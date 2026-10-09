/* =========================================================
   HUD — canvas speedometer, minimap, leaderboard, timing
   ========================================================= */
import { clamp, lerp, formatTime, ordinal } from '../util/math.js';

const MAX_KMH = 200;
const TAU = Math.PI * 2;
/** Dial face is drawn in km/h; mph just rescales what the needle is fed. */
const MPH = 0.621371192;

export class HUD {
  constructor(track) {
    this.el = {
      root: document.getElementById('hud'),
      posNum: document.getElementById('posNum'),
      posSuffix: document.getElementById('posSuffix'),
      posTotal: document.getElementById('posTotal'),
      lapNum: document.getElementById('lapNum'),
      lapTotal: document.getElementById('lapTotal'),
      timeRace: document.getElementById('timeRace'),
      timeCur: document.getElementById('timeCur'),
      timeBest: document.getElementById('timeBest'),
      lapFlash: document.getElementById('lapFlash'),
      board: document.getElementById('board'),
      spd: document.getElementById('spdVal'),
      gear: document.getElementById('gearVal'),
      boostFill: document.getElementById('boostFill'),
      boostBar: document.querySelector('.boostbar'),
      countdown: document.getElementById('countdown'),
      bigMsg: document.getElementById('bigMsg'),
      trackName: document.getElementById('trackName'),
      fps: document.getElementById('fps'),
      fpsDetail: document.getElementById('fpsDetail'),
    };
    this.speedo = document.getElementById('speedo');
    this.sctx = this.speedo.getContext('2d');
    this.map = document.getElementById('minimap');
    this.mctx = this.map.getContext('2d');

    this.track = track;
    this._unit = 1;
    this._unitLabel = 'KM/H';
    this._buildMapPath();
    this._boardRows = [];
    this._needle = 0;
    this._rpmShown = 0;
    this._msgTimer = 0;
    this._fpsAcc = 0;
    this._fpsN = 0;
  }

