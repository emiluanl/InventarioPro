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

// El transporte de Nodemailer se mockea para que NINGÚN test toque la red:
// antes, el caso "producción" usaba localhost:1 (puerto cerrado) esperando un
// ECONNREFUSED inmediato, pero el SMTP puede colgarse y superar el timeout de
// Jest (flaky). El mock hace el test determinista: en modo dev sendMail
// resuelve; en modo SMTP rechaza, y la aserción es que prod NUNCA loguea.
const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

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
    // Modo dev: sendMail resuelve (streamTransport simulado); cada test que
    // quiera un fallo lo overridea con mockRejectedValueOnce.
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue({ message: 'mock message' });
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
    // Simula un SMTP que falla (sin red real): el servicio lo absorbe y lo
    // registra como error, pero JAMÁS escribe el enlace en DEV_EMAIL_LOG.
    mockSendMail.mockRejectedValueOnce(new Error('SMTP rechazó la conexión'));
    const service = new EmailService(
      buildConfig({
        APP_BASE_URL: 'https://app.inventariopro.com',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'noreply@example.com',
        SMTP_PASSWORD: 'secret',
        DEV_EMAIL_LOG: logFile,
      }),
    );

    await service.sendVerificationEmail('a@b.com', 'tok');

    // En prod el enlace va por SMTP real: DEV_EMAIL_LOG debe quedar vacío.
    expect(() => readFileSync(logFile, 'utf8')).toThrow();
    // Y sí se intentó enviar por SMTP (el mock rechazó, el servicio absorbió).
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});
