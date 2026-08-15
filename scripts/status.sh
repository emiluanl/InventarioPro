#!/usr/bin/env bash
# =============================================================================
# status.sh — muestra qué servicios de InventarioPro están corriendo.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== InventarioPro: estado =="

probe() { # probe <puerto> <nombre>
  if node -e "const n=require('net').connect(Number(process.argv[1]),'127.0.0.1');n.on('connect',()=>process.exit(0));n.on('error',()=>process.exit(1))" "$1" >/dev/null 2>&1; then
    printf '  [OK]     %s (puerto %s)\n' "$2" "$1"
  else
    printf '  [parado] %s (puerto %s)\n' "$2" "$1"
  fi
}

probe 3001 "API (backend)"
probe 3010 "Web (frontend)"
probe 5432 "Postgres"
probe 6379 "Redis"

if command -v docker >/dev/null 2>&1; then
  echo
  echo "== Contenedores (docker compose) =="
  docker compose ps 2>/dev/null || echo "  (Docker no disponible)"
fi
