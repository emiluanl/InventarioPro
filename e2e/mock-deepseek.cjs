// =============================================================================
// Mock local de la API de DeepSeek para los tests e2e.
// =============================================================================
// Simula chat completions + function calling sin depender de una API key real:
//
//   - GET /health            → 200 (lo usa Playwright para esperar el server).
//   - POST /v1/chat/completions
//       · Pregunta de CONteo ("¿Cuántos productos…?") → ciclo de dos rondas:
//           Ronda 1: la "IA" responde tool_calls → buscar_productos.
//           Ronda 2: con el resultado REAL de la tool (el array de productos
//                    que devolvió el ejecutor del backend), formula el conteo.
//       · Cualquier otra pregunta → 401: el backend degrada al fallback amable
//         (mismo camino que hoy sin key), preservando los tests existentes.
//
// El conteo NO es inventado: sale del array que el backend devuelve tras
// ejecutar buscar_productos contra su propia base de datos (filtrado por
// usuario). El puerto se sobreescribe con MOCK_AI_PORT.
// =============================================================================
const http = require('http');

const PORT = Number(process.env.MOCK_AI_PORT ?? 3009);
const COUNT_RE = /cu[aá]ntos?\s+(productos?|producto|art[ií]culos?)/i;

function respond(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
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
    const isCountQuestion = COUNT_RE.test(lastUser?.content ?? '');

    // Fuera del guion: 401 → el backend devuelve el fallback amable.
    if (!isCountQuestion) {
      return respond(res, 401, { error: { message: 'mock: pregunta no soportada' } });
    }

    const hasToolResult = messages.some((m) => m.role === 'tool');

    if (!hasToolResult) {
      // Ronda 1: llamar a buscar_productos (sin filtros → inventario completo).
      return respond(res, 200, {
        id: 'mock-1',
        model: request.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_mock_1',
                  type: 'function',
                  function: { name: 'buscar_productos', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
    }

    // Ronda 2: extraer el resultado REAL de la tool y contar.
    const toolMsg = [...messages].reverse().find((m) => m.role === 'tool');
    let items = [];
    try {
      const parsed = JSON.parse(toolMsg?.content || '[]');
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }

    const count = items.length;
    const texto =
      count === 0
        ? 'Tienes 0 productos en tu inventario.'
        : count === 1
          ? `Tienes 1 producto en tu inventario: ${items[0].nombre}.`
          : `Tienes ${count} productos en tu inventario.`;

    return respond(res, 200, {
      id: 'mock-2',
      model: request.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: texto },
          finish_reason: 'stop',
        },
      ],
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-deepseek] escuchando en http://127.0.0.1:${PORT}/v1`);
});
