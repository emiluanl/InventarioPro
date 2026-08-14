// =============================================================================
// Playwright - InventarioPro
// =============================================================================
// Levanta dos webServers dedicados:
//   - Backend  : puerto 3002, BD e2e dedicada, Redis del entorno.
//   - Frontend : puerto 3102, build aislado en .next-e2e (no pisa el .next del
//                dev server del preview) con NEXT_PUBLIC_API_URL al backend e2e.
// =============================================================================

import { defineConfig, devices } from '@playwright/test';

import {
  API_URL,
  BACKEND_PORT,
  DATABASE_URL,
  EMAIL_LOG,
  FRONTEND_DIR,
  FRONTEND_PORT,
  FRONTEND_URL,
  ROOT_DIR,
} from './e2e/env';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // e2e/start-backend.cjs prepara la BD (prisma generate + migrate deploy)
      // y compila antes de dejar el servidor en primer plano.
      command: 'node e2e/start-backend.cjs',
      cwd: ROOT_DIR,
      url: `${API_URL}/health`,
      // En local (Windows) el nest build en frío + generate + migrate puede
      // superar 180s cuando corre en paralelo con el build del frontend y con
      // Docker activo. En CI (Linux) sobra con 300s.
      timeout: 300_000,
      reuseExistingServer: false,
      env: {
        PORT: String(BACKEND_PORT),
        API_PREFIX: 'api',
        DATABASE_URL,
        REDIS_HOST: 'localhost',
        REDIS_PORT: '6379',
        NODE_ENV: 'test',
        JWT_ACCESS_SECRET: 'e2e-access-secret-32chars-min!!',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
        CORS_ORIGIN: FRONTEND_URL,
        APP_BASE_URL: FRONTEND_URL,
        DEV_EMAIL_LOG: EMAIL_LOG,
        // backend/.env (SMTP_* reales del dev) no debe contaminar el e2e: si
        // SMTP_HOST queda definido, EmailService usa SMTP real y deja de
        // escribir DEV_EMAIL_LOG (los tests no podrían recuperar el token).
        // Forzamos SMTP_HOST vacío para caer en el modo dev (enlaces en log).
        SMTP_HOST: '',
        STORAGE_PROVIDER: 'local',
      },
    },
    {
      command: `npm run build && npx next start -p ${FRONTEND_PORT}`,
      cwd: FRONTEND_DIR,
      url: FRONTEND_URL,
      timeout: 300_000,
      reuseExistingServer: false,
      env: {
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_PUBLIC_API_URL: API_URL,
      },
    },
  ],
});
