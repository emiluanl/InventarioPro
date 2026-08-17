// =============================================================================
// Pruebas de desktop/scripts/sign-with-artifact-signing.js (node:test).
// Cubren: detección de modo (AS / PFX / sin credenciales), generación de
// metadata.json, normalización de WIN_CSC_LINK y guardas de herramientas.
// El flujo PFX real contra el certificado local se valida aparte (smoke).
// =============================================================================

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hook = require('../scripts/sign-with-artifact-signing');
const { _internals } = hook;

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('modo: sin credenciales → sign() no firma y no lanza', async () => {
  const tmp = path.join(os.tmpdir(), 'sign-hook-skip-test.exe');
  fs.writeFileSync(tmp, Buffer.from('not-a-real-pe', 'utf8'));
  try {
    await withEnv({ AS_ENDPOINT: '', WIN_CSC_LINK: '' }, () => hook({ path: tmp }));
    // Sin excepción = skip correcto.
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('modo: AS_* definido sin dlib → error claro', async () => {
  const tmp = path.join(os.tmpdir(), 'sign-hook-as-test.exe');
  fs.writeFileSync(tmp, Buffer.from('x', 'utf8'));
  try {
    await assert.rejects(
      withEnv(
        {
          AS_ENDPOINT: 'https://eus.codesigning.azure.net',
          AS_SIGNING_ACCOUNT: 'acct',
          AS_CERT_PROFILE: 'profile',
          AS_DLIB_PATH: 'C:/no-such-dir/Azure.CodeSigning.Dlib.dll',
          SIGNTOOL_PATH: 'C:/no-such-dir/signtool.exe',
        },
        () => hook({ path: tmp }),
      ),
      /Azure.CodeSigning.Dlib.dll/,
    );
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('metadata.json: campos correctos y archivo válido', () => {
  const file = withEnv({}, () => _internals.buildMetadataFile('https://eus.codesigning.azure.net', 'acct', 'profile'));
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed.Endpoint, 'https://eus.codesigning.azure.net');
    assert.equal(parsed.CodeSigningAccountName, 'acct');
    assert.equal(parsed.CertificateProfileName, 'profile');
    assert.ok(parsed.CorrelationId && parsed.CorrelationId.startsWith('electron-builder-'));
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('normalizeCscLink: quita el prefijo file://', () => {
  assert.equal(_internals.normalizeCscLink('file:///C:/x/y.pfx'), 'C:/x/y.pfx');
  assert.equal(_internals.normalizeCscLink('C:/x/y.pfx'), 'C:/x/y.pfx');
});

test('findSignTool: devuelve una ruta existente (Windows SDK o PATH)', () => {
  const st = _internals.findSignTool();
  assert.ok(st, 'debe encontrar signtool');
  assert.ok(fs.existsSync(st), `debe existir: ${st}`);
});

test('WIN_CSC_LINK con pfx inexistente → error claro', async () => {
  const tmp = path.join(os.tmpdir(), 'sign-hook-pfx-test.exe');
  fs.writeFileSync(tmp, Buffer.from('x', 'utf8'));
  try {
    await assert.rejects(
      withEnv(
        { WIN_CSC_LINK: 'file:///C:/no-such-dir/missing.pfx', SIGNTOOL_PATH: 'C:/no-such-dir/signtool.exe' },
        () => hook({ path: tmp }),
      ),
      /no existe el pfx/,
    );
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
