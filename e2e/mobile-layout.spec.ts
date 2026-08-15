// =============================================================================
// e2e: layout móvil (Propuesta A) + toggles forzados (Propuestas B y C)
// =============================================================================
// A) Viewport de celular (375×667). Verifica que:
//   1. NO hay desborde horizontal (scrollWidth ≈ clientWidth) en el dashboard.
//   2. La navegación inferior móvil está visible y la de escritorio oculta.
//   3. Los filtros vienen plegados y el botón "Filtros" los despliega.
//   4. La vista Lista usa tarjetas móviles (sin tabla que desborde).
//   5. La barra inferior navega a Reportes.
// B) Escritorio (1280×800) con el toggle "Forzado móvil": el chrome cambia a
//   móvil (barra inferior, cabecera compacta, filtros plegados, tarjetas)
//   aunque la pantalla sea grande, y persiste al recargar.
// C) Celular (375×667) con el toggle "Forzado escritorio": la cabecera
//   superior y la tabla se muestran aunque la pantalla sea chica, los filtros
//   quedan abiertos (sin botón "Filtros") y no hay desborde de página.
// D) Viewports intermedios (transiciones tablet): 768px (md, tarjetas → tabla,
//   nav móvil + filtros plegables) y 1024px (lg, salto a escritorio: cabecera
//   superior, filtros abiertos, grid 3 columnas). Ambos sin desborde en
//   dashboard (grid, lista, filtros abiertos) y en Reportes.
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

/** Número de columnas del grid de tarjetas del dashboard (gridTemplateColumns). */
async function gridColumns(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const link = document.querySelector('main a[href^="/products/"]') as HTMLElement | null;
    const grid = link?.closest<HTMLElement>('div.grid');
    if (!grid) return 0;
    return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
  });
}

/**
 * Espera a que la barra inferior esté ESTABLE antes de hacer clic en ella.
 * El flake de arranque en frío era un clic a "Reportes" que caía justo cuando
 * el nav se remontaba (hidratación + resolución del modo de layout): el
 * mousedown caía en un nodo y el mouseup en el reemplazo, el navegador no
 * sintetizaba el click y la URL nunca cambiaba. Esta espera muestrea el nodo
 * y su geometría y recién avanza cuando dos muestras consecutivas son
 * idénticas (nada remontándose ni moviéndose).
 */
async function waitForStableBottomNav(
  page: import('@playwright/test').Page,
): Promise<void> {
  await expect(
    page.locator('nav[aria-label="Navegación móvil"] a[href="/reports"]'),
  ).toBeVisible();
  await page.waitForFunction(
    () => {
      const el = document.querySelector<HTMLAnchorElement>(
        'nav[aria-label="Navegación móvil"] a[href="/reports"]',
      );
      if (!el) return false;
      const w = window as unknown as { __stableNav?: { node: Node; box: string } };
      const r = el.getBoundingClientRect();
      const box = `${r.left}|${r.top}|${r.width}|${r.height}`;
      const prev = w.__stableNav;
      // Dos muestras consecutivas con el MISMO nodo y la misma geometría → estable.
      if (prev && prev.node === el && prev.box === box) return true;
      w.__stableNav = { node: el, box };
      return false;
    },
    undefined,
    { polling: 200, timeout: 10_000 },
  );
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

  // 1b) El badge del header indica el modo efectivo (auto + pantalla chica).
  await expect(page.getByLabel('Modo de layout: Móvil')).toBeVisible();

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
  //    Espera a que el nav esté estable: el clic frío a veces caía en medio de
  //    un remount del nav y no navegaba (flake de arranque en frío).
  await waitForStableBottomNav(page);
  await bottomNav.getByRole('link', { name: 'Reportes' }).click();
  await expect(page).toHaveURL(/\/reports/);
  await expectNoHorizontalOverflow(page);
});

// -----------------------------------------------------------------------------
// Badge en el LOGIN: visible antes de entrar y la elección persiste al loguearse.
// -----------------------------------------------------------------------------
test.describe('badge del modo de layout en el login', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('se ve en /login, cambia el modo y persiste al entrar al dashboard', async ({
    page,
  }) => {
    const email = randomEmail('lgd');
    await registerAndVerify(page.request, email);

    // Sin loguear: el badge está visible en la pantalla de login.
    await page.goto('/login');
    await expect(page.getByLabel('Modo de layout: Escritorio')).toBeVisible();

    // Forzar el modo móvil desde el login.
    await page.getByLabel('Modo de layout: Escritorio').click();
    await page
      .getByRole('menu', { name: 'Cambiar modo de layout' })
      .getByRole('menuitemradio', { name: /Móvil/ })
      .click();
    await expect(page.getByLabel('Modo de layout: Móvil · forzado')).toBeVisible();

    // Al entrar, el layout forzado se mantiene (persistencia en localStorage).
    await login(page, email);
    await expect(page.getByLabel('Modo de layout: Móvil · forzado')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Navegación móvil' }),
    ).toBeVisible();
  });
});

