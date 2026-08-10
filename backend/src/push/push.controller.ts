// =============================================================================
// PushController - endpoints de suscripción a Web Push
// =============================================================================
// - GET /push/vapid-public-key: clave pública VAPID (es pública por diseño:
//   el navegador la necesita para suscribirse). Ruta @Public().
// - POST /push/subscribe: guarda la suscripción del navegador del usuario.
// - POST /push/unsubscribe: elimina la suscripción (solo si es del usuario).
// =============================================================================

import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { PushService } from './push.service';
import { SubscribePushDto, UnsubscribePushDto } from './dto/subscribe-push.dto';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** Clave pública VAPID (no secreta) para suscribirse desde el navegador. */
  @Public()
  @Get('vapid-public-key')
  vapidPublicKey() {
    return { publicKey: this.push.getPublicKey() };
  }

  /** Registra la suscripción Push del navegador para este usuario. */
  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  subscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubscribePushDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.push.subscribe(user.id, dto, userAgent);
  }

  /** Da de baja la suscripción (solo si pertenece al usuario). */
  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  unsubscribe(@CurrentUser() user: AuthUser, @Body() dto: UnsubscribePushDto) {
    return this.push.unsubscribe(user.id, dto.endpoint);
  }
}
