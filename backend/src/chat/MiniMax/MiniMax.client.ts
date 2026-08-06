// =============================================================================
// MiniMaxClient - cliente HTTP para la API de MiniMax M3
// =============================================================================
// Wrapper sobre fetch con:
//   - Timeout por request (AbortController, default 10s).
//   - Reintento con backoff exponencial (1 reintento).
//   - Manejo de errores tipado.
//
// Endpoint y modelo configurables por env var (MINIMAX_API_BASE, MINIMAX_MODEL).
// =============================================================================

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatCompletionRequest, ChatCompletionResponse } from './chat.types';

const FALLBACK_TIMEOUT_MS = 10000;

@Injectable()
export class MiniMaxClient {
  private readonly logger = new Logger(MiniMaxClient.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly defaultTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.get<string>('MINIMAX_API_KEY') ?? '';
    this.baseUrl = (config.get<string>('MINIMAX_API_BASE') ?? 'https://api.MiniMax.com/v1').replace(
      /\/$/,
      '',
    );
    this.model = config.get<string>('MINIMAX_MODEL') ?? 'MiniMax-M3';
    this.defaultTimeoutMs = Number(config.get<string>('MINIMAX_TIMEOUT_MS') ?? FALLBACK_TIMEOUT_MS);

    if (!this.apiKey || this.apiKey === 'replace-with-your-api-key') {
      this.logger.warn('MINIMAX_API_KEY no configurada: las llamadas a la IA fallarán.');
    }
  }

  getModel(): string {
    return this.model;
  }

  /**
   * Llama a /chat/completions con timeout. Si tarda más, lanza
   * ServiceUnavailableException para que el service devuelva un fallback.
   */
  async chatCompletion(
    request: ChatCompletionRequest,
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<ChatCompletionResponse> {
    if (!this.apiKey || this.apiKey === 'replace-with-your-api-key') {
      throw new ServiceUnavailableException('El servicio de IA no está configurado.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      attempt++;
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
          // 4xx: no reintentamos (es problema del payload).
          if (response.status >= 400 && response.status < 500) {
            throw new ServiceUnavailableException(
              `El servicio de IA rechazó la solicitud (${response.status}).`,
            );
          }
          // 5xx / timeouts de red: reintentamos una vez.
          if (attempt < maxAttempts) {
            await this.sleep(500 * attempt);
            continue;
          }
          throw new ServiceUnavailableException(
            `El servicio de IA no está respondiendo (${response.status}).`,
          );
        }

        clearTimeout(timeout);
        return (await response.json()) as ChatCompletionResponse;
      } catch (err) {
        clearTimeout(timeout);
        const isAbort = (err as Error).name === 'AbortError';
        if (isAbort) {
          if (attempt < maxAttempts) {
            await this.sleep(500 * attempt);
            continue;
          }
          throw new ServiceUnavailableException(
            'La IA tardó demasiado en responder. Inténtalo de nuevo.',
          );
        }
        // Errores de red transitorios: reintento.
        if (attempt < maxAttempts && this.isTransient(err as Error)) {
          await this.sleep(500 * attempt);
          continue;
        }
        throw err;
      }
    }

    throw new ServiceUnavailableException('No se pudo contactar con la IA.');
  }

  private isTransient(err: Error): boolean {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
