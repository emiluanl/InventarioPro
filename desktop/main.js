// =============================================================================
// InventarioPro Desktop - proceso principal de Electron
// =============================================================================
// Arranca el stack local embebido SIN terminal ni Docker:
//   1. Aplica las migraciones SQLite (CLI de Prisma empaquetado, idempotente).
//   2. Lanza el backend (NestJS, dist/main.js) como proceso Node hijo contra
//      una BD SQLite en userData (ELECTRON_RUN_AS_NODE = Node puro).
//   3. Lanza el frontend (Next.js standalone, server.js) como proceso hijo.
//   4. Abre la ventana apuntando a http://localhost:3010.
// Al salir mata los dos procesos (taskkill /T en Windows) y conserva los datos
// (dev.db + uploads) en userData para la próxima ejecución.
//
// Modo headless para pruebas/CI (no abre ventana):
//   INVENTARIOPRO_HEADLESS=1 node_modules/.bin/electron .
//   + INVENTARIOPRO_EXIT_AFTER_READY=1 para salir al estar listo.
// =============================================================================

const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const net = require('node:net');

const BACKEND_PORT = 3001;
const FRONTEND_PORT = 3010;
const APP_URL = `http://localhost:${FRONTEND_PORT}`;

// En desarrollo (npm start dentro de desktop/) usa resources/ local; empaquetado
// usa resources/stack al lado del ejecutable (extraResources de electron-builder).
const STACK_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'stack')
  : path.join(__dirname, 'resources');

const nodeBin = process.execPath; // electron.exe; con ELECTRON_RUN_AS_NODE=1 actúa como Node

let backendProc = null;
let frontendProc = null;
let mainWindow = null;
let quitting = false;

