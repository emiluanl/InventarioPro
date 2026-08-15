// =============================================================================
// Filtros de string compatibles con PostgreSQL y SQLite
// =============================================================================
// PostgreSQL soporta mode: 'insensitive' (ILIKE). SQLite NO: emitir ese
// argumento haría fallar la query en runtime y ni siquiera existe en los tipos
// del cliente generado. La buena noticia: el LIKE de SQLite ya es
// case-insensitive (para ASCII, igual de útil que ILIKE), así que basta
// OMITIR `mode` cuando el proveedor es sqlite (modo local sin Docker).
//
// Los objetos devueltos son estructuralmente compatibles con
// StringFilter/StringNullableFilter de ambos clientes generados.
// =============================================================================

export type CiStringFilter = { contains: string; mode?: 'insensitive' };
export type CiEqualsFilter = { equals: string; mode?: 'insensitive' };

const isSqlite = (): boolean => process.env.DB_PROVIDER === 'sqlite';

/** contains case-insensitive (ILIKE en Postgres, LIKE nativo en SQLite). */
export function ciContains(value: string): CiStringFilter {
  const filter: CiStringFilter = { contains: value };
  if (!isSqlite()) filter.mode = 'insensitive';
  return filter;
}

/** equals case-insensitive (ILIKE en Postgres; en SQLite igual exacto). */
export function ciEquals(value: string): CiEqualsFilter {
  const filter: CiEqualsFilter = { equals: value };
  if (!isSqlite()) filter.mode = 'insensitive';
  return filter;
}
