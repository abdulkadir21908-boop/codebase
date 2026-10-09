/* =========================================================
   Procedural canvas textures — the game ships with zero image
   assets, every surface is generated here at boot.
   ========================================================= */
import * as THREE from 'three';
import { makeRng } from '../util/math.js';
import { Noise } from '../util/noise.js';

const noise = new Noise(2024);

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(canvas, { srgb = true, repeat = 1, aniso = 8, wrap = THREE.RepeatWrapping } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = wrap;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Convert a grayscale height canvas into a tangent-space normal map texture. */
function heightToNormal(heightCanvas, strength = 2.0) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const at = (x, y) => {
    const xx = (x + w) % w, yy = (y + h) % h;
    return src[(yy * w + xx) * 4] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = toTexture(out, { srgb: false });
  return tex;
}

/* ------------------------------------------------------------------ */
/* Asphalt                                                             */
/* ------------------------------------------------------------------ */
export function asphalt() {
  const S = 512;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rng = makeRng(7);

  ctx.fillStyle = '#3b3e46';
  ctx.fillRect(0, 0, S, S);

  // aggregate speckle
  const img = ctx.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = noise.fbm(x * 0.09, y * 0.09, 4) * 0.5 + 0.5;
      const grain = rng();
      const v = 52 + n * 26 + grain * 30;
      const i = (y * S + x) * 4;
      img.data[i] = v * 0.98;
      img.data[i + 1] = v;
      img.data[i + 2] = v * 1.06;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // tar patches
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 10; i++) {
    const x = rng() * S, y = rng() * S, r = 30 + rng() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#20222a');
    g.addColorStop(1, 'rgba(14,15,19,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // cracks
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#25272e';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 26; i++) {
    let x = rng() * S, y = rng() * S;
    ctx.beginPath(); ctx.moveTo(x, y);
    const steps = 6 + (rng() * 10) | 0;
    let a = rng() * Math.PI * 2;
    for (let s = 0; s < steps; s++) {
      a += (rng() - 0.5) * 1.5;
      x += Math.cos(a) * 11; y += Math.sin(a) * 11;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // height for the normal map
  const hc = makeCanvas(S);
  const hctx = hc.getContext('2d');
  hctx.drawImage(c, 0, 0);
  hctx.globalAlpha = 0.5;
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, S, S);
  hctx.globalAlpha = 1;

  return {
    map: toTexture(c, { repeat: 1 }),
    normalMap: heightToNormal(hc, 1.1),
    roughness: 0.92,
  };
}

/* ------------------------------------------------------------------ */
/* Grass / terrain                                                     */
/* ------------------------------------------------------------------ */
export function grassTexture() {
  const S = 512;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rng = makeRng(31);

  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = noise.fbm(x * 0.035, y * 0.035, 4) * 0.5 + 0.5;
      const m = noise.fbm(x * 0.2 + 40, y * 0.2, 2) * 0.5 + 0.5;
      const r = 46 + n * 44 + m * 14;
      const g = 92 + n * 66 + m * 20;
      const b = 34 + n * 26;
      const i = (y * S + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // blade strokes
  for (let i = 0; i < 2600; i++) {
    const x = rng() * S, y = rng() * S;
    const len = 3 + rng() * 7;
    const shade = 0.7 + rng() * 0.7;
    ctx.strokeStyle = `rgba(${Math.floor(70 * shade)},${Math.floor(140 * shade)},${Math.floor(52 * shade)},0.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 3, y - len);
    ctx.stroke();
  }
  return toTexture(c, { repeat: 1 });
}

/* ------------------------------------------------------------------ */
/* Kerb (red / white) — stripes run along V                            */
/* ------------------------------------------------------------------ */
export function kerbTexture(a = '#e03a2f', b = '#f2f2f2') {
  const W = 64, H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? b : a;
    ctx.fillRect(0, (i * H) / 4, W, H / 4);
  }
  // grime + wear
  const rng = makeRng(5);
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = rng() > 0.5 ? '#000' : '#fff';
    const x = rng() * W, y = rng() * H;
    ctx.fillRect(x, y, 1 + rng() * 3, 1 + rng() * 3);
  }
  ctx.globalAlpha = 1;
  return toTexture(c, { repeat: 1, wrap: THREE.RepeatWrapping });
}

/* ------------------------------------------------------------------ */
/* Start/finish checker                                                */
/* ------------------------------------------------------------------ */
export function checkerTexture(cols = 8, rows = 2) {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const cw = S / cols, ch = S / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#1b1d22' : '#f4f5f7';
      ctx.fillRect(x * cw, y * ch, cw, ch);
    }
  }
  const rng = makeRng(11);
  ctx.globalAlpha = 0.14;
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = '#000';
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 4, 1 + rng() * 4);
  }
  ctx.globalAlpha = 1;
  return toTexture(c, { repeat: 1 });
}

/* ------------------------------------------------------------------ */
/* Tyre                                                                */
/* ------------------------------------------------------------------ */
export function tyreTexture() {
  const W = 256, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#141416';
  ctx.fillRect(0, 0, W, H);
  // circumferential grooves (vertical in UV = around the tyre)
  ctx.fillStyle = '#0a0a0c';
  const grooves = [0.2, 0.42, 0.58, 0.8];
  for (const g of grooves) ctx.fillRect(g * W - 5, 0, 10, H);
  // tread blocks
  ctx.fillStyle = '#1d1d20';
  for (let i = 0; i < 26; i++) {
    const y = (i / 26) * H;
    ctx.save();
    ctx.translate(0, y);
    ctx.fillRect(W * 0.05, 0, W * 0.13, H / 26 - 3);
    ctx.fillRect(W * 0.46, 0, W * 0.1, H / 26 - 3);
    ctx.fillRect(W * 0.85, 0, W * 0.12, H / 26 - 3);
    ctx.restore();
  }
  const hc = makeCanvas(W, H);
  const hx = hc.getContext('2d');
  hx.drawImage(c, 0, 0);
  return { map: toTexture(c), normalMap: heightToNormal(hc, 2.4) };
}

/* ------------------------------------------------------------------ */
/* Sprites                                                             */
/* ------------------------------------------------------------------ */
export function smokeSprite() {
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // break the perfect circle up a bit
  const rng = makeRng(3);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2, r = 30 + rng() * 32;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    const rr = 6 + rng() * 16;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, rr);
    gg.addColorStop(0, `rgba(0,0,0,${0.25 + rng() * 0.4})`);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  }
  return toTexture(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}

export function glowSprite(color = '#ffffff') {
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.18, color);
  g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}

/* ------------------------------------------------------------------ */
/* Car livery — applied to the extruded body (U = across the width)     */
/* ------------------------------------------------------------------ */
export function liveryTexture(base = '#e8e9ee', accent = '#1a1c22', stripe = '#ffffff') {
  const W = 256, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // outer accent flanks (visible on the side walls where U is pinned to the edge)
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W * 0.085, H);
  ctx.fillRect(W * 0.915, 0, W * 0.085, H);

  // twin centre stripes running over hood / roof / deck
  ctx.fillStyle = stripe;
  ctx.fillRect(W * 0.40, 0, W * 0.075, H);
  ctx.fillRect(W * 0.525, 0, W * 0.075, H);
  ctx.fillStyle = accent;
  ctx.fillRect(W * 0.485, 0, W * 0.03, H);

  // soft top-down shading so the paint isn't flat
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return toTexture(c, { repeat: 1, wrap: THREE.ClampToEdgeWrapping });
}

/** Door roundel with a race number. */
export function numberDecal(num, fg = '#111318', bg = '#f4f5f7', ring = '#ff6b2c') {
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = S * 0.06;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = `800 ${S * 0.56}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), S / 2, S / 2 + S * 0.03);
  const tex = toTexture(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
  return tex;
}

/* ------------------------------------------------------------------ */
/* Trackside branding                                                  */
/* ------------------------------------------------------------------ */
export function bannerTexture(text, bg = '#12141c', fg = '#ffffff', accent = '#ff6b2c') {
  const W = 512, H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, bg);
  g.addColorStop(1, '#05070c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 6);
  ctx.fillRect(0, H - 6, W, 6);
  ctx.fillStyle = fg;
  ctx.font = '800 62px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '6px';
  ctx.fillText(text, W / 2, H / 2 + 2);
  return toTexture(c, { repeat: 1, wrap: THREE.ClampToEdgeWrapping });
}

/** Big gantry sign. */
export function gantryTexture(left = 'APEX', right = 'VELOCITY') {
  const W = 1024, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0c12';
  ctx.fillRect(0, 0, W, H);
  // checker strips
  const sq = 24;
  for (let i = 0; i < W / sq; i++) {
    ctx.fillStyle = i % 2 ? '#f2f3f6' : '#1a1c22';
    ctx.fillRect(i * sq, 0, sq, 20);
    ctx.fillRect(i * sq, H - 20, sq, 20);
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 20, W, H - 40);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 108px "Segoe UI", system-ui, sans-serif';
  ctx.letterSpacing = '10px';
  const grad = ctx.createLinearGradient(0, 60, 0, 200);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#ff6b2c');
  ctx.fillStyle = grad;
  ctx.fillText(left, W * 0.29, H / 2 + 4);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(W * 0.5 - 2, 62, 4, H - 124);
  ctx.fillStyle = '#38e1ff';
  ctx.fillText(right, W * 0.71, H / 2 + 4);
  return toTexture(c, { repeat: 1, wrap: THREE.ClampToEdgeWrapping });
}

/** Grandstand crowd — thousands of dots, one draw call. */
export function crowdTexture() {
  const W = 512, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d1018';
  ctx.fillRect(0, 0, W, H);
  const rng = makeRng(99);
  const rows = 22;
  for (let r = 0; r < rows; r++) {
    const y = H - 10 - (r * H) / rows;
    const count = 150 + rng() * 40;
    for (let i = 0; i < count; i++) {
      const x = rng() * W;
      const hue = rng();
      const col = hue < 0.4 ? `hsl(${rng() * 40 + 190},70%,60%)`
        : hue < 0.75 ? `hsl(${rng() * 60 + 340},65%,58%)`
          : `hsl(${rng() * 60},60%,72%)`;
      ctx.fillStyle = col;
      const s = 3 + rng() * 2.2;
      ctx.globalAlpha = 0.5 + rng() * 0.5;
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      // bobbing heads animation is faked with a lighter highlight
      ctx.globalAlpha *= 0.5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x - s * 0.3, y - s * 0.4, s * 0.35, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  return toTexture(c, { repeat: 1 });
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */
export function metalScratch() {
  const S = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  const rng = makeRng(17);
  for (let i = 0; i < 900; i++) {
    const y = rng() * S;
    const g = 90 + rng() * 90;
    ctx.strokeStyle = `rgb(${g},${g},${g})`;
    ctx.lineWidth = rng() * 1.4;
    ctx.beginPath();
    ctx.moveTo(rng() * S, y);
    ctx.lineTo(rng() * S, y + (rng() - 0.5) * 4);
    ctx.stroke();
  }
  return toTexture(c, { srgb: false });
}

/** Radial fade used for blob shadows and light pools. */
export function blobShadow() {
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.72)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.34)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}

/** Grass tuft billboard (alpha cut-out). */
export function tuftTexture() {
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rng = makeRng(23);
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const x = 8 + rng() * (S - 16);
    const h = 34 + rng() * 74;
    const lean = (rng() - 0.5) * 30;
    const g = 0.5 + rng() * 0.5;
    ctx.strokeStyle = `rgba(${Math.floor(58 * g + 30)},${Math.floor(150 * g + 40)},${Math.floor(56 * g + 20)},0.95)`;
    ctx.lineWidth = 2 + rng() * 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, S);
    ctx.quadraticCurveTo(x + lean * 0.4, S - h * 0.55, x + lean, S - h);
    ctx.stroke();
  }
  return toTexture(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}
