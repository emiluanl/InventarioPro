// =============================================================================
// Helpers compartidos de los tests e2e
// =============================================================================
//
// ⚠ Para tests que usen page.route: la app es una PWA y en producción (next
// start, como corre el e2e) su service worker (/sw.js) intercepta los GETs —
// page.route NO ve esos requests (el SW hace su propio fetch) y una API lenta
// en frío puede devolver 503 del caché. Por eso playwright.config.ts bloquea
// el SW globalmente (serviceWorkers: 'block', aplica también a contextos
// manuales). No lo re-habiliten en un test salvo que el SW sea el objetivo.
// Detalle completo en el header de e2e/mobile-layout.spec.ts.
// =============================================================================

import { readFileSync } from 'node:fs';

import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { API_URL, EMAIL_LOG } from './env';

export const E2E_PASSWORD = 'E2ePass123';

/**
 * Email único por test (evita colisiones entre ejecuciones paralelas).
 *
 * CONTRATO: el dominio @example.com es la marca canónica de "usuario de
 * prueba" — scripts/clean-test-users.sh (npm run test-users) la usa para
 * listar/borrar usuarios de test de la BD de desarrollo. No cambies el
 * dominio sin actualizar también ese script.
 */
export function randomEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * El backend envía el email de verificación fire-and-forget y en modo dev lo
 * escribe en EMAIL_LOG (línea `VERIFY|<email>|<url>`). Este helper hace polling
 * hasta que la línea de ese email aparezca y devuelve la URL completa.
 */
export async function waitForVerificationUrl(email: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const url = findVerificationUrl(email);
      if (url) return url;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `No se encontró el enlace de verificación para ${email} en ${EMAIL_LOG}` +
      (lastError ? ` (${(lastError as Error).message})` : ''),
  );
}

function findVerificationUrl(email: string): string | null {
  let content: string;
  try {
    content = readFileSync(EMAIL_LOG, 'utf8');
  } catch {
    return null; // El archivo todavía no existe.
  }
  for (const line of content.split('\n').reverse()) {
    const match = /^VERIFY\|(.+)\|(https?:\/\/.+)$/.exec(line.trim());
    if (match && match[1] === email) {
      return match[2];
    }
  }
  return null;
}

/** Registra un usuario por API y lo deja verificado (token del email dev). */
export async function registerAndVerify(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  const res = await request.post(`${API_URL}/auth/register`, {
    data: { email, password: E2E_PASSWORD, nombre: 'Usuario E2E' },
  });
  expect(res.ok(), `register debería responder 2xx (${res.status()})`).toBeTruthy();

  const url = await waitForVerificationUrl(email);
  const token = new URL(url).searchParams.get('token');
  expect(token, 'el enlace de verificación debe incluir un token').toBeTruthy();

  const verify = await request.post(`${API_URL}/auth/verify-email`, {
    data: { token },
  });
  expect(verify.ok(), `verify-email debería responder 2xx (${verify.status()})`).toBeTruthy();
}

/** Login por la UI y espera aterrizar en el dashboard. */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', E2E_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}
