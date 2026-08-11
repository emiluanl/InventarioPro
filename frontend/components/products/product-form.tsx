'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';

import {
  productFormSchema,
  type ProductFormInput,
} from '@/lib/validations/product';
import {
  useCategories,
  useCreateProduct,
  useUpdateProduct,
} from '@/hooks/use-products';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { extractErrorMessage } from '@/lib/api';
import type { Product, ProductStatus, PurchaseType } from '@/lib/types';
import { PRODUCT_STATUS_LABELS, PURCHASE_TYPE_LABELS } from '@/lib/types';

interface ProductFormProps {
  mode: 'create' | 'edit';
  initialProduct?: Product;
}

const ESTADOS: ProductStatus[] = [
  'NUEVO',
  'USADO',
  'EN_REPARACION',
  'VENDIDO',
  'PERDIDO_ROBADO',
  'DADO_DE_BAJA',
];

const TIPOS: PurchaseType[] = ['FISICO', 'ONLINE'];

export function ProductForm({ mode, initialProduct }: ProductFormProps): JSX.Element {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const { data: categories } = useCategories();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormInput>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      nombre: initialProduct?.nombre ?? '',
      categoria_id: initialProduct?.categoria_id ?? null,
      marca: initialProduct?.marca ?? '',
      modelo: initialProduct?.modelo ?? '',
      descripcion: initialProduct?.descripcion ?? '',
      fecha_compra: initialProduct?.fecha_compra ?? '',
      lugar_compra: initialProduct?.lugar_compra ?? '',
      tipo_compra: initialProduct?.tipo_compra ?? 'FISICO',
      precio: initialProduct ? Number(initialProduct.precio) : 0,
      moneda: initialProduct?.moneda ?? 'USD',
      metodo_pago: initialProduct?.metodo_pago ?? '',
      numero_serie: initialProduct?.numero_serie ?? '',
      duracion_garantia_meses: initialProduct?.duracion_garantia_meses ?? null,
      fecha_vencimiento_garantia: initialProduct?.fecha_vencimiento_garantia ?? '',
      estado: initialProduct?.estado ?? 'NUEVO',
      notas: initialProduct?.notas ?? '',
      tags: initialProduct?.tags ?? '',
    },
  });

  const watchDuracion = watch('duracion_garantia_meses');
  const watchFechaCompra = watch('fecha_compra');

  // Si cambia duración o fecha_compra, recalcula fecha_vencimiento automáticamente.
  useEffect(() => {
    if (watchFechaCompra && watchDuracion && watchDuracion > 0) {
      const base = new Date(watchFechaCompra);
      base.setMonth(base.getMonth() + Number(watchDuracion));
      const iso = base.toISOString().slice(0, 10);
      setValue('fecha_vencimiento_garantia', iso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchDuracion, watchFechaCompra]);

  const onSubmit = async (data: ProductFormInput): Promise<void> => {
    setServerError(null);
    const payload = {
      ...data,
      // Limpiar strings vacíos → null para no enviar ""
      marca: data.marca || null,
      modelo: data.modelo || null,
      descripcion: data.descripcion || null,
      lugar_compra: data.lugar_compra || null,
      metodo_pago: data.metodo_pago || null,
      numero_serie: data.numero_serie || null,
      notas: data.notas || null,
      tags: data.tags || null,
      fecha_vencimiento_garantia: data.fecha_vencimiento_garantia || null,
      duracion_garantia_meses: data.duracion_garantia_meses || null,
      categoria_id: data.categoria_id || null,
    };
    try {
      if (mode === 'create') {
        const created = await createProduct.mutateAsync(payload);
        router.push(`/products/${created.id}`);
      } else if (initialProduct) {
        const updated = await updateProduct.mutateAsync({ id: initialProduct.id, ...payload });
        router.push(`/products/${updated.id}`);
      }
    } catch (err) {
      setServerError(extractErrorMessage(err));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {serverError && <Alert variant="error">{serverError}</Alert>}

      {/* Nombre */}
      <div className="space-y-1">
        <Label htmlFor="nombre">Nombre *</Label>
        <Input id="nombre" {...register('nombre')} error={errors.nombre?.message} />
      </div>

      {/* Categoría */}
      <div className="space-y-1">
        <Label htmlFor="categoria_id">Categoría</Label>
        <select
          id="categoria_id"
          {...register('categoria_id')}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500"
        >
          <option value="">Sin categoría</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
      </div>

      {/* Marca / Modelo */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="marca">Marca</Label>
          <Input id="marca" {...register('marca')} error={errors.marca?.message} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="modelo">Modelo</Label>
          <Input id="modelo" {...register('modelo')} error={errors.modelo?.message} />
        </div>
      </div>

      {/* Descripción */}
      <div className="space-y-1">
        <Label htmlFor="descripcion">Descripción</Label>
        <textarea
          id="descripcion"
          rows={3}
          {...register('descripcion')}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
      </div>

      {/* Fecha / lugar / tipo */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="fecha_compra">Fecha de compra *</Label>
          <Input
            id="fecha_compra"
            type="date"
            {...register('fecha_compra')}
            error={errors.fecha_compra?.message}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lugar_compra">Lugar de compra</Label>
          <Input id="lugar_compra" {...register('lugar_compra')} error={errors.lugar_compra?.message} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tipo_compra">Tipo *</Label>
          <select
            id="tipo_compra"
            {...register('tipo_compra')}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>{PURCHASE_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Precio / moneda / método */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="precio">Precio *</Label>
          <Input
            id="precio"
            type="number"
            step="0.01"
            {...register('precio', { valueAsNumber: true })}
            error={errors.precio?.message}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="moneda">Moneda</Label>
          <Input id="moneda" maxLength={3} {...register('moneda')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="metodo_pago">Método de pago</Label>
          <Input id="metodo_pago" {...register('metodo_pago')} />
        </div>
      </div>

      {/* Garantía */}
      <div className="grid gap-4 sm:grid-cols-2 rounded-md border border-gray-200 p-4">
        <div className="space-y-1">
          <Label htmlFor="duracion_garantia_meses">Duración de garantía (meses)</Label>
          <Input
            id="duracion_garantia_meses"
            type="number"
            min={0}
            {...register('duracion_garantia_meses', { valueAsNumber: true })}
            error={errors.duracion_garantia_meses?.message}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fecha_vencimiento_garantia">Vencimiento de garantía</Label>
          <Input
            id="fecha_vencimiento_garantia"
            type="date"
            {...register('fecha_vencimiento_garantia')}
          />
          <p className="text-xs text-gray-500">
            Se calcula automáticamente si defines duración.
          </p>
        </div>
      </div>

      {/* Estado / número de serie */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="estado">Estado</Label>
          <select
            id="estado"
            {...register('estado')}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500"
          >
            {ESTADOS.map((e) => (
              <option key={e} value={e}>{PRODUCT_STATUS_LABELS[e]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="numero_serie">Número de serie</Label>
          <Input id="numero_serie" {...register('numero_serie')} />
        </div>
      </div>

      {/* Notas / tags */}
      <div className="space-y-1">
        <Label htmlFor="notas">Notas</Label>
        <textarea
          id="notas"
          rows={3}
          {...register('notas')}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="tags">Etiquetas (separadas por comas)</Label>
        <Input id="tags" {...register('tags')} placeholder="ej: cocina, regalo, hogar" />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Cancelar
        </Button>
        <Button type="submit" isLoading={isSubmitting}>
          {mode === 'create' ? 'Crear producto' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}
