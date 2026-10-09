/* =========================================================
   Effects — tyre smoke, dust, sparks, exhaust, boost flames
   and persistent skid marks. Everything is pooled: no runtime
   allocation, no garbage collection spikes mid-corner.
   ========================================================= */
import * as THREE from 'three';
import { clamp, lerp } from '../util/math.js';
import { smokeSprite, glowSprite } from '../world/textures.js';

const PARTICLE_VERT = /* glsl */`
attribute float aSize;
attribute vec4 aColor;
uniform float uPix;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // world-space size → pixels, resolution and FOV independent
  gl_PointSize = aSize * uPix / max(-mv.z, 0.25);
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb, a);
}`;

class PointPool {
  constructor(scene, max, texture, blending) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.col0 = new Float32Array(max * 3);
    this.col1 = new Float32Array(max * 3);
    this.drag = new Float32Array(max);
    this.rise = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.alpha1 = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aColor', this.aColor);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uPix: { value: 900 } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.geo = g;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, opts) {
    let i;
    if (this.count < this.max) i = this.count++;
    // pool is full: every slot in [0, max) is live, so overwrite a random
    // one rather than walking a ring buffer (compaction keeps live
    // particles packed at the front, so there is no meaningful "oldest")
    else i = (Math.random() * this.max) | 0;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = 0;
    this.maxLife[i] = opts.life;
    this.size0[i] = opts.size0;
    this.size1[i] = opts.size1;
    this.drag[i] = opts.drag ?? 1.4;
    this.rise[i] = opts.rise ?? 0;
    this.alpha0[i] = opts.alpha0 ?? 0.6;
    this.alpha1[i] = opts.alpha1 ?? 0;
    const c0 = opts.color0, c1 = opts.color1 || opts.color0;
    this.col0[i3] = c0.r; this.col0[i3 + 1] = c0.g; this.col0[i3 + 2] = c0.b;
    this.col1[i3] = c1.r; this.col1[i3 + 1] = c1.g; this.col1[i3 + 2] = c1.b;
  }

  update(dt) {
    const { pos, vel, life, maxLife, size0, size1, col0, col1, alpha0, alpha1, drag, rise } = this;
    const sizeArr = this.aSize.array;
    const colArr = this.aColor.array;
    let write = 0;
    for (let i = 0; i < this.count; i++) {
      const t = life[i] + dt;
      if (t >= maxLife[i]) continue;
      const i3 = i * 3;
      const d = Math.exp(-drag[i] * dt);
      vel[i3] *= d; vel[i3 + 2] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d + rise[i] * dt;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      life[i] = t;
      const u = t / maxLife[i];

      // compact live particles to the front of the arrays
      const w3 = write * 3;
      pos[w3] = pos[i3]; pos[w3 + 1] = pos[i3 + 1]; pos[w3 + 2] = pos[i3 + 2];
      vel[w3] = vel[i3]; vel[w3 + 1] = vel[i3 + 1]; vel[w3 + 2] = vel[i3 + 2];
      life[write] = t; maxLife[write] = maxLife[i];
      size0[write] = size0[i]; size1[write] = size1[i];
      col0[w3] = col0[i3]; col0[w3 + 1] = col0[i3 + 1]; col0[w3 + 2] = col0[i3 + 2];
      col1[w3] = col1[i3]; col1[w3 + 1] = col1[i3 + 1]; col1[w3 + 2] = col1[i3 + 2];
      alpha0[write] = alpha0[i]; alpha1[write] = alpha1[i];
      drag[write] = drag[i]; rise[write] = rise[i];

      sizeArr[write] = lerp(size0[i], size1[i], u);
      const a = lerp(alpha0[i], alpha1[i], u) * (1 - u * u * 0.15);
      const w4 = write * 4;
      colArr[w4] = lerp(col0[i3], col1[w3], u);
      colArr[w4 + 1] = lerp(col0[i3 + 1], col1[w3 + 1], u);
      colArr[w4 + 2] = lerp(col0[i3 + 2], col1[w3 + 2], u);
      colArr[w4 + 3] = a;
      write++;
    }
    this.count = write;
    this.geo.setDrawRange(0, write);
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aColor.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.points.material.dispose();
    this.points.removeFromParent();
  }
}

