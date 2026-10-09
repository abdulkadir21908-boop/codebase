/* =========================================================
   Apex Velocity — entry point
   Boots the renderer, builds a circuit, runs the race and
   drives the game loop.
   ========================================================= */
import * as THREE from 'three';
import { Track, TRACKS } from './world/track.js';
import { Scenery } from './world/scenery.js';
import { SkySystem, SKIES } from './world/sky.js';
import { buildCar, disposeCar, CAR_COLORS } from './car/carModel.js';
import { Vehicle, CONTROL, CONTROL_ORDER, SETUP_DEFAULT, SETUP_KEYS } from './car/vehicle.js';
import { AIDriver } from './car/ai.js';
import { Effects } from './fx/particles.js';
import { PostFX } from './fx/postfx.js';
import { HUD } from './ui/hud.js';
import { Input } from './core/input.js';
import { loadRecords, saveRecords, trackRecords, recordLap, recordRace, describeRecords, clearRecords } from './core/records.js';
import { TEAMS, assignTeams, maxTeams, teamStandings } from './core/teams.js';
import {
  CARS, CAR_BY_ID, loadGarage, saveGarage, ownsCar, selectedCar,
  buyCar, selectCar, racePayout, awardRace, carStats, formatCoins,
} from './core/garage.js';
import { GameAudio } from './core/audio.js';
import { PerfGovernor, AutoProbe, pickQuality, detectHardware, guessQuality, QUALITY_ORDER } from './core/perf.js';
import { blobShadow } from './world/textures.js';
import { clamp, lerp, damp, smoothstep, formatTime, ordinal } from './util/math.js';

/**
 * WebGL support probe. The page computes this once in index.html so the answer
 * is shared; kept here as a fallback for anything that imports the module
 * directly.
 */
function hasWebGL() {
  if (typeof window !== 'undefined' && window.__hasWebGL !== undefined) return window.__hasWebGL;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}

/** Show the readable error overlay (defined in index.html). */
function fatal(msg) {
  const box = document.getElementById('fatal');
  const out = document.getElementById('fatalMsg');
  if (!box) { console.error(msg); return; }
  if (out) out.textContent = msg;
  box.classList.remove('hidden');
  document.getElementById('loader')?.classList.add('hidden');
}

/* Cars per team for each team-count option in the menu. Two per team keeps the
   biggest option at 12 cars, which the grid and scenery budget can absorb. */
const TEAM_CARS_PER_TEAM = { 2: 2, 3: 2, 4: 2, 6: 2 };

/* ------------------------------------------------------------------ */
/* Setup panel                                                           */
/* ------------------------------------------------------------------ */
/**
 * Every dial in the setup panel, in display order. `numeric` marks the ones
 * stored as numbers; the rest are named levels. These mirror SETUP_DEFAULT in
 * car/vehicle.js — the physics side ignores anything not listed there.
 */
const SETUP_UI = [
  {
    id: 'transmission', label: 'Gearbox', values: ['auto', 'manual'],
    labels: { auto: 'Auto', manual: 'Manual' },
    note: 'Manual: Q / E to shift (or the pad bumpers). No auto-shifts.',
  },
  {
    id: 'traction', label: 'Traction ctrl', values: ['off', 'low', 'med', 'high'],
    labels: { off: 'Off', low: 'Low', med: 'Med', high: 'High' },
    title: 'Cuts drive when the rear axle exceeds its slip allowance',
    note: 'Off = wheelspin is yours to manage.',
  },
  {
    id: 'abs', label: 'ABS', values: ['off', 'low', 'high'],
    labels: { off: 'Off', low: 'Low', high: 'High' },
    title: 'Eases the brake when the fronts lock',
    note: 'Off = you can lock up and lose steering.',
  },
  {
    id: 'esc', label: 'Stability', values: ['off', 'low', 'high'],
    labels: { off: 'Off', low: 'Low', high: 'High' },
    title: 'Bleeds off rotation you did not ask for',
    note: 'Off = the car will rotate exactly as much as physics says.',
  },
  {
    id: 'brakeBias', label: 'Brake bias', numeric: true, values: [45, 52, 60, 68, 75],
    labels: { 45: '45%', 52: '52%', 60: '60%', 68: '68%', 75: '75%' },
    title: 'Share of braking force on the front axle',
    note: 'More forward locks the fronts first (understeer). Less rearward spins the car.',
  },
  {
    id: 'steerLock', label: 'Steer lock', numeric: true, values: [70, 85, 100, 115, 130],
    labels: { 70: '70%', 85: '85%', 100: '100%', 115: '115%', 130: '130%' },
    title: 'Multiplier on maximum steering angle',
  },
  {
    id: 'downforce', label: 'Downforce', numeric: true, values: [50, 75, 100, 140, 180],
    labels: { 50: '50%', 75: '75%', 100: '100%', 140: '140%', 180: '180%' },
    title: 'Aero load — more grip at speed, more drag',
  },
];

function bar(label, level, value) {
  let bars = '';
  for (let i = 0; i < 5; i++) bars += `<i class="${i < level ? 'on' : ''}"></i>`;
  return `<div class="stat-row"><span>${label}</span><div class="stat-bars">${bars}</div><span class="stat-val">${value}</span></div>`;
}

/* ------------------------------------------------------------------ */
/* Grid order                                                            */
/* ------------------------------------------------------------------ */
/**
 * Grid slot for each car, indexed by car position (car 0 is the player).
 *
 * The player lines up on the third slot and the rivals take every remaining
 * slot in order. Indexing the rivals by their own car number instead makes the
 * player and car 2 both read slots[2]: the two spawn inside each other and the
 * front row is left empty, which is what put a rival on top of you at the line.
 */
function gridOrder(n) {
  const playerSlot = Math.max(0, Math.min(2, n - 1));
  const order = [playerSlot];
  for (let k = 0; k < n; k++) if (k !== playerSlot) order.push(k);
  return order;
}

/* ------------------------------------------------------------------ */
/* Quality presets                                                     */
/* ------------------------------------------------------------------ */
/**
 * Quality presets.
 *
 * Profiling on an Intel HD 4400 (D3D11 via ANGLE) showed the two dominant
 * costs are the shadow pass and post-processing — geometry, particles and the
 * simulation are all negligible. The presets are therefore mostly about
 * shadows, pixel count and how many full-screen passes we run.
 *
 *   post        'off' renders straight to the canvas (three tone maps in-shader)
 *   bloomMips   depth of the bloom pyramid (each level costs two blur passes)
 *   speedTaps   texture fetches in the speed/grade pass
 *   shadowCasters  who writes into the shadow map
 *   scale       base resolution scale, before the dynamic governor trims it
 */
const QUALITY = {
  low: {
    name: 'low',
    scale: 0.72, maxPixelRatio: 1,
    shadows: false, shadowMap: 512, shadowExtent: 34, shadowCasters: 'none',
    post: 'off', bloom: false, speedTaps: 3,
    skyQuality: 0,
    terrainRings: 80, terrainSegs: 56, propScale: 0.3, treeShadows: false,
    smokeMax: 160, glowMax: 90, skidMax: 260, particleScale: 0.45,
    blobShadow: true, softShadow: false, richCar: false,
  },
  medium: {
    name: 'medium',
    scale: 0.95, maxPixelRatio: 1.25,
    shadows: true, shadowMap: 1024, shadowExtent: 46, shadowCasters: 'cars',
    post: 'on', bloom: true, bloomMips: 3, bloomScale: 0.3,
    bloomStrength: 0.34, bloomThreshold: 1.45, speedTaps: 4,
    skyQuality: 1,
    terrainRings: 140, terrainSegs: 100, propScale: 0.7, treeShadows: false,
    smokeMax: 480, glowMax: 260, skidMax: 700, particleScale: 0.8,
    blobShadow: true, softShadow: false, richCar: false,
  },
  high: {
    name: 'high',
    scale: 1, maxPixelRatio: 1.75,
    shadows: true, shadowMap: 2048, shadowExtent: 62, shadowCasters: 'all',
    post: 'on', bloom: true, bloomMips: 5, bloomScale: 0.55,
    bloomStrength: 0.4, bloomThreshold: 1.3, speedTaps: 8,
    skyQuality: 2,
    terrainRings: 200, terrainSegs: 150, propScale: 1.1, treeShadows: true,
    smokeMax: 800, glowMax: 420, skidMax: 1200, particleScale: 1.1,
    blobShadow: true, softShadow: true, richCar: true,
  },
  // For a dedicated card with memory to spare. Everything the high preset
  // does, but without being careful about it: full-resolution shadows, a
  // deeper bloom pyramid and a denser world. Only ever chosen when the
  // machine has actually measured comfortably fast, or asked for it.
  ultra: {
    name: 'ultra',
    scale: 1, maxPixelRatio: 2,
    shadows: true, shadowMap: 4096, shadowExtent: 78, shadowCasters: 'all',
    post: 'on', bloom: true, bloomMips: 6, bloomScale: 0.7,
    bloomStrength: 0.45, bloomThreshold: 1.25, speedTaps: 10,
    skyQuality: 3,
    terrainRings: 260, terrainSegs: 190, propScale: 1.4, treeShadows: true,
    smokeMax: 1100, glowMax: 620, skidMax: 1800, particleScale: 1.35,
    blobShadow: true, softShadow: true, richCar: true,
  },
};

// QUALITY_ORDER (worst-to-best, for the auto governor) lives in core/perf.js
// so the picking logic and the ordering can never drift apart.

const CAM_MODES = ['CHASE', 'CLOSE', 'COCKPIT', 'CINEMATIC'];
const STORE_KEY = 'apex-velocity.v1';

