// giffcheck.mjs -- decode a GIF back to pixels and compare with the source
// frames, so a wrong LZW stream shows up as a mismatch rather than as "the
// image will not open".
import { readFileSync } from "node:fs";

function decode(buf) {
  if (buf.toString("latin1", 0, 6) !== "GIF89a") throw new Error("not a GIF");
  let p = 6;
  const w = buf.readUInt16LE(p);
  const h = buf.readUInt16LE(p + 2);
  const packed = buf[p + 4];
  p = 13;                                   // 6 header + 7 logical screen desc
  const gctSize = (packed & 0x80) ? 2 << (packed & 7) : 0;
  const pal = [];
  for (let i = 0; i < gctSize; i++) pal.push([buf[p + i * 3], buf[p + i * 3 + 1], buf[p + i * 3 + 2]]);
  p += gctSize * 3;

  const frames = [];
  let delay = 0;
  while (p < buf.length) {
    const b = buf[p];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = buf[p + 1];
      p += 2;
      if (label === 0xf9) {
        delay = buf.readUInt16LE(p + 2);
      }
      // skip sub-blocks
      while (buf[p] !== 0) p += buf[p] + 1;
      p += 1;
      continue;
    }
    if (b === 0x2c) {
      const fw = buf.readUInt16LE(p + 5);
      const fh = buf.readUInt16LE(p + 7);
      const ipacked = buf[p + 9];
      p += 10;
      if (ipacked & 0x80) p += 3 * (2 << (ipacked & 7));
      const minCode = buf[p++];
      const data = [];
      while (buf[p] !== 0) {
        const n = buf[p];
        for (let i = 1; i <= n; i++) data.push(buf[p + i]);
        p += n + 1;
      }
      p += 1;
      frames.push({ w: fw, h: fh, delay, data, minCode });
      continue;
    }
    throw new Error(`unexpected block 0x${b.toString(16)} at ${p}`);
  }
  return { w, h, pal, frames };
}

function lzwDecode(data, minCode, npix) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let codeSize = minCode + 1;
  let dict = [];
  const reset = () => {
    dict = new Array(clear + 2);
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[eoi] = [];
    codeSize = minCode + 1;
  };
  reset();

  const out = [];
  let acc = 0, bits = 0, pos = 0;
  let prev = null;
  const read = () => {
    while (bits < codeSize) {
      if (pos >= data.length) return eoi;
      acc |= data[pos++] << bits;
      bits += 8;
    }
    const code = acc & ((1 << codeSize) - 1);
    acc >>= codeSize;
    bits -= codeSize;
    return code;
  };
  for (;;) {
    const code = read();
    if (code === eoi) break;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (code === dict.length && prev) entry = prev.concat([prev[0]]);
    else throw new Error(`bad code ${code} (dict ${dict.length}) at pixel ${out.length}`);
    out.push(...entry);
    if (prev) {
      dict.push(prev.concat([entry[0]]));
      if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = entry;
    if (out.length >= npix) break;
  }
  return out;
}

const g = decode(readFileSync(process.argv[2]));
console.log(`screen ${g.w}x${g.h}, palette ${g.pal.length}, frames ${g.frames.length}`);
let bad = 0;
for (let f = 0; f < g.frames.length; f++) {
  const fr = g.frames[f];
  let px;
  try {
    px = lzwDecode(fr.data, fr.minCode, fr.w * fr.h);
  } catch (e) {
    console.log(`  frame ${f}: LZW ERROR ${e.message}`);
    bad++;
    continue;
  }
  if (px.length !== fr.w * fr.h) {
    console.log(`  frame ${f}: got ${px.length} pixels, want ${fr.w * fr.h}`);
    bad++;
    continue;
  }
  for (let i = 0; i < px.length; i++) {
    if (!g.pal[px[i]]) {
      console.log(`  frame ${f}: palette index ${px[i]} out of range`);
      bad++;
      break;
    }
  }
}
console.log(bad === 0 ? "every frame decodes cleanly" : `${bad} bad frame(s)`);