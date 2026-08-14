// =============================================================================
// Flujo integral del usuario LOGEADO: todo lo que se puede usar con sesión.
// =============================================================================
// Cubre la superficie completa que el auth.spec/products.spec no tocan:
//   - Ciclo de vida del producto: crear (UI) → editar (UI) → buscar → borrar.
//   - Categorías personalizadas (API) + su uso en el alta de producto.
//   - Reportes de gasto (UI) y export CSV (descarga real).
//   - Chat del asistente (UI): responde con fallback amable sin key de IA.
//   - Notificaciones (UI): estado vacío + endpoints de conteo.
//   - Configuración (UI): cambio de contraseña → re-login con la nueva.
//   - Cierre de sesión (UI).
//
// Nota: las llamadas API con page.request comparten las cookies httpOnly de la
// sesión establecida por el login por UI (mismo contexto de navegador).
// =============================================================================

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

import { API_URL } from './env';
import { E2E_PASSWORD, login, randomEmail, registerAndVerify } from './helpers';

// -----------------------------------------------------------------------------
// TEST 1: ciclo de vida completo del producto por la UI
// -----------------------------------------------------------------------------
test('producto: crear → editar → buscar → borrar (UI)', async ({ page, request }) => {
  const email = randomEmail('flow');
  await registerAndVerify(request, email);
  await login(page, email);

  // --- Crear ---
  await page.goto('/products/new');
  await page.fill('#nombre', 'Tablet Flow');
  await page.fill('#marca', 'Samsung');
  await page.fill('#modelo', 'Tab S9');
  await page.fill('#fecha_compra', '2026-07-15');
  await page.fill('#precio', '899.50');
  await page.fill('#duracion_garantia_meses', '12');
  await page.getByRole('button', { name: 'Crear producto' }).click();

  await expect(page).toHaveURL(/\/products\/[a-z0-9]+$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Tablet Flow' })).toBeVisible();
  await expect(page.getByText('Samsung · Tab S9')).toBeVisible();

  // --- Editar (cambiar nombre y precio) ---
  await page.getByRole('link', { name: 'Editar' }).click();
  await expect(page).toHaveURL(/\/products\/[a-z0-9]+\/edit$/);
  await page.fill('#nombre', 'Tablet Flow Pro');
  await page.fill('#precio', '1099.00');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page).toHaveURL(/\/products\/[a-z0-9]+$/);
  await expect(page.getByRole('heading', { name: 'Tablet Flow Pro' })).toBeVisible();

  // --- Buscar en el dashboard ---
  await page.goto('/dashboard');
  await page.getByPlaceholder('Buscar por nombre, marca, modelo...').fill('Flow Pro');
  await expect(page.getByRole('heading', { name: 'Tablet Flow Pro' })).toBeVisible({
    timeout: 15_000,
  });

  // --- Borrar desde la vista lista ---
  await page.getByRole('button', { name: 'Lista' }).click();
  // El confirm() se dispara al hacer click: registramos el handler ANTES.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Borrar' }).click();
  // El producto desaparece del listado.
  await expect(page.getByText('Tablet Flow Pro').first()).toHaveCount(0, { timeout: 15_000 });
});

