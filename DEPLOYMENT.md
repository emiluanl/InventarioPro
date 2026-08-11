# InventarioPro — Guía de despliegue

> Cómo llevar InventarioPro a producción. Asume Docker en el servidor.

## 1. Requisitos previos

- **Servidor** con Docker 24+ y Docker Compose v2.
- **Dominio** propio con DNS apuntando al servidor (A o AAAA records).
- **Subdominios** para frontend y API (ej. `app.inventariopro.com` y `api.inventariopro.com`).
- **Puerto 80 y 443** abiertos en el firewall.

## 2. Generar secretos

```bash
# Genera strings aleatorios para JWT
openssl rand -hex 32   # JWT_ACCESS_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET

# Genera una contraseña fuerte para Redis y Postgres
openssl rand -hex 24   # REDIS_PASSWORD
openssl rand -hex 24   # POSTGRES_PASSWORD
```

## 3. Crear `.env.prod`

En la raíz del proyecto, crea `.env.prod` con TODAS estas variables:

```env
# Dominios
FRONTEND_DOMAIN=app.inventariopro.com
API_DOMAIN=api.inventariopro.com

# API expuesta al frontend
PUBLIC_API_URL=https://api.inventariopro.com/api

# CORS: solo el dominio exacto del frontend
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
JWT_REFRESH_SECRET=tu-refresh-secret-aqui-32-chars-min
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

# IA (MiniMax M3)
MINIMAX_API_KEY=tu-clave-MiniMax
MINIMAX_API_BASE=https://api.MiniMax.com/v1
MINIMAX_MODEL=MiniMax-M3
MINIMAX_TIMEOUT_MS=10000

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

## 5. Migrar la base de datos

```bash
# Una vez levantado, ejecuta las migraciones dentro del contenedor del backend
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

## 6. HTTPS automático

Caddy (incluido en el compose) obtiene y renueva certificados de Let's Encrypt automáticamente.

Verifica después de unos minutos:

```bash
curl -I https://api.inventariopro.com/api/auth/me
curl -I https://app.inventariopro.com
```

## 7. Backups

El stack incluye un **contenedor de backups automático** (`backup/`): un cron
dentro de Docker ejecuta `pg_dump` en formato custom comprimido (`-Fc`) y
aplica retención. Se levanta solo con `up -d` (no necesita configuración
adicional) y escribe los dumps en `./backups` del host:

```bash
# Por defecto: 03:00 diario (UTC o la TZ configurada), retención 14 días.
# Sobrescribible desde .env.prod:
#   BACKUP_SCHEDULE="0 3 * * *"
#   BACKUP_KEEP_DAYS=14
#   TZ=America/Argentina/Buenos_Aires
#   WATCHDOG_SCHEDULE="7 * * * *"   (watchdog cada hora)
#   STALE_AFTER_MIN=1560             (26 h: alarma si el último dump es viejo)
#   MONITOR_PING_URL="https://hc-ping.com/<check-id>"  (heartbeat/alarma, ver §8)

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

> Además del backup diario, el contenedor ejecuta un **watchdog** (`check.sh`)
> cada hora que comprueba la antigüedad del último dump y, si supera
> `STALE_AFTER_MIN` (26 h), lo registra en los logs, avisa a `MONITOR_PING_URL`
> (si está configurada) y deja de pasar el healthcheck de Docker.

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

> ⚠️ `restore` usa `--clean --if-exists`: **reemplaza** el contenido actual de la
> base de datos por el del dump. Hazlo solo si estás seguro de querer volver a
> ese estado (p. ej. tras un desastre o un error de migración).

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
RCLONE_REMOTE=s3backup:inventariopro
```

#### 3. Reiniciar el contenedor y verificar

```bash
docker compose -p inventariopro-prod -f docker-compose.prod.yml \
  --env-file .env.prod up -d --build backup

# Backup inmediato: debe aparecer "copia remota OK" en los logs
docker compose -p inventariopro-prod -f docker-compose.prod.yml \
  --env-file .env.prod exec backup /usr/local/bin/backup

docker compose -p inventariopro-prod -f docker-compose.prod.yml \
  --env-file .env.prod logs backup | grep -E 'copia|retención remota'

# Confirmar los archivos en el destino (dentro del contenedor)
docker compose -p inventariopro-prod -f docker-compose.prod.yml \
  --env-file .env.prod exec backup rclone ls s3backup:inventariopro
```

A partir de ahí, cada ejecución del cron (03:00) hace: `pg_dump` → retención
local → `rclone copy` al destino → retención remota (`rclone delete
--min-age`, mismo `BACKUP_KEEP_DAYS`).

#### 4. Restaurar desde la copia remota

```bash
# 1) Traer el dump al servidor
cd backups && docker compose -p inventariopro-prod -f docker-compose.prod.yml \
  --env-file .env.prod run --rm backup \
  rclone copy s3backup:inventariopro/inventariopro-YYYYMMDD-HHMMSS.dump /backups/

# 2) Restaurar (--clean: reemplaza el contenido actual de la BD)
docker compose -p inventariopro-prod -f docker-compose.prod.yml \
  --env-file .env.prod exec backup \
  /usr/local/bin/restore /backups/inventariopro-YYYYMMDD-HHMMSS.dump
```

