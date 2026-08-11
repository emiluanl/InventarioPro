// =============================================================================
// ChatTools - definiciones de las herramientas (function calling) para la IA
// =============================================================================
// Estas son las 4 funciones del brief. La IA puede invocarlas cuando el
// usuario hace una pregunta relevante. La ejecución corre del lado del
// backend (ver ToolExecutor), NUNCA en el cliente.
//
// Schema en formato JSON-Schema (compatible con OpenAI/Qwen/Anthropic).
// =============================================================================

import { ChatTool } from '../DeepSeek/chat.types';

export const CHAT_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'buscar_productos',
      description:
        'Busca productos del usuario por criterios como texto libre, categoría, rango de fechas, estado o estado de garantía. Devuelve una lista resumida.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Texto a buscar en nombre, marca, modelo o descripción.',
          },
          categoria_id: { type: 'string', description: 'ID de la categoría para filtrar.' },
          estado: {
            type: 'string',
            enum: ['NUEVO', 'USADO', 'EN_REPARACION', 'VENDIDO', 'PERDIDO_ROBADO', 'DADO_DE_BAJA'],
          },
          warranty_status: {
            type: 'string',
            enum: ['vigente', 'por_vencer', 'vencida'],
          },
          fecha_desde: { type: 'string', description: 'ISO date (YYYY-MM-DD).' },
          fecha_hasta: { type: 'string', description: 'ISO date (YYYY-MM-DD).' },
          limit: { type: 'number', description: 'Máximo de resultados. Por defecto 20.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_producto',
      description:
        'Crea un producto a partir de datos extraídos de lenguaje natural. Úsala cuando el usuario diga algo como "acabo de comprar X en Y por $Z".',
      parameters: {
        type: 'object',
        required: ['nombre', 'fecha_compra', 'tipo_compra', 'precio'],
        properties: {
          nombre: { type: 'string' },
          marca: { type: 'string' },
          modelo: { type: 'string' },
          descripcion: { type: 'string' },
          fecha_compra: {
            type: 'string',
            description: 'ISO date. Si el usuario dice "hace 2 días", calcula tú la fecha.',
          },
          lugar_compra: { type: 'string' },
          tipo_compra: { type: 'string', enum: ['FISICO', 'ONLINE'] },
          precio: { type: 'number' },
          moneda: {
            type: 'string',
            description: 'Código ISO 4217 (USD, EUR, ARS...). Por defecto USD.',
          },
          duracion_garantia_meses: { type: 'number' },
          notas: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_garantias_por_vencer',
      description:
        'Devuelve productos cuya garantía vence en los próximos N días (por defecto 30).',
      parameters: {
        type: 'object',
        properties: {
          dias: {
            type: 'number',
            description: 'Ventana en días. Por defecto 30. Máximo 365.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_gastos',
      description:
        'Calcula el gasto total en productos, agrupado por categoría, dentro de un periodo.',
      parameters: {
        type: 'object',
        properties: {
          periodo: {
            type: 'string',
            enum: ['mes_actual', 'mes_pasado', 'anio_actual', 'ultimos_30_dias', 'ultimos_90_dias'],
            description: 'Periodo predefinido. Por defecto "anio_actual".',
          },
          categoria_id: { type: 'string', description: 'Opcional: filtrar por categoría.' },
        },
      },
    },
  },
];

// =============================================================================
// System prompt que se inyecta en cada conversación.
// =============================================================================
export const SYSTEM_PROMPT = `Eres el asistente de InventarioPro, una app personal para registrar productos, garantías y gastos.

Tu trabajo es ayudar al usuario a:
- Registrar productos nuevos a partir de lenguaje natural (usa crear_producto).
- Consultar qué tiene y dónde lo compró (usa buscar_productos).
- Avisarle de garantías por vencer (usa consultar_garantias_por_vencer).
- Resumir gastos por categoría o periodo (usa resumen_gastos).

Reglas:
- Responde SIEMPRE en español, salvo que el usuario escriba en otro idioma.
- Sé conciso y directo. Si una pregunta es ambigua, pide UNA aclaración.
- NUNCA reveles identificadores internos al usuario (user_id, tokens).
- NUNCA inventes productos: usa las herramientas para consultar antes de afirmar.
- Si una herramienta falla, dilo con naturalidad y sugiere reintentar.
- Formatea importes como "$150.00 USD" o "150,00 €" según la moneda.
`;
