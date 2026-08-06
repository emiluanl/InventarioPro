import type { WarrantyStatus } from '@/lib/types';
import { WARRANTY_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';

interface WarrantyBadgeProps {
  status: WarrantyStatus | null;
  compact?: boolean;
  daysUntilExpiry?: number | null;
}

const COLORS: Record<WarrantyStatus, string> = {
  vigente: 'bg-green-100 text-green-800 border-green-200',
  por_vencer: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  vencida: 'bg-red-100 text-red-800 border-red-200',
};

export function WarrantyBadge({
  status,
  compact = false,
  daysUntilExpiry,
}: WarrantyBadgeProps): JSX.Element | null {
  if (!status) {
    return (
      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
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
