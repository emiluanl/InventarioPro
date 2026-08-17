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
const MAX_HISTORY_MESSAGES = 50; // filas de BD consultadas como máximo (las más recientes)
const MAX_CONTEXT_CHARS = 16000; // presupuesto TOTAL de caracteres del contexto
const MAX_MESSAGE_CHARS = 4000; // tope individual por mensaje
const MAX_RECENT_GROUPS = 6; // intercambios recientes que SIEMPRE se priorizan completos
const MAX_SUMMARY_CHARS = 1500; // tope de longitud del resumen histórico
const SUMMARY_LINE_CHARS = 160; // tope de texto por línea del resumen

/** Registro de auditoría de una herramienta ejecutada por la IA. */
interface ToolCallDetail {
  name: string;
  arguments: string;
  result: unknown;
  /** Ronda del loop de function calling en la que se ejecutó (0-based). */
  round: number;
}

/** Recorta un texto a un tope legible (con elipsis). */
function truncateText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Tamaño JSON aproximado de un grupo de mensajes (para el presupuesto). */
function groupJsonSize(group: ApiChatMessage[]): number {
  return group.reduce((acc, m) => acc + (JSON.stringify(m)?.length ?? 0), 0);
}

/**
 * Agrupa el historial materializado en EXCHANGES atómicos:
 *   - un mensaje del usuario (+ la respuesta de texto del asistente), o
 *   - una RONDA de tools completa: assistant con todos los tool_calls de esa
 *     ronda + sus tool results + la respuesta final del asistente.
 * Nunca se divide un assistant tool_calls de sus resultados, una ronda con
 * varias tools, ni un intercambio consultivo (needs_confirmation →
 * confirmar/cancelar).
 */
function groupExchanges(messages: ApiChatMessage[]): ApiChatMessage[][] {
  const groups: ApiChatMessage[][] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (m.role === 'user') {
      groups.push([m]);
    } else if (m.role === 'assistant' && m.tool_calls) {
      groups.push([m]); // nueva ronda de tools
    } else if (m.role === 'tool') {
      if (last && last[0].tool_calls) last.push(m);
      else groups.push([m]);
    } else {
      // assistant con texto: cierra el intercambio del usuario o de la ronda.
      if (last && (last[last.length - 1].role === 'user' || last.some((x) => x.tool_calls))) {
        last.push(m);
      } else {
        groups.push([m]);
      }
    }
  }
  return groups;
}

/**
 * Índice del intercambio consultivo PENDIENTE: el último grupo que devolvió
 * `needs_confirmation` SIN un confirmar/cancelar posterior. Ese intercambio
 * (y su confirmation_id) debe preservarse COMPLETO en el contexto para que la
 * IA pueda confirmar o cancelar. Devuelve -1 si no hay ninguno pendiente.
 */
function findPendingExchangeIndex(groups: ApiChatMessage[][]): number {
  const CONFIRM_TOOLS = new Set(['confirmar_creacion_producto', 'cancelar_creacion_producto']);
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    const closed = group.some(
      (m) =>
        m.role === 'assistant' && m.tool_calls?.some((tc) => CONFIRM_TOOLS.has(tc.function.name)),
    );
    if (closed) return -1; // un confirmar/cancelar posterior cerró el flujo
    const pending = group.some((m) => {
      if (m.role !== 'tool' || !m.content) return false;
      try {
        return JSON.parse(m.content).needs_confirmation === true;
      } catch {
        return false;
      }
    });
    if (pending) return i;
  }
  return -1;
}

/**
 * Resumen histórico determinista y LOCAL (sin DeepSeek, sin API key) de los
 * grupos antiguos ya finalizados. Solo usa texto del usuario, respuestas del
 * asistente y NOMBRES de herramientas — NUNCA results de tools (podrían
 * contener ids internos o confirmation_ids), ni userId ni otros datos
 * internos. Acotado a MAX_SUMMARY_CHARS, conservando las entradas más
 * recientes (las más útiles para el modelo).
 */
