// =============================================================================
// Pruebas de desktop/lib/startup.js (node:test, sin Electron).
//   npm test            → node --test
// =============================================================================
// Cubren los escenarios del P1.2:
//   1. backend listo antes del timeout;
//   2. backend lento pero válido;
//   3. timeout real (no espera infinita);
//   4. cleanup después del timeout (procesos muertos + puertos libres);
//   5. segundo arranque sin huérfanos (los puertos quedan libres);
//   6/7. withDeadline (timeout claro / resolución a tiempo).
// =============================================================================

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const {
  portInUse,
  waitForUrl,
  waitForServices,
  killTree,
  waitPortsFree,
  withDeadline,
} = require('../lib/startup');

const noop = () => {};

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

// Server con Connection: close para que fetch no deje sockets keep-alive
// abiertos (si no, node --test no termina al esperar el drenado del loop).
function startServer(handler) {
  const srv = http.createServer((req, res) => {
    res.setHeader('Connection', 'close');
    handler(req, res);
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

function closeServer(srv) {
  return new Promise((resolve) => {
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    srv.close(() => resolve());
  });
}

// Lanza un hijo Node que abre un servidor HTTP en `port` y queda vivo.
function spawnListener(port) {
  const script = `
    const http = require('node:http');
    const srv = http.createServer((q, s) => { s.setHeader('Connection','close'); s.end('ok'); });
    srv.on('error', (e) => { console.error('LISTEN_ERROR', e.code); process.exit(3); });
    srv.listen(${port}, '127.0.0.1', () => console.log('LISTENING'));
    setInterval(() => {}, 1000);
  `;
  return spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
}

async function waitPortBusy(port, timeoutMs = 5000) {
  const t0 = Date.now();
  while (!(await portInUse(port)) && Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 200));
  }
  return portInUse(port);
}

test('1. servicio listo antes del timeout → ok rápido', async () => {
  const { srv, port } = await startServer((_req, res) => res.end('ok'));
  const t0 = Date.now();
  const ok = await waitForUrl(`http://127.0.0.1:${port}/`, { timeoutMs: 5000, log: noop });
  assert.equal(ok, true);
  assert.ok(Date.now() - t0 < 3000, 'resuelve sin esperar el presupuesto');
  await closeServer(srv);
});

test('2. backend lento pero válido → ok antes del timeout', async () => {
  let hit = false;
  const { srv, port } = await startServer((_req, res) => {
    if (!hit) {
      hit = true;
      setTimeout(() => res.end('ok'), 1200);
    } else {
      res.end('ok');
    }
  });
  const t0 = Date.now();
  const ok = await waitForUrl(`http://127.0.0.1:${port}/`, { timeoutMs: 8000, log: noop });
  assert.equal(ok, true);
  assert.ok(Date.now() - t0 >= 1000, 'espera al servicio lento');
  assert.ok(Date.now() - t0 < 8000, 'dentro del presupuesto');
  await closeServer(srv);
});

test('3. timeout real → false y NO espera infinita', async () => {
  const port = await freePort(); // nada escucha ahí
  const t0 = Date.now();
  const ok = await waitForUrl(`http://127.0.0.1:${port}/`, { timeoutMs: 2000, log: noop });
  const elapsed = Date.now() - t0;
  assert.equal(ok, false);
  assert.ok(elapsed >= 1900, `respeta el presupuesto (${elapsed}ms)`);
  assert.ok(elapsed < 5000, 'no se desborda');
});

test('4a. waitForServices devuelve los pendientes al agotar el presupuesto', async () => {
  const { srv, port } = await startServer((_req, res) => res.end('ok'));
  const free = await freePort();
  const missing = await waitForServices(
    [
      { label: 'frontend', url: `http://127.0.0.1:${port}/` },
      { label: 'backend', url: `http://127.0.0.1:${free}/health` },
    ],
    { timeoutMs: 2500, log: noop },
  );
  assert.deepEqual(missing, ['backend']);
  await closeServer(srv);
});

test('4b. cleanup tras timeout: killTree mata el árbol y el puerto queda libre', async () => {
  const port = await freePort();
  const child = spawnListener(port);
  assert.equal(await waitPortBusy(port), true, 'el hijo debe estar escuchando');
  await killTree(child, { log: noop });
  const free = await waitPortsFree([port], { timeoutMs: 8000, log: noop });
  assert.equal(free, true, 'tras cleanup el puerto debe quedar libre');
  assert.equal(await portInUse(port), false);
});

test('5. segundo arranque sin huérfanos: puertos libres tras cerrar la instancia previa', async () => {
  const port = await freePort();
  const child = spawnListener(port);
  assert.equal(await waitPortBusy(port), true);
  await killTree(child, { log: noop });
  // "Segundo arranque": el check de puertos libres no debe encontrar nada.
  assert.equal(await portInUse(port), false, 'puerto libre para el segundo arranque');
});

test('6. withDeadline: rechaza con error claro si la promesa no termina', async () => {
  await assert.rejects(
    withDeadline(new Promise(() => {}), 500, 'Migraciones SQLite', noop),
    /Migraciones SQLite no terminó dentro del presupuesto/,
  );
});

test('7. withDeadline: resuelve si la promesa termina a tiempo', async () => {
  const value = await withDeadline(Promise.resolve('ok'), 2000, 'X', noop);
  assert.equal(value, 'ok');
});
