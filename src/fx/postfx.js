/* =========================================================
   Post-processing

   Bloom is implemented here rather than with UnrealBloomPass:
   that pass hardcodes HalfFloatType render targets, which come
   back as a black frame on some drivers (notably older Intel
   integrated graphics through ANGLE/D3D11). This is a dual
   filter (Kawase) bloom - downsample chain, tent upsample
   chain - running on plain 8-bit targets so it works anywhere.

   The whole stack is optional. On the low preset the composer
   is skipped entirely and three tone maps in-shader while
   rendering straight to the canvas, which removes ~10 ms per
   frame on weak GPUs. Everything is also scaled down by the
   quality preset (bloom pyramid depth, tap counts).
   ========================================================= */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const LUMA = `float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }`;

const BRIGHT_SHADER = {
  uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.85 }, uKnee: { value: 0.35 } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uThreshold; uniform float uKnee;
    varying vec2 vUv;
    ${LUMA}
    void main() {
      vec3 c = texture2D( tDiffuse, vUv ).rgb;
      float l = luma( c );
      float soft = clamp( l - uThreshold + uKnee, 0.0, 2.0 * uKnee );
      soft = soft * soft / ( 4.0 * uKnee + 1e-4 );
      float w = max( soft, l - uThreshold ) / max( l, 1e-4 );
      gl_FragColor = vec4( c * w, 1.0 );
    }`,
};

const DOWN_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec2 t = uTexel;
      vec3 s = texture2D( tDiffuse, vUv + vec2( -t.x,  t.y ) ).rgb;
      s += texture2D( tDiffuse, vUv + vec2(  0.0,  t.y ) ).rgb * 2.0;
      s += texture2D( tDiffuse, vUv + vec2(  t.x,  t.y ) ).rgb;
      s += texture2D( tDiffuse, vUv + vec2( -t.x,  0.0 ) ).rgb * 2.0;
      s += texture2D( tDiffuse, vUv ).rgb * 4.0;
      s += texture2D( tDiffuse, vUv + vec2(  t.x,  0.0 ) ).rgb * 2.0;
      s += texture2D( tDiffuse, vUv + vec2( -t.x, -t.y ) ).rgb;
      s += texture2D( tDiffuse, vUv + vec2(  0.0, -t.y ) ).rgb * 2.0;
      s += texture2D( tDiffuse, vUv + vec2(  t.x, -t.y ) ).rgb;
      gl_FragColor = vec4( s * 0.0625, 1.0 );
    }`,
};

const UP_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uRadius;
    varying vec2 vUv;
    void main() {
      vec2 t = uTexel * uRadius;
      vec3 s = texture2D( tDiffuse, vUv + vec2( -t.x,  t.y ) ).rgb;
      s += texture2D( tDiffuse, vUv + vec2(  0.0,  t.y ) ).rgb * 2.0;
      s += texture2D( tDiffuse, vUv + vec2(  t.x,  t.y ) ).rgb;
      s += texture2D( tDiffuse, vUv + vec2( -t.x,  0.0 ) ).rgb * 2.0;
      s += texture2D( tDiffuse, vUv ).rgb * 4.0;
      s += texture2D( tDiffuse, vUv + vec2(  t.x,  0.0 ) ).rgb * 2.0;
      s += texture2D( tDiffuse, vUv + vec2( -t.x, -t.y ) ).rgb;
      s += texture2D( tDiffuse, vUv + vec2(  0.0, -t.y ) ).rgb * 2.0;
      s += texture2D( tDiffuse, vUv + vec2(  t.x, -t.y ) ).rgb;
      gl_FragColor = vec4( s * 0.0625, 1.0 );
    }`,
};

const COMPOSITE_SHADER = {
  uniforms: {
    tDiffuse: { value: null }, tBloom: { value: null },
    uStrength: { value: 0.6 }, uTint: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tBloom;
    uniform float uStrength; uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D( tDiffuse, vUv );
      gl_FragColor = vec4( base.rgb + texture2D( tBloom, vUv ).rgb * uTint * uStrength, base.a );
    }`,
};

