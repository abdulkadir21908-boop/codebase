AppManager.register('calculator', {
  name: 'Calculator',
  icon: '&#129518;',
  color: 'linear-gradient(135deg,#45475a,#585b70)',
  create: function(mgr) {
    var w = mgr.createWindow({ appId: 'calculator', title: 'Calculator', width: 252, height: 380 });
    var body = w.bodyEl;
    var display = '0', expr = '', first = null, op = null, waiting = false;
    var lastOp = null, lastOperand = null;

    var buttons = [
      ['C', '\u00B1', '%', '\u00F7'],
      ['7', '8', '9', '\u00D7'],
      ['4', '5', '6', '\u2212'],
      ['1', '2', '3', '+'],
      ['0', '.', '=']
    ];

    function fmt(n) {
      if (typeof n !== 'number' || !isFinite(n) || isNaN(n)) return 'Error';
      if (n === 0) return '0';
      var r = parseFloat(n.toPrecision(12));
      var s = String(r);
      if (s.length > 12) {
        if (Math.abs(r) >= 1e12 || (Math.abs(r) < 1e-6 && r !== 0)) {
          return r.toExponential(5).replace(/(\.\d*?)0+e/, '$1e').replace(/\.e/, 'e');
        }
        s = s.slice(0, 12);
      }
      return s;
    }

    function compute(a, b, operator) {
      if (operator === '+') return a + b;
      if (operator === '\u2212') return a - b;
      if (operator === '\u00D7') return a * b;
      if (operator === '\u00F7') {
        if (b === 0) return null;
        return a / b;
      }
      return b;
    }

    function showError() {
      display = 'Error'; expr = ''; first = null; op = null;
      waiting = true; lastOp = null; lastOperand = null;
    }

    function inputDigit(d) {
      if (display === 'Error') { display = d; expr = ''; first = null; op = null; waiting = false; lastOp = null; return; }
      if (waiting) { display = d; waiting = false; return; }
      var clean = display.replace('-', '').replace('.', '');
      if (clean === '0' && d === '0') return;
      if (clean.length >= 9) return;
      if (display === '0') display = d;
      else if (display === '-0') display = '-' + d;
      else display += d;
    }

    function inputDot() {
      if (display === 'Error') { display = '0.'; waiting = false; expr = ''; return; }
      if (waiting) { display = '0.'; waiting = false; return; }
      if (display.indexOf('.') === -1) display += '.';
    }

    function toggleSign() {
      if (display === 'Error' || display === '0' || display === '0.') return;
      if (waiting) {
        if (first !== null) {
          first = -first;
          display = fmt(first);
        }
        return;
      }
      if (display.charAt(0) === '-') display = display.slice(1);
      else display = '-' + display;
    }

    function percent() {
      if (display === 'Error') return;
      var v = parseFloat(display);
      if (isNaN(v)) return;
      v = v / 100;
      display = fmt(v);
      if (waiting && first !== null && op !== null) {
        // keep waiting state so next = uses percent value
      }
    }

    function backspace() {
      if (waiting || display === 'Error') return;
      if (display.length <= 1 || (display.length === 2 && display.charAt(0) === '-')) display = '0';
      else display = display.slice(0, -1);
    }

    function clearAll() {
      display = '0'; expr = ''; first = null; op = null;
      waiting = false; lastOp = null; lastOperand = null;
    }

    function setOperator(nextOp) {
      if (display === 'Error') return;
      var cur = parseFloat(display);
      if (op !== null && waiting) {
        op = nextOp;
        expr = fmt(first) + ' ' + nextOp;
        lastOp = null;
        renderCalc();
        return;
      }
      if (first === null) {
        first = cur;
      } else if (op !== null) {
        var res = compute(first, cur, op);
        if (res === null || !isFinite(res)) { showError(); renderCalc(); return; }
        first = parseFloat(fmt(res));
        display = fmt(first);
      }
      waiting = true;
      op = nextOp;
      lastOp = null; lastOperand = null;
      expr = fmt(first) + ' ' + nextOp;
      renderCalc();
    }

    function equals() {
      if (display === 'Error') return;
      var cur = parseFloat(display);
      if (op !== null) {
        var second = waiting ? first : cur;
        var res = compute(first, second, op);
        if (res === null || !isFinite(res)) { showError(); renderCalc(); return; }
        expr = fmt(first) + ' ' + op + ' ' + fmt(second) + ' =';
        display = fmt(res);
        lastOp = op; lastOperand = second;
        first = null; op = null; waiting = true;
      } else if (lastOp !== null) {
        var res2 = compute(cur, lastOperand, lastOp);
        if (res2 === null || !isFinite(res2)) { showError(); renderCalc(); return; }
        expr = fmt(cur) + ' ' + lastOp + ' ' + fmt(lastOperand) + ' =';
        display = fmt(res2);
        waiting = true;
      }
      renderCalc();
    }

    function renderCalc() {
      var h = '<div class="calc-body"><div class="calc-display"><div class="calc-expr">' + expr + '</div><div class="calc-result">' + display + '</div></div><div class="calc-buttons">';
      var fnSet = { 'C': 1, '\u00B1': 1, '%': 1 };
      var opSet = { '\u00F7': 1, '\u00D7': 1, '\u2212': 1, '+': 1 };
      buttons.forEach(function(row) {
        row.forEach(function(btn) {
          var cls = 'calc-btn calc-num';
          if (fnSet[btn]) cls = 'calc-btn calc-fn';
          else if (opSet[btn]) cls = 'calc-btn calc-op';
          else if (btn === '=') cls = 'calc-btn calc-eq';
          if (btn === '0') cls += ' calc-zero';
          h += '<div class="' + cls + '" data-btn="' + btn + '">' + btn + '</div>';
        });
      });
      h += '</div></div>';
      body.innerHTML = h;
      body.querySelectorAll('.calc-btn').forEach(function(el) {
        el.onclick = function() { pressBtn(el.getAttribute('data-btn')); };
      });
    }

    function pressBtn(btn) {
      if (btn >= '0' && btn <= '9') inputDigit(btn);
      else if (btn === '.') inputDot();
      else if (btn === 'C') clearAll();
      else if (btn === '\u00B1') toggleSign();
      else if (btn === '%') percent();
      else if (btn === '=') { equals(); return; }
      else setOperator(btn);
      renderCalc();
    }

    document.addEventListener('keydown', function handler(e) {
      if (!document.body.contains(body)) {
        document.removeEventListener('keydown', handler);
        return;
      }
      var focused = mgr.getFocused && mgr.getFocused();
      if (!focused || focused.id !== w.id) return;
      var k = e.key;
      if (k >= '0' && k <= '9') { pressBtn(k); e.preventDefault(); }
      else if (k === '.') { pressBtn('.'); e.preventDefault(); }
      else if (k === '+') { pressBtn('+'); e.preventDefault(); }
      else if (k === '-') { pressBtn('\u2212'); e.preventDefault(); }
      else if (k === '*') { pressBtn('\u00D7'); e.preventDefault(); }
      else if (k === '/') { pressBtn('\u00F7'); e.preventDefault(); }
      else if (k === '%') { pressBtn('%'); e.preventDefault(); }
      else if (k === 'Enter' || k === '=') { pressBtn('='); e.preventDefault(); }
      else if (k === 'Escape') { pressBtn('C'); e.preventDefault(); }
      else if (k === 'Backspace') { backspace(); renderCalc(); e.preventDefault(); }
    });

    renderCalc();
  }
});
