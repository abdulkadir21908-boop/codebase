// palettecheck.mjs -- count distinct colours in the replayed frames, so the
// GIF encoder knows whether a straight palette will do or it has to quantise.
import { readFileSync } from "node:fs";

const [, , inFile, colsArg, rowsArg, maxArg] = process.argv;
const COLS = +colsArg, ROWS = +rowsArg, MAXF = Number(maxArg ?? 40);
const b = readFileSync(inFile);

const frames = [];
let grid = new Uint8Array(COLS * ROWS * 6);
let cell = 0, frame = 0, fg = [255, 255, 255], bg = [0, 0, 0];
const key = (r, g, bl) => (r << 16) | (g << 8) | bl;

for (let i = 0; i < b.length; ) {
  if (b[i] === 0x1b && b[i + 1] === 0x5b) {
    let j = i + 2;
    while (j < b.length && b[j] >= 0x30 && b[j] <= 0x3f) j++;
    const cmd = String.fromCharCode(b[j]);
    const p = b.toString("latin1", i + 2, j).split(";");
    if (cmd === "H") {
      if (cell > 0) frames.push(grid);
      grid = new Uint8Array(COLS * ROWS * 6);
      cell = 0;
      frame++;
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
  if (b[i] === 0xe2 && b[i + 1] === 0x96 && b[i + 2] === 0x80) {
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

const seen = new Map();
const stride = COLS * 3;
const step = Math.max(1, Math.floor(frames.length / MAXF));
for (let f = 0; f < frames.length; f += step) {
  const g = frames[f];
  for (let row = 0; row < ROWS * 2; row++) {
    for (let x = 0; x < COLS; x++) {
      const c = Math.floor(row / 2) * COLS + x;
      const o = c * 6 + (row % 2 ? 3 : 0);
      const k = key(g[o], g[o + 1], g[o + 2]);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  }
}
console.log(`frames replayed: ${frames.length}, sampled every ${step}`);
console.log(`distinct colours: ${seen.size}`);
const top = [...seen.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 12);
for (const [k, n] of top) {
  console.log(`  #${k.toString(16).padStart(6, "0")}  ${n}`);
}