/* =========================================================
   Teams.

   Foundation for every multiplayer mode: team racing needs
   team identity and aggregate scoring, split-screen needs
   per-player team assignment, and online play needs teams
   to survive the round trip to the server.

   A team's result is the best (lowest) finishing position of
   any of its cars — the classic endurance-racing rule — so
   two cars finishing 1st and 4th beat a team with 2nd and 3rd.
   ========================================================= */

/** Liveries are per-team so both cars share a colour identity. */
export const TEAMS = [
  {
    id: 'ember', name: 'EMBER', color: '#f23c1e',
    paints: [
      { paint: 0xf23c1e, accent: 0x111318, stripe: 0xffffff },
      { paint: 0xff8c1a, accent: 0x2a1405, stripe: 0x1a1c22 },
    ],
  },
  {
    id: 'cobalt', name: 'COBALT', color: '#1f6df2',
    paints: [
      { paint: 0x1f6df2, accent: 0x0b1220, stripe: 0xf2f6ff },
      { paint: 0x2b8fff, accent: 0x0a1626, stripe: 0xf2f6ff },
    ],
  },
  {
    id: 'solar', name: 'SOLAR', color: '#f5c518',
    paints: [
      { paint: 0xf5c518, accent: 0x1a1508, stripe: 0x1a1508 },
      { paint: 0xffe14d, accent: 0x241d06, stripe: 0x241d06 },
    ],
  },
  {
    id: 'jade', name: 'JADE', color: '#18c48a',
    paints: [
      { paint: 0x18c48a, accent: 0x08201a, stripe: 0xffffff },
      { paint: 0x7ec850, accent: 0x101a0a, stripe: 0x101a0a },
    ],
  },
  {
    id: 'violet', name: 'VIOLET', color: '#a855f7',
    paints: [
      { paint: 0xa855f7, accent: 0x150a20, stripe: 0xffe9ff },
      { paint: 0xff4d6d, accent: 0x2a0a12, stripe: 0xffffff },
    ],
  },
  {
    id: 'ghost', name: 'GHOST', color: '#e8e9ee',
    paints: [
      { paint: 0xe8e9ee, accent: 0x1a1c22, stripe: 0xff3b30 },
      { paint: 0x2b2f3a, accent: 0x00e5ff, stripe: 0x00e5ff },
    ],
  },
];

/**
 * Split a field of `count` cars across `teamsPerRace` teams.
 *
 * Alternating rather than blocked, so the grid is visually mixed and a
 * teammate is never parked directly alongside you on the line.
 *
 * @returns {number[]} team index per car, indexed by car position.
 */
export function assignTeams(count, teamsPerRace) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = i % teamsPerRace;
  return out;
}

/** How many distinct teams a field of `count` cars can support. */
export function maxTeams(count) {
  return Math.max(1, Math.min(TEAMS.length, Math.floor(count / 2)));
}

/**
 * Roll up per-car results into a team result.
 *
 * A team's score is its best-placed car (the endurance-racing rule), so 1st+4th
 * beats 2nd+3rd.
 *
 * Finished cars are ranked on finishing time; cars still running are ranked on
 * distance covered, exactly like the car standings, so the team order moves
 * through the race instead of sitting frozen behind a placeholder score.
 *
 * @param {Array} cars   vehicle-like objects with
 *                       { team, position, finished, finishTime, signedProgress }
 * @param {number} teamCount
 */
export function teamStandings(cars, teamCount) {
  const rows = [];
  for (let t = 0; t < teamCount; t++) {
    rows.push({ team: t, cars: 0, best: Infinity, total: 0, finished: 0, running: false });
  }
  for (const c of cars) {
    const t = c.team;
    if (t == null || t < 0 || t >= rows.length) continue;
    const row = rows[t];
    row.cars++;

    // Lower score is better. Finished cars sort on time; running cars get a
    // score derived from distance that is always worse than any finish, so a
    // classified car always outranks one still running.
    let score;
    if (c.finished) {
      row.finished++;
      score = c.finishTime != null ? c.finishTime : (c.position || 99);
    } else {
      row.running = true;
      const dist = c.signedProgress != null ? c.signedProgress : 0;
      score = 1e9 - dist;
    }
    row.total += score;
    if (score < row.best) row.best = score;
  }

  rows.sort((a, b) => (a.best !== b.best ? a.best - b.best : a.total - b.total));
  rows.forEach((r, i) => { r.position = i + 1; });
  return rows;
}

/** Grid slots ordered so teammates start nose-to-tail down the road. */
export function teamGridOrder(n, teamOf, slots) {
  // slots: array of { s, lateral }. Lead the field by team so a team starts
  // front-to-back rather than side by side.
  const order = [];
  const used = new Set();
  for (let i = 0; i < n; i++) {
    if (used.has(i)) continue;
    const team = teamOf[i];
    order.push(i);
    used.add(i);
    for (let j = i + 1; j < n; j++) {
      if (!used.has(j) && teamOf[j] === team) { order.push(j); used.add(j); }
    }
  }
  return order.map((i) => slots[i]).filter(Boolean);
}
