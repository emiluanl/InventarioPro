# 📦 InventarioPro

> Aplicación web full-stack para registrar productos personales y hacer seguimiento de cuándo, dónde y cómo fueron comprados, su garantía y su tiempo de posesión.

**"InventarioPro"** es un nombre de trabajo. Cámbialo por el que prefieras buscando `inventariopro` en `package.json`, `docker-compose*.yml`, `prisma/schema.prisma` y nombres de variables de entorno.

---

## ✨ Qué hace

Pensada como una **herramienta de gestión de posesiones personales** (no como una lista bonita), responde preguntas concretas:

- 🕒 ¿Cuánto tiempo llevo con este producto?
- 🛡️ ¿La garantía sigue vigente o ya venció?
- 💸 ¿Cuánto gasté este año en electrónica / ropa / etc.?
- 📍 ¿Dónde y cuándo compré esto, para un reclamo o seguro?

## 🚀 Stack

| Capa | Tecnología |
|---|---|
| **Frontend** | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS |
| **Estado y datos remotos** | React Query + react-hook-form + zod |
| **Backend** | NestJS 11 + TypeScript |
| **Base de datos** | PostgreSQL 16 + Prisma ORM 7 (cliente generado + driver adapter pg) |
| **Cache, sesiones, rate limiting** | Redis 7 |
| **Almacenamiento de archivos** | Local (dev y despliegue actual: `./backend/uploads`, incluido en los backups) / Supabase Storage (opción soportada) |
| **Autenticación** | JWT propio (access 15 min + refresh 7 días, cookies httpOnly) |
| **IA conversacional** | API de DeepSeek (chat completions + function calling, compatible con OpenAI) |
| **Contenedores** | Docker + docker-compose |
| **HTTPS en producción** | Caddy con Let's Encrypt automático |
| **CI** | GitHub Actions (lint + type-check + tests + build + audit) |

## 📂 Estructura

```
InventarioPro/
├── backend/                          # NestJS + Prisma
│   ├── src/
│   │   ├── auth/                     # Login, register, refresh, logout, forgot/reset
│   │   ├── products/                 # CRUD + filtros + tiempo de posesión
│   │   ├── categories/               # Categorías del sistema + personalizadas
│   │   ├── chat/                     # DeepSeek + 4 herramientas (function calling)
│   │   ├── common/                   # Cookies, Storage, Redis, ValidationPipe, Audit
│   │   ├── generated/prisma/         # Cliente Prisma generado (v7, se commitea)
│   │   └── prisma/                   # PrismaService (adapter pg)
│   ├── prisma/schema.prisma          # Modelo de datos
│   ├── prisma.config.ts              # Config del CLI Prisma 7 (URL, migraciones)
│   ├── test/                         # Tests con Jest
│   ├── Dockerfile
│   └── package.json
├── frontend/                         # Next.js + Tailwind
│   ├── app/
│   │   ├── (auth)/                   # Login, register, forgot, reset
│   │   └── (dashboard)/              # Dashboard, productos, widget de chat
│   ├── components/                   # UI base + productos + chat
│   ├── hooks/                        # useAuth, useProducts, useChat
│   ├── lib/                          # api.ts, types, validations, format
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml                # Desarrollo
├── docker-compose.prod.yml           # Producción
├── Caddyfile                         # Reverse proxy + HTTPS
├── e2e/                              # Tests de navegador (Playwright)
├── .github/workflows/ci.yml          # CI (backend, frontend y e2e)
├── README.md                         # ← este archivo
├── SECURITY.md                       # Auditoría de seguridad
└── DEPLOYMENT.md                     # Guía paso a paso para producción
```

## ⚡ Arranque rápido (desarrollo)

### Requisitos
- Docker + Docker Compose
- Node.js 20.9+ (solo si quieres correr sin Docker)
- Una API key de DeepSeek (opcional; sin ella el chat responde con un fallback amable)

### Con Docker (recomendado)

```bash
# 1. Clonar (o copiar) el repositorio
cd InventarioPro

# 2. Crear los .env desde los ejemplos
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 3. Editar backend/.env: poner secretos JWT y DEEPSEEK_API_KEY
#    (en dev puedes dejar los valores por defecto que ya están en .env.example)

# 4. Levantar todo
docker compose up --build

# Frontend → http://localhost:3010
# Backend  → http://localhost:3001/api
# Postgres → localhost:5432
# Redis    → localhost:6379
```

> ✅ El stack de desarrollo **puede correr a la vez que el de producción**: los
> contenedores usan sufijo `-dev` (`inventariopro-postgres-dev`, …) y el
> frontend publica en `:3010` (producción usa `:3000`). Sus Postgres/Redis
> publican `localhost:5432/6379`, que producción no toca (solo usa la red
> interna).

### Sin Docker

