#!/bin/sh
# =============================================================================
# backup.sh - pg_dump programado + retención + copia remota (rclone)
# =============================================================================
# Genera un dump en formato custom (comprimido) con fecha y hora en el nombre,
# elimina los dumps más antiguos que BACKUP_KEEP_DAYS y, si RCLONE_REMOTE está
# configurado, copia los dumps al remote y aplica la misma retención allí. Se
# puede ejecutar a mano con:
#   docker compose -f docker-compose.prod.yml exec backup /usr/local/bin/backup
#
# Copia remota (opcional):
#   RCLONE_REMOTE    - remote rclone ("s3backup:inventariopro", "mi-server:...").
#                      Vacío o no definido = sin copia remota (no falla).
#   BACKUP_KEEP_DAYS - se aplica también en el remote (borra los dumps más
#                      antiguos que N días).
#   La config de rclone se lee de /root/.config/rclone/rclone.conf (montada
#   desde ./rclone del host). Ver DEPLOYMENT.md §7.
#
# Heartbeat de monitoreo (opcional):
#   BACKUP_PING_URL - URL tipo healthchecks.io del check de BACKUPS (periodo
#     diario, p. ej. 24 h + 2 h de gracia). Tras cada ejecución se hace GET a la
#     URL si el backup terminó bien y a "<url>/fail" si falló. El watchdog
#     (check.sh) usa la misma URL. Si solo está MONITOR_PING_URL (compatibilidad
#     con la config antigua de un único check), se usa esa.
# =============================================================================
set -eu

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER requerido}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD requerido}"
POSTGRES_DB="${POSTGRES_DB:-inventariopro}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
# BD de desarrollo (opcional): la app en uso real apunta aquí (host:5432).
# Si POSTGRES_HOST_DEV está definido se vuelca también a inventariopro-dev-*.dump.
POSTGRES_HOST_DEV="${POSTGRES_HOST_DEV:-}"
POSTGRES_DEV_PORT="${POSTGRES_DEV_PORT:-5432}"
POSTGRES_DEV_USER="${POSTGRES_DEV_USER:-inventariopro}"
POSTGRES_DEV_PASSWORD="${POSTGRES_DEV_PASSWORD:-inventariopro}"
POSTGRES_DEV_DB="${POSTGRES_DEV_DB:-inventariopro}"
# Uploads (opcional): si UPLOADS_SRC existe, se empaquetan en uploads-*.tar.gz.
UPLOADS_SRC="${UPLOADS_SRC:-}"
# BACKUP_PING_URL es el check diario de backups; MONITOR_PING_URL queda solo
# como fallback (config antigua de un único check compartido).
BACKUP_PING_URL="${BACKUP_PING_URL:-${MONITOR_PING_URL:-}}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

# ---------------------------------------------------------------------------
# Ping de monitoreo según el estado de salida del backup (best-effort).
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

report_status() {
  rc="$?"
  if [ "${rc}" -eq 0 ]; then
    echo "[backup] heartbeat OK → ${BACKUP_PING_URL:-<sin monitor>}"
    ping "${BACKUP_PING_URL}"
  else
    echo "[backup] heartbeat FAIL → ${BACKUP_PING_URL:-<sin monitor>} (código ${rc})"
    ping "${BACKUP_PING_URL}/fail"
  fi
  exit "${rc}"
}
trap 'report_status' EXIT

mkdir -p "${BACKUP_DIR}"
TS="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/inventariopro-${TS}.dump"

echo "[backup] pg_dump -Fc ${POSTGRES_DB}@${POSTGRES_HOST}:${POSTGRES_PORT} ..."
if pg_dump -Fc -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -f "${FILE}"; then
  SIZE="$(du -h "${FILE}" | cut -f1)"
  echo "[backup] OK: ${FILE} (${SIZE})"
else
  echo "[backup] ERROR: pg_dump falló; no se guardó ningún archivo"
  rm -f "${FILE}"
  exit 1
fi

