/* =========================================================
   Vehicle dynamics.

   A load-transferring bicycle model with a simplified Pacejka
   tyre, an automatic gearbox, downforce, a handbrake that
   breaks the rear loose, boost, air time and wall collisions.
   Arcade-tuned but the forces are all physically motivated, so
   the car has weight transfer, understeer and controllable
   slides instead of sliding around like a hockey puck.
   ========================================================= */
import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp } from '../util/math.js';

const G = 9.81;

export const TUNING = {
  mass: 1230,
  inertiaFactor: 0.42,       // yaw inertia = mass * inertiaFactor
  wheelBase: 2.80,
  cgHeight: 0.42,
  frontWeight: 0.53,
  wheelRadius: 0.36,
  wheelInertia: 1.1,

  // engine
  peakTorque: 560,
  redline: 7600,
  idleRpm: 900,
  gears: [3.35, 2.20, 1.65, 1.30, 1.06, 0.88],
  finalDrive: 3.42,
  drivetrainEff: 0.92,
  shiftUpRpm: 7150,
  shiftDownRpm: 3050,
  shiftTime: 0.22,

  // aero
  dragK: 0.30,              // 0.5*rho*Cd*A
  downforceK: 1.7,          // 0.5*rho*Cl*A
  rollingResistance: 13.0,
  brakeForce: 30000,
  reverseForce: 7200,
  maxReverse: 11,             // m/s (~40 km/h) — reverse drive tapers out here
  maxSpeed: 45,              // m/s (~162 km/h) — global speed governor
  handbrakeForce: 11000,

  // tyres
  gripFront: 2.05,
  gripRear: 2.0,
  stiffFront: 108000,
  stiffRear: 122000,
  pacejkaC: 1.52,
  pacejkaE: 0.96,
  handbrakeGrip: 0.3,

  // steering
  maxSteerLow: 0.45,
  maxSteerHigh: 0.12,
  steerSpeedLow: 7,
  steerSpeedHigh: 68,
  steerRate: 3.4,

  boostPower: 1.55,
  boostMax: 1,
  boostRegen: 0.24,
  boostDrain: 0.34,
};

const TIRE = (alpha, D, B, C, E) =>
  -D * Math.sin(C * Math.atan(B * alpha - E * (B * alpha - Math.atan(B * alpha))));

/* =========================================================
   Control difficulty.

   Each level is a genuine loss of control rather than a nudge:
   less counter-steer authority, a slower steering rack, more
   lock per input, looser tyres and less rotational damping.
   The car both answers less when you ask it to turn, and
   rotates further than you meant once it lets go.

   MEDIUM is the baseline the handling model above was tuned
   around, so it reproduces the previous feel exactly.
   ========================================================= */
export const CONTROL = {
  easy: {
    label: 'Easy',
    blurb: 'Extra grip, planted rotation and a strong self-correction net.',
    steerAssist: 1.0,      // counter-steer authority, 0..1
    steerRate: 6.0,        // how fast the rack follows the input
    lockLow: 0.34,         // steering lock at parking speed
    lockHigh: 0.10,        // steering lock at speed
    falloffLow: 7,         // speed where lock starts bleeding off
    falloffHigh: 55,       // speed where it is fully bled off
    yawDamp: 4.2,          // rotational damping, resists spin
    gripScale: 1.25,       // tyre grip multiplier
    yawLimit: 1.25,        // rad/s ceiling on rotation, 0 = no ceiling
  },
  medium: {
    label: 'Medium',
    blurb: 'Standard handling — the balance the car was tuned around.',
    steerAssist: 0.5,
    steerRate: 3.4,
    lockLow: 0.45,
    lockHigh: 0.12,
    falloffLow: 7,
    falloffHigh: 68,
    yawDamp: 2.8,
    gripScale: 1.06,
    yawLimit: 0,
  },
  hard: {
    label: 'Hard',
    blurb: 'Loose tyres, a slow rack and no assist. It will not hold your line.',
    steerAssist: 0.0,
    steerRate: 1.8,
    lockLow: 0.58,
    lockHigh: 0.17,
    falloffLow: 5,
    falloffHigh: 95,
    yawDamp: 1.0,
    gripScale: 0.72,
    yawLimit: 0,
  },
};

