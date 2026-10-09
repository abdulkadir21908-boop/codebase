// framediff.mjs -- decode two frames of the ANSI stream and report which cells
// changed, so a late-breaking regression can be localised.
//   node tools/framediff.mjs IN COLS ROWS FRAME_A FRAME_B
import { readFileSync } from "node:fs";

const [, , inFile, colsArg, rowsArg, aArg, bArg] = process.argv;
const COLS = +colsArg, ROWS = +rowsArg, A = +aArg, B = +bArg;
const N = COLS * ROWS;

// decode every frame into a flat array of two colours per cell
const frames = [];
let grid = new Int32Array(N * 2);
let cell = 0, frame = 0, fg = 0, bg = 0;
function emit() {
  grid[cell * 2] = fg;
  grid[cell * 2 + 1] = bg;
  cell++;
}
const b = readFileSync(inFile);
for (let i = 0; i < b.length; ) {
  if (b[i] === 0x1b && b[i + 1] === 0x5b) {
    let j = i + 2;
    while (j < b.length && b[j] >= 0x30 && b[j] <= 0x3f) j++;
    const cmd = String.fromCharCode(b[j]);
    const p = b.toString("latin1", i + 2, j).split(";");
    if (cmd === "H") {
      if (cell > 0) frames.push(grid);
      grid = new Int32Array(N * 2);
      cell = 0;
      frame++;
      i = j + 1;
      continue;
    }
    if (cmd === "m") {
      if (p[0] === "38" && p[1] === "2") fg = (+p[2] << 16) | (+p[3] << 8) | +p[4];
      else if (p[0] === "48" && p[1] === "2") bg = (+p[2] << 16) | (+p[3] << 8) | +p[4];
    }
    i = j + 1;
    continue;
  }
  if (b[i] === 0xe2 && b[i + 1] === 0x96 && b[i + 2] === 0x80) {
    emit();
    i += 3;
    continue;
  }
  i++;
}
if (cell > 0) frames.push(grid);

const hx = (v) => (v >>> 0).toString(16).padStart(6, "0");
console.log(`decoded ${frames.length} frames; comparing index ${A} and ${B}`);
const fa = frames[A], fb = frames[B];
if (!fa || !fb) {
  console.log("frame index out of range");
  process.exit(0);
}
let n = 0;
for (let c = 0; c < N; c++) {
  if (fa[c * 2] !== fb[c * 2] || fa[c * 2 + 1] !== fb[c * 2 + 1]) {
    n++;
    if (n <= 40) {
      console.log(
        `  cell ${c} (row ${Math.floor(c / COLS)}, col ${c % COLS}): ` +
          `${hx(fa[c * 2])}/${hx(fa[c * 2 + 1])} -> ${hx(fb[c * 2])}/${hx(fb[c * 2 + 1])}`,
      );
    }
  }
}
console.log(`${n} of ${N} cells changed`);