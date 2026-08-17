#!/usr/bin/env node
// =============================================================================
// load-test.js — prueba de carga LOCAL del backend (sin API key, sin VPS, sin
// llamadas externas). Arranca el backend COMPILADO contra una COPIA descartable
// de una BD SQLite y mide la latencia de los endpoints reales:
//
//   Fase 1  warmup:    registrar + verificar email (link del log) + login.
//   Fase 2  crear:     N productos (POST /api/products) — mide p50/p95.
//   Fase 3  listar:    GET /api/products + filtros warranty_status.
//   Fase 4  mixta:     M workers en paralelo creando + listando (concurrencia).
//
// Reporta totales, fallos y percentiles por consola Y en un JSON configurable.
// Exit code != 0 si hubo fallos (el CI lo usa con continue-on-error: el job
// falla/inestable pero no bloquea el workflow).
//
// Uso:
//   npm run test:load                                  # dev.db de desarrollo
//   npm run test:load -- --source-db /ruta/base.db     # BD SQLite creada aparte
//   npm run test:load -- --iters 200 --concurrency 10 --port 3007 \
//       --report load-test-results.json
//
// El script regenera el cliente Prisma para SQLite y recompila (igual que
// scripts/start.sh --sqlite) y, al salir (pase o falle, incluso con Ctrl+C o
// un fallo temprano), restaura backend/src/generated a su estado commiteado —
// solo si ya estaba limpio al arrancar, para no pisar cambios del usuario.
// La BD de origen NUNCA se modifica: se copia a un archivo temporal.
// =============================================================================

'use strict';

const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
// El proyecto entero usa bash (Git Bash en Windows); los shims de npm no se
// spawnan directo con execFileSync, así que se invoca todo vía bash -c.
const BASH = 'bash';

// --- Args ----------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const ITERS = Number(arg('--iters', process.env.LOAD_TEST_ITERS ?? '50'));
const CONCURRENCY = Number(arg('--concurrency', process.env.LOAD_TEST_CONCURRENCY ?? '5'));
const PORT = Number(arg('--port', process.env.LOAD_TEST_PORT ?? '3007'));
const SOURCE_DB =
  arg('--source-db', process.env.LOAD_TEST_SOURCE_DB) ||
  path.join(BACKEND, 'prisma', 'dev.db');
const REPORT_PATH =
  arg('--report', process.env.LOAD_TEST_REPORT) || path.join(ROOT, 'load-test-results.json');

const API = `http://127.0.0.1:${PORT}/api`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// --- Cleanup temprano: se registra ANTES de cualquier operación que pueda
// fallar (prisma generate, chequeo de la BD origen, build, BD temporal,
// arranque del backend, requests con errores). Pase o falle — incluso con
// Ctrl+C o un fallo temprano — el árbol vuelve a su estado y no queda nada.
let child = null;
let TMP = null;

// El cliente Prisma commiteado es de provider postgres; el generate para
// SQLite deja ruido en src/generated (una línea en blanco por archivo). Se
// registra el estado PREVIO y se restaura solo si ya estaba limpio: nunca se
// pisan cambios preexistentes del usuario.
const generatedStatus = execFileSync(BASH, ['-lc', 'git status --short -- src/generated'], {
  cwd: BACKEND,
  encoding: 'utf8',
}).trim();
const generatedWasClean = generatedStatus === '';

function restoreGenerated() {
  if (!generatedWasClean) return;
  try {
    execFileSync(BASH, ['-lc', 'git checkout -- src/generated'], { cwd: BACKEND, stdio: 'pipe' });
  } catch {
    console.warn(
      '[load-test] AVISO: no pude restaurar src/generated a su estado commiteado. Corré: cd backend && git checkout -- src/generated',
    );
  }
}

function cleanup() {
  if (child) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* noop */
    }
  }
  if (TMP) {
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
  restoreGenerated();
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  writeReport({ error: 'Proceso interrumpido (SIGINT)' });
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  writeReport({ error: 'Proceso interrumpido (SIGTERM)' });
  cleanup();
  process.exit(143);
});

// Fases completadas: el reporte parcial (si algo falla a mitad de camino)
// conserva las métricas que ya se midieron.
const opStats = [];

