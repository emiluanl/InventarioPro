// =============================================================================
// ChatService - orquesta DeepSeek + function calling + persistencia
// =============================================================================
// Flujo:
//   1) Carga o crea la conversación.
//   2) Persiste el mensaje del usuario.
//   3) Llama a la IA con el historial + system prompt + tools.
//   4) Si la IA responde con tool_calls, ejecuta cada uno, reenvía los
//      resultados a la IA y repite hasta obtener un mensaje final
//      (máximo 5 rondas para evitar loops infinitos).
//   5) Persiste la respuesta final del asistente.
// =============================================================================

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChatRole } from '../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { DeepSeekClient } from './DeepSeek/DeepSeek.client';
import { ChatToolExecutor } from './tools/tool-executor';
import { CHAT_TOOLS, SYSTEM_PROMPT } from './tools/chat-tools';
import { ChatMessage as ApiChatMessage, ChatCompletionRequest } from './DeepSeek/chat.types';

const MAX_TOOL_ROUNDS = 5;
const FALLBACK_MESSAGE =
  'Ahora mismo no puedo pensar bien. ¿Te importa volver a intentarlo en unos segundos?';

// Límites del contexto que se envía al LLM: un historial que crece sin tope
// multiplica coste, tokens y latencia. El input del usuario ya está acotado por
// el DTO (MaxLength 2000); aquí se acota lo que ACUMULA la conversación.
const MAX_HISTORY_MESSAGES = 50; // mensajes como máximo (fila más reciente)
const MAX_CONTEXT_CHARS = 16000; // presupuesto TOTAL de caracteres
const MAX_MESSAGE_CHARS = 4000; // tope individual por mensaje

