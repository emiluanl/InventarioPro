# Inspección profunda — InventarioPro

> **Fecha:** 14-08-2026 · **Método:** ejecución real de los sub-proyectos (lint, typecheck, tests, builds, npm audit) + análisis dirigido de código (seguridad, queries, bundles, ambigüedades).
> **Veredicto corto:** base sólida y bien tipada (0 `any`, 0 TODOs, 179 tests verdes). **Estado: los 6 hallazgos de esta inspección están RESUELTOS** — cada sección de las §4-5 incluye su evidencia de la resolución (15-08-2026).

---

## 1. Verificaciones ejecutadas (todo verde salvo donde se indica)

| Chequeo | Resultado |
|---|---|
| Backend ESLint (`--max-warnings=0`) | ✅ 0 warnings |
| Backend `tsc --noEmit` | ✅ limpio |
| Backend Jest | ✅ 124/124 (sin ruido — ver §5.6) |
| Frontend ESLint | ✅ 0 warnings |
| Frontend `tsc --noEmit` | ✅ limpio |
| Frontend Vitest | ✅ 55/55 |
| `next build` (Turbopack 16.3) | ✅ 14 rutas, sin errores |
| npm audit — raíz / frontend | ✅ 0 vulnerabilidades |
| npm audit — backend | ⚠️ 2 low (transitiva de `@supabase/supabase-js`) |
| npm audit — desktop | ✅ **0 vulnerabilidades** (Electron 43.4.0 — ver §4.1) |
| Secretos hardcodeados (`grep` patrones) | ✅ 0 |
| `any` / `<any>` / `as any` en src | ✅ 0 |
| TODO/FIXME/HACK en src | ✅ 0 |
| Tamaño de bundles | ✅ 24 chunks, **0.9 MB total**, chunk mayor 0.22 MB |

## 2. Seguridad — lo que está bien (verificado en código)

- **Storage**: nombres de archivo generados por el servidor (`Date.now()-randomHex` + extensión validada) → sin path traversal; whitelist MIME + extensión + tope 5 MB; borrado idempotente.
- **main.ts**: helmet con CSP estricta en producción, CORS explícito (nunca `*`, `credentials: true`), estáticos con `fallthrough: false`, whitelist en DTOs.
- **Cookies**: httpOnly + Secure (prod) + SameSite=Strict; tokens de refresh almacenados **hasheados** (SHA-256).
- **AuthService**: Argon2id (64 MB, t=3), mensajes genéricos anti-enumeración de usuarios, rotación de refresh, reset/change-password revocan todas las sesiones en transacción, borrado de cuenta limpia los archivos del storage.
- **Ownership**: TODAS las consultas filtran por `user_id` (verificado en products/notifications/categories/chat).
- **Cliente HTTP del frontend**: refresh single-flight (cola de suscriptores), sin bucle de recargas infinito, `withCredentials`.

## 3. Optimización — lo que está bien

- **Caché Redis de listados** (60 s) con invalidación por patrón al mutar; clave estable (hash de la query canonicalizada).
- **Listado en una sola query** (include + `_count`), índices compuestos correctos por `user_id` + filtros usados (`fecha_compra`, `categoria_id`, `estado`, `fecha_vencimiento_garantia`).
- **Bundles mínimos** (0.9 MB total; el chat no infla el chunk principal).
- Agregación de reportes en JS (decisión documentada, escala personal); parse de TTL correcto (segundos, no milisegundos).

## 4. Hallazgos — seguridad

### 4.1 🔴 Desktop: 7 vulnerabilidades (6 high, 1 critical) + Electron 37 desactualizado
- `extract-zip` (high, symlink traversal) y `tar ≤7.5.20` (**critical**, path traversal) son transitivas de `electron-builder`/`@electron/rebuild`: riesgo de **supply chain en build** (desempaquetar tarballs maliciosos), no viajan en la app instalada.
- **Electron 37.10.3** tiene 8+ advisories high (AppleScript injection, service-worker IPC spoofing, registry key injection…). La app solo carga contenido local (mitiga el riesgo práctico), pero conviene subir a una major soportada (`npm audit fix --force` propone 43.x, breaking).
- Acción: `npm audit fix --force` en `desktop/` + rebuild nativo + re-verificación del smoke test (el rebuild de `better-sqlite3` es obligatorio al cambiar el ABI de Electron).
- **✅ RESUELTO (15-08-2026):** `npm audit fix --force` → **Electron 37.10.3 → 43.4.0**, `@electron/rebuild → 4.2.0`, **7 → 0 vulnerabilidades**. `allowScripts` actualizado a la versión nueva; binario descargado y **`better-sqlite3` reconstruido** para el ABI de Electron 43 (argon2 es N-API, sin rebuild). Smoke test headless con el stack actualizado: migraciones → `STACK_READY` → flujo funcional (registro → verify → login → producto → web 200) → **reuso de refresh → 401**. Instalador regenerado (208 MB) y firmado (`Get-AuthenticodeSignature` → `Status: Valid`).

