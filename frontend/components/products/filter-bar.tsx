'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, type JSX } from 'react';

import type { ProductsFilters, ProductStatus, PurchaseType, WarrantyStatus } from '@/lib/types';
import { PRODUCT_STATUS_LABELS, PURCHASE_TYPE_LABELS, WARRANTY_LABELS } from '@/lib/types';
import { useLayoutMode } from '@/lib/layout-mode';
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
  const { forcedMobile, forcedDesktop } = useLayoutMode();

  const [search, setSearch] = useState<string>(params?.get('search') ?? '');
  const [estado, setEstado] = useState<string>(params?.get('estado') ?? '');
  const [tipo, setTipo] = useState<string>(params?.get('tipo_compra') ?? '');
  const [warranty, setWarranty] = useState<string>(params?.get('warranty_status') ?? '');
  const [sortBy, setSortBy] = useState<string>(params?.get('sort_by') ?? 'fecha_compra');
  const [sortOrder, setSortOrder] = useState<string>(params?.get('sort_order') ?? 'desc');
  // En móvil los filtros vienen plegados (el botón "Filtros" los despliega);
  // en escritorio (lg) el panel siempre está visible.
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);

  // Cuántos filtros hay activos (sin contar orden/paginación): para el badge
  // del botón "Filtros" en móvil.
  const activeFilterCount = [estado, tipo, warranty].filter(Boolean).length + (search.trim() ? 1 : 0);

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
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-100 p-4">
      {/* Botón que despliega/pliega los filtros: solo en móvil (<lg) o con el
          modo móvil forzado. Con el modo escritorio forzado no aparece (los
          filtros quedan siempre visibles, como en pantalla grande). */}
      <div
        className={cn(
          'flex items-center justify-between',
          forcedMobile ? '' : forcedDesktop ? 'hidden' : 'lg:hidden',
        )}
      >
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          // min-h-11: touch target ≥ 44px en móvil (Apple HIG).
          className="flex min-h-11 items-center gap-2 rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-200"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className={cn('transition-transform', filtersOpen && 'rotate-180')}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          Filtros
          {activeFilterCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-600 px-1.5 text-xs font-semibold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <div
        className={cn(
          'grid gap-3 sm:grid-cols-2 lg:grid-cols-5',
          forcedDesktop
            ? 'grid'
            : forcedMobile
              ? filtersOpen
                ? 'grid'
                : 'hidden'
              : filtersOpen
                ? 'grid'
                : 'hidden lg:grid',
        )}
      >
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
            'rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm',
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
            'rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm',
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
            'rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm',
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
        {/* flex-wrap: en móvil "Ordenar por" + selects + Limpiar se parten en
            varias líneas en vez de desbordar el ancho del teléfono. */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-700">Ordenar por</span>
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value);
              applyFilters();
            }}
            className="rounded-md border border-gray-300 bg-gray-100 px-2 py-1 text-sm"
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
            className="rounded-md border border-gray-300 bg-gray-100 px-2 py-1 text-sm"
          >
            <option value="desc">Descendente</option>
            <option value="asc">Ascendente</option>
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            // min-h-11: touch target ≥ 44px en móvil (Apple HIG).
            className="min-h-11"
          >
            Limpiar
          </Button>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-gray-300 bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => onViewChange('grid')}
            aria-pressed={view === 'grid'}
            className={cn(
              // min-h-11 min-w-11: touch targets ≥ 44px en móvil (Apple HIG).
              'min-h-11 min-w-11 rounded px-2 py-1 text-xs',
              view === 'grid' ? 'bg-accent-500/20 text-accent-300' : 'text-gray-700 hover:bg-gray-100',
            )}
          >
            Tarjetas
          </button>
          <button
            type="button"
            onClick={() => onViewChange('list')}
            aria-pressed={view === 'list'}
            className={cn(
              // min-h-11 min-w-11: touch targets ≥ 44px en móvil (Apple HIG).
              'min-h-11 min-w-11 rounded px-2 py-1 text-xs',
              view === 'list' ? 'bg-accent-500/20 text-accent-300' : 'text-gray-700 hover:bg-gray-100',
            )}
          >
            Lista
          </button>
        </div>
      </div>
    </div>
  );
}
