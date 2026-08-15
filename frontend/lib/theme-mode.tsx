'use client';

// =============================================================================
// Tema de la app: oscuro (predeterminado), claro, o 'sistema' (sigue la
// preferencia del SO vía prefers-color-scheme). Se persiste en localStorage.
// =============================================================================
// Sigue el mismo patrón que lib/layout-mode: useSyncExternalStore (sin
// effects, sin mismatch de SSR y sincronizado entre pestañas). Con el modo
// 'sistema', además se suscribe al media query prefers-color-scheme para
// reflejar el cambio del SO EN VIVO (y entre pestañas: el evento storage
// re-dispara la lectura). El provider aplica la clase `.light` en el <html>
// (ver globals.css), que redefine la escala gray de Tailwind para el tema
// claro. La clase se aplica con un effect tras el montaje (no con un script
// pre-hidratación: mutar <html> antes de hidratar rompe la hidratación).
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

export type ThemeMode = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'inventariopro:theme';

interface ThemeContextValue {
  /** La elección del usuario: 'dark', 'light' o 'system'. */
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  /** true si el tema claro está ACTIVO (con 'system', según el SO). */
  isLight: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/** El SO prefiere el tema oscuro (prefers-color-scheme). */
function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'system' ? stored : 'dark';
}

/** Snapshot estable del par {elección, preferencia del SO} para re-render solo
 * cuando cambia alguno (siempre devolver un objeto nuevo re-renderiza en loop). */
interface ThemeSnapshot {
  theme: ThemeMode;
  prefersDark: boolean;
}

const SERVER_SNAPSHOT: ThemeSnapshot = { theme: 'dark', prefersDark: true };

let cachedSnapshot: ThemeSnapshot | null = null;

function getSnapshot(): ThemeSnapshot {
  const theme = readStoredTheme();
  const prefersDark = systemPrefersDark();
  if (
    cachedSnapshot &&
    cachedSnapshot.theme === theme &&
    cachedSnapshot.prefersDark === prefersDark
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = { theme, prefersDark };
  return cachedSnapshot;
}

/** Se notifica por: evento storage (misma pestaña vía dispatch propio + otras
 * pestañas) y por cambios del prefers-color-scheme del SO. */
function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', callback);
  return () => {
    window.removeEventListener('storage', callback);
    mql.removeEventListener('change', callback);
  };
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const snapshot = useSyncExternalStore<ThemeSnapshot>(
    subscribe,
    getSnapshot,
    () => SERVER_SNAPSHOT,
  );
  const { theme, prefersDark } = snapshot;

  // Tema efectivo: con 'system', el que prefiera el SO.
  const isLight = theme === 'light' || (theme === 'system' && !prefersDark);

  const setTheme = useCallback((next: ThemeMode): void => {
    window.localStorage.setItem(STORAGE_KEY, next);
    // El evento 'storage' no se dispara en la pestaña que escribe: lo emitimos
    // a mano para que useSyncExternalStore re-renderice en la misma pestaña.
    window.dispatchEvent(new Event('storage'));
  }, []);

  // Aplica la clase en el <html> (y color-scheme) según el tema efectivo.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', isLight);
    return () => root.classList.remove('light');
  }, [isLight]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isLight }}>
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
