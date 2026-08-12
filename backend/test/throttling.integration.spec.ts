// =============================================================================
// Test de integración: rate limiting por endpoint
// =============================================================================
// Levanta la app completa (AppModule) con Prisma mockeado y verifica con
// supertest que cada endpoint respeta su límite documentado (SECURITY.md):
//   - forgot-password / resend-verification: 3 por hora
//   - login: 5 por 15 minutos
//   - chat/message: 20 por minuto
//   - register: 100 por hora (se comprueba que no se limita prematuramente)
//   - /health (global): sin fuga de los límites estrictos de otras rutas
//
// Cada bucket del throttler es por endpoint (clave sha256(Clase+Handler+IP)),
// así que los tests no interfieren entre sí aunque compartan el módulo.
// No se necesita base de datos: PrismaService se sustituye por mocks.
// =============================================================================

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockPrisma, buildPrismaMock } from './helpers/prisma-mock';

jest.setTimeout(60000);

describe('Rate limiting por endpoint (integración)', () => {
  let app: INestApplication;
  let prisma: MockPrisma;
  let accessToken: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-32chars-minimum';
    process.env.NODE_ENV = 'test';

    prisma = buildPrismaMock();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    // main.ts aplica el prefijo global; lo replicamos para probar las rutas reales.
    app.setGlobalPrefix('api');
    await app.init();

    const jwt = moduleRef.get<JwtService>(JwtService);
    accessToken = await jwt.signAsync({ sub: 'u1', email: 'a@b.com' });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  /** Ejecuta `fn` `times` veces y devuelve los códigos de estado en orden. */
  async function statuses(times: number, fn: () => request.Test): Promise<number[]> {
    const codes: number[] = [];
    for (let i = 0; i < times; i++) {
      codes.push((await fn()).status);
    }
    return codes;
  }

  it('forgot-password respeta 3 por hora (3x200 + 429)', async () => {
    const send = () =>
      http().post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });
    await expect(statuses(4, send)).resolves.toEqual([200, 200, 200, 429]);
  });

  it('resend-verification respeta 3 por hora (3x200 + 429)', async () => {
    const send = () =>
      http().post('/api/auth/resend-verification').send({ email: 'ghost@example.com' });
    await expect(statuses(4, send)).resolves.toEqual([200, 200, 200, 429]);
  });

  it('login respeta 5 por 15 minutos (5x401 + 429)', async () => {
    const send = () =>
      http().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'x' });
    await expect(statuses(6, send)).resolves.toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('chat/message respeta 20 por minuto (20x200 + 429)', async () => {
    prisma.chatConversation.findFirst.mockResolvedValue(null);
    prisma.chatConversation.create.mockResolvedValue({ id: 'c1', user_id: 'u1' });
    prisma.chatConversation.update.mockResolvedValue({});
    prisma.chatMessage.findMany.mockResolvedValue([]);
    prisma.chatMessage.create.mockResolvedValue({});

    const send = () =>
      http()
        .post('/api/chat/message')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'hola' });
    const codes = await statuses(21, send);
    expect(codes.slice(0, 20)).toEqual(Array(20).fill(200));
    expect(codes[20]).toBe(429);
  });

  it('register no se limita prematuramente (3x201, límite documentado 100/h)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u1', email: 'a@b.com' });

    const send = () =>
      http()
        .post('/api/auth/register')
        .send({ email: 'a@b.com', password: 'Password123', nombre: 'A' });
    await expect(statuses(3, send)).resolves.toEqual([201, 201, 201]);
  });

  it('los límites estrictos no se filtran a otras rutas (/health 8x200)', async () => {
    await expect(statuses(8, () => http().get('/api/health'))).resolves.toEqual(Array(8).fill(200));
  });
});
