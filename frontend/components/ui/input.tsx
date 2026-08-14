'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'block w-full rounded-md border bg-gray-100 px-3 py-2 text-sm text-gray-900',
        'placeholder:text-gray-600',
        'transition-all duration-150 ease-out',
        'focus:outline-none focus:ring-2 focus:ring-accent-400/50',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        error
          ? 'border-red-400/70 focus:border-red-400 focus:ring-red-400/40'
          : 'border-gray-300 hover:border-gray-400 focus:border-accent-500',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
