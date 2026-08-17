// =============================================================================
// Valida los assets del logo (PNG generados + SVG fuente + favicon.ico).
// Falla (exit != 0) si falta cualquier archivo requerido o no tiene el
// formato/dimensiones esperadas. Sin dependencias (lee las dimensiones del
// header IHDR del PNG directamente).
//
// Comprueba:
//   - SVG fuente presentes (public/logo/*.svg, variantes claras y oscuras);
//   - PNG generados con dimensiones exactas y firma PNG válida;
//   - favicon.ico presente;
//   - TODAS las rutas que referencian layout.tsx (metadata) y manifest.ts
//     existen (los archivos generados ya no viven en git: este test evita
//     que un checkout limpio quiebre el build/PWA en silencio);
//   - el icono 512 existe (fuente del icono de la app de escritorio).
//
// Uso:  npm run validate:logo-assets
// =============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');
const logoDir = join(root, 'public', 'logo');
const appDir = join(root, 'app');

const errors = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  errors.push(msg);
  console.error(`  ✗ ${msg}`);
};

/** Lee las dimensiones de un PNG desde su header IHDR (sin decodificar). */
function pngDimensions(file) {
  const buf = readFileSync(file);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// --- 1. SVG fuente (conservados en git) -------------------------------------
console.log('SVG fuente (public/logo):');
const sourceSvgs = [
  'favicon.svg',
  'logo-symbol-dark.svg',
  'logo-symbol-light.svg',
  'logo-horizontal-dark.svg',
  'logo-horizontal-light.svg',
];
for (const name of sourceSvgs) {
  const file = join(logoDir, name);
  if (existsSync(file)) ok(name);
  else fail(`falta el SVG fuente: public/logo/${name}`);
}

// --- 2. PNG generados obligatorios con dimensiones exactas ------------------
console.log('PNG generados (public/icons):');
const requiredPngs = [
  ['favicon-16x16.png', 16, 16],
  ['favicon-32x32.png', 32, 32],
  ['apple-touch-icon.png', 180, 180],
  ['icon-192x192.png', 192, 192],
  ['icon-512x512.png', 512, 512],
  ['maskable-512.png', 512, 512],
];
for (const [name, w, h] of requiredPngs) {
  const file = join(iconsDir, name);
  if (!existsSync(file)) {
    fail(`falta el PNG: public/icons/${name} (generar con npm run generate:logo-assets)`);
    continue;
  }
  const dim = pngDimensions(file);
  if (!dim) {
    fail(`PNG inválido: public/icons/${name}`);
  } else if (dim.width !== w || dim.height !== h) {
    fail(`dimensiones incorrectas en public/icons/${name}: ${dim.width}x${dim.height} (esperado ${w}x${h})`);
  } else {
    ok(`${name} (${w}x${h})`);
  }
}

// --- 3. Splash screens (iOS, layout.tsx) ------------------------------------
console.log('Splash screens (public/icons):');
const splashes = [
  [640, 1136], [750, 1334], [1125, 2436], [1242, 2688], [1170, 2532],
  [2532, 1170], [1179, 2556], [1284, 2778], [1290, 2796], [2796, 1290],
  [1668, 2224], [2224, 1668], [1668, 2388], [2388, 1668], [2048, 2732],
  [2732, 2048],
];
for (const [w, h] of splashes) {
  const file = join(iconsDir, `splash-${w}x${h}.png`);
  if (!existsSync(file)) {
    fail(`falta el splash: public/icons/splash-${w}x${h}.png`);
    continue;
  }
  const dim = pngDimensions(file);
  if (!dim || dim.width !== w || dim.height !== h) {
    fail(`splash inválido: splash-${w}x${h}.png (${dim ? `${dim.width}x${dim.height}` : 'no PNG'})`);
  } else {
    ok(`splash-${w}x${h}.png`);
  }
}

// --- 4. favicon.ico ----------------------------------------------------------
console.log('favicon.ico (app/):');
const icoFile = join(appDir, 'favicon.ico');
if (existsSync(icoFile) && readFileSync(icoFile).length > 0) {
  ok('app/favicon.ico presente');
} else {
  fail('falta app/favicon.ico (generar con npm run generate:logo-assets)');
}

// --- 5. Referencias del metadata (layout.tsx + manifest.ts) -----------------
console.log('Referencias del metadata (layout.tsx / manifest.ts):');
function referencedIconUrls(file, field) {
  const src = readFileSync(file, 'utf8');
  const re = new RegExp(`(?:${field})\\s*:\\s*['"]\\/icons\\/([^'"]+)['"]`, 'g');
  const urls = [];
  let m;
  while ((m = re.exec(src)) !== null) urls.push(`/icons/${m[1]}`);
  return urls;
}
const layoutUrls = [
  ...referencedIconUrls(join(appDir, 'layout.tsx'), 'url'),
];
const manifestUrls = referencedIconUrls(join(appDir, 'manifest.ts'), 'src');
const allReferenced = [...new Set([...layoutUrls, ...manifestUrls])];
for (const url of allReferenced) {
  const rel = url.replace(/^\/icons\//, '');
  const file = join(iconsDir, rel);
  if (existsSync(file)) ok(`${url} → existe`);
  else fail(`${url} → NO existe (referencia en layout.tsx/manifest.ts)`);
}
if (allReferenced.length === 0) fail('no se encontraron referencias a /icons/ en layout.tsx ni manifest.ts');

// --- 6. Icono del escritorio (fuente) ---------------------------------------
console.log('Desktop (fuente del icono):');
if (existsSync(join(iconsDir, 'icon-512x512.png'))) {
  ok('icon-512x512.png disponible como fuente de desktop/build/icon.png');
} else {
  fail('falta icon-512x512.png: desktop/build.sh lo copia a build/icon.png (electron-builder)');
}

// ----------------------------------------------------------------------------
console.log('');
if (errors.length > 0) {
  console.error(`✗ Validación de logo-assets FALLÓ (${errors.length} problema(s)).`);
  console.error('  Ejecuta primero: npm run generate:logo-assets');
  process.exit(1);
}
console.log('✓ Todos los assets del logo están presentes y válidos.');