> ⚠️ Igual que la restauración local: `restore` usa `--clean --if-exists` y
> **reemplaza** la base actual por el contenido del dump.

## 8. Monitoreo

### Alarma de backups (watchdog + heartbeat)

El contenedor `backup` trae dos mecanismos integrados:

- **Heartbeat**: `backup.sh` hace `GET <MONITOR_PING_URL>` cuando el backup
  termina bien y `GET <MONITOR_PING_URL>/fail` si falla (convención
  healthchecks.io). Es el latido de "los backups están funcionando".
- **Watchdog**: `check.sh` (cron cada hora) comprueba que el último dump tenga
  menos de `STALE_AFTER_MIN` minutos (26 h por defecto). Si está viejo o no
  hay ningún dump, hace `GET <MONITOR_PING_URL>/fail` y falla el healthcheck
  de Docker (`docker ps` lo muestra como *unhealthy*). Sin dumps aún (primer
  arranque) el healthcheck se considera sano.

#### Configurar el aviso

1. Crea un **check en healthchecks.io** (gratis) con periodicidad "24 h" y
   período de gracia de 2 h: `https://hc-ping.com/<check-id>`. También sirve
   cualquier endpoint compatible con ese patrón (ntfy, scripts propios...).
2. En `.env.prod`:

   ```bash
   MONITOR_PING_URL=https://hc-ping.com/<check-id>
   # Opcional:
   # STALE_AFTER_MIN=1560
   # WATCHDOG_SCHEDULE="7 * * * *"
   ```

3. Aplica:

   ```bash
   docker compose -p inventariopro-prod -f docker-compose.prod.yml \
     --env-file .env.prod up -d --build backup
   ```

#### Verificar la alarma

```bash
# Estado del último dump y del watchdog (OK o STALE + antigüedad)
docker compose -p inventariopro-prod -f docker-compose.prod.yml exec backup /usr/local/bin/check

# Healthcheck de Docker (healthy/unhealthy)
docker ps --filter name=inventariopro-backup

# Pings enviados (al configurar MONITOR_PING_URL, healthchecks.io los registra)
docker compose -p inventariopro-prod -f docker-compose.prod.yml logs backup | grep heartbeat
```

Sin `MONITOR_PING_URL`, la alarma sigue funcionando vía **logs** y **exit
code** (útil para scripts o monitores que lean `docker logs`).

### Alarma del backend (probe de la API)

El stack incluye un contenedor **`monitor`** que comprueba la API cada 5
minutos contra `/api/auth/me` (por defecto por la red interna del compose) y
alerta si deja de responder:

- **Semántica tipo UptimeRobot**: cualquier respuesta HTTP 2xx-4xx = API viva
  (sin sesión, `/api/auth/me` responde 401: "está arriba"); 5xx, timeout o
  error de conexión = caída.
- **Sin falsos positivos**: reintenta `CHECK_RETRIES` veces (3) con
  `RETRY_DELAY_SEC` segundos (10) antes de declarar DOWN.
- **Aviso**: cuando la API responde hace `GET <MONITOR_PING_URL>` y si queda
  caída `GET <MONITOR_PING_URL>/fail` (misma URL de heartbeat que los
  backups). Sin `MONITOR_PING_URL`, la alarma queda en logs y exit codes.

Variables en `.env.prod` (opcionales, hay defaults):

```bash
# API_CHECK_URL=http://backend:3001/api/auth/me
# CHECK_SCHEDULE="*/5 * * * *"
# CHECK_RETRIES=3
# RETRY_DELAY_SEC=10
```

Verificar:

```bash
# Probe manual (UP/DOWN + antigüedad de la respuesta)
docker compose -p inventariopro-prod -f docker-compose.prod.yml exec monitor /usr/local/bin/uptime

# Logs del cron
docker compose -p inventariopro-prod -f docker-compose.prod.yml logs -f monitor
```

> 🌐 **Cuando tengas un dominio real** (ver §6), puedes además apuntar
> **UptimeRobot o BetterStack** directamente a
> `https://api.tudominio.com/api/auth/me` con intervalo de 5 min: al ser una
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
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

## 10. Troubleshooting

| Problema | Solución |
|---|---|
| Backend no arranca | `docker compose logs backend` para ver el error |
| Migración falla | Revisar `DATABASE_URL` y que Postgres esté sano |
| Cookies no se setean | Verificar que `NODE_ENV=production` y HTTPS activo |
| CORS rechaza el frontend | Confirmar que `CORS_ORIGIN` es EXACTO al dominio del frontend |
| IA no responde | Verificar `MINIMAX_API_KEY` y que `MINIMAX_API_BASE` esté correcto |
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

## 12. Variables que NO debes commitear

- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `POSTGRES_PASSWORD`, `REDIS_PASSWORD`
- `MINIMAX_API_KEY`
- `SUPABASE_SERVICE_KEY`
- `SMTP_PASSWORD`

`.gitignore` ya excluye `.env`, `.env.local`, `.env.prod`. Asegúrate de **no subir** el `.env.prod` al repositorio.
