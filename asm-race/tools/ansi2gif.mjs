// ansi2gif.mjs -- replay the game's ANSI output into an animated GIF.
//
// The output is a stream of SGR colour changes followed by one U+2580 per
// terminal cell, so the picture is recovered exactly the way a terminal would
// recover it: the SGR state persists across cells and across frames, and a
// cell that receives no SGR is still repainted with the state in effect.
//
//   node tools/ansi2gif.mjs IN OUT COLS ROWS [first] [count] [every] [delayCs]
//
// The framebuffer has only ~30 distinct colours, so a straight palette works
// with no quantisation.
import { readFileSync, writeFileSync } from "node:fs";

// ------------------------------------------------------------ replay
function replay(buf, COLS, ROWS) {
  const frames = [];
  let grid = new Uint8Array(COLS * ROWS * 6);
  let cell = 0;
  let fg = [255, 255, 255];
  let bg = [0, 0, 0];

  for (let i = 0; i < buf.length; ) {
    if (buf[i] === 0x1b && buf[i + 1] === 0x5b) {
      let j = i + 2;
      while (j < buf.length && buf[j] >= 0x30 && buf[j] <= 0x3f) j++;
      const cmd = String.fromCharCode(buf[j]);
      const p = buf.toString("latin1", i + 2, j).split(";");
      if (cmd === "H") {
        if (cell > 0) frames.push(grid);
        grid = new Uint8Array(COLS * ROWS * 6);
        cell = 0;
        i = j + 1;
        continue;
      }
      if (cmd === "m") {
        if (p[0] === "38" && p[1] === "2") fg = [+p[2], +p[3], +p[4]];
        else if (p[0] === "48" && p[1] === "2") bg = [+p[2], +p[3], +p[4]];
      }
      i = j + 1;
      continue;
    }
    if (buf[i] === 0xe2 && buf[i + 1] === 0x96 && buf[i + 2] === 0x80) {
      if (cell < COLS * ROWS) {
        const o = cell * 6;
        grid[o] = fg[0]; grid[o + 1] = fg[1]; grid[o + 2] = fg[2];
        grid[o + 3] = bg[0]; grid[o + 4] = bg[1]; grid[o + 5] = bg[2];
        cell++;
      }
      i += 3;
      continue;
    }
    i++;
  }
  if (cell > 0) frames.push(grid);
  return frames;
}

// ------------------------------------------------------------- LZW
// Fixed 9-bit codes. The dictionary is flushed with a CLEAR well before it
// reaches 2^9 entries, because the decoder grows its own table in lockstep and
// would bump its code size the moment its table hit 512 -- one entry later than
// we would, which desynchronises the bit stream. The margin below that line is
// what keeps the two in step.
function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const codeSize = minCodeSize + 1;
  const MAX_ENTRIES = (1 << codeSize) - (eoi + 1) - 16;   // 512 - 258 - 16 = 238
  const out = [];
  let acc = 0;
  let bits = 0;
  const emit = (code) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(acc & 0xff);
      acc >>= 8;
      bits -= 8;
    }
  };

  let table = new Map();
  emit(clear);
  if (indices.length === 0) {
    emit(eoi);
    if (bits) out.push(acc & 0xff);
    return out;
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const kk = prefix * 4096 + k;
    const found = table.get(kk);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (table.size < MAX_ENTRIES) {
      table.set(kk, eoi + 1 + table.size);
    } else {
      emit(clear);
      table = new Map();
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits) out.push(acc & 0xff);
  return out;
}

