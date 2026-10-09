// pngread.mjs -- decode the PNG ansi2png wrote and print a few pixels, to
// check the encoder rather than trusting the viewer.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const buf = readFileSync(process.argv[2]);
let p = 8;
let w = 0, h = 0, depth = 0, ctype = 0;
const idat = [];
while (p < buf.length) {
  const len = buf.readUInt32BE(p);
  const type = buf.toString("latin1", p + 4, p + 8);
  const data = buf.subarray(p + 8, p + 8 + len);
  if (type === "IHDR") {
    w = data.readUInt32BE(0);
    h = data.readUInt32BE(4);
    depth = data[8];
    ctype = data[9];
  } else if (type === "IDAT") idat.push(data);
  p += 12 + len;
}
console.log(`${w}x${h} depth=${depth} colourType=${ctype} idat=${idat.reduce((a, b) => a + b.length, 0)}`);
const raw = inflateSync(Buffer.concat(idat));
const bpp = 3;
const stride = w * bpp;
const img = Buffer.alloc(h * stride);
let prev = Buffer.alloc(stride);
for (let y = 0; y < h; y++) {
  const ft = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  const cur = Buffer.alloc(stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? cur[x - bpp] : 0;
    const b = prev[x];
    const c = x >= bpp ? prev[x - bpp] : 0;
    let v = line[x];
    if (ft === 1) v += a;
    else if (ft === 2) v += b;
    else if (ft === 3) v += (a + b) >> 1;
    else if (ft === 4) {
      const pp = a + b - c;
      const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    cur[x] = v & 0xff;
  }
  cur.copy(img, y * stride);
  prev = cur;
}
const at = (x, y) => {
  const o = y * stride + x * bpp;
  return `#${[img[o], img[o + 1], img[o + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};
console.log(`corners: ${at(0, 0)} ${at(w - 1, 0)} ${at(0, h - 1)} ${at(w - 1, h - 1)}`);
for (const fy of [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 0.99]) {
  console.log(`  y=${fy.toFixed(2)} -> ${at(w >> 1, Math.min(h - 1, Math.floor(h * fy)))}`);
}