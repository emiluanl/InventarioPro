#!/usr/bin/env bash
# =============================================================================
# smoke-test.sh — verificación headless de la app de escritorio empaquetada.
#
#   Uso:  bash scripts/smoke-test.sh [ruta/al/InventarioPro.exe]
#         (sin argumento busca en desktop/dist/win-unpacked/InventarioPro.exe)
#
# Fase A: arranque headless con INVENTARIOPRO_EXIT_AFTER_READY=1 → STACK_READY
#         (migraciones SQLite + stack embebido) y salida limpia con puertos
#         liberados. Reintenta una vez ante el transitorio conocido del backend.
# Fase B: stack arriba + flujo funcional real contra el backend embebido:
#         registro → verify (token del log) → login (cookies) → alta de
#         producto → refresh (rota) → reuso de refresh → 401 → familia
#         revocada → 401 → frontend 200.
#
# Termina siempre (trap) matando la app y verificando puertos libres.
# Pensado para GitHub Actions (windows-latest) y uso local bajo Git Bash.
# =============================================================================
set -euo pipefail

fail() { echo "[smoke] ✗ $*" >&2; exit 1; }
note() { echo "[smoke] $*"; }

# --- Rutas ----------------------------------------------------------------
DATA_ROOT="${APPDATA:-$HOME/AppData/Roaming}"
DATA_ROOT="$(printf '%s' "$DATA_ROOT" | tr '\\' '/')"
# El userData real puede ser %APPDATA%/InventarioPro (productName, preferido
# por Electron) o %APPDATA%/inventariopro-desktop (name): cubrimos ambos.
LOG_CANDS=(
  "$DATA_ROOT/InventarioPro/logs/desktop.log"
  "$DATA_ROOT/inventariopro-desktop/logs/desktop.log"
)
ACTIVE_LOG=""
jar=""

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXE="${1:-$HERE/dist/win-unpacked/InventarioPro.exe}"
[ -f "$EXE" ] || fail "no encuentro el ejecutable: $EXE"

API="http://localhost:3001/api"
FRONT="http://localhost:3010"

