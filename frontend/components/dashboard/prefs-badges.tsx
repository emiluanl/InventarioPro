'use client';

// =============================================================================
// Badges de preferencias: modo de layout y tema (oscuro/claro).
// =============================================================================
// Se muestran dentro de la app (cabecera del DashboardShell) y también en las
// pantallas de auth (login/registro) para que el usuario pueda forzar el
// layout o cambiar el tema antes de entrar. Ambos son botones con menú; la
// elección se persiste en localStorage (lib/layout-mode y lib/theme-mode).
// =============================================================================

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
} from 'react';

import Link from 'next/link';

import { cn } from '@/lib/utils';
import { useLayoutMode, type LayoutMode } from '@/lib/layout-mode';
import { useTheme, type ThemeMode } from '@/lib/theme-mode';

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

/** true tras hidratar (evita mismatch de SSR con valores de localStorage). */
function useIsMounted(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

const MODE_LABELS = { mobile: 'Móvil', desktop: 'Escritorio' } as const;

/** Ícono del dispositivo según el modo efectivo. */
function DeviceIcon({ mode }: { mode: 'mobile' | 'desktop' }): JSX.Element {
  return mode === 'mobile' ? (
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
  );
}

/**
 * Cierra el menú al: hacer clic afuera (mousedown), presionar Escape, o cuando
 * el FOCO sale del contenedor (Tab/Shift+Tab desde el último/primer elemento,
 * o clic en otro control) — esto último da accesibilidad completa por teclado
 * sin depender solo del puntero.
 */
function useDismissOnOutside(
  open: boolean,
  setOpen: (open: boolean) => void,
  rootRef: React.RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Al perder el foco hacia FUERA del contenedor (menú abierto) se cierra.
    // focusout burbujea y e.relatedTarget es el elemento que recibe el foco.
    const onFocusOut = (e: FocusEvent): void => {
      const next = e.relatedTarget as Node | null;
      if (rootRef.current && (!next || !rootRef.current.contains(next))) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [open, setOpen, rootRef]);
}

/** Chevron pequeño de los botones de badge. */
function Chevron(): JSX.Element {
  return (
    <svg className="hidden sm:block" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Badge interactivo con el modo de layout EFECTIVO (automático resuelto por el
 * viewport). Al hacer clic abre un menú para cambiar el modo sin ir a
 * Configuración. Se separa en wrapper + inner para cumplir las reglas de hooks:
 * el wrapper solo difiere el montaje hasta tener el viewport medido.
 */
function LayoutModeBadge(): JSX.Element {
  const isDesktopViewport = useIsDesktopViewport();
  if (isDesktopViewport === null) return <></>;
  return <LayoutModeBadgeInner isDesktopViewport={isDesktopViewport} />;
}

function LayoutModeBadgeInner({ isDesktopViewport }: { isDesktopViewport: boolean }): JSX.Element {
  const { mode, setMode } = useLayoutMode();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, setOpen, rootRef);

  const effective: 'mobile' | 'desktop' =
    mode === 'auto' ? (isDesktopViewport ? 'desktop' : 'mobile') : mode;
  const forced = mode !== 'auto';
  const label = `${MODE_LABELS[effective]}${forced ? ' · forzado' : ''}`;

  const choose = useCallback(
    (next: LayoutMode) => {
      setMode(next);
      setOpen(false);
      // Restaura el foco al badge (el ítem elegido se desmonta al cerrar; se
      // consulta el DOM en ese momento porque el re-render puede remontarlo).
      const trigger = rootRef.current?.querySelector('button[aria-haspopup]');
      if (trigger instanceof HTMLElement) trigger.focus();
    },
    [setMode, rootRef],
  );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Modo de layout: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          forced
            ? `Layout ${MODE_LABELS[effective]} forzado — clic para cambiar`
            : 'Layout automático: se adapta al tamaño de la pantalla — clic para cambiar'
        }
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
          forced
            ? 'border-accent-500/40 bg-accent-500/10 text-accent-700 hover:bg-accent-500/20'
            : 'border-gray-300 bg-gray-100 text-gray-600 hover:bg-gray-200',
        )}
      >
        <DeviceIcon mode={effective} />
        {/* En pantallas chicas el texto se oculta para no desbordar la cabecera. */}
        <span className="hidden sm:inline">{label}</span>
        <Chevron />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Cambiar modo de layout"
          className="absolute left-0 top-full z-50 mt-1.5 w-44 rounded-lg border border-gray-200 bg-gray-50 py-1 shadow-lg"
        >
          {(
            [
              ['auto', 'Automático', 'Se adapta al tamaño de la pantalla'],
              ['mobile', 'Móvil', 'Barra inferior y tarjetas, siempre'],
              ['desktop', 'Escritorio', 'Cabecera superior y tabla, siempre'],
            ] as const
          ).map(([value, name, hint]) => {
            const selected = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => choose(value)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  selected ? 'font-medium text-accent-700' : 'text-gray-700 hover:bg-gray-100',
                )}
              >
                <span className="w-4 shrink-0">{selected && <span aria-hidden="true">✓</span>}</span>
                <span className="flex flex-col">
                  <span>{name}</span>
                  <span className="text-[11px] font-normal text-gray-400">{hint}</span>
                </span>
              </button>
            );
          })}

          {/* Separador + acceso directo a Configuración → Vista (el mismo
              selector que aquí, por si se prefiere desde la página). */}
          <div role="separator" className="my-1 border-t border-gray-200" />
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-accent-700 hover:bg-gray-100"
          >
            <span className="w-4 shrink-0">⚙</span>
            Configuración → Vista
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Badge del tema (oscuro/claro): botón con menú, mismo patrón que el badge del
 * modo de layout. El tema se persiste y aplica desde lib/theme-mode.
 */