function commitSha() {
  try {
    return execFileSync(BASH, ['-lc', 'git rev-parse HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'desconocido';
  }
}

/** Escribe el reporte JSON (también en fallos: generate, build, BD ausente, arranque, interrupción). */
function writeReport(extra = {}) {
  const ok = opStats.reduce((a, m) => a + m.ok, 0);
  const bad = opStats.reduce((a, m) => a + m.failures, 0);
  const report = {
    status: 'failed',
    iterations: ITERS,
    concurrency: CONCURRENCY,
    successes: ok,
    failures: bad,
    successRate: ok + bad > 0 ? Number(((ok / (ok + bad)) * 100).toFixed(2)) : 0,
    operations: opStats,
    commitSha: commitSha(),
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
    ...extra,
  };
  try {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
    console.log(`[load-test] reporte: ${REPORT_PATH}`);
  } catch (err) {
    console.warn(`[load-test] AVISO: no pude escribir el reporte ${REPORT_PATH}: ${err && err.message ? err.message : err}`);
  }
}

function fail(msg) {
  console.error(`[load-test] ERROR: ${msg}`);
  writeReport({ error: msg });
  process.exit(1);
}

// --- 1) Regenerar el cliente Prisma para SQLite y compilar ------------------
console.log('[load-test] regenerando el cliente Prisma para SQLite (se restaura al salir)…');
execFileSync(BASH, ['-lc', 'DB_PROVIDER=sqlite npx prisma generate'], {
  cwd: BACKEND,
  env: process.env,
  stdio: 'pipe',
});
console.log('[load-test] compilando backend con el cliente SQLite (npm run build)…');
execFileSync(BASH, ['-lc', 'npm run build'], { cwd: BACKEND, stdio: 'inherit' });

// --- 2) BD SQLite descartable: copia de la fuente (nunca se modifica la de
// origen; en CI se crea con las migraciones y se pasa con --source-db) -------
if (!fs.existsSync(SOURCE_DB)) {
  fail(
    `la BD de origen no existe: ${SOURCE_DB}. Usá --source-db / LOAD_TEST_SOURCE_DB, o levantá la app una vez en modo SQLite para generar backend/prisma/dev.db.`,
  );
}
TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inventariopro-load-'));
const DB_PATH = path.join(TMP, 'load-test.db');
const UPLOADS_DIR = path.join(TMP, 'uploads');
fs.copyFileSync(SOURCE_DB, DB_PATH);
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- 3) Arrancar el backend compilado --------------------------------------
const env = {
  ...process.env,
  PORT: String(PORT),
  DB_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${DB_PATH}`,
  LOCAL_UPLOAD_DIR: UPLOADS_DIR,
  NODE_ENV: 'test',
  APP_BASE_URL: `http://127.0.0.1:${PORT}`,
  JWT_ACCESS_SECRET: 'load-test-access-secret-32chars-min',
  JWT_REFRESH_SECRET: 'load-test-refresh-secret-32chars-min',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  REDIS_HOST: '', // Redis opcional: no-op (rate limiting en memoria)
  DEEPSEEK_API_KEY: '', // sin clave: el chat queda en fallback (no se ejercita)
};

child = spawn(process.execPath, ['dist/main.js'], {
  cwd: BACKEND,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
child.stdout.on('data', (d) => (bootLog += d));
child.stderr.on('data', (d) => (bootLog += d));

// --- 4) Esperar readiness ---------------------------------------------------
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return;
    } catch {
      /* aún arrancando */
    }
    await sleep(500);
  }
  fail(`el backend no quedó listo en 30s.\n${bootLog.slice(-2000)}`);
}

