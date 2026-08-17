import type { JSX } from 'react';

import Link from 'next/link';

import type { Product } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/format';
import { WarrantyBadge } from './warranty-badge';
import { cn } from '@/lib/utils';

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps): JSX.Element {
  return (
    <Link
      href={`/products/${product.id}`}
      className="group block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition duration-150 ease-out hover:border-accent-400/50 hover:shadow-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-[var(--text)] transition group-hover:text-accent-300">
            {product.nombre}
          </h3>
          {product.marca && (
            <p className="mt-0.5 truncate text-sm text-[var(--text-secondary)]">
              {product.marca}
              {product.modelo && ` · ${product.modelo}`}
            </p>
          )}
        </div>
        <WarrantyBadge status={product.warranty_status} compact />
      </div>

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="t-label">Precio</dt>
          <dd className="t-num font-semibold text-[var(--text)]">
            {formatCurrency(product.precio, product.moneda)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="t-label">Comprado</dt>
          <dd className="t-num text-[var(--text-secondary)]">
            {formatDate(product.fecha_compra)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="t-label">Antigüedad</dt>
          <dd className="text-[var(--text-secondary)]">{product.tiempo_posesion}</dd>
        </div>
        {product.categoria && (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="t-label">Categoría</dt>
            <dd className="text-[var(--text-secondary)]">{product.categoria.nombre}</dd>
          </div>
        )}
      </dl>

      {product.attachments_count > 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 text-xs text-[var(--text-secondary)]">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          {product.attachments_count} adjunto{product.attachments_count === 1 ? '' : 's'}
        </p>
      )}
    </Link>
  );
}
