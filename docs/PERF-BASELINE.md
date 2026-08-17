# Frontend — Línea base de rendimiento (build de producción)

Medición reproducible del build de producción **antes** del rediseño visual,
para comparar cualquier cambio futuro de rendimiento (code-splitting, árboles,
imágenes, etc.).

## Comando

```bash
cd frontend
NEXT_DIST_DIR=.next-baseline npx next build
```

- Next 16.3.0 (Turbopack), `output: 'standalone'`, `distDir` propio para no
  pisar el `.next` del dev server / e2e.
- Build registrado el 16-08-2026, árbol en `8f23053` + cambios del design
  system (commit de esta fase).

## Resultados (baseline)

| Métrica | Valor |
|---|---|
| Compilación (Turbopack) | **12.3 s** (build total ~27 s) |
| JS estático total (`.next/static`) | **939 KB** (sin gzip) |
| CSS total | **32 KB** |
| Routes | 14 páginas: 12 estáticas + 2 dinámicas (`/products/[id]`, `/products/[id]/edit`) |
| Warnings | 1 (Turbopack `turbopack.root` por lockfiles múltiples; no funcional) |

### Chunks más pesados (JS sin gzip)

| Tamaño | Chunk | Contenido probable |
|---|---|---|
| 224 KB | `0e6t78x6zb_q1.js` | react-dom / runtime |
| 156 KB | `2z47e0c2dxn3o.js` | next runtime |
| 112 KB | `0cz1d0mv5g_q7.js` | shared app (react-query, api) |
| 80 KB | `3v5ge6_pzzy8u.js` | shared app (zod, react-hook-form, auth) |
| 52 KB | `1ow3op4udg50h.js` | app shell (dashboard, nav, chat) |
| 48 KB | `21p1fn2cub25b.js` | axios / cliente HTTP |

> Turbopack no imprime la tabla de **First Load JS por ruta** en el log. La
> métrica reproducible es el total de JS estático + análisis de chunks. Las
> rutas YA están divididas por el App Router (cada página es su propio chunk
> de ruta); los chunks raíz son las dependencias compartidas.

## Code-splitting — experimento y decisión (16-08-2026)

Se evaluó el candidato principal con medición A/B (mismo build, distDir
separados):

**Chat (`ChatPanel` vía `next/dynamic` + `ssr:false` + skeleton de loading):**

| Métrica | Antes (import estático) | Después (dynamic) |
|---|---|---|
| JS estático total | 939 KB | 956 KB (incluye chunk lazy de chat de 8 KB) |
| JS *eager* (lo que carga la primera visita) | **939 KB** | **948 KB** (956 − 8 del chunk lazy) |

**Resultado: NEGATIVO.** El panel del chat pesa solo **~8 KB** minificados
(sus dependencias — react-query, cliente api, UI — ya son chunks compartidos),
y el loader de `next/dynamic` agrega ~9–17 KB de overhead *eager*. Diferir
8 KB al costo de +9 KB no mejora el First Load: **se revirtió el cambio y no
se mantiene** (regla: no dividir sin beneficio medible).

**Otros candidatos evaluados y descartados:**
- `zod` + `react-hook-form` (chunk compartido de ~80 KB): los usan login,
  registro, settings y formularios de productos — es compartido por diseño;
  diferirlos exige dynamic en formularios (complejidad + riesgo SSR) sin
  ganancia limpia por ruta.
- Dashboard / productos / reportes: no importan librerías pesadas propias
  (los gráficos de reportes son CSS puro; el CSV se genera a mano) y ya
  están divididos por ruta.

**Decisión:** no aplicar code-splitting adicional en esta fase. El JS está
dominado por framework (next + react-dom ≈ 490 KB) y dependencias
genuinamente compartidas. La palanca real de reducción está en el framework,
no en división manual de componentes.

## Cómo reproducir la comparación

1. Build baseline: `NEXT_DIST_DIR=.next-baseline npx next build` → total JS.
2. Para probar un split: aplicar el cambio, rebuild con `NEXT_DIST_DIR=.next-x`,
   comparar total + `eager = total − Σ chunks lazy`. Un split solo se mantiene
   si `eager` baja (y no rompe e2e de navegación).
