// =============================================================================
// parseTtlSeconds - normaliza un TTL a segundos
// =============================================================================
// jsonwebtoken interpreta `expiresIn` así:
//   - número  -> SEGUNDOS
//   - string  -> lo parsea con el paquete `ms` (¡milisegundos! `'900'` = 900 ms)
// Para que JWT y cookies coincidan SIEMPRE (con o sin unidad en la variable de
// entorno), convertimos el TTL a segundos numéricos antes de firmar.
// Acepta: '900' (segundos), '15m', '1h', '7d', '30s'. Si no reconoce el
// formato, usa el fallback (15 minutos por defecto).
// =============================================================================

export function parseTtlSeconds(ttl: string | undefined, fallbackSeconds = 15 * 60): number {
  const value = (ttl ?? '').trim();
  const match = /^(\d+)([smhd])?$/.exec(value);
  if (!match) {
    return fallbackSeconds;
  }
  const n = Number(match[1]);
  const unit = match[2];
  if (!unit) {
    return n; // Número plano = segundos (semántica de jsonwebtoken con números).
  }
  switch (unit) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 60 * 60;
    case 'd':
      return n * 60 * 60 * 24;
    default:
      return fallbackSeconds;
  }
}