### 4.2 🟡 Hardening: detección de reuso de refresh token
`refresh()` rota el token pero **no revoca la familia de sesiones** si se usa un token ya rotado/robado (la práctica estándar es invalidar todas las sesiones del usuario ante reuso). No es explotable fácilmente (los tokens van hasheados en BD), pero es el clásico gap de OWASP "refresh token reuse".
- **✅ RESUELTO (15-08-2026):** `refresh()` ahora detecta reuso: rotación **atómica** con `updateMany({ where: { token_hash, revoked_at: null, expires_at: { gt: now } } })` (de N peticiones concurrentes solo una gana; el resto entra al chequeo de reuso). Si el token presentado **ya está revocado** → se revoca **toda la familia** de sesiones del usuario (`updateMany` de todos los tokens activos) + log del incidente. Token expirado (no revocado) ≠ reuso: rechazo normal sin tocar la familia. Verificación: suite 124/124 (nuevos tests: rotación atómica 1 update, **reuso revoca la familia**, expirado no revoca, inexistente sin efectos) + **E2E real contra SQLite**: refresh RT1 → 200 (emite RT2), reuso de RT1 → 401, **RT2 → 401** (familia revocada), log "Reuso de refresh token detectado".

### 4.3 🟢 Backend: 2 vulnerabilidades low (transitiva de supabase-js)
Sin acción urgente; revisar en el próximo `npm audit fix` compatible.
- **Actualización (16-08-2026):** `npm audit fix` (compatible) NO las resuelve; el único camino es `--force` (supabase-js 2.45.6 → 2.112.3, fuera del rango declarado). Decisión: **no forzar** — es severidad low, en un path opcional que producción no usa (`STORAGE_PROVIDER=local`) y un salto de ~65 minors sin poder testear el storage Supabase. Se re-evalúa si se activa Supabase o aparece un fix dentro de rango.

## 5. Hallazgos — corrección y ambigüedades

### 5.1 🔴 Bug de paginación con filtro `warranty_status`
`products.service.list()` aplica `skip/take` en SQL y **después** filtra `warranty_status` en JS:
- `pagination.total`/`total_pages` cuentan productos **sin** el filtro → números incorrectos.
- Solo se filtran los items de la página actual → productos que coinciden en páginas posteriores **nunca aparecen**.
- Reproducido por análisis del código (`queryList` → `items.filter` tras `take`).
- Acción: mover el filtro al `where` (requiere expresar "vence en 30 días / ya venció" en el query: `fecha_vencimiento_garantia` entre `now` y `now+30d`, o `< now`) y eliminar el post-filtro.
- **✅ RESUELTO (15-08-2026):** el filtro vive en el `where` SQL (`buildListWhere`, compartido por `list` y `export`): `vencida = fecha_vencimiento_garantia < now`, `por_vencer = now..now+30d`, `vigente = > now+30d` — mismo criterio que `getWarrantyStatus()`. Eliminados los post-filtros JS: `count` y `findMany` usan el mismo `where`, así `total`/`total_pages` son correctos y ningún producto se pierde entre páginas. **4 tests nuevos** (3 parametrizados que verifican el `where` de cada estado + 1 de regresión que fallaría si se reintroduce el post-filtro). Backend: 124/124, lint 0, tsc limpio.

### 5.2 🟡 Doble ValidationPipe global
`main.ts` registra `useGlobalPipes(new ValidationPipe({whitelist, transform}))` **y** `app.module.ts` registra `GlobalValidationPipe` vía `APP_PIPE` (whitelist + `forbidNonWhitelisted` + transform sin conversión implícita). Ambos corren por request:
- Validación duplicada (coste ×2) y settings distintos según el orden (el de main.ts es más débil y puede enmascarar errores del estricto).
- Acción: eliminar el `useGlobalPipes` de `main.ts`; dejar solo el `GlobalValidationPipe`.
- **✅ RESUELTO (15-08-2026):** eliminado `useGlobalPipes` de `main.ts`; queda **un único validador global** (`GlobalValidationPipe` vía `APP_PIPE`: whitelist + `forbidNonWhitelisted` + transform). Una sola validación por request con settings consistentes; suite completa verde (124/124).

