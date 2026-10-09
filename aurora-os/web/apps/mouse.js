AppManager.register('mouse', {
  name: 'Mouse',
  icon: '&#128433;',
  color: 'linear-gradient(135deg,#6c7086,#45475a)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'mouse', title: 'Mouse', width: 470, height: 600 });
    var body = w.bodyEl;

    var stats = loadStats();
    var dpi = stats.dpi || 1600;
    var leftHanded = !!stats.leftHanded;
    var cpsClicks = 0, cpsRunning = false, cpsT0 = 0, cpsTimer = null;
    var peakSpeed = 0, lastMove = null;

    function readShared() {
      var dpi = 1600, leftHanded = false, hasS = false;
      try {
        var s = JSON.parse(localStorage.getItem('aurora_settings') || '{}');
        if (s) {
          if (Number(s.mousedpi) >= 400 && Number(s.mousedpi) <= 3200) { dpi = Number(s.mousedpi); hasS = true; }
          if (s.mousehanded === 'left' || s.mousehanded === 'right') { leftHanded = s.mousehanded === 'left'; hasS = true; }
        }
      } catch (e) {}
      if (!hasS) {
        try {
          var m = JSON.parse(localStorage.getItem('aurora_mouse') || '{}');
          if (m) {
            if (Number(m.dpi) >= 400 && Number(m.dpi) <= 3200) dpi = Number(m.dpi);
            if (typeof m.leftHanded === 'boolean') leftHanded = m.leftHanded;
          }
        } catch (e) {}
      }
      return { dpi: dpi, leftHanded: leftHanded };
    }
    function loadStats() {
      var shared = readShared();
      try {
        var s = JSON.parse(localStorage.getItem('aurora_mouse') || '{}');
        return {
          left: Number(s.left) || 0, right: Number(s.right) || 0, scrolls: Number(s.scrolls) || 0,
          dpi: shared.dpi, leftHanded: shared.leftHanded
        };
      } catch (e) { return { left: 0, right: 0, scrolls: 0, dpi: shared.dpi, leftHanded: shared.leftHanded }; }
    }
    function saveStats() {
      stats.dpi = dpi; stats.leftHanded = leftHanded;
      try { localStorage.setItem('aurora_mouse', JSON.stringify(stats)); } catch (e) {}
      try {
        var s = {};
        try { s = JSON.parse(localStorage.getItem('aurora_settings') || '{}'); } catch (e) { s = {}; }
        s.mousedpi = dpi;
        s.mousehanded = leftHanded ? 'left' : 'right';
        localStorage.setItem('aurora_settings', JSON.stringify(s));
      } catch (e) {}
    }

    function render() {
      var h = '<div class="mo-root">';
      h += '<div class="mo-head"><div class="mo-conn"><span class="mo-led"></span>Aurora Wireless \u00b7 Connected</div>';
      h += '<div class="mo-batt">\u25CF\u25CF\u25CF\u25CB 82%</div></div>';

      h += '<div class="mo-stage">';
      h += '<svg id="mo-svg" viewBox="0 0 220 320" width="200" height="290">';
      h += '<defs><linearGradient id="moBody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a8fa8"/><stop offset=".18" stop-color="#c9cede"/><stop offset=".5" stop-color="#f2f4fa"/><stop offset=".82" stop-color="#c9cede"/><stop offset="1" stop-color="#8a8fa8"/></linearGradient>';
      h += '<linearGradient id="moBtn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d5dae6"/></linearGradient>';
      h += '<linearGradient id="moWheel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a3a4e"/><stop offset=".5" stop-color="#6c7086"/><stop offset="1" stop-color="#3a3a4e"/></linearGradient></defs>';
      h += '<ellipse cx="110" cy="306" rx="72" ry="9" fill="rgba(0,0,0,.45)"/>';
      h += '<path d="M110 8 C55 8 38 70 38 150 C38 240 66 300 110 300 C154 300 182 240 182 150 C182 70 165 8 110 8 Z" fill="url(#moBody)" stroke="#2a2a3c" stroke-width="2"/>';
      h += '<g id="mo-left" class="mo-btn"><path d="M110 8 C55 8 38 70 38 150 L38 150 L108 150 L108 12 Z" fill="url(#moBtn)" stroke="#2a2a3c" stroke-width="2" opacity=".92"/><text x="72" y="110" text-anchor="middle" font-size="13" fill="#45475a" font-weight="700" class="mo-lbl">L</text></g>';
      h += '<g id="mo-right" class="mo-btn"><path d="M110 8 C165 8 182 70 182 150 L182 150 L112 150 L112 12 Z" fill="url(#moBtn)" stroke="#2a2a3c" stroke-width="2" opacity=".92"/><text x="148" y="110" text-anchor="middle" font-size="13" fill="#45475a" font-weight="700" class="mo-lbl">R</text></g>';
      h += '<line x1="110" y1="10" x2="110" y2="150" stroke="#2a2a3c" stroke-width="2"/>';
      h += '<g id="mo-wheel"><rect x="100" y="34" width="20" height="52" rx="10" fill="url(#moWheel)" stroke="#1a1a28" stroke-width="1.5"/><g id="mo-grips" stroke="#a6adc8" stroke-width="1.6"><line x1="104" y1="46" x2="116" y2="46"/><line x1="104" y1="54" x2="116" y2="54"/><line x1="104" y1="62" x2="116" y2="62"/><line x1="104" y1="70" x2="116" y2="70"/></g></g>';
      h += '<circle id="mo-eye" cx="110" cy="272" r="9" fill="#f38ba8" opacity=".9"><animate attributeName="opacity" values=".9;.35;.9" dur="2.4s" repeatCount="indefinite"/></circle>';
      h += '<circle cx="110" cy="272" r="4" fill="#ffdde4"/>';
      h += '</svg>';
      h += '<div class="mo-hint">Click the buttons \u00b7 drag or scroll the wheel</div></div>';

      h += '<div class="mo-stats">';
      h += '<div class="mo-stat"><div class="mo-num" id="mo-n-left">' + stats.left + '</div><div class="mo-cap">Left clicks</div></div>';
      h += '<div class="mo-stat"><div class="mo-num" id="mo-n-right">' + stats.right + '</div><div class="mo-cap">Right clicks</div></div>';
      h += '<div class="mo-stat"><div class="mo-num" id="mo-n-scroll">' + stats.scrolls + '</div><div class="mo-cap">Scrolls</div></div>';
      h += '<div class="mo-stat"><div class="mo-num" id="mo-n-dpi">' + dpi + '</div><div class="mo-cap">DPI</div></div>';
      h += '</div>';

      h += '<div class="mo-row"><span class="mo-lab">DPI</span><input type="range" id="mo-dpi" min="400" max="3200" step="100" value="' + dpi + '"><span class="mo-val" id="mo-dpi-v">' + dpi + '</span></div>';
      h += '<div class="mo-row"><span class="mo-lab">Handedness</span><div class="mo-seg" id="mo-hand"><div class="mo-opt' + (!leftHanded ? ' on' : '') + '" data-v="right">Right-handed</div><div class="mo-opt' + (leftHanded ? ' on' : '') + '" data-v="left">Left-handed</div></div></div>';

      h += '<div class="mo-pads">';
      h += '<div class="mo-pad" id="mo-cps"><div class="mo-pad-t">Click speed test</div><div class="mo-pad-big" id="mo-cps-v">Click here, then go!</div><div class="mo-pad-s" id="mo-cps-s">0.0 CPS</div></div>';
      h += '<div class="mo-pad" id="mo-speed"><div class="mo-pad-t">Tracking speed</div><div class="mo-pad-big" id="mo-speed-v">0 px/s</div><div class="mo-pad-s" id="mo-speed-s">peak 0 px/s \u00b7 move inside</div></div>';
      h += '</div>';
      h += '<div class="mo-menu" id="mo-menu"></div>';
      h += '</div>';

      h += '<style>' +
        '.mo-root{position:absolute;inset:0;overflow-y:auto;background:radial-gradient(600px 300px at 50% -60px,#26263e 0%,#14141f 60%);padding:14px 18px 22px;font-family:var(--font,system-ui,sans-serif)}' +
        '.mo-head{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#8a8fa8;margin-bottom:6px}' +
        '.mo-conn{display:flex;align-items:center;gap:7px}' +
        '.mo-led{width:8px;height:8px;border-radius:50%;background:#a6e3a1;box-shadow:0 0 8px #a6e3a1;animation:moPulse 2s infinite}' +
        '@keyframes moPulse{0%,100%{opacity:1}50%{opacity:.4}}' +
        '.mo-stage{display:flex;flex-direction:column;align-items:center;padding:6px 0 2px}' +
        '.mo-btn{cursor:pointer;transition:transform .06s}' +
        '.mo-btn.down{transform:translateY(2px)}' +
        '.mo-btn.down path{fill:#b9bfd2!important}' +
        '#mo-wheel{cursor:ns-resize}' +
        '.mo-hint{font-size:11px;color:#585b70;margin:8px 0 4px}' +
        '.mo-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}' +
        '.mo-stat{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:10px 4px;text-align:center}' +
        '.mo-num{font-size:19px;font-weight:700;color:#fff}' +
        '.mo-cap{font-size:9px;color:#8a8fa8;text-transform:uppercase;letter-spacing:1px;margin-top:3px}' +
        '.mo-row{display:flex;align-items:center;gap:10px;margin:10px 0}' +
        '.mo-lab{font-size:12px;color:#a6adc8;width:86px;flex-shrink:0}' +
        '.mo-row input[type=range]{flex:1;accent-color:#89b4fa}' +
        '.mo-val{font-size:12px;color:#fff;min-width:52px;text-align:right}' +
        '.mo-seg{display:flex;flex:1;background:rgba(255,255,255,.05);border-radius:10px;padding:3px;gap:3px}' +
        '.mo-opt{flex:1;text-align:center;font-size:11px;padding:6px;border-radius:8px;color:#8a8fa8;cursor:pointer}' +
        '.mo-opt.on{background:rgba(137,180,250,.2);color:#dbe4ff}' +
        '.mo-pads{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}' +
        '.mo-pad{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;cursor:pointer;user-select:none}' +
        '.mo-pad-t{font-size:10px;color:#8a8fa8;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}' +
        '.mo-pad-big{font-size:15px;font-weight:700;color:#fff;min-height:22px}' +
        '.mo-pad-s{font-size:11px;color:#8a8fa8;margin-top:6px}' +
        '.mo-menu{margin-top:10px}' +
        '.mo-toast{background:rgba(137,180,250,.12);border:1px solid rgba(137,180,250,.25);color:#dbe4ff;font-size:12px;padding:9px 14px;border-radius:10px;margin-top:8px}' +
        '</style>';

      body.innerHTML = h;
      bind();
    }

    function bump(which) {
      var key = which === 'scroll' ? 'scrolls' : which;
      stats[key] = (Number(stats[key]) || 0) + 1;
      var el = body.querySelector('#mo-n-' + which);
      if (el) {
        el.textContent = stats[key];
        el.style.transform = 'scale(1.35)';
        setTimeout(function() { el.style.transform = ''; }, 130);
      }
      saveStats();
    }

    function pressVisual(id) {
      var g = body.querySelector('#' + id);
      if (!g) return;
      g.classList.add('down');
      setTimeout(function() { g.classList.remove('down'); }, 120);
    }

    function toast(msg) {
      var m = body.querySelector('#mo-menu');
      if (!m) return;
      m.innerHTML = '<div class="mo-toast">' + msg + '</div>';
      clearTimeout(toast._t);
      toast._t = setTimeout(function() { m.innerHTML = ''; }, 2600);
    }

    function bind() {
      var L = body.querySelector('#mo-left');
      var R = body.querySelector('#mo-right');
      function clickLeft(e) {
        if (e) e.stopPropagation();
        pressVisual('mo-left');
        bump(leftHanded ? 'right' : 'left');
      }
      function clickRight(e) {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        pressVisual('mo-right');
        bump(leftHanded ? 'left' : 'right');
        if (typeof AppManager !== 'undefined') {
          AppManager._showCtxMenu(e ? e.clientX : window.innerWidth / 2, e ? e.clientY : 300, [
            { head: 'Mouse right-click' },
            { label: 'Open Mouse settings', icon: '\u2699', action: function() { AppManager.open('settings'); } },
            { label: 'Swap buttons', icon: '\u21C4', action: function() { leftHanded = !leftHanded; saveStats(); render(); } },
            { sep: true },
            { label: 'Reset counters', icon: '\u21BA', action: function() { stats.left = 0; stats.right = 0; stats.scrolls = 0; delete stats.scroll; saveStats(); render(); } }
          ]);
        } else {
          toast('Right-click works \u2014 buttons can be swapped below.');
        }
      }
      if (L) {
        L.addEventListener('mousedown', clickLeft);
        L.addEventListener('contextmenu', function(e) { e.preventDefault(); });
      }
      if (R) {
        R.addEventListener('mousedown', clickRight);
        R.addEventListener('contextmenu', function(e) { e.preventDefault(); clickRight(e); });
      }

      var wheel = body.querySelector('#mo-wheel');
      var grips = body.querySelector('#mo-grips');
      var wheelY = null;
      function spin(dy) {
        if (grips) grips.setAttribute('transform', 'translate(0,' + (Math.max(-6, Math.min(6, dy))) + ')');
        clearTimeout(spin._t);
        spin._t = setTimeout(function() { if (grips) grips.setAttribute('transform', ''); }, 150);
      }
      if (wheel) {
        wheel.addEventListener('wheel', function(e) {
          e.preventDefault();
          spin(e.deltaY > 0 ? 5 : -5);
          bump('scroll');
        }, { passive: false });
        wheel.addEventListener('mousedown', function(e) { wheelY = e.clientY; });
        document.addEventListener('mousemove', function mv(e) {
          if (wheelY === null || !document.body.contains(body)) {
            if (!document.body.contains(body)) document.removeEventListener('mousemove', mv);
            return;
          }
          var d = e.clientY - wheelY;
          if (Math.abs(d) > 14) {
            spin(d > 0 ? 5 : -5);
            bump('scroll');
            wheelY = e.clientY;
          }
        });
        document.addEventListener('mouseup', function() { wheelY = null; });
      }

      var dpiEl = body.querySelector('#mo-dpi');
      if (dpiEl) dpiEl.oninput = function() {
        dpi = parseInt(dpiEl.value, 10);
        var v = body.querySelector('#mo-dpi-v');
        if (v) v.textContent = dpi;
        var n = body.querySelector('#mo-n-dpi');
        if (n) n.textContent = dpi;
        saveStats();
      };

      body.querySelectorAll('#mo-hand .mo-opt').forEach(function(o) {
        o.onclick = function() {
          leftHanded = o.getAttribute('data-v') === 'left';
          saveStats(); render();
          toast(leftHanded ? 'Left-handed mode \u2014 buttons swapped.' : 'Right-handed mode.');
        };
      });

      var cps = body.querySelector('#mo-cps');
      if (cps) cps.onclick = function() {
        var now = Date.now();
        if (!cpsRunning) {
          cpsRunning = true; cpsClicks = 1; cpsT0 = now;
          body.querySelector('#mo-cps-v').textContent = '1 \u2014 keep clicking!';
          cpsTimer = setInterval(function() {
            var el2 = (Date.now() - cpsT0) / 1000;
            var cpsEl = body.querySelector('#mo-cps-s');
            if (cpsEl) cpsEl.textContent = (cpsClicks / Math.max(el2, 0.1)).toFixed(1) + ' CPS \u00b7 ' + el2.toFixed(1) + 's';
            if (el2 >= 5) {
              clearInterval(cpsTimer);
              cpsRunning = false;
              var v = body.querySelector('#mo-cps-v');
              if (v) v.textContent = cpsClicks + ' clicks in 5s!';
            }
          }, 100);
        } else {
          cpsClicks++;
          var v = body.querySelector('#mo-cps-v');
          if (v) v.textContent = cpsClicks + ' \u2014 keep clicking!';
        }
      };

      var spd = body.querySelector('#mo-speed');
      if (spd) {
        spd.addEventListener('mousemove', function(e) {
          var now = performance.now();
          if (lastMove) {
            var dt = (now - lastMove.t) / 1000;
            if (dt > 0.01) {
              var dx = e.clientX - lastMove.x, dy = e.clientY - lastMove.y;
              var v = Math.round(Math.sqrt(dx * dx + dy * dy) / dt * (dpi / 1600));
              if (v > peakSpeed) {
                peakSpeed = v;
                var s = body.querySelector('#mo-speed-s');
                if (s) s.textContent = 'peak ' + peakSpeed + ' px/s \u00b7 ' + dpi + ' DPI';
              }
              var vv = body.querySelector('#mo-speed-v');
              if (vv) vv.textContent = v + ' px/s';
            }
          }
          lastMove = { x: e.clientX, y: e.clientY, t: now };
        });
        spd.addEventListener('mouseleave', function() { lastMove = null; });
      }
    }

    window.addEventListener('aurora-mouse-sync', function() {
      if (!document.body.contains(body)) return;
      var shared = readShared();
      if (shared.dpi === dpi && shared.leftHanded === leftHanded) return;
      dpi = shared.dpi; leftHanded = shared.leftHanded;
      stats.dpi = dpi; stats.leftHanded = leftHanded;
      render();
    });

    render();
  }
});
