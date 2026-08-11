import { parseTtlSeconds } from '../src/common/parse-ttl';

describe('parseTtlSeconds', () => {
  it('parsea duraciones con unidad', () => {
    expect(parseTtlSeconds('30s')).toBe(30);
    expect(parseTtlSeconds('15m')).toBe(15 * 60);
    expect(parseTtlSeconds('1h')).toBe(60 * 60);
    expect(parseTtlSeconds('7d')).toBe(7 * 24 * 60 * 60);
  });

  it('trata un número plano como segundos (semántica de jsonwebtoken)', () => {
    expect(parseTtlSeconds('900')).toBe(900);
    expect(parseTtlSeconds('3600')).toBe(3600);
  });

  it('usa el fallback para valores inválidos o ausentes', () => {
    expect(parseTtlSeconds(undefined)).toBe(15 * 60);
    expect(parseTtlSeconds('')).toBe(15 * 60);
    expect(parseTtlSeconds('quince minutos')).toBe(15 * 60);
    expect(parseTtlSeconds('-5m')).toBe(15 * 60);
  });

  it('respeta un fallback personalizado', () => {
    expect(parseTtlSeconds(undefined, 7 * 24 * 60 * 60)).toBe(7 * 24 * 60 * 60);
    expect(parseTtlSeconds('garbage', 42)).toBe(42);
  });
});
