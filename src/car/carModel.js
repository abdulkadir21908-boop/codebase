/* =========================================================
   Procedural sports car.

   The body is an extruded side-profile that is then deformed:
   width flares out over the axles (fenders) and tapers in
   towards the roof (greenhouse). That single trick gives a
   convincing supercar silhouette from a handful of polygons.
   ========================================================= */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeParts } from '../util/geo.js';
import { smoothstep } from '../util/math.js';
import { liveryTexture, numberDecal, tyreTexture, metalScratch } from '../world/textures.js';

const L = 4.42;          // length
const BASE_HALF = 0.86;  // half width at the waist
const FRONT_AXLE = 1.38;
const REAR_AXLE = -1.42;
const TRACK_HALF = 0.855;
const WHEEL_R = 0.36;
const WHEEL_W = 0.30;

/* ---- side profiles (x = forward, y = up) ---- */
const LOWER_BODY = [
  [2.14, 0.30], [2.23, 0.50], [2.15, 0.64], [1.62, 0.715], [1.00, 0.735],
  [0.56, 0.755], [-1.28, 0.795], [-1.76, 0.845], [-2.10, 0.80], [-2.21, 0.60],
  [-2.19, 0.34], [-1.92, 0.215], [1.88, 0.215],
];
const CANOPY = [
  [0.60, 0.745], [0.10, 1.10], [-0.30, 1.155], [-0.73, 1.12], [-1.16, 0.935], [-1.30, 0.79],
];
const ROOF = [
  [0.155, 1.095], [-0.30, 1.17], [-0.735, 1.135], [-0.95, 1.02],
  [-0.90, 0.965], [-0.71, 1.075], [-0.30, 1.115], [0.14, 1.04],
];

function shapeFrom(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/** Width multiplier along the length — fender flares + nose/tail taper. */
function widthAt(x) {
  const u = smoothstep(-L / 2, L / 2, x);
  let w = 0.80 + 0.20 * Math.sin(Math.PI * u);
  w += 0.235 * Math.exp(-Math.pow((x - FRONT_AXLE) / 0.54, 2));
  w += 0.255 * Math.exp(-Math.pow((x - REAR_AXLE) / 0.58, 2));
  w -= 0.10 * Math.exp(-Math.pow((x - 0.35) / 0.9, 2));   // door pinch
  return w;
}
function heightTaper(y) {
  return 1 - 0.215 * smoothstep(0.70, 1.18, y);
}

function extrudeProfile(pts, depth, bevel = 0.05) {
  const geo = new THREE.ExtrudeGeometry(shapeFrom(pts), {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 5,
    curveSegments: 8,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function deform(geo) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setZ(i, z * widthAt(x) * heightTaper(y));
  }
  geo.computeVertexNormals();
  return geo;
}

/** Re-map UVs so U runs across the car width — lets the livery stripes read. */
function widthUVs(geo) {
  const p = geo.attributes.position;
  let maxZ = 0.001;
  for (let i = 0; i < p.count; i++) maxZ = Math.max(maxZ, Math.abs(p.getZ(i)));
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getZ(i) / maxZ) * 0.5 + 0.5;
    uv[i * 2 + 1] = (p.getX(i) + L / 2) / L;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/* ------------------------------------------------------------------ */
/* shared resources (built once, reused by every car)                  */
/* ------------------------------------------------------------------ */
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const tt = tyreTexture();
  for (const t of [tt.map, tt.normalMap]) {
    t.center.set(0.5, 0.5);
    t.rotation = Math.PI / 2;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 1);
  }
  SHARED = {
    tyre: tt,
    scratch: metalScratch(),
    liveries: new Map(),
  };
  return SHARED;
}

/**
 * Livery strip layout is baked into the texture, so it cannot be shared
 * between cars that picked different accent/stripe colours. Cache one 256px
 * texture per distinct pair instead of one texture for the whole field.
 */
function liveryFor(accent, stripe) {
  const key = accent + '/' + stripe;
  let tex = shared().liveries.get(key);
  if (!tex) {
    tex = liveryTexture('#e8e9ee', accent, stripe);
    shared().liveries.set(key, tex);
  }
  return tex;
}

