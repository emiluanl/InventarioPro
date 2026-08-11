#!/bin/sh
# =============================================================================
# entrypoint.sh - programa el cron del probe de la API y arranca crond.
# Permite ejecutar el probe a mano con:
#   docker compose exec monitor /usr/local/bin/uptime
# =============================================================================
set -e

CHECK_SCHEDULE="${CHECK_SCHEDULE:-*/5 * * * *}"
API_CHECK_URL="${API_CHECK_URL:-http://backend:3001/api/auth/me}"

echo "[monitor] programando probe: ${CHECK_SCHEDULE} → ${API_CHECK_URL}"
echo "${CHECK_SCHEDULE} /usr/local/bin/uptime" > /etc/crontabs/root

exec "$@"
