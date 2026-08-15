'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type JSX, type ReactNode } from 'react';

import { AuthProvider } from '@/hooks/use-auth';
import { LayoutModeProvider } from '@/lib/layout-mode';

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <LayoutModeProvider>
        <AuthProvider>{children}</AuthProvider>
      </LayoutModeProvider>
    </QueryClientProvider>
  );
}
