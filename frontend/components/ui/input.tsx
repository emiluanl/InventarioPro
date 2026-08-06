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
        'block w-full rounded-md border px-3 py-2 text-sm',
        'bg-white placeholder:text-gray-400',
        'focus:outline-none focus:ring-2 focus:ring-accent-500',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        error
          ? 'border-red-500 focus:ring-red-500'
          : 'border-gray-300 focus:border-accent-500',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
