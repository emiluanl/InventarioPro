'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

interface NavItemProps {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}

function NavItem({ href, active, label, children }: NavItemProps): JSX.Element {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition',
        active ? 'text-accent-400' : 'text-gray-500 hover:text-gray-700',
      )}
    >
      {children}
      <span className="truncate">{label}</span>
    </Link>
  );
}

const isActive = (pathname: string, href: string): boolean =>
  href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

/**
 * Barra de navegación INFERIOR, solo visible en móvil (<lg). En escritorio el
 * layout usa la cabecera superior tradicional; acá conviven los dos "modos":
 * la misma app con navegación de app nativa en el teléfono. Incluye el botón
 * central "+" (crear producto) y respeta el safe-area de iOS.
 */
interface MobileNavProps {
  /** true con el modo móvil FORZADO: la barra se muestra aunque la pantalla sea grande. */
  forced?: boolean;
}

export function MobileNav({ forced = false }: MobileNavProps): JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación móvil"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-gray-100/95 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)]',
        forced ? '' : 'lg:hidden',
      )}
    >
      <div className="mx-auto flex max-w-lg items-stretch px-2">
        <NavItem href="/dashboard" active={isActive(pathname, '/dashboard')} label="Inicio">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </NavItem>

        <NavItem href="/reports" active={isActive(pathname, '/reports')} label="Reportes">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </NavItem>

        {/* Botón central: crear producto */}
        <Link
          href="/products/new"
          aria-label="Nuevo producto"
          className="flex flex-1 items-center justify-center py-1.5"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-600 text-white shadow-md transition active:scale-95">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </span>
        </Link>

        <NavItem href="/settings" active={isActive(pathname, '/settings')} label="Ajustes">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </NavItem>
      </div>
    </nav>
  );
}
