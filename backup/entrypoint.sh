#!/bin/sh
# =============================================================================
# entrypoint.sh - escribe la programación del cron y arranca crond en primer
# plano. El contenedor también permite ejecutar tareas puntuales con
# `docker exec inventariopro-backup /usr/local/bin/backup` o restore.
# =============================================================================
set -e

BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

echo "[backup] programando: ${BACKUP_SCHEDULE} (pg_dump + retención ${BACKUP_KEEP_DAYS} días)"
echo "${BACKUP_SCHEDULE} /usr/local/bin/backup" > /etc/crontabs/root

exec "$@"
