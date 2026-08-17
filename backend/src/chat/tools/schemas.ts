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
      .max(100, 'Máximo 100 caracteres.')
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
  .strict(); // =============================================================================
// crear_producto
// =============================================================================
// SOLO crea una INTENCIÓN de producto. Los obligatorios (nombre, fecha_compra,
// tipo_compra, precio) son REQUIRED en el contrato del LLM. Si ya existe un
// producto con el mismo nombre + fecha, NO crea: devuelve needs_confirmation
// con un confirmation_id opaco (el executor guarda los args originales).
// La confirmación/cancelación son herramientas SEPARADAS
// (confirmar_creacion_producto / cancelar_creacion_producto).
// Los MaxLength replican los límites del DTO HTTP (create-product.dto.ts) para
// que la IA no pueda crear datos que el resto de la app rechazaría.
export const crearProductoSchema = z
  .object({
    nombre: z
      .string()
      .min(1, 'No puede estar vacío.')
      .max(200, 'Máximo 200 caracteres.')
      .describe('Nombre del producto.'),
    marca: z.string().max(120, 'Máximo 120 caracteres.').optional().describe('Marca del producto.'),
    modelo: z
      .string()
      .max(120, 'Máximo 120 caracteres.')
      .optional()
      .describe('Modelo del producto.'),
    descripcion: z
      .string()
      .max(2000, 'Máximo 2000 caracteres.')
      .optional()
      .describe('Descripción breve.'),
    fecha_compra: isoDate.describe(
      'ISO date. Si el usuario dice "hace 2 días", calcula tú la fecha.',
    ),
    lugar_compra: z
      .string()
      .max(200, 'Máximo 200 caracteres.')
      .optional()
      .describe('Tienda o lugar donde se compró.'),
    tipo_compra: z.enum(PURCHASE_TYPE).describe('FISICO u ONLINE.'),
    precio: z
      .number()
      .finite('Debe ser un número.')
      .min(0, 'No puede ser negativo.')
      .multipleOf(0.01, 'Máximo 2 decimales.')
      .describe('Precio en la moneda indicada (0 es válido para regalos).'),
    moneda: isoCurrency.optional().describe('Código ISO 4217 (USD, EUR, ARS...). Por defecto USD.'),
    // 0 = sin garantía (dato válido, como en el resto de la app); tope 600 meses.
    duracion_garantia_meses: z
      .number()
      .int('Debe ser un entero.')
      .min(0, 'Mínimo 0.')
      .max(600, 'Máximo 600 meses.')
      .optional()
      .describe('Garantía en meses (0 = sin garantía). Máximo 600.'),
    notas: z
      .string()
      .max(2000, 'Máximo 2000 caracteres.')
      .optional()
      .describe('Notas adicionales.'),
    // Categoría por NOMBRE (la IA no conoce IDs internos). Si no existe, se
    // crea como categoría personal del usuario (mismo patrón que importCsv).
    categoria_nombre: z
      .string()
      .max(60, 'Máximo 60 caracteres.')
      .optional()
      .describe('Nombre de la categoría (se crea si no existe).'),
    metodo_pago: z
      .string()
      .max(80, 'Máximo 80 caracteres.')
      .optional()
      .describe('Método de pago (efectivo, tarjeta...).'),
    numero_serie: z
      .string()
      .max(120, 'Máximo 120 caracteres.')
      .optional()
      .describe('Número de serie del producto.'),
    tags: z
      .string()
      .max(500, 'Máximo 500 caracteres.')
      .optional()
      .describe('Etiquetas separadas por comas.'),
  })
  .strict();

// =============================================================================
// confirmar_creacion_producto / cancelar_creacion_producto
// =============================================================================
// La confirmación se identifica por el confirmation_id OPACO que devolvió
// needs_confirmation (uuid aleatorio): nunca viajan IDs internos de productos
// ni claves de estado al LLM. La cancelación acepta el id opcional (si se
// omite, cancela el pendiente de la conversación actual si existe).
export const confirmarCreacionProductoSchema = z
  .object({
    confirmation_id: z
      .string()
      .min(1, 'No puede estar vacío.')
      .max(64, 'Máximo 64 caracteres.')
      .describe('ID opaco devuelto por needs_confirmation al pedir confirmación.'),
  })
  .strict();

export const cancelarCreacionProductoSchema = z
  .object({
    confirmation_id: z
      .string()
      .min(1, 'No puede estar vacío.')
      .max(64, 'Máximo 64 caracteres.')
      .optional()
      .describe(
        'ID opaco del pendiente a cancelar. Si se omite, cancela el pendiente de la conversación actual.',
      ),
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

/** Mapa nombre de tool → schema zod (las 6 funciones). */
export const TOOL_SCHEMAS = {
  buscar_productos: buscarProductosSchema,
  crear_producto: crearProductoSchema,
  confirmar_creacion_producto: confirmarCreacionProductoSchema,
  cancelar_creacion_producto: cancelarCreacionProductoSchema,
  consultar_garantias_por_vencer: garantiasPorVencerSchema,
  resumen_gastos: resumenGastosSchema,
} as const;
