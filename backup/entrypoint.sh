#!/bin/sh
# =============================================================================
# entrypoint.sh - escribe la programación del cron y arranca crond en primer
# plano. El contenedor también permite ejecutar tareas puntuales con
# `docker exec inventariopro-backup /usr/local/bin/backup` o restore.
#
# Dos tareas programadas:
#   1. backup     (BACKUP_SCHEDULE, por defecto 03:00 diario) - pg_dump real.
#   2. watchdog   (WATCHDOG_SCHEDULE, por defecto cada hora) - check.sh: avisa
#      si el último dump supera STALE_AFTER_MIN minutos.
# =============================================================================
set -e

BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
WATCHDOG_SCHEDULE="${WATCHDOG_SCHEDULE:-7 * * * *}"

echo "[backup] programando backup: ${BACKUP_SCHEDULE} (pg_dump + retención ${BACKUP_KEEP_DAYS} días)"
echo "${BACKUP_SCHEDULE} /usr/local/bin/backup" > /etc/crontabs/root
echo "[backup] programando watchdog: ${WATCHDOG_SCHEDULE} (alarma si el último dump es viejo)"
echo "${WATCHDOG_SCHEDULE} /usr/local/bin/check" >> /etc/crontabs/root

exec "$@"
