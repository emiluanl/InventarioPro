'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'error' | 'success' | 'info';
}

export function Alert({
  className,
  variant = 'info',
  children,
  ...props
}: AlertProps): React.JSX.Element {
  const variants: Record<string, string> = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-green-200 bg-green-50 text-green-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
  };

  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
