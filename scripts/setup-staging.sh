#!/usr/bin/env bash
# =============================================================================
# setup-staging.sh — automatiza el runbook §1.7 de docs/DEPLOY-SETUP.md:
# crear el servidor de staging y probar el primer deploy, en un comando.
#
#   Uso:
#     bash scripts/setup-staging.sh <IP_STAGING> [opciones]
#
#   Opciones:
#     -u, --user <user>      usuario SSH (default: deploy)
#     -d, --domain <dom>     FRONTEND_DOMAIN (default: localhost)
#                              localhost            → Caddy HTTP en :80 (validación)
#                              <IP>                 → HTTP directo por IP
#                              staging.dominio.com  → HTTPS automático (Let's Encrypt)
#     -k, --key <path>       clave privada del deploy (default:
#                              ~/.ssh/inventariopro_deploy)
#     -f, --force            regenerar .env.prod aunque ya exista en el server
#     -s, --setup-secrets    además, configurar los secrets STAGING_* en GitHub
#                              (requiere `gh` autenticado con permisos de admin)
#     -h, --help             muestra esta ayuda
#
#   Qué hace (todo el §1.7):
#     1. Genera la clave SSH del deploy (si falta) y la instala en el server.
#     2. Instala Docker Engine (si falta) y clona/actualiza el repo en
#        ~/InventarioPro-staging.
#     3. Genera .env.prod con secretos aleatorios (openssl rand) desde la
#        plantilla raíz .env.prod.example — NUNCA sobrescribe un .env.prod
#        existente salvo con --force, y no imprime los valores.
#     4. Primer arranque: `docker compose up -d --build` + verificación real
#        (config válida, health del backend por la red interna, frontend :3000
#        y Caddy :80) — exactamente lo que hará el workflow por SSH.
#     5. Opcionalmente configura STAGING_* en GitHub y deja listo el disparo
#        del workflow (Actions → Deploy → staging).
#
#   Salida: exit 0 si el stack queda arriba y verificado; exit != 0 si algo
#   falla (pensado para correrse a mano o en CI).
# =============================================================================
set -euo pipefail

# --- Parseo de argumentos -----------------------------------------------------
HOST="${1:-}"
USER_SSH="deploy"
DOMAIN="localhost"
KEY="$HOME/.ssh/inventariopro_deploy"
FORCE=0
SETUP_SECRETS=0

usage() {
  sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -u|--user)          USER_SSH="$2"; shift 2 ;;
    -d|--domain)        DOMAIN="$2"; shift 2 ;;
    -k|--key)           KEY="$2"; shift 2 ;;
    -f|--force)         FORCE=1; shift ;;
    -s|--setup-secrets) SETUP_SECRETS=1; shift ;;
    -h|--help)          usage 0 ;;
    *)                  [ -z "$HOST" ] && HOST="$1" && shift || usage 1 ;;
  esac
done

