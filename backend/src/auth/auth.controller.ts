// =============================================================================
// AuthController - Endpoints HTTP
// =============================================================================
// Todos los endpoints son públicos (marcados con @Public()) porque el guard
// global exige token en todo lo demás. Login y register aplican throttling
// individual para limitar intentos.
// =============================================================================

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser, AuthUser } from './decorators/current-user.decorator';
import { CookiesService } from '../common/cookies.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: CookiesService,
  ) {}

  // ---------------------------------------------------------------------------
  // REGISTRO
  // ---------------------------------------------------------------------------
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  // 100 por hora por IP (el guard global ThrottlerGuard aplica igualmente).
  @Throttle({ default: { limit: 100, ttl: 60 * 60 * 1000 } })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  // ---------------------------------------------------------------------------
  // LOGIN: máximo 5 intentos por 15 minutos por IP.
  // ---------------------------------------------------------------------------
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto);
    this.cookies.setAuthCookies(res, result);
    return result.user;
  }

  // ---------------------------------------------------------------------------
  // REFRESH
  // ---------------------------------------------------------------------------
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.['refresh_token'];
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token no presente en cookies.');
    }
    const tokens = await this.auth.refresh(refreshToken);
    this.cookies.setAuthCookies(res, tokens);
    return {
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
    };
  }

  // ---------------------------------------------------------------------------
  // LOGOUT (requiere estar autenticado para identificar al usuario)
  // ---------------------------------------------------------------------------
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.['refresh_token'];
    await this.auth.logout(user.id, refreshToken);
    this.cookies.clearAuthCookies(res);
    return { message: 'Sesión cerrada.' };
  }

  // ---------------------------------------------------------------------------
  // FORGOT PASSWORD
  // ---------------------------------------------------------------------------
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  // ---------------------------------------------------------------------------
  // RESET PASSWORD
  // ---------------------------------------------------------------------------
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  // ---------------------------------------------------------------------------
  // ME - devuelve los datos del usuario autenticado
  // ---------------------------------------------------------------------------
  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  // ---------------------------------------------------------------------------
  // VERIFY EMAIL
  // ---------------------------------------------------------------------------
  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() body: { token: string }) {
    return this.auth.verifyEmail(body.token);
  }

  // ---------------------------------------------------------------------------
  // RESEND VERIFICATION EMAIL - para enlaces expirados (máx. 3 por hora).
  // ---------------------------------------------------------------------------
  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  resendVerification(@Body() dto: ForgotPasswordDto) {
    return this.auth.resendVerificationEmail(dto.email);
  }
}
