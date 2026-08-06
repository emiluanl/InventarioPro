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
      className="group block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-accent-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-gray-900 group-hover:text-accent-700">
            {product.nombre}
          </h3>
          {product.marca && (
            <p className="mt-0.5 truncate text-sm text-gray-600">
              {product.marca}
              {product.modelo && ` · ${product.modelo}`}
            </p>
          )}
        </div>
        <WarrantyBadge status={product.warranty_status} compact />
      </div>

      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500">Precio</dt>
          <dd className="font-medium text-gray-900">
            {formatCurrency(product.precio, product.moneda)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Comprado</dt>
          <dd className="text-gray-700">{formatDate(product.fecha_compra)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Antigüedad</dt>
          <dd className="text-gray-700">{product.tiempo_posesion}</dd>
        </div>
        {product.categoria && (
          <div className="flex justify-between">
            <dt className="text-gray-500">Categoría</dt>
            <dd className="text-gray-700">{product.categoria.nombre}</dd>
          </div>
        )}
      </dl>

      {product.attachments_count > 0 && (
        <p className={cn(
          'mt-3 inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700',
        )}>
          � {product.attachments_count} adjunto{product.attachments_count === 1 ? '' : 's'}
        </p>
      )}
    </Link>
  );
}
