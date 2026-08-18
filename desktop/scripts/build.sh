#!/usr/bin/env bash
# =============================================================================
# build.sh - ensambla el stack embebido y empaqueta la app de escritorio.
#
#   npm run build          → backend (dist+deps+CLI prisma) + frontend
#                            (standalone) en desktop/resources/ y empaqueta
#                            con electron-builder --dir (carpeta de prueba).
#   npm run build:installer→ ídem + genera el instalador NSIS (Windows).
#
# Notas:
#   - El backend se compila con el cliente Prisma SQLITE (src/generated) y al
#     terminar se restaura el cliente de Postgres commiteado (árbol limpio).
#   - El CLI de Prisma viaja en node_modules para que la app aplique
#     migraciones SQLite en userData al primer arranque (idempotente).
#   - better-sqlite3 (módulo nativo) se reconstruye para el ABI de Electron.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DESK="$ROOT/desktop"
RES="$DESK/resources"
TMP_STAGE="$(mktemp -d)"
trap 'rm -rf "$TMP_STAGE"' EXIT

INSTALLER=false
[ "${1:-}" = "--installer" ] && INSTALLER=true

log() { printf '\033[1;34m[desktop-build]\033[0m %s\n' "$*"; }

# copy_dir src dst — copia recursivamente con tolerancia a rutas largas de
# Windows. cp -r de Git Bash falla con node_modules (path > 260 chars);
# tar maneja correctamente rutas largas en todas las plataformas.
copy_dir() {
  local src="$1" dst="$2"
  mkdir -p "$dst"
  (cd "$src" && tar cf - .) | (cd "$dst" && tar xf -)
}

# ---------- 1. Backend: build con el cliente SQLite --------------------------
log "Backend: generando cliente Prisma SQLite y compilando (nest build)…"
(
  cd "$ROOT/backend"
  DB_PROVIDER=sqlite npx prisma generate
  npm run build
)
# El build dejó el cliente SQLite dentro de dist; restauramos el commiteado.
git -C "$ROOT" checkout -- backend/src/generated/prisma 2>/dev/null || true

# ---------- 2. Backend: dependencias de producción ---------------------------
log "Backend: instalando dependencias de producción en staging…"
mkdir -p "$TMP_STAGE/backend-deps"
cp "$ROOT/backend/package.json" "$ROOT/backend/package-lock.json" "$TMP_STAGE/backend-deps/"
PRISMA_VER="$(sed -n 's/.*"prisma": "\^\([0-9.]*\)".*/\1/p' "$ROOT/backend/package.json" | head -1)"
(
  cd "$TMP_STAGE/backend-deps"
  npm ci --omit=dev --omit=optional --no-audit --no-fund
  # CLI de Prisma + dotenv: devDeps del backend que el runtime SÍ necesita
  # para `migrate deploy` contra el dev.db del usuario (prisma.config.ts hace
  # `import 'dotenv/config'`). npm instala sus transitivas (effect, …).
  # OJO: sin --omit=dev, este `npm install` REINSTALA todas las devDependencies
  # del backend (jest, typescript, eslint, …) → el stack empaquetado crecía a
  # ~600 paquetes y la extracción/instalación era mucho más lenta (Defender
  # escanea cada archivo). Con --omit=dev queda solo runtime + prisma + dotenv.
  npm install --no-save --omit=dev --no-audit --no-fund "prisma@${PRISMA_VER:-7.9.1}" dotenv
)

# ---------- 3. Ensamblar resources/backend -----------------------------------
log "Ensamblando resources/backend…"
rm -rf "$RES"
mkdir -p "$RES/backend"
# package.json mínimo: @electron/rebuild y electron-builder lo esperan al
# escanear node_modules (el runtime del backend no lo lee).
printf '{\n  "name": "inventariopro-backend-runtime",\n  "version": "1.0.0",\n  "private": true\n}\n' > "$RES/backend/package.json"
copy_dir "$ROOT/backend/dist" "$RES/backend/dist"
copy_dir "$TMP_STAGE/backend-deps/node_modules" "$RES/backend/node_modules"
copy_dir "$ROOT/backend/prisma" "$RES/backend/prisma"
cp "$ROOT/backend/prisma.config.ts" "$RES/backend/prisma.config.ts"

