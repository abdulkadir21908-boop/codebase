// ansi2png.mjs -- turn the game's ANSI truecolour half-block output into a PNG
// so a frame can actually be looked at.  Each cell is ESC[38;2;r;g;bm for the
// foreground (upper half), ESC[48;2;r;g;bm for the background (lower half)
// and U+2580.  Everything else is ignored.
//   node tools/ansi2png.mjs IN OUT [cols] [rows] [frame] [scale]
// The last two arguments may be "col,row,cols,rows" to crop a region first --
// a HUD is 7 pixels tall in a 68-pixel frame, so reading one at 1:1 is hopeless.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

function parse(arg, fallback) {
  if (arg == null) return fallback;
  if (typeof arg === "string" && arg.includes(",")) return arg.split(",").map(Number);
  return Number(arg);
}

const [, , inFile, outFile, wArg, hArg, frameArg, scaleArg, cropArg] = process.argv;
const COLS = Number(wArg ?? 100);
const ROWS = Number(hArg ?? 30);
const WANT = Number(frameArg ?? 0);
const SCALE = Number(scaleArg ?? 1);
const CROP = cropArg ? parse(cropArg, null) : null;   // cx, cy, cw, ch in cells

const buf = readFileSync(inFile);

// ---- replay the escape stream, keeping one grid at a time
const grid = new Uint8Array(COLS * ROWS * 6); // rgb per cell, top then bottom
let cell = 0;
let fg = [255, 255, 255];
let bg = [0, 0, 0];

let keep = null;
let frames = 0;
function paint() {
  if (cell >= COLS * ROWS) return;
  const o = cell * 6;
  grid[o] = fg[0]; grid[o + 1] = fg[1]; grid[o + 2] = fg[2];
  grid[o + 3] = bg[0]; grid[o + 4] = bg[1]; grid[o + 5] = bg[2];
  cell++;
  if (cell === COLS * ROWS && frames - 1 === WANT) keep = grid.slice();
}
function reset() { cell = 0; frames++; }

let i = 0;
while (i < buf.length) {
  if (buf[i] === 0x1b && buf[i + 1] === 0x5b) {
    // ESC [ ... final-byte
    let j = i + 2;
    while (j < buf.length && buf[j] >= 0x30 && buf[j] <= 0x3f) j++;
    const cmd = buf[j];
    const params = buf.toString("latin1", i + 2, j);
    if (cmd === 0x48) { reset(); i = j + 1; continue; }          // ESC [ H
    if (cmd === 0x6d) {                                          // ESC [ ... m
      const parts = params.split(";");
      if (parts[0] === "38" && parts[1] === "2") fg = [+parts[2], +parts[3], +parts[4]];
      else if (parts[0] === "48" && parts[1] === "2") bg = [+parts[2], +parts[3], +parts[4]];
      else if (parts[0] === "" || parts[0] === "0") { fg = [255, 255, 255]; bg = [0, 0, 0]; }
      i = j + 1;
      continue;
    }
    i = j + 1;
    continue;
  }
  const ch = buf[i];
  if (ch === 0xe2 && buf[i + 1] === 0x96 && buf[i + 2] === 0x80) { paint(); i += 3; continue; }
  if (ch === 0x0a || ch === 0x0d) { i++; continue; }
  i++; // any other printable: skip
}
console.log(`replayed ${frames} frame(s)`);

// ---- compose an RGB image: two pixel rows per cell, then nearest-neighbour scale
const full = keep ?? grid.slice();
const [CX, CY, CW, CH] = CROP ?? [0, 0, COLS, ROWS];
const src = (() => {
  if (!CROP) return full;
  const out = new Uint8Array(CW * CH * 6);
  for (let r = 0; r < CH; r++) {
    for (let c = 0; c < CW; c++) {
      const srcCell = (CY + r) * COLS + (CX + c);
      const dstCell = r * CW + c;
      out.set(full.subarray(srcCell * 6, srcCell * 6 + 6), dstCell * 6);
    }
  }
  return out;
})();
const W = CW * SCALE;
const H = CH * 2 * SCALE;
const img = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  const srow = Math.floor(y / SCALE); // pixel row within the scaled image
  const cellRow = srow >> 1;          // two pixel rows per terminal cell
  const bottom = srow & 1;
  for (let x = 0; x < W; x++) {
    const scol = Math.floor(x / SCALE);
    const c = cellRow * CW + scol;
    const o = c * 6;
    const d = (y * W + x) * 3;
    const k = bottom ? 3 : 0;
    img[d] = src[o + k]; img[d + 1] = src[o + k + 1]; img[d + 2] = src[o + k + 2];
  }
}

// ---- minimal PNG writer (8-bit RGB, filter 0)
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 2;   // colour type: truecolour
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(outFile, png);
console.log(`wrote ${outFile} (${W}x${H})`);