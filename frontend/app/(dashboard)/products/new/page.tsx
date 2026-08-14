import type { JSX } from 'react';

import { ProductForm } from '@/components/products/product-form';

export default function NewProductPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Nuevo producto</h1>
      <div className="rounded-lg border border-gray-200 bg-gray-100 p-6 shadow-sm">
        <ProductForm mode="create" />
      </div>
    </div>
  );
}
