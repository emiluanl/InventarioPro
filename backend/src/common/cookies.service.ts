// =============================================================================
// CookiesService - helper para setear / limpiar cookies httpOnly
// =============================================================================
// En lugar de devolver los tokens en el body del login, los seteamos como
// cookies httpOnly + Secure + SameSite=Strict. El frontend los recibe
// automáticamente en cada request con `withCredentials: true`.
//
// JavaScript del frontend NO puede leer estas cookies → defensa extra
// contra XSS.
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { Response } from 'express';

interface TokenCookies {
  access_token: string;
  refresh_token: string;
  access_max_age_ms: number;
  refresh_max_age_ms: number;
}

@Injectable()
export class CookiesService {
  private readonly isProduction: boolean;
  private readonly accessCookieName = 'access_token';
  private readonly refreshCookieName = 'refresh_token';

  constructor() {
    this.isProduction = (process.env.NODE_ENV ?? 'development') === 'production';
  }

  /** Setea las cookies de access y refresh tokens. */
  setAuthCookies(res: Response, tokens: TokenCookies): void {
    res.cookie(
      this.accessCookieName,
      tokens.access_token,
      this.cookieOptions(tokens.access_max_age_ms),
    );
    res.cookie(
      this.refreshCookieName,
      tokens.refresh_token,
      this.cookieOptions(tokens.refresh_max_age_ms),
    );
  }

  /** Limpia las cookies (logout). */
  clearAuthCookies(res: Response): void {
    res.clearCookie(this.accessCookieName, this.cookieOptions(0));
    res.clearCookie(this.refreshCookieName, this.cookieOptions(0));
  }

  /** Configuración común de cookie segura. */
  private cookieOptions(maxAgeMs: number) {
    return {
      httpOnly: true, // JS no puede leerla
      secure: this.isProduction, // solo HTTPS en producción
      sameSite: 'strict' as const,
      maxAge: maxAgeMs,
      path: '/',
    };
  }
}