# ---------- 4. Frontend: build standalone ------------------------------------
log "Frontend: build standalone (NEXT_PUBLIC_API_URL=http://localhost:3001/api)…"
(
  cd "$ROOT/frontend"
  NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_URL="http://localhost:3001/api" npm run build
)
git -C "$ROOT" checkout -- frontend/next-env.d.ts 2>/dev/null || true
mkdir -p "$RES/frontend"
# El standalone puede incluir un prefijo con el nombre del proyecto (cuando el
# root de tracing es la raíz del monorepo): se aplana para que server.js quede
# en la raíz de resources/frontend (así lo espera main.js).
STANDALONE="$ROOT/frontend/.next/standalone"
if [ -f "$STANDALONE/server.js" ]; then
  copy_dir "$STANDALONE" "$RES/frontend"
else
  copy_dir "$STANDALONE/frontend" "$RES/frontend"
fi
mkdir -p "$RES/frontend/.next"
copy_dir "$ROOT/frontend/.next/static" "$RES/frontend/.next/static"
copy_dir "$ROOT/frontend/public" "$RES/frontend/public"

# ---------- 4b. Validación de assets del logo --------------------------------
# El build del frontend (paso 4) ya generó los PNG/favicon (generate:logo-assets
# va dentro de `npm run build`). Validarlos acá garantiza que el empaquetado
# nunca corra con iconos faltantes (los PNG no viven en git).
log "Validando assets del logo (PNG generados + SVG fuente)…"
( cd "$ROOT/frontend" && npm run validate:logo-assets )

# ---------- 5. Icono de la app (reutiliza el de la PWA) ----------------------
mkdir -p "$DESK/build"
cp "$ROOT/frontend/public/icons/icon-512x512.png" "$DESK/build/icon.png"

# ---------- 6. Dependencias de Electron + rebuild nativo ---------------------
(
  cd "$DESK"
  [ -d node_modules/electron ] || npm install --no-audit --no-fund
  # Ojo con los backslashes de Windows en node -p: se lee con sed, no con require.
  ELECTRON_VER="$(sed -n 's/.*"version": "\([0-9][0-9.]*\)".*/\1/p' "$DESK/node_modules/electron/package.json" | head -1)"
  if [ -n "$ELECTRON_VER" ]; then
    log "Rebuild de better-sqlite3 para Electron $ELECTRON_VER (ABI)…"
    # better-sqlite3 NO es N-API → necesita rebuild para el ABI de Electron.
    # argon2 SÍ es N-API (prebuilds en node_modules) → el mismo binario vale
    # para Node y Electron; reconstruirlo exige Visual Studio (no siempre
    # instalado) y es innecesario.
    npx @electron/rebuild --module-dir "$RES/backend" -w better-sqlite3 -v "$ELECTRON_VER" -f
  else
    log "WARN: no se pudo determinar la versión de Electron; saltando rebuild nativo."
  fi
)

# ---------- 7. Firma de código (opcional) -----------------------------------
# Si existe desktop/certs/inventariopro.pfx (generado con scripts/create-cert.ps1),
# electron-builder firma el instalador y los ejecutables. Sin certificado el
# build sigue siendo válido, solo sin firma. El pfx y su contraseña viven en
# desktop/certs/ (gitignored): nunca commitees la clave privada.
CERT_PFX="$DESK/certs/inventariopro.pfx"
CERT_PASS="$DESK/certs/password.txt"
if [ -f "$CERT_PFX" ]; then
  if [ -f "$CERT_PASS" ]; then
    export WIN_CSC_LINK="file://$(cygpath -m "$CERT_PFX" 2>/dev/null || echo "$CERT_PFX")"
    export WIN_CSC_KEY_PASSWORD="$(cat "$CERT_PASS")"
    log "Firmando con certificado: $CERT_PFX"
  else
    log "WARN: $CERT_PFX existe pero falta $CERT_PASS; build SIN firma."
  fi
else
  log "Sin certificado de firma (crea uno con desktop/scripts/create-cert.ps1)."
fi

# ---------- 8. Empaquetar -----------------------------------------------------
if [ "$INSTALLER" = true ]; then
  log "electron-builder: generando instalador…"
  ( cd "$DESK" && npx electron-builder --win nsis )
else
  log "electron-builder: empaquetando directorio (--dir)…"
  ( cd "$DESK" && npx electron-builder --dir )
fi
unset WIN_CSC_LINK WIN_CSC_KEY_PASSWORD

log "Listo. Artefactos en $DESK/dist"
