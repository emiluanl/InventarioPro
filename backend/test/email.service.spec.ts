// =============================================================================
// Tests de EmailService (URLs de verificación y reset)
// =============================================================================
// En modo dev (sin SMTP_HOST) el servicio escribe el enlace en DEV_EMAIL_LOG.
// Capturamos esa salida para verificar que la URL se construye con
// APP_BASE_URL correctamente — incluye el fallback a :3010 (el frontend dev),
// regresión del fix del puerto 3000.
// =============================================================================

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';

import { EmailService } from '../src/auth/email.service';

function buildConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('EmailService', () => {
  let logFile: string;
  let logDir: string;

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), 'email-test-'));
    logFile = join(logDir, 'emails.log');
  });

  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true });
  });

  function lastLogLine(): string {
    return readFileSync(logFile, 'utf8').trim().split('\n').at(-1) ?? '';
  }

  it('usa APP_BASE_URL para construir el enlace de verificación', async () => {
    const service = new EmailService(
      buildConfig({
        APP_BASE_URL: 'http://localhost:3010',
        DEV_EMAIL_LOG: logFile,
      }),
    );

    await service.sendVerificationEmail('usuario@example.com', 'token-abc-123');

    expect(lastLogLine()).toBe(
      'VERIFY|usuario@example.com|http://localhost:3010/verify-email?token=token-abc-123',
    );
  });

  it('usa APP_BASE_URL para construir el enlace de reset de contraseña', async () => {
    const service = new EmailService(
      buildConfig({
        APP_BASE_URL: 'http://localhost:3010',
        DEV_EMAIL_LOG: logFile,
      }),
    );

    await service.sendPasswordResetEmail('usuario@example.com', 'reset-token-xyz');

    expect(lastLogLine()).toBe(
      'RESET|usuario@example.com|http://localhost:3010/reset-password?token=reset-token-xyz',
    );
  });

  it('respeta el APP_BASE_URL personalizado (no lo hardcodea)', async () => {
    const service = new EmailService(
      buildConfig({
        APP_BASE_URL: 'https://app.inventariopro.com',
        DEV_EMAIL_LOG: logFile,
      }),
    );

    await service.sendVerificationEmail('a@b.com', 'tok');

    expect(lastLogLine()).toBe(
      'VERIFY|a@b.com|https://app.inventariopro.com/verify-email?token=tok',
    );
  });

  it('cae al fallback :3010 si APP_BASE_URL no está definido', async () => {
    const service = new EmailService(
      buildConfig({
        DEV_EMAIL_LOG: logFile,
      }),
    );

    await service.sendVerificationEmail('a@b.com', 'tok');

    expect(lastLogLine()).toBe('VERIFY|a@b.com|http://localhost:3010/verify-email?token=tok');
  });

  it('codifica el token con encodeURIComponent en la URL', async () => {
    const service = new EmailService(
      buildConfig({
        APP_BASE_URL: 'http://localhost:3010',
        DEV_EMAIL_LOG: logFile,
      }),
    );

    await service.sendVerificationEmail('a@b.com', 'abc+def/x y');

    expect(lastLogLine()).toBe(
      'VERIFY|a@b.com|http://localhost:3010/verify-email?token=abc%2Bdef%2Fx%20y',
    );
  });

  it('no loguea enlaces en producción (SMTP configurado)', async () => {
    const service = new EmailService(
      buildConfig({
        APP_BASE_URL: 'https://app.inventariopro.com',
        // Host local con puerto cerrado: el envío falla al instante
        // (ECONNREFUSED) y el catch interno del servicio lo absorbe.
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1',
        SMTP_USER: 'noreply@example.com',
        SMTP_PASSWORD: 'secret',
        DEV_EMAIL_LOG: logFile,
      }),
    );

    await service.sendVerificationEmail('a@b.com', 'tok');

    // En prod el enlace va por SMTP real: DEV_EMAIL_LOG debe quedar vacío.
    expect(() => readFileSync(logFile, 'utf8')).toThrow();
  });
});
