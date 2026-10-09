/* =========================================================
   Garage: wallet, owned cars, and the car catalogue.

   Cars are not reskins. Every entry carries real tuning
   overrides that merge over TUNING in vehicle.js, so a car
   genuinely drives differently -- mass, power, grip, aero
   and steering lock all come from the same numbers the
   physics reads. The stat block shown in the garage is
   derived from that tuning rather than typed in by hand, so
   it cannot drift away from what the car actually does.

   Kept in its own storage key, separate from settings and
   records, so a corrupt file can never stop the game
   booting or silently cost the player their cars.
   ========================================================= */
import { TUNING } from '../car/vehicle.js';

const KEY = 'apex-velocity.garage.v1';

/* ---------------- catalogue ---------------- */

/**
 * tuning keys: any subset of TUNING. Unlisted keys inherit the base car.
 * Prices are tuned so a clean win buys roughly one car per few races --
 * deliberately slow, so the currency means something.
 */
export const CARS = [
  {
    id: 'vesper', name: 'VESPER GT', price: 0,
    paint: 0xf23c1e, accent: 0x0f1015, stripe: 0xffffff, number: 1,
    blurb: 'The works car. Forgiving, balanced, quick everywhere.',
    tuning: {},
  },
  {
    id: 'atlas', name: 'ATLAS SV', price: 900,
    paint: 0x2b2f3a, accent: 0x00e5ff, stripe: 0x00e5ff, number: 7,
    blurb: 'Heavy, planted, calm. Punishes you gently; rewards patience.',
    tuning: {
      mass: 1520, peakTorque: 700, frontWeight: 0.56,
      downforceK: 2.6, dragK: 0.34, maxSpeed: 47,
      gripFront: 2.10, gripRear: 2.08, stiffRear: 132000,
      brakeForce: 34000, inertiaFactor: 0.46,
    },
  },
  {
    id: 'phantom', name: 'PHANTOM X', price: 1600,
    paint: 0xa855f7, accent: 0x150a20, stripe: 0xffe9ff, number: 12,
    blurb: 'Enormous mechanical grip. Slow to rotate, impossible to spin.',
    tuning: {
      mass: 1290, peakTorque: 640, downforceK: 3.1, dragK: 0.38,
      gripFront: 2.45, gripRear: 2.50, pacejkaC: 1.68,
      stiffFront: 122000, stiffRear: 136000, maxSpeed: 46,
      brakeForce: 36000,
    },
  },
  {
    id: 'inferno', name: 'INFERNO RS', price: 2600,
    paint: 0xff4d6d, accent: 0x2a0a12, stripe: 0xffffff, number: 24,
    blurb: 'Enormous power, nervous traction. Fastest thing here, by a margin.',
    tuning: {
      mass: 1180, peakTorque: 830, redline: 8400, shiftUpRpm: 7900,
      gears: [3.45, 2.28, 1.70, 1.33, 1.08, 0.90],
      maxSpeed: 58, dragK: 0.26, downforceK: 2.2,
      gripFront: 2.15, gripRear: 1.88, boostPower: 1.7,
    },
  },
  {
    id: 'ronin', name: 'RONIN DR', price: 3800,
    paint: 0x7ec850, accent: 0x101a0a, stripe: 0x101a0a, number: 33,
    blurb: 'Enormous steering lock and a loose rear. Made for opposite lock.',
    tuning: {
      mass: 1150, peakTorque: 700, maxSteerLow: 0.72, maxSteerHigh: 0.22,
      steerSpeedLow: 6, steerSpeedHigh: 78, steerRate: 4.6,
      gripFront: 2.20, gripRear: 1.78, stiffRear: 116000,
      downforceK: 1.5, maxSpeed: 49, brakeForce: 31000,
    },
  },
  {
    id: 'comet', name: 'COMET EVO', price: 5200,
    paint: 0x18c48a, accent: 0x08201a, stripe: 0xffffff, number: 48,
    blurb: 'Featherweight, razor-gripped, overgeared. The best car in the game.',
    tuning: {
      mass: 1020, peakTorque: 780, frontWeight: 0.50,
      gripFront: 2.52, gripRear: 2.44, pacejkaC: 1.70,
      downforceK: 2.9, dragK: 0.27, maxSpeed: 54,
      gears: [3.30, 2.14, 1.60, 1.26, 1.03, 0.86], finalDrive: 3.50,
      maxSteerLow: 0.52, steerRate: 4.2, brakeForce: 33000,
    },
  },
];

export const CAR_BY_ID = Object.create(null);
for (const c of CARS) CAR_BY_ID[c.id] = c;

