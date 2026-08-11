#!/bin/sh
# =============================================================================
# check.sh - watchdog de backups (alarma si el último dump es viejo)
# =============================================================================
# Comprueba que exista un dump y que el más reciente tenga menos de
# STALE_AFTER_MIN minutos (por defecto 1560 = 26 h, un margen sobre el cron
# diario de 03:00). Si está viejo (o no hay ningún dump) registra un STALE en
# los logs, avisa a un monitor externo y sale con código 1 — útil para
# healthchecks de Docker y para el cron del watchdog.
#
# Notificación externa (opcional):
#   BACKUP_PING_URL - URL tipo healthchecks.io del check de BACKUPS (p. ej.
#     periodo 24 h). Se hace GET a la URL cuando todo está bien y GET a
#     "<url>/fail" cuando está stale. Si solo está MONITOR_PING_URL
#     (compatibilidad con la config antigua de un único check), se usa esa.
#     Vacío = solo logs + exit code.
#
# Uso:
#   docker compose exec backup /usr/local/bin/check
# =============================================================================
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
# 26 horas por defecto (el cron de backup es diario a las 03:00).
STALE_AFTER_MIN="${STALE_AFTER_MIN:-1560}"
# BACKUP_PING_URL es el check diario de backups; MONITOR_PING_URL queda solo
# como fallback (config antigua de un único check compartido).
BACKUP_PING_URL="${BACKUP_PING_URL:-${MONITOR_PING_URL:-}}"

# ---------------------------------------------------------------------------
# Ping de notificación (best-effort: un fallo de red NO debe romper el check).
# ---------------------------------------------------------------------------
ping() {
  [ -z "${BACKUP_PING_URL}" ] && return 0
  URL="$1"
  if command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null --timeout=10 "$URL" 2>/dev/null || true
  else
    curl -fsS -m 10 "$URL" >/dev/null 2>&1 || true
  fi
}

NEWEST="$(ls -1t "${BACKUP_DIR}"/inventariopro-*.dump 2>/dev/null | head -n 1 || true)"

if [ -z "${NEWEST}" ]; then
  echo "[watchdog] STALE: no hay ningún dump en ${BACKUP_DIR} (¿el backup nunca corrió?)"
  ping "${BACKUP_PING_URL}/fail"
  exit 1
fi

NOW="$(date +%s)"
MTIME="$(stat -c %Y "${NEWEST}")"
AGE_MIN=$(( (NOW - MTIME) / 60 ))

if [ "${AGE_MIN}" -gt "${STALE_AFTER_MIN}" ]; then
  echo "[watchdog] STALE: último dump ${NEWEST} hace ${AGE_MIN} min (límite ${STALE_AFTER_MIN} min)"
  ping "${BACKUP_PING_URL}/fail"
  exit 1
fi

echo "[watchdog] OK: último dump ${NEWEST} hace ${AGE_MIN} min"
ping "${BACKUP_PING_URL}"
exit 0
