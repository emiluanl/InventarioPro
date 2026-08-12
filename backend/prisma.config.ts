// =============================================================================
// Prisma ORM 7 - configuración del CLI
// =============================================================================
// En Prisma 7 la URL de la BD y la ruta del schema ya NO viven en el
// datasource de schema.prisma: se configuran aquí. dotenv carga backend/.env
// para que `prisma generate` / `prisma migrate deploy` funcionen igual que
// antes, sin variables de entorno exportadas a mano.
//
// Nota: el fallback de URL solo aplica cuando DATABASE_URL no está definida
// (p. ej. durante `prisma generate` en el build de Docker, donde no hay .env).
// En runtime (contenedor o dev) DATABASE_URL siempre viene del compose/.env;
// si faltara, `migrate deploy` fallaría al conectar — comportamiento deseado.
// =============================================================================

import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://inventariopro:inventariopro@localhost:5432/inventariopro?schema=public',
  },
});
