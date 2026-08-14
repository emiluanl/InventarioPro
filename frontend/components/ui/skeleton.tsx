'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

/**
 * Placeholder de carga (shimmer). Usa la superficie + borde del tema dark:
 * se funde con el fondo sin ruido visual.
 */
export function Skeleton({ className, ...props }: SkeletonProps): React.JSX.Element {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-md border border-gray-300/60 bg-gray-200/60',
        className,
      )}
      {...props}
    />
  );
}
