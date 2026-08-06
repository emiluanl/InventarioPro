'use client';

import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useProduct, useDeleteProduct } from '@/hooks/use-products';
import { WarrantyBadge } from '@/components/products/warranty-badge';
import { ProductImages } from '@/components/products/product-images';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { formatCurrency, formatDate } from '@/lib/format';
import { PRODUCT_STATUS_LABELS } from '@/lib/types';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ProductDetailPage({ params }: PageProps): JSX.Element {
  const { id } = use(params);
  const router = useRouter();
  const { data: product, isLoading, isError, error } = useProduct(id);
  const deleteProduct = useDeleteProduct();

  const handleDelete = (): void => {
    if (!confirm('¿Eliminar este producto? Podrás recuperarlo contactando al soporte.')) {
      return;
    }
    deleteProduct.mutate(id, {
      onSuccess: () => router.replace('/dashboard'),
    });
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="h-64 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
      </div>
    );
  }

  if (isError || !product) {
    return (
      <Alert variant="error">
        {error?.message ?? 'Producto no encontrado.'}{' '}
        <Link href="/dashboard" className="underline">
          Volver al dashboard
        </Link>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-accent-600 hover:text-accent-700"
          >
            ← Mis productos
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">{product.nombre}</h1>
          {product.marca && (
            <p className="mt-1 text-gray-600">
              {product.marca}
              {product.modelo && ` · ${product.modelo}`}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/products/${product.id}/edit`}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Editar
          </Link>
          <Button variant="danger" size="sm" onClick={handleDelete} isLoading={deleteProduct.isPending}>
            Eliminar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Tiempo de posesión" value={product.tiempo_posesion} />
        <Stat
          label="Garantía"
          value={
            <WarrantyBadge
              status={product.warranty_status}
              daysUntilExpiry={product.days_until_warranty_expires}
            />
          }
        />
        <Stat label="Precio" value={formatCurrency(product.precio, product.moneda)} />
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-medium uppercase text-gray-500">Detalles</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <Row label="Categoría" value={product.categoria?.nombre ?? '—'} />
          <Row label="Estado" value={PRODUCT_STATUS_LABELS[product.estado]} />
          <Row label="Fecha de compra" value={formatDate(product.fecha_compra)} />
          <Row label="Tipo de compra" value={product.tipo_compra} />
          <Row label="Lugar de compra" value={product.lugar_compra ?? '—'} />
          <Row label="Método de pago" value={product.metodo_pago ?? '—'} />
          <Row label="Número de serie" value={product.numero_serie ?? '—'} />
          <Row label="Vence garantía" value={formatDate(product.fecha_vencimiento_garantia)} />
          {product.tags && <Row label="Etiquetas" value={product.tags} />}
          {product.descripcion && (
            <Row label="Descripción" value={product.descripcion} fullWidth />
          )}
          {product.notas && <Row label="Notas" value={product.notas} fullWidth />}
        </dl>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-medium uppercase text-gray-500">
          Adjuntos ({product.attachments?.length ?? 0})
        </h2>
        <ProductImages productId={product.id} attachments={product.attachments ?? []} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <div className="mt-1 text-base font-medium text-gray-900">{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: React.ReactNode;
  fullWidth?: boolean;
}): JSX.Element {
  return (
    <div className={fullWidth ? 'sm:col-span-2' : ''}>
      <dt className="text-xs uppercase text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value}</dd>
    </div>
  );
}
