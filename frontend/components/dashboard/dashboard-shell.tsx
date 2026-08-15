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
 */
export function DashboardShell({ children }: { children: ReactNode }): JSX.Element {
  const { forced } = useLayoutMode();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="text-lg font-semibold text-gray-900">
            Inventario<span className="text-accent-400">Pro</span>
          </Link>

          {/* Navegación de escritorio: solo sin forzar y en pantallas ≥lg */}
          <nav className={cn('items-center gap-4 text-sm', forced ? 'hidden' : 'hidden lg:flex')}>
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

          {/* Cabecera compacta de móvil: siempre en modo forzado; si no, <lg */}
          <div
            className={cn(
              'flex items-center gap-2',
              forced ? '' : 'lg:hidden',
            )}
          >
            <NotificationsBell />
            <HeaderActions compact />
          </div>
        </div>
      </header>

      {/* pb-24: espacio para la barra inferior; en escritorio (sin forzar) el padding normal */}
      <main
        className={cn(
          'mx-auto max-w-6xl px-4 py-6',
          forced ? 'pb-24' : 'pb-24 lg:py-8 lg:pb-8',
        )}
      >
        {children}
      </main>

      <MobileNav forced={forced} />
      <ChatWidget />
    </div>
  );
}
