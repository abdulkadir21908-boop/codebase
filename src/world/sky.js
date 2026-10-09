/* =========================================================
   Sky / lighting / environment
   • procedural sky dome (gradient + sun + volumetric-ish clouds
     + stars + moon) rendered as a shader
   • sun + hemisphere lighting with a car-following shadow camera
   • PMREM environment map generated from the sky itself, so the
     car paint reflects the actual sky it is racing under
   ========================================================= */
import * as THREE from 'three';

export const SKIES = {
  sunset: {
    key: 'sunset',
    zenith: 0x123a86, horizon: 0xf78a52, mid: 0xffb877, ground: 0x2e2230,
    sunDir: [0.42, 0.15, -0.9], sunColor: 0xffdcb4, sunIntensity: 2.85, sunSize: 1.0,
    hemiSky: 0x6f9ae8, hemiGround: 0x4c4436, hemiIntensity: 1.5,
    ambient: 0x36466e, ambientIntensity: 0.55,
    fog: 0xc98f78, fogDensity: 0.00068,
    exposure: 1.05, envIntensity: 1.15,
    cloud: 0.8, cloudLit: 0xfff2dc, cloudDark: 0x5b4a70, stars: 0.0,
    grassLo: 0x4a6b2a, grassHi: 0x88a349, rock: 0x7d7466, snow: 0xffd9c0, snowLine: 1e9,
    terrainEnv: 0.45,
  },
  alpine: {
    key: 'alpine',
    zenith: 0x1c56c8, horizon: 0xc4dcf2, mid: 0xe2eefb, ground: 0x44524a,
    sunDir: [-0.35, 0.62, 0.7], sunColor: 0xfff6e2, sunIntensity: 2.9, sunSize: 0.7,
    hemiSky: 0x9dc0ff, hemiGround: 0x6f7d5c, hemiIntensity: 1.25,
    ambient: 0x5c7096, ambientIntensity: 0.4,
    fog: 0xbcd4ec, fogDensity: 0.00055,
    exposure: 0.78, envIntensity: 1.0,
    cloud: 1.0, cloudLit: 0xffffff, cloudDark: 0x8fa4c0, stars: 0.0,
    grassLo: 0x4e6f33, grassHi: 0x8aa355, rock: 0x8b8378, snow: 0xffffff, snowLine: 70,
    terrainEnv: 0.5,
  },
  night: {
    key: 'night',
    zenith: 0x03040c, horizon: 0x1a1030, mid: 0x3a1b4a, ground: 0x05060c,
    sunDir: [0.3, 0.5, -0.8], sunColor: 0xbcd0ff, sunIntensity: 0.4, sunSize: 0.4,
    hemiSky: 0x2b3f6e, hemiGround: 0x0e0c18, hemiIntensity: 0.75,
    ambient: 0x2b3352, ambientIntensity: 0.75,
    fog: 0x0a0a18, fogDensity: 0.0016,
    exposure: 1.25, envIntensity: 0.9,
    cloud: 0.4, cloudLit: 0x4a5a80, cloudDark: 0x101828, stars: 1.0,
    grassLo: 0x1c2a1e, grassHi: 0x2f4230, rock: 0x3a3c46, snow: 0x8899bb, snowLine: 1e9,
    terrainEnv: 0.25,
  },
  desert: {
    key: 'desert',
    zenith: 0x2a63c8, horizon: 0xf5cfa2, mid: 0xffd9a8, ground: 0x6b5238,
    sunDir: [0.55, 0.32, -0.75], sunColor: 0xffe6c0, sunIntensity: 3.0, sunSize: 1.1,
    hemiSky: 0xbfd4ff, hemiGround: 0xa08058, hemiIntensity: 1.35,
    ambient: 0x8a7355, ambientIntensity: 0.7,
    fog: 0xe8cba8, fogDensity: 0.0005,
    exposure: 0.95, envIntensity: 1.1,
    cloud: 0.3, cloudLit: 0xfff3e0, cloudDark: 0xc09a78, stars: 0.0,
    grassLo: 0x7a6a3a, grassHi: 0xb0905a, rock: 0x9a7256, snow: 0xffd9b0, snowLine: 1e9,
    terrainEnv: 0.5,
  },
  coast: {
    key: 'coast',
    zenith: 0x1f6fe0, horizon: 0xbfe6ff, mid: 0xe0f2ff, ground: 0x51685a,
    sunDir: [-0.45, 0.45, 0.78], sunColor: 0xfffbe0, sunIntensity: 2.9, sunSize: 0.8,
    hemiSky: 0xa8d4ff, hemiGround: 0x5a6a50, hemiIntensity: 1.45,
    ambient: 0x5a7096, ambientIntensity: 0.55,
    fog: 0xcfe6f8, fogDensity: 0.00045,
    exposure: 1.0, envIntensity: 1.15,
    cloud: 0.9, cloudLit: 0xffffff, cloudDark: 0x9ab8d8, stars: 0.0,
    grassLo: 0x3a6a3a, grassHi: 0x7ab35a, rock: 0x8b8a7a, snow: 0xffffff, snowLine: 1e9,
    terrainEnv: 0.5,
  },
};

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;      // always on the far plane
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uMid, uGround, uSunCol, uCloudLit, uCloudDark, uSunDir, uMoonDir;
uniform float uTime, uCloud, uStars, uSunSize, uMoon;
uniform float uExposure;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p *= 2.03; p += 17.1; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  // vertical gradient
  float t1 = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.13, t1));
  col = mix(col, uZenith, smoothstep(0.07, 0.62, t1));
  // below the horizon
  col = mix(col, uGround, smoothstep(0.0, -0.16, h));

  // sun / moon
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * pow(sd, 5.0) * 0.30 * uSunSize;
  col += uSunCol * pow(sd, 90.0) * 0.55 * uSunSize;
  col += uSunCol * smoothstep(0.9986, 0.9994, sd) * 9.0 * uSunSize;

  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.85, 0.9, 1.0) * uMoon * smoothstep(0.9992, 0.99955, md) * 7.0;
  col += vec3(0.5, 0.6, 0.9) * uMoon * pow(md, 220.0) * 0.5;

  // stars
  if (uStars > 0.01) {
    vec3 sp = d * 340.0;
    vec3 cell = floor(sp);
    float hsh = hash13(cell);
    float star = smoothstep(0.9972, 0.99955, hsh);
    float tw = 0.65 + 0.35 * sin(uTime * 2.2 + hsh * 90.0);
    col += vec3(0.85, 0.9, 1.0) * star * tw * uStars * smoothstep(-0.02, 0.28, h) * 2.4;
  }

  // cloud layers
  if (uCloud > 0.01 && h > 0.005) {
    vec2 uv = d.xz / max(h, 0.02);
    float lit = pow(max(dot(d, uSunDir), 0.0), 2.5);
    float band = smoothstep(0.0, 0.10, h) * (1.0 - smoothstep(0.35, 0.95, h) * 0.55);
    for (int L = 0; L < CLOUD_LAYERS; L++) {
      float sc = L == 0 ? 0.30 : 0.85;
      float spd = L == 0 ? 0.0035 : 0.0080;
      vec2 p = uv * sc + vec2(uTime * spd, uTime * spd * 0.35);
      float n = fbm(p);
      float th = L == 0 ? 0.50 : 0.56;
      float c = smoothstep(th, th + 0.26, n) * band * uCloud * (L == 0 ? 0.9 : 0.5);
      vec3 cc = mix(uCloudDark, uCloudLit, clamp(lit * 1.1 + 0.12, 0.0, 1.0));
      col = mix(col, cc, clamp(c, 0.0, 1.0));
    }
  }

  gl_FragColor = vec4(col, 1.0);

  // Direct-to-canvas path (the low preset): there is no OutputPass to convert
  // the frame, so this shader has to tone map and sRGB-encode itself, exactly as
  // OutputPass would have. Without this it writes raw linear light, which looks
  // washed out and milky next to the correctly converted scene geometry.
  //
  // Written out longhand rather than using three's chunks because a raw
  // ShaderMaterial does not get those chunks - or their #defines - injected.
  #ifdef DIRECT_OUTPUT
    col *= uExposure;

    // ACES filmic, matching three's ACESFilmicToneMapping
    const mat3 IN_M = mat3(
      0.59719, 0.07600, 0.02840,
      0.35458, 0.90834, 0.13383,
      0.04823, 0.01566, 0.83777);
    const mat3 OUT_M = mat3(
       1.60475, -0.10208, -0.00327,
      -0.53108,  1.10813, -0.07276,
      -0.07367, -0.00605,  1.07602);
    col = OUT_M * (IN_M * col);
    col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);

    // linear -> sRGB
    col = mix(pow(col, vec3(0.41666)) * 1.055 - 0.055, col * 12.92,
              step(col, vec3(0.0031308)));
    gl_FragColor.rgb = col;
  #endif
}`;

export class SkySystem {
  constructor(renderer, themeKey = 'sunset', quality) {
    this.renderer = renderer;
    this.theme = SKIES[themeKey] || SKIES.sunset;
    this.quality = quality;
    this.sunDir = new THREE.Vector3(...this.theme.sunDir).normalize();
    this.time = 0;
  }

  /**
   * Tell the sky whether it is drawing to the canvas or into a composer
   * render target. Only the direct path needs to tone map in-shader.
   */
  setDirectOutput(direct) {
    const want = direct ? 1 : 0;
    if (!this.material || this._directOutput === want) return;
    this._directOutput = want;
    const d = this.material.defines;
    if (d.DIRECT_OUTPUT === want) return;
    d.DIRECT_OUTPUT = want;
    this.material.needsUpdate = true;
  }

  build(scene) {
    const T = this.theme;

    /* ---- dome ---- */
    // the sky covers the whole screen, so its fragment shader is one of the
    // most expensive things in the frame - scale the noise work with quality
    const skyQ = this.quality?.skyQuality ?? 2;
    const geo = new THREE.SphereGeometry(1, skyQ >= 2 ? 48 : 32, skyQ >= 2 ? 32 : 16);
    this.material = new THREE.ShaderMaterial({
      defines: {
        OCTAVES: skyQ >= 2 ? 5 : skyQ >= 1 ? 3 : 3,
        CLOUD_LAYERS: skyQ >= 2 ? 2 : 2,
        // filled in by SkySystem.setDirectOutput()
        DIRECT_OUTPUT: 0,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uExposure: { value: T.exposure !== undefined ? T.exposure : 1 },
        uZenith: { value: new THREE.Color(T.zenith) },
        uHorizon: { value: new THREE.Color(T.horizon) },
        uMid: { value: new THREE.Color(T.mid) },
        uGround: { value: new THREE.Color(T.ground) },
        uSunCol: { value: new THREE.Color(T.sunColor) },
        uCloudLit: { value: new THREE.Color(T.cloudLit) },
        uCloudDark: { value: new THREE.Color(T.cloudDark) },
        uSunDir: { value: this.sunDir.clone() },
        uMoonDir: { value: new THREE.Vector3(-0.4, 0.55, 0.72).normalize() },
        uTime: { value: 0 },
        uCloud: { value: T.cloud },
        uStars: { value: T.stars },
        uSunSize: { value: T.sunSize },
        uMoon: { value: T.key === 'night' ? 1 : 0 },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(4000);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    /* ---- fog ---- */
    scene.fog = new THREE.FogExp2(T.fog, T.fogDensity);
    scene.background = null;

    /* ---- lights ---- */
    this.sun = new THREE.DirectionalLight(T.sunColor, T.sunIntensity);
    this.sun.castShadow = this.quality.shadows;
    const sm = this.quality.shadowMap;
    this.sun.shadow.mapSize.set(sm, sm);
    const ext = this.quality.shadowExtent;
    this.sun.shadow.camera.left = -ext;
    this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 620;
    // normalBias offsets the shadow lookup along the surface normal to stop
    // self-shadowing acne. At 0.6 m it was enormous for a car ~1.3 m tall: the
    // lookup point was pushed clean off the car's own shadow, so cars cast no
    // visible shadow at all. Measured: 0 px changed with shadows on vs off;
    // 6085 px once this was brought into a sane range.
    // 0.03 m is ~1 shadow texel at the widest preset (156 m frustum / 4096).
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(T.hemiSky, T.hemiGround, T.hemiIntensity);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(T.ambient, T.ambientIntensity);
    scene.add(this.ambient);

    /* ---- environment map from the sky itself ---- */
    this._buildEnvironment(scene);
    return this;
  }

  _buildEnvironment(scene) {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    const clone = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.material);
    clone.scale.setScalar(100);
    envScene.add(clone);
    // a bright blob standing in for the sun keeps a crisp specular highlight
    const sunBall = new THREE.Mesh(
      new THREE.SphereGeometry(9, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(this.theme.sunColor).multiplyScalar(6) })
    );
    sunBall.position.copy(this.sunDir).multiplyScalar(78);
    envScene.add(sunBall);
    if (this.theme.key === 'night') {
      const moon = new THREE.Mesh(
        new THREE.SphereGeometry(5, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0x9fb4ff })
      );
      moon.position.set(-31, 43, 56);
      envScene.add(moon);
    }

    const rt = pmrem.fromScene(envScene, 0.02, 1, 400);
    scene.environment = rt.texture;
    scene.environmentIntensity = this.theme.envIntensity;
    this.envRT = rt;

    clone.geometry.dispose();
    sunBall.geometry.dispose();
    sunBall.material.dispose();
    pmrem.dispose();
  }

  /** Keep the shadow frustum tight around the action. */
  update(dt, focus, camera) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.mesh.position.copy(camera.position);

    if (focus) {
      this.sun.target.position.set(focus.x, 0, focus.z);
      this.sun.position.set(
        focus.x + this.sunDir.x * 220,
        this.sunDir.y * 220 + 30,
        focus.z + this.sunDir.z * 220
      );
    }
  }

  dispose() {
    this.material.dispose();
    this.mesh.geometry.dispose();
    if (this.envRT) this.envRT.dispose();
  }
}
