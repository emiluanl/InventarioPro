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
    expect(executor.execute).toHaveBeenCalledWith('u1', 'buscar_productos', {});

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
