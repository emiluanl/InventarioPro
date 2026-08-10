// =============================================================================
// sw.js - Service Worker de InventarioPro
// =============================================================================
// Estrategias:
//   - Navegación: red primero; si falla, shell cacheado (offline).
//   - API (GET, fuera de /auth/): red primero con timeout corto y fallback a
//     la última respuesta vista (datos disponibles sin conexión).
//     NUNCA cacheamos /auth/ (credenciales y sesiones no deben persistir).
//   - Estáticos del mismo origen (JS/CSS/imágenes): stale-while-revalidate.
//   - Push: muestra notificaciones del backend (garantías) y abre la app al
//     hacer clic (notificationclick).
//
// Los caches están versionados (VERSION); al actualizar la app el activate
// borra los antiguos.
//
// MODO DEV: si se registra como /sw.js?dev=1 (lo hace el toggle de push en
// desarrollo) el worker NO intercepta fetch ni cachea nada: solo sirve las
// notificaciones push. Evita que el caché interfiera con el dev server.
// =============================================================================

const VERSION = 'v1';
const IS_DEV = new URL(self.location.href).searchParams.has('dev');
const SHELL_CACHE = `inventariopro-shell-${VERSION}`;
const API_CACHE = `inventariopro-api-${VERSION}`;
const STATIC_CACHE = `inventariopro-static-${VERSION}`;

const SHELL_URLS = ['/', '/dashboard', '/login', '/reports', '/products/new'];

self.addEventListener('install', (event) => {
  if (IS_DEV) {
    // En dev no cacheamos nada: el SW solo gestiona push.
    event.waitUntil(self.skipWaiting());
    return;
  }
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(`inventariopro-${VERSION}`))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Red primero con fallback a la última respuesta cacheada. */
async function networkFirst(request, cacheName, { timeoutMs = 3000 } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetchWithTimeout(request, timeoutMs);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('Sin conexión y sin datos en caché.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/** Navegaciones: red primero; offline -> shell (o dashboard) cacheado. */
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { credentials: 'same-origin' });
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached =
      (await cache.match(request)) ||
      (await cache.match('/dashboard')) ||
      (await cache.match('/'));
    if (cached) return cached;
    return new Response('Sin conexión.', { status: 503 });
  }
}

/** Estáticos del mismo origen: sirve caché y actualiza en segundo plano. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

// ---------------------------------------------------------------------------
// PUSH: notificaciones del backend (garantías por vencer / vencidas)
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'InventarioPro', body: event.data.text() };
    }
  }

  const title = data.title || 'InventarioPro';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192x192.png',
    badge: data.badge || '/icons/icon-192x192.png',
    data: { url: (data.data && data.data.url) || '/dashboard' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clic en la notificación: abre (o enfoca) la página correspondiente.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const appUrl = new URL(url, self.location.origin).href;
      const existing = clients.find((client) => client.url === appUrl);
      if (existing) {
        existing.navigate(appUrl);
        return existing.focus();
      }
      // Si hay una ventana abierta de la app, la usamos; si no, abrimos una.
      const anyAppWindow = clients.find((client) =>
        client.url.startsWith(self.location.origin),
      );
      if (anyAppWindow) {
        anyAppWindow.navigate(appUrl);
        return anyAppWindow.focus();
      }
      return self.clients.openWindow(appUrl);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (IS_DEV) return; // en dev el SW solo gestiona push

  const url = new URL(request.url);

  // API: solo GET y nunca /auth/ (no persistir credenciales/sesiones).
  if (url.pathname.includes('/api/')) {
    if (url.pathname.includes('/auth/')) return;
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
