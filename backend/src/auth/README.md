# Fase 3 — Autenticación

## Endpoints

Todos en `/api/auth/*`.

| Método | Ruta | Auth | Rate limit | Descripción |
|---|---|---|---|---|
| `POST` | `/auth/register` | público | 100/h global | Crea cuenta, envía email de verificación |
| `POST` | `/auth/login` | público | **5 / 15 min** | Devuelve access + refresh |
| `POST` | `/auth/refresh` | público | 10 / min | Rota el refresh token |
| `POST` | `/auth/logout` | autenticado | global | Invalida el refresh token (o todos) |
| `POST` | `/auth/forgot-password` | público | 3 / hora | Envía email con token de reset |
| `POST` | `/auth/reset-password` | público | global | Cambia contraseña usando token |
| `POST` | `/auth/verify-email` | público | global | Marca email como verificado |

## Flujos

### Registro
1. Cliente envía `{ email, password, nombre }`.
2. Backend valida con `class-validator`.
3. Backend hashea la contraseña con **Argon2id**.
4. Genera token aleatorio, guarda solo el hash SHA-256 en BD.
5. Envía email con el token en claro (válido 24h).
6. Cliente abre `/verify-email?token=...` → backend marca `email_verificado=true`.

### Login
1. Cliente envía `{ email, password }`.
2. Backend busca usuario y compara con `argon2.verify`.
3. Si OK: emite `access_token` (JWT, 15 min) y `refresh_token` (random 48 bytes, 7 días).
4. El refresh se guarda **hasheado** en la tabla `refresh_tokens`.

### Refresh
1. Cliente envía el refresh token.
2. Backend hashea, busca en BD, valida que no esté revocado ni expirado.
3. **Rotación**: revoca el actual, emite uno nuevo.

### Logout
1. Cliente envía su refresh token actual.
2. Backend lo marca como `revoked_at = now()`.

### Reset password
1. Cliente envía email.
2. Backend genera token, guarda hash, envía email con token en claro (1h).
3. Cliente envía `{ token, new_password }`.
4. Backend cambia password, **invalida todos los refresh tokens** activos, limpia tokens.

## Seguridad implementada

- **Hash de contraseñas**: Argon2id (64 MB memory cost, 3 iteraciones).
- **Hash de tokens**: SHA-256 sobre tokens aleatorios — un atacante con acceso a BD no puede usar los tokens.
- **JWT firmado**: `JWT_ACCESS_SECRET` con expiración de 15 minutos.
- **Rotación de refresh tokens**: cada refresh emite uno nuevo e invalida el anterior.
- **Mensajes genéricos**: en login, register y forgot-password no se distingue "usuario no existe" vs "contraseña incorrecta" (evita enumeración).
- **Rate limiting**: `@nestjs/throttler` con 5 intentos por 15 min en login, 3 por hora en forgot-password.
- **CORS estricto**: solo el dominio configurado en `CORS_ORIGIN`.
- **Helmet**: cabeceras HTTP seguras por defecto.
- **Global guard**: `JwtAuthGuard` aplica a todas las rutas excepto las marcadas con `@Public()`.
- **Validación global**: `ValidationPipe` con `whitelist` + `forbidNonWhitelisted` para evitar mass-assignment.
- **Filtro global de excepciones**: respuestas de error uniformes.

## Cómo probarlo

```bash
# 1. Levantar Postgres + Redis (Docker compose ya preparado)
docker compose up -d postgres redis

# 2. Backend
cd backend
npm install
npx prisma migrate dev --name init
npm run start:dev

# 3. Registrar un usuario
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"MiPass123","nombre":"Test User"}'

# 4. Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"MiPass123"}'
```

En modo desarrollo (sin SMTP configurado) el enlace de verificación aparece en la consola del backend.
