import type { JSX } from 'react';

import { cn } from '@/lib/utils';

/**
 * Logo original de InventarioPro — caja abierta en perspectiva con un
 * infinito integrado (los extremos del infinito tocan las paredes interiores).
 *
 * Concepto: almacenamiento, inventario, protección, amplitud, capacidad
 * ilimitada y orden dentro de un sistema complejo. Dirección industrial /
 * aeroespacial / precisa. Símbolo 100 % propio, geométrico, sin marcas ajenas.
 *
 * Los colores usan tokens CSS por tema (--logo-* en globals.css): la misma
 * marca se adapta a fondo oscuro y claro sin duplicar SVGs en el código.
 * El SVG es seguro: sin scripts, sin eventos, sin URLs externas.
 */
export function Logo({
  variant = 'horizontal',
  className,
  symbolClassName,
  textClassName,
}: {
  variant?: 'symbol' | 'horizontal';
  className?: string;
  symbolClassName?: string;
  textClassName?: string;
}): JSX.Element {
  // Símbolo: caja abierta en perspectiva (caras laterales + interior) con el
  // infinito acento eléctrico integrado de pared a pared.
  const symbol = (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={cn('h-9 w-9', symbolClassName)}
    >
      {/* Cara izquierda */}
      <path d="M14 24 L32 36 L32 54 L14 42 Z" fill="var(--logo-face-a)" />
      {/* Cara derecha */}
      <path d="M50 24 L32 36 L32 54 L50 42 Z" fill="var(--logo-face-b)" />
      {/* Interior (el hueco de la caja abierta) */}
      <path d="M17 25 L32 15 L47 25 L32 35 Z" fill="var(--logo-void)" />
      {/* Arista del borde superior */}
      <path
        d="M14 24 L32 12 L50 24 L32 36 Z"
        fill="none"
        stroke="var(--logo-edge)"
        strokeWidth="1.5"
      />
      {/* Infinito integrado: sus extremos tocan las paredes interiores */}
      <path
        d="M18 24 C18 20.1 21.1 17 25 17 C28.9 17 32 20.1 32 24 C32 20.1 35.1 17 39 17 C42.9 17 46 20.1 46 24 C46 27.9 42.9 31 39 31 C35.1 31 32 27.9 32 24 C32 27.9 28.9 31 25 31 C21.1 31 18 27.9 18 24 Z"
        fill="none"
        stroke="var(--logo-infinity)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  if (variant === 'symbol') {
    return symbol;
  }

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {symbol}
      <span
        className={cn(
          'text-lg font-semibold tracking-tight text-[var(--text)]',
          textClassName,
        )}
      >
        Inventario<span className="text-accent-400">Pro</span>
      </span>
    </span>
  );
}
