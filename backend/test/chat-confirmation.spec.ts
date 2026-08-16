// =============================================================================
// Pruebas de DOS TURNOS del flujo consultivo de crear_producto
// =============================================================================
// Pasan por ChatService completo (executor REAL + DeepSeek mockeado + prisma
// mockeado) para verificar el ciclo real de conversación:
//   Turno 1: el usuario reporta una compra que YA existe → needs_confirmation,
//            no se crea nada.
//   Turno 2 "sí": la IA confirma → se crea con los argumentos ORIGINALES.
//   Turno 2 "no": la IA cancela → no se crea y el pendiente queda limpio (un
//                 confirmar:true posterior se rechaza).
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
  it('turno 1: duplicado → needs_confirmation sin crear; turno 2 "sí" → crea con los argumentos ORIGINALES', async () => {
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

    // --- Turno 2: el usuario dice que sí; la IA confirma (repitiendo otros args) ---
    deepSeek.chatCompletion
      .mockResolvedValueOnce(
        toolCall('crear_producto', {
          confirmar: true,
          nombre: 'lo que sea',
          fecha_compra: '2026-01-01',
          tipo_compra: 'ONLINE',
          precio: 999,
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

  it('turno 1: duplicado; turno 2 "no" → no crea y limpia el pendiente (confirmar:true posterior se rechaza)', async () => {
    const { prisma, deepSeek, service } = buildFullStack();
    prisma.product.findMany.mockResolvedValue(EXISTING);

    // --- Turno 1 ---
    deepSeek.chatCompletion
      .mockResolvedValueOnce(toolCall('crear_producto', ORIGINAL_ARGS))
      .mockResolvedValueOnce(textAnswer('¿La creo igual?'));
    await service.sendMessage('u1', undefined, 'Compré una licuadora');
    expect(prisma.product.create).not.toHaveBeenCalled();

    // --- Turno 2: el usuario dice que no; la IA cancela ---
    deepSeek.chatCompletion
      .mockResolvedValueOnce(toolCall('crear_producto', { ...ORIGINAL_ARGS, confirmar: false }))
      .mockResolvedValueOnce(textAnswer('Perfecto, no la creo.'));

    const turn2 = await service.sendMessage('u1', 'c1', 'no');
    expect(turn2.message).toBe('Perfecto, no la creo.');
    expect(prisma.product.create).not.toHaveBeenCalled();

    // --- Turno 3: un confirmar:true SIN pendiente se rechaza (el "no" lo limpió) ---
    deepSeek.chatCompletion
      .mockResolvedValueOnce(toolCall('crear_producto', { ...ORIGINAL_ARGS, confirmar: true }))
      .mockResolvedValueOnce(textAnswer('No pude crear el producto.'));

    const turn3 = await service.sendMessage('u1', 'c1', 'al final sí');
    expect(turn3.message).toBe('No pude crear el producto.');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });
});
