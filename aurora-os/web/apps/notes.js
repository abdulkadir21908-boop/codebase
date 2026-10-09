AppManager.register('notes', {
  name: 'Notes',
  icon: '&#128221;',
  color: 'linear-gradient(135deg,#f9e2af,#fab387)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'notes', title: 'Notes', width: 640, height: 440 });
    var body = w.bodyEl;

    var defaultNotes = [
      { id: 1, title: 'Welcome to Aurora', body: 'Aurora OS v0.1.0 - Dawn Release\n\nThis is the first release of Aurora OS.\nFeatures:\n- Custom AISA-64 CPU architecture\n- Custom assembler and instruction set\n- In-memory filesystem (AuroraFS)\n- Desktop environment with windows\n- Dock, menu bar, and notifications\n- Terminal, Finder, Calculator, Notes\n- Activity Monitor, System Settings\n\nEnjoy the Aurora experience!', date: new Date().toLocaleDateString() },
      { id: 2, title: 'Kernel Boot Sequence', body: '1. BIOS POST and memory check\n2. Load kernel from sector 1\n3. Display boot logo (ASCII art)\n4. Initialize AISA-64 CPU\n5. Set up interrupt vector table\n6. Load filesystem driver\n7. Initialize window server\n8. Start desktop environment\n\nKernel size: 556 bytes', date: new Date().toLocaleDateString() },
      { id: 3, title: 'Shortcuts', body: 'Ctrl+Space  - Spotlight Search\nEsc         - Close Spotlight\nCtrl+N      - New Terminal\nCtrl+Shift+A - Activity Monitor\n\nWindow Controls:\nRed    - Close\nYellow - Minimize\nGreen  - Maximize\n\nDrag title bar to move windows.', date: new Date().toLocaleDateString() }
    ];

    var notes = [];
    var selectedId = null;
    var editing = false;
    var nextId = 1;
    var saveTimer = null;

    function saveNotes() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function() {
        fetch('/api/notes/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: notes })
        }).catch(function() {});
      }, 300);
    }

    function render() {
      var nb = '<div class="notes-sidebar"><div class="ns-header"><button class="ns-add" title="New Note">+ New</button></div><div class="ns-list">';
      notes.forEach(function(n) {
        var sel = selectedId === n.id ? ' selected' : '';
        var preview = n.body.substring(0, 40).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        nb += '<div class="ns-item' + sel + '" data-nid="' + n.id + '"><div class="ns-title">' + n.title.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div><div class="ns-date">' + n.date + '</div><div class="ns-preview">' + preview + '...</div></div>';
      });
      nb += '</div></div>';

      var content = '<div class="notes-empty"><div class="empty-icon">&#128221;</div>Select a note or create a new one</div>';
      if (selectedId) {
        var n = notes.find(function(x) { return x.id === selectedId; });
        if (n) {
          if (editing) {
            var safeTitle = n.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            var safeBody = n.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            content = '<div class="notes-editor"><div class="ne-header"><input class="ne-title" value="' + safeTitle + '" placeholder="Note title..."></div><textarea class="ne-body" placeholder="Start typing...">' + safeBody + '</textarea><div class="ne-footer"><span>' + n.date + '</span><span>' + n.body.split(/\s+/).filter(Boolean).length + ' words</span></div></div>';
          } else {
            var safeBody2 = n.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
            var safeTitle2 = n.title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
            content = '<div class="notes-viewer"><div class="nv-header"><span class="nv-title">' + safeTitle2 + '</span><div class="nv-actions"><button class="nv-btn" data-action="edit">Edit</button><button class="nv-btn nv-del" data-action="delete">Delete</button></div></div><div class="nv-body">' + safeBody2 + '</div><div class="nv-footer"><span>' + n.date + '</span><span>' + n.body.split(/\s+/).filter(Boolean).length + ' words</span></div></div>';
          }
        }
      }
      body.innerHTML = '<div class="notes-body">' + nb + '<div class="notes-content">' + content + '</div></div>';

      body.querySelectorAll('.ns-item').forEach(function(el) {
        el.onclick = function() { selectedId = parseInt(el.getAttribute('data-nid')); editing = false; render(); };
      });
      var addBtn = body.querySelector('.ns-add');
      if (addBtn) {
        addBtn.onclick = function() {
          var nn = { id: nextId++, title: 'Untitled Note', body: '', date: new Date().toLocaleDateString() };
          notes.unshift(nn);
          selectedId = nn.id;
          editing = true;
          saveNotes();
          render();
        };
      }
      var editBtn = body.querySelector('[data-action="edit"]');
      if (editBtn) editBtn.onclick = function() { editing = true; render(); };
      var delBtn = body.querySelector('[data-action="delete"]');
      if (delBtn) delBtn.onclick = function() {
        var idx = -1;
        notes.forEach(function(x, i) { if (x.id === selectedId) idx = i; });
        if (idx >= 0) notes.splice(idx, 1);
        selectedId = null; editing = false;
        saveNotes();
        render();
      };
      var titleInput = body.querySelector('.ne-title');
      var bodyInput = body.querySelector('.ne-body');
      if (titleInput) titleInput.oninput = function(e) { var n = notes.find(function(x) { return x.id === selectedId; }); if (n) { n.title = e.target.value; saveNotes(); } };
      if (bodyInput) bodyInput.oninput = function(e) { var n = notes.find(function(x) { return x.id === selectedId; }); if (n) { n.body = e.target.value; saveNotes(); } };
    }

    fetch('/api/notes').then(function(r) { return r.json(); }).then(function(data) {
      if (Array.isArray(data) && data.length > 0) {
        notes = data;
        nextId = 0;
        notes.forEach(function(n) { if (n.id >= nextId) nextId = n.id + 1; });
      } else {
        notes = defaultNotes;
        nextId = notes.length + 1;
        saveNotes();
      }
      render();
    }).catch(function() {
      notes = defaultNotes;
      nextId = notes.length + 1;
      render();
    });
  }
});
