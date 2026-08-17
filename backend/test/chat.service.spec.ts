// =============================================================================
// Tests del ChatService — persistencia de tool calls (auditoría)
// =============================================================================
// Verifica que cuando la IA ejecuta herramientas (function calling):
//   1. Se persisten filas de auditoría con function_call y function_result
//      (content null → invisibles para la IA y para la UI).
//   2. La respuesta final incluye tool_calls con los nombres ejecutados.
//   3. getMessages NO expone las filas de auditoría (content not null).
// =============================================================================

import { ChatService } from '../src/chat/chat.service';
import { ChatRole } from '../src/generated/prisma/client';

type CreateData = { data: Record<string, unknown> };

function buildMocks() {
  const prisma = {
    chatConversation: {
      findFirst: jest.fn().mockResolvedValue({ id: 'c1', user_id: 'u1' }),
      create: jest.fn().mockResolvedValue({ id: 'c1', user_id: 'u1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    chatMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }: CreateData) => ({
        id: `m-${Math.random().toString(36).slice(2)}`,
        ...data,
      })),
    },
  };
  const deepSeek = {
    getModel: jest.fn().mockReturnValue('deepseek-chat'),
    chatCompletion: jest.fn(),
  };
  const executor = {
    execute: jest.fn(),
  };
  const service = new ChatService(prisma as never, deepSeek as never, executor as never);
  return { prisma, deepSeek, executor, service };
}

describe('ChatService — persistencia de tool calls', () => {
  it('persiste function_call/function_result cuando la IA ejecuta herramientas', async () => {
    const { prisma, deepSeek, executor, service } = buildMocks();

    deepSeek.chatCompletion
      // Ronda 1: la IA decide llamar a buscar_productos.
      .mockResolvedValueOnce({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'buscar_productos', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      })
      // Ronda 2: con el resultado, formula la respuesta final.
      .mockResolvedValueOnce({
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Tienes 2 productos.' },
            finish_reason: 'stop',
          },
        ],
      });

    executor.execute.mockResolvedValue([
      { id: 'p1', nombre: 'A', precio: '1' },
      { id: 'p2', nombre: 'B', precio: '2' },
    ]);

    const result = await service.sendMessage('u1', undefined, '¿Cuántos productos tengo?');

    expect(result.message).toBe('Tienes 2 productos.');
    expect(result.tool_calls).toEqual(['buscar_productos']);
    expect(executor.execute).toHaveBeenCalledWith('u1', 'c1', 'buscar_productos', {});

    // 3 filas: mensaje del usuario + auditoría + respuesta final.
    const created = prisma.chatMessage.create.mock.calls.map((c) => c[0].data);
    expect(created).toHaveLength(3);

    expect(created[0]).toMatchObject({
      role: ChatRole.USER,
      content: '¿Cuántos productos tengo?',
    });

    // Fila de auditoría: content vacío + qué se llamó y qué devolvió.
    expect(created[1]).toMatchObject({
      role: ChatRole.ASSISTANT,
      content: '',
      function_call: JSON.stringify({ name: 'buscar_productos', arguments: '{}' }),
    });
    expect(JSON.parse(created[1].function_result as string)).toEqual([
      { id: 'p1', nombre: 'A', precio: '1' },
      { id: 'p2', nombre: 'B', precio: '2' },
    ]);

    expect(created[2]).toMatchObject({
      role: ChatRole.ASSISTANT,
      content: 'Tienes 2 productos.',
    });
  });

  it('no crea filas de auditoría si la IA no llama herramientas', async () => {
    const { prisma, deepSeek, executor, service } = buildMocks();

    deepSeek.chatCompletion.mockResolvedValueOnce({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hola, ¿en qué te ayudo?' },
          finish_reason: 'stop',
        },
      ],
    });

    const result = await service.sendMessage('u1', undefined, 'hola');

    expect(result.message).toBe('Hola, ¿en qué te ayudo?');
    expect(result.tool_calls).toBeUndefined();
    expect(executor.execute).not.toHaveBeenCalled();

    const created = prisma.chatMessage.create.mock.calls.map((c) => c[0].data);
    expect(created).toHaveLength(2); // usuario + respuesta, sin auditoría
    expect(created.every((d) => d.function_call === undefined)).toBe(true);
  });

  it('getMessages no expone las filas de auditoría (function_call set)', async () => {
    const { prisma, service } = buildMocks();
    prisma.chatMessage.findMany.mockResolvedValue([]);

    await service.getMessages('u1', 'c1');

    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith({
      where: { conversation_id: 'c1', function_call: null },
      orderBy: { created_at: 'asc' },
    });
  });
});

