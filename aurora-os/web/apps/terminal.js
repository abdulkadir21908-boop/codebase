AppManager.register('terminal', {
  name: 'Terminal',
  icon: '&#128187;',
  color: 'linear-gradient(135deg,#1e1e2e,#313244)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'terminal', title: 'Terminal', width: 720, height: 480 });
    var body = w.bodyEl;
    var wid = w.id;

    body.classList.add('term-selection');

    var titleBar = document.createElement('div');
    titleBar.className = 'term-title-bar';
    titleBar.innerHTML = '<div class="term-dots"><span class="term-dot red" title="Close"></span><span class="term-dot yellow" title="Minimize"></span><span class="term-dot green" title="Maximize"></span></div><div class="term-tabs" id="term-tabs-' + wid + '"><div class="term-tab active">bash</div><span class="term-add-tab" title="New Tab">+</span></div>';
    body.appendChild(titleBar);

    var out = document.createElement('div');
    out.className = 'term-output';
    out.id = 'tout-' + wid;
    body.appendChild(out);

    var inputWrap = document.createElement('div');
    inputWrap.className = 'term-input-wrap';
    inputWrap.innerHTML = '<span class="term-prompt-line"><span class="term-user">user</span><span class="term-at">@</span><span class="term-host">aurora</span><span class="term-sep">:</span><span class="term-path" id="tpath-' + wid + '">~</span><span class="term-prompt">$ </span></span><input class="term-input" id="tin-' + wid + '" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off">';
    body.appendChild(inputWrap);

    var inp = body.querySelector('.term-input');
    var pathEl = body.querySelector('.term-path');
    var history = [];
    var histIdx = -1;
    var cancelled = false;
    var cwd = '~';

    var ESC = {
      red:     '<span style="color:#f38ba8">',
      green:   '<span style="color:#a6e3a1">',
      yellow:  '<span style="color:#f9e2af">',
      blue:    '<span style="color:#89b4fa">',
      magenta: '<span style="color:#cba6f7">',
      cyan:    '<span style="color:#94e2d5">',
      white:   '<span style="color:#cdd6f4">',
      gray:    '<span style="color:#6c7086">',
      bold:    '<span style="font-weight:700">',
      dim:     '<span style="opacity:.6">',
      reset:   '</span>',
      link:    '<span style="color:#89b4fa;text-decoration:underline;cursor:pointer" onclick="window.open(\'%URL%\')">'
    };

    function parseAnsi(text) {
      var s = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      var codes = {
        '1;31': ESC.red, '1;32': ESC.green, '1;33': ESC.yellow,
        '1;34': ESC.blue, '1;35': ESC.magenta, '1;36': ESC.cyan,
        '1;37': ESC.white, '0;30': ESC.gray, '0;31': ESC.red,
        '0;32': ESC.green, '0;33': ESC.yellow, '0;34': ESC.blue,
        '0;35': ESC.magenta, '0;36': ESC.cyan, '0;37': ESC.white,
        '1': ESC.bold, '2': ESC.dim, '0': ESC.reset
      };
      s = s.replace(/\x1b\[([0-9;]*)m/g, function(m, code) {
        return codes[code] || '';
      });
      return s;
    }

    function writeLine(text, raw) {
      var span = document.createElement('span');
      span.innerHTML = raw ? text : parseAnsi(text);
      out.appendChild(span);
      out.appendChild(document.createTextNode('\n'));
      out.scrollTop = out.scrollHeight;
    }

    function writeHtml(html) {
      var span = document.createElement('span');
      span.innerHTML = html;
      out.appendChild(span);
      out.appendChild(document.createTextNode('\n'));
      out.scrollTop = out.scrollHeight;
    }

    function getDirName(p) {
      if (p === '~') return '~';
      var parts = p.split('/');
      return parts[parts.length - 1] || p;
    }

    function updatePrompt(p) {
      pathEl.textContent = p;
      cwd = p;
      var dirName = getDirName(p);
      document.title = 'user@aurora: ' + dirName;
      var tab = document.querySelector('#term-tabs-' + wid + ' .term-tab.active');
      if (tab) tab.textContent = dirName + ' — bash';
    }

    writeHtml(
      ESC.cyan + ESC.bold +
      '         _                         __              ' + ESC.reset + '\n' +
      ESC.cyan + '    ____(_)___ _____ ___  ____    ' + ESC.reset + '/ /' + ESC.dim + '___  _________ _  ' + ESC.reset + '\n' +
      ESC.cyan + '   / __  / __ `/ __ `__ \\/ __ \\  ' + ESC.reset + '/ __/' + ESC.blue + ' \\/ ___/ __ `/ ' + ESC.reset + '\n' +
      ESC.cyan + '  / /_/ / /_/ / / / / / / /_/ / ' + ESC.reset + '/ /_' + ESC.blue + ' /__/ /  / /_/ /  ' + ESC.reset + '\n' +
      ESC.cyan + '  \\__,_/\\__,_/_/ /_/ /_/\\____/  ' + ESC.reset + '\\__/\\___/_/   \\__,_/   ' + ESC.reset + '\n' +
      ESC.dim + '  Aurora Terminal  |  bash  |  ' + ESC.reset + ESC.gray + new Date().toLocaleDateString() + ESC.reset
    );
    writeHtml('');

    refreshPath();

    function refreshPath() {
      fetch('/api/fs/pwd').then(function(r) { return r.json(); }).then(function(d) {
        updatePrompt(d.path.replace('/home/user', '~'));
      }).catch(function() {});
    }

    function appendPrompt() {
      var span = document.createElement('span');
      span.className = 'term-prompt-line';
      var userSpan = document.createElement('span');
      userSpan.className = 'term-user';
      userSpan.textContent = 'user';
      var atSpan = document.createElement('span');
      atSpan.className = 'term-at';
      atSpan.textContent = '@';
      var hostSpan = document.createElement('span');
      hostSpan.className = 'term-host';
      hostSpan.textContent = 'aurora';
      var sepSpan = document.createElement('span');
      sepSpan.className = 'term-sep';
      sepSpan.textContent = ':';
      var pathSpan = document.createElement('span');
      pathSpan.className = 'term-path';
      pathSpan.textContent = pathEl.textContent;
      var promptSpan = document.createElement('span');
      promptSpan.className = 'term-prompt';
      promptSpan.textContent = ' $ ';
      span.appendChild(userSpan);
      span.appendChild(atSpan);
      span.appendChild(hostSpan);
      span.appendChild(sepSpan);
      span.appendChild(pathSpan);
      span.appendChild(promptSpan);
      out.appendChild(span);
      out.scrollTop = out.scrollHeight;
    }

    function executeCommand(cmd) {
      history.push(cmd);
      histIdx = history.length;
      cancelled = false;

      appendPrompt();
      var cmdSpan = document.createElement('span');
      cmdSpan.className = 'term-cmd';
      cmdSpan.textContent = cmd;
      out.appendChild(cmdSpan);
      out.appendChild(document.createTextNode('\n'));
      out.scrollTop = out.scrollHeight;

      if (cmd.trim() === '') return;

      var args = cmd.trim().split(/\s+/);
      var cmdName = args[0];

      if (cmdName === 'clear' || cmdName === 'cls') {
        out.innerHTML = '';
        return;
      }

      fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: cmd })
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (cancelled) return;
          if (d.output === '__CLEAR__') {
            out.innerHTML = '';
          } else if (d.output) {
            writeLine(parseAnsi(d.output));
          }
          if (d.path !== undefined) updatePrompt(d.path.replace('/home/user', '~'));
          out.scrollTop = out.scrollHeight;
        })
        .catch(function() {
          if (!cancelled) writeLine(ESC.red + ESC.bold + 'Error: connection lost' + ESC.reset);
        });
    }

    function doTabComplete() {
      var val = inp.value;
      fetch('/api/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partial: val })
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.completions && d.completions.length === 1) {
            inp.value = d.completions[0];
          } else if (d.completions && d.completions.length > 1) {
            appendPrompt();
            var cmdSpan = document.createElement('span');
            cmdSpan.className = 'term-cmd';
            cmdSpan.textContent = val;
            out.appendChild(cmdSpan);
            out.appendChild(document.createTextNode('\n'));
            var completions = d.completions.map(function(c) {
              return ESC.blue + c.replace(/&/g, '&amp;').replace(/</g, '&lt;') + ESC.reset;
            });
            writeLine(completions.join('  '));
          }
        })
        .catch(function() {});
    }

    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var cmd = inp.value;
        inp.value = '';
        executeCommand(cmd);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        doTabComplete();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (histIdx > 0) { histIdx--; inp.value = history[histIdx]; }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (histIdx < history.length - 1) { histIdx++; inp.value = history[histIdx]; }
        else { histIdx = history.length; inp.value = ''; }
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        out.innerHTML = '';
      } else if (e.key === 'c' && e.ctrlKey) {
        e.preventDefault();
        cancelled = true;
        appendPrompt();
        var cmdSpan = document.createElement('span');
        cmdSpan.textContent = inp.value + '^C';
        cmdSpan.style.color = '#f38ba8';
        out.appendChild(cmdSpan);
        out.appendChild(document.createTextNode('\n'));
        inp.value = '';
        out.scrollTop = out.scrollHeight;
      } else if (e.key === 'a' && e.ctrlKey) {
        e.preventDefault();
        inp.setSelectionRange(0, 0);
      } else if (e.key === 'e' && e.ctrlKey) {
        e.preventDefault();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      } else if (e.key === 'u' && e.ctrlKey) {
        e.preventDefault();
        inp.value = '';
      } else if (e.key === 'w' && e.ctrlKey) {
        e.preventDefault();
        var val = inp.value;
        var pos = inp.selectionStart;
        var before = val.substring(0, pos);
        var after = val.substring(pos);
        var trimmed = before.replace(/\s*\S+\s*$/, '');
        inp.value = trimmed + after;
        inp.setSelectionRange(trimmed.length, trimmed.length);
      } else if (e.key === 'k' && e.ctrlKey) {
        e.preventDefault();
        inp.value = inp.value.substring(0, inp.selectionStart);
      } else if (e.key === 'r' && e.ctrlKey) {
        e.preventDefault();
        var search = prompt('Reverse search:');
        if (search) {
          for (var i = history.length - 1; i >= 0; i--) {
            if (history[i].indexOf(search) !== -1) {
              inp.value = history[i];
              break;
            }
          }
        }
      }
    });

    titleBar.querySelector('.term-dot.red').addEventListener('click', function() { mgr.close(wid); });
    titleBar.querySelector('.term-dot.yellow').addEventListener('click', function() { mgr.minimize(wid); });
    titleBar.querySelector('.term-dot.green').addEventListener('click', function() { mgr.toggleMaximize(wid); });
    titleBar.querySelector('.term-add-tab').addEventListener('click', function() {
      mgr.open('terminal');
    });

    setTimeout(function() { inp.focus(); }, 100);
    w.el.addEventListener('click', function() { inp.focus(); });
  }
});
