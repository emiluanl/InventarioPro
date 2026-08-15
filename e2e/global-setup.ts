// =============================================================================
// globalSetup - corre una vez antes de los tests
// =============================================================================
// Nota: los webServers de Playwright arrancan ANTES que globalSetup, así que
// las migraciones de la BD e2e y el build del backend viven en el comando del
// webServer (e2e/start-backend.cjs). Aquí:
//   1. Se truncan TODAS las tablas de la BD e2e (menos _prisma_migrations)
//      para que cada corrida parta de cero, sin importar datos de corridas
//      previas (locales o en CI con retries).
//   2. IMPORTANTE: el truncado borra también las categorías del sistema que el
//      bootstrap del backend sembró al arrancar (el webServer va ANTES que este
//      setup). Se re-siembran aquí para que los tests las tengan disponibles
//      (p. ej. crear un producto con categoria_id de sistema).
//   3. Se limpia el log de emails dev que los tests leen para obtener el token
//      de verificación.
// =============================================================================

import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { BACKEND_DIR, DATABASE_URL, EMAIL_LOG } from './env';

// pg no es dependencia directa del root (paquete e2e): se resuelve desde el
// node_modules del backend, donde lo instala @prisma/adapter-pg. En CI el job
// e2e hace `npm ci` en backend/, así que siempre está disponible.
const requireFromBackend = createRequire(join(BACKEND_DIR, 'package.json'));
const { Client } = requireFromBackend('pg');

export default async function globalSetup(): Promise<void> {
  rmSync(EMAIL_LOG, { force: true });
  mkdirSync(dirname(EMAIL_LOG), { recursive: true });

  const client = new Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await truncateDatabase(client);
    await seedSystemCategories(client);
  } finally {
    await client.end();
  }
}

// Borra los datos de la BD e2e (falla duro: si no se puede truncar, mejor
// abortar que correr los tests contra datos de una corrida anterior).
async function truncateDatabase(client: Client): Promise<void> {
  const { rows } = await client.query<{ tables: string | null }>(`
    SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS tables
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `);

  const tables = rows[0]?.tables;
  if (!tables) {
    console.log('[e2e] BD e2e sin tablas de datos, nada que truncar.');
    return;
  }

  await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  console.log('[e2e] BD e2e truncada: los tests parten de cero.');
}

// Las categorías del sistema (ids deterministas `system-<slug>`) las siembra el
// bootstrap del backend al arrancar, pero el truncado de arriba las borra. Las
// re-insertamos con la MISMA semántica que CategoriesService.seedSystemCategories
// para que los tests puedan usarlas (idempotente vía ON CONFLICT).
async function seedSystemCategories(client: Client): Promise<void> {
  const categories = [
    { nombre: 'Electrónica', icono: 'cpu' },
    { nombre: 'Electrodomésticos', icono: 'home' },
    { nombre: 'Muebles', icono: 'sofa' },
    { nombre: 'Ropa y calzado', icono: 'shirt' },
    { nombre: 'Herramientas', icono: 'wrench' },
    { nombre: 'Hogar y cocina', icono: 'utensils' },
    { nombre: 'Deportes', icono: 'dumbbell' },
    { nombre: 'Libros y música', icono: 'book' },
    { nombre: 'Joyería y accesorios', icono: 'gem' },
    { nombre: 'Otros', icono: 'package' },
  ];

  for (const cat of categories) {
    const id = `system-${cat.nombre.toLowerCase().replace(/\s+/g, '-')}`;
    await client.query(
      `INSERT INTO categories (id, nombre, icono, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, NULL, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, cat.nombre, cat.icono],
    );
  }
  console.log('[e2e] Categorías del sistema re-sembradas tras el truncado.');
}
