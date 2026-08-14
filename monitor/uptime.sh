#!/bin/sh
# =============================================================================
# uptime.sh - probe de monitoreo del backend
# =============================================================================
# Comprueba periódicamente que la API responde, en DOS niveles:
#
#   Liveness  (API_CHECK_URL, /api/auth/me por defecto): el proceso responde
#              (2xx-4xx; sin sesión el backend devuelve 401 = "está arriba").
#   Readiness (READINESS_URL, /api/health por defecto): la app está COMPLETA:
#              /api/health consulta BD (SELECT 1) y Redis, y devuelve 503 si
#              algo falla. Detecta el caso "backend arriba pero 5xx/BD caída".
#
# Semántica compatible con UptimeRobot/BetterStack: 2xx-4xx = vivo, 5xx,
# timeout o error de conexión = caído. Para evitar falsos positivos por un
# blip puntual, reintenta CHECK_RETRIES veces con RETRY_DELAY_SEC segundos
# entre intentos antes de declarar DOWN.
#
# Notificación externa (opcional):
#   MONITOR_PING_URL - URL tipo healthchecks.io: GET a la URL cuando todo
#     responde y GET a "<url>/fail" cuando queda caído tras los reintentos.
#     Vacío = solo logs + exit code.
#
# Uso:
#   docker compose exec monitor /usr/local/bin/uptime
# =============================================================================
set -eu

API_CHECK_URL="${API_CHECK_URL:-http://backend:3001/api/auth/me}"
READINESS_URL="${READINESS_URL:-http://backend:3001/api/health}"
CHECK_RETRIES="${CHECK_RETRIES:-3}"
RETRY_DELAY_SEC="${RETRY_DELAY_SEC:-10}"
TIMEOUT_SEC="${TIMEOUT_SEC:-10}"
MONITOR_PING_URL="${MONITOR_PING_URL:-}"
MONITOR_WEBHOOK_URL="${MONITOR_WEBHOOK_URL:-}"
MONITOR_WEBHOOK_TOKEN="${MONITOR_WEBHOOK_TOKEN:-}"

# ---------------------------------------------------------------------------
# Ping de notificación (best-effort: un fallo de red NO debe romper el probe).
# ---------------------------------------------------------------------------
ping() {
  [ -z "${MONITOR_PING_URL}" ] && return 0
  curl -fsS -m 10 "$1" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# Webhook de alerta (Slack/Discord/Mattermost: POST JSON con texto).
# Best-effort como ping: un fallo aquí no rompe el probe.
#   MONITOR_WEBHOOK_URL   - URL del webhook (p. ej. Slack Incoming Webhook).
#   MONITOR_WEBHOOK_TOKEN - token opcional; se envía como cabecera
#                           Authorization: Bearer <token>.
# ---------------------------------------------------------------------------
alert() {
  [ -z "${MONITOR_WEBHOOK_URL}" ] && return 0
  PAYLOAD=$(printf '{"text": "%s"}' "$1")
  if [ -n "${MONITOR_WEBHOOK_TOKEN}" ]; then
    curl -fsS -m 10 -H "Authorization: Bearer ${MONITOR_WEBHOOK_TOKEN}" \
      -H "Content-Type: application/json" -d "${PAYLOAD}" "${MONITOR_WEBHOOK_URL}" >/dev/null 2>&1 || true
  else
    curl -fsS -m 10 -H "Content-Type: application/json" -d "${PAYLOAD}" \
      "${MONITOR_WEBHOOK_URL}" >/dev/null 2>&1 || true
  fi
}

# ---------------------------------------------------------------------------
# Notificación SOLO en cambios de estado (DOWN↔UP), para no spamear cada
# corrida del cron. Usa un archivo de estado en /tmp (efímero por contenedor;
# suficiente para evitar el spam dentro de una sesión de uptime continua).
# ---------------------------------------------------------------------------
STATE_FILE="/tmp/monitor-state"

set_state() {
  echo "$1" > "${STATE_FILE}"
}

state_changed() {
  [ "$(cat "${STATE_FILE}" 2>/dev/null || echo 'UP')" != "$1" ]
}

# ---------------------------------------------------------------------------
# Un intento de probe sobre una URL. Imprime el código HTTP y devuelve
# 0 = vivo (2xx-4xx), 1 = caído (5xx/000/timeout).
# ---------------------------------------------------------------------------
probe_url() {
  URL="$1"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -m "${TIMEOUT_SEC}" "${URL}" 2>/dev/null)" || CODE="000"
  if [ "${CODE}" = "000" ] || [ "${CODE}" -ge 500 ]; then
    echo "[uptime] ${URL} → ${CODE} (caído)"
    return 1
  fi
  echo "[uptime] ${URL} → ${CODE} (OK)"
  return 0
}

# ---------------------------------------------------------------------------
# Bucle con reintentos: liveness Y readiness deben responder en el mismo
# intento para declarar UP (así un blip de una sola no engaña a la otra).
# ---------------------------------------------------------------------------
i=1
while [ "${i}" -le "${CHECK_RETRIES}" ]; do
  LIVENESS_OK=0
  READINESS_OK=0
  probe_url "${API_CHECK_URL}" && LIVENESS_OK=1 || true
  probe_url "${READINESS_URL}" && READINESS_OK=1 || true

  if [ "${LIVENESS_OK}" = 1 ] && [ "${READINESS_OK}" = 1 ]; then
    echo "[uptime] UP: liveness y readiness responden (intento ${i})"
    ping "${MONITOR_PING_URL}"
    if state_changed UP; then
      alert "[InventarioPro] Recuperado: la API vuelve a responder."
      set_state UP
    fi
    exit 0
  fi

  echo "[uptime] reintento en ${RETRY_DELAY_SEC}s (${i}/${CHECK_RETRIES})..."
  sleep "${RETRY_DELAY_SEC}"
  i=$((i + 1))
done

echo "[uptime] DOWN: liveness (${API_CHECK_URL}) o readiness (${READINESS_URL}) fallan tras ${CHECK_RETRIES} intentos"
ping "${MONITOR_PING_URL}/fail"
if state_changed DOWN; then
  alert "[InventarioPro] ALERTA: la API no responde (liveness y/o readiness fallan)."
  set_state DOWN
fi
exit 1
