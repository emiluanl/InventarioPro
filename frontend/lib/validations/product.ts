// =============================================================================
// Validaciones del formulario de producto (compartido new/edit)
// =============================================================================

import { z } from 'zod';

export const productFormSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio.').max(200),
  categoria_id: z.string().optional().nullable(),
  marca: z.string().max(120).optional().nullable(),
  modelo: z.string().max(120).optional().nullable(),
  descripcion: z.string().max(2000).optional().nullable(),
  fecha_compra: z.string().min(1, 'La fecha de compra es obligatoria.'),
  lugar_compra: z.string().max(200).optional().nullable(),
  tipo_compra: z.enum(['FISICO', 'ONLINE']),
  precio: z
    .number({ invalid_type_error: 'Precio inválido.' })
    .positive('El precio debe ser mayor a 0.')
    .max(9999999999.99),
  moneda: z.string().length(3).default('USD'),
  metodo_pago: z.string().max(80).optional().nullable(),
  numero_serie: z.string().max(120).optional().nullable(),
  duracion_garantia_meses: z
    .number()
    .int('Debe ser un número entero.')
    .min(0)
    .max(600)
    .optional()
    .nullable(),
  fecha_vencimiento_garantia: z.string().optional().nullable(),
  estado: z.enum([
    'NUEVO',
    'USADO',
    'EN_REPARACION',
    'VENDIDO',
    'PERDIDO_ROBADO',
    'DADO_DE_BAJA',
  ]).default('NUEVO'),
  notas: z.string().max(2000).optional().nullable(),
  tags: z.string().max(500).optional().nullable(),
});

export type ProductFormInput = z.infer<typeof productFormSchema>;
