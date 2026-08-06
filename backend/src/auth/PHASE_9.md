# Fase 9 — Hardening de seguridad

## Cambios principales

### Backend

- **Cookies httpOnly + Secure + SameSite=Strict** para `access_token` y `refresh_token` (en lugar de devolverlos en el body).
- **`cookie-parser`** añadido como dependencia para leer cookies en el server.
- **`CookiesService`** centraliza el set/clear de cookies.
- **`AuthController`** ahora setea cookies en login/refresh y limpia en logout.
- **`AuditInterceptor`** loguea acciones sensibles en formato JSON.
- **`main.ts`**: CSP estricto en producción (Helmet), cookie-parser middleware.
- **`AuthService.refresh()`** ahora devuelve también los `max_age_ms` para que las cookies caduquen correctamente.

### Frontend

El frontend **no cambió** porque ya estaba preparado para cookies (`withCredentials: true` + interceptor de 401). Ahora simplemente no necesita extraer tokens del body.

## Verificación de secretos

```bash
grep -rEn "(password|secret|api_key|apiKey|token)\s*[:=]\s*['\"][^'\"]+['\"]" backend/src --include='*.ts' \
  | grep -v 'this.config' | grep -v 'process.env' | grep -v '.env' | grep -v 'JWT_'
```

Resultado: **vacío**. Cero secretos hardcodeados.

## Documentación

`SECURITY.md` (raíz del proyecto) lista todas las medidas implementadas y un checklist de despliegue a producción.
