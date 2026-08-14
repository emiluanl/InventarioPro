# Decisiones técnicas del frontend

Registro de decisiones del frontend y su estado, para retomarlas con contexto.

## 🎨 Rediseño del estilo "dark-first" (estilo Musk/Grok/X/Starlink) — ✅ APLICADO

**Estado**: implementado y verificado. Dirección de diseño aplicada:

- **Dark-first**: fondo `#0a0a0b` con gradiente radial azul sutil; tokens
  `--bg`/`--surface`/`--border`/`--text`/`--accent` en `globals.css`.
- **Un solo acento eléctrico** (`#0a84ff`): escala `accent` monótona en
  `tailwind.config.ts`; links `accent-300/400`, botones `accent-500` con glow.
- **Paleta `gray` invertida** (50 oscuro → 900 claro): los componentes
  existentes (`bg-gray-100`, `text-gray-900`, `border-gray-200`) quedan dark
  sin tocarlos uno a uno.
- **Jerarquía por tipografía**: tracking-tight en títulos, pesos, sin cajas
  con borde duro.
- **Bordes 1px + superficies por valor tonal** (gray-100/200/300).
- **Micro-interacciones**: transiciones 150-200ms, glow al hover, focus rings
  luminosos, `::selection` azul.
- **Coherencia PWA**: `theme_color`/manifest e íconos regenerados con el
  acento nuevo.

**Verificación**: build OK, lint estricto 0/0, typecheck 0 errores, 55/55
tests (snapshots UI actualizados), validación visual contra el stack dev
(login, registro y dashboard).

**Impacto**: solo capa de presentación; sin cambios de lógica ni de API.

## ⬆️ Tailwind 4 (4.3.3 disponible; en uso 3.4.14) — DIFERIDO

La migración a Tailwind 4 cambia el modelo de config (CSS-first: `@theme` en
lugar de `tailwind.config.ts` y `@import "tailwindcss"` en lugar de las
directivas `@tailwind`).

**Decisión**: el rediseño ya se aplicó sobre 3.4 (la paleta vive en
`tailwind.config.ts`). Migrar a 4 ahora implica trasladar esa paleta a `@theme`
en CSS — trabajo acotado, pero sin urgencia mientras 3.4 funcione. Evaluar
como mejora independiente, no bloqueante.

## 🐳 Optimización de imágenes Docker — ✅ APLICADO (14-08-2026)

Reducción de las imágenes de producción y desarrollo para liberar disco en la
laptop (entorno con espacio limitado). ~2.1GB liberados en prod + ~179MB de
imágenes sin uso prunadas.

| Imagen | Antes | Después | Cambio |
|---|---|---|---|
| **frontend** | 979MB | **263MB** | `output: 'standalone'` en `next.config.js` + Dockerfile copia solo `.next/standalone` + `static` + `public` (antes copiaba todo `node_modules`, incluidas devDeps) |
| **migrate** | 1.63GB | **1.11GB** | Ya no copia el `node_modules` de producción; instala solo `prisma@7.9.1` + `dotenv` (lo que importa `prisma.config.ts`). El CLI de prisma v7 arrastra `@prisma/studio-core` como dep obligatoria (react-dom, elkjs…), por eso sigue siendo la imagen más pesada |
| **backup** | 568MB | **135MB** | Base `alpine:3.20` + `postgresql16-client` en vez de `postgres:16-alpine` completo (solo usa `pg_dump`/`pg_restore`/`rclone`) |

**Verificación en vivo**: frontend sirve `/login` 200; migrate aplica "No pending
migrations" contra la BD real; backup genera dump+tar OK (incluida la copia
remota B2); `verify:prod` completo en verde con datos intactos (5 users | 6
products | 11 categories).

**Nota**: el contenedor backend de prod estaba corriendo código stale (imagen
anterior al fix de throttling). Reconstruido y recreado: el contenedor verifica
el código nuevo. Docker queda con 0B de imágenes reclaimables (todo activo).

## ☁️ Copia remota B2 — ✅ ACTIVA (descubierta 14-08-2026)

Durante la verificación del backup (imagen ligera) se confirmó que la copia
remota **ya está configurada y funcionando** en producción — antes se creía
pendiente:

- `RCLONE_REMOTE=b2backup:InventarioPro` en `.env.prod` con la config de
  rclone en `./rclone/rclone.conf` (montada en el contenedor backup).
- Ejecución real verificada: `rclone copy` al bucket OK + retención remota de
  14 días aplicada (`rclone delete --min-age`).
- Heartbeat de monitoreo activo: `BACKUP_PING_URL` apunta a healthchecks.io
  (`hc-ping.com/...`) — el backup y el watchdog reportan estado.

**Implicación**: el pendiente "configurar copia B2" ya no aplica. El riesgo
residual es el mismo para cualquier setup single-laptop (pérdida física), pero
los dumps ya viven también fuera del disco local.

## ✅ Aplicado

- **Rediseño dark-first estilo Musk** (tokens + paleta + componentes UI +
  íconos PWA) — ver arriba.
- **Skeletons reutilizables**: `components/ui/skeleton.tsx` extraído de los
  `animate-pulse` inline; aplicado en dashboard y detalle de producto.
- **Lint estricto** (`--max-warnings=0`) y **protección EOL** (`.prettierrc`
  con `endOfLine: lf` + `.gitattributes`).
- **Optimización de imágenes Docker** (standalone, migrate lean, backup
  ligero) — ver arriba.
- **Copia remota B2 activa** confirmada y documentada — ver arriba.
