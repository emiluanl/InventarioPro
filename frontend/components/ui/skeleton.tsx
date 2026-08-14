'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

/**
 * Placeholder de carga (shimmer). Usa la superficie + borde del tema para
 * que se adapte cuando el frontend pase a dark-first.
 */
export function Skeleton({ className, ...props }: SkeletonProps): React.JSX.Element {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-md border border-gray-200 bg-gray-100',
        className,
      )}
      {...props}
    />
  );
}