/* ------------------------------------------------------------------ */
class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.settings = this.loadSettings();
    this.autoQuality = this.settings.quality === 'auto';
    // Start from what the machine *is* rather than what it managed to render
    // for two seconds in the menu, which is a far easier view than a race.
    this.hw = detectHardware();
    this.qualityName = this.autoQuality ? guessQuality(this.hw)
      : (QUALITY[this.settings.quality] ? this.settings.quality : 'medium');
    this.quality = QUALITY[this.qualityName];
    // Force a fixed, full-quality preset and stop the live governor from
    // silently dropping the resolution. The auto profiler was measuring a
    // slow/pixel-starved machine and cutting the render to 55%, which made
    // the whole scene look soft.
    this.autoQuality = false;
    this.qualityName = 'high';
    this.quality = QUALITY.high;
    this.resScale = 1;
    this.resScale = 1;
    this.gov = new PerfGovernor(
      () => { this.resScale = 1; this._applyResolution(); },
      () => {},
    );
    // the measured floor: auto may climb back up to here, never above it
    this._qualityFloor = this.qualityName;
    this._climbHold = 0;
    this.state = 'menu';
    this.raceTime = 0;
    this.countdown = 0;
    this.camMode = 0;
    this.clock = new THREE.Clock();
    this.flash = 0;
    this.shake = 0;
    this.paused = false;
    this.resultsShown = false;
    this.slowmo = 1;
    this._loading = false;
    this._tmp = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this._fov = 70;
    this.bestEver = this.settings.best || 0;
    this.records = loadRecords();
    this.garage = loadGarage();
    // Track-record best for the currently selected circuit, seeded from the
    // legacy single global best so upgrading players keep their PB.
    const tr = trackRecords(this.records, this.settings.track);
    if (!tr.best && this.bestEver) { tr.best = this.bestEver; saveRecords(this.records); }
    this._recordFlash = 0;
  }

  /* ---------------- persistence ---------------- */
  loadSettings() {
    const def = {
      quality: 'auto', laps: 3, rivals: 5, track: 'sunset', fov: 70,
      audio: true, control: 'easy', best: 0, muted: false,
      assists: Object.assign({}, SETUP_DEFAULT),
      units: 'kmh', camera: 'chase', assistsVisible: true,
      raceMode: 'solo', teams: 2, players: 1,
    };
    let out = def;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      out = raw ? Object.assign(def, JSON.parse(raw)) : def;
    } catch (e) { /* fall through to defaults */ }
    // A stored value from an older build (or a hand-edited one) must not leave
    // the player on a preset that no longer exists.
    if (!CONTROL[out.control]) out.control = def.control;
    // Same for the setup block: merge over the defaults and reject any value
    // of the wrong type so a hand-edited file cannot feed NaN into the tyre
    // model.
    const a = Object.assign({}, SETUP_DEFAULT, out.assists || {});
    for (const k of SETUP_KEYS) {
      if (typeof a[k] !== typeof SETUP_DEFAULT[k]) a[k] = SETUP_DEFAULT[k];
      if (typeof a[k] === 'number' && !Number.isFinite(a[k])) a[k] = SETUP_DEFAULT[k];
    }
    if (a.brakeBias < 35 || a.brakeBias > 85) a.brakeBias = SETUP_DEFAULT.brakeBias;
    if (a.steerLock < 60 || a.steerLock > 140) a.steerLock = SETUP_DEFAULT.steerLock;
    if (a.downforce < 20 || a.downforce > 200) a.downforce = SETUP_DEFAULT.downforce;
    out.assists = a;
    if (!['solo', 'teams', 'split', 'online'].includes(out.raceMode)) out.raceMode = 'solo';
    out.teams = Math.max(2, Math.min(6, +out.teams || 2));
    out.players = Math.max(1, Math.min(2, +out.players || 1));
    return out;
  }
  saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
  }

  /* ---------------- boot ---------------- */
  async boot() {
    this._noPost = new URLSearchParams(location.search).get('nopost');
    this._dbgCam = (new URLSearchParams(location.search).get('cam') | 0) || 0;
    this._auto = /[?&]auto=1/.test(location.search);
    this._selfTestMode = /[?&]selftest=1/.test(location.search);
    this._captureMode = /[?&]shot=/.test(location.search);
    this._topDown = /[?&]top=1/.test(location.search);
    this._raceTestMode = /[?&]racetest=1/.test(location.search);
    this._perfMode = /[?&]perf=/.test(location.search);
    this._partsMode = /[?&]perfparts=1/.test(location.search);
    this._perfTestMode = /[?&]perftest=1/.test(location.search);
    const qLevel = new URLSearchParams(location.search).get('q');
    if (qLevel && QUALITY[qLevel]) {
      // dev/benchmark override: pin the preset and switch auto detection off
      this.settings.quality = qLevel;
      this.qualityName = qLevel;
      this.quality = QUALITY[qLevel];
      this.autoQuality = false;
      this._probed = true;
    }
    const qTrack = new URLSearchParams(location.search).get('track');
    if (qTrack && TRACKS[qTrack]) this.settings.track = qTrack;
    this._initRenderer();
    // The GL renderer string is only readable once the context exists, and it
    // is what tells us about software rasterisers and shared memory. Refine
    // the prior *before* the world is built, because the preset decides how
    // much terrain, scenery and particle budget gets allocated.
    this._refineQualityFromHardware();
    await this._loadWorld(this.settings.track);
    this._initUI();
    this._initInput();
    window.__gameBooted = true;
    document.getElementById('loader').classList.add('hidden');
    this.state = 'menu';
    if (this._selfTestMode) { this._selfTest(); return; }
    if (this._captureMode) { await this._capture(); return; }
    if (this._raceTestMode) { await this._raceTest(); return; }
    if (this._perfMode) { await this._perf(); return; }
    if (this._partsMode) { await this._perfParts(); return; }
    if (this._perfTestMode) { await this._perfGovernorTest(); return; }
    this.showMenu();
    this._loop();
  }

  _initRenderer() {
    if (!hasWebGL()) {
      fatal('This machine or browser cannot create a WebGL context, so the 3D ' +
        'view cannot start. Enable hardware acceleration in your browser ' +
        'settings, update the graphics driver, or try another browser.');
      throw new Error('WebGL unavailable');
    }

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      // MSAA on the default framebuffer would be wasted work: the mid/high
      // presets draw through an EffectComposer whose targets get no MSAA, and
      // the low preset is fill-rate bound. Off everywhere.
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      failIfMajorPerformanceCaveat: false,
    });
    // this.renderer must exist before _applyResolution() touches it
    this.renderer = renderer;
    this._applyResolution();
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = this.quality.shadows;
    renderer.shadowMap.type = this.quality.softShadow ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.35, 9000);
    this.camera.position.set(0, 8, 20);
    this.baseFov = this.settings.fov;

    addEventListener('resize', () => this._onResize());

    // Driver-level context loss: GPU reset, driver update, switching between
    // hybrid GPUs, or a backgrounded tab on some drivers. three re-uploads its
    // own resources on restore, so we only have to stop drawing meanwhile.
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      document.getElementById('ctxLost')?.classList.remove('hidden');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      document.getElementById('ctxLost')?.classList.add('hidden');
      this._applyResolution();
      renderer.shadowMap.needsUpdate = true;
      this.clock.getDelta();          // discard the gap while we were dark
      this.gov && this.gov.reset();
    });
  }

  /**
   * Capture mode (?shot=<seconds>&name=<label>).
   * Simulates the race forward without rendering, then draws a single frame
   * and uploads the canvas to the dev server. Lets the game be inspected on
   * machines where the browser window cannot be brought to the foreground.
   */
  async _capture() {
    const params = new URLSearchParams(location.search);
    const seconds = parseFloat(params.get('shot')) || 20;
    const name = params.get('name') || 'shot';
    const W = parseInt(params.get('w') || '1280', 10);
    const H = parseInt(params.get('h') || '760', 10);

    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(W, H);
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';

    // put the field on the grid and release the throttle
    this.startRace();
    const driver = new AIDriver(this.player, this.track, { skill: 0.95, seed: 7 });
    this.camMode = this._dbgCam || 0;
    this._camSnap();

    const dt = 1 / 60;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      driver.update(dt, this.cars);
      for (const ai of this.ais) ai.update(dt, this.cars);
      this._resolveCarCollisions();
      // effects and rendering at 10 Hz is plenty for a still
      if (i % 6 === 0) {
        this.raceTime += dt * 6;
        this._updateStandings();
        for (const v of this.cars) this._carEffects(v, dt * 6);
        this.effects.update(dt * 6, this.camera, H);
        this.post.update(clamp((this.player.speed - 22) / 70, 0, 1), 0, this.player.boosting ? 1 : 0);
      }
      this.scenery.update(performance.now() * 0.001);
      if (this._topDown) {
        this.camera.position.set(this.player.pos.x, this.player.pos.y + 34, this.player.pos.z + 0.01);
        this.camera.lookAt(this.player.pos.x, this.player.pos.y, this.player.pos.z);
        this.camera.fov = 60;
        this.camera.updateProjectionMatrix();
        this.sky.update(dt, this.player.pos, this.camera);
      } else {
        this._updateCamera(dt);
      }
      if (i % 6 === 0) this.post.render(dt * 6);
    }
    this.state = 'racing';

    this.post.render(0.016);
    const url = this.canvas.toDataURL('image/jpeg', 0.86);
    const sf = this.track.surface(this.player.pos.x, this.player.pos.z, {});
    const info = 't=' + seconds + 's kmh=' + Math.round(this.player.kmh) +
      ' lap=' + this.player.lap + ' pos=' + this.player.position +
      ' gear=' + this.player.gear + ' lat=' + (this.player.trackOffset || 0).toFixed(1) +
      ' off=' + this.player.offRoad.toFixed(2) +
      ' cam=' + this.camera.position.toArray().map(n => n.toFixed(1)).join(',') +
      ' car=' + this.player.pos.toArray().map(n => n.toFixed(1)).join(',') +
      ' camMode=' + this.camMode +
      ' tris=' + this.renderer.info.render.triangles +
      ' surf=' + sf.kind + '/' + sf.lateral.toFixed(1) + '/hw' + this.track.halfWidth.toFixed(1) +
      ' s=' + this.player.progressS.toFixed(0);
    await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: url });
    const el = document.createElement('pre');
    el.id = 'capture';
    el.style.cssText = 'position:fixed;left:0;bottom:0;z-index:999;background:#000c;color:#0f0;font:12px monospace;padding:6px;';
    el.textContent = 'captured ' + name + ' :: ' + info;
    document.body.appendChild(el);
  }

  /**
   * The menu already renders real frames while the camera drifts around the
   * circuit, so use them to size the preset once. Only runs when the graphics
   * setting is Auto, and never rebuilds mid-race.
   */
  _updateDetail() {
    this.hud._detail = this.quality.name.toUpperCase() +
      '  ' + Math.round(this.renderer.getPixelRatio() * 100) + '% res' +
      (this.resScale < 0.995 ? '  (auto ' + Math.round(this.resScale * 100) + '%)' : '');
  }

  /** Push the preset's shadow settings into the renderer. */
  _applyShadowSettings() {
    const r = this.renderer;
    r.shadowMap.enabled = this.quality.shadows;
    r.shadowMap.type = this.quality.softShadow ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  }

  /**
   * Apply the parts of a preset that cost nothing to change: resolution,
   * shadows and the post chain. Those three dominate the frame, and none of
   * them need the world rebuilt, so this is safe mid-race.
   */
  _applyQualityCheap(name) {
    if (!QUALITY[name]) return false;
    this.qualityName = name;
    this.quality = QUALITY[name];
    this._applyShadowSettings();
    if (this.post) this.post.enabled = this.quality.post !== 'off';
    this._syncSkyOutput();
    this._applyResolution();
    this.gov.reset();
    return true;
  }

  /**
   * Switch preset and rebuild the world, so scenery density, terrain
   * subdivision and particle budgets match the new preset. Only safe when no
   * race is in progress -- rebuilding resets the cars.
   */
  _setQuality(name, note, force) {
    if (!QUALITY[name] || (!force && name === this.qualityName)) return false;
    this._applyQualityCheap(name);
    this._reloadWorld().then(() => {
      const el = document.getElementById('perfNote');
      if (el && note) el.textContent = note;
    }).catch(() => {
      // _reloadWorld has already logged the reason. At this point the world is
      // half torn down, so say so plainly instead of leaving a dead menu that
      // silently fails on every frame.
      fatal('Could not switch the graphics preset. Reload the page to carry on.');
    });
    return true;
  }

  /**
   * A preset change made mid-race only took the cheap parts. Finish the job
   * next time we are back at the menu, where a rebuild is harmless.
   */
  _flushPendingQuality() {
    if (!this._pendingQuality) return;
    const name = this._pendingQuality;
    this._pendingQuality = null;
    this._setQuality(name, null, true);
  }

  /**
   * Second look at the machine now that WebGL exists. The pre-renderer guess
   * can see cores and RAM, but not whether we are on a software rasteriser or
   * borrowing system memory for the GPU. Runs before the world is built,
   * because the preset decides how much of everything gets allocated.
   */
  _refineQualityFromHardware() {
    this.hw = detectHardware(this.renderer.getContext());
    if (!this.autoQuality || this._probed) return;
    const prior = guessQuality(this.hw);
    if (prior === this.qualityName || !QUALITY[prior]) return;
    this.qualityName = prior;
    this.quality = QUALITY[prior];
    this._applyShadowSettings();
    this._applyResolution();
  }

  /**
   * Menu probe. The idle camera roams the circuit, which is a far easier view
   * than a race, so this is treated as a hint and confirmed by _raceProbe once
   * the race is actually running.
   */
  _autoProbe(dtRaw) {
    if (!this.autoQuality || this._probed || this.paused) return;
    if (!this._probe) this._probe = new AutoProbe();
    if (!this._probe.push(dtRaw)) return;

    this._probed = true;
    const fps = this._probe.fps;
    this._probe.reset();
    this.gov.reset();
    const name = pickQuality(fps, this.hw);
    if (name === this.qualityName) return;
    this._setQuality(name, 'Graphics set to ' + name.toUpperCase() + ' automatically (' +
      Math.round(fps) + ' fps measured)');
  }


  /**
   * Confirm the preset once the race is genuinely under way. This is the
   * measurement that actually counts, because it sees the full field of cars,
   * the particles and the scenery the race camera passes. Only ever steps
   * *down*: climbing would mean rebuilding the world mid-race.
   */
  _raceProbe(dt) {
    if (!this.autoQuality || this._raceProbed || this.paused) return;
    // raceTime is in milliseconds, like everything else that reaches formatTime
    if (this.state !== 'racing' || this.raceTime < 2500) return;
    this._raceProbeAcc = (this._raceProbeAcc || 0) + dt;
    this._raceProbeFrames = (this._raceProbeFrames || 0) + 1;
    if (this._raceProbeAcc < 2.5) return;
    this._raceProbed = true;
    const fps = this._raceProbeFrames / this._raceProbeAcc;
    const name = pickQuality(fps, this.hw);
    if (QUALITY_ORDER.indexOf(name) >= QUALITY_ORDER.indexOf(this.qualityName)) return;
    this._applyQualityCheap(name);
    this._pendingQuality = name;
    const el = document.getElementById('perfNote');
    if (el) el.textContent = 'Dropped to ' + name.toUpperCase() + ' to hold the frame rate (' +
      Math.round(fps) + ' fps measured in a race)';
  }

  /**
   * Called by the governor whenever the frame rate is being missed even at
   * minimum resolution (starving = true), and again once there is headroom
   * again (starving = false).
   *
   * This used to ignore its argument and only ever step down, so the preset
   * ratcheted one way: a machine demoted during a bad moment could never
   * climb back however much spare frame rate it later had.
   */
  _stepDownQuality(starving) {
    if (!this.autoQuality) return;
    const i = QUALITY_ORDER.indexOf(this.qualityName);

    if (starving) {
      if (i <= 0) return;                     // already at the floor
      const name = QUALITY_ORDER[i - 1];
      this._applyQualityCheap(name);
      if (this.state === 'menu') this._setQuality(name, null, true);
      else this._pendingQuality = name;
      const el = document.getElementById('perfNote');
      if (el) el.textContent = 'Dropped to ' + name.toUpperCase() + ' to hold the frame rate';
      return;
    }

    // Climbing costs a world rebuild, so it is only done from the menu, only
    // on real headroom, never past the measured floor, and never twice in a
    // hurry. A preset that oscillates is worse than one a notch too low.
    if (this.state !== 'menu') return;
    if (this._climbHold > 0) { this._climbHold--; return; }
    if (i >= QUALITY_ORDER.length - 1) return;
    if (this.qualityName === this._qualityFloor) return;
    if (this.gov.fps < 75) return;

    const name = QUALITY_ORDER[i + 1];
    this._qualityFloor = name;
    this._climbHold = 3;
    this._setQuality(name, 'Raised to ' + name.toUpperCase() +
      ' - this machine has frame rate to spare');
  }

  /**
   * ?perftest=1 - verify the governor's adaptation logic.
   *
   * Feeds PerfGovernor a synthetic frame time for a range of target frame
   * rates and asserts that resolution falls, that a preset is eventually
   * given up, and that a fast machine is left alone. Pure logic, so it does
   * not depend on the window being visible.
   */
  async _perfGovernorTest() {
    const lines = [];
    const say = (t) => lines.push(t);
    let problems = 0;
    const fail = (t) => { lines.push('  FAIL  ' + t); problems++; };

    /* ---- boot-time auto detection ------------------------------------ */
    // The regression this exists for: probing the first two seconds after the
    // world is built measures shader compilation, not the machine. It reported
    // 23 fps on a laptop that then held a steady 60, and quietly demoted it to
    // the low preset - which is the difference between a good-looking game and
    // a flat one.
    const bootCases = [
      {
        label: 'warm-up 12 fps, then 60 fps',
        warmFps: 12, realFps: 60, want: 'high',
        why: 'compilation frames must be discarded, not measured',
      },
      {
        label: 'warm-up 12 fps, then 30 fps',
        warmFps: 12, realFps: 30, want: 'low',
        why: 'a genuinely slow machine is still caught',
      },
      {
        label: 'warm-up 8 fps, then 55 fps',
        warmFps: 8, realFps: 55, want: 'high',
        why: 'worst-case warm-up must not demote a fast machine',
      },
      {
        label: 'steady 58 fps throughout',
        warmFps: 58, realFps: 58, want: 'high',
        why: 'no warm-up at all',
      },
      {
        label: 'steady 20 fps throughout',
        warmFps: 20, realFps: 20, want: 'low',
        why: 'honest slow machine',
      },
    ];

    const boot = bootCases.map((c) => {
      const probe = new AutoProbe();
      // Feed loader-quality frames only until the probe declares itself warm,
      // which is what actually happens: the scene stops being the bottleneck at
      // some point during load and the machine takes over.
      let guard = 0;
      while (!probe.warmed && guard++ < 20000) probe.push(1 / c.warmFps);
      const decidedEarly = probe.done;
      // then real frames
      for (let i = 0, n = Math.round(4 * c.realFps); i < n; i++) probe.push(1 / c.realFps);
      return { ...c, fps: probe.fps, got: pickQuality(probe.fps, null), decidedEarly };
    });

    say('BOOT AUTO-DETECTION  (3 s of loader frames, then 3 s of real frames)');
    say('scenario'.padEnd(30) + 'warm'.padStart(6) + 'real'.padStart(7) +
      'measured'.padStart(10) + 'picked'.padStart(10) + '  expected');
    say('-'.repeat(78));
    for (const b of boot) {
      say(b.label.padEnd(30) + String(b.warmFps).padStart(6) + String(b.realFps).padStart(7) +
        b.fps.toFixed(0).padStart(10) + b.got.padStart(10) +
        (b.got === b.want ? '  ok' : '  WANT ' + b.want));
    }
    say('');

    for (const b of boot) {
      if (b.decidedEarly) fail(b.label + ': decided before the warm-up window closed');
      if (b.got !== b.want) {
        fail(b.label + ': picked ' + b.got + ' (measured ' + b.fps.toFixed(0) +
          ' fps), want ' + b.want + ' - ' + b.why);
      }
    }

    const QIDX = { low: 0, medium: 1, high: 2 };

    const scenarios = [
      { label: '144 Hz desktop', fps: 144, start: 'high' },
      { label: '60 Hz desktop', fps: 60, start: 'high' },
      { label: '48 fps laptop', fps: 48, start: 'high' },
      { label: '42 fps laptop', fps: 42, start: 'high' },
      { label: '30 fps weak iGPU', fps: 30, start: 'high' },
      { label: '20 fps old iGPU', fps: 20, start: 'high' },
      { label: '12 fps software GL', fps: 12, start: 'high' },
    ];

    const results = scenarios.map((sc) => {
      let idx = QIDX[sc.start];
      let scale = 1;
      let postOn = true;
      const dt = 1 / sc.fps;
      const gov = new PerfGovernor(
        (v) => { scale = v; },
        () => { idx = Math.max(0, idx - 1); postOn = false; },
      );
      // This harness runs in whatever window the automation happens to have,
      // which is usually a hidden tab. The visibility guard would otherwise
      // reset the governor on every frame and the test would prove nothing.
      gov.ignoreHidden = true;
      const frames = Math.round(12 / dt);
      for (let i = 0; i < frames; i++) gov.update(dt);
      return { ...sc, scale, reached: QUALITY_ORDER[idx], postOn, steps: gov.changed, frames };
    });

    say('GOVERNOR TEST - 12 s of synthetic frames per scenario');
    say('scenario'.padEnd(23) + 'fps'.padStart(5) + 'res'.padStart(8) + 'preset'.padStart(10) +
      'post'.padStart(7) + 'steps'.padStart(7));
    say('-'.repeat(60));
    for (const r of results) {
      say(r.label.padEnd(23) + String(r.fps).padStart(5) +
        (r.scale * 100).toFixed(0).padStart(7) + '%' +
        r.reached.padStart(10) + (r.postOn ? '     on' : '    off') + String(r.steps).padStart(7));
    }
    say('');

    const by = (f) => results.find((r) => r.fps === f);

    // a fast machine must be left completely alone
    for (const f of [144, 60]) {
      const r = by(f);
      if (r.scale < 0.999) fail(f + ' fps: resolution was cut to ' + r.scale.toFixed(2));
      if (QIDX[r.reached] > QIDX.high) fail(f + ' fps: impossible preset ' + r.reached);
    }
    if (by(60).reached !== 'high') fail('60 fps: expected to stay on high, got ' + by(60).reached);

    // a struggling machine must be helped, in the right order
    for (const f of [30, 20, 12]) {
      const r = by(f);
      if (r.scale >= 0.999) fail(f + ' fps: resolution was never scaled down');
      if (QIDX[r.reached] >= QIDX.medium) fail(f + ' fps: preset stayed at ' + r.reached);
    }

    // a merely-slightly-short machine must keep its scenery: 42-48 fps is
    // playable and does not justify dropping to the low preset
    for (const f of [48, 42]) {
      const r = by(f);
      if (r.reached === 'low') fail(f + ' fps: dropped to low, but ' + f + ' fps is playable');
    }

    const above = (r) => r.scale > 0.555;

    // never below the floor
    for (const r of results) {
      if (r.scale < 0.545) fail(r.label + ': scale fell below the floor (' + r.scale.toFixed(3) + ')');
      if (r.scale > 1.001) fail(r.label + ': scale rose above 100%');
    }

    // Help must be proportional to need. There are three regimes, and the shape
    // of the response is what matters:
    //
    //   in-band  (>= 46 fps)  untouched - full resolution, full preset
    //   near     (30..45 fps) resolution scaled down, scenery kept
    //   starved  (< 34 fps)   resolution pinned AND a preset given up
    //
    const band = 46, starve = 34;
    for (const f of [144, 60, 48]) {
      if (f < band) continue;
      const r = by(f);
      if (r.scale < 0.999) fail(f + " fps is inside the target band but resolution was cut to " + r.scale.toFixed(2));
      if (r.reached !== 'high') fail(f + " fps is inside the target band but the preset dropped to " + r.reached);
      if (r.steps !== 0) fail(f + " fps is inside the target band but the governor took " + r.steps + " steps");
    }
    for (const f of [42, 30, 20, 12]) {
      if (by(f).scale >= 0.999) fail(f + " fps is below the band but resolution was never cut");
    }
    for (const f of [30, 20, 12]) {
      if (f >= starve) continue;
      const r = by(f);
      if (r.reached !== 'low') fail(f + " fps is starving but the preset is " + r.reached);
      if (r.postOn) fail(f + " fps is starving but post-processing is still on");
    }

    // Monotonicity: a slower machine may never end up with more resolution or a
    // better preset than a faster one.
    const order = [60, 48, 42, 30, 20, 12];
    for (let i = 0; i < order.length - 1; i++) {
      const a = by(order[i]), b = by(order[i + 1]);
      if (b.scale > a.scale + 0.001) fail(order[i + 1] + " fps got more resolution than " + order[i] + " fps");
      if (QIDX[b.reached] > QIDX[a.reached]) fail(order[i + 1] + " fps got a better preset than " + order[i] + " fps");
    }

    say(problems ? problems + ' FAILURE(S)' : 'all checks passed');

    const el = document.createElement('pre');
    el.id = 'perftest';
    el.style.cssText = 'position:fixed;inset:0;z-index:999;background:#000;color:#0f0;' +
      'font:13px monospace;padding:18px;white-space:pre;overflow:auto;';
    el.textContent = lines.join('\n');
    if (problems) el.style.color = '#f66';
    document.body.appendChild(el);
  }

  /**
   * Performance harness (?perf=<frames>).
   * Times the real per-frame work (simulation, effects, camera, render)
   * so bottlenecks can be measured instead of guessed at.
   */
  async _perf() {
    const frames = parseInt(new URLSearchParams(location.search).get('perf') || '120', 10);
    const W = parseInt(new URLSearchParams(location.search).get('w') || '1280', 10);
    const H = parseInt(new URLSearchParams(location.search).get('h') || '760', 10);
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(W, H);
    this.startRace();
    const driver = new AIDriver(this.player, this.track, { skill: 0.95, seed: 7 });
    this.camMode = 0;
    this._camSnap();

    const dt = 1 / 60;
    const acc = { sim: 0, cam: 0, cpu: 0 };
    const info = this.renderer.info;
    const frameTimes = [];
    let calls = 0, tris = 0;
    info.autoReset = false;
    const tWall0 = performance.now();
    for (let i = 0; i < frames + 20; i++) {
      const warm = i < 20;
      info.reset();
      const t0 = performance.now();
      driver.update(dt, this.cars);
      for (const ai of this.ais) ai.update(dt, this.cars);
      this._resolveCarCollisions();
      this._carEffects(this.player, dt);
      this.effects.update(dt, this.camera, H);
      this.scenery.update(performance.now() * 0.001);
      this._updateCamera(dt);
      const t1 = performance.now();
      this.post.update(clamp((this.player.speed - 22) / 70, 0, 1), 0, 0);
      this.post.render(dt);
      const t2 = performance.now();
      if (!warm) {
        frameTimes.push(t2 - t0);
        acc.sim += t1 - t0;
        acc.cam += t2 - t1;
        acc.cpu += t2 - t0;
        calls = Math.max(calls, info.render.calls);
        tris = Math.max(tris, info.render.triangles);
      }
    }
    info.autoReset = true;
    const wall = performance.now() - tWall0;
    const n = frames;
    const perFrame = wall / n;
    // the minimum is the least noisy estimate of true throughput: interference
    // can only ever make a frame slower, never faster
    frameTimes.sort((a, b) => a - b);
    const best = frameTimes[0] || perFrame;
    const medianFrame = frameTimes[frameTimes.length >> 1] || perFrame;

    const lines = [
      'PERF ' + this.quality.name + ' @ ' + W + 'x' + H +
        ' pixelRatio=' + this.renderer.getPixelRatio().toFixed(2) +
        ' buffer=' + Math.round(W * this.renderer.getPixelRatio()) + 'x' + Math.round(H * this.renderer.getPixelRatio()) +
        '  (warmup excluded)',
      'THROUGHPUT best ' + best.toFixed(1) + ' ms (' + (1000 / best).toFixed(0) + ' fps)' +
        '   median ' + medianFrame.toFixed(1) + ' ms (' + (1000 / medianFrame).toFixed(0) + ' fps)' +
        '   mean ' + perFrame.toFixed(1) + ' ms (' + (1000 / perFrame).toFixed(0) + ' fps)',
      '  cpu work per frame: sim+fx ' + (acc.sim / n).toFixed(2) + 'ms   camera+issue ' + (acc.cam / n).toFixed(2) +
        'ms   total cpu ' + (acc.cpu / n).toFixed(2) + 'ms',
      '  draw calls/frame ' + calls + '   triangles/frame ' + tris,
      '  geometries ' + info.memory.geometries + '   textures ' + info.memory.textures +
        '   programs ' + info.programs.length,
      '  car ' + Math.round(this.player.kmh) + ' km/h  track ' + this.track.name,
    ];
    const el = document.createElement('pre');
    el.id = 'perf';
    el.style.cssText = 'position:fixed;inset:0;z-index:999;background:#000;color:#0f0;font:13px monospace;padding:16px;white-space:pre-wrap;overflow:auto;';
    el.textContent = lines.join('\n');
    document.body.appendChild(el);
  }

  /**
   * ?perfparts=1 - static triangle census.
   *
   * Frame timings on a busy or virtualised GPU are far too noisy to attribute
   * cost, but the geometry census is exact, so this reports every drawable's
   * triangle and draw-call contribution. That is what tells us where to cut.
   */
  async _perfParts() {
    this.startRace();
    this._camSnap();
    this.post.render(0.016);

    const triCount = (o) => {
      const g = o.geometry;
      if (!g) return 0;
      const idx = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
      return (idx / 3) * (o.isInstancedMesh ? o.count : 1);
    };

    const groups = new Map();
    this.scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine) || !o.visible) return;
      let p = o;
      const chain = [];
      while (p && p !== this.scene) { if (p.name) chain.unshift(p.name); p = p.parent; }
      const key = chain[0] || o.type;
      let g = groups.get(key);
      if (!g) { g = { tris: 0, draws: 0, n: 0 }; groups.set(key, g); }
      g.tris += triCount(o);
      g.draws += 1;
      g.n += 1;
    });

    const rows = [...groups.entries()].sort((a, b) => b[1].tris - a[1].tris);
    let total = 0, draws = 0;
    for (const [, v] of rows) { total += v.tris; draws += v.draws; }

    const lines = [
      'TRIANGLE CENSUS  quality=' + this.quality.name +
        '  shadows=' + this.quality.shadows +
        '  casters=' + this.quality.shadowCasters +
        '  propScale=' + this.quality.propScale,
      'group'.padEnd(20) + 'objects'.padStart(8) + 'tris'.padStart(11) + 'draws'.padStart(8),
      '-'.repeat(47),
    ];
    for (const [k, v] of rows) {
      lines.push(k.padEnd(20) + String(v.n).padStart(8) +
        String(Math.round(v.tris)).padStart(11) + String(v.draws).padStart(8));
    }
    lines.push('-'.repeat(47));
    lines.push('TOTAL'.padEnd(20) + ''.padStart(8) + String(Math.round(total)).padStart(11) + String(draws).padStart(8));

    const big = [];
    this.scene.traverse((o) => {
      if ((o.isMesh || o.isPoints) && o.visible) {
        big.push([o.name || o.parent?.name || o.type, triCount(o), o.isInstancedMesh ? o.count : 1]);
      }
    });
    big.sort((a, b) => b[1] - a[1]);
    lines.push('');
    lines.push('TOP DRAWABLES  name / tris / instances');
    for (const [n, t, c] of big.slice(0, 20)) {
      lines.push('  ' + String(n).padEnd(22) + String(Math.round(t)).padStart(9) + String(c).padStart(7));
    }

    const el = document.createElement('pre');
    el.id = 'perfparts';
    el.style.cssText = 'position:fixed;inset:0;z-index:999;background:#000;color:#0f0;' +
      'font:12px monospace;padding:14px;white-space:pre;overflow:auto;';
    el.textContent = lines.join('\n');
    document.body.appendChild(el);
  }

