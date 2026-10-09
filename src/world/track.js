/* =========================================================
   Track — a closed racing circuit built from a Catmull-Rom
   spline. Provides:
     • arc-length sampled centreline with frames + curvature
     • fast O(1) world → track projection (spatial hash)
     • road / kerb / line / verge / guardrail geometry
     • a smoothed racing line + physics speed profile for the AI
   ========================================================= */
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../util/math.js';
import { Noise } from '../util/noise.js';
import * as TEX from './textures.js';

const ROAD_HALF = 7.4;          // half road width (m)
const KERB_W = 1.7;
const VERGE_W = 2.6;
const CROWN = 0.13;             // road camber at the centre line
const ROAD_CLEARANCE = 0.07;    // ground sits this far below the circuit near the road
const GRID_CELL = 20;
const STAMP_RADIUS = 56;

const noise = new Noise(9081);

/* ------------------------------------------------------------------ */
/* Track layouts                                                       */
/* ------------------------------------------------------------------ */
export const TRACKS = {
  sunset: {
    name: 'SUNSET RIDGE',
    width: ROAD_HALF,
    hillAmp: 40,
    props: { trees: 0, rocks: 160, stands: true, lights: true, buildings: 0, tufts: 5200, banners: true },
    points: [
      [-320, 20, 0], [-280, -60, 0], [-170, -130, 0], [-40, -165, 0],
      [80, -160, 0], [190, -120, 3], [260, -40, 6], [280, 50, 8],
      [220, 130, 10], [130, 190, 12], [20, 210, 10], [-80, 190, 7],
      [-60, 120, 4], [-110, 80, 2], [-170, 90, 0], [-250, 70, 0],
    ],
  },
  alpine: {
    name: 'ALPINE PASS',
    width: ROAD_HALF - 0.6,
    hillAmp: 70,
    props: { trees: 0, rocks: 330, stands: false, lights: true, buildings: 0, tufts: 2800, banners: true },
    points: [
      [-260, -80, 0], [-180, -140, 4], [-60, -160, 10], [70, -140, 14],
      [160, -80, 12], [120, 0, 6], [190, 60, 4], [290, 120, 12],
      [280, 220, 20], [170, 260, 22], [70, 230, 16], [-10, 160, 10],
      [-90, 110, 8], [-160, 120, 6], [-230, 60, 2], [-250, -20, 0],
    ],
  },
  night: {
    name: 'NEON NIGHT',
    width: ROAD_HALF - 0.4,
    hillAmp: 4,
    props: { trees: 0, rocks: 60, stands: true, lights: true, buildings: 190, tufts: 1100, banners: true, city: true },
    points: [
      [-150, -170, 0], [40, -195, 0], [170, -155, 0], [225, -60, 0],
      [190, 60, 0], [110, 150, 0], [0, 190, 0], [-120, 150, 0],
      [-185, 60, 0], [-175, -70, 0],
    ],
  },
  desert: {
    name: 'DESERT CRUISER',
    width: ROAD_HALF + 0.6,
    hillAmp: 35,
    props: { trees: 0, rocks: 260, stands: false, lights: false, buildings: 0, tufts: 2400, banners: true },
    points: [
      [-300, 0, 0], [-220, -160, 0], [-40, -210, 0], [140, -160, 0],
      [240, -60, 0], [260, 70, 0], [150, 150, 0], [0, 165, 0],
      [-140, 130, 0], [-230, 80, 0],
    ],
  },
  coast: {
    name: 'COAST ROAD',
    width: ROAD_HALF,
    hillAmp: 14,
    props: { trees: 0, rocks: 90, stands: false, lights: false, buildings: 0, tufts: 1900, banners: true },
    points: [
      [-280, -20, 0], [-140, -130, 2], [40, -170, 4], [200, -140, 2],
      [280, -60, 0], [260, 60, 4], [160, 130, 8], [0, 140, 6],
      [-140, 80, 4], [-240, 40, 0],
    ],
  },
};

/* ------------------------------------------------------------------ */

export class Track {
  constructor(themeKey = 'sunset') {
    this.key = themeKey;
    const T = TRACKS[themeKey];
    this.theme = T;
    this.name = T.name;
    this.halfWidth = T.width;
    this.hillAmp = T.hillAmp;

    this._buildCurve(T.points);
    this._buildSamples();
    this._alignStartLine();
    this._buildGrid();
    this._buildRacingLine();

    this.textures = {
      asphalt: TEX.asphalt(),
      kerb: TEX.kerbTexture(),
      checker: TEX.checkerTexture(),
    };
    this.group = new THREE.Group();
    this.group.name = 'track';
  }

  /* ---------------- curve + samples ---------------- */
  _buildCurve(points) {
    const vecs = points.map((p) => new THREE.Vector3(p[0], p[2] || 0, p[1]));
    this.curve = new THREE.CatmullRomCurve3(vecs, true, 'centripetal', 0.5);
    this.length = this.curve.getLength();
    // curvature check: make sure the road never overlaps itself
    this.minRadius = this._measureMinRadius();
  }

