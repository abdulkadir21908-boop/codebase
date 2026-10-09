/* =========================================================
   Audio — fully synthesised with the Web Audio API.
   Engine note is derived from the real RPM, so upshifts are
   audible; tyres, wind, impacts and the countdown are all
   generated. No sample files.
   ========================================================= */
import { clamp, lerp } from '../util/math.js';

const TUNE_IDLE = 900;

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.volume = 0.7;
    this._engineOn = false;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    this.master.connect(comp).connect(ctx.destination);

    /* ---- noise source shared by tyres / wind / impacts ---- */
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = w * 0.6 + last * 3.2;
    }
    this.noiseBuf = buf;

    /* ---- engine ---- */
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 900;
    this.engFilter.Q.value = 1.1;
    this.engFilter.connect(this.engGain).connect(this.master);

    this.oscs = [];
    const harmonics = [
      { mul: 0.5, type: 'sawtooth', gain: 0.5, detune: -6 },
      { mul: 1.0, type: 'sawtooth', gain: 0.85, detune: 0 },
      { mul: 2.0, type: 'square', gain: 0.22, detune: 8 },
      { mul: 3.0, type: 'sawtooth', gain: 0.12, detune: -12 },
    ];
    for (const h of harmonics) {
      const o = ctx.createOscillator();
      o.type = h.type;
      o.frequency.value = 60;
      o.detune.value = h.detune;
      const g = ctx.createGain();
      g.gain.value = h.gain;
      o.connect(g).connect(this.engFilter);
      o.start();
      this.oscs.push({ osc: o, mul: h.mul });
    }
    // intake / exhaust noise layer
    this.engNoise = ctx.createBufferSource();
    this.engNoise.buffer = buf;
    this.engNoise.loop = true;
    this.engNoiseFilter = ctx.createBiquadFilter();
    this.engNoiseFilter.type = 'bandpass';
    this.engNoiseFilter.frequency.value = 320;
    this.engNoiseFilter.Q.value = 0.7;
    this.engNoiseGain = ctx.createGain();
    this.engNoiseGain.gain.value = 0;
    this.engNoise.connect(this.engNoiseFilter).connect(this.engNoiseGain).connect(this.master);
    this.engNoise.start();

    // boost whine
    this.whine = ctx.createOscillator();
    this.whine.type = 'triangle';
    this.whine.frequency.value = 900;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.whine.start();

    /* ---- tyres ---- */
    this.tyreSrc = ctx.createBufferSource();
    this.tyreSrc.buffer = buf;
    this.tyreSrc.loop = true;
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.frequency.value = 2100;
    this.tyreFilter.Q.value = 5.5;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.tyreSrc.connect(this.tyreFilter).connect(this.tyreGain).connect(this.master);
    this.tyreSrc.start();

    /* ---- wind ---- */
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = buf;
    this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'highpass';
    this.windFilter.frequency.value = 700;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.windSrc.start();

    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.value = v;
  }

  /** @param s { rpm, throttle, speed, slip, boost, gear, active } */
  updateEngine(s, dt) {
    if (!this.ready) return;
    // never let a bad frame turn into a Web Audio exception
    const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
    s.rpm = num(s.rpm, TUNE_IDLE);
    s.throttle = num(s.throttle);
    s.speed = num(s.speed);
    s.slip = num(s.slip);
    s.redline = num(s.redline, 7600);
    s.boost = !!s.boost;
    s.active = !!s.active;
    const t = this.ctx.currentTime;
    const f0 = clamp((s.rpm / 60) * 2, 24, 420);
    for (const o of this.oscs) {
      o.osc.frequency.setTargetAtTime(f0 * o.mul, t, 0.02);
    }
    const load = clamp(s.throttle * 0.75 + 0.25, 0, 1);
    const target = s.active ? lerp(0.055, 0.16, load) * (0.55 + s.rpm / s.redline * 0.75) : 0;
    this.engGain.gain.setTargetAtTime(target, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(
      lerp(520, 4200, clamp(s.rpm / s.redline, 0, 1) * 0.75 + load * 0.35), t, 0.04
    );
    this.engNoiseGain.gain.setTargetAtTime(s.active ? 0.05 + load * 0.1 : 0, t, 0.06);
    this.engNoiseFilter.frequency.setTargetAtTime(lerp(180, 900, s.rpm / s.redline), t, 0.05);

    // boost whine
    this.whineGain.gain.setTargetAtTime(s.boost && s.active ? 0.05 : 0, t, 0.05);
    this.whine.frequency.setTargetAtTime(700 + s.rpm / 40, t, 0.06);

    // tyres
    const slip = clamp(s.slip, 0, 1);
    this.tyreGain.gain.setTargetAtTime(s.active ? slip * 0.14 : 0, t, 0.05);
    this.tyreFilter.frequency.setTargetAtTime(lerp(1500, 3200, slip), t, 0.06);
    this.tyreFilter.Q.value = lerp(4, 9, slip);

    // wind
    this.windGain.gain.setTargetAtTime(s.active ? clamp(s.speed / 90, 0, 1) * 0.11 : 0, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(lerp(500, 1800, clamp(s.speed / 90, 0, 1)), t, 0.1);
  }

  impact(power) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const g = clamp(power / 18, 0.08, 1);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(200, t + 0.28);
    const gn = this.ctx.createGain();
    gn.gain.setValueAtTime(g * 0.55, t);
    gn.gain.exponentialRampToValueAtTime(0.0008, t + 0.34);
    src.connect(f).connect(gn).connect(this.master);

    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(g * 0.4, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
    o.connect(og).connect(this.master);

    // Anything still wired to master stays alive in the audio graph for the
    // life of the context, so tear the one-shot chain down once it has played.
    src.onended = () => {
      src.disconnect(); f.disconnect(); gn.disconnect();
      o.disconnect(); og.disconnect();
    };
    src.start(t);
    src.stop(t + 0.4);
    o.start(t); o.stop(t + 0.32);
  }

  beep(freq = 440, dur = 0.16, vol = 0.16) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.master);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    o.start(t); o.stop(t + dur + 0.02);
  }

  shift() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 3;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    src.connect(f).connect(g).connect(this.master);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
    src.start(t); src.stop(t + 0.11);
  }

  fanfare(win) {
    if (!this.ready) return;
    const notes = win ? [523, 659, 784, 1047] : [523, 440, 349];
    notes.forEach((n, i) => setTimeout(() => this.beep(n, 0.22, 0.14), i * 130));
  }
}