/**
   * Race-logic harness (?racetest=1): drives the real countdown -> race ->
   * finish -> results path with a simulated clock, so the flow can be checked
   * without a visible window.
   */
  async _raceTest() {
    const lines = [];
    const total = 3;
    this.settings.laps = total;
    this.startRace();
    const driver = new AIDriver(this.player, this.track, { skill: 0.95, seed: 7 });
    const dt = 1 / 60;
    const events = [];
    const origMsg = this.hud.bigMessage.bind(this.hud);
    this.hud.bigMessage = (html) => events.push(String(html).replace(/<[^>]*>/g, ' ').trim());

    let steps = 0;
    const maxSteps = 60 * 60 * 8;
    while (this.state !== 'finished' && steps < maxSteps) {
      steps++;
      // countdown
      if (this.state === 'countdown') {
        this.countdown -= dt;
        if (this.countdown <= 0.9 && !this._goShown) {
          this._goShown = true;
          this.hud.countdown('GO!', true);
          this.state = 'racing';
        }
        driver.v.update(dt, ZERO_INPUT);
        for (const ai of this.ais) ai.v.update(dt, ZERO_INPUT);
      } else {
        this.raceTime += dt * 1000;
        driver.update(dt, this.cars);
        for (const ai of this.ais) ai.update(dt, this.cars);
        this._resolveCarCollisions();
        this._checkFinish();
        this._updateStandings();
        this.hud.update(dt, {
          kmh: this.player.kmh, rpm: this.player.rpm, redline: this.player.tune.redline,
          gear: this.player.gear, boost: this.player.boost,
          position: this.player.position, total: this.cars.length,
          lap: this.player.lap || 1, totalLaps: total,
          raceTime: this.raceTime, currentLap: this.raceTime - this.player.lapStart,
          bestLap: this.player.bestLap, standings: this._standings,
          cars: this.cars, player: this.player, track: this.track,
        });
        this.hud.tick(dt);
      }
    }

    this._showResults();
    const board = document.getElementById('resBoard');
    const rows = [...board.querySelectorAll('li')].map(li => li.textContent.replace(/\s+/g, ' ').trim());
    lines.push('race finished after ' + (this.raceTime / 1000).toFixed(2) + 's of race time');
    lines.push('player position: ' + this.player.position);
    lines.push('lap times: ' + this.player.lapTimes.map(t => (t / 1000).toFixed(2)).join(', '));
    lines.push('best lap: ' + formatTime(this.player.bestLap));
    lines.push('events: ' + events.join(' | '));
    lines.push('results board:');
    rows.forEach(r => lines.push('  ' + r));
    lines.push('results visible: ' + !document.getElementById('results').classList.contains('hidden'));
    lines.push('title: ' + document.getElementById('resTitle').textContent);
    this.hud.bigMessage = origMsg;

    const el = document.createElement('pre');
    el.id = 'racetest';
    el.style.cssText = 'position:fixed;inset:0;z-index:999;background:#000;color:#0f0;font:12px monospace;padding:16px;white-space:pre-wrap;overflow:auto;';
    el.textContent = lines.join('\n');
    document.body.appendChild(el);
  }

  /**
   * Headless simulation harness (?selftest=1).
   * Runs the race logic with no rendering so physics, AI and race rules can
   * be verified on machines where the window cannot be shown.
   */
  _selfTest() {
    const track = this.track;
    const cars = this.cars;
    const driver = new AIDriver(this.player, track, { skill: 0.95, seed: 7 });
    const dt = 1 / 60;
    const limit = (track.barrierOffset || 12) - 0.6;
    const lines = [];
    let maxLat = 0, nan = 0, offRoadTicks = 0, totalTicks = 0, contacts = 0;
    const start = performance.now();

    for (let step = 0; step < 60 * 150; step++) {
      for (const ai of this.ais) ai.update(dt, cars);
      driver.update(dt, cars);
      this._resolveCarCollisions();
      for (const v of cars) {
        totalTicks++;
        if (!isFinite(v.pos.x) || !isFinite(v.pos.z) || !isFinite(v.speed) || !isFinite(v.rpm)) nan++;
        const pr = track.project(v.pos.x, v.pos.z, {});
        const al = Math.abs(pr.lateral);
        if (al > maxLat) maxLat = al;
        if (al > limit + 0.5) contacts++;
        if (al > track.halfWidth) offRoadTicks++;
      }
      if (step % 1200 === 0) {
        const order = cars.slice().sort((a, b) => b.progress - a.progress);
        lines.push(
          't=' + (step * dt).toFixed(0) + 's laps=' + cars.map(c => c.lap).join('') +
          ' kmh=' + cars.map(c => Math.round(c.kmh)).join('/') +
          ' spread=' + (order[0].progress - order[order.length - 1].progress).toFixed(0) + 'm'
        );
      }
      if (cars.every(c => c.lap >= this.settings.laps)) break;
    }

    const order = cars.slice().sort((a, b) => a.position - b.position);
    lines.push('---');
    lines.push('sim wall time ' + (performance.now() - start).toFixed(0) + 'ms for ' +
      (totalTicks / 60 / cars.length).toFixed(1) + 's of racing');
    lines.push('non-finite states: ' + nan);
    // theoretical lap time straight from the speed profile
    {
      const t = this.track;
      let ideal = 0, total = 0;
      const N = t.N;
      for (let i = 0; i < N; i++) {
        let ds = t.sArr[i + 1] - t.sArr[i];
        if (!(ds > 0.01)) ds = t.length / N;
        total += ds;
        ideal += ds / Math.max(t.lineSpeed[i], 6);
      }
      lines.push('track length: ' + total.toFixed(0) + 'm over ' + N + ' samples');
      lines.push('ideal lap from speed profile: ' + ideal.toFixed(1) + 's (avg ' +
        (total / ideal * 3.6).toFixed(0) + ' km/h)');
      let vmax = 0, vmin = 1e9, sum = 0;
      for (let i = 0; i < N; i++) { vmax = Math.max(vmax, t.lineSpeed[i]); vmin = Math.min(vmin, t.lineSpeed[i]); sum += t.lineSpeed[i]; }
      lines.push('profile v: min ' + vmin.toFixed(1) + ' avg ' + (sum / N).toFixed(1) + ' max ' + vmax.toFixed(1) + ' m/s');
    }
    lines.push('max lateral offset: ' + maxLat.toFixed(2) + 'm (limit ' + limit.toFixed(2) + ')');
    lines.push('barrier breaches: ' + contacts);
    lines.push('off-track time: ' + (100 * offRoadTicks / totalTicks).toFixed(1) + '%');
    lines.push('laps: ' + cars.map(c => c.lap).join(','));
    lines.push('best lap: ' + formatTime(Math.min(...cars.map(c => c.bestLap || Infinity))));
    lines.push('order: ' + order.map(c => c.name.slice(0, 10)).join(' > '));

    const el = document.createElement('pre');
    el.id = 'selftest';
    el.style.cssText = 'position:fixed;inset:0;z-index:999;background:#000;color:#0f0;font:12px monospace;padding:16px;white-space:pre-wrap;overflow:auto;';
    el.textContent = lines.join('\n');
    document.body.appendChild(el);
    this.state = 'selftest';
  }

  _bufH() {
    if (!this._bufSize) this._bufSize = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(this._bufSize);
    return this._bufSize.y;
  }

  /**
   * Render resolution = device ratio (capped) x preset scale x the dynamic
   * governor's factor. Every cost in the frame scales with pixel count, which
   * makes this the single most effective lever on weak hardware.
   */
  _applyResolution() {
    const q = this.quality;
    const dpr = Math.min(devicePixelRatio || 1, q.maxPixelRatio || 1);
    this.renderer.setPixelRatio(clamp(dpr * (q.scale === undefined ? 1 : q.scale) * this.resScale, 0.4, 3));
  }

  /**
   * Keep the sky shader's output path in step with the post stack.
   *
   * With a composer, OutputPass tone maps and sRGB-encodes the whole frame,
   * so the sky must stay in linear. Drawing straight to the canvas, the sky
   * has to do both itself or it renders as raw linear light and looks milky
   * next to the (correctly converted) rest of the scene.
   */
  _syncSkyOutput() {
    if (!this.sky || !this.sky.setDirectOutput) return;
    const direct = !this.post || !this.post.enabled || !this.post.composer;
    this.sky.setDirectOutput(direct);
  }

  _onResize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._applyResolution();
    this.renderer.setSize(w, h, false);
    if (this.post) this.post.setSize(w, h);
    if (this.gov) this.gov.reset();
  }

  async _loadWorld(trackKey) {
    const loader = document.getElementById('loader');
    const fill = document.getElementById('loadfill');
    const msg = document.getElementById('loadmsg');
    loader.classList.remove('hidden');
    // the render loop keeps running while this awaits, and everything below
    // tears the old world down — so park the loop until the new one is ready
    this._loading = true;
    const step = async (p, text) => {
      fill.style.width = (p * 100).toFixed(0) + '%';
      msg.textContent = text;
      // setTimeout rather than rAF: rAF is throttled to a standstill in a
      // backgrounded window, which would freeze the loader forever
      await new Promise((r) => setTimeout(r, 16));
    };

    await step(0.05, 'Surveying the circuit…');

    // tear down the previous world
    if (this.scene) {
      // release GPU resources explicitly rather than blanket-disposing every
      // geometry: the wheel geometries and liveries are shared by the whole
      // field, and the render targets held by PostFX live outside the scene
      for (const m of this.cars || []) disposeCar(m.mesh);
      this.cars = [];
      this.ais = [];
      if (this.effects) { this.effects.dispose(); this.effects = null; }
      if (this.post) { this.post.dispose(); this.post = null; }
      if (this.scenery) { this.scenery.dispose(); this.scenery = null; }
      if (this.sky) { this.sky.dispose(); this.sky = null; }
      if (this.track) { this.track.dispose(); this.track = null; }
    }

    const scene = new THREE.Scene();
    this.scene = scene;

    const track = new Track(trackKey);
    this.track = track;

    // lighting preset (sky.js) + the prop budget for this circuit (track.js)
    this.theme = Object.assign({}, SKIES[trackKey] || SKIES.sunset, {
      props: track.theme.props,
    });

    await step(0.2, 'Laying asphalt…');
    track.build();
    scene.add(track.group);

    await step(0.55, 'Planting the scenery…');
    this.scenery = new Scenery(track, this.theme, this.quality);
    scene.add(this.scenery.build());

    await step(0.8, 'Painting the sky…');
    this.sky = new SkySystem(this.renderer, trackKey, this.quality);
    this.sky.build(scene);
    const expOverride = parseFloat(new URLSearchParams(location.search).get('exp'));
    if (Number.isFinite(expOverride)) this.theme.exposure = expOverride;
    this.renderer.toneMappingExposure = this.theme.exposure;
    // The sky tone maps itself when there is no composer, so it needs the same
    // exposure value or it will not match the rest of the scene.
    if (this.sky?.material?.uniforms?.uExposure) {
      this.sky.material.uniforms.uExposure.value = this.theme.exposure;
    }

    await step(0.92, 'Rolling out the cars…');
    this._buildCars();

    this.effects = new Effects(scene, this.quality);
    this.post = new PostFX(this.renderer, scene, this.camera, this.quality);
    // Dev A/B switch: ?nopost=<list> keeps only the named passes, so a colour
    // problem can be attributed to the composer rather than to the scene.
    // e.g. ?nopost=RenderPass,OutputPass
    if (this._noPost && this.post.composer) {
      const keep = String(this._noPost).split(',').map((x) => x.trim());
      this.post.composer.passes = this.post.composer.passes
        .filter((x) => keep.includes(x.constructor.name));
    }
    window.__passes = this.post.composer
      ? this.post.composer.passes.map((x) => x.constructor.name)
      : ['<no composer>'];
    this._syncSkyOutput();

    await step(1, 'Ready.');
    loader.classList.add('hidden');
    this._loading = false;
  }

  _buildCars() {
    const n = this._fieldSize();
    const track = this.track;
    this.cars = [];
    this.ais = [];

    const blobTex = blobShadow();
    const slots = track.gridSlots(n);
    const slotOf = gridOrder(n);
    const palette = [...CAR_COLORS].sort(() => Math.random() - 0.5);

    // Team identity. In team mode each entry runs a team livery; in the normal
    // solo race every car is its own team so the standings code paths are
    // identical either way (team 0 == "every car scores itself").
    const teamMode = this.settings.raceMode === 'teams';
    const teamsPerRace = teamMode ? (this.settings.teams || 2) : n;
    const teamOf = assignTeams(n, teamsPerRace);
    const teamCarIndex = new Array(teamsPerRace).fill(0);
    this.teamCount = teamsPerRace;
    this.teamMode = teamMode;

    for (let i = 0; i < n; i++) {
      const isPlayer = i === 0;
      const teamIdx = teamOf[i];
      const team = TEAMS[teamIdx % TEAMS.length];
      const teamCarNo = teamCarIndex[teamIdx]++;
      let skin;
      if (isPlayer && !teamMode) {
        const own = selectedCar(this.garage);
        skin = { color: own.paint, accent: own.accent, stripe: own.stripe, name: 'YOU', number: own.number };
      } else if (isPlayer) {
        const p = team.paints[teamCarNo % team.paints.length];
        skin = { color: p.paint, accent: p.accent, stripe: p.stripe, name: 'YOU', number: teamCarNo + 1 };
      } else if (teamMode) {
        const p = team.paints[teamCarNo % team.paints.length];
        skin = {
          color: p.paint, accent: p.accent, stripe: p.stripe,
          name: team.name + (teamsPerRace > 1 ? ' ' + (teamCarNo + 1) : ''),
          number: teamCarNo + 1,
        };
      } else {
        skin = {
          color: palette[i % palette.length].paint,
          accent: palette[i % palette.length].accent,
          stripe: palette[i % palette.length].stripe,
          name: `${palette[i % palette.length].name.toUpperCase()} #${i}`,
          number: i + 1,
        };
      }
      const mesh = buildCar({
        color: skin.color, accent: skin.accent, stripe: skin.stripe,
        number: skin.number,
        quality: { blobShadow: this.quality.blobShadow, blobTex, richCar: this.quality.richCar },
      });
      // shadow casting is the single most expensive thing in the frame,
      // so only the cars cast on the mid preset (scenery uses contact blobs)
      const casters = this.quality.shadowCasters;
      if (casters === 'none') {
        mesh.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      }
      this.scene.add(mesh);

      const v = new Vehicle({
        mesh, track, isPlayer, name: skin.name,
        control: isPlayer ? this.settings.control : 'medium',
        setup: this.settings.assists,
        // The player's car comes from the garage; rivals all run stock so a
        // purchased car never becomes an unfair advantage against the field.
        tuning: isPlayer ? selectedCar(this.garage).tuning : {},
      });
      v.skin = skin;
      v.cssColor = '#' + new THREE.Color(skin.color).getHexString();
      v.team = teamIdx;
      v.teamName = team.name;
      v.teamColor = team.color;
      v.isLocalPlayer = isPlayer;
      v.remote = false;
      const slot = slots[slotOf[i]];
      const gp = track.pointAt(slot.s, slot.lateral, this._tmp);
      v.reset(track.wrapS(slot.s), slot.lateral, track.project(gp.x, gp.z).heading);

      if (!isPlayer) {
        const skill = 0.80 + (1 - i / n) * 0.17 + Math.random() * 0.03;
        this.ais.push(new AIDriver(v, track, {
          skill, seed: 1000 + i * 77,
          aggression: 0.4 + Math.random() * 0.5,
        }));
      } else {
        this.player = v;
      }
      this.cars.push(v);
    }
    if (this._auto && this.player) {
      this.autoDriver = new AIDriver(this.player, track, { skill: 0.95, seed: 42 });
    }
    this.hud = new HUD(track);
  }

  /* ---------------- UI wiring ---------------- */
  _initUI() {
    this.audio = new GameAudio();
    this.audio.setMuted(this.settings.muted);

    const MODE_NOTES = {
      solo: 'One car against the field.',
      teams: 'Team racing — your team scores its best finisher.',
      split: 'Two players, one screen. Player 2: arrows + right Ctrl handbrake.',
      online: 'Matchmaking over the network — see the server note below.',
    };

    const segs = [
      ['optLaps', (v) => { this.settings.laps = +v; }],
      ['optRivals', (v) => { this.settings.rivals = +v; this._needsRebuild = true; }],
      ['optRaceMode', (v) => {
        this.settings.raceMode = v;
        this._syncModeRows();
        this._needsRebuild = true;      // field size changed; rebuild the grid
        this.saveSettings();
      }],
      ['optTeams', (v) => {
        this.settings.teams = +v;
        this._syncModeRows();
        this._needsRebuild = true;
      }],
      ['optPlayers', (v) => { this.settings.players = +v; }],
      ['optUnits', (v) => {
        this.settings.units = v;
        this.baseFov = +this.settings.fov;
        if (v === 'mph') {
          // The speedo dial is drawn in km/h; rescale the unit so the needle and
          // the readout stay consistent instead of relabelling a 200 km/h dial.
          this.unitScale = 0.621371;
          this.hud.setUnits(0.621371, 'MPH');
        } else {
          this.unitScale = 1;
          this.hud.setUnits(1, 'KM/H');
        }
      }],
      ['optCamera', (v) => {
        this.settings.camera = v;
        this.camMode = { chase: 0, hood: 1, far: 2, cockpit: 4 }[v] ?? 0;
      }],
      ['optControl', (v) => {
        this.settings.control = v;
        // Applies immediately so the car in the menu scene already feels
        // different; startRace() re-applies it for a fresh grid.
        if (this.player) this.player.setControl(v);
        const note = document.getElementById('controlNote');
        if (note && CONTROL[v]) note.textContent = CONTROL[v].blurb;
      }],
      ['optQuality', (v) => {
        this.settings.quality = v;
        this.autoQuality = v === 'auto';
        this._probed = !this.autoQuality;   // manual choice wins, no probing
        this._raceProbed = false;           // a new preset deserves a new sample
        this._raceProbeAcc = 0;
        this._raceProbeFrames = 0;
        this._pendingQuality = null;
        this._needsRebuild = true;
        const note = document.getElementById('perfNote');
        if (note && v !== 'auto') note.textContent = 'Preset locked to ' + v.toUpperCase() + '.';
      }],
      ['optTrack', (v) => { this.settings.track = v; this._needsRebuild = true; }],
      ['optFov', (v) => { this.settings.fov = +v; this.baseFov = +v; this.camera.fov = +v; this.camera.updateProjectionMatrix(); }],
      ['optAudio', (v) => { this.settings.audio = v === 'on'; this.audio.setMuted(!this.settings.audio || this.settings.muted); }],
    ];
    for (const [id, fn] of segs) {
      const root = document.getElementById(id);
      if (!root) continue;
      root.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        root.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        fn(b.dataset.v);
        this.saveSettings();
        this._syncMenuLabels();
      });
      const val = {
        optLaps: this.settings.laps, optRivals: this.settings.rivals,
        optControl: this.settings.control, optQuality: this.settings.quality,
        optTrack: this.settings.track, optFov: this.settings.fov,
        optAudio: this.settings.audio ? 'on' : 'off',
        optUnits: this.settings.units, optCamera: this.settings.camera,
        optRaceMode: this.settings.raceMode,
        optTeams: this.settings.teams,
        optPlayers: this.settings.players,
      }[id];
      root.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', String(b.dataset.v) === String(val));
      });
    }
    this._syncMenuLabels();

    this._syncModeRows();
    const garageBtn = document.getElementById('garageBtn');
    if (garageBtn) garageBtn.addEventListener('click', () => this.toggleGarage());
    const garageClose = document.getElementById('garageClose');
    if (garageClose) garageClose.addEventListener('click', () => this.toggleGarage(false));

    this._syncWallet();
    this._buildSetupPanel();
    const setupBtn = document.getElementById('setupBtn');
    if (setupBtn) setupBtn.addEventListener('click', () => this.toggleSettings());
    const setupClose = document.getElementById('setupClose');
    if (setupClose) setupClose.addEventListener('click', () => this.toggleSettings(false));
    const clearBtn = document.getElementById('clearRecords');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const btn = clearBtn;
        if (btn.dataset.armed !== '1') {
          btn.dataset.armed = '1';
          btn.textContent = 'Confirm clear';
          btn.classList.add('armed');
          setTimeout(() => {
            if (!btn.isConnected) return;
            btn.dataset.armed = '0';
            btn.textContent = 'Clear records';
            btn.classList.remove('armed');
          }, 3000);
          return;
        }
        btn.dataset.armed = '0';
        btn.textContent = 'Clear records';
        btn.classList.remove('armed');
        this._resetRecords();
      });
    }

    document.getElementById('playBtn').addEventListener('click', () => this.startRace());
    document.getElementById('resumeBtn').addEventListener('click', () => this.setPaused(false));
    document.getElementById('restartBtn').addEventListener('click', () => { this.setPaused(false); this.startRace(); });
    document.getElementById('menuBtn').addEventListener('click', () => this.showMenu());
    document.getElementById('againBtn').addEventListener('click', () => { this.resultsShown = false; this.startRace(); });
    document.getElementById('resMenuBtn').addEventListener('click', () => this.showMenu());
  }

  _syncMenuLabels() {
    const el = document.getElementById('menuBest');
    if (el) el.innerHTML = describeRecords(this.records, this.settings.track);
    const note = document.getElementById('controlNote');
    if (note && CONTROL[this.settings.control]) note.textContent = CONTROL[this.settings.control].blurb;
    this._syncLapBoard();
  }

  /**
   * Show only the options the current mode actually uses, and keep the rival
   * count consistent with the team size. Without this the panel offers a 4-team
   * race while the field is still sized for a solo run.
   */
  _syncModeRows() {
    const mode = this.settings.raceMode;
    const show = (id, on) => {
      const el = document.getElementById(id);
      if (el) el.hidden = !on;
    };
    show('rowTeams', mode === 'teams');
    show('rowSplitPlayers', mode === 'split');
    show('rowOnline', mode === 'online');
    show('rowRivals', mode === 'solo');

    const note = document.getElementById('modeNote');
    const notes = {
      solo: 'One car against the field.',
      teams: 'Team racing — your team scores its best finisher.',
      split: 'Two players, one screen. Player 2: arrows, right Ctrl to handbrake.',
      online: 'Matchmaking over the network — needs the server running.',
    };
    if (note) note.textContent = notes[mode] || notes.solo;

    // Field size is derived per mode in _fieldSize(); the stored `rivals`
    // preference is deliberately left alone so switching to split and back
    // does not quietly leave a solo race running with two cars.
  }

  /**
   * How many cars actually take the grid.
   *
   * Derived rather than stored, because the modes size the field differently:
   * solo uses the rival preference, teams use the team size, and split/online
   * are always a two-car grid.
   */
  _fieldSize() {
    const mode = this.settings.raceMode;
    if (mode === 'split' || mode === 'online') return 2;
    if (mode === 'teams') return TEAM_CARS_PER_TEAM[this.settings.teams] * this.settings.teams;
    return this.settings.rivals + 1;
  }

  /* ---------------- garage ---------------- */

  /** Render the car catalogue. Rebuilt whenever the garage changes. */
  _buildGarage() {
    const host = document.getElementById('carGrid');
    if (!host) return;
    host.innerHTML = '';
    const g = this.garage;

    for (const car of CARS) {
      const owned = ownsCar(g, car.id);
      const isSel = g.selected === car.id;
      const afford = g.coins >= car.price;
      const st = carStats(car);

      const card = document.createElement('div');
      card.className = 'car-card' + (isSel ? ' selected' : '') + (owned ? '' : ' locked');

      const swatch = '#' + car.paint.toString(16).padStart(6, '0');
      card.innerHTML = `
        <div class="car-top">
          <div class="car-swatch" style="background:${swatch}"></div>
          <div class="car-name">${car.name}</div>
          <div class="car-tag${owned ? ' owned' : ''}">${isSel ? 'IN USE' : owned ? 'OWNED' : formatCoins(car.price) + ' ¢'}</div>
        </div>
        <div class="car-blurb">${car.blurb}</div>
        <div class="car-stats">
          ${bar('Speed', st.bars.speed, st.topSpeed + ' km/h')}
          ${bar('Power', st.bars.power, st.power + ' Nm')}
          ${bar('Grip', st.bars.grip, 'x' + st.grip.toFixed(2))}
          ${bar('Agility', st.bars.agility, st.mass + ' kg')}
        </div>
        <button class="car-buy${owned && !isSel ? ' select' : ''}"${isSel || (!owned && !afford) ? ' disabled' : ''}>
          ${isSel ? 'SELECTED' : owned ? 'DRIVE THIS' : afford ? 'BUY ' + formatCoins(car.price) + ' ¢' : 'NEED ' + formatCoins(car.price - g.coins) + ' MORE'}
        </button>
      `;

      const btn = card.querySelector('.car-buy');
      btn.addEventListener('click', () => {
        const res = owned ? selectCar(g, car.id) : buyCar(g, car.id);
        if (!res.ok) return;
        saveGarage(g);
        this._syncWallet();
        this._buildGarage();
        this._needsRebuild = true;      // new car => new grid, new physics
        this._setCarNote(`${car.name} ready. ${owned ? 'Selected for your next race.' : 'Purchased and selected.'}`);
      });

      host.appendChild(card);
    }
    this._syncWallet();
  }

  _setCarNote(text) {
    const el = document.getElementById('carNote');
    if (el) el.textContent = text;
  }

  _syncWallet() {
    for (const id of ['wallet', 'walletBig']) {
      const el = document.getElementById(id);
      if (el) el.textContent = formatCoins(this.garage.coins);
    }
  }

  toggleGarage(force) {
    const panel = document.getElementById('garage');
    if (!panel) return;
    const show = force !== undefined ? force : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show);
    if (show) { this._buildGarage(); this._setCarNote('Earn coins by finishing races. Position pays the most.'); }
  }

  /** Award coins at the end of a race and show the breakdown. */
  _awardRaceCoins() {
    const p = this.player;
    if (!p) return;
    const tr = this.records.tracks[this.settings.track];
    const payout = racePayout({
      position: p.position || 1,
      field: this.cars.length,
      laps: p.lapTimes.length,
      isRecord: !!(tr && p.bestLap && tr.best === p.bestLap),
    });
    awardRace(this.garage, payout);
    saveGarage(this.garage);
    this._lastPayout = payout;
    this._syncWallet();
  }

  /* ---------------- setup panel ---------------- */

  /**
   * The setup panel is generated from SETUP_UI so the labels, the stored value
   * and the button states cannot drift apart.
   */
  _buildSetupPanel() {
    const host = document.getElementById('setupRows');
    if (!host) return;
    host.innerHTML = '';

    for (const row of SETUP_UI) {
      const wrap = document.createElement('div');
      wrap.className = 'setup-row';

      const label = document.createElement('label');
      label.textContent = row.label;
      label.title = row.title || row.label;

      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.id = 'optSetup_' + row.id;

      for (const v of row.values) {
        const b = document.createElement('button');
        b.dataset.v = String(v);
        b.textContent = row.labels ? row.labels[v] : String(v);
        b.title = row.hint || '';
        seg.appendChild(b);
      }
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        this.settings.assists[row.id] = row.numeric ? +b.dataset.v : b.dataset.v;
        if (this.player) this.player.setSetup(this.settings.assists);
        this.saveSettings();
        this._syncSetupPanel();
        this._syncSetupSummary();
      });

      wrap.appendChild(label);
      wrap.appendChild(seg);
      host.appendChild(wrap);

      if (row.note) {
        const n = document.createElement('div');
        n.className = 'setup-note';
        n.textContent = row.note;
        wrap.appendChild(n);
      }
    }
    this._syncSetupPanel();
    this._syncSetupSummary();
  }

  _syncSetupPanel() {
    for (const row of SETUP_UI) {
      const seg = document.getElementById('optSetup_' + row.id);
      if (!seg) continue;
      const cur = String(this.settings.assists[row.id]);
      seg.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', String(b.dataset.v) === cur);
      });
    }
  }

  /** One-line read-out of the whole setup, so the effect is visible at a glance. */
  _syncSetupSummary() {
    const el = document.getElementById('setupSummary');
    if (!el) return;
    const a = this.settings.assists;
    const aids = [];
    aids.push(a.traction === 'off' ? 'TC off' : `TC ${a.traction}`);
    aids.push(a.abs === 'off' ? 'ABS off' : `ABS ${a.abs}`);
    aids.push(a.esc === 'off' ? 'ESC off' : `ESC ${a.esc}`);
    el.innerHTML =
      `<b>${a.transmission === 'manual' ? 'Manual' : 'Automatic'}</b> gearbox · ${aids.join(' · ')} · ` +
      `bias <b>${a.brakeBias}%</b> front · lock <b>${a.steerLock}%</b> · downforce <b>${a.downforce}%</b>`;
  }

  _syncLapBoard() {
    const host = document.getElementById('lapBoard');
    if (!host) return;
    const t = trackRecords(this.records, this.settings.track);
    if (!t.laps.length) {
      host.innerHTML = '<div class="lap-empty">No laps yet — set the first one.</div>';
      return;
    }
    const rows = t.laps.slice(0, 5).map((ms, i) => {
      const cls = t.best && Math.abs(ms - t.best) < 1 ? ' best' : '';
      const when = i === 0 ? '<span class="lap-when">last</span>' : '';
      return `<div class="lap-row${cls}">${when}<span>${formatTime(ms)}</span></div>`;
    });
    host.innerHTML = rows.join('');
  }

  _resetRecords() {
    this.records = clearRecords();
    const tr = trackRecords(this.records, this.settings.track);
    if (this.bestEver) tr.best = this.bestEver;
    saveRecords(this.records);
    this._syncLapBoard();
    this._syncMenuLabels();
  }

  toggleSettings(force) {
    const panel = document.getElementById('setup');
    if (!panel) return;
    const show = force !== undefined ? force : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show);
    if (show) {
      this._syncSetupPanel();
      this._syncSetupSummary();
      this._syncLapBoard();
    }
  }

  _initInput() {
    this.input = new Input();
  }

  showMenu() {
    this.state = 'menu';
    // Finish any preset change that could only be applied in part while a
    // race was running. Safe here: nothing is in progress.
    this._flushPendingQuality();
    document.body.classList.add('menu-open');
    document.getElementById('menu').classList.remove('hidden');
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('results').classList.add('hidden');
    this.hud.setVisible(false);
    if (this._needsRebuild) {
      this._reloadWorld();
    } else if (this.player) {
      // park the camera at a nice spot on the circuit
      this._cinematicIdle(0);
    }
    this._syncMenuLabels();
  }

  async _reloadWorld() {
    const btn = document.getElementById('playBtn');
    btn.disabled = true;
    // The world is torn down to null and rebuilt asynchronously, so frames
    // can land in the gap with nothing to simulate. The loop watches this.
    this._worldLoading = true;
    try {
      await this._loadWorld(this.settings.track);
    } catch (err) {
      // never leave the loop parked if a rebuild blows up mid-way
      this._loading = false;
      console.error('world rebuild failed', err);
      throw err;
    } finally {
      btn.disabled = false;
      this._worldLoading = false;
    }
    this.hud.setVisible(false);
    this._cinematicIdle(0);
  }

  async startRace() {
    document.body.classList.remove('menu-open');
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('results').classList.add('hidden');
    document.getElementById('pause').classList.add('hidden');

    if (this._needsRebuild) {
      this._needsRebuild = false;
      if (this.autoQuality) { this._probed = false; this._probe = new AutoProbe(); this._probeAcc = 0; this._probeFrames = 0; }
      if (QUALITY[this.settings.quality] && !this.autoQuality) {
        this.qualityName = this.settings.quality;
        this.quality = QUALITY[this.qualityName];
      }
      this._applyResolution();
      this.renderer.shadowMap.enabled = this.quality.shadows;
      this.renderer.shadowMap.type = this.quality.softShadow ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      try {
        await this._loadWorld(this.settings.track);
      } catch (err) {
        this._loading = false;
        console.error('world rebuild failed', err);
        throw err;
      }
      document.getElementById('menu').classList.add('hidden');
    }

    this.audio.init();
    this.audio.resume();
    this.audio.setMuted(!this.settings.audio || this.settings.muted);

    // reset the field
    const n = this._fieldSize();
    const slots = this.track.gridSlots(n);
    const slotOf = gridOrder(n);
    if (this.player) {
      this.player.setControl(this.settings.control);
      this.player.setSetup(this.settings.assists);
    }
    for (let i = 0; i < this.cars.length; i++) {
      const v = this.cars[i];
      const slot = slots[slotOf[i]];
      const p = this.track.pointAt(slot.s, slot.lateral, new THREE.Vector3());
      v.reset(slot.s, slot.lateral, this.track.project(p.x, p.z).heading);
      v.topSpeed = 0;
      v.topSpeedKmh = 0;
      v.lapStart = 0;
      v.lapTimes = [];
      v.bestLap = 0;
      v._lastLap = 0;
      v.finished = false;
      v.finishTime = 0;
    }
    if (this.effects) this.effects.skid.last.clear();

    this.raceTime = 0;
    this.countdown = 3.9;
    this._cdShown = -1;
    this._goShown = false;
    this._wrongShown = false;
    this.resultsShown = false;
    this.finishedAt = 0;
    this.state = 'countdown';
    this.gov.reset();
    // Each race is measured again: the last one is the only honest sample we
    // have of what this circuit actually costs.
    this._raceProbed = false;
    this._raceProbeAcc = 0;
    this._raceProbeFrames = 0;
    this.track.setStartLights(0);
    this.hud.setVisible(true);
    this.camMode = this._dbgCam || 0;
    this._camSnap();
    this.hud.hideCountdown();
    this.hud.bigMessage(
      this.track.name + '<small>' + this.settings.laps + ' laps / ' + this._fieldSize() + ' cars</small>', 2200
    );
  }

  setPaused(p) {
    if (this.state !== 'racing' && this.state !== 'countdown' && !p) return;
    this.paused = p;
    document.getElementById('pause').classList.toggle('hidden', !p);
    if (p) this.audio.setMuted(true);
    else this.audio.setMuted(!this.settings.audio || this.settings.muted);
  }

  /* ---------------- camera ---------------- */
  _camSnap() {
    const v = this.player;
    const fwd = v.forward, right = v.right;
    this._camPos.set(
      v.pos.x - fwd.x * 8 - right.x * 0.2,
      v.pos.y + 3.0,
      v.pos.z - fwd.z * 8 - right.z * 0.2
    );
    this._camLook.copy(v.pos).y += 1.1;
    this.camera.position.copy(this._camPos);
  }

  _cinematicIdle(dt) {
    const t = this.track;
    const tt = performance.now() * 0.00006;
    const i = Math.floor((tt % 1) * t.N);
    const j = (i + 40) % t.N;
    const lat = 26;
    this._tmp.set(
      t.px[i] + t.rx[i] * lat,
      t.py[i] + 9,
      t.pz[i] + t.rz[i] * lat
    );
    this.camera.position.lerp(this._tmp, 1 - Math.pow(0.02, dt || 0.016));
    this._tmp.set(t.px[j], t.py[j] + 1.5, t.pz[j]);
    this.camera.lookAt(this._tmp);
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
  }

  _updateCamera(dt) {
    const v = this.player;
    const speed = v.speed;
    const fwd = v.forward, right = v.right;
    const cam = this.camera;

    if (this.camMode === 3) {
      // slow cinematic orbit — photo mode
      const a = performance.now() * 0.00016;
      const r = 11 + Math.sin(performance.now() * 0.00011) * 4;
      this._tmp.set(
        v.pos.x + Math.cos(a) * r,
        v.pos.y + 3.4 + Math.sin(a * 0.7) * 1.6,
        v.pos.z + Math.sin(a) * r
      );
      this._camPos.lerp(this._tmp, 1 - Math.pow(0.02, dt));
      this._camLook.lerp(this._tmp.copy(v.pos).y += 0.9, 1 - Math.pow(0.001, dt));
      cam.position.copy(this._camPos);
      cam.lookAt(this._camLook);
      cam.fov = damp(cam.fov, 52, 4, dt);
      cam.updateProjectionMatrix();
      this.sky.update(dt, v.pos, cam);
      return;
    }

    if (this.camMode === 2) {
      // bonnet cam: sits just above the cowl so the bodywork frames the shot
      // instead of blocking it
      v.mesh.userData.glass.visible = false;
      const px = v.pos.x + fwd.x * 1.02;
      const py = v.pos.y + 1.02;
      const pz = v.pos.z + fwd.z * 1.02;
      cam.position.set(px, py, pz);
      const look = 30 + speed * 0.5;
      this._tmp.set(px + fwd.x * look, py - 1.5 + v.longG * 7, pz + fwd.z * look);
      cam.lookAt(this._tmp);
      cam.rotation.z = -v.lateralG * 0.03;
      cam.rotation.x = clamp(v.longG * 0.02, -0.05, 0.05);
      cam.fov = damp(cam.fov, this.baseFov + 4 + clamp(speed / 90, 0, 1) * 12, 3, dt);
      cam.updateProjectionMatrix();
      this.sky.update(dt, v.pos, cam);
      return;
    }
    if (v.mesh.userData) v.mesh.userData.glass.visible = true;

    // chase cameras
    const close = this.camMode === 1;
    // blend the car's heading with its velocity direction so drifts look good
    const velHeading = speed > 4 ? Math.atan2(v.vel.x, v.vel.z) : v.yaw;
    let blend = close ? 0.3 : 0.18;
    let h = v.yaw + Math.atan2(Math.sin(velHeading - v.yaw), Math.cos(velHeading - v.yaw)) * blend;

    const spd = clamp(speed / 92, 0, 1.2);
    const dist = (close ? 6.0 : 8.2) + spd * (close ? 1.4 : 2.4);
    const height = (close ? 2.15 : 3.15) + spd * 0.5;

    const dx = Math.sin(h), dz = Math.cos(h);
    // lateral lead into the corner
    const lead = clamp(-v.trackOffset * 0.05, -1.4, 1.4) * (this.track.curv[Math.floor((v.progressS / this.track.length) * this.track.N) % this.track.N] > 0 ? 1 : -1);

    this._tmp.set(
      v.pos.x - dx * dist + Math.cos(h) * lead,
      v.pos.y + height,
      v.pos.z - dz * dist - Math.sin(h) * lead
    );
    // keep the camera above the ground
    const groundY = this.track.groundHeight(this._tmp.x, this._tmp.z) + 0.9;
    if (this._tmp.y < groundY) this._tmp.y = groundY;

    const lambda = 6.5 + spd * 7;
    this._camPos.lerp(this._tmp, 1 - Math.exp(-lambda * dt));
    cam.position.copy(this._camPos);

    const lookAhead = 9 + speed * 0.36;
    this._tmp.set(
      v.pos.x + fwd.x * lookAhead,
      v.pos.y + 1.35,
      v.pos.z + fwd.z * lookAhead
    );
    this._camLook.lerp(this._tmp, 1 - Math.exp(-(lambda + 4) * dt));
    cam.lookAt(this._camLook);

    // shake
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      cam.position.z += (Math.random() - 0.5) * this.shake;
      this.shake = damp(this.shake, 0, 6, dt);
    }

    const fovTarget = this.baseFov + spd * 15 + (v.boosting ? 7 : 0);
    cam.fov = damp(cam.fov, fovTarget, 4, dt);
    cam.updateProjectionMatrix();
    this.sky.update(dt, v.pos, cam);
  }

  /* ---------------- collisions ---------------- */
  /**
   * Minimum-translation overlap of two cars as oriented boxes.
   *
   * An oriented box, not a circle pair: a capsule traced from circles on the
   * centreline never reaches the body's four corners, so two cars overlapping
   * corner-to-corner registered no collision at all while the bodywork visibly
   * intersected.
   *
   * @returns {{depth:number,nx:number,nz:number,cx:number,cz:number}|null}
   *          null when the two are apart. `n` points from a to b and (cx,cz) is
   *          the contact point used as the lever arm for spin.
   */
  _boxOverlap(a, b) {
    const HX = 2.21, HZ = 0.86;            // half length / half width
    const aux = Math.sin(a.yaw), auz = Math.cos(a.yaw);
    const bux = Math.sin(b.yaw), buz = Math.cos(b.yaw);
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;

    const out = this._ovl || (this._ovl = { depth: 0, nx: 0, nz: 0, cx: 0, cz: 0 });
    let depth = 0, nx = 0, nz = 0;
    for (let k = 0; k < 4; k++) {
      // four candidate normals: each car's forward and right vectors
      const Lx = k === 0 ? aux : k === 1 ? auz : k === 2 ? bux : buz;
      const Lz = k === 0 ? auz : k === 1 ? -aux : k === 2 ? buz : -bux;
      const ra = Math.abs(Lx * aux + Lz * auz) * HX + Math.abs(Lx * auz - Lz * aux) * HZ;
      const rb = Math.abs(Lx * bux + Lz * buz) * HX + Math.abs(Lx * buz - Lz * bux) * HZ;
      const dist = dx * Lx + dz * Lz;
      const ov = ra + rb - Math.abs(dist);
      if (ov <= 0) return null;                       // separating axis found
      // Minimum translation: keep the axis that needs the SMALLEST push to
      // separate. Taking the largest overlap picks the wrong axis whenever a
      // nose-to-tail hit also happens to overlap laterally — it returned a
      // 1.72 m lateral depth for a genuine 0.82 m head-on overlap, so the
      // contact normal pointed sideways and fired the cars apart laterally
      // (measured: 14 m/s climbing to 146 m/s).
      if (depth === 0 || ov < depth) {
        depth = ov;
        const s = dist < 0 ? -1 : 1;                  // normal points a -> b
        nx = Lx * s; nz = Lz * s;
      }
    }
    // contact point: midpoint of each body's support vertex along the normal
    const sA = nx * aux + nz * auz >= 0 ? -1 : 1;
    const rA = nx * auz - nz * aux >= 0 ? -1 : 1;
    const sB = nx * bux + nz * buz >= 0 ? 1 : -1;
    const rB = nx * buz - nz * bux >= 0 ? 1 : -1;
    out.depth = depth;
    out.nx = nx; out.nz = nz;
    out.cx = (a.pos.x + aux * HX * sA + auz * HZ * rA + b.pos.x + bux * HX * sB + buz * HZ * rB) * 0.5;
    out.cz = (a.pos.z + auz * HX * sA - aux * HZ * rA + b.pos.z + buz * HX * sB - bux * HZ * rB) * 0.5;
    return out;
  }

  /**
   * Car-to-car contact.
   *
   * The car is ~4.42 m long and ~1.72 m wide (see BASE_HALF / L in
   * carModel.js). Colliding it as a single 3.1 m circle was wrong in both
   * directions: too wide, so cars shoved each other aside with a visible gap
   * side to side, and too short, so two cars nosed together still overlapped by
   * over a metre and visibly drove through each other's bodywork.
   *
   * Each car is an oriented box (4.42 x 1.72 m) resolved by separating-axis
   * test. Two circles on the centre line were tried first and still could not
   * reach the body corners, so corner-to-corner overlap registered no
   * collision at all while the bodywork visibly intersected.
   *
   * The response is a real impulse: velocity is sampled at the contact point
   * (so a nose hit spins the car and a square hit does not), the normal impulse
   * follows from a restitution coefficient, tangential slip is clamped by a
   * friction cone, and the spin comes from the contact offset acting on the
   * car's yaw inertia rather than from a random kick.
   */
  _resolveCarCollisions(dt = 1 / 60) {
    const cars = this.cars;
    const HX = 2.21;            // half length  (4.42 m)
    const HZ = 0.86;            // half width   (1.72 m)
    // Penalty contact. STIFFNESS sets how far the bodies crush (a 28 m/s
    // head-on compresses roughly 0.25 m, which reads as sheet metal giving).
    // DAMPING sits near critical for two 1230 kg bodies, so the cars crush and
    // settle instead of bouncing apart like billiard balls.
    const STIFFNESS = 2.0e7;    // N/m -- a 28 m/s hit compresses ~0.15 m
    const DAMPING = 1.6e5;      // N/(m/s), near critical for two 1230 kg bodies
    const MU = 0.55;            // friction at the contact patch
    const MAX_PEN = 0.12;       // spring compresses at most this far (m)
    const SUBSTEPS = 8;         // stiff spring needs 480 Hz to stay stable
    // Yaw inertia of the car treated as a box. Used to convert the contact
    // offset into angular response, which is what makes off-centre hits spin.
    const INERTIA = cars[0].mass * (4.42 * 4.42 + 1.72 * 1.72) / 12;

    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (Math.abs(a.pos.y - b.pos.y) > 2.2) continue;

        // ---- penalty contact: a force, not an instantaneous impulse ----
        // Swapping velocities in a single frame is arithmetically correct but
        // reads as hitting an invisible wall — the car stops dead between two
        // frames and never visibly compresses. Driving the overlap through a
        // spring-damper instead makes the bodies crush together, shed speed
        // over several frames, and push apart on their own. That progressive
        // crush is what makes an impact feel like metal rather than a barrier.
        const mass = a.mass;
        const h = dt / SUBSTEPS;
        const hitN = this._boxOverlap(a, b);
        if (!hitN) continue;                     // not touching
        let closing = 0;

        for (let s2 = 0; s2 < SUBSTEPS; s2++) {
          // Re-measure from the CURRENT positions on every substep. Holding the
          // overlap fixed for the whole frame is what made this explode: the
          // spring kept pushing at full force after the bodies had already
          // parted, pumping energy in (measured: 14 m/s climbing to 54 m/s).
          const d = this._boxOverlap(a, b);
          if (!d) break;                                  // separated, done
          const nx = d.nx, nz = d.nz;
          const la = [d.cx - a.pos.x, d.cz - a.pos.z];     // lever arms
          const lb = [d.cx - b.pos.x, d.cz - b.pos.z];

          // relative velocity AT THE CONTACT POINT, so a nose hit swings the
          // car and a square hit through the centre of mass does not
          const vax = a.vel.x - a.yawRate * la[1], vaz = a.vel.z + a.yawRate * la[0];
          const vbx = b.vel.x - b.yawRate * lb[1], vbz = b.vel.z + b.yawRate * lb[0];
          const rvx = vbx - vax, rvz = vbz - vaz;
          const vn = rvx * nx + rvz * nz;                 // negative while closing
          if (-vn > closing) closing = -vn;

          // Bounded response. Penetration deeper than MAX_PEN is recovered by
          // moving the bodies apart rather than by compressing the spring
          // further: a deep overlap otherwise banks enormous energy and then
          // fires the cars apart at speed (measured 28 m/s from a standstill).
          const pen = d.depth > MAX_PEN ? MAX_PEN : d.depth;
          let Fn = STIFFNESS * pen - DAMPING * vn;
          if (Fn < 0) Fn = 0;                           // never adhesive
          // The contact may not reverse the approach inside a single substep. Both
          // bodies move, so the closing rate changes at 2F/m: cap at half, or
          // the clamp itself overshoots and injects energy.
          const cap = (mass * Math.abs(vn)) / (2 * h);
          if (Fn > cap) Fn = cap;
          const push = (d.depth - MAX_PEN) * 0.5;
          if (push > 0) {
            a.pos.x -= nx * push; a.pos.z -= nz * push;
            b.pos.x += nx * push; b.pos.z += nz * push;
          }

          let Fax = -nx * Fn, Faz = -nz * Fn;             // reaction on a
          let Fbx = nx * Fn, Fbz = nz * Fn;               // and on b

          // Coulomb friction on the tangential slide, clamped to the friction
          // cone so a glancing blow scrubs speed without reversing it
          const vtx = rvx - vn * nx, vtz = rvz - vn * nz;
          const vts = Math.hypot(vtx, vtz);
          if (vts > 1e-4 && Fn > 0) {
            const ft = Math.min(MU * Fn, (vts * mass) / h);
            Fax += (vtx / vts) * ft;
            Faz += (vtz / vts) * ft;
            Fbx -= (vtx / vts) * ft;
            Fbz -= (vtz / vts) * ft;
          }

          a.vel.x += (Fax / mass) * h; a.vel.z += (Faz / mass) * h;
          b.vel.x += (Fbx / mass) * h; b.vel.z += (Fbz / mass) * h;
          a.yawRate += ((la[0] * Faz - la[1] * Fax) / INERTIA) * h;
          b.yawRate += ((lb[0] * Fbz - lb[1] * Fbx) / INERTIA) * h;

          // integrate positions so the overlap genuinely shrinks each step
          a.pos.x += a.vel.x * h; a.pos.z += a.vel.z * h;
          b.pos.x += b.vel.x * h; b.pos.z += b.vel.z * h;
        }
        if (closing > 2.5) {
          // direction of the last contact drives the spark spray
          const last = this._boxOverlap(a, b) || hitN;
          const cxm = (a.pos.x + b.pos.x) / 2, czm = (a.pos.z + b.pos.z) / 2;
          const cym = (a.pos.y + b.pos.y) / 2 + 0.4;
          this.effects.sparks(cxm, cym, czm, last.nx, last.nz, Math.min(18, closing * 1.1));
          if (a === this.player || b === this.player) {
            this.audio.impact(closing * 0.55);
            this.shake = Math.min(0.55, closing * 0.028);
            this.flash = Math.min(0.14, closing * 0.007);
          }
        }
      }
    }
  }

  /* ---------------- effects per car ---------------- */
  _carEffects(v, dt, budget) {
    const ud = v.mesh.userData;
    const fwd = v.forward, right = v.right;
    const grip = this.quality.particleScale;
    const slipRear = Math.abs(v.slipRear);
    const slipFront = Math.abs(v.slipFront);
    const smokeBase = clamp((slipRear - 0.09) * 1.9, 0, 1) * (v.grounded ? 1 : 0);
    const smokeF = clamp((slipFront - 0.13) * 1.6, 0, 1) * (v.grounded ? 1 : 0);
    const hb = v.handbrake;
    const screech = clamp(Math.max(smokeBase, smokeF * 0.7) + hb * 0.85, 0, 1);
    v._screech = screech;

    const near = v === this.player
      || (this.player.pos.distanceToSquared(v.pos) < 90 * 90);

    for (let i = 0; i < ud.wheels.length; i++) {
      const w = ud.wheels[i];
      const lx = w.pivot.position.x, lz = w.pivot.position.z;
      const wx = v.pos.x + fwd.x * lx + right.x * lz;
      const wz = v.pos.z + fwd.z * lx + right.z * lz;
      const wy = v.pos.y + w.pivot.position.y - 0.34;
      const isRear = !w.steer;
      const intensity = clamp(
        (isRear ? smokeBase : smokeF * 0.85) + hb * (isRear ? 0.8 : 0.5), 0, 1
      );

      if (near && v.grounded) {
        if (intensity > 0.05) {
          this.effects.tyreSmoke(wx, wy, wz, -v.vel.x, -v.vel.z, intensity, dt);
          this.effects.skid.add(`${v.name}-${i}`, wx, wy + 0.02, wz, right.x, right.z, 0.30, intensity);
        }
        if (v.offRoad > 0.15 && v.speed > 5) {
          this.effects.dust(wx, wy, wz, -v.vel.x, -v.vel.z, v.offRoad * clamp(v.speed / 25, 0, 1), dt);
        }
      } else if (near && v.offRoad > 0.15 && v.speed > 5) {
        this.effects.dust(wx, wy, wz, -v.vel.x, -v.vel.z, v.offRoad * clamp(v.speed / 25, 0, 1), dt * 0.4);
      }
    }

    if (near && v.boosting) {
      for (const e of ud.exhaust) {
        const wx = v.pos.x + fwd.x * e.x + right.x * e.z;
        const wz = v.pos.z + fwd.z * e.x + right.z * e.z;
        this.effects.boostFlame(wx, v.pos.y + e.y, wz, -fwd.x, -fwd.z, 1, dt);
      }
    }
    if (near && v === this.player) {
      for (const e of ud.exhaust) {
        const wx = v.pos.x + fwd.x * e.x + right.x * e.z;
        const wz = v.pos.z + fwd.z * e.x + right.z * e.z;
        this.effects.exhaust(wx, v.pos.y + e.y, wz, clamp(v.throttle, 0, 1), dt);
      }
    }
    if (v.landImpact > 5) {
      this.effects.landingPuff(v.pos.x, v.pos.y, v.pos.z, v.landImpact);
      if (v === this.player) this.shake = Math.min(0.6, v.landImpact * 0.05);
      v.landImpact = 0;
    }
  }

  /* ---------------- race logic ---------------- */
  _updateStandings() {
    const L = this.track.length;
    const arr = this.cars.slice();
    arr.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.signedProgress - a.signedProgress;
    });
    for (let i = 0; i < arr.length; i++) {
      arr[i].position = i + 1;
      if (arr[i] === this.player) this._playerPos = i + 1;
    }

    // Team standings run alongside the car order: a team's score is its best
    // finisher, so the panel shows both the car you are in and the overall
    // team result. In solo mode every car is its own team and this collapses
    // back to the plain order.
    if (this.teamMode && this.teamCount > 1) {
      const rows = teamStandings(this.cars, this.teamCount);
      this._teamStandings = rows;
      const mine = rows.find((r) => r.team === (this.player ? this.player.team : -1));
      this._playerTeamPos = mine ? mine.position : 0;
    } else {
      this._teamStandings = null;
      this._playerTeamPos = this._playerPos;
    }

    const leader = arr[0];
    this._standings = arr.map((c, i) => {
      const prev = arr[i - 1];
      let gap = '';
      if (i === 0) gap = 'LEADER';
      else {
        const d = prev.signedProgress - c.signedProgress;
        gap = (d > L * 0.9 ? '+' + Math.floor(d / L) + 'L' : '-' + d.toFixed(0) + 'm');
      }
      return {
        name: c.name, color: c.cssColor, isPlayer: c === this.player,
        gap, car: c,
        team: c.team, teamColor: c.teamColor,
        // Flag a teammate so the HUD can mark them differently from rivals.
        teammate: !!(this.teamMode && this.player && c.team === this.player.team && c !== this.player),
      };
    });
    return this._standings;
  }

  _checkFinish() {
    const p = this.player;
    const totalLaps = this.settings.laps;
    if (p.lap > p._lastLap) {
      p._lastLap = p.lap;
      if (p.lap === 1) {
        p.lapStart = this.raceTime;
        this.hud.bigMessage('GO GO GO<small>make them work for it</small>', 1200);
      } else {
        const t = this.raceTime - p.lapStart;
        p.lapTimes.push(t);
        p.lapStart = this.raceTime;
        if (!p.bestLap || t < p.bestLap) p.bestLap = t;
        if (t < this.bestEver) { this.bestEver = t; this.saveSettings(); }
        // Persist per track so records survive switching circuits.
        const res = recordLap(this.records, this.settings.track, t);
        saveRecords(this.records);
        if (res.record) {
          this._recordFlash = 2.6;
          this.hud.bigMessage('NEW TRACK RECORD<small>' + formatTime(t) + '</small>', 2200);
          this.audio.beep(1320, 0.1, 0.16);
          setTimeout(() => this.audio.beep(1760, 0.14, 0.16), 110);
        }
        if (p.lap < totalLaps) {
          this.hud.flashLap();
          this.hud.bigMessage(p.lap === totalLaps - 1
            ? 'FINAL LAP<small>everything you have</small>'
            : `LAP ${p.lap + 1}<small>${formatTime(t)} last lap</small>`);
          this.audio.beep(880, 0.12, 0.12);
        }
      }
    }
    for (const v of this.cars) {
      if (!v.finished && v.lap >= totalLaps) {
        v.finished = true;
        v.finishTime = this.raceTime;
        if (v === p) {
          this.state = 'finished';
          this.finishedAt = this.raceTime;
          this.camMode = 3;
          recordRace(this.records, this.settings.track, p.position);
          saveRecords(this.records);
          this._awardRaceCoins();
          setTimeout(() => this._showResults(), 1400);
        }
      }
    }
  }

  _showResults() {
    if (this.resultsShown) return;
    this.resultsShown = true;
    const order = this.cars.slice().sort((a, b) => a.position - b.position);
    const p = this.player;
    const pos = p.position;
    const board = document.getElementById('resBoard');
    board.innerHTML = '';
    order.forEach((c, i) => {
      const li = document.createElement('li');
      li.className = c === p ? 'me' : '';
      const gap = i === 0 ? 'WINNER'
        : (c.finished && order[0].finished) ? '+' + ((c.finishTime - order[0].finishTime) / 1000).toFixed(2) + 's'
          : `LAP ${Math.min(c.lap, this.settings.laps)}`;
      li.innerHTML = `<span class="rp">${i + 1}</span><span class="swatch" style="background:${c.cssColor}"></span>` +
        `<span class="rn">${c.name}</span><span class="rt">${gap}</span>`;
      board.appendChild(li);
    });
    const title = document.getElementById('resTitle');
    const sub = document.getElementById('resSub');
    title.textContent = pos === 1 ? 'VICTORY' : pos <= 3 ? 'ON THE PODIUM' : 'RACE COMPLETE';
    title.style.color = pos === 1 ? 'var(--good)' : pos <= 3 ? 'var(--accent)' : '';
    sub.textContent = `${ordinal(pos)} place · ${this.track.name} · ${this.settings.laps} laps`;
    document.getElementById('resStats').innerHTML = `
      <div>TOP SPEED<b>${Math.round(p.topSpeedKmh || 0)} km/h</b></div>
      <div>BEST LAP<b>${formatTime(p.bestLap)}</b></div>
      <div>TOTAL<b>${formatTime(this.finishedAt || this.raceTime)}</b></div>`;
    document.getElementById('results').classList.remove('hidden');
    this.hud.setVisible(false);
    this.audio.fanfare(pos === 1);
  }

  /* ---------------- main loop ---------------- */
  _loop = () => {
    requestAnimationFrame(this._loop);
    const raw = this.clock.getDelta();
    // keep draining the clock during a world rebuild so the first real frame
    // afterwards does not inherit a huge delta.
    // _worldLoading is set synchronously by _reloadWorld, so it also covers the
    // window between the world being torn down and _loadWorld taking over.
    if (this._loading || this._worldLoading || this.contextLost) return;
    const dt = Math.min(raw, 0.05);

    if (this.state === 'menu') {
      // _tick() is not reached while the menu is up, so the "press Enter to
      // race" action has to be drained here or the flag would stay latched.
      if (this.input.took('confirm')) this.startRace();
      this._cinematicIdle(dt);
      this.scenery && this.scenery.update(performance.now() * 0.001);
      // the idle camera roams the circuit, so the dome has to keep following
      // it and keep the cloud/star shaders advancing
      this.sky.update(dt, null, this.camera);
      this.post.render(dt);
      this._autoProbe(raw);
      return;
    }

    if (this.paused) {
      this.post.render(dt);
      this.gov.update(raw);
      return;
    }

    this._tick(dt);
    this.post.render(dt);
    this.gov.update(raw);
    this._raceProbe(dt);
    this._updateDetail();
  };



  _tick(dt) {
    const p = this.player;
    const input = this.input.update(dt);

    // Manual gearbox: consume the edge once per frame, outside the physics
    // substeps, so one key press is exactly one shift.
    const shift = this.input.takeShift();
    if (shift && p && p.setup.transmission === 'manual') p.queueShift(shift);

    /* ---- countdown ---- */
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 0.9);
      if (n !== this._cdShown) {
        this._cdShown = n;
        if (n >= 1 && n <= 3) {
          this.hud.countdown(String(n));
          this.track.setStartLights(4 - n);
          this.audio.beep(560, 0.2, 0.16);
        }
      }
      if (this.countdown <= 0.9 && !this._goShown) {
        this._goShown = true;
        this.hud.countdown('GO!', true);
        this.track.setStartLights(4);
        this.audio.beep(1040, 0.42, 0.2);
        this.state = 'racing';
        setTimeout(() => { this.hud.hideCountdown(); this._goShown = false; }, 900);
      }
    } else if (this.state === 'racing' || this.state === 'finished') {
      this.raceTime += dt * 1000;
    }

    /* ---- actions ---- */
    if (this.input.took('camera')) {
      this.camMode = (this.camMode + 1) % CAM_MODES.length;
      this.hud.bigMessage(`${CAM_MODES[this.camMode]} CAMERA`);
    }
    if (this.input.took('photo')) {
      this.camMode = CAM_MODES.indexOf('CINEMATIC');
      this.hud.bigMessage('CINEMATIC CAMERA');
    }
    if (this.input.took('pause')) this.setPaused(!this.paused);
    if (this.input.took('mute')) {
      this.settings.muted = !this.settings.muted;
      this.audio.setMuted(this.settings.muted || !this.settings.audio);
      this.saveSettings();
      this.hud.bigMessage(this.settings.muted ? 'AUDIO MUTED' : 'AUDIO ON');
    }
    if (this.input.took('respawn') && this.state !== 'finished') {
      p.respawn();
      this.hud.bigMessage('RESPAWNED');
    }
    if (this.input.padPressed() && (this.state === 'racing' || this.state === 'countdown')) {
      // gamepad start button
      const pad = this.input._pad();
      if (pad && pad.buttons[9] && pad.buttons[9].pressed) this.setPaused(!this.paused);
    }

    /* ---- simulate ---- */
    const frozen = this.state === 'countdown';
    let pIn = input;
    if (this.autoDriver && !frozen) {
      this.autoDriver.update(dt, this.cars);
      pIn = this.autoDriver.input;
    } else if (this.autoDriver && frozen) {
      this.autoDriver.v.update(dt, ZERO_INPUT);
    }
    p.update(dt, frozen ? ZERO_INPUT : pIn);
    p.topSpeed = Math.max(p.topSpeed || 0, p.speed);
    p.topSpeedKmh = p.topSpeed * 3.6;

    for (const ai of this.ais) {
      if (frozen) {
        ai.v.update(dt, ZERO_INPUT);
        ai.v.sync();
      } else {
        ai.update(dt, this.cars);
      }
    }

    this._resolveCarCollisions(dt);
    this._checkFinish();
    this._updateStandings();

    /* ---- wall impacts ---- */
    for (const v of this.cars) {
      if (v.impact > 2) {
        const p2 = v.mesh.userData;
        const back = v.forward;
        this.effects.sparks(v.pos.x - back.x * 2, v.pos.y + 0.6, v.pos.z - back.z * 2, -back.x, -back.z, Math.min(14, v.impact));
        if (v === p) {
          this.audio.impact(v.impact);
          this.shake = Math.min(0.55, v.impact * 0.035);
          this.flash = Math.min(0.14, v.impact * 0.009);
        }
      }
    }

    /* ---- effects ---- */
    for (const v of this.cars) this._carEffects(v, dt);
    this.effects.update(dt, this.camera, this._bufH());
    this.flash = damp(this.flash, 0, 8, dt);

    /* ---- camera + sky ---- */
    this._updateCamera(dt);
    this.scenery.update(performance.now() * 0.001);

    /* ---- post ---- */
    const speed01 = clamp((p.speed - 22) / 70, 0, 1);
    this.post.update(speed01, this.flash, p.boosting ? 1 : 0);

    /* ---- audio ---- */
    this.audio.updateEngine({
      rpm: p.rpm, throttle: p.throttle, speed: p.speed,
      slip: p._screech || 0, boost: p.boosting, redline: p.tune.redline,
      active: true,
    }, dt);

    /* ---- HUD ---- */
    const standings = this._standings;
    this.hud.update(dt, {
      kmh: p.kmh, rpm: p.rpm, redline: p.tune.redline, gear: p.gear, boost: p.boost,
      manual: p.setup.transmission === 'manual',
      position: p.position, total: this.cars.length,
      lap: clamp(p.lap || 1, 1, this.settings.laps), totalLaps: this.settings.laps,
      raceTime: this.raceTime, currentLap: this.raceTime - p.lapStart, bestLap: p.bestLap,
      standings, cars: this.cars, player: p, track: this.track,
    });
    this.hud.tick(dt);

    if (this.state === 'racing' && p.wrongWay && !this._wrongShown) {
      this._wrongShown = true;
      this.hud.bigMessage('WRONG WAY<small>turn around</small>', 1200);
      setTimeout(() => { this._wrongShown = false; }, 2600);
    }
  }
}

const ZERO_INPUT = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: false };

/* ------------------------------------------------------------------ */
const game = new Game();
window.__game = game;
game.boot().catch((err) => {
  console.error(err);
  const box = document.getElementById('fatal');
  document.getElementById('fatalMsg').textContent = err && err.message ? err.message : String(err);
  box.classList.remove('hidden');
  document.getElementById('loader').classList.add('hidden');
});
