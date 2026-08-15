# Autoevaluación del proyecto — InventarioPro

> **Fecha:** 14-08-2026 · **Autor:** autoevaluación técnica (criterio senior, sin autocomplacencia)
> **Alcance:** estado actual del repo tras el recorrido reciente (arranque con un comando, modo SQLite sin Docker, app de escritorio Electron + firma).
> **Datos duros:** 265 archivos trackeados · 179 tests (118 backend + 55 frontend + 6 e2e) · 3 formas de ejecución · ~750 MB de artefactos regenerables en disco.

---

## 1. Resumen ejecutivo

El proyecto es **funcionalmente sólido y demostrable de punta a punta** (web + API + 3 modos de ejecución + desktop instalable firmado), pero arrastra **deuda de diseño por acumulación**: cada pedido se resolvió de forma correcta y verificada, y a la vez cada uno añadió una capa nueva de complejidad sin consolidar la anterior. El resultado es un proyecto con **muy buen producto y una arquitectura con 3 formas de correr el mismo stack** que empieza a fragmentarse.

**Nota global: 7.4 / 10** — muy autoevaluada. Es un 7 alto / 8 bajo: no es basura, pero no está limpio.

---

## 2. Criterios y puntuación

| Criterio | Peso | Nota | Comentario corto |
|---|---|---|---|
| Arquitectura y decisiones de stack | 30% | **7.5** | Un solo código para Postgres/SQLite y web/desktop es elegante; el precio es regenerar el cliente Prisma en runtime y duplicar el stack en `desktop/resources/` (~550 MB). |
| Calidad de código y tests | 25% | **7.0** | 179 tests verdes y typecheck limpio; pero el desktop y los orquestadores (`start.sh`, `build.sh`) no tienen tests automatizados, y el build del desktop es una pipeline de ~30 min frágil. |
| Seguridad | 15% | **8.0** | Fuerte (argon2id, JWT rotativo, cookies Secure, CSP, rate limiting, ownership, 0 secretos commiteados). Flancos: secretos JWT en claro en `%APPDATA%`, dumps de backup sin cifrar, certificado autofirmado (solo confiable local). |
| DX / onboarding | 15% | **8.0** | `npm start` de un comando + SQLite automático + desktop de un clic es un buen viaje. Falla en Windows sin Git Bash y en builds del desktop lentos/no-bootstrapped. |
| Mantenibilidad / deuda técnica | 15% | **6.5** | Triple forma de correr el stack, documentación triplicada, 4+ archivos obsoletos, el "dance" de regenerar/restaurar el cliente Prisma. |

**Nota ponderada = 7.4 / 10.**

Para que sea útil, esto es lo que separa el 7.4 de un 9: **un solo orquestador** (matar `start.sh` o el desktop a favor del otro, o unificar), **tests para el desktop y los scripts**, y **borrar la basura listada abajo**.

---

## 3. Fortalezas reales (verificadas, no presumidas)

1. **Un solo esquema, dos proveedores** — `schema.prisma` (Postgres prod) y `schema.sqlite.prisma` (local) comparten modelo; la única incompatibilidad real encontrada (`mode: 'insensitive'`) se resolvió con un helper provider-aware (`prisma-filters.ts`) y **se probó en ambos modos**.
2. **Tres modos de ejecución verificados end-to-end**: `npm start` (Postgres → Docker → SQLite por degradación), y desktop headless (`STACK_READY` + smoke test funcional: registro → verify → login → CRUD → búsqueda).
3. **Seguridad por capas** con auditoría propia (SECURITY.md) y 0 secretos en git (`.env*`, `rclone.conf`, `certs/` gitignored; verificado con `git ls-files`).
4. **Documentación operativa real** (DEPLOYMENT.md con recuperación ante desastre probada, backups con watchdog, monitor).
5. **Firma de código funcional** con el flujo honesto documentado (autofirmado local vs OV/EV público).

## 4. Debilidades críticas (lo que bajaría la nota)

1. **Triplicación del stack**: `npm start` (orquestador bash), `docker compose` (dev) y `desktop/resources/` (embebido) mantienen tres formas de ensamblar el mismo backend+frontend. Cada una tiene su propia lógica de env, migraciones y limpieza. Un cambio en una rara vez toca las otras dos.
2. **Cliente Prisma regenerado en runtime**: el modo SQLite exige `prisma generate` con el otro proveedor y `git checkout` al salir. Funciona (verificado, árbol limpio), pero es frágil: si el proceso muere a mitad, el repo queda con el cliente equivocado.
3. **El desktop no tiene tests propios**: solo smoke headless manual. `build.sh` es una pipeline de ~30 min (copiar ~500 MB en MSYS) que ya falló 4 veces por detalles de entorno durante el desarrollo; sin CI ni tests, cada release es una lotería.
4. **Fragmentación documental**: README + DEPLOYMENT.md + docs/DEPLOY-SETUP.md + docs/LOCAL-FIRST.md + SECURITY.md + docs de fase. Hay solapamiento y un plan obsoleto (ver basura).
5. **Coste de disco**: ~750 MB de artefactos regenerables (`desktop/dist` 385 MB, `desktop/resources` 553 MB, `frontend/.next`, `backend/dist`, node_modules) viven en el working tree; `backups/` suma dumps reales.

