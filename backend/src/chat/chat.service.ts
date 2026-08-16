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
    const history = await this.buildHistory(userId, conversation.id);

    // 4) Loop de function calling
    const result = await this.runAgentLoop(userId, history);

    // 5) Auditoría: registrar las herramientas ejecutadas (qué se llamó, con
    //    qué argumentos y qué devolvió). Son filas auxiliares marcadas por
    //    function_call (content ''): no van al historial de la IA (buildHistory
    //    las filtra) ni a la UI (getMessages filtra function_call null).
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

  private async buildHistory(userId: string, conversationId: string): Promise<ApiChatMessage[]> {
    const messages = (
      await this.prisma.chatMessage.findMany({
        where: { conversation_id: conversationId },
        orderBy: { created_at: 'asc' },
        take: 50, // límite para no enviar historiales infinitos
      })
    ).filter(
      // Las filas de auditoría (function_call seteado) no se envían al LLM.
      (m) => m.function_call === null,
    );

    const apiMessages: ApiChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT + `\n\nUsuario actual: ${userId}` },
      ...messages.map((m) => ({
        role: m.role.toLowerCase() as ApiChatMessage['role'],
        content: m.content,
      })),
    ];
    return apiMessages;
  }

  private async runAgentLoop(
    userId: string,
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

          const result = await this.executor.execute(userId, toolCall.function.name, parsedArgs);
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
