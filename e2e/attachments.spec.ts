// =============================================================================
// e2e: subida de imágenes y visualización en la galería
// =============================================================================
// Flujo completo: usuario verificado → login → crear producto → subir una foto
// por la UI (input file del uploader) → la galería la muestra CARGADA.
//
// Regresión que protege: la imagen debe renderizar DENTRO de la página. Sin el
// header Cross-Origin-Resource-Policy: cross-origin en /uploads (helmet pone
// same-origin por defecto), el navegador bloquea el <img> cross-origin
// (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin): la imagen se ve rota aunque la URL
// responda 200 al abrirla en otra pestaña. El test falla con naturalWidth 0.
// =============================================================================

import { expect, test } from '@playwright/test';

import { API_URL } from './env';
import { login, randomEmail, registerAndVerify } from './helpers';

// PNG válido de 1x1 (transparente). El uploader acepta image/png.
const PNG_1PX: Buffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('sube una foto y se visualiza cargada en la galería del producto', async ({ page }) => {
  const email = randomEmail('img');
  await registerAndVerify(page.request, email);
  await login(page, email);

  // Producto por API con la sesión del navegador (el foco es la imagen).
  const res = await page.request.post(`${API_URL}/products`, {
    data: {
      nombre: 'Fotocopiadora E2E',
      tipo_compra: 'FISICO',
      precio: 199.99,
      moneda: 'USD',
      estado: 'NUEVO',
      fecha_compra: '2026-08-10',
    },
  });
  expect(res.ok(), `crear producto falló: ${res.status()} ${await res.text()}`).toBeTruthy();
  const { id } = (await res.json()) as { id: string };

  await page.goto(`/products/${id}`);

  // Subir la foto por la UI (el input file del uploader está oculto; Playwright
  // puede setear archivos igual). Dispara el onChange → upload → refetch.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'foto-e2e.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });

  // La galería renderiza el <img> con el nombre original como alt.
  const img = page.locator('img[alt="foto-e2e.png"]');
  await expect(img).toBeVisible({ timeout: 15_000 });

  // La URL debe apuntar al ORIGEN del backend (no al del frontend): si fuera
  // relativa, el navegador la resolvería contra :3102 y daría 404.
  await expect(img).toHaveAttribute('src', new RegExp(`^${new URL(API_URL).origin}/uploads/`));

  // La imagen CARGA de verdad (naturalWidth > 0). Un <img> bloqueado por CORP
  // o 404 queda en naturalWidth 0 aunque el elemento exista en el DOM.
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  // Y el archivo responde 200 por HTTP con el MIME correcto.
  const src = await img.getAttribute('src');
  expect(src).toBeTruthy();
  const file = await page.request.get(src!);
  expect(file.ok(), `el archivo ${src} debería responder 200`).toBeTruthy();
  expect(file.headers()['content-type']).toBe('image/png');
});
