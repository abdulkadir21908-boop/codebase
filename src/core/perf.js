/* =========================================================
   Performance: hardware detection, preset sizing, live governor

   "Runs on every machine" needs three things:

     1. A guess before anything is allocated. The preset decides how much
        scenery, terrain, particles and shadow map memory get created, so
        the guess has to happen before the world is built.

     2. A measurement once WebGL exists. Core count and RAM say nothing
        about whether we are on a software rasteriser or borrowing system
        memory for the GPU, and the GL renderer string does.

     3. A live governor. Real frame times during the menu and the race,
        scaling the render resolution and finally the preset to hold a
        playable frame rate.

   Everything here is driven by the RAW wall-clock frame delta, never the
   clamped physics dt. The physics loop clamps dt to 50 ms so a long stall
   cannot explode the simulation, but measuring that value would cap every
   reading at 20 fps - a machine crawling at 8 fps would look healthy and
   never be corrected.
   ========================================================= */

/**
 * Ordered worst-to-best. The governor walks this when stepping down.
 * `ultra` must stay in step with the presets in main.js: it is what
 * QUALITY_ORDER.indexOf() is used for, and a preset missing from this list
 * silently becomes unreachable to the auto step-down (index -1).
 */
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

const WINDOW = 0.75;          // seconds of samples per decision
const TARGET = 52;           // fps we aim for
const MIN_SCALE = 0.55;
const MAX_SCALE = 1.0;
// Below this, and with resolution already at the floor, give up a preset.
// Deliberately well under TARGET: a machine holding ~45 fps is playable, and
// stripping the scenery out of it is a worse trade than a slightly lower
// frame rate on hardware that is already struggling.
const STARVE_FPS = 34;

// The frame-rate bands both the governor and the boot probe reason about, so
// that the two can never disagree about what counts as struggling.
export const BANDS = { target: TARGET, starve: STARVE_FPS, near: 46 };

/* ------------------------------------------------------------------ */
/* Hardware probe                                                      */
/* ------------------------------------------------------------------ */

/**
 * Best-effort description of the machine, usable before WebGL exists.
 *
 * @param gl optional WebGL context; when given, the GL renderer string is
 *           parsed, which is the only reliable way to spot a software
 *           rasteriser (SwiftShader, llvmpipe, "Microsoft Basic Render").
 */
export function detectHardware(gl) {
  const hw = {
    cores: navigator.hardwareConcurrency || 0,
    memory: navigator.deviceMemory || 0,
    dpr: (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1),
    mobile: false,
    softwareGL: false,
    renderer: '',
    integrated: true,
  };

  try {
    hw.mobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && hw.cores <= 8 && hw.dpr > 2);
  } catch (e) { /* ignore */ }

  if (gl) {
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      hw.renderer = String(name || '');
      const r = hw.renderer.toLowerCase();
      hw.softwareGL = /swiftshader|llvmpipe|software|basic render|microsoft basic|mesa offscreen/.test(r);
      hw.integrated = /intel|uhd|iris|hd graphics|hd_|apple gpu|adreno|mali|powervr|llvmpipe|swiftshader/.test(r);
    } catch (e) { /* a browser may refuse the string; that is fine */ }
  }

  return hw;
}

/**
 * Preset guess from hardware alone, before WebGL is available.
 * Conservative: anything uncertain lands on 'medium', and the measured probe
 * corrects it a moment later.
 */
export function guessQuality(hw) {
  if (!hw) return 'medium';
  if (hw.softwareGL) return 'low';
  if (hw.cores && hw.cores <= 2) return 'low';
  if (hw.memory && hw.memory <= 2) return 'low';
  if (hw.mobile) return hw.cores >= 8 && hw.memory >= 6 ? 'medium' : 'low';
  if (hw.cores >= 8 && hw.memory >= 8 && hw.dpr <= 2) return 'high';
  return 'medium';
}

/**
 * Preset from a measured frame rate. Deliberately pessimistic: a machine that
 * only just makes the target should still have headroom for the corners and
 * for effects that only fire part of the time.
 */
/* ------------------------------------------------------------------ */
/* Boot-time probe                                                     */
/* ------------------------------------------------------------------ */

