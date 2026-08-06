# Fase 8 — Widget de chat IA

## Componentes

| Archivo | Función |
|---|---|
| `components/chat/chat-widget.tsx` | Botón flotante + monta el panel |
| `components/chat/chat-panel.tsx` | Header + lista de mensajes + input |
| `components/chat/chat-message.tsx` | Burbuja user/assistant + indicador "escribiendo..." |

## Hooks

- `useConversations()` → lista las conversaciones del usuario.
- `useMessages(conversationId)` → historial de mensajes.
- `useSendMessage()` → mutation para enviar mensajes, con invalidación de cache.

## Flujo

1. Usuario hace click en el botón flotante.
2. Se carga la conversación más reciente (si existe).
3. El usuario escribe y envía.
4. Mientras llega la respuesta: indicador "escribiendo..." (3 puntos animados).
5. La respuesta del asistente aparece en su burbuja.
6. Auto-scroll al último mensaje.

## Decisiones técnicas

1. **Widget flotante** accesible desde cualquier página del dashboard (montado en el layout).
2. **Conversación persistida** en el backend (no se pierde al cerrar el widget).
3. **Auto-apertura de la última conversación** para que el usuario vea el contexto previo.
4. **Auto-scroll** al último mensaje cada vez que llega contenido nuevo o el usuario envía.
5. **Manejo de errores**: si el backend devuelve el fallback amable (cuando la IA falla), se muestra como un mensaje normal; si hay un error HTTP, se muestra en un Alert rojo.
6. **Rate limit 20 msg/min** lo aplica el backend con `@Throttle()`. El frontend simplemente deja mandar y muestra el error si lo hay.

## Cómo probarlo

```bash
# Con backend y frontend corriendo:
# 1. Inicia sesión
# 2. Click en el botón flotante (esquina inferior derecha)
# 3. Escribe: "¿Cuántos productos tengo?"
# 4. La IA llama a la tool 'buscar_productos' y responde.
```
