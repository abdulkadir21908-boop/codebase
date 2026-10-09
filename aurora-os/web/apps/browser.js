AppManager.register('browser', {
  name: 'Browser',
  icon: '&#127760;',
  color: 'linear-gradient(135deg,#89b4fa,#74c7ec)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'browser', title: 'Aurora Browser', width: 980, height: 640 });
    var body = w.bodyEl;
    var DEF_BM = [
      { name: 'Google', url: 'https://www.google.com' },
      { name: 'Wikipedia', url: 'https://en.wikipedia.org' },
      { name: 'GitHub', url: 'https://github.com' },
      { name: 'YouTube', url: 'https://www.youtube.com' },
      { name: 'Stack Overflow', url: 'https://stackoverflow.com' },
      { name: 'MDN', url: 'https://developer.mozilla.org' }
    ];
    var TRACKERS = ['google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'googleadservices.com', 'facebook.net/tr', 'connect.facebook.net', 'hotjar.com', 'segment.io', 'mixpanel.com', 'criteo.com', 'taboola.com', 'outbrain.com', 'scorecardresearch.com', 'quantserve.com', 'ads.yahoo.com', 'amazon-adsystem.com', 'analytics.tiktok.com', 'linkedin.com/insight', 'ct.pinterest.com', 'sc-static.net'];
    var bm = load('aurora_browser_bookmarks', DEF_BM);
    var gh = load('aurora_browser_history', []);
    var rl = load('aurora_reading_list', []);
    var dl = load('aurora_downloads', []);
    var tabs = [], active = null, nextId = 1, closed = [], frames = {}, forder = [], privTotal = 0, clockT = null;
    var sideOpen = true;
    try { sideOpen = localStorage.getItem('aurora_browser_sidebar_open') !== '0'; } catch (e) {}
    var ENG = 'Web engine';
    try {
      if (navigator.userAgentData && navigator.userAgentData.brands) {
        var _bl = navigator.userAgentData.brands.map(function(b) { return b.brand; }).filter(function(x) { return x.indexOf('Not') !== 0; });
        ENG = _bl.length ? _bl.join(' ') : 'Chromium';
      }
    } catch (e) {}

    function load(k, fb) {
      try { var v = JSON.parse(localStorage.getItem(k)); return v || JSON.parse(JSON.stringify(fb)); }
      catch (e) { return JSON.parse(JSON.stringify(fb)); }
    }
    function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function esc(s) {
      if (s === null || s === undefined) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function dom(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } }
    function fav(url, s) {
      s = s || 14;
      var d = dom(url);
      return '<img class="br-fav" width="' + s + '" height="' + s + '" loading="lazy" src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(d) + '&sz=32" onerror="this.style.display=\'none\'">';
    }
    function cur() { for (var i = 0; i < tabs.length; i++) if (tabs[i].id === active) return tabs[i]; return null; }
    function pushGH(url, title) {
      if (!url || url.indexOf('http') !== 0) return;
      gh = gh.filter(function(h) { return h.url !== url; });
      gh.unshift({ url: url, title: title || dom(url), time: Date.now() });
      if (gh.length > 100) gh.length = 100;
      save('aurora_browser_history', gh);
    }
    function fkey(t, url) { return t.id + '|' + (t.mode || 'proxied') + '|' + (t.lite ? 'lite|' : '') + url; }
    function fget(t, url) { return frames[fkey(t, url)]; }
    function fput(t, url, f) {
      var k = fkey(t, url);
      frames[k] = f;
      forder = forder.filter(function(x) { return x !== k; });
      forder.push(k);
      var ck = cur() && cur().url ? fkey(cur(), cur().url) : null;
      while (forder.length > 3) {
        var old = null;
        for (var i = 0; i < forder.length; i++) if (forder[i] !== ck) { old = forder[i]; break; }
        if (!old) break;
        forder = forder.filter(function(x) { return x !== old; });
        var of = frames[old];
        delete frames[old];
        if (of && of.parentNode) of.parentNode.removeChild(of);
      }
    }
    function fdrop(id) {
      Object.keys(frames).forEach(function(k) { if (k.indexOf(id + '|') === 0) delete frames[k]; });
      forder = forder.filter(function(k) { return k.indexOf(id + '|') !== 0; });
    }
    function mkTab(url, seed) {
      var t = { id: nextId++, url: '', title: 'New Tab', history: [{ type: 'home', time: Date.now() }], hi: 0, loading: false, zoom: 100, mode: 'proxied', lite: false };
      if (seed) {
        if (seed.history && seed.history.length) { t.history = seed.history; t.hi = seed.historyIdx || 0; }
        if (seed.mode) t.mode = seed.mode;
        if (typeof seed.lite !== 'undefined') t.lite = !!seed.lite;
      }
      tabs.push(t); active = t.id; renderAll();
      if (url) go(url);
      return t;
    }
    function closeTab(id, ev) {
      if (ev) ev.stopPropagation();
      for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) {
        var rm = tabs.splice(i, 1)[0];
        if (rm._pct) clearInterval(rm._pct);
        if (rm._err) clearTimeout(rm._err);
        closed.push({ url: rm.url, title: rm.title, history: rm.history, historyIdx: rm.hi, mode: rm.mode, lite: rm.lite });
        if (closed.length > 5) closed.shift();
        fdrop(rm.id);
        if (active === id) active = tabs.length ? tabs[Math.min(i, tabs.length - 1)].id : null;
        break;
      }
      if (!active) mkTab(); else renderAll();
    }
    function restoreClosed() {
      var l = closed.pop();
      if (!l) { toast('Nothing to reopen'); return; }
      mkTab(null, l);
      var t = cur(), e = t.history[t.hi];
      if (e && e.type === 'url') { t.url = e.url; t.title = e.title || dom(e.url); page(e.url); }
      else if (e && e.type === 'search') search(e.query);
      renderTabs(); urlBar();
    }
    function switchTab(id) { if (id === active) return; active = id; closePop(); renderAll(); }
    function norm(v) {
      v = (v || '').trim();
      if (!v) return null;
      if (/^https?:\/\//i.test(v)) return { k: 'url', url: v };
      if (v.indexOf(' ') === -1 && /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}(\/.*)?$/.test(v)) return { k: 'url', url: 'https://' + v };
      if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.test(v)) return { k: 'url', url: 'http://' + v };
      return { k: 'search', q: v };
    }
    function go(raw) {
      var t = cur();
      if (!t || !raw) return;
      var n = norm(raw);
      if (!n) return;
      closePop();
      t.history = t.history.slice(0, t.hi + 1);
      if (n.k === 'search') {
        t.url = ''; t.title = 'Search: ' + n.q;
        t.history.push({ type: 'search', query: n.q, time: Date.now() }); t.hi = t.history.length - 1;
        renderTabs(); urlBar(); navBtns(); star(); search(n.q);
        return;
      }
      t.history.push({ type: 'url', url: n.url, title: dom(n.url), time: Date.now() }); t.hi = t.history.length - 1;
      t.url = n.url; t.title = dom(n.url);
      pushGH(n.url, t.title);
      renderTabs(); urlBar(); navBtns(); star(); page(n.url);
    }
    function jump(i) {
      var t = cur();
      if (!t || i < 0 || i >= t.history.length) return;
      t.hi = i;
      var e = t.history[i];
      closePop();
      if (e.type === 'url') { t.url = e.url; t.title = e.title || dom(e.url); page(e.url); }
      else if (e.type === 'search') { t.url = ''; t.title = 'Search: ' + e.query; search(e.query); }
      else { t.url = ''; t.title = 'New Tab'; home(); }
      renderTabs(); urlBar(); navBtns(); star();
    }
    function back() { var t = cur(); if (t && t.hi > 0) jump(t.hi - 1); }
    function fwd() { var t = cur(); if (t && t.hi < t.history.length - 1) jump(t.hi + 1); }
    function home() {
      var t = cur();
      if (!t) return;
      t.url = ''; t.title = 'New Tab';
      t.history = t.history.slice(0, t.hi + 1);
      t.history.push({ type: 'home', time: Date.now() }); t.hi = t.history.length - 1;
      closePop(); home(); renderTabs(); urlBar(); navBtns(); star();
    }
    function reloadStop() {
      var t = cur();
      if (!t) return;
      if (t.loading) {
        t.loading = false;
        var c = body.querySelector('#br-content'), f = c && c.querySelector('iframe');
        if (f) { try { f.src = 'about:blank'; } catch (e) {} }
        loadUI(); return;
      }
      if (t.url) page(t.url, true);
      else { var l = t.history[t.hi]; if (l && l.type === 'search') search(l.query); else home(); }
    }
    function home() {
      var c = body.querySelector('#br-content');
      if (!c) return;
      c.style.zoom = '';
      var un = '';
      try { un = localStorage.getItem('aurora_username') || 'there'; } catch (e) {}
      var hr = new Date().getHours();
      var greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
      var rec = gh.slice(0, 6), unread = rl.filter(function(r) { return r.unread; }).slice(0, 4);
      var h = '<div class="br-nt"><div class="br-nt-clock" id="br-clock">--:--</div><div class="br-nt-date" id="br-date"></div>' +
        '<div class="br-nt-greeting">' + greet + ', ' + esc(un) + '</div>' +
        '<div class="br-nt-search"><span class="br-nt-sicon">&#128269;</span><input id="br-nt-input" class="br-nt-input" placeholder="Search or type a URL" autocomplete="off" spellcheck="false"><button class="br-nt-go" id="br-nt-go" title="Search">&#8594;</button></div>' +
        '<div class="br-nt-sec">Favorites</div><div class="br-nt-bm">';
      bm.forEach(function(b) {
        h += '<div class="br-nt-bm-item" data-url="' + esc(b.url) + '"><div class="br-nt-bm-icon">' + fav(b.url, 22) + '</div><div class="br-nt-bm-name">' + esc(b.name) + '</div></div>';
      });
      h += '</div>';
      if (unread.length) {
        h += '<div class="br-nt-sec">Reading List</div><div class="br-nt-recent">';
        unread.forEach(function(r) {
          h += '<div class="br-nt-rec" data-rl="' + esc(r.url) + '">' + fav(r.url, 14) + '<span class="br-nt-rec-t">' + esc(r.title) + '</span></div>';
        });
        h += '</div>';
      }
      if (rec.length) {
        h += '<div class="br-nt-sec">Recent</div><div class="br-nt-recent">';
        rec.forEach(function(r) {
          h += '<div class="br-nt-rec" data-url="' + esc(r.url) + '">' + fav(r.url, 14) + '<span class="br-nt-rec-t">' + esc(r.title) + '</span><span class="br-nt-rec-u">' + esc(dom(r.url)) + '</span></div>';
        });
        h += '</div>';
      }
      h += '<div class="br-nt-sec">Privacy</div><div class="br-priv">Trackers seen this session: <b>' + privTotal + '</b> (loaded through Aurora proxy)</div></div>';
      c.innerHTML = h;
      tick();
      var inp = c.querySelector('#br-nt-input');
      if (inp) {
        inp.focus();
        inp.onkeydown = function(e) { if (e.key === 'Enter' && inp.value.trim()) go(inp.value.trim()); };
      }
      var gb = c.querySelector('#br-nt-go');
      if (gb) gb.onclick = function() { if (inp && inp.value.trim()) go(inp.value.trim()); };
      c.querySelectorAll('[data-url]').forEach(function(el) { el.onclick = function() { go(el.getAttribute('data-url')); }; });
      c.querySelectorAll('[data-rl]').forEach(function(el) {
        el.onclick = function() {
          var u = el.getAttribute('data-rl');
          rl.forEach(function(r) { if (r.url === u) r.unread = false; });
          save('aurora_reading_list', rl); renderSide(); go(u);
        };
      });
    }
    function tick() {
      var c = body.querySelector('#br-clock'), d = body.querySelector('#br-date');
      if (!c) return;
      var n = new Date(), p = function(x) { return String(x).padStart(2, '0'); };
      c.textContent = p(n.getHours()) + ':' + p(n.getMinutes());
      if (d) d.textContent = n.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    }
    function search(q) {
      var c = body.querySelector('#br-content');
      if (!c) return;
      c.style.zoom = '';
      c.innerHTML = '<div class="br-loading"><div class="br-spinner"></div><div>Searching for &ldquo;' + esc(q) + '&rdquo;&hellip;</div></div>';
      var x = new XMLHttpRequest();
      x.open('GET', '/api/search?q=' + encodeURIComponent(q), true);
      x.onload = function() {
        try { showRes(c, q, (JSON.parse(x.responseText).results || [])); }
        catch (e) { c.innerHTML = errBox('Search failed', e.message); wireRetry(c, function() { search(q); }); }
      };
      x.onerror = function() { c.innerHTML = errBox('You appear to be offline', 'Check your connection and try again.'); wireRetry(c, function() { search(q); }); };
      x.send();
    }
    function errBox(t, s) {
      return '<div class="br-error"><div><div class="br-err-t">' + esc(t) + '</div><div class="br-err-s">' + esc(s) + '</div><button class="br-btn" id="br-err-retry">Retry</button></div></div>';
    }
    function wireRetry(c, fn) { var b = c.querySelector('#br-err-retry'); if (b) b.onclick = fn; }
    function showRes(c, q, res) {
      var h = '<div class="br-sr"><div class="br-sr-header"><div class="br-sr-logo">&#127760;</div>' +
        '<div class="br-sr-bar"><input id="br-sr-input" class="br-sr-input" value="' + esc(q) + '" autocomplete="off" spellcheck="false"></div>' +
        '<div class="br-sr-count">' + res.length + ' result' + (res.length === 1 ? '' : 's') + '</div></div>';
      if (!res.length) h += '<div class="br-sr-empty"><div class="br-err-t">No results for &ldquo;' + esc(q) + '&rdquo;</div></div>';
      res.forEach(function(r) {
        h += '<div class="br-sr-item" data-url="' + esc(r.url) + '"><div class="br-sr-top">' + fav(r.url, 14) + '<span class="br-sr-url">' + esc(dom(r.url)) + '</span></div>' +
          '<div class="br-sr-title">' + esc(r.title) + '</div>' + (r.snippet ? '<div class="br-sr-snippet">' + esc(r.snippet) + '</div>' : '') + '</div>';
      });
      c.innerHTML = h + '</div>';
      var si = c.querySelector('#br-sr-input');
      if (si) si.onkeydown = function(e) { if (e.key === 'Enter' && si.value.trim()) go(si.value.trim()); };
      c.querySelectorAll('[data-url]').forEach(function(el) { el.onclick = function() { go(el.getAttribute('data-url')); }; });
    }
    function purl(t, url) {
      var u = '/api/proxy?url=' + encodeURIComponent(url);
      return t.lite ? u + '&lite=1' : u;
    }
    function busters(url) {
      var host = '';
      try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return false; }
      if (/(^|\.)google\.[a-z.]+$/.test(host)) return true;
      var l = ['github.com', 'youtube.com', 'youtu.be', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'tiktok.com', 'netflix.com', 'reddit.com'];
      for (var i = 0; i < l.length; i++) if (host === l[i] || host.slice(-l[i].length - 1) === '.' + l[i]) return true;
      return false;
    }
    function page(url, force) {
      var c = body.querySelector('#br-content'), t = cur();
      if (!c || !t) return;
      if (!t.mode) t.mode = 'proxied';
      if (t._pct) { clearInterval(t._pct); t._pct = null; }
      if (t._err) { clearTimeout(t._err); t._err = null; }
      var mode = t.mode, cf0 = fget(t, url);
      if (!force && cf0) {
        c.innerHTML = '';
        var vw = document.createElement('div');
        vw.className = 'br-frame-wrap';
        vw.appendChild(cf0);
        vw.appendChild(pill(url));
        dwarn(vw, url, mode, t);
        c.appendChild(vw);
        zoomApply();
        t.loading = false; loadUI();
        return;
      }
      var pct = 0;
      c.innerHTML = '<div class="br-loading"><div class="br-spinner"></div><div>Loading ' + esc(dom(url)) + '&hellip;</div>' +
        '<div class="br-load-pct" id="br-load-pct">0%</div><div class="br-load-mode">' + (mode === 'direct' ? 'Direct' : t.lite ? 'Lite' : 'Proxied') + ' &middot; ' + esc(dom(url)) + '</div></div>';
      t.loading = true; loadUI();
      t._pct = setInterval(function() {
        pct = Math.min(92, pct + Math.random() * 9 + 2);
        var el = body.querySelector('#br-load-pct');
        if (el) el.textContent = Math.floor(pct) + '%';
        loadUI();
      }, 220);
      var f = document.createElement('iframe');
      f.className = 'br-frame';
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.setAttribute('allowfullscreen', 'true');
      f.src = mode === 'direct' ? url : purl(t, url);
      var done = false;
      function fin(ok, reason) {
        if (done) return;
        done = true;
        if (t._pct) { clearInterval(t._pct); t._pct = null; }
        if (t._err) { clearTimeout(t._err); t._err = null; }
        if (cur() !== t) return;
        t.loading = false;
        var el = body.querySelector('#br-load-pct');
        if (el && ok) el.textContent = '100%';
        loadUI();
        if (ok) {
          try {
            var ti = f.contentDocument && f.contentDocument.title;
            if (ti) {
              t.title = ti.slice(0, 60);
              var hh = t.history[t.hi];
              if (hh) hh.title = t.title;
              pushGH(t.url, t.title);
              renderTabs();
            }
          } catch (e) {}
          scanTrackers(f);
        } else if (reason) perr(url, reason);
      }
      f.onload = function() { fput(t, url, f); fin(true); };
      f.onerror = function() { fin(false, mode === 'direct' ? 'Blocked or failed to load directly' : 'Load failed'); };
      t._err = setTimeout(function() { fin(false, 'Timed out'); }, 20000);
      var to = setTimeout(function() { mountFrame(c, t, f, url, mode); }, 350);
      f.addEventListener('load', function() { clearTimeout(to); });
      setTimeout(function() { mountFrame(c, t, f, url, mode); }, 400);
    }
    function mountFrame(c, t, f, url, mode) {
      if (cur() !== t || c.querySelector('iframe')) return;
      if (!c.querySelector('.br-loading')) return;
      c.innerHTML = '';
      var vw = document.createElement('div');
      vw.className = 'br-frame-wrap';
      vw.appendChild(f);
      vw.appendChild(pill(url));
      dwarn(vw, url, mode, t);
      c.appendChild(vw);
      zoomApply();
    }
    function dwarn(vw, url, mode, t) {
      if (mode !== 'direct' || !busters(url)) return;
      var bar = document.createElement('div');
      bar.className = 'br-direct-warn';
      bar.innerHTML = '<span>&#9888; This site usually refuses direct embedding.</span><button class="br-pill-btn" data-act="useprox">Use Proxied</button>';
      bar.querySelector('[data-act=useprox]').onclick = function(e) { e.stopPropagation(); t.mode = 'proxied'; page(t.url, true); };
      vw.insertBefore(bar, vw.firstChild);
    }
    function pill(url) {
      var t = cur(), mode = (t && t.mode) || 'proxied';
      var p = document.createElement('div');
      p.className = 'br-pill br-mode-' + mode;
      p.innerHTML = '<span class="br-pill-dot"></span><span>' + (mode === 'direct' ? 'Direct' : t.lite ? 'Lite' : 'Proxied view') + '</span>' +
        '<button class="br-pill-btn" data-act="mode">' + (mode === 'direct' ? 'Use Proxied' : 'Use Direct') + '</button>' +
        '<button class="br-pill-btn" data-act="lite">' + (t.lite ? 'Full page' : 'Lite') + '</button>' +
        '<button class="br-pill-btn" data-act="edge">Open in Edge</button>' +
        '<button class="br-pill-btn" data-act="copy">Copy link</button>' +
        '<button class="br-pill-x" data-act="hide">&times;</button>';
      p.querySelector('[data-act=mode]').onclick = function(e) { e.stopPropagation(); var x = cur(); if (x) { x.mode = x.mode === 'direct' ? 'proxied' : 'direct'; page(x.url, true); } };
      p.querySelector('[data-act=lite]').onclick = function(e) { e.stopPropagation(); var x = cur(); if (x) { x.lite = !x.lite; fdrop(x.id); page(x.url, true); } };
      p.querySelector('[data-act=edge]').onclick = function(e) { e.stopPropagation(); ext(url); };
      p.querySelector('[data-act=copy]').onclick = function(e) { e.stopPropagation(); copy(url, this); };
      p.querySelector('[data-act=hide]').onclick = function(e) { e.stopPropagation(); p.remove(); };
      return p;
    }
    function perr(url, reason) {
      var c = body.querySelector('#br-content'), t = cur();
      if (!c) return;
      var mode = (t && t.mode) || 'proxied';
      c.innerHTML = '<div class="br-perr"><div class="br-err-t">Couldn\u2019t load ' + esc(dom(url)) + '</div>' +
        '<div class="br-perr-r">' + esc(reason || 'Load failed') + ' &middot; ' + (mode === 'direct' ? 'Direct' : t.lite ? 'Lite' : 'Proxied') + '</div>' +
        '<div class="br-perr-hint">Framing-blocked sites often refuse both modes. Try switching, or open in Edge.</div>' +
        '<div class="br-perr-btns"><button class="br-btn" data-e="retry">Retry</button>' +
        '<button class="br-btn br-btn-ghost" data-e="mode">' + (mode === 'direct' ? 'Switch to Proxied' : 'Switch to Direct') + '</button>' +
        '<button class="br-btn br-btn-ghost" data-e="edge">Open in Edge</button>' +
        '<button class="br-btn br-btn-ghost" data-e="copy">Copy link</button></div></div>';
      c.querySelector('[data-e=retry]').onclick = function() { if (t) page(t.url, true); };
      c.querySelector('[data-e=mode]').onclick = function() { var x = cur(); if (x) { x.mode = x.mode === 'direct' ? 'proxied' : 'direct'; page(x.url, true); } };
      c.querySelector('[data-e=edge]').onclick = function() { ext(url); };
      c.querySelector('[data-e=copy]').onclick = function() { copy(url, this); };
    }
    function ext(url) {
      if (!url) return;
      try { window.open('/api/open-external?url=' + encodeURIComponent(url), '_blank'); } catch (e) {}
      try { window.open(url, '_blank'); } catch (e) {}
    }
    function copy(text, btn) {
      function ok() {
        if (!btn) return;
        var o = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(function() { btn.textContent = o; }, 1200);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, ok);
      else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        ta.remove(); ok();
      }
    }
    function scanTrackers(f) {
      try {
        var html = f.contentDocument.documentElement.outerHTML;
        var found = [];
        TRACKERS.forEach(function(tr) { if (html.indexOf(tr) !== -1) found.push(tr); });
        if (found.length) {
          privTotal += found.length;
          var t = cur();
          if (t) { t.trackers = found; renderTabs(); }
        }
      } catch (e) {}
    }
    function readerOn() {
      var t = cur();
      if (!t || !t.url || t.mode === 'direct') { toast('Reader needs a Proxied page'); return; }
      var f = body.querySelector('#br-content iframe');
      if (!f) return;
      var doc;
      try { doc = f.contentDocument; } catch (e) { toast('Reader unavailable on this page'); return; }
      var art = doc.querySelector('article'), ps = doc.querySelectorAll('p'), keep = [];
      for (var i = 0; i < ps.length; i++) if ((ps[i].innerText || '').length > 60) keep.push(ps[i]);
      var txt = keep.map(function(p) { return p.innerText; }).join('\n').length;
      if (!art && (keep.length < 3 || txt < 200)) { toast('No article found on this page'); return; }
      var title = (doc.querySelector('h1') || {}).innerText || t.title;
      var img = '';
      try {
        var im = (art || doc).querySelector('img');
        if (im && im.src) img = '<img src="' + im.src + '" class="br-rd-img">';
      } catch (e) {}
      var src = art ? art.querySelectorAll('p') : keep, ph = '';
      for (var j = 0; j < src.length; j++) {
        var pt = (src[j].innerText || '').trim();
        if (pt.length > 40) ph += '<p>' + esc(pt) + '</p>';
      }
      var c = body.querySelector('#br-content');
      c.innerHTML = '<div class="br-rd"><div class="br-rd-bar"><button class="br-btn br-btn-ghost" id="br-rd-back">&#8249; Back</button>' +
        '<span class="br-rd-d">' + esc(dom(t.url)) + '</span><span><button class="br-rd-z" id="br-rd-minus">A\u2212</button>' +
        '<button class="br-rd-z" id="br-rd-plus">A+</button></span></div>' +
        '<div class="br-rd-body" id="br-rd-body"><h1>' + esc(title) + '</h1>' + img + ph + '</div></div>';
      c.querySelector('#br-rd-back').onclick = function() { renderContent(); };
      c.querySelector('#br-rd-minus').onclick = function() { rz(-1); };
      c.querySelector('#br-rd-plus').onclick = function() { rz(1); };
    }
    function rz(d) {
      var b = body.querySelector('#br-rd-body');
      if (!b) return;
      var s = parseInt(b.getAttribute('data-z') || '19', 10) + d;
      s = Math.max(14, Math.min(26, s));
      b.setAttribute('data-z', s);
      b.style.fontSize = s + 'px';
    }
    function toast(m) {
      var c = body.querySelector('#br-content');
      if (!c) return;
      var d = document.createElement('div');
      d.className = 'br-toast';
      d.textContent = m;
      c.appendChild(d);
      setTimeout(function() { d.remove(); }, 2200);
    }
    function findBar() {
      closePop();
      if (body.querySelector('#br-find')) return;
      var d = document.createElement('div');
      d.id = 'br-find';
      d.className = 'br-pop br-find-pop';
      d.innerHTML = '<input id="br-find-in" placeholder="Find in page\u2026"><span id="br-find-n"></span><button id="br-find-x">&times;</button>';
      body.querySelector('.br-url-bar').appendChild(d);
      var inp = d.querySelector('#br-find-in');
      inp.focus();
      inp.oninput = function() {
        var f = body.querySelector('#br-content iframe'), n = d.querySelector('#br-find-n');
        try {
          var ok = f.contentWindow.find(inp.value);
          n.textContent = inp.value ? (ok ? '\u2713' : '0') : '';
        } catch (e) { n.textContent = ''; toast('Find is unavailable on this page (Direct mode blocks access)'); }
      };
      inp.onkeydown = function(e) { if (e.key === 'Escape') d.remove(); };
      d.querySelector('#br-find-x').onclick = function() { d.remove(); };
    }
    function loadUI() {
      var t = cur(), bar = body.querySelector('#br-progress');
      if (bar) bar.classList.toggle('loading', !!(t && t.loading));
      var rb = body.querySelector('#br-reload');
      if (rb) {
        rb.innerHTML = (t && t.loading)
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>';
        rb.title = (t && t.loading) ? 'Stop' : 'Reload';
      }
      var tb = body.querySelector('#br-tabs');
      if (tb && t) tb.querySelectorAll('.br-tab').forEach(function(el) {
        if (parseInt(el.getAttribute('data-tid'), 10) === t.id) {
          var sp = el.querySelector('.br-tab-ic');
          if (sp) sp.innerHTML = t.loading ? '<span class="br-tab-spin">&#8635;</span>' : fav(t.url || '', 14);
        }
      });
    }
    function urlBar() {
      var t = cur(), inp = body.querySelector('#br-url-input'), lock = body.querySelector('#br-lock');
      if (!inp) return;
      if (!t || !t.url) { inp.value = ''; if (lock) { lock.style.color = ''; lock.style.opacity = '.4'; } }
      else {
        if (document.activeElement !== inp) inp.value = t.url;
        if (lock) { lock.style.color = t.url.indexOf('https://') === 0 ? '#a6e3a1' : '#f9e2af'; lock.style.opacity = '1'; }
      }
      var rd = body.querySelector('#br-reader');
      if (rd) rd.style.opacity = '.35';
    }
    function navBtns() {
      var t = cur();
      var bk = body.querySelector('#br-back'), fw = body.querySelector('#br-fwd');
      if (bk) bk.disabled = !t || t.hi <= 0;
      if (fw) fw.disabled = !t || !t.history || t.hi >= t.history.length - 1;
    }
    function isBM(url) { return bm.some(function(x) { return x.url === url; }); }
    function star() {
      var s = body.querySelector('#br-star');
      if (!s) return;
      var t = cur(), on = !!(t && t.url && isBM(t.url));
      s.classList.toggle('on', on);
      s.innerHTML = on
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    }
    function toggleBM() {
      var t = cur();
      if (!t || !t.url) return;
      var i = -1;
      for (var k = 0; k < bm.length; k++) if (bm[k].url === t.url) { i = k; break; }
      if (i >= 0) bm.splice(i, 1);
      else bm.push({ name: t.title || dom(t.url), url: t.url });
      save('aurora_browser_bookmarks', bm);
      renderBM(); star();
      if (cur() && !cur().url) home();
    }
    function zoomApply() {
      var t = cur(), c = body.querySelector('#br-content');
      if (!c || !t) return;
      var f = c.querySelector('iframe');
      if (f) { try { f.style.zoom = ((t.zoom || 100) / 100); } catch (e) {} }
      var zl = body.querySelector('#br-zoom-label');
      if (zl) zl.textContent = (t.zoom || 100) + '%';
    }
    function zoom(d) {
      var t = cur();
      if (!t) return;
      t.zoom = Math.min(200, Math.max(50, (t.zoom || 100) + d));
      zoomApply();
    }
    function closePop() {
      ['#br-suggest', '#br-hist-pop', '#br-menu-pop', '#br-site-pop', '#br-share-pop'].forEach(function(s) {
        var el = body.querySelector(s);
        if (el) el.remove();
      });
    }
    function pop(anchor, id, cls, html) {
      closePop();
      var p = document.createElement('div');
      p.id = id; p.className = 'br-pop ' + cls;
      p.innerHTML = html;
      anchor.parentElement.style.position = 'relative';
      anchor.parentElement.appendChild(p);
      return p;
    }
    function suggest() {
      var inp = body.querySelector('#br-url-input'), bar = body.querySelector('.br-url-bar');
      if (!inp || !bar) return;
      closePop();
      var q = inp.value.trim().toLowerCase(), items = [];
      bm.forEach(function(x) {
        if (!q || x.name.toLowerCase().indexOf(q) !== -1 || x.url.toLowerCase().indexOf(q) !== -1) {
          items.push({ label: x.name, sub: dom(x.url), url: x.url, ic: '&#9733;' });
        }
      });
      gh.forEach(function(x) {
        if (items.length >= 7) return;
        if (!q || (x.title + ' ' + x.url).toLowerCase().indexOf(q) !== -1) {
          if (!items.some(function(y) { return y.url === x.url; })) items.push({ label: x.title, sub: dom(x.url), url: x.url, ic: '&#128336;' });
        }
      });
      if (q) items.unshift({ label: 'Search for "' + inp.value.trim() + '"', sub: 'Aurora Search', url: null, qq: inp.value.trim(), ic: '&#128269;' });
      if (!items.length) return;
      var p = document.createElement('div');
      p.id = 'br-suggest'; p.className = 'br-pop br-suggest';
      p.innerHTML = items.map(function(it, i) {
        return '<div class="br-sug" data-i="' + i + '"><span class="br-sug-ic">' + it.ic + '</span><span class="br-sug-t">' + esc(it.label) + '</span><span class="br-sug-u">' + esc(it.sub) + '</span></div>';
      }).join('');
      bar.style.position = 'relative';
      bar.appendChild(p);
      p.querySelectorAll('.br-sug').forEach(function(el) {
        el.onmousedown = function(e) { e.preventDefault(); var it = items[parseInt(el.getAttribute('data-i'), 10)]; go(it.url || it.qq); closePop(); };
      });
    }
    function histPop() {
      var a = body.querySelector('#br-hist-btn'), t = cur();
      if (!a || !t) return;
      if (body.querySelector('#br-hist-pop')) { closePop(); return; }
      var h = '<div class="br-pop-h">This tab<button class="br-mini" id="br-h-clear">Clear</button></div>';
      for (var i = t.history.length - 1; i >= 0; i--) {
        var e = t.history[i];
        var lb = e.type === 'url' ? (e.title || dom(e.url)) : e.type === 'search' ? 'Search: ' + e.query : 'New Tab';
        h += '<div class="br-hist-item' + (i === t.hi ? ' cur' : '') + '" data-i="' + i + '"><span class="br-hist-t">' + esc(lb) + '</span></div>';
      }
      h += '<div class="br-pop-h" style="margin-top:8px">Recently visited</div>';
      var rc = gh.slice(0, 8);
      if (!rc.length) h += '<div class="br-pop-empty">Nothing yet</div>';
      rc.forEach(function(x) { h += '<div class="br-hist-item br-gh" data-url="' + esc(x.url) + '">' + fav(x.url, 12) + '<span class="br-hist-t">' + esc(x.title) + '</span></div>'; });
      var p = pop(a, 'br-hist-pop', 'br-hist-pop', h);
      p.querySelectorAll('.br-hist-item[data-i]').forEach(function(el) { el.onclick = function() { jump(parseInt(el.getAttribute('data-i'), 10)); }; });
      p.querySelectorAll('.br-gh').forEach(function(el) { el.onclick = function() { go(el.getAttribute('data-url')); }; });
      p.querySelector('#br-h-clear').onclick = function(e) {
        e.stopPropagation();
        t.history = [{ type: 'home', time: Date.now() }]; t.hi = 0; t.url = ''; t.title = 'New Tab';
        home(); renderTabs(); urlBar(); navBtns(); closePop();
      };
    }
    function sitePop() {
      var lock = body.querySelector('#br-lock'), t = cur();
      if (!lock) return;
      if (body.querySelector('#br-site-pop')) { closePop(); return; }
      var h;
      if (!t || !t.url) h = '<div class="br-pop-h">Aurora Browser</div><div class="br-pop-empty">New tab page is always secure.</div>';
      else {
        var sec = t.url.indexOf('https://') === 0;
        h = '<div class="br-pop-h">' + (sec ? '&#128274; Connection secure' : '&#9888; Not fully secure') + '</div>' +
          '<div class="br-site-url">' + esc(dom(t.url)) + '</div>' +
          '<div class="br-site-row">Mode: <b>' + (t.mode === 'direct' ? 'Direct' : t.lite ? 'Lite' : 'Proxied') + '</b></div>' +
          '<div class="br-site-row">Trackers on this page: <b>' + ((t.trackers || []).length) + '</b></div>' +
          '<div class="br-site-actions"><button class="br-btn" id="br-site-edge">Open in Edge</button>' +
          '<button class="br-btn br-btn-ghost" id="br-site-mode">' + (t.mode === 'direct' ? 'Use Proxied' : 'Use Direct') + '</button>' +
          '<button class="br-btn br-btn-ghost" id="br-site-copy">Copy link</button></div>';
      }
      var p = pop(lock, 'br-site-pop', 'br-site-pop', h);
      var be = p.querySelector('#br-site-edge'), bmd = p.querySelector('#br-site-mode'), bc = p.querySelector('#br-site-copy');
      if (be) be.onclick = function() { ext(t.url); closePop(); };
      if (bmd) bmd.onclick = function() { t.mode = t.mode === 'direct' ? 'proxied' : 'direct'; page(t.url, true); };
      if (bc) bc.onclick = function() { copy(t.url, bc); };
    }
    function sharePop() {
      var a = body.querySelector('#br-share-btn'), t = cur();
      if (!a) return;
      if (body.querySelector('#br-share-pop')) { closePop(); return; }
      var p = pop(a, 'br-share-pop', 'br-menu-pop',
        '<div class="br-menu-item" data-a="copy">Copy link</div>' +
        '<div class="br-menu-item" data-a="edge">Open in Edge</div>' +
        '<div class="br-menu-item" data-a="save">Save page</div>' +
        '<div class="br-menu-item" data-a="rl">Add to Reading List</div>' +
        '<div class="br-menu-item" data-a="bm">Bookmark this page</div>');
      p.querySelectorAll('.br-menu-item').forEach(function(el) {
        el.onclick = function() {
          var x = cur(), act = el.getAttribute('data-a');
          if (!x) { closePop(); return; }
          if (act === 'copy') copy(x.url, null);
          else if (act === 'edge') ext(x.url);
          else if (act === 'save') savePage(x);
          else if (act === 'rl') addRL(x);
          else if (act === 'bm') toggleBM();
          closePop();
        };
      });
    }
    function menuPop() {
      var a = body.querySelector('#br-menu-btn'), t = cur();
      if (!a) return;
      if (body.querySelector('#br-menu-pop')) { closePop(); return; }
      var p = pop(a, 'br-menu-pop', 'br-menu-pop',
        '<div class="br-menu-item" data-a="new">New tab <span class="br-kbd">Ctrl+T</span></div>' +
        '<div class="br-menu-item" data-a="reader">Reader View <span class="br-kbd">Ctrl+Shift+R</span></div>' +
        '<div class="br-menu-item" data-a="overview">Tab Overview <span class="br-kbd">Ctrl+Shift+O</span></div>' +
        '<div class="br-menu-item" data-a="dup">Duplicate tab</div>' +
        '<div class="br-menu-item" data-a="restore">Reopen closed tab <span class="br-kbd">Ctrl+Shift+T</span></div>' +
        '<div class="br-menu-sep"></div>' +
        '<div class="br-menu-item" data-a="zin">Zoom in <span class="br-kbd" id="br-zoom-label">' + (t ? (t.zoom || 100) : 100) + '%</span></div>' +
        '<div class="br-menu-item" data-a="zout">Zoom out</div>' +
        '<div class="br-menu-item" data-a="zreset">Reset zoom</div>' +
        '<div class="br-menu-sep"></div>' +
        '<div class="br-menu-item" data-a="rl">Add to Reading List</div>' +
        '<div class="br-menu-item" data-a="edge">Open in Edge</div>' +
        '<div class="br-menu-item" data-a="copy">Copy link</div>' +
        '<div class="br-menu-item" data-a="full">Fullscreen</div>' +
        '<div class="br-menu-sep"></div>' +
        '<div class="br-menu-foot">Aurora engine \u00b7 ' + esc(ENG).slice(0, 40) + ' (WebKit family)</div>');
      p.querySelectorAll('.br-menu-item').forEach(function(el) {
        el.onclick = function() {
          var x = cur(), act = el.getAttribute('data-a');
          if (act === 'new') mkTab();
          else if (act === 'reader') readerOn();
          else if (act === 'overview') overview();
          else if (act === 'dup' && x) mkTab(x.url || undefined, { mode: x.mode, lite: x.lite });
          else if (act === 'restore') restoreClosed();
          else if (act === 'zin') { zoom(10); return; }
          else if (act === 'zout') { zoom(-10); return; }
          else if (act === 'zreset' && x) { x.zoom = 100; zoomApply(); return; }
          else if (act === 'rl' && x) addRL(x);
          else if (act === 'edge' && x) ext(x.url);
          else if (act === 'copy' && x) copy(x.url, null);
          else if (act === 'full') { try { mgr.maximize(w.id); } catch (e) {} }
          closePop();
        };
      });
    }
    function addRL(t) {
      if (!t || !t.url) { toast('Open a page first'); return; }
      if (!rl.some(function(r) { return r.url === t.url; })) {
        rl.unshift({ url: t.url, title: t.title || dom(t.url), added: Date.now(), unread: true });
        save('aurora_reading_list', rl);
      }
      renderSide(); toast('Added to Reading List');
    }
    function savePage(t) {
      if (!t || !t.url || t.mode === 'direct') { toast('Save works on Proxied pages'); return; }
      toast('Saving page\u2026');
      fetch(purl(t, t.url)).then(function(r) { return r.text(); }).then(function(html) {
        var blob = new Blob([html], { type: 'text/html' });
        var a = document.createElement('a');
        var nm = (t.title || 'page').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'page';
        a.href = URL.createObjectURL(blob);
        a.download = nm + '.html';
        document.body.appendChild(a); a.click();
        setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        dl.unshift({ name: nm, url: t.url, time: Date.now() });
        if (dl.length > 30) dl.length = 30;
        save('aurora_downloads', dl); renderSide(); toast('Page saved');
      }).catch(function() { toast('Save failed'); });
    }
    function overview() {
      closePop();
      var ex = body.querySelector('#br-overview');
      if (ex) { ex.remove(); return; }
      var o = document.createElement('div');
      o.id = 'br-overview'; o.className = 'br-overview';
      var h = '';
      tabs.forEach(function(t) {
        h += '<div class="br-ov-card' + (t.id === active ? ' cur' : '') + '" data-tid="' + t.id + '">' +
          '<div class="br-ov-ic">' + fav(t.url || '', 26) + '</div>' +
          '<div class="br-ov-t">' + esc(t.title || 'New Tab') + '</div>' +
          '<div class="br-ov-u">' + esc(t.url ? dom(t.url) : 'new tab') + ' \u00b7 ' + (t.mode === 'direct' ? 'Direct' : t.lite ? 'Lite' : 'Proxied') + '</div>' +
          '<span class="br-ov-x" data-x="' + t.id + '">&times;</span></div>';
      });
      h += '<div class="br-ov-card br-ov-new" id="br-ov-new">+ New tab</div>';
      if (closed.length) h += '<div class="br-ov-card br-ov-new" id="br-ov-restore">\u21A9 Reopen closed tab</div>';
      o.innerHTML = h;
      body.querySelector('#br-content').appendChild(o);
      o.querySelectorAll('.br-ov-card[data-tid]').forEach(function(el) {
        el.onclick = function(e) {
          if (e.target.classList.contains('br-ov-x')) return;
          o.remove(); switchTab(parseInt(el.getAttribute('data-tid'), 10));
        };
      });
      o.querySelectorAll('[data-x]').forEach(function(el) {
        el.onclick = function(e) { e.stopPropagation(); closeTab(parseInt(el.getAttribute('data-x'), 10)); overview(); };
      });
      o.querySelector('#br-ov-new').onclick = function() { o.remove(); mkTab(); };
      var rs = o.querySelector('#br-ov-restore');
      if (rs) rs.onclick = function() { o.remove(); restoreClosed(); };
    }
    function renderTabs() {
      var bar = body.querySelector('#br-tabs');
      if (!bar) return;
      var h = '';
      tabs.forEach(function(t) {
        h += '<div class="br-tab' + (t.id === active ? ' active' : '') + '" data-tid="' + t.id + '">' +
          '<span class="br-tab-ic">' + (t.loading ? '<span class="br-tab-spin">&#8635;</span>' : (t.url ? fav(t.url, 14) : '<span class="br-tab-ic-nt">+</span>')) + '</span>' +
          '<span class="br-tab-title">' + esc(t.title || 'New Tab') + '</span>' +
          '<span class="br-tab-close" data-tclose="' + t.id + '">&times;</span></div>';
      });
      h += '<div class="br-tab-new" id="br-newtab-btn" title="New tab (Ctrl+T)">+</div>';
      bar.innerHTML = h;
      bar.querySelectorAll('.br-tab').forEach(function(el) {
        el.onclick = function(e) {
          if (e.target.classList.contains('br-tab-close')) return;
          switchTab(parseInt(el.getAttribute('data-tid'), 10));
        };
      });
      bar.querySelectorAll('.br-tab-close').forEach(function(el) {
        el.onclick = function(e) { closeTab(parseInt(el.getAttribute('data-tclose'), 10), e); };
      });
      bar.querySelector('#br-newtab-btn').onclick = function() { mkTab(); };
      var wt = body.querySelector('.win-title'), t = cur();
      if (wt && t) wt.textContent = (t.title || 'New Tab') + ' - Aurora Browser';
    }
    function renderBM() {
      var bar = body.querySelector('#br-bm-bar');
      if (!bar) return;
      var h = '<div class="br-bm-item br-bm-static" title="Bookmarks">&#9733;</div><div class="br-bm-sep"></div>';
      bm.forEach(function(b, i) {
        h += '<div class="br-bm-item" data-nav="' + esc(b.url) + '" title="' + esc(b.url) + '">' + fav(b.url, 12) + ' ' + esc(b.name) +
          (i >= DEF_BM.length ? ' <span class="br-bm-x" data-rm="' + i + '">&times;</span>' : '') + '</div>';
      });
      bar.innerHTML = h;
      bar.querySelectorAll('[data-nav]').forEach(function(el) {
        el.onclick = function(e) { if (e.target.classList.contains('br-bm-x')) return; go(el.getAttribute('data-nav')); };
      });
      bar.querySelectorAll('[data-rm]').forEach(function(el) {
        el.onclick = function(e) {
          e.stopPropagation();
          bm.splice(parseInt(el.getAttribute('data-rm'), 10), 1);
          save('aurora_browser_bookmarks', bm); renderBM(); star();
          if (cur() && !cur().url) home();
        };
      });
    }
    function renderSide() {
      var s = body.querySelector('#br-sidebar');
      if (!s) return;
      s.style.display = sideOpen ? '' : 'none';
      var h = '<div class="br-side-sec">Bookmarks</div>';
      bm.forEach(function(b) {
        h += '<div class="br-side-item" data-nav="' + esc(b.url) + '">' + fav(b.url, 14) + '<span>' + esc(b.name) + '</span></div>';
      });
      h += '<div class="br-side-sec">Reading List (' + rl.filter(function(r) { return r.unread; }).length + ' unread)</div>';
      if (!rl.length) h += '<div class="br-pop-empty">Use Share \u2192 Add to Reading List</div>';
      rl.forEach(function(r) {
        h += '<div class="br-side-item' + (r.unread ? ' unread' : '') + '" data-rl="' + esc(r.url) + '">' + fav(r.url, 14) + '<span>' + esc(r.title) + '</span><span class="br-side-x" data-rlx="' + esc(r.url) + '">&times;</span></div>';
      });
      h += '<div class="br-side-sec">History</div>';
      gh.slice(0, 12).forEach(function(x) {
        h += '<div class="br-side-item" data-nav="' + esc(x.url) + '">' + fav(x.url, 14) + '<span>' + esc(x.title) + '</span></div>';
      });
      h += '<div class="br-side-sec">Downloads (' + dl.length + ')</div>';
      if (!dl.length) h += '<div class="br-pop-empty">Share \u2192 Save page</div>';
      dl.forEach(function(d, i) {
        h += '<div class="br-side-item" data-dl="' + i + '"><span>&#128190;</span><span>' + esc(d.name) + '</span></div>';
      });
      s.innerHTML = h;
      s.querySelectorAll('[data-nav]').forEach(function(el) { el.onclick = function() { go(el.getAttribute('data-nav')); }; });
      s.querySelectorAll('[data-rl]').forEach(function(el) {
        el.onclick = function(e) {
          if (e.target.classList.contains('br-side-x')) return;
          var u = el.getAttribute('data-rl');
          rl.forEach(function(r) { if (r.url === u) r.unread = false; });
          save('aurora_reading_list', rl); renderSide(); go(u);
        };
      });
      s.querySelectorAll('[data-rlx]').forEach(function(el) {
        el.onclick = function(e) {
          e.stopPropagation();
          var u = el.getAttribute('data-rlx');
          rl = rl.filter(function(r) { return r.url !== u; });
          save('aurora_reading_list', rl); renderSide();
        };
      });
      s.querySelectorAll('[data-dl]').forEach(function(el) {
        el.onclick = function() { var d = dl[parseInt(el.getAttribute('data-dl'), 10)]; if (d) go(d.url); };
      });
    }
    function renderContent() {
      var t = cur();
      if (!t) return;
      if (t.url) {
        var cf = fget(t, t.url);
        if (cf) {
          var c = body.querySelector('#br-content');
          c.innerHTML = '';
          var vw = document.createElement('div');
          vw.className = 'br-frame-wrap';
          vw.appendChild(cf);
          vw.appendChild(pill(t.url));
          dwarn(vw, t.url, t.mode, t);
          c.appendChild(vw);
          zoomApply(); t.loading = false; loadUI();
        } else page(t.url);
      } else {
        var l = t.history[t.hi];
        if (l && l.type === 'search') search(l.query);
        else home();
      }
    }
    function renderAll() {
      renderTabs(); renderBM(); renderSide();
      urlBar(); loadUI(); navBtns(); star();
      renderContent();
    }
    function initUI() {
      body.innerHTML =
        '<div class="br-root"><div class="br-tabs" id="br-tabs"></div>' +
        '<div class="br-toolbar">' +
        '<button class="br-nav" id="br-back" title="Back (Alt+Left)">&larr;</button>' +
        '<button class="br-nav" id="br-fwd" title="Forward (Alt+Right)">&rarr;</button>' +
        '<button class="br-nav" id="br-reload" title="Reload">&#8635;</button>' +
        '<button class="br-nav" id="br-side-toggle" title="Sidebar">&#9783;</button>' +
        '<div class="br-url-bar"><span class="br-lock" id="br-lock" title="Site info">&#128274;</span>' +
        '<input id="br-url-input" class="br-url-input" placeholder="Search or enter URL (Ctrl+L)" spellcheck="false" autocomplete="off">' +
        '<button class="br-nav" id="br-reader" title="Reader View (Ctrl+Shift+R)">&#128214;</button>' +
        '<button class="br-nav br-star" id="br-star" title="Bookmark"></button>' +
        '<button class="br-nav" id="br-share-btn" title="Share">&#8599;</button>' +
        '<button class="br-nav" id="br-hist-btn" title="History (Ctrl+H)">&#128336;</button>' +
        '<button class="br-nav" id="br-overview-btn" title="Tab Overview (Ctrl+Shift+O)">&#8862;</button>' +
        '<button class="br-nav" id="br-menu-btn" title="Menu">&#8942;</button></div>' +
        '<button class="br-profile-btn" title="Profile"><div class="br-profile-avatar">A</div></button></div>' +
        '<div class="br-main"><div class="br-sidebar" id="br-sidebar"></div>' +
        '<div class="br-col"><div class="br-bm-bar" id="br-bm-bar"></div>' +
        '<div id="br-content" class="br-content"></div>' +
        '<div class="br-status"><div class="br-prog" id="br-progress"></div></div></div></div></div>' +
        '<style>' +
        '@keyframes brspin{from{transform:rotate(0)}to{transform:rotate(360deg)}}' +
        '@keyframes brprog{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}' +
        '.br-root{display:flex;flex-direction:column;height:100%;overflow:hidden;background:#14141f}' +
        '.br-tabs{display:flex;align-items:flex-end;gap:4px;padding:6px 8px 0;background:#1a1a2e;flex-shrink:0;overflow-x:auto;min-height:38px}' +
        '.br-tab{display:flex;align-items:center;gap:7px;padding:6px 10px;border-radius:10px 10px 0 0;font-size:12px;color:#8a8fa8;cursor:pointer;max-width:220px;min-width:80px;flex:1;background:rgba(255,255,255,.03)}' +
        '.br-tab.active{background:#24243a;color:#eef1ff}' +
        '.br-tab:hover:not(.active){background:rgba(255,255,255,.06)}' +
        '.br-tab-ic{display:flex;flex-shrink:0}.br-fav{border-radius:3px}.br-hide{display:none}' +
        '.br-tab-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}' +
        '.br-tab-close{font-size:15px;opacity:0;padding:1px 5px;border-radius:6px}' +
        '.br-tab:hover .br-tab-close{opacity:.6}.br-tab-close:hover{opacity:1!important;background:rgba(243,139,168,.25);color:#f38ba8}' +
        '.br-tab-spin{animation:brspin .8s linear infinite;font-size:11px;color:#89b4fa}' +
        '.br-tab-new{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:8px;color:#8a8fa8;cursor:pointer;font-size:18px;flex-shrink:0;margin:2px}' +
        '.br-tab-new:hover{background:rgba(137,180,250,.15);color:#cdd6f4}' +
        '.br-tab-ic-nt{opacity:.5}' +
        '.br-toolbar{display:flex;align-items:center;gap:4px;padding:6px 8px;background:#24243a;border-bottom:1px solid rgba(255,255,255,.06)}' +
        '.br-nav{width:30px;height:30px;border:none;border-radius:50%;background:transparent;color:#a6adc8;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
        '.br-nav:hover:not(:disabled){background:rgba(255,255,255,.09);color:#fff}' +
        '.br-nav:disabled{opacity:.22}' +
        '.br-star.on{color:#f9e2af!important}' +
        '.br-url-bar{flex:1;display:flex;align-items:center;gap:4px;background:#0a0a14;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:0 6px 0 12px;height:34px;margin:0 6px;min-width:0}' +
        '.br-url-bar:focus-within{border-color:rgba(137,180,250,.55)}' +
        '.br-lock{opacity:.5;cursor:pointer;padding:4px;font-size:11px}' +
        '.br-url-input{flex:1;background:transparent;border:none;color:#eef1ff;font-size:13px;outline:none;font-family:inherit;min-width:0}' +
        '.br-url-input::placeholder{color:#585b70}' +
        '.br-profile-btn{border:none;background:transparent;cursor:pointer;padding:2px;flex-shrink:0}' +
        '.br-profile-avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#89b4fa,#cba6f7);color:#11111b;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}' +
        '.br-main{flex:1;display:flex;min-height:0}' +
        '.br-sidebar{width:210px;flex-shrink:0;background:#14141f;border-right:1px solid rgba(255,255,255,.06);overflow-y:auto;padding:10px}' +
        '.br-side-sec{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#585b70;margin:10px 4px 6px}' +
        '.br-side-item{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:9px;font-size:12px;color:#a6adc8;cursor:pointer}' +
        '.br-side-item:hover{background:rgba(137,180,250,.09);color:#eef1ff}' +
        '.br-side-item.unread span:first-of-type{font-weight:700;color:#fff}' +
        '.br-side-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}' +
        '.br-side-x{opacity:0;padding:0 4px;border-radius:4px}.br-side-item:hover .br-side-x{opacity:.7}.br-side-x:hover{color:#f38ba8}' +
        '.br-col{flex:1;display:flex;flex-direction:column;min-width:0}' +
        '.br-bm-bar{display:flex;align-items:center;gap:2px;padding:3px 10px;background:#1a1a2e;border-bottom:1px solid rgba(255,255,255,.05);flex-shrink:0;overflow-x:auto}' +
        '.br-bm-sep{width:1px;height:16px;background:rgba(255,255,255,.1);flex-shrink:0;margin:0 6px}' +
        '.br-bm-item{display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;font-size:11px;color:#8a8fa8;cursor:pointer;white-space:nowrap;flex-shrink:0}' +
        '.br-bm-item:hover{background:rgba(137,180,250,.1);color:#dbe4ff}' +
        '.br-bm-static{padding:4px 8px}.br-bm-x{opacity:0;margin-left:2px;padding:0 4px;border-radius:4px}.br-bm-item:hover .br-bm-x{opacity:.7}.br-bm-x:hover{color:#f38ba8}' +
        '.br-content{flex:1;position:relative;overflow:hidden;background:#1e1e2e}' +
        '.br-frame-wrap{position:absolute;inset:0;background:#fff;display:flex;flex-direction:column}' +
        '.br-frame{flex:1;min-height:0;height:auto;width:100%;border:none;background:#fff}' +
        '.br-pill{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;background:rgba(17,17,27,.9);border:1px solid rgba(255,255,255,.1);color:#cdd6f4;font-size:11px;padding:6px 8px 6px 12px;border-radius:20px;z-index:5}' +
        '.br-pill-dot{width:7px;height:7px;border-radius:50%;background:#a6e3a1}' +
        '.br-mode-direct .br-pill-dot{background:#89b4fa}' +
        '.br-pill-btn{border:1px solid rgba(137,180,250,.35);background:rgba(137,180,250,.12);color:#b4befe;font-size:11px;padding:4px 10px;border-radius:12px;cursor:pointer}' +
        '.br-pill-x{border:none;background:transparent;color:#6c7086;cursor:pointer;font-size:14px;padding:0 4px}' +
        '.br-direct-warn{display:flex;align-items:center;justify-content:center;gap:10px;background:rgba(249,226,175,.12);color:#f9e2af;font-size:11px;padding:7px 12px;flex-shrink:0}' +
        '.br-nt{display:flex;flex-direction:column;align-items:center;overflow-y:auto;height:100%;padding:30px 20px 40px}' +
        '.br-nt-clock{font-size:52px;font-weight:200;color:#fff;letter-spacing:-2px;line-height:1}' +
        '.br-nt-date{font-size:13px;color:#8a8fa8;margin:6px 0 4px}' +
        '.br-nt-greeting{font-size:19px;color:#cdd6f4;margin-bottom:22px;font-weight:300}' +
        '.br-nt-search{display:flex;width:100%;max-width:560px;margin-bottom:22px;position:relative}' +
        '.br-nt-sicon{position:absolute;left:18px;top:50%;transform:translateY(-50%);opacity:.45}' +
        '.br-nt-input{flex:1;padding:13px 52px 13px 44px;border:1px solid rgba(255,255,255,.09);border-radius:24px;background:#0a0a14;color:#fff;font-size:15px;outline:none;font-family:inherit;width:100%}' +
        '.br-nt-go{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:34px;height:34px;border:none;border-radius:50%;background:#89b4fa;color:#11111b;cursor:pointer;font-size:16px}' +
        '.br-nt-sec{font-size:11px;color:#585b70;margin:6px 0 12px;letter-spacing:1px}' +
        '.br-nt-bm{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:640px;margin-bottom:8px}' +
        '.br-nt-bm-item{display:flex;flex-direction:column;align-items:center;gap:9px;padding:16px 14px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);cursor:pointer;width:100px}' +
        '.br-nt-bm-icon{height:26px;display:flex;align-items:center}.br-nt-bm-icon img{border-radius:5px}' +
        '.br-nt-bm-name{font-size:11px;color:#a6adc8}' +
        '.br-nt-recent{display:flex;flex-direction:column;gap:2px;width:100%;max-width:560px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:6px}' +
        '.br-nt-rec{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;cursor:pointer}' +
        '.br-nt-rec:hover{background:rgba(137,180,250,.08)}' +
        '.br-nt-rec-t{flex:1;font-size:12px;color:#cdd6f4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.br-nt-rec-u{font-size:11px;color:#585b70;flex-shrink:0}' +
        '.br-priv{font-size:12px;color:#8a8fa8;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:10px 18px;margin-bottom:8px}' +
        '.br-priv b{color:#a6e3a1}' +
        '.br-sr{padding:22px 36px 60px;max-width:760px;margin:0 auto;overflow-y:auto;height:100%}' +
        '.br-sr-header{display:flex;align-items:center;gap:12px;margin-bottom:8px}' +
        '.br-sr-logo{font-size:26px}.br-sr-bar{flex:1}' +
        '.br-sr-input{width:100%;padding:10px 18px;border:1px solid rgba(255,255,255,.1);border-radius:20px;background:#0a0a14;color:#fff;font-size:14px;outline:none;font-family:inherit}' +
        '.br-sr-count{font-size:11px;color:#585b70;white-space:nowrap}' +
        '.br-sr-item{padding:14px;border-radius:12px;cursor:pointer}' +
        '.br-sr-item:hover{background:rgba(137,180,250,.06)}' +
        '.br-sr-top{display:flex;align-items:center;gap:7px;margin-bottom:4px}.br-sr-url{font-size:11px;color:#6c7086}' +
        '.br-sr-title{font-size:17px;color:#89b4fa;margin-bottom:5px}' +
        '.br-sr-snippet{font-size:13px;color:#a6adc8;line-height:1.55}' +
        '.br-sr-empty,.br-error{display:flex;align-items:center;justify-content:center;height:60%;text-align:center}' +
        '.br-err-t{font-size:17px;color:#cdd6f4;margin-bottom:8px}.br-err-s{font-size:13px;color:#8a8fa8;margin-bottom:16px}' +
        '.br-btn{border:none;background:#89b4fa;color:#11111b;font-size:13px;font-weight:600;padding:9px 22px;border-radius:18px;cursor:pointer}' +
        '.br-btn-ghost{background:rgba(255,255,255,.08);color:#cdd6f4}' +
        '.br-perr{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;padding:20px;text-align:center}' +
        '.br-perr-r{font-size:12px;color:#8a8fa8}.br-perr-hint{font-size:11px;color:#585b70;max-width:420px}' +
        '.br-perr-btns{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;justify-content:center}' +
        '.br-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:14px;color:#6c7086;font-size:13px}' +
        '.br-spinner{width:30px;height:30px;border:3px solid #313244;border-top-color:#89b4fa;border-radius:50%;animation:brspin .7s linear infinite}' +
        '.br-load-pct{font-size:22px;font-weight:200;color:#fff}.br-load-mode{font-size:11px;color:#6c7086}' +
        '.br-status{height:2px;position:relative;flex-shrink:0;overflow:hidden}' +
        '.br-prog{position:absolute;top:0;left:0;height:100%;width:100%;background:linear-gradient(90deg,transparent,#89b4fa,transparent);transform:translateX(-100%)}' +
        '.br-prog.loading{animation:brprog 1.1s ease-in-out infinite}' +
        '.br-pop{position:absolute;top:calc(100% + 8px);background:#141423;border:1px solid rgba(255,255,255,.1);border-radius:14px;box-shadow:0 16px 50px rgba(0,0,0,.55);z-index:50;overflow:hidden}' +
        '.br-suggest{left:0;right:0;min-width:280px}' +
        '.br-sug{display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;font-size:12px}' +
        '.br-sug:hover{background:rgba(137,180,250,.1)}.br-sug-ic{opacity:.6;width:16px;text-align:center;flex-shrink:0}' +
        '.br-sug-t{flex:1;color:#cdd6f4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.br-sug-u{color:#585b70;font-size:11px;flex-shrink:0;max-width:140px;overflow:hidden;text-overflow:ellipsis}' +
        '.br-hist-pop{right:0;width:320px;max-height:420px;overflow-y:auto;padding:10px}' +
        '.br-menu-pop{right:0;width:250px;padding:6px}' +
        '.br-site-pop{left:0;width:280px;padding:14px}' +
        '.br-find-pop{right:0;padding:8px;display:flex;gap:6px;align-items:center}' +
        '.br-find-pop input{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;padding:6px 10px;font-size:12px;outline:none;width:160px}' +
        '.br-pop-h{font-size:11px;color:#8a8fa8;padding:6px 8px;display:flex;justify-content:space-between;align-items:center;letter-spacing:1px}' +
        '.br-pop-empty{font-size:12px;color:#585b70;padding:10px}' +
        '.br-hist-item{display:flex;align-items:center;gap:8px;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;color:#cdd6f4}' +
        '.br-hist-item:hover{background:rgba(137,180,250,.09)}.br-hist-item.cur{background:rgba(137,180,250,.13)}.br-hist-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}' +
        '.br-mini{border:1px solid rgba(255,255,255,.12);background:transparent;color:#8a8fa8;font-size:10px;padding:3px 10px;border-radius:10px;cursor:pointer}' +
        '.br-menu-item{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-radius:9px;font-size:12px;color:#cdd6f4;cursor:pointer;gap:12px}' +
        '.br-menu-item:hover{background:rgba(137,180,250,.1)}' +
        '.br-kbd{font-size:10px;color:#585b70;background:rgba(255,255,255,.05);padding:2px 7px;border-radius:6px;white-space:nowrap}' +
        '.br-menu-sep{height:1px;background:rgba(255,255,255,.07);margin:5px 8px}' +
        '.br-menu-foot{font-size:10px;color:#585b70;padding:7px 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.br-site-url{font-size:14px;color:#fff;margin:4px 0 8px;word-break:break-all}' +
        '.br-site-row{font-size:11px;color:#8a8fa8;margin-bottom:8px}' +
        '.br-site-actions{display:flex;gap:8px;flex-wrap:wrap}.br-site-actions .br-btn{font-size:11px;padding:7px 14px}' +
        '.br-overview{position:absolute;inset:0;background:rgba(14,14,25,.96);z-index:20;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;padding:22px;overflow-y:auto;align-content:start}' +
        '.br-ov-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:16px 14px;cursor:pointer;position:relative;min-height:110px}' +
        '.br-ov-card:hover{border-color:rgba(137,180,250,.4)}.br-ov-card.cur{border-color:rgba(137,180,250,.6)}' +
        '.br-ov-ic{font-size:26px;margin-bottom:8px}.br-ov-ic img{border-radius:6px}' +
        '.br-ov-t{font-size:12px;color:#fff;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.br-ov-u{font-size:10px;color:#6c7086;margin-top:3px}' +
        '.br-ov-x{position:absolute;top:8px;right:10px;color:#6c7086;font-size:16px;padding:0 5px;border-radius:6px}.br-ov-x:hover{color:#f38ba8}' +
        '.br-ov-new{display:flex;align-items:center;justify-content:center;color:#8a8fa8;font-size:13px;border-style:dashed;min-height:110px}' +
        '.br-rd{background:#f4f1ea;position:absolute;inset:0;overflow-y:auto}' +
        '.br-rd-bar{position:sticky;top:0;display:flex;align-items:center;gap:10px;background:#f4f1ea;border-bottom:1px solid #ddd6c4;padding:10px 18px}' +
        '.br-rd-d{flex:1;font-size:12px;color:#8a7f63;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.br-rd-z{border:1px solid #c9c0a6;background:#fff;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px}' +
        '.br-rd-body{max-width:660px;margin:0 auto;padding:34px 30px 80px;color:#2b2620;font-family:Georgia,serif}' +
        '.br-rd-body h1{font-size:30px;margin-bottom:18px}' +
        '.br-rd-body p{line-height:1.85;margin-bottom:16px}' +
        '.br-rd-img{max-width:100%;border-radius:10px;margin:6px 0 18px}' +
        '.br-toast{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:#141423;border:1px solid rgba(255,255,255,.1);color:#cdd6f4;font-size:12px;padding:9px 18px;border-radius:12px;z-index:60}' +
        '</style>';
      body.querySelector('#br-back').onclick = back;
      body.querySelector('#br-fwd').onclick = fwd;
      body.querySelector('#br-reload').onclick = reloadStop;
      body.querySelector('#br-side-toggle').onclick = function() {
        sideOpen = !sideOpen;
        try { localStorage.setItem('aurora_browser_sidebar_open', sideOpen ? '1' : '0'); } catch (e) {}
        renderSide();
      };
      body.querySelector('#br-lock').onclick = function(e) { e.stopPropagation(); body.querySelector('#br-site-pop') ? closePop() : sitePop(); };
      body.querySelector('#br-star').onclick = toggleBM;
      body.querySelector('#br-reader').onclick = readerOn;
      body.querySelector('#br-share-btn').onclick = function(e) { e.stopPropagation(); body.querySelector('#br-share-pop') ? closePop() : sharePop(); };
      body.querySelector('#br-hist-btn').onclick = function(e) { e.stopPropagation(); histPop(); };
      body.querySelector('#br-overview-btn').onclick = function(e) { e.stopPropagation(); overview(); };
      body.querySelector('#br-menu-btn').onclick = function(e) { e.stopPropagation(); body.querySelector('#br-menu-pop') ? closePop() : menuPop(); };
      var inp = body.querySelector('#br-url-input');
      inp.addEventListener('focus', function() { inp.select(); suggest(); });
      inp.addEventListener('input', suggest);
      inp.addEventListener('blur', function() { setTimeout(closePop, 150); });
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { var v = inp.value.trim(); if (v) go(v); closePop(); inp.blur(); }
        else if (e.key === 'Escape') { inp.blur(); closePop(); }
      });
      document.addEventListener('click', function h(e) {
        if (!document.body.contains(body)) { document.removeEventListener('click', h); return; }
        if (!body.contains(e.target)) closePop();
      });
      document.addEventListener('keydown', function k(e) {
        if (!document.body.contains(body)) { document.removeEventListener('keydown', k); return; }
        var f = mgr.getFocused && mgr.getFocused();
        if (!f || f.id !== w.id) return;
        var kk = e.key.toLowerCase();
        if (e.ctrlKey && e.shiftKey && kk === 't') { e.preventDefault(); restoreClosed(); }
        else if (e.ctrlKey && e.shiftKey && kk === 'o') { e.preventDefault(); overview(); }
        else if (e.ctrlKey && e.shiftKey && kk === 'r') { e.preventDefault(); readerOn(); }
        else if (e.ctrlKey && kk === 't') { e.preventDefault(); mkTab(); }
        else if (e.ctrlKey && kk === 'w') { e.preventDefault(); var t = cur(); if (t) closeTab(t.id); }
        else if (e.ctrlKey && kk === 'r') { e.preventDefault(); reloadStop(); }
        else if (e.ctrlKey && kk === 'l') { e.preventDefault(); inp.focus(); inp.select(); }
        else if (e.ctrlKey && kk === 'h') { e.preventDefault(); histPop(); }
        else if (e.ctrlKey && kk === 'f') { e.preventDefault(); findBar(); }
        else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
        else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); fwd(); }
        else if (e.key === 'F5') { e.preventDefault(); reloadStop(); }
        else if (e.key === 'Escape') {
          var o = body.querySelector('#br-overview');
          if (o) { o.remove(); return; }
          var fb = body.querySelector('#br-find');
          if (fb) { fb.remove(); return; }
          closePop();
        }
      });
      w.onClose = function() { if (clockT) clearInterval(clockT); };
    }
    initUI();
    mkTab();
    clockT = setInterval(tick, 15000);
  }
});
