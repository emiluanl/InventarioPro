// =============================================================================
// Test de integración: flujo completo de autenticación
// =============================================================================
// Levanta la app completa (AppModule) con Prisma mockeado (una "BD" en
// memoria dentro del mock) y EmailService mockeado que CAPTURA los tokens
// enviados, y verifica el ciclo real por HTTP:
//
//   registro → login bloqueado (email sin verificar) → verificación con el
//   token del email → login OK (cookies) → /auth/me con la cookie de sesión
//   → refresh rotando la cookie.
//
//   Y el reenvío: un enlace nuevo INVALIDA el anterior.
//
// El password se hashea con argon2 REAL (como en producción): el login
// verifica exactamente la cadena que generó el registro.
// No se necesita base de datos: PrismaService se sustituye por mocks.
// =============================================================================

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ThrottlerStorage } from '@nestjs/throttler';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailService } from '../src/auth/email.service';
import { StorageService } from '../src/common/storage.service';
import { MockPrisma, buildPrismaMock } from './helpers/prisma-mock';

// =============================================================================
// Storage de throttling con RESET entre tests.
// =============================================================================
// El guard global aplica los límites reales (login: 5 por 15 min por IP, etc.).
// Como toda la suite comparte la misma IP, sin reset los buckets se acumulan
// entre tests y el 5º/6º login de la suite recibe 429 (falso positivo). Con
// este storage, cada test arranca con buckets vacíos: los límites se respetan
// DENTRO de cada test, pero no se arrastran entre tests.
// =============================================================================
// El record que espera el guard no se exporta del paquete; replicamos su forma.
interface ThrottleRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

class TestThrottleStorage implements ThrottlerStorage {
  private buckets = new Map<string, { hits: number; expireAt: number; blockedUntil: number }>();

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<ThrottleRecord> {
    const now = Date.now();
    const prev = this.buckets.get(key);
    const hits = prev && prev.expireAt > now ? prev.hits + 1 : 1;
    const wasBlocked = prev ? prev.blockedUntil > now : false;
    const isBlocked = hits > limit || wasBlocked;
    const blockedUntil = isBlocked ? Math.max(now + blockDuration, prev?.blockedUntil ?? 0) : 0;
    const expireAt = Math.max(now + ttl, prev?.expireAt ?? 0);
    this.buckets.set(key, { hits, expireAt, blockedUntil });
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, expireAt - now),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.max(0, blockedUntil - now) : 0,
    };
  }

  reset(): void {
    this.buckets.clear();
  }
}

jest.setTimeout(60000);

interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  nombre: string;
  email_verificado: boolean;
  email_verification_token: string | null;
  email_verification_expires_at: Date | null;
}

interface Db {
  user: DbUser | null;
  refreshTokens: number;
}

/** Conecta el mock de Prisma a una "BD" en memoria para que el flujo sea realista. */
function wireDbMocks(prisma: MockPrisma, db: Db): void {
  prisma.user.findUnique.mockImplementation(({ where }: any) => {
    if (!db.user) return null;
    // El service busca tanto por email (login) como por id (change-password,
    // delete-account): matcheamos por la clave que traiga el where.
    if (where.email && db.user.email !== where.email) return null;
    if (where.id && db.user.id !== where.id) return null;
    return db.user;
  });

  prisma.user.findFirst.mockImplementation(({ where }: any) => {
    if (!db.user) return null;
    if (where.email_verification_token !== db.user.email_verification_token) return null;
    if (
      db.user.email_verification_expires_at &&
      db.user.email_verification_expires_at <= new Date()
    ) {
      return null;
    }
    return db.user;
  });

  prisma.user.create.mockImplementation(({ data }: any) => {
    db.user = {
      id: `u-${Math.random().toString(36).slice(2, 10)}`,
      email: data.email,
      password_hash: data.password_hash,
      nombre: data.nombre,
      email_verificado: false,
      email_verification_token: data.email_verification_token,
      email_verification_expires_at: data.email_verification_expires_at,
    };
    return db.user;
  });

  prisma.user.update.mockImplementation(({ data }: any) => {
    if (!db.user) throw new Error('update sin usuario en BD');
    Object.assign(db.user, data);
    return db.user;
  });

  prisma.refreshToken.create.mockImplementation(() => {
    db.refreshTokens += 1;
    return { id: `rt${db.refreshTokens}` };
  });

  prisma.refreshToken.findUnique.mockImplementation(({ where }: any) => ({
    id: 'rt-stored',
    token_hash: where.token_hash,
    revoked_at: null,
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
    user: { id: db.user?.id ?? 'u1', email: db.user?.email ?? 'a@b.com' },
  }));

  prisma.refreshToken.update.mockResolvedValue({});

  prisma.user.delete.mockImplementation(() => {
    db.user = null;
    return { id: 'deleted' };
  });

  prisma.productAttachment.findMany.mockResolvedValue([]);
}