// --- Helpers HTTP con cookie httpOnly (como el navegador) -------------------
function setCookieHeader(res) {
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

async function api(method, urlPath, { body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const start = now();
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = now() - start;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* sin body JSON */
  }
  return { status: res.status, ms, data, setCookie: setCookieHeader(res) };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function metrics(name, timings, failures) {
  const sorted = [...timings].sort((a, b) => a - b);
  const total = sorted.length;
  const avg = total ? sorted.reduce((a, b) => a + b, 0) / total : 0;
  return {
    operation: name,
    ok: total,
    failures,
    p50Ms: Number(percentile(sorted, 50).toFixed(1)),
    p95Ms: Number(percentile(sorted, 95).toFixed(1)),
    avgMs: Number(avg.toFixed(1)),
  };
}

// --- 5) Fases ---------------------------------------------------------------
async function main() {
  console.log(
    `[load-test] backend compilado en ${PORT} (SQLite descartable, ${ITERS} iters, ${CONCURRENCY} workers)`,
  );
  await waitReady();
  console.log('[load-test] backend listo. Registrando usuario…');

  // Warmup: register + verify (link del log) + login
  const email = `load.${Date.now()}@example.com`;
  const password = 'LoadTest!2026';
  const reg = await api('POST', '/auth/register', {
    body: { email, password, nombre: 'Load Test' },
  });
  if (reg.status >= 400) fail(`register falló: ${reg.status} ${JSON.stringify(reg.data)}`);

  // El email va en modo consola (SMTP vacío): el link de verificación aparece
  // en los logs del backend. Se verifica la cuenta de verdad (flujo real).
  await sleep(500);
  const m = bootLog.match(/verify-email\?token=([^&"\s']+)/);
  if (!m) fail('no se encontró el link de verificación en los logs del backend');
  const verify = await api('POST', '/auth/verify-email', { body: { token: decodeURIComponent(m[1]) } });
  if (verify.status >= 400) fail(`verify-email falló: ${verify.status} ${JSON.stringify(verify.data)}`);

  const login = await api('POST', '/auth/login', { body: { email, password } });
  if (login.status !== 201 && login.status !== 200) {
    fail(`login falló: ${login.status} ${JSON.stringify(login.data)}`);
  }
  const cookie = login.setCookie;
  if (!cookie) fail('login no devolvió cookie de sesión');

  // Fase 2: crear productos
  console.log('[load-test] creando productos…');
  const createTimes = [];
  let createFails = 0;
  for (let i = 0; i < ITERS; i++) {
    const res = await api('POST', '/products', {
      cookie,
      body: {
        nombre: `Producto de carga ${i}`,
        marca: 'LoadTest',
        fecha_compra: '2026-08-15',
        tipo_compra: 'FISICO',
        precio: 99.99 + i,
        duracion_garantia_meses: i % 3 === 0 ? 0 : 12,
      },
    });
    if (res.status >= 400) createFails++;
    else createTimes.push(res.ms);
  }

  // Fase 3: listar (paginado + filtros)
  console.log('[load-test] listando productos…');
  const listTimes = [];
  let listFails = 0;
  for (let i = 0; i < Math.max(10, Math.floor(ITERS / 5)); i++) {
    const res = await api('GET', '/products?per_page=100&sort_by=fecha_compra&sort_order=desc', {
      cookie,
    });
    if (res.status >= 400) listFails++;
    else listTimes.push(res.ms);

    const filtro = await api('GET', '/products?warranty_status=vigente&per_page=50', { cookie });
    if (filtro.status >= 400) listFails++;
    else listTimes.push(filtro.ms);
  }

  // Fase 4: mixta concurrente (crear + listar)
  console.log('[load-test] carga mixta concurrente…');
  const mixTimes = [];
  let mixFails = 0;
  const perWorker = Math.max(1, Math.floor(ITERS / CONCURRENCY));
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (let i = 0; i < perWorker; i++) {
      const r = Math.random();
      const res =
        r < 0.6
          ? await api('POST', '/products', {
              cookie,
              body: {
                nombre: `Mixto ${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
                fecha_compra: '2026-08-15',
                tipo_compra: 'ONLINE',
                precio: Math.round((10 + Math.random() * 500) * 100) / 100,
              },
            })
          : await api('GET', '/products?per_page=50', { cookie });
      if (res.status >= 400) {
        mixFails++;
        if (mixFails <= 3) console.error(`[load-test] fallo mixto: ${res.status} ${JSON.stringify(res.data)}`);
      } else mixTimes.push(res.ms);
    }
  });
  await Promise.all(workers);

  // Resumen
  opStats.push(metrics('crear_producto', createTimes, createFails));
  opStats.push(metrics('listar_y_filtros', listTimes, listFails));
  opStats.push(metrics('mixta_concurrente', mixTimes, mixFails));
  console.log('\n[load-test] resumen:');
  for (const m of opStats) {
    console.log(
      `  ${m.operation.padEnd(20)} n=${String(m.ok).padStart(5)}  p50=${String(m.p50Ms).padStart(6)}ms  ` +
        `p95=${String(m.p95Ms).padStart(6)}ms  avg=${String(m.avgMs).padStart(6)}ms  fallos=${m.failures}`,
    );
  }

  const totalFails = opStats.reduce((a, m) => a + m.failures, 0);
  const totalOk = opStats.reduce((a, m) => a + m.ok, 0);
  console.log(`\n[load-test] OK=${totalOk} fallos=${totalFails}  tasa éxito=${((totalOk / (totalOk + totalFails)) * 100).toFixed(2)}%`);

  writeReport({ status: totalFails > 0 ? 'failed' : 'ok' });
  process.exit(totalFails > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[load-test] fallo inesperado:', err);
  writeReport({ error: err && err.message ? err.message : String(err) });
  process.exit(1);
});
