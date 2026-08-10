// =============================================================================
// lib/report-types.ts - tipos del panel de reportes
// =============================================================================

export interface SpendingCategory {
  categoria_id: string | null;
  nombre: string;
  total: number;
  cantidad: number;
}

export interface SpendingMonth {
  mes: number;
  label: string;
  total: number;
  cantidad: number;
}

export interface SpendingCurrency {
  moneda: string;
  total: number;
  cantidad: number;
}

export interface SpendingReport {
  year: number | null;
  total: number;
  cantidad: number;
  currency: string;
  by_category: SpendingCategory[];
  by_month: SpendingMonth[];
  by_currency: SpendingCurrency[];
  years: number[];
}
