'use client';

// =============================================================================
// Tema de la app: oscuro (predeterminado) o claro, persistido en localStorage.
// =============================================================================
// Sigue el mismo patrón que lib/layout-mode: useSyncExternalStore (sin
// effects, sin mismatch de SSR y sincronizado entre pestañas). El provider
// aplica la clase `.light` en el <html> (ver globals.css), que redefina la
// escala gray de Tailwind para el tema claro. La clase se aplica con un effect
// tras el montaje (no con un script pre-hidratación: mutar <html> antes de
// hidratar rompe la hidratación de React en dev).
// =============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';

export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'inventariopro:theme';

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  /** true si el tema claro está activo. */
  isLight: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

/** Se notifica en otras pestañas (evento storage) y en la misma (dispatch propio). */
function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const theme = useSyncExternalStore<ThemeMode>(subscribe, readStoredTheme, () => 'dark');

  const setTheme = useCallback((next: ThemeMode): void => {
    window.localStorage.setItem(STORAGE_KEY, next);
    // El evento 'storage' no se dispara en la pestaña que escribe: lo emitimos
    // a mano para que useSyncExternalStore re-renderice en la misma pestaña.
    window.dispatchEvent(new Event('storage'));
  }, []);

  // Aplica la clase en el <html> (y color-scheme) según el tema.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', theme === 'light');
    return () => root.classList.remove('light');
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isLight: theme === 'light' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme debe usarse dentro de <ThemeProvider>.');
  }
  return ctx;
}