# ---------------------------------------------------------------------------
# Vuelco de la BD de desarrollo (la que usa la app en la práctica).
# ---------------------------------------------------------------------------
if [ -n "${POSTGRES_HOST_DEV}" ]; then
  export PGPASSWORD="${POSTGRES_DEV_PASSWORD}"
  DEV_FILE="${BACKUP_DIR}/inventariopro-dev-${TS}.dump"
  echo "[backup] pg_dump -Fc ${POSTGRES_DEV_DB}@${POSTGRES_HOST_DEV}:${POSTGRES_DEV_PORT} (BD dev) ..."
  if pg_dump -Fc -h "${POSTGRES_HOST_DEV}" -p "${POSTGRES_DEV_PORT}" -U "${POSTGRES_DEV_USER}" -d "${POSTGRES_DEV_DB}" -f "${DEV_FILE}"; then
    echo "[backup] OK dev: ${DEV_FILE} ($(du -h "${DEV_FILE}" | cut -f1))"
  else
    echo "[backup] ERROR: pg_dump de la BD dev falló; no se guardó ningún archivo" >&2
    rm -f "${DEV_FILE}"
    exit 1
  fi
  export PGPASSWORD="${POSTGRES_PASSWORD}"
fi

# ---------------------------------------------------------------------------
# Uploads (fotos, recibos, facturas) - empaquetado en tar.gz.
# ---------------------------------------------------------------------------
if [ -n "${UPLOADS_SRC}" ] && [ -d "${UPLOADS_SRC}" ]; then
  UP_FILE="${BACKUP_DIR}/uploads-${TS}.tar.gz"
  echo "[backup] tar czf ${UP_FILE} (desde ${UPLOADS_SRC}) ..."
  if tar czf "${UP_FILE}" -C "$(dirname "${UPLOADS_SRC}")" "$(basename "${UPLOADS_SRC}")"; then
    echo "[backup] OK uploads: ${UP_FILE} ($(du -h "${UP_FILE}" | cut -f1))"
  else
    echo "[backup] ERROR: tar de uploads falló" >&2
    rm -f "${UP_FILE}"
    exit 1
  fi
fi

# Retención local: borra dumps/tarballs más antiguos que BACKUP_KEEP_DAYS.
DELETED="$(find "${BACKUP_DIR}" \( -name 'inventariopro-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"${BACKUP_KEEP_DAYS}" -delete -print | wc -l)"
echo "[backup] retención local: ${BACKUP_KEEP_DAYS} días (eliminados ${DELETED} antiguos)"

# ---------------------------------------------------------------------------
# Copia remota con rclone (opcional).
# ---------------------------------------------------------------------------
if [ -z "${RCLONE_REMOTE}" ]; then
  echo "[backup] RCLONE_REMOTE vacío: sin copia remota (los dumps solo están en ${BACKUP_DIR})"
  exit 0
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "[backup] ERROR: RCLONE_REMOTE configurado pero rclone no está instalado" >&2
  exit 1
fi

RCLONE_CONFIG="${RCLONE_CONFIG:-/root/.config/rclone/rclone.conf}"
if [ ! -f "${RCLONE_CONFIG}" ]; then
  echo "[backup] ERROR: no existe ${RCLONE_CONFIG} (crea ./rclone/rclone.conf desde el example). Ver DEPLOYMENT.md §7" >&2
  exit 1
fi

echo "[backup] rclone copy ${BACKUP_DIR} -> ${RCLONE_REMOTE} (retención remota: ${BACKUP_KEEP_DAYS} días)"
if rclone copy "${BACKUP_DIR}" "${RCLONE_REMOTE}" --include 'inventariopro-*.dump' --include 'uploads-*.tar.gz' --config "${RCLONE_CONFIG}"; then
  echo "[backup] copia remota OK"
else
  echo "[backup] ERROR: rclone copy falló; el backup local sigue intacto en ${BACKUP_DIR}" >&2
  exit 1
fi

# Retención remota: borra en el remote los dumps/tarballs más antiguos que N días.
# (--min-age: solo archivos más viejos que la edad indicada.)
if rclone delete "${RCLONE_REMOTE}" --min-age "${BACKUP_KEEP_DAYS}d" --include 'inventariopro-*.dump' --include 'uploads-*.tar.gz' --config "${RCLONE_CONFIG}" >/dev/null 2>&1; then
  echo "[backup] retención remota: ${BACKUP_KEEP_DAYS} días aplicada en ${RCLONE_REMOTE}"
else
  echo "[backup] aviso: no se pudo aplicar retención remota en ${RCLONE_REMOTE} — revisa los logs" >&2
fi
