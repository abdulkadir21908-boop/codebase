AppManager.register('codeeditor', {
  name: 'Aurora Code',
  icon: '&#9998;',
  color: 'linear-gradient(135deg,#89b4fa,#74c7ec)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'codeeditor', title: 'Aurora Code', width: 960, height: 620 });
    var body = w.bodyEl;
    var home = '';
    var openTabs = [];
    var activeTab = null;
    var modified = {};
    var explorerTree = null;
    var explorerExpanded = {};
    var findVisible = false;
    var cmdVisible = false;
    var minimapVisible = true;

    var langMap = {
      js: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript',
      py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java',
      html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', less: 'LESS',
      json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
      md: 'Markdown', txt: 'Text', sh: 'Shell', bash: 'Shell', zsh: 'Shell',
      sql: 'SQL', xml: 'XML', c: 'C', cpp: 'C++', h: 'C Header',
      php: 'PHP', swift: 'Swift', kt: 'Kotlin', dart: 'Dart',
      makefile: 'Makefile', dockerfile: 'Dockerfile', gitignore: 'Git Ignore'
    };

    var iconMap = {
      js: '\u{1F7E1}', jsx: '\u{1F7E1}', ts: '\u{1F535}', tsx: '\u{1F535}',
      py: '\u{1F40D}', rb: '\u{1F534}', go: '\u{00AE}', rs: '\u{1F6E0}',
      java: '\u2615', html: '\u{1F310}', css: '\u{1F3A8}', scss: '\u{1F3A8}',
      json: '\u{1F4CB}', md: '\u{1F4DD}', txt: '\u{1F4C4}',
      sh: '\u{1F4BB}', sql: '\u{1F5C4}', c: '\u{1F4BB}', cpp: '\u{1F4BB}',
      php: '\u{1F350}', swift: '\u{1F300}', kt: '\u{1F31F}'
    };

    var extIcons = {
      folder: '\u{1F4C1}', folderOpen: '\u{1F4C2}', file: '\u{1F4C4}'
    };

    function extOf(name) {
      var parts = name.split('.');
      return parts.length > 1 ? parts.pop().toLowerCase() : '';
    }

    function langOf(name) { return langMap[extOf(name)] || 'Text'; }
    function iconOf(name) { return iconMap[extOf(name)] || ''; }

    function getTab(id) {
      for (var i = 0; i < openTabs.length; i++) {
        if (openTabs[i].id === id) return openTabs[i];
      }
      return null;
    }

    function escHtml(s) {
      if (!s) return '';
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(1) + ' MB';
    }

    // ── Syntax Highlighting ──
    function highlight(code, lang) {
      var esc = escHtml(code);
      if (!esc) return '';
      if (lang === 'Text' || lang === 'Markdown') return esc;
      var rules = [];
      if (lang === 'JavaScript' || lang === 'TypeScript') {
        rules = [
          [/(\/\/.*$)/gm, '<span class="syn-cmt">$1</span>'],
          [/(\/\*[\s\S]*?\*\/)/gm, '<span class="syn-cmt">$1</span>'],
          [/(&apos;&apos;[\s\S]*?&apos;&apos;|`[\s\S]*?`|&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="syn-str">$1</span>'],
          [/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|super|import|export|default|from|async|await|try|catch|finally|throw|typeof|instanceof|in|of|yield|void|delete|true|false|null|undefined|NaN|Infinity)\b/g, '<span class="syn-kw">$1</span>'],
          [/\b(\d+\.?\d*([eE][+-]?\d+)?|0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+)\b/g, '<span class="syn-num">$1</span>'],
          [/\b([A-Z][a-zA-Z0-9]*)\b/g, '<span class="syn-type">$1</span>'],
          [/\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, '<span class="syn-fn">$1</span>'],
        ];
      } else if (lang === 'Python') {
        rules = [
          [/(#.*$)/gm, '<span class="syn-cmt">$1</span>'],
          [/(&quot;&quot;&quot;[\s\S]*?&quot;&quot;&quot;|&#39;&#39;&#39;[\s\S]*?&#39;&#39;&#39;|&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="syn-str">$1</span>'],
          [/\b(def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|raise|with|yield|lambda|pass|break|continue|and|or|not|in|is|True|False|None|self|print|async|await|global|nonlocal|del|assert)\b/g, '<span class="syn-kw">$1</span>'],
          [/\b(\d+\.?\d*([eE][+-]?\d+)?|0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+)\b/g, '<span class="syn-num">$1</span>'],
          [/\b([A-Z][a-zA-Z0-9]*)\b/g, '<span class="syn-type">$1</span>'],
          [/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="syn-fn">$1</span>'],
        ];
      } else if (lang === 'HTML') {
        rules = [
          [/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="syn-cmt">$1</span>'],
          [/(&lt;\/?)([\w-]+)/g, '$1<span class="syn-kw">$2</span>'],
          [/\b([\w-]+)(?==)/g, '<span class="syn-attr">$1</span>'],
          [/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="syn-str">$1</span>'],
        ];
      } else if (lang === 'CSS' || lang === 'SCSS') {
        rules = [
          [/(\/\*[\s\S]*?\*\/)/gm, '<span class="syn-cmt">$1</span>'],
          [/(\.[a-zA-Z_-][\w-]*)/g, '<span class="syn-type">$1</span>'],
          [/(#[0-9a-fA-F]{3,8})\b/g, '<span class="syn-num">$1</span>'],
          [(/\d+\.?\d*(px|em|rem|%|vh|vw|s|ms)?/g), '<span class="syn-num">$1</span>'],
          [/@(media|keyframes|import|font-face|supports|charset|namespace)\b/g, '<span class="syn-kw">@$1</span>'],
          [/([a-zA-Z-]+)(?=\s*:)/g, '<span class="syn-attr">$1</span>'],
          [/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="syn-str">$1</span>'],
        ];
      } else if (lang === 'JSON') {
        rules = [
          [/(&quot;[^&]*?&quot;)(?=\s*:)/g, '<span class="syn-attr">$1</span>'],
          [/(&quot;[^&]*?&quot;)/g, '<span class="syn-str">$1</span>'],
          [/\b(true|false|null)\b/g, '<span class="syn-kw">$1</span>'],
          [/\b(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, '<span class="syn-num">$1</span>'],
        ];
      } else if (lang === 'Shell') {
        rules = [
          [/(#.*$)/gm, '<span class="syn-cmt">$1</span>'],
          [/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="syn-str">$1</span>'],
          [/\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|export|source|alias|unalias|local|readonly|declare|typeset|set|unset|shift|eval|exec|cd|pwd|echo|printf|read|test)\b/g, '<span class="syn-kw">$1</span>'],
          [/\b(\d+)\b/g, '<span class="syn-num">$1</span>'],
          [/\$[\w{][\w}]*/g, '<span class="syn-type">$&</span>'],
        ];
      } else if (lang === 'SQL') {
        rules = [
          [/(--.*$)/gm, '<span class="syn-cmt">$1</span>'],
          [/(\/\*[\s\S]*?\*\/)/gm, '<span class="syn-cmt">$1</span>'],
          [/\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|VIEW|DATABASE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|LIKE|BETWEEN|IS|NULL|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|DISTINCT|COUNT|SUM|AVG|MIN|MAX|UNION|ALL|EXISTS|CASE|WHEN|THEN|ELSE|END|PRIMARY|KEY|FOREIGN|REFERENCES|CONSTRAINT|DEFAULT|CHECK|UNIQUE|CASCADE|RESTRICT|GRANT|REVOKE|COMMIT|ROLLBACK|BEGIN|TRANSACTION)\b/gi, '<span class="syn-kw">$1</span>'],
          [/(&#39;[^&]*?&#39;)/g, '<span class="syn-str">$1</span>'],
          [/\b(\d+\.?\d*)\b/g, '<span class="syn-num">$1</span>'],
          [/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="syn-fn">$1</span>'],
        ];
      } else {
        rules = [
          [/(\/\/.*$|#.*$)/gm, '<span class="syn-cmt">$1</span>'],
          [/(\/\*[\s\S]*?\*\/)/gm, '<span class="syn-cmt">$1</span>'],
          [/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="syn-str">$1</span>'],
          [/\b(function|return|if|else|for|while|class|new|var|let|const|import|export|from|try|catch|throw|switch|case|break|continue|true|false|null|undefined)\b/g, '<span class="syn-kw">$1</span>'],
          [/\b(\d+\.?\d*)\b/g, '<span class="syn-num">$1</span>'],
          [/\b([A-Z][a-zA-Z0-9]*)\b/g, '<span class="syn-type">$1</span>'],
          [/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="syn-fn">$1</span>'],
        ];
      }
      for (var i = 0; i < rules.length; i++) {
        esc = esc.replace(rules[i][0], rules[i][1]);
      }
      return esc;
    }

    // ── File Explorer ──
    function loadTree(path) {
      fetch('/api/files/tree?path=' + encodeURIComponent(path || home) + '&depth=2')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          explorerTree = data.tree || [];
          home = data.path || home;
          renderExplorer();
        })
        .catch(function() {
          explorerTree = [];
          renderExplorer();
        });
    }

    function renderExplorer() {
      var el = body.querySelector('#ce-explorer');
      if (!el) return;
      if (!explorerTree || explorerTree.length === 0) {
        el.innerHTML = '<div style="padding:16px;color:var(--text3);font-size:12px">No files found</div>';
        return;
      }
      el.innerHTML = renderTreeNodes(explorerTree, 0);
      el.querySelectorAll('.ce-file-item').forEach(function(item) {
        item.onclick = function(e) {
          e.stopPropagation();
          var path = item.getAttribute('data-path');
          var isDir = item.getAttribute('data-dir') === '1';
          if (isDir) {
            toggleDir(path, item);
          } else {
            openFile(path);
          }
        };
      });
    }

    function renderTreeNodes(nodes, depth) {
      var html = '';
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.name.startsWith('.')) continue;
        var isExpanded = explorerExpanded[n.path];
        if (n.is_dir) {
          html += '<div class="ce-file-item ce-dir" data-path="' + escHtml(n.path) + '" data-dir="1" style="padding-left:' + (12 + depth * 14) + 'px">';
          html += '<span class="ce-file-icon">' + (isExpanded ? '\u{1F4C2}' : '\u{1F4C1}') + '</span>';
          html += '<span class="ce-file-name">' + escHtml(n.name) + '</span>';
          html += '</div>';
          if (isExpanded && n.children) {
            html += renderTreeNodes(n.children, depth + 1);
          }
        } else {
          var ext = extOf(n.name);
          var icon = iconMap[ext] || extIcons.file;
          html += '<div class="ce-file-item" data-path="' + escHtml(n.path) + '" data-dir="0" style="padding-left:' + (12 + depth * 14) + 'px">';
          html += '<span class="ce-file-icon">' + icon + '</span>';
          html += '<span class="ce-file-name">' + escHtml(n.name) + '</span>';
          html += '<span class="ce-file-size">' + formatSize(n.size || 0) + '</span>';
          html += '</div>';
        }
      }
      return html;
    }

    function toggleDir(path, item) {
      if (explorerExpanded[path]) {
        delete explorerExpanded[path];
      } else {
        explorerExpanded[path] = true;
        var node = findNode(explorerTree, path);
        if (node && !node._loaded) {
          fetch('/api/files/tree?path=' + encodeURIComponent(path) + '&depth=1')
            .then(function(r) { return r.json(); })
            .then(function(data) {
              node.children = data.tree || [];
              node._loaded = true;
              renderExplorer();
            });
          return;
        }
      }
      renderExplorer();
    }

    function findNode(tree, path) {
      for (var i = 0; i < tree.length; i++) {
        if (tree[i].path === path) return tree[i];
        if (tree[i].children) {
          var found = findNode(tree[i].children, path);
          if (found) return found;
        }
      }
      return null;
    }

    // ── File Open/Save ──
    function openFile(path) {
      for (var i = 0; i < openTabs.length; i++) {
        if (openTabs[i].path === path) {
          switchTab(openTabs[i].id);
          return;
        }
      }
      fetch('/api/files/read?path=' + encodeURIComponent(path))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.error) {
            showToast('Error: ' + data.error);
            return;
          }
          var tab = {
            id: Date.now() + Math.random(),
            path: path,
            name: path.split(/[/\\]/).pop(),
            content: data.content || '',
            originalContent: data.content || '',
            scrollTop: 0,
            cursorLine: 1,
            cursorCol: 1
          };
          openTabs.push(tab);
          activeTab = tab.id;
          modified[path] = false;
          renderTabs();
          renderEditor();
          renderStatusBar();
        })
        .catch(function(e) {
          showToast('Failed to open file: ' + e.message);
        });
    }

    function saveFile() {
      var tab = getTab(activeTab);
      if (!tab) return;
      fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tab.path, content: tab.content })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) {
          tab.originalContent = tab.content;
          modified[tab.path] = false;
          renderTabs();
          renderStatusBar();
          showToast('Saved: ' + tab.name);
        } else {
          showToast('Save failed: ' + (d.error || 'Unknown error'));
        }
      })
      .catch(function(e) {
        showToast('Save failed: ' + e.message);
      });
    }

    // ── Tabs ──
    function switchTab(id) {
      activeTab = id;
      renderTabs();
      renderEditor();
      renderStatusBar();
    }

    function closeTab(id, ev) {
      if (ev) ev.stopPropagation();
      var idx = -1;
      for (var i = 0; i < openTabs.length; i++) {
        if (openTabs[i].id === id) { idx = i; break; }
      }
      if (idx === -1) return;
      var tab = openTabs[idx];
      if (modified[tab.path]) {
        if (!confirm('Unsaved changes in ' + tab.name + '. Close anyway?')) return;
      }
      openTabs.splice(idx, 1);
      delete modified[tab.path];
      if (activeTab === id) {
        activeTab = openTabs.length > 0 ? openTabs[Math.min(idx, openTabs.length - 1)].id : null;
      }
      renderTabs();
      renderEditor();
      renderStatusBar();
    }

    function renderTabs() {
      var tabBar = body.querySelector('#ce-tabs');
      if (!tabBar) return;
      var html = '';
      for (var i = 0; i < openTabs.length; i++) {
        var t = openTabs[i];
        var active = t.id === activeTab;
        var isMod = modified[t.path];
        var ext = extOf(t.name);
        var dot = isMod ? '<span class="ce-tab-dot"></span>' : '';
        html += '<div class="ce-tab' + (active ? ' active' : '') + '" data-tid="' + t.id + '">';
        html += '<span class="ce-tab-icon">' + (iconOf(t.name) || extIcons.file) + '</span>';
        html += '<span class="ce-tab-name">' + escHtml(t.name) + '</span>' + dot;
        html += '<span class="ce-tab-close" data-tclose="' + t.id + '">&times;</span>';
        html += '</div>';
      }
      tabBar.innerHTML = html;
      tabBar.querySelectorAll('.ce-tab').forEach(function(el) {
        el.onclick = function(ev) {
          if (ev.target.classList.contains('ce-tab-close')) return;
          switchTab(parseFloat(el.getAttribute('data-tid')));
        };
      });
      tabBar.querySelectorAll('.ce-tab-close').forEach(function(el) {
        el.onclick = function(ev) { closeTab(parseFloat(el.getAttribute('data-tclose')), ev); };
      });
    }

    // ── Editor ──
    function renderEditor() {
      var editorEl = body.querySelector('#ce-editor');
      if (!editorEl) return;
      var tab = getTab(activeTab);
      if (!tab) {
        editorEl.innerHTML = '<div class="ce-welcome">' +
          '<div class="ce-welcome-logo">&#9998;</div>' +
          '<div class="ce-welcome-title">Aurora Code</div>' +
          '<div class="ce-welcome-sub">Open a file from the explorer or create a new one</div>' +
          '<div class="ce-welcome-keys">' +
            '<div class="ce-key-item"><kbd>Ctrl+N</kbd> New File</div>' +
            '<div class="ce-key-item"><kbd>Ctrl+S</kbd> Save</div>' +
            '<div class="ce-key-item"><kbd>Ctrl+P</kbd> Quick Open</div>' +
            '<div class="ce-key-item"><kbd>Ctrl+F</kbd> Find</div>' +
          '</div></div>';
        return;
      }
      var lang = langOf(tab.name);
      var lines = tab.content.split('\n');
      var lineCount = lines.length;
      var gutterWidth = String(lineCount).length * 8 + 24;
      var highlighted = highlight(tab.content, lang);
      var hLines = highlighted.split('\n');
      var gutter = '';
      for (var i = 0; i < lineCount; i++) {
        gutter += '<div class="ce-line-num">' + (i + 1) + '</div>';
      }

      editorEl.innerHTML =
        '<div class="ce-breadcrumb">' +
          '<span class="ce-bc-item">' + escHtml(tab.path.replace(/\\/g, '/').split('/').slice(-3).join(' / ')) + '</span>' +
          '<span class="ce-bc-sep"> \u2502 </span>' +
          '<span class="ce-bc-lang">' + lang + '</span>' +
        '</div>' +
        '<div class="ce-editor-body">' +
          '<div class="ce-gutter" id="ce-gutter">' + gutter + '</div>' +
          '<div class="ce-code-wrap" id="ce-code-wrap">' +
            '<pre class="ce-code" id="ce-code">' + hLines.map(function(l, i) {
              return '<div class="ce-line" data-line="' + (i + 1) + '">' + (l || ' ') + '</div>';
            }).join('') + '</pre>' +
            '<textarea class="ce-textarea" id="ce-textarea" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"></textarea>' +
          '</div>' +
          (minimapVisible ? '<div class="ce-minimap" id="ce-minimap"></div>' : '') +
        '</div>';

      var textarea = body.querySelector('#ce-textarea');
      var codeWrap = body.querySelector('#ce-code-wrap');
      var codeEl = body.querySelector('#ce-code');

      if (textarea) {
        textarea.value = tab.content;
        textarea.style.cssText = 'position:absolute;inset:0;opacity:0;color:transparent;caret-color:#cdd6f4;font-family:var(--font-mono,monospace);font-size:13px;line-height:1.65;padding:8px 16px;border:none;resize:none;outline:none;z-index:2;white-space:pre;overflow:auto;tab-size:2;';
        textarea.oninput = function() {
          tab.content = textarea.value;
          modified[tab.path] = tab.content !== tab.originalContent;
          renderTabs();
          updateHighlight(tab);
          renderMinimap();
        };
        textarea.onscroll = function() {
          if (codeWrap) { codeWrap.scrollTop = textarea.scrollTop; codeWrap.scrollLeft = textarea.scrollLeft; }
          var gutter = body.querySelector('#ce-gutter');
          if (gutter) gutter.style.transform = 'translateY(-' + textarea.scrollTop + 'px)';
          var mm = body.querySelector('#ce-minimap');
          if (mm) mm.scrollTop = textarea.scrollTop * 0.35;
        };
        textarea.onkeydown = function(e) {
          if (e.key === 'Tab') {
            e.preventDefault();
            var start = textarea.selectionStart;
            var end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 2;
            textarea.oninput();
          }
          if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFile(); }
          if (e.ctrlKey && e.key === 'f') { e.preventDefault(); toggleFind(); }
        };
        textarea.onclick = function() { updateCursorPos(textarea); };
        textarea.onkeyup = function() { updateCursorPos(textarea); };

        if (tab.scrollTop) { textarea.scrollTop = tab.scrollTop; textarea.onscroll(); }
        textarea.focus();
      }
      renderMinimap();
    }

    function updateHighlight(tab) {
      var codeEl = body.querySelector('#ce-code');
      if (!codeEl) return;
      var lang = langOf(tab.name);
      var lines = tab.content.split('\n');
      var hLines = lines.map(function(l, i) {
        return '<div class="ce-line" data-line="' + (i + 1) + '">' + (highlight(l, lang) || ' ') + '</div>';
      });
      codeEl.innerHTML = hLines.join('');
    }

    function renderMinimap() {
      var mm = body.querySelector('#ce-minimap');
      if (!mm) return;
      var tab = getTab(activeTab);
      if (!tab) return;
      var lines = tab.content.split('\n');
      var html = '';
      for (var i = 0; i < lines.length; i++) {
        var len = Math.min(lines[i].length, 50);
        var w = len * 1.2;
        html += '<div class="mm-line"><div class="mm-bar" style="width:' + w + 'px"></div></div>';
      }
      mm.innerHTML = '<div class="mm-content">' + html + '</div>';
    }

    function updateCursorPos(textarea) {
      var val = textarea.value;
      var pos = textarea.selectionStart;
      var before = val.substring(0, pos);
      var line = before.split('\n').length;
      var col = pos - before.lastIndexOf('\n');
      var tab = getTab(activeTab);
      if (tab) { tab.cursorLine = line; tab.cursorCol = col; }
      renderStatusBar();
    }

    // ── Find & Replace ──
    function toggleFind() {
      findVisible = !findVisible;
      var bar = body.querySelector('#ce-find-bar');
      if (bar) bar.style.display = findVisible ? 'flex' : 'none';
      if (findVisible) {
        var input = body.querySelector('#ce-find-input');
        if (input) { input.focus(); input.select(); }
      }
    }

    function doFind() {
      var input = body.querySelector('#ce-find-input');
      var textarea = body.querySelector('#ce-textarea');
      if (!input || !textarea) return;
      var query = input.value;
      if (!query) return;
      var val = textarea.value;
      var idx = val.indexOf(query, textarea.selectionEnd);
      if (idx === -1) idx = val.indexOf(query);
      if (idx !== -1) {
        textarea.selectionStart = idx;
        textarea.selectionEnd = idx + query.length;
        textarea.focus();
        var before = val.substring(0, idx);
        var line = before.split('\n').length;
        showToast('Found at line ' + line);
      } else {
        showToast('No matches found');
      }
    }

    function doReplace() {
      var input = body.querySelector('#ce-find-input');
      var repInput = body.querySelector('#ce-replace-input');
      var textarea = body.querySelector('#ce-textarea');
      if (!input || !repInput || !textarea) return;
      var query = input.value;
      var replacement = repInput.value;
      if (!query) return;
      var val = textarea.value;
      var sel = val.substring(textarea.selectionStart, textarea.selectionEnd);
      if (sel === query) {
        textarea.value = val.substring(0, textarea.selectionStart) + replacement + val.substring(textarea.selectionEnd);
        textarea.selectionStart = textarea.selectionStart;
        textarea.selectionEnd = textarea.selectionStart + replacement.length;
        textarea.oninput();
      }
      doFind();
    }

    function doReplaceAll() {
      var input = body.querySelector('#ce-find-input');
      var repInput = body.querySelector('#ce-replace-input');
      var textarea = body.querySelector('#ce-textarea');
      if (!input || !repInput || !textarea) return;
      var query = input.value;
      var replacement = repInput.value;
      if (!query) return;
      var count = 0;
      var val = textarea.value;
      while (val.indexOf(query) !== -1) {
        val = val.replace(query, replacement);
        count++;
      }
      textarea.value = val;
      textarea.oninput();
      showToast('Replaced ' + count + ' occurrences');
    }

    // ── Command Palette ──
    var commands = [
      { name: 'Save', key: 'Ctrl+S', fn: saveFile },
      { name: 'New File', key: 'Ctrl+N', fn: function() { showToast('New file \u2014 use Save As to name it'); } },
      { name: 'Find', key: 'Ctrl+F', fn: toggleFind },
      { name: 'Close Tab', key: 'Ctrl+W', fn: function() { if (activeTab) closeTab(activeTab); } },
      { name: 'Toggle Minimap', key: '', fn: function() { minimapVisible = !minimapVisible; renderEditor(); } },
      { name: 'Toggle Explorer', key: '', fn: function() { var el = body.querySelector('#ce-sidebar'); if (el) el.style.display = el.style.display === 'none' ? '' : 'none'; } },
      { name: 'Go to Line', key: 'Ctrl+G', fn: function() {
        var line = prompt('Go to line:');
        if (line) {
          var textarea = body.querySelector('#ce-textarea');
          if (!textarea) return;
          var lines = textarea.value.split('\n');
          var pos = 0;
          for (var i = 0; i < Math.min(parseInt(line) - 1, lines.length); i++) { pos += lines[i].length + 1; }
          textarea.selectionStart = textarea.selectionEnd = pos;
          textarea.focus();
        }
      }},
      { name: 'Reload Explorer', key: '', fn: function() { loadTree(home); } },
    ];

    function toggleCmdPalette() {
      cmdVisible = !cmdVisible;
      var overlay = body.querySelector('#ce-cmd-overlay');
      if (overlay) overlay.style.display = cmdVisible ? 'flex' : 'none';
      if (cmdVisible) {
        var input = body.querySelector('#ce-cmd-input');
        if (input) { input.value = ''; input.focus(); renderCmdList(''); }
      }
    }

    function renderCmdList(filter) {
      var list = body.querySelector('#ce-cmd-list');
      if (!list) return;
      var filtered = filter ? commands.filter(function(c) { return c.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1; }) : commands;
      list.innerHTML = filtered.map(function(c, i) {
        return '<div class="ce-cmd-item' + (i === 0 ? ' selected' : '') + '" data-cidx="' + i + '">' +
          '<span class="ce-cmd-name">' + c.name + '</span>' +
          '<span class="ce-cmd-key">' + c.key + '</span></div>';
      }).join('');
      list.querySelectorAll('.ce-cmd-item').forEach(function(el) {
        el.onclick = function() {
          var idx = parseInt(el.getAttribute('data-cidx'));
          toggleCmdPalette();
          if (filtered[idx]) filtered[idx].fn();
        };
      });
    }

    // ── Toast ──
    function showToast(msg) {
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%) translateY(20px);background:rgba(30,30,46,.95);color:#cdd6f4;padding:8px 18px;border-radius:8px;font-size:12px;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.08);opacity:0;transition:all .25s cubic-bezier(.16,1,.3,1)';
      t.textContent = msg;
      document.body.appendChild(t);
      requestAnimationFrame(function() { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
      setTimeout(function() {
        t.style.opacity = '0';
        t.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(function() { t.remove(); }, 300);
      }, 1800);
    }

    // ── Status Bar ──
    function renderStatusBar() {
      var bar = body.querySelector('#ce-status');
      if (!bar) return;
      var tab = getTab(activeTab);
      if (!tab) {
        bar.innerHTML = '<div class="ce-st-left"><span>Aurora Code</span></div><div class="ce-st-right"><span>v1.0</span></div>';
        return;
      }
      var lang = langOf(tab.name);
      var line = tab.cursorLine || 1;
      var col = tab.cursorCol || 1;
      var lines = tab.content.split('\n').length;
      var chars = tab.content.length;
      bar.innerHTML =
        '<div class="ce-st-left">' +
          '<span class="ce-st-item ce-st-modified">' + (modified[tab.path] ? '\u25CF Modified' : '') + '</span>' +
          '<span class="ce-st-item">' + lang + '</span>' +
        '</div>' +
        '<div class="ce-st-right">' +
          '<span class="ce-st-item">Ln ' + line + ', Col ' + col + '</span>' +
          '<span class="ce-st-item">' + lines + ' lines</span>' +
          '<span class="ce-st-item">UTF-8</span>' +
          '<span class="ce-st-item">' + (tab.content.length > 1024 ? formatSize(chars) : chars + ' chars') + '</span>' +
        '</div>';
    }

    // ── Init UI ──
    body.innerHTML =
      '<div class="ce-root">' +
        '<div class="ce-sidebar" id="ce-sidebar">' +
          '<div class="ce-explorer-header">' +
            '<span class="ce-explorer-title">Explorer</span>' +
            '<div class="ce-explorer-actions">' +
              '<button class="ce-action-btn" id="ce-new-file" title="New File">&#43;</button>' +
              '<button class="ce-action-btn" id="ce-refresh" title="Refresh">&#8635;</button>' +
            '</div>' +
          '</div>' +
          '<div class="ce-explorer-section">' +
            '<div class="ce-section-header"><span class="ce-section-arrow">\u25BE</span> Open Files</div>' +
            '<div id="ce-open-files" class="ce-open-files"></div>' +
          '</div>' +
          '<div class="ce-explorer-section">' +
            '<div class="ce-section-header"><span class="ce-section-arrow">\u25BE</span> Files</div>' +
            '<div id="ce-explorer" class="ce-explorer-tree"></div>' +
          '</div>' +
        '</div>' +
        '<div class="ce-main">' +
          '<div class="ce-tabs" id="ce-tabs"></div>' +
          '<div class="ce-find-bar" id="ce-find-bar" style="display:none">' +
            '<input type="text" id="ce-find-input" class="ce-find-input" placeholder="Find">' +
            '<input type="text" id="ce-replace-input" class="ce-find-input ce-replace-input" placeholder="Replace">' +
            '<button class="ce-find-btn" id="ce-find-next">Find</button>' +
            '<button class="ce-find-btn" id="ce-find-replace">Replace</button>' +
            '<button class="ce-find-btn" id="ce-find-replace-all">All</button>' +
            '<button class="ce-find-close" id="ce-find-close">&times;</button>' +
          '</div>' +
          '<div class="ce-editor" id="ce-editor"></div>' +
          '<div class="ce-status" id="ce-status"></div>' +
        '</div>' +
      '</div>' +
      '<div class="ce-cmd-overlay" id="ce-cmd-overlay" style="display:none">' +
        '<div class="ce-cmd-palette">' +
          '<input type="text" id="ce-cmd-input" class="ce-cmd-input" placeholder="Type a command...">' +
          '<div class="ce-cmd-list" id="ce-cmd-list"></div>' +
        '</div>' +
      '</div>' +
      '<style>' +
      '.ce-root{display:flex;height:100%;overflow:hidden;font-family:var(--font)}' +
      '.ce-sidebar{width:220px;background:#181825;border-right:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;flex-shrink:0;overflow:hidden}' +
      '.ce-explorer-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 6px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#585b70}' +
      '.ce-explorer-title{font-weight:600}' +
      '.ce-explorer-actions{display:flex;gap:2px}' +
      '.ce-action-btn{width:22px;height:22px;border:none;border-radius:4px;background:transparent;color:#6c7086;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .15s}' +
      '.ce-action-btn:hover{background:rgba(255,255,255,.06);color:#cdd6f4}' +
      '.ce-explorer-section{flex:1;overflow:hidden;display:flex;flex-direction:column}' +
      '.ce-section-header{display:flex;align-items:center;gap:4px;padding:6px 12px;font-size:11px;font-weight:600;color:#585b70;cursor:pointer;text-transform:uppercase;letter-spacing:.5px}' +
      '.ce-section-header:hover{color:#a6adc8}' +
      '.ce-section-arrow{font-size:8px;transition:transform .15s}' +
      '.ce-open-files,.ce-explorer-tree{flex:1;overflow-y:auto;overflow-x:hidden}' +
      '.ce-explorer-tree::-webkit-scrollbar,.ce-open-files::-webkit-scrollbar{width:4px}' +
      '.ce-explorer-tree::-webkit-scrollbar-thumb,.ce-open-files::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px}' +
      '.ce-file-item{display:flex;align-items:center;gap:6px;padding:4px 12px;font-size:12px;color:#a6adc8;cursor:pointer;transition:background .1s;white-space:nowrap;overflow:hidden}' +
      '.ce-file-item:hover{background:rgba(255,255,255,.04)}' +
      '.ce-file-item.active{background:rgba(137,180,250,.08);color:#cdd6f4}' +
      '.ce-file-icon{font-size:13px;flex-shrink:0;width:16px;text-align:center}' +
      '.ce-file-name{flex:1;overflow:hidden;text-overflow:ellipsis}' +
      '.ce-file-size{font-size:10px;color:#45475a;flex-shrink:0}' +
      '.ce-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}' +
      '.ce-tabs{display:flex;gap:0;background:#1e1e2e;border-bottom:1px solid rgba(255,255,255,.04);flex-shrink:0;overflow-x:auto}' +
      '.ce-tabs::-webkit-scrollbar{height:0}' +
      '.ce-tab{display:flex;align-items:center;gap:5px;padding:6px 14px;font-size:12px;color:#585b70;cursor:pointer;border-right:1px solid rgba(255,255,255,.03);transition:all .12s;white-space:nowrap;flex-shrink:0;position:relative}' +
      '.ce-tab.active{background:#181825;color:#cdd6f4}' +
      '.ce-tab.active::after{content:"";position:absolute;bottom:0;left:0;right:0;height:2px;background:#89b4fa}' +
      '.ce-tab:hover:not(.active){background:rgba(255,255,255,.02);color:#a6adc8}' +
      '.ce-tab-icon{font-size:11px}' +
      '.ce-tab-name{max-width:120px;overflow:hidden;text-overflow:ellipsis}' +
      '.ce-tab-dot{width:6px;height:6px;border-radius:50%;background:#f9e2af;flex-shrink:0}' +
      '.ce-tab-close{font-size:14px;opacity:0;padding:0 2px;border-radius:3px;flex-shrink:0;transition:opacity .1s}' +
      '.ce-tab:hover .ce-tab-close{opacity:.5}' +
      '.ce-tab-close:hover{opacity:1!important;background:rgba(243,139,168,.2);color:#f38ba8}' +
      '.ce-find-bar{display:flex;align-items:center;gap:6px;padding:6px 12px;background:#1e1e2e;border-bottom:1px solid rgba(255,255,255,.04);flex-shrink:0}' +
      '.ce-find-input{padding:5px 10px;border:1px solid rgba(255,255,255,.08);border-radius:6px;background:#181825;color:#cdd6f4;font-size:12px;outline:none;font-family:inherit;width:180px;transition:border-color .15s}' +
      '.ce-find-input:focus{border-color:rgba(137,180,250,.4)}' +
      '.ce-replace-input{width:160px}' +
      '.ce-find-btn{padding:4px 10px;border:none;border-radius:5px;background:rgba(137,180,250,.12);color:#89b4fa;font-size:11px;cursor:pointer;transition:background .12s}' +
      '.ce-find-btn:hover{background:rgba(137,180,250,.2)}' +
      '.ce-find-close{width:22px;height:22px;border:none;border-radius:4px;background:transparent;color:#6c7086;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}' +
      '.ce-find-close:hover{color:#f38ba8}' +
      '.ce-editor{flex:1;position:relative;overflow:hidden;background:#1e1e2e}' +
      '.ce-editor-body{display:flex;height:100%;position:relative}' +
      '.ce-gutter{width:48px;background:#181825;border-right:1px solid rgba(255,255,255,.04);padding:8px 0;overflow:hidden;flex-shrink:0}' +
      '.ce-line-num{font-size:12px;line-height:1.65;color:#45475a;text-align:right;padding-right:12px;font-family:var(--font-mono,monospace);user-select:none}' +
      '.ce-code-wrap{flex:1;position:relative;overflow:hidden}' +
      '.ce-code{margin:0;padding:8px 16px;font-size:13px;line-height:1.65;color:#cdd6f4;font-family:var(--font-mono,monospace);white-space:pre;tab-size:2;position:absolute;inset:0;overflow:auto;pointer-events:none;z-index:1}' +
      '.ce-code-wrap::-webkit-scrollbar,.ce-textarea::-webkit-scrollbar,.ce-minimap::-webkit-scrollbar{width:6px;height:6px}' +
      '.ce-code-wrap::-webkit-scrollbar-thumb,.ce-textarea::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:3px}' +
      '.ce-line{min-height:1.65em}' +
      '.ce-textarea{position:absolute;inset:0;color:transparent;caret-color:#cdd6f4;background:transparent;z-index:2}' +
      '.syn-kw{color:#cba6f7}' +
      '.syn-str{color:#a6e3a1}' +
      '.syn-cmt{color:#6c7086;font-style:italic}' +
      '.syn-num{color:#fab387}' +
      '.syn-type{color:#f9e2af}' +
      '.syn-fn{color:#89b4fa}' +
      '.syn-attr{color:#89dceb}' +
      '.ce-minimap{width:100px;background:#181825;border-left:1px solid rgba(255,255,255,.04);overflow:hidden;flex-shrink:0;padding:8px 6px}' +
      '.mm-line{height:3px;margin-bottom:1px}' +
      '.mm-bar{height:100%;background:rgba(205,214,244,.15);border-radius:1px}' +
      '.ce-welcome{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:#585b70}' +
      '.ce-welcome-logo{font-size:48px;margin-bottom:8px;filter:drop-shadow(0 4px 16px rgba(137,180,250,.2))}' +
      '.ce-welcome-title{font-size:22px;font-weight:600;color:#cdd6f4;margin-bottom:4px}' +
      '.ce-welcome-sub{font-size:13px;margin-bottom:20px}' +
      '.ce-welcome-keys{display:flex;flex-wrap:wrap;gap:16px;justify-content:center}' +
      '.ce-key-item{display:flex;align-items:center;gap:6px;font-size:12px;color:#6c7086}' +
      '.ce-key-item kbd{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:4px;padding:2px 7px;font-size:11px;font-family:inherit;color:#a6adc8}' +
      '.ce-breadcrumb{display:flex;align-items:center;gap:4px;padding:4px 12px;font-size:11px;color:#45475a;border-bottom:1px solid rgba(255,255,255,.03);flex-shrink:0;background:#1e1e2e}' +
      '.ce-bc-lang{color:#89b4fa}' +
      '.ce-status{display:flex;align-items:center;justify-content:space-between;padding:0 10px;height:24px;background:#181825;border-top:1px solid rgba(255,255,255,.04);font-size:11px;color:#585b70;flex-shrink:0}' +
      '.ce-st-left,.ce-st-right{display:flex;align-items:center;gap:12px}' +
      '.ce-st-item{white-space:nowrap}' +
      '.ce-st-modified{color:#f9e2af}' +
      '.ce-cmd-overlay{position:absolute;inset:0;background:rgba(0,0,0,.4);z-index:100;display:flex;justify-content:center;padding-top:80px;backdrop-filter:blur(2px)}' +
      '.ce-cmd-palette{width:420px;background:#1e1e2e;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5);max-height:320px;display:flex;flex-direction:column}' +
      '.ce-cmd-input{padding:12px 16px;border:none;border-bottom:1px solid rgba(255,255,255,.06);background:transparent;color:#cdd6f4;font-size:14px;outline:none;font-family:inherit}' +
      '.ce-cmd-input::placeholder{color:#45475a}' +
      '.ce-cmd-list{overflow-y:auto;flex:1}' +
      '.ce-cmd-item{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;cursor:pointer;transition:background .08s}' +
      '.ce-cmd-item:hover,.ce-cmd-item.selected{background:rgba(137,180,250,.08)}' +
      '.ce-cmd-name{font-size:13px;color:#cdd6f4}' +
      '.ce-cmd-key{font-size:11px;color:#585b70;font-family:var(--font-mono,monospace)}' +
      '</style>';

    // Wire up events
    body.querySelector('#ce-new-file').onclick = function() {
      var name = prompt('File name:');
      if (!name) return;
      var path = home + '/' + name;
      fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path, content: '' })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) {
          loadTree(home);
          openFile(path);
          showToast('Created: ' + name);
        }
      });
    };
    body.querySelector('#ce-refresh').onclick = function() { loadTree(home); };

    body.querySelector('#ce-find-next').onclick = doFind;
    body.querySelector('#ce-find-replace').onclick = doReplace;
    body.querySelector('#ce-find-replace-all').onclick = doReplaceAll;
    body.querySelector('#ce-find-close').onclick = function() { toggleFind(); };

    body.querySelector('#ce-cmd-input').oninput = function(e) { renderCmdList(e.target.value); };
    body.querySelector('#ce-cmd-overlay').onclick = function(e) { if (e.target.id === 'ce-cmd-overlay') toggleCmdPalette(); };
    body.querySelector('#ce-cmd-input').onkeydown = function(e) {
      if (e.key === 'Escape') toggleCmdPalette();
      if (e.key === 'Enter') {
        var sel = body.querySelector('.ce-cmd-item.selected');
        if (sel) sel.click();
      }
    };

    body.onkeydown = function(e) {
      if (e.ctrlKey && e.key === 'p') { e.preventDefault(); toggleCmdPalette(); }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFile(); }
      if (e.ctrlKey && e.key === 'f') { e.preventDefault(); toggleFind(); }
      if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (activeTab) closeTab(activeTab); }
    };

    // Init
    renderEditor();
    renderStatusBar();
    loadTree(home);
  }
});
