(function() {
  if (window.AuroraSettings) return;
  var KEY = 'aurora_settings';
  var DEF = {
    theme: 'dark', accent: '#89b4fa', wallpaper: 'aurora', iconsize: 'medium', scrollbar: 'auto',
    docksize: 64, magnification: true, dockmag: 62, dockpos: 'bottom', mineffect: 'scale',
    dockautohide: false, dockrecent: true, dockindicators: true, showwidgets: false,
    brightness: 80, nightshift: false, truetone: true, hdr: false, refresh: '60', rotation: '0',
    volume: 75, alertvol: 60, inputvol: 50, soundeffects: true, startupsound: true, volfeedback: true, spatial: true,
    voiceover: false, reducemotion: false, reducetransparency: false, increasecontrast: false,
    displayzoom: false, stickykeys_top: false, slowkeys_top: false, dblclick: 60, cursorsize: 2,
    invert: false, colorfilters: false, colorfilter: 'off', reducewhitepoint: false, reducedarkbright: false,
    boldtext: false, largertext: false, visiontext: 16, visioncursor: 2,
    kbdfullaccess: true, tabcontrols: true, motorrepeat: 30, motordelay: 50, ptrctrl: 'mouse',
    dwellclick: false, dwelltime: 3, stickykeys: false, slowkeys: false,
    mono: false, balance: 0, ledflash: false, flashscreen: false, noisecancel: true,
    headphone: false, bgsounds: false, bgsound: 'rain',
    mousetrack: 50, mousedbl: 60, mousescroll: 50, naturalscroll: true, secclick: true,
    smartzoom: true, twofinger: true, pointersize: 2, pointercolor: '#89b4fa',
    mousedpi: 1600, mousehanded: 'right',
    keyrepeat: 50, keydelay: 40, keybright: 80, backlight: true, fkeys: false, spotlightkey: true,
    autocorrect: true, dashhyphen: true, smartquotes: true,
    capslock: 'caps', ctrlkey: 'ctrl', optkey: 'opt', cmdkey: 'cmd', fnkey: 'fn',
    switchinputs: true, showinputmenu: true,
    notiflock: true, notifcenter: true, bannerstyle: 'banners', notifsound: true, badges: true,
    dnd: false,
    siri_enable: true, siri_listen: true, siri_lockscreen: true, siriresp: 'auto',
    siri_improve: false, siri_audio: false,
    siri_suggest: true, spotlock: false,
    wifi: true, autojoin: true, askjoin: false, privatewifi: true, bluetooth: true,
    airdrop: 'contacts', firewall_net: true,
    airdrop_mode: 'contacts', airdrop_from: 'everyone', handoff: true, handoff_icloud: true,
    nearby: true, shareacross: false,
    share_file: false, share_screen: false, share_ssh: false, share_remote_mgmt: false,
    share_airdrop: true, share_bt: false, share_airplay: true,
    autoset: true, calformat: 'iso', h24: true,
    lockpw: 'immediate', showuserpic: true, showclock: true, showmsg: false,
    lowpower: false, optimized: true, optimize: true, emptytrash: true,
    firewall: true, lockdown: false, dns_tls: true, dns_limit: true,
    perm_camera: true, perm_mic: true, perm_location: true, perm_contacts: false,
    perm_calendars: false, perm_mail: false, perm_files: true, perm_bluetooth: true,
    perm_notif: true, perm_analytics: false, perm_ads: false,
    notifapp_Finder: true, notifapp_Terminal: true, notifapp_Notes: true,
    notifapp_Calculator: false, notifapp_SystemSettings: true, notifapp_ActivityMonitor: false,
    spotcat_Applications: true, spotcat_Documents: true, spotcat_Folders: true, spotcat_Images: true,
    spotcat_Music: true, spotcat_Notes: true, spotcat_PDFs: true, spotcat_SystemSettings: true,
    spotcat_WebHistory: false, spotcat_Bookmarks: true, spotcat_EventsReminders: true, spotcat_Fonts: false
  };
  var FOCUS_NAMES = ['Sleep', 'Work', 'School', 'Personal', 'Gaming', 'Driving', 'Mindfulness', 'Custom'];
  FOCUS_NAMES.forEach(function(n) {
    DEF['focus_' + n + '_on'] = false;
    DEF['focus_' + n + '_hide'] = (n !== 'Personal' && n !== 'Custom');
    DEF['focus_' + n + '_calls'] = (n === 'Sleep' || n === 'School' || n === 'Mindfulness') ? 'none' : (n === 'Personal' || n === 'Custom' || n === 'Driving') ? 'everyone' : 'contacts';
    DEF['focus_' + n + '_sched'] = (n === 'Work' || n === 'School') ? 'time' : (n === 'Driving' ? 'location' : 'manual');
    DEF['focus_' + n + '_safari'] = (n === 'Personal' || n === 'Custom');
    DEF['focus_' + n + '_mail'] = (n === 'Work' || n === 'Personal' || n === 'Custom');
    DEF['focus_' + n + '_messages'] = (n === 'Personal' || n === 'Custom');
    DEF['focus_' + n + '_music'] = true;
  });
  var WP_BG = {
    aurora: 'linear-gradient(135deg,#1a1a3e,#2d4a6f,#4a6fa5)',
    sunrise: 'linear-gradient(135deg,#1a0a2e,#4a1942,#e8634a,#f9a825)',
    ocean: 'linear-gradient(135deg,#0a1628,#0d3b66,#1d6fa5,#48cae4)',
    forest: 'linear-gradient(135deg,#0a1a0a,#1a3a1a,#2d5a27,#4a8a3a)',
    sunset: 'linear-gradient(135deg,#1a0a2e,#6a1b4a,#e65100,#ff9800)',
    midnight: 'linear-gradient(135deg,#0a0a12,#1a1a2e,#16213e,#0f3460)',
    candy: 'linear-gradient(135deg,#e91e63,#9c27b0,#673ab7,#3f51b5)',
    mint: 'linear-gradient(135deg,#004d40,#00695c,#00897b,#26a69a)',
    peach: 'linear-gradient(135deg,#4a1a2e,#8e244e,#e65100,#ffb74d)'
  };
  function clone(o) { var n = {}; for (var k in o) n[k] = o[k]; return n; }
  function load() {
    var s = clone(DEF);
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var p = JSON.parse(raw); for (var k in p) s[k] = p[k]; }
      else {
        var la = localStorage.getItem('aurora_accent'); if (la) s.accent = la;
        var lw = localStorage.getItem('aurora_wallpaper'); if (lw) s.wallpaper = lw;
      }
    } catch (e) {}
    for (var d in DEF) if (s[d] === undefined) s[d] = DEF[d];
    return s;
  }
  var store = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }
  function get(k) { return (store[k] === undefined) ? DEF[k] : store[k]; }
  function set(k, v) { store[k] = v; save(); apply(); return v; }

  function ensureStyle() {
    if (document.getElementById('aurora-settings-extra')) return;
    var st = document.createElement('style');
    st.id = 'aurora-settings-extra';
    st.textContent =
      'html[data-theme="light"]{--bg:#e8eaf6;--surface:rgba(255,255,255,.88);--surface2:rgba(255,255,255,.94);--surface3:#d7d9e8;--text:#1c1c2e;--text2:#4c4c64;--text3:#8b8ba0;--shadow:0 22px 70px 4px rgba(60,60,120,.25),0 0 0 1px rgba(0,0,0,.05)}' +
      'html[data-theme="light"] #menubar{background:rgba(255,255,255,.85);border-bottom:1px solid rgba(0,0,0,.06)}' +
      'html[data-theme="light"] #dock{background:rgba(255,255,255,.85);border:1px solid rgba(0,0,0,.08)}' +
      'html[data-theme="light"] .win-titlebar{background:rgba(240,240,248,.95)}' +
      'html[data-theme="light"] .window.focused .win-titlebar{background:linear-gradient(180deg,rgba(250,250,255,.98),rgba(238,238,248,.98))}' +
      'body.reduce-motion *,body.reduce-motion *::before,body.reduce-motion *::after{animation:none!important;transition:none!important}' +
      'body.reduce-transparency *{backdrop-filter:none!important}' +
      'body.reduce-transparency .window,body.reduce-transparency #dock,body.reduce-transparency #menubar,body.reduce-transparency .notification{background:#23233a!important}' +
      'html[data-theme="light"] body.reduce-transparency .window,html[data-theme="light"] body.reduce-transparency #dock,html[data-theme="light"] body.reduce-transparency #menubar{background:#ffffff!important}' +
      'body.high-contrast{--text:#ffffff;--text2:#e0e0f0;--text3:#b8b8d0}' +
      'body.high-contrast .settings-row .label,body.high-contrast .settings-row .perm-label{font-weight:700}' +
      'body.bold-text .settings-row .label,body.bold-text .settings-row .perm-label,body.bold-text .menu-item,body.bold-text .s-item{font-weight:700!important}' +
      'body.larger-text .settings-content{font-size:15px}' +
      'body.invert-colors #desktop{filter:invert(1) hue-rotate(180deg)}' +
      'body.cf-grayscale #desktop{filter:grayscale(1)}' +
      'body.cf-protanopia #desktop{filter:sepia(.7) hue-rotate(-45deg) saturate(2.2)}' +
      'body.cf-deuteranopia #desktop{filter:sepia(.7) hue-rotate(60deg) saturate(2.2)}' +
      'body.cf-tritanopia #desktop{filter:sepia(.7) hue-rotate(160deg) saturate(2.2)}' +
      'body.low-power .orb{animation:none!important;opacity:.06!important}' +
      'body[data-indicators="off"] .dock-item .dot{display:none!important}' +
      '#dock-wrap[data-pos="left"]{left:8px;right:auto;top:50%;bottom:auto;transform:translateY(-50%)!important}' +
      '#dock-wrap[data-pos="right"]{left:auto;right:8px;top:50%;bottom:auto;transform:translateY(-50%)!important}' +
      '#dock-wrap[data-pos="left"] #dock,#dock-wrap[data-pos="right"] #dock{flex-direction:column}' +
      '#dock-wrap[data-pos="bottom"]{bottom:8px;top:auto;left:50%;transform:translateX(-50%)!important}' +
      '#dock-wrap.autohide{opacity:.07}' +
      '#dock-wrap.autohide:hover{opacity:1}' +
      'html[data-scrollbar="never"] ::-webkit-scrollbar{width:0!important;height:0!important}' +
      'html[data-scrollbar="always"] ::-webkit-scrollbar{width:12px!important;height:12px!important}' +
      '#aurora-brightness{position:fixed;inset:0;background:#000;pointer-events:none;z-index:99996;opacity:0}' +
      '#aurora-nightshift{position:fixed;inset:0;background:rgba(255,140,40,.22);mix-blend-mode:multiply;pointer-events:none;z-index:99995;display:none}' +
      '#aurora-flash{position:fixed;inset:0;background:#fff;pointer-events:none;z-index:99997;opacity:0;transition:opacity .3s}';
    document.head.appendChild(st);
  }

  function hexRgb(h) {
    h = (h || '#89b4fa').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function applyCursor() {
    var size = Math.max(1, Math.min(8, Number(get('pointersize')) || 2));
    var c = get('pointercolor') || '#89b4fa';
    var rgb = hexRgb(c);
    function tintCh(v) { return Math.round(v + (255 - v) * 0.72); }
    var tint = '#' + ((1 << 24) + (tintCh(rgb.r) << 16) + (tintCh(rgb.g) << 8) + tintCh(rgb.b)).toString(16).slice(1);
    var sc = size / 2, w = Math.max(14, Math.round(26 * sc)), h = Math.max(16, Math.round(28 * sc));
    var svg = "%3Csvg xmlns='http://www.w3.org/2000/svg' width='" + w + "' height='" + h + "' viewBox='0 0 28 28'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23ffffff'/%3E%3Cstop offset='1' stop-color='" + encodeURIComponent(tint) + "'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M6 5L6 23L11.5 18L14.5 25.5L17.8 24L14.8 16.8L21.5 16.8Z' fill='%23000000' opacity='.3'/%3E%3Cpath d='M4 3L4 21L9.5 16L12.5 23.5L15.8 22L12.8 14.8L19.5 14.8Z' fill='url(%23g)' stroke='%2314141f' stroke-width='1.6' stroke-linejoin='round'/%3E%3C/svg%3E";
    var css = 'html,body{cursor:url("data:image/svg+xml,' + svg + '") 4 3,auto!important}' +
      'a,.dock-item,.nav-item,.menu-item,.cm-item,.finder-item,.finder-list-row,.ns-item,.s-item,.tm-row,.tl-btn,.nv-btn,.ns-add,.result-item,.toggle,.seg-opt,.color-dot,.wp-thumb{cursor:url("data:image/svg+xml,' + svg + '") 4 3,pointer!important}';
    var el = document.getElementById('aurora-cursor-style');
    if (!el) { el = document.createElement('style'); el.id = 'aurora-cursor-style'; document.head.appendChild(el); }
    el.textContent = css;
  }

  function apply() {
    ensureStyle();
    var de = document.documentElement, bd = document.body;
    var theme = get('theme');
    if (theme === 'auto') {
      try { theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark'; }
      catch (e) { theme = 'dark'; }
    }
    de.setAttribute('data-theme', theme);
    var accent = get('accent') || '#89b4fa';
    de.style.setProperty('--accent', accent);
    try { localStorage.setItem('aurora_accent', accent); } catch (e) {}
    var wp = get('wallpaper');
    var art = document.querySelector('.wallpaper-art');
    if (art && WP_BG[wp]) art.style.background = WP_BG[wp];
    var szMap = { small: '13px', medium: '16px', large: '20px' };
    bd.setAttribute('data-iconsize', get('iconsize'));
    var icss = document.getElementById('aurora-iconsize-style');
    if (!icss) { icss = document.createElement('style'); icss.id = 'aurora-iconsize-style'; document.head.appendChild(icss); }
    icss.textContent = '.settings-sidebar .s-icon{font-size:' + (szMap[get('iconsize')] || '16px') + '!important}.finder-sidebar .nav-icon{font-size:' + (szMap[get('iconsize')] || '15px') + '!important}';
    de.setAttribute('data-scrollbar', get('scrollbar'));
    var dock = document.getElementById('dock'), wrap = document.getElementById('dock-wrap');
    var ds = Math.max(36, Math.min(128, Number(get('docksize')) || 64));
    var dm = Math.max(36, Math.min(128, Number(get('dockmag')) || 62));
    if (dock) {
      dock.classList.toggle('mag', !!get('magnification'));
      dock.style.setProperty('--dock-mag', dm + 'px');
      var icons = dock.querySelectorAll('.icon');
      for (var i = 0; i < icons.length; i++) {
        icons[i].style.width = ds + 'px'; icons[i].style.height = ds + 'px';
        icons[i].style.fontSize = Math.round(ds * 0.48) + 'px';
      }
    }
    if (wrap) {
      wrap.setAttribute('data-pos', get('dockpos'));
      wrap.classList.toggle('autohide', !!get('dockautohide'));
    }
    bd.setAttribute('data-mineffect', get('mineffect'));
    bd.setAttribute('data-indicators', get('dockindicators') ? 'on' : 'off');
    bd.setAttribute('data-recent', get('dockrecent') ? 'on' : 'off');
    bd.setAttribute('data-widgets', get('showwidgets') ? 'on' : 'off');
    var b = document.getElementById('aurora-brightness');
    if (!b) { b = document.createElement('div'); b.id = 'aurora-brightness'; document.body.appendChild(b); }
    b.style.opacity = String(((100 - (Number(get('brightness')) || 0)) / 100) * 0.75);
    var ns = document.getElementById('aurora-nightshift');
    if (!ns) { ns = document.createElement('div'); ns.id = 'aurora-nightshift'; document.body.appendChild(ns); }
    ns.style.display = get('nightshift') ? 'block' : 'none';
    bd.setAttribute('data-truetone', get('truetone') ? 'on' : 'off');
    bd.setAttribute('data-hdr', get('hdr') ? 'on' : 'off');
    bd.setAttribute('data-rotation', String(get('rotation')));
    bd.setAttribute('data-refresh', String(get('refresh')));
    bd.classList.toggle('reduce-motion', !!get('reducemotion'));
    bd.classList.toggle('reduce-transparency', !!get('reducetransparency'));
    bd.classList.toggle('high-contrast', !!get('increasecontrast'));
    bd.classList.toggle('bold-text', !!get('boldtext'));
    bd.classList.toggle('larger-text', !!(get('largertext')));
    bd.classList.toggle('invert-colors', !!get('invert'));
    bd.classList.remove('cf-grayscale', 'cf-protanopia', 'cf-deuteranopia', 'cf-tritanopia');
    if (get('colorfilters') && get('colorfilter') && get('colorfilter') !== 'off') bd.classList.add('cf-' + get('colorfilter'));
    var vt = Math.max(12, Math.min(28, Number(get('visiontext')) || 16));
    de.style.fontSize = '';
    try { de.style.setProperty('--settings-text-size', vt + 'pt'); } catch (e) {}
    bd.setAttribute('data-voiceover', get('voiceover') ? 'on' : 'off');
    bd.setAttribute('data-mono', get('mono') ? 'on' : 'off');
    bd.setAttribute('data-balance', String(get('balance')));
    bd.classList.toggle('low-power', !!get('lowpower'));
    var desk = document.getElementById('desktop');
    if (desk) desk.style.zoom = get('displayzoom') ? '1.15' : '';
    applyCursor();
    var mf = document.getElementById('menu-focus');
    if (mf) mf.style.opacity = get('dnd') ? '.35' : '';
    var mw = document.getElementById('menu-wifi');
    if (mw) mw.style.opacity = get('wifi') ? '' : '.35';
    var mb = document.getElementById('menu-battery');
    if (mb) mb.style.opacity = get('lowpower') ? '.6' : '';
    bd.setAttribute('data-dnd', get('dnd') ? 'on' : 'off');
    bd.setAttribute('data-siri', get('siri_enable') ? 'on' : 'off');
    bd.setAttribute('data-lockdown', get('lockdown') ? 'on' : 'off');
    bd.setAttribute('data-firewall', get('firewall') ? 'on' : 'off');
    bd.setAttribute('data-backlight', get('backlight') ? 'on' : 'off');
  }

  window.AuroraSettings = {
    get: get, set: set, apply: apply,
    all: function() { return clone(store); },
    reset: function() { store = clone(DEF); save(); apply(); },
    key: KEY, defaults: clone(DEF)
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else { try { apply(); } catch (e) {} }
})();

AppManager.register('settings', {
  name: 'System Settings',
  icon: '&#9881;',
  color: 'linear-gradient(135deg,#cba6f7,#b4befe)',
  create: function(mgr) {
    var S = window.AuroraSettings;
    function get(k) { return S.get(k); }
    function set(k, v) { return S.set(k, v); }
    try {
      var _mm = JSON.parse(localStorage.getItem('aurora_mouse') || '{}');
      if (_mm) {
        if (Number(_mm.dpi) >= 400 && Number(_mm.dpi) <= 3200) S.set('mousedpi', Number(_mm.dpi));
        if (_mm.leftHanded === true) S.set('mousehanded', 'left');
        else if (_mm.leftHanded === false) S.set('mousehanded', 'right');
      }
    } catch (e) {}
    var w = mgr.createWindow({ appId: 'settings', title: 'System Settings', width: 680, height: 500 });
    var body = w.bodyEl;
    var userName = localStorage.getItem('aurora_username') || 'User';

    var sections = [
      { id: 'general', icon: '&#9881;', name: 'General' },
      { id: 'appearance', icon: '&#127912;', name: 'Appearance' },
      { id: 'accessibility', icon: '&#9855;', name: 'Accessibility' },
      { id: 'desktop', icon: '&#127968;', name: 'Desktop & Dock' },
      { id: 'displays', icon: '&#128421;', name: 'Displays' },
      { id: 'wallpaper', icon: '&#127748;', name: 'Wallpaper' },
      { id: 'battery', icon: '&#128267;', name: 'Battery' },
      { id: 'lockscreen', icon: '&#128274;', name: 'Lock Screen' },
      { id: 'privacy', icon: '&#128737;', name: 'Privacy & Security' },
      { id: 'keyboard', icon: '&#9000;', name: 'Keyboard' },
      { id: 'mouse', icon: '&#128433;', name: 'Mouse' },
      { id: 'sound', icon: '&#128266;', name: 'Sound' },
      { id: 'notifications', icon: '&#128276;', name: 'Notifications' },
      { id: 'focus', icon: '&#127769;', name: 'Focus' },
      { id: 'siri', icon: '&#128172;', name: 'Siri' },
      { id: 'spotlight', icon: '&#128269;', name: 'Spotlight' },
      { id: 'network', icon: '&#127760;', name: 'Network' },
      { id: 'storage', icon: '&#128190;', name: 'Storage' },
      { id: 'about', icon: '&#10022;', name: 'About Aurora' }
    ];
    var cur = 'general';
    var accentColors = ['#89b4fa','#cba6f7','#f38ba8','#fab387','#f9e2af','#a6e3a1','#94e2d5','#f5c2e7'];

    var wallpapers = [
      { id: 'aurora', name: 'Aurora', bg: 'linear-gradient(135deg,#1a1a3e,#2d4a6f,#4a6fa5)' },
      { id: 'sunrise', name: 'Sunrise', bg: 'linear-gradient(135deg,#1a0a2e,#4a1942,#e8634a,#f9a825)' },
      { id: 'ocean', name: 'Ocean', bg: 'linear-gradient(135deg,#0a1628,#0d3b66,#1d6fa5,#48cae4)' },
      { id: 'forest', name: 'Forest', bg: 'linear-gradient(135deg,#0a1a0a,#1a3a1a,#2d5a27,#4a8a3a)' },
      { id: 'sunset', name: 'Sunset', bg: 'linear-gradient(135deg,#1a0a2e,#6a1b4a,#e65100,#ff9800)' },
      { id: 'midnight', name: 'Midnight', bg: 'linear-gradient(135deg,#0a0a12,#1a1a2e,#16213e,#0f3460)' },
      { id: 'candy', name: 'Candy', bg: 'linear-gradient(135deg,#e91e63,#9c27b0,#673ab7,#3f51b5)' },
      { id: 'mint', name: 'Mint', bg: 'linear-gradient(135deg,#004d40,#00695c,#00897b,#26a69a)' },
      { id: 'peach', name: 'Peach', bg: 'linear-gradient(135deg,#4a1a2e,#8e244e,#e65100,#ffb74d)' }
    ];

    function showToast(msg) {
      if (get('dnd')) { try { console.info('[Aurora] toast suppressed by Do Not Disturb:', msg); } catch (e) {} return; }
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%) translateY(20px);background:rgba(30,30,46,.95);color:#cdd6f4;padding:10px 20px;border-radius:10px;font-size:13px;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(10px);opacity:0;transition:all .3s cubic-bezier(.16,1,.3,1)';
      t.textContent = msg;
      document.body.appendChild(t);
      requestAnimationFrame(function() { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
      setTimeout(function() {
        t.style.opacity = '0';
        t.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(function() { t.remove(); }, 300);
      }, 2000);
    }

    function tg(key) {
      return '<div class="toggle' + (get(key) ? ' on' : '') + '" data-setting="' + key + '"></div>';
    }

    function makeSeg(id, opts, selected) {
      var h = '<div class="settings-segmented" data-seg="' + id + '">';
      opts.forEach(function(o) { h += '<div class="seg-opt' + (String(o.val) === String(selected) ? ' active' : '') + '" data-val="' + o.val + '">' + o.label + '</div>'; });
      return h + '</div>';
    }
    function sg(id, opts) { return makeSeg(id, opts, get(id)); }

    function makeSlider(id, min, max, val, unit, step) {
      return '<input type="range" class="settings-slider" data-slider="' + id + '" min="' + min + '" max="' + max + '" value="' + val + '"' + (step ? ' step="' + step + '"' : '') + '><span class="settings-slider-val">' + val + (unit || '') + '</span>';
    }
    function sl(id, min, max, unit, step) { return makeSlider(id, min, max, get(id), unit, step); }

    var _ac = null, _lastBeep = 0;
    function beep(vol) {
      try {
        var now = Date.now();
        if (now - _lastBeep < 90) return;
        _lastBeep = now;
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        _ac = _ac || new Ctx();
        if (_ac.state === 'suspended') _ac.resume();
        var o = _ac.createOscillator(), g = _ac.createGain();
        o.connect(g); g.connect(_ac.destination);
        o.frequency.value = 880;
        g.gain.value = Math.max(0.001, ((Number(vol) || 50) / 100) * 0.2);
        o.start();
        g.gain.exponentialRampToValueAtTime(0.0001, _ac.currentTime + 0.25);
        o.stop(_ac.currentTime + 0.26);
      } catch (e) {}
    }
    function flashScreen() {
      var f = document.getElementById('aurora-flash');
      if (!f) { f = document.createElement('div'); f.id = 'aurora-flash'; document.body.appendChild(f); }
      if (!get('flashscreen')) return;
      f.style.opacity = '0.7';
      setTimeout(function() { f.style.opacity = '0'; }, 120);
    }

    function mouseCounters() {
      try {
        var m = JSON.parse(localStorage.getItem('aurora_mouse') || '{}');
        return { left: Number(m.left) || 0, right: Number(m.right) || 0, scrolls: Number(m.scrolls) || 0 };
      } catch (e) { return { left: 0, right: 0, scrolls: 0 }; }
    }

    function syncMouseStore() {
      try {
        var m = {};
        try { m = JSON.parse(localStorage.getItem('aurora_mouse') || '{}'); } catch (e) { m = {}; }
        m.dpi = Math.max(400, Math.min(3200, Number(get('mousedpi')) || 1600));
        m.leftHanded = get('mousehanded') === 'left';
        localStorage.setItem('aurora_mouse', JSON.stringify(m));
      } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('aurora-mouse-sync')); } catch (e) {}
    }

    var TOAST_ON_CHANGE = {
      truetone: 'True Tone', hdr: 'HDR', rotation: 'Display rotation', refresh: 'Refresh rate',
      mineffect: 'Minimize effect', dockpos: 'Dock position', theme: 'Appearance',
      airdrop: 'AirDrop setting', colorfilter: 'Color filter', bgsound: 'Background sound'
    };

    var contents = {};

    contents.general =
      '<h2>General</h2>' +
      '<div class="settings-group">' +
        '<div class="settings-row" data-nav="about" style="cursor:pointer"><span class="icon-left">&#128196;</span><span class="label">About</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128260;</span><span class="label">Software Update</span><span class="value" style="color:var(--green)">Up to Date</span></div>' +
        '<div class="settings-row" data-nav="storage" style="cursor:pointer"><span class="icon-left">&#128190;</span><span class="label">Storage</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="general/airdrop" style="cursor:pointer"><span class="icon-left">&#128225;</span><span class="label">AirDrop & Handoff</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128260;</span><span class="label">Login Items</span><span class="value">3 items</span></div>' +
        '<div class="settings-row" data-sub="general/datetime" style="cursor:pointer"><span class="icon-left">&#128197;</span><span class="label">Date & Time</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="general/sharing" style="cursor:pointer"><span class="icon-left">&#128228;</span><span class="label">Sharing</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="general/reset" style="cursor:pointer"><span class="icon-left">&#128260;</span><span class="label">Transfer or Reset</span><span class="value">&#8250;</span></div>' +
      '</div>';

    contents.appearance =
      '<h2>Appearance</h2>' +
      '<div class="settings-subtitle">Customize the look and feel of Aurora OS</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#127774;</span><span class="label">Appearance</span>' +
          sg('theme', [{val:'dark',label:'Dark'},{val:'light',label:'Light'},{val:'auto',label:'Auto'}]) +
        '</div>' +
        '<div class="settings-row"><span class="icon-left">&#127912;</span><span class="label">Accent Color</span>' +
          '<div class="settings-colors" id="settings-accent-colors"></div>' +
        '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128065;</span><span class="label">Sidebar Icon Size</span>' +
          sg('iconsize', [{val:'small',label:'S'},{val:'medium',label:'M'},{val:'large',label:'L'}]) +
        '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128386;</span><span class="label">Scroll Bar</span>' +
          sg('scrollbar', [{val:'auto',label:'Auto'},{val:'always',label:'Always'},{val:'never',label:'Never'}]) +
        '</div>' +
      '</div>';

    contents.accessibility =
      '<h2>Accessibility</h2>' +
      '<div class="settings-subtitle">Make Aurora OS work the way you need</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row" data-sub="accessibility/vision" style="cursor:pointer"><span class="icon-left">&#128065;</span><span class="label">Vision</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="accessibility/motor" style="cursor:pointer"><span class="icon-left">&#129460;</span><span class="label">Motor</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="accessibility/hearing" style="cursor:pointer"><span class="icon-left">&#128266;</span><span class="label">Hearing</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128161;</span><span class="label">VoiceOver</span>' + tg('voiceover') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128161;</span><span class="label">Reduce Motion</span>' + tg('reducemotion') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128161;</span><span class="label">Reduce Transparency</span>' + tg('reducetransparency') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128161;</span><span class="label">Increase Contrast</span>' + tg('increasecontrast') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128065;</span><span class="label">Display Zoom</span>' + tg('displayzoom') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Sticky Keys</span>' + tg('stickykeys_top') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Slow Keys</span>' + tg('slowkeys_top') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128433;</span><span class="label">Double-Click Speed</span>' + sl('dblclick', 0, 100, '') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128164;</span><span class="label">Cursor Size</span>' + sl('cursorsize', 1, 5, 'x') + '</div>' +
      '</div>';

    contents.desktop =
      '<h2>Desktop & Dock</h2>' +
      '<div class="settings-subtitle">Customize the Dock and desktop behavior</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128200;</span><span class="label">Dock Size</span>' + sl('docksize', 36, 128, 'px') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128269;</span><span class="label">Magnification</span>' + tg('magnification') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128200;</span><span class="label">Magnify Size</span>' + sl('dockmag', 36, 128, 'px') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128205;</span><span class="label">Position on Screen</span>' +
          sg('dockpos', [{val:'bottom',label:'Bottom'},{val:'left',label:'Left'},{val:'right',label:'Right'}]) +
        '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128230;</span><span class="label">Minimize Effect</span>' +
          sg('mineffect', [{val:'scale',label:'Scale'},{val:'genie',label:'Genie'}]) +
        '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128269;</span><span class="label">Automatically Hide</span>' + tg('dockautohide') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128269;</span><span class="label">Show Recent Applications</span>' + tg('dockrecent') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128193;</span><span class="label">Show Indicators</span>' + tg('dockindicators') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#127968;</span><span class="label">Show Widgets</span>' + tg('showwidgets') + '</div>' +
      '</div>';

    contents.displays =
      '<h2>Displays</h2>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128421;</span><span class="label">Resolution</span><span class="value js-live-res">' + window.innerWidth + ' x ' + window.innerHeight + '</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128200;</span><span class="label">Refresh Rate</span>' +
          sg('refresh', [{val:'60',label:'60 Hz'},{val:'90',label:'90 Hz'},{val:'120',label:'120 Hz'}]) +
        '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128161;</span><span class="label">Brightness</span>' + sl('brightness', 0, 100, '%') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#127752;</span><span class="label">True Tone</span>' + tg('truetone') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#127749;</span><span class="label">Night Shift</span>' + tg('nightshift') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#127912;</span><span class="label">Color Profile</span><span class="value">Aurora Display P3</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128424;</span><span class="label">HDR</span>' + tg('hdr') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128187;</span><span class="label">Rotation</span>' +
          sg('rotation', [{val:'0',label:'0\u00b0'},{val:'90',label:'90\u00b0'},{val:'180',label:'180\u00b0'},{val:'270',label:'270\u00b0'}]) +
        '</div>' +
      '</div>';

    contents.wallpaper =
      '<h2>Wallpaper</h2>' +
      '<div class="settings-subtitle">Choose a wallpaper for your desktop</div>' +
      '<div class="settings-group" style="padding:18px">' +
        '<div class="settings-wallpaper-grid" id="settings-wallpaper-grid"></div>' +
      '</div>';

    contents.battery =
      '<h2>Battery</h2>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128267;</span><span class="label">Battery Level</span><span class="value" style="color:var(--green)">100%</span></div>' +
        '<div class="settings-row" style="flex-direction:column;align-items:stretch;padding:18px">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:var(--text3)">Current Charge</span><span style="font-size:12px;color:var(--green)">Full</span></div>' +
          '<div class="settings-progress"><div class="settings-progress-fill" style="width:100%;background:linear-gradient(90deg,var(--green),var(--accent))"></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128164;</span><span class="label">Low Power Mode</span>' + tg('lowpower') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128267;</span><span class="label">Optimized Battery Charging</span>' + tg('optimized') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128161;</span><span class="label">Display Sleep</span><span class="value">10 min</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128164;</span><span class="label">Computer Sleep</span><span class="value">30 min</span></div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row" style="flex-direction:column;align-items:stretch;padding:18px">' +
          '<div style="font-size:12px;color:var(--text3);margin-bottom:10px">Battery Usage (Last 24 Hours)</div>' +
          '<div style="display:flex;align-items:flex-end;gap:3px;height:60px" id="battery-chart"></div>' +
        '</div>' +
      '</div>';

    contents.lockscreen =
      '<h2>Lock Screen</h2>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#9201;</span><span class="label">Start Screen Saver After</span><span class="value">5 Minutes</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128274;</span><span class="label">Require Password</span>' +
          sg('lockpw', [{val:'immediate',label:'Immediately'},{val:'5s',label:'5 sec'},{val:'1m',label:'1 min'},{val:'5m',label:'5 min'}]) +
        '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128247;</span><span class="label">Show Login User Picture</span>' + tg('showuserpic') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128221;</span><span class="label">Show Clock on Lock Screen</span>' + tg('showclock') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">Show Message on Lock Screen</span>' + tg('showmsg') + '</div>' +
      '</div>';

    function permRow(key, icon, label) {
      var on = get(key);
      return '<div class="settings-perm-row"><span class="icon-left">' + icon + '</span><span class="perm-label">' + label + '</span>' +
        '<span class="perm-status ' + (on ? 'granted' : 'denied') + '">' + (on ? 'Allowed' : 'Denied') + '</span>' +
        '<div class="toggle' + (on ? ' on' : '') + '" data-setting="' + key + '" data-perm="' + key + '"></div></div>';
    }

    contents.privacy =
      '<h2>Privacy & Security</h2>' +
      '<div class="settings-subtitle">Control which apps can access your data</div>' +
      '<div class="settings-group">' +
        permRow('perm_camera', '&#128247;', 'Camera') +
        permRow('perm_mic', '&#127908;', 'Microphone') +
        permRow('perm_location', '&#128205;', 'Location Services') +
        permRow('perm_contacts', '&#128246;', 'Contacts') +
        permRow('perm_calendars', '&#128197;', 'Calendars') +
        permRow('perm_mail', '&#128231;', 'Mail') +
        permRow('perm_files', '&#128196;', 'Files & Folders') +
        permRow('perm_bluetooth', '&#128246;', 'Bluetooth') +
        permRow('perm_notif', '&#128276;', 'Notifications') +
        permRow('perm_analytics', '&#128274;', 'Analytics & Improvements') +
        permRow('perm_ads', '&#128274;', 'Advertising') +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128274;</span><span class="label">FileVault</span><span class="value" style="color:var(--green)">On</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128737;</span><span class="label">Firewall</span>' + tg('firewall') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128274;</span><span class="label">Lockdown Mode</span>' + tg('lockdown') + '</div>' +
      '</div>';

    contents.keyboard =
      '<h2>Keyboard</h2>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Key Repeat Rate</span>' + sl('keyrepeat', 0, 100, '') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Delay Until Repeat</span>' + sl('keydelay', 0, 100, '') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Keyboard Brightness</span>' + sl('keybright', 0, 100, '%') + '</div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#127912;</span><span class="label">Keyboard Backlight</span>' + tg('backlight') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Use F1/F2 as Standard Keys</span>' + tg('fkeys') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Press \u2318 for Spotlight</span>' + tg('spotlightkey') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Correct Spelling Automatically</span>' + tg('autocorrect') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Smart Dash & Hyphens</span>' + tg('dashhyphen') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Smart Quotes</span>' + tg('smartquotes') + '</div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row" data-sub="keyboard/modifiers" style="cursor:pointer"><span class="icon-left">&#9000;</span><span class="label">Modifier Keys</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="keyboard/textinput" style="cursor:pointer"><span class="icon-left">&#9000;</span><span class="label">Text Input Sources</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="keyboard/shortcuts" style="cursor:pointer"><span class="icon-left">&#9000;</span><span class="label">Keyboard Shortcuts</span><span class="value">&#8250;</span></div>' +
      '</div>';

    contents.mouse =
      '<h2>Mouse</h2>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128433;</span><span class="label">Tracking Speed</span>' + sl('mousetrack', 0, 100, '') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128433;</span><span class="label">Double-Click Speed</span>' + sl('mousedbl', 0, 100, '') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128433;</span><span class="label">Scrolling Speed</span>' + sl('mousescroll', 0, 100, '') + '</div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128269;</span><span class="label">Natural Scrolling</span>' + tg('naturalscroll') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128269;</span><span class="label">Secondary Click (Right)</span>' + tg('secclick') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128269;</span><span class="label">Smart Zoom</span>' + tg('smartzoom') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128269;</span><span class="label">Click with Two Fingers</span>' + tg('twofinger') + '</div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#127912;</span><span class="label">Pointer Size</span>' + sl('pointersize', 1, 5, 'x') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#127912;</span><span class="label">Pointer Color</span>' +
          '<div class="settings-colors" id="settings-pointer-colors"></div>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">Mouse App \u00b7 shared with the Mouse app</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128433;</span><span class="label">DPI</span>' + sl('mousedpi', 400, 3200, ' DPI', 100) + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128433;</span><span class="label">Handedness</span>' +
          sg('mousehanded', [{val:'right',label:'Right-handed'},{val:'left',label:'Left-handed'}]) +
        '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128202;</span><span class="label">Button Clicks</span><span class="value" id="mouse-click-count">0 left \u00b7 0 right \u00b7 0 scrolls</span></div>' +
        '<div class="settings-row" style="cursor:pointer" data-action="mouse-reset"><span class="icon-left">&#128260;</span><span class="label">Reset Click Counters</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-action="mouse-open" style="cursor:pointer"><span class="icon-left">&#128433;</span><span class="label">Open Mouse App</span><span class="value">&#8250;</span></div>' +
      '</div>';

    contents.sound =
      '<h2>Sound</h2>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128266;</span><span class="label">Output Volume</span>' + sl('volume', 0, 100, '%') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128264;</span><span class="label">Alert Volume</span>' + sl('alertvol', 0, 100, '%') + '</div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128264;</span><span class="label">Output Device</span><span class="value">Internal Speakers</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#127908;</span><span class="label">Input Device</span><span class="value">Internal Microphone</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#127908;</span><span class="label">Input Volume</span>' + sl('inputvol', 0, 100, '%') + '</div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128264;</span><span class="label">Sound Effects</span>' + tg('soundeffects') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#127925;</span><span class="label">Alert Sound</span><span class="value">Aurora</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128264;</span><span class="label">Play Sound on Startup</span>' + tg('startupsound') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128264;</span><span class="label">Play Feedback When Volume Changed</span>' + tg('volfeedback') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128264;</span><span class="label">Spatial Audio</span>' + tg('spatial') + '</div>' +
      '</div>';

    contents.notifications =
      '<h2>Notifications</h2>' +
      '<div class="settings-subtitle">Choose how apps deliver notifications</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128276;</span><span class="label">Show Notifications on Lock Screen</span>' + tg('notiflock') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128276;</span><span class="label">Show in Notification Center</span>' + tg('notifcenter') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128276;</span><span class="label">Banner Style</span>' +
          sg('bannerstyle', [{val:'banners',label:'Banners'},{val:'alerts',label:'Alerts'}]) +
        '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128276;</span><span class="label">Sound</span>' + tg('notifsound') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128276;</span><span class="label">Badges</span>' + tg('badges') + '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">App Notification Settings</div>' +
      '<div class="settings-group" id="settings-notif-apps"></div>';

    contents.focus =
      '<h2>Focus</h2>' +
      '<div class="settings-subtitle">Manage Do Not Disturb and Focus modes</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#127769;</span><span class="label">Do Not Disturb</span>' + tg('dnd') + '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">Focus Modes</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row" data-sub="focus/sleep" style="cursor:pointer"><span class="icon-left">&#128164;</span><span class="label">Sleep</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="focus/work" style="cursor:pointer"><span class="icon-left">&#128218;</span><span class="label">Work</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="focus/school" style="cursor:pointer"><span class="icon-left">&#127891;</span><span class="label">School</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="focus/personal" style="cursor:pointer"><span class="icon-left">&#9918;</span><span class="label">Personal</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="focus/gaming" style="cursor:pointer"><span class="icon-left">&#128247;</span><span class="label">Gaming</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="focus/driving" style="cursor:pointer"><span class="icon-left">&#127860;</span><span class="label">Driving</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="focus/mindfulness" style="cursor:pointer"><span class="icon-left">&#128161;</span><span class="label">Mindfulness</span><span class="value">&#8250;</span></div>' +
        '<div class="settings-row" data-sub="focus/custom" style="cursor:pointer"><span class="icon-left">&#10024;</span><span class="label">Custom</span><span class="value">&#8250;</span></div>' +
      '</div>';

    contents.siri =
      '<h2>Siri</h2>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">Enable Siri</span>' + tg('siri_enable') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">Listen for "Hey Siri"</span>' + tg('siri_listen') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128241;</span><span class="label">Allow on Lock Screen</span>' + tg('siri_lockscreen') + '</div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#127908;</span><span class="label">Siri Voice</span><span class="value">Voice 4</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#127908;</span><span class="label">Language</span><span class="value">English (US)</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">Siri Responses</span>' +
          sg('siriresp', [{val:'auto',label:'Automatic'},{val:'on',label:'Always On'},{val:'off',label:'Off'}]) +
        '</div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row" data-sub="siri/history" style="cursor:pointer"><span class="icon-left">&#128241;</span><span class="label">Siri & Dictation History</span><span class="value">&#8250;</span></div>' +
      '</div>';

    contents.spotlight =
      '<h2>Spotlight</h2>' +
      '<div class="settings-subtitle">Configure search results in Spotlight</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128269;</span><span class="label">Siri Suggestions</span>' + tg('siri_suggest') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128269;</span><span class="label">Allow on Lock Screen</span>' + tg('spotlock') + '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">Search Categories</div>' +
      '<div class="settings-group" id="spotlight-cats"></div>';

    contents.network =
      '<h2>Network</h2>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128246;</span><span class="label">Wi-Fi</span><span class="value" style="color:var(--green)" id="wifi-status">On</span>' + tg('wifi') + '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin:14px 0 8px"><span style="font-size:12px;color:var(--text3)">Known Networks</span><button class="settings-btn" id="wifi-scan-btn" style="padding:4px 12px;font-size:11px">&#8635; Scan</button></div>' +
      '<div class="settings-group" id="wifi-network-list">' +
        '<div class="settings-row" style="justify-content:center;color:var(--text3);padding:24px;font-size:12px">Scanning for networks...</div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128246;</span><span class="label">Auto-Join</span>' + tg('autojoin') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128246;</span><span class="label">Ask to Join Networks</span>' + tg('askjoin') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128246;</span><span class="label">Private Wi-Fi Address</span>' + tg('privatewifi') + '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">Other Connections</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128246;</span><span class="label">Bluetooth</span><span class="value" style="color:var(--green)">On</span>' + tg('bluetooth') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128246;</span><span class="label">AirDrop</span>' +
          sg('airdrop', [{val:'off',label:'Off'},{val:'contacts',label:'Contacts'},{val:'everyone',label:'Everyone'}]) +
        '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128737;</span><span class="label">Firewall</span>' + tg('firewall_net') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128737;</span><span class="label">VPN</span><span class="value">Not Connected</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128246;</span><span class="label">Proxy</span><span class="value">Off</span></div>' +
        '<div class="settings-row" data-sub="network/dns" style="cursor:pointer"><span class="icon-left">&#127760;</span><span class="label">DNS</span><span class="value">&#8250;</span></div>' +
      '</div>';

    contents.storage =
      '<h2>Storage</h2>' +
      '<div class="settings-subtitle">Manage your storage and files</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row" style="flex-direction:column;align-items:stretch;padding:18px">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:13px">16 MB Capacity</span><span style="font-size:12px;color:var(--green)">15.8 MB Available</span></div>' +
          '<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;gap:2px" id="storage-bar"></div>' +
        '</div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left" style="color:#89b4fa">&#9679;</span><span class="label">System</span><span class="value">240 KB</span></div>' +
        '<div class="settings-row"><span class="icon-left" style="color:#cba6f7">&#9679;</span><span class="label">Applications</span><span class="value">12 KB</span></div>' +
        '<div class="settings-row"><span class="icon-left" style="color:#a6e3a1">&#9679;</span><span class="label">Documents</span><span class="value">4.8 KB</span></div>' +
        '<div class="settings-row"><span class="icon-left" style="color:#f9e2af">&#9679;</span><span class="label">Other</span><span class="value">1.2 KB</span></div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128260;</span><span class="label">Optimize Storage</span>' + tg('optimize') + '</div>' +
        '<div class="settings-row"><span class="icon-left">&#128465;</span><span class="label">Store in iCloud</span><span class="value">Off</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#9940;</span><span class="label">Empty Trash Automatically</span>' + tg('emptytrash') + '</div>' +
      '</div>';

    contents.about =
      '<h2>About Aurora</h2>' +
      '<div class="settings-info"><div class="si-icon" style="background:linear-gradient(135deg,#89b4fa,#cba6f7)">&#10022;</div><div class="si-text"><h3>Aurora OS</h3><p>Version 0.1.0 (Dawn)</p></div></div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128196;</span><span class="label">OS Name</span><span class="value">Aurora OS</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128196;</span><span class="label">Version</span><span class="value">v0.1.0 (Dawn)</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128187;</span><span class="label">Kernel</span><span class="value">AISA-64</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128295;</span><span class="label">Build</span><span class="value">2026.07.12</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128100;</span><span class="label">Owner</span><span class="value">' + userName + '</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128736;</span><span class="label">Architecture</span><span class="value">Custom (AISA-64)</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128190;</span><span class="label">Memory</span><span class="value">16 MB</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128421;</span><span class="label">Display</span><span class="value js-live-res">' + window.innerWidth + ' x ' + window.innerHeight + '</span></div>' +
      '</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span class="icon-left">&#128196;</span><span class="label">Boot Kernel</span><span class="value">kernel.sys</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128193;</span><span class="label">Filesystem</span><span class="value">AuroraFS</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128187;</span><span class="label">Assembler</span><span class="value">aurasm v1.0</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#128187;</span><span class="label">Emulator</span><span class="value">AISA Emulator v1.0</span></div>' +
        '<div class="settings-row"><span class="icon-left">&#127760;</span><span class="label">Shell</span><span class="value">Aurora Shell v1.0</span></div>' +
      '</div>' +
      '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px">Made with &#10084; by Abdul Kadir</div>';

    var subPanels = {};
    var curSub = null;

    subPanels['general/airdrop'] = {
      title: 'AirDrop & Handoff', parent: 'general',
      html: '<h2>AirDrop & Handoff</h2>' +
        '<div class="settings-subtitle">Share content wirelessly between devices</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128225;</span><span class="label">AirDrop</span>' +
            sg('airdrop_mode', [{val:'off',label:'Receiving Off'},{val:'contacts',label:'Contacts Only'},{val:'everyone',label:'Everyone'}]) +
          '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128225;</span><span class="label">Allow from</span>' +
            sg('airdrop_from', [{val:'everyone',label:'Everyone'},{val:'contacts',label:'Contacts Only'},{val:'noone',label:'No One'}]) +
          '</div>' +
        '</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128241;</span><span class="label">Handoff</span>' + tg('handoff') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128225;</span><span class="label">Allow Handoff Between This Mac and iCloud Devices</span>' + tg('handoff_icloud') + '</div>' +
        '</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128225;</span><span class="label">Nearby Sharing</span>' + tg('nearby') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128225;</span><span class="label">Share Across Devices</span>' + tg('shareacross') + '</div>' +
        '</div>'
    };

    subPanels['general/datetime'] = {
      title: 'Date & Time', parent: 'general',
      html: '<h2>Date & Time</h2>' +
        '<div class="settings-group">' +
          '<div class="settings-row" style="flex-direction:column;align-items:stretch;padding:18px;text-align:center">' +
            '<div style="font-size:36px;font-weight:300;color:var(--text);margin-bottom:4px" id="settings-time-display"></div>' +
            '<div style="font-size:13px;color:var(--text3)" id="settings-date-display"></div>' +
          '</div>' +
        '</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128260;</span><span class="label">Set Date and Time Automatically</span>' + tg('autoset') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#127760;</span><span class="label">Time Zone</span><span class="value">Auto-detected</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#128197;</span><span class="label">Calendar</span>' +
            sg('calformat', [{val:'iso',label:'ISO'},{val:'us',label:'US'},{val:'eu',label:'EU'}]) +
          '</div>' +
          '<div class="settings-row"><span class="icon-left">&#9201;</span><span class="label">24-Hour Time</span>' + tg('h24') + '</div>' +
        '</div>'
    };

    subPanels['general/sharing'] = {
      title: 'Sharing', parent: 'general',
      html: '<h2>Sharing</h2>' +
        '<div class="settings-subtitle">Configure sharing services on this Mac</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128187;</span><span class="label">Computer Name</span><span class="value">' + (localStorage.getItem('aurora_username') || 'User') + '\u2019s Aurora</span></div>' +
        '</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128193;</span><span class="label">File Sharing</span>' + tg('share_file') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128247;</span><span class="label">Screen Sharing</span>' + tg('share_screen') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128274;</span><span class="label">Remote Login (SSH)</span>' + tg('share_ssh') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128225;</span><span class="label">Remote Management</span>' + tg('share_remote_mgmt') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128241;</span><span class="label">AirDrop</span>' + tg('share_airdrop') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128246;</span><span class="label">Bluetooth Sharing</span>' + tg('share_bt') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#127909;</span><span class="label">Display AirPlay Receiver</span>' + tg('share_airplay') + '</div>' +
        '</div>'
    };

    subPanels['general/reset'] = {
      title: 'Transfer or Reset', parent: 'general',
      html: '<h2>Transfer or Reset</h2>' +
        '<div class="settings-subtitle">Erase or migrate data to a new Mac</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row" style="flex-direction:column;align-items:stretch;padding:18px;cursor:pointer" data-toast="Migration Assistant launched">' +
            '<div style="font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px">&#128225; Migration Assistant</div>' +
            '<div style="font-size:12px;color:var(--text3)">Transfer files, settings, and data from another Mac or PC</div>' +
          '</div>' +
        '</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row" style="flex-direction:column;align-items:stretch;padding:18px;cursor:pointer" data-action="reset-all">' +
            '<div style="font-size:14px;font-weight:500;color:var(--red);margin-bottom:4px">&#128683; Reset All Settings</div>' +
            '<div style="font-size:12px;color:var(--text3)">Restore system settings to their defaults without erasing data</div>' +
          '</div>' +
          '<div class="settings-row" style="flex-direction:column;align-items:stretch;padding:18px;cursor:pointer" data-action="erase-all">' +
            '<div style="font-size:14px;font-weight:500;color:var(--red);margin-bottom:4px">&#9888; Erase All Content and Settings</div>' +
            '<div style="font-size:12px;color:var(--text3)">Erase all data, apps, and settings. This cannot be undone.</div>' +
          '</div>' +
        '</div>'
    };

    subPanels['accessibility/vision'] = {
      title: 'Vision', parent: 'accessibility',
      html: '<h2>Vision</h2>' +
        '<div class="settings-subtitle">Display accommodations for visual needs</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128065;</span><span class="label">Invert Colors</span>' + tg('invert') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#127912;</span><span class="label">Color Filters</span>' + tg('colorfilters') + '</div>' +
          '<div class="settings-row" style="flex-direction:column;align-items:stretch;padding:14px 18px">' +
            '<div class="label" style="margin-bottom:8px">Color Filter Type</div>' +
            sg('colorfilter', [{val:'off',label:'Off'},{val:'grayscale',label:'Grayscale'},{val:'protanopia',label:'Protanopia'},{val:'deuteranopia',label:'Deuteranopia'},{val:'tritanopia',label:'Tritanopia'}]) +
          '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128161;</span><span class="label">Reduce White Point</span>' + tg('reducewhitepoint') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128065;</span><span class="label">Reduce Brightness in Dark Mode</span>' + tg('reducedarkbright') + '</div>' +
        '</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128220;</span><span class="label">Bold Text</span>' + tg('boldtext') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128220;</span><span class="label">Larger Text</span>' + tg('largertext') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128220;</span><span class="label">Text Size</span>' + sl('visiontext', 12, 28, 'pt') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128269;</span><span class="label">Cursor Size</span>' + sl('visioncursor', 1, 8, 'x') + '</div>' +
        '</div>'
    };

    subPanels['accessibility/motor'] = {
      title: 'Motor', parent: 'accessibility',
      html: '<h2>Motor</h2>' +
        '<div class="settings-subtitle">Physical and motor accessibility settings</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Full Keyboard Access</span>' + tg('kbdfullaccess') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Tab between controls</span>' + tg('tabcontrols') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Key Repeat Rate</span>' + sl('motorrepeat', 0, 100, '') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Delay Until Repeat</span>' + sl('motordelay', 0, 100, '') + '</div>' +
        '</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128433;</span><span class="label">Pointer Control</span>' +
            sg('ptrctrl', [{val:'mouse',label:'Mouse'},{val:'trackpad',label:'Trackpad'},{val:'head',label:'Head Pointer'}]) +
          '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128433;</span><span class="label">Dwell Click</span>' + tg('dwellclick') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128433;</span><span class="label">Dwell Timeout</span>' + sl('dwelltime', 1, 10, 's') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Sticky Keys</span>' + tg('stickykeys') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Slow Keys</span>' + tg('slowkeys') + '</div>' +
        '</div>'
    };

    subPanels['accessibility/hearing'] = {
      title: 'Hearing', parent: 'accessibility',
      html: '<h2>Hearing</h2>' +
        '<div class="settings-subtitle">Audio accessibility accommodations</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128266;</span><span class="label">Mono Audio</span>' + tg('mono') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128266;</span><span class="label">Audio Balance</span>' + sl('balance', -100, 100, '') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">LED Flash for Alerts</span>' + tg('ledflash') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">Flash Screen on Alert</span>' + tg('flashscreen') + '</div>' +
        '</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#127911;</span><span class="label">Noise Cancellation</span>' + tg('noisecancel') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#127911;</span><span class="label">Headphone Accommodations</span>' + tg('headphone') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128266;</span><span class="label">Background Sounds</span>' + tg('bgsounds') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#127925;</span><span class="label">Background Sound Type</span>' +
            sg('bgsound', [{val:'rain',label:'Rain'},{val:'ocean',label:'Ocean'},{val:'stream',label:'Stream'},{val:'white',label:'White'}]) +
          '</div>' +
        '</div>'
    };

    subPanels['keyboard/modifiers'] = {
      title: 'Modifier Keys', parent: 'keyboard',
      html: '<h2>Modifier Keys</h2>' +
        '<div class="settings-subtitle">Remap modifier key behavior</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Caps Lock</span>' +
            sg('capslock', [{val:'caps',label:'Caps Lock'},{val:'ctrl',label:'Control'},{val:'opt',label:'Option'},{val:'cmd',label:'Command'},{val:'esc',label:'Escape'},{val:'none',label:'No Action'}]) +
          '</div>' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Control</span>' +
            sg('ctrlkey', [{val:'ctrl',label:'Control'},{val:'caps',label:'Caps Lock'},{val:'opt',label:'Option'},{val:'cmd',label:'Command'},{val:'esc',label:'Escape'},{val:'none',label:'No Action'}]) +
          '</div>' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Option</span>' +
            sg('optkey', [{val:'opt',label:'Option'},{val:'ctrl',label:'Control'},{val:'caps',label:'Caps Lock'},{val:'cmd',label:'Command'},{val:'esc',label:'Escape'},{val:'none',label:'No Action'}]) +
          '</div>' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Command</span>' +
            sg('cmdkey', [{val:'cmd',label:'Command'},{val:'ctrl',label:'Control'},{val:'opt',label:'Option'},{val:'caps',label:'Caps Lock'},{val:'esc',label:'Escape'},{val:'none',label:'No Action'}]) +
          '</div>' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Fn/Globe</span>' +
            sg('fnkey', [{val:'fn',label:'Change Input Source'},{val:'emoji',label:'Show Emoji'},{val:'none',label:'No Action'}]) +
          '</div>' +
        '</div>' +
        '<div style="padding:10px 0"><button class="settings-btn" data-action="modifiers-reset">Restore Defaults</button></div>'
    };

    subPanels['keyboard/textinput'] = {
      title: 'Text Input Sources', parent: 'keyboard',
      html: '<h2>Text Input Sources</h2>' +
        '<div class="settings-subtitle">Manage keyboard input methods and languages</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#127482;&#127480;</span><span class="label">English (US)</span><span class="value" style="color:var(--green)">Active</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#127475;&#127476;</span><span class="label">Emoji</span><span class="value" style="color:var(--green)">Active</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#127468;&#127463;</span><span class="label">Arabic</span><span class="value">Inactive</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#127463;&#127475;</span><span class="label">Chinese (Simplified)</span><span class="value">Inactive</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#127471;&#127477;</span><span class="label">Japanese</span><span class="value">Inactive</span></div>' +
        '</div>' +
        '<div style="padding:10px 0;display:flex;gap:8px">' +
          '<button class="settings-btn primary" data-toast="Input source added">+ Add Input Source</button>' +
          '<button class="settings-btn" data-toast="Input source removed">Remove</button>' +
        '</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Use \u2318 Space to switch between input sources</span>' + tg('switchinputs') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#9000;</span><span class="label">Show Input menu in menu bar</span>' + tg('showinputmenu') + '</div>' +
        '</div>'
    };

    subPanels['keyboard/shortcuts'] = {
      title: 'Keyboard Shortcuts', parent: 'keyboard',
      html: '<h2>Keyboard Shortcuts</h2>' +
        '<div class="settings-subtitle">Customize keyboard shortcuts</div>' +
        '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">Launchpad & Dock</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="label" style="flex:1">Open Launchpad</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; Shift + A</span></div>' +
          '<div class="settings-row"><span class="label" style="flex:1">Show/Hide Dock</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; Option + D</span></div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">Mission Control</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="label" style="flex:1">Mission Control</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; Ctrl + Up</span></div>' +
          '<div class="settings-row"><span class="label" style="flex:1">Application Windows</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; Ctrl + Down</span></div>' +
          '<div class="settings-row"><span class="label" style="flex:1">Show Desktop</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; F3</span></div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">Screenshots</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="label" style="flex:1">Entire Screen</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; Shift + 3</span></div>' +
          '<div class="settings-row"><span class="label" style="flex:1">Selected Portion</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; Shift + 4</span></div>' +
          '<div class="settings-row"><span class="label" style="flex:1">Screen Recording</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; Shift + 5</span></div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">General</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="label" style="flex:1">Spotlight</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; Space</span></div>' +
          '<div class="settings-row"><span class="label" style="flex:1">Force Quit</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; Option + Esc</span></div>' +
          '<div class="settings-row"><span class="label" style="flex:1">Lock Screen</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; Ctrl + Q</span></div>' +
          '<div class="settings-row"><span class="label" style="flex:1">Switch Input Source</span><span class="value" style="font-family:monospace;font-size:12px;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:4px">&#8984; Space</span></div>' +
        '</div>'
    };

    function _focusModePanel(name, icon) {
      var p = 'focus_' + name + '_';
      return {
        title: name + ' Focus', parent: 'focus',
        html: '<h2>' + icon + ' ' + name + '</h2>' +
          '<div class="settings-subtitle">Configure ' + name.toLowerCase() + ' focus mode</div>' +
          '<div class="settings-group">' +
            '<div class="settings-row"><span class="icon-left">' + icon + '</span><span class="label">Enable ' + name + ' Focus</span>' + tg(p + 'on') + '</div>' +
            '<div class="settings-row"><span class="icon-left">&#128276;</span><span class="label">Hide Notifications</span>' + tg(p + 'hide') + '</div>' +
            '<div class="settings-row"><span class="icon-left">&#128276;</span><span class="label">Allow Calls from</span>' +
              sg(p + 'calls', [{val:'everyone',label:'Everyone'},{val:'contacts',label:'Favorites'},{val:'none',label:'No One'}]) +
            '</div>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">Allowed Apps</div>' +
          '<div class="settings-group">' +
            '<div class="settings-row"><span class="icon-left">&#127760;</span><span class="label">Safari</span>' + tg(p + 'safari') + '</div>' +
            '<div class="settings-row"><span class="icon-left">&#128231;</span><span class="label">Mail</span>' + tg(p + 'mail') + '</div>' +
            '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">Messages</span>' + tg(p + 'messages') + '</div>' +
            '<div class="settings-row"><span class="icon-left">&#127925;</span><span class="label">Music</span>' + tg(p + 'music') + '</div>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">Schedule</div>' +
          '<div class="settings-group">' +
            '<div class="settings-row"><span class="icon-left">&#128197;</span><span class="label">Schedule</span>' +
              sg(p + 'sched', [{val:'manual',label:'Manual'},{val:'time',label:'Time-Based'},{val:'location',label:'Location'}]) +
            '</div>' +
            (get(p + 'sched') === 'time' ?
              '<div class="settings-row"><span class="icon-left">&#9201;</span><span class="label">From</span><span class="value">9:00 AM</span></div>' +
              '<div class="settings-row"><span class="icon-left">&#9201;</span><span class="label">To</span><span class="value">5:00 PM</span></div>'
            : '') +
          '</div>'
      };
    }

    subPanels['focus/sleep'] = _focusModePanel('Sleep', '\u{1F4A4}');
    subPanels['focus/work'] = _focusModePanel('Work', '\u{1F4DA}');
    subPanels['focus/school'] = _focusModePanel('School', '\u{1F393}');
    subPanels['focus/personal'] = _focusModePanel('Personal', '\u26BE');
    subPanels['focus/gaming'] = _focusModePanel('Gaming', '\u{1F3AE}');
    subPanels['focus/driving'] = _focusModePanel('Driving', '\u{1F697}');
    subPanels['focus/mindfulness'] = _focusModePanel('Mindfulness', '\u{1F4A1}');
    subPanels['focus/custom'] = _focusModePanel('Custom', '\u2728');

    subPanels['siri/history'] = {
      title: 'Siri & Dictation History', parent: 'siri',
      html: '<h2>Siri & Dictation History</h2>' +
        '<div class="settings-subtitle">Review and manage Siri interaction history</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">"What\u2019s the weather today?"</span><span class="value" style="font-size:11px;color:var(--text3)">2 hours ago</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">"Set a timer for 10 minutes"</span><span class="value" style="font-size:11px;color:var(--text3)">Yesterday</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">"Play some jazz music"</span><span class="value" style="font-size:11px;color:var(--text3)">2 days ago</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">"Remind me to buy groceries"</span><span class="value" style="font-size:11px;color:var(--text3)">3 days ago</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">"How do you spell encyclopedia?"</span><span class="value" style="font-size:11px;color:var(--text3)">Last week</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#128172;</span><span class="label">"Navigate to the nearest coffee shop"</span><span class="value" style="font-size:11px;color:var(--text3)">Last week</span></div>' +
        '</div>' +
        '<div style="padding:10px 0"><button class="settings-btn" style="color:var(--red)" data-action="siri-clear">Delete Siri & Dictation History</button></div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128274;</span><span class="label">Improve Siri & Dictation</span>' + tg('siri_improve') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128274;</span><span class="label">Share Audio Recordings</span>' + tg('siri_audio') + '</div>' +
        '</div>'
    };

    subPanels['network/dns'] = {
      title: 'DNS', parent: 'network',
      html: '<h2>DNS</h2>' +
        '<div class="settings-subtitle">Configure DNS server settings</div>' +
        '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">DNS Servers</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#127760;</span><span class="label">8.8.8.8</span><span class="value" style="color:var(--green)">Google</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#127760;</span><span class="label">1.1.1.1</span><span class="value" style="color:var(--green)">Cloudflare</span></div>' +
          '<div class="settings-row"><span class="icon-left">&#127760;</span><span class="label">9.9.9.9</span><span class="value" style="color:var(--text3)">Quad9</span></div>' +
        '</div>' +
        '<div style="padding:10px 0;display:flex;gap:8px">' +
          '<button class="settings-btn primary" data-toast="DNS server added">+ Add Server</button>' +
          '<button class="settings-btn" data-toast="DNS server removed">Remove</button>' +
        '</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128269;</span><span class="label">Search Domains</span><span class="value">localdomain</span></div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text3);margin:14px 0 8px">DNS Settings</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span class="icon-left">&#128274;</span><span class="label">Use DNS over TLS</span>' + tg('dns_tls') + '</div>' +
          '<div class="settings-row"><span class="icon-left">&#128274;</span><span class="label">Limit IP Address Tracking</span>' + tg('dns_limit') + '</div>' +
        '</div>'
    };

    function fmtClock(date) {
      var h = date.getHours(), m = date.getMinutes(), s = date.getSeconds();
      if (get('h24')) {
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
      }
      var ampm = h >= 12 ? 'PM' : 'AM';
      var h12 = h % 12 || 12;
      return h12 + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + ' ' + ampm;
    }
    function fmtDate(date) {
      var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      var cf = get('calformat');
      var dstr = days[date.getDay()] + ', ' + months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
      if (cf === 'us') dstr = days[date.getDay()] + ', ' + (date.getMonth() + 1) + '/' + date.getDate() + '/' + date.getFullYear();
      else if (cf === 'eu') dstr = days[date.getDay()] + ', ' + date.getDate() + '.' + (date.getMonth() + 1) + '.' + date.getFullYear();
      else if (cf === 'iso') dstr = date.getFullYear() + '-' + (date.getMonth() + 1 < 10 ? '0' : '') + (date.getMonth() + 1) + '-' + (date.getDate() < 10 ? '0' : '') + date.getDate() + ' (' + days[date.getDay()] + ')';
      return dstr;
    }

    function showSubPanel(id) {
      var panel = subPanels[id];
      if (!panel) return;
      curSub = id;
      var sc = body.querySelector('.settings-content');
      if (!sc) return;
      sc.innerHTML =
        '<div class="settings-sub-back" style="display:flex;align-items:center;gap:6px;padding:0 0 12px;cursor:pointer;color:var(--accent);font-size:13px" id="sub-back-btn">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
          '<span>' + panel.title + '</span>' +
        '</div>' +
        panel.html;
      var backBtn = sc.querySelector('#sub-back-btn');
      if (backBtn) {
        backBtn.onclick = function() {
          curSub = null;
          render();
        };
      }
      initInteractive(sc);
      if (id === 'general/datetime') {
        var timeEl = sc.querySelector('#settings-time-display');
        var dateEl = sc.querySelector('#settings-date-display');
        if (timeEl && dateEl) {
          (function _tick() {
            var now = new Date();
            timeEl.textContent = fmtClock(now);
            dateEl.textContent = fmtDate(now);
          })();
          var clkId = setInterval(function() {
            if (!document.body.contains(timeEl)) { clearInterval(clkId); return; }
            var now = new Date();
            timeEl.textContent = fmtClock(now);
            dateEl.textContent = fmtDate(now);
          }, 1000);
          if (backBtn) backBtn.onclick = function() { clearInterval(clkId); curSub = null; render(); };
        }
      }
    }

    function render() {
      curSub = null;
      var sb = '<div class="settings-sidebar">';
      sections.forEach(function(s) {
        sb += '<div class="s-item' + (s.id === cur ? ' active' : '') + '" data-sid="' + s.id + '"><span class="s-icon">' + s.icon + '</span>' + s.name + '</div>';
      });
      sb += '</div><div class="settings-content"></div>';
      body.innerHTML = '<div class="settings-body">' + sb + '</div>';
      body.querySelectorAll('.s-item').forEach(function(el) {
        el.onclick = function() { cur = el.getAttribute('data-sid'); render(); };
      });
      var sc = body.querySelector('.settings-content');
      sc.innerHTML = contents[cur] || '<h2>Coming Soon</h2>';
      initInteractive(sc);
    }

    function sliderUnit(sn) {
      if (sn === 'cursorsize' || sn === 'pointersize' || sn === 'visioncursor') return 'x';
      if (sn === 'docksize' || sn === 'dockmag') return 'px';
      if (sn === 'brightness' || sn === 'volume' || sn === 'alertvol' || sn === 'inputvol' || sn === 'keybright') return '%';
      if (sn === 'balance') return '';
      if (sn === 'dwelltime') return 's';
      if (sn === 'visiontext') return 'pt';
      if (sn === 'mousedpi') return ' DPI';
      return '';
    }

    function syncUI(container) {
      container.querySelectorAll('.toggle[data-setting]').forEach(function(t) {
        var k = t.getAttribute('data-setting');
        t.classList.toggle('on', !!get(k));
        if (t.hasAttribute('data-perm')) {
          var row = t.closest('.settings-perm-row');
          var st = row ? row.querySelector('.perm-status') : null;
          if (st) {
            var on = !!get(k);
            st.textContent = on ? 'Allowed' : 'Denied';
            st.className = 'perm-status ' + (on ? 'granted' : 'denied');
          }
        }
      });
      container.querySelectorAll('.settings-segmented[data-seg]').forEach(function(g) {
        var k = g.getAttribute('data-seg');
        var v = String(get(k));
        g.querySelectorAll('.seg-opt').forEach(function(o) {
          o.classList.toggle('active', o.getAttribute('data-val') === v);
        });
      });
      container.querySelectorAll('.settings-slider[data-slider]').forEach(function(sld) {
        var k = sld.getAttribute('data-slider');
        var v = get(k);
        if (v !== undefined && v !== null && String(sld.value) !== String(v)) sld.value = v;
        var valEl = sld.nextElementSibling;
        if (valEl && valEl.classList.contains('settings-slider-val')) valEl.textContent = sld.value + sliderUnit(k);
      });
      container.querySelectorAll('.js-live-res').forEach(function(el) {
        el.textContent = window.innerWidth + ' x ' + window.innerHeight;
      });
      var ws = container.querySelector('#wifi-status');
      if (ws && !ws.hasAttribute('data-conn')) {
        ws.textContent = get('wifi') ? 'On' : 'Off';
        ws.style.color = get('wifi') ? 'var(--green)' : 'var(--text3)';
      }
    }

    function handleToggle(key, el) {
      var nv = !get(key);
      set(key, nv);
      el.classList.toggle('on', nv);
      if (el.hasAttribute('data-perm')) {
        var row = el.closest('.settings-perm-row');
        var st = row ? row.querySelector('.perm-status') : null;
        if (st) { st.textContent = nv ? 'Allowed' : 'Denied'; st.className = 'perm-status ' + (nv ? 'granted' : 'denied'); }
      }
      if (key === 'flashscreen' && nv) flashScreen();
      if (key === 'nightshift' || key === 'hdr' || key === 'truetone') showToast((TOAST_ON_CHANGE[key] || key) + (nv ? ' on' : ' off'));
      if (key === 'showwidgets') showToast('Widgets ' + (nv ? 'shown' : 'hidden'));
      if (key === 'dockrecent') showToast('Recent apps ' + (nv ? 'shown' : 'hidden'));
      if (key === 'dnd' && nv) showToast('Do Not Disturb on');
    }

    function handleSeg(key, val) {
      set(key, val);
      if (key === 'mousehanded') { syncMouseStore(); showToast(val === 'left' ? 'Left-handed mouse' : 'Right-handed mouse'); return; }
      if (TOAST_ON_CHANGE[key]) showToast(TOAST_ON_CHANGE[key] + ': ' + val);
    }

    function handleSlider(key, val) {
      var num = Number(val);
      set(key, isNaN(num) ? val : num);
      if (key === 'mousedpi') { syncMouseStore(); return; }
      if (key === 'volume' || key === 'alertvol' || key === 'inputvol') {
        if (get('volfeedback') && get('soundeffects')) beep(get(key));
        flashScreen();
      }
    }

    function handleAction(action, container) {
      if (action === 'reset-all') {
        S.reset();
        try { localStorage.setItem('aurora_accent', S.get('accent')); } catch (e) {}
        try { localStorage.setItem('aurora_wallpaper', S.get('wallpaper')); } catch (e) {}
        ['#settings-accent-colors', '#settings-pointer-colors', '#settings-wallpaper-grid'].forEach(function(sel) {
          var g = container.querySelector(sel);
          if (g) g.innerHTML = '';
        });
        renderAccentColors(container);
        renderPointerColors(container);
        renderWallpapers(container);
        syncUI(container);
        showToast('Settings reset to defaults');
      } else if (action === 'erase-all') {
        if (confirm('Erase all content and settings? This cannot be undone.')) {
          S.reset();
          ['aurora_accent', 'aurora_wallpaper'].forEach(function(k) { try { localStorage.removeItem(k); } catch (e) {} });
          try { localStorage.setItem('aurora_accent', S.get('accent')); } catch (e) {}
          try { localStorage.setItem('aurora_wallpaper', S.get('wallpaper')); } catch (e) {}
          S.apply();
          curSub = null;
          render();
          showToast('Erase complete \u2014 settings cleared');
        } else {
          showToast('Erase cancelled');
        }
      } else if (action === 'modifiers-reset') {
        set('capslock', 'caps'); set('ctrlkey', 'ctrl'); set('optkey', 'opt'); set('cmdkey', 'cmd'); set('fnkey', 'fn');
        syncUI(container);
        showToast('Modifier keys reset to defaults');
      } else if (action === 'siri-clear') {
        showToast('Siri history cleared');
      } else if (action === 'mouse-reset') {
        try {
          var m = {};
          try { m = JSON.parse(localStorage.getItem('aurora_mouse') || '{}'); } catch (e) { m = {}; }
          m.left = 0; m.right = 0; m.scrolls = 0;
          localStorage.setItem('aurora_mouse', JSON.stringify(m));
        } catch (e) {}
        refreshMouseCounts(container);
        try { window.dispatchEvent(new CustomEvent('aurora-mouse-sync')); } catch (e2) {}
        showToast('Mouse click counters reset');
      } else if (action === 'mouse-open') {
        if (typeof AppManager !== 'undefined') AppManager.open('mouse');
      }
    }

    function refreshMouseCounts(container) {
      var el = container.querySelector('#mouse-click-count');
      if (!el) return;
      var c = mouseCounters();
      el.textContent = c.left + ' left \u00b7 ' + c.right + ' right \u00b7 ' + c.scrolls + ' scrolls';
    }

    function initInteractive(container) {
      if (cur === 'appearance') renderAccentColors(container);
      if (cur === 'wallpaper') renderWallpapers(container);
      if (cur === 'battery') renderBatteryChart(container);
      if (cur === 'storage') renderStorageBar(container);
      if (cur === 'notifications') renderNotifApps(container);
      if (cur === 'spotlight') renderSpotlightCats(container);
      if (cur === 'mouse') renderPointerColors(container);
      if (cur === 'mouse') refreshMouseCounts(container);
      if (cur === 'network') scanWifi(container);
      syncUI(container);
      container.querySelectorAll('.toggle[data-setting]').forEach(function(t) {
        t.onclick = function() { handleToggle(t.getAttribute('data-setting'), t); };
      });
      container.querySelectorAll('.settings-segmented[data-seg]').forEach(function(g) {
        var key = g.getAttribute('data-seg');
        g.querySelectorAll('.seg-opt').forEach(function(opt) {
          opt.onclick = function() {
            g.querySelectorAll('.seg-opt').forEach(function(o) { o.classList.remove('active'); });
            opt.classList.add('active');
            handleSeg(key, opt.getAttribute('data-val'));
          };
        });
      });
      container.querySelectorAll('.settings-slider[data-slider]').forEach(function(sld) {
        var key = sld.getAttribute('data-slider');
        var valEl = sld.nextElementSibling;
        sld.oninput = function() {
          if (valEl && valEl.classList.contains('settings-slider-val')) valEl.textContent = sld.value + sliderUnit(key);
          handleSlider(key, sld.value);
        };
        sld.onchange = function() { handleSlider(key, sld.value); };
      });
      renderAccentPreview(container);
      renderPointerPreview(container);
      container.querySelectorAll('[data-nav]').forEach(function(el) {
        el.onclick = function() { cur = el.getAttribute('data-nav'); render(); };
      });
      container.querySelectorAll('[data-sub]').forEach(function(el) {
        el.onclick = function() { showSubPanel(el.getAttribute('data-sub')); };
      });
      container.querySelectorAll('[data-toast]').forEach(function(el) {
        el.onclick = function(e) { e.stopPropagation(); showToast(el.getAttribute('data-toast')); };
      });
      container.querySelectorAll('[data-action]').forEach(function(el) {
        el.onclick = function(e) { e.stopPropagation(); handleAction(el.getAttribute('data-action'), container); };
      });
    }

    function renderAccentPreview(container) {
      var el = container.querySelector('#settings-accent-colors');
      if (!el || el.childElementCount > 0) return;
      renderAccentColors(container);
    }

    function renderPointerPreview(container) {
      var el = container.querySelector('#settings-pointer-colors');
      if (!el || el.childElementCount > 0) return;
      renderPointerColors(container);
    }

    function renderAccentColors(container) {
      var el = container.querySelector('#settings-accent-colors');
      if (!el) return;
      el.innerHTML = '';
      var curAccent = get('accent');
      accentColors.forEach(function(c) {
        var d = document.createElement('div');
        d.className = 'color-dot' + (c === curAccent ? ' active' : '');
        d.style.background = c;
        d.onclick = function() {
          set('accent', c);
          try { localStorage.setItem('aurora_accent', c); } catch (e) {}
          S.apply();
          el.querySelectorAll('.color-dot').forEach(function(dd) { dd.classList.remove('active'); });
          d.classList.add('active');
        };
        el.appendChild(d);
      });
    }

    function renderPointerColors(container) {
      var el = container.querySelector('#settings-pointer-colors');
      if (!el) return;
      el.innerHTML = '';
      var curP = get('pointercolor');
      var pointerColors = ['#89b4fa','#cba6f7','#f38ba8','#fab387','#f9e2af','#a6e3a1','#94e2d5','#f5c2e7','#ffffff'];
      pointerColors.forEach(function(c) {
        var d = document.createElement('div');
        d.className = 'color-dot' + (c === curP ? ' active' : '');
        d.style.background = c;
        d.onclick = function() {
          set('pointercolor', c);
          el.querySelectorAll('.color-dot').forEach(function(dd) { dd.classList.remove('active'); });
          d.classList.add('active');
        };
        el.appendChild(d);
      });
    }

    function renderWallpapers(container) {
      var grid = container.querySelector('#settings-wallpaper-grid');
      if (!grid) return;
      grid.innerHTML = '';
      var curWallpaper = get('wallpaper');
      wallpapers.forEach(function(wp) {
        var t = document.createElement('div');
        t.className = 'wp-thumb' + (wp.id === curWallpaper ? ' active' : '');
        t.style.background = wp.bg;
        t.innerHTML = '<span class="wp-label">' + wp.name + '</span>';
        t.onclick = function() {
          set('wallpaper', wp.id);
          try { localStorage.setItem('aurora_wallpaper', wp.id); } catch (e) {}
          var art = document.querySelector('.wallpaper-art');
          if (art) art.style.background = wp.bg;
          fetch('/api/set-wallpaper?id=' + encodeURIComponent(wp.id)).catch(function(){});
          if (typeof window._applySpotlightGlow === 'function') window._applySpotlightGlow(wp.id);
          else if (typeof _applySpotlightGlow === 'function') _applySpotlightGlow(wp.id);
          grid.querySelectorAll('.wp-thumb').forEach(function(tt) { tt.classList.remove('active'); });
          t.classList.add('active');
        };
        grid.appendChild(t);
      });
    }

    function renderBatteryChart(container) {
      var el = container.querySelector('#battery-chart');
      if (!el) return;
      el.innerHTML = '';
      for (var i = 0; i < 24; i++) {
        var bar = document.createElement('div');
        var h = Math.floor(Math.random() * 30) + 30;
        bar.style.cssText = 'flex:1;height:' + h + 'px;background:linear-gradient(to top,var(--green),var(--accent));border-radius:3px;transition:height .5s cubic-bezier(.2,.8,.3,1.2);opacity:.7';
        el.appendChild(bar);
      }
    }

    function renderStorageBar(container) {
      var el = container.querySelector('#storage-bar');
      if (!el) return;
      var data = [
        { pct: 1.5, color: '#89b4fa' },
        { pct: 0.1, color: '#cba6f7' },
        { pct: 0.05, color: '#a6e3a1' },
        { pct: 0.02, color: '#f9e2af' }
      ];
      data.forEach(function(d) {
        var seg = document.createElement('div');
        seg.style.cssText = 'height:100%;width:' + d.pct + '%;background:' + d.color + ';border-radius:3px;transition:width .5s cubic-bezier(.2,.8,.3,1.2)';
        el.appendChild(seg);
      });
    }

    function renderNotifApps(container) {
      var el = container.querySelector('#settings-notif-apps');
      if (!el) return;
      var apps = [
        { key: 'notifapp_Finder', name: 'Finder', icon: '&#128193;' },
        { key: 'notifapp_Terminal', name: 'Terminal', icon: '&#128187;' },
        { key: 'notifapp_Notes', name: 'Notes', icon: '&#128221;' },
        { key: 'notifapp_Calculator', name: 'Calculator', icon: '&#129518;' },
        { key: 'notifapp_SystemSettings', name: 'System Settings', icon: '&#9881;' },
        { key: 'notifapp_ActivityMonitor', name: 'Activity Monitor', icon: '&#128200;' }
      ];
      el.innerHTML = apps.map(function(a) {
        return '<div class="settings-row"><span class="icon-left">' + a.icon + '</span><span class="label">' + a.name + '</span><div class="toggle' + (get(a.key) ? ' on' : '') + '" data-setting="' + a.key + '"></div></div>';
      }).join('');
    }

    function renderSpotlightCats(container) {
      var el = container.querySelector('#spotlight-cats');
      if (!el) return;
      var cats = [
        { key: 'spotcat_Applications', name: 'Applications', icon: '&#128187;' },
        { key: 'spotcat_Documents', name: 'Documents', icon: '&#128196;' },
        { key: 'spotcat_Folders', name: 'Folders', icon: '&#128193;' },
        { key: 'spotcat_Images', name: 'Images', icon: '&#128247;' },
        { key: 'spotcat_Music', name: 'Music', icon: '&#127925;' },
        { key: 'spotcat_Notes', name: 'Notes', icon: '&#128221;' },
        { key: 'spotcat_PDFs', name: 'PDFs', icon: '&#128196;' },
        { key: 'spotcat_SystemSettings', name: 'System Settings', icon: '&#9881;' },
        { key: 'spotcat_WebHistory', name: 'Web History', icon: '&#127760;' },
        { key: 'spotcat_Bookmarks', name: 'Bookmarks', icon: '&#128278;' },
        { key: 'spotcat_EventsReminders', name: 'Events & Reminders', icon: '&#128197;' },
        { key: 'spotcat_Fonts', name: 'Fonts', icon: '&#9998;' }
      ];
      el.innerHTML = cats.map(function(c) {
        return '<div class="settings-row"><span class="icon-left">' + c.icon + '</span><span class="label">' + c.name + '</span><div class="toggle' + (get(c.key) ? ' on' : '') + '" data-setting="' + c.key + '"></div></div>';
      }).join('');
    }

    function scanWifi(container) {
      var list = container.querySelector('#wifi-network-list');
      var scanBtn = container.querySelector('#wifi-scan-btn');
      if (!list) return;

      function doScan() {
        list.innerHTML = '<div class="settings-row" style="justify-content:center;color:var(--text3);padding:18px;font-size:12px">&#8635; Scanning...</div>';
        fetch('/api/wifi/scan').then(function(r) { return r.json(); }).then(function(data) {
          var nets = data.networks || [];
          var connected = data.connected || '';
          if (nets.length === 0) {
            list.innerHTML = '<div class="settings-row" style="justify-content:center;color:var(--text3);padding:18px;font-size:12px">No networks found</div>';
            return;
          }
          nets.sort(function(a, b) {
            var sa = parseInt(a.signal) || 0;
            var sb = parseInt(b.signal) || 0;
            return sb - sa;
          });
          list.innerHTML = '';
          nets.forEach(function(net) {
            var pct = parseInt(net.ssid ? net.signal : '0') || 0;
            var bars = pct >= 80 ? 3 : pct >= 50 ? 2 : pct >= 20 ? 1 : 0;
            var barIcons = ['', '&#9644;', '&#9644;&#9644;', '&#9644;&#9644;&#9644;'];
            var barColors = ['#f38ba8', '#f9e2af', '#a6e3a1', '#a6e3a1'];
            var isConn = net.ssid === connected;
            var signalColor = barColors[bars];
            var row = document.createElement('div');
            row.className = 'settings-row';
            row.style.cursor = 'pointer';
            row.innerHTML =
              '<span class="icon-left" style="color:' + signalColor + '">' + barIcons[bars] + '</span>' +
              '<div style="flex:1">' +
                '<div class="label">' + (net.ssid || 'Hidden Network') + '</div>' +
                '<div class="subtitle">' + (net.auth || 'Unknown') + (net.channel ? ' \u00b7 Ch ' + net.channel : '') + '</div>' +
              '</div>' +
              (isConn ? '<span class="value" style="color:var(--green);margin-right:8px">Connected &#10003;</span>' : '') +
              '<span class="value">' + pct + '%</span>';
            if (isConn) {
              row.onclick = function() {
                if (confirm('Disconnect from "' + net.ssid + '"?')) {
                  row.querySelector('.label').textContent += '...';
                  fetch('/api/wifi/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(function(r) { return r.json(); }).then(function() {
                    doScan();
                    var st = container.querySelector('#wifi-status');
                    if (st) { st.textContent = 'Disconnected'; st.style.color = 'var(--text3)'; st.setAttribute('data-conn', '1'); }
                  });
                }
              };
            } else {
              row.onclick = function() {
                showWifiDialog(net.ssid, function(pw) {
                  var valEl = row.querySelector('.value:last-child');
                  if (valEl) valEl.textContent = '...';
                  fetch('/api/wifi/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ssid: net.ssid, password: pw }) }).then(function(r) { return r.json(); }).then(function(d) {
                    if (d.ok) {
                      if (valEl) valEl.innerHTML = '<span style="color:var(--green)">Connected &#10003;</span>';
                      var st = container.querySelector('#wifi-status');
                      if (st) { st.textContent = net.ssid; st.style.color = 'var(--green)'; st.setAttribute('data-conn', '1'); }
                    } else {
                      if (valEl) valEl.innerHTML = '<span style="color:var(--red)">Failed</span>';
                      setTimeout(function() { if (valEl) valEl.textContent = pct + '%'; }, 2000);
                    }
                  }).catch(function() {
                    if (valEl) valEl.innerHTML = '<span style="color:var(--red)">Error</span>';
                    setTimeout(function() { if (valEl) valEl.textContent = pct + '%'; }, 2000);
                  });
                });
              };
            }
            list.appendChild(row);
          });
          if (connected) {
            var st = container.querySelector('#wifi-status');
            if (st) { st.textContent = connected; st.style.color = 'var(--green)'; st.setAttribute('data-conn', '1'); }
          }
        }).catch(function(e) {
          list.innerHTML = '<div class="settings-row" style="justify-content:center;color:var(--red);padding:18px;font-size:12px">Scan failed: ' + e.message + '</div>';
        });
      }

      function showWifiDialog(ssid, callback) {
        var existing = container.querySelector('#wifi-dialog-overlay');
        if (existing) existing.remove();
        var dlg = document.createElement('div');
        dlg.id = 'wifi-dialog-overlay';
        dlg.style.cssText = 'position:absolute;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)';
        dlg.innerHTML =
          '<div style="background:var(--surface2);border-radius:14px;padding:24px;width:340px;border:1px solid rgba(255,255,255,.08);box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
            '<div style="font-size:16px;font-weight:600;margin-bottom:4px">Join "' + ssid + '"</div>' +
            '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">Enter the Wi-Fi password</div>' +
            '<input type="password" id="wifi-pw-input" placeholder="Password" style="width:100%;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:var(--text);font-size:13px;font-family:var(--font);outline:none;margin-bottom:6px">' +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:16px;cursor:pointer" id="wifi-show-pw">' +
              '<input type="checkbox" id="wifi-pw-check" style="cursor:pointer">' +
              '<label for="wifi-pw-check" style="font-size:11px;color:var(--text3);cursor:pointer">Show password</label>' +
            '</div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end">' +
              '<button id="wifi-cancel" class="settings-btn" style="padding:6px 16px;font-size:12px">Cancel</button>' +
              '<button id="wifi-go" class="settings-btn primary" style="padding:6px 16px;font-size:12px">Join</button>' +
            '</div>' +
          '</div>';
        container.appendChild(dlg);
        var pwInput = dlg.querySelector('#wifi-pw-input');
        setTimeout(function() { pwInput.focus(); }, 100);
        dlg.querySelector('#wifi-show-pw').onclick = function() {
          pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
        };
        dlg.querySelector('#wifi-cancel').onclick = function() { dlg.remove(); };
        dlg.onclick = function(e) { if (e.target === dlg) dlg.remove(); };
        function go() {
          var pw = pwInput.value;
          dlg.remove();
          callback(pw);
        }
        pwInput.onkeydown = function(e) { if (e.key === 'Enter') go(); };
        dlg.querySelector('#wifi-go').onclick = go;
      }

      if (scanBtn) scanBtn.onclick = doScan;
      doScan();
    }

    if (!window._auroraSettingsResize) {
      window._auroraSettingsResize = true;
      window.addEventListener('resize', function() {
        document.querySelectorAll('.js-live-res').forEach(function(el) {
          el.textContent = window.innerWidth + ' x ' + window.innerHeight;
        });
      });
    }
    if (window.matchMedia) {
      try {
        var mq = window.matchMedia('(prefers-color-scheme: light)');
        if (mq && mq.addEventListener) mq.addEventListener('change', function() { if (get('theme') === 'auto') S.apply(); });
      } catch (e) {}
    }

    S.apply();
    render();
  }
});
