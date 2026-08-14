// =============================================================================
// Servicio de Redis (cliente compartido)
// =============================================================================
// Usado por: rate limiting (ThrottlerStorage), blacklist de tokens
// revocados, y caché de consultas repetidas en otros módulos.
//
// Si REDIS_HOST no está definido, los métodos devuelven no-op para no romper
// el arranque. En producción siempre debe estar configurado.
// =============================================================================

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const host = this.config.get<string>('REDIS_HOST');
    const port = Number(this.config.get<string>('REDIS_PORT') ?? 6379);
    const password = this.config.get<string>('REDIS_PASSWORD') || undefined;

    if (!host) {
      this.logger.warn('REDIS_HOST no definido: el servicio funcionará en modo no-op.');
      return;
    }

    this.client = new Redis({
      host,
      port,
      password,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    this.enabled = true;

    this.client.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
    this.client.on('connect', () => {
      this.logger.log(`Redis conectado en ${host}:${port}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis no está inicializado.');
    }
    return this.client;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(key);
  }

  /**
   * Borra todas las claves que coinciden con un patrón (SCAN + DEL, sin
   * bloquear el servidor como KEYS). No-op si Redis no está disponible.
   */
  async delPattern(pattern: string): Promise<void> {
    if (!this.client) return;
    const stream = this.client.scanStream({ match: pattern, count: 100 });
    const pipeline = this.client.pipeline();

    for await (const keys of stream) {
      if (keys.length > 0) {
        pipeline.del(...keys);
      }
    }
    await pipeline.exec();
  }
}
