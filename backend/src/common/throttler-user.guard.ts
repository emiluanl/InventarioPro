// =============================================================================
// ThrottlerUserGuard - rate limiting por usuario autenticado
// =============================================================================
// El ThrottlerGuard por defecto cuenta por IP (getTracker => req.ip). Para las
// rutas autenticadas (chat, productos, categorías...) el límite debe ser POR
// USUARIO: varios usuarios detrás del mismo NAT/IP no deben compartir bucket,
// y un usuario no debe poder eludir el límite rotando IPs.
//
// JwtAuthGuard (APP_GUARD global) se declara ANTES que este guard en
// AppModule, así que req.user ya está poblado cuando getTracker se ejecuta
// para las rutas protegidas. Las rutas públicas (sin req.user) caen al
// tracker por IP, preservando los límites de login/register/forgot/resend.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

type ThrottledRequest = Request & { user?: { id?: string } };

@Injectable()
export class ThrottlerUserGuard extends ThrottlerGuard {
  protected async getTracker(req: ThrottledRequest): Promise<string> {
    const userId = req.user?.id;
    if (typeof userId === 'string' && userId.length > 0) {
      return `user:${userId}`;
    }
    return req.ip ?? 'unknown';
  }
}