  _buildMapPath() {
    const t = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.N; i++) {
      minX = Math.min(minX, t.px[i]); maxX = Math.max(maxX, t.px[i]);
      minZ = Math.min(minZ, t.pz[i]); maxZ = Math.max(maxZ, t.pz[i]);
    }
    const pad = 26;
    const w = this.map.width, h = this.map.height;
    const sx = (w - pad * 2) / (maxX - minX);
    const sz = (h - pad * 2) / (maxZ - minZ);
    const s = Math.min(sx, sz);
    const ox = pad + ((w - pad * 2) - (maxX - minX) * s) / 2;
    const oz = pad + ((h - pad * 2) - (maxZ - minZ) * s) / 2;
    this._map = { s, ox, oz, minX, minZ, w, h };
  }

  _toMap(x, z) {
    const m = this._map;
    return [m.ox + (x - m.minX) * m.s, m.oz + (z - m.minZ) * m.s];
  }

  /** Switch the readout between km/h and mph. */
  setUnits(scale, label) {
    this._unit = scale;
    this._unitLabel = label;
    const el = document.getElementById('spdUnit');
    if (el) el.textContent = label;
    this._needle = 0;
  }

  /* ---------------------------------------------------------------- */
  update(dt, s) {
    this._needle = lerp(this._needle, s.kmh * this._unit, 1 - Math.pow(0.001, dt));
    this._rpmShown = lerp(this._rpmShown, s.rpm, 1 - Math.pow(0.0005, dt));
    this.drawSpeedo(s);
    this.drawMap(s);
    this.updateDom(s);
  }

  updateDom(s) {
    const e = this.el;
    e.posNum.firstChild.nodeValue = String(s.position);
    e.posSuffix.textContent = ordinal(s.position);
    e.posTotal.textContent = String(s.total);
    e.lapNum.textContent = String(clamp(s.lap, 1, s.totalLaps));
    e.lapTotal.textContent = String(s.totalLaps);
    e.timeRace.textContent = formatTime(s.raceTime);
    e.timeCur.textContent = formatTime(s.currentLap);
    e.timeBest.textContent = s.bestLap ? formatTime(s.bestLap) : '--:--.---';
    e.spd.textContent = String(Math.round(s.kmh * this._unit));
    e.gear.textContent = s.gear <= 0 ? 'R' : String(s.gear);
    const gt = document.getElementById('gearType');
    if (gt) gt.textContent = s.manual ? 'M' : 'A';
    e.boostFill.style.width = (s.boost * 100).toFixed(1) + '%';
    e.boostBar.classList.toggle('full', s.boost > 0.98);
    e.trackName.textContent = this.track.name;

    // leaderboard
    if (this._boardRows.length !== s.standings.length) {
      e.board.innerHTML = '';
      this._boardRows = s.standings.map(() => {
        const li = document.createElement('li');
        li.innerHTML = '<span class="bp"></span><span class="bswatch"></span><span class="bn"></span><span class="bgap"></span>';
        e.board.appendChild(li);
        return {
          li, bp: li.querySelector('.bp'), sw: li.querySelector('.bswatch'),
          bn: li.querySelector('.bn'), gap: li.querySelector('.bgap'),
        };
      });
    }
    for (let i = 0; i < s.standings.length; i++) {
      const r = this._boardRows[i];
      const st = s.standings[i];
      r.bp.textContent = String(i + 1);
      r.sw.style.background = st.color;
      r.bn.textContent = st.name;
      r.gap.textContent = st.gap;
      r.li.classList.toggle('me', !!st.isPlayer);
    }
  }

  /* ---------------------------------------------------------------- */
  drawSpeedo(s) {
    const ctx = this.sctx;
    const W = this.speedo.width, H = this.speedo.height;
    const cx = W / 2, cy = H / 2, R = W * 0.455;
    const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
    const ang = (v) => A0 + (clamp(v, 0, MAX_KMH) / MAX_KMH) * (A1 - A0);

    ctx.clearRect(0, 0, W, H);

    // dial plate
    const plate = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.1, cx, cy, R);
    plate.addColorStop(0, 'rgba(18,24,40,0.82)');
    plate.addColorStop(0.7, 'rgba(8,11,20,0.86)');
    plate.addColorStop(1, 'rgba(4,6,12,0.92)');
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.99, 0, TAU);
    ctx.fillStyle = plate;
    ctx.fill();

    ctx.lineCap = 'butt';
    // track groove
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.83, A0, A1);
    ctx.lineWidth = R * 0.13;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.stroke();

    // redline
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.83, ang(255), ang(MAX_KMH));
    ctx.lineWidth = R * 0.13;
    ctx.strokeStyle = 'rgba(255,60,60,0.30)';
    ctx.stroke();

    // value arc
    const a = ang(this._needle);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#38e1ff');
    grad.addColorStop(0.45, '#ffd36b');
    grad.addColorStop(1, '#ff5a2c');
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.83, A0, Math.max(a, A0 + 0.001));
    ctx.lineWidth = R * 0.13;
    ctx.strokeStyle = grad;
    ctx.shadowColor = 'rgba(255,120,50,0.65)';
    ctx.shadowBlur = R * 0.12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // rpm ring
    const rA0 = A0, rA1 = A1;
    const rpmF = clamp(this._rpmShown / s.redline, 0, 1.02);
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.66, rA0, rA0 + (rA1 - rA0) * rpmF);
    ctx.lineWidth = R * 0.045;
    const over = rpmF > 0.94;
    ctx.strokeStyle = over ? (Math.sin(performance.now() * 0.03) > 0 ? '#ff3b30' : '#ff8a3c') : 'rgba(120,220,255,0.85)';
    ctx.stroke();

    // ticks
    ctx.save();
    for (let v = 0; v <= MAX_KMH; v += 20) {
      const t = ang(v) - A0;
      const major = v % 60 === 0;
      const r0 = R * (major ? 0.70 : 0.745);
      const r1 = R * 0.795;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(A0 + t) * r0, cy + Math.sin(A0 + t) * r0);
      ctx.lineTo(cx + Math.cos(A0 + t) * r1, cy + Math.sin(A0 + t) * r1);
      ctx.lineWidth = major ? 3 : 1.6;
      ctx.strokeStyle = v >= 150 ? 'rgba(255,90,90,0.9)' : 'rgba(215,226,255,0.62)';
      ctx.stroke();
      if (major) {
        const rr = R * 0.60;
        ctx.font = `600 ${R * 0.085}px ui-monospace, Consolas, monospace`;
        ctx.fillStyle = v >= 150 ? 'rgba(255,120,120,0.85)' : 'rgba(190,205,240,0.75)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), cx + Math.cos(A0 + t) * rr, cy + Math.sin(A0 + t) * rr);
      }
    }
    ctx.restore();

    // needle
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(-R * 0.09, -R * 0.028);
    ctx.lineTo(R * 0.80, -R * 0.010);
    ctx.lineTo(R * 0.80, R * 0.010);
    ctx.lineTo(-R * 0.09, R * 0.028);
    ctx.closePath();
    ctx.fillStyle = '#ff6b2c';
    ctx.shadowColor = 'rgba(255,90,40,0.9)';
    ctx.shadowBlur = R * 0.09;
    ctx.fill();
    ctx.restore();

    // hub
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.075, 0, TAU);
    ctx.fillStyle = '#12161f';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();

    // outer bezel
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.99, 0, TAU);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.stroke();
  }

  /* ---------------------------------------------------------------- */
  drawMap(s) {
    const ctx = this.mctx;
    const t = this.track;
    ctx.clearRect(0, 0, this.map.width, this.map.height);

    // road — smooth through the sample points instead of a jagged polyline
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= t.N; i += 2) {
      const [x, y] = this._toMap(t.px[i], t.pz[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = 13;
    ctx.strokeStyle = 'rgba(6,8,16,0.9)';
    ctx.stroke();
    ctx.lineWidth = 9.5;
    ctx.strokeStyle = 'rgba(40,52,80,0.9)';
    ctx.stroke();
    ctx.lineWidth = 6.5;
    ctx.strokeStyle = 'rgba(150,168,210,0.85)';
    ctx.stroke();

    // start line
    const [sx, sy] = this._toMap(t.px[0], t.pz[0]);
    ctx.beginPath();
    ctx.moveTo(sx + t.rx[0] * 7, sy + t.rz[0] * 7);
    ctx.lineTo(sx - t.rx[0] * 7, sy - t.rz[0] * 7);
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // cars
    for (const c of s.cars) {
      const [x, y] = this._toMap(c.pos.x, c.pos.z);
      if (c.isPlayer) continue;
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, TAU);
      ctx.fillStyle = c.cssColor;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.stroke();
    }

    // player — directional arrow that points where the car is heading
    const [px, py] = this._toMap(s.player.pos.x, s.player.pos.z);
    const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.18;
    ctx.beginPath();
    ctx.arc(px, py, 9.5 * pulse, 0, TAU);
    ctx.fillStyle = 'rgba(255,107,44,0.20)';
    ctx.fill();

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - s.player.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3.4);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fillStyle = '#ff6b2c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
    // bright heading tick from the car
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.sin(s.player.yaw) * 15, py + Math.cos(s.player.yaw) * 15);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  /* ---------------------------------------------------------------- */
  countdown(text, isGo = false) {
    const el = this.el.countdown;
    el.textContent = text;
    el.classList.remove('hidden', 'go');
    void el.offsetWidth;
    if (isGo) el.classList.add('go');
  }

  hideCountdown() {
    this.el.countdown.classList.add('hidden');
  }

  bigMessage(html, ms = 1800) {
    const el = this.el.bigMsg;
    el.innerHTML = html;
    el.classList.remove('hidden');
    void el.offsetWidth;
    this._msgTimer = ms / 1000;
  }

  tick(dt) {
    if (this._msgTimer > 0) {
      this._msgTimer -= dt;
      if (this._msgTimer <= 0) this.el.bigMsg.classList.add('hidden');
    }
    this._fpsAcc += dt;
    this._fpsN++;
    if (this._fpsAcc > 0.5) {
      this.el.fps.textContent = Math.round(this._fpsN / this._fpsAcc) + ' FPS';
      this._fpsAcc = 0;
      this._fpsN = 0;
      if (this._detail) this.el.fpsDetail.textContent = this._detail;
    }
  }

  flashLap() {
    const f = this.el.lapFlash;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  setVisible(v) {
    this.el.root.classList.toggle('hidden', !v);
  }
}
