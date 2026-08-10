'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { isPushSupported, urlBase64ToUint8Array } from '@/lib/push';

interface PushState {
  supported: boolean;
  configured: boolean;
  enabled: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Gestiona la suscripción a Web Push del navegador:
 *  - supported: ¿el navegador soporta push?
 *  - configured: ¿el backend tiene VAPID configurado (clave pública)?
 *  - enabled: ¿hay una suscripción activa registrada en el backend?
 *  - toggle(): pide permiso y suscribe, o da de baja.
 *
 * El SW se registra con '/sw.js' en producción (ya lo hace sw-register) y con
 * '/sw.js?dev=1' en desarrollo (modo solo-push, sin cacheo, para no interferir
 * con el dev server).
 */
export function usePushNotifications(): PushState & {
  toggle: () => Promise<void>;
} {
  const [supported] = useState<boolean>(() => isPushSupported());
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clave pública VAPID del backend (necesaria al suscribirse).
  const vapidKey = useRef<string | null>(null);

  useEffect(() => {
    if (!supported) return;

    let cancelled = false;

    async function init(): Promise<void> {
      try {
        const { data } = await api.get<{ publicKey: string | null }>(
          '/push/vapid-public-key',
        );
        if (cancelled) return;
        if (!data.publicKey) {
          setError('El servidor no tiene configuradas las notificaciones push.');
          return;
        }
        vapidKey.current = data.publicKey;
        setConfigured(true);

        // Solo detectamos suscripciones si ya hay un SW registrado:
        // navigator.serviceWorker.ready NUNCA resuelve si no hay registro
        // (p. ej. en desarrollo hasta que el usuario activa el toggle), así
        // que usamos getRegistration() que devuelve null al instante.
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          const subscription = await registration.pushManager.getSubscription();
          if (!cancelled && subscription) setEnabled(true);
        }
      } catch {
        // Sin conexión o error de red: no bloqueamos el resto de la UI.
        if (!cancelled) setError('No se pudo consultar el estado de las notificaciones.');
      }
    }

    void init();

    // Si el navegador rota la suscripción (pushsubscriptionchange) la
    // re-registramos en el backend con la nueva.
    const onSubscriptionChange = (event: Event): void => {
      const newSub = (event as Event & { newSubscription?: PushSubscription })
        .newSubscription;
      if (!newSub) return;
      void api
        .post('/push/subscribe', {
          endpoint: newSub.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...new Uint8Array(newSub.getKey('p256dh')!))),
            auth: btoa(String.fromCharCode(...new Uint8Array(newSub.getKey('auth')!))),
          },
        })
        .then(() => setEnabled(true))
        .catch(() => undefined);
    };
    navigator.serviceWorker.addEventListener('pushsubscriptionchange', onSubscriptionChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        'pushsubscriptionchange',
        onSubscriptionChange,
      );
    };
  }, [supported]);

  const subscribe = useCallback(async (): Promise<void> => {
    if (!supported) {
      setError('Tu navegador no soporta notificaciones push.');
      return;
    }
    if (!configured || !vapidKey.current) {
      setError('El servidor no tiene configuradas las notificaciones push.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError('Permiso denegado. Activa las notificaciones desde el navegador.');
        return;
      }

      // En desarrollo registramos el SW solo-push; en producción ya está
      // registrado por sw-register (con cacheo y shell offline).
      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        const swUrl = process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw.js?dev=1';
        registration = await navigator.serviceWorker.register(swUrl, { scope: '/' });
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey.current),
      });

      await api.post('/push/subscribe', {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')!))),
          auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth')!))),
        },
      });

      setEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo activar las notificaciones.');
    } finally {
      setLoading(false);
    }
  }, [supported, configured]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await api.post('/push/unsubscribe', { endpoint });
      }
      setEnabled(false);
    } catch {
      setError('No se pudo desactivar las notificaciones.');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback(async (): Promise<void> => {
    if (enabled) await unsubscribe();
    else await subscribe();
  }, [enabled, subscribe, unsubscribe]);

  return { supported, configured, enabled, loading, error, toggle };
}
