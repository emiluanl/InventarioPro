// =============================================================================
// EmptyState - tests del estado vacío del inventario
// =============================================================================

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// next/link no se puede renderizar fuera de Next.js; lo sustituimos por un <a>.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('muestra el mensaje de inventario vacío', () => {
    render(<EmptyState />);
    expect(screen.getByRole('heading', { name: 'Tu inventario está vacío' })).toBeInTheDocument();
    expect(screen.getByText(/Empieza registrando tu primer producto/)).toBeInTheDocument();
  });

  it('enlaza al CTA de nuevo producto', () => {
    render(<EmptyState />);
    const link = screen.getByRole('link', { name: '+ Nuevo producto' });
    expect(link).toHaveAttribute('href', '/products/new');
  });
});
