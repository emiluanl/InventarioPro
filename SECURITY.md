# InventarioPro — SECURITY

> Documento de seguridad. Lista de medidas implementadas y comprobaciones para auditorías internas.

## 1. Resumen ejecutivo

InventarioPro está diseñado siguiendo el principio de **mínimo privilegio** y **defensa en profundidad**:

- **Cero secretos hardcodeados**: todas las claves van en variables de entorno.
- **HTTPS en producción**: cabeceras `Helmet` + cookies `Secure` cuando `NODE_ENV=production`.
- **Autenticación robusta**: Argon2id para contraseñas, JWT con refresh rotativo.
- **Validación en dos capas**: `class-validator` en el backend (autoridad) + `zod` en el frontend (UX).
- **Ownership verificado**: cada recurso comprueba que pertenece al usuario autenticado.
- **Auditoría**: log estructurado en acciones sensibles.
- **Rate limiting**: diferenciado por endpoint.

## 2. Medidas implementadas

### 2.1 Autenticación y contraseñas

| Medida | Estado |
|---|---|
| Hash con **Argon2id** (memory 64MB, time 3, parallelism 1) | ✅ |
| Validación de complejidad mínima (8 chars, letras + números) | ✅ |
| Tokens hasheados (SHA-256) en BD (verificación, reset, refresh) | ✅ |
| JWT firmado con `JWT_ACCESS_SECRET` (HS256) | ✅ |
| Access token 15 min + refresh token 7 días | ✅ |
| Refresh tokens rotativos (cada refresh emite uno nuevo e invalida el anterior) | ✅ |
| Cambio de contraseña invalida TODOS los refresh tokens | ✅ |
| Mensajes genéricos en login/register/forgot (evita enumeración) | ✅ |
| Endpoint `GET /auth/me` protegido por guard JWT | ✅ |

### 2.2 Cookies y sesión

| Medida | Estado |
|---|---|
| Cookies `httpOnly` (no accesibles desde JS) | ✅ |
| Cookies `Secure` en producción (solo HTTPS) | ✅ |
| Cookies `SameSite=Strict` (protección CSRF adicional) | ✅ |
| Cookie `refresh_token` solo se lee en el backend (no se expone) | ✅ |
| Logout invalida el refresh token en BD | ✅ |

### 2.3 Validación de entrada

| Medida | Estado |
|---|---|
| `class-validator` + `ValidationPipe` global | ✅ |
| `whitelist: true` + `forbidNonWhitelisted: true` (anti mass-assignment) | ✅ |
| `transform: true` (coerción de tipos) | ✅ |
| Validación de archivos: MIME, extensión, tamaño (5 MB) | ✅ en `StorageService` |
| Validación de query params (tipos, rangos, enums) | ✅ en `ProductsQueryDto` |

### 2.4 Authorization

| Medida | Estado |
|---|---|
| Guard JWT global (`JwtAuthGuard`) | ✅ respeta `@Public()` |
| Verificación de ownership en el service (no solo en el guard) | ✅ `assertOwned()` en Products y Attachments |
| Categorías: el service filtra por `user_id` o `null` | ✅ |

### 2.5 Cabeceras HTTP y CORS

| Medida | Estado |
|---|---|
| `helmet` activo con CSP en producción | ✅ |
| `crossOriginEmbedderPolicy: false` (compatibilidad con imágenes externas) | ✅ |
| CORS con whitelist explícita por dominio | ✅ `CORS_ORIGIN` |
| `credentials: true` para cookies cross-origin | ✅ |
| Métodos HTTP permitidos explícitos | ✅ |

### 2.6 Rate limiting

| Endpoint | Límite | Estado |
|---|---|---|
| `POST /auth/login` | 5 / 15 min por IP | ✅ |
| `POST /auth/refresh` | 10 / min | ✅ |
| `POST /auth/forgot-password` | 3 / hora | ✅ |
| `POST /auth/register` | 100 / hora (global) | ✅ |
| `POST /chat/message` | 20 / min por usuario | ✅ |
| Global | 100 / min | ✅ |

### 2.7 Auditoría

- `AuditInterceptor` loguea en formato JSON todas las requests a:
  - `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`.
  - `/products/:id` (PUT/DELETE) y `/products/:id/attachments/*` (POST/DELETE).
- Cada entrada incluye: método, path, status, duración, IP, user-agent, timestamp.

### 2.8 Manejo de errores

- `AllExceptionsFilter` global: SIEMPRE devuelve el mismo formato JSON.
- Mensajes genéricos donde revelar información ayudaría a un atacante.
- Errores 5xx se loguean con stack; el cliente recibe mensaje genérico.

### 2.9 IA (chat)

- Timeout de 10 s con `AbortController` + 1 reintento en errores transitorios.
- Fallback amable en cualquier fallo (nunca error crudo al usuario).
- Function calling corre SIEMPRE en el servidor con filtrado por `user_id`.
- Rate limit 20/min por usuario.
- La API key de MiniMax va en variable de entorno, nunca en código.

### 2.10 Almacenamiento de archivos

- Validación de MIME, extensión y tamaño (5 MB) en el servidor.
- En producción: Supabase Storage con URLs firmadas por 1 año.
- El `STORAGE_PROVIDER` es configurable; el código no hardcodea credenciales.

## 3. Verificación de secretos

Comando que usamos para validar:

```bash
grep -rEn "(password|secret|api_key|apiKey|token)\s*[:=]\s*['\"][^'\"]+['\"]" backend/src --include='*.ts' \
  | grep -v 'this.config' | grep -v 'process.env' | grep -v '.env' | grep -v 'JWT_'
```

**Resultado esperado**: vacío.

## 4. Checklist de despliegue a producción

Antes de subir a producción:

- [ ] `NODE_ENV=production` en el servidor.
- [ ] Generar `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` con `openssl rand -hex 32` (cada uno).
- [ ] Configurar SMTP real para emails.
- [ ] Configurar Supabase Storage con credenciales reales.
- [ ] `CORS_ORIGIN` con el dominio exacto (sin `*`).
- [ ] HTTPS activo (certificado válido, redirección 80 → 443).
- [ ] Rate limit storage en Redis (no memoria local).
- [ ] Backups automáticos de la base de datos.
- [ ] Logs centralizados para auditoría.
- [ ] Política de privacidad publicada.

## 5. Decisión de privacidad sobre borrado de cuenta

Cuando un usuario borra su cuenta:

1. Sus productos, adjuntos y conversaciones se eliminan en cascada.
2. Los archivos en storage se borran (Supabase `remove()`).
3. Los refresh tokens se revocan.
4. La fila del usuario se elimina (GDPR-style hard delete).

*(Implementar `DELETE /users/me` con confirmación cuando sea necesario.)*

## 6. Reporte de vulnerabilidades

Si encuentras una vulnerabilidad, **no abras un issue público**. Escribe a `security@inventariopro.example` (o el canal privado que configures). Incluye:

- Descripción del problema.
- Pasos para reproducir.
- Impacto potencial.
- (Opcional) Propuesta de fix.
