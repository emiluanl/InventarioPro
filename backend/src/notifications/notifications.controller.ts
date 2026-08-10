// =============================================================================
// NotificationsController - endpoints de notificaciones
// =============================================================================
// Rutas protegidas (JWT global). TODAS filtran por el usuario autenticado:
// un usuario nunca ve ni marca notificaciones de otro.
// =============================================================================

import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';

import { NotificationsService } from './notifications.service';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Lista las notificaciones del usuario (más recientes primero). */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('unread_only') unreadOnly?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Math.min(Math.max(Number(limit) || 50, 1), 100) : 50;
    return this.notifications.list(user.id, {
      unreadOnly: unreadOnly === 'true',
      limit: parsedLimit,
    });
  }

  /** Número de notificaciones sin leer (para el badge de la campana). */
  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  /** Marca UNA notificación como leída. */
  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  /** Marca TODAS las notificaciones del usuario como leídas. */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }
}