describe('ChatService — fallback sin API key y respuestas malformadas (sin 500)', () => {
  const FALLBACK =
    'Ahora mismo no puedo pensar bien. ¿Te importa volver a intentarlo en unos segundos?';

  it('sin API key (el cliente rechaza) responde el fallback amable y persiste sin errores', async () => {
    const { prisma, deepSeek, executor, service } = buildMocks();
    deepSeek.chatCompletion.mockRejectedValue(new Error('El servicio de IA no está configurado.'));

    const result = await service.sendMessage('u1', undefined, '¿Cuántos productos tengo?');

    expect(result.message).toBe(FALLBACK);
    expect(result.tool_calls).toBeUndefined();
    expect(executor.execute).not.toHaveBeenCalled();
    // Usuario + respuesta de fallback, ambas persistidas (2 filas, sin auditoría).
    expect(prisma.chatMessage.create).toHaveBeenCalledTimes(2);
    expect(prisma.chatMessage.create.mock.calls[1][0].data.content).toBe(FALLBACK);
  });

  it('choices vacío → fallback (nunca 500 por shape malformado)', async () => {
    const { deepSeek, service } = buildMocks();
    deepSeek.chatCompletion.mockResolvedValueOnce({ choices: [] } as never);

    const result = await service.sendMessage('u1', undefined, 'hola');
    expect(result.message).toBe(FALLBACK);
  });

  it('mensaje sin content ni tool_calls → fallback', async () => {
    const { deepSeek, service } = buildMocks();
    deepSeek.chatCompletion.mockResolvedValueOnce({
      choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
    } as never);

    const result = await service.sendMessage('u1', undefined, 'hola');
    expect(result.message).toBe(FALLBACK);
  });

  it('tool_calls con arguments JSON inválido se degrada a error de la tool (no 500)', async () => {
    const { deepSeek, executor, service } = buildMocks();
    deepSeek.chatCompletion
      .mockResolvedValueOnce({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'buscar_productos', arguments: '{rotos' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          { index: 0, message: { role: 'assistant', content: 'Listo.' }, finish_reason: 'stop' },
        ],
      });
    executor.execute.mockResolvedValue({ error: 'Argumentos inválidos' });

    const result = await service.sendMessage('u1', undefined, 'hola');
    expect(result.message).toBe('Listo.');
    expect(executor.execute).toHaveBeenCalledWith('u1', 'c1', 'buscar_productos', {});
  });
});

