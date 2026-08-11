// =============================================================================
// lib/types.ts - tipos compartidos del frontend
// =============================================================================

export type ProductStatus =
  | 'NUEVO'
  | 'USADO'
  | 'EN_REPARACION'
  | 'VENDIDO'
  | 'PERDIDO_ROBADO'
  | 'DADO_DE_BAJA';

export type PurchaseType = 'FISICO' | 'ONLINE';

export type AttachmentType = 'FOTO' | 'RECIBO' | 'FACTURA';

export type WarrantyStatus = 'vigente' | 'por_vencer' | 'vencida';

export interface Category {
  id: string;
  nombre: string;
  icono: string | null;
}

export interface ProductAttachment {
  id: string;
  tipo: AttachmentType;
  url: string;
  nombre: string | null;
  mime_type: string | null;
  tamano_bytes: number | null;
  created_at: string;
}

export interface Product {
  id: string;
  user_id: string;
  nombre: string;
  categoria_id: string | null;
  categoria?: Category | null;
  marca: string | null;
  modelo: string | null;
  descripcion: string | null;
  fecha_compra: string;
  lugar_compra: string | null;
  tipo_compra: PurchaseType;
  precio: string; // llega como string de Prisma.Decimal
  moneda: string;
  metodo_pago: string | null;
  numero_serie: string | null;
  duracion_garantia_meses: number | null;
  fecha_vencimiento_garantia: string | null;
  estado: ProductStatus;
  notas: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
  tiempo_posesion: string;
  warranty_status: WarrantyStatus | null;
  days_until_warranty_expires: number | null;
  attachments_count: number;
  attachments?: ProductAttachment[];
}

export interface PaginatedProducts {
  items: Product[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export interface ProductsFilters {
  page?: number;
  per_page?: number;
  search?: string;
  categoria_id?: string;
  estado?: ProductStatus;
  tipo_compra?: PurchaseType;
  warranty_status?: WarrantyStatus;
  fecha_desde?: string;
  fecha_hasta?: string;
  sort_by?: 'fecha_compra' | 'nombre' | 'precio' | 'tiempo_posesion' | 'created_at';
  sort_order?: 'asc' | 'desc';
}

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  NUEVO: 'Nuevo',
  USADO: 'Usado',
  EN_REPARACION: 'En reparación',
  VENDIDO: 'Vendido',
  PERDIDO_ROBADO: 'Perdido o robado',
  DADO_DE_BAJA: 'Dado de baja',
};

export const PURCHASE_TYPE_LABELS: Record<PurchaseType, string> = {
  FISICO: 'Física',
  ONLINE: 'Online',
};

export const WARRANTY_LABELS: Record<WarrantyStatus, string> = {
  vigente: 'Garantía vigente',
  por_vencer: 'Vence pronto',
  vencida: 'Garantía vencida',
};