/**
 * Collects frame times and decides when the scene is warm enough to judge.
 *
 * The warm-up discard is the important part. The first second or so after the
 * world is built is dominated by shader compilation, texture upload and the
 * PMREM pass; timing those frames measures the loader, not the machine. Doing
 * it anyway cost a perfectly capable laptop its scenery - it measured 23 fps
 * during warm-up and then sat at a steady 60.
 *
 * Kept as a standalone class with no rendering dependencies so the decision
 * can be tested deterministically instead of being eyeballed in a browser
 * window, where a hidden tab throttles requestAnimationFrame anyway.
 */
export class AutoProbe {
  constructor(opts = {}) {
    this.warmup = opts.warmup ?? 1.5;      // seconds of frames to throw away
    this.window = opts.window ?? 1.5;      // seconds of real samples to collect
    this.minFrames = opts.minFrames ?? 30; // ...and a floor on the count
    this.reset();
  }

  reset() {
    this.warmed = false;
    this.warm = 0;
    this.acc = 0;
    this.frames = 0;
    this.samples = [];
    this.done = false;
    this.fps = 0;
  }

  /** @param dt seconds of real time since the last frame; @returns true once decided */
  push(dt) {
    if (this.done) return true;
    if (!(dt > 0) || dt > 1.5) return false;      // stall or clock jump

    if (!this.warmed) {
      this.warm += dt;
      if (this.warm < this.warmup) return false;   // still compiling shaders
      // Close the warm-up window on its own clock, not on a frame count. A
      // slow machine produces few frames per second, so counting frames from
      // the very first one would let the measurement window close while we
      // were still inside warm-up - and the only samples it had were the
      // compilation frames we were trying to discard.
      this.warmed = true;
      this.acc = 0;
      this.frames = 0;
      this.samples.length = 0;
      return false;
    }

    this.acc += dt;
    this.frames++;
    this.samples.push(dt);
    if (this.acc < this.window || this.frames < this.minFrames) return false;

    // median, not mean: one remaining hitch must not demote the machine
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const usable = sorted.slice(Math.floor(sorted.length * 0.2), Math.floor(sorted.length * 0.95));
    this.fps = usable.length ? 1 / usable[usable.length >> 1] : this.frames / this.acc;
    this.done = true;
    return true;
  }
}

export function pickQuality(fps, hw) {
  if (!(fps > 0)) return 'low';
  // a software rasteriser never recovers by being asked for more pixels
  if (hw && hw.softwareGL) return 'low';

  // These deliberately match PerfGovernor's regimes: below STARVE_FPS the
  // governor is going to pin resolution and give up a preset anyway, so the
  // probe should say so up front rather than nominate a preset that is about to
  // be taken away again. Disagreeing thresholds made the game pick a preset and
  // then immediately drop it, which looked like flicker.
  let name;
  if (fps < STARVE_FPS) name = 'low';
  else if (fps < 46) name = 'medium';
  else name = 'high';
  // small phones get pointed at low even when they report a flattering rate,
  // because they thermal-throttle within a lap
  if (hw && hw.mobile && hw.cores < 8 && name !== 'low') name = 'medium';
  return name;
}

/* ------------------------------------------------------------------ */
/* Live governor                                                       */
/* ------------------------------------------------------------------ */

export class PerfGovernor {
  /**
   * @param onScale   called when the resolution scale changes
   * @param onStarve  called with true when pinned at the minimum resolution
   *                  and still short of target (give up a preset), and with
   *                  false when there is room again
   */
  constructor(onScale, onStarve) {
    this.onScale = onScale;
    this.onStarve = onStarve || null;
    this.scale = 1;
    this.acc = 0;
    this.frames = 0;
    this.fps = TARGET;
    this.samples = [];
    this.cooldown = 0;
    this.changed = 0;
    this.starved = 0;      // consecutive slow windows, for reporting
    this._sinceStarve = -1;// windows spent pinned and slow (-1 = not currently)
    this._sinceFire = 0;   // how many preset steps have been given up
    this._fast = 0;
    // set by the governor test, which drives update() synthetically and is
    // therefore not subject to the tab being visible
    this.ignoreHidden = false;
  }

