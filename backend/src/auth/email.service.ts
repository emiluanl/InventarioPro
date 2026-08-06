// =============================================================================
// Servicio de email
// =============================================================================
// Wrapper sobre Nodemailer. En desarrollo (sin SMTP configurado) cae en un
// modo "console transport" que imprime los enlaces en la consola del backend,
// para que puedas probar el flujo sin un proveedor real.
//
// En producción configura las variables SMTP_* en .env y se usará SMTP real.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter;
  private readonly fromAddress: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.fromAddress =
      this.config.get<string>('SMTP_FROM') ?? 'InventarioPro <noreply@example.com>';
    this.baseUrl = this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:3000';

    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASSWORD');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`Email configurado vía SMTP (${host}).`);
    } else {
      // Modo desarrollo: imprimimos el contenido en consola.
      this.transporter = nodemailer.createTransport({
        streamTransport: true,
        newline: 'unix',
        buffer: true,
      });
      this.logger.warn(
        'Email en modo DESARROLLO: los mensajes se imprimirán en consola. Configura SMTP_HOST/USER/PASSWORD para envío real.',
      );
    }
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const url = `${this.baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.send(
      to,
      'Verifica tu cuenta de InventarioPro',
      this.renderEmail(
        'Verifica tu cuenta',
        `Para terminar de crear tu cuenta, abre este enlace (válido por 24 horas):`,
        url,
        'Verificar email',
      ),
    );
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const url = `${this.baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send(
      to,
      'Restablece tu contraseña de InventarioPro',
      this.renderEmail(
        'Restablece tu contraseña',
        'Recibimos una solicitud para restablecer tu contraseña. Si no fuiste tú, ignora este mensaje.',
        url,
        'Elegir nueva contraseña',
      ),
    );
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        html,
      });
      // En modo streamTransport (sin SMTP), info.message contiene el mensaje completo.
      const isDevMode = !this.config.get<string>('SMTP_HOST');
      if (isDevMode) {
        this.logger.warn(`[EMAIL DEV] Para: ${to} | Asunto: ${subject}`);
        this.logger.warn((info.message as string) ?? '(contenido no disponible)');
      }
    } catch (err) {
      this.logger.error(`Error enviando email a ${to}: ${(err as Error).message}`);
      // No lanzamos: un fallo de email no debe tumbar el registro.
    }
  }

  private renderEmail(title: string, intro: string, url: string, cta: string): string {
    return `
      <div style="font-family: Inter, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #1f2937; font-size: 20px;">${title}</h1>
        <p style="color: #4b5563; line-height: 1.6;">${intro}</p>
        <p style="margin: 24px 0;">
          <a href="${url}" style="background-color: #2563eb; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">
            ${cta}
          </a>
        </p>
        <p style="color: #9ca3af; font-size: 13px;">
          Si el botón no funciona, copia este enlace: <br />
          <a href="${url}" style="color: #6b7280;">${url}</a>
        </p>
      </div>
    `;
  }
}
