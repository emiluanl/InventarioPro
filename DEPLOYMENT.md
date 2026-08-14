# InventarioPro — Guía de despliegue

> Cómo llevar InventarioPro a producción. Asume Docker en el servidor.

## 1. Requisitos previos

- **Servidor** con Docker 24+ y Docker Compose v2.
- **Dominio** propio con DNS apuntando al servidor (A o AAAA records).
- **Dominio único**: frontend y API se sirven bajo el MISMO dominio (ej. `app.inventariopro.com`). Caddy enruta `/api/*` y `/uploads/*` al backend y todo lo demás al frontend — así las cookies de sesión (httpOnly + Secure + SameSite=Strict) funcionan sin tratarse como cross-site.
- **Puerto 80 y 443** abiertos en el firewall.

## 2. Generar secretos

```bash
# Genera strings aleatorios para JWT
openssl rand -hex 32   # JWT_ACCESS_SECRET

# Genera una contraseña fuerte para Redis y Postgres
openssl rand -hex 24   # REDIS_PASSWORD
openssl rand -hex 24   # POSTGRES_PASSWORD
```

## 3. Crear `.env.prod`

En la raíz del proyecto, crea `.env.prod` con TODAS estas variables:

```env
# Dominio único (frontend + API bajo el mismo dominio; Caddy enruta /api/*
# y /uploads/* al backend)
FRONTEND_DOMAIN=app.inventariopro.com

# API expuesta al frontend (mismo dominio, prefijo /api)
PUBLIC_API_URL=https://app.inventariopro.com/api

# CORS: solo el dominio exacto
CORS_ORIGIN=https://app.inventariopro.com

# Base URL para links en emails (verificación, reset)
APP_BASE_URL=https://app.inventariopro.com

# Base de datos
POSTGRES_USER=inventariopro
POSTGRES_PASSWORD=tu-password-aqui
POSTGRES_DB=inventariopro

# Redis
REDIS_PASSWORD=tu-redis-password-aqui

# JWT
JWT_ACCESS_SECRET=tu-access-secret-aqui-32-chars-min
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# Email (SMTP real)
SMTP_HOST=smtp.tu-proveedor.com
SMTP_PORT=587
SMTP_USER=noreply@inventariopro.com
SMTP_PASSWORD=tu-smtp-password
SMTP_FROM="InventarioPro <noreply@inventariopro.com>"

# Storage (Supabase)
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=tu-service-key
SUPABASE_BUCKET=inventariopro

# IA (DeepSeek, compatible con OpenAI). Sin key el chat usa un fallback amable.
DEEPSEEK_API_KEY=tu-clave-DeepSeek
DEEPSEEK_API_BASE=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TIMEOUT_MS=10000

# Web Push (notificaciones fuera de la app) - opcional
# Genera las claves una sola vez con:
#   npx web-push generate-vapid-keys --json
# Sin ellas el push queda deshabilitado (el resto de la app funciona igual).
VAPID_PUBLIC_KEY=tu-clave-publica-vapid
VAPID_PRIVATE_KEY=tu-clave-privada-vapid
VAPID_SUBJECT=mailto:admin@inventariopro.com
```

> **Web Push**: los avisos de garantías por vencer/vencidas llegan al navegador
> incluso con la app cerrada. El servicio worker (`frontend/public/sw.js`) los
> muestra y abre el producto al hacer clic. Los avisos requieren HTTPS
> (el que ya da Caddy); en localhost funcionan también.
> Si una suscripción expira (404/410 del push service), se elimina sola.

## 4. Levantar los servicios

```bash
# Desde la raíz del proyecto
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# Ver logs
docker compose -f docker-compose.prod.yml logs -f

# Verificar estado
docker compose -f docker-compose.prod.yml ps
```

### Deploy automatizado (GitHub Actions)

> 📘 **Guía paso a paso**: [docs/DEPLOY-SETUP.md](docs/DEPLOY-SETUP.md) —
> creación del servidor staging, instalación de Docker, clave SSH,
> configuración de secrets y prueba del primer deploy.

El workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) hace
`git pull` + `docker compose up -d --build` en el servidor vía SSH (el mismo
flujo de esta sección). **Soporta dos entornos** — `staging` y `production` —
y se dispara al pushear a `main` (producción) o manualmente desde la pestaña
Actions eligiendo el entorno.

#### 1. Crear un entorno de staging (recomendado antes de tocar prod)

