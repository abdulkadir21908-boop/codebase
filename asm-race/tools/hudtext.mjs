// hudtext.mjs -- print a region of a replayed frame as its raw pixel grid.
//
// The renderer draws a 5x7 glyph into a pixel framebuffer, so the text is
// already there at full fidelity; it is only the half-block terminal cell that
// squashes it 2:1.  Reading the two pixel rows behind a cell straight out of
// the frame gives back the un-squashed glyph, which is the only reliable way to
// check that the HUD says what it is supposed to say.
//
//   node tools/hudtext.mjs IN COLS ROWS FRAME COL ROW COLS_ROWS [inkHex]
//
// COL/ROW/COLS_ROWS are in terminal cells.  inkHex defaults to the HUD white.
import { readFileSync } from "node:fs";

const [, , inFile, colsArg, rowsArg, frameArg, cxArg, cyArg, cwArg, chArg, inkArg] =
  process.argv;
const COLS = Number(colsArg ?? 100);
const ROWS = Number(rowsArg ?? 30);
const WANT = Number(frameArg ?? 0);
const CX = Number(cxArg ?? 0);
const CY = Number(cyArg ?? 0);
const CW = Number(cwArg ?? COLS);
const CH = Number(chArg ?? ROWS);
const INK = (inkArg ?? "e8f4ff").replace(/^#/, "").match(/../g).map((h) => parseInt(h, 16));

function isInk(r, g, b) {
  return Math.abs(r - INK[0]) <= 6 && Math.abs(g - INK[1]) <= 6 && Math.abs(b - INK[2]) <= 6;
}

let grid = new Uint8Array(COLS * ROWS * 6);
let cell = 0;
let fg = [255, 255, 255];
let bg = [0, 0, 0];
const frames = [];
const buf = readFileSync(inFile);
for (let i = 0; i < buf.length; ) {
  if (buf[i] === 0x1b && buf[i + 1] === 0x5b) {
    let j = i + 2;
    while (j < buf.length && buf[j] >= 0x30 && buf[j] <= 0x3f) j++;
    const cmd = buf[j];
    const p = buf.toString("latin1", i + 2, j).split(";");
    if (cmd === 0x48) {
      if (cell > 0) frames.push(grid);
      grid = new Uint8Array(COLS * ROWS * 6);
      cell = 0;
      i = j + 1;
      continue;
    }
    if (cmd === 0x6d) {
      if (p[0] === "38" && p[1] === "2") fg = [+p[2], +p[3], +p[4]];
      else if (p[0] === "48" && p[1] === "2") bg = [+p[2], +p[3], +p[4]];
      else if (p[0] === "" || p[0] === "0") { fg = [255, 255, 255]; bg = [0, 0, 0]; }
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

const g = frames[WANT];
if (!g) {
  console.error(`no frame ${WANT} (only ${frames.length})`);
  process.exit(1);
}

// Each cell contributes two pixel rows: the foreground is the upper one and the
// background the lower, so both halves of the glyph come back out.
const px = (col, row) => {
  const c = row >> 1;
  const o = (c * COLS + col) * 6 + (row & 1 ? 3 : 0);
  return isInk(g[o], g[o + 1], g[o + 2]);
};

const out = [];
for (let r = 0; r < CH * 2; r++) {
  let s = String(CY * 2 + r).padStart(3) + " ";
  for (let c = 0; c < CW; c++) s += px(CX + c, CY * 2 + r) ? "#" : ".";
  out.push(s);
}
console.log(`frame ${WANT}, cells (${CX},${CY}) ${CW}x${CH}, ink #${INK.map((v) => v.toString(16).padStart(2, "0")).join("")}`);
console.log(out.join("\n"));