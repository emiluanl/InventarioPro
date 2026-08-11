#!/bin/sh
# =============================================================================
# restore.sh - restaura un dump en la base de datos
# =============================================================================
# Uso (desde la raíz del proyecto):
#   docker compose -f docker-compose.prod.yml exec backup \
#     /usr/local/bin/restore /backups/inventariopro-YYYYMMDD-HHMMSS.dump
#
# Usa --clean --if-exists: deja la BD en el estado exacto del dump
# (elimina objetos existentes con el mismo nombre). ¡Ojo con el contenido
# actual de la BD!
# --no-owner: los objetos quedan a nombre del usuario con el que se restaura
# (el rol original del dump casi nunca existe en una BD de recuperación/DR).
# =============================================================================
set -eu

DUMP="${1:?Uso: restore /backups/ARCHIVO.dump}"

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER requerido}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD requerido}"
POSTGRES_DB="${POSTGRES_DB:-inventariopro}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

if [ ! -f "${DUMP}" ]; then
  echo "[restore] ERROR: el archivo ${DUMP} no existe" >&2
  exit 1
fi

echo "[restore] restaurando ${DUMP} en ${POSTGRES_DB}@${POSTGRES_HOST}:${POSTGRES_PORT} ..."
pg_restore --clean --if-exists --no-owner \
  -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  "${DUMP}"
echo "[restore] OK: base restaurada"
