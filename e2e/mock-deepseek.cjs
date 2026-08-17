// =============================================================================
// Mock local de la API de DeepSeek para los tests e2e.
// =============================================================================
// Simula chat completions + function calling sin depender de una API key real:
//
//   - GET /health            → 200 (lo usa Playwright para esperar el server).
//   - POST /v1/chat/completions (escenarios por guion, según el último mensaje):
//       1. CONteo ("¿Cuántos productos…?") → ciclo de dos rondas:
//            Ronda 1: tool_calls → buscar_productos.
//            Ronda 2: formula el conteo con el resultado REAL de la tool.
//       2. Consultivo ("Compré nuevamente una licuadora…") → el ciclo completo
//          de deduplicación consultiva de crear_producto:
//            Ronda 1: tool_calls → crear_producto (args fijos del guion).
//            Ronda 2: lee del historial el needs_confirmation REAL del backend
//                     y pregunta al usuario ("¿La creo igual?").
//            Turno 2 "sí": tool_calls → confirmar_creacion_producto con el
//                     confirmation_id REAL que el backend generó (lo lee del
//                     tool result materializado en el historial).
//            Turno 2 "no": tool_calls → cancelar_creacion_producto.
//            "confirma nuevamente": tool_calls → confirmar_creacion_producto
//                     con el MISMO id (idempotencia: el backend lo rechaza).
//       · Cualquier otra pregunta → 401: el backend degrada al fallback amable.
//
// El conteo y el confirmation_id NO se inventan: salen de los resultados de
// las tools que el backend ejecutó contra su propia base de datos. El puerto
// se sobreescribe con MOCK_AI_PORT.
// =============================================================================
const http = require('http');

const PORT = Number(process.env.MOCK_AI_PORT ?? 3009);
const COUNT_RE = /cu[aá]ntos?\s+(productos?|producto|art[ií]culos?)/i;
const CONFIRM_TRIGGER_RE = /nuevamente|duplicad|otra vez/i;
const SI_RE = /^\s*s[ií]\s*[.!]?\s*$/i;
const NO_RE = /^\s*no\s*[.!]?\s*$/i;
const RECONFIRM_RE = /confirma\s+(nuevamente|de\s+nuevo)|reconfirma/i;

const CREAR_ARGS = {
  nombre: 'Licuadora Oster',
  fecha_compra: '2026-08-15',
  tipo_compra: 'FISICO',
  precio: 150,
};

function respond(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function toolCall(name, args) {
  return {
    id: `call_${name}_${Date.now()}`,
    model: 'mock-deepseek',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: `call_${name}_1`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };
}

function textAnswer(content) {
  return {
    id: `text_${Date.now()}`,
    model: 'mock-deepseek',
    choices: [
      { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
    ],
  };
}

/** Resultados de tools presentes en el request (parseados, ignorando ruido). */
function toolResults(messages) {
  return messages
    .filter((m) => m.role === 'tool')
    .map((m) => {
      try {
        return JSON.parse(m.content ?? '{}');
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return respond(res, 200, { ok: true });
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      return respond(res, 404, { error: 'not found' });
    }

    let request;
    try {
      request = JSON.parse(body);
    } catch {
      return respond(res, 400, { error: 'bad json' });
    }

    const messages = request.messages || [];
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const userText = lastUser?.content ?? '';
    const lastMsg = messages[messages.length - 1];
    const results = toolResults(messages);
    // "Sin respuesta todavía": el último mensaje del array es del usuario
    // (si el último es un tool result o texto del asistente, ya hay respuesta).
    const unanswered = lastMsg?.role === 'user';

    // --- 0) Reintento de confirmación (idempotencia) -------------------------
    // Si el usuario pide confirmar de nuevo, el mock emite confirmar con el
    // MISMO confirmation_id del primer needs_confirmation del historial. El
    // backend debe rechazarlo (ya usado/cancelado) — es lo que prueba el e2e.
    if (unanswered && RECONFIRM_RE.test(userText)) {
      const needs = results.find((r) => r && r.needs_confirmation);
      if (needs) {
        return respond(res, 200, toolCall('confirmar_creacion_producto', {
          confirmation_id: needs.confirmation_id,
        }));
      }
    }

    // --- 1) Conteo (guion existente) ----------------------------------------
    if (COUNT_RE.test(userText)) {
      if (unanswered) {
        // Ronda 1: llamar a buscar_productos (sin filtros → inventario completo).
        return respond(res, 200, toolCall('buscar_productos', {}));
      }
      // Ronda 2: el resultado REAL de la tool (el array de productos).
      const last = results[results.length - 1];
      const items = Array.isArray(last) ? last : [];
      const count = items.length;
      const texto =
        count === 0
          ? 'Tienes 0 productos en tu inventario.'
          : count === 1
            ? `Tienes 1 producto en tu inventario: ${items[0].nombre}.`
            : `Tienes ${count} productos en tu inventario.`;
      return respond(res, 200, textAnswer(texto));
    }

    // --- 2) Consultivo: duplicado de crear_producto → confirmar/cancelar -----
    // Entra cuando el último mensaje dispara el guion (compra nuevamente) o
    // cuando ya existe un needs_confirmation en el historial (turno 2: el
    // usuario solo respondió "sí"/"no", sin repetir el trigger).
    const needs = results.find((r) => r && r.needs_confirmation);
    if (needs || CONFIRM_TRIGGER_RE.test(userText)) {
      if (results.length === 0) {
        // Ronda 1: la IA "extrae" los datos del mensaje y crea la intención.
        return respond(res, 200, toolCall('crear_producto', CREAR_ARGS));
      }
      const last = results[results.length - 1];
      if (last && last.ok === true) return respond(res, 200, textAnswer('Listo, la creé.'));
      if (last && last.cancelada === true) return respond(res, 200, textAnswer('No se creó el producto.'));
      if (last && last.error) return respond(res, 200, textAnswer('No pude crear el producto.'));
      if (last && last.needs_confirmation) {
        if (SI_RE.test(userText)) {
          // El usuario confirmó: usar el id REAL que generó el backend.
          return respond(res, 200, toolCall('confirmar_creacion_producto', {
            confirmation_id: last.confirmation_id,
          }));
        }
        if (NO_RE.test(userText)) {
          return respond(res, 200, toolCall('cancelar_creacion_producto', {
            confirmation_id: last.confirmation_id,
          }));
        }
        // Primer turno: el backend detectó el duplicado, la IA pregunta.
        return respond(res, 200, textAnswer('Ya existe una Licuadora Oster con esa fecha. ¿La creo igual?'));
      }
      return respond(res, 401, { error: { message: 'mock: estado consultivo no soportado' } });
    }

    // Fuera del guion: 401 → el backend devuelve el fallback amable.
    return respond(res, 401, { error: { message: 'mock: pregunta no soportada' } });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-deepseek] escuchando en http://127.0.0.1:${PORT}/v1`);
});
