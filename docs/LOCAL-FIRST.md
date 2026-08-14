# Plan técnico: InventarioPro local-first (app portable de doble clic + nube opcional)

> Estado: **PROPUESTA** (no iniciada). Fecha: 14-08-2026.
> Objetivo: que cualquier persona pueda correr la app en su propia laptop con
> sus datos en su disco (1000+ productos, sin límites ni cuotas centrales),
> sin tener que hacer nada técnico (doble clic), y que **además** exista la
> opción de nube (el modelo actual) para quien la prefiera.
> Modelo de referencia: local-first (Obsidian, Vaultwarden, Notion offline).

---

## 1. Estado actual (verificado en el código)

| Componente | Hoy |
|---|---|
| Backend | NestJS 11 + Prisma 7 (driver adapter **pg**) + PostgreSQL 16 + Redis |
| Frontend | Next.js 16 (App Router), build `standalone` ya en uso para Docker |
| Datos | 9 modelos, 5 enums, `Decimal(12,2)` para dinero — todo filtrado por `user_id` (multi-tenant) |
| Auth | JWT httpOnly cookies, refresh rotativo, throttling por env, SMTP (prod) / log (dev) |
| Uploads | Storage local (`LOCAL_UPLOAD_DIR`) o Supabase (opción) |
| Backup | Contenedor con pg_dump + rclone B2 (modo servidor) |
| Tests | 118 backend · 55 frontend · 6 e2e — **la red de seguridad del proyecto** |

## 2. Objetivo arquitectónico

Dos modos, un solo código:

- **Modo local (nuevo)**: la app se abre con doble clic → levanta un servidor
  local (localhost, puerto fijo p. ej. 3411) → abre el navegador con la app →
  los datos viven en una **base SQLite embebida** en la carpeta de datos del
  usuario (`~/.inventariopro/` o AppData/Application Support según SO).
  Sin Docker, sin Node instalado, sin terminal, sin servidor externo.
- **Modo nube (ya existe)**: el mismo frontend apunta a un backend remoto
  (el VPS con el compose prod actual). Solo es una opción de configuración.

**Regla de oro**: la app nunca escribe en su carpeta de instalación; toda la
data del usuario (SQLite + uploads + config) vive en la carpeta de datos —
esto hace posibles las actualizaciones y el backup por copia simple.

## 3. Decisión de motor de datos (SQLite) — viabilidad YA verificada

El schema actual es portable a SQLite:

| Elemento del schema | ¿Compatible con SQLite? |
|---|---|
| 9 modelos + 5 enums | ✅ Prisma soporta enums en SQLite |
| `Decimal(12,2)` (precio, dinero) | ✅ |
| `String`, `DateTime`, `Boolean`, relaciones | ✅ |
| `@db.Date` / `@db.Text` / `@db.VarChar(3)` | ⚠️ Anotaciones Postgres — **se eliminan** (Prisma mapea `String`/`DateTime` automáticamente) |
| `Json`, `BigInt`, `Unsupported` | ✅ No existen — sin bloqueadores |

- **Adapter**: `@prisma/adapter-better-sqlite3` (Prisma 7 ya usa driver
  adapters — el proyecto ya usa `@prisma/adapter-pg`, así que el cambio es
  consistente con la arquitectura actual).
- **Migraciones**: se regeneran para SQLite (las de Postgres quedan para el
  modo nube). Un solo `schema.prisma` con dos sets de migraciones, o un
  schema por modo generado desde una fuente común.
- **La lógica de negocio NO cambia**: services/controllers hablan con Prisma,
  que abstrae la base. La suite de 118 tests es la red de seguridad.

## 4. Qué se desactiva en modo local (y por qué es gratis)

| Pieza del modo servidor | En modo local |
|---|---|
| Redis (sesiones/caché/rate-limit) | **Deshabilitado** — el código ya degrada a no-op (`RedisService.isEnabled`); throttling usa memoria (default) |
| Verificación de email | **Auto-aprobada o PIN en pantalla** (la cuenta es local; SMTP no aplica). El flujo dev actual ya escribe el enlace en un log |
| Contenedor backup | Sustituido por **export de la carpeta de datos** (zip) + CSV de productos + opción B2 del usuario (futuro) |
| DeepSeek (chat IA) | Sigue **opcional**: llama a la API con la key del usuario; sin key → fallback amable (ya existe) |
| Push web (VAPID) | Funciona en localhost (service worker + VAPID propios del usuario) — no bloqueante |

## 5. Fases de implementación (con estimaciones y riesgos)

### Fase 0 — Prueba de concepto del adapter SQLite (2–4 días) — GO/NO-GO
- Rama experimental: schema sin `@db.*`, migraciones SQLite,
  `@prisma/adapter-better-sqlite3`, `DATABASE_URL=file:./dev.db`.
