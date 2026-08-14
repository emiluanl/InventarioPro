// =============================================================================
// JsonLogger - logger estructurado (JSON) para producción
// =============================================================================
// En producción cada entrada es un objeto JSON de una sola línea, lo que
// facilita grep, journald y agregadores (Loki, CloudWatch, etc.):
//
//   {"level":"error","message":"...","context":"AuthService","timestamp":"..."}
//
// En desarrollo mantiene el formato legible de texto para no perder la
// experiencia local. Mismos niveles que el Logger de Nest.
// =============================================================================

import { Injectable, LoggerService, LogLevel } from '@nestjs/common';

@Injectable()
export class JsonLogger implements LoggerService {
  private readonly json: boolean;

  constructor(isProduction = false) {
    this.json = isProduction;
  }

  private emit(level: LogLevel, message: unknown, context?: string): void {
    const timestamp = new Date().toISOString();

    if (this.json) {
      const line = JSON.stringify({
        level,
        message: this.formatMessage(message),
        ...(context ? { context } : {}),
        timestamp,
      });
      // En producción escribimos a stdout (logs en JSON en una línea).
      // eslint-disable-next-line no-console
      console.log(line);
      return;
    }

    const prefix = context ? `[${context}]` : '';
    // eslint-disable-next-line no-console
    console.log(`${timestamp} ${level.toUpperCase()} ${prefix} ${this.formatMessage(message)}`);
  }

  private formatMessage(message: unknown): string {
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }

  log(message: unknown, context?: string): void {
    this.emit('log', message, context);
  }

  error(message: unknown, stackOrContext?: string, context?: string): void {
    // Nest llama error(msg, stack) o error(msg, context): normalizamos.
    this.emit('error', message, stackOrContext ?? context);
  }

  warn(message: unknown, context?: string): void {
    this.emit('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.emit('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.emit('verbose', message, context);
  }
}
