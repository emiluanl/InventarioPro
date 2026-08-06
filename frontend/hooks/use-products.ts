'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api, extractErrorMessage } from '@/lib/api';
import type {
  PaginatedProducts,
  Product,
  ProductsFilters,
} from '@/lib/types';

const PRODUCTS_KEY = ['products'] as const;

function buildQueryString(filters: ProductsFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      params.append(k, String(v));
    }
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useProducts(
  filters: ProductsFilters,
): UseQueryResult<PaginatedProducts, Error> {
  return useQuery<PaginatedProducts, Error>({
    queryKey: [...PRODUCTS_KEY, filters],
    queryFn: async () => {
      const { data } = await api.get<PaginatedProducts>(
        `/products${buildQueryString(filters)}`,
      );
      return data;
    },
    placeholderData: (previousData) => previousData,
  });
}

export function useProduct(id: string): UseQueryResult<Product, Error> {
  return useQuery<Product, Error>({
    queryKey: [...PRODUCTS_KEY, id],
    queryFn: async () => {
      const { data } = await api.get<Product>(`/products/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export interface CreateProductInput {
  nombre: string;
  categoria_id?: string | null;
  marca?: string | null;
  modelo?: string | null;
  descripcion?: string | null;
  fecha_compra: string;
  lugar_compra?: string | null;
  tipo_compra: 'FISICO' | 'ONLINE';
  precio: number;
  moneda?: string;
  metodo_pago?: string | null;
  numero_serie?: string | null;
  duracion_garantia_meses?: number | null;
  fecha_vencimiento_garantia?: string | null;
  estado?: Product['estado'];
  notas?: string | null;
  tags?: string | null;
}

export function useCreateProduct(): UseMutationResult<Product, Error, CreateProductInput> {
  const qc = useQueryClient();
  return useMutation<Product, Error, CreateProductInput>({
    mutationFn: async (input) => {
      try {
        const { data } = await api.post<Product>('/products', input);
        return data;
      } catch (err) {
        throw new Error(extractErrorMessage(err));
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRODUCTS_KEY });
    },
  });
}

export interface UpdateProductInput extends CreateProductInput {
  id: string;
}

export function useUpdateProduct(): UseMutationResult<Product, Error, UpdateProductInput> {
  const qc = useQueryClient();
  return useMutation<Product, Error, UpdateProductInput>({
    mutationFn: async ({ id, ...input }) => {
      try {
        const { data } = await api.put<Product>(`/products/${id}`, input);
        return data;
      } catch (err) {
        throw new Error(extractErrorMessage(err));
      }
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: PRODUCTS_KEY });
      void qc.invalidateQueries({ queryKey: [...PRODUCTS_KEY, data.id] });
    },
  });
}

export function useDeleteProduct(): UseMutationResult<{ message: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation<{ message: string }, Error, string>({
    mutationFn: async (id) => {
      try {
        const { data } = await api.delete<{ message: string }>(`/products/${id}`);
        return data;
      } catch (err) {
        throw new Error(extractErrorMessage(err));
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRODUCTS_KEY });
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await api.get('/categories');
      return data as Array<{ id: string; nombre: string; icono: string | null }>;
    },
    staleTime: 5 * 60 * 1000,
  });
}
