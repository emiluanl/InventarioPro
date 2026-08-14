'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const variants: Record<string, string> = {
      // Acento eléctrico: sólido con glow al hover.
      primary:
        'bg-accent-500 text-white hover:bg-accent-400 hover:shadow-glow active:bg-accent-600',
      // Superficie tonal: base sutil, hover aclara (Grok style).
      secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 active:bg-gray-400/60',
      ghost: 'bg-transparent text-gray-700 hover:bg-gray-300/60 hover:text-gray-900 active:bg-gray-300',
      danger: 'bg-red-500/90 text-white hover:bg-red-400 hover:shadow-[0_0_16px_rgba(239,68,68,0.25)] active:bg-red-600',
    };

    const sizes: Record<string, string> = {
      sm: 'px-2.5 py-1 text-xs',
      md: 'px-4 py-2 text-sm',
      lg: 'px-5 py-2.5 text-base',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md font-medium',
          // Micro-interacción: transición rápida, sin saltos bruscos.
          'transition-all duration-150 ease-out',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0b]',
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none',
          sizes[size],
          variants[variant],
          className,
        )}
        {...props}
      >
        {isLoading && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        )}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
