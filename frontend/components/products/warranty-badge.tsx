import type { JSX } from 'react';

import type { WarrantyStatus } from '@/lib/types';
import { WARRANTY_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';

interface WarrantyBadgeProps {
  status: WarrantyStatus | null;
  compact?: boolean;
  daysUntilExpiry?: number | null;
}

// Variantes por token de estado (--tw-success/warning/error): mismo tono en
// fondo/borde/texto, legible en oscuro y claro. El icono (decorativo, el
// texto es el nombre accesible) acompaña al color: el estado no depende solo
// de este último.
const COLORS: Record<WarrantyStatus, string> = {
  vigente: 'bg-success/15 text-success border-success/30',
  por_vencer: 'bg-warning/15 text-warning border-warning/30',
  vencida: 'bg-error/15 text-error border-error/30',
};

/** Icono de estado (aria-hidden: el texto del badge ya es el nombre). */
function StatusIcon({ status }: { status: WarrantyStatus }): JSX.Element {
  if (status === 'vigente') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === 'por_vencer') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15.5 14" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function WarrantyBadge({
  status,
  compact = false,
  daysUntilExpiry,
}: WarrantyBadgeProps): JSX.Element | null {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Sin garantía
      </span>
    );
  }

  const detail =
    !compact && status === 'por_vencer' && daysUntilExpiry != null
      ? ` (${daysUntilExpiry} día${daysUntilExpiry === 1 ? '' : 's'})`
      : '';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        COLORS[status],
      )}
    >
      <StatusIcon status={status} />
      {WARRANTY_LABELS[status]}{detail}
    </span>
  );
}
