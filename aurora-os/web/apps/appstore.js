AppManager.register('appstore', {
  name: 'App Store',
  icon: '&#128722;',
  color: 'linear-gradient(135deg,#89b4fa,#b4befe)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'appstore', title: 'App Store', width: 700, height: 520 });
    var body = w.bodyEl;

    var apps = [];
    var devApps = [];
    var selectedCat = 'All';
    var selectedApp = null;
    var searchQuery = '';
    var loading = true;
    var view = 'discover';
    var categories = ['All', 'Utilities', 'Entertainment', 'Productivity', 'Developer', 'Navigation', 'Finance', 'Photography'];
    var icons = ['&#128296;','&#127912;','&#128187;','&#9881;','&#128640;','&#127911;','&#128218;','&#127910;','&#128222;','&#128302;','&#128190;','&#128293;'];
    var colors = ['linear-gradient(135deg,#89b4fa,#74c7ec)','linear-gradient(135deg,#cba6f7,#b4befe)','linear-gradient(135deg,#f38ba8,#eba0ac)','linear-gradient(135deg,#a6e3a1,#94e2d5)','linear-gradient(135deg,#f9e2af,#fab387)','linear-gradient(135deg,#f5c2e7,#cba6f7)'];

    function fetchApps() {
      loading = true;
      render();
      fetch('/api/store/apps').then(function(r) { return r.json(); }).then(function(d) {
        apps = d.apps || [];
        return fetch('/api/store/dev-apps');
      }).then(function(r) { return r.json(); }).then(function(d) {
        devApps = d.apps || [];
        loading = false;
        render();
      }).catch(function() {
        loading = false;
        render();
      });
    }

    function getAllApps() {
      return apps.concat(devApps.map(function(a) { a._dev = true; return a; }));
    }

    function installApp(id) {
      var btn = body.querySelector('#install-' + id);
      if (btn) { btn.textContent = '...'; btn.disabled = true; }
      var isDev = devApps.some(function(a) { return a.id === id; });
      var url = isDev ? '/api/store/dev-install' : '/api/store/install';
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: id }) }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          var all = getAllApps();
          var app = all.find(function(a) { return a.id === id; });
          if (app) app.installed = true;
          if (!isDev && typeof AuroraStore !== 'undefined') AuroraStore.install(id);
          AppManager.renderDock();
          render();
        }
      });
    }

    function uninstallApp(id) {
      var btn = body.querySelector('#uninstall-' + id);
      if (btn) { btn.textContent = '...'; btn.disabled = true; }
      var isDev = devApps.some(function(a) { return a.id === id; });
      var url = isDev ? '/api/store/dev-uninstall' : '/api/store/uninstall';
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: id }) }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          var all = getAllApps();
          var app = all.find(function(a) { return a.id === id; });
          if (app) app.installed = false;
          if (!isDev && typeof AuroraStore !== 'undefined') AuroraStore.uninstall(id);
          AppManager.renderDock();
          render();
        }
      });
    }

    function renderStars(rating) {
      var full = Math.floor(rating || 0);
      var s = '';
      for (var i = 0; i < full; i++) s += '&#9733;';
      for (var i = full; i < 5; i++) s += '&#9734;';
      return s;
    }

    function render() {
      var h = '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg)">';
      h += '<div style="display:flex;align-items:center;padding:10px 16px;gap:10px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0">';
      h += '<span style="font-size:18px">&#128722;</span>';
      h += '<span style="font-size:15px;font-weight:600">App Store</span>';
      h += '<div style="flex:1"></div>';
      h += '<div style="display:flex;gap:4px">';
      h += '<button class="as-view-btn' + (view === 'discover' ? ' active' : '') + '" data-view="discover" style="padding:4px 12px;border-radius:6px;border:none;background:' + (view === 'discover' ? 'rgba(137,180,250,.15)' : 'transparent') + ';color:' + (view === 'discover' ? 'var(--accent)' : 'var(--text3)') + ';font-size:11px;cursor:pointer;font-family:var(--font)">Discover</button>';
      h += '<button class="as-view-btn' + (view === 'developer' ? ' active' : '') + '" data-view="developer" style="padding:4px 12px;border-radius:6px;border:none;background:' + (view === 'developer' ? 'rgba(166,227,161,.15)' : 'transparent') + ';color:' + (view === 'developer' ? 'var(--green)' : 'var(--text3)') + ';font-size:11px;cursor:pointer;font-family:var(--font">&#128187; Developer</button>';
      h += '</div>';
      h += '<div style="display:flex;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:0 10px;height:28px;align-items:center;width:180px">';
      h += '<span style="color:var(--text3);margin-right:6px;font-size:12px">&#128269;</span>';
      h += '<input type="text" id="as-search" placeholder="Search apps..." value="' + searchQuery.replace(/"/g, '&quot;') + '" style="flex:1;background:none;border:none;outline:none;color:var(--text);font-size:12px;font-family:var(--font)">';
      h += '</div></div>';

      if (selectedApp) {
        h += renderAppDetail(selectedApp);
      } else if (view === 'developer') {
        h += renderDeveloper();
      } else {
        h += renderDiscover();
      }

      h += '</div>';
      body.innerHTML = h;

      body.querySelectorAll('.as-view-btn').forEach(function(el) {
        el.onclick = function() { view = el.getAttribute('data-view'); selectedApp = null; selectedCat = 'All'; render(); };
      });
      body.querySelectorAll('[data-cat]').forEach(function(el) {
        el.onclick = function() { selectedCat = el.getAttribute('data-cat'); selectedApp = null; render(); };
      });
      body.querySelectorAll('.as-app-card').forEach(function(el) {
        el.onmouseenter = function() { el.style.background = 'rgba(255,255,255,.03)'; };
        el.onmouseleave = function() { el.style.background = ''; };
      });
      body.querySelectorAll('[id^="install-"]').forEach(function(btn) {
        btn.onclick = function(ev) { ev.stopPropagation(); installApp(btn.id.replace('install-', '')); };
      });
      body.querySelectorAll('[id^="uninstall-"]').forEach(function(btn) {
        btn.onclick = function(ev) { ev.stopPropagation(); uninstallApp(btn.id.replace('uninstall-', '')); };
      });
      var searchEl = body.querySelector('#as-search');
      if (searchEl) {
        searchEl.oninput = function() {
          searchQuery = searchEl.value;
          var pos = 0, end = 0;
          try { pos = searchEl.selectionStart; end = searchEl.selectionEnd; } catch (e) {}
          render();
          var s = body.querySelector('#as-search');
          if (s) { s.focus(); try { s.setSelectionRange(pos, end); } catch (e) {} }
        };
        searchEl.onkeydown = function(e) { if (e.key === 'Escape') { searchQuery = ''; render(); var s2 = body.querySelector('#as-search'); if (s2) s2.focus(); } };
      }
      setupDevForm();
    }

    function renderDiscover() {
      var h = '<div style="display:flex;flex:1;overflow:hidden">';
      h += '<div style="width:140px;border-right:1px solid rgba(255,255,255,.05);padding:10px 0;overflow-y:auto;flex-shrink:0">';
      categories.forEach(function(cat) {
        var all = getAllApps();
        var count = cat === 'All' ? all.length : all.filter(function(a) { return a.category === cat; }).length;
        h += '<div class="as-cat' + (selectedCat === cat ? ' active' : '') + '" data-cat="' + cat + '" style="padding:6px 16px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:8px;border-left:2px solid transparent;transition:all .15s ease;color:' + (selectedCat === cat ? 'var(--accent)' : 'var(--text3)') + ';border-left-color:' + (selectedCat === cat ? 'var(--accent)' : 'transparent') + ';background:' + (selectedCat === cat ? 'rgba(137,180,250,.08)' : 'transparent') + '">' + cat + ' <span style="margin-left:auto;font-size:10px;opacity:.6">' + count + '</span></div>';
      });
      h += '</div>';
      h += '<div style="flex:1;overflow-y:auto;padding:16px">';
      if (loading) {
        h += '<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px">Loading apps...</div>';
      } else {
        var all = getAllApps();
        var filtered = all.filter(function(a) {
          if (selectedCat !== 'All' && a.category !== selectedCat) return false;
          if (searchQuery) {
            var q = searchQuery.toLowerCase();
            if (a.name.toLowerCase().indexOf(q) === -1 && a.desc.toLowerCase().indexOf(q) === -1) return false;
          }
          return true;
        });
        if (filtered.length === 0) {
          h += '<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px">No apps found</div>';
        } else {
          filtered.forEach(function(app) {
            h += '<div class="as-app-card" data-aid="' + app.id + '" style="display:flex;gap:14px;padding:14px;border-radius:12px;cursor:pointer;transition:background .15s ease;border:1px solid transparent;margin-bottom:4px" onclick="this.closest(\'.win-body\').dispatchEvent(new CustomEvent(\'as-open\',{detail:\'' + app.id + '\'}))">';
            h += '<div style="width:52px;height:52px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;background:' + app.color + ';box-shadow:0 4px 16px rgba(0,0,0,.2)">' + app.icon + '</div>';
            h += '<div style="flex:1;min-width:0">';
            h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px"><span style="font-size:13px;font-weight:600">' + app.name + '</span><span style="font-size:10px;color:var(--text3)">' + app.author + '</span>';
            if (app._dev) h += ' <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(166,227,161,.15);color:var(--green)">Community</span>';
            h += '</div>';
            h += '<div style="font-size:11px;color:var(--text3);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + app.desc + '</div>';
            h += '<div style="display:flex;align-items:center;gap:8px;font-size:11px">';
            h += '<span style="color:var(--yellow)">' + renderStars(app.rating) + '</span>';
            h += '<span style="color:var(--text3)">' + (app.rating || 'New') + '</span>';
            h += '<span style="color:var(--text3);opacity:.4">\u00b7</span>';
            h += '<span style="color:var(--text3)">' + app.category + '</span>';
            h += '</div></div>';
            h += '<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;justify-content:center">';
            if (app.installed) {
              h += '<button class="settings-btn" id="uninstall-' + app.id + '" style="font-size:10px;padding:4px 12px;color:var(--red);border-color:rgba(243,139,168,.2)" onclick="event.stopPropagation()">Installed</button>';
            } else {
              h += '<button class="settings-btn primary" id="install-' + app.id + '" style="font-size:10px;padding:4px 14px" onclick="event.stopPropagation()">Get</button>';
            }
            h += '<span style="font-size:10px;color:var(--text3);margin-top:4px">' + (app.size || '') + '</span>';
            h += '</div></div>';
          });
        }
      }
      h += '</div></div>';
      return h;
    }

    function renderDeveloper() {
      var h = '<div style="flex:1;overflow-y:auto;padding:20px 28px">';
      h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">';
      h += '<div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,var(--green),var(--teal));display:flex;align-items:center;justify-content:center;font-size:22px">&#128187;</div>';
      h += '<div><div style="font-size:18px;font-weight:600">Developer Hub</div><div style="font-size:12px;color:var(--text3)">Write code, launch instantly, publish later</div></div>';
      h += '</div>';

      h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">';
      h += '<div style="padding:16px;background:rgba(137,180,250,.08);border-radius:12px;text-align:center"><div style="font-size:24px;font-weight:700;color:var(--accent)">' + devApps.filter(function(a){return !a.draft}).length + '</div><div style="font-size:11px;color:var(--text3);margin-top:4px">Published</div></div>';
      h += '<div style="padding:16px;background:rgba(166,227,161,.08);border-radius:12px;text-align:center"><div style="font-size:24px;font-weight:700;color:var(--green)">' + devApps.filter(function(a){return a.draft}).length + '</div><div style="font-size:11px;color:var(--text3);margin-top:4px">Drafts</div></div>';
      h += '<div style="padding:16px;background:rgba(203,166,247,.08);border-radius:12px;text-align:center"><div style="font-size:24px;font-weight:700;color:var(--purple)">' + apps.length + '</div><div style="font-size:11px;color:var(--text3);margin-top:4px">Store Apps</div></div>';
      h += '</div>';

      h += '<div style="background:rgba(255,255,255,.03);border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid rgba(255,255,255,.04)">';
      h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
      h += '<h3 style="font-size:14px;font-weight:600">&#128187; Code Editor</h3>';
      h += '<div style="display:flex;gap:6px">';
      h += '<button class="settings-btn" id="dev-clear-btn" style="font-size:11px;padding:4px 12px">Clear</button>';
      h += '<button class="settings-btn" id="dev-save-btn" style="font-size:11px;padding:4px 12px;color:var(--yellow);border-color:rgba(249,226,175,.2)">Save Draft</button>';
      h += '<button class="settings-btn primary" id="dev-launch-btn" style="font-size:11px;padding:4px 16px">&#9654; Launch</button>';
      h += '</div></div>';

      h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';
      h += '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">App Name</label><input type="text" id="dev-name" placeholder="My App" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text);font-size:12px;font-family:var(--font);outline:none"></div>';
      h += '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Icon (emoji)</label><input type="text" id="dev-icon" placeholder="&#128296;" maxlength="4" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text);font-size:12px;font-family:var(--font);outline:none"></div>';
      h += '</div>';
      h += '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Write your HTML/JS app below</label>';
      h += '<textarea id="dev-content" rows="14" placeholder="&lt;div style=&quot;padding:20px;color:white&quot;&gt;\n  &lt;h1&gt;Hello World&lt;/h1&gt;\n  &lt;p&gt;My Aurora OS app&lt;/p&gt;\n&lt;/div&gt;\n&lt;script&gt;\n  document.body.style.background = &quot;#1a1a2e&quot;;\n&lt;/script&gt;" style="width:100%;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.3);color:#a6e3a1;font-size:12px;font-family:var(--mono);outline:none;resize:vertical;line-height:1.5;tab-size:2"></textarea></div>';
      h += '<div id="dev-submit-msg" style="font-size:11px;color:var(--green);margin-top:8px;min-height:16px"></div>';
      h += '</div>';

      if (devApps.length > 0) {
        h += '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px">&#128230; Your Apps</h3>';
        devApps.forEach(function(app) {
          var draftTag = app.draft ? ' <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(249,226,175,.15);color:var(--yellow)">Draft</span>' : ' <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(166,227,161,.15);color:var(--green)">Published</span>';
          h += '<div style="display:flex;gap:12px;padding:12px;border-radius:10px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);margin-bottom:8px;align-items:center">';
          h += '<div style="width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;background:' + (app.color || 'linear-gradient(135deg,#89b4fa,#cba6f7)') + '">' + (app.icon || '&#128296;') + '</div>';
          h += '<div style="flex:1;min-width:0">';
          h += '<div style="font-size:13px;font-weight:500">' + (app.name || 'Untitled') + draftTag + '</div>';
          h += '<div style="font-size:11px;color:var(--text3)">' + (app.downloads || 0) + ' downloads \u00b7 ' + (app.submitted || '') + '</div>';
          h += '</div>';
          h += '<button class="settings-btn dev-reopen" data-cid="' + app.id + '" style="font-size:10px;padding:4px 10px">&#9654; Run</button>';
          h += '<button class="settings-btn dev-edit-app" data-cid="' + app.id + '" style="font-size:10px;padding:4px 10px;color:var(--yellow);border-color:rgba(249,226,175,.2)">&#9998; Edit</button>';
          h += '<button class="settings-btn dev-delete-app" data-cid="' + app.id + '" style="font-size:10px;padding:4px 10px;color:var(--red);border-color:rgba(243,139,168,.2)">&times;</button>';
          h += '</div>';
        });
      }

      h += '<div style="margin-top:24px;padding:16px;background:rgba(137,180,250,.05);border-radius:10px;border:1px solid rgba(137,180,250,.08)">';
      h += '<h3 style="font-size:13px;font-weight:600;margin-bottom:8px">&#128218; How It Works</h3>';
      h += '<p style="font-size:11px;color:var(--text3);line-height:1.7">1. Write HTML/JS code in the editor above.\n2. Click <b>Launch</b> to run your app instantly in a new window.\n3. Click <b>Save Draft</b> to save your work.\n4. Use <b>Edit</b> on any saved app to fill in details and publish to the store.\n5. No coding knowledge required for publishing - just code, launch, decide later!</p>';
      h += '</div>';

      h += '</div>';
      return h;
    }

    function setupDevForm() {
      var launchBtn = body.querySelector('#dev-launch-btn');
      var saveBtn = body.querySelector('#dev-save-btn');
      var clearBtn = body.querySelector('#dev-clear-btn');

      function getEditorContent() {
        var el = body.querySelector('#dev-content');
        return el ? el.value.trim() : '';
      }
      function getEditorName() {
        var el = body.querySelector('#dev-name');
        return el ? el.value.trim() : '';
      }
      function getEditorIcon() {
        var el = body.querySelector('#dev-icon');
        return el ? el.value.trim() : '';
      }

      function launchApp(content, name, icon) {
        var appId = 'devlaunch_' + Date.now();
        var appName = name || 'My App';
        var appIcon = icon || '&#128296;';
        AppManager.register(appId, {
          name: appName,
          icon: appIcon,
          color: 'linear-gradient(135deg,#a6e3a1,#94e2d5)',
          create: function(mgr) {
            var w = mgr.createWindow({ appId: appId, title: appName, width: 700, height: 500 });
            var b = w.bodyEl;
            b.style.cssText = 'position:absolute;inset:0;padding:0;overflow:hidden;';
            var iframe = document.createElement('iframe');
            iframe.style.cssText = 'width:100%;height:100%;border:none;background:#1e1e2e;';
            var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;font-family:system-ui,sans-serif;color:#e4e4f0;background:#1e1e2e">' + content + '</body></html>';
            iframe.srcdoc = html;
            b.appendChild(iframe);
          }
        });
        AppManager.open(appId);
      }

      if (launchBtn) {
        launchBtn.onclick = function() {
          var content = getEditorContent();
          var msg = body.querySelector('#dev-submit-msg');
          if (!content) {
            if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Write some code first!'; }
            return;
          }
          var name = getEditorName() || 'My App';
          var icon = getEditorIcon() || '&#128296;';
          launchApp(content, name, icon);
          if (msg) { msg.style.color = 'var(--green)'; msg.textContent = 'App launched!'; }
          fetch('/api/store/dev-launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, icon: icon, content: content, draft: true })
          }).then(function(r) { return r.json(); }).then(function(d) {
            if (d.ok && d.app) {
              devApps.unshift(d.app);
            }
          }).catch(function() {});
        };
      }

      if (saveBtn) {
        saveBtn.onclick = function() {
          var content = getEditorContent();
          var name = getEditorName();
          var msg = body.querySelector('#dev-submit-msg');
          if (!content) {
            if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Nothing to save'; }
            return;
          }
          saveBtn.textContent = 'Saving...';
          saveBtn.disabled = true;
          fetch('/api/store/dev-launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name || 'Untitled Draft', icon: getEditorIcon() || '&#128296;', content: content, draft: true })
          }).then(function(r) { return r.json(); }).then(function(d) {
            saveBtn.textContent = 'Save Draft';
            saveBtn.disabled = false;
            if (d.ok && d.app) {
              devApps.unshift(d.app);
              if (msg) { msg.style.color = 'var(--green)'; msg.textContent = 'Draft saved!'; }
              render();
            }
          }).catch(function() {
            saveBtn.textContent = 'Save Draft';
            saveBtn.disabled = false;
            if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Save failed'; }
          });
        };
      }

      if (clearBtn) {
        clearBtn.onclick = function() {
          var el = body.querySelector('#dev-content');
          var nameEl = body.querySelector('#dev-name');
          var iconEl = body.querySelector('#dev-icon');
          var msg = body.querySelector('#dev-submit-msg');
          if (el) el.value = '';
          if (nameEl) nameEl.value = '';
          if (iconEl) iconEl.value = '';
          if (msg) msg.textContent = '';
        };
      }

      body.querySelectorAll('.dev-reopen').forEach(function(btn) {
        btn.onclick = function() {
          var cid = btn.getAttribute('data-cid');
          var app = devApps.find(function(a) { return a.id === cid; });
          if (app && app.content) launchApp(app.content, app.name, app.icon);
        };
      });

      body.querySelectorAll('.dev-edit-app').forEach(function(btn) {
        btn.onclick = function() {
          var cid = btn.getAttribute('data-cid');
          var app = devApps.find(function(a) { return a.id === cid; });
          if (!app) return;
          var nameEl = body.querySelector('#dev-name');
          var iconEl = body.querySelector('#dev-icon');
          var contentEl = body.querySelector('#dev-content');
          var msg = body.querySelector('#dev-submit-msg');
          if (nameEl) nameEl.value = app.name || '';
          if (iconEl) iconEl.value = (app.icon || '').replace(/<[^>]*>/g, '');
          if (contentEl) { contentEl.value = app.content || ''; contentEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); contentEl.focus(); }
          if (msg) { msg.style.color = 'var(--accent)'; msg.textContent = 'Editing: ' + (app.name || 'Untitled') + ' - Make changes then Launch or Save.'; }
        };
      });

      body.querySelectorAll('.dev-delete-app').forEach(function(btn) {
        btn.onclick = function() {
          var cid = btn.getAttribute('data-cid');
          var msg = body.querySelector('#dev-submit-msg');
          fetch('/api/store/dev-uninstall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: cid })
          }).then(function() {
            devApps = devApps.filter(function(a) { return a.id !== cid; });
            if (msg) { msg.style.color = 'var(--green)'; msg.textContent = 'App deleted'; }
            render();
          });
        };
      });
    }

    function renderAppDetail(app) {
      var isDev = app._dev;
      var h = '<div style="flex:1;overflow-y:auto;padding:20px 28px">';
      h += '<div style="cursor:pointer;color:var(--text3);font-size:12px;margin-bottom:16px;display:flex;align-items:center;gap:4px" id="as-back">&#8249; Back</div>';
      h += '<div style="display:flex;gap:18px;margin-bottom:24px">';
      h += '<div style="width:80px;height:80px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:40px;flex-shrink:0;background:' + app.color + ';box-shadow:0 8px 28px rgba(0,0,0,.25)">' + app.icon + '</div>';
      h += '<div style="flex:1">';
      h += '<h2 style="font-size:22px;font-weight:600;margin-bottom:4px">' + app.name;
      if (isDev) h += ' <span style="font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(166,227,161,.15);color:var(--green);vertical-align:middle">Community</span>';
      h += '</h2>';
      h += '<div style="font-size:12px;color:var(--text3);margin-bottom:6px">' + app.author + ' \u00b7 ' + app.category + '</div>';
      h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="color:var(--yellow);font-size:13px">' + renderStars(app.rating) + '</span><span style="font-size:12px;color:var(--text2)">' + (app.rating || 'New') + '</span>';
      if (isDev && app.downloads) h += '<span style="font-size:11px;color:var(--text3)">\u00b7 ' + app.downloads + ' downloads</span>';
      h += '</div>';
      if (app.installed) {
        h += '<button class="settings-btn" id="detail-uninstall" style="font-size:12px;padding:6px 24px;color:var(--red);border-color:rgba(243,139,168,.2)">Uninstall</button>';
      } else {
        h += '<button class="settings-btn primary" id="detail-install" style="font-size:12px;padding:6px 24px">Get</button>';
      }
      h += '</div></div>';

      h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">';
      h += '<div style="text-align:center;padding:12px;background:rgba(255,255,255,.03);border-radius:10px"><div style="font-size:14px;font-weight:600">' + (app.size || 'N/A') + '</div><div style="font-size:10px;color:var(--text3)">Size</div></div>';
      h += '<div style="text-align:center;padding:12px;background:rgba(255,255,255,.03);border-radius:10px"><div style="font-size:14px;font-weight:600">v' + (app.version || '1.0') + '</div><div style="font-size:10px;color:var(--text3)">Version</div></div>';
      h += '<div style="text-align:center;padding:12px;background:rgba(255,255,255,.03);border-radius:10px"><div style="font-size:14px;font-weight:600">' + (isDev ? (app.downloads || 0) : '4+') + '</div><div style="font-size:10px;color:var(--text3)">' + (isDev ? 'Downloads' : 'Age Rating') + '</div></div>';
      h += '</div>';

      h += '<h3 style="font-size:14px;font-weight:600;margin-bottom:8px">About</h3>';
      h += '<p style="font-size:12px;color:var(--text3);line-height:1.7;margin-bottom:20px">' + app.desc;
      if (!isDev) h += ' This app is designed specifically for Aurora OS and follows the Aurora design language with smooth animations and a clean interface.';
      h += '</p>';

      if (app.content) {
        h += '<h3 style="font-size:14px;font-weight:600;margin-bottom:8px">App Content</h3>';
        h += '<pre style="font-size:11px;color:var(--text2);background:rgba(255,255,255,.03);padding:12px;border-radius:8px;overflow-x:auto;font-family:var(--mono);line-height:1.6;white-space:pre-wrap">' + app.content.replace(/</g, '&lt;') + '</pre>';
      }

      if (!isDev) {
        h += '<h3 style="font-size:14px;font-weight:600;margin-bottom:8px">What\'s New</h3>';
        h += '<p style="font-size:12px;color:var(--text3);line-height:1.7">Version ' + (app.version || '1.0') + ' \u2014 Initial release with full Aurora OS integration.</p>';
      } else if (app.submitted) {
        h += '<h3 style="font-size:14px;font-weight:600;margin-bottom:8px">Published</h3>';
        h += '<p style="font-size:12px;color:var(--text3);line-height:1.7">Submitted on ' + app.submitted + ' by ' + app.author + '</p>';
      }

      h += '</div>';
      return h;
    }

    body.addEventListener('click', function(e) {
      var backBtn = e.target.closest('#as-back');
      if (backBtn) { selectedApp = null; render(); }
      var detailInstall = e.target.closest('#detail-install');
      if (detailInstall && selectedApp) installApp(selectedApp.id);
      var detailUninstall = e.target.closest('#detail-uninstall');
      if (detailUninstall && selectedApp) uninstallApp(selectedApp.id);
    });

    body.addEventListener('as-open', function(e) {
      var aid = e.detail;
      var all = getAllApps();
      selectedApp = all.find(function(a) { return a.id === aid; });
      render();
    });

    fetchApps();
  }
});
