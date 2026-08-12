// =============================================================================
// PushService - notificaciones push web (web-push + VAPID)
// =============================================================================
// Responsabilidades:
//   1. Configurar VAPID desde el entorno (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
//      / VAPID_SUBJECT). Sin esas variables el servicio queda DESHABILITADO y
//      las llamadas a sendToUser son no-op (el app no debe romper sin push).
//   2. CRUD de suscripciones por usuario (subscribe / unsubscribe / list).
//   3. Envío a todas las suscripciones de un usuario con limpieza de
//      suscripciones muertas: si el push service devuelve 404/410 (endpoint
//      expirado) la fila se elimina automáticamente.
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '../generated/prisma/client';
import * as webpush from 'web-push';

import { PrismaService } from '../prisma/prisma.service';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: { url?: string };
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT');

    if (publicKey && privateKey && subject) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.enabled = true;
      this.logger.log('Web Push habilitado (VAPID configurado).');
    } else {
      this.logger.warn(
        'Web Push deshabilitado: faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y/o VAPID_SUBJECT.',
      );
    }
  }

  /** Clave pública VAPID para que el navegador pueda suscribirse. */
  getPublicKey(): string | null {
    if (!this.enabled) return null;
    return this.config.get<string>('VAPID_PUBLIC_KEY') ?? null;
  }

  // ===========================================================================
  // SUSCRIPCIONES
  // ===========================================================================
  async subscribe(userId: string, subscription: PushSubscriptionInput, userAgent?: string) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: userAgent,
      },
      update: {
        // El endpoint ya existía: lo reasignamos al usuario actual (p. ej. el
        // mismo navegador con otra cuenta) y refrescamos las claves.
        user_id: userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: userAgent,
      },
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<{ removed: number }> {
    // Solo borra si la suscripción pertenece al usuario (ownership).
    const result = await this.prisma.pushSubscription.deleteMany({
      where: { user_id: userId, endpoint },
    });
    return { removed: result.count };
  }

  // ===========================================================================
  // ENVÍO
  // ===========================================================================
  /**
   * Envía un payload JSON a todas las suscripciones del usuario.
   * Las suscripciones expiradas (404/410) se eliminan; el resto de fallos se
   * cuentan y loguean sin romper el envío a las demás.
   */
  async sendToUser(
    userId: string,
    payload: PushPayload,
  ): Promise<{ sent: number; failed: number; removed: number }> {
    if (!this.enabled) {
      this.logger.debug('Web Push deshabilitado: envío omitido.');
      return { sent: 0, failed: 0, removed: 0 };
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { user_id: userId },
    });
    if (subscriptions.length === 0) return { sent: 0, failed: 0, removed: 0 };

    const body = JSON.stringify(payload);
    let sent = 0;
    let failed = 0;
    let removed = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        sent += 1;
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // El navegador ya no escucha en ese endpoint: suscripción muerta.
          await this.prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
          removed += 1;
          this.logger.log(`Suscripción push eliminada (${statusCode}): ${sub.endpoint}`);
        } else {
          failed += 1;
          this.logger.warn(`Push falló para ${sub.endpoint}: ${(err as Error).message}`);
        }
      }
    }

    return { sent, failed, removed };
  }

  /**
   * Envía el aviso de garantía (por vencer / vencida) a las suscripciones del
   * usuario. El clic en la notificación abre el producto.
   */
  async sendWarrantyPush(
    userId: string,
    notification: { tipo: NotificationType; mensaje: string; product_id: string | null },
  ): Promise<{ sent: number; failed: number; removed: number }> {
    const title =
      notification.tipo === NotificationType.GARANTIA_VENCIDA
        ? 'Garantía vencida'
        : 'Garantía por vencer';

    return this.sendToUser(userId, {
      title,
      body: notification.mensaje,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      data: {
        url: notification.product_id ? `/products/${notification.product_id}` : '/dashboard',
      },
    });
  }
}
