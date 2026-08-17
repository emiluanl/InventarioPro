'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'error' | 'success' | 'warning' | 'info';
}

export function Alert({
  className,
  variant = 'info',
  children,
  ...props
}: AlertProps): React.JSX.Element {
  const variants: Record<string, string> = {
    error: 'border-error/30 bg-error/10 text-error',
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/40 bg-warning/10 text-warning',
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
