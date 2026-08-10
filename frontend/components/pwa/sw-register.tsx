'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker (public/sw.js) en producción.
 * En desarrollo no se registra: evitaría cachés obsoletas durante el desarrollo.
 */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('No se pudo registrar el service worker:', err);
    });
  }, []);
  return null;
}
