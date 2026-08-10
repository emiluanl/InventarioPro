// =============================================================================
// ProductCard - tests de la tarjeta de producto
// =============================================================================

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// next/link no se puede renderizar fuera de Next.js; lo sustituimos por un <a>.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ProductCard } from './product-card';
import type { Product } from '@/lib/types';

const baseProduct: Product = {
  id: 'p1',
  user_id: 'u1',
  nombre: 'iPhone 15',
  categoria_id: 'c1',
  categoria: { id: 'c1', nombre: 'Electrónica', icono: null },
  marca: 'Apple',
  modelo: '15 Pro',
  descripcion: null,
  fecha_compra: '2024-01-15T00:00:00.000Z',
  lugar_compra: null,
  tipo_compra: 'FISICO',
  precio: '1200.00',
  moneda: 'EUR',
  metodo_pago: null,
  numero_serie: null,
  duracion_garantia_meses: 12,
  fecha_vencimiento_garantia: '2025-01-15T00:00:00.000Z',
  estado: 'NUEVO',
  notas: null,
  tags: null,
  created_at: '2024-01-15T00:00:00.000Z',
  updated_at: '2024-01-15T00:00:00.000Z',
  tiempo_posesion: '2 años, 6 meses, 26 días',
  warranty_status: 'vigente',
  days_until_warranty_expires: 158,
  attachments_count: 0,
};

describe('ProductCard', () => {
  it('muestra nombre, marca y modelo', () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.getByText('iPhone 15')).toBeInTheDocument();
    expect(screen.getByText('Apple · 15 Pro')).toBeInTheDocument();
  });

  it('formatea el precio y la fecha de compra', () => {
    const { container } = render(<ProductCard product={baseProduct} />);
    // El primer dd es el precio: Intl es-ES -> "1200,00 €" (con espacio de no
    // separación; usamos regex para no depender de la normalización de texto).
    const price = container.querySelector('dd');
    expect(price).toHaveTextContent(/200/);
    expect(price).toHaveTextContent(/€/);
    expect(screen.getByText(/2024/)).toBeInTheDocument();
  });

  it('muestra el tiempo de posesión y la categoría', () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.getByText('2 años, 6 meses, 26 días')).toBeInTheDocument();
    expect(screen.getByText('Electrónica')).toBeInTheDocument();
  });

  it('muestra el badge de garantía en modo compact', () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.getByText('Garantía vigente')).toBeInTheDocument();
  });

  it('muestra el conteo de adjuntos cuando hay', () => {
    render(<ProductCard product={{ ...baseProduct, attachments_count: 3 }} />);
    expect(screen.getByText(/3 adjuntos/)).toBeInTheDocument();
  });

  it('no muestra adjuntos si no hay', () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.queryByText(/adjunto/)).not.toBeInTheDocument();
  });

  it('enlaza al detalle del producto', () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/products/p1');
  });
});
