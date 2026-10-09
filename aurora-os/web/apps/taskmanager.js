AppManager.register('taskmanager', {
  name: 'Activity Monitor',
  icon: '&#128200;',
  color: 'linear-gradient(135deg,#a6e3a1,#94e2d5)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'taskmanager', title: 'Activity Monitor', width: 780, height: 540 });
    var body = w.bodyEl;
    var tmInterval = null;

    var selectedTab = 'all', searchTerm = '', selectedKey = null;
    var cpuHistory = [], heapHistory = [];
    for (var i = 0; i < 50; i++) { cpuHistory.push(0); heapHistory.push(0); }
    var aurora = { cpu_percent: 0, mem_rss: 0, mem_percent: 0, threads: 0, uptime: '0m', pid: 0 };

    var SERVICES = [
      { key: 'svc-kernel', name: 'Aurora Kernel', kind: 'System', desc: 'AISA-64 virtual machine' },
      { key: 'svc-windowserver', name: 'WindowServer', kind: 'System', desc: 'Windows, dock & desktop' },
      { key: 'svc-webserver', name: 'Aurora Web Server', kind: 'System', desc: 'Localhost services & APIs' },
      { key: 'svc-fs', name: 'AuroraFS', kind: 'System', desc: 'Virtual filesystem' },
      { key: 'svc-shell', name: 'Aurora Shell', kind: 'System', desc: 'Command interpreter' }
    ];

    function formatBytes(b) {
      b = b || 0;
      if (b < 1024) return b + ' B';
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
      if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
      return (b / 1073741824).toFixed(2) + ' GB';
    }

    function jsHeapMB() {
      try {
        if (window.performance && performance.memory && performance.memory.usedJSHeapSize) {
          return performance.memory.usedJSHeapSize / 1048576;
        }
      } catch (e) {}
      return -1;
    }

    function fmtUptime(ms) {
      var s = Math.max(0, Math.floor(ms / 1000));
      if (s < 60) return s + 's';
      var m = Math.floor(s / 60);
      if (m < 60) return m + 'm';
      var h = Math.floor(m / 60);
      if (h < 24) return h + 'h ' + (m % 60) + 'm';
      return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
    }

    function buildRows() {
      var rows = [];
      SERVICES.forEach(function(s, i) {
        rows.push({
          key: s.key, name: s.name, pid: (aurora.pid || 0) + i + 1,
          kind: 'Service', status: 'Running', desc: s.desc, canQuit: false, uptime: aurora.uptime || '0m'
        });
      });
      var wins = (mgr.windows || []).filter(function(x) { return !x.closed; });
      wins.forEach(function(x) {
        var app = (mgr.apps && mgr.apps[x.appId]) || {};
        var focused = x.el && x.el.classList.contains('focused');
        rows.push({
          key: 'win-' + x.id, name: app.name || x.title || x.appId, pid: 1000 + x.id,
          kind: 'App', status: x.minimized ? 'Minimized' : focused ? 'Focused' : 'Background',
          desc: x.title || '', canQuit: true, winId: x.id,
          uptime: fmtUptime(Date.now() - (x.created || Date.now()))
        });
      });
      return rows;
    }

    function fetchStats() {
      fetch('/api/system/aurora').then(function(r) { return r.json(); }).then(function(d) {
        if (!d.error) {
          aurora = d;
          cpuHistory.push(d.cpu_percent || 0);
          if (cpuHistory.length > 50) cpuHistory.shift();
        }
        var heap = jsHeapMB();
        heapHistory.push(heap >= 0 ? heap : 0);
        if (heapHistory.length > 50) heapHistory.shift();
        renderTM();
      }).catch(function() { renderTM(); });
    }

    function renderMiniGraph(data, color, maxVal, suffix) {
      var max = maxVal || 100;
      var w2 = 100, h2 = 32;
      var step = w2 / (data.length - 1);
      var points = '';
      data.forEach(function(v, i) {
        var x = i * step;
        var y = h2 - (Math.min(v, max) / max) * h2;
        points += x.toFixed(1) + ',' + y.toFixed(1) + ' ';
      });
      var fillPoints = '0,' + h2 + ' ' + points + w2 + ',' + h2;
      var last = data[data.length - 1] || 0;
      return '<svg viewBox="0 0 ' + w2 + ' ' + h2 + '" style="width:100%;height:' + h2 + 'px;display:block">' +
        '<polygon points="' + fillPoints + '" fill="' + color + '" opacity=".15"/>' +
        '<polyline points="' + points.trim() + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round"/>' +
        '<circle cx="' + w2 + '" cy="' + (h2 - (Math.min(last, max) / max) * h2) + '" r="2.5" fill="' + color + '"/>' +
        '</svg>';
    }

    function renderTM() {
      var rows = buildRows();
      var apps = rows.filter(function(r) { return r.kind === 'App'; }).length;
      var heap = jsHeapMB();
      var filtered = rows.filter(function(p) {
        if (searchTerm) {
          var q = searchTerm.toLowerCase();
          if ((p.name || '').toLowerCase().indexOf(q) === -1 && String(p.pid).indexOf(q) === -1) return false;
        }
        if (selectedTab === 'apps' && p.kind !== 'App') return false;
        if (selectedTab === 'services' && p.kind !== 'Service') return false;
        return true;
      });

      var cpu = aurora.cpu_percent || 0;
      var cpuColor = cpu > 80 ? 'var(--red)' : cpu > 50 ? 'var(--yellow)' : 'var(--green)';

      var h = '<div class="tm-body"><div class="tm-toolbar">';
      h += '<div class="tm-tabs">';
      h += '<button class="tm-tab' + (selectedTab === 'all' ? ' active' : '') + '" data-tab="all">All</button>';
      h += '<button class="tm-tab' + (selectedTab === 'apps' ? ' active' : '') + '" data-tab="apps">Apps</button>';
      h += '<button class="tm-tab' + (selectedTab === 'services' ? ' active' : '') + '" data-tab="services">Services</button>';
      h += '</div>';
      h += '<input class="tm-search" placeholder="Search Aurora processes..." value="' + (searchTerm || '').replace(/"/g, '&quot;') + '">';
      h += '</div>';

      h += '<div class="tm-scope">Showing Aurora OS only \u2014 its apps, windows and server. Host computer processes are never listed.</div>';

      h += '<div class="tm-summary">';

      h += '<div class="tm-stat">';
      h += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px"><span class="stat-label">Aurora Server CPU</span><span class="stat-value" style="color:' + cpuColor + '">' + cpu.toFixed(1) + '%</span></div>';
      h += renderMiniGraph(cpuHistory, cpuColor, 100);
      h += '<div class="stat-bar" style="margin-top:6px"><div class="stat-bar-fill" style="width:' + Math.min(cpu, 100) + '%;background:' + cpuColor + '"></div></div>';
      h += '<div style="font-size:10px;color:var(--text3);margin-top:3px">PID ' + (aurora.pid || '?') + ' \u00b7 ' + (aurora.threads || 0) + ' threads</div>';
      h += '</div>';

      h += '<div class="tm-stat">';
      h += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px"><span class="stat-label">Aurora Server Memory</span><span class="stat-value" style="color:var(--accent)">' + formatBytes(aurora.mem_rss) + '</span></div>';
      h += '<div class="stat-bar"><div class="stat-bar-fill" style="width:' + Math.min(aurora.mem_percent || 0, 100) + '%;background:var(--accent)"></div></div>';
      h += '<div style="font-size:10px;color:var(--text3);margin-top:3px">' + (aurora.mem_percent || 0).toFixed(1) + '% of host RAM \u00b7 in Aurora only</div>';
      h += '</div>';

      h += '<div class="tm-stat">';
      h += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px"><span class="stat-label">Desktop (this page)</span><span class="stat-value">' + (heap >= 0 ? heap.toFixed(1) + ' MB' : 'n/a') + '</span></div>';
      h += renderMiniGraph(heapHistory, 'var(--purple)', Math.max(64, heap * 1.4 || 64));
      h += '<div style="font-size:10px;color:var(--text3);margin-top:3px">' + apps + ' app window(s) open \u00b7 Uptime: ' + (aurora.uptime || '0m') + '</div>';
      h += '</div>';

      h += '</div>';

      h += '<div class="tm-table"><div class="tm-table-header">';
      h += '<span class="col-name">Aurora Process</span><span class="col-pid">PID</span><span class="col-cpu">Kind</span><span class="col-mem">Uptime</span><span class="col-status">Status</span>';
      h += '</div>';

      filtered.forEach(function(p) {
        var sel = selectedKey === p.key ? ' selected' : '';
        var statusClass = p.status === 'Running' || p.status === 'Focused' ? 'running' : p.status === 'Background' || p.status === 'Minimized' ? 'sleeping' : 'stopped';
        h += '<div class="tm-row' + sel + '" data-key="' + p.key + '">';
        h += '<span class="col-name" title="' + (p.desc || '').replace(/"/g, '&quot;') + '">' + (p.name || 'Unknown') + '</span>';
        h += '<span class="col-pid">' + p.pid + '</span>';
        h += '<span class="col-cpu">' + p.kind + '</span>';
        h += '<span class="col-mem">' + p.uptime + '</span>';
        h += '<span class="col-status"><span class="tm-status-badge ' + statusClass + '">' + p.status + '</span></span>';
        h += '</div>';
      });
      if (!filtered.length) {
        h += '<div style="padding:22px;text-align:center;color:var(--text3);font-size:12px">No Aurora processes match.</div>';
      }
      h += '</div>';

      var selRow = null;
      filtered.forEach(function(p) { if (p.key === selectedKey) selRow = p; });
      h += '<div class="tm-footer"><span>' + filtered.length + ' Aurora process(es) \u00b7 Uptime: ' + (aurora.uptime || '0m') + '</span>';
      h += '<span style="display:flex;gap:8px;align-items:center"><span style="color:var(--text3)">Last updated: ' + new Date().toLocaleTimeString() + '</span>';
      if (selRow && selRow.canQuit) {
        h += '<button class="settings-btn" id="tm-quit" style="font-size:11px;padding:4px 14px;color:var(--red);border-color:rgba(243,139,168,.25)">Quit ' + (selRow.name || '').replace(/</g, '&lt;') + '</button>';
      }
      h += '</span></div>';
      h += '</div>';

      body.innerHTML = h;

      body.querySelectorAll('.tm-tab').forEach(function(el) { el.onclick = function() { selectedTab = el.getAttribute('data-tab'); renderTM(); }; });
      body.querySelectorAll('.tm-row').forEach(function(el) { el.onclick = function() { selectedKey = el.getAttribute('data-key'); renderTM(); }; });
      var searchEl = body.querySelector('.tm-search');
      if (searchEl) {
        searchEl.oninput = function(e) { searchTerm = e.target.value; renderTM(); };
        if (searchTerm) { searchEl.focus(); searchEl.setSelectionRange(searchTerm.length, searchTerm.length); }
      }
      var quitBtn = body.querySelector('#tm-quit');
      if (quitBtn && selRow) {
        quitBtn.onclick = function() {
          if (selRow.winId) mgr.close(selRow.winId);
          selectedKey = null;
          setTimeout(fetchStats, 400);
        };
      }
    }

    fetchStats();
    if (tmInterval) clearInterval(tmInterval);
    tmInterval = setInterval(fetchStats, 2000);
    w.onClose = function() { clearInterval(tmInterval); tmInterval = null; };
  }
});
