# Revisión visual pre-release — v1.0.3 (previo a tag)

- **Fecha:** 2026-08-17
- **Base:** `f66a491` + commits locales `5c06673`, `e6cf8de`, `8a18ded`, `2245500`
- **Tag `v1.0.3`:** NO creado (pendiente de aprobación final)
- **Resultado:** ✅ **APROBADO CON AJUSTES** → ajustes aplicados y re-verificados
- **Datos:** 100% sintéticos (usuario de prueba local con 14 productos, 10 categorías, USD+EUR). Sin datos reales, sin credenciales, sin tokens ni datos privados en este documento.
- **IA:** solo mock local `http://127.0.0.1:3009/v1` (`DEEPSEEK_API_BASE` apuntando al mock, key falsa). Verificado: ninguna llamada a `api.deepseek.com`. Prueba funcional: *"¿Cuántos productos tengo?"* → *"Tienes 14 productos en tu inventario."* (con `tool_calls: ["buscar_productos"]` real contra la BD SQLite local).

## Capturas (36 PNG, ignoradas por Git)

Rutas: `.freebuff/preview-shots/{desktop,mobile}/{dark,light}/NN-*.png`
(la carpeta `.freebuff/` está en `.gitignore`; ningún PNG está versionado).

| Viewport | Tema | Pantallas |
|---|---|---|
| Desktop 1440×900 | dark + light | login, dashboard/listado, vista tabla, detalle, formulario, reportes, chat abierto, chat en carga, chat con respuesta |
| Móvil 390×844 | dark + light | ídem |

- Verificación píxel a píxel: **36/36 con el tema correcto** (luminancia de fondo coincide con el tema esperado).
- **Overflow horizontal: 0/32 pantallas** con scroll horizontal.

## Contraste — antes → después

| Elemento | Tema | Antes | Después | AA ≥4.5 |
|---|---|---|---|---|
| Badge garantía vigente | claro | 3.14:1 | **6.04:1** | ✅ |
| Badge garantía por vencer | claro | 2.72:1 | **5.59:1** | ✅ |
| Badge garantía vencida | claro | 3.81:1 | **6.37:1** | ✅ |
| Enlaces `accent-400` (login, detalle, chat) | claro | 3.26:1 | **5.42:1** | ✅ |
| Hover de enlaces | claro | ~2.2:1 | 7.51:1 | ✅ |
| Texto `text-muted` (metadatos) | oscuro | 3.90:1 | **4.64:1** | ✅ |
| Texto `text-muted` | claro | 4.83:1 | 4.83:1 (sin cambio) | ✅ |
| Bordes de inputs | claro | 1.24:1 | ~1.5:1 (sutil, compensado por focus ring) | n/a (no texto) |
| Badges y acento | oscuro | intactos (5.38–8.03:1) | intactos | ✅ |

### Cambios aplicados

- **F1 (P2):** escala accent a variables CSS por tema (como gray); `.light` usa niveles más oscuros (`accent-600` base / `accent-700` hover); estados de garantía usan niveles 800 (emerald/amber/red-800) que aguantan ≥4.5:1 incluso sobre fondos al 15% de alpha. Los badges ganaron **icono de estado** (check / reloj / triángulo) para no depender solo del color; texto como nombre accesible. → `frontend/app/globals.css`, `frontend/tailwind.config.ts`, `frontend/components/products/warranty-badge.tsx`.
- **F2 (P2):** enlaces en claro ahora usan token accent oscuro; hover se oscurece y se distingue. → `globals.css`, `tailwind.config.ts`.
- **P3 (muted):** `--text-muted` oscuro sube de 3.90 → 4.64:1. → `globals.css`.
- **P3 (bordes inputs):** borde claro ligeramente más definido sin destruir jerarquía; focus ring fuerte (3px, contraste suficiente). → `frontend/components/ui/input.tsx`.
- **Prueba:** `frontend/lib/theme-contrast.test.ts` parsea `globals.css` y falla si cualquier token (claro/oscuro) baja de 4.5:1 (hex y rgb). ✅ Verde.

## Hallazgos P0–P3

- **P0:** ninguno.
- **P1:** ninguno.
- **P2:** F1 (badges claro), F2 (enlaces claro) — **corregidos** (tabla anterior).
- **P3:** muted oscuro 3.90:1, bordes inputs claros sutiles — **corregidos** (tabla anterior).

## Accesibilidad y responsive verificado

- **Focus visible:** ✅ (ring 3px con contraste suficiente en ambos temas).
- **Navegación con teclado:** ✅ (recorrido de tabs en login y dashboard sin trampas).
- **Labels:** ✅ (labels visibles + `sr-only` donde aplica).
- **Alt / nombres accesibles:** ✅ (badges con texto, iconos decorativos con `aria-hidden`).
- **Estados de carga:** ✅ (skeletons en dashboard, typing indicator en chat).
- **Touch targets:** ✅ ≥44px — nav móvil 94×57, FAB 56×56, botones de formulario ≥44px.
- **`prefers-reduced-motion`:** ✅ (respetado en CSS global).
- **Jerarquía:** h1 dominante, CTA primario evidente (+ FAB móvil), métricas con `t-num`, chat distingue usuario (derecha/acento), asistente (izquierda/superficie) y carga (typing dots).

## Logo, favicon y PWA

- Logo en login, header y nav móvil: componente `logo.tsx` con SVG inline (tokens por tema) — verificado en ambos temas.
- Favicon `/favicon.ico`: generado por `generate:logo-assets` (logo nuevo, PNG embebidos), servido por Next. ✅
- Manifest: iconos 192/512/maskable 512 y splash generados desde SVG; validado con `validate:logo-assets` (existencia, dimensiones, formato PNG, rutas del manifest). ✅
- Iconos PWA y splash: 16 `splash-*.png` + `apple-touch-icon.png` generados. ✅

## Estado del repositorio

- Árbol limpio salvo por los archivos regenerados por la máquina al levantar el stack (`backend/src/generated/prisma/*` cliente SQLite, `frontend/next-env.d.ts`) — se restauran al detener el stack (`git checkout`), no son cambios reales.
- 4 commits lógicos locales (sin push): `5c06673` (contraste), `e6cf8de` (pipeline PNG), `8a18ded` (PNG fuera de git), `2245500` (assets en dev).
- Sin tag, sin instalador definitivo aún, sin secretos.
