// Generates src/icons/*.png with Node built-ins only (SPEC 16, R14).
// Radar concept: dark rounded square, faint ring, accent sweep arc with a soft wedge, centre dot, one blip.
// Usage: npm run icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icons');
const SUPERSAMPLE = 4;

const THEMES = {
  toolbar: { bg: [0x1b, 0x21, 0x2b], accent: [0x2d, 0xd4, 0xa7], blip: [0xea, 0xff, 0xf8], weight: 1 },
  notification: { bg: [0x0b, 0x0f, 0x14], accent: [0x3e, 0xf0, 0xc0], blip: [0xff, 0xff, 0xff], weight: 1.25 }
};

const OUTPUTS = [
  { file: '16.png', size: 16, theme: 'toolbar' },
  { file: '32.png', size: 32, theme: 'toolbar' },
  { file: '48.png', size: 48, theme: 'toolbar' },
  { file: '128.png', size: 128, theme: 'toolbar' },
  { file: 'notif-128.png', size: 128, theme: 'notification' }
];

// ---------- geometry, all in unit coordinates with y pointing down ----------

const C = 0.5;
const TAU = Math.PI * 2;
const SWEEP_FROM = -Math.PI / 2;   // 12 o'clock
const SWEEP_TO = 0;                // 3 o'clock

function inRoundedSquare(x, y, radius) {
  const dx = Math.max(radius - x, 0, x - (1 - radius));
  const dy = Math.max(radius - y, 0, y - (1 - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function angleIn(a, from, to) {
  const norm = v => ((v % TAU) + TAU) % TAU;
  const span = norm(to - from);
  return norm(a - from) <= span;
}

/** Straight-alpha RGBA layers for one sample point, painted bottom to top. */
function layersAt(x, y, size, theme) {
  const px = 1 / size;
  const w = theme.weight;
  const ringR = 0.3;
  const faintW = Math.max(0.06 * w, 1.2 * px);
  const arcW = Math.max(0.1 * w, 2 * px);
  const dotR = Math.max(0.08 * w, 1.6 * px);
  const blipR = Math.max(0.055 * w, 1.2 * px);

  const dx = x - C, dy = y - C;
  const d = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx);
  const layers = [];

  if (inRoundedSquare(x, y, 0.22)) layers.push([...theme.bg, 1]);
  if (Math.abs(d - ringR) <= faintW / 2) layers.push([...theme.accent, 0.3]);
  if (d < ringR && angleIn(a, SWEEP_FROM, SWEEP_TO)) {
    const t = ((a - SWEEP_FROM) + TAU) % TAU / (SWEEP_TO - SWEEP_FROM);
    layers.push([...theme.accent, 0.05 + 0.35 * t]);          // brighter toward the leading edge
  }
  if (Math.abs(d - ringR) <= arcW / 2 && angleIn(a, SWEEP_FROM, SWEEP_TO)) layers.push([...theme.accent, 1]);
  if (d <= dotR) layers.push([...theme.accent, 1]);
  const bx = C + Math.cos(-3 * Math.PI / 4) * 0.19, by = C + Math.sin(-3 * Math.PI / 4) * 0.19;
  if (Math.hypot(x - bx, y - by) <= blipR) layers.push([...theme.blip, 0.95]);
  return layers;
}

/** Source-over compositing, returned premultiplied. */
function composite(layers) {
  let r = 0, g = 0, b = 0, alpha = 0;
  for (const [lr, lg, lb, la] of layers) {
    r = lr * la + r * (1 - la);
    g = lg * la + g * (1 - la);
    b = lb * la + b * (1 - la);
    alpha = la + alpha * (1 - la);
  }
  return [r, g, b, alpha];
}

function render(size, theme) {
  const rgba = Buffer.alloc(size * size * 4);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          const [cr, cg, cb, ca] = composite(layersAt(x, y, size, theme));
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const i = (py * size + px) * 4;
      const alpha = a / n;
      rgba[i] = alpha ? Math.round(r / n / alpha) : 0;
      rgba[i + 1] = alpha ? Math.round(g / n / alpha) : 0;
      rgba[i + 2] = alpha ? Math.round(b / n / alpha) : 0;
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

// ---------- PNG encoding ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;    // bit depth
  header[9] = 6;    // colour type RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const offset = y * (size * 4 + 1);
    rows[offset] = 0;   // filter: none
    rgba.copy(rows, offset + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, size, theme } of OUTPUTS) {
  const png = encodePng(size, render(size, THEMES[theme]));
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`wrote src/icons/${file} (${size}x${size}, ${png.length} bytes)`);
}