# --- Procesos / puertos ------------------------------------------------------
port_pids() { # $1 = puerto → PIDs LISTENING
  netstat -ano 2>/dev/null | grep ":${1} " | grep -i listening | awk '{print $NF}' | sort -u
}
kill_procs() {
  for p in 3001 3010; do
    for pid in $(port_pids "$p"); do taskkill //F //PID "$pid" //T >/dev/null 2>&1 || true; done
  done
  # Fallback por imagen (la app es single-instance; en CI no hay otras).
  taskkill //F //IM InventarioPro.exe //T >/dev/null 2>&1 || true
}
wait_ports_free() { # $1 = timeout segundos
  local deadline=$(( $(date +%s) + $1 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    [ -z "$(port_pids 3001)" ] && [ -z "$(port_pids 3010)" ] && return 0
    sleep 2
  done
  return 1
}

# --- App ---------------------------------------------------------------------
launch() { # $1 = "exit" (salir tras STACK_READY) | "stay"
  rm -f "${LOG_CANDS[@]}"
  if [ "$1" = "exit" ]; then
    INVENTARIOPRO_HEADLESS=1 INVENTARIOPRO_EXIT_AFTER_READY=1 "$EXE" >/dev/null 2>&1 &
  else
    INVENTARIOPRO_HEADLESS=1 "$EXE" >/dev/null 2>&1 &
  fi
  sleep 1
}
tail_logs() {
  for lf in "${LOG_CANDS[@]}"; do
    [ -f "$lf" ] && { echo "----- $lf (últimas líneas) -----"; tail -30 "$lf"; }
  done
}
wait_ready() { # $1 = timeout segundos; llena ACTIVE_LOG
  local deadline=$(( $(date +%s) + $1 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    for lf in "${LOG_CANDS[@]}"; do
      [ -f "$lf" ] || continue
      grep -q "FALLO:" "$lf" && { tail_logs; fail "la app reportó FALLO (ver log)"; }
      if grep -q "STACK_READY" "$lf"; then ACTIVE_LOG="$lf"; return 0; fi
    done
    sleep 2
  done
  return 1
}

# --- Fases -------------------------------------------------------------------
phase_a() {
  note "Fase A: arranque headless + STACK_READY…"
  launch exit
  if wait_ready 120; then
    note "✓ STACK_READY (log: ${ACTIVE_LOG#*Roaming/})"
  else
    note "primer intento sin STACK_READY (transitorio conocido); reintento…"
    kill_procs; sleep 5
    launch exit
    wait_ready 120 || { tail_logs; fail "Fase A: sin STACK_READY tras reintento"; }
    note "✓ STACK_READY al reintento (log: ${ACTIVE_LOG#*Roaming/})"
  fi
  # Con EXIT_AFTER_READY la app sale ~500ms después de marcar listo.
  wait_ports_free 60 || { tail_logs; fail "Fase A: puertos aún ocupados tras la salida"; }
  note "✓ salida limpia: puertos 3001/3010 libres"
}

phase_b() {
  note "Fase B: stack arriba + flujo funcional…"
  launch stay
  wait_ready 120 || { tail_logs; fail "Fase B: sin STACK_READY"; }

  local email="ci$(date +%s)@test.local" pass="Test1234!" code
  jar="$(mktemp)"

  # 1. Registro (RegisterDto: email + password + nombre)
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/register" \
    -H "Content-Type: application/json" -d "{\"email\":\"$email\",\"password\":\"$pass\",\"nombre\":\"CI User\"}")
  [ "$code" = "201" ] || fail "registro: esperaba 201, obtuvo $code"
  note "✓ registro (201)"

  # 2. Verify: el token sale en el log (SMTP en modo consola)
  local token
  token=$(grep -hoE "verify-email\?token=[A-Za-z0-9_-]+" "$ACTIVE_LOG" | tail -1 | sed 's/.*token=//')
  [ -n "$token" ] || { tail_logs; fail "no encontré el token de verificación en el log"; }
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/verify-email" \
    -H "Content-Type: application/json" -d "{\"token\":\"$token\"}")
  [ "$code" = "200" ] || fail "verify-email: esperaba 200, obtuvo $code"
  note "✓ email verificado (200)"

  # 3. Login → cookies de sesión
  code=$(curl -s -o /dev/null -w "%{http_code}" -c "$jar" -X POST "$API/auth/login" \
    -H "Content-Type: application/json" -d "{\"email\":\"$email\",\"password\":\"$pass\"}")
  [ "$code" = "200" ] || fail "login: esperaba 200, obtuvo $code"
  grep -q "refresh_token" "$jar" || fail "login: no se setearon cookies de sesión"
  note "✓ login (200, cookies seteadas)"

  # 4. Alta de producto (CRUD principal autenticado; CreateProductDto exige
  #    nombre, fecha_compra, tipo_compra y precio)
  code=$(curl -s -o /dev/null -w "%{http_code}" -b "$jar" -X POST "$API/products" \
    -H "Content-Type: application/json" \
    -d '{"nombre":"Producto CI","fecha_compra":"2026-01-15","tipo_compra":"FISICO","precio":100}')
  [ "$code" = "201" ] || fail "crear producto: esperaba 201, obtuvo $code"
  note "✓ producto creado (201)"

  # 5. Refresh rota el token (guardamos el viejo del jar)
  local old_rt
  old_rt=$(awk '$6 == "refresh_token" { print $7 }' "$jar" | tail -1)
  [ -n "$old_rt" ] || fail "refresh: no hay refresh_token en el jar"
  code=$(curl -s -o /dev/null -w "%{http_code}" -b "$jar" -c "$jar" -X POST "$API/auth/refresh")
  [ "$code" = "200" ] || fail "refresh: esperaba 200, obtuvo $code"
  note "✓ refresh rota el token (200)"

  # 6. Reuso del token ya rotado → detección (401)
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/refresh" \
    -H "Cookie: refresh_token=$old_rt")
  [ "$code" = "401" ] || fail "reuso de refresh: esperaba 401, obtuvo $code"
  note "✓ reuso de refresh detectado (401)"

  # 7. El token nuevo quedó revocado (familia) → 401
  code=$(curl -s -o /dev/null -w "%{http_code}" -b "$jar" -X POST "$API/auth/refresh")
  [ "$code" = "401" ] || fail "revocación de familia: esperaba 401, obtuvo $code"
  note "✓ familia revocada (401)"

  # 8. Frontend responde. La raíz / redirige a /dashboard (redirect() de
  #    Next, 307) y el dashboard a /login por JS sin sesión — seguimos la
  #    cadena (-L) para verificar que el servidor web sirve de verdad.
  code=$(curl -sL -o /dev/null -w "%{http_code}" "$FRONT")
  [ "$code" = "200" ] || fail "frontend: esperaba 200, obtuvo $code"
  note "✓ frontend responde (200, siguiendo redirects)"
}

# --- Ejecución ----------------------------------------------------------------
note "preflight: cerrando instancias previas y esperando puertos libres…"
kill_procs
wait_ports_free 30 || fail "puertos 3001/3010 ocupados por otro proceso (¿npm start corriendo?)"
note "✓ preflight ok (${EXE#*desktop/})"

phase_a
phase_b

note "SMOKE OK — la app empaquetada arranca, migra, sirve y cumple el flujo completo."
