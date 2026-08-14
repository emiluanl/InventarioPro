// =============================================================================
// Arranque del backend para los tests e2e.
// =============================================================================
// El webServer de Playwright ejecuta este script ANTES de esperar a que la URL
// responda, así que aquí va toda la preparación de la BD e2e:
//   1. Backup de backend/src/generated (el cliente Prisma generado).
//   2. prisma generate (tolerante: en Windows puede fallar con EPERM si otro
//      proceso —p. ej. el backend dev— mantiene abierto el query engine DLL;
//      el client ya generado es válido si el schema no cambió).
//   3. prisma migrate deploy contra la BD e2e.
//   4. npm run build (compila el código nuevo).
//   5. Restaura backend/src/generated a su estado previo.
//   6. node dist/main.js (se queda en primer plano; Playwright mata el árbol).
//
// Por qué el backup/restore: `prisma generate` reescribe el cliente generado
// (backend/src/generated) y en local puede producir diffs de formato (p. ej.
// una línea en blanco extra) que ensucian el working tree sin representar un
// cambio real del schema. El backup vive en e2e/.tmp (ignorado por git), fuera
// del directorio de salida que Prisma borra/reescribe.
// =============================================================================

const { execSync } = require('node:child_process');
const { cpSync, existsSync, rmSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const backendDir = join(__dirname, '..', 'backend');
const generatedDir = join(backendDir, 'src', 'generated');
const backupDir = join(__dirname, '.tmp', 'generated-backup');

function run(cmd, extraEnv) {
  execSync(cmd, {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
}

function backupGenerated() {
  mkdirSync(backupDir, { recursive: true });
  // Copia recursiva preservando la estructura (sin .git ni node_modules).
  cpSync(generatedDir, join(backupDir, 'generated'), {
    recursive: true,
    force: true,
  });
  console.log('[e2e] backup de backend/src/generated');
}

function restoreGenerated() {
  const bak = join(backupDir, 'generated');
  if (existsSync(bak)) {
    rmSync(generatedDir, { recursive: true, force: true });
    cpSync(bak, generatedDir, { recursive: true, force: true });
    console.log('[e2e] backend/src/generated restaurado');
  }
}

// 1. Backup
backupGenerated();

// 2-4. generate + migrate + build
try {
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
} finally {
  // 5. Restore pase lo que pase (build puede fallar y aun así no ensuciar).
  restoreGenerated();
}

// 6. Servir (primer plano)
console.log('[e2e] Backend listo, arrancando en primer plano…');
execSync('node dist/main.js', {
  cwd: backendDir,
  stdio: 'inherit',
  env: process.env,
});
