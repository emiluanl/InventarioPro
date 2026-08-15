// =============================================================================
// e2e: layout móvil (Propuesta A) + toggle forzado (Propuesta B)
// =============================================================================
// A) Viewport de celular (375×667). Verifica que:
//   1. NO hay desborde horizontal (scrollWidth ≈ clientWidth) en el dashboard.
//   2. La navegación inferior móvil está visible y la de escritorio oculta.
//   3. Los filtros vienen plegados y el botón "Filtros" los despliega.
//   4. La vista Lista usa tarjetas móviles (sin tabla que desborde).
//   5. La barra inferior navega a Reportes.
// B) Escritorio (1280×800) con el toggle de Configuración en "Forzado móvil":
//   el chrome cambia a móvil (barra inferior, cabecera compacta, filtros
//   plegados, tarjetas) aunque la pantalla sea grande, y persiste al recargar.
// =============================================================================

import { expect, test } from '@playwright/test';

import { API_URL } from './env';
import { login, randomEmail, registerAndVerify } from './helpers';

test.use({ viewport: { width: 375, height: 667 } });

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { timeout: 10_000 },
    )
    .toBeLessThanOrEqual(1);
}

test('móvil: sin overflow, nav inferior, filtros plegables y tarjetas en la lista', async ({
  page,
}) => {
  const email = randomEmail('mob');
  await registerAndVerify(page.request, email);
  await login(page, email);

  // Dos productos para verificar el listado.
  for (const nombre of ['Mouse Gamer', 'Teclado RGB']) {
    const res = await page.request.post(`${API_URL}/products`, {
      data: {
        nombre,
        tipo_compra: 'FISICO',
        precio: 49.9,
        moneda: 'USD',
        estado: 'NUEVO',
        fecha_compra: '2026-08-10',
      },
    });
    expect(res.ok(), `crear ${nombre} falló: ${res.status()}`).toBeTruthy();
  }
  await page.goto('/dashboard');

  // 1) Sin desborde horizontal en el dashboard (la cabecera y la tabla eran
  //    los puntos que rompían el ancho del teléfono).
  await expectNoHorizontalOverflow(page);

  // 2) Nav inferior visible; la cabecera de escritorio (con "Reportes") oculta.
  const bottomNav = page.getByRole('navigation', { name: 'Navegación móvil' });
  await expect(bottomNav).toBeVisible();
  await expect(bottomNav.getByRole('link', { name: 'Reportes' })).toBeVisible();
  // La cabecera de escritorio (con su link a Reportes) debe estar oculta.
  await expect(page.locator('header').getByRole('link', { name: 'Reportes' })).toBeHidden();

  // 3) Filtros plegados al inicio; "Filtros" los despliega.
  const filtrosBtn = page.getByRole('button', { name: /Filtros/ });
  await expect(filtrosBtn).toBeVisible();
  const buscarInput = page.getByPlaceholder('Buscar por nombre, marca, modelo...');
  await expect(buscarInput).toBeHidden();  await filtrosBtn.click();
  await expect(buscarInput).toBeVisible();
  // Sin overflow con el panel de filtros abierto (en 1 columna).
  await expectNoHorizontalOverflow(page);

  // 4) Vista Lista en móvil: tarjetas compactas, sin tabla.
  await page.getByRole('button', { name: 'Lista' }).click();
  await expect(page.getByRole('link', { name: /Mouse Gamer/ })).toBeVisible();
  await expect(page.locator('table')).toBeHidden();
  await expectNoHorizontalOverflow(page);

  // 5) La barra inferior navega a Reportes (y no hay overflow ahí tampoco).
  await bottomNav.getByRole('link', { name: 'Reportes' }).click();
  await expect(page).toHaveURL(/\/reports/);
  await expectNoHorizontalOverflow(page);
});

// -----------------------------------------------------------------------------
// Propuesta B: toggle manual para forzar el layout móvil en pantallas grandes.
// -----------------------------------------------------------------------------
test.describe('toggle forzado de móvil en escritorio (Propuesta B)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('forzar móvil desde Configuración cambia el chrome y persiste al recargar', async ({
    page,
  }) => {
    const email = randomEmail('tgl');
    await registerAndVerify(page.request, email);
    await login(page, email);

    const res = await page.request.post(`${API_URL}/products`, {
      data: {
        nombre: 'Monitor 27"',
        tipo_compra: 'ONLINE',
        precio: 259.99,
        moneda: 'USD',
        estado: 'USADO',
        fecha_compra: '2026-08-01',
      },
    });
    expect(res.ok(), `crear producto falló: ${res.status()}`).toBeTruthy();

    const bottomNav = page.getByRole('navigation', { name: 'Navegación móvil' });
    const headerDesktopNav = page
      .locator('header')
      .getByRole('link', { name: 'Reportes' });

    // Antes del toggle: en escritorio la barra inferior está oculta y la
    // cabecera superior (con Reportes) visible; los filtros vienen abiertos.
    await page.goto('/dashboard');
    await expect(bottomNav).toBeHidden();
    await expect(headerDesktopNav).toBeVisible();
    await expect(page.getByRole('button', { name: /Filtros/ })).toBeHidden();
    await expect(page.getByPlaceholder('Buscar por nombre, marca, modelo...')).toBeVisible();

    // Activar "Forzado móvil" en Configuración.
    await page.goto('/settings');
    await page.getByLabel('Modo de vista').selectOption('mobile');

    // El chrome cambia al instante: barra inferior visible, cabecera oculta.
    await expect(bottomNav).toBeVisible();
    await expect(headerDesktopNav).toBeHidden();

    // En el dashboard: filtros plegados (botón "Filtros") y vista Lista en
    // tarjetas móviles, sin tabla, aunque la pantalla sea de escritorio.
    await page.goto('/dashboard');
    await expect(bottomNav).toBeVisible();
    await expect(headerDesktopNav).toBeHidden();
    const filtrosBtn = page.getByRole('button', { name: /Filtros/ });
    await expect(filtrosBtn).toBeVisible();
    await expect(page.getByPlaceholder('Buscar por nombre, marca, modelo...')).toBeHidden();

    await page.getByRole('button', { name: 'Lista' }).click();
    await expect(page.getByRole('link', { name: /Monitor 27/ })).toBeVisible();
    await expect(page.locator('table')).toBeHidden();
    await expectNoHorizontalOverflow(page);

    // El modo se persiste en localStorage: sobrevive a la recarga.
    await page.reload();
    await expect(bottomNav).toBeVisible();
    await expect(headerDesktopNav).toBeHidden();

    // Volver a "Automático" restaura el layout de escritorio.
    await page.goto('/settings');
    await page.getByLabel('Modo de vista').selectOption('auto');
    await page.goto('/dashboard');
    await expect(bottomNav).toBeHidden();
    await expect(headerDesktopNav).toBeVisible();
  });
});
