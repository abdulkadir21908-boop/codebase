/* =========================================================
   Input — keyboard + gamepad, with an analog-feeling steer ramp
   ========================================================= */
import { clamp, damp } from '../util/math.js';

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'handbrake',
  ShiftLeft: 'boost', ShiftRight: 'boost',
};

const ACTIONS = {
  KeyC: 'camera', KeyR: 'respawn', KeyP: 'pause', Escape: 'pause',
  KeyM: 'mute', KeyF: 'photo', Enter: 'confirm', NumpadEnter: 'confirm',
};

// Manual gearbox. Separate from KEYMAP because these are edge-triggered
// actions, not held axes — one press must be exactly one shift, and the sim
// runs several physics substeps per frame.
const SHIFTS = {
  KeyE: 1, ShiftRight: 1, Numpad8: 1,      // up
  KeyQ: -1, ControlLeft: -1, Numpad2: -1,  // down
};

export class Input {
  constructor() {
    this.keys = Object.create(null);
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: false };
    this.steer = 0;
    this.actions = Object.create(null);
    this.gamepadIndex = null;
    this.usingGamepad = false;
    this._anyKey = false;
    this.shift = 0;
    this._prevPadShift = 0;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = KEYMAP[e.code];
      if (k) { this.keys[k] = true; this.usingGamepad = false; e.preventDefault(); }
      const sh = SHIFTS[e.code];
      if (sh) { this.shift = sh; e.preventDefault(); }
      const a = ACTIONS[e.code];
      if (a) { this.actions[a] = true; this._anyKey = true; e.preventDefault(); }
    }, { passive: false });

    addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k) { this.keys[k] = false; e.preventDefault(); }
    }, { passive: false });

    addEventListener('blur', () => {
      for (const k in this.keys) this.keys[k] = false;
      this.shift = 0;
      this._prevPadShift = 0;
    });

    addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; this.usingGamepad = false; });
  }

  /** Consume an action flag. */
  took(name) {
    if (this.actions[name]) { this.actions[name] = false; return true; }
    return false;
  }

  get anyInput() { return this._anyKey; }

  update(dt) {
    const s = this.state;
    const pad = this._pad();

    if (pad) {
      const ax = pad.axes[0] || 0;
      const dead = 0.12;
      const mag = Math.abs(ax) < dead ? 0 : (Math.abs(ax) - dead) / (1 - dead);
      const steerTarget = Math.sign(ax) * mag * mag * 0.85 + Math.sign(ax) * mag * 0.15;
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      s.throttle = Math.max(this.keys.up ? 1 : 0, rt);
      s.brake = Math.max(this.keys.down ? 1 : 0, lt);
      s.steer = clamp(this.keys.left || this.keys.right ? (this.keys.left ? 1 : -1) : steerTarget, -1, 1);
      s.handbrake = Math.max(this.keys.handbrake ? 1 : 0, pad.buttons[0] && pad.buttons[0].pressed ? 1 : 0);
      s.boost = (this.keys.boost || (pad.buttons[1] && pad.buttons[1].pressed) ||
        (pad.buttons[5] && pad.buttons[5].value > 0.4));
      this.usingGamepad = true;
      this.steer = s.steer;
      // Bumpers shift up/down. Latched against the previous frame so holding
      // the button only shifts once.
      const up = !!(pad.buttons[5] && pad.buttons[5].pressed);
      const down = !!(pad.buttons[4] && pad.buttons[4].pressed);
      const padShift = up ? 1 : down ? -1 : 0;
      if (padShift && padShift !== this._prevPadShift) this.shift = padShift;
      this._prevPadShift = padShift;
    } else {
      const left = this.keys.left ? 1 : 0;
      const right = this.keys.right ? 1 : 0;
      // Sign flipped: previously left/right were inverted relative to the car
      const target = left - right;
      // ramp in, snap back — feels like a stick without one
      const rate = target === 0 ? 6.5 : 3.2 + 2.4 * (1 - Math.abs(this.steer));
      this.steer = damp(this.steer, target, rate, dt);
      if (Math.abs(this.steer) < 0.002) this.steer = 0;
      s.throttle = this.keys.up ? 1 : 0;
      s.brake = this.keys.down ? 1 : 0;
      s.steer = this.steer;
      s.handbrake = this.keys.handbrake ? 1 : 0;
      s.boost = !!this.keys.boost;
    }
    return s;
  }

  /**
   * Consume the pending gear change. Returns +1, -1 or 0, and clears the
   * latch so a single press cannot shift twice.
   */
  takeShift() {
    const s = this.shift;
    this.shift = 0;
    return s;
  }

  _pad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.gamepadIndex != null && pads[this.gamepadIndex]) return pads[this.gamepadIndex];
    for (const p of pads) {
      if (p && p.connected) { this.gamepadIndex = p.index; return p; }
    }
    return null;
  }

  /** Any gamepad button press — used to let players start with a controller. */
  padPressed() {
    const pad = this._pad();
    if (!pad) return false;
    return pad.buttons.some((b) => b.pressed);
  }
}
