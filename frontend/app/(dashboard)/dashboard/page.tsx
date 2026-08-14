'use client';

import { Suspense, useState, useMemo, type JSX } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useProducts, useDeleteProduct } from '@/hooks/use-products';
import { ProductCard } from '@/components/products/product-card';
import { FilterBar } from '@/components/products/filter-bar';
import { EmptyState } from '@/components/products/empty-state';
import { CsvActions } from '@/components/products/csv-actions';
import { Skeleton } from '@/components/ui/skeleton';
import type { Product, ProductsFilters } from '@/lib/types';
import { PRODUCT_STATUS_LABELS } from '@/lib/types';
import { formatCurrency } from '@/lib/format';

function DashboardInner(): JSX.Element {
  const params = useSearchParams();
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const filters: ProductsFilters = useMemo(
    () => ({
      page: Number(params?.get('page') ?? '1'),
      per_page: Number(params?.get('per_page') ?? '20'),
      search: params?.get('search') ?? undefined,
      categoria_id: params?.get('categoria_id') ?? undefined,
      estado: (params?.get('estado') as ProductsFilters['estado']) ?? undefined,
      tipo_compra:
        (params?.get('tipo_compra') as ProductsFilters['tipo_compra']) ?? undefined,
      warranty_status:
        (params?.get('warranty_status') as ProductsFilters['warranty_status']) ??
        undefined,
      fecha_desde: params?.get('fecha_desde') ?? undefined,
      fecha_hasta: params?.get('fecha_hasta') ?? undefined,
      sort_by:
        (params?.get('sort_by') as ProductsFilters['sort_by']) ?? 'fecha_compra',
      sort_order:
        (params?.get('sort_order') as ProductsFilters['sort_order']) ?? 'desc',
    }),
    [params],
  );

  const { data, isLoading, isError, error } = useProducts(filters);
  const deleteProduct = useDeleteProduct();

  const totalValue = useMemo(() => {
    if (!data?.items) return 0;
    return data.items.reduce((acc, p) => acc + Number(p.precio), 0);
  }, [data]);

  const handleDelete = (id: string): void => {
    if (confirm('¿Eliminar este producto?')) {
      deleteProduct.mutate(id);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Mis productos</h1>
          {data && data.items.length > 0 && (
            <p className="text-sm text-gray-700">
              {data.pagination.total} producto{data.pagination.total === 1 ? '' : 's'} ·{' '}
              <span className="font-medium">
                {formatCurrency(totalValue.toFixed(2), 'USD')}
              </span>{' '}
              en total
            </p>
          )}
        </div>
        <div className="flex items-center justify-end">
          <CsvActions />
        </div>
      </header>

      <FilterBar view={view} onViewChange={setView} />

      {isLoading && <DashboardSkeleton view={view} />}

      {isError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {data && data.items.length === 0 && <EmptyState />}

      {data && data.items.length > 0 && (
        <>
          {view === 'grid' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <ProductsTable products={data.items} onDelete={handleDelete} />
          )}

          <Pagination pagination={data.pagination} />
        </>
      )}
    </div>
  );
}

function ProductsTable({
  products,
  onDelete,
}: {
  products: Product[];
  onDelete: (id: string) => void;
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-100">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-600">
          <tr>
            <th className="px-4 py-2">Producto</th>
            <th className="px-4 py-2">Categoría</th>
            <th className="px-4 py-2">Precio</th>
            <th className="px-4 py-2">Antigüedad</th>
            <th className="px-4 py-2">Estado</th>
            <th className="px-4 py-2 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-sm">
          {products.map((p) => (
            <tr key={p.id} className="hover:bg-gray-200">
              <td className="px-4 py-2">
                <Link
                  href={`/products/${p.id}`}
                  className="font-medium text-gray-900 hover:text-accent-300"
                >
                  {p.nombre}
                </Link>
                {p.marca && <p className="text-xs text-gray-600">{p.marca}</p>}
              </td>
              <td className="px-4 py-2 text-gray-800">{p.categoria?.nombre ?? '—'}</td>
              <td className="px-4 py-2 font-medium text-gray-900">
                {formatCurrency(p.precio, p.moneda)}
              </td>
              <td className="px-4 py-2 text-gray-800">{p.tiempo_posesion}</td>
              <td className="px-4 py-2 text-gray-800">{PRODUCT_STATUS_LABELS[p.estado]}</td>
              <td className="px-4 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onDelete(p.id)}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Borrar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({
  pagination,
}: {
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}): JSX.Element | null {
  const router = useRouter();
  const params = useSearchParams();

  function go(page: number): void {
    const next = new URLSearchParams(params?.toString());
    next.set('page', String(page));
    router.replace(`/dashboard?${next.toString()}`);
  }

  if (pagination.total_pages <= 1) return null;

  const pages: Array<number | '…'> = [];
  const last = pagination.total_pages;
  const current = pagination.page;

  pages.push(1);
  for (let i = Math.max(2, current - 1); i <= Math.min(last - 1, current + 1); i++) {
    pages.push(i);
  }
  if (last > 1) pages.push(last);

  return (
    <nav className="flex items-center justify-center gap-1">
      <button
        type="button"
        onClick={() => go(Math.max(1, current - 1))}
        disabled={current === 1}
        className="rounded-md border border-gray-300 bg-gray-100 px-3 py-1 text-sm disabled:opacity-50"
      >
        ← Anterior
      </button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`dots-${i}`} className="px-2 text-gray-500">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => go(p)}
            className={`rounded-md px-3 py-1 text-sm ${
              p === current
                ? 'bg-accent-600 text-white'
                : 'border border-gray-300 bg-gray-100 hover:bg-gray-200'
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => go(Math.min(last, current + 1))}
        disabled={current === last}
        className="rounded-md border border-gray-300 bg-gray-100 px-3 py-1 text-sm disabled:opacity-50"
      >
        Siguiente →
      </button>
    </nav>
  );
}

function DashboardSkeleton({ view }: { view: 'grid' | 'list' }): JSX.Element {
  if (view === 'grid') {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }
  return <Skeleton className="h-64" />;
}

export default function DashboardPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}
