'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';

import { useSpendingReport } from '@/hooks/use-reports';
import type { SpendingCategory, SpendingMonth } from '@/lib/report-types';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

const CURRENT_YEAR = new Date().getFullYear();

export default function ReportsPage(): JSX.Element {
  const [year, setYear] = useState<number | null>(CURRENT_YEAR);
  const { data, isLoading, isError, error } = useSpendingReport(year);

  // Opciones del selector: año actual + años con compras (data.years es
  // estable: la lista de años no depende del filtro).
  const yearOptions = Array.from(
    new Set([CURRENT_YEAR, ...(data?.years ?? [])]),
  ).sort((a, b) => b - a);

  const isEmpty = !isLoading && data && data.total === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Reportes de gasto</h1>
          <p className="mt-1 text-sm text-gray-600">
            ¿Cuánto gastaste en cada categoría? Respuesta con datos reales de tu inventario.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <span>Año</span>
          <select
            value={year === null ? 'all' : String(year)}
            onChange={(e) => setYear(e.target.value === 'all' ? null : Number(e.target.value))}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
          >
            <option value="all">Todos los años</option>
            {yearOptions.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </header>

      {isLoading && <ReportsSkeleton />}

      {isError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error.message}
        </div>
      )}

      {isEmpty && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-100 text-xl text-accent-700">
            💸
          </div>
          <h2 className="mt-4 text-lg font-medium text-gray-900">Sin gastos en este periodo</h2>
          <p className="mt-1 text-sm text-gray-600">
            Registra productos para empezar a ver tu historial de gasto.
          </p>
          <Link
            href="/products/new"
            className="mt-6 inline-flex items-center justify-center rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700"
          >
            + Nuevo producto
          </Link>
        </div>
      )}

      {data && data.total > 0 && (
        <>
          {/* Resumen */}
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard
              label={year === null ? 'Gasto total' : `Gasto en ${year}`}
              value={formatCurrency(data.total.toFixed(2), data.currency)}
            />
            <SummaryCard label="Compras" value={String(data.cantidad)} />
            <SummaryCard label="Categorías" value={String(data.by_category.length)} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Por categoría */}
            <section className="rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-900">Por categoría</h2>
              <CategoryBreakdown categories={data.by_category} currency={data.currency} total={data.total} />
            </section>

            {/* Por mes */}
            <section className="rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-900">Por mes</h2>
              <MonthChart months={data.by_month} currency={data.currency} />
            </section>
          </div>

          {/* Por moneda (solo si hay más de una) */}
          {data.by_currency.length > 1 && (
            <section className="rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-900">Por moneda</h2>
              <ul className="mt-3 space-y-1 text-sm">
                {data.by_currency.map((c) => (
                  <li key={c.moneda} className="flex items-center justify-between">
                    <span className="text-gray-700">{c.moneda}</span>
                    <span className="font-medium text-gray-900">
                      {formatCurrency(c.total.toFixed(2), c.moneda)}
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        {c.cantidad} compra{c.cantidad === 1 ? '' : 's'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function CategoryBreakdown({
  categories,
  currency,
  total,
}: {
  categories: SpendingCategory[];
  currency: string;
  total: number;
}): JSX.Element {
  return (
    <ul className="mt-4 space-y-3">
      {categories.map((c) => {
        const share = total > 0 ? (c.total / total) * 100 : 0;
        return (
          <li key={c.categoria_id ?? 'sin-categoria'}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-800">{c.nombre}</span>
              <span className="text-gray-600">
                {formatCurrency(c.total.toFixed(2), currency)}
                <span className="ml-2 text-xs text-gray-400">
                  {c.cantidad} {c.cantidad === 1 ? 'compra' : 'compras'}
                </span>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-accent-600"
                style={{ width: `${share}%` }}
                role="img"
                aria-label={`${c.nombre}: ${share.toFixed(0)}% del gasto`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MonthChart({
  months,
  currency,
}: {
  months: SpendingMonth[];
  currency: string;
}): JSX.Element {
  const max = Math.max(...months.map((m) => m.total), 1);
  return (
    <div className="mt-4 flex h-40 items-end gap-1.5">
      {months.map((m) => {
        const height = max > 0 ? (m.total / max) * 100 : 0;
        return (
          <div key={m.mes} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] text-gray-500" title={formatCurrency(m.total.toFixed(2), currency)}>
              {m.total > 0 ? formatCurrency(m.total.toFixed(2), currency).replace(/[,.]\d{2}.*/, '') : ''}
            </span>
            <div
              className={cn(
                'w-full rounded-t',
                m.total > 0 ? 'bg-accent-600' : 'bg-gray-100',
              )}
              style={{ height: `${height}%` }}
              role="img"
              aria-label={`${m.label}: ${formatCurrency(m.total.toFixed(2), currency)}`}
            />
            <span className="text-[10px] text-gray-400">{m.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ReportsSkeleton(): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-lg bg-gray-100" />
        <div className="h-64 animate-pulse rounded-lg bg-gray-100" />
      </div>
    </div>
  );
}
