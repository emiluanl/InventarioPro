// =============================================================================
// desktop/scripts/sign-with-artifact-signing.js
// =============================================================================
// Hook de firma personalizado para electron-builder (config `sign`).
// electron-builder lo invoca para CADA ejecutable que empaqueta:
//   - InventarioPro.exe (el binario de Electron);
//   - elevate.exe (helper de elevación de NSIS);
//   - el __uninstaller.exe del instalador NSIS;
//   - cualquier otro PE que electron-builder decida firmar.
//
// Modos (en orden de precedencia):
//   1. ARTIFACT SIGNING (Microsoft): si están AS_ENDPOINT + AS_SIGNING_ACCOUNT
//      + AS_CERT_PROFILE → firma con signtool + Azure.CodeSigning.Dlib.dll.
//      Timestamp RFC 3161 obligatorio (http://timestamp.acs.microsoft.com)
//      porque los certificados de Artifact Signing valen ~3 días.
//   2. PFX autofirmado (builds internos): si WIN_CSC_LINK (+ opcional
//      WIN_CSC_KEY_PASSWORD) → firma con signtool + pfx + timestamp DigiCert.
//   3. SIN CREDENCIALES → no firma (builds de desarrollo/CI sin cert).
//
// Localización de herramientas (NO hardcodeadas):
//   - SIGNFILE_PATH / AS_SIGNSIGNTOOL_PATH: ruta explícita a signtool.exe
//     (usada por el workflow después de instalar el SDK de Windows).
//   - AS_DLIB_PATH: ruta a Azure.CodeSigning.Dlib.dll (workflow la descubre
//     tras instalar "Artifact Signing Client Tools").
//   - Si no hay ruta explícita, busca en el Windows SDK instalado y en PATH.
// =============================================================================

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AS_TIMESTAMP = 'http://timestamp.acs.microsoft.com';
const DIGICERT_TIMESTAMP = 'http://timestamp.digicert.com';

function env(name) {
  const v = process.env[name];
  return v ? String(v).trim() : '';
}

function hasArtifactSigningEnv() {
  return Boolean(env('AS_ENDPOINT') && env('AS_SIGNING_ACCOUNT') && env('AS_CERT_PROFILE'));
}

function hasPfxEnv() {
  return Boolean(env('WIN_CSC_LINK'));
}

// Busca signtool.exe: ruta explícita → Windows SDK (versión más nueva) → PATH.
function findSignTool() {
  const explicit = env('SIGNTOOL_PATH') || env('AS_SIGNSIGNTOOL_PATH');
  if (explicit && fs.existsSync(explicit)) return explicit;
  const sdkRoot = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  if (fs.existsSync(sdkRoot)) {
    const versions = fs
      .readdirSync(sdkRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d+\./.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => (a < b ? 1 : -1)); // descendente → más nueva primero
    for (const v of versions) {
      const candidate = path.join(sdkRoot, v, 'x64', 'signtool.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  try {
    const found = execFileSync('where.exe', ['signtool'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) return found.trim();
  } catch {
    /* sin signtool en PATH */
  }
  return '';
}

// Busca Azure.CodeSigning.Dlib.dll: ruta explícita → ubicaciones habituales
// de "Artifact Signing Client Tools".
function findDlib() {
  const explicit = env('AS_DLIB_PATH');
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = [
    path.join(env('ProgramFiles'), 'ArtifactSigningClientTools', 'x64', 'Azure.CodeSigning.Dlib.dll'),
    path.join(env('ProgramFiles'), 'Microsoft', 'ArtifactSigningClientTools', 'x64', 'Azure.CodeSigning.Dlib.dll'),
    path.join(env('ProgramFiles(x86)'), 'ArtifactSigningClientTools', 'x64', 'Azure.CodeSigning.Dlib.dll'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return '';
}

function buildMetadataFile(endpoint, account, profile) {
  const metadata = {
    Endpoint: endpoint,
    CodeSigningAccountName: account,
    CertificateProfileName: profile,
    CorrelationId: `electron-builder-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  };
  const file = path.join(os.tmpdir(), `as-metadata-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(metadata, null, 2), 'utf8');
  return file;
}

function normalizeCscLink(link) {
  // build.sh expone WIN_CSC_LINK como file://C:/... o file:///C:/...
  let p = link.replace(/^file:\/\//i, '');
  p = p.replace(/^\/([A-Za-z]:)/, '$1'); // file:///C:/... → /C:/... → C:/...
  return p;
}

function signWithSigntool(signtool, args) {
  execFileSync(signtool, ['sign', ...args], { stdio: 'inherit', windowsHide: true });
}

async function sign(config) {
  const filePath = config && config.path;
  if (!filePath) {
    throw new Error('sign hook: falta config.path');
  }

  if (hasArtifactSigningEnv()) {
    const signtool = findSignTool();
    const dlib = findDlib();
    if (!signtool) throw new Error('sign hook: no se encontró signtool.exe (instalar Windows SDK o fijar SIGNTOOL_PATH)');
    if (!dlib) throw new Error('sign hook: no se encontró Azure.CodeSigning.Dlib.dll (instalar "Artifact Signing Client Tools" o fijar AS_DLIB_PATH)');
    const metadataFile = buildMetadataFile(env('AS_ENDPOINT'), env('AS_SIGNING_ACCOUNT'), env('AS_CERT_PROFILE'));
    console.log(`[sign] Artifact Signing → ${path.basename(filePath)}`);
    signWithSigntool(signtool, [
      '/fd', 'SHA256',
      '/tr', AS_TIMESTAMP,
      '/td', 'SHA256',
      '/dlib', dlib,
      '/dmdf', metadataFile,
      filePath,
    ]);
    fs.rmSync(metadataFile, { force: true });
    return;
  }

  if (hasPfxEnv()) {
    const signtool = findSignTool();
    if (!signtool) throw new Error('sign hook: WIN_CSC_LINK definido pero no se encontró signtool.exe');
    const pfx = normalizeCscLink(env('WIN_CSC_LINK'));
    if (!fs.existsSync(pfx)) throw new Error(`sign hook: no existe el pfx: ${pfx}`);
    const args = [
      '/fd', 'SHA256',
      '/tr', DIGICERT_TIMESTAMP,
      '/td', 'SHA256',
      '/f', pfx,
    ];
    const pass = env('WIN_CSC_KEY_PASSWORD');
    if (pass) args.push('/p', pass);
    args.push(filePath);
    console.log(`[sign] PFX autofirmado → ${path.basename(filePath)}`);
    signWithSigntool(signtool, args);
    return;
  }

  // Sin credenciales: no firmar (build de desarrollo o CI sin cert).
  console.log('[sign] sin credenciales de firma (AS_ENDPOINT o WIN_CSC_LINK): archivo sin firmar:', path.basename(filePath));
}

module.exports = sign;
module.exports._internals = { findSignTool, findDlib, buildMetadataFile, normalizeCscLink };
