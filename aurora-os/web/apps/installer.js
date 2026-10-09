AppManager.register('installer', {
  name: 'Aurora Installer',
  icon: '&#9881;',
  color: 'linear-gradient(135deg,#89b4fa,#74c7ec)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'installer', title: 'Aurora OS Installer', width: 560, height: 440 });
    var body = w.bodyEl;

    var step = 0;
    var installing = false;
    var installProgress = 0;
    var backupResult = null;
    var installResult = null;

    var steps = [
      'Welcome',
      'License Agreement',
      'Backup',
      'Install',
      'Complete'
    ];

    function render() {
      var h = '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:linear-gradient(160deg,#0f0f1e,#161630 40%,#1a1a3e)">';

      h += '<div style="display:flex;align-items:center;justify-content:center;padding:20px 0 8px;flex-shrink:0">';
      h += '<div style="display:flex;gap:4px;align-items:center">';
      steps.forEach(function(s, i) {
        var color = i < step ? 'var(--green)' : i === step ? 'var(--accent)' : 'var(--text3)';
        var bg = i < step ? 'rgba(166,227,161,.15)' : i === step ? 'rgba(137,180,250,.15)' : 'rgba(255,255,255,.04)';
        h += '<div style="display:flex;align-items:center;gap:4px">';
        h += '<div style="width:22px;height:22px;border-radius:50%;background:' + bg + ';border:1.5px solid ' + color + ';display:flex;align-items:center;justify-content:center;font-size:10px;color:' + color + ';font-weight:600">' + (i < step ? '&#10003;' : (i + 1)) + '</div>';
        h += '<span style="font-size:11px;color:' + color + ';margin-right:6px">' + s + '</span>';
        h += '</div>';
        if (i < steps.length - 1) {
          h += '<div style="width:20px;height:1px;background:' + (i < step ? 'var(--green)' : 'rgba(255,255,255,.1)') + '"></div>';
        }
      });
      h += '</div></div>';

      h += '<div style="flex:1;overflow-y:auto;padding:10px 36px 16px;display:flex;flex-direction:column">';

      if (step === 0) {
        h += '<div style="text-align:center;padding:20px 0">';
        h += '<div style="font-size:48px;margin-bottom:16px;filter:drop-shadow(0 0 12px rgba(137,180,250,.3))">&#10022;</div>';
        h += '<h2 style="font-size:24px;font-weight:600;margin-bottom:8px;color:var(--text)">Welcome to Aurora OS</h2>';
        h += '<p style="font-size:13px;color:var(--text3);max-width:360px;margin:0 auto 30px;line-height:1.6">This installer will guide you through reinstalling Aurora OS. Your personal files will be backed up and restored automatically.</p>';
        h += '<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:24px">';
        h += '<div style="padding:8px 14px;background:rgba(255,255,255,.04);border-radius:8px;font-size:11px;color:var(--text3)">&#128187; AISA-64 Kernel</div>';
        h += '<div style="padding:8px 14px;background:rgba(255,255,255,.04);border-radius:8px;font-size:11px;color:var(--text3)">&#128190; AuroraFS Filesystem</div>';
        h += '<div style="padding:8px 14px;background:rgba(255,255,255,.04);border-radius:8px;font-size:11px;color:var(--text3)">&#128295; Shell v1.0</div>';
        h += '</div>';
        h += '</div>';
      } else if (step === 1) {
        h += '<h3 style="font-size:16px;font-weight:600;margin-bottom:12px">Software License Agreement</h3>';
        h += '<div style="flex:1;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:16px;font-size:12px;color:var(--text3);line-height:1.7;overflow-y:auto;max-height:240px">';
        h += '<p style="font-weight:600;color:var(--text);margin-bottom:8px">Aurora OS End User License Agreement</p>';
        h += '<p>By using Aurora OS, you agree to the following terms:</p>';
        h += '<p style="margin:6px 0"><b>1. License Grant.</b> Aurora OS is free software licensed, not sold. You may use, modify, and distribute this software freely.</p>';
        h += '<p style="margin:6px 0"><b>2. No Warranty.</b> Aurora OS is provided "as is" without warranty of any kind, express or implied.</p>';
        h += '<p style="margin:6px 0"><b>3. Limitation of Liability.</b> In no event shall the author be liable for any damages arising from the use of this software.</p>';
        h += '<p style="margin:6px 0"><b>4. Intellectual Property.</b> The Aurora name, logo, and design are trademarks of the Aurora OS project.</p>';
        h += '<p style="margin:6px 0"><b>5. Privacy.</b> Aurora OS respects your privacy. No data is collected or transmitted without your explicit consent.</p>';
        h += '<p style="margin:6px 0"><b>6. User Files.</b> The installer will back up your personal files before reinstallation and restore them afterward.</p>';
        h += '<p style="margin:6px 0"><b>7. Modifications.</b> You may customize Aurora OS to suit your needs. Custom configurations are preserved across updates.</p>';
        h += '<p style="margin-top:12px;color:var(--text2)">Copyright (c) 2026 Aurora OS Project. All rights reserved.</p>';
        h += '</div>';
      } else if (step === 2) {
        h += '<h3 style="font-size:16px;font-weight:600;margin-bottom:8px">Backup Your Files</h3>';
        h += '<p style="font-size:12px;color:var(--text3);margin-bottom:16px">Your personal files will be backed up before reinstallation and restored automatically afterward.</p>';
        if (backupResult) {
          h += '<div style="background:rgba(166,227,161,.08);border:1px solid rgba(166,227,161,.2);border-radius:10px;padding:14px;margin-bottom:12px">';
          h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="color:var(--green);font-size:16px">&#10003;</span><span style="font-size:13px;color:var(--green);font-weight:500">Backup Complete</span></div>';
          h += '<div style="font-size:12px;color:var(--text3)">' + backupResult.count + ' file(s) backed up:</div>';
          h += '<div style="font-size:11px;color:var(--text3);margin-top:6px;font-family:var(--mono)">' + (backupResult.backed_up || []).join(', ') + '</div>';
          h += '</div>';
        } else {
          h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:16px;text-align:center">';
          h += '<div style="font-size:32px;margin-bottom:10px;opacity:.6">&#128190;</div>';
          h += '<div style="font-size:13px;color:var(--text2);margin-bottom:4px">Ready to back up your files</div>';
          h += '<div style="font-size:11px;color:var(--text3)">Files in /home/user will be preserved</div>';
          h += '</div>';
        }
      } else if (step === 3) {
        h += '<h3 style="font-size:16px;font-weight:600;margin-bottom:8px">Installing Aurora OS</h3>';
        if (installResult) {
          h += '<div style="background:rgba(166,227,161,.08);border:1px solid rgba(166,227,161,.2);border-radius:10px;padding:14px;margin-bottom:12px">';
          h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="color:var(--green);font-size:16px">&#10003;</span><span style="font-size:13px;color:var(--green);font-weight:500">Installation Complete</span></div>';
          h += '<div style="font-size:12px;color:var(--text3)">' + (installResult.message || '') + '</div>';
          h += '<div style="font-size:11px;color:var(--text3);margin-top:6px">' + (installResult.restored || []).length + ' file(s) restored from backup</div>';
          h += '</div>';
        } else if (installing) {
          h += '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:20px">';
          h += '<div class="settings-progress" style="height:10px;border-radius:5px;margin-bottom:12px"><div class="settings-progress-fill" style="width:' + installProgress + '%;background:linear-gradient(90deg,var(--accent),var(--purple));border-radius:5px"></div></div>';
          var msgs = ['Backing up user files...', 'Clearing system cache...', 'Reinstalling system files...', 'Restoring user files...', 'Setting up defaults...'];
          var mi = Math.min(msgs.length - 1, Math.floor(installProgress / 25));
          h += '<div style="text-align:center;font-size:12px;color:var(--text3)">' + msgs[mi] + '</div>';
          h += '</div>';
        } else {
          h += '<div style="background:rgba(243,139,168,.06);border:1px solid rgba(243,139,168,.15);border-radius:10px;padding:14px;margin-bottom:12px">';
          h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:16px">&#9888;</span><span style="font-size:13px;color:var(--yellow);font-weight:500">Ready to Install</span></div>';
          h += '<div style="font-size:12px;color:var(--text3)">System files will be reset. User files will be preserved.</div>';
          h += '</div>';
        }
      } else if (step === 4) {
        h += '<div style="text-align:center;padding:20px 0">';
        h += '<div style="font-size:48px;margin-bottom:16px;filter:drop-shadow(0 0 12px rgba(166,227,161,.3))">&#10003;</div>';
        h += '<h2 style="font-size:22px;font-weight:600;margin-bottom:8px;color:var(--green)">Installation Complete</h2>';
        h += '<p style="font-size:13px;color:var(--text3);max-width:320px;margin:0 auto 24px;line-height:1.6">Aurora OS has been successfully reinstalled. Your files have been restored and are ready to use.</p>';
        h += '<div style="display:flex;justify-content:center;gap:12px">';
        h += '<div style="padding:10px 20px;background:rgba(255,255,255,.04);border-radius:8px;font-size:12px;color:var(--text3)">Aurora OS v0.1.0 (Dawn)</div>';
        h += '</div>';
        h += '</div>';
      }

      h += '</div>';

      h += '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 36px;border-top:1px solid rgba(255,255,255,.05);flex-shrink:0">';
      if (step > 0 && step < 4 && !installing) {
        h += '<button class="settings-btn" id="inst-back" style="padding:7px 18px">Back</button>';
      }
      if (step === 0) {
        h += '<button class="settings-btn primary" id="inst-next" style="padding:7px 24px">Continue</button>';
      } else if (step === 1) {
        h += '<button class="settings-btn primary" id="inst-next" style="padding:7px 24px">Agree</button>';
      } else if (step === 2) {
        if (!backupResult) {
          h += '<button class="settings-btn primary" id="inst-backup" style="padding:7px 24px">Back Up Now</button>';
        } else {
          h += '<button class="settings-btn primary" id="inst-next" style="padding:7px 24px">Continue</button>';
        }
      } else if (step === 3) {
        if (!installResult && !installing) {
          h += '<button class="settings-btn primary" id="inst-install" style="padding:7px 24px;background:linear-gradient(135deg,var(--red),var(--peach))">Install</button>';
        } else if (installResult) {
          h += '<button class="settings-btn primary" id="inst-next" style="padding:7px 24px">Finish</button>';
        }
      } else if (step === 4) {
        h += '<button class="settings-btn primary" id="inst-done" style="padding:7px 24px">Done</button>';
      }
      h += '</div>';

      h += '</div>';
      body.innerHTML = h;

      var nextBtn = body.querySelector('#inst-next');
      if (nextBtn) nextBtn.onclick = function() { step++; render(); };
      var backBtn = body.querySelector('#inst-back');
      if (backBtn) backBtn.onclick = function() { if (step > 0) { step--; render(); } };
      var backupBtn = body.querySelector('#inst-backup');
      if (backupBtn) backupBtn.onclick = doBackup;
      var installBtn = body.querySelector('#inst-install');
      if (installBtn) installBtn.onclick = doInstall;
      var doneBtn = body.querySelector('#inst-done');
      if (doneBtn) doneBtn.onclick = function() { w.onClose && w.onClose(); AppManager.close(w.id); };
    }

    function doBackup() {
      var btn = body.querySelector('#inst-backup');
      if (btn) { btn.textContent = 'Backing up...'; btn.disabled = true; }
      fetch('/api/installer/backup').then(function(r) { return r.json(); }).then(function(d) {
        backupResult = d;
        render();
      }).catch(function(e) {
        backupResult = { count: 0, backed_up: [], error: e.message };
        render();
      });
    }

    function doInstall() {
      installing = true;
      installProgress = 0;
      render();
      var iv = setInterval(function() {
        installProgress += Math.random() * 18 + 7;
        if (installProgress >= 100) {
          installProgress = 100;
          clearInterval(iv);
          fetch('/api/installer/reinstall').then(function(r) { return r.json(); }).then(function(d) {
            installing = false;
            installResult = d;
            render();
          }).catch(function(e) {
            installing = false;
            installResult = { ok: false, message: e.message };
            render();
          });
        }
        var fill = body.querySelector('.settings-progress-fill');
        if (fill) fill.style.width = installProgress + '%';
        var msgs = ['Backing up user files...', 'Clearing system cache...', 'Reinstalling system files...', 'Restoring user files...', 'Setting up defaults...'];
        var statusEl = body.querySelector('[style*="text-align:center;font-size:12px"]');
        if (statusEl) statusEl.textContent = msgs[Math.min(msgs.length - 1, Math.floor(installProgress / 25))];
      }, 400);
    }

    render();
  }
});
