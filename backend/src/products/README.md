# Fase 4 — Productos (CRUD + búsqueda + adjuntos)

## Endpoints

Todos en `/api/products/*` y `/api/products/:id/attachments/*`.

### Productos

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/products` | Listado paginado, filtrable, buscable y ordenable |
| `GET` | `/products/:id` | Detalle completo con adjuntos |
| `POST` | `/products` | Crea un producto |
| `PUT` | `/products/:id` | Actualiza un producto |
| `DELETE` | `/products/:id` | Borrado lógico (`deleted_at`) |

### Adjuntos

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/products/:productId/attachments` | Lista adjuntos |
| `POST` | `/products/:productId/attachments` | Sube foto/recibo/factura (`multipart/form-data` con campo `file`) |
| `DELETE` | `/products/:productId/attachments/:attachmentId` | Borra adjunto (en storage + BD) |

### Categorías (complemento)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/categories` | Categorías del sistema + personalizadas del usuario |
| `POST` | `/categories` | Crea categoría personalizada |
| `PUT` | `/categories/:id` | Actualiza |
| `DELETE` | `/categories/:id` | Borra |

## Query params de `GET /products`

| Param | Tipo | Default | Notas |
|---|---|---|---|
| `page` | int ≥ 1 | `1` | |
| `per_page` | int 1–100 | `20` | |
| `search` | string | – | Busca en `nombre`, `marca`, `modelo`, `descripcion` |
| `category_id` | cuid | – | |
| `estado` | enum ProductStatus | – | NUEVO, USADO, EN_REPARACION, VENDIDO, PERDIDO_ROBADO, DADO_DE_BAJA |
| `tipo_compra` | enum PurchaseType | – | FISICO, ONLINE |
| `warranty_status` | enum | – | vigente, por_vencer, vencida |
| `fecha_desde` / `fecha_hasta` | ISO date | – | Rango de fecha_compra |
| `sort_by` | enum | `fecha_compra` | fecha_compra, nombre, precio, tiempo_posesion, created_at |
| `sort_order` | enum | `desc` | asc, desc |

## Respuesta de un producto

```json
{
  "id": "ckxyz...",
  "user_id": "ckabc...",
  "nombre": "Licuadora Oster",
  "marca": "Oster",
  "modelo": "BLSTKAP",
  "descripcion": "...",
  "fecha_compra": "2024-01-15",
  "lugar_compra": "Falabella",
  "tipo_compra": "FISICO",
  "precio": "150.00",
  "moneda": "USD",
  "metodo_pago": "tarjeta",
  "numero_serie": "...",
  "duracion_garantia_meses": 12,
  "fecha_vencimiento_garantia": "2025-01-15",
  "estado": "NUEVO",
  "notas": null,
  "tags": "cocina, regalo",
  "created_at": "...",
  "updated_at": "...",
  "categoria": { "id": "...", "nombre": "Electrodomésticos", "icono": "home" },
  "attachments_count": 3,
  "tiempo_posesion": "1 año, 6 meses, 20 días",
  "warranty_status": "vencida",
  "days_until_warranty_expires": -180
}
```

## Decisiones técnicas

### Cálculo de `tiempo_posesion`

Calculado **al vuelo** en cada respuesta a partir de `fecha_compra` y `new Date()`. Formato: `"X años, Y meses, Z días"`, o `"Recién adquirido"` si es <1 día.

### Cálculo de `warranty_status`

- `vigente`: vence en >30 días
- `por_vencer`: vence en ≤30 días
- `vencida`: ya pasó la fecha

Calculado en la misma pasada que `tiempo_posesion`, por lo que siempre está actualizado.

### Borrado lógico

`DELETE /products/:id` marca `deleted_at = NOW()`; no se borra la fila. Las consultas filtran `deleted_at: null`.

### Ownership verificado en service

Cada operación pasa por `assertOwned(userId, productId)` que hace `findFirst({ where: { id, user_id, deleted_at: null }})`. **No basta con el guard**: el guard solo verifica que estés autenticado, no que el recurso sea tuyo.

### Validación de uploads

En `StorageService.validateFile`:
- MIME permitido: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`
- Extensión permitida: `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.pdf`
- Tamaño máximo: **5 MB**

### Storage providers

Seleccionable por `STORAGE_PROVIDER` en `.env`:

- **`local`** (default): guarda en `LOCAL_UPLOAD_DIR` (`./uploads` por defecto). Sirve archivos en `/uploads/<ruta>`.
- **`supabase`**: usa Supabase Storage. Requiere `SUPABASE_URL` y `SUPABASE_SERVICE_KEY`. Genera URL firmada por 1 año.

En producción, usa Supabase (o S3) — el local no escala y los archivos se pierden al redeploy.

### Categorías

- `user_id = null` → categoría del sistema (no se puede editar ni borrar desde la API)
- `user_id = X` → categoría personalizada del usuario X

El método `CategoriesService.seedSystemCategories()` inserta las predefinidas (Electrónica, Electrodomésticos, etc.). Lo llamas desde un script de seed o desde el bootstrap si lo prefieres.

## Cómo probarlo

```bash
# (con sesión activa: reemplazá TOKEN por el access_token del login)
TOKEN=eyJhbGciOi...

# Crear
curl -X POST http://localhost:3001/api/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Licuadora Oster",
    "fecha_compra": "2024-01-15",
    "tipo_compra": "FISICO",
    "precio": 150.00,
    "moneda": "USD",
    "duracion_garantia_meses": 12,
    "lugar_compra": "Falabella"
  }'

# Listar
curl "http://localhost:3001/api/products?page=1&per_page=20&sort_by=fecha_compra" \
  -H "Authorization: Bearer $TOKEN"

# Subir una foto (multipart)
curl -X POST http://localhost:3001/api/products/$PRODUCT_ID/attachments \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./foto.jpg" \
  -F "tipo=FOTO"
```
