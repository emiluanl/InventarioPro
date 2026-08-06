# Fase 5 — Chat con IA (MiniMax M3)

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
2. El backend guarda el mensaje y construye el historial (últimos 50 mensajes + system prompt).
3. Llama a la API de MiniMax con el historial + las 4 tools definidas.
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

### `consultar_garantias_por_vencer`
`dias` (default 30, máx 365). Devuelve productos cuya garantía vence en los próximos N días.

### `resumen_gastos`
`periodo` ∈ `{mes_actual, mes_pasado, anio_actual, ultimos_30_dias, ultimos_90_dias}` + `categoria_id` opcional. Devuelve total + desglose por categoría.

## Manejo de errores

| Situación | Comportamiento |
|---|---|
| API key no configurada | El cliente lanza `ServiceUnavailableException` → frontend recibe mensaje de fallback |
| Timeout (>10s) | Reintento automático una vez; si vuelve a fallar, mensaje amable |
| 4xx de MiniMax | Sin reintento (payload malo); fallback |
| 5xx / red transitoria | Un reintento con backoff; si falla, fallback |
| Loop infinito (>5 rondas) | Mensaje de fallback |

**Nunca** se devuelve un error crudo de la IA al usuario.

## Variables de entorno relevantes

```env
MINIMAX_API_KEY=tu-clave-real
MINIMAX_API_BASE=https://api.MiniMax.com/v1
MINIMAX_MODEL=MiniMax-M3
MINIMAX_TIMEOUT_MS=10000
```

## Seguridad y privacidad

- El system prompt incluye solo el `userId` (no se envía ningún dato personal).
- Las tools filtran SIEMPRE por `user_id`: la IA solo puede ver/crear productos del usuario autenticado.
- Cada llamada a tool se audita en `ChatMessage.function_call` y `function_result`.
- Rate limiting por usuario: 20 msg/min, evita abuso y controla costos.

## Costos y modelo

- Para producción: considera usar un modelo intermedio de la familia MiniMax en el chat diario, y reservar el modelo grande (M3) para tareas que justifiquen el costo.
- Antes de producción: confirma el pricing vigente en la documentación oficial.

## Cómo probarlo

```bash
# 1. Configura MINIMAX_API_KEY en backend/.env

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
