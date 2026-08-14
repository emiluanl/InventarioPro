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

## ✅ Aplicado

- **Rediseño dark-first estilo Musk** (tokens + paleta + componentes UI +
  íconos PWA) — ver arriba.
- **Skeletons reutilizables**: `components/ui/skeleton.tsx` extraído de los
  `animate-pulse` inline; aplicado en dashboard y detalle de producto.
- **Lint estricto** (`--max-warnings=0`) y **protección EOL** (`.prettierrc`
  con `endOfLine: lf` + `.gitattributes`).