/** Registro de auditoría de una herramienta ejecutada por la IA. */
interface ToolCallDetail {
  name: string;
  arguments: string;
  result: unknown;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deepSeek: DeepSeekClient,
    private readonly executor: ChatToolExecutor,
  ) {}

  // ===========================================================================
  // sendMessage
  // ===========================================================================
  async sendMessage(
    userId: string,
    conversationId: string | undefined,
    content: string,
  ): Promise<{ conversation_id: string; message: string; tool_calls?: string[] }> {
    // 1) Cargar o crear la conversación
    const conversation = await this.getOrCreateConversation(userId, conversationId);

    // 2) Persistir el mensaje del usuario
    await this.prisma.chatMessage.create({
      data: { conversation_id: conversation.id, role: ChatRole.USER, content },
    });

    // 3) Construir el historial para la IA
    const history = await this.buildHistory(conversation.id);

    // 4) Loop de function calling
    const result = await this.runAgentLoop(userId, conversation.id, history);

    // 5) Auditoría: registrar las herramientas ejecutadas (qué se llamó, con
    //    qué argumentos y qué devolvió). Son filas auxiliares marcadas por
    //    function_call (content ''): no van a la UI (getMessages filtra
    //    function_call null), pero buildHistory las materializa en el contexto
    //    del LLM como el intercambio assistant tool_calls + tool result para
    //    que la IA pueda continuar (p. ej. confirmar con el confirmation_id).
    for (const detail of result.toolDetails) {
      await this.prisma.chatMessage.create({
        data: {
          conversation_id: conversation.id,
          role: ChatRole.ASSISTANT,
          content: '',
          function_call: JSON.stringify({ name: detail.name, arguments: detail.arguments }),
          function_result: detail.result === undefined ? null : JSON.stringify(detail.result),
        },
      });
    }

    // 6) Persistir la respuesta final del asistente
    await this.prisma.chatMessage.create({
      data: {
        conversation_id: conversation.id,
        role: ChatRole.ASSISTANT,
        content: result.message,
      },
    });
    await this.prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { updated_at: new Date() },
    });

    return {
      conversation_id: conversation.id,
      message: result.message,
      ...(result.toolCalls.length > 0 ? { tool_calls: result.toolCalls } : {}),
    };
  }

  // ===========================================================================
  // listConversations
  // ===========================================================================
  async listConversations(userId: string) {
    return this.prisma.chatConversation.findMany({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' },
      include: { _count: { select: { messages: true } } },
    });
  }

  // ===========================================================================
  // getMessages
  // ===========================================================================
  async getMessages(userId: string, conversationId: string) {
    const conversation = await this.prisma.chatConversation.findFirst({
      where: { id: conversationId, user_id: userId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada.');
    }
    // function_call null: las filas de auditoría (function_call/result, content
    // vacío) no se exponen a la UI, solo viven en la BD.
    return this.prisma.chatMessage.findMany({
      where: { conversation_id: conversationId, function_call: null },
      orderBy: { created_at: 'asc' },
    });
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================
  private async getOrCreateConversation(userId: string, conversationId?: string) {
    if (conversationId) {
      const existing = await this.prisma.chatConversation.findFirst({
        where: { id: conversationId, user_id: userId },
      });
      if (!existing) {
        throw new NotFoundException('Conversación no encontrada.');
      }
      return existing;
    }
    return this.prisma.chatConversation.create({
      data: { user_id: userId },
    });
  }

  private async buildHistory(conversationId: string): Promise<ApiChatMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
      take: MAX_HISTORY_MESSAGES, // límite para no enviar historiales infinitos
    });

    // Cada fila se materializa en los mensajes que el LLM necesita para
    // CONTINUAR la conversación (patrón estándar de function calling):
    //   - Fila normal (function_call null) → mensaje user/assistant con texto.
    //   - Fila de auditoría (function_call seteado) → el intercambio completo:
    //     assistant con tool_calls + tool con el resultado. Sin esto, los
    //     resultados de las tools (p. ej. el confirmation_id del flujo
    //     consultivo de crear_producto) se pierden entre turnos y la IA no
    //     podría confirmar ni cancelar en la siguiente respuesta.
    const messages: ApiChatMessage[] = [];
    for (const row of rows) {
      if (row.function_call === null) {
        if (!row.content) continue;
        messages.push({
          role: row.role.toLowerCase() as ApiChatMessage['role'],
          content: row.content.slice(0, MAX_MESSAGE_CHARS),
        });
        continue;
      }
      let fn: { name: string; arguments: string };
      try {
        fn = JSON.parse(row.function_call);
      } catch {
        continue; // auditoría ilegible: se omite, el resto del historial sigue intacto
      }
      // Id determinístico derivado del id de la fila: el par assistant
      // tool_calls ↔ tool debe referenciar el MISMO id (lo exige la API).
      const toolCallId = `call_${row.id}`;
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: toolCallId,
            type: 'function',
            function: { name: fn.name, arguments: fn.arguments },
          },
        ],
      });
      messages.push({
        role: 'tool',
        content: (row.function_result ?? '{}').slice(0, MAX_MESSAGE_CHARS),
        tool_call_id: toolCallId,
        name: fn.name,
      });
    }

    // Podar por GRUPO ATÓMICO: un intercambio de tool (assistant con tool_calls
    // + su tool result, materializados de UNA misma fila de auditoría) se
    // descarta COMPLETO o entra COMPLETO. Así NUNCA se envía al proveedor un
    // resultado `tool` sin su `assistant.tool_calls` asociado (lo rechazaría
    // la API y rompería el flujo). Se recorta desde los más viejos,
    // conservando SIEMPRE el último grupo (el del usuario que dispara).
    const groups: ApiChatMessage[][] = [];
    for (const m of messages) {
      const prev = groups[groups.length - 1];
      if (m.role === 'tool' && prev && prev.length === 1 && prev[0].tool_calls) {
        // El tool result completa el intercambio del assistant tool_calls previo.
        prev.push(m);
      } else {
        groups.push([m]);
      }
    }

    let budget = MAX_CONTEXT_CHARS;
    const capped: ApiChatMessage[] = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const size = groups[i].reduce((acc, m) => acc + (JSON.stringify(m)?.length ?? 0), 0);
      if (capped.length === 0) {
        // El último mensaje siempre entra (el del usuario que dispara la llamada).
        capped.unshift(...groups[i]);
        budget = Math.max(0, budget - size);
      } else if (size <= budget) {
        capped.unshift(...groups[i]);
        budget -= size;
      }
      // Si un grupo viejo no entra, se descarta COMPLETO (nunca a medias).
      if (budget <= 0) break;
    }

    // El system prompt NO lleva datos internos (userId, tokens, ids de BD):
    // el LLM no los necesita y el proveedor no debe ver identificadores
    // internos del usuario.
    return [{ role: 'system', content: SYSTEM_PROMPT }, ...capped];
  }

  private async runAgentLoop(
    userId: string,
    conversationId: string,
    history: ApiChatMessage[],
  ): Promise<{ message: string; toolCalls: string[]; toolDetails: ToolCallDetail[] }> {
    const toolCalls: string[] = [];
    const toolDetails: ToolCallDetail[] = [];
    const currentMessages = [...history];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let response;
      try {
        const request: ChatCompletionRequest = {
          model: this.deepSeek.getModel(),
          messages: currentMessages,
          tools: CHAT_TOOLS,
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 1000,
        };
        response = await this.deepSeek.chatCompletion(request);
      } catch (err) {
        // Fallback amable: nunca devolvemos el error crudo.
        this.logger.warn(`Error de IA: ${(err as Error).message}`);
        return { message: FALLBACK_MESSAGE, toolCalls, toolDetails };
      }

      const choice = response.choices?.[0];
      const message = choice?.message;

      if (!message) {
        return { message: FALLBACK_MESSAGE, toolCalls, toolDetails };
      }

      // Si la IA quiere llamar a una o más herramientas...
      if (
        message.tool_calls &&
        message.tool_calls.length > 0 &&
        choice.finish_reason === 'tool_calls'
      ) {
        // Añadimos el mensaje del asistente (con tool_calls) al historial.
        currentMessages.push({
          role: 'assistant',
          content: message.content,
          tool_calls: message.tool_calls,
        });

        // Ejecutamos cada tool.
        for (const toolCall of message.tool_calls) {
          toolCalls.push(toolCall.function.name);

          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            parsedArgs = {};
          }

          // El conversationId llega al executor: el estado de confirmaciones
          // pendientes (crear_producto consultivo) queda aislado POR conversación
          // — confirmar en otra conversación del mismo usuario se rechaza.
          const result = await this.executor.execute(
            userId,
            conversationId,
            toolCall.function.name,
            parsedArgs,
          );
          toolDetails.push({
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
            result,
          });

          currentMessages.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
          });
        }
        // Continuamos al siguiente round para que la IA formule la respuesta final.
        continue;
      }

      // Si la IA respondió con texto, terminamos.
      if (message.content) {
        return { message: message.content, toolCalls, toolDetails };
      }

      // Sin contenido ni tool_calls: fallback.
      return { message: FALLBACK_MESSAGE, toolCalls, toolDetails };
    }

    // Si agotamos las rondas, fallback.
    return { message: FALLBACK_MESSAGE, toolCalls, toolDetails };
  }
}
