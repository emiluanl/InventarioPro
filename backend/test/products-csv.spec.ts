// =============================================================================
// Tests de import/export CSV de productos
// =============================================================================
// Cubre: export (cabeceras, fechas UTC, escapado, filtros, warranty en where
// SQL) e import (fila válida, categorías por nombre con cache, errores por
// fila, auto-cálculo de garantía, CSV vacío, defaults).
// =============================================================================

import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';

import { ProductsService } from '../src/products/products.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { parseProductsCsv } from '../src/products/csv';
import { MockPrisma, buildPrismaMock } from './helpers/prisma-mock';

describe('ProductsService CSV', () => {
  let service: ProductsService;
  let prisma: MockPrisma;
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock; delPattern: jest.Mock };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      delPattern: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  // ===========================================================================
  // EXPORT
  // ===========================================================================
  describe('exportCsv', () => {
    const baseQuery = {
      page: 1,
      per_page: 20,
      sort_by: 'fecha_compra' as const,
      sort_order: 'desc' as const,
    };

    it('genera el CSV con cabecera, fechas en YYYY-MM-DD y precio como texto', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p1',
          nombre: 'Laptop',
          categoria: { nombre: 'Electrónica' },
          marca: 'Lenovo',
          modelo: null,
          descripcion: 'n/d',
          fecha_compra: new Date('2026-03-14T00:00:00Z'),
          lugar_compra: null,
          tipo_compra: 'ONLINE',
          precio: { toString: () => '1250.5' },
          moneda: 'EUR',
          metodo_pago: null,
          numero_serie: 'SN-1',
          duracion_garantia_meses: 24,
          fecha_vencimiento_garantia: new Date('2028-03-14T00:00:00Z'),
          estado: 'NUEVO',
          notas: null,
          tags: 'oficina',
        },
      ]);

      const result = await service.exportCsv('u1', baseQuery as never);

      expect(result.filename).toMatch(/^inventariopro-productos-\d{4}-\d{2}-\d{2}\.csv$/);
      const lines = result.content.trim().split('\n');
      expect(lines[0]).toBe(
        'nombre,categoria,marca,modelo,descripcion,fecha_compra,lugar_compra,tipo_compra,precio,moneda,metodo_pago,numero_serie,duracion_garantia_meses,fecha_vencimiento_garantia,estado,notas,tags',
      );
      expect(lines[1]).toContain(
        'Laptop,Electrónica,Lenovo,,n/d,2026-03-14,,ONLINE,1250.5,EUR,,SN-1,24,2028-03-14,NUEVO,,oficina',
      );
    });

    it('escapa comas y comillas en los campos de texto', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p1',
          nombre: 'Auriculares "Pro", edición',
          categoria: null,
          marca: null,
          modelo: null,
          descripcion: null,
          fecha_compra: new Date('2026-01-01T00:00:00Z'),
          lugar_compra: 'Tienda, Calle 1',
          tipo_compra: 'FISICO',
          precio: { toString: () => '99.99' },
          moneda: 'USD',
          metodo_pago: null,
          numero_serie: null,
          duracion_garantia_meses: null,
          fecha_vencimiento_garantia: null,
          estado: 'USADO',
          notas: null,
          tags: null,
        },
      ]);

      const result = await service.exportCsv('u1', baseQuery as never);
      // La fila debe ir entre comillas por la coma y las comillas internas.
      expect(result.content).toContain('"Auriculares ""Pro"", edición"');
      expect(result.content).toContain('"Tienda, Calle 1"');
    });

    it('aplica los filtros del listado (where con user_id y búsqueda)', async () => {
      prisma.product.findMany.mockResolvedValue([]);

      await service.exportCsv('u1', {
        ...baseQuery,
        search: 'licuadora',
      } as never);

      const call = prisma.product.findMany.mock.calls[0][0];
      expect(call.where).toEqual(
        expect.objectContaining({
          user_id: 'u1',
          deleted_at: null,
          OR: expect.any(Array),
        }),
      );
    });

    it('filtra por warranty_status en el where SQL (sin post-filtro)', async () => {
      const today = new Date();
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p1',
          nombre: 'Vence pronto',
          categoria: null,
          marca: null,
          modelo: null,
          descripcion: null,
          fecha_compra: new Date('2026-01-01T00:00:00Z'),
          lugar_compra: null,
          tipo_compra: 'FISICO',
          precio: { toString: () => '10' },
          moneda: 'USD',
          metodo_pago: null,
          numero_serie: null,
          duracion_garantia_meses: null,
          fecha_vencimiento_garantia: new Date(today.getTime() + 5 * 86_400_000),
          estado: 'NUEVO',
          notas: null,
          tags: null,
        },
        {
          id: 'p2',
          nombre: 'Sin garantía',
          categoria: null,
          marca: null,
          modelo: null,
          descripcion: null,
          fecha_compra: new Date('2026-01-01T00:00:00Z'),
          lugar_compra: null,
          tipo_compra: 'FISICO',
          precio: { toString: () => '10' },
          moneda: 'USD',
          metodo_pago: null,
          numero_serie: null,
          duracion_garantia_meses: null,
          fecha_vencimiento_garantia: null,
          estado: 'NUEVO',
          notas: null,
          tags: null,
        },
      ]);

      const result = await service.exportCsv('u1', {
        ...baseQuery,
        warranty_status: 'por_vencer',
      } as never);

      // El filtro va en el where SQL (mismo criterio que getWarrantyStatus):
      // por_vencer = vence en los próximos 30 días.
      const call = prisma.product.findMany.mock.calls[0][0];
      expect(call.where.fecha_vencimiento_garantia).toEqual({
        gt: expect.any(Date),
        lte: expect.any(Date),
      });
      // Sin post-filtro: lo que devuelve SQL pasa tal cual (el mock no aplica
      // el where). Si alguien reintroduce un filtro en JS, este test falla.
      const rows = parseProductsCsv(result.content);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.nombre)).toEqual(['Vence pronto', 'Sin garantía']);
    });
  });

  // ===========================================================================
  // IMPORT
  // ===========================================================================
  describe('importCsv', () => {
    const csv = [
      'nombre,categoria,marca,fecha_compra,tipo_compra,precio,moneda,duracion_garantia_meses,estado',
      'Licuadora Oster,Electrodomésticos,Oster,2026-08-01,ONLINE,89.99,EUR,24,NUEVO',
      'Cafetera,Electrodomésticos,,2026-07-15,FISICO,150,USD,,USADO',
    ].join('\n');

    beforeEach(() => {
      // createMany devuelve el conteo de filas insertadas.
      prisma.product.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({
        count: data.length,
      }));
    });

    it('importa las filas válidas y normaliza los campos', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'cat-1', nombre: 'Electrodomésticos' },
      ] as never);

      const result = await service.importCsv('u1', csv);

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
      expect(prisma.product.createMany).toHaveBeenCalledTimes(1);

      const first = prisma.product.createMany.mock.calls[0][0].data[0];
      expect(first).toEqual(
        expect.objectContaining({
          user_id: 'u1',
          nombre: 'Licuadora Oster',
          categoria_id: 'cat-1',
          fecha_compra: new Date('2026-08-01T00:00:00Z'),
          tipo_compra: 'ONLINE',
          precio: expect.any(Object), // Prisma.Decimal
          moneda: 'EUR',
          duracion_garantia_meses: 24,
          estado: 'NUEVO',
        }),
      );
      // La garantía se auto-calcula: 24 meses desde 2026-08-01.
      const vencimiento = first.fecha_vencimiento_garantia as Date;
      expect(vencimiento.getUTCFullYear()).toBe(2028);
      expect(vencimiento.getUTCMonth()).toBe(7); // agosto
    });

    it('crea la categoría personalizada si no existe y la cachea por import', async () => {
      prisma.category.findMany.mockResolvedValue([]);
      prisma.category.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'cat-new',
          nombre: data.nombre,
        }),
      );

      const result = await service.importCsv('u1', csv);

      expect(result.created_categories).toEqual(['Electrodomésticos']);
      expect(prisma.category.create).toHaveBeenCalledTimes(1);
      expect(prisma.category.create).toHaveBeenCalledWith({
        data: { nombre: 'Electrodomésticos', user_id: 'u1' },
      });
      // Ambas filas usan la misma categoría creada.
      const data = prisma.product.createMany.mock.calls[0][0].data;
      expect(data[0].categoria_id).toBe('cat-new');
      expect(data[1].categoria_id).toBe('cat-new');
    });

    it('reporta errores por fila sin abortar las filas válidas', async () => {
      const mixed = [
        'nombre,fecha_compra,tipo_compra,precio,estado',
        'Válido,2026-01-01,FISICO,10,NUEVO',
        ',2026-01-01,FISICO,10,NUEVO', // falta nombre
        'Fecha mala,no-es-fecha,FISICO,10,NUEVO',
        'Tipo malo,2026-01-01,SUBMARINO,10,NUEVO',
        'Precio malo,2026-01-01,FISICO,abc,NUEVO',
        'Válido 2,2026-02-01,ONLINE,20,USADO',
      ].join('\n');
      prisma.category.findMany.mockResolvedValue([]);
      prisma.category.create.mockResolvedValue({ id: 'c', nombre: 'x' });

      const result = await service.importCsv('u1', mixed);

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(4);
      expect(result.errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
      expect(result.errors.map((e) => e.message)).toEqual([
        'Falta el nombre.',
        'fecha_compra debe tener formato YYYY-MM-DD.',
        'tipo_compra debe ser FISICO u ONLINE.',
        'precio debe ser un número mayor o igual que 0.',
      ]);
    });

    it('aplica defaults: moneda USD y estado NUEVO', async () => {
      const minimal = ['nombre,fecha_compra,tipo_compra,precio', 'Silla,2026-01-01,FISICO,10'].join(
        '\n',
      );
      prisma.category.findMany.mockResolvedValue([]);

      const result = await service.importCsv('u1', minimal);

      expect(result.imported).toBe(1);
      const data = prisma.product.createMany.mock.calls[0][0].data[0];
      expect(data.moneda).toBe('USD');
      expect(data.estado).toBe('NUEVO');
    });

    it('acepta coma decimal en el precio (campo entre comillas)', async () => {
      // Un campo con coma debe ir entre comillas en CSV, si no se parte en dos.
      const row = ['nombre,fecha_compra,tipo_compra,precio', 'X,2026-01-01,FISICO,"19,99"'].join(
        '\n',
      );
      prisma.category.findMany.mockResolvedValue([]);

      const result = await service.importCsv('u1', row);

      expect(result.imported).toBe(1);
      expect(prisma.product.createMany.mock.calls[0][0].data[0].precio.toString()).toBe('19.99');
    });

    it('lanza BadRequestException si el CSV está vacío o solo tiene cabecera', async () => {
      await expect(service.importCsv('u1', '')).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.importCsv('u1', 'nombre,fecha_compra,tipo_compra,precio\n'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.product.createMany).not.toHaveBeenCalled();
    });
  });
});
