'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, type JSX } from 'react';

import type { ProductsFilters, ProductStatus, PurchaseType, WarrantyStatus } from '@/lib/types';
import { PRODUCT_STATUS_LABELS, PURCHASE_TYPE_LABELS, WARRANTY_LABELS } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ESTADOS: ProductStatus[] = [
  'NUEVO',
  'USADO',
  'EN_REPARACION',
  'VENDIDO',
  'PERDIDO_ROBADO',
  'DADO_DE_BAJA',
];

const TIPOS: PurchaseType[] = ['FISICO', 'ONLINE'];
const WARRANTY: WarrantyStatus[] = ['vigente', 'por_vencer', 'vencida'];

interface FilterBarProps {
  view: 'grid' | 'list';
  onViewChange: (view: 'grid' | 'list') => void;
}

export function FilterBar({ view, onViewChange }: FilterBarProps): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();

  const [search, setSearch] = useState<string>(params?.get('search') ?? '');
  const [estado, setEstado] = useState<string>(params?.get('estado') ?? '');
  const [tipo, setTipo] = useState<string>(params?.get('tipo_compra') ?? '');
  const [warranty, setWarranty] = useState<string>(params?.get('warranty_status') ?? '');
  const [sortBy, setSortBy] = useState<string>(params?.get('sort_by') ?? 'fecha_compra');
  const [sortOrder, setSortOrder] = useState<string>(params?.get('sort_order') ?? 'desc');

  const applyFilters = useCallback(
    (overrides: Partial<ProductsFilters> = {}) => {
      const next = new URLSearchParams(params?.toString());
      const merged: ProductsFilters = {
        search,
        estado: (estado as ProductStatus) || undefined,
        tipo_compra: (tipo as PurchaseType) || undefined,
        warranty_status: (warranty as WarrantyStatus) || undefined,
        sort_by: sortBy as ProductsFilters['sort_by'],
        sort_order: sortOrder as ProductsFilters['sort_order'],
        page: 1,
        ...overrides,
      };
      Object.entries(merged).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          next.set(k, String(v));
        } else {
          next.delete(k);
        }
      });
      router.replace(`/dashboard?${next.toString()}`);
    },
    [params, search, estado, tipo, warranty, sortBy, sortOrder, router],
  );

  // Debounce del search input
  useEffect(() => {
    const t = setTimeout(() => applyFilters(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const reset = (): void => {
    setSearch('');
    setEstado('');
    setTipo('');
    setWarranty('');
    setSortBy('fecha_compra');
    setSortOrder('desc');
    router.replace('/dashboard');
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Input
            placeholder="Buscar por nombre, marca, modelo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value);
            applyFilters();
          }}
          className={cn(
            'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm',
            'focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500',
          )}
        >
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>{PRODUCT_STATUS_LABELS[e]}</option>
          ))}
        </select>
        <select
          value={tipo}
          onChange={(e) => {
            setTipo(e.target.value);
            applyFilters();
          }}
          className={cn(
            'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm',
            'focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500',
          )}
        >
          <option value="">Compra física u online</option>
          {TIPOS.map((t) => (
            <option key={t} value={t}>{PURCHASE_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <select
          value={warranty}
          onChange={(e) => {
            setWarranty(e.target.value);
            applyFilters();
          }}
          className={cn(
            'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm',
            'focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500',
          )}
        >
          <option value="">Cualquier garantía</option>
          {WARRANTY.map((w) => (
            <option key={w} value={w}>{WARRANTY_LABELS[w]}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Ordenar por</span>
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value);
              applyFilters();
            }}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
          >
            <option value="fecha_compra">Fecha de compra</option>
            <option value="nombre">Nombre</option>
            <option value="precio">Precio</option>
            <option value="tiempo_posesion">Tiempo de posesión</option>
            <option value="created_at">Fecha de registro</option>
          </select>
          <select
            value={sortOrder}
            onChange={(e) => {
              setSortOrder(e.target.value);
              applyFilters();
            }}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
          >
            <option value="desc">Descendente</option>
            <option value="asc">Ascendente</option>
          </select>
          <Button variant="ghost" size="sm" onClick={reset}>
            Limpiar
          </Button>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-gray-300 bg-white p-1">
          <button
            type="button"
            onClick={() => onViewChange('grid')}
            aria-pressed={view === 'grid'}
            className={cn(
              'rounded px-2 py-1 text-xs',
              view === 'grid' ? 'bg-accent-100 text-accent-800' : 'text-gray-600 hover:bg-gray-100',
            )}
          >
            Tarjetas
          </button>
          <button
            type="button"
            onClick={() => onViewChange('list')}
            aria-pressed={view === 'list'}
            className={cn(
              'rounded px-2 py-1 text-xs',
              view === 'list' ? 'bg-accent-100 text-accent-800' : 'text-gray-600 hover:bg-gray-100',
            )}
          >
            Lista
          </button>
        </div>
      </div>
    </div>
  );
}