El workflow puede desplegar a un servidor de pruebas independiente. Necesitas:

1. Un servidor (VPS o máquina) con Docker instalado, accesible por SSH.
2. Clonar el repo en el servidor: `git clone <repo> ~/InventarioPro-staging`.
3. Crear ahí el `.env.prod` local (nunca se sube a git) y levantar el stack
   una vez a mano para validar: `docker compose -f docker-compose.prod.yml
   --env-file .env.prod up -d --build`.

#### 2. Configurar los secrets en GitHub

`Settings → Secrets and variables → Actions` (secretos de repo o de
environment). El workflow mapea cada entorno a sus propios secrets:

| Entorno | Secret | Descripción |
|---|---|---|
| **staging** | `STAGING_HOST` | IP o dominio del servidor de staging |
| **staging** | `STAGING_USER` | Usuario SSH con permisos sobre Docker |
| **staging** | `STAGING_SSH_KEY` | Clave privada SSH (PEM, sin passphrase) |
| **staging** | `STAGING_PORT` | Puerto SSH (opcional, por defecto 22) |
| **staging** | `STAGING_DIR` (variable) | Ruta del repo (por defecto `~/InventarioPro-staging`) |
| **production** | `DEPLOY_HOST` | IP o dominio del servidor de producción |
| **production** | `DEPLOY_USER` | Usuario SSH con permisos sobre Docker |
| **production** | `DEPLOY_SSH_KEY` | Clave privada SSH (PEM, sin passphrase) |
| **production** | `DEPLOY_PORT` | Puerto SSH (opcional, por defecto 22) |
| **production** | `DEPLOY_DIR` (variable) | Ruta del repo (por defecto `~/InventarioPro`) |

#### 3. Probar en staging

1. En GitHub, ve a la pestaña **Actions** → **Deploy** → **Run workflow**.
2. Elige `staging` en el desplegable y lanza el job.
3. El workflow hace `git pull` + `docker compose up -d --build` en staging y
   verifica el healthcheck del backend al final.
4. Solo cuando staging valide, repite con `production`.

> El job `migrate` del compose aplica las migraciones automáticamente antes de
> que el backend sirva; el workflow verifica el healthcheck al final. El
> `.env.prod` vive solo en el servidor y nunca se sube a git. Para protección
> extra, puedes crear *environments* en
> `Settings → Environments` y exigir aprobación manual antes de desplegar a
> producción.

## 5. Migrar la base de datos

```bash
# Las migraciones las aplica el job one-shot 'migrate' antes de que el backend
# sirva (depends_on service_completed_successfully). Para aplicarlas a mano:
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm migrate
```

> El comando es **idempotente** y además ya se ejecuta solo: en cada
> `up -d --build` con código nuevo, el job `migrate` aplica las migraciones
> pendientes y solo entonces arranca el backend (la imagen runtime del backend
> no incluye el CLI de Prisma, por eso las migraciones viven en su propio job).

## 6. HTTPS automático

Caddy (incluido en el compose) obtiene y renueva certificados de Let's Encrypt automáticamente.

Verifica después de unos minutos:

```bash
curl -I https://app.inventariopro.com/api/auth/me
curl -I https://app.inventariopro.com
```

## 7. Backups

El stack incluye un **contenedor de backups automático** (`backup/`): un cron
dentro de Docker ejecuta `pg_dump` en formato custom comprimido (`-Fc`) y
aplica retención. Se levanta solo con `up -d` (no necesita configuración
adicional) y escribe los dumps en `./backups` del host:

> Además de los dumps, cada backup empaqueta los **uploads** (fotos/recibos/facturas)
> en `uploads-*.tar.gz`. El backend de producción monta `./backend/uploads` como
> almacenamiento local (`LOCAL_UPLOAD_DIR`), así que lo que el backup ve es
> exactamente lo que la app guardó.

