'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  useNotifications,
  useUnreadCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/hooks/use-notifications';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { NOTIFICATION_TYPE_LABELS } from '@/lib/notification-types';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export function NotificationsBell(): JSX.Element {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data: notifications } = useNotifications();
  const { data: unreadCount = 0 } = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const push = usePushNotifications();

  const onOpenNotification = (id: string, productId: string | null): void => {
    if (productId) {
      setOpen(false);
      router.push(`/products/${productId}`);
    }
    void markRead.mutate(id);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificaciones"
        className="relative rounded-md p-1.5 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop transparente: click fuera cierra el panel. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">Notificaciones</h3>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAll.mutateAsync()}
                  className="text-xs font-medium text-accent-600 hover:underline"
                >
                  Marcar todas leídas
                </button>
              )}
            </header>

            <ul className="max-h-96 overflow-y-auto">
              {(!notifications || notifications.length === 0) && (
                <li className="px-4 py-8 text-center text-sm text-gray-500">
                  No tienes notificaciones.
                </li>
              )}
              {notifications?.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onOpenNotification(n.id, n.product_id)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-gray-50',
                      !n.leido && 'bg-accent-50',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        n.leido ? 'bg-gray-200' : 'bg-accent-600',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-gray-400">
                        {NOTIFICATION_TYPE_LABELS[n.tipo]}
                      </span>
                      <span className="block text-sm text-gray-800">{n.mensaje}</span>
                      <span className="block text-xs text-gray-400">
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* Toggle de notificaciones push (avisos fuera de la app). */}
            <footer className="border-t border-gray-100 bg-gray-50/60 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">Avisos fuera de la app</p>
                  <p className="text-xs text-gray-500">Garantías por vencer o vencidas</p>
                </div>
                {push.supported ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={push.enabled}
                    aria-label="Activar notificaciones push"
                    disabled={push.loading || !push.configured}
                    onClick={() => void push.toggle()}
                    className={cn(
                      'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition',
                      push.enabled ? 'bg-accent-600' : 'bg-gray-300',
                      (push.loading || !push.configured) && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-4 w-4 transform rounded-full bg-white shadow transition',
                        push.enabled ? 'translate-x-4' : 'translate-x-0.5',
                      )}
                    />
                  </button>
                ) : (
                  <span className="text-xs text-gray-400">No soportado</span>
                )}
              </div>
              {push.error && <p className="mt-1.5 text-xs text-red-600">{push.error}</p>}
            </footer>
          </div>
        </>
      )}
    </div>
  );
}
