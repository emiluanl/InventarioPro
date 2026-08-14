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
    error: 'border-red-400/30 bg-red-400/10 text-red-300',
    success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    info: 'border-accent-400/30 bg-accent-400/10 text-accent-400',
  };

  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border px-4 py-3 text-sm backdrop-blur-sm',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
