// =============================================================================
// desktop/lib/startup.js — utilidades de arranque del stack (sin Electron).
// =============================================================================
// Lógica extraída de main.js para poder probarla con node:test: espera de
// servicios HTTP con presupuesto de tiempo configurable, logs de progreso y
// matado de árboles de procesos con verificación de puertos libres.
//
// Presupuesto total de arranque por defecto: 180 s (migraciones SQLite del
// primer arranque en frío pueden tardar >60 s en máquinas lentas/AV activo).
// Se configura con APP_STARTUP_TIMEOUT_MS en main.js.
// =============================================================================

'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');

const DEFAULT_STARTUP_TIMEOUT_MS = 180000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect(port, host);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(1500, () => { s.destroy(); resolve(false); });
  });
}

async function probeUrl(url, requestTimeoutMs = 2000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

// Espera a que una URL responda OK dentro de `timeoutMs` (presupuesto), con
// logs de progreso. Retorna true/false. NUNCA espera más del presupuesto.
async function waitForUrl(url, { timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS, pollMs = 1200, log = () => {}, label = url } = {}) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    if (await probeUrl(url)) {
      const elapsed = Date.now() - (deadline - timeoutMs);
      log(`${label} listo (${Math.round(elapsed / 1000)}s)`);
      return true;
    }
    attempts += 1;
    if (attempts % 4 === 0) {
      const elapsed = Date.now() - (deadline - timeoutMs);
      const budget = Math.round(timeoutMs / 1000);
      log(`${label}: aún no responde (${Math.round(elapsed / 1000)}s de ${budget}s)`);
    }
    await sleep(pollMs);
  }
  log(`timeout esperando a ${label} (${Math.round(timeoutMs / 1000)}s)`);
  return false;
}

// Espera a que TODOS los servicios estén OK dentro de un presupuesto común.
// Retorna la lista de etiquetas que no llegaron a estar listas.
async function waitForServices(services, { timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS, pollMs = 1200, log = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  const pending = new Map(services.map((s) => [s.label, s.url]));
  while (pending.size > 0 && Date.now() < deadline) {
    for (const [label, url] of [...pending]) {
      if (await probeUrl(url, 1500)) {
        pending.delete(label);
        log(`${label} listo`);
      }
    }
    if (pending.size > 0) {
      const elapsed = Date.now() - (deadline - timeoutMs);
      const budget = Math.round(timeoutMs / 1000);
      log(`pendientes: ${[...pending.keys()].join(', ')} (${Math.round(elapsed / 1000)}s de ${budget}s)`);
      await sleep(pollMs);
    }
  }
  const missing = [...pending.keys()];
  if (missing.length > 0) {
    log(`presupuesto agotado sin: ${missing.join(', ')}`);
  }
  return missing;
}

// Corre una promesa con un presupuesto de tiempo; si expira, rechaza con un
// error claro. Se usa para que las migraciones SQLite no esperen para siempre.
async function withDeadline(promise, timeoutMs, label, log = () => {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} no terminó dentro del presupuesto (${Math.round(timeoutMs / 1000)}s)`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Mata un árbol de procesos (taskkill /T /F en Windows) y espera a que el
// proceso haya salido. Retorna true si se pudo matar (o ya estaba muerto).
async function killTree(proc, { log = () => {} } = {}) {
  if (!proc || proc.pid == null) return true;
  if (proc.exitCode !== null || proc.signalCode != null) return true; // ya salió
  const pid = proc.pid;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('exit', resolve);
      killer.once('error', () => resolve());
    });
  } else {
    proc.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => proc.once('exit', resolve)),
      sleep(3000).then(() => { try { proc.kill('SIGKILL'); } catch { /* ya murió */ } }),
    ]);
  }
  // Gracia: el SO debe liberar el pid antes de considerar el cleanup completo.
  await sleep(400);
  return true;
}

// Espera a que NINGUNO de los puertos esté ocupado (verificación post-cleanup).
async function waitPortsFree(ports, { timeoutMs = 15000, log = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const busy = [];
    for (const p of ports) {
      if (await portInUse(p)) busy.push(p);
    }
    if (busy.length === 0) return true;
    await sleep(400);
  }
  log(`ADVERTENCIA: puertos siguen ocupados tras cleanup: ${busy.join(', ')}`);
  return false;
}

module.exports = {
  DEFAULT_STARTUP_TIMEOUT_MS,
  portInUse,
  probeUrl,
  waitForUrl,
  waitForServices,
  withDeadline,
  killTree,
  waitPortsFree,
};
