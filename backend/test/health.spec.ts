// =============================================================================
// Tests de HealthController (readiness del stack)
// =============================================================================
// Verifica que /api/health responda 200 solo cuando BD y Redis están
// operativos, y 503 (formato unificado del AllExceptionsFilter) si la BD está
// caída (backend "arriba" pero degradado) o Redis configurado no responde.
// =============================================================================

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { MockPrisma, buildPrismaMock } from './helpers/prisma-mock';

describe('HealthController', () => {
  let app: INestApplication;
  let prisma: MockPrisma;
  let redis: { isEnabled: jest.Mock; getClient: jest.Mock };

  beforeAll(async () => {
    prisma = buildPrismaMock();
    redis = {
      isEnabled: jest.fn().mockReturnValue(false), // no-op (dev sin REDIS_HOST)
      getClient: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(RedisService)
      .useValue(redis)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const http = () => request(app.getHttpServer());

  it('responde 200 ok cuando la BD funciona (redis no-op)', async () => {
    prisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);

    const res = await http().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up', redis: 'disabled' });
  });

  it('responde 503 cuando la BD está caída (backend arriba pero degradado)', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("Can't reach database server"));

    const res = await http().get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.statusCode).toBe(503);
    expect(res.body.message).toContain('Base de datos no disponible');
  });

  it('responde 503 cuando Redis está configurado pero no responde', async () => {
    prisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    redis.isEnabled.mockReturnValue(true);
    redis.getClient.mockReturnValue({
      ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });

    const res = await http().get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.message).toContain('Redis no disponible');
  });

  it('responde 200 con redis up cuando está configurado y responde', async () => {
    prisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    redis.isEnabled.mockReturnValue(true);
    redis.getClient.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });

    const res = await http().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.redis).toBe('up');
  });
});
