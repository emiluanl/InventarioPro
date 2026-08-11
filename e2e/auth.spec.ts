// =============================================================================
// Flujo de autenticación de punta a punta:
// registro (UI) → verificación de email (token real del email dev) → login (UI)
// =============================================================================

import { expect, test } from '@playwright/test';

import { E2E_PASSWORD, login, randomEmail, waitForVerificationUrl } from './helpers';

test('registro → verificación de email → login → dashboard', async ({ page }) => {
  const email = randomEmail('auth');
  const nombre = 'Usuario E2E';

  // --- Registro por la UI ---
  await page.goto('/register');
  await page.fill('#nombre', nombre);
  await page.fill('#email', email);
  await page.fill('#password', E2E_PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  // Redirige a /login?registered=true con el aviso de verificación.
  await expect(page).toHaveURL(/\/login\?registered=true/, { timeout: 15_000 });
  await expect(page.getByText(/Cuenta creada\. Revisa tu email/)).toBeVisible();

  // --- Verificación con el token real del email ---
  const verificationUrl = await waitForVerificationUrl(email);
  await page.goto(verificationUrl);
  await expect(page.getByRole('heading', { name: '¡Email verificado!' })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Ir a iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // --- Login por la UI ---
  await login(page, email);

  // El dashboard muestra el email del usuario en el header.
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
});