```bash
# Por defecto: 03:00 diario (UTC o la TZ configurada), retención 14 días.
# Sobrescribible desde .env.prod:
#   BACKUP_SCHEDULE="0 3 * * *"
#   BACKUP_KEEP_DAYS=14
#   TZ=America/Argentina/Buenos_Aires
#   WATCHDOG_SCHEDULE="7 * * * *"   (watchdog cada hora)
#   STALE_AFTER_MIN=1560             (26 h: alarma si el último dump es viejo)
#   BACKUP_PING_URL="https://hc-ping.com/<check-backups>"  (heartbeat del backup, ver §8)
#   MONITOR_PING_URL="https://hc-ping.com/<check-api>"     (monitor de la API; fallback
#                                                            legacy del backup si el anterior va vacío)

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

> Además del backup diario, el contenedor ejecuta un **watchdog** (`check.sh`)
> cada hora que comprueba la antigüedad del último dump y, si supera
> `STALE_AFTER_MIN` (26 h), lo registra en los logs, avisa a `BACKUP_PING_URL`
> (si está configurada; `MONITOR_PING_URL` solo como fallback legacy) y deja de
> pasar el healthcheck de Docker.

### Verificar que funciona

```bash
# Ejecutar un backup inmediato (además del cron)
docker compose -f docker-compose.prod.yml exec backup /usr/local/bin/backup

# Comprobar los dumps generados
ls -lh backups/

# Ver los logs del cron
docker compose -f docker-compose.prod.yml logs -f backup
```

### Restaurar

```bash
# Listar el contenido de un dump (verifica que no está corrupto)
docker compose -f docker-compose.prod.yml exec backup \
  pg_restore --list /backups/inventariopro-YYYYMMDD-HHMMSS.dump | head

# Restaurar (--clean: deja la BD en el estado exacto del dump)
docker compose -f docker-compose.prod.yml exec backup \
  /usr/local/bin/restore /backups/inventariopro-YYYYMMDD-HHMMSS.dump
```

> ⚠️ `restore` usa `--clean --if-exists --no-owner`: **reemplaza** el contenido
> actual de la base de datos por el del dump. Hazlo solo si estás seguro de
> querer volver a ese estado (p. ej. tras un desastre o un error de migración).
> `--no-owner` deja los objetos a nombre del usuario con el que se restaura:
> en producción es idéntico al resultado anterior, y en una BD de recuperación
> (donde el rol original del dump no existe) evita errores de `ALTER OWNER`.

### Copia remota de los dumps (rclone)

Los dumps viven en `./backups` del host; un fallo del disco del servidor los
perdería. El contenedor de backups incluye **rclone** y, si se configura
`RCLONE_REMOTE`, copia cada dump a un destino remoto (bucket S3, Backblaze B2,
Cloudflare R2, otro servidor por SFTP, un NAS...) justo después de generarlo,
aplicando allí la misma retención (`BACKUP_KEEP_DAYS`). **Con `RCLONE_REMOTE`
vacío (default) no se hace nada** y el backup funciona igual que antes.

#### 1. Crear la config de rclone

La config se lee de `./rclone/rclone.conf` (montada en `/root/.config/rclone`
dentro del contenedor; el archivo real está en `.gitignore`, el ejemplo
`rclone/rclone.conf.example` sí se commitea):

```bash
cp rclone/rclone.conf.example rclone/rclone.conf

# Opción A: asistente interactivo dentro del contenedor (recomendado)
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm backup rclone config

# Opción B: editar rclone/rclone.conf a mano en el host
#   [s3backup]
#   type = s3
#   provider = AWS          # o B2 / Cloudflare / MinIO...
#   access_key_id = ...
#   secret_access_key = ...
#   region = ...
#   endpoint =              # solo si no es AWS (R2, MinIO...)
```

> 💡 **Cifrado**: si el destino no es de confianza, envuelve el remote en uno
> de tipo `crypt` (genera las contraseñas con `rclone obscure 'tu-frase'`) y
> usa ese remote en `RCLONE_REMOTE`. Los dumps contienen datos reales.

> 💡 **SFTP**: para un segundo servidor con SSH, usa el backend `sftp` y monta
> tu clave privada añadiendo al servicio `backup` un volumen como
> `- ./backup/id_ed25519:/config/id_ed25519:ro`.

#### 2. Activar la copia en `.env.prod`

```bash
# RCLONE_REMOTE=<remote>:<carpeta>  (el nombre del remote y la ruta en él)
# Remote real activo en este despliegue (Backblaze B2):
RCLONE_REMOTE=b2backup:InventarioPro
```

#### 3. Reiniciar el contenedor y verificar

```bash
docker compose -f docker-compose.prod.yml \
  --env-file .env.prod up -d --build backup

# Backup inmediato: debe aparecer "copia remota OK" en los logs
docker compose -f docker-compose.prod.yml \
  --env-file .env.prod exec backup /usr/local/bin/backup

docker compose -f docker-compose.prod.yml \
  --env-file .env.prod logs backup | grep -E 'copia|retención remota'

