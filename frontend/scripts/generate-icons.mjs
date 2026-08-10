// =============================================================================
// generate-icons.mjs - genera los iconos PNG de la PWA (sin dependencias)
// =============================================================================
// Dibuja una "caja de paquete" blanca sobre el color accent (#2563eb) con
// cálculo de píxeles y un encoder PNG mínimo (zlib + CRC32, color type 6).
//
// Uso: node scripts/generate-icons.mjs
// Salida: public/icons/icon-192x192.png, icon-512x512.png, maskable-512.png
// =============================================================================

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCENT = [0x25, 0x63, 0xeb]; // accent-600
const WHITE = [0xff, 0xff, 0xff];

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

function encodePng(size, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // Raw scanlines con filtro 0.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Dibujo del icono
// ---------------------------------------------------------------------------
function drawIcon(size, { rounded = false, radiusRatio = 0.18 } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * radiusRatio);

  const inRoundedRect = (x, y) => {
    if (!rounded) return true;
    const dx = Math.max(radius - x, x - (size - radius), 0);
    const dy = Math.max(radius - y, y - (size - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
  };

  // Coordenadas relativas (0..1) de la caja.
  const inBox = (x, y) => {
    const rx = x / size;
    const ry = y / size;
    const body = rx >= 0.3 && rx <= 0.7 && ry >= 0.46 && ry <= 0.74;
    const lid = rx >= 0.26 && rx <= 0.74 && ry >= 0.34 && ry <= 0.46;
    const tape = rx >= 0.485 && rx <= 0.515 && ry >= 0.3 && ry <= 0.74;
    return body || lid || tape;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRoundedRect(x, y)) continue; // transparente fuera del redondeo
      const color = inBox(x, y) ? WHITE : ACCENT;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-192x192.png', 192, { rounded: true }],
  ['icon-512x512.png', 512, { rounded: true }],
  ['maskable-512.png', 512, { rounded: false }],
];

for (const [name, size, opts] of targets) {
  const png = encodePng(size, drawIcon(size, opts));
  writeFileSync(join(outDir, name), png);
  console.log(`✓ ${name} (${size}x${size}, ${png.length} bytes)`);
}
