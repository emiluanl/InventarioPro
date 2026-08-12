// =============================================================================
// Cliente Prisma singleton
// =============================================================================
// En NestJS normalmente se expone Prisma a través de un módulo (PrismaModule)
// que envuelve este singleton. Aquí dejamos el cliente listo para ser
// inyectado y un helper para tests.
//
// Prisma 7: el cliente se genera en src/generated/prisma (ver schema.prisma)
// y se conecta vía driver adapter (@prisma/adapter-pg) en vez del engine Rust.
// =============================================================================

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString:
          process.env.DATABASE_URL ??
          'postgresql://inventariopro:inventariopro@localhost:5432/inventariopro?schema=public',
      }),
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
