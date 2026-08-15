// =============================================================================
// PrefsBadges - badges interactivos de preferencias (layout y tema)
// =============================================================================
// Verifica los menús de los badges: el del modo de layout (abre, muestra las
// tres opciones con la actual marcada, y elegir una cambia el modo al instante)
// y el del tema (abre, cambia a claro y aplica la clase .light en el <html>).
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LayoutModeProvider } from '@/lib/layout-mode';
import { ThemeProvider } from '@/lib/theme-mode';
import { PrefsBadges } from './prefs-badges';

// next/link en jsdom: renderiza un <a> normal.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  // Estado limpio entre tests (el tema se persiste en localStorage y la clase
  // .light en el <html> la aplica el provider con un effect).
  window.localStorage.clear();
  document.documentElement.classList.remove('light');
  // jsdom no tiene matchMedia: simulamos escritorio (≥lg).
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(min-width: 1024px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

/** Renderiza los badges con ambos providers. */
function renderBadges(): void {
  render(
    <ThemeProvider>
      <LayoutModeProvider>
        <PrefsBadges />
      </LayoutModeProvider>
    </ThemeProvider>,
  );
}

describe('badge del modo de layout', () => {
  it('abre el menú al hacer clic en el badge', async () => {
    const user = userEvent.setup();
    renderBadges();

    const badge = screen.getByLabelText('Modo de layout: Escritorio');
    expect(badge).toBeInTheDocument();

    await user.click(badge);

    const menu = screen.getByRole('menu', { name: 'Cambiar modo de layout' });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /Automático/ })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: /Móvil/ })).not.toBeChecked();
  });

  it('cambia el modo al elegir una opción del menú', async () => {
    const user = userEvent.setup();
    renderBadges();

    await user.click(screen.getByLabelText('Modo de layout: Escritorio'));
    await user.click(screen.getByRole('menuitemradio', { name: /Móvil/ }));

    expect(screen.getByLabelText('Modo de layout: Móvil · forzado')).toBeInTheDocument();
  });

  it('ofrece un acceso directo a Configuración → Vista al final del menú', async () => {
    const user = userEvent.setup();
    renderBadges();

    await user.click(screen.getByLabelText('Modo de layout: Escritorio'));

    const link = screen.getByRole('link', { name: /Configuración → Vista/ });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/settings');
  });

  it('se cierra al salir el foco del menú (Tab) y restaura el foco al elegir una opción', async () => {
    const user = userEvent.setup();
    renderBadges();

    const badge = screen.getByLabelText('Modo de layout: Escritorio');
    await user.click(badge);
    const menu = screen.getByRole('menu', { name: 'Cambiar modo de layout' });
    expect(menu).toBeInTheDocument();

    // Tab desde el badge llega al primer ítem del menú (dentro del contenedor).
    await user.tab();
    expect(menu).toBeInTheDocument();

    // Tab hasta salir del menú (el enlace a Configuración es el último) → cierra.
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.queryByRole('menu', { name: 'Cambiar modo de layout' })).not.toBeInTheDocument();

    // Al elegir una opción el menú se cierra y el foco vuelve al badge.
    await user.click(badge);
    await user.click(screen.getByRole('menuitemradio', { name: /Escritorio/ }));
    expect(screen.queryByRole('menu', { name: 'Cambiar modo de layout' })).not.toBeInTheDocument();
    expect(badge).toHaveFocus();
  });
});

describe('badge del tema', () => {
  it('cambia a claro y aplica la clase .light en el <html>', async () => {
    const user = userEvent.setup();
    renderBadges();

    const badge = screen.getByLabelText('Tema: Oscuro');
    expect(badge).toBeInTheDocument();

    await user.click(badge);
    await user.click(screen.getByRole('menuitemradio', { name: /Claro/ }));

    expect(screen.getByLabelText('Tema: Claro')).toBeInTheDocument();
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(window.localStorage.getItem('inventariopro:theme')).toBe('light');
  });

  it('el modo Sistema sigue prefers-color-scheme del SO', async () => {
    const user = userEvent.setup();
    renderBadges();

    const badge = screen.getByLabelText('Tema: Oscuro');
    await user.click(badge);
    await user.click(screen.getByRole('menuitemradio', { name: /Sistema/ }));

    // El stub de matchMedia devuelve prefers-color-scheme: dark = false → claro.
    expect(screen.getByLabelText('Tema: Sistema')).toBeInTheDocument();
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(window.localStorage.getItem('inventariopro:theme')).toBe('system');
  });
});
