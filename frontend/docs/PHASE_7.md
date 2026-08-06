# Fase 7 — Frontend: dashboard y gestión de productos

## Páginas creadas

| Ruta | Descripción |
|---|---|
| `/dashboard` | Lista de productos con filtros, búsqueda, paginación, vistas grid y lista |
| `/products/new` | Formulario para crear un producto |
| `/products/[id]` | Detalle completo del producto (incluye galería + subida de adjuntos) |
| `/products/[id]/edit` | Formulario para editar |

## Hooks principales: `hooks/use-products.ts`

- `useProducts(filters)` → `useQuery` con paginación, filtros, búsqueda.
- `useProduct(id)` → `useQuery` para el detalle.
- `useCreateProduct()` → `useMutation` con `invalidateQueries`.
- `useUpdateProduct()` → `useMutation` que invalida la lista y el detalle.
- `useDeleteProduct()` → `useMutation` con invalidación.
- `useCategories()` → `useQuery` con `staleTime: 5min` (categorías cambian poco).

## Componentes principales: `components/products/`

- **`ProductCard`**: tarjeta para vista grid (clickable → detalle).
- **`WarrantyBadge`**: verde / amarillo / rojo según `warranty_status`. "Sin garantía" si es null.
- **`FilterBar`**: filtros en URL (searchParams), vista grid/lista, orden, "limpiar".
- **`EmptyState`**: estado vacío con CTA a `/products/new`.
- **`ProductForm`**: compartido entre new/edit. Calcula automáticamente `fecha_vencimiento_garantia` cuando defines `duracion_garantia_meses`.
- **`ProductImages`**: uploader + galería (fotos) + lista (recibos/facturas).

## Decisiones técnicas

1. **Filtros en URL** (no en estado): compartibles, permalinkables, sobreviven a refresh.
2. **`ProductForm` compartido** con `mode: 'create' | 'edit'`. Mismo formulario para ambos.
3. **Auto-cálculo de `fecha_vencimiento_garantia`** en el formulario: cuando defines duración, se actualiza el campo de fecha.
4. **React Query 5** con `placeholderData: previousData` para evitar parpadeo al paginar/filtrar.
5. **Validación con `react-hook-form` + `zod`** (schemas en `lib/validations/`).
6. **Subida de imágenes** vía `FormData` con preview local (URL.createObjectURL).
7. **`use(params)` para Next.js 15** (en este proyecto usamos Next 14, pero ya es compatible hacia atrás y hacia adelante).
8. **Componentes UI base reutilizables** (Button, Input, Label, Alert) en `components/ui/`.

## Cómo probarlo

```bash
# 1. Backend corriendo en localhost:3001
# 2. Frontend
cd frontend
npm install
npm run dev
```

Abre http://localhost:3000, inicia sesión, y prueba:
- Crear un producto.
- Ver el dashboard con tarjetas y lista.
- Filtrar por estado / garantía / tipo.
- Buscar por texto.
- Entrar al detalle y subir una foto.
- Editar el producto.