function subBlocks(data) {
  const parts = [];
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    parts.push(Buffer.from([n]), Buffer.from(data.subarray(i, i + n)));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

// -------------------------------------------------------------- GIF
const [, , inFile, outFile, colsArg, rowsArg, firstArg, countArg, everyArg, delayArg] =
  process.argv;
const COLS = Number(colsArg ?? 110);
const ROWS = Number(rowsArg ?? 34);
const FIRST = Number(firstArg ?? 0);
const COUNT = Number(countArg ?? 150);
const EVERY = Math.max(1, Number(everyArg ?? 6));
const DELAY = Number(delayArg ?? 8);          // hundredths of a second
const SCALE = 2;                              // nearest-neighbour blow-up

const frames = replay(readFileSync(inFile), COLS, ROWS);
const wanted = [];
for (let i = FIRST; i < frames.length && wanted.length < COUNT; i += EVERY) {
  wanted.push(frames[i]);
}
if (wanted.length === 0) {
  console.error("no frames matched");
  process.exit(1);
}

// palette: every colour used, sorted for a stable mapping
const toIndex = new Map();
const palette = [];
const add = (r, g, b) => {
  const k = (r << 16) | (g << 8) | b;
  if (toIndex.has(k)) return;
  if (palette.length >= 256) return;             // never happens here
  toIndex.set(k, palette.length);
  palette.push([r, g, b]);
};
for (const g of wanted) for (let c = 0; c < COLS * ROWS; c++) {
  const o = c * 6;
  add(g[o], g[o + 1], g[o + 2]);
  add(g[o + 3], g[o + 4], g[o + 5]);
}
while (palette.length < 2) palette.push([0, 0, 0]);
let bitsPal = 1;
while ((1 << bitsPal) < palette.length) bitsPal++;

const W = COLS * SCALE;
const H = ROWS * 2 * SCALE;

const chunks = [];
const header = Buffer.from("GIF89a", "latin1");
const lsd = Buffer.alloc(7);
lsd.writeUInt16LE(W, 0);
lsd.writeUInt16LE(H, 2);
lsd[4] = 0x80 | ((bitsPal - 1) << 4) | (bitsPal - 1);
lsd[5] = 0;
lsd[6] = 0;
const gct = Buffer.alloc(3 * (1 << bitsPal));
palette.forEach(([r, g, b], i) => {
  gct[i * 3] = r; gct[i * 3 + 1] = g; gct[i * 3 + 2] = b;
});
chunks.push(header, lsd, gct);
// NETSCAPE2.0 looping extension
chunks.push(Buffer.from([0x21, 0xff, 0x0b]));
chunks.push(Buffer.from("NETSCAPE2.0", "latin1"));
chunks.push(Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]));

for (const g of wanted) {
  const idx = new Uint8Array(COLS * ROWS * 2);
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const c = cy * COLS + cx;
      const o = c * 6;
      idx[cy * 2 * COLS + cx] = toIndex.get((g[o] << 16) | (g[o + 1] << 8) | g[o + 2]);
      idx[(cy * 2 + 1) * COLS + cx] = toIndex.get((g[o + 3] << 16) | (g[o + 4] << 8) | g[o + 5]);
    }
  }
  // nearest-neighbour scale
  const big = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const srow = Math.floor(y / SCALE);
    for (let x = 0; x < W; x++) {
      big[y * W + x] = idx[srow * COLS + Math.floor(x / SCALE)];
    }
  }

  chunks.push(Buffer.from([0x21, 0xf9, 0x04, 0x04, DELAY & 0xff, (DELAY >> 8) & 0xff, 0x00, 0x00]));
  const gce = chunks[chunks.length - 1];
  gce[1] = 0xf9;
  gce[3] = 0x04;                                  // disposal: do not dispose
  const desc = Buffer.alloc(10);
  desc[0] = 0x2c;
  desc.writeUInt16LE(0, 1);
  desc.writeUInt16LE(0, 3);
  desc.writeUInt16LE(W, 5);
  desc.writeUInt16LE(H, 7);
  desc[9] = 0;                                    // no local table, not interlaced
  chunks.push(desc);
  const minCodeSize = 8;
  chunks.push(Buffer.from([minCodeSize]));
  chunks.push(subBlocks(Buffer.from(lzw(big, minCodeSize))));
}
chunks.push(Buffer.from([0x3b]));

const gif = Buffer.concat(chunks);
writeFileSync(outFile, gif);
console.log(
  `${wanted.length} frames, ${palette.length} colours, ${W}x${H}, ` +
  `${(gif.length / 1024).toFixed(0)} KiB -> ${outFile} ` +
  `(${(wanted.length * DELAY / 100).toFixed(1)} s)`,
);