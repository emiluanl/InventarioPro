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
// fondo/borde/texto, legible en oscuro y claro.
const COLORS: Record<WarrantyStatus, string> = {
  vigente: 'bg-success/15 text-success border-success/30',
  por_vencer: 'bg-warning/15 text-warning border-warning/30',
  vencida: 'bg-error/15 text-error border-error/30',
};

export function WarrantyBadge({
  status,
  compact = false,
  daysUntilExpiry,
}: WarrantyBadgeProps): JSX.Element | null {
  if (!status) {
    return (
      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
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
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        COLORS[status],
      )}
    >
      {WARRANTY_LABELS[status]}{detail}
    </span>
  );
}