---

## 5. Inventario de basura obsoleta (recorrido reciente)

Leyenda: 🟥 borrar / 🟨 consolidar / 🟩 inofensivo pero regenerable.

| # | Ítem | Estado git | Por qué es basura | Acción recomendada |
|---|---|---|---|---|
| 1 | `scripts/start-backend.cmd` | 🟥 TRACKEADO | Script legacy de "tarea programada de Windows" (schtasks ONLOGON). **0 referencias** en README/DEPLOYMENT/package.json. Superado por `npm start` y por la app de escritorio. | ✅ **BORRADO (15-08-2026)** |
| 2 | `docs/LOCAL-FIRST.md` | 🟥 TRACKEADO | Plan "PROPUESTA (no iniciada)" del 14-08-2026 que el trabajo reciente **ya implementó en gran parte** (modo SQLite + app portable de doble clic). Nadie lo referencia y describe como futuro lo que ya existe. | ✅ **BORRADO (15-08-2026)** |
| 3 | `rclone/rclone.conf;C` | 🟥 NO trackeado (ignorado) | Directorio vacío de 0 bytes, artefacto de mangling de shell (un comando terminó en `;C`). Basura pura en disco. | ✅ **BORRADO (15-08-2026)** |
| 4 | `desktop/dist/builder-debug.yml` | 🟨 NO trackeado (ignorado) | Depuración de electron-builder; se regenera sola en cada build. | Ignorar (inofensivo) o limpiar en build.sh. |
| 5 | `backups/` (2 dumps + 2 tars, 3.8 MB) | 🟨 NO trackeado (ignorado) | Volumen real de backups del compose de producción montado en el repo. Datos reales en el working tree: riesgo de higiene y confusión. | ✅ **MOVIDO a `../backups` (15-08-2026)** — compose y DEPLOYMENT actualizados al nuevo path. |
| 6 | `backend/.env`, `frontend/.env` | 🟩 ignorado | Generados por `start.sh`; necesarios para dev. No son basura, pero si se deja de usar `npm start` quedan como estado latente. | Documentar que son regenerables. |
| 7 | `desktop/dist/`, `desktop/resources/` (~750 MB) | 🟩 ignorado | Artefactos de build perfectamente regenerables. | `npm run build` los recrea; borrar si se necesita disco. |
| 8 | `frontend/.next`, `backend/dist` | 🟩 ignorado | Builds regenerables. | Ídem. |
| 9 | `docs/AUTOEVALUACION.md` (este archivo) | — | — | Conservar como registro. |

**No es basura (verificado):** `scripts/e2e-local.sh` (referenciado por `test:e2e:local`), `scripts/verify-prod-health.sh` (referenciado por DEPLOYMENT.md y `verify:prod`), `docs/DEPLOY-SETUP.md` (referenciado por DEPLOYMENT.md), `backup/`, `monitor/`, `rclone/rclone.conf.example` (el `.conf` real está bien ignorado).

## 6. Deuda técnica estructural (más allá de archivos)

1. **`git checkout` como mecanismo de restore** del cliente Prisma en `start.sh` y `build.sh`: funciona, pero es un truco. Alternativa: versionar ambos clientes en carpetas separadas o generar en un directorio externo.
2. **Sin CI para desktop**: `ci.yml` cubre backend/frontend/e2e, no el build de Electron. Un job `desktop-build` (aunque sea `--dir` + smoke headless) cerraría el agujero más barato.
3. **Sin tests para los orquestadores**: ni `start.sh` ni la lógica de arranque del desktop (`main.js`) tienen cobertura automatizada; la detección de fallos y la limpieza se validaron manualmente.
4. **`wait -n -t` no disponible** en el Git Bash del entorno → watchdog por puertos en `start.sh`. Portable pero con latencia (~36 s) en la detección de fallos.
5. **Dependencia de Git Bash en Windows** para `npm start` — el desktop mitiga esto, pero no lo elimina para desarrollo.

## 7. Plan de remediación priorizado

- **P0 (higiene):** ✅ **ejecutado 15-08-2026** — borrados `scripts/start-backend.cmd`, `docs/LOCAL-FIRST.md` y `rclone/rclone.conf;C`; `backups/` movido a `../backups` (fuera del repo) y `docker-compose.prod.yml`/`DEPLOYMENT.md` actualizados al nuevo path; artefactos regenerables (`desktop/dist`, `desktop/resources`, `frontend/.next`, `backend/dist`, ~2.1 GB) eliminados. **P0 completo.**
- **P1 (consolidación):** decidir entre `start.sh` y desktop como único orquestador local; unificar la documentación de arranque en un solo lugar (README).
- **P2 (robustez):** CI del desktop (build `--dir` + smoke headless en Windows runner); tests unitarios para la lógica pura de `main.js` (resolución de paths, env, watchdog); eliminar el `git checkout` de restore con clientes versionados por separado.

---

*Autoevaluación honesta: 7.4/10. El producto funciona y está verificado; la arquitectura paga el peaje de crecer por acumulación. La basura concreta es poca y barata de limpiar (P0); lo caro es la deuda estructural (P1-P2), que es opcional si el proyecto sigue siendo personal.*