describe('ChatService — privacidad del prompt y límites de contexto', () => {
  it('el system prompt NO incluye el userId interno ni datos del request', async () => {
    const { deepSeek, service } = buildMocks();
    let captured: { messages: { role: string; content: string | null }[] } | undefined;
    deepSeek.chatCompletion.mockImplementation(async (req: never) => {
      captured = req as typeof captured;
      return {
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      } as never;
    });

    await service.sendMessage('u1', undefined, '¿Cuántos productos tengo?');

    expect(captured).toBeDefined();
    const system = captured!.messages.find((m) => m.role === 'system');
    expect(system?.content).not.toContain('u1');
    expect(JSON.stringify(captured!.messages)).not.toContain('u1');
  });

  it('buildHistory materializa las filas de auditoría como assistant tool_calls + tool result (continuidad del function calling)', async () => {
    const { prisma, deepSeek, service } = buildMocks();
    prisma.chatMessage.findMany.mockResolvedValue([
      { id: 'm1', role: ChatRole.USER, content: 'Compré una licuadora', function_call: null },
      {
        id: 'm2',
        role: ChatRole.ASSISTANT,
        content: '',
        function_call: JSON.stringify({ name: 'crear_producto', arguments: '{}' }),
        function_result: JSON.stringify({
          needs_confirmation: true,
          confirmation_id: 'id-opaco-123',
        }),
      },
      { id: 'm3', role: ChatRole.ASSISTANT, content: '¿La creo igual?', function_call: null },
    ]);

    let captured:
      | {
          messages: {
            role: string;
            content: string | null;
            tool_call_id?: string;
            tool_calls?: unknown[];
          }[];
        }
      | undefined;
    deepSeek.chatCompletion.mockImplementation(async (req: never) => {
      captured = req as typeof captured;
      return {
        choices: [
          { index: 0, message: { role: 'assistant', content: 'sí' }, finish_reason: 'stop' },
        ],
      } as never;
    });

    await service.sendMessage('u1', undefined, 'sí');

    const nonSystem = captured!.messages.filter((m) => m.role !== 'system');
    // El confirmation_id viaja al LLM en el tool result del turno anterior.
    expect(JSON.stringify(nonSystem)).toContain('id-opaco-123');
    // El par assistant tool_calls ↔ tool usa el MISMO id (lo exige la API).
    const assistantToolCall = nonSystem.find((m) => m.role === 'assistant' && m.tool_calls);
    const toolMsg = nonSystem.find((m) => m.role === 'tool');
    const callId = (assistantToolCall!.tool_calls as { id: string }[])[0].id;
    expect(toolMsg?.tool_call_id).toBe(callId);
    expect(toolMsg?.content).toContain('id-opaco-123');
  });

  it('la poda es ATÓMICA por intercambio de tool: nunca envía un tool sin su assistant.tool_calls (aunque el presupuesto corte)', async () => {
    const { prisma, deepSeek, service } = buildMocks();
    // 6 intercambios grandes (~4100 chars c/u = ~24.6k) + el mensaje del usuario:
    // superan el presupuesto de 16k, así que la poda recorta varios.
    const history = [];
    for (let i = 0; i < 6; i++) {
      history.push({
        id: `m-user-${i}`,
        role: ChatRole.USER,
        content: `Pregunta ${i}`,
        function_call: null,
      });
      history.push({
        id: `m-audit-${i}`,
        role: ChatRole.ASSISTANT,
        content: '',
        function_call: JSON.stringify({ name: 'buscar_productos', arguments: '{}' }),
        function_result: JSON.stringify({ data: 'x'.repeat(4000), n: i }),
      });
    }
    history.push({
      id: 'm-final-user',
      role: ChatRole.USER,
      content: 'Última pregunta',
      function_call: null,
    });
    prisma.chatMessage.findMany.mockResolvedValue(history);

    let captured:
      | {
          messages: {
            role: string;
            content: string | null;
            tool_call_id?: string;
            tool_calls?: { id: string }[];
          }[];
        }
      | undefined;
    deepSeek.chatCompletion.mockImplementation(async (req: never) => {
      captured = req as typeof captured;
      return {
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      } as never;
    });

    await service.sendMessage('u1', undefined, 'hola');

    const msgs = captured!.messages.filter((m) => m.role !== 'system');
    // Invariante: todo mensaje tool tiene SU assistant tool_calls ANTES con el
    // MISMO tool_call_id (nunca un resultado huérfano).
    const assistantIds = new Set(
      msgs
        .filter((m) => m.role === 'assistant' && m.tool_calls)
        .flatMap((m) => m.tool_calls!.map((t) => t.id)),
    );
    for (const m of msgs.filter((m) => m.role === 'tool')) {
      expect(assistantIds.has(m.tool_call_id!)).toBe(true);
    }
    // El último mensaje del usuario siempre se conserva.
    expect(msgs[msgs.length - 1].content).toBe('Última pregunta');
    // La poda recortó (no cabe todo en 16k).
    expect(msgs.length).toBeLessThan(history.length + 1);
  });

  it('el historial se recorta al presupuesto de caracteres conservando el último mensaje', async () => {
    const { prisma, deepSeek, service } = buildMocks();
    // 14 mensajes largos (3k chars) + el último del usuario (distintivo).
    const history = Array.from({ length: 14 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? ChatRole.USER : ChatRole.ASSISTANT,
      content: 'x'.repeat(3000),
      function_call: null,
    }));
    history.push({
      id: 'm-last',
      role: ChatRole.USER,
      content: 'ULTIMO_MENSAJE_DISTINTIVO',
      function_call: null,
    });
    prisma.chatMessage.findMany.mockResolvedValue(history);

    let captured: { messages: { role: string; content: string | null }[] } | undefined;
    deepSeek.chatCompletion.mockImplementation(async (req: never) => {
      captured = req as typeof captured;
      return {
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      } as never;
    });

    await service.sendMessage('u1', undefined, 'hola');

    const nonSystem = captured!.messages.filter((m) => m.role !== 'system');
    const totalChars = nonSystem.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
    // Presupuesto total de contexto (16000) sin contar el system prompt.
    expect(totalChars).toBeLessThanOrEqual(16000);
    // El último mensaje (el que dispara la llamada) SIEMPRE se conserva.
    expect(nonSystem.some((m) => m.content === 'ULTIMO_MENSAJE_DISTINTIVO')).toBe(true);
  });
});
