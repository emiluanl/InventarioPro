// =============================================================================
// Tests del ChatToolExecutor — validación zod de argumentos + warranty_status
// =============================================================================
// Verifica:
//   1. Los argumentos pasan por los schemas zod ANTES de tocar la BD: un arg
//      inválido devuelve { error } y NUNCA llega a Prisma.
//   2. warranty_status SÍ filtra en SQL (el bug silencioso: estaba declarado en
//      el schema pero ignorado en el where).
//   3. Límites por tool: limit 1..50, fechas YYYY-MM-DD, precio >= 0, moneda
//      ISO 4217, enums (estado, tipo_compra, periodo) y MaxLength de todos los
//      campos (mismos límites del DTO HTTP).
//   4. El flujo feliz construye el where correcto y crea con Decimal.
//   5. Deduplicación consultiva con confirmation_id OPACO y tools separadas
//      (confirmar/cancelar): idempotencia, TTL y aislamiento por conversación.
// =============================================================================

import { Prisma } from '../src/generated/prisma/client';
import { ChatToolExecutor } from '../src/chat/tools/tool-executor';

function buildMocks() {
  const product = {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({
      id: 'p1',
      nombre: 'Licuadora',
      fecha_compra: new Date('2026-08-15T00:00:00.000Z'),
      precio: { toString: () => '129.99' },
      moneda: 'USD',
    }),
  };
  const category = {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'cat-new', nombre: 'Electro' }),
  };
  const prisma = { product, category };
  const executor = new ChatToolExecutor(prisma as never);
  return { prisma, executor };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('ChatToolExecutor — validación y ejecución de tools', () => {
  it('devuelve error para una función desconocida', async () => {
    const { executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'no_existe', {});
    expect(res).toEqual({ error: 'Función desconocida: no_existe' });
  });

  // -------------------------------------------------------------------------
  // buscar_productos — filtro warranty_status (el fix)
  // -------------------------------------------------------------------------
  it('buscar_productos filtra warranty_status=vencida en SQL (lt now)', async () => {
    const { prisma, executor } = buildMocks();
    const before = Date.now();

    await executor.execute('u1', 'conv-1', 'buscar_productos', { warranty_status: 'vencida' });

    const where = prisma.product.findMany.mock.calls[0][0].where;
    expect(where.user_id).toBe('u1');
    expect(where.deleted_at).toBeNull();
    const lt = where.fecha_vencimiento_garantia.lt as Date;
    expect(lt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(lt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('buscar_productos filtra warranty_status=por_vencer (gt now, lte +30d)', async () => {
    const { prisma, executor } = buildMocks();
    const before = Date.now();

    await executor.execute('u1', 'conv-1', 'buscar_productos', { warranty_status: 'por_vencer' });

    const fv = prisma.product.findMany.mock.calls[0][0].where.fecha_vencimiento_garantia;
    expect(fv.gt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    const in30 = new Date(Date.now() + 30 * DAY_MS);
    expect(Math.abs(fv.lte.getTime() - in30.getTime())).toBeLessThanOrEqual(5_000);
  });

  it('buscar_productos filtra warranty_status=vigente (gt +30d)', async () => {
    const { prisma, executor } = buildMocks();

    await executor.execute('u1', 'conv-1', 'buscar_productos', { warranty_status: 'vigente' });

    const fv = prisma.product.findMany.mock.calls[0][0].where.fecha_vencimiento_garantia;
    const in30 = new Date(Date.now() + 30 * DAY_MS);
    expect(Math.abs(fv.gt.getTime() - in30.getTime())).toBeLessThanOrEqual(5_000);
  });

  // -------------------------------------------------------------------------
  // buscar_productos — validación de argumentos
  // -------------------------------------------------------------------------
  it('buscar_productos con limit inválido devuelve error sin consultar', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'buscar_productos', { limit: 0 });
    expect((res as { error: string }).error).toContain('Argumentos inválidos');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('buscar_productos con fecha inválida devuelve error', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'buscar_productos', { fecha_desde: 'ayer' });
    expect((res as { error: string }).error).toContain('fecha_desde');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('buscar_productos con estado inválido devuelve error', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'buscar_productos', { estado: 'ROTO' });
    expect((res as { error: string }).error).toContain('estado');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('buscar_productos con search y fechas válidas construye el where', async () => {
    const { prisma, executor } = buildMocks();

    await executor.execute('u1', 'conv-1', 'buscar_productos', {
      search: 'licuadora',
      fecha_desde: '2026-01-01',
      fecha_hasta: '2026-12-31',
    });

    const where = prisma.product.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeDefined();
    expect(where.fecha_compra.gte).toEqual(new Date('2026-01-01'));
    expect(where.fecha_compra.lte).toEqual(new Date('2026-12-31'));
  });

  it('buscar_productos respeta el default de limit (20)', async () => {
    const { prisma, executor } = buildMocks();
    await executor.execute('u1', 'conv-1', 'buscar_productos', {});
    expect(prisma.product.findMany.mock.calls[0][0].take).toBe(20);
  });

  it('args nulos se tratan como objeto vacío', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'buscar_productos', null as never);
    expect(res).toEqual([]);
    expect(prisma.product.findMany).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // crear_producto
  // -------------------------------------------------------------------------
  it('crear_producto con args válidos crea el producto con Decimal', async () => {
    const { prisma, executor } = buildMocks();

    const res = await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 129.99,
    });

    expect((res as { ok: boolean }).ok).toBe(true);
    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data.user_id).toBe('u1');
    expect(data.nombre).toBe('Licuadora Oster');
    expect(data.precio).toBeInstanceOf(Prisma.Decimal);
    expect(data.moneda).toBe('USD');
    expect(data.fecha_vencimiento_garantia).toBeNull();
  });

  it('crear_producto calcula fecha_vencimiento desde la duración (UTC)', async () => {
    const { prisma, executor } = buildMocks();

    await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'TV',
      fecha_compra: '2026-08-15',
      tipo_compra: 'ONLINE',
      precio: 500,
      duracion_garantia_meses: 12,
    });

    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data.fecha_vencimiento_garantia.toISOString().slice(0, 10)).toBe('2027-08-15');
  });

  it.each([
    ['sin nombre', { fecha_compra: '2026-08-15', tipo_compra: 'FISICO', precio: 10 }],
    [
      'precio negativo',
      { nombre: 'X', fecha_compra: '2026-08-15', tipo_compra: 'FISICO', precio: -1 },
    ],
    [
      'precio no numérico',
      { nombre: 'X', fecha_compra: '2026-08-15', tipo_compra: 'FISICO', precio: 'caro' },
    ],
    [
      'moneda en minúsculas',
      { nombre: 'X', fecha_compra: '2026-08-15', tipo_compra: 'FISICO', precio: 10, moneda: 'us' },
    ],
    [
      'moneda no ISO 4217 real (ZZZ)',
      { nombre: 'X', fecha_compra: '2026-08-15', tipo_compra: 'FISICO', precio: 10, moneda: 'ZZZ' },
    ],
    [
      'tipo_compra inválido',
      { nombre: 'X', fecha_compra: '2026-08-15', tipo_compra: 'REGALO', precio: 10 },
    ],
    [
      'fecha con formato inválido',
      { nombre: 'X', fecha_compra: 'hoy', tipo_compra: 'FISICO', precio: 10 },
    ],
    [
      'fecha que no existe en el calendario (2026-02-31)',
      { nombre: 'X', fecha_compra: '2026-02-31', tipo_compra: 'FISICO', precio: 10 },
    ],
    [
      'duración no entera',
      {
        nombre: 'X',
        fecha_compra: '2026-08-15',
        tipo_compra: 'FISICO',
        precio: 10,
        duracion_garantia_meses: 2.5,
      },
    ],
    [
      'duración > 600 meses',
      {
        nombre: 'X',
        fecha_compra: '2026-08-15',
        tipo_compra: 'FISICO',
        precio: 10,
        duracion_garantia_meses: 601,
      },
    ],
    [
      'clave extra (strict)',
      { nombre: 'X', fecha_compra: '2026-08-15', tipo_compra: 'FISICO', precio: 10, hack: true },
    ],
  ])('crear_producto rechaza %s', async (_label, args) => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'crear_producto', args as never);
    expect((res as { error: string }).error).toContain('Argumentos inválidos');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('crear_producto acepta duracion_garantia_meses=0 (sin garantía)', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'X',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 10,
      duracion_garantia_meses: 0,
    });
    expect((res as { ok: boolean }).ok).toBe(true);
    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data.duracion_garantia_meses).toBe(0);
    expect(data.fecha_vencimiento_garantia).toBeNull();
  });

  it('crear_producto acepta moneda ISO 4217 real (ARS)', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'X',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 10,
      moneda: 'ARS',
    });
    expect((res as { ok: boolean }).ok).toBe(true);
    expect(prisma.product.create.mock.calls[0][0].data.moneda).toBe('ARS');
  });

  // -------------------------------------------------------------------------
  // crear_producto — límites de longitud (mismos MaxLength del DTO HTTP)
  // -------------------------------------------------------------------------
  it.each([
    ['nombre > 200', { nombre: 'x'.repeat(201) }],
    ['marca > 120', { marca: 'x'.repeat(121) }],
    ['modelo > 120', { modelo: 'x'.repeat(121) }],
    ['descripcion > 2000', { descripcion: 'x'.repeat(2001) }],
    ['lugar_compra > 200', { lugar_compra: 'x'.repeat(201) }],
    ['metodo_pago > 80', { metodo_pago: 'x'.repeat(81) }],
    ['numero_serie > 120', { numero_serie: 'x'.repeat(121) }],
    ['notas > 2000', { notas: 'x'.repeat(2001) }],
    ['tags > 500', { tags: 'x'.repeat(501) }],
    ['categoria_nombre > 60', { categoria_nombre: 'x'.repeat(61) }],
  ])('crear_producto rechaza %s', async (_label, extra) => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'X',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 10,
      ...extra,
    } as never);
    expect((res as { error: string }).error).toContain('Argumentos inválidos');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('buscar_productos rechaza search > 100 caracteres', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'buscar_productos', {
      search: 'x'.repeat(101),
    });
    expect((res as { error: string }).error).toContain('search');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // crear_producto — deduplicación consultiva (nunca automática)
  // -------------------------------------------------------------------------
  it('crear_producto pide confirmación si ya existe el mismo nombre+fecha (no crea, id opaco, sin IDs internos)', async () => {
    const { prisma, executor } = buildMocks();
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: 'p-old',
        nombre: 'licuadora oster', // case distinto: el match es case-insensitive
        fecha_compra: new Date('2026-08-15T00:00:00.000Z'),
        precio: { toString: () => '129.99' },
        moneda: 'USD',
      },
    ]);

    const res = (await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 129.99,
    })) as {
      needs_confirmation?: boolean;
      confirmation_id?: string;
      similar?: unknown[];
    };

    expect(res.needs_confirmation).toBe(true);
    // Id OPACO (uuid) — nunca la clave interna ni IDs de productos.
    expect(res.confirmation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.similar).toHaveLength(1);
    // Los similares NO exponen el id interno del producto al LLM.
    expect(res.similar![0]).not.toHaveProperty('id');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('confirmar_creacion_producto con el confirmation_id crea con los argumentos ORIGINALES (sin repetir datos)', async () => {
    const { prisma, executor } = buildMocks();
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: 'p-old',
        nombre: 'Licuadora Oster',
        fecha_compra: new Date('2026-08-15T00:00:00.000Z'),
        precio: { toString: () => '150' },
        moneda: 'USD',
      },
    ]);

    // Turno 1: duplicado → needs_confirmation + confirmation_id.
    const first = (await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 150,
      lugar_compra: 'Falabella',
    })) as { confirmation_id: string };
    expect(prisma.product.create).not.toHaveBeenCalled();

    // Turno 2: la tool de confirmación acepta SOLO el id — crea con los
    // ORIGINALES (la IA no puede repetir ni alterar datos: ni los acepta).
    const res = await executor.execute('u1', 'conv-1', 'confirmar_creacion_producto', {
      confirmation_id: first.confirmation_id,
    });

    expect((res as { ok: boolean }).ok).toBe(true);
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data.nombre).toBe('Licuadora Oster');
    expect(data.fecha_compra).toEqual(new Date('2026-08-15T00:00:00Z'));
    expect(data.precio.toString()).toBe('150');
    expect(data.lugar_compra).toBe('Falabella');
  });

  it('confirmar_creacion_producto es IDEMPOTENTE: la misma confirmación no crea dos productos', async () => {
    const { prisma, executor } = buildMocks();
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: 'p-old',
        nombre: 'Licuadora Oster',
        fecha_compra: new Date('2026-08-15T00:00:00.000Z'),
        precio: { toString: () => '150' },
        moneda: 'USD',
      },
    ]);

    const first = (await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 150,
    })) as { confirmation_id: string };

    const ok = await executor.execute('u1', 'conv-1', 'confirmar_creacion_producto', {
      confirmation_id: first.confirmation_id,
    });
    expect((ok as { ok: boolean }).ok).toBe(true);
    expect(prisma.product.create).toHaveBeenCalledTimes(1);

    // Segunda llamada con el MISMO id: la confirmación ya fue consumida.
    const again = (await executor.execute('u1', 'conv-1', 'confirmar_creacion_producto', {
      confirmation_id: first.confirmation_id,
    })) as { error: string };
    expect(again.error).toContain('no existe, ya fue usada o expiró');
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
  });

  it('confirmar_creacion_producto con id desconocido se rechaza (no crea)', async () => {
    const { prisma, executor } = buildMocks();
    const res = (await executor.execute('u1', 'conv-1', 'confirmar_creacion_producto', {
      confirmation_id: 'no-existe',
    })) as { error: string };
    expect(res.error).toContain('no existe, ya fue usada o expiró');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('confirmar_creacion_producto desde OTRA conversación se rechaza (aislamiento por conversación)', async () => {
    const { prisma, executor } = buildMocks();
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: 'p-old',
        nombre: 'Licuadora Oster',
        fecha_compra: new Date('2026-08-15T00:00:00.000Z'),
        precio: { toString: () => '150' },
        moneda: 'USD',
      },
    ]);

    const first = (await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 150,
    })) as { confirmation_id: string };

    // Mismo usuario, OTRA conversación: se rechaza (el pendiente es de conv-1).
    const res = (await executor.execute('u1', 'conv-2', 'confirmar_creacion_producto', {
      confirmation_id: first.confirmation_id,
    })) as { error: string };
    expect(res.error).toContain('no corresponde a esta conversación');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('confirmar_creacion_producto rechaza argumentos fuera del contrato (solo confirmation_id)', async () => {
    const { prisma, executor } = buildMocks();
    const res = (await executor.execute('u1', 'conv-1', 'confirmar_creacion_producto', {
      confirmation_id: 'x',
      nombre: 'Intento de alterar el producto',
      precio: 999,
    })) as { error: string };
    expect(res.error).toContain('Argumentos inválidos');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('cancelar_creacion_producto cancela y limpia; un confirmar posterior se rechaza', async () => {
    const { prisma, executor } = buildMocks();
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: 'p-old',
        nombre: 'Licuadora Oster',
        fecha_compra: new Date('2026-08-15T00:00:00.000Z'),
        precio: { toString: () => '150' },
        moneda: 'USD',
      },
    ]);

    const first = (await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 150,
    })) as { confirmation_id: string };

    const cancel = (await executor.execute('u1', 'conv-1', 'cancelar_creacion_producto', {
      confirmation_id: first.confirmation_id,
    })) as { cancelada: boolean };
    expect(cancel.cancelada).toBe(true);
    expect(prisma.product.create).not.toHaveBeenCalled();

    // El pendiente quedó limpio: confirmar con el mismo id se rechaza.
    const later = (await executor.execute('u1', 'conv-1', 'confirmar_creacion_producto', {
      confirmation_id: first.confirmation_id,
    })) as { error: string };
    expect(later.error).toContain('no existe, ya fue usada o expiró');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('cancelar_creacion_producto es segura aunque no exista pendiente (con o sin id)', async () => {
    const { prisma, executor } = buildMocks();
    const withId = (await executor.execute('u1', 'conv-1', 'cancelar_creacion_producto', {
      confirmation_id: 'nada-por-acá',
    })) as { cancelada: boolean };
    expect(withId.cancelada).toBe(true);

    const withoutId = (await executor.execute(
      'u1',
      'conv-1',
      'cancelar_creacion_producto',
      {},
    )) as {
      cancelada: boolean;
    };
    expect(withoutId.cancelada).toBe(true);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('la confirmación pendiente expira (TTL 10 min): confirmar posterior se rechaza', async () => {
    jest.useFakeTimers();
    try {
      const { prisma, executor } = buildMocks();
      prisma.product.findMany.mockResolvedValueOnce([
        {
          id: 'p-old',
          nombre: 'Licuadora Oster',
          fecha_compra: new Date('2026-08-15T00:00:00.000Z'),
          precio: { toString: () => '150' },
          moneda: 'USD',
        },
      ]);

      const first = (await executor.execute('u1', 'conv-1', 'crear_producto', {
        nombre: 'Licuadora Oster',
        fecha_compra: '2026-08-15',
        tipo_compra: 'FISICO',
        precio: 150,
      })) as { confirmation_id: string };

      jest.advanceTimersByTime(11 * 60 * 1000); // +11 min: el pendiente expiró

      const res = (await executor.execute('u1', 'conv-1', 'confirmar_creacion_producto', {
        confirmation_id: first.confirmation_id,
      })) as { error: string };
      expect(res.error).toContain('no existe, ya fue usada o expiró');
      expect(prisma.product.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('crear_producto crea directo si el similar tiene OTRA fecha (no es duplicado)', async () => {
    const { prisma, executor } = buildMocks();
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: 'p-old',
        nombre: 'Licuadora Oster',
        fecha_compra: new Date('2025-01-01T00:00:00.000Z'), // fecha distinta
        precio: { toString: () => '129.99' },
        moneda: 'USD',
      },
    ]);

    const res = await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 129.99,
    });

    expect((res as { ok: boolean }).ok).toBe(true);
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // crear_producto — campos nuevos (categoría, pago, serie, tags)
  // -------------------------------------------------------------------------
  it('crear_producto resuelve categoria_nombre existente (case-insensitive)', async () => {
    const { prisma, executor } = buildMocks();
    prisma.category.findMany.mockResolvedValueOnce([{ id: 'cat-1', nombre: 'Electrodomésticos' }]);

    await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'X',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 10,
      categoria_nombre: 'electrodomésticos',
    });

    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data.categoria_id).toBe('cat-1');
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it('crear_producto crea la categoría personal si no existe', async () => {
    const { prisma, executor } = buildMocks();

    await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'X',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 10,
      categoria_nombre: 'MiCategoría',
    });

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: { nombre: 'MiCategoría', user_id: 'u1' },
    });
    expect(prisma.product.create.mock.calls[0][0].data.categoria_id).toBe('cat-new');
  });

  it('crear_producto completa metodo_pago, numero_serie y tags', async () => {
    const { prisma, executor } = buildMocks();

    await executor.execute('u1', 'conv-1', 'crear_producto', {
      nombre: 'X',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 10,
      metodo_pago: 'Tarjeta de crédito',
      numero_serie: 'SN-123',
      tags: 'cocina, nuevo',
    });

    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data.metodo_pago).toBe('Tarjeta de crédito');
    expect(data.numero_serie).toBe('SN-123');
    expect(data.tags).toBe('cocina, nuevo');
  });

  // -------------------------------------------------------------------------
  // Sanitización de errores internos (Prisma nunca llega al usuario)
  // -------------------------------------------------------------------------
  it('un error de Prisma se devuelve genérico, sin filtrar el detalle interno', async () => {
    const { prisma, executor } = buildMocks();
    const prismaError = Object.assign(
      new Error(
        'PrismaClientValidationError: Argument `precio`: Invalid value. SELECT "id" FROM "products"...',
      ),
      {
        constructor: { name: 'PrismaClientValidationError' },
      },
    );
    prisma.product.findMany.mockRejectedValueOnce(prismaError);

    const res = (await executor.execute('u1', 'conv-1', 'buscar_productos', {})) as {
      error: string;
    };

    expect(res.error).toBe('Error interno al consultar los datos. Inténtalo de nuevo.');
    expect(res.error).not.toContain('SELECT');
    expect(res.error).not.toContain('prisma');
  });

  it('un error inesperado NO Prisma también se devuelve genérico', async () => {
    const { prisma, executor } = buildMocks();
    prisma.product.findMany.mockRejectedValueOnce(new Error('se rompió algo interno'));

    const res = (await executor.execute('u1', 'conv-1', 'buscar_productos', {})) as {
      error: string;
    };

    expect(res.error).toBe('Ocurrió un error al ejecutar la herramienta. Inténtalo de nuevo.');
  });

  // -------------------------------------------------------------------------
  // consultar_garantias_por_vencer
  // -------------------------------------------------------------------------
  it('garantías con dias inválido (0) devuelve error sin consultar', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'consultar_garantias_por_vencer', {
      dias: 0,
    });
    expect((res as { error: string }).error).toContain('dias');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('garantías con dias 30 consulta con ventana de fechas', async () => {
    const { prisma, executor } = buildMocks();
    await executor.execute('u1', 'conv-1', 'consultar_garantias_por_vencer', { dias: 30 });
    const where = prisma.product.findMany.mock.calls[0][0].where;
    expect(where.fecha_vencimiento_garantia.not).toBeNull();
    expect(where.fecha_vencimiento_garantia.lte).toBeInstanceOf(Date);
    expect(where.fecha_vencimiento_garantia.gte).toBeInstanceOf(Date);
  });

  // -------------------------------------------------------------------------
  // resumen_gastos
  // -------------------------------------------------------------------------
  it('resumen_gastos con periodo inválido devuelve error', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'conv-1', 'resumen_gastos', { periodo: 'el_anio' });
    expect((res as { error: string }).error).toContain('periodo');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('resumen_gastos con periodo válido suma y agrupa por categoría', async () => {
    const { prisma, executor } = buildMocks();
    prisma.product.findMany.mockResolvedValueOnce([
      { id: 'a', precio: { toString: () => '10' }, categoria: { nombre: 'Electro' } },
      { id: 'b', precio: { toString: () => '20' }, categoria: { nombre: 'Electro' } },
      { id: 'c', precio: { toString: () => '5' }, categoria: null },
    ]);

    const res = (await executor.execute('u1', 'conv-1', 'resumen_gastos', {
      periodo: 'anio_actual',
    })) as { total: string; cantidad_productos: number; por_categoria: Record<string, number> };

    expect(res.total).toBe('35.00');
    expect(res.cantidad_productos).toBe(3);
    expect(res.por_categoria).toEqual({ Electro: 30, 'Sin categoría': 5 });
  });

  it('resumen_gastos filtra por categoria_id', async () => {
    const { prisma, executor } = buildMocks();
    await executor.execute('u1', 'conv-1', 'resumen_gastos', { categoria_id: 'cat1' });
    const where = prisma.product.findMany.mock.calls[0][0].where;
    expect(where.categoria_id).toBe('cat1');
  });
});
