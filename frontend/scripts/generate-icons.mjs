// =============================================================================
// generate-icons.mjs - genera los iconos PNG/ICO de la PWA (sin dependencias)
// =============================================================================
// Dibuja una "caja de paquete" blanca sobre el color accent (#2563eb) con
// cálculo de píxeles y un encoder PNG mínimo (zlib + CRC32, color type 6).
//
// Uso: node scripts/generate-icons.mjs
// Salida:
//   public/icons/icon-192x192.png, icon-512x512.png, maskable-512.png
//   public/icons/favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png
//   app/favicon.ico (ICO con PNG 16 y 32 embebidos - soportado por todos los
//                    navegadores modernos; Next lo sirve como favicon)
//   public/icons/splash-<W>x<H>.png (splash screens iOS, portrait y landscape)
// =============================================================================

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCENT = [0x25, 0x63, 0xeb]; // accent-600
const WHITE = [0xff, 0xff, 0xff];
const SPLASH_BG = [0xf9, 0xfa, 0xfb]; // gray-50, coincide con background_color del manifest

// ---------------------------------------------------------------------------
// Encoder PNG mínimo (RGBA, sin compresión extra)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // Raw scanlines con filtro 0.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Encoder ICO: cabecera + entradas que apuntan a PNG embebidos (PNG-in-ICO,
// soportado por todos los navegadores modernos).
// ---------------------------------------------------------------------------
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // width (0 = 256)
    entry[1] = size >= 256 ? 0 : size; // height
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ---------------------------------------------------------------------------
// Dibujo del icono (caja de paquete). Devuelve [r,g,b] o null (transparente).
// ---------------------------------------------------------------------------
function iconColorAt(size, x, y, { rounded = false, radiusRatio = 0.18 } = {}) {
  const radius = Math.round(size * radiusRatio);
  if (rounded) {
    const dx = Math.max(radius - x, x - (size - radius), 0);
    const dy = Math.max(radius - y, y - (size - radius), 0);
    if (dx * dx + dy * dy > radius * radius) return null;
  }
  const rx = x / size;
  const ry = y / size;
  const body = rx >= 0.3 && rx <= 0.7 && ry >= 0.46 && ry <= 0.74;
  const lid = rx >= 0.26 && rx <= 0.74 && ry >= 0.34 && ry <= 0.46;
  const tape = rx >= 0.485 && rx <= 0.515 && ry >= 0.3 && ry <= 0.74;
  return body || lid || tape ? WHITE : ACCENT;
}

function drawIcon(size, opts) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = iconColorAt(size, x, y, opts);
      if (!color) continue;
      const i = (y * size + x) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

// ---------------------------------------------------------------------------
// Splash screen: fondo claro (gray-50) con el icono centrado, como genera
// Android a partir del manifest. iOS muestra estas imágenes al arrancar la
// app instalada (apple-touch-startup-image).
// ---------------------------------------------------------------------------
function drawSplash(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const size = Math.round(Math.min(width, height) * 0.3);
  const cx = Math.floor((width - size) / 2);
  const cy = Math.floor((height - size) / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = SPLASH_BG[0];
      pixels[i + 1] = SPLASH_BG[1];
      pixels[i + 2] = SPLASH_BG[2];
      pixels[i + 3] = 255;
    }
  }
  // Icono centrado con esquinas redondeadas (borde suave contra el fondo claro).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = iconColorAt(size, x, y, { rounded: true });
      if (!color) continue;
      const gx = cx + x;
      const gy = cy + y;
      if (gx < 0 || gx >= width || gy < 0 || gy >= height) continue;
      const i = (gy * width + gx) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');
const appDir = join(root, 'app');
mkdirSync(iconsDir, { recursive: true });

const targets = [
  ['icon-192x192.png', 192, { rounded: true }],
  ['icon-512x512.png', 512, { rounded: true }],
  ['maskable-512.png', 512, { rounded: false }],
  ['favicon-16x16.png', 16, { rounded: true }],
  ['favicon-32x32.png', 32, { rounded: true }],
  ['apple-touch-icon.png', 180, { rounded: true }],
];

for (const [name, size, opts] of targets) {
  const png = encodePng(size, size, drawIcon(size, opts));
  writeFileSync(join(iconsDir, name), png);
  console.log(`✓ public/icons/${name} (${size}x${size}, ${png.length} bytes)`);
}

// favicon.ico (PNG 16 y 32 embebidos) en app/ - Next lo sirve en /favicon.ico
const icoPngs = [
  { size: 16, png: encodePng(16, 16, drawIcon(16, { rounded: true })) },
  { size: 32, png: encodePng(32, 32, drawIcon(32, { rounded: true })) },
];
const ico = encodeIco(icoPngs);
writeFileSync(join(appDir, 'favicon.ico'), ico);
console.log(`✓ app/favicon.ico (${ico.length} bytes)`);

// Splash screens iOS: portrait y landscape de los dispositivos más comunes.
// El media query de cada imagen se define en layout.tsx (appleWebApp.startupImage).
const devices = [
  { w: 640, h: 1136, label: 'iPhone 5/SE 320x568 @2x' },
  { w: 750, h: 1334, label: 'iPhone 6/7/8/SE2/3 375x667 @2x' },
  { w: 1125, h: 2436, label: 'iPhone X/XS/11 Pro/12 mini 375x812 @3x' },
  { w: 1242, h: 2688, label: 'iPhone XS Max/11 Pro Max 414x896 @3x' },
  { w: 1170, h: 2532, label: 'iPhone 12/13/14 390x844 @3x' },
  { w: 1179, h: 2556, label: 'iPhone 14 Pro 393x852 @3x' },
  { w: 1284, h: 2778, label: 'iPhone 12/13 Pro Max 428x926 @3x' },
  { w: 1290, h: 2796, label: 'iPhone 14 Pro Max/15 Plus 430x932 @3x' },
  { w: 1668, h: 2224, label: 'iPad 10.5" 834x1112 @2x' },
  { w: 1668, h: 2388, label: 'iPad Pro 11" 834x1194 @2x' },
  { w: 2048, h: 2732, label: 'iPad 12.9" 1024x1366 @2x' },
];
// Landscape solo para las pantallas grandes (iPhones modernos e iPads).
const landscapeOnly = new Set(['1290x2796', '1170x2532', '1668x2224', '1668x2388', '2048x2732']);

for (const { w, h, label } of devices) {
  const png = encodePng(w, h, drawSplash(w, h));
  writeFileSync(join(iconsDir, `splash-${w}x${h}.png`), png);
  console.log(`✓ public/icons/splash-${w}x${h}.png (${label})`);
  if (landscapeOnly.has(`${w}x${h}`)) {
    const lpng = encodePng(h, w, drawSplash(h, w));
    writeFileSync(join(iconsDir, `splash-${h}x${w}.png`), lpng);
    console.log(`✓ public/icons/splash-${h}x${w}.png (${label} landscape)`);
  }
}
