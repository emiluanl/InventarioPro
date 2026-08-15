// =============================================================================
// Tests de ProductsService (ownership + tiempo_posesion)
// =============================================================================

import { Test, type TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';

import { ProductsService } from '../src/products/products.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { SortBy, SortOrder, WarrantyStatusFilter } from '../src/products/dto/products-query.dto';
import { PurchaseType } from '../src/generated/prisma/client';
import { MockPrisma, buildPrismaMock } from './helpers/prisma-mock';

describe('ProductsService', () => {
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
  // OWNERSHIP
  // ===========================================================================
  describe('findOne (ownership)', () => {
    it('lanza NotFoundException si el producto no pertenece al usuario', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.findOne('u1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza NotFoundException si el producto está borrado lógicamente', async () => {
      // El service filtra por deleted_at: null, así que findFirst devuelve null.
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.findOne('u1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('devuelve el producto con campos calculados si todo OK', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1',
        user_id: 'u1',
        nombre: 'Test',
        fecha_compra: new Date('2020-01-15'),
        fecha_vencimiento_garantia: new Date('2099-01-01'),
        precio: { toString: () => '100.00' },
        moneda: 'USD',
        estado: 'NUEVO',
        categoria: null,
        attachments: [],
        _count: { attachments: 0 },
      });

      const result = await service.findOne('u1', 'p1');
      expect(result.id).toBe('p1');
      expect(result.tiempo_posesion).toMatch(/año/);
      expect(result.warranty_status).toBe('vigente');
    });
  });

  // ===========================================================================
  // UPDATE con ownership
  // ===========================================================================
  describe('update (ownership)', () => {
    it('rechaza si el producto no existe o pertenece a otro usuario', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.update('u1', 'p1', { nombre: 'Nuevo' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('actualiza si el producto pertenece al usuario', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', user_id: 'u1' });
      prisma.product.update.mockResolvedValue({
        id: 'p1',
        user_id: 'u1',
        nombre: 'Nuevo',
        fecha_compra: new Date('2020-01-15'),
        precio: { toString: () => '100.00' },
        moneda: 'USD',
        estado: 'NUEVO',
        categoria: null,
        _count: { attachments: 0 },
      });

      const result = await service.update('u1', 'p1', { nombre: 'Nuevo' });
      expect(result.nombre).toBe('Nuevo');
    });
  });

  // ===========================================================================
  // CREATE con categoría inválida
  // ===========================================================================
  describe('create (categoría)', () => {
    it('rechaza categorías que no son del usuario ni del sistema', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      prisma.product.create.mockResolvedValue({});

      await expect(
        service.create('u1', {
          nombre: 'X',
          fecha_compra: '2024-01-01',
          tipo_compra: PurchaseType.FISICO,
          precio: 100,
          categoria_id: 'cat-invalid',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ===========================================================================
  // DELETE lógico
  // ===========================================================================
  describe('remove', () => {
    it('marca deleted_at sin borrar la fila', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', user_id: 'u1' });
      prisma.product.update.mockResolvedValue({});

      const result = await service.remove('u1', 'p1');
      expect(result.message).toContain('eliminado');
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { deleted_at: expect.any(Date) },
      });
    });

    it('rechaza si el producto no pertenece al usuario', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.remove('u1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // LIST con paginación
  // ===========================================================================
  describe('list', () => {
    it('devuelve paginación correcta', async () => {
      prisma.product.count.mockResolvedValue(42);
      prisma.product.findMany.mockResolvedValue([]);

      const result = await service.list('u1', {
        page: 2,
        per_page: 10,
        sort_by: SortBy.FECHA_COMPRA,
        sort_order: SortOrder.DESC,
      });

      expect(result.pagination).toEqual({
        page: 2,
        per_page: 10,
        total: 42,
        total_pages: 5,
      });
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user_id: 'u1', deleted_at: null }),
          skip: 10,
          take: 10,
        }),
      );
    });

    it('aplica filtro de búsqueda con OR case-insensitive', async () => {
      prisma.product.count.mockResolvedValue(0);
      prisma.product.findMany.mockResolvedValue([]);

      await service.list('u1', {
        page: 1,
        per_page: 20,
        search: 'licuadora',
        sort_by: SortBy.FECHA_COMPRA,
        sort_order: SortOrder.DESC,
      });

      const call = prisma.product.findMany.mock.calls[0][0];
      expect(call.where.OR).toBeDefined();
      expect(call.where.OR[0].nombre).toEqual({
        contains: 'licuadora',
        mode: 'insensitive',
      });
    });

    // =========================================================================
    // WARRANTY_STATUS EN EL WHERE SQL (paginación correcta)
    // =========================================================================
    // El filtro debe ir en `where` (no post-query): así `count` y `findMany`
    // comparten el mismo filtro y total/total_pages son consistentes con los
    // items devueltos (regresión del bug de paginación).
    // =========================================================================
    it.each([
      [WarrantyStatusFilter.VENCIDA, { lt: expect.any(Date) }],
      [WarrantyStatusFilter.POR_VENCER, { gt: expect.any(Date), lte: expect.any(Date) }],
      [WarrantyStatusFilter.VIGENTE, { gt: expect.any(Date) }],
    ])('aplica warranty_status=%s en el where SQL', async (status, expectedFilter) => {
      prisma.product.count.mockResolvedValue(3);
      prisma.product.findMany.mockResolvedValue([]);

      const result = await service.list('u1', {
        page: 1,
        per_page: 10,
        warranty_status: status as WarrantyStatusFilter,
        sort_by: SortBy.FECHA_COMPRA,
        sort_order: SortOrder.DESC,
      });

      // count y findMany usan el MISMO filtro → total consistente con items.
      expect(prisma.product.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fecha_vencimiento_garantia: expectedFilter,
          }),
        }),
      );
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fecha_vencimiento_garantia: expectedFilter,
          }),
        }),
      );
      expect(result.pagination.total).toBe(3);
    });

    it('no filtra post-query (los items son exactamente los que devuelve SQL)', async () => {
      // Producto con garantía vencida y otro vigente: si hubiera post-filtro,
      // el item con warranty_status distinto se descartaría y el total
      // (contado SIN el filtro) no coincidiría con items.length.
      prisma.product.count.mockResolvedValue(2);
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p1',
          user_id: 'u1',
          nombre: 'Vencida',
          fecha_compra: new Date('2020-01-15'),
          fecha_vencimiento_garantia: new Date('2020-02-01'),
          precio: { toString: () => '10.00' },
          moneda: 'USD',
          estado: 'NUEVO',
          categoria: null,
          _count: { attachments: 0 },
        },
        {
          id: 'p2',
          user_id: 'u1',
          nombre: 'Vigente',
          fecha_compra: new Date('2020-01-15'),
          fecha_vencimiento_garantia: new Date('2099-01-01'),
          precio: { toString: () => '20.00' },
          moneda: 'USD',
          estado: 'NUEVO',
          categoria: null,
          _count: { attachments: 0 },
        },
      ]);

      const result = await service.list('u1', {
        page: 1,
        per_page: 10,
        warranty_status: WarrantyStatusFilter.VENCIDA,
        sort_by: SortBy.FECHA_COMPRA,
        sort_order: SortOrder.DESC,
      });

      // Sin post-filtro: SQL devolvió 2 items (vencida + vigente) y el total
      // se contó con el mismo where; el post-procesado solo enriquece.
      expect(result.items).toHaveLength(2);
      expect(result.items.map((p) => p.warranty_status)).toEqual(['vencida', 'vigente']);
      expect(result.pagination.total).toBe(2);
    });
  });
});
