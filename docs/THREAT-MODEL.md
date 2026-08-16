# Modelo de amenaza — decisiones explícitas

Este documento fija las decisiones de seguridad de InventarioPro **y los gatillos
que las cambian**, para que un riesgo aceptado hoy no se convierta en una
decisión olvidada.

## 1. Archivos subidos (`/uploads/*`)

**Estado hoy: riesgo aceptado.** La app es de **un solo usuario** (el dueño de
los datos) y los archivos se sirven sin autenticación.

### Por qué es aceptable hoy

- **No hay multi-tenancy**: no existe el vector "usuario A ve archivos de
  usuario B" (hay un solo usuario).
- **Nombres no adivinables**: cada archivo se guarda como
  `Date.now()-<16 hex aleatorios>.<ext>` (`storage.service.ts`,
  `LocalStorageProvider.upload`). 16 hex = **64 bits de entropía**: un atacante
  no puede enumerar URLs.
- **La URL solo se filtra si el usuario la comparte** (enlace, screenshot, logs).

### Dónde vive

- `backend/src/main.ts` — `useStaticAssets(uploadDir, { prefix: '/uploads/' })`:
  sirve el directorio sin auth; relaja `Cross-Origin-Resource-Policy` a
  `cross-origin` solo en esta ruta (las imágenes se embeben desde el frontend).
- `Caddyfile` — proxya `/uploads/*` al backend en producción.
- `storage.service.ts` — con `STORAGE_PROVIDER=supabase` las URLs se firman por
  **365 días** (muy larga, no revocable salvo borrar el objeto).

### Gatillos de cambio (cuándo deja de ser aceptable)

| Gatillo | Acción requerida |
|---|---|
| **Segundo usuario** (cualquier multi-tenancy) | **Obligatorio**: autenticar el acceso a `/uploads/*` (guard de cookie/sesión en los estáticos o URLs firmadas cortas) |
| **Archivos sensibles compartidos** | URLs privadas temporales en lugar de URL pública permanente |
| **Storage externo** (S3/R2/Supabase como modelo definitivo) | URLs firmadas de **5–15 minutos** re-firmadas en el servidor al leer |
| Migración a storage externo | Acompañarla SIEMPRE del pipeline de backups del storage (ver §3) |

**Regla:** nunca dejar las URLs firmadas de 1 año como modelo definitivo.

## 2. Herramientas de IA (function calling)

**Estado: validado y acotado.**

- Los argumentos de las 4 tools se validan con **schemas zod**
  (`backend/src/chat/tools/schemas.ts`) ANTES de tocar la base de datos; el JSON
  schema que ve DeepSeek se **genera desde esos mismos schemas**
  (`chat-tools.ts`), así el contrato del LLM y el de la validación no divergen.
- `.strict()`: la IA no puede inventar claves fuera del contrato.
- Límites: `limit` 1–50, fechas `YYYY-MM-DD`, precio ≥ 0, moneda ISO 4217,
  enums (estado, tipo_compra, periodo), `dias` 1–365.
- `warranty_status` **filtra en SQL** (no post-query), mismo criterio que
  `products.service.ts`.
- El proveedor (DeepSeek) tiene timeout **por intento** (10 s) + **presupuesto
  total** (15 s) + un único reintento solo para errores de red transitorios y
  HTTP 5xx. Los 4xx y timeouts no se reintentan: fallback amable inmediato.

**Riesgo residual:** un LLM malicioso o con alucinaciones puede generar
argumentos inválidos → la tool devuelve `{ error }` descriptivo (no 500, no
datos corruptos). Sin deduplicación automática: dos productos idénticos son
datos legítimos en un inventario personal (cualquier detección de duplicados
futura debe ser **consultiva**: preguntar antes de crear).

## 3. Backups y restauración

- Cobertura: pg_dump diario + `uploads-*.tar.gz` (fotos/recibos) + copia remota
  con rclone + watchdog de staleness (`DEPLOYMENT.md` §7).
- **Drill de restauración automatizado**: `npm run restore:drill`
  (`scripts/restore-drill.sh`) — restaura el dump en una BD descartable,
  verifica conteos y opcionalmente el tar de uploads. **No toca producción.**
- Antes de migrar el storage a S3/R2: el drill debe cubrir **objetos** además de
  la BD, o el backup actual dejaría de respaldar los archivos.

## 4. Runtime

- Redis y el caché son **opcionales** por diseño (modo no-op sin Redis) — el
  desktop y el modo SQLite corren offline-first.
- Los dumps en el host están en claro; si se exige cifrado en reposo, cifrar el
  directorio de backups o el remote de rclone.
