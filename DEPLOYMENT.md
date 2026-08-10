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

Configura backups automáticos de Postgres. Un ejemplo simple con cron:

```bash
# /etc/cron.d/inventariopro-backup
0 3 * * * cd /opt/inventariopro && \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U $POSTGRES_USER $POSTGRES_DB > /backups/db-$(date +\%Y\%m\%d).sql && \
  find /backups -name 'db-*.sql' -mtime +30 -delete
```

## 8. Monitoreo

Recomendaciones mínimas:

- **Logs centralizados**: usar un driver de Docker (json-file con rotación o syslog).
- **Uptime monitoring**: UptimeRobot, BetterStack o Healthchecks.io contra `/api/auth/me`.
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
