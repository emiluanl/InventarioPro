'use client';

import { use } from 'react';
import Link from 'next/link';

import { useProduct } from '@/hooks/use-products';
import { ProductForm } from '@/components/products/product-form';
import { Alert } from '@/components/ui/alert';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditProductPage({ params }: PageProps): JSX.Element {
  const { id } = use(params);
  const { data: product, isLoading, isError, error } = useProduct(id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="h-96 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
      </div>
    );
  }

  if (isError || !product) {
    return (
      <Alert variant="error">
        {error?.message ?? 'Producto no encontrado.'}{' '}
        <Link href="/dashboard" className="underline">
          Volver
        </Link>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">
        Editar: {product.nombre}
      </h1>
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <ProductForm mode="edit" initialProduct={product} />
      </div>
    </div>
  );
}
