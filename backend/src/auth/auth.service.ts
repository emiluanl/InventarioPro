// =============================================================================
// AuthService - Lógica de autenticación
// =============================================================================
// Responsabilidades:
//   - Registro con hash Argon2id + envío de email de verificación
//   - Login (verifica password, emite access + refresh)
//   - Refresh (rota el refresh token, invalida el anterior)
//   - Logout (marca el refresh token como revocado)
//   - Forgot / reset password (tokens hasheados de un solo uso)
//   - Verificación de email
//
// Todas las contraseñas se hashean con Argon2id. Los tokens (verificación,
// reset, refresh) se almacenan hasheados en BD: si alguien accede a la base
// de datos no puede suplantar usuarios.
// =============================================================================

import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { StorageService } from '../common/storage.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { createHash, randomBytes } from 'node:crypto';
import { parseTtlSeconds } from '../common/parse-ttl';

interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
}

interface AuthTokensWithCookies extends AuthTokens {
  access_max_age_ms: number;
  refresh_max_age_ms: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly storage: StorageService,
  ) {}

  // ===========================================================================
  // REGISTER
  // ===========================================================================
  async register(dto: RegisterDto): Promise<{ message: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      // Mensaje genérico para no confirmar si un email está registrado.
      throw new ConflictException('No se pudo completar el registro con esos datos.');
    }

    const password_hash = await this.hashPassword(dto.password);
    const verificationToken = this.generateSecureToken();
    const verificationHash = this.hashToken(verificationToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password_hash,
        nombre: dto.nombre,
        email_verification_token: verificationHash,
        email_verification_expires_at: expiresAt,
      },
    });

    // No esperamos a que se envíe: si falla, el service de email ya loguea
    // el error y no bloqueamos el registro.
    void this.email.sendVerificationEmail(user.email, verificationToken);

    this.logger.log(`Usuario registrado: ${user.id}`);
    return { message: 'Registro completado. Revisa tu email para verificar la cuenta.' };
  }

  // ===========================================================================
  // LOGIN
  // ===========================================================================
  async login(
    dto: LoginDto,
  ): Promise<AuthTokensWithCookies & { user: { id: string; email: string } }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      // Mensaje genérico para no permitir enumeración de usuarios.
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const ok = await this.verifyPassword(dto.password, user.password_hash);
    if (!ok) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (!user.email_verificado) {
      throw new UnauthorizedException(
        'Debes verificar tu email antes de iniciar sesión. Revisa tu bandeja de entrada.',
      );
    }

    const tokens = await this.issueTokens(user.id, user.email);
    return { ...tokens, user: { id: user.id, email: user.email } };
  }

  // ===========================================================================
  // REFRESH
  // ===========================================================================
  // Rotación con detección de REUSO: si un token ya rotado (revocado) se
  // presenta de nuevo, es señal de robo o replay → se revoca TODA la familia
  // de sesiones del usuario (todos los refresh tokens activos), invalidando
  // también el token nuevo que el atacante pudo haber obtenido.
  //
  // Trade-off conocido (mismo criterio que Auth0/OWASP): un dispositivo
  // legítimo que guardó un token viejo también fuerza el re-login de todas
  // las sesiones al usarlo. El frontend ya serializa los refreshes (single
  // flight), así que no hay falsos positivos por refreshes paralelos.
  // ===========================================================================
  async refresh(refreshToken: string): Promise<AuthTokensWithCookies> {
    const tokenHash = this.hashToken(refreshToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { token_hash: tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }

    // Rotación ATÓMICA: el update lleva la guardia (revocado_at nulo + no
    // expirado), así que de N peticiones concurrentes con el mismo token solo
    // UNA gana (count=1). Las demás obtienen count=0 y entran en el chequeo
    // de reuso.
    const rotated = await this.prisma.refreshToken.updateMany({
      where: {
        token_hash: tokenHash,
        revoked_at: null,
        expires_at: { gt: new Date() },
      },
      data: { revoked_at: new Date() },
    });

    if (rotated.count === 0) {
      // No se pudo rotar: el token expiró (caso normal) o YA FUE ROTADO.
      if (stored.revoked_at) {
        // REUSO: este token ya se usó antes. Revocamos todas las sesiones
        // activas del usuario.
        await this.prisma.refreshToken.updateMany({
          where: { user_id: stored.user_id, revoked_at: null },
          data: { revoked_at: new Date() },
        });
        this.logger.warn(
          `Reuso de refresh token detectado; sesiones revocadas para ${stored.user_id}`,
        );
      }
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }

    // Rotación OK: el token anterior quedó revocado; emitimos el par nuevo.
    return this.issueTokens(stored.user.id, stored.user.email);
  }

  // ===========================================================================
  // LOGOUT
  // ===========================================================================
  async logout(userId: string, refreshToken?: string): Promise<{ message: string }> {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { user_id: userId, token_hash: tokenHash, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    } else {
      // Sin refresh token: cerramos TODAS las sesiones del usuario.
      await this.prisma.refreshToken.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    }
    return { message: 'Sesión cerrada.' };
  }

  // ===========================================================================
  // FORGOT PASSWORD
  // ===========================================================================
  async forgotPassword(email: string): Promise<{ message: string }> {
    // SIEMPRE devolvemos el mismo mensaje, exista el email o no.
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = this.generateSecureToken();
      const tokenHash = this.hashToken(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          password_reset_token: tokenHash,
          password_reset_expires_at: expiresAt,
        },
      });

      void this.email.sendPasswordResetEmail(user.email, token);
    }
    return {
      message:
        'Si la cuenta existe, enviaremos un email con instrucciones para restablecer la contraseña.',
    };
  }

  // ===========================================================================
  // RESET PASSWORD
  // ===========================================================================
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(dto.token);
    const user = await this.prisma.user.findFirst({
      where: {
        password_reset_token: tokenHash,
        password_reset_expires_at: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Token inválido o expirado.');
    }

    const password_hash = await this.hashPassword(dto.new_password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          password_hash,
          password_reset_token: null,
          password_reset_expires_at: null,
        },
      }),
      // Por seguridad, también cerramos todas las sesiones activas.
      this.prisma.refreshToken.updateMany({
        where: { user_id: user.id, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    return { message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.' };
  }

  // ===========================================================================
  // CHANGE PASSWORD (estando logueado)
  // ===========================================================================
  // Exige la contraseña actual (evita que alguien con una sesión robada la
  // cambie sin conocerla) y revoca TODAS las sesiones activas: cualquier otro
  // dispositivo deja de ser válido al agotarse su access token.
  // ===========================================================================
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const ok = await this.verifyPassword(dto.current_password, user.password_hash);
    if (!ok) {
      throw new UnauthorizedException('La contraseña actual no es correcta.');
    }

    const password_hash = await this.hashPassword(dto.new_password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password_hash },
      }),
      // Por seguridad, cerramos todas las sesiones activas.
      this.prisma.refreshToken.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    this.logger.log(`Contraseña cambiada: ${userId}`);
    return { message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.' };
  }

  // ===========================================================================
  // DELETE ACCOUNT
  // ===========================================================================
  // Destructivo e irreversible: exige la contraseña actual como confirmación.
  // Las relaciones del esquema borran en cascada (productos, categorías,
  // adjuntos, notificaciones, chat, push, refresh tokens); los ARCHIVOS del
  // storage (fotos/recibos) se borran aparte, best-effort: si el provider
  // falla no impedimos la eliminación de la cuenta.
  // ===========================================================================
  async deleteAccount(userId: string, password: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const ok = await this.verifyPassword(password, user.password_hash);
    if (!ok) {
      throw new UnauthorizedException('La contraseña no es correcta.');
    }

    // Recolectamos las URLs (claves) de los adjuntos del usuario antes de
    // borrar, porque la cascada elimina las filas de la BD.
    const attachments = await this.prisma.productAttachment.findMany({
      where: { product: { user_id: userId } },
      select: { url: true },
    });

    // La cascada del esquema se encarga del resto de tablas.
    await this.prisma.user.delete({ where: { id: userId } });

    for (const attachment of attachments) {
      try {
        // El storage espera la key interna, no la URL pública (evita huérfanos).
        await this.storage.delete(this.storage.keyFromUrl(attachment.url));
      } catch (err) {
        this.logger.warn(
          `No se pudo borrar el archivo ${attachment.url} del storage: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(`Cuenta eliminada: ${userId} (${attachments.length} adjuntos)`);
    return { message: 'Tu cuenta y todos tus datos fueron eliminados.' };
  }

  // ===========================================================================
  // VERIFY EMAIL
  // ===========================================================================
  async verifyEmail(token: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(token);
    const user = await this.prisma.user.findFirst({
      where: {
        email_verification_token: tokenHash,
        email_verification_expires_at: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Token de verificación inválido o expirado.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        email_verificado: true,
        email_verification_token: null,
        email_verification_expires_at: null,
      },
    });

    return { message: 'Email verificado correctamente.' };
  }

  // ===========================================================================
  // RESEND VERIFICATION EMAIL
  // ===========================================================================
  // Cubre el caso de enlace expirado: genera un token nuevo (24h) y reenvía
  // el email. Como en forgotPassword, SIEMPRE devolvemos el mismo mensaje
  // (privacidad): no revela si la cuenta existe ni si ya está verificada.
  // ===========================================================================
  async resendVerificationEmail(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user && !user.email_verificado) {
      const token = this.generateSecureToken();
      const tokenHash = this.hashToken(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          email_verification_token: tokenHash,
          email_verification_expires_at: expiresAt,
        },
      });

      void this.email.sendVerificationEmail(user.email, token);
    }

    return {
      message: 'Si la cuenta existe y no está verificada, enviaremos un nuevo enlace a tu email.',
    };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================
  private async issueTokens(userId: string, email: string): Promise<AuthTokensWithCookies> {
    const accessMaxAgeSec = parseTtlSeconds(this.config.get<string>('JWT_ACCESS_TTL'));
    const refreshMaxAgeSec = parseTtlSeconds(
      this.config.get<string>('JWT_REFRESH_TTL'),
      7 * 24 * 60 * 60,
    );

    const access_token = await this.jwt.signAsync(
      { sub: userId, email },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        // NÚMERO de segundos: si pasáramos un string, jsonwebtoken lo
        // interpretaría como milisegundos ('900' = 0.9 s → token instantáneo).
        expiresIn: accessMaxAgeSec,
      },
    );

    const refresh_token = this.generateSecureToken();
    const refresh_token_hash = this.hashToken(refresh_token);

    await this.prisma.refreshToken.create({
      data: {
        user_id: userId,
        token_hash: refresh_token_hash,
        expires_at: new Date(Date.now() + refreshMaxAgeSec * 1000),
      },
    });

    return {
      access_token,
      refresh_token,
      expires_in: accessMaxAgeSec,
      refresh_expires_in: refreshMaxAgeSec,
      access_max_age_ms: accessMaxAgeSec * 1000,
      refresh_max_age_ms: refreshMaxAgeSec * 1000,
    };
  }

  private async hashPassword(plain: string): Promise<string> {
    // Argon2id es el algoritmo recomendado por OWASP desde 2023.
    // Parámetros por defecto de argon2 son razonables; ajustamos memoria
    // para no penalizar el arranque en máquinas modestas.
    const argon2 = await import('argon2');
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16, // 64 MB
      timeCost: 3,
      parallelism: 1,
    });
  }

  private async verifyPassword(plain: string, hash: string): Promise<boolean> {
    try {
      const argon2 = await import('argon2');
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  private generateSecureToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
