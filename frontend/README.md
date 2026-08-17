# Fase 6 — Frontend: autenticación

## Páginas creadas

| Ruta | Descripción |
|---|---|
| `/login` | Inicio de sesión |
| `/register` | Crear cuenta |
| `/forgot-password` | Solicitar recuperación |
| `/reset-password?token=...` | Cambiar contraseña con token |

Más:
- `/dashboard` placeholder (se implementa en Fase 7).
- Redirección automática:
  - Si no estás autenticado y visitas `/dashboard/*` → te lleva a `/login`.
  - Si estás autenticado y visitas `/login` o `/register` → te lleva a `/dashboard`.

## Hook principal: `useAuth`

Ubicación: `frontend/hooks/use-auth.tsx`.

```tsx
import { useAuth } from '@/hooks/use-auth';

const { user, isLoading, isAuthenticated, login, register, logout, forgotPassword, resetPassword } = useAuth();
```

- Al montar, hace `GET /api/auth/me` para saber si hay sesión.
- `login(input)` → llama a `/api/auth/login` y guarda el user en estado.
- `register(input)` → llama a `/api/auth/register` y redirige a `/login?registered=true`.
- `logout()` → llama a `/api/auth/logout` y limpia el estado.
- `forgotPassword(input)` / `resetPassword(input)` → para los flujos de recuperación.

## Cliente HTTP: `lib/api.ts`

- `axios` con `baseURL` apuntando a `NEXT_PUBLIC_API_URL`.
- `withCredentials: true` para enviar cookies httpOnly.
- Interceptor: si una request recibe 401, intenta `POST /api/auth/refresh` una vez y reintenta.
- `extractErrorMessage(err)` → devuelve un string legible del error del backend (sirve para mostrar mensajes en los formularios).

## Componentes UI base

En `components/ui/`:
- `Button` con variantes `primary`, `secondary`, `ghost`, `danger` y estado `isLoading` con spinner.
- `Input` con soporte de mensaje de error (borde rojo).
- `Label`.
- `Alert` con variantes `error`, `success`, `info`.

Paleta neutra con un solo color de acento (azul), definida en `tailwind.config.ts`.

## Validación

`react-hook-form` + `zod` con schemas en `lib/validations/auth.ts`. Las reglas (longitud mínima, regex, etc.) están sincronizadas con el backend para evitar llamadas innecesarias.

## Variables de entorno

`frontend/.env.local` (creado desde `.env.example`):

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

## Cookies httpOnly

Las cookies `access_token` y `refresh_token` se configuran en el backend con `httpOnly`, `secure` (en producción), `sameSite=strict`. El frontend **nunca** las toca directamente; solo las recibe en cada request gracias a `withCredentials`.

> **Nota**: en el código del backend que dejamos en la Fase 3, los tokens se devuelven en el body del login. La parte de **setearlos en cookies** la implementamos en la Fase 9 (seguridad) para mantener el scope manejable. Mientras tanto, el hook funciona con la sesión tal cual: hace `GET /auth/me` con el `Authorization: Bearer` que también emite el backend (alternativa).

## Cómo probarlo

```bash
# 1. Backend corriendo en localhost:3001
# 2. Frontend
cd frontend
npm install
npm run dev
```

Abre http://localhost:3000 y prueba el flujo register → email (en consola del backend) → login → dashboard.

## 🎨 Logo y assets generados (PNG desde SVG)

Los **SVG fuente** del logo viven versionados en `frontend/public/logo/`
(`logo-symbol-dark.svg`, `logo-symbol-light.svg`, `logo-horizontal-dark.svg`,
`logo-horizontal-light.svg` y `favicon.svg`). Los **PNG** (favicon, iconos PWA,
apple-touch-icon, maskable y splash de iOS) y el `app/favicon.ico` **no se
versionan**: se generan desde los SVG en cada build.

| Script | Qué hace | Cuándo corre |
|---|---|---|
| `npm run generate:logo-assets` | Genera `public/icons/*.png` + `app/favicon.ico` (sharp, determinista) | Manual, y **automáticamente** en `npm run build` |
| `npm run validate:logo-assets` | Falla si falta cualquier asset requerido o tiene dimensiones/formato incorrectos; verifica que las rutas de `layout.tsx` y `manifest.ts` existan | Manual, en CI (frontend) y antes del empaquetado desktop |

Flujo: `npm run build` (y por tanto el Dockerfile, el desktop `build.sh` y el CI)
ejecutan la generación antes de `next build`. Si un checkout limpio no tiene los
PNG, el build los crea solos; `validate:logo-assets` garantiza que nunca se
empaquete con iconos faltantes.

```bash
cd frontend
npm run generate:logo-assets   # regenerar desde los SVG fuente
npm run validate:logo-assets   # verificar que todo está presente y válido
```