// Log dual: consola + archivo en userData/logs/desktop.log (las apps GUI de
// Windows no tienen stdout visible; el archivo es la única traza del usuario).
let logFile = null;
function setupLogFile() {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    logFile = path.join(logsDir, 'desktop.log');
  } catch { /* sin log de archivo */ }
}
function log(...args) {
  const line = `[desktop ${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  if (logFile) {
    try { fs.appendFileSync(logFile, line + '\n'); } catch { /* sin log */ }
  }
}

// =============================================================================
// Utilidades
// =============================================================================
function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForUrl(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      /* aún no responde */
    }
    await sleep(1200);
  }
  log(`timeout esperando a ${label} (${url})`);
  return false;
}

function spawnStackProc(scriptRel, cwdRel, extraEnv) {
  const script = path.join(STACK_DIR, scriptRel);
  const cwd = path.join(STACK_DIR, cwdRel);
  const proc = spawn(nodeBin, [script], {
    cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const prefix = cwdRel.replace(/[/\\]/g, '-');
  // La salida de los hijos (logs del backend/frontend) va a stdout Y al
  // archivo de log: en Windows una GUI no tiene stdout visible, y sin esto el
  // usuario no tendría forma de ver por qué falló un servicio interno. También
  // es lo que hace verificable el smoke test headless en CI.
  const tee = (stream, tag) => (d) => {
    stream.write(`[${prefix}] ${d}`);
    if (logFile) {
      try { fs.appendFileSync(logFile, `[${prefix}] ${d}`); } catch { /* sin log */ }
    }
  };
  proc.stdout.on('data', tee(process.stdout, 'out'));
  proc.stderr.on('data', tee(process.stderr, 'err'));
  proc.on('error', (err) => {
    log(`ERROR al lanzar ${cwdRel}: ${err.message}`);
  });
  proc.on('exit', (code, signal) => {
    if (!quitting) {
      log(`${cwdRel} terminó inesperadamente (code=${code}, signal=${signal})`);
      fatal(`El servicio interno "${cwdRel}" se detuvo (code=${code}).`);
    }
  });
  return proc;
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode === 'SIGTERM') return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 3000).unref();
    }
  } catch (err) {
    log('error matando proceso:', err.message);
  }
}

function fatal(message) {
  log('FALLO:', message);
  if (!process.env.INVENTARIOPRO_HEADLESS) {
    dialog.showErrorBox('InventarioPro', message);
  }
  quitting = true;
  killTree(backendProc);
  killTree(frontendProc);
  app.quit();
}

// =============================================================================
// Arranque del stack
// =============================================================================
async function ensureUserData() {
  const dataDir = app.getPath('userData');
  log('userData:', dataDir); // diagnóstico: dónde viven dev.db, uploads y logs
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });

  // Secretos JWT persistentes (se generan una vez; no viajan en el instalador).
  const secretsFile = path.join(dataDir, 'secrets.json');
  let jwtSecret;
  try {
    jwtSecret = JSON.parse(fs.readFileSync(secretsFile, 'utf8')).jwt_access_secret;
  } catch {
    jwtSecret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretsFile, JSON.stringify({ jwt_access_secret: jwtSecret }, null, 2));
  }
  return { dataDir, jwtSecret };
}

async function runMigrations(dataDir) {
  const cli = path.join(STACK_DIR, 'backend', 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(cli)) {
    throw new Error(`CLI de Prisma no encontrado en el stack: ${cli}`);
  }
  const dbFile = path.join(dataDir, 'dev.db');
  const dbUrl = 'file:' + dbFile.split(path.sep).join('/');
  log('aplicando migraciones SQLite…');
  await new Promise((resolve, reject) => {
    const p = spawn(
      nodeBin,
      [cli, 'migrate', 'deploy'],
      {
        cwd: path.join(STACK_DIR, 'backend'),
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          DB_PROVIDER: 'sqlite',
          DATABASE_URL: dbUrl,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let out = '';
    const tee = (stream, tag) => (d) => {
      out += d;
      stream.write(`[prisma] ${d}`);
      if (logFile) {
        try { fs.appendFileSync(logFile, `[prisma] ${d}`); } catch { /* sin log */ }
      }
    };
    p.stdout.on('data', tee(process.stdout, 'out'));
    p.stderr.on('data', tee(process.stderr, 'err'));
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`migrate deploy falló (code=${code}): ${out.slice(-500)}`))));
  });
  return dbUrl;
}

async function startStack() {
  const { dataDir, jwtSecret } = await ensureUserData();
  const dbUrl = await runMigrations(dataDir);
  const uploadsDir = path.join(dataDir, 'uploads');

  // Puertos libres (la app usa puertos fijos como el arranque local).
  if ((await portInUse(BACKEND_PORT)) || (await portInUse(FRONTEND_PORT))) {
    throw new Error(
      `Los puertos ${BACKEND_PORT}/${FRONTEND_PORT} ya están en uso. ` +
        'Cierra la otra instancia de InventarioPro (o el npm start de desarrollo) y vuelve a abrir la app.',
    );
  }

  const commonEnv = {
    NODE_ENV: 'production',
    DB_PROVIDER: 'sqlite',
    DATABASE_URL: dbUrl,
    REDIS_HOST: '', // sin Redis: modo no-op (rate limiting en memoria)
  };

  backendProc = spawnStackProc('backend/dist/main.js', 'backend', {
    ...commonEnv,
    PORT: String(BACKEND_PORT),
    API_PREFIX: 'api',
    CORS_ORIGIN: `http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}`,
    APP_BASE_URL: APP_URL,
    STORAGE_PROVIDER: 'local',
    LOCAL_UPLOAD_DIR: uploadsDir,
    JWT_ACCESS_SECRET: jwtSecret,
    SMTP_HOST: '', // email en modo consola: el enlace de verificación sale en los logs
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  });

  frontendProc = spawnStackProc('frontend/server.js', 'frontend', {
    NODE_ENV: 'production',
    PORT: String(FRONTEND_PORT),
    HOSTNAME: '127.0.0.1',
    NEXT_TELEMETRY_DISABLED: '1',
  });

  const [backendOk, frontendOk] = await Promise.all([
    waitForUrl(`http://127.0.0.1:${BACKEND_PORT}/api/health`, 60_000, 'backend'),
    waitForUrl(`http://127.0.0.1:${FRONTEND_PORT}`, 60_000, 'frontend'),
  ]);
  if (!backendOk || !frontendOk) {
    throw new Error('El stack no arrancó a tiempo. Revisa los logs en la carpeta de datos de la app.');
  }
  return { dataDir, dbUrl };
}

// =============================================================================
// Ventana
// =============================================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    if (!mainWindow) return;
    fatal(`La web no pudo cargar (${code}: ${desc}).`);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(APP_URL);
}

// =============================================================================
// Ciclo de vida de Electron
// =============================================================================
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    setupLogFile();
    try {
      const info = await startStack();
      log('stack listo:', info.dbUrl);

      if (process.env.INVENTARIOPRO_HEADLESS === '1') {
        log('STACK_READY');
        if (process.env.INVENTARIOPRO_EXIT_AFTER_READY === '1') {
          setTimeout(() => app.quit(), 500);
        }
        return;
      }
      createWindow();
    } catch (err) {
      fatal(`No se pudo arrancar InventarioPro:\n\n${err.message}`);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    killTree(backendProc);
    killTree(frontendProc);
  });
}
