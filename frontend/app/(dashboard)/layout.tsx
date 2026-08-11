import Link from 'next/link';

import { HeaderActions } from '@/components/dashboard/header-actions';
import { NotificationsBell } from '@/components/dashboard/notifications-bell';
import { ChatWidget } from '@/components/chat/chat-widget';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="text-lg font-semibold text-gray-900">
            Inventario<span className="text-accent-600">Pro</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/reports" className="font-medium text-gray-600 hover:text-accent-700">
              Reportes
            </Link>
            <Link href="/settings" className="font-medium text-gray-600 hover:text-accent-700">
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
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <ChatWidget />
    </div>
  );
}
