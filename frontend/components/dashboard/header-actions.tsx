'use client';

import type { JSX } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

export function HeaderActions(): JSX.Element {
  const { user, logout } = useAuth();

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-gray-600 sm:inline">{user?.email}</span>
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
