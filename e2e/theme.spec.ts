// =============================================================================
// E2E del tema (oscuro predeterminado ↔ claro) — coherencia visual y acceso
// =============================================================================
// Verifica: 1) oscuro por defecto, 2) activar claro, 3) superficies cambian,
// 4) texto legible, 5) botones conservan estados visibles, 6) persistencia
// tras recargar, 7) sin scroll horizontal, 8) navegación por teclado.
// =============================================================================

import { expect, test } from '@playwright/test';

import { login, randomEmail, registerAndVerify } from './helpers';

test.describe('tema oscuro/claro', () => {
  test('coherencia del tema: oscuro por defecto, activar claro, persistencia y acceso', async ({
    page,
    request,
  }) => {
    const email = randomEmail('tema');
    await registerAndVerify(request, email);
    await login(page, email);

    // 1) Tema OSCURO por defecto (sin clase .light en <html>).
    await expect(page.locator('html')).not.toHaveClass(/light/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Mis productos' })).toBeVisible();

    // 7) Sin scroll horizontal (inicio).
    const noOverflow = (): Promise<boolean> =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
    expect(await noOverflow()).toBe(true);

    // 2) Activar el tema CLARO desde el badge de la cabecera.
    await page.getByLabel('Tema: Oscuro').click();
    await page.getByRole('menuitemradio', { name: /Claro/ }).click();
    await expect(page.locator('html')).toHaveClass(/light/);

    // 3) Las superficies principales cambian coherentemente (body y header).
    //    El fade del tema dura 400ms: esperar a que el color se estabilice
    //    antes de comparar (expect.poll evita leer a mitad de transición).
    const bodyBgLight = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );
    await page.getByLabel('Tema: Claro').click();
    await page.getByRole('menuitemradio', { name: /Oscuro/ }).click();
    await expect(page.locator('html')).not.toHaveClass(/light/);
    await expect
      .poll(async () =>
        page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      )
      .not.toBe(bodyBgLight);

    // Volver a claro para el resto de las comprobaciones.
    await page.getByLabel('Tema: Oscuro').click();
    await page.getByRole('menuitemradio', { name: /Claro/ }).click();
    await expect(page.locator('html')).toHaveClass(/light/);

    // 4) Texto legible: el título principal en claro es oscuro (contraste).
    await expect
      .poll(async () =>
        page
          .getByRole('heading', { name: 'Mis productos' })
          .evaluate((el) => {
            const [r, g, b] = getComputedStyle(el)
              .color.match(/\d+/g)!
              .map(Number);
            return r + g + b;
          }),
      )
      .toBeLessThan(240); // texto casi negro sobre fondo claro (tras el fade)

    // 5) Botones y controles conservan estados visibles (fondo del CTA).
    //    (El usuario de prueba no tiene productos: hay dos CTAs, usamos el del
    //    header con .first()).
    const cta = page.getByRole('link', { name: '+ Nuevo producto' }).first();
    const ctaBg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(ctaBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(await cta.isVisible()).toBe(true);

    // 7) Sin scroll horizontal en claro.
    expect(await noOverflow()).toBe(true);

    // 6) El tema persiste tras recargar (localStorage + clase en <html>).
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/light/);
    expect(
      await page.evaluate(() => window.localStorage.getItem('inventariopro:theme')),
    ).toBe('light');

    // 8) Navegación por teclado: el badge se enfoca, se abre con Enter y se
    //    cambia con flechas + Enter (patrón ARIA menú).
    await page.getByLabel('Tema: Claro').focus();
    await page.keyboard.press('Enter'); // abre el menú
    await expect(page.getByRole('menu', { name: /Cambiar tema/ })).toBeVisible();
    await page.keyboard.press('Tab'); // entra al menú: foco en la opción seleccionada (Claro)
    await page.keyboard.press('ArrowDown'); // → Sistema
    await page.keyboard.press('Enter'); // elige Sistema
    await expect(page.getByLabel('Tema: Sistema · Claro')).toBeVisible();
  });
});
