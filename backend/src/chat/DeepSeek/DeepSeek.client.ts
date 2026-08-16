// =============================================================================
// DeepSeekClient - cliente HTTP para la API de DeepSeek (chat completions)
// =============================================================================
// Wrapper sobre fetch con:
//   - Timeout POR INTENTO: un AbortController independiente por intento
//     (default 10s, configurable con DEEPSEEK_TIMEOUT_MS).
//   - Presupuesto TOTAL de la llamada (default 15s, DEEPSEEK_TOTAL_BUDGET_MS):
//     los reintentos nunca pueden excederlo — el usuario no espera más de eso.
//   - Un único reintento SOLO para errores de red transitorios (ECONNRESET,
//     ETIMEDOUT, ENOTFOUND) y HTTP 5xx. Los 4xx (payload o key) y los timeouts
//     NO se reintentan: en un caso el problema no se arregla solo y en el otro
//     la respuesta no va a llegar; mejor responder el fallback de inmediato.
//   - Limpieza del timer con finally en cada intento.
//
// DeepSeek expone una API compatible con OpenAI (chat completions + function
// calling). Endpoint y modelo configurables por env var (DEEPSEEK_API_BASE,
// DEEPSEEK_MODEL).
// =============================================================================

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatCompletionRequest, ChatCompletionResponse } from './chat.types';

const FALLBACK_TIMEOUT_MS = 10000;
const FALLBACK_TOTAL_BUDGET_MS = 15000;
const MAX_ATTEMPTS = 2;
const PLACEHOLDER_KEY = 'replace-with-your-api-key';

@Injectable()
export class DeepSeekClient {
  private readonly logger = new Logger(DeepSeekClient.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly defaultTimeoutMs: number;
  private readonly totalBudgetMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.get<string>('DEEPSEEK_API_KEY') ?? '';
    this.baseUrl = (
      config.get<string>('DEEPSEEK_API_BASE') ?? 'https://api.deepseek.com/v1'
    ).replace(/\/$/, '');
    this.model = config.get<string>('DEEPSEEK_MODEL') ?? 'deepseek-chat';
    this.defaultTimeoutMs = Number(
      config.get<string>('DEEPSEEK_TIMEOUT_MS') ?? FALLBACK_TIMEOUT_MS,
    );
    this.totalBudgetMs = Number(
      config.get<string>('DEEPSEEK_TOTAL_BUDGET_MS') ?? FALLBACK_TOTAL_BUDGET_MS,
    );

    if (!this.apiKey || this.apiKey === PLACEHOLDER_KEY) {
      this.logger.warn(
        'DEEPSEEK_API_KEY no configurada: las llamadas a la IA fallarán (el chat responde con fallback amable).',
      );
    }
  }

  getModel(): string {
    return this.model;
  }

  /**
   * Llama a /chat/completions con timeout por intento y presupuesto total.
   * Si el presupuesto se agota o el proveedor falla, lanza
   * ServiceUnavailableException para que el service devuelva un fallback.
   */
  async chatCompletion(
    request: ChatCompletionRequest,
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<ChatCompletionResponse> {
    if (!this.apiKey || this.apiKey === PLACEHOLDER_KEY) {
      throw new ServiceUnavailableException('El servicio de IA no está configurado.');
    }

    const deadline = Date.now() + this.totalBudgetMs;
    let attempt = 0;

    while (attempt < MAX_ATTEMPTS) {
      attempt++;

      // El presupuesto total es un techo duro: si ya se consumió (p. ej. por
      // reintentos lentos), no disparamos otro intento sin margen.
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new ServiceUnavailableException(
          'El servicio de IA tardó demasiado en responder. Inténtalo de nuevo.',
        );
      }

      // AbortController INDEPENDIENTE por intento: un timeout en el intento 1
      // no contamina el intento 2 (el bug viejo reusaba el mismo controller).
      const controller = new AbortController();
      // El timeout del intento nunca supera lo que queda del presupuesto.
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        if (!response.ok) {
          // 4xx: problema del payload o de la key — reintentar no ayuda.
          if (response.status >= 400 && response.status < 500) {
            throw new ServiceUnavailableException(
              `El servicio de IA rechazó la solicitud (${response.status}).`,
            );
          }
          // 5xx: fallo del proveedor — un reintento, sin exceder el presupuesto.
          if (attempt < MAX_ATTEMPTS) {
            await this.sleep(this.backoffFor(attempt, deadline));
            continue;
          }
          throw new ServiceUnavailableException(
            `El servicio de IA no está respondiendo (${response.status}).`,
          );
        }

        try {
          return (await response.json()) as ChatCompletionResponse;
        } catch {
          // Cuerpo no-JSON (HTML de un proxy, gateway, etc.): no se arregla
          // reintentando; error sanitizado → el service devuelve el fallback.
          throw new ServiceUnavailableException(
            'El servicio de IA devolvió una respuesta inválida.',
          );
        }
      } catch (err) {
        const isAbort = (err as Error).name === 'AbortError';
        if (isAbort) {
          // Timeout del intento: NO reintentamos (regla: solo red/5xx); el
          // fallback amable responde de inmediato.
          throw new ServiceUnavailableException(
            'La IA tardó demasiado en responder. Inténtalo de nuevo.',
          );
        }
        // Errores de red transitorios: un reintento, sin exceder el presupuesto.
        if (attempt < MAX_ATTEMPTS && this.isTransient(err as Error)) {
          await this.sleep(this.backoffFor(attempt, deadline));
          continue;
        }
        throw err;
      } finally {
        // Limpieza SIEMPRE, incluso en el camino del retry: el timer del
        // intento actual no puede quedar vivo ni cancelar el siguiente.
        clearTimeout(timer);
      }
    }

    throw new ServiceUnavailableException('No se pudo contactar con la IA.');
  }

  private isTransient(err: Error): boolean {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND';
  }

  /**
   * Backoff del reintento acotado al presupuesto TOTAL: nunca duerme más de
   * lo que queda antes del deadline (el bucle corta si no queda margen).
   */
  private backoffFor(attempt: number, deadline: number): number {
    return Math.min(500 * attempt, Math.max(0, deadline - Date.now()));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
