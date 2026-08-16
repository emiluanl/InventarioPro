#!/usr/bin/env bash
# =============================================================================
# start.sh — arranca InventarioPro como una app normal, desde la raíz del repo.
#
#   npm start              → levanta BD + API + web (un solo comando)
#   npm start -- --no-open → igual, pero sin abrir el navegador
#   npm start -- --sqlite  → fuerza el modo SQLite (sin Docker)
#   npm run stop           → detiene los servicios (postgres/redis dev)
#   npm run status         → muestra qué está corriendo
#
# Qué hace exactamente:
#   1. Crea backend/.env y frontend/.env desde los .env.example si faltan
#      (los valores de desarrollo ya funcionan sin cambios).
#   2. Instala dependencias la primera vez (backend y frontend).
#   3. Base de datos, en este orden de preferencia:
#        a. PostgreSQL si ya responde en el DATABASE_URL (por defecto :5432)
#           — se reutiliza sin tocar Docker.
#        b. PostgreSQL + Redis con Docker (docker compose, solo infraestructura).
#        c. SQLite (backend/prisma/dev.db) — SIN DOCKER EN ABSOLUTO: se usa
#           solo cuando no hay Postgres ni Docker, o con --sqlite. El cliente
#           Prisma se regenera para SQLite al arrancar y se restaura el de
#           Postgres al salir (el árbol de git queda como estaba).
#   4. Aplica las migraciones de Prisma pendientes (idempotente, del proveedor activo).
#   5. Arranca el backend (Nest, :3001) y el frontend (Next, :3010) como
#      procesos locales con logs unificados. Ctrl+C detiene todo.
#
# Los datos persisten entre ejecuciones: volúmenes de Docker (postgres/redis),
# backend/prisma/dev.db (SQLite) y ./backend/uploads (fotos).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OPEN_BROWSER=1
SQLITE_MODE=false
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_BROWSER=0 ;;
    --sqlite) SQLITE_MODE=true ;;
  esac
done

log()  { printf '\033[1;34m[start]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[start]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[start]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[start]\033[0m ERROR: %s\n' "$*" >&2; exit 1; }

# Al salir (Ctrl+C o fallo) mata API, web y watchers.
# En Git Bash/Windows, kill 0 no llega a los procesos nativos node.exe (los
# fork de MSYS no los ve Windows), así que la limpieza usa netstat → taskkill
# /T anclado al listener de cada puerto, que sí mata todo el árbol nativo
# (verificado: nest --watch no reinicia). En Linux/macOS basta kill 0.
cleanup() {
  trap - EXIT INT TERM
  # 0) Modo SQLite: restaura el cliente Prisma de PostgreSQL (el commiteado)
  #    para dejar el árbol de git como estaba. Va PRIMERO porque el kill 0 de
  #    abajo mata también a este script y no llegaría a ejecutarse después.
  #    git checkout es byte-exacto; si no hay git, se regenera con Postgres.
  if [ "$SQLITE_MODE" = true ]; then
    if ! git checkout -- backend/src/generated/prisma 2>/dev/null; then
      (cd backend && npx prisma generate) >/dev/null 2>&1 \
        || warn "No se pudo restaurar el cliente Prisma de Postgres. Ejecuta: cd backend && npx prisma generate"
    fi
  fi
  # 0b) Next regenera frontend/next-env.d.ts al arrancar (next dev lo apunta a
  #     .next/dev/types, next build a .next/types) → el árbol queda "sucio" con
  #     un diff que no representa un cambio real. Se restaura el estado
  #     commiteado al salir (mismo patrón que e2e/start-frontend.cjs). Va antes
  #     del kill de procesos: en Windows el taskkill de abajo mata este script y
  #     no llegaría a ejecutarse después.
  git checkout -- frontend/next-env.d.ts 2>/dev/null || true
  # 1) Windows: mata el árbol nativo que escucha en los puertos de la app.
  if command -v netstat >/dev/null 2>&1 && command -v taskkill >/dev/null 2>&1; then
    for port in "$BACKEND_PORT" 3010; do
      local listener
      listener="$(netstat -ano 2>/dev/null | awk -v p=":$port " '$0 ~ p && $4 ~ /LISTEN/ {print $NF; exit}')"
      if [ -n "$listener" ]; then
        taskkill //F //T //PID "$listener" >/dev/null 2>&1 || true
      fi
    done
  fi
  # 2) Linux/macOS (y wrappers MSYS): mata el grupo de procesos.
  if [ -n "$(jobs -p)" ]; then
    kill 0 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  # No redefinir el exit status: si el script falló, que se propague.
}
trap cleanup EXIT INT TERM

# --- 1. Requisitos -----------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js 20.9+ es obligatorio y no está en el PATH."
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 20 ] || die "Se necesita Node.js 20.9+ (tienes $(node --version))."

DOCKER_OK=false
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  DOCKER_OK=true
fi