function buildSummary(groups: ApiChatMessage[][]): string | null {
  const lines: string[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    const user = group.find((m) => m.role === 'user');
    const assistantText = [...group].reverse().find((m) => m.role === 'assistant' && !m.tool_calls);
    const tools = group.flatMap((m) => (m.tool_calls ?? []).map((tc) => tc.function.name));
    const parts: string[] = [];
    if (user) parts.push(`usuario: "${truncateText(user.content ?? '', SUMMARY_LINE_CHARS)}"`);
    if (assistantText) {
      parts.push(`asistente: "${truncateText(assistantText.content ?? '', SUMMARY_LINE_CHARS)}"`);
    }
    if (tools.length > 0) parts.push(`herramientas: ${[...new Set(tools)].join(', ')}`);
    if (parts.length > 0) lines.push(`- ${parts.join(' · ')}`);
  }
  if (lines.length === 0) return null;
  const header = 'Resumen histórico (mensajes anteriores condensados para ahorrar contexto):';
  let body = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = body ? `${lines[i]}\n${body}` : lines[i];
    if (header.length + 1 + candidate.length > MAX_SUMMARY_CHARS) break;
    body = candidate;
  }
  if (!body) return null;
  return `${header}\n${body}`;
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
    //    El campo interno `round` (misma ronda del loop) permite reconstruir
    //    en el historial UN assistant con TODOS los tool_calls simultáneos de
    //    esa ronda + un tool result por llamada (patrón estándar de la API).
    for (const detail of result.toolDetails) {
      await this.prisma.chatMessage.create({
        data: {
          conversation_id: conversation.id,
          role: ChatRole.ASSISTANT,
          content: '',
          function_call: JSON.stringify({
            name: detail.name,
            arguments: detail.arguments,
            round: detail.round ?? 0,
          }),
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
      take: MAX_HISTORY_MESSAGES, // límite de filas consultadas (nunca un historial infinito)
    });

    // 1) MATERIALIZAR las filas en los mensajes que el LLM necesita para
    //    CONTINUAR la conversación (patrón estándar de function calling):
    //      - Fila normal (function_call null) → mensaje user/assistant con texto.
    //      - Filas de auditoría (function_call seteado) → UN assistant con
    //        TODOS los tool_calls de la MISMA ronda (campo interno `round`) +
    //        un tool result por llamada. Sin esto, los resultados de las tools
    //        (p. ej. el confirmation_id del flujo consultivo de crear_producto)
    //        se perderían entre turnos y la IA no podría confirmar ni cancelar.
    const messages: ApiChatMessage[] = [];
    let batch: {
      round: number | null;
      items: {
        id: string;
        fn: { name: string; arguments: string };
        result: string | null;
      }[];
    } | null = null;
    const flushBatch = () => {
      if (!batch) return;
      // Ids determinísticos derivados del id de cada fila: el par assistant
      // tool_calls ↔ tool debe referenciar el MISMO id (lo exige la API).
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: batch.items.map((it) => ({
          id: `call_${it.id}`,
          type: 'function',
          function: { name: it.fn.name, arguments: it.fn.arguments },
        })),
      });
      for (const it of batch.items) {
        messages.push({
          role: 'tool',
          content: (it.result ?? '{}').slice(0, MAX_MESSAGE_CHARS),
          tool_call_id: `call_${it.id}`,
          name: it.fn.name,
        });
      }
      batch = null;
    };
    for (const row of rows) {
      if (row.function_call === null) {
        flushBatch();
        if (!row.content) continue;
        messages.push({
          role: row.role.toLowerCase() as ApiChatMessage['role'],
          content: row.content.slice(0, MAX_MESSAGE_CHARS),
        });
        continue;
      }
      let fn: { name: string; arguments: string; round?: number };
      try {
        fn = JSON.parse(row.function_call);
      } catch {
        flushBatch();
        continue; // auditoría ilegible: se omite, el resto del historial sigue intacto
      }
      const round = typeof fn.round === 'number' ? fn.round : null;
      if (batch && round !== null && batch.round === round) {
        // Misma ronda: varios tool_calls simultáneos → se agrupan en UN assistant.
        batch.items.push({ id: row.id, fn, result: row.function_result });
      } else {
        flushBatch();
        batch = { round, items: [{ id: row.id, fn, result: row.function_result }] };
      }
    }
    flushBatch();

    // 2) AGRUPAR el historial en EXCHANGES atómicos (ver groupExchanges):
    //    nunca se divide una ronda de tools de sus resultados, una ronda con
    //    varias tools, ni un intercambio consultivo pendiente.
    const groups = groupExchanges(messages);
    if (groups.length === 0) return [{ role: 'system', content: SYSTEM_PROMPT }];

    // 3) PRIORIDADES del presupuesto de contexto (MAX_CONTEXT_CHARS):
    //    a. los MAX_RECENT_GROUPS intercambios más recientes — incluye SIEMPRE
    //       el último mensaje del usuario (el que dispara la llamada);
    //    b. el intercambio consultivo PENDIENTE (needs_confirmation sin
    //       confirmar/cancelar aún), aunque quede fuera de la ventana reciente:
    //       su confirmation_id debe llegar al LLM para poder confirmar/cancelar;
    //    c. un resumen histórico determinista y LOCAL de los grupos antiguos ya
    //       finalizados (sin DeepSeek, sin API key, sin datos internos);
    //    d. el resto de grupos antiguos, solo con el espacio que sobre (atómicos).
    //
    // El resumen reserva hasta MAX_SUMMARY_CHARS del presupuesto ANTES de
    // incluir grupos antiguos crudos: así la condensación tiene prioridad sobre
    // los intercambios más viejos y nunca se duplica ni se pierde información
    // (cada grupo antiguo entra completo O queda resumido, nunca ambos).
    const pendingIndex = findPendingExchangeIndex(groups);
    const startRecent = Math.max(0, groups.length - MAX_RECENT_GROUPS);

    const included = new Set<number>();
    let budget = MAX_CONTEXT_CHARS;

    for (let i = groups.length - 1; i >= startRecent; i--) {
      const size = groupJsonSize(groups[i]);
      if (included.size === 0) {
        // El último grupo (contiene el último mensaje del usuario) entra SIEMPRE.
        included.add(i);
        budget = Math.max(0, budget - size);
      } else if (size <= budget) {
        included.add(i);
        budget -= size;
      } else {
        break;
      }
    }
    if (pendingIndex >= 0 && !included.has(pendingIndex)) {
      const size = groupJsonSize(groups[pendingIndex]);
      if (size <= budget) {
        included.add(pendingIndex);
        budget -= size;
      }
    }

    // Presupuesto reservado para el resumen (solo si hay grupos antiguos).
    const hasOldGroups = startRecent > 0 && groups.length - included.size > 0;
    const reserved = hasOldGroups ? Math.min(MAX_SUMMARY_CHARS, budget) : 0;
    let walkBudget = budget - reserved;

    // d) Grupos antiguos que caben COMPLETOS (del más reciente al más antiguo;
    //    cada grupo entra completo o no entra — nunca a medias).
    const rawOld = new Set<number>();
    for (let i = startRecent - 1; i >= 0; i--) {
      if (included.has(i)) continue;
      const size = groupJsonSize(groups[i]);
      if (size <= walkBudget) {
        rawOld.add(i);
        walkBudget -= size;
      } else {
        break;
      }
    }

    // c) Resumen de los grupos antiguos que NO entraron completos.
    const summary = buildSummary(groups.filter((_, i) => !included.has(i) && !rawOld.has(i)));
    let summaryMessage: ApiChatMessage | null = null;
    if (summary && summary.length <= reserved) {
      summaryMessage = { role: 'system', content: summary };
    }

    // 4) ENSAMBLAR en orden cronológico: system prompt, resumen histórico,
    //    grupos conservados. El system prompt NO lleva datos internos (userId,
    //    tokens, ids de BD): el LLM no los necesita y el proveedor no debe ver
    //    identificadores internos del usuario.
    const final: ApiChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
    if (summaryMessage) final.push(summaryMessage);
    for (let i = 0; i < groups.length; i++) {
      if (included.has(i) || rawOld.has(i)) final.push(...groups[i]);
    }
    return final;
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
            round,
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
