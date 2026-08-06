// =============================================================================
// lib/utils.ts - utilidades compartidas
// =============================================================================

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 Combina clases de Tailwind de forma segura, resolviendo conflictos.
 Ej: cn("px-2 px-4", condition && "py-2") -> "px-4 py-2"
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
