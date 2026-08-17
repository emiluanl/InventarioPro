// =============================================================================
// Pruebas de DOS TURNOS del flujo consultivo de crear_producto
// =============================================================================
// Pasan por ChatService completo (executor REAL + DeepSeek mockeado + prisma
// mockeado) para verificar el ciclo real de conversación:
//   Turno 1: el usuario reporta una compra que YA existe → needs_confirmation
//            con confirmation_id opaco; no se crea nada.
//   Turno 2 "sí": la IA llama confirmar_creacion_producto con ESE id → se crea
//                 con los argumentos ORIGINALES (sin repetir los datos).
//   Turno 2 "no": la IA llama cancelar_creacion_producto → no se crea y el
//                 pendiente queda limpio (un confirmar posterior se rechaza).
// El id opaco viaja de verdad: el turno 2 lo captura del function_result que
// el executor persistió en el turno 1 (la auditoría de function_call/
// function_result), igual que haría un LLM real al leer el resultado de la
// tool en el contexto de la conversación.
// =============================================================================

import { ChatService } from '../src/chat/chat.service';
import { ChatToolExecutor } from '../src/chat/tools/tool-executor';

type CreateData = { data: Record<string, unknown> };

const ORIGINAL_ARGS = {
  nombre: 'Licuadora Oster',
  fecha_compra: '2026-08-15',
  tipo_compra: 'FISICO',
  precio: 150,
  lugar_compra: 'Falabella',
};

const EXISTING = [
  {
    id: 'p-old',
    nombre: 'Licuadora Oster',
    fecha_compra: new Date('2026-08-15T00:00:00.000Z'),
    precio: { toString: () => '150' },
    moneda: 'USD',
  },
];

const toolCall = (name: string, args: Record<string, unknown>) => ({
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
});

const textAnswer = (content: string) => ({
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
});

/**
 * Lee el confirmation_id opaco del function_result que el executor persistió
 * en el turno 1 (la auditoría de function_call/function_result).
 */
function lastConfirmationId(prisma: { chatMessage: { create: jest.Mock } }): string {
  const funcMsg = prisma.chatMessage.create.mock.calls.find((c) => c[0].data.function_result);
  return JSON.parse(funcMsg![0].data.function_result).confirmation_id;
}

function buildFullStack() {
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
    product: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({
        id: 'p-new',
        nombre: 'Licuadora Oster',
        fecha_compra: new Date('2026-08-15T00:00:00.000Z'),
        precio: { toString: () => '150' },
        moneda: 'USD',
      }),
    },
    category: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'cat-new', nombre: 'x' }),
    },
  };
  const executor = new ChatToolExecutor(prisma as never);
  const deepSeek = {
    getModel: jest.fn().mockReturnValue('deepseek-chat'),
    chatCompletion: jest.fn(),
  };
  const service = new ChatService(prisma as never, deepSeek as never, executor as never);
  return { prisma, deepSeek, executor, service };
}

