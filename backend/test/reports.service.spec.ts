// =============================================================================
// Tests de ReportsService (agregados de gasto)
// =============================================================================
// Cubre la agregación por categoría/mes/moneda, el filtro de año, la exclusión
// de productos borrados y la lista de años disponibles del usuario.
// =============================================================================

import { ReportsService } from '../src/reports/reports.service';
import { MockPrisma, buildPrismaMock } from './helpers/prisma-mock';

function product(
  id: string,
  categoriaId: string | null,
  precio: string,
  moneda: string,
  fechaCompra: Date,
) {
  return { id, categoria_id: categoriaId, precio, moneda, fecha_compra: fechaCompra };
}

const CATEGORIES = [
  { id: 'c1', nombre: 'Electrónica' },
  { id: 'c2', nombre: 'Ropa' },
];

describe('ReportsService', () => {
  let prisma: MockPrisma;
  let service: ReportsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new ReportsService(prisma as never);
    prisma.category.findMany.mockResolvedValue(CATEGORIES as never);
  });

  // ===========================================================================
  // AGREGACIÓN POR CATEGORÍA
  // ===========================================================================
  describe('spendingReport - por categoría', () => {
    it('agrupa por categoría con nombre y ordena por total desc', async () => {
      const now = new Date('2026-08-10T12:00:00Z');
      prisma.product.findMany
        .mockResolvedValueOnce([
          product('p1', 'c1', '500.00', 'EUR', now),
          product('p2', 'c2', '80.00', 'EUR', now),
          product('p3', 'c1', '150.00', 'EUR', now),
        ] as never)
        .mockResolvedValueOnce([]);

      const report = await service.spendingReport('u1', 2026);

      expect(report.total).toBe(730);
      expect(report.cantidad).toBe(3);
      expect(report.by_category).toEqual([
        { categoria_id: 'c1', nombre: 'Electrónica', total: 650, cantidad: 2 },
        { categoria_id: 'c2', nombre: 'Ropa', total: 80, cantidad: 1 },
      ]);
    });

    it('usa "Sin categoría" para productos sin categoría', async () => {
      const now = new Date('2026-08-10T12:00:00Z');
      prisma.product.findMany
        .mockResolvedValueOnce([product('p1', null, '30.00', 'USD', now)] as never)
        .mockResolvedValueOnce([]);

      const report = await service.spendingReport('u1', 2026);

      expect(report.by_category).toEqual([
        { categoria_id: null, nombre: 'Sin categoría', total: 30, cantidad: 1 },
      ]);
    });

    it('usa "Otra" si la categoría ya no existe', async () => {
      const now = new Date('2026-08-10T12:00:00Z');
      prisma.product.findMany
        .mockResolvedValueOnce([product('p1', 'c-perdida', '10.00', 'USD', now)] as never)
        .mockResolvedValueOnce([]);

      const report = await service.spendingReport('u1', 2026);

      expect(report.by_category[0].nombre).toBe('Otra');
    });
  });

  // ===========================================================================
  // AGREGACIÓN POR MES / MONEDA
  // ===========================================================================
  describe('spendingReport - por mes y moneda', () => {
    it('devuelve los 12 meses con sus etiquetas y suma en el mes correcto', async () => {
      const jan = new Date('2026-01-15T00:00:00Z');
      const mar = new Date('2026-03-10T00:00:00Z');
      prisma.product.findMany
        .mockResolvedValueOnce([
          product('p1', 'c1', '100.00', 'EUR', jan),
          product('p2', 'c1', '50.00', 'EUR', mar),
        ] as never)
        .mockResolvedValueOnce([]);

      const report = await service.spendingReport('u1', 2026);

      expect(report.by_month).toHaveLength(12);
      expect(report.by_month[0]).toEqual({ mes: 1, label: 'ene', total: 100, cantidad: 1 });
      expect(report.by_month[2]).toEqual({ mes: 3, label: 'mar', total: 50, cantidad: 1 });
      expect(report.by_month[5]).toEqual({ mes: 6, label: 'jun', total: 0, cantidad: 0 });
    });

    it('desglosa por moneda y usa la dominante como currency del reporte', async () => {
      const now = new Date('2026-08-10T12:00:00Z');
      prisma.product.findMany
        .mockResolvedValueOnce([
          product('p1', 'c1', '100.00', 'EUR', now),
          product('p2', 'c1', '50.00', 'EUR', now),
          product('p3', 'c1', '200.00', 'USD', now),
        ] as never)
        .mockResolvedValueOnce([]);

      const report = await service.spendingReport('u1', 2026);

      // USD acumula más gasto (200 > 150) -> moneda dominante del reporte.
      expect(report.currency).toBe('USD');
      expect(report.by_currency).toEqual([
        { moneda: 'USD', total: 200, cantidad: 1 },
        { moneda: 'EUR', total: 150, cantidad: 2 },
      ]);
    });
  });

  // ===========================================================================
  // FILTRO DE AÑO / BORRADOS / AÑOS DISPONIBLES
  // ===========================================================================
  describe('spendingReport - filtros', () => {
    it('filtra por usuario y año con rango UTC', async () => {
      prisma.product.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await service.spendingReport('u1', 2026);

      expect(prisma.product.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: {
            user_id: 'u1',
            deleted_at: null,
            fecha_compra: {
              gte: new Date('2026-01-01T00:00:00.000Z'),
              lt: new Date('2027-01-01T00:00:00.000Z'),
            },
          },
        }),
      );
    });

    it('sin año no filtra por fecha (todos los años)', async () => {
      prisma.product.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const report = await service.spendingReport('u1');

      expect(report.year).toBeNull();
      expect(prisma.product.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { user_id: 'u1', deleted_at: null },
        }),
      );
    });

    it('devuelve los años disponibles ordenados desc', async () => {
      prisma.product.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { fecha_compra: new Date('2023-05-01T00:00:00Z') },
          { fecha_compra: new Date('2026-05-01T00:00:00Z') },
          { fecha_compra: new Date('2024-05-01T00:00:00Z') },
        ] as never);

      const report = await service.spendingReport('u1', 2026);

      expect(report.years).toEqual([2026, 2024, 2023]);
    });
  });
});
