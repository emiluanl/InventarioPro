// =============================================================================
// NotificationsBell - tests de la campana de notificaciones
// =============================================================================
// Los hooks de notificaciones y de push se mockean. Se verifica: la lista, el
// badge de no leídas y el toggle de notificaciones push (activo / inactivo /
// no soportado).
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: vi.fn(),
  useUnreadCount: vi.fn(),
  useMarkNotificationRead: vi.fn(() => ({ mutate: vi.fn() })),
  useMarkAllNotificationsRead: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@/hooks/use-push-notifications', () => ({
  usePushNotifications: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

import {
  useNotifications,
  useUnreadCount,
} from '@/hooks/use-notifications';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { NotificationsBell } from './notifications-bell';

const mockNotifications = vi.mocked(useNotifications);
const mockUnread = vi.mocked(useUnreadCount);
const mockPush = vi.mocked(usePushNotifications);

const toggle = vi.fn().mockResolvedValue(undefined);

function mockPushState(overrides: Record<string, unknown> = {}): void {
  mockPush.mockReturnValue({
    supported: true,
    configured: true,
    enabled: false,
    loading: false,
    error: null,
    toggle,
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNotifications.mockReturnValue({ data: [] } as never);
  mockUnread.mockReturnValue({ data: 0 } as never);
  mockPushState();
});

describe('NotificationsBell', () => {
  it('muestra las notificaciones y el badge de no leídas', () => {
    mockNotifications.mockReturnValue({
      data: [
        {
          id: 'n1',
          tipo: 'GARANTIA_POR_VENCER',
          mensaje: 'La garantía de «Laptop» vence en 7 días.',
          product_id: 'p1',
          leido: false,
          created_at: '2026-08-10T12:00:00.000Z',
          read_at: null,
        },
      ],
    } as never);
    mockUnread.mockReturnValue({ data: 1 } as never);

    render(<NotificationsBell />);

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByLabelText('Notificaciones')).toBeInTheDocument();
  });

  it('muestra el toggle de push desactivado y lo activa al pulsarlo', async () => {
    const user = userEvent.setup();
    render(<NotificationsBell />);

    // Abrimos el panel para ver el toggle.
    await user.click(screen.getByLabelText('Notificaciones'));

    const switchBtn = screen.getByRole('switch', {
      name: 'Activar notificaciones push',
    });
    expect(switchBtn).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Avisos fuera de la app')).toBeInTheDocument();

    await user.click(switchBtn);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('refleja el estado activo de push', async () => {
    mockPushState({ enabled: true });
    const user = userEvent.setup();
    render(<NotificationsBell />);

    await user.click(screen.getByLabelText('Notificaciones'));

    expect(
      screen.getByRole('switch', { name: 'Activar notificaciones push' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('muestra el error de push debajo del toggle', async () => {
    mockPushState({ error: 'Permiso denegado. Activa las notificaciones desde el navegador.' });
    const user = userEvent.setup();
    render(<NotificationsBell />);

    await user.click(screen.getByLabelText('Notificaciones'));

    expect(screen.getByText(/Permiso denegado/)).toBeInTheDocument();
  });

  it('muestra "No soportado" si el navegador no soporta push', async () => {
    mockPushState({ supported: false });
    const user = userEvent.setup();
    render(<NotificationsBell />);

    await user.click(screen.getByLabelText('Notificaciones'));

    expect(screen.getByText('No soportado')).toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: 'Activar notificaciones push' }),
    ).not.toBeInTheDocument();
  });
});
