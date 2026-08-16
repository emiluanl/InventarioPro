// =============================================================================
// Schemas Zod de las herramientas del chat (function calling)
// =============================================================================
// FUENTE ÚNICA de verdad de los argumentos de las tools:
//   - ChatToolExecutor valida los args entrantes contra estos schemas (los
//     argumentos de la IA nunca llegan "crudos" a la base de datos).
//   - chat-tools.ts genera el JSON schema que se le manda a DeepSeek a partir
//     de estos mismos schemas (zod-to-json-schema), así el contrato que ve el
//     LLM y el que valida el backend nunca pueden divergir.
//
// Convenciones:
//   - .strict(): la IA no puede inventar claves fuera del contrato.
//   - .describe(): la descripción viaja al JSON schema que ve el LLM.
//   - Precio >= 0 (un regalo cuesta 0), moneda ISO 4217, fechas YYYY-MM-DD,
//     limit 1..50, dias 1..365 — mismos criterios que products.service.
// =============================================================================

import { z } from 'zod';

export const PRODUCT_STATUS = [
  'NUEVO',
  'USADO',
  'EN_REPARACION',
  'VENDIDO',
  'PERDIDO_ROBADO',
  'DADO_DE_BAJA',
] as const;

export const WARRANTY_STATUS = ['vigente', 'por_vencer', 'vencida'] as const;

export const PURCHASE_TYPE = ['FISICO', 'ONLINE'] as const;

export const GASTO_PERIODOS = [
  'mes_actual',
  'mes_pasado',
  'anio_actual',
  'ultimos_30_dias',
  'ultimos_90_dias',
] as const;

// Códigos ISO 4217 ACTIVOS (el refinamiento valida contra esta lista real, no
// solo contra "3 letras"). El regex queda para el JSON schema del LLM (light);
// el refine exige el código real server-side.
const ISO_4217_CURRENCIES = new Set([
  'AED',
  'AFN',
  'ALL',
  'AMD',
  'ANG',
  'AOA',
  'ARS',
  'AUD',
  'AWG',
  'AZN',
  'BAM',
  'BBD',
  'BDT',
  'BGN',
  'BHD',
  'BIF',
  'BMD',
  'BND',
  'BOB',
  'BOV',
  'BRL',
  'BSD',
  'BTN',
  'BWP',
  'BYN',
  'BZD',
  'CAD',
  'CDF',
  'CHE',
  'CHF',
  'CHW',
  'CLF',
  'CLP',
  'CNY',
  'COP',
  'COU',
  'CRC',
  'CUC',
  'CUP',
  'CVE',
  'CZK',
  'DJF',
  'DKK',
  'DOP',
  'DZD',
  'EGP',
  'ERN',
  'ETB',
  'EUR',
  'FJD',
  'FKP',
  'GBP',
  'GEL',
  'GHS',
  'GIP',
  'GMD',
  'GNF',
  'GTQ',
  'GYD',
  'HKD',
  'HNL',
  'HRK',
  'HTG',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'IQD',
  'IRR',
  'ISK',
  'JMD',
  'JOD',
  'JPY',
  'KES',
  'KGS',
  'KHR',
  'KMF',
  'KPW',
  'KRW',
  'KWD',
  'KYD',
  'KZT',
  'LAK',
  'LBP',
  'LKR',
  'LRD',
  'LSL',
  'LYD',
  'MAD',
  'MDL',
  'MGA',
  'MKD',
  'MMK',
  'MNT',
  'MOP',
  'MRU',
  'MUR',
  'MVR',
  'MWK',
  'MXN',
  'MXV',
  'MYR',
  'MZN',
  'NAD',
  'NGN',
  'NIO',
  'NOK',
  'NPR',
  'NZD',
  'OMR',
  'PAB',
  'PEN',
  'PGK',
  'PHP',
  'PKR',
  'PLN',
  'PYG',
  'QAR',
  'RON',
  'RSD',
  'RUB',
  'RWF',
  'SAR',
  'SBD',
  'SCR',
  'SDG',
  'SEK',
  'SGD',
  'SHP',
  'SLE',
  'SOS',
  'SRD',
  'SSP',
  'STN',
  'SVC',
  'SYP',
  'SZL',
  'THB',
  'TJS',
  'TMT',
  'TND',
  'TOP',
  'TRY',
  'TTD',
  'TWD',
  'TZS',
  'UAH',
  'UGX',
  'USD',
  'USN',
  'UYI',
  'UYU',
  'UYW',
  'UZS',
  'VED',
  'VES',
  'VND',
  'VUV',
  'WST',
  'XAF',
  'XAG',
  'XAU',
  'XBA',
  'XBB',
  'XBC',
  'XBD',
  'XCD',
  'XDR',
  'XOF',
  'XPD',
  'XPF',
  'XPT',
  'XSU',
  'XTS',
  'XUA',
  'XXX',
  'YER',
  'ZAR',
  'ZMW',
  'ZWL',
]);

