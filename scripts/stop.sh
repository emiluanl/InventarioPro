#!/usr/bin/env bash
# =============================================================================
# stop.sh — detiene los servicios de infraestructura de desarrollo
# (postgres/redis de docker compose). Los datos se conservan en los volúmenes.
# La API y la web se detienen con Ctrl+C en la terminal de npm start.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[stop] Deteniendo postgres/redis de desarrollo (los datos se conservan en los volúmenes)…"
if command -v docker >/dev/null 2>&1 && docker compose down >/dev/null 2>&1; then
  echo "[stop] Listo: contenedores detenidos."
else
  echo "[stop] No había contenedores que detener (o Docker no está disponible)."
fi