# Confirmar los archivos en el destino (dentro del contenedor)
# (b2backup es el remote real configurado en ./rclone/rclone.conf)
docker compose -f docker-compose.prod.yml \
  --env-file .env.prod exec backup rclone ls b2backup:InventarioPro
```

A partir de ahí, cada ejecución del cron (03:00) hace: `pg_dump` → retención
local → `rclone copy` al destino → retención remota (`rclone delete
--min-age`, mismo `BACKUP_KEEP_DAYS`).

#### 4. Restaurar desde la copia remota

```bash
# 1) Traer el dump al servidor (remote real: b2backup:InventarioPro)
cd backups && docker compose -f docker-compose.prod.yml \
  --env-file .env.prod run --rm backup \
  rclone copy b2backup:InventarioPro/inventariopro-YYYYMMDD-HHMMSS.dump /backups/

# 2) Restaurar (--clean: reemplaza el contenido actual de la BD)
docker compose -f docker-compose.prod.yml \
  --env-file .env.prod exec backup \
  /usr/local/bin/restore /backups/inventariopro-YYYYMMDD-HHMMSS.dump
```

> ⚠️ Igual que la restauración local: `restore` usa `--clean --if-exists` y
> **reemplaza** la base actual por el contenido del dump.

#### 5. Drill de restauración (verificación periódica)

Los backups solo valen si se pueden restaurar. Al menos una vez al mes (o tras
cambiar la configuración), verifica de punta a punta que un dump remoto
restaura correctamente **sin tocar la BD de producción** — se restaura en una
BD descartable en la red del stack:

```bash
# 1) BD temporal en la red del stack (el nombre de la red es <proyecto>_default)
docker run -d --name restore-drill --network inventariopro-prod_default \
  -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drillpass -e POSTGRES_DB=drilldb \
  postgres:16-alpine

# 2) Bajar el dump más reciente del remote dentro del contenedor de backup
# (puedes listar los disponibles con: rclone ls b2backup:InventarioPro)
docker compose -f docker-compose.prod.yml \
  --env-file .env.prod exec backup \
  rclone copyto b2backup:InventarioPro/inventariopro-YYYYMMDD-HHMMSS.dump /tmp/drill.dump

# 3) Restaurarlo en la BD temporal (debe terminar en "OK: base restaurada"
#    sin errores de pg_restore)
docker compose -f docker-compose.prod.yml \
  --env-file .env.prod exec -e POSTGRES_HOST=restore-drill -e POSTGRES_PORT=5432 \
  -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drillpass -e POSTGRES_DB=drilldb \
  backup /usr/local/bin/restore /tmp/drill.dump

# 4) Verificar que el contenido coincide con producción (tablas y conteos)
set -a; . ./.env.prod; set +a
docker exec inventariopro-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -t -c "SELECT count(*) FROM categories"
docker exec restore-drill psql -U drill -d drilldb \
  -t -c "SELECT count(*) FROM categories"
# Repite el conteo para el resto de tablas (users, products, ...) y, si quieres
# ir más fino, compara los datos con un diff: `psql ... -c 'SELECT ...'` y `diff`.

# 5) Limpieza: eliminar la BD temporal y el dump de prueba
docker rm -f restore-drill
docker compose -f docker-compose.prod.yml \
  --env-file .env.prod exec backup sh -c 'rm -f /tmp/drill.dump'
