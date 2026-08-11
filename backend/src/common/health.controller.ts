// =============================================================================
// HealthController - endpoint de salud para Docker / monitoreo
// =============================================================================
// Este endpoint es la "readiness" del stack: además de responder 200, verifica
// que la base de datos (SELECT 1) y Redis (PING) estén operativos. Si alguno
// falla responde 503 Service Unavailable, lo que hace que:
//   - El healthcheck del contenedor backend marque unhealthy.
//   - El contenedor monitor (probe a /api/health) alerte con /fail.
// De esta forma un backend "arriba pero con la BD caída" (5xx) no pasa
// desapercibido: el probe de liveness (/api/auth/me) solo confirma que el
// proceso responde.
// =============================================================================

import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from './redis.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check(): Promise<{ status: string; db: string; redis: string; timestamp: string }> {
    const timestamp = new Date().toISOString();

    // --- Base de datos: SELECT 1 fuerza una conexión real. ---
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      this.logger.error(`Health: BD no disponible: ${(err as Error).message}`);
      // El AllExceptionsFilter unifica el body; el detalle queda en el mensaje.
      throw new ServiceUnavailableException('Base de datos no disponible.');
    }

    // --- Redis: si está configurado (no-op en dev sin REDIS_HOST), PING. ---
    let redisStatus = 'disabled';
    if (this.redis.isEnabled()) {
      try {
        await this.redis.getClient().ping();
        redisStatus = 'up';
      } catch (err) {
        this.logger.error(`Health: Redis no disponible: ${(err as Error).message}`);
        throw new ServiceUnavailableException('Redis no disponible.');
      }
    }

    return { status: 'ok', db: 'up', redis: redisStatus, timestamp };
  }
}
