// =============================================================================
// Tests del helper time-ownership
// =============================================================================

import {
  calculateOwnershipDuration,
  formatOwnership,
  getWarrantyStatus,
} from '../src/common/lib/time-ownership';

describe('calculateOwnershipDuration', () => {
  it('devuelve 0 en todo si la fecha es futura', () => {
    const future = new Date('2099-01-01');
    const past = new Date('2000-01-01');
    const result = calculateOwnershipDuration(future, past);
    expect(result).toEqual({ years: 0, months: 0, days: 0, totalDays: 0 });
  });

  it('calcula años completos', () => {
    const from = new Date('2020-01-15');
    const to = new Date('2024-01-15');
    const result = calculateOwnershipDuration(from, to);
    expect(result.years).toBe(4);
    expect(result.months).toBe(0);
    expect(result.days).toBe(0);
  });

  it('calcula años y meses', () => {
    const from = new Date('2020-01-15');
    const to = new Date('2024-07-15');
    const result = calculateOwnershipDuration(from, to);
    expect(result.years).toBe(4);
    expect(result.months).toBe(6);
    expect(result.days).toBe(0);
  });

  it('calcula años, meses y días parciales', () => {
    const from = new Date('2020-01-15');
    const to = new Date('2022-04-25');
    const result = calculateOwnershipDuration(from, to);
    expect(result.years).toBe(2);
    expect(result.months).toBe(3);
    expect(result.days).toBe(10);
  });

  // Los @db.Date llegan a medianoche UTC (convención de products/csv.ts): el
  // cálculo usa componentes UTC para que la antigüedad no dependa de la zona
  // horaria del servidor (en UTC-3 un producto comprado hoy mostraba "1 día").
  it('muestra 0 días el mismo día (aunque sea tarde en el día UTC)', () => {
    const from = new Date('2026-08-15T00:00:00.000Z');
    const to = new Date('2026-08-15T23:59:00.000Z');
    const result = calculateOwnershipDuration(from, to);
    expect(result).toEqual({ years: 0, months: 0, days: 0, totalDays: 0 });
  });

  it('suma 1 día al rotar el día UTC', () => {
    const from = new Date('2026-08-15T00:00:00.000Z');
    const to = new Date('2026-08-16T00:00:00.000Z');
    const result = calculateOwnershipDuration(from, to);
    expect(result).toEqual({ years: 0, months: 0, days: 1, totalDays: 1 });
  });
});

describe('formatOwnership', () => {
  it('formatea con todas las partes', () => {
    expect(formatOwnership({ years: 2, months: 3, days: 10, totalDays: 0 })).toBe(
      '2 años, 3 meses, 10 días',
    );
  });

  it('singulariza correctamente', () => {
    expect(formatOwnership({ years: 1, months: 1, days: 1, totalDays: 0 })).toBe(
      '1 año, 1 mes, 1 día',
    );
  });

  it('omite partes con valor 0', () => {
    expect(formatOwnership({ years: 0, months: 5, days: 0, totalDays: 0 })).toBe('5 meses');
  });

  it('devuelve "Recién adquirido" para duraciones vacías', () => {
    expect(formatOwnership({ years: 0, months: 0, days: 0, totalDays: 0 })).toBe(
      'Recién adquirido',
    );
  });
});

describe('getWarrantyStatus', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  it('devuelve null si no hay fecha', () => {
    expect(getWarrantyStatus(null, now)).toBeNull();
    expect(getWarrantyStatus(undefined, now)).toBeNull();
  });

  it('marca como vencida si la fecha ya pasó', () => {
    expect(getWarrantyStatus(new Date('2024-01-01'), now)).toBe('vencida');
  });

  it('marca como por_vencer si vence en ≤30 días', () => {
    expect(getWarrantyStatus(new Date('2024-07-01'), now)).toBe('por_vencer');
    expect(getWarrantyStatus(new Date('2024-07-14'), now)).toBe('por_vencer');
  });

  it('marca como vigente si vence en más de 30 días', () => {
    expect(getWarrantyStatus(new Date('2024-09-01'), now)).toBe('vigente');
    expect(getWarrantyStatus(new Date('2025-01-01'), now)).toBe('vigente');
  });
});