```

> ✅ **Drill verificado el 2026-08-11** con el dump `inventariopro-20260811-150954.dump`
> desde `b2backup:InventarioPro`: restauración limpia con `--no-owner` (el rol
> original no existe en la BD temporal), 10 tablas restauradas, conteos
> idénticos a producción (2 migraciones, 10 categorías) y datos de categorías
> byte-idénticos.

> 💡 El drill destapó y corrigió un fallo real: `restore` sin `--no-owner`
> fallaba con `role "inventariopro" does not exist` en cualquier BD que no
> tuviera el rol original. Ahora los objetos quedan a nombre del usuario con
> el que se restaura (en producción, el mismo resultado que antes).

#### 6. Rotar las credenciales de B2

Si una application key viaja por un chat, un email o un ticket, conviene
rotarla. La rotación es manual en el dashboard de Backblaze (la application
key del bucket **no tiene permisos `writeKeys`**, y la master key no debe
compartirse):

1. **Backblaze → App Keys → Add a New Application Key**:
   - Name: `inventariopro-backup`
   - Allow access to Bucket(s): `InventarioPro` (solo ese)
   - Capabilities: **Read & Write** (incluye `listFiles`, `readFiles`,
     `writeFiles` y `deleteFiles` — `deleteFiles` la usa la retención remota)
2. **Copy to Clipboard** y guarda el par (`keyID` + `applicationKey`) — solo
   se muestra una vez. **No borres la key antigua todavía**: primero verifica
   que la nueva funciona (paso 3) para no dejar backups sin copia remota.
3. Actualiza `./rclone/rclone.conf` (gitignoreado, nunca se commitea) con el
   par nuevo y verifica dentro del contenedor:

   ```bash
   docker compose -f docker-compose.prod.yml \
     --env-file .env.prod exec backup rclone lsd b2backup:
   ```

4. Ejecuta un backup real y confirma la subida al bucket:

   ```bash
   docker compose -f docker-compose.prod.yml \
     --env-file .env.prod exec backup /usr/local/bin/backup
   # Espera "copia remota OK" y comprueba: rclone ls b2backup:InventarioPro
   ```

5. Ya con la nueva funcionando, borra la key antigua en **App Keys → Delete
   Key**. Comprueba que dejó de funcionar (el comando del paso 3 con la key
   vieja debe fallar con 401).

> ⚠️ Las claves se muestran una sola vez al crearlas. Si pierdes el par nuevo
> antes de usarlo, créalo de nuevo (otro keyID) en lugar de intentar
> recuperarlo.

> ✅ **Rotación verificada el 2026-08-11**: key nueva `inventariopro-backup`
> activa (lsd OK + backup real subido al bucket), key antigua borrada en el
> dashboard y confirmada inválida (401). El único secreto que viajó por chat
> quedó revocado.

## 8. Monitoreo

### Alarma de backups (watchdog + heartbeat)

El contenedor `backup` trae dos mecanismos integrados:

- **Heartbeat**: `backup.sh` hace `GET <BACKUP_PING_URL>` cuando el backup
  termina bien y `GET <BACKUP_PING_URL>/fail` si falla (convención
  healthchecks.io). Es el latido de "los backups están funcionando".
  (`MONITOR_PING_URL` solo se usa como fallback si el anterior va vacío.)
- **Watchdog**: `check.sh` (cron cada hora) comprueba que el último dump tenga
  menos de `STALE_AFTER_MIN` minutos (26 h por defecto). Si está viejo o no
  hay ningún dump, hace `GET <BACKUP_PING_URL>/fail` y falla el healthcheck
  de Docker (`docker ps` lo muestra como *unhealthy*). Sin dumps aún (primer
  arranque) el healthcheck se considera sano.

#### Configurar el aviso

> ✅ **Activo en este despliegue (2026-08-11)**: dos checks reales en
> healthchecks.io, ambos verificados de punta a punta. El backup pinge su
> check diario (`BACKUP_PING_URL`, wget → 200), el monitor pinge el suyo
> (`MONITOR_PING_URL`, cada 5 min), y un fallo de backup simulado marcó
> `/fail` **solo** en el check de backups mientras el de la API siguió en UP.

Se usan **dos checks separados** (cada contenedor pinge el suyo):

1. **Check de la API** — `MONITOR_PING_URL`, **Period 5 min / Grace 10 min**.
   Lo pinge el contenedor `monitor` en cada probe (cada 5 min) y `<url>/fail`
   cuando la API queda caída o degradada.
2. **Check de backups** — `BACKUP_PING_URL`, **Period 24 h (1 día) / Grace 2 h**.
   Lo pinge el contenedor `backup`: heartbeat tras cada backup diario,
   `<url>/fail` si el backup falla y, vía el watchdog, si el último dump se
   queda viejo (más de `STALE_AFTER_MIN`). Si un día no corre ningún backup,
   el check se pone DOWN a las 24 h + gracia → alerta sí o sí.

Crea los dos checks en healthchecks.io (gratis), copia sus URLs y ponlas en
`.env.prod`:

```bash
MONITOR_PING_URL=https://hc-ping.com/<check-api>
BACKUP_PING_URL=https://hc-ping.com/<check-backups>
# Opcional:
# STALE_AFTER_MIN=1560
# WATCHDOG_SCHEDULE="7 * * * *"
```

**Webhook de alerta directa (Slack/Discord/Teams, opcional)**: además del
heartbeat de healthchecks.io, el monitor puede enviar un mensaje a un webhook
**solo cuando el estado cambia** (DOWN↔UP), no en cada corrida:

```bash
MONITOR_WEBHOOK_URL=https://hooks.slack.com/services/...
# MONITOR_WEBHOOK_TOKEN=opcional  # se envía como Authorization: Bearer
```

> 💡 Compatibilidad: si `BACKUP_PING_URL` está vacío, el contenedor de backup
> usa `MONITOR_PING_URL` (config antigua de un único check).

Aplica (recrea los contenedores que leen las variables):

```bash
docker compose -f docker-compose.prod.yml \
  --env-file .env.prod up -d --build backup monitor
