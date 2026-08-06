# Fase 10 — Testing y despliegue

## Tests (Jest)

Ubicación: `backend/test/`.

| Archivo | Qué cubre |
|---|---|
| `time-ownership.spec.ts` | Helper de cálculo de tiempo de posesión y estado de garantía |
| `auth.service.spec.ts` | register, login, refresh, logout, forgot/reset password |
| `products.service.spec.ts` | Ownership, listado con filtros, borrado lógico |

Correr los tests:

```bash
cd backend
npm run test         # una pasada
npm run test:watch   # modo watch
npm run test:cov     # con cobertura
```

## Dockerfiles

| Archivo | Build stage | Imagen final |
|---|---|---|
| `backend/Dockerfile` | Build con `npm ci` + `prisma generate` + `nest build` | `node:20-alpine` con `dist/` y usuario no-root |
| `frontend/Dockerfile` | Build con `next build` | `node:20-alpine` con `.next/` y usuario no-root |

Ambos con healthcheck usando `wget` y usuario no-root para producción.

## docker-compose.prod.yml

Override del base con:
- Sin exposición de puertos a Postgres (solo backend accede).
- Redis con `--requirepass`.
- `restart: always` en todos los servicios.
- Servicio adicional **Caddy** para HTTPS automático con Let's Encrypt.
- Variables marcadas como `?required` (falla si no están en `.env.prod`).

## CI: `.github/workflows/ci.yml`

En cada push o PR a `main` o `develop`:

- **Backend job** (con Postgres + Redis services en el runner):
  1. `npm ci`
  2. `prisma generate`
  3. `lint`
  4. `tsc --noEmit` (type-check)
  5. `test:cov`
- **Frontend job**:
  1. `npm ci`
  2. `lint`
  3. `type-check`
  4. `build`

## DEPLOYMENT.md

Guía paso a paso con:
- Requisitos del servidor
- Generación de secretos con `openssl rand -hex 32`
- Lista completa de variables de entorno
- Comandos `docker compose`
- Migración de la BD con `prisma migrate deploy`
- Configuración de HTTPS automático con Caddy
- Backups automáticos vía cron
- Estimación de costos
- Troubleshooting

## Cierre del proyecto

Con esta fase se completa el roadmap de 10 fases. Tienes:

✅ Backend NestJS completo (auth, productos, categorías, chat IA).
✅ Frontend Next.js completo (auth, dashboard, productos, chat flotante).
✅ Schema Prisma validado.
✅ Tests unitarios en services críticos.
✅ Dockerfiles multi-stage.
✅ docker-compose para dev y producción.
✅ CI con GitHub Actions.
✅ HTTPS automático con Caddy.
✅ SECURITY.md con checklist completo.
✅ DEPLOYMENT.md con guía paso a paso.
