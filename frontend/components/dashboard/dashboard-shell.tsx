'use client';

import { useSyncExternalStore, type JSX, type ReactNode } from 'react';

import Link from 'next/link';

import { cn } from '@/lib/utils';
import { useLayoutMode } from '@/lib/layout-mode';
import { HeaderActions } from '@/components/dashboard/header-actions';
import { NotificationsBell } from '@/components/dashboard/notifications-bell';
import { MobileNav } from '@/components/dashboard/mobile-nav';
import { ChatWidget } from '@/components/chat/chat-widget';

/** true si el viewport es ≥lg (el mismo límite que usa el CSS); null en SSR. */
function useIsDesktopViewport(): boolean | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const mql = window.matchMedia('(min-width: 1024px)');
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    () =>
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(min-width: 1024px)').matches
        : true,
    // SSR: sin viewport medido — el badge no se renderiza hasta hidratar.
    () => null,
  );
}

const MODE_LABELS = { mobile: 'Móvil', desktop: 'Escritorio' } as const;

/** Badge con el modo de layout EFECTIVO (automático resuelto por el viewport). */
function LayoutModeBadge(): JSX.Element {
  const { mode } = useLayoutMode();
  const isDesktopViewport = useIsDesktopViewport();

  // En SSR/hidratación todavía no medimos el viewport: no renderizar (evita
  // parpadeo y mismatch).
  if (isDesktopViewport === null) return <></>;

  const effective: 'mobile' | 'desktop' =
    mode === 'auto' ? (isDesktopViewport ? 'desktop' : 'mobile') : mode;
  const forced = mode !== 'auto';
  const label = `${MODE_LABELS[effective]}${forced ? ' · forzado' : ''}`;

  return (
    <span
      aria-label={`Modo de layout: ${label}`}
      title={
        forced
          ? `Layout ${MODE_LABELS[effective]} forzado (Configuración → Vista)`
          : 'Layout automático: se adapta al tamaño de la pantalla'
      }
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
        forced
          ? 'border-accent-500/40 bg-accent-500/10 text-accent-700'
          : 'border-gray-300 bg-gray-100 text-gray-600',
      )}
    >
      {effective === 'mobile' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      )}
      {label}
    </span>
  );
}

/**
 * Chrome del área logueada. Aplica el modo de layout:
 *   - auto:    la cabecera/nav responden al ancho (móvil <lg, escritorio ≥lg).
 *   - mobile:  SIEMPRE layout móvil (toggle manual en Configuración), aunque la
 *              pantalla sea grande: nav inferior, cabecera compacta, padding.
 *   - desktop: SIEMPRE layout de escritorio (toggle manual), aunque la pantalla
 *              sea chica: cabecera superior, filtros abiertos, tabla. El header
 *              envuelve (flex-wrap) para no desbordar en anchos pequeños.
 */
export function DashboardShell({ children }: { children: ReactNode }): JSX.Element {
  const { forcedMobile, forcedDesktop } = useLayoutMode();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-gray-100">
        <div
          className={cn(
            'mx-auto flex max-w-6xl items-center justify-between px-4 py-3',
            forcedDesktop && 'flex-wrap gap-x-4 gap-y-2',
          )}
        >
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="text-lg font-semibold text-gray-900">
              Inventario<span className="text-accent-400">Pro</span>
            </Link>
            <LayoutModeBadge />
          </div>

          {/* Navegación de escritorio: con 'desktop' forzado siempre visible
              (envuelve en pantallas chicas); en automático, solo ≥lg. */}
          <nav
            className={cn(
              'items-center gap-4 text-sm',
              forcedMobile
                ? 'hidden'
                : forcedDesktop
                  ? 'flex flex-wrap gap-y-2'
                  : 'hidden lg:flex',
            )}
          >
            <Link href="/reports" className="font-medium text-gray-700 hover:text-accent-300">
              Reportes
            </Link>
            <Link href="/settings" className="font-medium text-gray-700 hover:text-accent-300">
              Configuración
            </Link>
            <Link
              href="/products/new"
              className="rounded-md bg-accent-600 px-3 py-1.5 font-medium text-white hover:bg-accent-700"
            >
              + Nuevo producto
            </Link>
            <NotificationsBell />
            <HeaderActions />
          </nav>

          {/* Cabecera compacta de móvil: siempre con 'mobile' forzado; si no, <lg */}
          <div
            className={cn(
              'flex items-center gap-2',
              forcedMobile ? '' : forcedDesktop ? 'hidden' : 'lg:hidden',
            )}
          >
            <NotificationsBell />
            <HeaderActions compact />
          </div>
        </div>
      </header>

      {/* pb-24: espacio para la barra inferior; en escritorio (forzado o ≥lg) el padding normal */}
      <main
        className={cn(
          'mx-auto max-w-6xl px-4 py-6',
          forcedDesktop ? 'lg:py-8 lg:pb-8' : 'pb-24 lg:py-8 lg:pb-8',
        )}
      >
        {children}
      </main>

      <MobileNav forced={forcedMobile} hidden={forcedDesktop} />
      <ChatWidget />
    </div>
  );
}
