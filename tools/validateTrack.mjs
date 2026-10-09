/**
 * Offline sanity check for the circuit layouts in src/world/track.js.
 * Re-implements three.js' centripetal Catmull-Rom curve so we can verify
 * corner radius and self-intersection without a browser.
 *
 *   node tools/validateTrack.mjs
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/world/track.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('export const TRACKS'), src.indexOf('/* ------------------------------------------------------------------ */\n\nexport class Track'));
const { TRACKS } = await import('data:text/javascript;base64,' + Buffer.from(
  'const ROAD_HALF = 7.4;\n' +
  block.replace('export const', 'const').replace(/hillAmp:.*\n/g, '').replace(/props:.*\n/g, '')
    + '\nexport { TRACKS };'
).toString('base64'));

/* ---- centripetal Catmull-Rom (mirrors three.js Curve.getPoint) ---- */
const px = (a, b, c, d, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
};
function curvePoint(P, t) {
  const l = P.length;
  const p = l * t;
  const i = Math.floor(p);
  const w = p - i;
  const p0 = P[((i - 1) % l + l) % l], p1 = P[i % l], p2 = P[(i + 1) % l], p3 = P[(i + 2) % l];
  const dt0 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.5) || 1e-4;
  const dt1 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 0.5) || 1e-4;
  const dt2 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), 0.5) || 1e-4;
  return [px(p0[0], p1[0], p2[0], p3[0], (w + dt0) / (dt0 + dt1)),
          px(p0[1], p1[1], p2[1], p3[1], (w + dt0) / (dt0 + dt1))];
}

let fail = false;
for (const [name, T] of Object.entries(TRACKS)) {
  const P = T.points.map((p) => [p[0], p[1]]);
  const N = 1600;
  const S = [];
  let len = 0;
  let prev = curvePoint(P, 0);
  for (let i = 0; i <= N; i++) {
    const c = curvePoint(P, i / N);
    len += Math.hypot(c[0] - prev[0], c[1] - prev[1]);
    S.push(c);
    prev = c;
  }

  // minimum corner radius
  let minR = Infinity, minAt = 0;
  for (let i = 0; i < N; i++) {
    const a = S[(i - 3 + N) % N], b = S[i], c = S[(i + 3) % N];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
    if (area2 < 1e-9) continue;
    const R = (ab * bc * ca) / area2;
    if (R < minR) { minR = R; minAt = i; }
  }

  // self intersection: min distance between parts of the lap > 150 m apart
  const MIN_GAP = 160;  // samples (~150 m of arc)
  let minSep = Infinity, sepAt = 0;
  for (let i = 0; i < N; i += 2) {
    for (let j = i + MIN_GAP; j < N - 4; j += 2) {
      if (Math.min(j - i, N - (j - i)) < MIN_GAP) continue;
      const d = Math.hypot(S[i][0] - S[j][0], S[i][1] - S[j][1]);
      if (d < minSep) { minSep = d; sepAt = i; }
    }
  }

  const bbox = P.reduce((a, p) => [Math.min(a[0], p[0]), Math.max(a[1], p[0]), Math.min(a[2], p[1]), Math.max(a[3], p[1])], [1e9, -1e9, 1e9, -1e9]);
  const okR = minR > 22;
  const okS = minSep > 34;
  if (!okR || !okS) fail = true;
  console.log(
    `${okR && okS ? 'OK  ' : 'BAD '} ${name.padEnd(7)} len=${len.toFixed(0)}m  minRadius=${minR.toFixed(1)}m @${minAt}  minSeparation=${minSep.toFixed(1)}m @${sepAt}  bbox=${bbox.map(Math.round).join(',')}`
  );
  if (!okS) {
    const bad = [];
    for (let i = 0; i < N; i += 2) {
      for (let j = i + MIN_GAP; j < N - 4; j += 2) {
        if (Math.min(j - i, N - (j - i)) < MIN_GAP) continue;
        const d = Math.hypot(S[i][0] - S[j][0], S[i][1] - S[j][1]);
        if (d < 20) bad.push(`      s=${(i * len / N).toFixed(0)}m (${S[i][0].toFixed(0)},${S[i][1].toFixed(0)})  <->  s=${(j * len / N).toFixed(0)}m (${S[j][0].toFixed(0)},${S[j][1].toFixed(0)})  d=${d.toFixed(1)}`);
      }
    }
    console.log(bad.slice(0, 14).join('\n'));
  }
}
process.exit(fail ? 1 : 0);