```bash
# Backend
cd backend
npm install
cp .env.example .env
# Edita .env: DATABASE_URL apuntando a tu Postgres local
npx prisma migrate dev --name init
npm run start:dev

# Frontend (en otra terminal)
cd ../frontend
npm install
cp .env.example .env
npm run dev
# (sirve en http://localhost:3010)
```

### Primer uso

1. Abre http://localhost:3010
2. **Regístrate** con email y contraseña.
3. Revisa la consola del backend: ahí verás el **email de verificación** (modo dev sin SMTP).
4. **Crea un producto** desde "+ Nuevo producto".
5. **Sube una foto** en la vista de detalle.
6. **Abre el chat flotante** y pregunta: *"¿Cuántos productos tengo?"*.

## ✅ Tests

Tres capas, todas en el CI:

```bash
# 1) Backend — Jest (118 tests)
cd backend && npm test

# 2) Frontend — Vitest + Testing Library (55 tests)
cd frontend && npm test

# 3) E2E de navegador — Playwright (6 tests: registro → verificación → login,
#    CRUD de productos, categorías, reportes + CSV, chat, notificaciones y
#    configuración de cuenta)
npm install            # en la raíz (deps del e2e)
npx playwright install chromium
npm run test:e2e:local # levanta el stack dev, crea la BD e2e si falta, corre y baja
```

El e2e levanta sus propios servidores (backend en `:3002` con BD `inventariopro_e2e`
dedicada y frontend en `:3102` con build aislado en `.next-e2e`), así que no
interfiere con el dev server ni con la BD de desarrollo. El token de verificación
se recupera del log de emails del backend en modo dev (`DEV_EMAIL_LOG`);
el informe HTML queda en `playwright-report/`.

`npm run test:e2e:local` hace el ciclo completo: levanta el stack de desarrollo
(`docker compose up -d`), espera a que Postgres/Redis estén healthy, crea la BD
`inventariopro_e2e` en ese Postgres si no existe, corre Playwright y baja el stack
(los volúmenes persisten). Pasa flags con `--`: `npm run test:e2e:local -- --trace=on`.

Si ya tienes el stack dev arriba, `npm run test:e2e` (sin el script) sirve igual,
pero requiere que la BD `inventariopro_e2e` exista en el Postgres que publica
`localhost:5432`. En CI se crea automáticamente como servicio de GitHub Actions.

## 🔒 Seguridad

Todas las medidas implementadas están documentadas en [`SECURITY.md`](./SECURITY.md). Resumen:

- **Hashing**: Argon2id para contraseñas, SHA-256 para tokens
- **Auth**: JWT con refresh rotativo + hasheado en BD
- **Cookies**: httpOnly + Secure + SameSite=Strict
- **CORS**: whitelist explícita por dominio
- **Headers**: Helmet con CSP estricto en producción
- **Validación**: class-validator global con anti-mass-assignment
- **Rate limiting**: diferenciado por endpoint (login 5/15min, chat 20/min, etc.)
- **Auditoría**: AuditInterceptor con logs JSON en acciones sensibles
- **Ownership**: verificado en services, no solo en guards
- **Secretos**: 0 hardcodeados (verificable con `grep`)

Para auditorías internas: ver [`SECURITY.md`](./SECURITY.md).

## 🚀 Despliegue a producción

Guía paso a paso en [`DEPLOYMENT.md`](./DEPLOYMENT.md). Incluye:

