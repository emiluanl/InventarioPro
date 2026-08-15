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
import { NotificationType } from '../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

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

    // Candidatos que necesitarían un aviso (producto + tipo).
    const candidates: Array<{
      user_id: string;
      product_id: string;
      nombre: string;
      expiresAt: Date;
      status: 'por_vencer' | 'vencida';
      tipo: NotificationType;
    }> = [];
    for (const product of products) {
      const status = getWarrantyStatus(product.fecha_vencimiento_garantia, now);
      if (status !== 'por_vencer' && status !== 'vencida') continue;
      candidates.push({
        user_id: product.user_id,
        product_id: product.id,
        nombre: product.nombre,
        expiresAt: product.fecha_vencimiento_garantia!,
        status,
        tipo:
          status === 'por_vencer'
            ? NotificationType.GARANTIA_POR_VENCER
            : NotificationType.GARANTIA_VENCIDA,
      });
    }
    if (candidates.length === 0) return { created: 0, checked: products.length };

    // Dedupe en UNA query (antes: un findFirst por producto → N+1): un solo
    // aviso por (usuario, producto, tipo).
    const existing = await this.prisma.notification.findMany({
      where: {
        OR: candidates.map((c) => ({
          user_id: c.user_id,
          product_id: c.product_id,
          tipo: c.tipo,
        })),
      },
      select: { user_id: true, product_id: true, tipo: true },
    });
    const existingKeys = new Set(existing.map((n) => `${n.user_id}|${n.product_id}|${n.tipo}`));
    const toCreate = candidates.filter(
      (c) => !existingKeys.has(`${c.user_id}|${c.product_id}|${c.tipo}`),
    );

    // Un solo INSERT por corrida (createMany) en vez de un create por aviso.
    let created = 0;
    if (toCreate.length > 0) {
      const result = await this.prisma.notification.createMany({
        data: toCreate.map((c) => ({
          user_id: c.user_id,
          tipo: c.tipo,
          mensaje: this.buildMessage(c.nombre, c.expiresAt, now, c.status),
          product_id: c.product_id,
        })),
      });
      created = result.count;
    }

    // Aviso push fuera de la app (si el usuario tiene suscripciones activas
    // y VAPID configurado). Es una llamada de red por usuario: no se puede
    // batchear. Un fallo del push no debe romper el job.
    for (const c of toCreate) {
      try {
        await this.push.sendWarrantyPush(c.user_id, {
          tipo: c.tipo,
          mensaje: this.buildMessage(c.nombre, c.expiresAt, now, c.status),
          product_id: c.product_id,
        });
      } catch (err) {
        this.logger.warn(`Push de garantía falló para ${c.user_id}: ${(err as Error).message}`);
      }
    }

    if (created > 0) {
      this.logger.log(
        `Notificaciones de garantía creadas: ${created} (revisados ${products.length})`,
      );
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
