/* =========================================================
   Scenery — terrain, mountains, trees, rocks, grandstands,
   floodlights, tyre walls and (for the night track) a city.
   Everything is instanced / merged to keep draw calls low.
   ========================================================= */
import * as THREE from 'three';
import { mergeParts } from '../util/geo.js';
import { clamp, lerp, smoothstep, makeRng, randRange } from '../util/math.js';
import { Noise } from '../util/noise.js';
import * as TEX from './textures.js';

const noise = new Noise(4242);

/* ---------------- tiny geometry helpers ---------------- */
function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}
function colorize(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function cyl(rTop, rBot, h, seg, x = 0, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(x, y, z);
  return g;
}

export class Scenery {
  constructor(track, theme, quality) {
    this.track = track;
    this.theme = theme;              // sky / lighting preset
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    this.rng = makeRng(20240607);
    this._proj = {};
    this.terrainHeight = (x, z) => track.groundHeight(x, z);
    // prop budgets scale with the quality preset
    const P = theme.props;
    const s = quality.propScale;
    this.props = Object.assign({}, P, {
      trees: 0,   // trees removed: the user asked for a cleaner, barrier-led look
      rocks: Math.round((P.rocks || 0) * s),
      tufts: Math.round((P.tufts || 0) * s),
      buildings: Math.round((P.buildings || 0) * s),
    });
  }

  build(onProgress) {
    this._buildTerrain();
    onProgress && onProgress(0.55);
    this._buildProps();
    onProgress && onProgress(0.85);
    if (this.props.stands) this._buildGrandstands();
    if (this.props.lights) this._buildFloodlights();
    if (this.props.buildings) this._buildCity();
    this._buildTyreWalls();
    onProgress && onProgress(1);
    return this.group;
  }

  /* ---------------------------------------------------------------- */
  /* Terrain — polar grid, dense near the circuit, huge triangles far out */
  /* ---------------------------------------------------------------- */
  _buildTerrain() {
    const t = this.track;
    const cx = (t.bounds.minX + t.bounds.maxX) / 2;
    const cz = (t.bounds.minZ + t.bounds.maxZ) / 2;
    const RINGS = this.quality.terrainRings;
    const SEGS = this.quality.terrainSegs;
    const RMAX = 3600;
    const EXP = 3.1;

    const vCount = (RINGS + 1) * (SEGS + 1);
    const pos = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    const col = new Float32Array(vCount * 3);
    const c = new THREE.Color();
    const grassLo = new THREE.Color(this.theme.grassLo);
    const grassHi = new THREE.Color(this.theme.grassHi);
    const rock = new THREE.Color(this.theme.rock);
    const snow = new THREE.Color(this.theme.snow || 0xffffff);

    for (let i = 0; i <= RINGS; i++) {
      const r = RMAX * Math.pow(i / RINGS, EXP);
      for (let j = 0; j <= SEGS; j++) {
        const a = (j / SEGS) * Math.PI * 2;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const y = t.groundHeight(x, z);
        const k = i * (SEGS + 1) + j;
        pos[k * 3] = x - cx; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z - cz;
        uv[k * 2] = x / 26; uv[k * 2 + 1] = z / 26;

        // slope drives the rock/grass blend; only worth sampling close in
        let shade, slope;
        if (r < 1500) {
          const h1 = t.groundHeight(x + 6, z);
          const h2 = t.groundHeight(x, z + 6);
          slope = clamp(Math.hypot(h1 - y, h2 - y) / 6, 0, 1.6);
        } else {
          slope = 0.25;
        }
        const n = noise.fbm(x * 0.02, z * 0.02, 2) * 0.5 + 0.5;
        c.copy(grassLo).lerp(grassHi, clamp(n * 0.9 + 0.1, 0, 1));
        c.lerp(rock, smoothstep(0.45, 0.95, slope));
        if (this.theme.snow !== undefined) c.lerp(snow, smoothstep(this.theme.snowLine || 90, (this.theme.snowLine || 90) + 45, y));
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
    }

    const idx = new Uint32Array(RINGS * SEGS * 6);
    let n = 0;
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEGS; j++) {
        const a = i * (SEGS + 1) + j;
        const b = a + 1;
        const d = (i + 1) * (SEGS + 1) + j;
        const e = d + 1;
        // CCW when viewed from above: the polar grid runs outward along i and
        // anticlockwise along j, so a/d/b winds clockwise and leaves every
        // normal pointing at the sky's floor. Faces the other way.
        idx[n++] = a; idx[n++] = b; idx[n++] = d;
        idx[n++] = b; idx[n++] = e; idx[n++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: TEX.grassTexture(),
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: this.theme.terrainEnv ?? 0.4,
      dithering: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.set(cx, 0, cz);
    this.group.add(mesh);
    this.terrain = mesh;
  }

  /* ---------------------------------------------------------------- */
  /* Random point placement near (but not on) the circuit               */
  /* ---------------------------------------------------------------- */
  /**
   * Random point placement near (but not on) the circuit.
   *
   * `radius` is the prop's largest world radius. The guard it feeds is not
   * cosmetic: the offset is taken from one randomly chosen track sample and was
   * never re-validated, so wherever the circuit runs back near itself a point
   * offset 15 m from *that* sample could still be a metre from a *different*
   * stretch of tarmac. Measured on Desert Cruiser: nominal lateral 16.6 m,
   * actual distance to the road 0.31 m — boulders sat on the racing line.
   *
   * So the offset is re-measured with project(), which accounts for the whole
   * circuit, and the prop's whole body is required to clear the road edge.
   */
  _place(minLat, maxLat, maxSlope = 0.55, radius = 0) {
    const t = this.track;
    const need = Math.max(minLat, t.halfWidth + radius + 0.5);
    const pr = {};
    for (let attempt = 0; attempt < 26; attempt++) {
      const i = (this.rng() * t.N) | 0;
      const side = this.rng() < 0.5 ? 1 : -1;
      const lat = side * lerp(need, maxLat, Math.pow(this.rng(), 0.7));
      const x = t.px[i] + t.rx[i] * lat;
      const z = t.pz[i] + t.rz[i] * lat;
      // Re-measure against the entire circuit, not just sample i.
      t.project(x, z, pr);
      if (Math.abs(pr.lateral) < need) continue;
      const y = t.groundHeight(x, z);
      const h1 = t.groundHeight(x + 5, z);
      const h2 = t.groundHeight(x, z + 5);
      const slope = Math.hypot(h1 - y, h2 - y) / 5;
      if (slope > maxSlope) continue;
      return { x, y, z, i, lateral: lat, heading: t.heading[i], slope };
    }
    return null;
  }

  _buildProps() {
    const P = this.props;
    if (P.rocks) this._buildRocks(P.rocks);
    if (P.tufts) this._buildTufts(P.tufts);
  }

  _treeGeometries() {
    if (!this._treeGeo) {
      /* pine — low poly on purpose: there can be a thousand of these */
      const pineParts = [];
      pineParts.push(colorize(cyl(0.16, 0.3, 2.6, 5, 0, 1.3, 0), 0x4a3527));
      for (let i = 0; i < 3; i++) {
        const y = 2.3 + i * 1.9;
        const r = 1.9 - i * 0.5;
        const h = 3.0 - i * 0.4;
        pineParts.push(colorize(cyl(0.05, r, h, 6, 0, y, 0), i < 1 ? 0x2f5a34 : 0x3a6b3c));
      }
      const pine = mergeParts(pineParts);

      /* broadleaf */
      const leafParts = [];
      leafParts.push(colorize(cyl(0.14, 0.34, 3.1, 6, 0, 1.55, 0), 0x53412f));
      const blobs = [[0, 4.1, 0, 1.85], [0.95, 3.5, 0.4, 1.15], [-0.9, 3.7, -0.35, 1.1]];
      for (const [bx, by, bz, br] of blobs) {
        const g = new THREE.IcosahedronGeometry(br, 0);
        g.translate(bx, by, bz);
        leafParts.push(colorize(g, 0x3f6b32));
      }
      const leaf = mergeParts(leafParts);
      this._treeGeo = { pine, leaf };
    }
    return this._treeGeo;
  }

  _buildTrees(count) {
    const { pine, leaf } = this._treeGeometries();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0,
      envMapIntensity: 0.35, flatShading: true,
    });
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();

    const make = (geo, n, baseTint, tintVar) => {
      const inst = new THREE.InstancedMesh(geo, mat, n);
      inst.castShadow = this.quality.treeShadows;
      inst.receiveShadow = false;
      let k = 0;
      for (let i = 0; i < n; i++) {
        const p = this._place(26, 640, 0.75, 3.0);
        if (!p) continue;
        const s = randRange(0.75, 1.9) * (p.lateral > 200 ? 1.25 : 1);
        q.setFromAxisAngle(up, this.rng() * Math.PI * 2);
        v.set(p.x, p.y - 0.25, p.z);
        sc.set(s * randRange(0.85, 1.15), s, s * randRange(0.85, 1.15));
        m4.compose(v, q, sc);
        inst.setMatrixAt(k, m4);
        tint.setHSL(baseTint + (this.rng() - 0.5) * tintVar, 0.5 + this.rng() * 0.2, 0.55 + this.rng() * 0.2);
        inst.setColorAt(k, tint);
        k++;
      }
      inst.count = k;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      if (k) this.group.add(inst);
      return k;
    };

    const night = !!this.theme.props.city;
    const nPine = Math.round(count * (night ? 0.8 : this.theme.key === 'alpine' ? 0.85 : 0.42));
    make(pine, nPine, night ? 0.32 : 0.29, 0.06);
    make(leaf, count - nPine, night ? 0.27 : 0.25, 0.09);
  }

  _buildRocks(count) {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const pos = geo.attributes.position;
    const rng = this.rng;
    for (let i = 0; i < pos.count; i++) {
      const s = 0.62 + rng() * 0.75;
      pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.72, pos.getZ(i) * s);
    }
    geo.computeVertexNormals();
    colorize(geo, 0x8b8579);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true, envMapIntensity: 0.3,
    });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.castShadow = this.quality.treeShadows;
    inst.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    let k = 0;
    for (let i = 0; i < count; i++) {
      const p = this._place(15, 520, 1.1, 5.5);
      if (!p) continue;
      const s = randRange(0.5, 3.4);
      q.setFromAxisAngle(up, this.rng() * Math.PI * 2);
      v.set(p.x, p.y - s * 0.28, p.z);
      sc.set(s, s * randRange(0.6, 1.0), s * randRange(0.8, 1.2));
      m4.compose(v, q, sc);
      inst.setMatrixAt(k, m4);
      const g = 0.5 + this.rng() * 0.35;
      tint.setRGB(g * 1.05, g, g * 0.92);
      inst.setColorAt(k, tint);
      k++;
    }
    inst.count = k;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    if (k) this.group.add(inst);
  }

  _buildTufts(count) {
    const tex = TEX.tuftTexture();
    const p1 = new THREE.PlaneGeometry(1.1, 0.9);
    p1.translate(0, 0.45, 0);
    const p2 = p1.clone();
    p2.rotateY(Math.PI / 2);
    const geo = mergeParts([p1, p2]);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: false, alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 1, metalness: 0, vertexColors: false,
    });
    // wind sway
    const time = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
         #else
           vec3 ip = vec3(0.0);
         #endif
         float sway = sin(uTime * 1.6 + ip.x * 0.35 + ip.z * 0.27) * 0.5
                    + sin(uTime * 2.7 + ip.z * 0.6) * 0.22;
         transformed.x += sway * 0.34 * max(transformed.y, 0.0) * max(transformed.y, 0.0);
         transformed.z += sway * 0.2 * max(transformed.y, 0.0) * max(transformed.y, 0.0);`
      );
    };
    this._tuftTime = time;

    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    let k = 0;
    for (let i = 0; i < count; i++) {
      const p = this._place(8.5, 70, 0.5, 2.2);
      if (!p) continue;
      const s = randRange(0.8, 2.1);
      q.setFromAxisAngle(up, this.rng() * Math.PI * 2);
      v.set(p.x, p.y - 0.06, p.z);
      sc.set(s, s * randRange(0.7, 1.4), s);
      m4.compose(v, q, sc);
      inst.setMatrixAt(k, m4);
      const g = 0.42 + this.rng() * 0.34;
      tint.setRGB(g * 1.02, g, g * 0.92);
      inst.setColorAt(k, tint);
      k++;
    }
    inst.count = k;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    if (k) this.group.add(inst);
  }

  /* ---------------------------------------------------------------- */
  _buildGrandstands() {
    const t = this.track;
    const crowdTex = TEX.crowdTexture();
    const spots = [0.10, 0.055, 0.145].map((f) => t.length * f);
    for (let sIdx = 0; sIdx < spots.length; sIdx++) {
      const s = spots[sIdx];
      const i = Math.floor((s / t.length) * t.N) % t.N;
      const side = sIdx === 1 ? -1 : 1;
      const lat = side * (t.halfWidth + 26);
      const x = t.px[i] + t.rx[i] * lat;
      const z = t.pz[i] + t.rz[i] * lat;
      const y = t.groundHeight(x, z);
      const len = 46;

      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = Math.atan2(t.tx[i], t.tz[i]);

      // raked seating block (built from stacked steps)
      const steps = 9;
      const stepParts = [];
      for (let k = 0; k < steps; k++) {
        stepParts.push(box(len, 0.9, 1.5, 0, 0.6 + k * 0.95, -k * 1.5));
      }
      const rake = new THREE.Mesh(
        mergeParts(stepParts),
        new THREE.MeshStandardMaterial({ color: 0x2c313d, roughness: 0.85, metalness: 0.05 })
      );
      g.add(rake);

      // crowd plane on the rake
      const crowd = new THREE.Mesh(
        new THREE.PlaneGeometry(len * 0.98, steps * 1.45),
        new THREE.MeshStandardMaterial({
          map: crowdTex, roughness: 0.9, metalness: 0,
          emissive: 0xffffff, emissiveMap: crowdTex,
          emissiveIntensity: this.theme.props.city ? 0.5 : 0.14,
        })
      );
      crowd.position.set(0, 0.6 + steps * 0.475, -steps * 0.72);
      crowd.rotation.x = -Math.atan2(steps * 0.95, steps * 1.5);
      g.add(crowd);

      // roof
      const roof = new THREE.Mesh(
        box(len + 3, 0.35, steps * 1.6 + 5, 0, 0.6 + steps * 0.95 + 7.4, -steps * 0.75 - 1.4),
        new THREE.MeshStandardMaterial({ color: 0x1a1e28, roughness: 0.6, metalness: 0.4 })
      );
      roof.castShadow = true;
      g.add(roof);
      for (const px of [-len / 2 + 2, 0, len / 2 - 2]) {
        const pillar = new THREE.Mesh(
          cyl(0.3, 0.34, 8, 8, px, 4.4, -steps * 1.5 - 2.6),
          new THREE.MeshStandardMaterial({ color: 0x333a48, roughness: 0.5, metalness: 0.7 })
        );
        pillar.castShadow = true;
        g.add(pillar);
      }
      // video screen
      const screen = new THREE.Mesh(
        box(9, 5, 0.4, 0, 0.6 + steps * 0.95 + 2.2, -steps * 1.5 - 1.2),
        new THREE.MeshStandardMaterial({
          color: 0x0a0d14, roughness: 0.25, metalness: 0.1,
          emissive: 0x1b3a5c, emissiveIntensity: 1.4,
        })
      );
      g.add(screen);

      this.group.add(g);
    }
  }

  _buildFloodlights() {
    const t = this.track;
    const count = Math.max(6, Math.round(t.length / 260));
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5, metalness: 0.8 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff4d6, emissive: 0xfff0cc, emissiveIntensity: this.theme.props.city ? 3.2 : 0.5,
      roughness: 0.2,
    });
    for (let k = 0; k < count; k++) {
      const s = (k / count) * t.length + 20;
      const i = Math.floor((s / t.length) * t.N) % t.N;
      const side = k % 2 === 0 ? 1 : -1;
      const lat = side * (t.halfWidth + 13);
      const x = t.px[i] + t.rx[i] * lat;
      const z = t.pz[i] + t.rz[i] * lat;
      const y = t.groundHeight(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = Math.atan2(t.tx[i], t.tz[i]);

      const h = 15;
      const pole = new THREE.Mesh(cyl(0.16, 0.34, h, 8, 0, h / 2, 0), poleMat);
      pole.castShadow = true;
      g.add(pole);
      const head = new THREE.Mesh(box(3.6, 0.3, 1.0, 0, h + 0.4, 0), poleMat);
      head.rotation.x = 0.3;
      g.add(head);
      for (let l = 0; l < 4; l++) {
        const lamp = new THREE.Mesh(box(0.72, 0.28, 0.8, (l - 1.5) * 0.9, h + 0.62, 0.1), lampMat);
        lamp.rotation.x = 0.3;
        g.add(lamp);
      }
      if (this.theme.props.city) {
        const pool = new THREE.PointLight(0xffe0b0, 40, 60, 2);
        pool.position.set(0, h, 0);
        g.add(pool);
      }
      this.group.add(g);
    }
  }

  _buildCity() {
    const count = this.props.buildings;
    const geos = [0, 1, 2].map(() => new THREE.BoxGeometry(1, 1, 1));
    // one texture per variant, shared between `map` and `emissiveMap`
    const winTex = [0, 1, 2].map((i) => this._windowTex(i));
    const mats = [0, 1, 2].map((i) => new THREE.MeshStandardMaterial({
      color: 0x1a1f2b,
      roughness: 0.65, metalness: 0.25,
      map: winTex[i],
      emissive: 0xffffff, emissiveMap: winTex[i], emissiveIntensity: 1.5,
    }));
    const buckets = [[], [], []];
    for (let i = 0; i < count * 3; i++) {
      const p = this._place(38, 470, 0.9, 0.5);
      if (!p) continue;
      buckets[(this.rng() * 3) | 0].push(p);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const tint = new THREE.Color();
    for (let b = 0; b < 3; b++) {
      const list = buckets[b];
      if (!list.length) continue;
      const inst = new THREE.InstancedMesh(geos[b], mats[b], list.length);
      inst.castShadow = false;
      let k = 0;
      for (const p of list) {
        const w = randRange(10, 26), d = randRange(10, 26);
        const hh = randRange(14, 92) * (1 - smoothstep(120, 460, Math.abs(p.lateral)) * 0.35);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(this.rng() * 4) * Math.PI / 2);
        v.set(p.x, p.y + hh / 2 - 1, p.z);
        sc.set(w, hh, d);
        m4.compose(v, q, sc);
        inst.setMatrixAt(k, m4);
        const g = 0.6 + this.rng() * 0.7;
        tint.setRGB(g, g * 0.95, g * 1.1);
        inst.setColorAt(k, tint);
        k++;
      }
      inst.count = k;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      this.group.add(inst);
    }
  }

  _windowTex(variant) {
    const W = 256, H = 512;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const rng = makeRng(500 + variant * 31);
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, W, H);
    const cols = 8, rows = 22;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const lit = rng() < 0.45;
        const warm = rng();
        const col = lit
          ? (warm < 0.6 ? `rgb(${255},${190 + rng() * 50 | 0},${120 + rng() * 60 | 0})`
            : `rgb(${150 + rng() * 60 | 0},${220 + rng() * 35 | 0},255)`)
          : 'rgb(16,20,28)';
        ctx.fillStyle = col;
        ctx.fillRect((x + 0.22) * (W / cols), (y + 0.25) * (H / rows), (W / cols) * 0.56, (H / rows) * 0.5);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  _buildTyreWalls() {
    const t = this.track;
    // 4x8 segments is plenty for a 27 cm tyre seen from the racing line, and
    // there can be 500+ of these stacked along the barriers
    const geo = new THREE.TorusGeometry(0.27, 0.115, 4, 8);
    geo.rotateX(Math.PI / 2);
    colorize(geo, 0x1a1a1d);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const spots = [];
    for (let i = 0; i < t.N; i += 4) {
      const k = t.curv[i];
      if (Math.abs(k) > 0.0075) spots.push({ i, side: k > 0 ? -1 : 1 });
    }
    if (!spots.length) return;
    const per = 4;
    // sit the stacks just inside the guardrail: the physics barrier is at
    // track.barrierOffset and the car is stopped 0.6 m before it, so
    // anything nearer the centreline gets driven straight through
    const wallLat = (t.barrierOffset || t.halfWidth + 5.2) - 0.9;
    const inst = new THREE.InstancedMesh(geo, mat, spots.length * per);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    const e = new THREE.Euler();
    let k = 0;
    for (const s of spots) {
      for (let layer = 0; layer < per; layer++) {
        const lat = s.side * wallLat;
        const x = t.px[s.i] + t.rx[s.i] * lat;
        const z = t.pz[s.i] + t.rz[s.i] * lat;
        const y = t.groundHeight(x, z) + 0.15 + layer * 0.235;
        e.set(0, t.heading[s.i] + (this.rng() - 0.5) * 0.3, 0);
        q.setFromEuler(e);
        v.set(x, y, z);
        m4.compose(v, q, sc);
        inst.setMatrixAt(k++, m4);
      }
    }
    inst.count = k;
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = this.quality.treeShadows;
    inst.receiveShadow = true;
    this.group.add(inst);
  }

  update(t) {
    if (this._tuftTime) this._tuftTime.value = t;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k in m) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    });
    this.group.clear();
  }
}