  reset() {
    this.acc = 0;
    this.frames = 0;
    this.samples.length = 0;
    this.cooldown = 1.5;      // ignore the first moments after a rebuild
    this.starved = 0;
    this._sinceStarve = -1;
    this._fast = 0;
    // deliberately NOT resetting _sinceFire: a rebuild does not put the
    // machine's power back, so the governor must not walk all the way back up
    // through every preset on the next stall
  }

  /** @param dt seconds of REAL time since the last frame */
  update(dt) {
    // A hidden tab is not evidence the machine is slow: browsers throttle
    // requestAnimationFrame hard when a page is not visible, which would look
    // exactly like a catastrophic frame rate and make the governor strip the
    // resolution down for no reason.
    if (!this.ignoreHidden && typeof document !== 'undefined' && document.hidden) {
      this.reset();
      return;
    }
    if (!(dt > 0) || dt > 2) return;       // clock jump, debugger pause, etc.

    this.acc += dt;
    this.frames++;
    if (this.samples.length > 400) this.samples.shift();
    this.samples.push(dt);

    if (this.cooldown > 0) { this.cooldown -= dt; this.acc = 0; this.frames = 0; return; }
    if (this.acc < WINDOW) return;

    this.fps = this.frames / this.acc;
    const before = this.scale;

    if (this.fps < TARGET - 6) {
      // Cut resolution in proportion to how far off we are, so a machine that
      // is only just struggling is not punished as hard as one that crawls.
      const severity = clamp01((TARGET - this.fps) / TARGET, 0.05, 0.45);
      this.scale = clamp01(this.scale - severity * 0.55, MIN_SCALE, MAX_SCALE);
      this.starved++;
      this._fast = 0;
    } else if (this.fps > TARGET + 12 && this.scale < MAX_SCALE) {
      this.scale = clamp01(this.scale + 0.06, MIN_SCALE, MAX_SCALE);
      this.starved = 0;
      this._fast++;
    } else {
      this.starved = 0;
      this._fast = 0;
    }

    // Pinned at the resolution floor and still missing the target: the cost is
    // not fill rate any more, so give back a whole preset instead of spinning
    // at the floor forever.
    //
    // This has to be able to fire more than once, otherwise a machine that is
    // far below target only ever gets one step of help and then gives up. Each
    // step is therefore separated by a few settled windows, and the effect is
    // given back as soon as there is genuine headroom.
    const pinned = this.scale <= MIN_SCALE + 0.005;
    // Only give up a preset once the machine is genuinely struggling, not
    // merely a few frames short of target. Resolution scaling has already been
    // exhausted by the time we get here, but a machine sitting at ~45 fps is
    // perfectly playable and does not deserve to have the scenery taken away.
    if (pinned && this.fps < STARVE_FPS) {
      if (this._sinceStarve < 0) this._sinceStarve = 0;
      this._sinceStarve++;
      // two windows to confirm this is not a one-off, then three to settle
      // before considering another step
      const needed = this._sinceFire === 0 ? 2 : 5;
      if (this._sinceStarve >= needed) {
        this._sinceStarve = 0;
        this._sinceFire++;
        this.starving = true;
        this.onStarve && this.onStarve(true);
      }
    } else {
      this._sinceStarve = -1;
      // comfortable again, and not pinned: hand the preset back
      if (this.starving && this.fps > TARGET - 2 && this.scale > MIN_SCALE + 0.02) {
        this.starving = false;
        this._sinceFire = 0;
        this.onStarve && this.onStarve(false);
      }
    }

    if (Math.abs(this.scale - before) > 0.004) {
      this.changed++;
      this.onScale(this.scale);
    }
    this.acc = 0;
    this.frames = 0;
  }

  /**
   * Robust fps estimate over the samples collected so far. The plain mean is
   * misleading because one long hitch dominates it, so trim the slow tail and
   * take the median.
   */
  probe() {
    const s = this.samples.slice().sort((a, b) => a - b);
    if (s.length < 12) return 0;
    // drop the first quarter (shader compilation, texture upload) and the top
    // decile (hitches), then take the median of what is left
    const usable = s.slice(Math.floor(s.length * 0.25), Math.floor(s.length * 0.9));
    if (!usable.length) return 0;
    return 1 / usable[usable.length >> 1];
  }
}

function clamp01(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
