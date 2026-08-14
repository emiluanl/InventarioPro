// =============================================================================
// Arranque del frontend para los tests e2e.
// =============================================================================
// El webServer de Playwright ejecuta este script ANTES de esperar a que la URL
// responda:
//   1. Backup de next-env.d.ts y tsconfig.json.
//   2. npm run build con NEXT_DIST_DIR=.next-e2e (build aislado, no pisa el
//      .next del dev server local).
//   3. Restaura los dos archivos (next build ya los reescribió).
//   4. next start en primer plano (Playwright mata el árbol con SIGTERM).
//
// Por qué el restore en dos momentos: tanto `next build` como `next start`
// reescriben next-env.d.ts y tsconfig.json cuando NEXT_DIST_DIR != '.next'
// (apuntan los tipos a .next-e2e). Sin restaurar, cada corrida local ensucia
// el working tree con cambios que no representan el estado real del proyecto.
// El restore final ocurre en la señal de terminación (SIGTERM/SIGINT/exit),
// cubriendo también la reescritura de `next start`.
// =============================================================================

const { spawn, execSync } = require('node:child_process');
const { copyFileSync, mkdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');

// El backup NO puede vivir dentro de .next-e2e: next build borra el directorio
// de destino al empezar y destruiría la copia antes del restore. e2e/.tmp ya
// está en .gitignore.
const frontendDir = join(__dirname, '..', 'frontend');
const tmpDir = join(__dirname, '.tmp', 'config-backup');

// Archivos que `next build`/`next start` reescriben con NEXT_DIST_DIR != '.'.
const CONFIG_FILES = ['next-env.d.ts', 'tsconfig.json'];

function run(cmd, extraEnv) {
  execSync(cmd, {
    cwd: frontendDir,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
}

function backupConfigs() {
  mkdirSync(tmpDir, { recursive: true });
  for (const file of CONFIG_FILES) {
    const src = join(frontendDir, file);
    if (existsSync(src)) {
      copyFileSync(src, join(tmpDir, file));
    }
  }
}

function restoreConfigs() {
  for (const file of CONFIG_FILES) {
    const bak = join(tmpDir, file);
    if (existsSync(bak)) {
      copyFileSync(bak, join(frontendDir, file));
      console.log(`[e2e] ${file} restaurado`);
    }
  }
}

// 1. Backup
backupConfigs();
console.log('[e2e] backup de next-env.d.ts y tsconfig.json');

// 2. Build aislado + restore inmediato (por si next start no los reescribe).
try {
  run('npm run build', { NEXT_DIST_DIR: '.next-e2e' });
} finally {
  restoreConfigs();
}

// 3. Servir en primer plano; al terminar (cualquier señal) se restaura de nuevo.
const port = process.env.E2E_FRONTEND_PORT ?? '3102';
console.log(`[e2e] Frontend listo, sirviendo en :${port}…`);

const server = spawn('npx next start -p ' + port, {
  cwd: frontendDir,
  stdio: 'inherit',
  shell: true, // Windows: npx es un .cmd, no se puede spawn sin shell.
  env: { ...process.env, NEXT_DIST_DIR: '.next-e2e' },
});

const cleanup = () => {
  restoreConfigs();
  process.exit(0);
};
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('exit', restoreConfigs);

server.on('exit', (code) => {
  restoreConfigs();
  process.exit(code ?? 0);
});