describe('crear_producto consultivo — flujo real de dos turnos', () => {
  it('turno 1: duplicado → needs_confirmation con id opaco; turno 2 confirmar_creacion_producto crea con los ORIGINALES', async () => {
    const { prisma, deepSeek, service } = buildFullStack();
    prisma.product.findMany.mockResolvedValue(EXISTING);

    // --- Turno 1: la IA detecta el duplicado y le pregunta al usuario ---
    deepSeek.chatCompletion
      .mockResolvedValueOnce(toolCall('crear_producto', ORIGINAL_ARGS))
      .mockResolvedValueOnce(
        textAnswer('Ya existe una Licuadora Oster con esa fecha. ¿La creo igual?'),
      );

    const turn1 = await service.sendMessage(
      'u1',
      undefined,
      'Compré una licuadora Oster en Falabella por $150',
    );
    expect(turn1.message).toContain('¿La creo igual?');
    expect(prisma.product.create).not.toHaveBeenCalled();

    // El id opaco quedó persistido en el function_result (auditoría).
    const funcMsg = prisma.chatMessage.create.mock.calls.find((c) => c[0].data.function_result);
    const result = JSON.parse(funcMsg![0].data.function_result);
    expect(result.needs_confirmation).toBe(true);
    expect(result.confirmation_id).toMatch(/^[0-9a-f-]{36}$/);
    // La lista de similares no expone IDs internos de productos.
    expect(result.similar[0]).not.toHaveProperty('id');

    // --- Turno 2: el usuario dice que sí; la IA confirma SOLO con el id ---
    deepSeek.chatCompletion
      .mockResolvedValueOnce(
        toolCall('confirmar_creacion_producto', {
          confirmation_id: lastConfirmationId(prisma as never),
        }),
      )
      .mockResolvedValueOnce(textAnswer('Listo, la creé.'));

    const turn2 = await service.sendMessage('u1', 'c1', 'sí');
    expect(turn2.message).toBe('Listo, la creé.');

    // Se crea UNA vez, con los argumentos ORIGINALES del turno 1.
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data.nombre).toBe('Licuadora Oster');
    expect(data.fecha_compra).toEqual(new Date('2026-08-15T00:00:00Z'));
    expect(data.precio.toString()).toBe('150');
    expect(data.lugar_compra).toBe('Falabella');
  });

  it('turno 1: duplicado; turno 2 cancelar_creacion_producto → no crea y limpia el pendiente', async () => {
    const { prisma, deepSeek, service } = buildFullStack();
    prisma.product.findMany.mockResolvedValue(EXISTING);

    deepSeek.chatCompletion
      .mockResolvedValueOnce(toolCall('crear_producto', ORIGINAL_ARGS))
      .mockResolvedValueOnce(textAnswer('¿La creo igual?'));
    await service.sendMessage('u1', undefined, 'Compré una licuadora');
    expect(prisma.product.create).not.toHaveBeenCalled();

    // --- Turno 2: el usuario rechaza; la IA cancela con el id ---
    deepSeek.chatCompletion
      .mockResolvedValueOnce(
        toolCall('cancelar_creacion_producto', {
          confirmation_id: lastConfirmationId(prisma as never),
        }),
      )
      .mockResolvedValueOnce(textAnswer('Perfecto, no la creo.'));

    const turn2 = await service.sendMessage('u1', 'c1', 'no');
    expect(turn2.message).toBe('Perfecto, no la creo.');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('estado aislado por conversación: confirmar desde OTRA conversación se rechaza; desde la original crea', async () => {
    const { prisma, deepSeek, service } = buildFullStack();
    prisma.product.findMany.mockResolvedValue(EXISTING);
    // El mock devuelve la conversación pedida, para poder usar c1 y c2.
    prisma.chatConversation.findFirst.mockImplementation(
      async ({ where }: { where: { id?: string } }) => ({
        id: where?.id ?? 'c1',
        user_id: 'u1',
      }),
    );

    // --- Conversación c1: turno 1 con duplicado → pendiente con id opaco ---
    deepSeek.chatCompletion
      .mockResolvedValueOnce(toolCall('crear_producto', ORIGINAL_ARGS))
      .mockResolvedValueOnce(textAnswer('¿La creo igual?'));
    await service.sendMessage('u1', 'c1', 'Compré una licuadora');
    expect(prisma.product.create).not.toHaveBeenCalled();

    const confirmationId = lastConfirmationId(prisma as never);

    // --- Conversación c2 (mismo usuario): intenta confirmar con el id de c1 → SE RECHAZA ---
    deepSeek.chatCompletion
      .mockResolvedValueOnce(
        toolCall('confirmar_creacion_producto', { confirmation_id: confirmationId }),
      )
      .mockResolvedValueOnce(textAnswer('No pude crear el producto.'));
    const wrongConv = await service.sendMessage('u1', 'c2', 'sí');
    expect(wrongConv.message).toBe('No pude crear el producto.');
    expect(prisma.product.create).not.toHaveBeenCalled();

    // --- Conversación c1 (la original): confirma → se crea con los ORIGINALES ---
    deepSeek.chatCompletion
      .mockResolvedValueOnce(
        toolCall('confirmar_creacion_producto', {
          confirmation_id: lastConfirmationId(prisma as never),
        }),
      )
      .mockResolvedValueOnce(textAnswer('Listo, la creé.'));
    const rightConv = await service.sendMessage('u1', 'c1', 'sí');
    expect(rightConv.message).toBe('Listo, la creé.');
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data.nombre).toBe('Licuadora Oster');
    expect(data.fecha_compra).toEqual(new Date('2026-08-15T00:00:00Z'));
  });
});
