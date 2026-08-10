// =============================================================================
// WarrantyBadge - tests de los estados de garantía
// =============================================================================

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WarrantyBadge } from './warranty-badge';

describe('WarrantyBadge', () => {
  it('muestra "Sin garantía" cuando el estado es null', () => {
    render(<WarrantyBadge status={null} />);
    expect(screen.getByText('Sin garantía')).toBeInTheDocument();
  });

  it('muestra la etiqueta de garantía vigente', () => {
    render(<WarrantyBadge status="vigente" />);
    expect(screen.getByText('Garantía vigente')).toBeInTheDocument();
  });

  it('muestra la etiqueta de garantía vencida', () => {
    render(<WarrantyBadge status="vencida" />);
    expect(screen.getByText('Garantía vencida')).toBeInTheDocument();
  });

  it('incluye los días restantes en "por_vencer" (vista completa)', () => {
    render(<WarrantyBadge status="por_vencer" daysUntilExpiry={7} />);
    expect(screen.getByText('Vence pronto (7 días)')).toBeInTheDocument();
  });

  it('respeta el singular para 1 día', () => {
    render(<WarrantyBadge status="por_vencer" daysUntilExpiry={1} />);
    expect(screen.getByText('Vence pronto (1 día)')).toBeInTheDocument();
  });

  it('omite los días en modo compact', () => {
    render(<WarrantyBadge status="por_vencer" compact daysUntilExpiry={7} />);
    expect(screen.getByText('Vence pronto')).toBeInTheDocument();
    expect(screen.queryByText(/días/)).not.toBeInTheDocument();
  });
});
