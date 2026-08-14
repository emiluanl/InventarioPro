# Decisiones técnicas del frontend

Registro de decisiones pendientes y su estado, para retomarlas con contexto.

## 🎨 Rediseño del estilo "dark-first" (estilo Musk/Grok/X/Starlink) — DIFERIDO

**Estado**: diferido por petición del usuario (guardar la idea antes de
ejecutar). La dirección de diseño acordada:

- **Dark-first**: fondo casi negro (tokens `--bg`/`--surface`/`--border`),
  no gris-50.
- **Un solo acento eléctrico** (azul/cian brillante) reservado para acciones
  clave; el resto neutro.
- **Jerarquía por tipografía** (peso/tamaño/tracking), no por cajas con borde.
- **Bordes 1px + radio generoso**; superficies separadas por valor tonal.
- **Micro-interacciones**: hover con glow sutil, transiciones ~150-200ms.

**Plan de ejecución cuando se apruebe**:
1. Tokens CSS en `globals.css` (variables `--bg`, `--surface`, `--border`,
   `--text`, `--accent`) — todo el cambio se hace por variables.
2. Modo oscuro como base en `globals.css` + `tailwind.config.ts`.
3. Rediseñar `components/ui/` (button, input, alert, label) + `skeleton.tsx`.
4. Retoques: gradiente en login/header, glow en hover, tracking en títulos,
   métricas grandes en el dashboard.

**Impacto**: solo capa de presentación; sin cambios de lógica ni de API. Los
tests existentes se adaptan si cambian roles/textos accesibles.

## ⬆️ Tailwind 4 (4.3.3 disponible; en uso 3.4.14) — DIFERIDO

La migración a Tailwind 4 cambia el modelo de config (CSS-first: `@theme` en
lugar de `tailwind.config.ts` y `@import "tailwindcss"` en lugar de las
directivas `@tailwind`).

**Decisión**: migrar **junto con el rediseño del estilo** (ver arriba), no
antes — hacerlo ahora y rediseñar después sería doble trabajo y doble riesgo
de romper los 51 tests. Cuando se apruebe el rediseño, la migración 3.4 → 4
se hace en el mismo cambio.

## ✅ Aplicado

- **Skeletons reutilizables**: `components/ui/skeleton.tsx` extraído de los
  `animate-pulse` inline; aplicado en dashboard y detalle de producto.
- **Lint estricto** (`--max-warnings=0`) y **protección EOL** (`.prettierrc`
  con `endOfLine: lf` + `.gitattributes`).
