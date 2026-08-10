#!/bin/sh
# =============================================================================
# backup.sh - pg_dump programado + retención
# =============================================================================
# Genera un dump en formato custom (comprimido) con fecha y hora en el nombre,
# y elimina los dumps más antiguos que BACKUP_KEEP_DAYS. Se puede ejecutar a
# mano con:
#   docker compose -f docker-compose.prod.yml exec backup /usr/local/bin/backup
# =============================================================================
set -eu

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER requerido}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD requerido}"
POSTGRES_DB="${POSTGRES_DB:-inventariopro}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

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

# Retención: borra dumps más antiguos que BACKUP_KEEP_DAYS.
DELETED="$(find "${BACKUP_DIR}" -name 'inventariopro-*.dump' -mtime +"${BACKUP_KEEP_DAYS}" -delete -print | wc -l)"
echo "[backup] retención: ${BACKUP_KEEP_DAYS} días (eliminados ${DELETED} antiguos)"