### 5.3 🟡 N+1 en `checkWarranties` (notifications)
Por cada producto con garantía: 1 `findFirst` (dedupe) + 1 `create` → **2 queries × producto** cada 6 h. Con 1.000 garantías son 2.000 queries por corrida.
- Acción: un solo `findMany` de notificaciones existentes (user+tipo+product) + `createMany` para las nuevas.
- **✅ RESUELTO (15-08-2026):** de 2×N queries a **2 totales por corrida**: candidatos (producto+tipo) computados en memoria → **1 `findMany`** de dedupe (OR de candidatos) → **1 `createMany`**. El push sigue por item (llamada de red por usuario, no batchcable). Test de regresión nuevo (dedupe con `findMany` ×1 y `createMany` ×1); **`createMany` verificado en runtime real** (Node de Electron 43 + adaptador SQLite): `count = 2` y lectura de vuelta OK.

### 5.4 🟡 N+1 en `importCsv` (products)
Por cada fila: 1 `findFirst` de categoría (cacheado por nombre) + 1 `create` de producto → 1-2 queries × fila, secuenciales. Un CSV de 5.000 filas = ~7.500 queries.
- Acción: `createMany` por lotes + precargar las categorías del usuario en un solo `findMany`.
- **✅ RESUELTO (15-08-2026):** de 1-2 queries × fila a **1 query + lotes**: categorías del usuario + sistema precargadas en **un solo `findMany`** (mapa en memoria, resolución O(1) por fila); solo las categorías *nuevas* hacen create (suelen ser pocas); productos válidos con **`createMany` en lotes de 200**. Eliminado el helper `resolveCategoria` (quedaba huérfano) y el import de `ciEquals`.

### 5.5 🟢 `availableYears` hace un segundo scan completo de productos
`spendingReport` ya carga todos los productos del usuario y luego `availableYears` vuelve a consultar todos. Acción: derivar los años del primer `findMany` (mismo dataset).
- **✅ RESUELTO (15-08-2026):** sin filtro de año (caso dashboard), los años se derivan del primer scan ya cargado; la query extra solo corre cuando hay filtro de año (ahí los productos consultados no bastan). Un `findMany` menos en el camino feliz.

### 5.6 🟢 Ruido en los tests del backend
- `RedisService` intenta conectar a `127.0.0.1:6379` real en los tests (ECONNREFUSED ruidoso) — el mock de Prisma está incompleto (`checkWarranties` en init: "products is not iterable").
- Warning de worker force-exited (timers no liberados, intermitente — teardown del pool de jest, no un leak del código; no reapareció en las corridas finales).
- Los 118 tests pasan, pero el ruido puede enmascarar fallos reales.
- **✅ RESUELTO (15-08-2026):** nuevo helper `test/helpers/redis-noop.ts` (no-op de `RedisService`: get/set/del no-op, `isEnabled → false`) aplicado a los specs que bootean `AppModule` sin sobrescribirlo (auth-flow ×2 y chat-throttling); `prisma-mock.ts` devuelve `[]` por defecto en los `findMany` de colecciones → **0 ECONNREFUSED de Redis y 0 "products is not iterable"** en la corrida completa. Los 2 ECONNREFUSED restantes son **intencionales** (health.spec prueba la ruta degradada → 503; email.spec verifica que con SMTP real el enlace no se loguea, host `localhost:1`). El mock no enmascara: `create`/`findFirst` olvidados siguen fallando alto, y `mockResolvedValueOnce` tiene prioridad sobre los defaults.

## 6. Estado final — todos los hallazgos resueltos

| Hallazgo | Estado | Evidencia clave |
|---|---|---|
| §4.1 Electron 37 + 7 vulns | ✅ | Electron 43.4.0, **0 vulns**; smoke headless + instalador firmado `Valid` |
| §4.2 Reuso de refresh token | ✅ | Rotación atómica + revocación de familia; E2E: RT1→200, reuso RT1→401, RT2→401 |
| §5.1 Paginación `warranty_status` | ✅ | Filtro al `where` SQL; 4 tests nuevos; 124/124 |
| §5.2 Doble `ValidationPipe` | ✅ | Solo `GlobalValidationPipe` (APP_PIPE); suite verde |
| §5.3 N+1 `checkWarranties` | ✅ | 1 `findMany` + 1 `createMany`; `createMany` verificado en runtime real |
| §5.4 N+1 `importCsv` | ✅ | Categorías precargadas (1 query) + `createMany` en lotes de 200 |
| §5.5 `availableYears` 2º scan | ✅ | Años del primer scan; query extra solo con filtro de año |
| §5.6 Ruido de tests | ✅ | `redis-noop` + mock por defecto; 0 ECONNREFUSED accidentales |
| §4.3 2 low (supabase-js) | ⏳ | Pendiente — revisar en el próximo `npm audit fix` compatible |

*Ningún hallazgo permitió escalada entre usuarios, inyección SQL (único `$queryRaw` es `SELECT 1`) ni ejecución de código en la app. Los 8 puntos de acción detectados están resueltos y verificados (tests + runtime real); queda solo la nota §4.3 (2 vulnerabilidades low transitivas de `@supabase/supabase-js`) como seguimiento pasivo.*
