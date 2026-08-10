// =============================================================================
// Configuración de Vitest para el frontend
// =============================================================================
// Tests de componentes con Testing Library en entorno jsdom. El alias '@'
// replica el paths de tsconfig.json para que los imports funcionen igual
// que en la app.
// =============================================================================

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    include: [
      'components/**/*.test.{ts,tsx}',
      'hooks/**/*.test.{ts,tsx}',
      'lib/**/*.test.{ts,tsx}',
      'app/**/*.test.{ts,tsx}',
    ],
  },
});
