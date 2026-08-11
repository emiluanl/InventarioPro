// =============================================================================
// Alta de producto de punta a punta:
// usuario verificado (API) → login (UI) → crear producto → detalle → dashboard
// =============================================================================

import { expect, test } from '@playwright/test';

import { login, randomEmail, registerAndVerify } from './helpers';

test('login y alta de producto con garantía', async ({ page, request }) => {
  const email = randomEmail('prod');

  // Usuario verificado por API (el flujo UI de registro ya se cubre en auth.spec).
  await registerAndVerify(request, email);

  await login(page, email);

  // --- Alta de producto ---
  await page.goto('/products/new');
  await page.fill('#nombre', 'Laptop E2E');
  await page.fill('#marca', 'Lenovo');
  await page.fill('#modelo', 'ThinkPad X1');
  await page.fill('#fecha_compra', '2026-08-01');
  await page.fill('#precio', '1299.99');
  await page.fill('#duracion_garantia_meses', '24');
  await page.getByRole('button', { name: 'Crear producto' }).click();

  // Redirige al detalle con el producto creado.
  // Los IDs de Prisma son cuid (base36), p. ej. cmsnuxz2s0004nvk8jn3e8vgw.
  await expect(page).toHaveURL(/\/products\/[a-z0-9]+$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Laptop E2E' })).toBeVisible();

  // Marca/modelo y garantía auto-calculada se muestran en el detalle.
  await expect(page.getByText('Lenovo · ThinkPad X1')).toBeVisible();
  await expect(page.getByText('Vence garantía')).toBeVisible();

  // --- Aparece en el dashboard ---
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Laptop E2E' })).toBeVisible();
});
