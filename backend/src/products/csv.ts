// =============================================================================
// csv.ts - serialización CSV de productos (import / export)
// =============================================================================
// Define las columnas del CSV de InventarioPro (mismas en import y export para
// que un archivo exportado pueda re-importarse sin cambios).
//
// Convenciones:
//   - UTF-8 (con BOM tolerado en la lectura: Excel añade BOM al exportar).
//   - Fechas en YYYY-MM-DD. Prisma devuelve los @db.Date a medianoche UTC, así
//     que formateamos con getUTC* para no desplazar el día según la zona horaria.
//   - La primera fila es la cabecera (nombre de columna).
// =============================================================================

import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export const PRODUCT_CSV_COLUMNS = [
  'nombre',
  'categoria',
  'marca',
  'modelo',
  'descripcion',
  'fecha_compra',
  'lugar_compra',
  'tipo_compra',
  'precio',
  'moneda',
  'metodo_pago',
  'numero_serie',
  'duracion_garantia_meses',
  'fecha_vencimiento_garantia',
  'estado',
  'notas',
  'tags',
] as const;

export type CsvRow = Record<string, string>;

/** Convierte un Date a YYYY-MM-DD (UTC, ver nota del archivo). */
export function formatCsvDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Genera el CSV con cabecera a partir de filas (objetos clave -> valor). */
export function buildProductsCsv(rows: CsvRow[]): string {
  return stringify(rows, {
    header: true,
    columns: PRODUCT_CSV_COLUMNS as unknown as string[],
  });
}

/**
 * Parsea el contenido de un CSV de productos.
 * - columns: true  -> la primera fila son los nombres de columna.
 * - trim + skip_empty_lines: tolera espacios y filas en blanco (Excel).
 * - bom: true -> elimina el BOM UTF-8.
 * - relax_column_count: tolera filas con más/menos columnas (no corta la importación).
 */
export function parseProductsCsv(content: string): CsvRow[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  }) as CsvRow[];
}
