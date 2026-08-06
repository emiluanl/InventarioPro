// =============================================================================
// JwtAuthGuard (global)
// =============================================================================
// Se aplica de forma GLOBAL en AppModule. Por defecto exige token en TODAS
// las rutas; las excepciones se marcan con el decorador @Public().
//
// Esto elimina el riesgo de olvidar proteger un endpoint nuevo.
// =============================================================================

import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