// Fecha ISO + validez de CALENDARIO real: '2026-02-31' pasa el regex pero no
// existe — Date normaliza a marzo, así que se compara el round-trip completo.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser una fecha ISO (YYYY-MM-DD).')
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'La fecha no existe en el calendario (ej: 2026-02-31).');

// Moneda: regex (para el schema del LLM) + refine contra la lista ISO 4217 real.
const isoCurrency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Debe ser un código ISO 4217 de 3 letras.')
  .refine((c) => ISO_4217_CURRENCIES.has(c), 'No es un código ISO 4217 activo.');

// =============================================================================
// buscar_productos
// =============================================================================
// TODOS los filtros son opcionales: la IA puede llamar con {} y obtener el
// inventario completo (igual que el JSON schema original, sin `required`).
export const buscarProductosSchema = z
  .object({
    search: z
      .string()
      .optional()
      .describe('Texto a buscar en nombre, marca, modelo o descripción.'),
    categoria_id: z.string().optional().describe('ID de la categoría para filtrar.'),
    estado: z.enum(PRODUCT_STATUS).optional(),
    warranty_status: z.enum(WARRANTY_STATUS).optional(),
    fecha_desde: isoDate.optional().describe('ISO date (YYYY-MM-DD).'),
    fecha_hasta: isoDate.optional().describe('ISO date (YYYY-MM-DD).'),
    limit: z
      .number()
      .int('Debe ser un entero.')
      .min(1, 'Mínimo 1.')
      .max(50, 'Máximo 50.')
      .optional()
      .describe('Máximo de resultados. Por defecto 20.'),
  })
  .strict();

// =============================================================================
// crear_producto
// =============================================================================
export const crearProductoSchema = z
  .object({
    nombre: z.string().min(1, 'No puede estar vacío.').max(200, 'Máximo 200 caracteres.'),
    marca: z.string().optional(),
    modelo: z.string().optional(),
    descripcion: z.string().optional(),
    fecha_compra: isoDate.describe(
      'ISO date. Si el usuario dice "hace 2 días", calcula tú la fecha.',
    ),
    lugar_compra: z.string().optional(),
    tipo_compra: z.enum(PURCHASE_TYPE),
    precio: z.number().finite('Debe ser un número.').min(0, 'No puede ser negativo.'),
    moneda: isoCurrency.optional().describe('Código ISO 4217 (USD, EUR, ARS...). Por defecto USD.'),
    // 0 = sin garantía (dato válido, como en el resto de la app); tope 600 meses.
    duracion_garantia_meses: z
      .number()
      .int('Debe ser un entero.')
      .min(0, 'Mínimo 0.')
      .max(600, 'Máximo 600 meses.')
      .optional(),
    notas: z.string().optional(),
  })
  .strict();

// =============================================================================
// consultar_garantias_por_vencer
// =============================================================================
export const garantiasPorVencerSchema = z
  .object({
    dias: z
      .number()
      .int('Debe ser un entero.')
      .min(1, 'Mínimo 1.')
      .max(365, 'Máximo 365.')
      .optional()
      .describe('Ventana en días. Por defecto 30. Máximo 365.'),
  })
  .strict();

// =============================================================================
// resumen_gastos
// =============================================================================
export const resumenGastosSchema = z
  .object({
    periodo: z
      .enum(GASTO_PERIODOS)
      .optional()
      .describe('Periodo predefinido. Por defecto "anio_actual".'),
    categoria_id: z.string().optional().describe('Opcional: filtrar por categoría.'),
  })
  .strict();

/** Mapa nombre de tool → schema zod (las 4 funciones del brief). */
export const TOOL_SCHEMAS = {
  buscar_productos: buscarProductosSchema,
  crear_producto: crearProductoSchema,
  consultar_garantias_por_vencer: garantiasPorVencerSchema,
  resumen_gastos: resumenGastosSchema,
} as const;
