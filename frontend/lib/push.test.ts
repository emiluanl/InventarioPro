// =============================================================================
// lib/push - tests de los helpers de Web Push
// =============================================================================

import { describe, expect, it } from 'vitest';

import { isPushSupported, urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array', () => {
  it('convierte base64url a Uint8Array', () => {
    // 'hello' en base64 = aGVsbG8=  (con padding)
    const bytes = urlBase64ToUint8Array('aGVsbG8');
    expect(Array.from(bytes)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it('decodifica los caracteres url-safe (- y _)', () => {
    // '++8=' (base64 estándar) en base64url es '--8'. 62,62,60 con '=' de
    // relleno → 2 bytes: byte1 = (62<<2)|(62>>4) = 251 (0xfb),
    // byte2 = ((62&15)<<4)|(60>>2) = 239 (0xef).
    const bytes = urlBase64ToUint8Array('--8');
    expect(Array.from(bytes)).toEqual([0xfb, 0xef]);
  });

  it('una clave VAPID real (65 bytes comprimidos) se decodifica sin error', () => {
    const key =
      'BBP20sA-DoGBjkleX6Wo9fu5hZrEEpZ9hblA9aa1-4Gw8cWMJcA3upmA00rQQPBqGDd9asdxEYgVTIaO3J9FbqE';
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04); // punto de curva elíptica
  });
});

describe('isPushSupported', () => {
  it('devuelve false si no hay PushManager ni Notification', () => {
    // jsdom no implementa PushManager por defecto.
    expect(isPushSupported()).toBe(false);
  });
});
