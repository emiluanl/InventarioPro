// =============================================================================
// Test de integración: rate limiting del chat POR USUARIO
// =============================================================================
// Verifica que el límite de 20 msg/min de /chat/message se aplica por USUARIO
// autenticado y NO por IP: dos usuarios distintos tras la misma IP (supertest
// habla con el mismo servidor/socket, así que req.ip es idéntico) tienen
// buckets independientes — u2 no se bloquea cuando u1 agota el suyo.
//
// El guard usa ThrottlerUserGuard (getTracker => user:{id} si hay sesión).
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

describe('Rate limiting del chat por usuario (integración)', () => {
  let app: INestApplication;
  let prisma: MockPrisma;
  let u1Token: string;
  let u2Token: string;

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
    u1Token = await jwt.signAsync({ sub: 'u1', email: 'u1@example.com' });
    u2Token = await jwt.signAsync({ sub: 'u2', email: 'u2@example.com' });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  function sendMessage(token: string): request.Test {
    return http()
      .post('/api/chat/message')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'hola' });
  }

  it('dos usuarios tras la misma IP tienen buckets independientes (límite por usuario)', async () => {
    prisma.chatConversation.findFirst.mockResolvedValue(null);
    prisma.chatConversation.create.mockResolvedValue({ id: 'c1', user_id: 'u1' });
    prisma.chatConversation.update.mockResolvedValue({});
    prisma.chatMessage.findMany.mockResolvedValue([]);
    prisma.chatMessage.create.mockResolvedValue({});

    // 1) u1 llena su bucket: 20 mensajes -> 200
    const u1Codes: number[] = [];
    for (let i = 0; i < 20; i++) {
      u1Codes.push((await sendMessage(u1Token)).status);
    }
    expect(u1Codes).toEqual(Array(20).fill(200));

    // 2) u2, desde la MISMA IP, no está bloqueado: si el límite fuera por IP
    //    este sería el 21º de esa IP -> 429. Su bucket es propio: 1/20 usado.
    const u2First = await sendMessage(u2Token);
    expect(u2First.status).toBe(200);
    expect(u2First.headers['x-ratelimit-remaining']).toBe('19');

    // 3) u1 sí agotó SU bucket: el siguiente mensaje -> 429 con Retry-After.
    const u1Blocked = await sendMessage(u1Token);
    expect(u1Blocked.status).toBe(429);
    expect(u1Blocked.headers['retry-after']).toBeDefined();

    // 4) u2 sigue con su bucket intacto -> 200, remaining 18.
    const u2Second = await sendMessage(u2Token);
    expect(u2Second.status).toBe(200);
    expect(u2Second.headers['x-ratelimit-remaining']).toBe('18');
  });
});
