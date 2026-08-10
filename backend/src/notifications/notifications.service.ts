// =============================================================================
// NotificationsService - notificaciones de garantía
// =============================================================================
// Dos responsabilidades:
//
// 1) CRUD para el usuario autenticado:
//    - list / unreadCount / markRead / markAllRead (siempre filtrado por user).
//
// 2) JOB de garantías (checkWarranties): recorre los productos con fecha de
//    vencimiento de garantía y crea una Notification por producto:
//    - GARANTIA_POR_VENCER cuando vence en los próximos 30 días.
//    - GARANTIA_VENCIDA cuando ya venció.
//    Con DEDUPE: no se repite el mismo aviso (user + producto + tipo) aunque
//    el job corra muchas veces. Cuando un producto pasa de "por vencer" a
//    "vencida" se crea un aviso nuevo (tipo distinto).
//
// El job corre al arrancar (recupera avisos atrasados) y luego cada 6 horas.
// El timer usa unref() para no mantener vivo el proceso (tests, CLIs).
// =============================================================================

import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { NotificationType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { getWarrantyStatus } from '../common/lib/time-ownership';

const WARRANTY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // cada 6 horas

export interface NotificationResponse {
  id: string;
  tipo: NotificationType;
  mensaje: string;
  product_id: string | null;
  leido: boolean;
  created_at: Date;
  read_at: Date | null;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // Al arrancar: recupera avisos atrasados (p. ej. tras un deploy).
    void this.checkWarranties().catch((err) =>
      this.logger.error(`Chequeo inicial de garantías falló: ${(err as Error).message}`),
    );
    const timer = setInterval(() => {
      void this.checkWarranties().catch((err) =>
        this.logger.error(`Chequeo periódico de garantías falló: ${(err as Error).message}`),
      );
    }, WARRANTY_CHECK_INTERVAL_MS);
    timer.unref();
  }

  // ===========================================================================
  // CRUD POR USUARIO
  // ===========================================================================
  async list(
    userId: string,
    opts: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<NotificationResponse[]> {
    return this.prisma.notification.findMany({
      where: {
        user_id: userId,
        ...(opts.unreadOnly ? { leido: false } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: opts.limit ?? 50,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { user_id: userId, leido: false },
    });
  }

  async markRead(userId: string, id: string): Promise<NotificationResponse> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, user_id: userId },
    });
    if (!notification) {
      throw new NotFoundException('Notificación no encontrada.');
    }
    if (notification.leido) return notification;
    return this.prisma.notification.update({
      where: { id },
      data: { leido: true, read_at: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { user_id: userId, leido: false },
      data: { leido: true, read_at: new Date() },
    });
    return { updated: result.count };
  }

  // ===========================================================================
  // JOB: GARANTÍAS
  // ===========================================================================
  /**
   * Escanea productos con garantía y crea notificaciones faltantes.
   * Devuelve cuántas creó y cuántos productos revisó (para tests/logs).
   */
  async checkWarranties(now: Date = new Date()): Promise<{ created: number; checked: number }> {
    const products = await this.prisma.product.findMany({
      where: {
        deleted_at: null,
        fecha_vencimiento_garantia: { not: null },
      },
      select: {
        id: true,
        user_id: true,
        nombre: true,
        fecha_vencimiento_garantia: true,
      },
    });

    let created = 0;
    for (const product of products) {
      const status = getWarrantyStatus(product.fecha_vencimiento_garantia, now);
      if (status !== 'por_vencer' && status !== 'vencida') continue;

      const tipo =
        status === 'por_vencer'
          ? NotificationType.GARANTIA_POR_VENCER
          : NotificationType.GARANTIA_VENCIDA;

      // Dedupe: un solo aviso por producto y tipo.
      const existing = await this.prisma.notification.findFirst({
        where: { user_id: product.user_id, product_id: product.id, tipo },
        select: { id: true },
      });
      if (existing) continue;

      await this.prisma.notification.create({
        data: {
          user_id: product.user_id,
          tipo,
          mensaje: this.buildMessage(product.nombre, product.fecha_vencimiento_garantia!, now, status),
          product_id: product.id,
        },
      });
      created += 1;
    }

    if (created > 0) {
      this.logger.log(`Notificaciones de garantía creadas: ${created} (revisados ${products.length})`);
    }
    return { created, checked: products.length };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================
  private buildMessage(
    productName: string,
    expiresAt: Date,
    now: Date,
    status: 'por_vencer' | 'vencida',
  ): string {
    // Días restantes (positivo) o transcurridos (negativo) desde el vencimiento.
    const diffMs = expiresAt.getTime() - now.getTime();
    const days = diffMs >= 0 ? Math.ceil(diffMs / 86_400_000) : Math.floor(diffMs / 86_400_000);

    if (status === 'por_vencer') {
      if (days <= 0) return `La garantía de «${productName}» vence hoy.`;
      return `La garantía de «${productName}» vence en ${days} día${days === 1 ? '' : 's'}.`;
    }
    if (days >= 0) return `La garantía de «${productName}» venció hoy.`;
    const elapsed = Math.abs(days);
    return `La garantía de «${productName}» venció hace ${elapsed} día${elapsed === 1 ? '' : 's'}.`;
  }
}