- **Criterio de éxito**: los 118 tests de integración pasan contra SQLite.
- Riesgo principal: diferencias sutiles (Decimal, DateTime, FKs, upsert) —
  mitigado por la suite existente.
- **Entregable**: decisión documentada GO/NO-GO con evidencia.

### Fase 1 — Backend portable + frontend embebido (1–2 semanas)
- `DATA_MODE=local|cloud` por env (o detección automática).
  - local: SQLite file + Redis off + verificación auto-aprobada.
  - cloud: comportamiento actual (Postgres + Redis + SMTP) — **sin cambios**.
- El frontend (ya con `output: standalone`) se sirve desde el backend Nest
  (express static) o como proceso hermano lanzado por el launcher.
- `npm run build:portable` produce el paquete: backend compilado + frontend
  standalone + un `start` por SO que levanta y abre el navegador.
- **Entregable**: correr la app local con doble clic a un script, datos en
  `~/.inventariopro/`.

### Fase 2 — Empaquetado "doble clic" (1–2 semanas, dos niveles)
- **Nivel A (barato, recomendado primero)**: zip portable = binario/Node
  embebido + frontend standalone + lanzador (`.bat`/`.command`/`.app`).
  Sin compilar binarios nativos. Cubre el 90% del valor.
- **Nivel B (pulido)**: ventana nativa con **Tauri 2** (backend Node como
  sidecar, ~10MB, auto-update) o **Electron** (más simple, ~150MB).
  Recomendación: Tauri para producto final; Electron si se prioriza
  velocidad de desarrollo.
- Datos del usuario SIEMPRE en la carpeta de datos, nunca en la de instalación.
- **Entregable**: un archivo descargable que funciona sin instalar nada más.

### Fase 3 — Modo nube opcional en la UI (días — ya casi listo)
- Pantalla de inicio con selector: **"Usar en este equipo"** (local) o
  **"Conectar a la nube"** (URL del servidor). El modo cloud es el backend
  actual tal cual — solo se guarda la URL/config elegida.
- **Entregable**: el mismo binario sirve local y nube, elegido por el usuario.

### Fase 4 — Portabilidad de datos (acompaña a F1–F3)
- **Export/import completo**: además del CSV de productos (ya existe), un
  **export de la carpeta de datos completa** (sqlite + uploads) como `.zip`
  descargable → migrar entre laptops o como respaldo.
- **Migración local → nube** (futuro, acotado): la app genera un dump del
  SQLite y el modo cloud lo importa (import de CSV ya es la semilla).
- **Entregable**: "me llevo mis 1000 productos a otra máquina" en un clic.

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| SQLite difiere de Postgres (concurrencia, tipos, locking) | Suite de 118 tests como red; modo local = un solo usuario, concurrencia baja (WAL mode) |
| `output: export`/standalone con PWA (service worker, manifest) | El standalone ya está probado en Docker; validar SW/manifest en localhost en Fase 1 |
| Empaquetar Node: `pkg` obsoleto para Node 20+ | Node SEA (Single Executable) o distribuir Node embebido en el zip; Tauri sidecar para el nivel B |
| SmartScreen/Gatekeeper (firma de código) | Firma es de pago; para uso personal/familiar basta el aviso del SO; firmar solo si se publica |
| Un solo schema, dos motores | Mantener migraciones separadas por modo; schema común |
| Chat/IA sin key en local | Fallback amable ya implementado |

## 7. Esfuerzo total estimado

| Fase | Esfuerzo | Resultado |
|---|---|---|
| 0 · POC SQLite | 2–4 días | GO/NO-GO con tests verdes en SQLite |
| 1 · Backend portable | 1–2 semanas | App local corre con un script |
| 2 · Doble clic (nivel A) | ~1 semana | Zip portable |
| 2 · Ventana nativa (nivel B) | +1–2 semanas | Tauri/Electron con auto-update |
| 3 · Nube opcional en UI | días | Mismo binario, local o nube |
| **Total realista** | **~3–4 semanas enfocadas** (nivel A) · ~5–6 (con Tauri) | — |

## 8. Qué NO cambia (para acotar el riesgo)

- Lógica de negocio (services/controllers) — Prisma abstrae la base.
- Frontend casi intacto — solo la pantalla local/nube y la verificación local.
- El modo nube actual (Postgres + Redis + SMTP + backups B2) — intacto.
- Multi-tenant por usuario — en local cada máquina ES un usuario.

## 9. Orden de ejecución recomendado (cuando se retome)

1. **Fase 0** en rama experimental → decisión GO/NO-GO.
2. Si GO: **Fase 1 + Fase 4 (export)**, luego **Fase 2 nivel A** → primera
   versión portable usable.
3. **Fase 3** (selector local/nube) sobre el binario portable.
4. Nivel B (Tauri) y auto-update solo si se va a distribuir a más personas.
