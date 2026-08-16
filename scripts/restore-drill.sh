#!/usr/bin/env bash
# =============================================================================
# restore-drill.sh — drill de restauración (valida que un backup se puede
# restaurar ANTES de necesitarlo).
# =============================================================================
# Automatiza el procedimiento manual de DEPLOYMENT.md §9 punto 5 en un comando:
#   1. Sanidad del dump (pg_restore --list) dentro de un contenedor efímero.
#   2. Restauración real en una BD descartable (--clean --if-exists --no-owner,
#      igual que backup/restore.sh).
#   3. Verificación: conteos de users/products/categories + una fila de muestra.
#   4. Si se pasa un tar de uploads (--uploads), verificación BÁSICA: lista el
#      contenido y cuenta archivos (no extrae ni compara los archivos
#      restaurados — eso queda como extensión futura del drill).
#   5. Limpieza total (el contenedor efímero se elimina SIEMPRE, pase o falle).
#
# Uso:
#   scripts/restore-drill.sh                     # dump más reciente de ../backups
#   scripts/restore-drill.sh /ruta/al.dump       # dump explícito
#   scripts/restore-drill.sh /ruta/al.dump --uploads /ruta/uploads-*.tar.gz
#
# Requiere: docker (usa postgres:16-alpine, el mismo que el compose de prod).
# NO toca la base de producción: todo ocurre en un contenedor descartable.
# =============================================================================
set -euo pipefail

# En Git Bash/Windows, MSYS convierte los paths POSIX de los args de docker
# (p. ej. /dump/drill.dump) a rutas Windows y el contenedor recibe un path
# inexistente. Esto desactiva esa conversión SOLO para los comandos docker
# (en Linux la variable se ignora).
export MSYS_NO_PATHCONV=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

UPLOADS_TAR=""
DUMP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --uploads)
      UPLOADS_TAR="${2:?--uploads requiere una ruta al tar.gz}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,24p' "$0"
      exit 0
      ;;
    *)
      [ -z "$DUMP" ] || { echo "ERROR: solo se acepta un dump." >&2; exit 1; }
      DUMP="$1"
      shift
      ;;
  esac
done

if [ -z "$DUMP" ]; then
  DUMP="$(ls -t ../backups/inventariopro-*.dump 2>/dev/null | head -1 || true)"
  if [ -z "$DUMP" ]; then
    echo "ERROR: no encontré dumps en ../backups. Pasá la ruta: scripts/restore-drill.sh /ruta/al.dump" >&2
    exit 1
  fi
  echo "[drill] Dump más reciente: $DUMP"
fi

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker es obligatorio." >&2; exit 1; }
[ -f "$DUMP" ] || { echo "ERROR: el dump no existe: $DUMP" >&2; exit 1; }

TAG="postgres:16-alpine"
CID="inventariopro-restore-drill-$$"
DUMP_DIR="$(cd "$(dirname "$DUMP")" && pwd)"
DUMP_FILE="$(basename "$DUMP")"
# En Git Bash/Windows el path del volumen debe ser Windows; en Linux queda igual.
DUMP_DIR_HOST="$(cygpath -w "$DUMP_DIR" 2>/dev/null || echo "$DUMP_DIR")"

cleanup() {
  docker rm -f "$CID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[drill] 1/5 Levantando BD descartable ($TAG)…"
docker run -d --name "$CID" \
  -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drillpass -e POSTGRES_DB=drilldb \
  -v "$DUMP_DIR_HOST:/dump:ro" \
  "$TAG" >/dev/null

echo "[drill] 2/5 Esperando a que postgres esté listo…"
READY=false
for _ in $(seq 1 30); do
  if docker exec "$CID" pg_isready -U drill -d drilldb >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 1
done
[ "$READY" = true ] || { echo "ERROR: postgres efímero no levantó a tiempo." >&2; exit 1; }

echo "[drill] 3/5 Sanidad del dump (pg_restore --list)…"
docker exec "$CID" pg_restore --list "/dump/$DUMP_FILE" >/dev/null \
  || { echo "ERROR: el dump está corrupto o no es un dump de pg_dump." >&2; exit 1; }

echo "[drill] 4/5 Restaurando en la BD descartable (--clean --if-exists --no-owner)…"
docker exec "$CID" pg_restore --clean --if-exists --no-owner \
  -U drill -d drilldb "/dump/$DUMP_FILE" >/dev/null

echo "[drill] 5/5 Verificando contenido restaurado…"
count() {
  docker exec "$CID" psql -U drill -d drilldb -tA -c "SELECT count(*) FROM $1"
}
USERS="$(count users)"
PRODUCTS="$(count products)"
CATEGORIES="$(count categories)"
SAMPLE="$(docker exec "$CID" psql -U drill -d drilldb -tA -c \
  'SELECT nombre FROM products ORDER BY created_at DESC LIMIT 1' || true)"

echo "  users:      $USERS"
echo "  products:   $PRODUCTS"
echo "  categories: $CATEGORIES"
[ -n "$SAMPLE" ] && echo "  muestra:    $SAMPLE"  if [ -n "$UPLOADS_TAR" ]; then
    if [ ! -f "$UPLOADS_TAR" ]; then
      echo "ERROR: el tar de uploads no existe: $UPLOADS_TAR" >&2
      exit 1
    fi
    N_FILES="$(tar -tzf "$UPLOADS_TAR" 2>/dev/null | grep -v '/$' | wc -l)"
    echo "[drill] Uploads (verificación básica): $UPLOADS_TAR → $N_FILES archivos"
    echo "[drill]   (solo lista el contenido; no extrae ni compara los archivos)"
    [ "$N_FILES" -gt 0 ] || { echo "ERROR: el tar de uploads está vacío." >&2; exit 1; }
  fi

echo
echo "[drill] ✅ OK — el dump restaura sin errores (users=$USERS, products=$PRODUCTS)."
echo "[drill]    Contenedor efímero eliminado; la producción no se tocó."
