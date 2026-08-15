// =============================================================================
// Configuración compartida de los tests e2e
// =============================================================================
// Los servidores e2e usan puertos dedicados (3002/3102) para no chocar con el
// dev server del preview (3100) ni con el backend dev (3001). Se pueden
// sobreescribir con E2E_BACKEND_PORT / E2E_FRONTEND_PORT.
//
// E2E_DATABASE_URL apunta a una BD dedicada (inventariopro_e2e); en CI se pasa
// la BD del servicio postgres de GitHub Actions.
// =============================================================================

import { join } from 'node:path';

export const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 3002);
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 3102);

// Puerto del mock local de DeepSeek (chat con function calling sin API key real).
export const MOCK_AI_PORT = Number(process.env.E2E_MOCK_AI_PORT ?? 3009);

export const API_URL = `http://localhost:${BACKEND_PORT}/api`;
export const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://inventariopro:inventariopro@localhost:5432/inventariopro_e2e?schema=public';

// Archivo donde el backend (modo dev) escribe los enlaces de verificación.
export const EMAIL_LOG = join(__dirname, '.tmp', 'dev-emails.log');

export const ROOT_DIR = join(__dirname, '..');
export const BACKEND_DIR = join(ROOT_DIR, 'backend');
export const FRONTEND_DIR = join(ROOT_DIR, 'frontend');