function ThemeBadge(): JSX.Element {
  const isMounted = useIsMounted();
  if (!isMounted) return <></>;
  return <ThemeBadgeInner />;
}

function ThemeBadgeInner(): JSX.Element {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, setOpen, rootRef);

  const choose = useCallback(
    (next: ThemeMode) => {
      setTheme(next);
      setOpen(false);
      // Restaura el foco al badge (el ítem elegido se desmonta al cerrar; se
      // consulta el DOM en ese momento porque el re-render puede remontarlo).
      const trigger = rootRef.current?.querySelector('button[aria-haspopup]');
      if (trigger instanceof HTMLElement) trigger.focus();
    },
    [setTheme, rootRef],
  );

  const label = theme === 'light' ? 'Claro' : theme === 'system' ? 'Sistema' : 'Oscuro';

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Tema: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Cambiar tema oscuro/claro"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-gray-300 bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200"
      >
        {theme === 'light' ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
        {/* En pantallas chicas el texto se oculta para no desbordar la cabecera. */}
        <span className="hidden sm:inline">{label}</span>
        <Chevron />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Cambiar tema"
          className="absolute left-0 top-full z-50 mt-1.5 w-40 rounded-lg border border-gray-200 bg-gray-50 py-1 shadow-lg"
        >
          {(
            [
              ['dark', 'Oscuro', 'Predeterminado'],
              ['light', 'Claro', 'Superficies blancas'],
              ['system', 'Sistema', 'Sigue la preferencia del dispositivo'],
            ] as const
          ).map(([value, name, hint]) => {
            const selected = theme === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => choose(value)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  selected ? 'font-medium text-accent-700' : 'text-gray-700 hover:bg-gray-100',
                )}
              >
                <span className="w-4 shrink-0">{selected && <span aria-hidden="true">✓</span>}</span>
                <span className="flex flex-col">
                  <span>{name}</span>
                  <span className="text-[11px] font-normal text-gray-400">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Grupo de badges (layout + tema) listo para usar en cualquier pantalla. */
export function PrefsBadges(): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <LayoutModeBadge />
      <ThemeBadge />
    </div>
  );
}