```

#### Verificar la alarma

```bash
# Estado del último dump y del watchdog (OK o STALE + antigüedad)
docker compose -f docker-compose.prod.yml exec backup /usr/local/bin/check

# Healthcheck de Docker (healthy/unhealthy)
docker ps --filter name=inventariopro-backup

# Pings enviados (al configurar MONITOR_PING_URL, healthchecks.io los registra)
docker compose -f docker-compose.prod.yml logs backup | grep heartbeat
```

Sin `MONITOR_PING_URL`, la alarma sigue funcionando vía **logs** y **exit
code** (útil para scripts o monitores que lean `docker logs`).

### Alarma del backend (probe de la API)

El stack incluye un contenedor **`monitor`** que comprueba la API cada 5
minutos en dos niveles y alerta si algo falla:

- **Liveness** (`API_CHECK_URL`, `/api/auth/me` por defecto): confirma que el
  proceso responde. Cualquier 2xx-4xx vale (sin sesión devuelve 401: "está
  arriba").
- **Readiness** (`READINESS_URL`, `/api/health` por defecto): detecta el caso
  de **backend arriba pero degradado**. `/api/health` consulta la base de
  datos (`SELECT 1`) y Redis, y responde **503** si alguno no está operativo
  — p. ej. la BD caída: el contenedor sigue corriendo pero el servicio no
  sirve bien, y el monitor lo declara DOWN.
- **Semántica tipo UptimeRobot**: 2xx-4xx = vivo; 5xx, timeout o error de
  conexión = caído.
- **Sin falsos positivos**: reintenta `CHECK_RETRIES` veces (3) con
  `RETRY_DELAY_SEC` segundos (10) antes de declarar DOWN; liveness y
  readiness deben pasar en el mismo intento.
- **Aviso**: cuando todo responde hace `GET <MONITOR_PING_URL>` y si queda
  caído `GET <MONITOR_PING_URL>/fail` (misma URL de heartbeat que los
  backups). Sin `MONITOR_PING_URL`, la alarma queda en logs y exit codes.

Variables en `.env.prod` (opcionales, hay defaults):

```bash
# API_CHECK_URL=http://backend:3001/api/auth/me
# READINESS_URL=http://backend:3001/api/health
# CHECK_SCHEDULE="*/5 * * * *"
# CHECK_RETRIES=3
# RETRY_DELAY_SEC=10
```

Verificar:

```bash
# Probe manual (UP/DOWN + antigüedad de la respuesta)
docker compose -f docker-compose.prod.yml exec monitor /usr/local/bin/uptime

# Logs del cron
docker compose -f docker-compose.prod.yml logs -f monitor
```

> 🌐 **Cuando tengas un dominio real** (ver §6), puedes además apuntar
> **UptimeRobot o BetterStack** directamente a
> `https://app.tudominio.com/api/auth/me` con intervalo de 5 min: al ser una
> URL pública, esos servicios la comprueban desde fuera y avisan por email/otra
> vía. El contenedor `monitor` cubre el caso local (localhost) y sirve de
> respaldo aunque el dominio externo falle.

### Resto de monitoreo (recomendado)

- **Logs centralizados**: usar un driver de Docker (json-file con rotación o syslog).
- **Métricas**: si crece el uso, añadir Prometheus + Grafana.

## 9. Actualizar el deployment

```bash
cd /opt/inventariopro
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# Las migraciones ya las aplica el job 'migrate' (one-shot) del compose.
```

### Verificación de salud post-deploy (o tras reiniciar Docker)

El script [`scripts/verify-prod-health.sh`](scripts/verify-prod-health.sh)
comprueba en un solo comando que el stack prod esté sano después de un
reinicio de Docker Desktop o de un deploy:

