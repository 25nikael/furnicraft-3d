'use strict';
/**
 * Generates the PWA / Android launcher icons into public/icons/.
 *
 * Zero dependencies: rasterises a few flat shapes into an RGBA buffer and
 * encodes a PNG with Node's built-in zlib. Run with `node tools/make-icons.js`
 * whenever the mark changes; the generated PNGs are committed.
 *
 * The mark is a simple cabinet — outer carcase, one shelf, one divider — in
 * FurniCraft teal on the app's near-black background.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [0x10, 0x10, 0x14, 255];   // app background
const FG = [0x0a, 0xba, 0xb5, 255];   // FurniCraft teal

// ── tiny PNG encoder ────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── shape helpers (unit space 0..1, y down) ─────────────────────────────
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}
// hollow rounded rect (a frame of thickness t)
function inFrame(px, py, x, y, w, h, r, t) {
  return inRoundRect(px, py, x, y, w, h, r) &&
        !inRoundRect(px, py, x + t, y + t, w - 2 * t, h - 2 * t, Math.max(0, r - t));
}

// Draw the mark. `inset` shrinks the artwork toward the centre (maskable
// icons must keep their content inside a safe zone, since launchers crop).
function drawIcon(size, opts) {
  opts = opts || {};
  const inset = opts.inset || 0;        // 0..0.5 of the canvas
  const roundBg = opts.roundBg !== false;
  const buf = Buffer.alloc(size * size * 4);
  const S = 1 / size;
  const put = (i, c) => { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3]; };

  // Map unit artwork coords through the inset.
  const m = (v) => inset + v * (1 - 2 * inset);
  const ms = (v) => v * (1 - 2 * inset);

  const bx = m(0.19), by = m(0.17), bw = ms(0.62), bh = ms(0.66);
  const t  = ms(0.055);                                  // carcase wall
  const shelfY = m(0.455), shelfH = ms(0.045);
  const divX = m(0.475), divW = ms(0.045);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) * S, py = (y + 0.5) * S;
      let c = null;

      // background
      if (roundBg) { if (inRoundRect(px, py, 0, 0, 1, 1, 0.22)) c = BG; }
      else c = BG;
      if (!c) { put((y * size + x) * 4, [0, 0, 0, 0]); continue; }

      // carcase frame
      if (inFrame(px, py, bx, by, bw, bh, ms(0.06), t)) c = FG;
      // shelf, inside the carcase
      else if (px > bx + t && px < bx + bw - t && py > shelfY && py < shelfY + shelfH) c = FG;
      // divider, lower half only
      else if (px > divX && px < divX + divW && py > shelfY + shelfH && py < by + bh - t) c = FG;

      put((y * size + x) * 4, c);
    }
  }
  return encodePNG(size, size, buf);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { file: 'icon-192.png',          size: 192, opts: {} },
  { file: 'icon-512.png',          size: 512, opts: {} },
  // Maskable: full-bleed background, artwork pulled into the safe zone.
  { file: 'icon-maskable-512.png', size: 512, opts: { inset: 0.14, roundBg: false } },
  { file: 'apple-touch-icon.png',  size: 180, opts: {} }
];

targets.forEach((t) => {
  const png = drawIcon(t.size, t.opts);
  fs.writeFileSync(path.join(outDir, t.file), png);
  console.log('wrote public/icons/' + t.file + '  (' + t.size + 'px, ' + png.length + ' bytes)');
});
