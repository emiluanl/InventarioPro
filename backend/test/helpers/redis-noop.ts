// =============================================================================
// redisNoop - RedisService de reemplazo para tests que bootean AppModule
// =============================================================================
// Sin esto, RedisService.onModuleInit intenta conectar a REDIS_HOST (que el
// .env local define como localhost) → ECONNREFUSED ruidoso en cada suite que
// compila AppModule. Con este no-op, el rate limiting usa el storage en
// memoria de @nestjs/throttler y las cachés de Redis simplemente no hacen
// nada, igual que en modo local sin Redis.
// =============================================================================

import type { RedisService } from '../../src/common/redis.service';

export const redisNoop: Partial<RedisService> = {
  isEnabled: () => false,
  get: async () => null,
  set: async () => undefined,
  del: async () => undefined,
  delPattern: async () => undefined,
  getClient: () => {
    // Si algo intenta usar Redis de verdad en un test, que falle alto y claro.
    throw new Error('Redis no está inicializado (no-op de tests).');
  },
};