# --- 2. .env desde los ejemplos (defaults de dev ya funcionan) ---------------
CREATED_BACKEND_ENV=false
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  CREATED_BACKEND_ENV=true
  log "Creado backend/.env desde backend/.env.example."
fi
if [ ! -f frontend/.env ]; then
  cp frontend/.env.example frontend/.env
  log "Creado frontend/.env desde frontend/.env.example."
fi

# Sin Docker no habrá Redis; el backend tiene modo no-op documentado
# (backend/src/common/redis.service.ts): rate limiting en memoria.
if [ "$CREATED_BACKEND_ENV" = true ] && [ "$DOCKER_OK" = false ]; then
  sed -i 's|^REDIS_HOST=localhost$|# REDIS_HOST=localhost  # desactivado: sin Docker/Redis (modo no-op)|' backend/.env
  warn "Redis no disponible (sin Docker): el backend queda en modo no-op (rate limiting en memoria)."
fi

# --- 3. Dependencias (solo la primera vez) ----------------------------------
ensure_deps() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    log "Instalando dependencias de $dir (primera vez, puede tardar)…"
    (cd "$dir" && npm install --no-audit --no-fund)
  fi
}
ensure_deps backend
ensure_deps frontend

# --- 4. Puertos libres -------------------------------------------------------
# Puertos/URLs se leen del .env del backend/frontend para que una variable
# ambiental del shell (p. ej. PORT=0 exportado) no los pise: las variables de
# entorno tienen prioridad sobre el .env en Node, así que se fijan al lanzar.
BACKEND_PORT="$(sed -n 's/^PORT=//p' backend/.env 2>/dev/null | head -1)"
[ -n "$BACKEND_PORT" ] || BACKEND_PORT=3001

port_in_use() {
  node -e "const n=require('net').connect(Number(process.argv[1]),'127.0.0.1');n.on('connect',()=>process.exit(0));n.on('error',()=>process.exit(1))" "$1"
}
if port_in_use "$BACKEND_PORT"; then die "El puerto $BACKEND_PORT (API) ya está en uso. Detén el otro proceso y reintenta."; fi
if port_in_use 3010; then die "El puerto 3010 (frontend) ya está en uso. Detén el otro proceso y reintenta."; fi

# --- 5. Base de datos --------------------------------------------------------
DB_URL="$(sed -n 's/^DATABASE_URL=//p' backend/.env 2>/dev/null | head -1)"
[ -n "$DB_URL" ] || DB_URL="postgresql://inventariopro:inventariopro@localhost:5432/inventariopro?schema=public"
# Relativa al cwd del backend (backend/prisma/dev.db, ya en .gitignore).
SQLITE_DB_URL="file:./prisma/dev.db"

db_ready() {
  (cd backend && DATABASE_URL="$DB_URL" node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 });
    c.connect().then(() => c.query('SELECT 1')).then(() => process.exit(0)).catch(() => process.exit(1));
  ") >/dev/null 2>&1
}

if [ "$SQLITE_MODE" = true ]; then
  log "Modo SQLite forzado (--sqlite): la app corre sin Docker."
elif db_ready; then
  ok "Postgres detectado en $DB_URL — lo reutilizo (no toco Docker)."
  if [ "$DOCKER_OK" = true ]; then
    docker compose up -d redis >/dev/null 2>&1 \
      || warn "Redis dev no se levantó (¿puerto 6379 ocupado?): el backend seguirá funcionando igual."
  fi
elif [ "$DOCKER_OK" = true ]; then
  log "Levantando postgres + redis con Docker…"
  docker compose up -d postgres redis
  for _ in $(seq 1 60); do
    db_ready && break
    sleep 2
  done
  db_ready || {
    docker compose logs postgres 2>/dev/null | tail -20 || true
    die "Postgres no quedó listo a tiempo (revisa los logs de arriba)."
  }
  ok "Postgres y Redis listos."
else
  SQLITE_MODE=true
  warn "Sin Postgres ni Docker disponible: cambio automático al modo SQLite (sin Docker)."
fi

# --- 6. Cliente Prisma + migraciones (del proveedor activo) ------------------
if [ "$SQLITE_MODE" = true ]; then
  log "SQLite: generando cliente Prisma y aplicando migraciones (backend/prisma/dev.db)…"
  (cd backend && DB_PROVIDER=sqlite DATABASE_URL="$SQLITE_DB_URL" npx prisma generate) >/dev/null 2>&1 \
    || die "Fallo al generar el cliente Prisma para SQLite (revisa backend/prisma/schema.sqlite.prisma)."
  (cd backend && DB_PROVIDER=sqlite DATABASE_URL="$SQLITE_DB_URL" npx prisma migrate deploy) \
    || die "Fallo al aplicar las migraciones SQLite."
  ok "SQLite listo (backend/prisma/dev.db)."
else
  log "Aplicando migraciones de Prisma pendientes…"
  npm --prefix backend run prisma:migrate:deploy