/* ------------------------------------------------------------------ */
/* Skid marks — a ring buffer of quads laid on the tarmac              */
/* ------------------------------------------------------------------ */
class SkidMarks {
  constructor(scene, maxSegs = 1100) {
    this.max = maxSegs;
    this.head = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxSegs * 4 * 3);
    this.col = new Float32Array(maxSegs * 4 * 4);
    const idx = new Uint32Array(maxSegs * 6);
    for (let i = 0; i < maxSegs; i++) {
      const v = i * 4;
      idx[i * 6] = v; idx[i * 6 + 1] = v + 2; idx[i * 6 + 2] = v + 1;
      idx[i * 6 + 3] = v + 1; idx[i * 6 + 4] = v + 2; idx[i * 6 + 5] = v + 3;
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.NormalBlending,
    });
    // a 4-component color attribute makes three enable USE_COLOR_ALPHA,
    // so vColor.a is already multiplied into diffuseColor by <color_fragment>
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.geo = g;
    this.mat = m;
    scene.add(this.mesh);
    this.last = new Map();
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
    this.last.clear();
  }

  /**
   * @param key stable per-wheel key
   * @param x,z current contact point
   * @param nx,nz lateral direction (across the tyre)
   * @param width tyre width
   * @param intensity 0..1
   */
  add(key, x, y, z, nx, nz, width, intensity) {
    const prev = this.last.get(key);
    this.last.set(key, { x, y, z, nx, nz, intensity });
    if (!prev) return;
    const d = Math.hypot(x - prev.x, z - prev.z);
    if (d < 0.28 || d > 12) return;
    if (intensity < 0.06) return;

    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const p = this.pos;
    const w = width * 0.5;
    const a = i * 12;
    // prev
    p[a] = prev.x + prev.nx * w; p[a + 1] = prev.y; p[a + 2] = prev.z + prev.nz * w;
    p[a + 3] = prev.x - prev.nx * w; p[a + 4] = prev.y; p[a + 5] = prev.z - prev.nz * w;
    // current
    p[a + 6] = x - nx * w; p[a + 7] = y; p[a + 8] = z - nz * w;
    p[a + 9] = x + nx * w; p[a + 10] = y; p[a + 11] = z + nz * w;
    // reorder to match index buffer (v0,v2,v1 / v1,v2,v3)
    const a0 = i * 16;
    const c = this.col;
    const alpha = clamp(intensity, 0, 1) * 0.5;
    for (let k = 0; k < 4; k++) {
      c[a0 + k * 4] = 0.02; c[a0 + k * 4 + 1] = 0.02; c[a0 + k * 4 + 2] = 0.025;
      c[a0 + k * 4 + 3] = alpha;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */

export class Effects {
  constructor(scene, quality) {
    this.quality = quality;
    const smokeTex = smokeSprite();
    const glowTex = glowSprite('#ffffff');
    this.smoke = new PointPool(scene, quality.smokeMax, smokeTex, THREE.NormalBlending);
    this.glow = new PointPool(scene, quality.glowMax, glowTex, THREE.AdditiveBlending);
    this.skid = new SkidMarks(scene, quality.skidMax);
    this._smokeCol = new THREE.Color(0.82, 0.84, 0.9);
    this._smokeCol2 = new THREE.Color(0.55, 0.57, 0.62);
    this._dustCol = new THREE.Color(0.62, 0.5, 0.34);
    this._dustCol2 = new THREE.Color(0.5, 0.42, 0.3);
    this._sparkCol = new THREE.Color(1.0, 0.75, 0.25);
    this._flameCol = new THREE.Color(0.6, 0.8, 1.0);
    this._flameCol2 = new THREE.Color(1.0, 0.4, 0.1);
    this.scale = quality.particleScale;
  }

  /** Tyre smoke for one wheel. */
  tyreSmoke(x, y, z, vx, vz, intensity, dt, dark = false) {
    if (intensity < 0.03) return;
    if (Math.random() >= intensity * this.scale * 60 * dt) return;
    const jitter = 0.35;
    this.smoke.spawn(
      x + (Math.random() - 0.5) * jitter,
      y + 0.12 + Math.random() * 0.2,
      z + (Math.random() - 0.5) * jitter,
      vx * 0.16 + (Math.random() - 0.5) * 1.7,
      0.7 + Math.random() * 1.5,
      vz * 0.16 + (Math.random() - 0.5) * 1.7,
      {
        life: 0.9 + Math.random() * 1.1,
        size0: 0.7, size1: 4.2 + Math.random() * 2.6,
        color0: dark ? this._smokeCol : this._smokeCol,
        color1: this._smokeCol2,
        alpha0: 0.16 + intensity * 0.5,
        alpha1: 0,
        drag: 1.1, rise: 0.9,
      }
    );
  }

  /** Dust kicked up off the grass. */
  dust(x, y, z, vx, vz, intensity, dt) {
    if (intensity < 0.05) return;
    if (Math.random() > intensity * this.scale * 34 * dt) return;
    for (let k = 0; k < 2; k++) {
      this.smoke.spawn(
        x + (Math.random() - 0.5) * 0.8, y + 0.1, z + (Math.random() - 0.5) * 0.8,
        vx * 0.2 + (Math.random() - 0.5) * 2.4,
        0.9 + Math.random() * 1.8,
        vz * 0.2 + (Math.random() - 0.5) * 2.4,
        {
          life: 1.0 + Math.random() * 1.2,
          size0: 0.8, size1: 4.6,
          color0: this._dustCol, color1: this._dustCol2,
          alpha0: 0.24 + intensity * 0.4, alpha1: 0,
          drag: 1.0, rise: 0.5,
        }
      );
    }
  }

  sparks(x, y, z, nx, nz, amount = 10) {
    for (let k = 0; k < amount; k++) {
      this.glow.spawn(
        x, y + 0.1, z,
        nx * (2 + Math.random() * 7) + (Math.random() - 0.5) * 3,
        1.2 + Math.random() * 3.4,
        nz * (2 + Math.random() * 7) + (Math.random() - 0.5) * 3,
        {
          life: 0.28 + Math.random() * 0.35,
          size0: 0.55, size1: 0.05,
          color0: this._sparkCol, color1: this._flameCol2,
          alpha0: 1, alpha1: 0,
          drag: 0.6, rise: -9,
        }
      );
    }
  }

  boostFlame(x, y, z, dirX, dirZ, amount, dt) {
    if (Math.random() > amount * this.scale * 90 * dt) return;
    this.glow.spawn(
      x, y, z,
      dirX * (5 + Math.random() * 6) + (Math.random() - 0.5) * 1.2,
      0.4 + Math.random() * 1.0,
      dirZ * (5 + Math.random() * 6) + (Math.random() - 0.5) * 1.2,
      {
        life: 0.14 + Math.random() * 0.12,
        size0: 0.9 + Math.random() * 0.5, size1: 0.1,
        color0: this._flameCol, color1: this._flameCol2,
        alpha0: 0.95, alpha1: 0,
        drag: 2.2, rise: 0,
      }
    );
    if (Math.random() < 0.4) {
      this.smoke.spawn(x, y, z, dirX * 2, 0.8, dirZ * 2, {
        life: 0.5, size0: 0.5, size1: 2.4,
        color0: this._smokeCol2, color1: this._smokeCol2,
        alpha0: 0.1, alpha1: 0, drag: 1.6, rise: 0.6,
      });
    }
  }

  exhaust(x, y, z, load, dt) {
    if (Math.random() > 0.5 * this.scale * 26 * dt) return;
    this.smoke.spawn(
      x, y, z, (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6,
      {
        life: 0.55 + Math.random() * 0.5,
        size0: 0.22, size1: 1.5,
        color0: this._smokeCol2, color1: this._smokeCol2,
        alpha0: 0.05 + load * 0.12, alpha1: 0,
        drag: 1.4, rise: 0.7,
      }
    );
  }

  landingPuff(x, y, z, power) {
    const n = Math.min(28, 6 + power * 3);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      this.smoke.spawn(
        x, y + 0.1, z,
        Math.cos(a) * sp, 0.4 + Math.random() * 1.2, Math.sin(a) * sp,
        {
          life: 0.7 + Math.random() * 0.8,
          size0: 0.6, size1: 3.4,
          color0: this._smokeCol, color1: this._smokeCol2,
          alpha0: 0.3, alpha1: 0, drag: 2.0, rise: 0.4,
        }
      );
    }
  }

  update(dt, camera, bufferHeight) {
    if (camera && bufferHeight) {
      // pixel scale so a particle's `size` is in metres at any resolution / FOV
      const pix = bufferHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
      this.smoke.points.material.uniforms.uPix.value = pix;
      this.glow.points.material.uniforms.uPix.value = pix;
    }
    this.smoke.update(dt);
    this.glow.update(dt);
  }

  dispose() {
    this.smoke.dispose();
    this.glow.dispose();
    this.skid.dispose();
  }
}
