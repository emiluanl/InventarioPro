// =============================================================================
// Helper: cálculo del tiempo de posesión
// =============================================================================
// Dada una fecha de compra, devuelve un string formateado como:
//   "2 años, 3 meses, 10 días"
//   "11 meses"
//   "Recién adquirido"
//
// Se calcula en cada request (NO se guarda) porque siempre debe estar al día.
// =============================================================================

export interface OwnershipDuration {
  years: number;
  months: number;
  days: number;
  totalDays: number;
}

/**
 * Calcula la diferencia entre `from` y `to` (por defecto, ahora).
 * Si `from` es posterior a `to`, devuelve 0 en todo.
 */
export function calculateOwnershipDuration(from: Date, to: Date = new Date()): OwnershipDuration {
  if (from > to) {
    return { years: 0, months: 0, days: 0, totalDays: 0 };
  }

  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();

  if (days < 0) {
    months -= 1;
    const lastMonth = new Date(to.getFullYear(), to.getMonth(), 0);
    days += lastMonth.getDate();
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  // totalDays para ordenamiento o futuras estadísticas.
  const totalDays = Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

  return { years, months, days, totalDays };
}

/**
 * Formatea la duración como string legible en español.
 */
export function formatOwnership(duration: OwnershipDuration): string {
  const { years, months, days } = duration;
  const parts: string[] = [];

  if (years > 0) parts.push(`${years} ${years === 1 ? 'año' : 'años'}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? 'mes' : 'meses'}`);
  if (days > 0) parts.push(`${days} ${days === 1 ? 'día' : 'días'}`);

  if (parts.length === 0) return 'Recién adquirido';
  return parts.join(', ');
}

/**
 * Estado de la garantía en función de la fecha de vencimiento.
 * - null → sin garantía definida
 * - 'vigente' → vigente por más de 30 días
 * - 'por_vencer' → vence en los próximos 30 días
 * - 'vencida' → ya venció
 */
export type WarrantyStatus = 'vigente' | 'por_vencer' | 'vencida';

export function getWarrantyStatus(
  warrantyExpiresAt: Date | null | undefined,
  now: Date = new Date(),
): WarrantyStatus | null {
  if (!warrantyExpiresAt) return null;
  const diffMs = warrantyExpiresAt.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'vencida';
  if (diffDays <= 30) return 'por_vencer';
  return 'vigente';
}
