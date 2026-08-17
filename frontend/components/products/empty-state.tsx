import type { JSX } from 'react';

import Link from 'next/link';

export function EmptyState(): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-500/15 text-xl text-accent-300">
        📦
      </div>
      <h2 className="t-title mt-4 text-[var(--text)]">Tu inventario está vacío</h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
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