fi

# --- 7. Arrancar API + web ---------------------------------------------------
API_URL_FRONT="$(sed -n 's/^NEXT_PUBLIC_API_URL=//p' frontend/.env 2>/dev/null | head -1)"
[ -n "$API_URL_FRONT" ] || API_URL_FRONT="http://localhost:3001/api"

# Env del backend por modo. Se fijan aquí (no solo en .env) para que ninguna
# variable ambiental del shell (p. ej. PORT=0 exportado) las pise.
# SMTP vacío = email en modo consola: los enlaces de verificación aparecen en
# los logs [backend] (si el .env trae SMTP real, este arranque local no lo usa).
# APP_BASE_URL fijado al frontend local (:3010): los enlaces de los emails
# (verificación, reset) apuntan a la web que este script levanta, aunque el
# .env traiga otro valor (p. ej. de una corrida e2e).
BACKEND_ENV=(PORT="$BACKEND_PORT" APP_BASE_URL="http://localhost:3010" SMTP_HOST= SMTP_USER= SMTP_PASSWORD=)
if [ "$SQLITE_MODE" = true ]; then
  BACKEND_ENV+=(DB_PROVIDER=sqlite DATABASE_URL="$SQLITE_DB_URL")
  if port_in_use 6379; then
    BACKEND_ENV+=(REDIS_HOST=localhost)
  else
    BACKEND_ENV+=(REDIS_HOST=)
    warn "Redis no disponible: backend en modo no-op (rate limiting en memoria)."
  fi
else
  BACKEND_ENV+=(DATABASE_URL="$DB_URL")
fi
if grep -qE '^SMTP_HOST=.+' backend/.env 2>/dev/null; then
  warn "Email en modo consola (desarrollo): los enlaces de verificación aparecen en los logs [backend]."
fi

log "Arrancando backend (http://localhost:$BACKEND_PORT) y frontend (http://localhost:3010)…"
( cd backend  && env "${BACKEND_ENV[@]}" npm run start:dev ) 2>&1 | sed -u 's/^/[backend]  /' &
BACKEND_PID=$!
( cd frontend && NEXT_PUBLIC_API_URL="$API_URL_FRONT" npm run dev ) 2>&1 | sed -u 's/^/[frontend] /' &
FRONTEND_PID=$!

log "Esperando a que los servicios respondan…"
BACK_OK=false
FRONT_OK=false
for _ in $(seq 1 90); do
  if [ "$BACK_OK" = false ] && curl -sf --max-time 2 "http://localhost:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
    BACK_OK=true
    ok "API lista en http://localhost:$BACKEND_PORT/api"
  fi
  if [ "$FRONT_OK" = false ] && curl -sf --max-time 2 -o /dev/null http://localhost:3010 >/dev/null 2>&1; then
    FRONT_OK=true
    ok "Web lista en http://localhost:3010"
  fi
  [ "$BACK_OK" = true ] && [ "$FRONT_OK" = true ] && break
  sleep 1
done

if [ "$BACK_OK" = true ] && [ "$FRONT_OK" = true ]; then
  echo
  ok "InventarioPro está corriendo:"
  ok "   App → http://localhost:3010   (API → http://localhost:$BACKEND_PORT/api)"
  warn "Ctrl+C detiene todo (la base de datos queda guardada)."
  echo
  if [ "$OPEN_BROWSER" = 1 ]; then
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*) cmd.exe /c start "" "http://localhost:3010" >/dev/null 2>&1 || true ;;
      Darwin*) open "http://localhost:3010" ;;
      Linux*) command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:3010" || true ;;
    esac
  fi
else
  die "Algún servicio no respondió a tiempo (backend=$BACK_OK, frontend=$FRONT_OK). Revisa los logs de arriba."
fi

# Watchdog: vigila que API y web sigan respondiendo mientras el script vive.
# Un servicio que muere se detecta POR PUERTO aunque su pipeline quede colgada
# (en Windows, matar el proceso nativo con taskkill deja el wait de MSYS
# bloqueado para siempre). Se toleran los reinicios breves de watch-mode
# (nest/next recompilan reiniciando el proceso unos segundos): hacen falta 12
# chequeos fallidos (~36 s+ de silencio) para declarar el fallo.
DEAD_STRIKES=0
while true; do
  sleep 3
  if curl -sf --max-time 2 "http://localhost:$BACKEND_PORT/api/health" >/dev/null 2>&1 \
    && curl -sf --max-time 2 -o /dev/null http://localhost:3010 >/dev/null 2>&1; then
    DEAD_STRIKES=0
  else
    DEAD_STRIKES=$((DEAD_STRIKES + 1))
    if [ "$DEAD_STRIKES" -ge 12 ]; then
      die "Un servicio dejó de responder (backend:$BACKEND_PORT o frontend:3010). Revisa los logs de arriba."
    fi
  fi
done
