AppManager.register('about', {
  name: 'About Aurora',
  icon: '&#10022;',
  color: 'linear-gradient(135deg,#89b4fa,#cba6f7)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'about', title: 'About Aurora', width: 440, height: 520 });
    var body = w.bodyEl;
    var userName = localStorage.getItem('aurora_username') || 'User';

    body.innerHTML = '<div class="ab-root">' +
      '<div class="ab-hero">' +
        '<div class="ab-logo">&#10022;</div>' +
        '<div class="ab-title">Aurora OS</div>' +
        '<div class="ab-version">Sequoia 1.0 \u2022 Release 2</div>' +
        '<div class="ab-chip">AISA-64</div>' +
      '</div>' +
      '<div class="ab-body">' +
        '<div class="ab-section">' +
          '<div class="ab-section-title">Hardware</div>' +
          '<div class="ab-row"><span>Model</span><span>Aurora Studio</span></div>' +
          '<div class="ab-row"><span>Chip</span><span>AISA-64 \u2014 2.9 GHz</span></div>' +
          '<div class="ab-row"><span>Memory</span><span id="ab-mem">...</span></div>' +
          '<div class="ab-row"><span>Startup Disk</span><span>AuroraFS</span></div>' +
          '<div class="ab-row"><span>Serial</span><span>AU-2026-DAWN-042</span></div>' +
        '</div>' +
        '<div class="ab-section">' +
          '<div class="ab-section-title">Storage</div>' +
          '<div class="ab-storage">' +
            '<div class="ab-progress"><div class="ab-progress-fill" id="ab-disk-bar"></div></div>' +
            '<div class="ab-storage-text"><span id="ab-disk-used"></span> used of <span id="ab-disk-total"></span></div>' +
          '</div>' +
        '</div>' +
        '<div class="ab-section">' +
          '<div class="ab-section-title">Software</div>' +
          '<div class="ab-row"><span>macOS Version</span><span>Aurora OS 1.0 (Dawn)</span></div>' +
          '<div class="ab-row"><span>Kernel</span><span>aurora-kernel 25.6.0</span></div>' +
          '<div class="ab-row"><span>Built</span><span>July 12, 2026</span></div>' +
          '<div class="ab-row"><span>Owner</span><span>' + userName + '</span></div>' +
          '<div class="ab-row"><span>Filesystem</span><span>AuroraFS 9.2</span></div>' +
        '</div>' +
        '<div class="ab-section">' +
          '<div class="ab-section-title">Runtime</div>' +
          '<div class="ab-row"><span>Assembler</span><span>aurasm v1.0</span></div>' +
          '<div class="ab-row"><span>Emulator</span><span>AISA Emulator v1.0</span></div>' +
          '<div class="ab-row"><span>Shell</span><span>Aurora Shell v1.0</span></div>' +
          '<div class="ab-row"><span>Uptime</span><span id="ab-uptime">...</span></div>' +
        '</div>' +
        '<div class="ab-x"><a id="ab-support">Support</a> \u00b7 <a id="ab-legal">Legal</a></div>' +
        '<div class="ab-legal-text" id="ab-legal-text">Aurora OS is a custom-built operating system. No animals were harmed. Made with \u2764 by Abdul Kadir.</div>' +
      '</div>' +
      '</div>' +
      '<style>' +
      '.ab-root{position:absolute;inset:0;overflow-y:auto;background:#1e1e2e;font-family:var(--font)}' +
      '.ab-root::-webkit-scrollbar{width:6px}' +
      '.ab-root::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:3px}' +
      '.ab-hero{display:flex;flex-direction:column;align-items:center;padding:28px 20px 20px;background:linear-gradient(180deg,rgba(137,180,250,.08),transparent);border-bottom:1px solid rgba(255,255,255,.04)}' +
      '.ab-logo{font-size:52px;line-height:1;filter:drop-shadow(0 4px 24px rgba(137,180,250,.45));background:linear-gradient(135deg,#89b4fa,#cba6f7);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:10px}' +
      '.ab-title{font-size:24px;font-weight:700;letter-spacing:-.4px;color:#cdd6f4}' +
      '.ab-version{font-size:12px;color:#6c7086;margin:4px 0 10px}' +
      '.ab-chip{font-size:11px;font-weight:600;color:#b4befe;background:rgba(137,180,250,.1);border:1px solid rgba(137,180,250,.2);padding:3px 12px;border-radius:6px}' +
      '.ab-body{padding:12px 20px 16px}' +
      '.ab-section{margin-bottom:14px}' +
      '.ab-section-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:#6c7086;margin-bottom:6px}' +
      '.ab-row{display:flex;justify-content:space-between;padding:4px 0;font-size:12.5px;color:#a6adc8}' +
      '.ab-row span:first-child{color:#6c7086}' +
      '.ab-storage{margin-top:6px}' +
      '.ab-progress{height:8px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden}' +
      '.ab-progress-fill{height:100%;background:linear-gradient(90deg,#89b4fa,#cba6f7);border-radius:4px;transition:width .6s cubic-bezier(.16,1,.3,1);width:0}' +
      '.ab-storage-text{font-size:11px;color:#6c7086;margin-top:5px}' +
      '.ab-x{display:flex;gap:4px;justify-content:center;font-size:12px;color:#89b4fa;margin-top:8px;cursor:pointer}' +
      '.ab-x a:hover{text-decoration:underline}' +
      '.ab-legal-text{display:none;font-size:11px;color:#6c7086;text-align:center;margin-top:8px;line-height:1.6}' +
      '</style>';

    // Fill in real system stats
    fetch('/api/system/stats').then(function(r) { return r.json(); }).then(function(s) {
      var gb = function(b) { return (b / 1073741824).toFixed(0) + ' GB'; };
      var memEl = body.querySelector('#ab-mem');
      if (memEl) memEl.textContent = gb(s.mem_total) + ' \u2014 ' + Math.round((s.mem_used / s.mem_total) * 100) + ' % used';
      var upEl = body.querySelector('#ab-uptime');
      if (upEl) upEl.textContent = s.uptime || '1 min';
      var usedEl = body.querySelector('#ab-disk-used');
      var totalEl = body.querySelector('#ab-disk-total');
      if (usedEl) usedEl.textContent = gb(s.disk_used);
      if (totalEl) totalEl.textContent = gb(s.disk_total);
      var bar = body.querySelector('#ab-disk-bar');
      if (bar) bar.style.width = Math.min(s.disk_percent || 0, 100) + '%';
    }).catch(function() {});

    var legal = body.querySelector('#ab-legal');
    var legalText = body.querySelector('#ab-legal-text');
    var support = body.querySelector('#ab-support');
    if (legal && legalText) {
      legal.onclick = function() { legalText.style.display = legalText.style.display === 'block' ? 'none' : 'block'; };
    }
    if (support) {
      support.onclick = function() { window.open('/api/open-external?url=' + encodeURIComponent('https://github.com'), '_blank'); };
    }
  }
});