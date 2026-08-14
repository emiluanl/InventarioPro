#!/usr/bin/env bash
# =============================================================================
# verify-prod-health — Verificación de salud del stack de PRODUCCIÓN.
#
# Pensado para ejecutarse justo después de abrir Docker Desktop (o tras un
# deploy), para confirmar en un solo comando que:
#   1. Docker está arriba y el stack prod está corriendo.
#   2. Todos los contenedores de prod están "healthy" (o el estado esperado).
#   3. El job one-shot `migrate` sigue operativo (idempotente, exit 0).
#   4. La API responde con BD y Redis arriba.
#   5. Los datos NO se perdieron (conteos mínimos en la BD real).
#
# Uso:
#   bash scripts/verify-prod-health.sh            # verificación completa
#   bash scripts/verify-prod-health.sh --quick    # solo healthchecks + API
#   EXPECT_USERS=1 EXPECT_PRODUCTS=1 EXPECT_CATEGORIES=1 bash scripts/verify-prod-health.sh
#
# Salida: exit 0 si todo OK; exit 1 si algo falla (pensado para CI/scripts).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"
QUICK="${1:-full}"  # --quick solo salta la parte de datos

# ---------------------------------------------------------------------------
# 0. Docker arriba
# ---------------------------------------------------------------------------
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker NO está arriba. Abre Docker Desktop y reintenta."
  exit 1
fi
echo "✅ Docker arriba"

# ---------------------------------------------------------------------------
# 1. Stack prod corriendo
# ---------------------------------------------------------------------------
SERVICES="postgres redis backend frontend backup monitor caddy"
MISSING=""
for s in $SERVICES; do
  name="inventariopro-$s"
  if ! docker inspect "$name" > /dev/null 2>&1; then
    MISSING="$MISSING $s"
  fi
done
if [ -n "$MISSING" ]; then
  echo "❌ Contenedores ausentes:$MISSING"
  echo "   Levanta el stack: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d"
  exit 1
fi
echo "✅ Stack prod presente (8 servicios)"

# ---------------------------------------------------------------------------
# 2. Healthchecks de los servicios con healthcheck definido
# ---------------------------------------------------------------------------
FAIL=0
for s in $SERVICES; do
  name="inventariopro-$s"
  state=$(docker inspect -f '{{.State.Status}}' "$name")
  if [ "$state" != "running" ]; then
    echo "❌ $name: estado '$state' (esperado running)"
    FAIL=1
    continue
  fi
  has_health=$(docker inspect -f '{{if .State.Health}}si{{else}}no{{end}}' "$name")
  if [ "$has_health" = "si" ]; then
    health=$(docker inspect -f '{{.State.Health.Status}}' "$name")
    if [ "$health" != "healthy" ]; then
      echo "❌ $name: healthcheck '$health'"
      FAIL=1
    else
      echo "✅ $name: healthy"
    fi
  else
    echo "➖ $name: running (sin healthcheck)"
  fi
done
if [ "$FAIL" -ne 0 ]; then
  echo "❌ Algunos contenedores no están healthy. Revisa: docker compose -f $COMPOSE_FILE logs -f"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. API: healthcheck con BD y Redis
# ---------------------------------------------------------------------------
# Por la red interna (como lo ve el monitor), sin depender del puerto público.
backend_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' inventariopro-backend | head -n1)
if [ -n "$backend_ip" ]; then
  health_json=$(docker exec inventariopro-monitor sh -c "wget -qO- http://backend:3001/api/health 2>/dev/null" 2>/dev/null || true)
  if [ -z "$health_json" ]; then
    health_json=$(curl -s -m 5 "http://localhost:3001/api/health" 2>/dev/null || true)
  fi
else
  health_json=$(curl -s -m 5 "http://localhost:3001/api/health" 2>/dev/null || true)
fi

if echo "$health_json" | grep -q '"db":"up"' && echo "$health_json" | grep -q '"redis":"up"'; then
  echo "✅ API: $health_json"
else
  echo "❌ API no responde con BD/Redis arriba: ${health_json:-vacío}"
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Job migrate idempotente (no toca nada si no hay migraciones pendientes)
# ---------------------------------------------------------------------------
if [ "$QUICK" = "--quick" ]; then
  echo "ℹ️  Modo --quick: omitiendo migrate y verificación de datos."
  echo "✅ Verificación rápida completa"
  exit 0
fi

echo "── Ejecutando job migrate (idempotente)..."
if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm migrate; then
  echo "✅ migrate: exit 0"
else
  echo "❌ migrate falló"
  exit 1
fi

# ---------------------------------------------------------------------------
# 5. Datos intactos (conteos mínimos, configurables por env)
# ---------------------------------------------------------------------------
EXPECT_USERS="${EXPECT_USERS:-1}"
EXPECT_PRODUCTS="${EXPECT_PRODUCTS:-1}"
EXPECT_CATEGORIES="${EXPECT_CATEGORIES:-1}"

# Credenciales reales: se leen del .env.prod local (igual que el compose),
# con fallback a los valores por defecto del compose.
PG_USER=$(grep -E '^POSTGRES_USER=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
PG_USER=${PG_USER:-inventariopro}
PG_DB=$(grep -E '^POSTGRES_DB=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
PG_DB=${PG_DB:-inventariopro}

count() {
  # $1 = tabla; devuelve el conteo real desde el Postgres de prod
  docker exec inventariopro-postgres \
    psql -U "$PG_USER" -d "$PG_DB" -tAc \
    "SELECT count(*) FROM $1;" 2>/dev/null | tr -d ' ' || echo "?"
}

USERS=$(count '"users"')
PRODUCTS=$(count '"products"')
CATEGORIES=$(count '"categories"')

echo "📊 Datos de prod: $USERS users | $PRODUCTS products | $CATEGORIES categories"

FAIL=0
[ "$USERS" -ge "$EXPECT_USERS" ]       || { echo "❌ users: $USERS < $EXPECT_USERS"; FAIL=1; }
[ "$PRODUCTS" -ge "$EXPECT_PRODUCTS" ] || { echo "❌ products: $PRODUCTS < $EXPECT_PRODUCTS"; FAIL=1; }
[ "$CATEGORIES" -ge "$EXPECT_CATEGORIES" ] || { echo "❌ categories: $CATEGORIES < $EXPECT_CATEGORIES"; FAIL=1; }
[ "$FAIL" -eq 0 ] && echo "✅ Datos intactos"

# ---------------------------------------------------------------------------
# Resumen final
# ---------------------------------------------------------------------------
if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "✅✅ Stack prod verificado: healthy, migrate OK y datos intactos."
  exit 0
else
  echo ""
  echo "❌❌ Verificación con fallos."
  exit 1
fi
