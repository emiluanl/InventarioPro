// =============================================================================
// ReportsPage - tests del panel de reportes
// =============================================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// next/link solo se usa en el estado vacío; lo sustituimos por un <a>.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-reports', () => ({
  useSpendingReport: vi.fn(),
}));

import { useSpendingReport } from '@/hooks/use-reports';
import ReportsPage from './page';
import type { SpendingReport } from '@/lib/report-types';

const mockReport = vi.mocked(useSpendingReport);

const report: SpendingReport = {
  year: 2026,
  total: 730,
  cantidad: 3,
  currency: 'EUR',
  by_category: [
    { categoria_id: 'c1', nombre: 'Electrónica', total: 650, cantidad: 2 },
    { categoria_id: 'c2', nombre: 'Ropa', total: 80, cantidad: 1 },
  ],
  // El backend devuelve siempre los 12 meses del año.
  by_month: Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    label: ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][i],
    total: i === 0 ? 100 : i === 7 ? 630 : 0,
    cantidad: i === 0 || i === 7 ? 1 : 0,
  })),
  by_currency: [
    { moneda: 'EUR', total: 730, cantidad: 3 },
  ],
  years: [2026, 2024],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockReport.mockReturnValue({ data: report, isLoading: false, isError: false, error: null } as never);
});

describe('ReportsPage', () => {
  it('muestra el total, las compras y el selector de año', () => {
    render(<ReportsPage />);
    expect(screen.getByText(/Gasto en 2026/)).toBeInTheDocument();
    expect(screen.getByText('730,00 €')).toBeInTheDocument();
    expect(screen.getByLabelText('Año')).toBeInTheDocument();
  });

  it('lista las categorías con su desglose', () => {
    render(<ReportsPage />);
    expect(screen.getByText('Electrónica')).toBeInTheDocument();
    expect(screen.getByText('Ropa')).toBeInTheDocument();
    expect(screen.getByText('650,00 €')).toBeInTheDocument();
    expect(screen.getByText('80,00 €')).toBeInTheDocument();
  });

  it('renderiza el gráfico de meses con sus etiquetas y su alternativa textual', () => {
    const { container } = render(<ReportsPage />);
    expect(screen.getByText('ene')).toBeInTheDocument();
    expect(screen.getByText('feb')).toBeInTheDocument();
    expect(screen.getByText('ago')).toBeInTheDocument();
    // 12 barras del año, una por mes (las barras de categorías no cuentan).
    const monthSection = Array.from(container.querySelectorAll('section')).find((s) =>
      s.textContent?.includes('Por mes'),
    );
    expect(monthSection?.querySelectorAll('.bg-accent-600, [aria-hidden="true"]')).not.toBeNull();
    // Alternativa textual del gráfico (figcaption sr-only) con los datos.
    const caption = monthSection?.querySelector('figcaption');
    expect(caption).not.toBeNull();
    expect(caption?.textContent).toContain('Gasto mensual:');
    // El formato de moneda usa espacio no separable: comparar con \s*.
    expect(caption?.textContent).toMatch(/ene\s*100,00/);
    expect(caption?.textContent).toMatch(/ago\s*630,00/);
  });

  it('muestra el estado vacío cuando no hay gastos', () => {
    mockReport.mockReturnValue({
      data: { ...report, total: 0, cantidad: 0, by_category: [], by_month: [], by_currency: [] },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    render(<ReportsPage />);
    expect(screen.getByText('Sin gastos en este periodo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Nuevo producto' })).toHaveAttribute(
      'href',
      '/products/new',
    );
  });

  it('muestra el skeleton mientras carga', () => {
    mockReport.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null } as never);
    const { container } = render(<ReportsPage />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});
