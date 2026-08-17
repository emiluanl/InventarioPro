// =============================================================================
// Genera los PNG del logo (favicon, iconos PWA, apple-touch-icon y splash de
// iOS) a partir del SVG del símbolo con sharp. Sin dependencias nuevas
// (sharp es dependencia de Next). Ejecutar: node scripts/generate-logo-pngs.mjs
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');
const symbol = readFileSync(join(root, 'public', 'logo', 'logo-symbol-dark.svg'));
const favicon = readFileSync(join(root, 'public', 'logo', 'favicon.svg'));

const BG = '#0a0a0b'; // fondo de marca (tema oscuro predeterminado)

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
  console.log(`✓ ${name}`);
}
console.log('Listo.');
