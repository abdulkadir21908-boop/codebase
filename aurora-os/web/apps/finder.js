AppManager.register('finder', {
  name: 'Finder',
  icon: '&#128193;',
  color: 'linear-gradient(135deg,#89b4fa,#74c7ec)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'finder', title: 'Finder', width: 700, height: 460 });
    var body = w.bodyEl;

    var sidebarItems = [
      { label: 'Favorites', items: [
        { icon: '&#127968;', name: 'Home', path: '/home/user' },
        { icon: '&#128194;', name: 'Desktop', path: '/home/user/Desktop' },
        { icon: '&#128196;', name: 'Documents', path: '/home/user/Documents' },
        { icon: '&#128247;', name: 'Pictures', path: '/home/user/Pictures' },
        { icon: '&#127925;', name: 'Music', path: '/home/user/Music' },
        { icon: '&#128229;', name: 'Downloads', path: '/home/user/Downloads' }
      ]}
    ];

    var currentPath = '/home/user';
    var viewMode = 'grid';

    function fileIcon(n) {
      if (n.indexOf('.txt') !== -1 || n.indexOf('.md') !== -1) return '&#128221;';
      if (n.indexOf('.aur') !== -1) return '&#128640;';
      if (n.indexOf('.sys') !== -1) return '&#9881;';
      return '&#128196;';
    }

    function escHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function promptOverlay(title, placeholder, cb) {
      var ov = document.createElement('div');
      ov.style.cssText = 'position:absolute;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)';
      var card = document.createElement('div');
      card.style.cssText = 'background:#1e1e2e;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:24px;width:320px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);transform:scale(.9);opacity:0;transition:transform .35s cubic-bezier(.2,.8,.3,1.2),opacity .3s ease';
      var h = document.createElement('div');
      h.style.cssText = 'font-size:15px;font-weight:600;color:#e4e4f0;margin-bottom:16px';
      h.textContent = title;
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = placeholder;
      inp.style.cssText = 'width:100%;padding:10px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e4e4f0;font-size:14px;font-family:system-ui,sans-serif;outline:none;margin-bottom:16px;transition:border-color .3s ease,box-shadow .3s ease';
      inp.onfocus = function(){ inp.style.borderColor='#89b4fa'; inp.style.boxShadow='0 0 0 3px rgba(137,180,250,.15)' };
      inp.onblur = function(){ inp.style.borderColor='rgba(255,255,255,.12)'; inp.style.boxShadow='none' };
      var btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
      var cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'padding:7px 16px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#a6adc8;font-size:13px;font-family:system-ui,sans-serif;cursor:pointer;transition:background .2s ease';
      cancelBtn.onmouseover = function(){ cancelBtn.style.background='rgba(255,255,255,.14)' };
      cancelBtn.onmouseout = function(){ cancelBtn.style.background='rgba(255,255,255,.08)' };
      cancelBtn.onclick = function(){ ov.remove() };
      var okBtn = document.createElement('button');
      okBtn.textContent = 'Create';
      okBtn.style.cssText = 'padding:7px 16px;background:linear-gradient(135deg,#89b4fa,#cba6f7);border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:500;font-family:system-ui,sans-serif;cursor:pointer;transition:transform .25s cubic-bezier(.2,.8,.3,1.2),box-shadow .25s ease';
      okBtn.onmouseover = function(){ okBtn.style.transform='scale(1.03)'; okBtn.style.boxShadow='0 4px 16px rgba(137,180,250,.3)' };
      okBtn.onmouseout = function(){ okBtn.style.transform='scale(1)'; okBtn.style.boxShadow='none' };
      okBtn.onclick = function(){
        var val = inp.value.trim();
        if (!val) { inp.style.borderColor='#f38ba8'; setTimeout(function(){ inp.style.borderColor='rgba(255,255,255,.12)' },600); return; }
        ov.remove();
        cb(val);
      };
      inp.addEventListener('keydown', function(e){ if(e.key==='Enter') okBtn.click(); if(e.key==='Escape') ov.remove(); });
      btns.appendChild(cancelBtn);
      btns.appendChild(okBtn);
      card.appendChild(h);
      card.appendChild(inp);
      card.appendChild(btns);
      ov.appendChild(card);
      body.appendChild(ov);
      setTimeout(function(){ card.style.transform='scale(1)'; card.style.opacity='1' },10);
      setTimeout(function(){ inp.focus() },100);
    }

    function createFile() {
      promptOverlay('New File', 'filename.txt', function(name) {
        if (name.indexOf('.') === -1) name += '.txt';
        fetch('/api/fs/write', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ path: currentPath + '/' + name, content: '' })
        }).then(function() { loadFiles(); }).catch(function() {});
      });
    }

    function createFolder() {
      promptOverlay('New Folder', 'Untitled Folder', function(name) {
        fetch('/api/fs/mkdir', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ path: currentPath + '/' + name })
        }).then(function() { loadFiles(); }).catch(function() {});
      });
    }

    function deleteSelected() {
      var sel = body.querySelector('.finder-item.selected, .finder-list-row.selected');
      if (!sel) return;
      var name = sel.dataset.name;
      var isDir = sel.dataset.dir === 'true';
      var fullPath = currentPath + '/' + name;
      fetch('/api/fs/rm', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ path: fullPath })
      }).then(function() { loadFiles(); }).catch(function() {});
    }

    function render() {
      var sb = '<div class="finder-sidebar">';
      sidebarItems.forEach(function(sec) {
        sb += '<div class="section-label">' + sec.label + '</div>';
        sec.items.forEach(function(item) {
          var a = currentPath === item.path ? ' active' : '';
          sb += '<div class="nav-item' + a + '" data-path="' + item.path + '"><span class="nav-icon">' + item.icon + '</span>' + item.name + '</div>';
        });
      });
      sb += '</div><div class="finder-content"><div class="finder-toolbar"><div class="path">Path: <span>' + escHtml(currentPath) + '</span></div>';
      sb += '<div class="finder-toolbar-actions">';
      sb += '<button class="finder-action-btn" id="f-new-file-' + w.id + '" title="New File">&#128196;+</button>';
      sb += '<button class="finder-action-btn" id="f-new-folder-' + w.id + '" title="New Folder">&#128193;+</button>';
      sb += '<button class="finder-action-btn" id="f-delete-' + w.id + '" title="Delete">&#128465;</button>';
      sb += '<div class="finder-view-btns">';
      sb += '<button class="finder-view-btn' + (viewMode === 'grid' ? ' active' : '') + '" data-view="grid">&#9638;</button>';
      sb += '<button class="finder-view-btn' + (viewMode === 'list' ? ' active' : '') + '" data-view="list">&#9776;</button>';
      sb += '</div></div></div>';
      if (viewMode === 'grid') sb += '<div class="finder-grid"></div>';
      else sb += '<div class="finder-list"><div class="finder-list-header"><span>Name</span><span>Size</span><span>Modified</span></div></div>';
      sb += '<div class="finder-status"></div></div>';
      body.innerHTML = '<div class="finder-body">' + sb + '</div>';

      var newFileBtn = body.querySelector('#f-new-file-' + w.id);
      var newFolderBtn = body.querySelector('#f-new-folder-' + w.id);
      var deleteBtn = body.querySelector('#f-delete-' + w.id);
      if (newFileBtn) newFileBtn.onclick = createFile;
      if (newFolderBtn) newFolderBtn.onclick = createFolder;
      if (deleteBtn) deleteBtn.onclick = deleteSelected;

      body.querySelectorAll('.nav-item').forEach(function(el) {
        el.onclick = function() { currentPath = el.dataset.path; render(); };
      });
      body.querySelectorAll('.finder-view-btn').forEach(function(el) {
        el.onclick = function() { viewMode = el.dataset.view; render(); };
      });
      loadFiles();
    }

    function loadFiles() {
      fetch('/api/fs/ls?path=' + encodeURIComponent(currentPath))
        .then(function(r) { return r.json(); })
        .then(function(items) {
          var status = body.querySelector('.finder-status');
          if (status) {
            var dc = items.filter(function(i) { return i.is_dir; }).length;
            var fc = items.filter(function(i) { return !i.is_dir; }).length;
            status.textContent = dc + ' folder' + (dc !== 1 ? 's' : '') + ', ' + fc + ' file' + (fc !== 1 ? 's' : '');
          }
          if (!items.length) {
            var g = body.querySelector(viewMode === 'grid' ? '.finder-grid' : '.finder-list');
            if (g) g.innerHTML = '<div class="finder-empty"><div class="empty-icon">&#128193;</div>This folder is empty</div>';
            return;
          }
          if (viewMode === 'grid') {
            var grid = body.querySelector('.finder-grid');
            if (!grid) return;
            grid.innerHTML = items.map(function(item) {
              var icon = item.is_dir ? '&#128193;' : fileIcon(item.name);
              return '<div class="finder-item" data-name="' + escHtml(item.name) + '" data-dir="' + item.is_dir + '"><div class="fi-icon">' + icon + '</div><div class="fi-name">' + escHtml(item.name) + '</div></div>';
            }).join('');
            grid.querySelectorAll('.finder-item').forEach(function(el) {
              el.onclick = function(e) { if (!e.ctrlKey) grid.querySelectorAll('.finder-item').forEach(function(x) { x.classList.remove('selected'); }); el.classList.toggle('selected'); };
              el.ondblclick = function() { openItem(el.dataset.name, el.dataset.dir === 'true'); };
            });
          } else {
            var list = body.querySelector('.finder-list');
            if (!list) return;
            list.innerHTML = '<div class="finder-list-header"><span>Name</span><span>Size</span><span>Modified</span></div>' + items.map(function(item) {
              var icon = item.is_dir ? '&#128193;' : fileIcon(item.name);
              var sz = item.is_dir ? '--' : item.size + 'b';
              var dt = new Date().toLocaleDateString();
              return '<div class="finder-list-row" data-name="' + escHtml(item.name) + '" data-dir="' + item.is_dir + '"><span>' + icon + ' ' + escHtml(item.name) + '</span><span>' + sz + '</span><span>' + dt + '</span></div>';
            }).join('');
            list.querySelectorAll('.finder-list-row').forEach(function(el) {
              el.onclick = function(e) { if (!e.ctrlKey) list.querySelectorAll('.finder-list-row').forEach(function(x) { x.classList.remove('selected'); }); el.classList.toggle('selected'); };
              el.ondblclick = function() { openItem(el.dataset.name, el.dataset.dir === 'true'); };
            });
          }
        }).catch(function() {});
    }

    function openItem(name, isDir) {
      if (isDir) {
        currentPath = currentPath === '/' ? '/' + name : currentPath + '/' + name;
        render();
      } else {
        fetch('/api/fs/cat?path=' + encodeURIComponent(currentPath + '/' + name))
          .then(function(r) { return r.json(); })
          .then(function(d) {
            var ew = mgr.createWindow({ appId: 'editor', title: name, width: 520, height: 380 });
            ew.bodyEl.innerHTML = '<div style="position:absolute;inset:0"><textarea style="width:100%;height:100%;background:#0c0c14;color:var(--text);font-family:var(--mono);font-size:13px;padding:14px;border:none;outline:none;resize:none" spellcheck="false">' + (d.content || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea></div>';
          }).catch(function() {});
      }
    }

    render();
  }
});
