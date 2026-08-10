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
