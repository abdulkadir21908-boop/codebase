const AppManager = {
  apps: {},
  windows: [],
  windowOrder: [],
  nextWinId: 1,
  dragState: null,
  resizeState: null,
  _deletedKey: 'aurora_deleted_apps',

  register(id, config) {
    this.apps[id] = config;
  },

  open(id) {
    const app = this.apps[id];
    if (!app) return;
    const existing = this.windows.find(w => w.appId === id && !w.closed);
    if (existing) {
      this.focus(existing.id);
      if (existing.minimized) this.restore(existing.id);
      return;
    }
    try {
      app.create(this);
    } catch (e) {
      console.error('App create error:', e);
      const w = this.createWindow({ appId: id, title: app.name || id, width: 500, height: 300 });
      w.bodyEl.innerHTML = '<div style="padding:20px;color:#f38ba8;font-family:monospace;position:absolute;inset:0;overflow:auto"><h3>Error loading app</h3><pre>' + e.message + '\n' + e.stack + '</pre></div>';
    }
    this.renderDock();
  },

  createWindow(opts) {
    const id = this.nextWinId++;
    const w = {
      id, appId: opts.appId, title: opts.title,
      x: opts.x != null ? opts.x : 100 + (id % 8) * 40,
      y: opts.y != null ? opts.y : 50 + (id % 6) * 30,
      width: opts.width || 560, height: opts.height || 400,
      closed: false, minimized: false, maximized: false,
      created: Date.now(),
      el: null, bodyEl: null, onClose: opts.onClose || null
    };

    const el = document.createElement('div');
    el.className = 'window focused';
    el.id = 'win-' + id;
    el.style.cssText = 'left:' + w.x + 'px;top:' + w.y + 'px;width:' + w.width + 'px;height:' + w.height + 'px;z-index:' + (100 + id);

    const titlebar = document.createElement('div');
    titlebar.className = 'win-titlebar';
    titlebar.setAttribute('data-wid', id);

    const tl = document.createElement('div');
    tl.className = 'traffic-lights';

    const btnClose = document.createElement('button');
    btnClose.className = 'tl-btn tl-close';
    btnClose.innerHTML = '<svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" stroke="#4a0000" stroke-width="1.2" fill="none"/></svg>';
    btnClose.onclick = function() { AppManager.close(id); };

    const btnMin = document.createElement('button');
    btnMin.className = 'tl-btn tl-minimize';
    btnMin.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2.5 6h7" stroke="#995700" stroke-width="1.2" fill="none"/></svg>';
    btnMin.onclick = function() { AppManager.minimize(id); };

    const btnMax = document.createElement('button');
    btnMax.className = 'tl-btn tl-maximize';
    btnMax.innerHTML = '<svg viewBox="0 0 12 12"><path d="M3 3h6v6H3z" stroke="#006500" stroke-width="1.2" fill="none"/></svg>';
    btnMax.onclick = function() { AppManager.maximize(id); };

    tl.appendChild(btnClose);
    tl.appendChild(btnMin);
    tl.appendChild(btnMax);

    const title = document.createElement('div');
    title.className = 'win-title';
    title.textContent = w.title;

    titlebar.appendChild(tl);
    titlebar.appendChild(title);

    const body = document.createElement('div');
    body.className = 'win-body';
    body.id = 'win-body-' + id;

    el.appendChild(titlebar);
    el.appendChild(body);

    titlebar.addEventListener('mousedown', function(e) {
      if (e.target.closest('.tl-btn')) return;
      AppManager.focus(id);
      if (w.maximized) return;
      AppManager.dragState = { id: id, offX: e.clientX - w.x, offY: e.clientY - w.y };
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    el.addEventListener('mousedown', function() { AppManager.focus(id); });
    el.addEventListener('mousedown', function(e) {
      var rect = el.getBoundingClientRect();
      var onR = e.clientX > rect.right - 6;
      var onB = e.clientY > rect.bottom - 6;
      if ((onR || onB) && !w.maximized) {
        AppManager.resizeState = { id: id, startX: e.clientX, startY: e.clientY, startW: w.width, startH: w.height, onRight: onR, onBottom: onB };
        e.preventDefault();
      }
    });

    document.getElementById('windows').appendChild(el);
    w.el = el;
    w.bodyEl = body;
    this.windows.push(w);
    this.windowOrder.push(id);
    el.style.opacity = '0';
    el.classList.add('opening');
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        el.style.opacity = '1';
        el.classList.remove('opening');
        el.style.transform = '';
      });
    });
    this.focus(id);
    this.renderDock();
    return w;
  },

  focus(id) {
    this.windows.forEach(function(w) { w.el.classList.remove('focused'); });
    var w = this.windows.find(function(x) { return x.id === id; });
    if (w) {
      w.el.classList.add('focused');
      var mx = 100;
      this.windowOrder.forEach(function(_, i) { if (100 + i > mx) mx = 100 + i; });
      w.el.style.zIndex = ++mx;
    }
  },

  close(id) {
    var self = this;
    var w = this.windows.find(function(x) { return x.id === id; });
    if (!w) return;
    var el = w.el;
    el.style.transition = 'transform .4s cubic-bezier(.4,0,1,.7), opacity .35s ease, filter .4s ease, border-radius .4s ease';
    el.style.transform = 'scale(.88) translateY(16px)';
    el.style.opacity = '0';
    el.style.filter = 'blur(4px)';
    setTimeout(function() {
      el.style.transition = 'transform .3s cubic-bezier(.4,0,1,.7), opacity .2s ease, filter .3s ease';
      el.style.transform = 'scale(.7) translateY(30px)';
      el.style.opacity = '0';
      el.style.filter = 'blur(8px)';
      setTimeout(function() {
        w.closed = true;
        el.remove();
        if (w.onClose) w.onClose(w);
        self.windows = self.windows.filter(function(x) { return !x.closed; });
        self.renderDock();
      }, 220);
    }, 80);
  },

  minimize(id) {
    var w = this.windows.find(function(x) { return x.id === id; });
    if (w) {
      w.minimized = true;
      w.el.style.transition = 'transform .55s cubic-bezier(.4,0,1,.6), opacity .4s ease, border-radius .4s ease';
      w.el.style.transformOrigin = 'bottom center';
      w.el.style.transform = 'scale(.08) translateY(calc(100vh - 80px))';
      w.el.style.opacity = '0';
      w.el.style.pointerEvents = 'none';
    }
  },

  restore(id) {
    var w = this.windows.find(function(x) { return x.id === id; });
    if (w) {
      w.minimized = false;
      w.el.style.transformOrigin = 'bottom center';
      w.el.style.transition = 'transform .55s cubic-bezier(.16,1,.3,1), opacity .4s ease .05s, border-radius .4s ease';
      w.el.style.transform = 'scale(1) translateY(0)';
      w.el.style.opacity = '1';
      w.el.style.pointerEvents = '';
      this.focus(id);
    }
  },

  maximize(id) {
    var w = this.windows.find(function(x) { return x.id === id; });
    if (!w) return;
    if (w.maximized) {
      w.maximized = false;
      w.el.classList.remove('maximized');
      w.el.style.transition = 'left .45s cubic-bezier(.16,1,.3,1), top .45s cubic-bezier(.16,1,.3,1), width .45s cubic-bezier(.16,1,.3,1), height .45s cubic-bezier(.16,1,.3,1), border-radius .4s ease';
      w.el.style.left = w.x + 'px'; w.el.style.top = w.y + 'px';
      w.el.style.width = w.width + 'px'; w.el.style.height = w.height + 'px';
    } else {
      w.maximized = true;
      w.el.style.transition = 'left .45s cubic-bezier(.16,1,.3,1), top .45s cubic-bezier(.16,1,.3,1), width .45s cubic-bezier(.16,1,.3,1), height .45s cubic-bezier(.16,1,.3,1), border-radius .4s ease';
      w.el.classList.add('maximized');
    }
  },

  getDeleted() {
    try {
      var raw = localStorage.getItem(this._deletedKey);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  },

  _saveDeleted(list) {
    try { localStorage.setItem(this._deletedKey, JSON.stringify(list)); } catch (e) {}
  },

  isDeleted(id) {
    return this.getDeleted().indexOf(id) !== -1;
  },

  deleteApp(id) {
    var app = this.apps[id];
    if (!app) return false;
    var coreApps = ['terminal', 'finder', 'calculator', 'taskmanager', 'settings', 'notes', 'about', 'browser', 'appstore', 'codeeditor', 'mouse'];
    var isCore = coreApps.indexOf(id) !== -1;
    var label = app.name || id;
    var msg = isCore
      ? 'Delete system app "' + label + '"?\n\nAurora OS may stop working properly without it.\nYou can restore it later by right-clicking the dock.'
      : 'Delete "' + label + '"?\n\nIt will be uninstalled and removed from the dock.\nYou can reinstall it from the App Store.';
    if (typeof confirm === 'function' && !confirm(msg)) return false;
    this.windows.filter(function(w) { return w.appId === id && !w.closed; }).forEach(function(w) {
      try {
        w.closed = true;
        if (w.el) w.el.remove();
        if (w.onClose) w.onClose(w);
      } catch (e) {}
    });
    this.windows = this.windows.filter(function(x) { return !x.closed; });
    if (!isCore && typeof AuroraStore !== 'undefined') {
      try { AuroraStore.uninstall(id); } catch (e) {}
      try {
        fetch('/api/store/uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: id }) }).catch(function() {});
        fetch('/api/store/dev-uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: id }) }).catch(function() {});
      } catch (e) {}
    }
    var del = this.getDeleted();
    if (del.indexOf(id) === -1) { del.push(id); this._saveDeleted(del); }
    this.renderDock();
    return true;
  },

  restoreApp(id) {
    var del = this.getDeleted().filter(function(x) { return x !== id; });
    this._saveDeleted(del);
    var coreApps = ['terminal', 'finder', 'calculator', 'taskmanager', 'settings', 'notes', 'about', 'browser', 'appstore', 'codeeditor', 'mouse'];
    if (coreApps.indexOf(id) === -1 && typeof AuroraStore !== 'undefined') {
      try { AuroraStore.install(id); } catch (e) {}
      try {
        fetch('/api/store/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: id }) }).catch(function() {});
      } catch (e) {}
    }
    this.renderDock();
  },

  restoreAllApps() {
    this._saveDeleted([]);
    this.renderDock();
  },

  _hideCtxMenu() {
    var m = document.getElementById('aurora-ctx-menu');
    if (m) m.remove();
  },

  _showCtxMenu(x, y, items) {
    this._hideCtxMenu();
    try {
      if (!document.getElementById('aurora-ctx-style')) {
        var st = document.createElement('style');
        st.id = 'aurora-ctx-style';
        st.textContent = '#aurora-ctx-menu{position:fixed;z-index:999999;min-width:190px;background:rgba(24,24,38,.97);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:5px;box-shadow:0 16px 48px rgba(0,0,0,.55);font-family:var(--font,system-ui,sans-serif)}#aurora-ctx-menu .ctx-item{display:flex;align-items:center;gap:9px;padding:8px 11px;border-radius:8px;font-size:12px;color:#cdd6f4;cursor:pointer}#aurora-ctx-menu .ctx-item:hover{background:rgba(137,180,250,.13)}#aurora-ctx-menu .ctx-item.danger{color:#f38ba8}#aurora-ctx-menu .ctx-item.danger:hover{background:rgba(243,139,168,.14)}#aurora-ctx-menu .ctx-sep{height:1px;background:rgba(255,255,255,.07);margin:4px 8px}#aurora-ctx-menu .ctx-head{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6c7086;padding:6px 11px 3px}';
        document.head.appendChild(st);
      }
    } catch (e) {}
    var menu = document.createElement('div');
    menu.id = 'aurora-ctx-menu';
    items.forEach(function(it) {
      if (it.sep) {
        var s = document.createElement('div');
        s.className = 'ctx-sep';
        menu.appendChild(s);
        return;
      }
      if (it.head) {
        var hh = document.createElement('div');
        hh.className = 'ctx-head';
        hh.textContent = it.head;
        menu.appendChild(hh);
        return;
      }
      var d = document.createElement('div');
      d.className = 'ctx-item' + (it.danger ? ' danger' : '');
      d.textContent = (it.icon ? it.icon + '  ' : '') + it.label;
      d.onclick = function(ev) {
        ev.stopPropagation();
        AppManager._hideCtxMenu();
        if (it.action) it.action();
      };
      menu.appendChild(d);
    });
    document.body.appendChild(menu);
    var mw = menu.offsetWidth || 190;
    var mh = menu.offsetHeight || 80;
    menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
    var hide = function(e) {
      if (!menu.contains(e.target)) AppManager._hideCtxMenu();
    };
    setTimeout(function() {
      document.addEventListener('click', hide, { once: true });
      document.addEventListener('contextmenu', hide, { once: true });
    }, 0);
  },

  renderDock() {
    var dock = document.getElementById('dock');
    if (!dock) return;
    dock.innerHTML = '';
    var self = this;
    var coreApps = ['terminal', 'finder', 'calculator', 'taskmanager', 'settings', 'notes', 'about', 'browser', 'appstore', 'codeeditor', 'mouse'];
    var deleted = this.getDeleted();
    Object.keys(this.apps).forEach(function(id) {
      if (deleted.indexOf(id) !== -1) return;
      if (coreApps.indexOf(id) === -1) {
        if (typeof AuroraStore !== 'undefined' && !AuroraStore.isInstalled(id)) return;
      }
      var app = self.apps[id];
      var running = self.windows.some(function(w) { return w.appId === id && !w.closed; });
      var el = document.createElement('div');
      el.className = 'dock-item' + (running ? ' running' : '');
      el.innerHTML = '<div class="tooltip">' + app.name + '</div><div class="icon" style="background:' + app.color + '">' + app.icon + '</div><div class="dot"></div>';
      el.onclick = function() {
        el.classList.remove('clicked');
        void el.offsetWidth;
        el.classList.add('clicked');
        setTimeout(function(){el.classList.remove('clicked')},500);
        self.open(id);
      };
      el.oncontextmenu = function(e) {
        e.preventDefault();
        e.stopPropagation();
        var isCore = coreApps.indexOf(id) !== -1;
        self._showCtxMenu(e.clientX, e.clientY, [
          { head: app.name },
          { label: 'Open', icon: '\u25B6', action: function() { self.open(id); } },
          { sep: true },
          { label: 'Delete app', icon: '\u1F5D1', danger: true, action: function() { self.deleteApp(id); } }
        ]);
      };
      dock.appendChild(el);
    });
    dock.oncontextmenu = function(e) {
      if (e.target.closest && e.target.closest('.dock-item')) return;
      e.preventDefault();
      var del = self.getDeleted();
      if (!del.length) {
        self._showCtxMenu(e.clientX, e.clientY, [
          { head: 'Dock' },
          { label: 'No deleted apps', icon: '\u2139', action: function() {} }
        ]);
        return;
      }
      var items = [{ head: 'Restore app' }];
      del.forEach(function(id) {
        var nm = (self.apps[id] && self.apps[id].name) || id;
        items.push({ label: nm, icon: '\u21A9', action: function() { self.restoreApp(id); } });
      });
      items.push({ sep: true });
      items.push({ label: 'Restore all', icon: '\u2728', action: function() { self.restoreAllApps(); } });
      self._showCtxMenu(e.clientX, e.clientY, items);
    };
    this._initDockMagnify(dock);
  },

  _initDockMagnify(dock) {
    if (dock._magInit) return;
    dock._magInit = true;
    var maxLift = 6;
    var range = 2.2;

    function magEnabled() {
      try {
        var raw = localStorage.getItem('aurora_settings');
        if (raw) {
          var s = JSON.parse(raw);
          if (s && typeof s.magnification !== 'undefined') return !!s.magnification;
        }
      } catch (e) {}
      if (dock.classList.contains('mag')) return true;
      return true;
    }

    function peakScale() {
      var peak = 62, base = 50;
      try {
        var v = parseFloat(getComputedStyle(dock).getPropertyValue('--dock-mag'));
        if (v > 0) peak = v;
      } catch (e) {}
      var icon = dock.querySelector('.icon');
      if (icon) {
        var w = icon.getBoundingClientRect().width;
        if (w > 0) base = w;
      }
      var s = peak / base;
      if (!(s > 1)) return 1;
      return Math.min(s, 1.28);
    }

    dock.addEventListener('mousemove', function(e) {
      var items = dock.querySelectorAll('.dock-item');
      if (!magEnabled() || !items.length) {
        for (var k = 0; k < items.length; k++) {
          items[k].style.transform = '';
          items[k].querySelector('.icon').style.boxShadow = '';
        }
        return;
      }
      var maxScale = peakScale();
      var mouseX = e.clientX;
      var vertical = dockWrapVertical();

      for (var i = 0; i < items.length; i++) {
        var rect = items[i].getBoundingClientRect();
        var center = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
        var pos = vertical ? e.clientY : mouseX;
        var dist = Math.abs(pos - center);
        var maxDist = range * ((vertical ? rect.height : rect.width) + 2);
        var proximity = Math.max(0, 1 - dist / maxDist);
        var eased = Math.pow(proximity, 1.6);
        var scale = 1 + (maxScale - 1) * eased;
        var lift = maxLift * eased;

        items[i].style.transform = vertical
          ? 'translateX(' + (dockWrapSide() * -lift) + 'px) scale(' + scale + ')'
          : 'translateY(-' + lift + 'px) scale(' + scale + ')';
        items[i].querySelector('.icon').style.boxShadow = proximity > 0.1
          ? '0 ' + (3 + proximity * 5) + 'px ' + (10 + proximity * 10) + 'px rgba(0,0,0,' + (0.3 + proximity * 0.15) + ')'
          : '0 2px 12px rgba(0,0,0,.3)';
      }
    });

    function dockWrapVertical() {
      var wrap = document.getElementById('dock-wrap');
      if (!wrap) return false;
      var p = wrap.getAttribute('data-pos');
      return p === 'left' || p === 'right';
    }

    function dockWrapSide() {
      var wrap = document.getElementById('dock-wrap');
      if (!wrap) return 1;
      return wrap.getAttribute('data-pos') === 'right' ? -1 : 1;
    }

    dock.addEventListener('mouseleave', function() {
      var items = dock.querySelectorAll('.dock-item');
      for (var i = 0; i < items.length; i++) {
        items[i].style.transform = '';
        items[i].querySelector('.icon').style.boxShadow = '';
      }
    });
  },

  getFocused() {
    return this.windows.find(function(w) { return w.el.classList.contains('focused') && !w.closed; });
  },

  init() {
    var self = this;
    document.addEventListener('mousemove', function(e) {
      if (self.dragState) {
        var w = self.windows.find(function(x) { return x.id === self.dragState.id; });
        if (w) {
          w.x = e.clientX - self.dragState.offX;
          w.y = Math.max(28, e.clientY - self.dragState.offY);
          w.el.style.left = w.x + 'px';
          w.el.style.top = w.y + 'px';
        }
        return;
      }
      if (self.resizeState) {
        var w2 = self.windows.find(function(x) { return x.id === self.resizeState.id; });
        if (w2) {
          if (self.resizeState.onRight) w2.width = Math.max(300, self.resizeState.startW + (e.clientX - self.resizeState.startX));
          if (self.resizeState.onBottom) w2.height = Math.max(200, self.resizeState.startH + (e.clientY - self.resizeState.startY));
          if (self.resizeState.onRight) w2.el.style.width = w2.width + 'px';
          if (self.resizeState.onBottom) w2.el.style.height = w2.height + 'px';
        }
        return;
      }
      var t = e.target && e.target.closest ? e.target.closest('.window') : null;
      if (t && !t.classList.contains('maximized')) {
        if (e.target.closest && e.target.closest('.win-titlebar')) {
          t.style.cursor = '';
          return;
        }
        var rect = t.getBoundingClientRect();
        var onR = e.clientX > rect.right - 8;
        var onB = e.clientY > rect.bottom - 8;
        t.style.cursor = onR && onB ? 'nwse-resize' : onR ? 'ew-resize' : onB ? 'ns-resize' : '';
      }
    });
    document.addEventListener('mouseup', function() { self.dragState = null; self.resizeState = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') self._hideCtxMenu(); });
  }
};
