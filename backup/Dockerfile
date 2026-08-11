# =============================================================================
# Contenedor de backups de InventarioPro
# =============================================================================
# Ejecuta pg_dump programado con cron (busybox crond) dentro de la red de
# docker-compose. Los dumps van a /backups (volumen compartido con el host en
# ./backups) con formato custom (-Fc, comprimido) y retención configurable.
#
# Variables de entorno:
#   POSTGRES_HOST / PORT / USER / PASSWORD / DB  - conexión (por defecto la red
#     interna del compose: host "postgres").
#   BACKUP_SCHEDULE   - expresión cron (por defecto 0 3 * * * -> 03:00 diario).
#   BACKUP_KEEP_DAYS  - días de retención de dumps (por defecto 14).
#   TZ                - zona horaria para el cron (por defecto UTC).
#   RCLONE_REMOTE     - remote rclone (p. ej. "s3backup:inventariopro") al que
#     copiar los dumps tras cada backup. Vacío = sin copia remota. La config de
#     rclone vive en ./rclone/rclone.conf del host (montada en
#     /root/.config/rclone). Ver DEPLOYMENT.md §7.
#   WATCHDOG_SCHEDULE - cron del watchdog check.sh (por defecto 7 * * * * =
#     cada hora a los :07).
#   STALE_AFTER_MIN   - minutos máximos de antigüedad del último dump antes de
#     que el watchdog (y el healthcheck) fallen (por defecto 1560 = 26 h).
#   MONITOR_PING_URL  - URL tipo healthchecks.io para heartbeat del backup y
#     alarma del watchdog. Vacío = solo logs + exit codes.
# =============================================================================

FROM postgres:16-alpine

# tzdata: para que la hora del cron respete TZ (alpine sin tzdata = UTC fijo).
# rclone: copia remota de los dumps (S3, SFTP, WebDAV, etc.).
RUN apk add --no-cache tzdata rclone

COPY backup.sh /usr/local/bin/backup
COPY check.sh /usr/local/bin/check
COPY restore.sh /usr/local/bin/restore
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /usr/local/bin/backup /usr/local/bin/check /usr/local/bin/restore /entrypoint.sh

# crond en primer plano con logs a stdout (docker logs backup).
ENTRYPOINT ["/entrypoint.sh"]
CMD ["crond", "-f", "-l", "8", "-L", "/dev/stdout"]
