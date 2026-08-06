// =============================================================================
// Decorador @Public()
// =============================================================================
// Marca un endpoint como "no requiere autenticación". El JwtAuthGuard global
// (configurado en AppModule) salta la verificación cuando encuentra este
// decorador. Útil para login, register, forgot-password, health-check, etc.
// =============================================================================

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
