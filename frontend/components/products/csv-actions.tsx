'use client';

import { useRef, useState, type JSX } from 'react';

import {
  useExportProducts,
  useImportProducts,
  type CsvImportResult,
} from '@/hooks/use-products';

/**
 * Botones "Exportar CSV" e "Importar CSV" para el dashboard.
 * El export descarga el inventario actual; el import lee un .csv local, lo
 * sube al backend y muestra el resumen (importados / errores por línea).
 */
export function CsvActions(): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const exportCsv = useExportProducts();
  const importCsv = useImportProducts();
  const [result, setResult] = useState<CsvImportResult | null>(null);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    setResult(null);
    importCsv.mutate(file, {
      onSuccess: (data) => setResult(data),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => exportCsv.mutate()}
        disabled={exportCsv.isPending}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
      >
        {exportCsv.isPending ? 'Generando…' : 'Exportar CSV'}
      </button>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={importCsv.isPending}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
      >
        {importCsv.isPending ? 'Importando…' : 'Importar CSV'}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        aria-label="Seleccionar archivo CSV"
        onChange={onFileSelected}
      />

      {importCsv.isError && importCsv.error && (
        <p role="alert" className="w-full text-sm text-red-600">
          {importCsv.error.message}
        </p>
      )}

      {result && (
        <div
          role="status"
          className={`w-full rounded-md border px-3 py-2 text-sm ${
            result.skipped > 0
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-green-200 bg-green-50 text-green-800'
          }`}
        >
          <p className="font-medium">
            Se importaron {result.imported} producto{result.imported === 1 ? '' : 's'}
            {result.skipped > 0 && ` · ${result.skipped} con errores`}.
          </p>
          {result.created_categories.length > 0 && (
            <p className="mt-0.5 text-xs opacity-80">
              Categorías creadas: {result.created_categories.join(', ')}.
            </p>
          )}
          {result.skipped > 0 && (
            <ul className="mt-1 max-h-24 list-inside list-disc space-y-0.5 overflow-y-auto text-xs opacity-90">
              {result.errors.map((err) => (
                <li key={err.row}>
                  Línea {err.row}: {err.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
