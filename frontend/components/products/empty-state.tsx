import type { JSX } from 'react';

import Link from 'next/link';

export function EmptyState(): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center text-xl">
        📦
      </div>
      <h2 className="mt-4 text-lg font-medium text-gray-900">Tu inventario está vacío</h2>
      <p className="mt-1 text-sm text-gray-600">
        Empieza registrando tu primer producto.
      </p>
      <Link
        href="/products/new"
        className="mt-6 inline-flex items-center justify-center rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700"
      >
        + Nuevo producto
      </Link>
    </div>
  );
}
