// =============================================================================
// CsvActions - tests de import/export CSV
// =============================================================================
// Los hooks de export/import se mockean. Se verifica: los botones, la descarga
// (mutation de export), la subida de un archivo (mutation de import con el
// File) y el banner de resultado (éxito parcial / error).
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';

vi.mock('@/hooks/use-products', () => ({
  useExportProducts: vi.fn(),
  useImportProducts: vi.fn(),
}));

import { useExportProducts, useImportProducts } from '@/hooks/use-products';
import { CsvActions } from './csv-actions';

const mockExport = vi.mocked(useExportProducts);
const mockImport = vi.mocked(useImportProducts);

const exportMutate = vi.fn();
const importMutate = vi.fn();

function mockExportState(overrides: Record<string, unknown> = {}): void {
  mockExport.mockReturnValue({
    isPending: false,
    error: null,
    mutate: exportMutate,
    ...overrides,
  } as never);
}

function mockImportState(overrides: Record<string, unknown> = {}): void {
  mockImport.mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    mutate: importMutate,
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExportState();
  mockImportState();
});

describe('CsvActions', () => {
  it('muestra los botones de exportar e importar', () => {
    render(<CsvActions />);
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar CSV' })).toBeInTheDocument();
  });

  it('descarga el CSV al pulsar Exportar', async () => {
    const user = userEvent.setup();
    render(<CsvActions />);

    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));

    expect(exportMutate).toHaveBeenCalledTimes(1);
  });

  it('sube el archivo seleccionado al pulsar Importar y elegir un CSV', async () => {
    const user = userEvent.setup();
    render(<CsvActions />);

    await user.click(screen.getByRole('button', { name: 'Importar CSV' }));

    const file = new File(['nombre,precio\nX,10'], 'inventario.csv', {
      type: 'text/csv',
    });
    const input = screen.getByLabelText('Seleccionar archivo CSV');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(importMutate).toHaveBeenCalledWith(
        file,
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });
  });

  it('muestra el resumen del import (éxito total)', async () => {
    importMutate.mockImplementation((_file: File, opts: { onSuccess: (r: unknown) => void }) => {
      opts.onSuccess({ imported: 3, skipped: 0, errors: [], created_categories: [] });
    });

    render(<CsvActions />);

    const file = new File(['a,b,c'], 'x.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Seleccionar archivo CSV'), {
      target: { files: [file] },
    });

    expect(await screen.findByText(/Se importaron 3 productos/)).toBeInTheDocument();
    expect(screen.queryByText(/con errores/)).not.toBeInTheDocument();
  });

  it('muestra errores por línea en un import parcial', async () => {
    importMutate.mockImplementation((_file: File, opts: { onSuccess: (r: unknown) => void }) => {
      opts.onSuccess({
        imported: 1,
        skipped: 2,
        errors: [
          { row: 3, message: 'Falta el nombre.' },
          { row: 4, message: 'precio inválido.' },
        ],
        created_categories: ['Nueva'],
      });
    });

    render(<CsvActions />);

    const file = new File(['a,b'], 'x.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Seleccionar archivo CSV'), {
      target: { files: [file] },
    });

    expect(await screen.findByText(/Se importaron 1 producto · 2 con errores/)).toBeInTheDocument();
    expect(screen.getByText('Línea 3: Falta el nombre.')).toBeInTheDocument();
    expect(screen.getByText('Línea 4: precio inválido.')).toBeInTheDocument();
    expect(screen.getByText(/Categorías creadas: Nueva/)).toBeInTheDocument();
  });

  it('muestra el error de red del import en un alert', async () => {
    mockImportState({
      isError: true,
      error: new Error('El archivo debe tener extensión .csv.'),
    });

    render(<CsvActions />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'El archivo debe tener extensión .csv.',
    );
  });
});
