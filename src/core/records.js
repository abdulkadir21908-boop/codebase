/* =========================================================
   Lap and race records.

   Kept separate from the settings blob so a corrupt or
   oversized records file can never stop the game booting.
   ========================================================= */
import { formatTime } from '../util/math.js';

const KEY = 'apex-velocity.records.v1';
const LAP_HISTORY = 8;          // recent laps kept per track

function blank() {
  return { v: 1, tracks: {}, totals: { races: 0, wins: 0, podiums: 0 } };
}

/** Defensive parse: anything unexpected yields a clean slate. */
export function loadRecords() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || typeof d.tracks !== 'object' || !d.tracks) return blank();
    const out = blank();
    out.totals = Object.assign(out.totals, d.totals || {});
    for (const [id, t] of Object.entries(d.tracks)) {
      if (!t || typeof t !== 'object') continue;
      out.tracks[id] = {
        best: Number(t.best) || 0,            // ms
        last: Number(t.last) || 0,
        laps: Array.isArray(t.laps) ? t.laps.filter(n => Number.isFinite(n) && n > 0).slice(0, LAP_HISTORY) : [],
        races: Number(t.races) || 0,
        wins: Number(t.wins) || 0,
        podiums: Number(t.podiums) || 0,
      };
    }
    return out;
  } catch (e) {
    return blank();
  }
}

export function saveRecords(rec) {
  try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) { /* quota/private mode */ }
}

export function trackRecords(rec, trackId) {
  if (!rec.tracks[trackId]) {
    rec.tracks[trackId] = { best: 0, last: 0, laps: [], races: 0, wins: 0, podiums: 0 };
  }
  return rec.tracks[trackId];
}

/**
 * Record one completed lap.
 * @returns {{record: boolean}} true when it beat the track's best lap.
 */
export function recordLap(rec, trackId, ms) {
  const t = trackRecords(rec, trackId);
  if (!Number.isFinite(ms) || ms <= 0) return { record: false };
  const isRecord = !t.best || ms < t.best;
  if (isRecord) t.best = ms;
  t.last = ms;
  t.laps.unshift(ms);
  if (t.laps.length > LAP_HISTORY) t.laps.length = LAP_HISTORY;
  return { record: isRecord };
}

/** Record the outcome of a whole race. `position` is 1-based. */
export function recordRace(rec, trackId, position) {
  const t = trackRecords(rec, trackId);
  t.races++;
  rec.totals.races++;
  if (position === 1) { t.wins++; rec.totals.wins++; }
  if (position <= 3) { t.podiums++; rec.totals.podiums++; }
}

/** Human-readable summary for the menu. */
export function describeRecords(rec, trackId) {
  const t = rec.tracks[trackId];
  if (!t || (!t.best && !t.races)) return 'No laps recorded on this circuit yet.';
  const bits = [];
  if (t.best) bits.push(`Best lap <b>${formatTime(t.best)}</b>`);
  if (t.races) {
    bits.push(`${t.races} race${t.races === 1 ? '' : 's'}`);
    if (t.wins) bits.push(`${t.wins} win${t.wins === 1 ? '' : 's'}`);
    if (t.podiums - t.wins > 0) bits.push(`${t.podiums - t.wins} podium${t.podiums - t.wins === 1 ? '' : 's'}`);
  }
  return bits.join(' · ');
}

export function clearRecords() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  return blank();
}