// -----------------------------------------------------------------------------
// Badge interactivo: clic abre el menú y cambia el modo sin ir a Configuración.
// -----------------------------------------------------------------------------
test.describe('badge interactivo del modo de layout', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('el menú cambia el modo al instante y el badge refleja el nuevo', async ({
    page,
  }) => {
    const email = randomEmail('bdg');
    await registerAndVerify(page.request, email);
    await login(page, email);
    await page.goto('/dashboard');

    const bottomNav = page.getByRole('navigation', { name: 'Navegación móvil' });
    const headerDesktopNav = page
      .locator('header')
      .getByRole('link', { name: 'Reportes' });

    // Antes: escritorio automático, badge con el modo efectivo.
    await expect(bottomNav).toBeHidden();
    await expect(headerDesktopNav).toBeVisible();
    const badge = page.getByLabel('Modo de layout: Escritorio');
    await expect(badge).toBeVisible();

    // Clic en el badge: se abre el menú con las tres opciones.
    await badge.click();
    const menu = page.getByRole('menu', { name: 'Cambiar modo de layout' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: /Automático/ })).toBeChecked();
    await expect(menu.getByRole('menuitemradio', { name: /Móvil/ })).not.toBeChecked();
    await expect(menu.getByRole('menuitemradio', { name: /Escritorio/ })).not.toBeChecked();

    // El menú ofrece acceso directo a Configuración → Vista.
    await expect(menu.getByRole('link', { name: /Configuración → Vista/ })).toHaveAttribute(
      'href',
      '/settings',
    );

    // Elegir "Móvil": el chrome cambia al instante y el badge lo refleja.
    await menu.getByRole('menuitemradio', { name: /Móvil/ }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByLabel('Modo de layout: Móvil · forzado')).toBeVisible();
    await expect(bottomNav).toBeVisible();
    await expect(headerDesktopNav).toBeHidden();

    // De vuelta a "Automático": se restaura el escritorio (viewport grande).
    await page.getByLabel('Modo de layout: Móvil · forzado').click();
    await page
      .getByRole('menu', { name: 'Cambiar modo de layout' })
      .getByRole('menuitemradio', { name: /Automático/ })
      .click();
    await expect(page.getByLabel('Modo de layout: Escritorio')).toBeVisible();
    await expect(bottomNav).toBeHidden();
    await expect(headerDesktopNav).toBeVisible();
  });

  test('navega con las flechas (ARIA menú) y elige con Enter', async ({ page }) => {
    const email = randomEmail('bdg');
    await registerAndVerify(page.request, email);
    await login(page, email);
    await page.goto('/dashboard');

    await page.getByLabel('Modo de layout: Escritorio').click();
    const menu = page.getByRole('menu', { name: 'Cambiar modo de layout' });
    await expect(menu).toBeVisible();

    // Roving tabindex: al abrir, solo la opción seleccionada es alcanzable por Tab.
    const auto = menu.getByRole('menuitemradio', { name: /Automático/ });
    const movil = menu.getByRole('menuitemradio', { name: /Móvil/ });
    await expect(auto).toHaveAttribute('tabindex', '0');
    await expect(movil).toHaveAttribute('tabindex', '-1');

    await page.keyboard.press('Tab');
    await expect(auto).toBeFocused();

    // Flechas: bajan y suben, Home/End saltan a los extremos.
    await page.keyboard.press('ArrowDown');
    await expect(movil).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(auto).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitemradio', { name: /Escritorio/ })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(auto).toBeFocused();

    // Enter elige la opción activa: cierra el menú y cambia el modo al instante.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(page.getByLabel('Modo de layout: Móvil · forzado')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación móvil' })).toBeVisible();
  });
});