/* ---------------- persistence ---------------- */

function blank() {
  return { v: 1, coins: 0, owned: [CARS[0].id], selected: CARS[0].id, totalEarned: 0 };
}

/** Defensive parse: anything unexpected yields a clean slate with the starter car. */
export function loadGarage() {
  let out = blank();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return out;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1) return out;
    if (Number.isFinite(d.coins) && d.coins >= 0) out.coins = Math.floor(d.coins);
    if (Number.isFinite(d.totalEarned) && d.totalEarned >= 0) out.totalEarned = Math.floor(d.totalEarned);

    // Unknown car ids are dropped rather than trusted -- an old save from a
    // build with different cars must not put the player in an undriveable one.
    const owned = Array.isArray(d.owned) ? d.owned.filter((id) => CAR_BY_ID[id]) : [];
    out.owned = Array.from(new Set([CARS[0].id, ...owned]));
    out.selected = out.owned.includes(d.selected) ? d.selected : CARS[0].id;
  } catch (e) {
    return blank();
  }
  return out;
}

export function saveGarage(g) {
  try { localStorage.setItem(KEY, JSON.stringify(g)); } catch (e) { /* quota/private mode */ }
}

export function ownsCar(g, id) { return !!CAR_BY_ID[id] && g.owned.includes(id); }

export function selectedCar(g) { return CAR_BY_ID[g.selected] || CARS[0]; }

/**
 * Buy a car.
 * @returns {{ok:boolean, reason?:string}}
 */
export function buyCar(g, id) {
  const car = CAR_BY_ID[id];
  if (!car) return { ok: false, reason: 'unknown' };
  if (ownsCar(g, id)) return { ok: false, reason: 'owned' };
  if (g.coins < car.price) return { ok: false, reason: 'funds' };
  g.coins -= car.price;
  g.owned.push(id);
  g.selected = id;
  return { ok: true };
}

/** @returns {{ok:boolean, reason?:string}} */
export function selectCar(g, id) {
  if (!ownsCar(g, id)) return { ok: false, reason: 'locked' };
  g.selected = id;
  return { ok: true };
}

/* ---------------- economy ---------------- */

/**
 * Coins for a finished race.
 *
 * Position dominates, then laps banked, then a bonus for a new track record
 * so the fast line is worth chasing even in a midfield race.
 */
export function racePayout({ position = 1, field = 6, laps = 1, isRecord = false }) {
  const byPos = [120, 85, 65, 45, 35, 28, 22, 18];
  const posBonus = byPos[Math.max(0, Math.min(byPos.length - 1, position - 1))];
  const fieldBonus = Math.max(0, (field - 4)) * 4;   // bigger fields pay a little more
  const lapBonus = laps * 15;
  const recordBonus = isRecord ? 40 : 0;
  const total = 20 + posBonus + fieldBonus + lapBonus + recordBonus;
  return { total, posBonus, fieldBonus, lapBonus, recordBonus };
}

export function awardRace(g, payout) {
  g.coins += payout;
  g.totalEarned += payout;
  return g.coins;
}

/* ---------------- presentation ---------------- */

/** Derived from the tuning the physics actually uses, so it cannot go stale. */
export function carStats(car) {
  const t = Object.assign({}, TUNING, car.tuning || {});
  const pw = (t.peakTorque / t.mass) * 1000;       // power-to-weight
  const grip = (t.gripFront + t.gripRear) / 2;
  return {
    power: Math.round(t.peakTorque),
    mass: Math.round(t.mass),
    grip: +grip.toFixed(2),
    topSpeed: Math.round(t.maxSpeed * 3.6),
    // Bars are mapped onto the actual spread across the catalogue so the cars
    // rank against each other. Mapping raw ratios instead saturated every car
    // at 5 (power) or 1 (agility) and told the player nothing.
    bars: {
      speed: bars5(map(t.maxSpeed, 44, 58)),
      power: bars5(map(pw, 450, 770)),
      grip: bars5(map(grip, 1.95, 2.52)),
      // Agility: lighter is better, more lock is better.
      agility: bars5(map((1520 - t.mass) / 500 * 0.6 + (t.maxSteerLow - 0.45) / 0.3 * 0.4, 0, 1)),
    },
  };
}

/** normalise v from [lo,hi] to 0..1 */
function map(v, lo, hi) { return (v - lo) / (hi - lo); }
/** 0..1 -> 1..5 pips */
function bars5(t) { return Math.max(1, Math.min(5, Math.round(1 + t * 4))); }

export function formatCoins(n) { return Math.floor(n).toLocaleString(); }