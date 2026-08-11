@echo off
REM ===========================================================================
REM start-backend.cmd - arranca el backend de InventarioPro (proceso del host)
REM ===========================================================================
REM Pensado para ejecutarse al iniciar sesión vía la tarea programada de
REM Windows "InventarioProBackend" (schtasks /SC ONLOGON), de modo que el API
REM de localhost:3001 no dependa de un proceso manual.
REM
REM Registro de la tarea (una vez, desde cmd):
REM   schtasks /Create /TN "InventarioProBackend" /TR "\"%~dp0start-backend.cmd\"" /SC ONLOGON /RL LIMITED /F
REM
REM La config se lee de backend\.env (PORT=3001, BD, JWT...). Los logs van a
REM backend\backend-auto.log.
REM ===========================================================================

cd /d "%~dp0..\backend"

if not exist dist\main.js (
  echo [start-backend] ERROR: no existe dist\main.js - ejecuta "npm run build" primero.
  exit /b 1
)

echo [start-backend] iniciando backend en localhost:3001...
node dist\main.js >> backend-auto.log 2>&1
