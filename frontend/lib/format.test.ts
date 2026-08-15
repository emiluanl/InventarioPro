// =============================================================================
// Tests de lib/format.ts — fechas de producto en UTC
// =============================================================================

import { describe, expect, it } from 'vitest';
import { formatDate, formatRelativeTime, toDateInputValue } from './format';

describe('formatDate', () => {
  // El backend guarda los @db.Date a medianoche UTC ("2026-08-15T00:00:00.000Z").
  // formatDate debe mostrar el día ingresado tal cual, sin desplazarlo por la
  // zona horaria del usuario (el bug mostraba "14 ago 2026" en UTC-3).
  it('muestra la fecha en UTC sin desplazar el día', () => {
    expect(formatDate('2026-08-15T00:00:00.000Z')).toBe('15 ago 2026');
    expect(formatDate('2024-01-15T00:00:00.000Z')).toBe('15 ene 2024');
    expect(formatDate('2028-08-15T00:00:00.000Z')).toBe('15 ago 2028');
  });

  it('devuelve "—" para valores nulos y el texto original si es inválido', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('no-es-una-fecha')).toBe('no-es-una-fecha');
  });
});

describe('toDateInputValue', () => {
  it('extrae YYYY-MM-DD en UTC para los <input type="date">', () => {
    expect(toDateInputValue('2026-08-15T00:00:00.000Z')).toBe('2026-08-15');
    expect(toDateInputValue('2024-01-15T00:00:00.000Z')).toBe('2024-01-15');
  });

  it('devuelve cadena vacía para nulos o fechas inválidas', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue(undefined)).toBe('');
    expect(toDateInputValue('')).toBe('');
    expect(toDateInputValue('basura')).toBe('');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('formatea hace días para menos de 30 días', () => {
    const iso = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(iso, now)).toBe('hace 3 días');
  });

  it('usa formato de fecha local (timestamps reales) para más de 30 días', () => {
    const out = formatRelativeTime('2024-01-15T00:00:00.000Z', now);
    expect(out).toMatch(/2024/);
  });
});