1. Docker arriba y los 7 servicios de prod presentes.
2. Healthchecks de cada contenedor (`running` + `healthy`).
3. API responde con BD y Redis arriba (`/api/health`).
4. El job `migrate` re-ejecuta de forma idempotente (exit 0 si no hay
   migraciones pendientes).
5. Conteos mínimos de `users`/`products`/`categories` en la BD real (los
   umbrales se ajustan con `EXPECT_USERS=`, `EXPECT_PRODUCTS=`,
   `EXPECT_CATEGORIES=`).

```bash
npm run verify:prod              # verificación completa
npm run verify:prod -- --quick   # solo healthchecks + API (omite migrate y datos)
```

> Pensado también para CI: sale con exit 0 solo si todo está OK.

## 10. Troubleshooting

| Problema | Solución |
|---|---|
| Backend no arranca | `docker compose logs backend` para ver el error |
| Migración falla | Revisar `DATABASE_URL` y que Postgres esté sano |
| Cookies no se setean | Verificar que `NODE_ENV=production` y HTTPS activo |
| CORS rechaza el frontend | Confirmar que `CORS_ORIGIN` es EXACTO al dominio del frontend |
| IA no responde | Verificar `DEEPSEEK_API_KEY` y que `DEEPSEEK_API_BASE` esté correcto |
| Storage falla | Comprobar credenciales de Supabase y nombre del bucket |

## 11. Costos estimados (hosting mínimo)

| Servicio | Proveedor | Costo/mes |
|---|---|---|
| Frontend (1 vCPU, 512 MB) | Railway / Render | ~$5 |
| Backend (1 vCPU, 1 GB) | Railway / Render | ~$7 |
| Postgres (1 GB) | Neon / Supabase | gratis hasta cierto uso |
| Redis | Upstash | gratis hasta cierto uso |
| Storage | Supabase | gratis hasta 1 GB |
| Dominio | Namecheap / Cloudflare | ~$10/año |

**Total estimado**: $15–20/mes para un uso personal bajo.

## 12. Recuperación ante desastre (DR)

> **Procedimiento probado**: la restauración descrita abajo se validó de punta a
> punta (restaurar el dump en un Postgres limpio 16-alpine → verificar conteos
> y datos → conectar el cliente Prisma del backend → descomprimir el tar de
> uploads). Los pasos funcionan tal cual están escritos.

Cubre dos desastres comunes:

| Escenario | Qué restaurar |
|---|---|
| BD corrupta, borrado accidental o error de migración | el **dump** (`inventariopro-*.dump`) |
| Pérdida de fotos/recibos/facturas o disco nuevo | el **tar de uploads** (`uploads-*.tar.gz`) |
| Servidor nuevo completo | **ambos**, en ese orden |

Los artefactos viven en `./backups` del host (y, si configuraste `RCLONE_REMOTE`,
una copia en el destino remoto — descárgala con rclone y colócala en `./backups`).

### 12.1 Restaurar la base de datos

**Opción rápida** (misma instancia, BD existente): usa el helper del contenedor
`backup`, que aplica `--clean --if-exists --no-owner` (deja la BD en el estado
exacto del dump):

```bash
cd /opt/inventariopro
# 1. Baja el backend (no debe escribir en la BD mientras se restaura)
docker compose -f docker-compose.prod.yml --env-file .env.prod stop backend
# 2. Restaura
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backup \
  /usr/local/bin/restore backups/inventariopro-YYYYMMDD-HHMMSS.dump
# 3. Vuelve a levantarlo
docker compose -f docker-compose.prod.yml --env-file .env.prod start backend
```

**Opción completa** (Postgres limpio / servidor nuevo): en vez de confiar en la
BD existente, se restaura en un Postgres nuevo y se verifica antes de apuntar el
stack hacia él:

