// =============================================================================
// SettingsPage - tests de cambio de contraseña y eliminación de cuenta
// =============================================================================
// useAuth se mockea: se verifican los dos formularios, la validación zod
// (contraseñas que no coinciden), el flujo de éxito/error del cambio de
// contraseña y el doble paso de la eliminación (confirmación + contraseña).
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/hooks/use-auth';
import { LayoutModeProvider } from '@/lib/layout-mode';
import { ThemeProvider } from '@/lib/theme-mode';
import SettingsPage from './page';

const mockUseAuth = vi.mocked(useAuth);

/** Renderiza la página dentro de los providers que requiere (LayoutMode y Tema). */
function renderSettings(): void {
  render(
    <ThemeProvider>
      <LayoutModeProvider>
        <SettingsPage />
      </LayoutModeProvider>
    </ThemeProvider>,
  );
}

const changePassword = vi.fn();
const deleteAccount = vi.fn();
const logout = vi.fn();

function mockAuthState(overrides: Record<string, unknown> = {}): void {
  mockUseAuth.mockReturnValue({
    user: { id: 'u1', email: 'test@example.com' },
    changePassword,
    deleteAccount,
    logout,
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthState();
  // El tema se persiste en localStorage y la clase .light se aplica al <html>:
  // dejamos ambos limpios para que cada test parta del tema oscuro.
  window.localStorage.clear();
  document.documentElement.classList.remove('light');
  // ThemeProvider se suscribe a prefers-color-scheme: jsdom no tiene
  // matchMedia, así que lo simulamos (dark = false → el modo Sistema resuelve claro).
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe('SettingsPage', () => {
  it('muestra el email y las secciones', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: 'Configuración' })).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tema' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cambiar contraseña' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Zona de peligro' })).toBeInTheDocument();
  });

  it('cambia el tema a claro y aplica la clase .light en el <html>', async () => {
    const user = userEvent.setup();
    renderSettings();

    const select = screen.getByLabelText('Tema de la app');
    expect(select).toHaveValue('dark');

    await user.selectOptions(select, 'light');

    expect(select).toHaveValue('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(window.localStorage.getItem('inventariopro:theme')).toBe('light');
  });

  it('el modo Sistema sigue la preferencia del SO (aquí: claro)', async () => {
    const user = userEvent.setup();
    renderSettings();

    const select = screen.getByLabelText('Tema de la app');
    await user.selectOptions(select, 'system');

    expect(select).toHaveValue('system');
    // matchMedia stub: prefers-color-scheme dark = false → tema claro activo.
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(window.localStorage.getItem('inventariopro:theme')).toBe('system');
  });

  it('muestra un error si las contraseñas nuevas no coinciden', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.type(screen.getByLabelText('Contraseña actual'), 'OldPass123');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'NewPass456');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'NewPass789');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('llama a changePassword con los datos y muestra el mensaje de éxito', async () => {
    changePassword.mockResolvedValue('Contraseña actualizada. Inicia sesión con tu nueva contraseña.');
    const user = userEvent.setup();
    renderSettings();

    await user.type(screen.getByLabelText('Contraseña actual'), 'OldPass123');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'NewPass456');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'NewPass456');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        current_password: 'OldPass123',
        new_password: 'NewPass456',
        confirm_password: 'NewPass456',
      });
    });
    expect(
      await screen.findByText(/Contraseña actualizada/),
    ).toBeInTheDocument();
  });

  it('muestra el error del servidor si la contraseña actual es incorrecta', async () => {
    changePassword.mockRejectedValue(new Error('La contraseña actual no es correcta.'));
    const user = userEvent.setup();
    renderSettings();

    await user.type(screen.getByLabelText('Contraseña actual'), 'WrongPass1');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'NewPass456');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'NewPass456');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    expect(
      await screen.findByText('La contraseña actual no es correcta.'),
    ).toBeInTheDocument();
  });

  it('la eliminación exige el doble paso y la contraseña', async () => {
    deleteAccount.mockResolvedValue('Tu cuenta y todos tus datos fueron eliminados.');
    const user = userEvent.setup();
    renderSettings();

    // Paso 1: botón que abre la confirmación.
    await user.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }));
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar eliminación definitiva' });
    // Sin contraseña, el botón está deshabilitado.
    expect(confirmBtn).toBeDisabled();

    // Paso 2: con la contraseña, se llama a deleteAccount.
    await user.type(screen.getByLabelText(/Confirma con tu contraseña/), 'Delete123');
    expect(confirmBtn).toBeEnabled();
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(deleteAccount).toHaveBeenCalledWith('Delete123');
    });
  });

  it('muestra el error si la contraseña de eliminación es incorrecta', async () => {
    deleteAccount.mockRejectedValue(new Error('La contraseña no es correcta.'));
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }));
    await user.type(screen.getByLabelText(/Confirma con tu contraseña/), 'WrongPass1');
    await user.click(screen.getByRole('button', { name: 'Confirmar eliminación definitiva' }));

    expect(await screen.findByText('La contraseña no es correcta.')).toBeInTheDocument();
  });
});
