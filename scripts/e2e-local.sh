#!/usr/bin/env bash
# =============================================================================
# test:e2e:local — e2e de Playwright contra el stack de desarrollo local.
#
# Hace el ciclo completo (igual que en la sección E2E del README):
#   1. Levanta el stack dev (docker compose up -d). El e2e conecta a
#      localhost:5432/6379, que es lo que publica el Postgres/Redis dev.
#   2. Espera a que postgres y redis estén healthy.
#   3. Crea la BD inventariopro_e2e si aún no existe.
#   4. Corre Playwright (pasa argumentos extra, p. ej. --trace=on).
#   5. Baja el stack dev siempre (los volúmenes persisten).
#
# Uso:  npm run test:e2e:local
#       npm run test:e2e:local -- --trace=on
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

POSTGRES_USER="inventariopro"
POSTGRES_CONTAINER="inventariopro-postgres-dev"
E2E_DB="inventariopro_e2e"

# Bajar el stack al salir (pase o falle) sin enmascarar el exit code de Playwright.
cleanup() {
  echo "[e2e:local] Bajando el stack dev (los volúmenes persisten)…"
  docker compose down >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[e2e:local] Levantando el stack dev…"
docker compose up -d

echo "[e2e:local] Esperando a que postgres/redis estén healthy…"
for _ in $(seq 1 30); do
  pg_ok="$(docker inspect -f '{{.State.Health.Status}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)"
  redis_ok="$(docker inspect -f '{{.State.Health.Status}}' inventariopro-redis-dev 2>/dev/null || true)"
  if [ "$pg_ok" = "healthy" ] && [ "$redis_ok" = "healthy" ]; then
    break
  fi
  sleep 2
done

if [ "$pg_ok" != "healthy" ] || [ "$redis_ok" != "healthy" ]; then
  echo "[e2e:local] ERROR: postgres/redis no quedaron healthy a tiempo (pg=$pg_ok, redis=$redis_ok)." >&2
  docker compose ps
  exit 1
fi
echo "[e2e:local] postgres/redis healthy."

echo "[e2e:local] Verificando la BD ${E2E_DB}…"
if ! docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '${E2E_DB}'" | grep -q 1; then
  echo "[e2e:local] Creando la BD ${E2E_DB}…"
  docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d postgres \
    -c "CREATE DATABASE ${E2E_DB}"
fi

echo "[e2e:local] Corriendo Playwright…"
npx playwright test "$@"
