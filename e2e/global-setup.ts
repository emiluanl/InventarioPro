// =============================================================================
// globalSetup - corre una vez antes de los tests
// =============================================================================
// Nota: los webServers de Playwright arrancan ANTES que globalSetup, así que
// las migraciones de la BD e2e y el build del backend viven en el comando del
// webServer (e2e/start-backend.cjs). Aquí solo se limpia el log de emails dev
// que los tests leen para obtener el token de verificación.
// =============================================================================

import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { EMAIL_LOG } from './env';

export default function globalSetup(): void {
  rmSync(EMAIL_LOG, { force: true });
  mkdirSync(dirname(EMAIL_LOG), { recursive: true });
}