  _measureMinRadius() {
    const pts = this.curve.getSpacedPoints(700);
    let minR = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[(i - 1 + pts.length - 1) % (pts.length - 1)];
      const b = pts[i];
      const c = pts[i + 1];
      const ab = a.distanceTo(b), bc = b.distanceTo(c), ca = c.distanceTo(a);
      const area2 = Math.abs(
        (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)
      );
      if (area2 < 1e-6) continue;
      const R = (ab * bc * ca) / area2;          // circumradius
      if (R < minR) minR = R;
    }
    return minR;
  }

  _buildSamples() {
    const N = Math.max(600, Math.round(this.length / 1.35));
    this.N = N;
    const pts = this.curve.getSpacedPoints(N);
    const P = pts;

    this.px = new Float32Array(N + 1);
    this.py = new Float32Array(N + 1);
    this.pz = new Float32Array(N + 1);
    this.tx = new Float32Array(N + 1);
    this.ty = new Float32Array(N + 1);
    this.tz = new Float32Array(N + 1);
    this.rx = new Float32Array(N + 1);
    this.rz = new Float32Array(N + 1);
    this.heading = new Float32Array(N + 1);
    this.curv = new Float32Array(N + 1);
    this.sArr = new Float32Array(N + 1);

    // arc length
    let s = 0;
    for (let i = 0; i <= N; i++) {
      if (i > 0) s += P[i].distanceTo(P[i - 1]);
      this.sArr[i] = s;
    }
    this.length = s;

    // tangents (3D) + right vector (XZ, flattened)
    for (let i = 0; i <= N; i++) {
      const a = P[(i - 1 + N) % N], b = P[(i + 1) % N];
      let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      this.tx[i] = dx; this.ty[i] = dy; this.tz[i] = dz;

      // right = up × forward  (Y up)
      const l = Math.hypot(dz, dx) || 1;
      this.rx[i] = dz / l; this.rz[i] = -dx / l;

      this.px[i] = P[i].x; this.py[i] = P[i].y; this.pz[i] = P[i].z;
      this.heading[i] = Math.atan2(dx, dz);
    }
    this.px[N] = this.px[0]; this.py[N] = this.py[0]; this.pz[N] = this.pz[0];
    this.tx[N] = this.tx[0]; this.ty[N] = this.ty[0]; this.tz[N] = this.tz[0];
    this.rx[N] = this.rx[0]; this.rz[N] = this.rz[0];
    this.heading[N] = this.heading[0];
    this.sArr[N] = this.length;

    // signed curvature from heading change per metre
    for (let i = 0; i <= N; i++) {
      const a = this.heading[(i - 2 + N) % N];
      const b = this.heading[(i + 2) % N];
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const ds = this.sArr[Math.min(N, i + 2)] - this.sArr[Math.max(0, i - 2)];
      this.curv[i] = ds > 1e-4 ? d / ds : 0;
    }
    this.curv[N] = this.curv[0];
  }


  /**
   * Rotate the sample arrays so s = 0 lands on the straightest stretch of the
   * circuit. The grid, the gantry and the timing line then all sit on a fast
   * section instead of mid-corner.
   */
  _alignStartLine() {
    const N = this.N;
    // smoothed |curvature| over ~90 m
    const sm = new Float32Array(N);
    const R = Math.round(45 / (this.length / N));
    let sum = 0;
    for (let k = -R; k <= R; k++) sum += Math.abs(this.curv[(k + N) % N]);
    for (let i = 0; i < N; i++) {
      sm[i] = sum / (2 * R + 1);
      sum -= Math.abs(this.curv[(i - R + N) % N]);
      sum += Math.abs(this.curv[(i + R + 1) % N]);
    }
    // require a decent run either side, then take the flattest point
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < N; i++) {
      const ahead = sm[(i + Math.round(220 / (this.length / N))) % N];
      const behind = sm[(i - Math.round(220 / (this.length / N)) + N) % N];
      const score = Math.max(sm[i], ahead * 0.9, behind * 0.9);
      if (score < bestScore) { bestScore = score; best = i; }
    }

    const L = this.length;
    const rot = (arr, isLength) => {
      const out = new Float32Array(N + 1);
      for (let i = 0; i < N; i++) {
        let j = i + best;
        let add = 0;
        if (j >= N) { j -= N; add = L; }
        out[i] = arr[j] + (isLength ? add - arr[best] : 0);
      }
      // out[N] must repeat out[0] for the position/heading arrays, but for
      // arc length it has to stay at `length` — project() interpolates
      // sArr[a+1] for the closing segment, and a 0 here would make the last
      // stretch before the start line report arc positions halfway round
      // the circuit.
      out[N] = isLength ? L : out[0];
      return out;
    };

    this.px = rot(this.px); this.py = rot(this.py); this.pz = rot(this.pz);
    this.tx = rot(this.tx); this.ty = rot(this.ty); this.tz = rot(this.tz);
    this.rx = rot(this.rx); this.rz = rot(this.rz);
    this.heading = rot(this.heading); this.curv = rot(this.curv);
    this.sArr = rot(this.sArr, true);
    this.startIndex = best;

    // Ribbon geometry only needs a segment every few metres; the dense samples
    // are kept for physics/projection where the accuracy actually matters.
    this.ribbonStep = Math.max(1, Math.round(3.2 / (this.length / this.N)));
  }

  /* ---------------- spatial hash for projection ---------------- */
  _buildGrid() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.N; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    const pad = 90;
    this.bounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
    this.gw = Math.ceil((this.bounds.maxX - this.bounds.minX) / GRID_CELL) + 1;
    this.gh = Math.ceil((this.bounds.maxZ - this.bounds.minZ) / GRID_CELL) + 1;
    this.grid = new Array(this.gw * this.gh);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = null;

    const stamp = (cx, cz, i) => {
      const gy = Math.floor((cz - this.bounds.minZ) / GRID_CELL);
      const gx = Math.floor((cx - this.bounds.minX) / GRID_CELL);
      if (gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh) return;
      const k = gy * this.gw + gx;
      (this.grid[k] || (this.grid[k] = [])).push(i);
    };
    for (let i = 0; i < this.N; i++) {
      stamp(this.px[i], this.pz[i], i);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        stamp(this.px[i] + Math.cos(ang) * STAMP_RADIUS, this.pz[i] + Math.sin(ang) * STAMP_RADIUS, i);
      }
    }
  }

  /**
   * Project a world position onto the centreline.
   * Returns { i, s, lateral, y, curv, heading, onTrack } (object reused).
   */
  project(x, z, out = {}) {
    const gx = Math.floor((x - this.bounds.minX) / GRID_CELL);
    const gz = Math.floor((z - this.bounds.minZ) / GRID_CELL);
    let best = -1, bestD = Infinity;

    const consider = (i) => {
      const dx = x - this.px[i], dz = z - this.pz[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    };

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx, cz = gz + dy;
        if (cx < 0 || cz < 0 || cx >= this.gw || cz >= this.gh) continue;
        const list = this.grid[cz * this.gw + cx];
        if (!list) continue;
        for (let k = 0; k < list.length; k++) consider(list[k]);
      }
    }
    if (best < 0) {
      // far outside the grid — brute force over a decimated set
      for (let i = 0; i < this.N; i += 4) consider(i);
    }

    // refine onto the adjacent segments
    let i0 = best;
    let bestProj = null;
    for (let o = -1; o <= 0; o++) {
      const a = ((i0 + o) % this.N + this.N) % this.N;
      const b = (a + 1) % this.N;
      const ax = this.px[a], az = this.pz[a];
      const bx = this.px[b], bz = this.pz[b];
      const ex = bx - ax, ez = bz - az;
      const l2 = ex * ex + ez * ez || 1;
      let t = ((x - ax) * ex + (z - az) * ez) / l2;
      t = clamp(t, 0, 1);
      const cx = ax + ex * t, cz = az + ez * t;
      const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (!bestProj || d < bestProj.d) bestProj = { d, a, t, cx, cz };
    }

    const { a, t, cx, cz } = bestProj;
    const i = t >= 0.5 ? (a + 1) % this.N : a;
    const s = this.sArr[a] + t * (this.sArr[a + 1] - this.sArr[a]);
    const rx = this.rx[a], rz = this.rz[a];
    // perpendicular distance from the query point to the projected centreline
    // point. (Using the segment start here would dot an along-track offset
    // with the normal and always come out ~0.)
    const lateral = (x - cx) * rx + (z - cz) * rz;
    const y = lerp(this.py[a], this.py[a + 1], t);

    out.i = i;
    out.s = s;
    out.lateral = lateral;
    out.y = y;
    out.curv = this.curv[i];
    out.heading = this.heading[i];
    out.tx = this.tx[i]; out.ty = this.ty[i]; out.tz = this.tz[i];
    out.rx = rx; out.rz = rz;
    return out;
  }

  /* ---------------- heights ---------------- */
  /**
   * Terrain height (ground) including hills, blended flat near the track.
   *
   * The terrain is a coarse polar grid whose triangles are metres across, so
   * the interpolated surface between sample points can sit slightly *above* the
   * tarmac even where every sample is below it. At long range that is enough to
   * win the depth test and show grass through the road (depth precision at
   * 200 m is only a few millimetres). ROAD_CLEARANCE sinks the ground just
   * under the circuit to give the interpolation error somewhere to go; it fades
   * out with the same blend as the hills, so open country is unaffected.
   */
  groundHeight(x, z, proj) {
    const p = proj || this.project(x, z, this._tmpProj || (this._tmpProj = {}));
    const d = Math.abs(p.lateral);
    const blend = smoothstep(this.halfWidth + VERGE_W, this.halfWidth + VERGE_W + 150, d);
    const drop = ROAD_CLEARANCE * (1 - blend);
    if (blend <= 0.0001) return p.y - drop;
    const h =
      (noise.fbm(x * 0.0017, z * 0.0017, 4) * 0.62 +
        (noise.ridged(x * 0.00085 + 11, z * 0.00085, 3) - 0.42) * 0.7) * this.hillAmp;
    const flat = p.y + h * blend;
    return flat - drop;
  }

  /** Road surface height at a lateral offset (includes camber). */
  roadHeight(baseY, lateral) {
    const t = clamp(lateral / this.halfWidth, -1, 1);
    return baseY + CROWN * (1 - t * t);
  }

  /**
   * Full surface query used by the physics.
   * → { y, grip, bump, kind, lateral, s, i, onRoad }
   */
  surface(x, z, out = {}) {
    const p = this.project(x, z, this._surfTmp || (this._surfTmp = {}));
    const lat = p.lateral;
    const ad = Math.abs(lat);
    const hw = this.halfWidth;
    out.i = p.i; out.s = p.s; out.lateral = lat; out.curv = p.curv;
    out.tx = p.tx; out.ty = p.ty; out.tz = p.tz; out.heading = p.heading;
    out.rx = p.rx; out.rz = p.rz;
    out.centerY = p.y;

    let y, grip, bump = 0, kind;
    if (ad <= hw) {
      y = this.roadHeight(p.y, lat);
      grip = 1.0; kind = 'road';
    } else if (ad <= hw + KERB_W && Math.abs(p.curv) > 0.0035) {
      y = this.roadHeight(p.y, Math.sign(lat) * hw) + 0.09;
      grip = 0.74; kind = 'kerb';
      bump = 0.09 * (1 - (ad - hw) / KERB_W);
    } else if (ad <= hw + VERGE_W) {
      y = p.y - 0.02;
      grip = 0.55; kind = 'verge';
    } else {
      y = this.groundHeight(x, z, p);
      grip = 0.46; kind = 'grass';
    }
    out.y = y; out.grip = grip; out.bump = bump; out.kind = kind;
    out.onRoad = ad <= hw + KERB_W;
    return out;
  }

  /** World position of a point on the racing surface. */
  pointAt(s, lateral = 0, target = new THREE.Vector3()) {
    const N = this.N;
    let i = Math.floor((s / this.length) * N) % N;
    if (i < 0) i += N;
    const f = (s / this.length) * N - Math.floor((s / this.length) * N);
    const j = (i + 1) % N;
    const y = this.roadHeight(lerp(this.py[i], this.py[j], f), lateral);
    target.set(
      lerp(this.px[i], this.px[j], f) + this.rx[i] * lateral,
      y,
      lerp(this.pz[i], this.pz[j], f) + this.rz[i] * lateral
    );
    return target;
  }

  tangentAt(s, target = new THREE.Vector3()) {
    const N = this.N;
    let i = Math.floor((s / this.length) * N) % N;
    if (i < 0) i += N;
    target.set(this.tx[i], this.ty[i], this.tz[i]);
    return target;
  }

  /** Wrap an arc length into [0, length). */
  wrapS(s) {
    s %= this.length;
    return s < 0 ? s + this.length : s;
  }

  /* ---------------- racing line + speed profile ---------------- */
  _buildRacingLine() {
    const N = this.N;
    const maxOff = this.halfWidth * 0.55;
    let off = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      off[i] = clamp(this.curv[i] * 260, -maxOff, maxOff);
    }
    // heavy circular smoothing → apex-in / exit-out shape
    for (let pass = 0; pass < 26; pass++) {
      const next = new Float32Array(N);
      const R = 16;
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += off[(k + N) % N];
      for (let i = 0; i < N; i++) {
        next[i] = sum / (2 * R + 1);
        sum -= off[(i - R + N) % N];
        sum += off[(i + R + 1) % N];
      }
      off = next;
    }
    this.lineOffset = off;
    this.lineOffset[N] = off[0];

    // speed profile: corner limit → backward brake pass → forward traction pass
    const v = new Float32Array(N + 1);
    // A_LAT sits just under the grip the tyre model can actually deliver
    // (gripFront*g * (1+downforce) peaks near 18 m/s^2) so the AI keeps a
    // little margin to react instead of driving on the edge of adhesion.
    const A_LAT = 17.0, A_BRAKE = 17.0, A_ACC = 9.0, V_MAX = 90;
    for (let i = 0; i < N; i++) {
      const k = Math.abs(this.curv[i]);
      const vc = k > 1e-4 ? Math.sqrt(A_LAT / k) : V_MAX;
      v[i] = Math.min(V_MAX, vc);
    }
    const ds = this.length / N;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const nx = v[(i + 1) % N];
        v[i] = Math.min(v[i], Math.sqrt(nx * nx + 2 * A_BRAKE * ds));
      }
      for (let i = 0; i < N; i++) {
        const nx = v[(i - 1 + N) % N];
        v[i] = Math.min(v[i], Math.sqrt(nx * nx + 2 * A_ACC * ds));
      }
    }
    this.lineSpeed = v;
    this.lineSpeed[N] = v[0];
  }

  /* ---------------- geometry ---------------- */
  build(onProgress) {
    const g = this.group;
    const N = this.N;
    const hw = this.halfWidth;

    /* ---- road surface ---- */
    const COLS = 6;
    // Only every rStep-th track sample carries a row of vertices, so the
    // ribbon is addressed by *row*, not by track sample. Addressing it by the
    // sample (i, i+1) stitches each filled row to an unfilled one whose
    // vertices are still (0,0,0): the tarmac tears open and the terrain shows
    // through it. Sizing the buffers by rows also keeps the dead samples out.
    const rStep = this.ribbonStep;
    const rows = [];
    for (let i = 0; i <= N; i += rStep) rows.push(Math.min(i, N));

    const vCount = rows.length * (COLS + 1);
    const pos = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    const col = new Float32Array(vCount * 3);
    const idx = new Uint32Array((rows.length - 1) * COLS * 6);
    const c = new THREE.Color();

    for (let r = 0; r < rows.length; r++) {
      const i = rows[r];
      for (let j = 0; j <= COLS; j++) {
        const lat = lerp(-hw, hw, j / COLS);
        const k = r * (COLS + 1) + j;
        pos[k * 3] = this.px[i] + this.rx[i] * lat;
        pos[k * 3 + 1] = this.roadHeight(this.py[i], lat);
        pos[k * 3 + 2] = this.pz[i] + this.rz[i] * lat;
        uv[k * 2] = (lat / 9 + 0.5) * 2.2;
        uv[k * 2 + 1] = this.sArr[i] / 9;

        // rubbered-in racing line, lighter dusty edges
        const lineK = clamp(1 - Math.abs(lat - this.lineOffset[i]) / 3.4, 0, 1);
        const edge = smoothstep(hw * 0.72, hw, Math.abs(lat));
        let shade = 1.06 - lineK * 0.16 + edge * 0.12;
        shade *= 0.94 + 0.12 * (noise.noise2(this.sArr[i] * 0.05, lat * 0.4) * 0.5 + 0.5);
        c.setRGB(shade, shade, shade);
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
    }
    let t = 0;
    for (let r = 0; r < rows.length - 1; r++) {
      for (let j = 0; j < COLS; j++) {
        const a = r * (COLS + 1) + j, b = a + 1;
        const cc = (r + 1) * (COLS + 1) + j, d = cc + 1;
        idx[t++] = a; idx[t++] = cc; idx[t++] = b;
        idx[t++] = b; idx[t++] = cc; idx[t++] = d;
      }
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    roadGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    roadGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    roadGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    roadGeo.computeVertexNormals();

    const roadMat = new THREE.MeshStandardMaterial({
      map: this.textures.asphalt.map,
      normalMap: this.textures.asphalt.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.08,
      envMapIntensity: 0.55,
      dithering: true,
      // The terrain is a coarse polar grid, so a handful of its big triangles
      // interpolate a few millimetres above the tarmac on steep sections. Bias
      // the road toward the camera so the surface always wins, the same way the
      // line ribbons and kerb markings already do.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    roadMat.map.repeat.set(1, 1);
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.receiveShadow = true;
    road.renderOrder = 0;
    g.add(road);
    this.roadMesh = road;
    onProgress && onProgress(0.15);

    /* ---- edge lines + centre dashes ---- */
    g.add(this._buildLineRibbon(-hw + 0.42, -hw + 0.62, 0xffffff, 0.55));
    g.add(this._buildLineRibbon(hw - 0.62, hw - 0.42, 0xffffff, 0.55));
    g.add(this._buildCentreDashes());

    /* ---- kerbs on the corners ---- */
    g.add(this._buildKerbs());

    /* ---- verge / apron ---- */
    g.add(this._buildVerge());

    /* ---- start / finish ---- */
    g.add(this._buildStartLine());
    this.gantry = this._buildGantry();
    g.add(this.gantry.group);
    onProgress && onProgress(0.45);

    /* ---- guardrails + banners + tyre walls ---- */
    const rails = this._buildGuardrails();
    g.add(rails);
    onProgress && onProgress(0.7);

    /* ---- run-off area markings (optional) ---- */
    this.startS = 0;
    return g;
  }

  _buildLineRibbon(latA, latB, color, opacity = 1) {
    const step = this.ribbonStep;
    const N = Math.ceil(this.N / step);
    const pos = new Float32Array((N + 1) * 2 * 3);
    const uv = new Float32Array((N + 1) * 2 * 2);
    const idx = new Uint32Array(N * 6);
    for (let i = 0; i <= N; i++) {
      const si = Math.min(this.N, i * step);
      for (let e = 0; e < 2; e++) {
        const lat = e ? latB : latA;
        const k = (i * 2 + e) * 3;
        pos[k] = this.px[si] + this.rx[si] * lat;
        pos[k + 1] = this.roadHeight(this.py[si], Math.sign(lat) * this.halfWidth) + 0.012;
        pos[k + 2] = this.pz[si] + this.rz[si] * lat;
        uv[(i * 2 + e) * 2] = e;
        uv[(i * 2 + e) * 2 + 1] = this.sArr[si];
      }
    }
    let t = 0;
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.55, metalness: 0.0,
      transparent: opacity < 1, opacity,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      envMapIntensity: 0.7,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 1;
    return m;
  }

  _buildCentreDashes() {
    const N = this.N;
    const ds = 1.35;
    const startI = Math.floor(14 / (this.length / N));
    const parts = [];
    const posArr = [], idxArr = [], uvArr = [];
    let vbase = 0;
    for (let i = startI; i < N; i += Math.round(11 / ds)) {
      const len = Math.round(4.4 / ds);
      for (let k = 0; k < len; k++) {
        const a = (i + k) % N, b = (i + k + 1) % N;
        const w = 0.13;
        const p = [
          [this.px[a] - this.rx[a] * w, this.roadHeight(this.py[a], 0) + 0.012, this.pz[a] - this.rz[a] * w],
          [this.px[a] + this.rx[a] * w, this.roadHeight(this.py[a], 0) + 0.012, this.pz[a] + this.rz[a] * w],
          [this.px[b] - this.rx[b] * w, this.roadHeight(this.py[b], 0) + 0.012, this.pz[b] - this.rz[b] * w],
          [this.px[b] + this.rx[b] * w, this.roadHeight(this.py[b], 0) + 0.012, this.pz[b] + this.rz[b] * w],
        ];
        for (const q of p) posArr.push(q[0], q[1], q[2]);
        uvArr.push(0, 0, 1, 0, 0, 1, 1, 1);
        idxArr.push(vbase, vbase + 2, vbase + 1, vbase + 1, vbase + 2, vbase + 3);
        vbase += 4;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    geo.setIndex(idxArr);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xf0f2f6, roughness: 0.5,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
  }

  /** Red/white kerbs wherever the corner is meaningful. */
  _buildKerbs() {
    const N = this.N;
    const mask = new Uint8Array(N + 1);
    for (let i = 0; i < N; i++) {
      mask[i] = Math.abs(this.curv[i]) > 0.0038 ? 1 : 0;
    }
    // dilate / erode so kerbs start a little before the corner
    for (let p = 0; p < 26; p++) {
      const next = new Uint8Array(N + 1);
      for (let i = 0; i < N; i++) {
        const a = mask[(i - 1 + N) % N], b = mask[i], c = mask[(i + 1) % N];
        next[i] = a || b || c ? 1 : 0;
      }
      next[N] = next[0];
      mask.set(next);
    }
    for (let p = 0; p < 4; p++) {
      const next = new Uint8Array(N + 1);
      for (let i = 0; i < N; i++) {
        const a = mask[(i - 1 + N) % N], b = mask[i], c = mask[(i + 1) % N];
        next[i] = a && b && c ? 1 : 0;
      }
      next[N] = next[0];
      mask.set(next);
    }

    const quads = [];
    const posArr = [], uvArr = [], idxArr = [];
    let vbase = 0;
    for (let i = 0; i < N; i++) {
      if (!mask[i]) continue;
      const sign = this.curv[i] >= 0 ? 1 : -1;   // inside of the corner
      const other = -sign;
      for (const side of [sign, other]) {
        const a = i, b = i + 1;
        const la = this.halfWidth * side, lb = (this.halfWidth + KERB_W) * side;
        const ya = this.roadHeight(this.py[a], la), yb = this.roadHeight(this.py[b], lb);
        const p = [
          [this.px[a] + this.rx[a] * la, ya + 0.015, this.pz[a] + this.rz[a] * la],
          [this.px[a] + this.rx[a] * lb, ya + 0.10, this.pz[a] + this.rz[a] * lb],
          [this.px[b] + this.rx[b] * la, yb + 0.015, this.pz[b] + this.rz[b] * la],
          [this.px[b] + this.rx[b] * lb, yb + 0.10, this.pz[b] + this.rz[b] * lb],
        ];
        for (const q of p) posArr.push(q[0], q[1], q[2]);
        const v0 = this.sArr[a] / 2.4, v1 = this.sArr[b] / 2.4;
        uvArr.push(0, v0, 1, v0, 0, v1, 1, v1);
        if (side === sign) {
          idxArr.push(vbase, vbase + 2, vbase + 1, vbase + 1, vbase + 2, vbase + 3);
        } else {
          idxArr.push(vbase, vbase + 1, vbase + 2, vbase + 1, vbase + 3, vbase + 2);
        }
        vbase += 4;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    geo.setIndex(idxArr);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: this.textures.kerb, roughness: 0.5, metalness: 0.0,
      side: THREE.DoubleSide, envMapIntensity: 0.8,
    });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    m.receiveShadow = true;
    return m;
  }

  /** Grass apron that hides the seam between road and terrain. */
  _buildVerge() {
    const N = this.N;
    const posArr = [], uvArr = [], idxArr = [], colArr = [];
    const inner = this.halfWidth, outer = this.halfWidth + VERGE_W;
    let vbase = 0;
    const c = new THREE.Color();
    const vStep = this.ribbonStep;
    for (let i = 0; i < N; i += vStep) {
      // i + vStep can overshoot the last sample when N is not a multiple of
      // vStep, and px[N + 1] does not exist - reading it yields undefined,
      // which turns the whole geometry into NaN.
      const a = i, b = Math.min(this.N, i + vStep);
      for (const side of [1, -1]) {
        const ia = inner * side, ib = outer * side;
        const ya = this.py[a], yb = this.py[b];
        const p = [
          [this.px[a] + this.rx[a] * ia, ya + 0.005, this.pz[a] + this.rz[a] * ia],
          [this.px[a] + this.rx[a] * ib, ya - 0.06, this.pz[a] + this.rz[a] * ib],
          [this.px[b] + this.rx[b] * ia, yb + 0.005, this.pz[b] + this.rz[b] * ia],
          [this.px[b] + this.rx[b] * ib, yb - 0.06, this.pz[b] + this.rz[b] * ib],
        ];
        for (const q of p) posArr.push(q[0], q[1], q[2]);
        const v0 = this.sArr[a] / 6, v1 = this.sArr[b] / 6;
        uvArr.push(0, v0, 1.6, v0, 0, v1, 1.6, v1);
        const shade = 0.85 + noise.noise2(this.sArr[a] * 0.08, side) * 0.12;
        for (let k = 0; k < 4; k++) colArr.push(shade, shade, shade);
        idxArr.push(vbase, vbase + 2, vbase + 1, vbase + 1, vbase + 2, vbase + 3);
        vbase += 4;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
    geo.setIndex(idxArr);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: this.theme.vergeColor || 0x4a6b32, roughness: 0.95, metalness: 0,
      vertexColors: true,
    }));
  }

  _buildStartLine() {
    const N = this.N;
    const ds = 1.35;
    const startI = Math.floor(2.4 / ds);
    const lenI = Math.round(2.6 / ds);
    const posArr = [], uvArr = [], idxArr = [];
    let vbase = 0;
    for (let k = 0; k < lenI; k++) {
      const a = (startI + k) % N, b = (startI + k + 1) % N;
      const p = [
        [this.px[a] - this.rx[a] * this.halfWidth, this.roadHeight(this.py[a], -this.halfWidth) + 0.014, this.pz[a] - this.rz[a] * this.halfWidth],
        [this.px[a] + this.rx[a] * this.halfWidth, this.roadHeight(this.py[a], this.halfWidth) + 0.014, this.pz[a] + this.rz[a] * this.halfWidth],
        [this.px[b] - this.rx[b] * this.halfWidth, this.roadHeight(this.py[b], -this.halfWidth) + 0.014, this.pz[b] - this.rz[b] * this.halfWidth],
        [this.px[b] + this.rx[b] * this.halfWidth, this.roadHeight(this.py[b], this.halfWidth) + 0.014, this.pz[b] + this.rz[b] * this.halfWidth],
      ];
      for (const q of p) posArr.push(q[0], q[1], q[2]);
      uvArr.push(0, k / 2, 1, k / 2, 0, k / 2 + 0.5, 1, k / 2 + 0.5);
      idxArr.push(vbase, vbase + 2, vbase + 1, vbase + 1, vbase + 2, vbase + 3);
      vbase += 4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    geo.setIndex(idxArr);
    geo.computeVertexNormals();
    const tex = this.textures.checker.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 1);
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.6,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
  }

  _buildGantry() {
    const i = 0;
    const hw = this.halfWidth;
    const group = new THREE.Group();
    const baseY = this.py[i];
    const cx = this.px[i], cz = this.pz[i], rx = this.rx[i], rz = this.rz[i];
    const hx = this.tx[i], hz = this.tz[i];

    const pillarGeo = new THREE.BoxGeometry(1.5, 9.2, 1.5);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3c, roughness: 0.55, metalness: 0.7 });
    for (const side of [1, -1]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(cx + rx * (hw + 3.2) * side, baseY + 4.6, cz + rz * (hw + 3.2) * side);
      p.rotation.y = Math.atan2(hx, hz);
      p.castShadow = true;
      group.add(p);
      // foot
      const f = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 2.6), pillarMat);
      f.position.set(p.position.x, baseY + 0.25, p.position.z);
      f.rotation.y = p.rotation.y;
      group.add(f);
    }

    const beam = new THREE.Mesh(
      new THREE.BoxGeometry((hw + 3.2) * 2, 2.5, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x1a1e28, roughness: 0.5, metalness: 0.6 })
    );
    beam.position.set(cx, baseY + 9.4, cz);
    beam.rotation.y = Math.atan2(hx, hz);
    beam.castShadow = true;
    group.add(beam);

    // printed sign
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry((hw + 3.2) * 2 - 0.6, 2.1),
      new THREE.MeshStandardMaterial({
        map: TEX.gantryTexture(), roughness: 0.45, metalness: 0.1,
        emissive: 0xffffff, emissiveMap: TEX.gantryTexture(), emissiveIntensity: 0.32,
      })
    );
    sign.position.set(cx - hx * 0.42, baseY + 9.4, cz - hz * 0.42);
    sign.rotation.y = Math.atan2(hx, hz) + Math.PI;
    group.add(sign);

    // start lights
    const lights = [];
    const lightMat = () => new THREE.MeshStandardMaterial({
      color: 0x2a0a0a, emissive: 0xff2200, emissiveIntensity: 0, roughness: 0.3,
    });
    for (let k = 0; k < 5; k++) {
      const off = (k - 2) * 1.15;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), lightMat());
      bulb.position.set(
        cx - hx * 0.5 + rx * off, baseY + 8.1, cz - hz * 0.5 + rz * off
      );
      group.add(bulb);
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12, 1, true), pillarMat);
      hood.position.copy(bulb.position);
      hood.position.x += hx * 0.1; hood.position.z += hz * 0.1;
      hood.rotation.z = Math.PI / 2;
      hood.rotation.y = Math.atan2(hx, hz);
      group.add(hood);
      lights.push(bulb);
    }

    return { group, lights, baseY, index: i };
  }

  setStartLights(stage) {
    // stage: 0 = all off, 1..3 = that many reds, 4 = green
    this.gantry.lights.forEach((b, k) => {
      const m = b.material;
      if (stage === 4) {
        m.color.setHex(0x0a2a12); m.emissive.setHex(0x22ff55); m.emissiveIntensity = 3.2;
      } else if (k < stage) {
        m.color.setHex(0x2a0a0a); m.emissive.setHex(0xff2200); m.emissiveIntensity = 3.0;
      } else {
        m.color.setHex(0x2a0a0a); m.emissive.setHex(0xff2200); m.emissiveIntensity = 0;
      }
    });
  }

  _buildGuardrails() {
    const group = new THREE.Group();
    const N = this.N;
    const off = this.halfWidth + VERGE_W + 2.6;
    const railH = 1.0;

    // The barrier the physics enforces (see Vehicle._step) is present around
    // the whole circuit, so a partial rail only meant hitting an invisible wall
    // on the stretches that had none. Armco runs the full lap.
    const use = new Uint8Array(N + 1).fill(1);
    use[N] = 1;

    // Sponsor banners stay on the corners and the start/finish approaches —
    // running them the whole way round reads as spam and hides the scenery.
    const bannerUse = new Uint8Array(N + 1);
    for (let i = 0; i < N; i++) {
      const k = Math.abs(this.curv[i]);
      const near = Math.min(this.sArr[i], this.length - this.sArr[i]);
      if (k > 0.0022 || (k < 0.0012 && near > 60)) bannerUse[i] = 1;
    }
    for (let i = 0; i < N; i++) if (!bannerUse[i] && bannerUse[(i - 1 + N) % N] && bannerUse[(i + 1) % N]) bannerUse[i] = 1;
    bannerUse[N] = bannerUse[0];

    const postGeo = new THREE.BoxGeometry(0.16, 1.5, 0.22);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x585d68, roughness: 0.6, metalness: 0.75 });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xb8bdc8, roughness: 0.42, metalness: 0.9,
      envMapIntensity: 1.2, side: THREE.DoubleSide,
    });

    const posArr = [], uvArr = [], idxArr = [], nrmArr = [];
    let vbase = 0;
    const bannerPos = [], bannerUv = [], bannerIdx = [];
    let bbase = 0;

    const rStep = this.ribbonStep;
    const addStrip = (side, yLo, yHi, uRep) => {
      let runStart = -1;
      const flushRun = (a, b) => {
        if (b - a < 2) return;
        for (let i = a; i <= b; i += rStep) {
          const i0 = i, i1 = Math.min(this.N, i + rStep);
          // yLo/yHi are heights *above the ground*, not world Y. The circuit
          // climbs and drops by several metres, so a fixed world Y buried the
          // beam under the terrain wherever the track was high and left it
          // floating where the track was low — posts with no rail between them.
          // Plant the beam on the same ground the posts stand on.
          const x0 = this.px[i0] + this.rx[i0] * off * side;
          const z0 = this.pz[i0] + this.rz[i0] * off * side;
          const x1 = this.px[i1] + this.rx[i1] * off * side;
          const z1 = this.pz[i1] + this.rz[i1] * off * side;
          const y0 = this.groundHeight(x0, z0);
          const y1 = this.groundHeight(x1, z1);
          const p0 = [
            [x0, y0 + yLo, z0],
            [x0, y0 + yHi, z0],
            [x1, y1 + yLo, z1],
            [x1, y1 + yHi, z1],
          ];
          for (const q of p0) posArr.push(q[0], q[1], q[2]);
          const v0 = this.sArr[i0] / uRep, v1 = this.sArr[i1] / uRep;
          uvArr.push(0, v0, 0, v0 + 0.1, 1, v1, 1, v1 + 0.1);
          if (side > 0) idxArr.push(vbase, vbase + 2, vbase + 1, vbase + 1, vbase + 2, vbase + 3);
          else idxArr.push(vbase, vbase + 1, vbase + 2, vbase + 1, vbase + 3, vbase + 2);
          vbase += 4;
        }
      };
      for (let i = 0; i <= N; i++) {
        if (use[i] && runStart < 0) runStart = i;
        if ((!use[i] || i === N) && runStart >= 0) { flushRun(runStart, i - 1); runStart = -1; }
      }
    };

    const bannerTex = TEX.bannerTexture('APEX VELOCITY', '#0d1018', '#ffffff', '#ff6b2c');
    const addBanner = (side) => {
      const yLo = 0.55, yHi = 1.25;
      let runStart = -1;
      const flushRun = (a, b) => {
        if (b - a < 4) return;
        for (let i = a; i <= b; i += rStep) {
          const i0 = i, i1 = Math.min(this.N, i + rStep);
          // Same ground-relative fix as the rail beam above.
          const x0 = this.px[i0] + this.rx[i0] * off * side;
          const z0 = this.pz[i0] + this.rz[i0] * off * side;
          const x1 = this.px[i1] + this.rx[i1] * off * side;
          const z1 = this.pz[i1] + this.rz[i1] * off * side;
          const y0 = this.groundHeight(x0, z0);
          const y1 = this.groundHeight(x1, z1);
          const p = [
            [x0, y0 + yLo, z0],
            [x0, y0 + yHi, z0],
            [x1, y1 + yLo, z1],
            [x1, y1 + yHi, z1],
          ];
          for (const q of p) bannerPos.push(q[0], q[1], q[2]);
          const v0 = this.sArr[i0] / 14, v1 = this.sArr[i1] / 14;
          bannerUv.push(v0, 0, v0, 1, v1, 0, v1, 1);
          if (side > 0) bannerIdx.push(bbase, bbase + 2, bbase + 1, bbase + 1, bbase + 2, bbase + 3);
          else bannerIdx.push(bbase, bbase + 1, bbase + 2, bbase + 1, bbase + 3, bbase + 2);
          bbase += 4;
        }
      };
      for (let i = 0; i <= N; i++) {
        if (bannerUse[i] && runStart < 0) runStart = i;
        if ((!bannerUse[i] || i === N) && runStart >= 0) { flushRun(runStart, i - 1); runStart = -1; }
      }
    };

    for (const side of [1, -1]) {
      addStrip(side, 0.62, 1.12, 8);
      if (this.theme.props.banners) addBanner(side);
    }

    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    railGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    railGeo.setIndex(idxArr);
    railGeo.computeVertexNormals();
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.castShadow = true;
    rail.receiveShadow = true;
    group.add(rail);

    if (bannerPos.length) {
      const bGeo = new THREE.BufferGeometry();
      bGeo.setAttribute('position', new THREE.Float32BufferAttribute(bannerPos, 3));
      bGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bannerUv, 2));
      bGeo.setIndex(bannerIdx);
      bGeo.computeVertexNormals();
      const bMat = new THREE.MeshStandardMaterial({
        map: bannerTex, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide,
        emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.12,
      });
      group.add(new THREE.Mesh(bGeo, bMat));
    }

    // posts, instanced
    const step = Math.max(1, Math.round(6 / (this.length / N)));
    const slots = [];
    for (let i = 0; i < N; i += step) if (use[i]) slots.push(i);
    const posts = new THREE.InstancedMesh(postGeo, postMat, slots.length * 2);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let k = 0;
    for (const i of slots) {
      for (const side of [1, -1]) {
        const y = this.groundHeight(this.px[i] + this.rx[i] * off * side, this.pz[i] + this.rz[i] * off * side);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading[i]);
        m4.compose(
          new THREE.Vector3(this.px[i] + this.rx[i] * off * side, y + 0.75, this.pz[i] + this.rz[i] * off * side),
          q, new THREE.Vector3(1, 1, 1)
        );
        posts.setMatrixAt(k++, m4);
      }
    }
    posts.count = k;
    posts.instanceMatrix.needsUpdate = true;
    posts.castShadow = true;
    group.add(posts);
    this.barrierOffset = off;

    return group;
  }

  /** Race grid slots behind the start line. */
  gridSlots(count) {
    const out = [];
    const rowGap = 11.5, latGap = 4.3;
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 2);
      const side = i % 2 === 0 ? -1 : 1;
      const s = this.length - 12 - row * rowGap;
      out.push({ s, lateral: side * latGap });
    }
    return out;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          for (const k in m) {
            const v = m[k];
            if (v && v.isTexture) v.dispose();
          }
          m.dispose();
        }
      }
    });
  }
}

export { ROAD_HALF, KERB_W, VERGE_W };
