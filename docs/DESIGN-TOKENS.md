# Design System — Tokens (InventarioPro)

Dirección visual: **oscura, premium, industrial, tecnológica y precisa** —
inspirada en ingeniería aeroespacial e instrumentación de alta confiabilidad.
Original: no copia marcas ni estéticas ajenas. Sin gradientes excesivos,
glassmorphism pesado ni fondos animados costosos.

Vive en `frontend/app/globals.css` (variables CSS) + `frontend/tailwind.config.ts`
(mapa a utilidades Tailwind). El tema **oscuro es el predeterminado**; el claro
se activa con la clase `.light` en `<html>` (la gestiona `ThemeProvider` en
`frontend/lib/theme-mode`).

## Color (semántico)

| Token | Dark | Light | Uso |
|---|---|---|---|
| `--bg` | `#0a0a0b` | `#ffffff` | Fondo principal (página) |
| `--surface` | `#141417` | `#ffffff` | Superficie base (cards, header, inputs) |
| `--surface-raised` | `#1c1c1f` | `#f9fafb` | Superficie elevada (hover, dropdowns) |
| `--border` | `#26262a` | `#e5e7eb` | Borde por defecto |
| `--border-hover` | `#3a3a40` | `#d1d5db` | Borde hover / separadores fuertes |
| `--text` | `#f5f5f7` | `#111827` | Texto primario |
| `--text-secondary` | `#9e9ea6` | `#4b5563` | Texto secundario |
| `--text-muted` | `#6e6e73` | `#6b7280` | Metadatos / texto terciario |
| `--text-disabled` | `#4a4a50` | `#9ca3af` | Texto deshabilitado |
| `--accent` | `#0a84ff` | `#0071e3` | Acento (eléctrico) |
| `--accent-hover` | `#0071e3` | `#0066d6` | Acento hover |
| `--focus-ring` | `59 141 255` | `59 141 255` | Anillo de foco (triplet rgb) |

Colores de **estado** (triplets rgb, usados con alphas Tailwind:
`bg-success/10`, `text-error`, `border-warning/40`):

| Token | Dark | Light | Uso |
|---|---|---|---|
| `--tw-success` | `52 211 153` | `5 150 105` | Éxito (emerald) |
| `--tw-warning` | `251 191 36` | `217 119 6` | Advertencia (amber) |
| `--tw-error` | `248 113 113` | `220 38 38` | Error / destructivo (red) |

La escala `gray-*` de Tailwind (`--tw-gray-50…950`) es la paleta neutral por
tema: los componentes existentes (`bg-gray-100`, `text-gray-900`,
`border-gray-300`) se adaptan a oscuro/claro sin tocarlos.

## Tipografía

- Familia: `Inter, system-ui, sans-serif` (`fontFamily.sans` en Tailwind). Sin
  fuentes externas, CDNs ni dependencias nuevas.
- Utilidades: `.t-title` (1.25rem/600, títulos de sección), `.t-subtitle`
  (0.875rem/500, texto destacado), `.t-label` (0.75rem/500 mayúsculas,
  etiquetas), `.t-num` (`tabular-nums`, números y métricas).

## Espaciado y forma

- Escala de espaciado: la de Tailwind por defecto (base 4px: `px-4`, `gap-2`,
  `p-6`, `mt-8`…).
- Radios: `rounded-md` (controles), `rounded-lg` (cajas), `rounded-xl2` (1rem,
  superficies grandes), `rounded-pill` (acciones).
- Elevación: `--elev-1/2/3` (sombra sutil → flotante) con utilidades `.elev-1`,
  `.elev-2`, `.elev-3`. Además `shadow-glow` / `shadow-glow-sm` (hovers del
  acento) y `shadow-card` (cards).
- Densidad de controles: `sm`/`md`/`lg` en `Button` (los targets táctiles del
  móvil se mantienen **≥ 44px** — ver `e2e/mobile-touch-targets.spec.ts`).
- Focus visible: `*:focus-visible` global con `ring-accent-400/60` + offset.

## Movimiento

- `--duration-fast: 150ms`, `--duration-base: 200ms`, `--ease-out` —
  micro-interacciones de hover/focus/active.
- `prefers-reduced-motion`: todo el movimiento de la app (hover/active, glow,
  spinners, skeletons, scroll) se desactiva; el cambio de tema es instantáneo
  (ver `globals.css`).

## Temas

- **Oscuro**: predeterminado (sin clase).
- **Claro**: clase `.light` en `<html>` redefiniendo los tokens + `color-scheme`.
- **Sistema**: `ThemeProvider` resuelve `prefers-color-scheme` y aplica la clase
  correspondiente en vivo (`frontend/lib/theme-mode`).

## Alcance aplicado (checkpoint actual)

Design system aplicado a: `dashboard-shell`, `mobile-nav`, `empty-state`,
`Button`/`Input`/`Alert`/`Skeleton` (`components/ui`). Las pantallas de
productos, reportes, chat y el resto NO se reescribieron todavía (siguiente
bloque del rediseño).