- Requisitos del servidor
- Generación de secretos con `openssl rand`
- Variables de entorno obligatorias
- Comando `docker compose -f docker-compose.prod.yml up -d --build`
- Migraciones aplicadas por el job one-shot `migrate` antes de servir
- HTTPS automático con Caddy (Let's Encrypt)
- Backups automáticos de Postgres (contenedor con cron + pg_dump + retención + **copia remota opcional con rclone** a S3/SFTP/NAS + **watchdog que alarma si el último dump supera 26 h** con heartbeat a healthchecks.io, ver [DEPLOYMENT.md §7-8](./DEPLOYMENT.md))
- **Recuperación ante desastre** con procedimiento probado: restaurar el dump (BD) y el tar de uploads (fotos) en servidor nuevo o tras corrupción, ver [DEPLOYMENT.md §12](./DEPLOYMENT.md)
- Monitoreo de la API (contenedor `monitor` con probe cada 5 min a `/api/auth/me`, alerta si la API deja de responder; extensible a UptimeRobot/BetterStack con dominio real, ver [DEPLOYMENT.md §8](./DEPLOYMENT.md))
- Estimación de costos (~$15–20/mes para uso personal bajo)
- Troubleshooting

## 📋 Endpoints del backend (resumen)

| Recurso | Endpoints |
|---|---|
| **Auth** | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`, `GET /auth/me` |
| **Products** | `GET /products`, `GET /products/:id`, `POST /products`, `PUT /products/:id`, `DELETE /products/:id` · **CSV**: `GET /products/export`, `POST /products/import` |
| **Attachments** | `GET /products/:productId/attachments`, `POST /products/:productId/attachments`, `DELETE /products/:productId/attachments/:id` |
| **Categories** | `GET /categories`, `POST /categories`, `PUT /categories/:id`, `DELETE /categories/:id` |
| **Chat** | `POST /chat/message`, `GET /chat/conversations`, `GET /chat/conversations/:id/messages` |
| **Notifications** | `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `POST /notifications/read-all` |
| **Push** | `GET /push/vapid-public-key`, `POST /push/subscribe`, `POST /push/unsubscribe` (Web Push + VAPID) |
| **Reports** | `GET /reports/spending?year=YYYY` (gasto por categoría, mes y moneda) |

Todos los endpoints están bajo `/api` (configurable). Documentación detallada en cada módulo: [`backend/src/auth/README.md`](./backend/src/auth/README.md), [`backend/src/products/README.md`](./backend/src/products/README.md), [`backend/src/chat/README.md`](./backend/src/chat/README.md).

### 📦 Importar / Exportar CSV

Desde el dashboard (`Exportar CSV` / `Importar CSV`) puedes mover tu inventario
entre apps o hacer una carga inicial masiva. El export respeta los filtros
activos; el import valida fila a fila (las inválidas se reportan con su nº de
línea sin abortar el resto) y **crea las categorías por nombre** que no existan.

Columnas (UTF-8, primera fila = cabecera): `nombre`, `categoria`, `marca`,
`modelo`, `descripcion`, `fecha_compra` (YYYY-MM-DD), `lugar_compra`,
`tipo_compra` (FISICO/ONLINE), `precio`, `moneda` (ISO 4217), `metodo_pago`,
`numero_serie`, `duracion_garantia_meses`, `fecha_vencimiento_garantia`,
`estado`, `notas`, `tags`. Si falta `fecha_vencimiento_garantia` pero hay
`duracion_garantia_meses`, el vencimiento se calcula desde `fecha_compra`.
Un archivo exportado se puede re-importar tal cual.

## 🤖 Asistente IA — qué puede hacer

Usa **function calling** contra tu propio backend:

| Función | Ejemplo de pregunta |
|---|---|
| `buscar_productos` | *"¿Qué compré en enero?"* |
| `crear_producto` | *"Acabo de comprar una licuadora Oster en Falabella por $150 hace 2 días"* |
| `consultar_garantias_por_vencer` | *"¿Qué garantías vencen este mes?"* |
| `resumen_gastos` | *"¿Cuánto gasté en electrónica este año?"* |

Las herramientas ejecutan SIEMPRE del lado del servidor con filtrado por `user_id` — la IA no puede ver ni modificar datos de otros usuarios.

## �️ Roadmap por fases (completado)

| # | Fase | Documentación |
|---|---|---|
| 1 | Configuración inicial | este README |
| 2 | Base de datos (Prisma) | [`backend/prisma/README.md`](./backend/prisma/README.md) |
| 3 | Backend: autenticación | [`backend/src/auth/README.md`](./backend/src/auth/README.md) |
| 4 | Backend: productos | [`backend/src/products/README.md`](./backend/src/products/README.md) |
| 5 | Backend: chat IA | [`backend/src/chat/README.md`](./backend/src/chat/README.md) |
| 6 | Frontend: autenticación | [`frontend/README.md`](./frontend/README.md) |
| 7 | Frontend: dashboard | [`frontend/docs/PHASE_7.md`](./frontend/docs/PHASE_7.md) |
| 8 | Frontend: chat | [`frontend/docs/PHASE_8.md`](./frontend/docs/PHASE_8.md) |
| 9 | Hardening de seguridad | [`backend/src/auth/PHASE_9.md`](./backend/src/auth/PHASE_9.md), [`SECURITY.md`](./SECURITY.md) |
| 10 | Tests y despliegue | [`backend/test/PHASE_10.md`](./backend/test/PHASE_10.md), [`DEPLOYMENT.md`](./DEPLOYMENT.md) |

## 📊 Estadísticas del proyecto

- **175 archivos** de código y configuración (+ 17 del cliente Prisma generado)
- **~15 400 líneas** de TypeScript / TSX / YAML / Prisma (sin el cliente generado)
- **179 tests** (118 backend + 55 frontend + 6 e2e de navegador)
- **9 modelos** en la base de datos + 5 enums
- **~35 endpoints** REST
- **12 páginas** en el frontend
- **24 componentes** reutilizables

## 📝 Licencia

Privado. No distribuido. Cámbialo a tu preferencia en `package.json` (campo `license`).

## 🤝 Contribuir

Este es un proyecto personal. Si quieres adaptarlo:

1. Fork / copia el repositorio.
2. Crea una rama para tu feature.
3. Commit con mensajes descriptivos.
4. Push y abre un PR (si lo subes a un repo público).
