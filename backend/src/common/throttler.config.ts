// =============================================================================
// Configuración de rate limiting (fuente única de verdad)
// =============================================================================
// Compartida entre la app (AppModule) y los tests de integración para evitar
// que la configuración se duplique y se desincronice.
//
// NOTA sobre @nestjs/throttler v6: TODOS los throttlers del módulo se evalúan
// en TODAS las rutas (un nombre extra limita también /health), así que solo
// existe un throttler global 'default'. Los límites por endpoint se logran con
// @Throttle({ default: {...} }) por ruta, que sobreescribe estos valores, y v6
// genera un bucket por endpoint con la clave sha256(Clase+Handler+Nombre+IP).
// =============================================================================

import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const THROTTLER_CONFIG: ThrottlerModuleOptions = [
  // Límite global por defecto (los endpoints específicos lo sobreescriben).
  { name: 'default', limit: 100, ttl: 60 * 1000 },
];

// =============================================================================
// Límites de auth parametrizables por env (con fallback = valor de producción)
// =============================================================================
// Los @Throttle de AuthController usan estos valores. Producción usa los
// defaults (los mismos de siempre); los tests e2e los suben para que N tests
// en paralelo desde localhost no se bloqueen entre sí. Los decorators se
// evalúan al cargar la clase, así que se leen de process.env directamente.
// =============================================================================

export function throttleLimitFromEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const AUTH_LIMITS = {
  login: {
    limit: throttleLimitFromEnv('THROTTLE_LOGIN_LIMIT', 5),
    ttl: 15 * 60 * 1000,
  },
  register: {
    limit: throttleLimitFromEnv('THROTTLE_REGISTER_LIMIT', 100),
    ttl: 60 * 60 * 1000,
  },
  refresh: {
    limit: throttleLimitFromEnv('THROTTLE_REFRESH_LIMIT', 10),
    ttl: 60 * 1000,
  },
  forgotPassword: {
    limit: throttleLimitFromEnv('THROTTLE_FORGOT_LIMIT', 3),
    ttl: 60 * 60 * 1000,
  },
  resendVerification: {
    limit: throttleLimitFromEnv('THROTTLE_RESEND_LIMIT', 3),
    ttl: 60 * 60 * 1000,
  },
} as const;
