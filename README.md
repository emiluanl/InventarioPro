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
| **Frontend** | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| **Estado y datos remotos** | React Query + react-hook-form + zod |
| **Backend** | NestJS 10 + TypeScript |
| **Base de datos** | PostgreSQL 16 + Prisma ORM |
| **Cache, sesiones, rate limiting** | Redis 7 |
| **Almacenamiento de archivos** | Local (dev) / Supabase Storage (prod) |
| **Autenticación** | JWT propio (access 15 min + refresh 7 días, cookies httpOnly) |
| **IA conversacional** | API de MiniMax M3 (chat completions + function calling) |
| **Contenedores** | Docker + docker-compose |
| **HTTPS en producción** | Caddy con Let's Encrypt automático |
| **CI** | GitHub Actions (lint + type-check + tests + build) |

## 📂 Estructura

```
InventarioPro/
├── backend/                          # NestJS + Prisma
│   ├── src/
│   │   ├── auth/                     # Login, register, refresh, logout, forgot/reset
│   │   ├── products/                 # CRUD + filtros + tiempo de posesión
│   │   ├── categories/               # Categorías del sistema + personalizadas
│   │   ├── chat/                     # MiniMax M3 + 4 herramientas (function calling)
│   │   ├── common/                   # Cookies, Storage, Redis, ValidationPipe, Audit
│   │   └── prisma/                   # Cliente Prisma
│   ├── prisma/schema.prisma          # Modelo de datos
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
├── .github/workflows/ci.yml          # CI
├── README.md                         # ← este archivo
├── SECURITY.md                       # Auditoría de seguridad
└── DEPLOYMENT.md                     # Guía paso a paso para producción
```

## ⚡ Arranque rápido (desarrollo)

### Requisitos
- Docker + Docker Compose
- Node.js 20+ (solo si quieres correr sin Docker)
- Una API key de MiniMax M3

### Con Docker (recomendado)

```bash
# 1. Clonar (o copiar) el repositorio
cd InventarioPro

# 2. Crear los .env desde los ejemplos
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 3. Editar backend/.env: poner secretos JWT y MINIMAX_API_KEY
#    (en dev puedes dejar los valores por defecto que ya están en .env.example)

# 4. Levantar todo
docker compose up --build

# Frontend → http://localhost:3000
# Backend  → http://localhost:3001/api
# Postgres → localhost:5432
# Redis    → localhost:6379
```

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
```

### Primer uso

1. Abre http://localhost:3000
2. **Regístrate** con email y contraseña.
3. Revisa la consola del backend: ahí verás el **email de verificación** (modo dev sin SMTP).
4. **Crea un producto** desde "+ Nuevo producto".
5. **Sube una foto** en la vista de detalle.
6. **Abre el chat flotante** y pregunta: *"¿Cuántos productos tengo?"*.

## � Tests

```bash
cd backend
npm run test         # una pasada
npm run test:watch   # modo watch
npm run test:cov     # con cobertura
```

Tests incluidos:
- `auth.service.spec.ts` — register, login, refresh, logout, forgot, reset (11 tests)
- `products.service.spec.ts` — ownership, filtros, paginación, borrado lógico (7 tests)
- `time-ownership.spec.ts` — helper de cálculo de tiempo de posesión (11 tests)

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
- Migración con `prisma migrate deploy`
- HTTPS automático con Caddy (Let's Encrypt)
- Backups automáticos vía cron
- Estimación de costos (~$15–20/mes para uso personal bajo)
- Troubleshooting

## 📋 Endpoints del backend (resumen)

| Recurso | Endpoints |
|---|---|
| **Auth** | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`, `GET /auth/me` |
| **Products** | `GET /products`, `GET /products/:id`, `POST /products`, `PUT /products/:id`, `DELETE /products/:id` |
| **Attachments** | `GET /products/:productId/attachments`, `POST /products/:productId/attachments`, `DELETE /products/:productId/attachments/:id` |
| **Categories** | `GET /categories`, `POST /categories`, `PUT /categories/:id`, `DELETE /categories/:id` |
| **Chat** | `POST /chat/message`, `GET /chat/conversations`, `GET /chat/conversations/:id/messages` |
| **Notifications** | `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `POST /notifications/read-all` |
| **Push** | `GET /push/vapid-public-key`, `POST /push/subscribe`, `POST /push/unsubscribe` (Web Push + VAPID) |
| **Reports** | `GET /reports/spending?year=YYYY` (gasto por categoría, mes y moneda) |

Todos los endpoints están bajo `/api` (configurable). Documentación detallada en cada módulo: [`backend/src/auth/README.md`](./backend/src/auth/README.md), [`backend/src/products/README.md`](./backend/src/products/README.md), [`backend/src/chat/README.md`](./backend/src/chat/README.md).

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

- **129 archivos** de código y configuración
- **~7 500 líneas** de TypeScript / TSX / YAML / Prisma
- **29 tests** unitarios
- **9 modelos** en la base de datos + 5 enums
- **~25 endpoints** REST
- **11 páginas** en el frontend
- **11 componentes** reutilizables

## 📝 Licencia

Privado. No distribuido. Cámbialo a tu preferencia en `package.json` (campo `license`).

## 🤝 Contribuir

Este es un proyecto personal. Si quieres adaptarlo:

1. Fork / copia el repositorio.
2. Crea una rama para tu feature.
3. Commit con mensajes descriptivos.
4. Push y abre un PR (si lo subes a un repo público).
