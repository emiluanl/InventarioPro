// =============================================================================
// Cliente Prisma singleton
// =============================================================================
// En NestJS normalmente se expone Prisma a través de un módulo (PrismaModule)
// que envuelve este singleton. Aquí dejamos el cliente listo para ser
// inyectado y un helper para tests.
//
// Patrón recomendado por la documentación de Prisma:
// https://www.prisma.io/docs/guides/database/troubleshooting-database-issues
// =============================================================================

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
