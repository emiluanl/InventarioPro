// =============================================================================
// Genera los PNG del logo (favicon, iconos PWA, apple-touch-icon, splash de
// iOS) y el favicon.ico a partir de los SVG fuente de public/logo. Con sharp
// (dependencia de Next). Determinista: mismos SVG → mismos bytes.
//
// Uso:
//   node scripts/generate-logo-pngs.mjs
//   npm run generate:logo-assets
//
// Salida (rutas gitignored, se generan en cada build):
//   public/icons/favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png,
//   icon-192x192.png, icon-512x512.png, maskable-512.png,
//   public/icons/splash-<W>x<H>.png (16 splash screens iOS)
//   app/favicon.ico (ICO con PNG 16 y 32 embebidos — logo nuevo en el tab)
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');
const appDir = join(root, 'app');
const symbol = readFileSync(join(root, 'public', 'logo', 'logo-symbol-dark.svg'));
const favicon = readFileSync(join(root, 'public', 'logo', 'favicon.svg'));

const BG = '#0a0a0b'; // fondo de marca (tema oscuro predeterminado)

mkdirSync(iconsDir, { recursive: true });

async function renderSymbol(size) {
  return sharp(symbol).resize(size, size).png().toBuffer();
}

/** Icono cuadrado de marca (fondo sólido + símbolo centrado al % dado). */
async function tile(size, symbolRatio = 0.72, radius = 0) {
  const sym = Math.round(size * symbolRatio);
  const buf = await renderSymbol(sym);
  const base = sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  });
  if (radius > 0) {
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}"/></svg>`,
    );
    return base
      .composite([
        { input: buf, left: Math.round((size - sym) / 2), top: Math.round((size - sym) / 2) },
        { input: await sharp(mask).png().toBuffer(), blend: 'dest-in' },
      ])
      .png()
      .toBuffer();
  }
  return base
    .composite([{ input: buf, left: Math.round((size - sym) / 2), top: Math.round((size - sym) / 2) }])
    .png()
    .toBuffer();
}

/** Splash de iOS: fondo de marca + símbolo centrado (≈15% del lado menor). */
async function splash(w, h) {
  const sym = Math.round(Math.min(w, h) * 0.15);
  const buf = await renderSymbol(sym);
  return sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([{ input: buf, left: Math.round((w - sym) / 2), top: Math.round((h - sym) / 2) }])
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// favicon.ico: contenedor ICO con PNG embebidos (soportado por todos los
// navegadores modernos). Next sirve app/favicon.ico en /favicon.ico.
// ---------------------------------------------------------------------------
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const SPLASHES = [
  [640, 1136], [750, 1334], [1125, 2436], [1242, 2688], [1170, 2532],
  [2532, 1170], [1179, 2556], [1284, 2778], [1290, 2796], [2796, 1290],
  [1668, 2224], [2224, 1668], [1668, 2388], [2388, 1668], [2048, 2732],
  [2732, 2048],
];

const jobs = [
  ['favicon-16x16.png', () => sharp(favicon).resize(16, 16).png().toBuffer()],
  ['favicon-32x32.png', () => sharp(favicon).resize(32, 32).png().toBuffer()],
  ['apple-touch-icon.png', () => tile(180, 0.68, 40)],
  ['icon-192x192.png', () => tile(192, 0.72, 40)],
  ['icon-512x512.png', () => tile(512, 0.72, 110)],
  ['maskable-512.png', () => tile(512, 0.6, 0)], // zona segura: símbolo al 60%
  ...SPLASHES.map(([w, h]) => [`splash-${w}x${h}.png`, () => splash(w, h)]),
];

for (const [name, fn] of jobs) {
  const out = join(iconsDir, name);
  writeFileSync(out, await fn());
  console.log(`✓ public/icons/${name}`);
}

// favicon.ico con el MISMO símbolo (PNG 16 y 32 embebidos).
const ico = encodeIco([
  { size: 16, png: await sharp(favicon).resize(16, 16).png().toBuffer() },
  { size: 32, png: await sharp(favicon).resize(32, 32).png().toBuffer() },
]);
writeFileSync(join(appDir, 'favicon.ico'), ico);
console.log(`✓ app/favicon.ico (${ico.length} bytes)`);
console.log('Listo.');
