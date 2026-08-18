# Advisories de dependencias — InventarioPro

Registro de vulnerabilidades de dependencias detectadas por `npm audit` en CI,
con su evaluación de impacto, mitigación y responsable de revisión.

> Regla general: un advisory NO se considera resuelto hasta que `npm audit`
> deje de reportarlo. Una propuesta de override o un fix pendiente aguas arriba
> no equivale a resolución.

---

## GHSA-ggr8-5vv4-36mx / CVE-2026-40345 — deepmerge-ts (< 8.0.0)

**Estado: ABIERTO (mitigación documentada, sin fix definitivo)**

### Dependencia afectada

- `deepmerge-ts` **< 8.0.0** — severidad **high** (según npm audit).
- Advisory: <https://github.com/advisories/GHSA-ggr8-5vv4-36mx>

### Cadena de dependencia actual (backend)

```
prisma@7.9.1 (directa, devDependency del backend)
  └─ @prisma/config (>= 6.13.0-dev.1)
       └─ deepmerge-ts (< 8.0.0)   ← vulnerable
```

`npm audit --audit-level=moderate` reporta **5 vulnerabilidades (2 low, 3 high)**:
3 high por esta cadena (`prisma`, `@prisma/config`, `deepmerge-ts`) y 2 low por
`@supabase/auth-js <= 2.69.1` (GHSA-8r88-6cj9-9fh5, transitiva y sin uso en
runtime backend — se documenta aparte si persiste).

### Versiones

| Rol | Versión |
|---|---|
| Vulnerable | `deepmerge-ts` < 8.0.0 |
| Corregida | `deepmerge-ts` >= 8.0.0 |
| Prisma actual | `7.9.1` (depende de `@prisma/config` con `deepmerge-ts` vulnerable) |

`npm audit fix --force` propondría **bajar a `prisma@6.12.0`** (cambio breaking),
por lo que NO se aplica de forma automática.

### Impacto conocido

- El advisory describe **stack exhaustion al mergear grafos de objetos
  recursivos**.
- Evaluación actual: el backend no expone grafos recursivos controlados por
  usuarios al código que usa `deepmerge-ts`. `deepmerge-ts` se alcanza solo a
  través del **CLI de Prisma** (`@prisma/config`), usado en build y en
  `prisma migrate deploy` en el arranque del desktop; el merge de
  configuración es de archivos locales del proyecto, no de input de usuario.
- Riesgo práctico: bajo para este producto. Igualmente el advisory debe
  seguirse hasta su cierre.

### Mitigación provisional

- Ninguna allowlist activa por ahora en CI (el paso `Audit dependencies` del
  job `Security (npm audit) (backend)` está fallando deliberadamente para no
  ocultar el advisory).
- Si se decide permitir el fallo temporalmente, debe hacerse con allowlist
  explícita y documentada (ver criterio de cierre abajo).
- Opciones en evaluación: (a) esperar una versión de Prisma que suba
  `deepmerge-ts >= 8`; (b) `overrides` de `deepmerge-ts@^8.0.0` validado contra
  la suite completa (experimento controlado en `backend/package.json`).

### Responsable y fecha de revisión

- Responsable: Emiliano (propietario del repo).
- Revisión: 2026-08-17 (registro inicial del advisory en esta fase).
- Revisar de nuevo: al actualizar Prisma o ante un aviso del advisory en
  GitHub Dependabot / npm audit.

### Criterio para eliminar cualquier allowlist futura

1. `npm audit --audit-level=moderate` en `backend/` termina con exit 0.
2. O se documenta un override validado (pruebas backend completas en verde:
   Jest, lint, typecheck) y `npm audit` deja de reportar el GHSA.
3. Cualquier allowlist existente se retira el mismo día en que el advisory
   desaparezca del árbol de dependencias.

---

## GHSA-8r88-6cj9-9fh5 — @supabase/auth-js (<= 2.69.1) — INFORMATIVA

- Severidad **low**; transitiva vía `@supabase/supabase-js` (dependencia
  directa del backend pero **sin uso en el runtime de InventarioPro**).
- No requiere acción inmediata; se revisará con la actualización de
  dependencias del backend.