// -----------------------------------------------------------------------------
// Tema oscuro/claro: badge con menú en la cabecera + persistencia.
// -----------------------------------------------------------------------------
test.describe('tema oscuro/claro', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('el badge del tema cambia a claro, persiste al recargar y vuelve a oscuro', async ({
    page,
  }) => {
    const email = randomEmail('thm');
    await registerAndVerify(page.request, email);
    await login(page, email);
    await page.goto('/dashboard');

    // Por defecto el tema es oscuro (sin clase .light).
    await expect(page.getByLabel('Tema: Oscuro')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('light')),
    ).toBe(false);

    // Abrir el menú del badge y elegir "Claro".
    await page.getByLabel('Tema: Oscuro').click();
    const menu = page.getByRole('menu', { name: 'Cambiar tema' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: /Oscuro/ })).toBeChecked();
    await menu.getByRole('menuitemradio', { name: /Claro/ }).click();

    // El badge cambia y la clase .light se aplica al <html>.
    await expect(page.getByLabel('Tema: Claro')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('light')),
    ).toBe(true);

    // Transición suave: la clase temporal se activa al cambiar (fade de
    // colores, no un corte seco) y se limpia sola al terminar el fade.
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.classList.contains('theme-transition'),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.classList.contains('theme-transition'),
        ),
      )
      .toBe(false);

    // Persiste al recargar (localStorage + script anti-flash del layout).
    await page.reload();
    await expect(page.getByLabel('Tema: Claro')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('light')),
    ).toBe(true);

    // Volver a "Oscuro" restaura el tema predeterminado.
    await page.getByLabel('Tema: Claro').click();
    await page
      .getByRole('menu', { name: 'Cambiar tema' })
      .getByRole('menuitemradio', { name: /Oscuro/ })
      .click();
    await expect(page.getByLabel('Tema: Oscuro')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('light')),
    ).toBe(false);
  });

  test('el selector de Configuración también cambia el tema', async ({ page }) => {
    const email = randomEmail('thc');
    await registerAndVerify(page.request, email);
    await login(page, email);
    await page.goto('/settings');

    const select = page.getByLabel('Tema de la app');
    await expect(select).toHaveValue('dark');
    await select.selectOption('light');

    await expect(page.getByLabel('Tema: Claro')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('light')),
    ).toBe(true);
  });

  test('el modo Sistema sigue prefers-color-scheme del SO y cambia en vivo', async ({
    browser,
  }) => {
    // Contexto con el SO en MODO OSCURO (prefers-color-scheme: dark).
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    try {
      const email = randomEmail('ths');
      await registerAndVerify(page.request, email);
      await login(page, email);
      await page.goto('/settings');

      // Con el SO en oscuro, activar "Sistema" deja el tema oscuro (sin .light).
      const select = page.getByLabel('Tema de la app');
      await expect(select).toHaveValue('dark');
      await select.selectOption('system');
      await expect(page.getByLabel('Tema: Sistema')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.classList.contains('light')),
      ).toBe(false);
      expect(
        await page.evaluate(() => localStorage.getItem('inventariopro:theme')),
      ).toBe('system');
    } finally {
      await ctx.close();
    }
  });
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
    await expect(page.getByLabel('Modo de layout: Móvil · forzado')).toBeVisible();

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

// -----------------------------------------------------------------------------
// Propuesta C: forzar el layout de ESCRITORIO en pantallas chicas.
// -----------------------------------------------------------------------------
test.describe('toggle forzado de escritorio en pantalla chica (Propuesta C)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('forzar escritorio en móvil: cabecera superior, filtros abiertos y tabla', async ({
    page,
  }) => {
    const email = randomEmail('dsk');
    await registerAndVerify(page.request, email);
    await login(page, email);

    const res = await page.request.post(`${API_URL}/products`, {
      data: {
        nombre: 'Impresora Láser',
        tipo_compra: 'FISICO',
        precio: 189.0,
        moneda: 'USD',
        estado: 'NUEVO',
        fecha_compra: '2026-07-20',
      },
    });
    expect(res.ok(), `crear producto falló: ${res.status()}`).toBeTruthy();

    const bottomNav = page.getByRole('navigation', { name: 'Navegación móvil' });
    const headerDesktopNav = page
      .locator('header')
      .getByRole('link', { name: 'Reportes' });

    // Antes del toggle: en el celular automático, barra inferior visible y la
    // cabecera superior oculta; filtros plegados.
    await page.goto('/dashboard');
    await expect(bottomNav).toBeVisible();
    await expect(headerDesktopNav).toBeHidden();
    await expect(page.getByPlaceholder('Buscar por nombre, marca, modelo...')).toBeHidden();

    // Activar "Forzado escritorio" en Configuración.
    await page.goto('/settings');
    await page.getByLabel('Modo de vista').selectOption('desktop');
    await page.goto('/dashboard');

    // El chrome cambia al instante: cabecera superior visible, barra inferior
    // oculta, y los filtros quedan abiertos sin botón "Filtros".
    await expect(bottomNav).toBeHidden();
    await expect(headerDesktopNav).toBeVisible();
    await expect(page.getByPlaceholder('Buscar por nombre, marca, modelo...')).toBeVisible();
    await expect(page.getByRole('button', { name: /Filtros/ })).toBeHidden();
    await expect(page.getByLabel('Modo de layout: Escritorio · forzado')).toBeVisible();

    // Vista Lista: la tabla aparece (no las tarjetas móviles) y el desborde
    // queda contenido: el header envuelve y la tabla scrollea hacia adentro.
    await page.getByRole('button', { name: 'Lista' }).click();
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('table').getByText('Impresora Láser')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Persiste al recargar.
    await page.reload();
    await expect(bottomNav).toBeHidden();
    await expect(headerDesktopNav).toBeVisible();

    // Volver a "Automático" restaura el layout móvil.
    await page.goto('/settings');
    await page.getByLabel('Modo de vista').selectOption('auto');
    await page.goto('/dashboard');
    await expect(bottomNav).toBeVisible();
    await expect(headerDesktopNav).toBeHidden();
  });
});

