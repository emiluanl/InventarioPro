// =============================================================================
// Contraste WCAG de los tokens de tema (regresión del ajuste P2)
// =============================================================================
// Lee los valores reales de globals.css (fuente de verdad) y verifica que los
// tokens de acento y de estado cumplan WCAG AA (≥4.5:1 para texto normal):
//   - tema CLARO: contra el fondo blanco (#ffffff) — enlaces accent-400 y
//     badges success/warning/error (F1/F2 de la revisión pre-release).
//   - tema OSCURO: contra el fondo de marca (#0a0a0b) — que el ajuste no haya
//     degradado la identidad oscura.
// Si alguien aclara un token en globals.css por debajo de AA, este test falla.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const GLOBALS_CSS = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

const DARK_BG = '#0a0a0b';
const LIGHT_BG = '#ffffff';

/** Luminancia relativa WCAG de un color hex (#rrggbb). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Extrae las variables --tw-* de un bloque CSS (':root' o '.light'). */
function blockTokens(block: ':root' | '.light'): Record<string, string> {
  // Busca el SELECTOR (no la palabra dentro de comentarios): ':root {' o '.light {'.
  const re = block === ':root' ? /(^|\n)\s*:root\s*\{/ : /(^|\n)\s*\.light\s*\{/;
  const m = re.exec(GLOBALS_CSS);
  expect(m, `no se encontró el bloque ${block} en globals.css`).toBeTruthy();
  const start = m!.index + m![0].length;
  const end = GLOBALS_CSS.indexOf('}', start);
  const body = GLOBALS_CSS.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const vm = /^\s*--([\w-]+):\s*([\d\s.]+);/.exec(line);
    if (vm) tokens[vm[1]] = vm[2].trim();
  }
  return tokens;
}

function tokenToHex(token: string): string {
  const [r, g, b] = token.split(/\s+/).slice(0, 3).map(Number);
  const hex = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

describe('contraste WCAG de tokens de tema (globals.css)', () => {
  const dark = blockTokens(':root');
  const light = blockTokens('.light');

  const required: Array<[string, string]> = [
    // token, descripción
    ['tw-accent-400', 'enlaces/texto de acento'],
    ['tw-accent-300', 'hover de enlaces'],
    ['tw-success', 'badge/alert éxito'],
    ['tw-warning', 'badge/alert advertencia'],
    ['tw-error', 'badge/alert error'],
  ];

  it('los tokens del tema claro cumplen AA (≥4.5:1) sobre blanco', () => {
    for (const [token, label] of required) {
      const value = light[token];
      expect(value, `falta --${token} en el bloque .light`).toBeDefined();
      const ratio = contrast(tokenToHex(value), LIGHT_BG);
      expect(ratio, `--${token} (${label}) en claro: ${ratio.toFixed(2)}:1 < 4.5:1`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('los tokens del tema oscuro cumplen AA (≥4.5:1) sobre el fondo de marca', () => {
    for (const [token, label] of required) {
      const value = dark[token];
      expect(value, `falta --${token} en :root`).toBeDefined();
      const ratio = contrast(tokenToHex(value), DARK_BG);
      expect(ratio, `--${token} (${label}) en oscuro: ${ratio.toFixed(2)}:1 < 4.5:1`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('el hover de enlaces en claro se oscurece respecto del estado base', () => {
    // El hover (accent-300) debe tener más contraste que el base (accent-400):
    // el estado se percibe por luminosidad, no solo por el anillo de foco.
    const base = contrast(tokenToHex(light['tw-accent-400']), LIGHT_BG);
    const hover = contrast(tokenToHex(light['tw-accent-300']), LIGHT_BG);
    expect(hover).toBeGreaterThan(base);
  });
});