// -----------------------------------------------------------------------------
// TEST 2: categorías, reportes y export CSV
// -----------------------------------------------------------------------------
test('categorías personalizadas, reportes de gasto y export CSV', async ({ page, request }) => {
  const email = randomEmail('flow2');
  await registerAndVerify(request, email);
  await login(page, email);

  // --- Crear una categoría personalizada por API (cookies de la sesión) ---
  const catRes = await page.request.post(`${API_URL}/categories`, {
    data: { nombre: 'Electrodomésticos Flow', icono: '🧊' },
  });
  expect(catRes.ok(), `crear categoría debería ser 2xx (${catRes.status()})`).toBeTruthy();
  const category = (await catRes.json()) as { id: string };

  // La lista de categorías del formulario la incluye (los <option> cerrados
  // nunca son "visible" para Playwright: contamos nodos en vez de visibilidad).
  await page.goto('/products/new');
  await expect(page.locator('#categoria_id option', { hasText: 'Electrodomésticos Flow' })).toHaveCount(1);

  // --- Crear 2 productos por API con esa categoría ---
  const p1 = await page.request.post(`${API_URL}/products`, {
    data: {
      nombre: 'Nevera Flow',
      categoria_id: category.id,
      fecha_compra: '2026-08-01',
      tipo_compra: 'FISICO',
      precio: 450,
      moneda: 'USD',
      duracion_garantia_meses: 24,
    },
  });
  expect(p1.ok(), `crear producto 1 (${p1.status()})`).toBeTruthy();

  const p2 = await page.request.post(`${API_URL}/products`, {
    data: {
      nombre: 'Lavadora Flow',
      categoria_id: category.id,
      fecha_compra: '2026-08-05',
      tipo_compra: 'ONLINE',
      precio: 350,
      moneda: 'USD',
    },
  });
  expect(p2.ok(), `crear producto 2 (${p2.status()})`).toBeTruthy();

  // --- Dashboard: ambos aparecen ---
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Nevera Flow' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lavadora Flow' })).toBeVisible();

  // --- Reportes: el gasto total del año actual debe incluir 800,00 US$ ---
  // (formatCurrency usa locale es-ES: símbolo después y coma decimal).
  await page.goto('/reports');
  await expect(page.getByText('Gasto en ').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('800,00 US$').first()).toBeVisible();
  await expect(page.getByText('Electrodomésticos Flow')).toBeVisible();

  // --- Export CSV: descarga real y contenido ---
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  const download = await downloadPromise;
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv).toContain('Nevera Flow');
  expect(csv).toContain('Lavadora Flow');
  expect(csv).toContain('Electrodomésticos Flow');
});

// -----------------------------------------------------------------------------
// TEST 3: chat del asistente y notificaciones
// -----------------------------------------------------------------------------
test('chat del asistente (fallback sin key) y notificaciones', async ({ page, request }) => {
  const email = randomEmail('flow3');
  await registerAndVerify(request, email);
  await login(page, email);

  // --- Chat: sin DEEPSEEK_API_KEY el asistente responde con el fallback amable ---
  await page.getByRole('button', { name: 'Abrir chat con asistente' }).click();
  await expect(page.getByText('¡Hola! Soy tu asistente.')).toBeVisible();

  await page.getByPlaceholder('Escribe un mensaje…').fill('¿Qué compré en agosto?');
  await page.getByRole('button', { name: 'Enviar' }).click();

  // El servicio degrada con un mensaje amable (nunca un error crudo).
  await expect(page.getByText(/no puedo pensar bien|intentarlo de nuevo|no está configurado/i)).toBeVisible({
    timeout: 20_000,
  });

  // La conversación persiste: cerramos y reabrimos el chat.
  await page.getByRole('button', { name: 'Cerrar chat' }).click();
  await page.getByRole('button', { name: 'Abrir chat con asistente' }).click();
  await expect(page.getByText('¿Qué compré en agosto?')).toBeVisible({ timeout: 10_000 });

  // --- Notificaciones: estado vacío + endpoint de conteo ---
  await page.getByRole('button', { name: 'Cerrar chat' }).click();
  await page.getByRole('button', { name: 'Notificaciones' }).click();
  await expect(page.getByText('No tienes notificaciones.')).toBeVisible();

  const unread = await page.request.get(`${API_URL}/notifications/unread-count`);
  expect(unread.ok()).toBeTruthy();
  expect(await unread.json()).toEqual(0);

  const list = await page.request.get(`${API_URL}/notifications`);
  expect(list.ok()).toBeTruthy();
  expect(await list.json()).toEqual([]);
});

// -----------------------------------------------------------------------------
// TEST 4: configuración de cuenta — cambio de contraseña y cierre de sesión
// -----------------------------------------------------------------------------
test('configuración: cambiar contraseña → re-login y cerrar sesión', async ({ page, request }) => {
  const email = randomEmail('flow4');
  await registerAndVerify(request, email);
  await login(page, email);

  const newPassword = 'NuevaPass456';

  // --- Cambiar contraseña ---
  await page.goto('/settings');
  await page.fill('#current_password', E2E_PASSWORD);
  await page.fill('#new_password', newPassword);
  await page.fill('#confirm_password', newPassword);
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();

  // Éxito visible y cierre automático de sesión (revoca todas las sesiones).
  await expect(page.getByText(/Contraseña actualizada/)).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  // --- Re-login con la NUEVA contraseña ---
  await page.fill('#email', email);
  await page.fill('#password', newPassword);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  // --- Cierre de sesión explícito ---
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();

  // Tras logout, una ruta protegida redirige al login.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
});
