// =============================================================================
// Tests de NotificationsService
// =============================================================================
// Cubre el CRUD por usuario (list, unreadCount, markRead, markAllRead) y el
// job de garantías (checkWarranties): creación de avisos por vencer/vencidas,
// mensajes, dedupe y omisión de productos sin garantía o vigentes.
// =============================================================================

import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '../src/generated/prisma/client';

import { NotificationsService } from '../src/notifications/notifications.service';
import { MockPrisma, buildPrismaMock } from './helpers/prisma-mock';

const DAY = 86_400_000;

const pushMock = () => ({
  sendWarrantyPush: jest.fn().mockResolvedValue({ sent: 1, failed: 0, removed: 0 }),
});

function serviceWith(prisma: MockPrisma, push = pushMock()): NotificationsService {
  return new NotificationsService(prisma as never, push as never);
}

describe('NotificationsService', () => {
  let prisma: MockPrisma;
  let service: NotificationsService;
  let push: ReturnType<typeof pushMock>;

  beforeEach(() => {
    prisma = buildPrismaMock();
    push = pushMock();
    service = serviceWith(prisma, push);
  });

  // ===========================================================================
  // LIST / UNREAD COUNT
  // ===========================================================================
  describe('list', () => {
    it('lista las notificaciones del usuario, más recientes primero', async () => {
      const rows = [{ id: 'n1' }, { id: 'n2' }];
      prisma.notification.findMany.mockResolvedValue(rows as never);

      const result = await service.list('u1');

      expect(result).toBe(rows);
      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { user_id: 'u1' },
        orderBy: { created_at: 'desc' },
        take: 50,
      });
    });

    it('filtra solo no leídas y respeta el límite', async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      await service.list('u1', { unreadOnly: true, limit: 10 });

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { user_id: 'u1', leido: false },
        orderBy: { created_at: 'desc' },
        take: 10,
      });
    });
  });

  describe('unreadCount', () => {
    it('cuenta las no leídas del usuario', async () => {
      prisma.notification.count.mockResolvedValue(3);
      await expect(service.unreadCount('u1')).resolves.toBe(3);
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { user_id: 'u1', leido: false },
      });
    });
  });

  // ===========================================================================
  // MARK READ / MARK ALL READ
  // ===========================================================================
  describe('markRead', () => {
    it('lanza NotFoundException si la notificación no es del usuario', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);
      await expect(service.markRead('u1', 'n1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('no hace nada si ya estaba leída', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1', leido: true } as never);
      const result = await service.markRead('u1', 'n1');
      expect(result).toEqual({ id: 'n1', leido: true });
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('marca como leída con read_at', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1', leido: false } as never);
      prisma.notification.update.mockResolvedValue({ id: 'n1', leido: true } as never);

      await service.markRead('u1', 'n1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { leido: true, read_at: expect.any(Date) },
      });
    });
  });

  describe('markAllRead', () => {
    it('marca todas las no leídas del usuario y devuelve el conteo', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });
      const result = await service.markAllRead('u1');
      expect(result).toEqual({ updated: 5 });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'u1', leido: false },
        data: { leido: true, read_at: expect.any(Date) },
      });
    });
  });

  // ===========================================================================
  // JOB: CHECK WARRANTIES
  // ===========================================================================
  describe('checkWarranties', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const in7Days = new Date(now.getTime() + 7 * DAY);
    const expired3Days = new Date(now.getTime() - 3 * DAY);
    const in90Days = new Date(now.getTime() + 90 * DAY);

    const products = [
      { id: 'p1', user_id: 'u1', nombre: 'Laptop', fecha_vencimiento_garantia: in7Days },
      { id: 'p2', user_id: 'u2', nombre: 'Cafetera', fecha_vencimiento_garantia: expired3Days },
      { id: 'p3', user_id: 'u1', nombre: 'Silla', fecha_vencimiento_garantia: in90Days },
      { id: 'p4', user_id: 'u1', nombre: 'Sin garantía', fecha_vencimiento_garantia: null },
    ];

    beforeEach(() => {
      prisma.product.findMany.mockResolvedValue(products as never);
      // Dedupe: sin avisos existentes por defecto (una sola query de findMany).
      prisma.notification.findMany.mockResolvedValue([]);
      // createMany devuelve el conteo de filas insertadas.
      prisma.notification.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({
        count: data.length,
      }));
    });

    it('crea GARANTIA_POR_VENCER y GARANTIA_VENCIDA, y omite vigentes/sin garantía', async () => {
      const result = await service.checkWarranties(now);

      expect(result).toEqual({ created: 2, checked: 4 });
      expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [
          {
            user_id: 'u1',
            tipo: NotificationType.GARANTIA_POR_VENCER,
            mensaje: 'La garantía de «Laptop» vence en 7 días.',
            product_id: 'p1',
          },
          {
            user_id: 'u2',
            tipo: NotificationType.GARANTIA_VENCIDA,
            mensaje: 'La garantía de «Cafetera» venció hace 3 días.',
            product_id: 'p2',
          },
        ],
      });
    });

    it('usa UNA query de dedupe y UNA de creación (sin N+1)', async () => {
      await service.checkWarranties(now);

      expect(prisma.notification.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    });

    it('envía push por cada aviso nuevo, con el tipo y el producto', async () => {
      await service.checkWarranties(now);

      expect(push.sendWarrantyPush).toHaveBeenCalledTimes(2);
      expect(push.sendWarrantyPush).toHaveBeenCalledWith('u1', {
        tipo: NotificationType.GARANTIA_POR_VENCER,
        mensaje: 'La garantía de «Laptop» vence en 7 días.',
        product_id: 'p1',
      });
      expect(push.sendWarrantyPush).toHaveBeenCalledWith('u2', {
        tipo: NotificationType.GARANTIA_VENCIDA,
        mensaje: 'La garantía de «Cafetera» venció hace 3 días.',
        product_id: 'p2',
      });
    });

    it('no envía push para los avisos deduplicados', async () => {
      prisma.notification.findMany.mockResolvedValue([
        {
          user_id: 'u1',
          product_id: 'p1',
          tipo: NotificationType.GARANTIA_POR_VENCER,
        },
        {
          user_id: 'u2',
          product_id: 'p2',
          tipo: NotificationType.GARANTIA_VENCIDA,
        },
      ] as never);

      await service.checkWarranties(now);

      expect(prisma.notification.createMany).not.toHaveBeenCalled();
      expect(push.sendWarrantyPush).not.toHaveBeenCalled();
    });

    it('usa el singular para 1 día', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p1',
          user_id: 'u1',
          nombre: 'Taza',
          fecha_vencimiento_garantia: new Date(now.getTime() + DAY),
        },
      ] as never);

      await service.checkWarranties(now);

      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            mensaje: 'La garantía de «Taza» vence en 1 día.',
          }),
        ],
      });
    });

    it('dedupe: no crea un aviso si ya existe para el mismo producto y tipo', async () => {
      // findMany devuelve una notificación existente para p1, pero nada para p2.
      prisma.notification.findMany.mockResolvedValue([
        {
          user_id: 'u1',
          product_id: 'p1',
          tipo: NotificationType.GARANTIA_POR_VENCER,
        },
      ] as never);

      const result = await service.checkWarranties(now);

      expect(result.created).toBe(1); // solo p2 (vencida)
      expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ product_id: 'p2' })],
      });
    });

    it('no hace nada si no hay productos con garantía', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      const result = await service.checkWarranties(now);
      expect(result).toEqual({ created: 0, checked: 0 });
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
      expect(push.sendWarrantyPush).not.toHaveBeenCalled();
    });

    it('el job sobrevive si el push falla', async () => {
      push.sendWarrantyPush.mockRejectedValue(new Error('red caída'));

      const result = await service.checkWarranties(now);

      expect(result.created).toBe(2);
      expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    });
  });
});
