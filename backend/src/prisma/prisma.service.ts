// =============================================================================
// Cliente Prisma singleton
// =============================================================================
// En NestJS normalmente se expone Prisma a través de un módulo (PrismaModule)
// que envuelve este singleton. Aquí dejamos el cliente listo para ser
// inyectado y un helper para tests.
//
// Prisma 7: el cliente se genera en src/generated/prisma (ver schema.prisma)
// y se conecta vía driver adapter en vez del engine Rust.
//
// DUAL-PROVIDER: con DB_PROVIDER=sqlite (modo local sin Docker, ver
// scripts/start.sh) se usa el adapter better-sqlite3 contra una BD file:.
// Por defecto (sin la variable) se usa PostgreSQL con @prisma/adapter-pg,
// como siempre (desarrollo con Docker, CI, producción). El cliente generado
// debe corresponder al proveedor activo (el script lo regenera al arrancar).
// =============================================================================

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DEFAULT_PG_URL =
  'postgresql://inventariopro:inventariopro@localhost:5432/inventariopro?schema=public';
// Relativa al cwd del backend (backend/prisma/dev.db). *.db ya está en .gitignore.
const DEFAULT_SQLITE_URL = 'file:./prisma/dev.db';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const provider = process.env.DB_PROVIDER ?? 'postgresql';
    const adapter =
      provider === 'sqlite'
        ? new PrismaBetterSqlite3({
            url: process.env.DATABASE_URL ?? DEFAULT_SQLITE_URL,
          })
        : new PrismaPg({
            connectionString: process.env.DATABASE_URL ?? DEFAULT_PG_URL,
          });

    super({
      adapter,
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
