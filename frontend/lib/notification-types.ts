// =============================================================================
// lib/notification-types.ts - tipos compartidos de notificaciones
// =============================================================================

export type NotificationType =
  | 'GARANTIA_POR_VENCER'
  | 'GARANTIA_VENCIDA'
  | 'RESUMEN_PERIODICO'
  | 'SISTEMA';

export interface AppNotification {
  id: string;
  tipo: NotificationType;
  mensaje: string;
  product_id: string | null;
  leido: boolean;
  created_at: string;
  read_at: string | null;
}

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  GARANTIA_POR_VENCER: 'Garantía por vencer',
  GARANTIA_VENCIDA: 'Garantía vencida',
  RESUMEN_PERIODICO: 'Resumen',
  SISTEMA: 'Sistema',
};
