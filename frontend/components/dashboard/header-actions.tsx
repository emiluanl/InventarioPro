'use client';

import type { JSX } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

interface HeaderActionsProps {
  /** Modo compacto (móvil): botón de sesión como ícono sin texto ni email. */
  compact?: boolean;
}

export function HeaderActions({ compact = false }: HeaderActionsProps): JSX.Element {
  const { user, logout } = useAuth();

  if (compact) {
    return (
      <button
        type="button"
        aria-label="Cerrar sesión"
        onClick={() => {
          void logout();
        }}
        className="flex h-9 w-9 items-center justify-center rounded-md text-gray-600 transition hover:bg-gray-200 hover:text-gray-900"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-gray-700 sm:inline">{user?.email}</span>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          void logout();
        }}
      >
        Cerrar sesión
      </Button>
    </div>
  );
}