function buildTyreGeometry() {
  const pts = [
    [0.205, -WHEEL_W * 0.48], [0.262, -0.152], [0.315, -0.148], [0.352, -0.118],
    [0.358, -0.055], [0.360, 0], [0.358, 0.055], [0.352, 0.118],
    [0.315, 0.148], [0.262, 0.152], [0.205, WHEEL_W * 0.48],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const geo = new THREE.LatheGeometry(pts, 28);
  geo.rotateX(Math.PI / 2);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function buildRimGeometry() {
  const parts = [];
  // barrel
  const barrel = new THREE.CylinderGeometry(0.222, 0.222, WHEEL_W * 0.86, 24, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);
  // outer lip
  const lip = new THREE.TorusGeometry(0.215, 0.028, 8, 24);
  lip.rotateY(Math.PI / 2);
  lip.translate(WHEEL_W * 0.42, 0, 0);
  parts.push(lip);
  const lip2 = new THREE.TorusGeometry(0.215, 0.024, 8, 24);
  lip2.rotateY(Math.PI / 2);
  lip2.translate(-WHEEL_W * 0.42, 0, 0);
  parts.push(lip2);
  // spokes
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = new THREE.BoxGeometry(0.046, 0.19, 0.055);
    s.translate(0, 0.108, 0);
    s.rotateX(a);
    s.translate(WHEEL_W * 0.30, 0, 0);
    parts.push(s);
  }
  // splitter strakes behind the spokes for depth
  for (let i = 0; i < 9; i++) {
    const a = ((i + 0.5) / 9) * Math.PI * 2;
    const s = new THREE.BoxGeometry(0.018, 0.16, 0.02);
    s.translate(0, 0.1, 0);
    s.rotateX(a);
    s.translate(WHEEL_W * 0.18, 0, 0);
    parts.push(s);
  }
  // hub
  const hub = new THREE.CylinderGeometry(0.062, 0.055, 0.07, 8);
  hub.rotateZ(Math.PI / 2);
  hub.translate(WHEEL_W * 0.34, 0, 0);
  parts.push(hub);
  // brake caliper (fixed to the upright, merged here for draw-call economy)
  const cal = new RoundedBoxGeometry(0.07, 0.13, 0.1, 2, 0.02);
  cal.translate(WHEEL_W * 0.02, 0.185, 0.0);
  parts.push(cal);
  return mergeParts(parts);
}

function buildDiscGeometry() {
  const parts = [];
  const disc = new THREE.CylinderGeometry(0.195, 0.195, 0.022, 24);
  disc.rotateZ(Math.PI / 2);
  parts.push(disc);
  const hat = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 8);
  hat.rotateZ(Math.PI / 2);
  parts.push(hat);
  return mergeParts(parts);
}

/* ------------------------------------------------------------------ */

export const CAR_COLORS = [
  { paint: 0xf23c1e, accent: 0x111318, stripe: 0xffffff, name: 'Ember' },
  { paint: 0x1f6df2, accent: 0x0b1220, stripe: 0xf2f6ff, name: 'Cobalt' },
  { paint: 0xf5c518, accent: 0x1a1508, stripe: 0x1a1508, name: 'Solar' },
  { paint: 0x18c48a, accent: 0x08201a, stripe: 0xffffff, name: 'Jade' },
  { paint: 0xa855f7, accent: 0x150a20, stripe: 0xffe9ff, name: 'Violet' },
  { paint: 0xe8e9ee, accent: 0x1a1c22, stripe: 0xff3b30, name: 'Ghost' },
  { paint: 0xff8c1a, accent: 0x2a1405, stripe: 0x1a1c22, name: 'Ember II' },
  { paint: 0x2b2f3a, accent: 0x00e5ff, stripe: 0x00e5ff, name: 'Stealth' },
  { paint: 0xff4d6d, accent: 0x2a0a12, stripe: 0xffffff, name: 'Rose' },
  { paint: 0x7ec850, accent: 0x101a0a, stripe: 0x101a0a, name: 'Lime' },
];

