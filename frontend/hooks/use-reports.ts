'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { SpendingReport } from '@/lib/report-types';

/** Reporte de gasto. `year` null = todos los años. */
export function useSpendingReport(year: number | null) {
  return useQuery({
    queryKey: ['reports', 'spending', year],
    queryFn: async () => {
      const suffix = year ? `?year=${year}` : '';
      const { data } = await api.get<SpendingReport>(`/reports/spending${suffix}`);
      return data;
    },
  });
}
