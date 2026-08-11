# =============================================================================
# Contenedor de monitoreo de la API de InventarioPro
# =============================================================================
# Ejecuta un probe periódico (uptime.sh) contra /api/auth/me dentro de la red
# del compose y avisa (logs + MONITOR_PING_URL) si la API deja de responder.
# Ver DEPLOYMENT.md §8.
#
# Variables de entorno:
#   API_CHECK_URL     - URL a comprobar (por defecto http://backend:3001/api/auth/me).
#   CHECK_SCHEDULE    - expresión cron del probe (por defecto */5 * * * * = 5 min).
#   CHECK_RETRIES     - reintentos antes de declarar la API caída (por defecto 3).
#   RETRY_DELAY_SEC   - segundos entre reintentos (por defecto 10).
#   MONITOR_PING_URL  - URL tipo healthchecks.io para heartbeat/alarma. Vacío =
#                       solo logs + exit codes.
#   TZ                - zona horaria para el cron (por defecto UTC).
# =============================================================================

FROM alpine:3.20

# tzdata: para que el cron respete TZ. curl: probe HTTP con código de estado.
RUN apk add --no-cache tzdata curl

COPY uptime.sh /usr/local/bin/uptime
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /usr/local/bin/uptime /entrypoint.sh

# crond en primer plano con logs a stdout (docker logs monitor).
ENTRYPOINT ["/entrypoint.sh"]
CMD ["crond", "-f", "-l", "8", "-L", "/dev/stdout"]