export const CONTROL_ORDER = ['easy', 'medium', 'hard'];

/* =========================================================
   Setup and driving aids.

   The dials drivers actually reach for. Each maps onto a
   quantity the tyre model already works in, so switching one
   off is felt rather than cosmetic:

     traction  rad of rear slip the axle is allowed before
               drive is cut  (null = no limit)
     abs       rad of front slip before the brakes are eased
     esc       how hard rotation is bled off toward the rate
               the steering is actually asking for
   ========================================================= */
export const AIDS = {
  traction: { off: null, low: 0.30, med: 0.19, high: 0.11 },
  abs: { off: null, low: 0.15, high: 0.55 },
  esc: { off: 0, low: 0.35, high: 0.85 },
};

export const SETUP_DEFAULT = {
  transmission: 'auto',
  traction: 'high',
  abs: 'low',
  esc: 'low',
  brakeBias: 60,      // % of braking force on the front axle
  steerLock: 100,     // % multiplier on steering lock
  downforce: 100,     // % multiplier on downforce
};

/** Union of the defaults, used to validate anything loaded from storage. */
export const SETUP_KEYS = Object.keys(SETUP_DEFAULT);

const _v3 = new THREE.Vector3();

export class Vehicle {
  constructor(opts = {}) {
    this.tune = Object.assign({}, TUNING, opts.tuning || {});
    this.mass = this.tune.mass;
    this.mesh = opts.mesh;
    this.track = opts.track;
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name || 'Driver';
    this.color = opts.color ?? 0xffffff;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.yawRate = 0;
    this.vy = 0;
    this.grounded = true;
    this.airTime = 0;

    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.steerTarget = 0;
    this.handbrake = 0;
    // Edge-triggered so holding the key does not run through the gearbox in one
    // frame; the sim runs several substeps per frame.
    this.shiftQueued = 0;
    this.boost = TUNING.boostMax;
    this.boosting = false;

    this.gear = 1;
    this.rpm = TUNING.idleRpm;
    this.shiftTimer = 0;
    this.speed = 0;
    this.slipFront = 0;
    this.slipRear = 0;
    this.lateralG = 0;
    this.longG = 0;
    this.wheelSpin = 0;
    this.offRoad = 0;
    this.controlName = opts.control && CONTROL[opts.control] ? opts.control : 'medium';
    this.control = Object.assign({}, CONTROL[this.controlName]);
    this.steerAssist = this.isPlayer ? this.control.steerAssist : 0;

    this.setup = Object.assign({}, SETUP_DEFAULT, opts.setup || {});
    // Rivals are the benchmark, so they always run stock — a setup change must
    // never quietly hand the player an advantage against the field.
    if (!this.isPlayer) this.setup = Object.assign({}, SETUP_DEFAULT);

    // race bookkeeping
    this.progressS = 0;
    this.lastS = 0;
    this.lap = 0;
    this.lapStart = 0;
    this.lapTimes = [];
    this.finished = false;
    this.finishTime = 0;
    this.position = 1;
    this.wrongWay = false;

    this._surface = {};
    this._tmpRight = new THREE.Vector3();
    this._tmpFwd = new THREE.Vector3();
  }

  reset(s, lateral, heading) {
    const p = this.track.pointAt(s, lateral, new THREE.Vector3());
    this.pos.copy(p);
    this.yaw = heading;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.yawRate = 0;
    this.gear = 1;
    this.rpm = TUNING.idleRpm;
    this.boost = TUNING.boostMax;
    this.shiftQueued = 0;
    this._pendingShift = 0;
    this.shiftTimer = 0;
    this.lap = 0;
    this.lapTimes = [];
    this.finished = false;
    this.finishTime = 0;
    this.lastS = s;
    this.progressS = s;
    this.progress = s;
    this.signedProgress = s;
    this.speed = 0;
    this.sync();
  }

