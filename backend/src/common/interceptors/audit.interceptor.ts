// =============================================================================
// AuditInterceptor - log de acciones sensibles
// =============================================================================
// Loguea las requests que tocan datos sensibles:
//   - Auth: register, login, logout, forgot-password, reset-password.
//   - Borrado de productos.
//   - Subida/borrado de adjuntos.
// El log es estructurado (JSON) para fácil ingestion por un SIEM.
// =============================================================================

import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';

const AUDIT_PATHS = [
  '/auth/register',
  '/auth/login',
  '/auth/logout',
  '/auth/forgot-password',
  '/auth/reset-password',
];

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const path = req.path;

    // ¿Es ruta auditada?
    const sensitive =
      AUDIT_PATHS.some((p) => path.endsWith(p)) ||
      /\/products\/[^/]+$/.test(path) ||
      /\/products\/[^/]+\/attachments/.test(path);

    if (!sensitive) {
      return next.handle();
    }

    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            JSON.stringify({
              audit: true,
              method: req.method,
              path,
              status: http.getResponse().statusCode,
              duration_ms: Date.now() - start,
              ip: req.ip,
              ua: req.headers['user-agent'],
              ts: new Date().toISOString(),
            }),
          );
        },
        error: (err) => {
          this.logger.warn(
            JSON.stringify({
              audit: true,
              method: req.method,
              path,
              error: err.message,
              duration_ms: Date.now() - start,
              ip: req.ip,
              ts: new Date().toISOString(),
            }),
          );
        },
      }),
    );
  }
}
