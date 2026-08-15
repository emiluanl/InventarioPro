// =============================================================================
// lib/format.ts - utilidades de formateo
// =============================================================================

export function formatCurrency(value: string | number, currency: string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return `${value} ${currency}`;
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency}`;
  }
}

function formatDateIn(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

/**
 * Formatea una fecha de PRODUCTO (fecha_compra, fecha_vencimiento_garantia).
 *
 * El backend guarda estos @db.Date a medianoche UTC (convención documentada en
 * backend/src/products/csv.ts y parseDate). Se formatean en UTC para que el día
 * mostrado sea exactamente el ingresado, sin desplazarse según la zona horaria
 * del usuario (p. ej. en UTC-3 "2026-08-15" se mostraba como "14 ago 2026").
 */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDateIn(iso, 'UTC');
}

/**
 * Convierte el ISO que devuelve la API ("2026-08-15T00:00:00.000Z") al formato
 * "YYYY-MM-DD" que espera un <input type="date">, usando los componentes UTC
 * (misma convención que formatDate). Devuelve '' si no hay fecha válida.
 */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} día${days === 1 ? '' : 's'}`;
  // Timestamps reales (created_at de notificaciones): se muestran en hora local.
  return formatDateIn(iso);
}
