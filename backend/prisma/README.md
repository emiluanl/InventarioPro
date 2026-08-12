# Fase 2 — Base de datos (Prisma)

## Modelos definidos

| Modelo | Propósito |
|---|---|
| `User` | Usuarios de la aplicación |
| `RefreshToken` | Tokens de refresh hasheados (logout invalida) |
| `Category` | Categorías del sistema (user_id null) y personalizadas |
| `Product` | Productos del usuario (borrado lógico vía `deleted_at`) |
| `ProductAttachment` | Fotos, recibos y facturas asociados a un producto |
| `ChatConversation` | Hilos de conversación con la IA |
| `ChatMessage` | Mensajes individuales (user / assistant / system) |
| `Notification` | Avisos in-app (garantías por vencer, resúmenes, etc.) |

## Enums

- `ProductStatus`: `NUEVO`, `USADO`, `EN_REPARACION`, `VENDIDO`, `PERDIDO_ROBADO`, `DADO_DE_BAJA`
- `PurchaseType`: `FISICO`, `ONLINE`
- `AttachmentType`: `FOTO`, `RECIBO`, `FACTURA`
- `ChatRole`: `USER`, `ASSISTANT`, `SYSTEM`
- `NotificationType`: `GARANTIA_POR_VENCER`, `GARANTIA_VENCIDA`, `RESUMEN_PERIODICO`, `SISTEMA`

## Decisiones técnicas

- **Decimales para dinero** (`Decimal(12,2)`) — soporta hasta 9 999 999 999.99.
- **Borrado lógico** en `Product` vía `deleted_at`. El service debe filtrar por `deleted_at: null` en casi todas las consultas.
- **Categorías del sistema**: `user_id = null`. Las personalizadas tienen `user_id` del dueño y se eliminan en cascada.
- **Refresh tokens hasheados**: si alguien accede a la BD, no puede mantener sesiones activas.
- **Búsqueda full-text**: por simplicidad del MVP, los tags se guardan como string separado por comas. Migrable a tabla `tags` en una fase 2 sin romper nada.

## Índices obligatorios

- `user_id` en **todas** las tablas que tienen dueño.
- En `Product`: `user_id`, `fecha_compra`, `categoria_id`, `estado`, `fecha_vencimiento_garantia` (filtros principales del dashboard).
- En `Notification`: `(user_id, leido)` y `(user_id, created_at)` para listar no leídas rápido.
- En `ChatMessage`: `(conversation_id, created_at)` para paginar historiales.

## Cómo generar la migración inicial

```bash
# Desde la carpeta backend/, con la base de datos levantada:
cd backend

# 1. Generar el cliente Prisma (tipos TS para usar el ORM)
npx prisma generate

# 2. Crear la primera migración a partir del schema
npx prisma migrate dev --name init

# 3. (Opcional) Abrir Prisma Studio para inspeccionar la BD visualmente
npx prisma studio
```

En producción, las migraciones se aplican con:

```bash
npx prisma migrate deploy
```

## Datos seed (opcional, fase futura)

Cuando quieras categorías predefinidas (electrónica, electrodomésticos, muebles, ropa…), se insertan con un seed:

```bash
npx prisma db seed
```

Configurar `package.json` (requiere instalar `tsx` como devDependency):

```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

*(El seed se implementará cuando esté listo el módulo de categorías.)*