describe('Flujo completo de auth (integración)', () => {
  let app: INestApplication;
  let prisma: MockPrisma;
  let email: { sendVerificationEmail: jest.Mock; sendPasswordResetEmail: jest.Mock };
  let db: Db;

  let throttlerStorage: TestThrottleStorage;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-32chars-minimum';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-32chars-minimum';
    process.env.NODE_ENV = 'test';

    db = { user: null, refreshTokens: 0 };
    prisma = buildPrismaMock();
    wireDbMocks(prisma, db);

    email = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const storage = { delete: jest.fn().mockResolvedValue(undefined) };
    throttlerStorage = new TestThrottleStorage();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(EmailService)
      .useValue(email)
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider(ThrottlerStorage)
      .useValue(throttlerStorage)
      .compile();

    app = moduleRef.createNestApplication();
    // main.ts aplica el prefijo global, cookieParser (el strategy JWT lee la
    // cookie access_token) y el ValidationPipe; los replicamos para probar las
    // rutas exactamente como en producción.
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    throttlerStorage.reset();
  });

  const http = () => request(app.getHttpServer());

  /** Último token de verificación capturado por el mock de EmailService. */
  function lastVerificationToken(): string {
    const calls = email.sendVerificationEmail.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][1] as string;
  }

  // ===========================================================================
  // FLUJO COMPLETO
  // ===========================================================================
  it('registro → login bloqueado → verificación → login OK → /auth/me → refresh', async () => {
    // 1) Registro: crea la cuenta y envía el email de verificación
    const reg = await http()
      .post('/api/auth/register')
      .send({ email: 'nuevo@example.com', password: 'Password123', nombre: 'Nuevo' });
    expect(reg.status).toBe(201);
    expect(reg.body.message).toContain('Registro completado');
    expect(email.sendVerificationEmail).toHaveBeenCalledTimes(1);

    // 2) Login bloqueado: el email aún no está verificado
    const blocked = await http()
      .post('/api/auth/login')
      .send({ email: 'nuevo@example.com', password: 'Password123' });
    expect(blocked.status).toBe(401);
    expect(blocked.body.message).toContain('Debes verificar tu email');

    // 3) Verificación con el token real capturado del email
    const token = lastVerificationToken();
    const verify = await http().post('/api/auth/verify-email').send({ token });
    expect(verify.status).toBe(200);
    expect(verify.body.message).toContain('verificado');

    // 4) Login OK: emite cookies de sesión
    const login = await http()
      .post('/api/auth/login')
      .send({ email: 'nuevo@example.com', password: 'Password123' });
    expect(login.status).toBe(200);
    const setCookie = (login.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(setCookie.join('; ')).toContain('access_token=');

    // 5) /auth/me autenticado con la cookie de sesión
    const me = await http().get('/api/auth/me').set('Cookie', setCookie);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('nuevo@example.com');

    // 6) Refresh: rota el refresh token vía cookie
    const refresh = await http().post('/api/auth/refresh').set('Cookie', setCookie);
    expect(refresh.status).toBe(200);
    expect(refresh.body.access_token).toBeDefined();
    expect((refresh.headers['set-cookie'] as unknown as string[]).join('; ')).toContain(
      'access_token=',
    );
  });

  // ===========================================================================
  // REENVÍO: un enlace nuevo invalida el anterior
  // ===========================================================================
  it('el reenvío genera un enlace nuevo que invalida el anterior', async () => {
    const reg = await http()
      .post('/api/auth/register')
      .send({ email: 'reenvio@example.com', password: 'Password123', nombre: 'R' });
    expect(reg.status).toBe(201);

    const first = lastVerificationToken();

    const resend = await http()
      .post('/api/auth/resend-verification')
      .send({ email: 'reenvio@example.com' });
    expect(resend.status).toBe(200);
    expect(email.sendVerificationEmail).toHaveBeenCalledTimes(2); // registro + reenvío

    const second = lastVerificationToken();
    expect(second).not.toBe(first);

    // El enlace original quedó invalidado (token reemplazado en BD)
    const old = await http().post('/api/auth/verify-email').send({ token: first });
    expect(old.status).toBe(400);

    // El nuevo enlace funciona
    const fresh = await http().post('/api/auth/verify-email').send({ token: second });
    expect(fresh.status).toBe(200);
    expect(fresh.body.message).toContain('verificado');
  });

  // ===========================================================================
  // REGISTRO DUPLICADO
  // ===========================================================================
  it('rechaza el registro con un email ya existente (409, mensaje genérico)', async () => {
    const first = await http()
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'Password123', nombre: 'A' });
    expect(first.status).toBe(201);

    const dup = await http()
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'Password123', nombre: 'B' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toContain('No se pudo completar el registro');
    // No se envía un segundo email de verificación
    expect(email.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  // ===========================================================================
  // CHANGE PASSWORD estando logueado
  // ===========================================================================
  it('cambia la contraseña con la actual correcta y revoca las sesiones', async () => {
    const reg = await http()
      .post('/api/auth/register')
      .send({ email: 'cambio@example.com', password: 'OldPass123', nombre: 'C' });
    expect(reg.status).toBe(201);
    const token = lastVerificationToken();
    await http().post('/api/auth/verify-email').send({ token });

    const login = await http()
      .post('/api/auth/login')
      .send({ email: 'cambio@example.com', password: 'OldPass123' });
    const setCookie = (login.headers['set-cookie'] as unknown as string[]) ?? [];

    // 1) Contraseña actual incorrecta → 401 y NO se cambia nada.
    const wrong = await http()
      .post('/api/auth/change-password')
      .set('Cookie', setCookie)
      .send({ current_password: 'WrongPass1', new_password: 'NewPass456' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toContain('actual no es correcta');

    // 1b) La whitelist estricta del backend rechaza propiedades extra
    // (confirm_password es solo validación de UI, nunca debe viajar).
    const extra = await http().post('/api/auth/change-password').set('Cookie', setCookie).send({
      current_password: 'OldPass123',
      new_password: 'NewPass456',
      confirm_password: 'NewPass456',
    });
    expect(extra.status).toBe(400);
    expect((extra.body.message as string[]).join(' ')).toContain('should not exist');

    // 2) Cambio correcto → 200, limpia cookies y revoca TODAS las sesiones.
    const change = await http()
      .post('/api/auth/change-password')
      .set('Cookie', setCookie)
      .send({ current_password: 'OldPass123', new_password: 'NewPass456' });
    expect(change.status).toBe(200);
    expect(change.body.message).toContain('actualizada');
    const cleared = (change.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cleared.join('; ')).toContain('access_token=;');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: expect.any(String) }),
      }),
    );

    // 3) La contraseña vieja ya no sirve; la nueva sí.
    const oldLogin = await http()
      .post('/api/auth/login')
      .send({ email: 'cambio@example.com', password: 'OldPass123' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await http()
      .post('/api/auth/login')
      .send({ email: 'cambio@example.com', password: 'NewPass456' });
    expect(newLogin.status).toBe(200);
  });

  // ===========================================================================
  // DELETE ACCOUNT
  // ===========================================================================
  it('elimina la cuenta solo con la contraseña correcta y limpia la sesión', async () => {
    const reg = await http()
      .post('/api/auth/register')
      .send({ email: 'borrame@example.com', password: 'Delete123', nombre: 'B' });
    expect(reg.status).toBe(201);
    const token = lastVerificationToken();
    await http().post('/api/auth/verify-email').send({ token });

    const login = await http()
      .post('/api/auth/login')
      .send({ email: 'borrame@example.com', password: 'Delete123' });
    const setCookie = (login.headers['set-cookie'] as unknown as string[]) ?? [];

    // 1) Contraseña incorrecta → 401, la cuenta sigue.
    const wrong = await http()
      .delete('/api/auth/account')
      .set('Cookie', setCookie)
      .send({ password: 'WrongPass1' });
    expect(wrong.status).toBe(401);
    expect(db.user?.email).toBe('borrame@example.com');

    // 2) Eliminación correcta → 200, cookies limpiadas y usuario borrado.
    const del = await http()
      .delete('/api/auth/account')
      .set('Cookie', setCookie)
      .send({ password: 'Delete123' });
    expect(del.status).toBe(200);
    expect(del.body.message).toContain('eliminados');
    const cleared = (del.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cleared.join('; ')).toContain('access_token=;');
    expect(db.user).toBeNull();

    // 3) Login con las credenciales antiguas → ya no existe la cuenta.
    const relogin = await http()
      .post('/api/auth/login')
      .send({ email: 'borrame@example.com', password: 'Delete123' });
    expect(relogin.status).toBe(401);
  });

  // ===========================================================================
  // LOGIN CON CONTRASEÑA INCORRECTA
  // ===========================================================================
  it('rechaza el login con contraseña incorrecta sin emitir tokens', async () => {
    await http()
      .post('/api/auth/register')
      .send({ email: 'pw@example.com', password: 'Password123', nombre: 'P' });

    const before = db.refreshTokens;
    const bad = await http()
      .post('/api/auth/login')
      .send({ email: 'pw@example.com', password: 'WrongPass1' });
    expect(bad.status).toBe(401);
    expect(bad.body.message).toContain('Credenciales inválidas');
    expect(db.refreshTokens).toBe(before);
  });

  // ===========================================================================
  // TOKEN DE VERIFICACIÓN INVÁLIDO
  // ===========================================================================
  it('rechaza un token de verificación inválido o expirado (400)', async () => {
    const bad = await http().post('/api/auth/verify-email').send({ token: 'token-inexistente' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('inválido o expirado');
  });
});