```bash
# 1. Levanta un Postgres temporal con la MISMA imagen de producción
#    (16-alpine) en un puerto que no colisione (5433):
docker run -d --name inventariopro-dr-test \
  -e POSTGRES_USER=inventariopro -e POSTGRES_PASSWORD=inventariopro \
  -e POSTGRES_DB=inventariopro -p 5433:5432 \
  -v inventariopro_dr_test:/var/lib/postgresql/data \
  postgres:16-alpine

# 2. Espera a que esté listo y restaura el dump (--exit-on-error aborta si
#    algo no cuadra; --no-owner evita errores si el rol original no existe):
docker cp backups/inventariopro-YYYYMMDD-HHMMSS.dump inventariopro-dr-test:/tmp/dump
docker exec inventariopro-dr-test pg_restore \
  -U inventariopro -d inventariopro --no-owner --exit-on-error /tmp/dump
#    (Nota Windows/Git Bash: antepone MSYS_NO_PATHCONV=1 al docker exec para
#    que /tmp no se convierta en ruta de Windows.)

# 3. VERIFICA antes de seguir (esto es lo que hace que el procedimiento sirva):
#    los conteos de las 10 tablas deben coincidir con los de producción.
#    Si restauras en un servidor nuevo, compáralos con la última copia remota.
docker exec inventariopro-dr-test psql -U inventariopro -d inventariopro -tAc \
  "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM products), (SELECT count(*) FROM categories)"

# 4. Comprueba también datos reales (emails, productos):
docker exec inventariopro-dr-test psql -U inventariopro -d inventariopro -tAc \
  "SELECT email FROM users ORDER BY email"

# 5. (Opcional pero recomendado) Conecta el cliente Prisma del backend contra
#    la BD restaurada — el mismo camino que usa la app en producción. Requiere
#    el build local (backend/dist existe tras `npm run build`; en un servidor
#    nuevo sin build puedes saltarlo, los pasos 3-4 ya verifican los datos):
cd backend && DATABASE_URL="postgresql://inventariopro:inventariopro@localhost:5433/inventariopro?schema=public" \
  node -e "const {PrismaClient}=require('./dist/generated/prisma/client.js');const {PrismaPg}=require('@prisma/adapter-pg');const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});p.user.count().then(c=>{console.log('users='+c);return p.product.count()}).then(c=>{console.log('products='+c);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"
```

Si todo cuadra, detén el stack, apunta `DATABASE_URL` al Postgres restaurado
(en el servidor nuevo: edita `.env.prod` con la IP del nuevo Postgres y sube el
stack) y elimina el contenedor de prueba:

```bash
docker rm -f inventariopro-dr-test && docker volume rm inventariopro_dr_test
```

### 12.2 Restaurar los uploads

El tar empaqueta con prefijo `uploads-src/` (el `basename` de `UPLOADS_SRC`, el
mount del contenedor de backup). Al restaurar hay que **extraer el contenido
DENTRO de `backend/uploads`** (el directorio que el backend monta en
`/app/uploads`) quitando ese prefijo con `--strip-components=1`:

```bash
cd /opt/inventariopro
# 1. Con el backend detenido (o tras el restore de la BD), descomprime el tar
#    dentro de backend/uploads (el prefijo uploads-src/ del tar se descarta):
tar -xzf backups/uploads-YYYYMMDD-HHMMSS.tar.gz -C backend/uploads --strip-components=1

# 2. Verifica que las fotos quedaron en el directorio que el backend monta:
ls backend/uploads/products/

# 3. Comprueba que el contenedor las ve (el backend monta ./backend/uploads):
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend \
  ls -la /app/uploads/products/
```

> En un servidor Linux recuerda los permisos: el usuario `app` del contenedor
> (uid 999) debe poder leer `backend/uploads` — `chown -R 999:999 backend/uploads`
> si los archivos restaurados quedaron con otro dueño.

### 12.3 Orden de recuperación completo (servidor nuevo)

```bash
cd /opt/inventariopro
git clone <repo> .          # o copia el proyecto existente
cp .env.prod.example .env.prod   # y completa los secretos
# 1. BD: levanta el Postgres, restaura el dump y verifica (sección 12.1)
# 2. Uploads: descomprime el tar (sección 12.2)
# 3. Stack: sube todo — el job 'migrate' es idempotente (no aplica nada ya
#    aplicado en el dump) y el backend arranca después
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

> ⚠️ El dump de `pg_dump -Fc` **no** incluye la estructura de objetos ajenos a
> la app (roles, tablespaces). En un servidor nuevo, el usuario `inventariopro`
> debe existir con su rol antes de restaurar — el `docker run` de la sección
> 12.1 ya lo crea vía `POSTGRES_USER`.

## 13. Variables que NO debes commitear

- `JWT_ACCESS_SECRET`
- `POSTGRES_PASSWORD`, `REDIS_PASSWORD`
- `DEEPSEEK_API_KEY`
- `SUPABASE_SERVICE_KEY`
- `SMTP_PASSWORD`

`.gitignore` ya excluye `.env`, `.env.local`, `.env.prod`. Asegúrate de **no subir** el `.env.prod` al repositorio.
