// ansimap.mjs -- print a coarse ASCII map of one frame so it can be read in
// a terminal: one character per cell, mapped to the nearest palette entry.
//   node tools/ansimap.mjs IN COLS ROWS FRAME
import { readFileSync } from "node:fs";

const [, , inFile, colsArg, rowsArg, frameArg] = process.argv;
const COLS = Number(colsArg ?? 100);
const ROWS = Number(rowsArg ?? 30);
const WANT = Number(frameArg ?? 0);

const buf = readFileSync(inFile);
const grid = new Uint8Array(COLS * ROWS * 6);
let cell = 0, frames = 0, keep = null;
let fg = [255, 255, 255], bg = [0, 0, 0];

function paint() {
  if (cell >= COLS * ROWS) return;
  const o = cell * 6;
  grid[o] = fg[0]; grid[o + 1] = fg[1]; grid[o + 2] = fg[2];
  grid[o + 3] = bg[0]; grid[o + 4] = bg[1]; grid[o + 5] = bg[2];
  cell++;
  if (cell === COLS * ROWS && frames - 1 === WANT) keep = grid.slice();
}

let i = 0;
while (i < buf.length) {
  if (buf[i] === 0x1b && buf[i + 1] === 0x5b) {
    let j = i + 2;
    while (j < buf.length && buf[j] >= 0x30 && buf[j] <= 0x3f) j++;
    const cmd = buf[j];
    const params = buf.toString("latin1", i + 2, j);
    if (cmd === 0x48) { cell = 0; frames++; i = j + 1; continue; }
    if (cmd === 0x6d) {
      const p = params.split(";");
      if (p[0] === "38" && p[1] === "2") fg = [+p[2], +p[3], +p[4]];
      else if (p[0] === "48" && p[1] === "2") bg = [+p[2], +p[3], +p[4]];
      i = j + 1;
      continue;
    }
    i = j + 1;
    continue;
  }
  if (buf[i] === 0xe2 && buf[i + 1] === 0x96 && buf[i + 2] === 0x80) { paint(); i += 3; continue; }
  i++;
}

const g = keep ?? grid;
console.log(`frame ${WANT} of ${frames}:`);
// lump cells into 2x2 blocks and report the average colour's nearest symbol
const SYM = " .:-=+*#%@";
for (let by = 0; by < ROWS; by += 2) {
  let line = "";
  for (let bx = 0; bx < COLS; bx += 2) {
    let r = 0, g2 = 0, b = 0, n = 0;
    for (let dy = 0; dy < 2 && by + dy < ROWS; dy++) {
      for (let dx = 0; dx < 2 && bx + dx < COLS; dx++) {
        const c = (by + dy) * COLS + (bx + dx);
        const o = c * 6;
        r += (g[o] + g[o + 3]) / 2;
        g2 += (g[o + 1] + g[o + 4]) / 2;
        b += (g[o + 2] + g[o + 5]) / 2;
        n++;
      }
    }
    r /= n; g2 /= n; b /= n;
    const lum = (r * 3 + g2 * 6 + b) / 10;
    line += SYM[Math.min(SYM.length - 1, Math.floor(lum / 25.6))];
  }
  console.log(line);
}
// report a few sampled colours so the palette can be checked
console.log("\nsample cells (row, col) -> fg/bg:");
for (const [cy, cx] of [[0, 50], [8, 50], [14, 50], [15, 50], [16, 50], [20, 5], [20, 50], [20, 95], [25, 50], [29, 50]]) {
  const o = (cy * COLS + cx) * 6;
  const hx = (v) => v.toString(16).padStart(2, "0");
  console.log(
    `  (${cy},${cx}) fg=#${hx(g[o])}${hx(g[o + 1])}${hx(g[o + 2])} bg=#${hx(g[o + 3])}${hx(g[o + 4])}${hx(g[o + 5])}`,
  );
}