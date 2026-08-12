// =============================================================================
// Tests de PushService (web-push + VAPID)
// =============================================================================
// Cubre: configuración VAPID (habilitado/deshabilitado), CRUD de suscripciones
// por usuario, envío a todas las suscripciones, limpieza de endpoints muertos
// (404/410) y el payload del aviso de garantía.
// =============================================================================

import { NotificationType } from '../src/generated/prisma/client';

import { PushService } from '../src/push/push.service';
import { MockPrisma, buildPrismaMock } from './helpers/prisma-mock';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpush = require('web-push') as {
  setVapidDetails: jest.Mock;
  sendNotification: jest.Mock;
};

const VAPID = {
  VAPID_PUBLIC_KEY: 'pub-key',
  VAPID_PRIVATE_KEY: 'priv-key',
  VAPID_SUBJECT: 'mailto:dev@inventariopro.local',
};

function configWith(vars: Record<string, string>) {
  return { get: jest.fn((key: string) => vars[key] ?? undefined) } as never;
}

function serviceWith(prisma: MockPrisma, vars: Record<string, string> = VAPID): PushService {
  const service = new PushService(prisma as never, configWith(vars));
  service.onModuleInit();
  return service;
}

const SUB = {
  endpoint: 'https://push.example.com/abc',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

describe('PushService', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = buildPrismaMock();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // CONFIGURACIÓN VAPID
  // ===========================================================================
  describe('configuración VAPID', () => {
    it('habilita el push cuando están las tres variables', () => {
      serviceWith(prisma, VAPID);
      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        VAPID.VAPID_SUBJECT,
        VAPID.VAPID_PUBLIC_KEY,
        VAPID.VAPID_PRIVATE_KEY,
      );
    });

    it('queda deshabilitado y sin clave pública si faltan variables', () => {
      const service = serviceWith(prisma, {});
      expect(webpush.setVapidDetails).not.toHaveBeenCalled();
      expect(service.getPublicKey()).toBeNull();
    });
  });

  // ===========================================================================
  // SUSCRIPCIONES
  // ===========================================================================
  describe('subscribe / unsubscribe', () => {
    it('crea la suscripción con upsert (endpoint único)', async () => {
      prisma.pushSubscription.upsert.mockResolvedValue({ id: 's1' });
      const service = serviceWith(prisma);

      const result = await service.subscribe('u1', SUB, 'Chrome/128');

      expect(result).toEqual({ id: 's1' });
      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: SUB.endpoint },
        create: {
          user_id: 'u1',
          endpoint: SUB.endpoint,
          p256dh: SUB.keys.p256dh,
          auth: SUB.keys.auth,
          user_agent: 'Chrome/128',
        },
        update: {
          user_id: 'u1',
          p256dh: SUB.keys.p256dh,
          auth: SUB.keys.auth,
          user_agent: 'Chrome/128',
        },
      });
    });

    it('reutiliza el endpoint si ya existía (reasigna al usuario)', async () => {
      prisma.pushSubscription.upsert.mockResolvedValue({ id: 's1' });
      const service = serviceWith(prisma);

      await service.subscribe('u2', SUB);

      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ user_id: 'u2' }),
        }),
      );
    });

    it('borra solo suscripciones del usuario (ownership)', async () => {
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
      const service = serviceWith(prisma);

      const result = await service.unsubscribe('u1', SUB.endpoint);

      expect(result).toEqual({ removed: 1 });
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { user_id: 'u1', endpoint: SUB.endpoint },
      });
    });
  });

  // ===========================================================================
  // ENVÍO
  // ===========================================================================
  describe('sendToUser', () => {
    it('es no-op si el push está deshabilitado', async () => {
      const service = serviceWith(prisma, {});
      const result = await service.sendToUser('u1', { title: 't', body: 'b' });
      expect(result).toEqual({ sent: 0, failed: 0, removed: 0 });
      expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('no hace nada si el usuario no tiene suscripciones', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([]);
      const service = serviceWith(prisma);

      const result = await service.sendToUser('u1', { title: 't', body: 'b' });

      expect(result).toEqual({ sent: 0, failed: 0, removed: 0 });
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('envía el payload JSON a todas las suscripciones', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example.com/1', p256dh: 'k1', auth: 'a1' },
        { id: 's2', endpoint: 'https://push.example.com/2', p256dh: 'k2', auth: 'a2' },
      ]);
      webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
      const service = serviceWith(prisma);
      const payload = { title: 'Garantía por vencer', body: 'texto', icon: '/icons/i.png' };

      const result = await service.sendToUser('u1', payload);

      expect(result).toEqual({ sent: 2, failed: 0, removed: 0 });
      expect(webpush.sendNotification).toHaveBeenCalledWith(
        { endpoint: 'https://push.example.com/1', keys: { p256dh: 'k1', auth: 'a1' } },
        JSON.stringify(payload),
      );
      expect(webpush.sendNotification).toHaveBeenCalledWith(
        { endpoint: 'https://push.example.com/2', keys: { p256dh: 'k2', auth: 'a2' } },
        JSON.stringify(payload),
      );
    });

    it('elimina la suscripción si el push service responde 404 o 410', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example.com/dead', p256dh: 'k', auth: 'a' },
      ]);
      webpush.sendNotification.mockRejectedValue({ statusCode: 410, message: 'gone' });
      const service = serviceWith(prisma);

      const result = await service.sendToUser('u1', { title: 't', body: 'b' });

      expect(result).toEqual({ sent: 0, failed: 0, removed: 1 });
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { id: 's1' },
      });
    });

    it('cuenta como fallo los errores que no son 404/410 y NO elimina', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example.com/1', p256dh: 'k', auth: 'a' },
      ]);
      webpush.sendNotification.mockRejectedValue({ statusCode: 500, message: 'boom' });
      const service = serviceWith(prisma);

      const result = await service.sendToUser('u1', { title: 't', body: 'b' });

      expect(result).toEqual({ sent: 0, failed: 1, removed: 0 });
      expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // PAYLOAD DE GARANTÍA
  // ===========================================================================
  describe('sendWarrantyPush', () => {
    it('por vencer: título, mensaje e icono, url al producto', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example.com/1', p256dh: 'k', auth: 'a' },
      ]);
      webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
      const service = serviceWith(prisma);

      const result = await service.sendWarrantyPush('u1', {
        tipo: NotificationType.GARANTIA_POR_VENCER,
        mensaje: 'La garantía de «Laptop» vence en 7 días.',
        product_id: 'p1',
      });

      expect(result).toEqual({ sent: 1, failed: 0, removed: 0 });
      const sentPayload = JSON.parse(webpush.sendNotification.mock.calls[0][1]);
      expect(sentPayload).toEqual({
        title: 'Garantía por vencer',
        body: 'La garantía de «Laptop» vence en 7 días.',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        data: { url: '/products/p1' },
      });
    });

    it('vencida sin producto: título correcto y url al dashboard', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example.com/1', p256dh: 'k', auth: 'a' },
      ]);
      webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
      const service = serviceWith(prisma);

      const result = await service.sendWarrantyPush('u1', {
        tipo: NotificationType.GARANTIA_VENCIDA,
        mensaje: 'La garantía de «Silla» venció hace 3 días.',
        product_id: null,
      });

      expect(result).toEqual({ sent: 1, failed: 0, removed: 0 });
      const sentPayload = JSON.parse(webpush.sendNotification.mock.calls[0][1]);
      expect(sentPayload).toEqual({
        title: 'Garantía vencida',
        body: 'La garantía de «Silla» venció hace 3 días.',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        data: { url: '/dashboard' },
      });
    });
  });
});
