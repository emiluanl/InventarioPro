// =============================================================================
// Prisma ORM 7 - configuración del CLI
// =============================================================================
// En Prisma 7 la URL de la BD y la ruta del schema ya NO viven en el
// datasource de schema.prisma: se configuran aquí. dotenv carga backend/.env
// para que `prisma generate` / `prisma migrate deploy` funcionen igual que
// antes, sin variables de entorno exportadas a mano.
//
// DUAL-PROVIDER: con DB_PROVIDER=sqlite el CLI usa el schema SQLite
// (prisma/schema.sqlite.prisma), sus migraciones (prisma/migrations-sqlite) y
// una URL file: — el modo local SIN Docker que arranca scripts/start.sh.
// Sin DB_PROVIDER (por defecto) se comporta exactamente igual que antes:
// PostgreSQL (desarrollo con Docker, CI, producción).
//
// Nota: el fallback de URL solo aplica cuando DATABASE_URL no está definida
// (p. ej. durante `prisma generate` en el build de Docker, donde no hay .env).
// En runtime (contenedor o dev) DATABASE_URL siempre viene del compose/.env;
// si faltara, `migrate deploy` fallaría al conectar — comportamiento deseado.
// =============================================================================

import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const isSqlite = process.env.DB_PROVIDER === 'sqlite';

const DEFAULT_PG_URL =
  'postgresql://inventariopro:inventariopro@localhost:5432/inventariopro?schema=public';
// Relativa al cwd del backend (backend/prisma/dev.db). *.db ya está en .gitignore.
const DEFAULT_SQLITE_URL = 'file:./prisma/dev.db';

export default defineConfig({
  schema: isSqlite ? 'prisma/schema.sqlite.prisma' : 'prisma/schema.prisma',
  migrations: {
    path: isSqlite ? 'prisma/migrations-sqlite' : 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? (isSqlite ? DEFAULT_SQLITE_URL : DEFAULT_PG_URL),
  },
});
