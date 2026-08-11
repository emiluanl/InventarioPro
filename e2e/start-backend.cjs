// =============================================================================
// Arranque del backend para los tests e2e.
// =============================================================================
// El webServer de Playwright ejecuta este script ANTES de esperar a que la URL
// responda, así que aquí va toda la preparación de la BD e2e:
//   1. prisma generate (tolerante: en Windows puede fallar con EPERM si otro
//      proceso —p. ej. el backend dev— mantiene abierto el query engine DLL;
//      el client ya generado es válido si el schema no cambió).
//   2. prisma migrate deploy contra la BD e2e.
//   3. npm run build (compila el código nuevo).
//   4. node dist/main.js (se queda en primer plano; Playwright mata el árbol).
// =============================================================================

const { execSync } = require('node:child_process');
const { join } = require('node:path');

const backendDir = join(__dirname, '..', 'backend');

function run(cmd, extraEnv) {
  execSync(cmd, {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
}

try {
  run('npx prisma generate');
} catch (err) {
  console.warn(
    '[e2e] prisma generate no pudo reescribir el client (¿lo mantiene abierto otro proceso?).',
  );
  console.warn(`[e2e] ${err.message.split('\n')[0]}`);
  console.warn('[e2e] Se continúa con el client ya generado.');
}

run('npx prisma migrate deploy');
run('npm run build');

console.log('[e2e] Backend listo, arrancando en primer plano…');
execSync('node dist/main.js', {
  cwd: backendDir,
  stdio: 'inherit',
  env: process.env,
});
