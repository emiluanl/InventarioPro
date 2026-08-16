// =============================================================================
// Tests del ChatToolExecutor — validación zod de argumentos + warranty_status
// =============================================================================
// Verifica:
//   1. Los argumentos pasan por los schemas zod ANTES de tocar la BD: un arg
//      inválido devuelve { error } y NUNCA llega a Prisma.
//   2. warranty_status SÍ filtra en SQL (el bug silencioso: estaba declarado en
//      el schema pero ignorado en el where).
//   3. Límites por tool: limit 1..50, fechas YYYY-MM-DD, precio >= 0, moneda
//      ISO 4217, enums (estado, tipo_compra, periodo).
//   4. El flujo feliz construye el where correcto y crea con Decimal.
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
    const res = await executor.execute('u1', 'no_existe', {});
    expect(res).toEqual({ error: 'Función desconocida: no_existe' });
  });

  // -------------------------------------------------------------------------
  // buscar_productos — filtro warranty_status (el fix)
  // -------------------------------------------------------------------------
  it('buscar_productos filtra warranty_status=vencida en SQL (lt now)', async () => {
    const { prisma, executor } = buildMocks();
    const before = Date.now();

    await executor.execute('u1', 'buscar_productos', { warranty_status: 'vencida' });

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

    await executor.execute('u1', 'buscar_productos', { warranty_status: 'por_vencer' });

    const fv = prisma.product.findMany.mock.calls[0][0].where.fecha_vencimiento_garantia;
    expect(fv.gt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    const in30 = new Date(Date.now() + 30 * DAY_MS);
    expect(Math.abs(fv.lte.getTime() - in30.getTime())).toBeLessThanOrEqual(5_000);
  });

  it('buscar_productos filtra warranty_status=vigente (gt +30d)', async () => {
    const { prisma, executor } = buildMocks();

    await executor.execute('u1', 'buscar_productos', { warranty_status: 'vigente' });

    const fv = prisma.product.findMany.mock.calls[0][0].where.fecha_vencimiento_garantia;
    const in30 = new Date(Date.now() + 30 * DAY_MS);
    expect(Math.abs(fv.gt.getTime() - in30.getTime())).toBeLessThanOrEqual(5_000);
  });

  // -------------------------------------------------------------------------
  // buscar_productos — validación de argumentos
  // -------------------------------------------------------------------------
  it('buscar_productos con limit inválido devuelve error sin consultar', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'buscar_productos', { limit: 0 });
    expect((res as { error: string }).error).toContain('Argumentos inválidos');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('buscar_productos con fecha inválida devuelve error', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'buscar_productos', { fecha_desde: 'ayer' });
    expect((res as { error: string }).error).toContain('fecha_desde');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('buscar_productos con estado inválido devuelve error', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'buscar_productos', { estado: 'ROTO' });
    expect((res as { error: string }).error).toContain('estado');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('buscar_productos con search y fechas válidas construye el where', async () => {
    const { prisma, executor } = buildMocks();

    await executor.execute('u1', 'buscar_productos', {
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
    await executor.execute('u1', 'buscar_productos', {});
    expect(prisma.product.findMany.mock.calls[0][0].take).toBe(20);
  });

  it('args nulos se tratan como objeto vacío', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'buscar_productos', null as never);
    expect(res).toEqual([]);
    expect(prisma.product.findMany).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // crear_producto
  // -------------------------------------------------------------------------
  it('crear_producto con args válidos crea el producto con Decimal', async () => {
    const { prisma, executor } = buildMocks();

    const res = await executor.execute('u1', 'crear_producto', {
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

    await executor.execute('u1', 'crear_producto', {
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
    const res = await executor.execute('u1', 'crear_producto', args as never);
    expect((res as { error: string }).error).toContain('Argumentos inválidos');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('crear_producto acepta duracion_garantia_meses=0 (sin garantía)', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'crear_producto', {
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
    const res = await executor.execute('u1', 'crear_producto', {
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
  // crear_producto — deduplicación consultiva (nunca automática)
  // -------------------------------------------------------------------------
  it('crear_producto pide confirmación si ya existe el mismo nombre+fecha (no crea)', async () => {
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

    const res = (await executor.execute('u1', 'crear_producto', {
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 129.99,
    })) as { needs_confirmation?: boolean; similar?: unknown[] };

    expect(res.needs_confirmation).toBe(true);
    expect(res.similar).toHaveLength(1);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('confirmar:true tras una confirmación pendiente crea con los argumentos ORIGINALES', async () => {
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

    // Turno 1: duplicado → needs_confirmation (guarda el pendiente con los args).
    const first = await executor.execute('u1', 'crear_producto', {
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 150,
    });
    expect((first as { needs_confirmation: boolean }).needs_confirmation).toBe(true);
    expect(prisma.product.create).not.toHaveBeenCalled();

    // Turno 2: la IA confirma con OTROS args (los que repita no importan):
    // se crea con los ORIGINALES guardados en el turno 1.
    const res = await executor.execute('u1', 'crear_producto', {
      confirmar: true,
      nombre: 'Otro nombre cualquiera',
      fecha_compra: '2026-01-01',
      tipo_compra: 'ONLINE',
      precio: 999,
    });

    expect((res as { ok: boolean }).ok).toBe(true);
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data.nombre).toBe('Licuadora Oster');
    expect(data.fecha_compra).toEqual(new Date('2026-08-15T00:00:00Z'));
    expect(data.precio.toString()).toBe('150');
  });

  it('confirmar:true SIN confirmación pendiente se rechaza (no crea ni consulta)', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'crear_producto', {
      confirmar: true,
      nombre: 'X',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 10,
    });

    expect((res as { error: string }).error).toContain('No hay una confirmación pendiente');
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('confirmar:false cancela y limpia el pendiente; un confirmar:true posterior se rechaza', async () => {
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

    // Turno 1: pendiente creado.
    await executor.execute('u1', 'crear_producto', {
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 150,
    });

    // Turno 2: el usuario rechaza → no crea y limpia.
    const cancel = await executor.execute('u1', 'crear_producto', {
      confirmar: false,
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 150,
    });
    expect((cancel as { cancelada: boolean }).cancelada).toBe(true);
    expect(prisma.product.create).not.toHaveBeenCalled();

    // Turno 3: sin pendiente, confirmar:true se rechaza.
    const later = await executor.execute('u1', 'crear_producto', {
      confirmar: true,
      nombre: 'Licuadora Oster',
      fecha_compra: '2026-08-15',
      tipo_compra: 'FISICO',
      precio: 150,
    });
    expect((later as { error: string }).error).toContain('No hay una confirmación pendiente');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('la confirmación pendiente expira (TTL 10 min): confirmar:true posterior se rechaza', async () => {
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

      await executor.execute('u1', 'crear_producto', {
        nombre: 'Licuadora Oster',
        fecha_compra: '2026-08-15',
        tipo_compra: 'FISICO',
        precio: 150,
      });

      jest.advanceTimersByTime(11 * 60 * 1000); // +11 min: el pendiente expiró

      const res = await executor.execute('u1', 'crear_producto', {
        confirmar: true,
        nombre: 'Licuadora Oster',
        fecha_compra: '2026-08-15',
        tipo_compra: 'FISICO',
        precio: 150,
      });
      expect((res as { error: string }).error).toContain('No hay una confirmación pendiente');
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

    const res = await executor.execute('u1', 'crear_producto', {
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

    await executor.execute('u1', 'crear_producto', {
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

    await executor.execute('u1', 'crear_producto', {
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

    await executor.execute('u1', 'crear_producto', {
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

    const res = (await executor.execute('u1', 'buscar_productos', {})) as { error: string };

    expect(res.error).toBe('Error interno al consultar los datos. Inténtalo de nuevo.');
    expect(res.error).not.toContain('SELECT');
    expect(res.error).not.toContain('prisma');
  });

  it('un error inesperado NO Prisma también se devuelve genérico', async () => {
    const { prisma, executor } = buildMocks();
    prisma.product.findMany.mockRejectedValueOnce(new Error('se rompió algo interno'));

    const res = (await executor.execute('u1', 'buscar_productos', {})) as { error: string };

    expect(res.error).toBe('Ocurrió un error al ejecutar la herramienta. Inténtalo de nuevo.');
  });

  // -------------------------------------------------------------------------
  // consultar_garantias_por_vencer
  // -------------------------------------------------------------------------
  it('garantías con dias inválido (0) devuelve error sin consultar', async () => {
    const { prisma, executor } = buildMocks();
    const res = await executor.execute('u1', 'consultar_garantias_por_vencer', { dias: 0 });
    expect((res as { error: string }).error).toContain('dias');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('garantías con dias 30 consulta con ventana de fechas', async () => {
    const { prisma, executor } = buildMocks();
    await executor.execute('u1', 'consultar_garantias_por_vencer', { dias: 30 });
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
    const res = await executor.execute('u1', 'resumen_gastos', { periodo: 'el_anio' });
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

    const res = (await executor.execute('u1', 'resumen_gastos', {
      periodo: 'anio_actual',
    })) as { total: string; cantidad_productos: number; por_categoria: Record<string, number> };

    expect(res.total).toBe('35.00');
    expect(res.cantidad_productos).toBe(3);
    expect(res.por_categoria).toEqual({ Electro: 30, 'Sin categoría': 5 });
  });

  it('resumen_gastos filtra por categoria_id', async () => {
    const { prisma, executor } = buildMocks();
    await executor.execute('u1', 'resumen_gastos', { categoria_id: 'cat1' });
    const where = prisma.product.findMany.mock.calls[0][0].where;
    expect(where.categoria_id).toBe('cat1');
  });
});