function quad(Shader) {
  return new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(Shader.uniforms),
    vertexShader: Shader.vertexShader,
    fragmentShader: Shader.fragmentShader,
    depthTest: false, depthWrite: false,
  }));
}

class BloomPass extends Pass {
  constructor(width, height, opts = {}) {
    super();
    this.strength = opts.strength ?? 0.6;
    this.threshold = opts.threshold ?? 0.85;
    this.knee = opts.knee ?? 0.35;
    this.radius = opts.radius ?? 1.0;
    this.tint = new THREE.Color(opts.tint || 0xffffff);
    this.scale = opts.scale ?? 0.5;
    this.mipCount = Math.max(2, opts.mips || 5);

    this.brightQuad = quad(BRIGHT_SHADER);
    this.downQuad = quad(DOWN_SHADER);
    this.upQuad = quad(UP_SHADER);
    this.upQuad.material.blending = THREE.AdditiveBlending;
    this.upQuad.material.transparent = true;
    this.compQuad = quad(COMPOSITE_SHADER);
    this.mips = [];
    this.setSize(width, height);
  }

  setSize(width, height) {
    for (const rt of this.mips) rt.dispose();
    this.mips = [];
    let w = Math.max(2, Math.floor(width * this.scale));
    let h = Math.max(2, Math.floor(height * this.scale));
    for (let i = 0; i < this.mipCount; i++) {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      });
      rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      rt.texture.colorSpace = THREE.NoColorSpace;
      this.mips.push(rt);
      w = Math.max(2, Math.floor(w / 2));
      h = Math.max(2, Math.floor(h / 2));
    }
  }

  render(renderer, writeBuffer, readBuffer) {
    const oldAutoClear = renderer.autoClear;
    const mips = this.mips;

    this.brightQuad.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.brightQuad.material.uniforms.uThreshold.value = this.threshold;
    this.brightQuad.material.uniforms.uKnee.value = this.knee;
    renderer.setRenderTarget(mips[0]);
    renderer.clear();
    this.brightQuad.render(renderer);

    for (let i = 1; i < mips.length; i++) {
      const src = mips[i - 1];
      this.downQuad.material.uniforms.tDiffuse.value = src.texture;
      this.downQuad.material.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      renderer.setRenderTarget(mips[i]);
      renderer.clear();
      this.downQuad.render(renderer);
    }

    renderer.autoClear = false;
    for (let i = mips.length - 1; i > 0; i--) {
      const src = mips[i];
      this.upQuad.material.uniforms.tDiffuse.value = src.texture;
      this.upQuad.material.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.upQuad.material.uniforms.uRadius.value = this.radius;
      renderer.setRenderTarget(mips[i - 1]);
      this.upQuad.render(renderer);
    }
    renderer.autoClear = oldAutoClear;

    this.compQuad.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.compQuad.material.uniforms.tBloom.value = mips[0].texture;
    this.compQuad.material.uniforms.uStrength.value = this.strength;
    this.compQuad.material.uniforms.uTint.value.copy(this.tint);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.compQuad.render(renderer);
  }

  dispose() {
    for (const rt of this.mips) rt.dispose();
    this.brightQuad.dispose();
    this.downQuad.dispose();
    this.upQuad.dispose();
    this.compQuad.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Speed / grade pass                                                  */
/* ------------------------------------------------------------------ */
function speedShader(taps) {
  // The tap count is a compile-time constant so the cheap presets really do
  // fewer texture fetches.
  //
  // The taps are WEIGHTED (further from the centre counts for less) and the
  // weights must be summed back out, otherwise col ends up at
  // sum(1 - t*0.5) ~= 0.75 * taps times too bright. With 8 taps that is a 6x
  // over-exposure, which washes the whole frame out to near-white.
  const n = taps >= 6 ? 8 : taps >= 4 ? 4 : 2;
  let weightSum = 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    weightSum += 1 - t * 0.5;
  }
  const norm = (1 / weightSum).toFixed(6);

  const body = taps >= 4 ? `
      for ( int i = 0; i < ${n}; i++ ) {
        float t = float( i ) / ${(n - 1).toFixed(1)};
        vec2 uv = uCenter + dir * ( 1.0 - amount * t * 0.13 );
        col += texture2D( tDiffuse, uv ).rgb * ( 1.0 - t * 0.5 );
      }
      col *= ${norm};` : `
      col = texture2D( tDiffuse, uCenter + dir * ( 1.0 - amount * 0.13 ) ).rgb * 2.0;
      col += texture2D( tDiffuse, vUv ).rgb * 2.0;
      col *= 0.25;`;

  const chroma = taps >= 4 ? `
      float ca = uChroma + amount * 0.0035;
      col.r = mix( col.r, texture2D( tDiffuse, vUv + dir * ca ).r, 0.75 );
      col.b = mix( col.b, texture2D( tDiffuse, vUv - dir * ca ).b, 0.75 );` : '';

  return {
    uniforms: {
      tDiffuse: { value: null },
      uStrength: { value: 0.0 },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uVignette: { value: 0.5 },
      uChroma: { value: 0.0009 },
      uSaturation: { value: 1.1 },
      uFlash: { value: 0.0 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float uStrength, uVignette, uChroma, uSaturation, uFlash;
      uniform vec2 uCenter;
      varying vec2 vUv;
      void main() {
        vec2 dir = vUv - uCenter;
        float dist = length( dir );
        float amount = uStrength * smoothstep( 0.05, 0.8, dist );
        vec3 col = vec3( 0.0 );
        ${body}
        ${chroma}
        float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
        col = mix( vec3( l ), col, uSaturation );
        col *= mix( 1.0, smoothstep( 1.05, 0.25, dist ), uVignette );
        col += uFlash;
        gl_FragColor = vec4( col, 1.0 );
      }`,
  };
}

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.enabled = quality.post !== 'off';
    const size = renderer.getSize(new THREE.Vector2());

    if (!this.enabled) {
      // Direct-to-canvas path: three tone maps in the material shaders, so the
      // only extra cost is the vignette baked into the sky's own output.
      this.composer = null;
      this.setSize(size.x, size.y);
      return;
    }

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    if (quality.bloom) {
      this.bloom = new BloomPass(size.x, size.y, {
        strength: quality.bloomStrength,
        threshold: quality.bloomThreshold,
        radius: 1.15,
        scale: quality.bloomScale,
        mips: quality.bloomMips,
      });
      this.composer.addPass(this.bloom);
    }

    this.speedPass = new ShaderPass(speedShader(quality.speedTaps || 4));
    this.composer.addPass(this.speedPass);
    this.composer.addPass(new OutputPass());
    this.setSize(size.x, size.y);
  }

  setSize(w, h) {
    if (!this.composer) return;
    this.composer.setSize(w, h);
    if (this.bloom) this.bloom.setSize(w, h);
  }

  /** @param speed01 0..1 normalised speed  @param flash 0..1 impact flash */
  update(speed01, flash = 0, boost = 0) {
    if (!this.speedPass) return;
    const u = this.speedPass.uniforms;
    u.uStrength.value = speed01 * 0.8 + boost * 0.3;
    u.uVignette.value = 0.42 + speed01 * 0.28;
    u.uFlash.value = flash;
  }

  render(dt) {
    // `enabled` can be turned off at runtime by the performance governor, so
    // it has to be honoured here and not only where the composer is built.
    if (this.composer && this.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /**
   * Release the passes and the full-screen framebuffers they own.
   *
   * The composer holds two screen-sized render targets plus the whole bloom
   * pyramid, so skipping this leaks several megabytes every time the quality
   * preset changes -- which the auto governor is happy to do repeatedly.
   */
  dispose() {
    if (this.composer) {
      // EffectComposer.dispose only frees its own two targets, so the passes
      // (and the bloom pyramid behind them) have to be released explicitly.
      for (const pass of this.composer.passes) {
        if (pass && typeof pass.dispose === 'function') pass.dispose();
      }
      if (typeof this.composer.dispose === 'function') this.composer.dispose();
      else {
        if (this.composer.renderTarget1) this.composer.renderTarget1.dispose();
        if (this.composer.renderTarget2) this.composer.renderTarget2.dispose();
      }
    }
    this.composer = null;
    this.bloom = null;
    this.speedPass = null;
  }
}