// -----------------------------------------------------------------------------
// Propuesta D: viewports intermedios — desbordes en las transiciones tablet.
// -----------------------------------------------------------------------------
test.describe('tablet 768px (md): transición tarjetas → tabla (Propuesta D)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('sin desbordes: nav móvil, filtros plegables, grid 2 col y tabla', async ({
    page,
  }) => {
    const email = randomEmail('tb7');
    await registerAndVerify(page.request, email);
    await login(page, email);

    for (const nombre of ['Tablet Lenovo', 'Teclado Mecánico']) {
      const res = await page.request.post(`${API_URL}/products`, {
        data: {
          nombre,
          tipo_compra: 'FISICO',
          precio: 149.9,
          moneda: 'USD',
          estado: 'USADO',
          fecha_compra: '2026-08-05',
        },
      });
      expect(res.ok(), `crear ${nombre} falló: ${res.status()}`).toBeTruthy();
    }

    const bottomNav = page.getByRole('navigation', { name: 'Navegación móvil' });
    const headerDesktopNav = page
      .locator('header')
      .getByRole('link', { name: 'Reportes' });

    await page.goto('/dashboard');
    await expectNoHorizontalOverflow(page);

    // Aún <lg: la navegación inferior es la visible y la cabecera superior no.
    await expect(bottomNav).toBeVisible();
    await expect(headerDesktopNav).toBeHidden();

    // Filtros plegables (como en móvil): al abrirlos no debe desbordar.
    const filtrosBtn = page.getByRole('button', { name: /Filtros/ });
    await expect(filtrosBtn).toBeVisible();
    const buscarInput = page.getByPlaceholder('Buscar por nombre, marca, modelo...');
    await expect(buscarInput).toBeHidden();
    await filtrosBtn.click();
    await expect(buscarInput).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Grid de tarjetas con 2 columnas (sm) en md.
    await expect.poll(() => gridColumns(page)).toBe(2);

    // Vista Lista: en ≥md la tabla aparece y las tarjetas móviles se ocultan.
    await page.getByRole('button', { name: 'Lista' }).click();
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('table').getByText('Tablet Lenovo')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Reportes desde la barra inferior, sin desborde. Espera a que el nav esté
    // estable (mismo anti-flake de arranque en frío que el test móvil).
    await waitForStableBottomNav(page);
    await bottomNav.getByRole('link', { name: 'Reportes' }).click();
    await expect(page).toHaveURL(/\/reports/);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('tablet 1024px (lg): transición a escritorio (Propuesta D)', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('sin desbordes: cabecera superior, filtros abiertos y grid 3 col', async ({
    page,
  }) => {
    const email = randomEmail('tb4');
    await registerAndVerify(page.request, email);
    await login(page, email);

    for (const nombre of ['Monitor LG', 'Webcam HD', 'Micrófono USB']) {
      const res = await page.request.post(`${API_URL}/products`, {
        data: {
          nombre,
          tipo_compra: 'ONLINE',
          precio: 89.5,
          moneda: 'USD',
          estado: 'NUEVO',
          fecha_compra: '2026-08-10',
        },
      });
      expect(res.ok(), `crear ${nombre} falló: ${res.status()}`).toBeTruthy();
    }

    const bottomNav = page.getByRole('navigation', { name: 'Navegación móvil' });
    const headerDesktopNav = page
      .locator('header')
      .getByRole('link', { name: 'Reportes' });

    await page.goto('/dashboard');
    await expectNoHorizontalOverflow(page);

    // En ≥lg el chrome salta a escritorio: cabecera superior visible,
    // barra inferior oculta y filtros SIEMPRE abiertos (sin botón "Filtros").
    await expect(bottomNav).toBeHidden();
    await expect(headerDesktopNav).toBeVisible();
    await expect(page.getByRole('button', { name: /Filtros/ })).toBeHidden();
    await expect(page.getByPlaceholder('Buscar por nombre, marca, modelo...')).toBeVisible();
    await expect(page.getByLabel('Modo de layout: Escritorio')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Grid de tarjetas con 3 columnas (lg).
    await expect.poll(() => gridColumns(page)).toBe(3);

    // Vista Lista: tabla con los productos, sin desborde.
    await page.getByRole('button', { name: 'Lista' }).click();
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('table').getByText('Monitor LG')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Reportes desde la cabecera superior, sin desborde.
    await headerDesktopNav.click();
    await expect(page).toHaveURL(/\/reports/);
    await expectNoHorizontalOverflow(page);
  });
});
