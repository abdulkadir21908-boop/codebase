// hudread.mjs -- read the HUD back out of a rendered frame, as text.
//
// The renderer writes a 5x7 font into the pixel framebuffer, so a line of HUD
// text is a run of 5x7 windows with a 1-pixel gap.  Replaying the ANSI stream,
// then matching those windows against tools/genfont.mjs's own glyph table, turns
// the picture back into the string it was drawn from.  That makes "is the HUD
// saying the right thing" a checkable question rather than a squint.
//
//   node tools/hudread.mjs IN COLS ROWS FRAME PX PY [advance] [scale]
//
// PX/PY are framebuffer pixel coordinates.  advance is the pixel step between
// glyphs (6 at scale 1, 12 at scale 2) and scale the glyph size.
import { readFileSync } from "node:fs";

const [, , inFile, colsArg, rowsArg, frameArg, pxArg, pyArg, advArg, scaleArg] =
  process.argv;
const COLS = Number(colsArg ?? 100);
const ROWS = Number(rowsArg ?? 30);
const WANT = Number(frameArg ?? 0);
const PX = Number(pxArg ?? 0);
const PY = Number(pyArg ?? 0);
const ADV = Number(advArg ?? 6);
const SCALE = Number(scaleArg ?? 1);

// ---- the font, read out of font.inc -- the very bytes the game draws from
const GLYPHS = [];
{
  const src = readFileSync(new URL("../font.inc", import.meta.url), "utf8");
  const bytes = [...src.matchAll(/0x([0-9a-f]{2})/gi)].map((m) => parseInt(m[1], 16));
  if (bytes.length !== 64 * 5) {
    console.error(`font.inc gave ${bytes.length} bytes, expected ${64 * 5}`);
    process.exit(1);
  }
  for (let g = 0; g < 64; g++) {
    // column major, bit 0 = top row, so each byte is one 7-row column
    let bits = "";
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        bits += (bytes[g * 5 + col] >> row) & 1 ? "1" : "0";
      }
    }
    GLYPHS.push(String.fromCharCode(32 + g) + "\t" + bits);
  }
}

// ---- replay
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

// framebuffer pixel (x, y).  The text is drawn in one colour and everything
// behind it is scene -- road, kerbs, sky, grass -- none of which matches, so
// "is this pixel ink" is simply "is it the colour the text was drawn in".
const INK = (process.argv[11] ?? "e8f4ff").replace(/^#/, "").match(/../g).map((h) => parseInt(h, 16));
const px = (x, y) => {
  const c = y >> 1;
  if (c < 0 || c >= ROWS || x < 0 || x >= COLS) return [-1, -1, -1];
  const o = (c * COLS + x) * 6 + (y & 1 ? 3 : 0);
  return [g[o], g[o + 1], g[o + 2]];
};
const isInk = (x, y) => {
  const p = px(x, y);
  // exact: the HUD draws each glyph in one flat constant, so anything that is
  // merely close is a sky or road pixel that happened to land near the hue
  return p[0] === INK[0] && p[1] === INK[1] && p[2] === INK[2];
};

const W = 5 * SCALE;
const WIDTH = Number(process.argv[10] ?? 60);   // how many glyph slots to read

// blow a 35-bit row-major glyph up to the same pixel grid the frame was read
// at: every bit becomes a scale-by-scale block, and every row scale rows deep
function expand(bits, scale) {
  if (scale === 1) return bits;
  let out = "";
  for (let r = 0; r < 7; r++) {
    const row = bits.slice(r * 5, r * 5 + 5);
    for (let sy = 0; sy < scale; sy++) {
      for (const b of row) out += b.repeat(scale);
    }
  }
  return out;
}

let out = "";
let unknown = 0;
for (let i = 0; i < WIDTH; i++) {
  const x0 = PX + i * ADV;
  let bits = "";
  for (let r = 0; r < 7; r++) {
    for (let sy = 0; sy < SCALE; sy++) {
      for (let c = 0; c < W; c++) {
        bits += isInk(x0 + c, PY + r * SCALE + sy) ? "1" : "0";
      }
    }
  }
  const entry = GLYPHS.find((g) => expand(g.slice(g.indexOf("\t") + 1), SCALE) === bits);
  const hit = entry ? entry[0] : "?";
  if (hit === "?") unknown++;
  out += hit;
}
console.log(`frame ${WANT} at (${PX},${PY}) scale ${SCALE} advance ${ADV} ink #${INK.map((v) => v.toString(16).padStart(2, "0")).join("")}:`);
console.log(`"${out.replace(/\s+$/, "")}"${unknown ? `   (${unknown} glyph(s) unmatched)` : ""}`);