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
   **presupuesto total de 16 000 caracteres** y **4 000 caracteres por mensaje**
   como tope individual — el contexto no crece sin límite. Más el system prompt.
3. Llama a la API de DeepSeek con el historial + las 6 tools definidas.
4. Si la IA decide invocar una tool:
   - El backend la ejecuta contra la base de datos del propio usuario.
   - Devuelve el resultado a la IA.
   - Repite hasta que la IA formule una respuesta en texto natural.
   - **Máximo 5 rondas** para evitar loops infinitos.
5. Persiste la respuesta final del asistente.

## Poda inteligente del historial (resumen histórico)

Cuando el historial se acerca al presupuesto de 16 000 caracteres, se poda en
**grupos atómicos** (intercambios) y se condensa lo más antiguo:

- **Grupos atómicos**: un grupo es un mensaje del usuario (+ su respuesta), o
  una RONDA completa de tools (assistant con todos sus `tool_calls` + todos sus
  `tool` results + la respuesta final). Nunca se divide un `tool_calls` de sus
  resultados, una ronda con varias tools, ni un intercambio consultivo.
- **Prioridades**: (1) los **6 intercambios más recientes** — incluye SIEMPRE el
  último mensaje del usuario; (2) el intercambio consultivo **pendiente**
  (`needs_confirmation` sin confirmar/cancelar), aunque quede fuera de la
  ventana reciente — su `confirmation_id` debe llegar al LLM para poder
  confirmar o cancelar; (3) un **resumen histórico** de los grupos antiguos ya
  finalizados; (4) el resto de grupos antiguos, solo con el espacio que sobre.
- **El resumen** es determinista y LOCAL (sin DeepSeek, sin API key), acotado a
  **1 500 caracteres**, y se coloca como un mensaje `system` después del prompt
  y antes de los mensajes recientes. Solo contiene texto del usuario, respuestas
  del asistente y nombres de herramientas: **nunca** `userId`, IDs internos de
  productos, `confirmation_id` consumidos/expirados, tokens, SQL ni errores
  internos (los results de las tools no se resumen).
- **Reconstrucción de rondas**: las filas de auditoría guardan la **ronda**
  interna (varias tools simultáneas de una misma respuesta del proveedor se
  auditan con la misma ronda) y `buildHistory` las materializa como UN assistant
  con todos los `tool_calls` + un `tool` result por llamada con su
  `tool_call_id` correcto.
- **Límites**: 50 filas de BD consultadas, 16 000 caracteres totales, 4 000 por
  mensaje, 6 grupos recientes, 1 500 del resumen, último mensaje del usuario
  siempre conservado.

## Las 6 tools disponibles

### `buscar_productos`
Criterios: `search`, `categoria_id`, `estado`, `warranty_status`, `fecha_desde`, `fecha_hasta`, `limit`. Devuelve lista resumida (nombre, categoría, fecha, precio, tiempo de posesión, estado de garantía).

### `crear_producto`
Crea un producto a partir de parámetros extraídos. El usuario puede decir "acabo de comprar una licuadora Oster en Falabella por $150 hace 2 días" y la IA calcula la fecha, llena los campos y la invoca.

Campos: `nombre`, `fecha_compra`, `tipo_compra`, `precio` (obligatorios) + `marca`, `modelo`, `descripcion`, `lugar_compra`, `moneda` (ISO 4217 real), `duracion_garantia_meses` (0–600), `notas`, `categoria_nombre` (se resuelve por nombre o se crea), `metodo_pago`, `numero_serie`, `tags`. Todos los `MaxLength` replican los límites del DTO HTTP.

**Deduplicación consultiva (nunca automática):** si ya existe un producto con el mismo nombre (case-insensitive) y la misma fecha de compra, la tool devuelve `needs_confirmation` con un **`confirmation_id` opaco** (uuid aleatorio) y **NO crea**; además guarda los argumentos originales como confirmación pendiente.

La confirmación y la cancelación son herramientas SEPARADAS (la IA ya no puede repetir ni alterar los datos del producto al confirmar):

- Usuario **confirma** → la IA llama `confirmar_creacion_producto` con el `confirmation_id` → crea con los argumentos **originales** guardados (el schema de esta tool solo acepta `confirmation_id`).
- Usuario **rechaza** → la IA llama `cancelar_creacion_producto` (id opcional) → no crea y limpia el pendiente. Es segura aunque no exista pendiente.
- Una confirmación es **idempotente**: al crear se consume, así que el mismo `confirmation_id` no puede crear dos productos.
- El pendiente se guarda **en memoria, aislado por conversación**: confirmar desde otra conversación del mismo usuario se rechaza. TTL de **10 minutos** y al reiniciar el proceso se pierde de forma **segura** — el usuario solo tiene que reintentar y la tool vuelve a preguntar; nunca queda una confirmación huérfana que cree algo sin confirmación real.
- La lista de similares **no expone IDs internos de productos** al LLM.

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
