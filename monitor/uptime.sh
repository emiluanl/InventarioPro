#!/bin/sh
# =============================================================================
# uptime.sh - probe de monitoreo del backend
# =============================================================================
# Comprueba periódicamente que la API responde. Semántica compatible con
# UptimeRobot/BetterStack:
#   - Cualquier respuesta HTTP 2xx-4xx = API VIVA (con /api/auth/me sin sesión
#     el backend responde 401, que es exactamente "está arriba").
#   - 5xx, timeout o error de conexión = API CAÍDA.
# Para evitar falsos positivos por un blip puntual, reintenta CHECK_RETRIES
# veces con RETRY_DELAY_SEC segundos entre intentos antes de declarar DOWN.
#
# Notificación externa (opcional):
#   MONITOR_PING_URL - URL tipo healthchecks.io: GET a la URL cuando la API
#     responde y GET a "<url>/fail" cuando queda caída tras los reintentos.
#     Vacío = solo logs + exit code.
#
# Uso:
#   docker compose exec monitor /usr/local/bin/uptime
# =============================================================================
set -eu

API_CHECK_URL="${API_CHECK_URL:-http://backend:3001/api/auth/me}"
CHECK_RETRIES="${CHECK_RETRIES:-3}"
RETRY_DELAY_SEC="${RETRY_DELAY_SEC:-10}"
TIMEOUT_SEC="${TIMEOUT_SEC:-10}"
MONITOR_PING_URL="${MONITOR_PING_URL:-}"

# ---------------------------------------------------------------------------
# Ping de notificación (best-effort: un fallo de red NO debe romper el probe).
# ---------------------------------------------------------------------------
ping() {
  [ -z "${MONITOR_PING_URL}" ] && return 0
  curl -fsS -m 10 "$1" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# Un intento de probe. Imprime el código HTTP y devuelve 0 = vivo, 1 = caído.
# ---------------------------------------------------------------------------
probe() {
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -m "${TIMEOUT_SEC}" "${API_CHECK_URL}" 2>/dev/null)" || CODE="000"
  if [ "${CODE}" = "000" ] || [ "${CODE}" -ge 500 ]; then
    echo "[uptime] intento caído: ${CODE}"
    return 1
  fi
  echo "[uptime] intento OK: HTTP ${CODE}"
  return 0
}

# ---------------------------------------------------------------------------
# Bucle con reintentos.
# ---------------------------------------------------------------------------
i=1
while [ "${i}" -le "${CHECK_RETRIES}" ]; do
  if probe; then
    echo "[uptime] UP: ${API_CHECK_URL} responde al intento ${i}"
    ping "${MONITOR_PING_URL}"
    exit 0
  fi
  if [ "${i}" -lt "${CHECK_RETRIES}" ]; then
    echo "[uptime] reintento en ${RETRY_DELAY_SEC}s (${i}/${CHECK_RETRIES})..."
    sleep "${RETRY_DELAY_SEC}"
  fi
  i=$((i + 1))
done

echo "[uptime] DOWN: ${API_CHECK_URL} no responde tras ${CHECK_RETRIES} intentos"
ping "${MONITOR_PING_URL}/fail"
exit 1
