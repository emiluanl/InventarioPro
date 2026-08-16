#!/usr/bin/env bash
# =============================================================================
# clean-test-users.sh — lista o borra usuarios de prueba de la BD de desarrollo.
#
# Qué considera "usuario de prueba":
#   - Emails con dominio @example.com  → regla canónica: TODOS los helpers de
#     test (e2e randomEmail(), usuarios del preview) usan ese dominio.
#   - Prefijos explícitos preview-* / e2e-* (por si algún día se usa otro
#     dominio en un usuario de prueba).
#
# El borrado es DELETE por email → la cascada del esquema (onDelete: Cascade)
# limpia productos, categorías, conversaciones, notificaciones, sesiones y
# suscripciones push del usuario.
#
# NOTA: los archivos de uploads de productos borrados NO los toca este script
# (quedan huérfanos en backend/uploads — ver scripts de limpieza/T1). El e2e
# ya escribe en e2e/.tmp/uploads, así que no genera basura nueva.
#
# Uso:
#   bash scripts/clean-test-users.sh          # lista (por defecto)
#   bash scripts/clean-test-users.sh --list   # idem
#   bash scripts/clean-test-users.sh --delete            # borra (pide confirmación)
#   bash scripts/clean-test-users.sh --delete --yes      # borra sin confirmar
#
# npm:
#   npm run test-users            # lista
#   npm run test-users:clean      # borra (con confirmación)
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

POSTGRES_USER="inventariopro"
POSTGRES_CONTAINER="inventariopro-postgres-dev"
DB="inventariopro"

# Filtro SQL de "usuarios de prueba" (regla canónica + prefijos explícitos).
SQL_FILTER="(email ILIKE '%@example.com' OR email ~* '^(preview|e2e)-')"

MODE="list"
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --list) MODE="list" ;;
    --delete) MODE="delete" ;;
    --yes) ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Argumento desconocido: $arg (usa --list | --delete | --yes | -h)" >&2; exit 1 ;;
  esac
done

# --- Requisito: contenedor de Postgres dev arriba ---------------------------
if ! docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
  echo "[test-users] ERROR: el contenedor '$POSTGRES_CONTAINER' no está corriendo." >&2
  echo "[test-users] Levanta la infraestructura: docker compose up -d postgres redis" >&2
  echo "[test-users] (o 'npm start', que levanta todo el stack dev)." >&2
  exit 1
fi

psql() { docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$DB" -tA "$@"; }

# --- Listado ----------------------------------------------------------------
list_users() {
  psql -F ' | ' -c \
    "SELECT email, created_at::date,
            (SELECT count(*) FROM products p WHERE p.user_id = u.id) AS productos
     FROM users u WHERE $SQL_FILTER ORDER BY created_at"
}

echo "[test-users] BD: $DB (contenedor $POSTGRES_CONTAINER)"

TOTAL="$(psql -c "SELECT count(*) FROM users WHERE $SQL_FILTER")"
if [ "$TOTAL" = "0" ]; then
  echo "[test-users] No hay usuarios de prueba. Nada que hacer."
  exit 0
fi

echo "[test-users] Usuarios de prueba encontrados: $TOTAL"
list_users

if [ "$MODE" = "list" ]; then
  echo
  echo "[test-users] Para borrarlos: bash scripts/clean-test-users.sh --delete"
  exit 0
fi

# --- Borrado ----------------------------------------------------------------
PRODUCTS="$(psql -c "SELECT count(*) FROM products p JOIN users u ON u.id = p.user_id WHERE $SQL_FILTER")"
echo
echo "[test-users] Se van a borrar $TOTAL usuarios (y en cascada: productos = $PRODUCTS,"
echo "[test-users] categorías, conversaciones, notificaciones, sesiones y push)."

if [ "$ASSUME_YES" != "1" ]; then
  read -r -p "[test-users] ¿Confirmás el borrado? [y/N] " resp
  case "$resp" in
    y|Y|s|S) ;;
    *) echo "[test-users] Cancelado."; exit 0 ;;
  esac
fi

DELETED="$(psql -c "DELETE FROM users WHERE $SQL_FILTER")"
echo "[test-users] Borrados: $DELETED usuarios."

# Verificación: debe quedar 0.
LEFT="$(psql -c "SELECT count(*) FROM users WHERE $SQL_FILTER")"
if [ "$LEFT" != "0" ]; then
  echo "[test-users] ERROR: quedaron $LEFT usuarios de prueba sin borrar." >&2
  exit 1
fi
echo "[test-users] Verificado: 0 usuarios de prueba restantes."
echo "[test-users] Ojo: si esos usuarios tenían productos con fotos, los archivos"
echo "[test-users] quedaron huérfanos en backend/uploads (fuera del alcance de este script)."
