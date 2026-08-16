# Fase 5 — Chat con IA (DeepSeek)

## Endpoints

Todos en `/api/chat/*`.

| Método | Ruta | Rate limit | Descripción |
|---|---|---|---|
| `POST` | `/chat/message` | **20 / min** | Envía un mensaje, recibe respuesta (con function calling) |
| `GET` | `/chat/conversations` | global | Lista de conversaciones del usuario |
| `GET` | `/chat/conversations/:id/messages` | global | Historial completo de mensajes |

## Body de `POST /chat/message`

```json
{
  "conversation_id": "ckxyz...",   // opcional: si se omite, crea una nueva
  "message": "¿Qué compré en enero?"
}
```

**Respuesta:**

```json
{
  "conversation_id": "ckxyz...",
  "message": "En enero registraste 3 productos: ...",
  "tool_calls": ["buscar_productos"]
}
```

## Cómo funciona el function calling

1. El usuario envía un mensaje.
2. El backend guarda el mensaje y construye el historial para la IA: último
   mensaje del usuario + las últimas **50 filas** de la conversación, con un
   **presupuesto total de 16 000 caracteres** (recorta desde los más viejos,
   conservando siempre el último) y **4 000 caracteres por mensaje** como tope
   individual — el contexto no crece sin límite. Más el system prompt.
3. Llama a la API de DeepSeek con el historial + las 4 tools definidas.
4. Si la IA decide invocar una tool:
   - El backend la ejecuta contra la base de datos del propio usuario.
   - Devuelve el resultado a la IA.
   - Repite hasta que la IA formule una respuesta en texto natural.
   - **Máximo 5 rondas** para evitar loops infinitos.
5. Persiste la respuesta final del asistente.

## Las 4 tools disponibles

### `buscar_productos`
Criterios: `search`, `categoria_id`, `estado`, `warranty_status`, `fecha_desde`, `fecha_hasta`, `limit`. Devuelve lista resumida (nombre, categoría, fecha, precio, tiempo de posesión, estado de garantía).

### `crear_producto`
Crea un producto a partir de parámetros extraídos. El usuario puede decir "acabo de comprar una licuadora Oster en Falabella por $150 hace 2 días" y la IA calcula la fecha, llena los campos y la invoca.

Campos: `nombre`, `fecha_compra`, `tipo_compra`, `precio` (obligatorios) + `marca`, `modelo`, `descripcion`, `lugar_compra`, `moneda` (ISO 4217 real), `duracion_garantia_meses` (0–600), `notas`, `categoria_nombre` (se resuelve por nombre o se crea), `metodo_pago`, `numero_serie`, `tags` y `confirmar`.

**Deduplicación consultiva (nunca automática):** si ya existe un producto con el mismo nombre (case-insensitive) y la misma fecha de compra, la tool devuelve `needs_confirmation` y **NO crea**; además guarda los argumentos originales como confirmación pendiente (10 min de vida).

- Usuario **confirma** → la IA vuelve a llamar con `confirmar: true` → crea con los argumentos **originales** guardados.
- Usuario **rechaza** → la IA llama con `confirmar: false` → no crea y limpia el pendiente.
- `confirmar: true` **sin una confirmación pendiente previa se rechaza**: la IA no puede auto-crear un duplicado que el usuario nunca vio.

### `consultar_garantias_por_vencer`
`dias` (default 30, máx 365). Devuelve productos cuya garantía vence en los próximos N días.

### `resumen_gastos`
`periodo` ∈ `{mes_actual, mes_pasado, anio_actual, ultimos_30_dias, ultimos_90_dias}` + `categoria_id` opcional. Devuelve total + desglose por categoría.

## Manejo de errores

| Situación | Comportamiento |
|---|---|
| API key no configurada | El cliente lanza `ServiceUnavailableException` → frontend recibe mensaje de fallback (sin 500) |
| Timeout del intento (>10s) | **Sin reintento** (la respuesta no va a llegar): fallback amable inmediato |
| 4xx de DeepSeek (incl. 429) | Sin reintento (payload/key/rate limit); fallback |
| 5xx / red transitoria | Un reintento con backoff, dentro del presupuesto total de 15s; si falla, fallback |
| Cuerpo no-JSON (proxy/HTML) | Error sanitizado, sin reintentar; fallback |
| Respuesta malformada (choices vacío, sin contenido) | Fallback amable |
| Loop infinito (>5 rondas) | Mensaje de fallback |

**Nunca** se devuelve un error crudo de la IA al usuario, ni mensajes internos de
Prisma (los errores de las tools se sanitizan; el detalle real queda en los logs
Del servidor).

## Variables de entorno relevantes

```env
DEEPSEEK_API_KEY=tu-clave-real
DEEPSEEK_API_BASE=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TIMEOUT_MS=10000        # timeout por intento
DEEPSEEK_TOTAL_BUDGET_MS=15000   # presupuesto TOTAL (intentos + reintentos)
```

## Seguridad y privacidad

- **El system prompt NO incluye datos internos** (ni `userId` ni tokens): el LLM solo recibe las reglas de comportamiento. El `user_id` se usa únicamente en el backend para filtrar los datos de cada usuario.
- Las tools filtran SIEMPRE por `user_id`: la IA solo puede ver/crear productos del usuario autenticado.
- Cada llamada a tool se audita en `ChatMessage.function_call` y `function_result`.
- Errores internos de Prisma nunca llegan al usuario: las tools devuelven mensajes genéricos y loguean el detalle en el servidor.
- Rate limiting por usuario: 20 msg/min, evita abuso y controla costos.

## Costos y modelo

- Para producción: `deepseek-chat` es el modelo generalista recomendado para el chat diario (y `deepseek-reasoner` para tareas de razonamiento que lo justifiquen).
- Antes de producción: confirma el pricing vigente en la documentación oficial.

## Cómo probarlo

```bash
# 1. Configura DEEPSEEK_API_KEY en backend/.env

# 2. Login (necesitas un token)
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"MiPass123"}' \
  | jq -r '.access_token')

# 3. Enviar mensaje
curl -X POST http://localhost:3001/api/chat/message \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "¿Qué compré en enero?"}'
```
