// =============================================================================
// e2e: touch targets y desborde en dispositivos móviles REALES (emulación).
// =============================================================================
// Los tests de layout usan Desktop Chrome a 375×667 sin emulación de teléfono.
// Este spec emula iPhone 13 (390×844, dpr 3, touch) y Pixel 7 (412×915,
// dpr 2.625, touch) y verifica dos cosas que esa simulación no cubre:
//   1. Touch targets ≥ 44px (Apple HIG) en el header, la barra inferior y el
//      dashboard (los botones icon-only del header eran de ~32px).
//   2. Cero desborde horizontal en el dashboard (lista y filtros abiertos).
// =============================================================================

import { devices, expect, test } from '@playwright/test';

import { login, randomEmail, registerAndVerify } from './helpers';

const DEVICES = [
  { name: 'iPhone 13', desc: devices['iPhone 13'] },
  { name: 'Pixel 7', desc: devices['Pixel 7'] },
] as const;

for (const device of DEVICES) {
  test.describe(`layout móvil en ${device.name} (emulación real)`, () => {
    test('touch targets ≥ 44px y sin desborde en el dashboard', async ({
      browser,
    }) => {
      const ctx = await browser.newContext({ ...device.desc });
      const page = await ctx.newPage();

      try {
        const email = randomEmail('ttp');
        await registerAndVerify(page.request, email);
        await login(page, email);
        await page.request.post('http://localhost:3002/api/products', {
          data: {
            nombre: 'Producto Táctil',
            tipo_compra: 'FISICO',
            precio: 10,
            moneda: 'USD',
            estado: 'NUEVO',
            fecha_compra: '2026-08-10',
          },
        });
        await page.goto('/dashboard');
        await expect(page.locator('main')).toBeVisible();

        // 1) Sin desborde horizontal.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);

        // 2) Touch targets ≥ 44px en los controles clave del móvil: header
        //    (badges, campana, salir), barra inferior, FAB del chat, botones
        //    de Exportar/Importar CSV y controles del panel de filtros
        //    (Filtros, Limpiar, Tarjetas, Lista). Los 0×0 son los de la
        //    cabecera oculta.
        const sizes = await page.evaluate(() => {
          const targets = [
            ...document.querySelectorAll(
              'header button, nav a, [aria-label="Abrir chat con asistente"]',
            ),
            ...[...document.querySelectorAll('main button')].filter((el) =>
              /CSV|Filtros|Limpiar|Tarjetas|Lista/i.test(el.textContent || ''),
            ),
          ];
          return targets.map((el) => {
            const r = el.getBoundingClientRect();
            const label = el.getAttribute('aria-label') || el.textContent || '';
            return {
              label: label.trim().slice(0, 24),
              h: Math.round(r.height),
              w: Math.round(r.width),
              visible: r.width > 0 && r.height > 0,
            };
          });
        });
        const under = sizes.filter((s) => s.visible && (s.h < 44 || s.w < 44));
        console.log(`TOUCH-UNDER-44-${device.name}:`, JSON.stringify(under));
        expect(under).toEqual([]);

        // 3) Filtros abiertos: sin desborde tampoco.
        const filtrosBtn = page.getByRole('button', { name: /Filtros/ });
        if (await filtrosBtn.isVisible()) {
          await filtrosBtn.click();
          const overflowFilters = await page.evaluate(
            () =>
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflowFilters).toBeLessThanOrEqual(1);
        }
      } finally {
        await ctx.close();
      }
    });
  });
}