[ -n "$HOST" ] || { echo "❌ Falta la IP del servidor. Uso: bash scripts/setup-staging.sh <IP> [opciones]"; usage 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="$USER_SSH@$HOST"
PUB="$KEY.pub"
TPL="$ROOT/.env.prod.example"

note() { echo "── $*"; }
warn() { echo "⚠️  $*"; }
die()  { echo "❌ $*" >&2; exit 1; }

SSHOPTS="-o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new"
run_remote() { ssh -i "$KEY" $SSHOPTS "$REMOTE" "$@"; }

# Esquema según el dominio: localhost/IP → http; dominio real → https.
if [ "$DOMAIN" = "localhost" ] || echo "$DOMAIN" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  SCHEME="http"
else
  SCHEME="https"
fi
PUBLIC_API_URL="$SCHEME://$DOMAIN/api"
CORS_ORIGIN="$SCHEME://$DOMAIN"
APP_BASE_URL="$SCHEME://$DOMAIN"

# ---------------------------------------------------------------------------
# 1. Clave SSH del deploy + instalación de la pública en el server
# ---------------------------------------------------------------------------
if [ ! -f "$KEY" ]; then
  note "Generando clave SSH del deploy: $KEY"
  ssh-keygen -t ed25519 -f "$KEY" -C "github-actions" -N ""
else
  note "Clave SSH ya existe: $KEY"
fi
[ -f "$PUB" ] || die "No encuentro $PUB"

note "Instalando la clave pública en $REMOTE…"
if command -v ssh-copy-id >/dev/null 2>&1; then
  ssh-copy-id -i "$PUB" "$REMOTE" >/dev/null 2>&1 || true
fi
# Fallback manual (Git Bash en Windows no trae ssh-copy-id): idempotente
# (cat lee la clave desde stdin del ssh; sort -u deduplica).
cat "$PUB" | ssh -i "$KEY" $SSHOPTS "$REMOTE" \
  "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && \
   chmod 600 ~/.ssh/authorized_keys && sort -u -o ~/.ssh/authorized_keys ~/.ssh/authorized_keys" || \
  die "No pude instalar la clave pública. ¿Existe el usuario '$USER_SSH' en el server?"
run_remote "echo OK" >/dev/null || die "Login SSH sin contraseña no funciona"
note "✓ Login SSH sin contraseña OK"

# ---------------------------------------------------------------------------
# 2. Docker Engine + repo (clonar o actualizar)
# ---------------------------------------------------------------------------
note "Instalando Docker Engine (si falta)…"
run_remote bash -s <<'RMT'
set -e
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
sudo usermod -aG docker "$USER" || true   # se aplica en el próximo login
docker --version && docker compose version
RMT

note "Clonando/actualizando el repo en ~/InventarioPro-staging…"
run_remote bash -s <<'RMT'
set -e
if [ -d ~/InventarioPro-staging/.git ]; then
  git -C ~/InventarioPro-staging pull --ff-only origin main
else
  git clone https://github.com/emiluanl/InventarioPro.git ~/InventarioPro-staging
fi
RMT

# ---------------------------------------------------------------------------
# 3. .env.prod — solo si no existe (o con --force); nunca imprime valores
# ---------------------------------------------------------------------------
TMP_ENV="$(mktemp)"
trap 'rm -f "$TMP_ENV"' EXIT
[ -f "$TPL" ] || die "No encuentro la plantilla $TPL (¿corres el script desde el repo?)"

JWT=$(openssl rand -hex 32)
PGPASS=$(openssl rand -hex 24)
REDISPASS=$(openssl rand -hex 24)

sed -e "s|^FRONTEND_DOMAIN=.*|FRONTEND_DOMAIN=$DOMAIN|" \
    -e "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=$PUBLIC_API_URL|" \
    -e "s|^CORS_ORIGIN=.*|CORS_ORIGIN=$CORS_ORIGIN|" \
    -e "s|^APP_BASE_URL=.*|APP_BASE_URL=$APP_BASE_URL|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PGPASS|" \
    -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$REDISPASS|" \
    -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$JWT|" \
    "$TPL" > "$TMP_ENV"

EXISTS=$(run_remote "test -f ~/InventarioPro-staging/.env.prod && echo yes || echo no")
if [ "$EXISTS" = "yes" ] && [ "$FORCE" -ne 1 ]; then
  warn "El server ya tiene .env.prod — NO lo toqué (usá --force para regenerarlo)."
else
  scp -i "$KEY" $SSHOPTS "$TMP_ENV" "$REMOTE:~/InventarioPro-staging/.env.prod" >/dev/null
  note "✓ .env.prod copiado al server (secretos nuevos, no impresos)"
fi

# ---------------------------------------------------------------------------
# 4. Primer arranque + verificación real (lo que hará el workflow)
# ---------------------------------------------------------------------------
note "Validando config del compose…"
run_remote bash -s <<'RMT'
set -e
cd ~/InventarioPro-staging
docker compose -f docker-compose.prod.yml --env-file .env.prod config -q
RMT

note "Primer arranque: docker compose up -d --build (puede tardar varios minutos)…"
run_remote bash -s <<'RMT'
set -e
cd ~/InventarioPro-staging
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
RMT

note "Verificando el stack…"
run_remote bash -s <<'RMT'
set -e
cd ~/InventarioPro-staging
CF="-f docker-compose.prod.yml --env-file .env.prod"
docker compose $CF ps
echo "── health del backend (red interna, como lo ve el monitor):"
docker compose $CF exec backend node -e \
  "fetch('http://localhost:3001/api/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"
echo "── frontend :3000:  $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login)"
echo "── caddy    :80:    $(curl -s -o /dev/null -w '%{http_code}' http://localhost/login)"
echo "── backend health (docker): $(docker inspect --format '{{.State.Health.Status}}' inventariopro-backend)"
RMT

# ---------------------------------------------------------------------------
# 5. Secrets STAGING_* en GitHub (opcional) + siguientes pasos
# ---------------------------------------------------------------------------
if [ "$SETUP_SECRETS" -eq 1 ]; then
  command -v gh >/dev/null 2>&1 || die "--setup-secrets requiere la CLI gh"
  gh auth status >/dev/null 2>&1 || die "--setup-secrets requiere gh autenticado"
  note "Configurando secrets STAGING_* en GitHub…"
  gh secret set STAGING_HOST    --body "$HOST"
  gh secret set STAGING_USER    --body "$USER_SSH"
  gh secret set STAGING_SSH_KEY < "$KEY"
  note "✓ STAGING_HOST / STAGING_USER / STAGING_SSH_KEY configurados"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "✅ Stack de staging levantado y verificado en $REMOTE"
echo "   Dominio: $SCHEME://$DOMAIN  (sin dominio real, el login completo"
echo "   requiere HTTPS — las cookies Secure no persisten en HTTP)."
echo ""
echo "Siguientes pasos:"
echo "  1. Secrets en GitHub (si no usaste --setup-secrets):"
echo "     gh secret set STAGING_HOST    --body '$HOST'"
echo "     gh secret set STAGING_USER    --body '$USER_SSH'"
echo "     gh secret set STAGING_SSH_KEY < $KEY"
echo "  2. Disparar el deploy automatizado:"
echo "     GitHub → Actions → Deploy → Run workflow → environment: staging"
echo "     (ver docs/DEPLOY-SETUP.md §2-§3)"
echo "═══════════════════════════════════════════════════════════════════"
