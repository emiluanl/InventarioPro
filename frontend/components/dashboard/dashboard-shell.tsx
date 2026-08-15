'use client';

import type { JSX, ReactNode } from 'react';

import Link from 'next/link';

import { cn } from '@/lib/utils';
import { useLayoutMode } from '@/lib/layout-mode';
import { HeaderActions } from '@/components/dashboard/header-actions';
import { NotificationsBell } from '@/components/dashboard/notifications-bell';
import { MobileNav } from '@/components/dashboard/mobile-nav';
import { ChatWidget } from '@/components/chat/chat-widget';

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
          <Link href="/dashboard" className="text-lg font-semibold text-gray-900">
            Inventario<span className="text-accent-400">Pro</span>
          </Link>

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
