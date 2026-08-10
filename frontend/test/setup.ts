// =============================================================================
// Setup de Vitest
// =============================================================================
// - Registra los matchers de jest-dom (toBeInTheDocument, ...) sobre Vitest.
// - Limpia el DOM tras cada test: con `globals: false`, Testing Library no
//   puede registrar su afterEach automático, así que lo hacemos aquí.
//   Sin esto, los renders se acumulan y los tests ven "multiple elements".
// =============================================================================

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