  get forward() {
    return this._tmpFwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  get right() {
    return this._tmpRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** km/h */
  get kmh() { return this.speed * 3.6; }

  /** Swap the control preset (menu change, or a rebuild). Rivals stay neutral. */
  setControl(name) {
    if (!CONTROL[name]) name = 'medium';
    this.controlName = name;
    this.control = Object.assign({}, CONTROL[name]);
    this.steerAssist = this.isPlayer ? this.control.steerAssist : 0;
  }

  /**
   * Apply a driver setup. Unknown or malformed keys fall back to the default
   * rather than poisoning the physics with undefined.
   */
  setSetup(setup) {
    const next = Object.assign({}, SETUP_DEFAULT, setup || {});
    for (const k of SETUP_KEYS) {
      if (typeof next[k] !== typeof SETUP_DEFAULT[k]) next[k] = SETUP_DEFAULT[k];
    }
    if (!this.isPlayer) return;
    this.setup = next;
  }

  respawn() {
    const s = this.progressS;
    this.vel.multiplyScalar(0.2);
    this.vy = 0;
    this.yawRate = 0;
    this.reset(this.track.wrapS(s - 4), 0, this.track.project(this.pos.x, this.pos.z).heading);
  }

  /**
   * Queue a gear change for the next update. Edge-triggered so one key press
   * is one shift.
   */
  queueShift(dir) { this.shiftQueued = dir; }

  /**
   * @param {number} dt seconds
   * @param {object} input { throttle, brake, steer, handbrake, boost }
   */
  update(dt, input) {
    const T = this.tune;
    const sub = 1 / 180;
    this._applyShiftRequest();
    // A request held back mid-shift fires once the torque cut clears.
    if (this._pendingShift && this.shiftTimer <= 0) {
      const held = this._pendingShift;
      this._pendingShift = 0;
      this.queueShift(held);
      this._applyShiftRequest();
    }
    let remaining = Math.min(dt, 0.06);
    let n = 0;
    this.impact = 0;
    while (remaining > 1e-4 && n < 8) {
      const h = Math.min(sub, remaining);
      this._step(h, input);
      remaining -= h;
      n++;
    }
    this._updateProgress();
    this.sync();
  }

  _applyShiftRequest() {
    const dir = this.shiftQueued;
    if (!dir) return;
    this.shiftQueued = 0;
    const T = this.tune;
    if (!this.grounded) return;
    // Mid-shift presses are held rather than dropped. Otherwise a request that
    // lands during the torque cut is silently swallowed, which is exactly what
    // happens when you shift as the limiter bogs — the input appears to do
    // nothing at all.
    if (this.shiftTimer > 0) {
      this._pendingShift = dir;
      return;
    }
    if (dir > 0 && this.gear < T.gears.length) {
      this.gear++; this.shiftTimer = T.shiftTime;
    } else if (dir < 0 && this.gear > 1) {
      this.gear--; this.shiftTimer = T.shiftTime * 0.7;
    }
  }

  _step(dt, input) {
    const T = this.tune;
    const track = this.track;

    /* ---------- surface ---------- */
    const sf = track.surface(this.pos.x, this.pos.z, this._surface);
    const grip = sf.grip;
    this.gripLevel = grip;
    this.offRoad = damp(this.offRoad, sf.onRoad ? 0 : 1, 12, dt);

    /* ---------- inputs ---------- */
    const boosting = !!input.boost && this.boost > 0.02;
    this.boosting = boosting;
    this.boost = clamp(this.boost + (boosting ? -T.boostDrain : T.boostRegen) * dt, 0, T.boostMax);

    const fwd = this.forward.clone();
    const right = this.right.clone();
    let vx = this.vel.dot(fwd);
    let vz = this.vel.dot(right);
    const speed = Math.hypot(vx, vz);
    this.speed = speed;

    /* ---------- vertical ---------- */
    const groundY = sf.y;
    if (this.pos.y <= groundY + 0.015 && this.vy <= 0) {
      if (!this.grounded && this.vy < -6) this.landImpact = -this.vy;
      this.pos.y = groundY;
      this.vy = 0;
      this.grounded = true;
      this.airTime = 0;
    } else {
      this.vy -= G * dt;
      this.pos.y += this.vy * dt;
      this.grounded = false;
      this.airTime += dt;
    }

    /* ---------- steering ---------- */
    const C = this.control;
    const maxSteer = lerp(C.lockLow, C.lockHigh,
      smoothstep(C.falloffLow, C.falloffHigh, speed));
    let steerIn = clamp(input.steer || 0, -1, 1);
    // counter-steer assist keeps drifts catchable with a keyboard
    if (this.steerAssist > 0 && Math.abs(vx) > 6) {
      // Counter-steer assist with limited authority: enough to catch a slide,
      // never enough to hold the car sideways.
      // Sign matters: when the tail steps out the car's velocity points to the
      // same side as the slide, and the front wheels must follow it, so the
      // correction is *with* the slip angle, not against it.
      const slip = Math.atan2(vz, Math.abs(vx));
      // Dead zone: a small amount of slip is normal when rolling straight and
      // the assist must not chase it, otherwise the car weaves left-to-right
      // on its own and fights the driver's inputs.
      const corrected = Math.abs(slip) > 0.06 ? slip - Math.sign(slip) * 0.06 : 0;
      const assist = clamp(corrected * 0.9, -0.22, 0.22);
      steerIn = clamp(steerIn + assist * this.steerAssist, -1, 1);
    }
    this.steerTarget = steerIn * maxSteer * (this.setup.steerLock / 100);
    const rate = C.steerRate * (1 + 0.6 / (1 + speed * 0.05));
    this.steer = damp(this.steer, this.steerTarget, rate * 3, dt);

    /* ---------- gearbox ---------- */
    const wheelOmega = Math.abs(vx) / T.wheelRadius;
    const gr = T.gears[this.gear - 1] * T.finalDrive;
    let rpm = (wheelOmega * gr * 60) / (Math.PI * 2);
    rpm = clamp(Math.max(rpm, T.idleRpm), T.idleRpm, T.redline);
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    // Manual: the gearbox is the driver's problem. Rev limiter protection stays
    // on (it is a mechanical stop, not an aid) but nothing shifts by itself.
    if (this.setup.transmission === 'manual') {
      if (this.shiftTimer === 0 && rpm > T.redline * 0.995 && this.gear < T.gears.length) {
        this.shiftTimer = T.shiftTime * 0.5;   // short cut so the limiter does not stall you
      }
    } else if (this.shiftTimer === 0 && !this.boosting) {
      if (rpm > T.shiftUpRpm && this.gear < T.gears.length && vx > 0) {
        this.gear++; this.shiftTimer = T.shiftTime; rpm *= 0.62;
      } else if (rpm < T.shiftDownRpm && this.gear > 1) {
        this.gear--; this.shiftTimer = T.shiftTime * 0.7; rpm *= 1.5;
      }
    }
    this.rpm = damp(this.rpm, rpm, 18, dt);

    /* ---------- longitudinal forces ---------- */
    const throttleIn = this.grounded ? clamp(input.throttle || 0, 0, 1) : 0;
    const brakeIn = clamp(input.brake || 0, 0, 1);
    this.throttle = throttleIn;
    this.brake = brakeIn;
    this.handbrake = this.grounded ? clamp(input.handbrake || 0, 0, 1) : 0;

    const torqueCurve = (r) => {
      const x = clamp((r - 900) / (T.redline - 900), 0, 1);
      return 0.52 + 0.48 * Math.sin(Math.PI * Math.pow(x, 0.82)) + 0.14 * (1 - x);
    };
    // Aero loads first: downforce has to be known *before* the traction and
    // ABS limits below, or the downforce dial cannot influence them.
    // drag/roll/downforce are *magnitudes*: the direction of travel is applied
    // once, below, via Math.sign(vx). Rolling them up with the sign of vx here
    // would cancel out under that multiply and leave drag pushing the car
    // backwards while it reverses.
    const drag = T.dragK * speed * speed * (1 + this.offRoad * 0.9);
    const roll = T.rollingResistance * speed * (1 + this.offRoad * 3.2);
    const downforce = T.downforceK * speed * speed * (this.setup.downforce / 100);

    const W = this.mass * G;
    const L = T.wheelBase;
    const a = L * (1 - T.frontWeight);
    const b = L * T.frontWeight;
    const staticF = W * T.frontWeight, staticR = W * (1 - T.frontWeight);
    const transfer = (this.mass * this.longG * T.cgHeight) / L;
    const FzF = Math.max(400, staticF - transfer + downforce * 0.45);
    const FzR = Math.max(400, staticR + transfer + downforce * 0.55);

    /* ---------- traction limit + TC ---------- */
    // One ceiling on rear drive force, and TC simply moves that ceiling closer
    // to the actual friction limit.
    //
    // Note this model has no wheel rotational inertia, so it cannot simulate
    // true wheelspin — drive force above the grip limit simply accelerates the
    // car. TC therefore cannot "react to slip"; all it can do is refuse to let
    // you use the headroom above the limit. That is exactly what a traction
    // limit does, and the cost is a little acceleration in exchange for
    // predictable traction.
    //
    // The handbrake has to be in the cap: it collapses rear grip, and without
    // this the driver could floor it mid-drift and light the rears up instantly.
    const hb = this.handbrake;
    const rearCap = FzR * T.gripRear * grip * C.gripScale * lerp(1, T.handbrakeGrip, hb);
    const tcAllow = AIDS.traction[this.setup.traction];
    const tcFactor = tcAllow == null ? 1.15 : 1 + tcAllow * 0.15;

    const boostMul = this.boosting ? T.boostPower : 1;
    let driveF = 0;
    if (this.shiftTimer === 0) {
      const trq = T.peakTorque * torqueCurve(this.rpm) * boostMul;
      driveF = throttleIn * (trq * T.gears[this.gear - 1] * T.finalDrive * T.drivetrainEff) / T.wheelRadius;
      driveF = Math.min(driveF, 26000 * boostMul);
    }
    driveF = Math.min(driveF, rearCap * tcFactor);

    let brakeF = 0;
    if (brakeIn > 0.02) {
      if (vx > 0.4) brakeF = brakeIn * T.brakeForce;
      else {
        // Reverse. reverseForce is a flat constant, so without a taper a
        // player holding the brake just accelerates backwards until drag
        // balances it out — hundreds of km/h in the wrong direction. Fade
        // the reverse drive out as the car approaches a sane reversing speed.
        const cap = clamp(1 - (Math.abs(vx) - T.maxReverse * 0.6) / (T.maxReverse * 0.4), 0, 1);
        driveF -= brakeIn * T.reverseForce * cap;
      }
    }
    brakeF += this.handbrake * T.handbrakeForce;

    let totalF = driveF - Math.sign(vx) * (brakeF + roll + drag) * (Math.abs(vx) > 0.05 ? 1 : 0);

    /* ---------- slip angles ---------- */
    const vxa = Math.max(Math.abs(vx), 1.4) * Math.sign(vx || 1);
    const aF = Math.atan2(vz + this.yawRate * a, Math.abs(vxa)) - this.steer * Math.sign(vxa || 1);
    const aR = Math.atan2(vz - this.yawRate * b, Math.abs(vxa));
    this.slipFront = aF;
    this.slipRear = aR;

    const gripF = T.gripFront * grip * C.gripScale;
    const gripR = T.gripRear * grip * C.gripScale * lerp(1, T.handbrakeGrip, hb);

    const DF = gripF * FzF;
    const DR = gripR * FzR;

    const bias = clamp(this.setup.brakeBias, 35, 85) / 100;
    const BF = (T.stiffFront / (T.pacejkaC * DF)) * (1 - 0.35 * hb);
    const BR = (T.stiffRear / (T.pacejkaC * DR)) * (1 - 0.55 * hb);
    let FyF = TIRE(aF, DF, BF, T.pacejkaC, T.pacejkaE);
    let FyR = TIRE(aR, DR, BR, T.pacejkaC, T.pacejkaE);

    /* ---------- friction circle ---------- */
    // Longitudinal demand eats lateral capacity, so a car that is using all its
    // grip to brake has almost none left to turn with.
    //
    // Brake bias splits that demand. Locking the fronts eats front grip and the
    // car understeers into the corner; over-biasing rearward spins it. Both
    // directions fall out of the same cap, which is why bias is worth exposing.
    const rearBrake = brakeF * (1 - bias);
    let frontLongUse = Math.min(1, brakeF * bias / Math.max(DF, 1));

    /* ---------- ABS ---------- */
    // Lock-up is longitudinal: the fronts stop steering because their grip is
    // spent pushing the car. This model has no wheel rotational inertia, so a
    // locked wheel is not simulated as a separate loss of friction — the honest
    // thing ABS can do is hold the front axle just inside its friction limit
    // instead of letting it saturate, which keeps lateral capability for
    // steering.
    //
    // Note it deliberately does *not* trim brakeF. The brake demand here is far
    // larger than the available grip (there is no longitudinal tyre limit in
    // this model), so trimming to the friction limit just weakens the brakes —
    // that attempt tripled the stopping distance. Steering retention is the real
    // benefit and the honest one to claim.
    const absAllow = AIDS.abs[this.setup.abs];
    if (absAllow != null && brakeF > 0) {
      // The brake demand always saturates the fronts in this model, so the cap
      // has to bite below 1.0 to change anything. 'low' lets them sit much
      // nearer saturation (still sliding, some steering) and 'high' holds real
      // headroom in reserve.
      const cap = 1 - absAllow * 0.34;
      if (frontLongUse > cap) frontLongUse = cap;
    }

    const capF = Math.sqrt(Math.max(0, 1 - frontLongUse * frontLongUse * 0.72));
    FyF *= lerp(1, capF, 0.75);

    const rearLongUse = Math.min(1, Math.abs(driveF - rearBrake * 0.5) / Math.max(DR, 1));
    const capR = Math.sqrt(Math.max(0, 1 - rearLongUse * rearLongUse * 0.72));
    FyR *= lerp(1, capR, 0.75);

    if (!this.grounded) { FyF = 0; FyR = 0; }

    /* ---------- integrate ---------- */
    const cs = Math.cos(this.steer), sn = Math.sin(this.steer);
    const Fx = totalF * (this.grounded ? 1 : 0) - FyF * sn;
    const Fz = FyF * cs + FyR;
    const Mz = a * FyF * cs - b * FyR;

    const ax = Fx / this.mass + vz * this.yawRate;
    const az = Fz / this.mass - vx * this.yawRate;
    const Iz = this.mass * T.inertiaFactor;

    vx += ax * dt;
    vz += az * dt;
    this.yawRate += (Mz / Iz) * dt;

    // Stability control: bleed rotation toward the yaw rate the steering is
    // actually asking for. Off, it does nothing at all — which is the point.
    //
    // The gain is per-second, and it has to be well clear of the passive yaw
    // damping below or it is invisible: the base model already resists spin, so
    // a token nudge here changes nothing you can feel while driving.
    const escGain = AIDS.esc[this.setup.esc];
    if (escGain > 0 && this.grounded && speed > 4) {
      const wanted = (vx * Math.tan(this.steer)) / T.wheelBase;
      // Strongest mid-slide, tapering off at high speed where rotation is
      // legitimate and the driver is committed.
      const authority = 1 - 0.5 * clamp((speed - 30) / 25, 0, 1);
      // Cap the correction so it can catch a slide but cannot drive the car:
      // uncapped it overrides legitimate rotation and turns ordinary cornering
      // into something the driver did not ask for.
      const correction = clamp((this.yawRate - wanted) * escGain * 6 * authority, -1.8, 1.8);
      this.yawRate -= correction * dt;
    }

    // Control ceiling: on the forgiving levels the car simply refuses to rotate
    // faster than this, which is what stops a tap of the key from spinning it.
    if (C.yawLimit > 0) this.yawRate = clamp(this.yawRate, -C.yawLimit, C.yawLimit);
    // global speed governor
    if (vx > T.maxSpeed) vx = T.maxSpeed;
    if (vx < -T.maxReverse) vx = -T.maxReverse;
    this.yawRate = damp(this.yawRate, 0, C.yawDamp, dt);   // yaw damping
    this.yaw += this.yawRate * dt;

    this.longG = damp(this.longG, Fx / (this.mass * G), 9, dt);
    this.lateralG = damp(this.lateralG, Fz / (this.mass * G), 9, dt);

    // world velocity
    fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.vel.copy(fwd).multiplyScalar(vx).addScaledVector(right, vz);

    // integrate position
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    /* ---------- trackside barriers ---------- */
    // The push has to follow the *track* normal, not the car's heading: a
    // spun car would otherwise be shoved along the barrier and slowly
    // launched off the circuit.
    const sfx = track.surface(this.pos.x, this.pos.z, this._surface);
    const limit = (track.barrierOffset || track.halfWidth + 12) - 0.6;
    const lat = sfx.lateral;
    if (Math.abs(lat) > limit) {
      const side = lat < 0 ? -1 : 1;
      const over = Math.abs(lat) - limit;
      const nx = sfx.rx * side, nz = sfx.rz * side;   // unit, pointing off-track
      this.pos.x -= nx * over;
      this.pos.z -= nz * over;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn > 0) {
        // Rigid barrier: cancel only the outward velocity (no bounce), so the
        // car is stopped head-on and cannot cross the rail by any means.
        this.vel.x -= nx * vn;
        this.vel.z -= nz * vn;
        this.vel.multiplyScalar(0.92);
        this.yawRate *= 0.5;
        if (vn > 3) this.impact = vn;
      }
    }
  }

  _updateProgress() {
    const p = this.track.project(this.pos.x, this.pos.z, this._proj || (this._proj = {}));
    const L = this.track.length;
    let d = p.s - this.progressS;
    if (d > L * 0.5) d -= L;
    if (d < -L * 0.5) d += L;
    if (!isFinite(d) || Math.abs(d) > 40) d = 0;      // teleport / respawn guard

    this.progressS = p.s;
    // Monotonic distance travelled around the circuit. Deriving the lap from a
    // running total is robust across the start/finish seam, where s wraps from
    // L back to 0 and a naive "just crossed the line" test fires every frame.
    if (this.progress === undefined) this.progress = p.s;
    this.progress += d;
    this.trackOffset = p.lateral;
    this.signedProgress = this.progress;
    if (!this.finished) this.lap = Math.max(0, Math.floor(this.progress / L));
    this.wrongWay = d < -0.02 && this.speed > 6;
  }

  /** Push the simulation state onto the three.js object. */
  sync(alpha = 1) {
    const m = this.mesh;
    if (!m) return;
    m.position.copy(this.pos);
    m.rotation.y = this.yaw;

    const ud = m.userData;
    // body roll / pitch from the g-forces
    const targetRoll = clamp(-this.lateralG * 0.10, -0.14, 0.14);
    const targetPitch = clamp(this.longG * 0.055, -0.09, 0.09);
    ud.body.rotation.z = damp(ud.body.rotation.z, targetRoll, 9, 1 / 60);
    ud.body.rotation.x = damp(ud.body.rotation.x, targetPitch, 9, 1 / 60);
    // squat / dive
    ud.body.position.y = damp(ud.body.position.y, -Math.abs(this.longG) * 0.012, 8, 1 / 60);

    const steerAngle = this.steer;
    const spinSpeed = this.speed / this.tune.wheelRadius;
    this.wheelSpin += spinSpeed * (1 / 60);
    for (const w of ud.wheels) {
      if (w.steer) w.pivot.rotation.y = steerAngle;
      w.spin.rotation.x = this.wheelSpin;
      // suspension travel
      const load = w.side > 0 ? this.lateralG : -this.lateralG;
      const target = clamp(load * 0.022 + (this.longG > 0 ? 0.018 : -0.012) * (w.steer ? 1 : 1.3), -0.05, 0.05);
      w.pivot.position.y = damp(w.pivot.position.y, w.restY - target * 0.6, 10, 1 / 60);
    }
    // brake discs glow
    ud.discMat.emissiveIntensity = damp(
      ud.discMat.emissiveIntensity,
      this.brake > 0.15 ? 1.6 + Math.sin(performance.now() * 0.02) * 0.2 : 0, 10, 1 / 60
    );
    // brake lights
    ud.tailMat.emissiveIntensity = damp(
      ud.tailMat.emissiveIntensity,
      this.brake > 0.05 || this.handbrake > 0.3 ? 4.2 : this.boosting ? 2.2 : 1.1, 14, 1 / 60
    );
    if (ud.blob) {
      ud.blob.position.set(0, 0.03 - this.pos.y, 0);
      ud.blob.material.opacity = this.grounded ? 0.45 : 0.12;
    }
  }
}
