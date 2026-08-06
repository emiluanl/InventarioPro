// =============================================================================
// Decorador @CurrentUser()
// =============================================================================
// Extrae el usuario autenticado (inyectado por JwtStrategy.validate) de la
// request. Uso:
//
//   @Get('me')
//   me(@CurrentUser() user: AuthUser) {
//     return user;
//   }
//
// También soporta una propiedad específica:
//
//   @Get('me/id')
//   myId(@CurrentUser('id') id: string) { ... }
// =============================================================================

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | string => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    if (!user) {
      // Si llegamos aquí con el guard activo, hay un bug; lanzamos error claro.
      throw new Error('CurrentUser usado en una ruta sin @CurrentUser inyectado.');
    }
    return data ? user[data] : user;
  },
);
