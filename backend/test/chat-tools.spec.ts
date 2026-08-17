// =============================================================================
// Test de contrato del payload de tools para DeepSeek
// =============================================================================
// CHAT_TOOLS se GENERA desde los schemas zod (zod-to-json-schema). Este test
// fija el contrato que el LLM ve, para que un cambio en los schemas no rompa
// silenciosamente el function calling:
//   1. Las 6 funciones del brief existen con sus nombres.
//   2. buscar_productos NO exige nada ({} es válido — el mock e2e llama así).
//   3. crear_producto exige nombre/fecha_compra/tipo_compra/precio (la
//      confirmación es tool aparte: confirmar_creacion_producto solo acepta
//      confirmation_id, sin campos de producto).
//   4. additionalProperties: false (schema .strict() — la IA no inventa claves).
//   5. Las descripciones viajan al payload (documentación para el LLM).
// =============================================================================

import { CHAT_TOOLS } from '../src/chat/tools/chat-tools';

describe('CHAT_TOOLS — contrato del JSON schema para DeepSeek', () => {
  const byName = (name: string) => CHAT_TOOLS.find((t) => t.function.name === name);

  it('expone las 6 funciones del brief', () => {
    expect(CHAT_TOOLS.map((t) => t.function.name).sort()).toEqual([
      'buscar_productos',
      'cancelar_creacion_producto',
      'confirmar_creacion_producto',
      'consultar_garantias_por_vencer',
      'crear_producto',
      'resumen_gastos',
    ]);
  });

  it('buscar_productos no exige ningún argumento ({} es válido)', () => {
    const tool = byName('buscar_productos');
    expect(tool?.function.parameters.required).toBeUndefined();
    expect(tool?.function.parameters.properties).toHaveProperty('warranty_status');
    expect(tool?.function.parameters.properties).toHaveProperty('limit');
  });

  it('crear_producto exige nombre/fecha_compra/tipo_compra/precio y NO tiene confirmar', () => {
    const tool = byName('crear_producto');
    expect(tool?.function.parameters.required?.sort()).toEqual([
      'fecha_compra',
      'nombre',
      'precio',
      'tipo_compra',
    ]);
    expect(tool?.function.parameters.properties).toHaveProperty('moneda');
    expect(tool?.function.parameters.properties).toHaveProperty('duracion_garantia_meses');
    // La confirmación es tool aparte: crear_producto ya no expone `confirmar`.
    expect(tool?.function.parameters.properties).not.toHaveProperty('confirmar');
  });

  it('confirmar_creacion_producto acepta SOLO confirmation_id (sin campos de producto)', () => {
    const tool = byName('confirmar_creacion_producto');
    expect(tool?.function.parameters.required?.sort()).toEqual(['confirmation_id']);
    expect(Object.keys(tool?.function.parameters.properties ?? {})).toEqual(['confirmation_id']);
  });

  it('cancelar_creacion_producto acepta confirmation_id opcional', () => {
    const tool = byName('cancelar_creacion_producto');
    expect(tool?.function.parameters.required).toBeUndefined();
    expect(tool?.function.parameters.properties).toHaveProperty('confirmation_id');
  });

  it('los schemas .strict() marcan additionalProperties: false', () => {
    for (const tool of CHAT_TOOLS) {
      expect(tool.function.parameters.additionalProperties).toBe(false);
    }
  });

  it('las descripciones llegan al payload (documentación del LLM)', () => {
    const tool = byName('buscar_productos');
    const limit = tool?.function.parameters.properties.limit as { description?: string };
    expect(limit.description).toContain('Máximo de resultados');
    const fecha = tool?.function.parameters.properties.fecha_desde as {
      description?: string;
    };
    expect(fecha.description).toBe('ISO date (YYYY-MM-DD).');
  });

  it('los enums se reflejan en el schema', () => {
    const tool = byName('buscar_productos');
    const estado = tool?.function.parameters.properties.estado as { enum?: string[] };
    expect(estado.enum).toContain('NUEVO');
    expect(estado.enum).toContain('VENDIDO');
    const warranty = tool?.function.parameters.properties.warranty_status as {
      enum?: string[];
    };
    expect(warranty.enum).toEqual(['vigente', 'por_vencer', 'vencida']);
  });
});
