// =============================================================================
// lib/push.ts - helpers de Web Push
// =============================================================================

/**
 * Convierte la clave pública VAPID (base64url) a Uint8Array, el formato que
 * espera pushManager.subscribe({ applicationServerKey }).
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  // Normaliza a base64 estándar: - -> +, _ -> /, relleno con =.
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/') + padding;

  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

/** ¿El navegador soporta push (SW + Push API + Notification)? */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}
