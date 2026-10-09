/* =========================================================
   AI drivers — pure-pursuit steering on the pre-computed
   racing line + a speed controller using the track's physics
   speed profile, with overtaking, mistakes and a light hand of
   rubber banding.
   ========================================================= */
import * as THREE from 'three';
import { clamp, lerp, smoothstep, makeRng, angleDelta } from '../util/math.js';

export class AIDriver {
  constructor(vehicle, track, opts = {}) {
    this.v = vehicle;
    this.track = track;
    this.skill = opts.skill ?? 0.9;              // 0.6 … 1.05
    this.aggression = opts.aggression ?? 0.5;
    this.rng = makeRng(opts.seed ?? 1234);
    this.lineBias = (this.rng() - 0.5) * 1.7;       // personal line preference
    this.target = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.errorPhase = this.rng() * 100;
    this.mistake = 0;
    this.mistakeTimer = 6 + this.rng() * 20;
    this.recoverTimer = 0;
    this.stuckTimer = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: false };
    this.boostFuel = 0;
  }

  update(dt, cars) {
    const v = this.v;
    const t = this.track;
    const inp = this.input;

    /* --- occasional mistakes keep the field interesting --- */
    this.mistakeTimer -= dt;
    if (this.mistakeTimer <= 0) {
      this.mistakeTimer = 9 + this.rng() * 26;
      this.mistake = this.rng() < 0.55 ? (this.rng() - 0.5) * 2.2 : 0;
    }
    if (this.mistake !== 0) {
      this.mistake *= Math.pow(0.5, dt);
      if (Math.abs(this.mistake) < 0.02) this.mistake = 0;
    }

    /* --- where do we want to be? --- */
    const speed = Math.max(v.speed, 1);
    const look = clamp(9 + speed * 0.5, 12, 46);
    let sTarget = v.progressS + look;
    sTarget = t.wrapS(sTarget);

    // line offset with personal bias + avoidance
    const iNear = Math.floor((sTarget / t.length) * t.N) % t.N;
    let offset = t.lineOffset[iNear] + this.lineBias + this.mistake;

    let closing = 0;                                  // 0..1, how much we must lift
    let ahead = null, aheadDs = Infinity;
    for (const other of cars) {
      if (other === v) continue;
      const ds = t.wrapS(other.progressS - v.progressS);
      const forward = ds < t.length * 0.5;
      if (!forward || ds > 30) continue;
      const lat = other.trackOffset - v.trackOffset;
      if (Math.abs(lat) < 3.6) {
        if (ds < aheadDs) { aheadDs = ds; ahead = other; }
        const gaining = other.speed - v.speed;
        if (gaining > -1) {
          const closingRate = clamp((gaining + 6) / 26, 0, 1);
          const proximity = clamp(1 - ds / 30, 0, 1);
          closing = Math.max(closing, closingRate * proximity);
          // move to whichever side has more room
          const room = t.halfWidth - Math.abs(lat) * 0.5;
          offset += (lat > 0 ? -1 : 1) * clamp(room * 0.5, 0.7, 2.4);
          if (ds < 8 && Math.abs(lat) < 2.2) closing = Math.max(closing, 0.8);
        }
      }
    }
    closing = clamp(closing, 0, 1);
    // keep the aim point on the road, and bias it back to the middle once we
    // have drifted - otherwise a small error compounds into a trip
    const cross = v.trackOffset || 0;
    const recover = clamp((Math.abs(cross) - 1.8) / 3.6, 0, 1);
    offset *= 1 - recover * 0.85;
    offset = clamp(offset, -t.halfWidth * 0.72, t.halfWidth * 0.72);
    t.pointAt(sTarget, offset, this.target);

    /* --- steering: path feed-forward + Stanley feedback --- */
    const dx = this.target.x - v.pos.x;
    const dz = this.target.z - v.pos.z;
    const fwd = v.forward;
    const right = v.right;
    const localX = dx * fwd.x + dz * fwd.z;
    const localZ = dx * right.x + dz * right.z;
    const dist = Math.hypot(localX, localZ) || 1;
    const L = v.tune.wheelBase;
    const kappa = t.curv[iNear];

    // 1. geometric feed-forward: Ackermann for the path curvature plus an
    //    understeer allowance that grows with speed
    let delta = L * kappa * 1.05 + 0.0016 * speed * speed * kappa;

    // 2. heading feedback: swing the car back onto the direction of the path
    const headingErr = angleDelta(v.yaw, trackHeadingRef(t, v));
    delta += clamp(headingErr, -0.9, 0.9) * 0.85;

    // 3. cross-track feedback toward the aim point
    const crossErr = (v.trackOffset || 0) - offset;
    delta -= Math.atan((1.9 * crossErr) / Math.max(speed, 9));

    // 4. a little pure pursuit to catch the aim point when far off line
    if (dist > 12) {
      const alpha = Math.atan2(localZ, Math.max(localX, 0.5));
      delta += clamp(Math.atan2(2 * L * Math.sin(alpha), Math.max(dist, 4)), -0.5, 0.5) * 0.35;
    }

    const maxSteer = lerp(v.tune.maxSteerLow, v.tune.maxSteerHigh,
      smoothstep(v.tune.steerSpeedLow, v.tune.steerSpeedHigh, speed));
    inp.steer = clamp(delta / (maxSteer * 0.92), -1, 1);
    this.steerAngle = delta;

    /* --- speed control --- */
    // target speed = slowest point inside the braking window
    const brakeDist = clamp((speed * speed) / 30, 10, 200);
    let targetSpeed = 999;
    for (let d = 0; d < brakeDist; d += Math.max(6, brakeDist / 12)) {
      const si = Math.floor((t.wrapS(v.progressS + d) / t.length) * t.N) % t.N;
      const vLim = t.lineSpeed[si];
      // speed we could have now and still slow to vLim in distance d
      const allowed = Math.sqrt(Math.max(0, vLim * vLim + 2 * 15.0 * d));
      targetSpeed = Math.min(targetSpeed, allowed);
    }
    if (Number.isFinite(targetSpeed)) targetSpeed = Math.min(targetSpeed, t.lineSpeed[iNear] * 1.06);
    else targetSpeed = 60;

    targetSpeed *= 0.82 + this.skill * 0.2;
    targetSpeed *= 1 - closing * 0.3;
    // hold a gap to whoever is directly in front instead of queueing up
    // Only hold back if we are genuinely closing on the car in front —
    // otherwise a queue of cars would throttle each other off the line.
    if (ahead && aheadDs < 13 && speed > 12 && ahead.speed < speed - 1) {
      const gap = clamp((aheadDs - 5.5) / 7.5, 0, 1);
      targetSpeed = Math.min(targetSpeed, ahead.speed * (0.88 + 0.12 * gap) + 3);
    }
    if (!isFinite(targetSpeed) || targetSpeed < 4) targetSpeed = 12;
    if (v.offRoad > 0.4) targetSpeed = Math.min(targetSpeed, 18);
    // running out of road: scrub speed until we are back inside it
    const crossAbs = Math.abs(cross);
    if (crossAbs > t.halfWidth * 0.7) {
      targetSpeed *= lerp(1, 0.7, clamp((crossAbs - t.halfWidth * 0.7) / (t.halfWidth * 0.5), 0, 1));
    }

    this.lastTarget = targetSpeed;
    this.lastLimit = t.lineSpeed[iNear];
    const err = targetSpeed - speed;
    if (err > 0.6) {
      inp.throttle = clamp(err * 0.32, 0, 1);
      inp.brake = 0;
    } else if (err < -1.2) {
      inp.throttle = 0;
      inp.brake = clamp(-err * 0.22, 0, 1);
    } else {
      inp.throttle = clamp(0.45 + err * 0.3, 0, 1);
      inp.brake = 0;
    }

    /* --- recovery: spun around, off track, or wedged --- */
    const trackHeading = trackHeadingRef(t, v);
    const spinErr = angleDelta(v.yaw, trackHeading);         // + = track is to our right
    const offTrack = Math.abs(v.trackOffset || 0) > t.halfWidth + 2.5;

    // sideways: the rear is out and the car is no longer tracking forward
    const spin = Math.abs(v.slipRear) > 0.42 || Math.abs(v.yawRate) > 1.1;
    if (spin) {
      inp.throttle = 0;
      inp.brake = speed > 12 ? 0.45 : 0;
      // opposite lock: the front wheels chase the direction of travel
      inp.steer = clamp(v.slipRear * 1.7, -0.65, 0.65);
    }

    if (!spin && Math.abs(spinErr) > 1.5 && speed < 12) {
      // spun: unwind the wheels toward the direction of travel and creep
      inp.steer = clamp(spinErr * 1.5, -1, 1);
      inp.throttle = speed < 4 ? 0.4 : 0;
      inp.brake = speed > 7 ? 0.5 : 0;
    } else if (offTrack) {
      // aim harder for the tarmac
      inp.steer = clamp(inp.steer * 1.35 + spinErr * 0.5, -1, 1);
    }

    if (!spin && (Math.abs(spinErr) > 1.5 || offTrack)) {
      inp.throttle = Math.min(inp.throttle, speed < 6 ? 0.45 : 0.2);
    }
    if (speed < 0.9) this.stuckTimer += dt; else this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    if (this.stuckTimer > 1.4) {
      inp.throttle = 0;
      inp.brake = 1;                     // reverse out
      inp.steer = clamp(-inp.steer, -1, 1);
      if (this.stuckTimer > 3.2) this.stuckTimer = 0;
    }

    /* --- nitro on the straights --- */
    const straightness = 1 - clamp(Math.abs(t.curv[iNear]) * 90, 0, 1);
    this.boostFuel = clamp(this.boostFuel + (straightness > 0.92 && speed > 22 ? 0.6 : -0.55) * dt, 0, 1);
    inp.boost = this.boostFuel > 0.98 && straightness > 0.9 && Math.abs(err) < 6;

    /* --- handbrake never for AI, but they do use the kerbs --- */
    inp.handbrake = 0;

    v.update(dt, inp);
  }

  /** Gentle catch-up so the pack stays together. */
  applyRubberBand(dt, distanceToPlayer) {
    this.lineBias = lerp(this.lineBias, 0, dt * 0.6);
    this._rb = distanceToPlayer;
  }
}

/** Heading of the racing line at the car's current position (cached per frame). */
const _headingCache = { s: -1, heading: 0 };
function trackHeadingRef(track, v) {
  if (_headingCache.v !== v || Math.abs(_headingCache.s - v.progressS) > 0.5) {
    _headingCache.v = v;
    _headingCache.s = v.progressS;
    _headingCache.heading = track.project(v.pos.x, v.pos.z, track._aiProj || (track._aiProj = {})).heading;
  }
  return _headingCache.heading;
}