export function buildCar(opts = {}) {
  const {
    color = 0xf23c1e, accent = 0x111318, stripe = 0xffffff,
    number = 7, quality = {},
  } = opts;
  const S = shared();

  const root = new THREE.Group();
  const body = new THREE.Group();       // sprung mass — gets roll & pitch
  root.add(body);

  /* ---------------- paint ---------------- */
  const lower = deform(extrudeProfile(LOWER_BODY, BASE_HALF * 2, 0.055));
  widthUVs(lower);
  const roof = deform(extrudeProfile(ROOF, BASE_HALF * 1.68, 0.02));
  widthUVs(roof);
  const paintGeo = mergeParts([lower, roof]);
  // The profile is drawn with x as the forward axis, but the rest of the game
  // (wheels, camera, physics forward vector) treats +Z as forward. Rotate the
  // finished body so the nose (extruded towards +X) ends up pointing along +Z,
  // otherwise the car appears to drive crabbed sideways.
  paintGeo.rotateY(-Math.PI / 2);

  // Clearcoat and sheen are two extra BRDF lobes evaluated per pixel, and on
  // weak hardware they are the most expensive thing about a car by a wide
  // margin. At racing distances you cannot tell them apart, so the cheaper
  // presets drop them and fall back to a plain standard material.
  const rich = quality.richCar !== false;
  const paintMat = rich
    ? new THREE.MeshPhysicalMaterial({
      color,
      map: liveryFor(accent, stripe),
      roughness: 0.22,
      metalness: 0.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.6,
      sheen: 0.2,
      sheenColor: new THREE.Color(0xffffff),
    })
    : new THREE.MeshStandardMaterial({
      color,
      map: liveryFor(accent, stripe),
      roughness: 0.24,
      metalness: 0.5,
      envMapIntensity: 1.6,
    });
  const paint = new THREE.Mesh(paintGeo, paintMat);
  paint.castShadow = true;
  body.add(paint);

  /* ---------------- glass canopy ---------------- */
  const glassGeo = deform(extrudeProfile(CANOPY, BASE_HALF * 1.42, 0.03));
  glassGeo.rotateY(-Math.PI / 2);
  // For consistent +Z-forward orientation across the whole car, every piece is
  // rotated by -90deg about Y (profile space has +X as forward). Wheels spin
  // about the lateral axis, so their pivot *positions* are rotated but their
  // orientation is untouched -- see below.
  const R = (g) => { g.rotateY(-Math.PI / 2); return g; };
  const glass = new THREE.Mesh(glassGeo, rich
    ? new THREE.MeshPhysicalMaterial({
      color: 0x0a0e16,
      roughness: 0.04,
      metalness: 0.2,
      transmission: 0,
      transparent: true,
      opacity: 0.82,
      envMapIntensity: 2.8,
      clearcoat: 1,
      clearcoatRoughness: 0.015,
      side: THREE.DoubleSide,
    })
    : // Single sided and opaque enough to keep writing depth: the canopy is a
      // small part of the screen and DoubleSide doubles its fragment cost.
      new THREE.MeshStandardMaterial({
        color: 0x0a0e16,
        roughness: 0.08,
        metalness: 0.1,
        transparent: true,
        opacity: 0.9,
        envMapIntensity: 2.4,
      }));
  body.add(glass);

  /* ---------------- dark trim ---------------- */
  const trimParts = [];
  // front splitter
  trimParts.push(box(0.62, 0.07, 1.72, 2.02, 0.235, 0));
  // side skirts
  for (const s of [1, -1]) {
    trimParts.push(box(2.5, 0.13, 0.1, -0.05, 0.245, 0.9 * s));
  }
  // rear diffuser + fins
  trimParts.push(box(0.5, 0.16, 1.5, -2.02, 0.26, 0));
  for (let i = -2; i <= 2; i++) trimParts.push(box(0.44, 0.2, 0.05, -2.02, 0.3, i * 0.3));
  // front intakes
  for (const s of [1, -1]) {
    const g = new RoundedBoxGeometry(0.5, 0.26, 0.34, 2, 0.05);
    g.translate(1.86, 0.42, 0.72 * s);
    trimParts.push(g);
  }
  // grille
  trimParts.push(box(0.16, 0.24, 1.0, 2.16, 0.46, 0));
  // mirrors on stalks
  for (const s of [1, -1]) {
    trimParts.push(box(0.1, 0.05, 0.16, 0.55, 0.83, 0.86 * s));
    const m = new RoundedBoxGeometry(0.16, 0.1, 0.22, 2, 0.04);
    m.translate(0.5, 0.87, 0.95 * s);
    trimParts.push(m);
  }
  // rear wing
  trimParts.push(box(0.34, 0.055, 1.56, -1.92, 1.03, 0));
  for (const s of [1, -1]) {
    trimParts.push(box(0.3, 0.045, 0.05, -1.92, 1.03, 0.76 * s));
    trimParts.push(box(0.06, 0.2, 0.07, -1.9, 0.93, 0.6 * s));
  }
  // front canards
  for (const s of [1, -1]) {
    const c = new RoundedBoxGeometry(0.3, 0.03, 0.5, 2, 0.012);
    c.rotateY(0.35 * s);
    c.translate(2.08, 0.42, 0.95 * s);
    trimParts.push(c);
  }
  // side air intakes (dark scoops ahead of the rear wheels)
  for (const s of [1, -1]) {
    const inr = new RoundedBoxGeometry(0.62, 0.34, 0.12, 2, 0.05);
    inr.translate(-0.95, 0.5, 0.92 * s);
    trimParts.push(inr);
  }
  // roof scoop
  trimParts.push(box(0.5, 0.09, 0.34, -0.42, 1.16, 0));
  // underbody
  trimParts.push(box(3.6, 0.06, 1.6, -0.1, 0.2, 0));
  const trim = new THREE.Mesh(R(mergeParts(trimParts)), new THREE.MeshStandardMaterial({
    color: 0x121419, roughness: 0.62, metalness: 0.25, envMapIntensity: 0.8,
  }));
  trim.castShadow = true;
  body.add(trim);

  /* ---------------- chrome / brightwork ---------------- */
  const chromeParts = [];
  for (const s of [1, -1]) {
    const tip = new THREE.CylinderGeometry(0.075, 0.085, 0.22, 12, 1, false);
    tip.rotateZ(Math.PI / 2);
    tip.translate(-2.2, 0.33, 0.36 * s);
    chromeParts.push(tip);
  }
  // hood vents
  for (const s of [1, -1]) {
    const v = new RoundedBoxGeometry(0.4, 0.05, 0.2, 2, 0.02);
    v.translate(1.42, 0.72, 0.4 * s);
    chromeParts.push(v);
  }
  const chrome = new THREE.Mesh(R(mergeParts(chromeParts)), new THREE.MeshStandardMaterial({
    color: 0xd8dde8, roughness: 0.18, metalness: 1.0, envMapIntensity: 1.6,
  }));
  body.add(chrome);

  /* ---------------- lights ---------------- */
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfdfbff, emissive: 0xdce8ff, emissiveIntensity: 4.6,
    roughness: 0.12, metalness: 0.1,
  });
  const headParts = [];
  for (const s of [1, -1]) {
    const hl = new RoundedBoxGeometry(0.16, 0.13, 0.62, 2, 0.045);
    hl.rotateY(0.16 * s);
    hl.rotateZ(-0.12);
    hl.translate(2.05, 0.62, 0.5 * s);
    headParts.push(hl);
  }
  const dayMat = new THREE.MeshStandardMaterial({
    color: 0xfff0c0, emissive: 0xfff0c0, emissiveIntensity: 2.6, roughness: 0.2,
  });
  const drlParts = [];
  for (const s of [1, -1]) {
    const d = new RoundedBoxGeometry(0.1, 0.045, 0.72, 2, 0.02);
    d.rotateY(0.16 * s);
    d.translate(2.02, 0.72, 0.48 * s);
    drlParts.push(d);
  }
  body.add(new THREE.Mesh(R(mergeParts(headParts)), headMat));
  body.add(new THREE.Mesh(R(mergeParts(drlParts)), dayMat));

  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x2a0406, emissive: 0xff1414, emissiveIntensity: 1.6, roughness: 0.25,
  });
  const tailParts = [];
  const bar = new RoundedBoxGeometry(0.1, 0.11, 1.62, 2, 0.04);
  bar.translate(-2.17, 0.72, 0);
  tailParts.push(bar);
  for (const s of [1, -1]) {
    const t = new RoundedBoxGeometry(0.12, 0.09, 0.34, 2, 0.03);
    t.translate(-2.16, 0.55, 0.62 * s);
    tailParts.push(t);
  }
  body.add(new THREE.Mesh(R(mergeParts(tailParts)), tailMat));

  /* ---------------- race number ---------------- */
  const decalTex = numberDecal(number, '#12141a', '#f2f4f8', '#' + new THREE.Color(accent).getHexString());
  const decalMat = new THREE.MeshBasicMaterial({
    map: decalTex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });
  for (const s of [1, -1]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.66), decalMat);
    // profile-space side position (x = rear-biased, z = lateral) -> rotated by -90deg Y
    d.position.set(-0.878 * s, 0.56, -0.42);
    d.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    body.add(d);
  }

  /* ---------------- wheels ---------------- */
  if (!SHARED.tyreGeo) {
    SHARED.tyreGeo = buildTyreGeometry();
    SHARED.rimGeo = buildRimGeometry();
    SHARED.discGeo = buildDiscGeometry();
  }
  const tyreMat = new THREE.MeshStandardMaterial({
    color: 0x141416, map: S.tyre.map, normalMap: S.tyre.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.92, metalness: 0.02,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xc9ced9, roughness: 0.34, metalness: 0.95,
    envMapIntensity: 1.5, roughnessMap: S.scratch,
  });
  const discMat = new THREE.MeshStandardMaterial({
    color: 0x3a3d44, roughness: 0.35, metalness: 0.85,
    emissive: 0xff2a00, emissiveIntensity: 0,
  });

  const wheels = [];
  const wheelDefs = [
    { x: FRONT_AXLE, z: TRACK_HALF, steer: true },
    { x: FRONT_AXLE, z: -TRACK_HALF, steer: true },
    { x: REAR_AXLE, z: TRACK_HALF, steer: false },
    { x: REAR_AXLE, z: -TRACK_HALF, steer: false },
  ];
  const discParts = [];
  for (const def of wheelDefs) {
    const pivot = new THREE.Group();                 // steering + suspension
    // Pivot positions were authored in profile space (x = forward, z = lateral);
    // rotate them by -90deg about Y so the wheels sit at the correct corners
    // relative to the (now +Z-facing) body.
    pivot.position.set(-def.z, WHEEL_R, def.x);
    const spin = new THREE.Group();                   // rolling
    const t = new THREE.Mesh(SHARED.tyreGeo, tyreMat);
    t.castShadow = true;
    const r = new THREE.Mesh(SHARED.rimGeo, rimMat);
    r.castShadow = true;
    spin.add(t, r);
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, steer: def.steer, side: Math.sign(def.z), restY: WHEEL_R });
    const d = SHARED.discGeo.clone();
    // same -90deg Y rotation as the pivots
    d.translate(-(def.z - Math.sign(def.z) * 0.03), WHEEL_R, def.x);
    discParts.push(d);
  }
  const discs = new THREE.Mesh(mergeParts(discParts), discMat);
  root.add(discs);

  /* ---------------- blob shadow (keeps the car grounded even at low quality) */
  let blob = null;
  if (quality.blobShadow) {
    blob = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 5.6),
      new THREE.MeshBasicMaterial({
        map: quality.blobTex, transparent: true, opacity: 0.5,
        depthWrite: false, blending: THREE.NormalBlending, color: 0x000000,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    blob.renderOrder = 2;
    root.add(blob);
  }

  root.userData = {
    body, paint, paintMat, glass, wheels, discs, discMat, tailMat, headMat, dayMat, blob,
    frontAxle: FRONT_AXLE, rearAxle: REAR_AXLE, trackHalf: TRACK_HALF, wheelR: WHEEL_R,
    exhaust: [new THREE.Vector3(-2.28, 0.33, 0.36), new THREE.Vector3(-2.28, 0.33, -0.36)],
  };
  return root;
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/**
 * Release one car's own GPU resources. The wheel geometries, livery textures,
 * tyre maps and scratch map are shared across the whole field, so they are
 * left alone here and only freed by disposeShared().
 */
export function disposeCar(root) {
  if (!root) return;
  const keepGeo = new Set(SHARED ? [SHARED.tyreGeo, SHARED.rimGeo, SHARED.discGeo] : []);
  const keepTex = new Set();
  if (SHARED) {
    keepTex.add(SHARED.tyre.map).add(SHARED.tyre.normalMap).add(SHARED.scratch);
    for (const t of SHARED.liveries.values()) keepTex.add(t);
  }
  root.traverse((o) => {
    if (o.geometry && !keepGeo.has(o.geometry)) o.geometry.dispose();
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      for (const k in m) {
        const v = m[k];
        if (v && v.isTexture && !keepTex.has(v)) v.dispose();
      }
      m.dispose();
    }
  });
  root.removeFromParent();
}

/** Free everything every car shares. Called once the field is torn down. */
export function disposeShared() {
  if (!SHARED) return;
  for (const t of [SHARED.tyre.map, SHARED.tyre.normalMap, SHARED.scratch]) t.dispose();
  for (const t of SHARED.liveries.values()) t.dispose();
  for (const g of [SHARED.tyreGeo, SHARED.rimGeo, SHARED.discGeo]) if (g) g.dispose();
  SHARED = null;
}
