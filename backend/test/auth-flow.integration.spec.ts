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

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailService } from '../src/auth/email.service';
import { MockPrisma, buildPrismaMock } from './helpers/prisma-mock';

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
    if (!db.user || db.user.email !== where.email) return null;
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
}

describe('Flujo completo de auth (integración)', () => {
  let app: INestApplication;
  let prisma: MockPrisma;
  let email: { sendVerificationEmail: jest.Mock; sendPasswordResetEmail: jest.Mock };
  let db: Db;

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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(EmailService)
      .useValue(email)
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
