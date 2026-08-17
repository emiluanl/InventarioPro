// =============================================================================
// ChatTools - definiciones de las herramientas (function calling) para la IA
// =============================================================================
// Estas son las 6 funciones del brief (crear/confirmar/cancelar separadas).
// La IA puede invocarlas cuando el usuario hace una pregunta relevante. La
// ejecución corre del lado del backend (ver ToolExecutor), NUNCA en el cliente.
//
// Los JSON schemas NO se escriben a mano: se GENERAN a partir de los schemas
// zod de ./schemas (zod-to-json-schema). Así el contrato que ve DeepSeek y el
// que valida ToolExecutor son la misma fuente de verdad.
// =============================================================================

import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { ChatTool } from '../DeepSeek/chat.types';
import {
  buscarProductosSchema,
  confirmarCreacionProductoSchema,
  cancelarCreacionProductoSchema,
  crearProductoSchema,
  garantiasPorVencerSchema,
  resumenGastosSchema,
} from './schemas';

type ToolParameters = ChatTool['function']['parameters'];

function buildTool(name: string, description: string, schema: ZodTypeAny): ChatTool {
  // zod-to-json-schema devuelve { $ref, definitions: { [name]: schema } }.
  const generated = zodToJsonSchema(schema, name) as {
    definitions?: Record<string, ToolParameters>;
    $ref?: string;
  };
  const params =
    (name && generated.definitions?.[name]) || (generated as unknown as ToolParameters);

  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: params.properties ?? {},
        required: params.required,
        // .strict() en los schemas → la IA no inventa claves fuera del contrato.
        additionalProperties: params.additionalProperties ?? false,
      },
    },
  };
}

export const CHAT_TOOLS: ChatTool[] = [
  buildTool(
    'buscar_productos',
    'Busca productos del usuario por criterios como texto libre, categoría, rango de fechas, estado o estado de garantía. Devuelve una lista resumida.',
    buscarProductosSchema,
  ),
  buildTool(
    'crear_producto',
    'Crea un producto a partir de datos extraídos de lenguaje natural. Úsala cuando el usuario diga algo como "acabo de comprar X en Y por $Z". Si devuelve needs_confirmation (posible duplicado), pregunta al usuario y luego usa confirmar_creacion_producto o cancelar_creacion_producto.',
    crearProductoSchema,
  ),
  buildTool(
    'confirmar_creacion_producto',
    'Confirma la creación de un posible duplicado que el usuario aprobó. Acepta SOLO el confirmation_id que devolvió needs_confirmation. El producto se crea con los datos originales que el usuario ya vio.',
    confirmarCreacionProductoSchema,
  ),
  buildTool(
    'cancelar_creacion_producto',
    'Cancela la creación de un posible duplicado que el usuario rechazó. Acepta el confirmation_id que devolvió needs_confirmation (opcional). No crea nada.',
    cancelarCreacionProductoSchema,
  ),
  buildTool(
    'consultar_garantias_por_vencer',
    'Devuelve productos cuya garantía vence en los próximos N días (por defecto 30).',
    garantiasPorVencerSchema,
  ),
  buildTool(
    'resumen_gastos',
    'Calcula el gasto total en productos, agrupado por categoría, dentro de un periodo.',
    resumenGastosSchema,
  ),
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

Confirmación de duplicados en crear_producto:
- Si crear_producto devuelve needs_confirmation, existe un producto con el mismo
  nombre y fecha de compra: preguntá al usuario si lo crea igual.
- La respuesta trae un confirmation_id. NUNCA lo inventes ni lo modifiques:
  usá exactamente el que devolvió la herramienta.
- Si el usuario CONFIRMA: llamá confirmar_creacion_producto con ESE
  confirmation_id. El producto se crea con los datos originales guardados;
  no hace falta repetirlos.
- Si el usuario RECHAZA: llamá cancelar_creacion_producto con ESE
  confirmation_id (no se crea nada).
- Si confirmar_creacion_producto dice que la confirmación no existe, ya fue
  usada o expiró, o si cancelar_creacion_producto no cancela nada: informá al
  usuario con naturalidad y proponé reintentar la creación.
`;
