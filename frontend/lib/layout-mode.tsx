'use client';

// =============================================================================
// Modo de layout: forzar el layout MÓVIL o de ESCRITORIO sin importar la pantalla.
// =============================================================================
// Por defecto ('auto') el layout se adapta al ancho (móvil <lg, escritorio ≥lg).
// Con 'mobile' se fuerza SIEMPRE el layout móvil (barra inferior, cabecera
// compacta, filtros plegados, tarjetas en la lista) aunque la pantalla sea
// grande. Con 'desktop' se fuerza SIEMPRE el layout de escritorio (cabecera
// superior, filtros abiertos, tabla) aunque la pantalla sea chica. Se persiste
// en localStorage (useSyncExternalStore: sin effects, sin mismatch de SSR y
// sincronizado entre pestañas).
// =============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';

export type LayoutMode = 'auto' | 'mobile' | 'desktop';

const STORAGE_KEY = 'inventariopro:layout';

interface LayoutModeContextValue {
  mode: LayoutMode;
  setMode: (mode: LayoutMode) => void;
  /** true si el layout móvil está FORZADO (toggle manual), sea cual sea el viewport. */
  forcedMobile: boolean;
  /** true si el layout de escritorio está FORZADO (toggle manual). */
  forcedDesktop: boolean;
}

const LayoutModeContext = createContext<LayoutModeContextValue | undefined>(undefined);

function readStoredMode(): LayoutMode {
  if (typeof window === 'undefined') return 'auto';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'mobile' || stored === 'desktop' ? stored : 'auto';
}

/** Se notifica en otras pestañas (evento storage) y en la misma (dispatch propio). */
function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

export function LayoutModeProvider({ children }: { children: ReactNode }): JSX.Element {
  const mode = useSyncExternalStore<LayoutMode>(subscribe, readStoredMode, () => 'auto');

  const setMode = useCallback((next: LayoutMode): void => {
    window.localStorage.setItem(STORAGE_KEY, next);
    // El evento 'storage' no se dispara en la pestaña que escribe: lo emitimos
    // a mano para que useSyncExternalStore re-renderice en la misma pestaña.
    window.dispatchEvent(new Event('storage'));
  }, []);

  return (
    <LayoutModeContext.Provider
      value={{ mode, setMode, forcedMobile: mode === 'mobile', forcedDesktop: mode === 'desktop' }}
    >
      {children}
    </LayoutModeContext.Provider>
  );
}

export function useLayoutMode(): LayoutModeContextValue {
  const ctx = useContext(LayoutModeContext);
  if (!ctx) {
    throw new Error('useLayoutMode debe usarse dentro de <LayoutModeProvider>.');
  }
  return ctx;
}
