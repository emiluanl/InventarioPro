// =============================================================================
// Paridad de esquemas Prisma (Postgres ↔ SQLite)
// =============================================================================
// El proyecto mantiene DOS esquemas en paralelo con el MISMO modelo de datos:
//   - prisma/schema.prisma         → PostgreSQL (producción)
//   - prisma/schema.sqlite.prisma  → SQLite (modo local sin Docker / desktop)
// Los únicos cambios legítimos entre ambos son:
//   1. datasource.provider = "postgresql" | "sqlite"
//   2. Atributos nativos @db.* (Text, Date, Decimal, VarChar...) — SQLite no
//      los soporta, así que solo existen en el de Postgres.
// CUALQUIER otra diferencia (modelos, enums, campos, tipos, @map, @default,
// @relation, índices) es un drift: alguien tocó un esquema y olvidó el otro.
// Este test lo detecta comparando ambos archivos normalizados.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PG_SCHEMA = join(__dirname, '..', 'prisma', 'schema.prisma');
const SQLITE_SCHEMA = join(__dirname, '..', 'prisma', 'schema.sqlite.prisma');

/**
 * Normaliza un schema para comparar solo lo que define el modelo de datos:
 *   - Quita comentarios (línea completa y final de línea).
 *   - Quita bloques datasource/generator (config, no modelo).
 *   - Quita atributos nativos @db.* (solo existen en Postgres).
 *   - Colapsa espacios y descarta líneas vacías.
 */
function normalizeSchema(raw: string): string {
  const out: string[] = [];
  let inConfigBlock = false;

  for (const original of raw.split('\n')) {
    // Comentarios completos y final de línea (los valores de @map no usan //).
    const line = original
      .replace(/^\s*\/\/.*$/, '')
      .replace(/\s+\/\/.*$/, '')
      .trim();

    // Bloques de config (datasource/generator): se descartan ENTEROS, incluido
    // su contenido (p. ej. provider = "postgresql") y su llave de cierre.
    if (inConfigBlock) {
      if (line === '}') inConfigBlock = false;
      continue;
    }
    if (line === 'datasource db {' || line === 'generator client {') {
      inConfigBlock = true;
      continue;
    }
    if (line.length === 0) continue;

    // Atributos nativos: @db.Text, @db.Decimal(12, 2), @db.VarChar(3)...
    // y whitespace estable (colapsar corridas de espacios).
    out.push(
      line
        .replace(/@db\.\w+(\([^)]*\))?/g, '')
        .trim()
        .replace(/\s{2,}/g, ' '),
    );
  }
  return out.join('\n');
}

describe('paridad de esquemas Prisma (Postgres ↔ SQLite)', () => {
  const pg = readFileSync(PG_SCHEMA, 'utf8');
  const sqlite = readFileSync(SQLITE_SCHEMA, 'utf8');

  it('usa los proveedores esperados (postgresql y sqlite)', () => {
    expect(pg).toContain('provider = "postgresql"');
    expect(sqlite).toContain('provider = "sqlite"');
  });

  it('define los mismos modelos y enums', () => {
    const modelsPg = pg.match(/^model \w+ \{/gm) ?? [];
    const modelsSqlite = sqlite.match(/^model \w+ \{/gm) ?? [];
    expect(modelsSqlite).toEqual(modelsPg);
    expect(modelsPg.length).toBeGreaterThan(0);

    const enumsPg = pg.match(/^enum \w+ \{/gm) ?? [];
    const enumsSqlite = sqlite.match(/^enum \w+ \{/gm) ?? [];
    expect(enumsSqlite).toEqual(enumsPg);
  });

  it('tiene campos, tipos, mapeos e índices idénticos (salvo @db.* y provider)', () => {
    const a = normalizeSchema(pg);
    const b = normalizeSchema(sqlite);
    expect(b).toBe(a);
  });

  it('el test en sí detecta un drift: una diferencia no legítima rompe la paridad', () => {
    // Regresión del propio test: si alguien toca un solo esquema (campo,
    // tipo, índice...) la comparación normalizada DEBE dejar de ser igual.
    // Sin esto, el test de paridad podría pasar en silencio con esquemas
    // divergentes por un bug del normalize.
    const driftPg = pg.replace(/model Product \{/, 'model Product {\n  campo_fantasma String?');
    const driftSqlite = sqlite.replace(
      /model Product \{/,
      'model Product {\n  campo_fantasma String?',
    );

    // Drift solo en Postgres → debe diferir.
    expect(normalizeSchema(driftPg)).not.toBe(normalizeSchema(sqlite));
    // Drift en ambos lados → vuelve a coincidir (el test no es caprichoso).
    expect(normalizeSchema(driftPg)).toBe(normalizeSchema(driftSqlite));
  });
});
