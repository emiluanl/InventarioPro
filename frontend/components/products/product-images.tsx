'use client';

import { useRef, useState, type JSX } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api, extractErrorMessage, resolveFileUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import type { AttachmentType, ProductAttachment } from '@/lib/types';

interface ProductImagesProps {
  productId: string;
  attachments: ProductAttachment[];
}

export function ProductImages({ productId, attachments }: ProductImagesProps): JSX.Element {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState<AttachmentType>('FOTO');
  const [preview, setPreview] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const upload = useMutation<ProductAttachment, Error, { file: File; tipo: AttachmentType }>({
    mutationFn: async ({ file, tipo }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('tipo', tipo);
      const { data } = await api.post<ProductAttachment>(
        `/products/${productId}/attachments`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products', productId] });
      if (fileRef.current) fileRef.current.value = '';
      setPreview(null);
    },
    onError: (err) => setServerError(extractErrorMessage(err)),
  });

  const remove = useMutation<{ message: string }, Error, string>({
    mutationFn: async (attachmentId) => {
      const { data } = await api.delete<{ message: string }>(
        `/products/${productId}/attachments/${attachmentId}`,
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products', productId] });
    },
  });

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setServerError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreview(url);
    } else {
      setPreview(null);
    }
    upload.mutate({ file, tipo });
  };

  const fotos = attachments.filter((a) => a.tipo === 'FOTO');
  const recibos = attachments.filter((a) => a.tipo === 'RECIBO' || a.tipo === 'FACTURA');

  return (
    <div className="space-y-6">
      {serverError && <Alert variant="error">{serverError}</Alert>}

      {/* Uploader */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-4">
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as AttachmentType)}
          className="rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm"
        >
          <option value="FOTO">Foto</option>
          <option value="RECIBO">Recibo</option>
          <option value="FACTURA">Factura</option>
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={onFileChange}
          className="hidden"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => fileRef.current?.click()}
          isLoading={upload.isPending}
        >
          Subir archivo
        </Button>
        {preview && (
          /* eslint-disable-next-line @next/next/no-img-element -- preview es un
             blob URL (URL.createObjectURL) que next/image no soporta. */
          <img
            src={preview}
            alt="preview"
            className="h-12 w-12 rounded object-cover border border-gray-200"
          />
        )}
      </div>

      {/* Galería de fotos */}
      {fotos.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-800">Fotos</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {fotos.map((a) => (
              <div
                key={a.id}
                className={cn(
                  'group relative overflow-hidden rounded-md border border-[var(--border)]',
                )}
              >
                <a href={resolveFileUrl(a.url)} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- URLs
                      firmadas de Supabase/local con host dinámico: next/image
                      exigiría remotePatterns frágiles y rompe el provider local. */}
                  <img
                    src={resolveFileUrl(a.url)}
                    alt={a.nombre ?? 'foto'}
                    className="aspect-square w-full object-cover transition group-hover:scale-105"
                  />
                </a>
                {/* Visible siempre (no solo hover): el borrado es accesible
                    también en táctil, donde no existe group-hover. */}
                <button
                  type="button"
                  onClick={() => remove.mutate(a.id)}
                  className="absolute right-1 top-1 rounded-full bg-error px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-error/90"
                >
                  Borrar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recibos / facturas */}
      {recibos.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-800">Recibos y facturas</h3>
          <ul className="space-y-2">
            {recibos.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <div className="min-w-0">
                  <a
                    href={resolveFileUrl(a.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-medium text-[var(--text)] hover:text-accent-300"
                  >
                    {a.nombre ?? resolveFileUrl(a.url).split('/').pop() ?? 'archivo'}
                  </a>
                  <p className="text-xs text-[var(--text-secondary)]">{a.tipo}</p>
                </div>
                <button
                  type="button"
                  onClick={() => remove.mutate(a.id)}
                  className="text-sm text-error transition hover:text-error"
                >
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
