#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sigma  (written  Σ)  --  a programming language made only of mathematics.

There are no keywords, no strings, no statements and no libraries.
Every literal in a Sigma program is a number.  Every operation is a
operator that already exists in school mathematics.  Repetition is
recursion, because recursion is the only loop mathematics offers.

The one concession is the device symbol  (Δ),  which is memory-mapped I/O.
That is how real hardware works, and it is arguably more mathematical
than a keyword like `print`.

    python sigma.py program.m
    python sigma.py -e "(f = (n) => n < 2 ? 1 : n * f(n - 1))(10)"
    python sigma.py --codes "Hello"
    python sigma.py repl
"""

from __future__ import annotations

import math
import os
import random
import sys
import threading

INF = float("inf")
NL = 10          # the character code of a newline

# Every Sigma call is several Python frames deep, because the only loop in
# the language is recursion.  The limit has to be generous and the stack has
# to be big; main() runs the program on a thread with a large stack.
sys.setrecursionlimit(400000)


# --------------------------------------------------------------------------
# errors
# --------------------------------------------------------------------------
class SigmaError(Exception):
    def __init__(self, msg, line=0, col=0):
        super().__init__(msg)
        self.msg = msg
        self.line = line
        self.col = col

    def __str__(self):
        if self.line:
            return "line %d, col %d: %s" % (self.line, self.col, self.msg)
        return self.msg


# --------------------------------------------------------------------------
# runtime values
# --------------------------------------------------------------------------
def fmt(x):
    """Render a Sigma number the way Sigma prints it."""
    if isinstance(x, bool):
        return "1" if x else "0"
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        if x != x:
            return "NaN"
        if x == INF:
            return "Infinity"
        if x == -INF:
            return "-Infinity"
        if x.is_integer() and abs(x) < 1e15:
            return str(int(x))
        return repr(x)
    return str(x)


def show(v):
    if isinstance(v, Vec):
        return "( " + ", ".join(fmt(x) for x in v.items) + " )"
    if isinstance(v, (int, float)):
        return fmt(v)
    return repr(v)


class Cell:
    """A box holding one value.

    Names point at cells rather than at values, so a function can change a
    variable it did not create, and a recursive function can see itself."""

    __slots__ = ("v",)

    def __init__(self, v=0.0):
        self.v = v

    def __repr__(self):
        return "cell(%s)" % fmt(self.v)


class Vec:
    """A vector of numbers.

    In theory a vector is one packed integer; the interpreter keeps it
    unpacked so that long vectors stay exact."""

    __slots__ = ("items",)

    def __init__(self, items):
        # keep whatever numbers were given: a vector is a vector of numbers,
        # and truncating 0.5 to 0 would quietly ruin any fractional work
        self.items = [_num(i) for i in items]

    def __repr__(self):
        return show(self)


class Closure:
    """A Sigma function: parameter names, a compiled body, and the scope it
    was written in.

    `env` is held by reference, which is what lets a function see a name
    defined after it, and what lets a recursive function see itself.

    Calling copies that scope and boxes the parameters, so a function can
    change its own variables without disturbing its caller.  That copy is the
    largest single cost in a Sigma program, so a closure whose body builds no
    other function keeps its frame in `frame` and reuses it: the boxes are
    simply overwritten next time.  Such a frame cannot escape -- only an
    inner lambda could capture it -- so overwriting is unobservable.

    A closure that does build a function, or that calls itself, gets a fresh
    scope every call, because either could observe the difference."""

    __slots__ = ("params", "body", "env", "name", "frame", "fresh")

    def __init__(self, params, body, env, name="", fresh=False):
        self.params = params
        self.body = body
        self.env = env
        self.name = name
        self.frame = None
        self.fresh = fresh            # True: needs a new scope each call

    def __repr__(self):
        return "<function %s/%d>" % (self.name or "lambda", len(self.params))


class Native:
    __slots__ = ("name", "fn", "mn", "mx")

    def __init__(self, name, fn, mn, mx=None):
        self.name = name
        self.fn = fn
        self.mn = mn
        self.mx = mx

    def __repr__(self):
        return "<function %s>" % self.name


class Device:
    __slots__ = ()

    def __repr__(self):
        return "(device)"


DEVICE = Device()


# --------------------------------------------------------------------------
# lexer
# --------------------------------------------------------------------------
# Every glyph Sigma knows.  Each one is a piece of real notation.
# g_<name> in Interp implements <glyph>; this maps name -> glyph
GLYPH_NAMES = {
    "sqrt": "√", "cbrt": "∛", "abs": "∣", "floor": "⌊", "ceil": "⌈",
    "nop": "⊘", "make": "⊞", "len": "⊟", "set": "⊕", "slice": "⊖",
    "find": "⌕", "sort": "⊜", "cat": "⧺", "map": "↦", "fold": "⇑",
    "pack": "⇓", "unpack": "⇔", "text": "⧢", "sum": "∑", "prod": "∏",
    "diff": "∂", "int": "∫", "dev": "∆",
}
GLYPH_FUNCS = set("".join(GLYPH_NAMES.values())) | set("ΣΠΔ")
GLYPH_CONSTS = set("πτφℯ∞∅")

# Two characters at a time.  The canonical spelling is the mathematical one;
# the ASCII form is normalised onto it, so the evaluator only knows one name.
MULTI_OPS = {
    "≤": "≤", "≥": "≥", "≠": "≠", "≈": "≈", "→": "=>",
    "<=": "≤", ">=": "≥", "!=": "≠", "=>": "=>",
}
SINGLE_OPS = {
    "|": "∨", "&": "∧", "!": "¬",
}
# single mathematical symbols, for terminals that mangle Unicode
UNICODE_OPS = {"≤", "≥", "≠", "≈", "∨", "∧", "¬"}
OPS = set("+-*/%^<>=&|!?:(),#")

# ASCII spellings, for terminals without good Unicode
ALIAS_CONSTS = {
    "pi": "π", "tau": "τ", "phi": "φ", "golden": "φ",
    "euler": "ℯ", "infinity": "∞", "empty": "∅", "Delta": "∆", "delta": "∆",
}
ALIAS_GLYPHS = {
    "sqrt": "√", "cbrt": "∛",
    "sum": "∑", "prod": "∏",
    "int": "∫", "diff": "∂",
    "vec": "⊞", "len": "⊟", "at": "⊟", "set": "⊕",
    "slice": "⊖", "find": "⌕", "sort": "⊜",
    "cat": "⧺", "map": "↦", "fold": "⇑",
    "pack": "⇓", "unpack": "⇔", "text": "⧢", "nop": "⊘",
}
ALIAS_NAMES = dict(ALIAS_CONSTS)
ALIAS_NAMES.update(ALIAS_GLYPHS)

CAN_START = {"NUM", "IDENT", "GLYPH", "LPAREN"}


class Tok:
    __slots__ = ("kind", "val", "line", "col")

    def __init__(self, kind, val, line, col):
        self.kind = kind
        self.val = val
        self.line = line
        self.col = col

    def __repr__(self):
        return "%s(%r)" % (self.kind, self.val)


_NATIVE_NAMES = []


def _native_names():
    if not _NATIVE_NAMES:
        _NATIVE_NAMES.extend(n.name for n in NATIVES)
    return _NATIVE_NAMES


def describe(t):
    if t.kind == "EOF":
        return "end of input"
    if t.kind == "NEWLINE":
        return "end of line"
    return repr(t.val)


def tokenize(src):
    toks = []
    i, n = 0, len(src)
    line, col = 1, 1
    depth = 0

    def push(kind, val, l, c):
        toks.append(Tok(kind, val, l, c))

    while i < n:
        ch = src[i]

        if ch == "\n":
            # A newline separates statements.  The parser keeps it transparent
            # everywhere except between statements, where it is a separator.
            if toks and toks[-1].kind != "NEWLINE":
                push("NEWLINE", "\n", line, col)
            i += 1
            line += 1
            col = 1
            continue
        if ch in " \t\r":
            i += 1
            col += 1
            continue

        sl, sc = line, col

        # ---- number ----------------------------------------------------
        if ch.isdigit() or (ch == "." and i + 1 < n and src[i + 1].isdigit()):
            j = i
            while j < n and (src[j].isdigit() or src[j] == "_"):
                j += 1
            if j < n and src[j] == ".":
                j += 1
                while j < n and (src[j].isdigit() or src[j] == "_"):
                    j += 1
            if j < n and src[j] in "eE":          # exponent, only if it is one
                k = j + 1
                if k < n and src[k] in "+-":
                    k += 1
                if k < n and src[k].isdigit():
                    while k < n and src[k].isdigit():
                        k += 1
                    j = k
            text = src[i:j]
            if "_" in text:
                text = text.replace("_", "")
            toks.append(Tok("NUM", float(text), sl, sc))
            col += j - i
            i = j
            continue

        # ---- glyph ------------------------------------------------------
        # before identifiers, because Python calls π and ∑ letters
        if ch in GLYPH_FUNCS or ch in GLYPH_CONSTS:
            push("GLYPH", ch, sl, sc)
            i += 1
            col += 1
            continue

        # ---- identifier, or a glyph spelled in ASCII -------------------
        if ch.isalpha() or ch == "_":
            j = i
            while j < n and (src[j].isalnum() or src[j] == "_"):
                j += 1
            word = src[i:j]
            alias = ALIAS_NAMES.get(word)
            if alias and word not in _native_names():
                push("GLYPH", alias, sl, sc)
            else:
                push("IDENT", word, sl, sc)
            col += j - i
            i = j
            continue

        # ---- mathematical operator written as one symbol -----------------
        if ch in UNICODE_OPS:
            push("OP", ch, sl, sc)
            i += 1
            col += 1
            continue

        # ---- operator ----------------------------------------------------
        two = src[i:i + 2]
        if two in MULTI_OPS:
            push("OP", MULTI_OPS[two], sl, sc)
            i += 2
            col += 2
            continue

        if ch in OPS:
            if ch == "(":
                depth += 1
                push("LPAREN", ch, sl, sc)
            elif ch == ")":
                depth -= 1
                if depth < 0:
                    raise SigmaError("unbalanced )", sl, sc)
                push("RPAREN", ch, sl, sc)
            elif ch in SINGLE_OPS:
                push("OP", SINGLE_OPS[ch], sl, sc)
            else:
                push("OP", ch, sl, sc)
            i += 1
            col += 1
            continue

        raise SigmaError("symbol %r is not mathematics" % ch, sl, sc)

    if depth != 0:
        raise SigmaError("unbalanced (", line, col)
    push("NEWLINE", "\n", line, col)
    push("EOF", None, line, col)
    return toks


# --------------------------------------------------------------------------
# parser
# --------------------------------------------------------------------------
# AST nodes are plain tuples:
#   ('num', v)         ('ident', name)      ('glyph', g)
#   ('bin', op, l, r)  ('un', op, e)        ('seq', [stmt, ...])
#   ('tern', c, a, b)  ('call', f, args)    ('lambda', params, body)
#   ('assign', tgt, value)                  ('devget', idx)
#
# `=` always means definition: `x = 3` names x, `∆(0) = 65` writes a port.
# Tests use ≠ and ≈, which is what a mathematician reaches for anyway.


def _strip_parens(node):
    """Peel ( ) and seq wrappers off a node to find its real shape."""
    while True:
        if node[0] == "paren":
            node = node[1]
        elif node[0] == "seq" and len(node[1]) == 1:
            node = node[1][0]
        else:
            return node


def _makes_closure(node):
    """Does this expression build a function anywhere inside it?

    An inner function captures the scope around it, so a frame containing one
    must not be reused between calls."""
    k = node[0]
    if k == "lambda":
        return True
    if k == "seq":
        return any(_makes_closure(x) for x in node[1])
    if k in ("paren", "devset"):
        return _makes_closure(node[1])
    if k == "bin":
        return _makes_closure(node[2]) or _makes_closure(node[3])
    if k == "assign":
        return _makes_closure(node[2])          # node[1] is a target, not a value
    if k == "tern":
        return (_makes_closure(node[1]) or _makes_closure(node[2])
                or _makes_closure(node[3]))
    if k == "un":
        return _makes_closure(node[2])
    if k == "call":
        fn_node = node[1]
        if _makes_closure(fn_node):
            return True
        return any(_makes_closure(a) for a in node[2])
    return False


def _calls_any_function(node):
    """Does this expression call a named function?

    A frame that could be re-entered must not be reused, and we cannot tell
    from inside a function what another name refers to.  So any call at all is
    taken as a reason to be careful."""
    k = node[0]
    if k == "call":
        if node[1][0] == "ident":
            return True
        return _calls_any_function(node[1]) or \
            any(_calls_any_function(a) for a in node[2])
    if k == "seq":
        return any(_calls_any_function(x) for x in node[1])
    if k in ("paren", "devset"):
        return _calls_any_function(node[1])
    if k == "bin":
        return _calls_any_function(node[2]) or _calls_any_function(node[3])
    if k == "assign":
        return _calls_any_function(node[2])      # node[1] is a target
    if k == "tern":
        return (_calls_any_function(node[1]) or _calls_any_function(node[2])
                or _calls_any_function(node[3]))
    if k == "un":
        return _calls_any_function(node[2])
    return False


def parse(toks):
    return Parser(toks).program()


class Parser:
    def __init__(self, toks):
        self.t = toks
        self.i = 0
        self.tok = toks[0]
        self.saw_nl = False
    # -- token cursor; newlines are transparent ---------------------------
    #
    # `tok` caches the token at the cursor, because peek() is by far the
    # hottest thing in the parser: every precedence level asks what comes
    # next before deciding it is finished.  Anything that moves the cursor
    # must call _bump() to refresh the cache.
    def _norm(self, j):
        t = self.t
        while t[j].kind == "NEWLINE":
            j += 1
        return j

    def _step(self, j):
        """_norm, and remember that a newline was crossed."""
        t = self.t
        while t[j].kind == "NEWLINE":
            j += 1
            self.saw_nl = True
        return j

    def _bump(self):
        """Move past the current token and refresh the cache."""
        self.saw_nl = False
        if self.tok.kind != "EOF":
            self.i = self._step(self.i + 1)
        self.tok = self.t[self.i]
        return self.tok

    def peek(self, k=0):
        if k == 0:
            return self.tok
        j = self.i
        for _ in range(k):
            j = self._norm(j + 1)
        return self.t[j]

    def adv(self):
        t = self.tok
        self.saw_nl = False
        if t.kind != "EOF":
            self.i = self._step(self.i + 1)
            self.tok = self.t[self.i]
        return t

    def at(self, kind, val=None, k=0):
        t = self.peek(k)
        return t.kind == kind and (val is None or t.val == val)

    def eat(self, kind, val=None):
        t = self.peek()
        if t.kind == kind and (val is None or t.val == val):
            return self.adv()
        raise SigmaError("expected %s but found %s"
                         % (val or kind, describe(t)), t.line, t.col)

    def op(self, *vals):
        t = self.peek()
        if t.kind == "OP" and t.val in vals:
            return self.adv()
        return None

    def at_sep(self):
        """A newline or comma ending one statement and starting the next.

        The cursor has already stepped over newlines, so `saw_nl` remembers
        whether any were crossed on the way."""
        return self.saw_nl or (self.tok.kind == "OP" and self.tok.val == ",")

    def take_sep(self):
        self.saw_nl = False
        if self.tok.kind == "OP" and self.tok.val == ",":
            self.adv()

    def _land(self, i):
        """Put the cursor on token i, stepping over newlines and remembering
        that we did."""
        self.saw_nl = False
        self.i = self._step(i)
        self.tok = self.t[self.i]

    def _plain_list_ahead(self):
        """Is the group starting at the cursor a list of plain numbers?"""
        i = self.i + 1
        t = self.t
        n = len(t)
        if i >= n:
            return False
        while True:
            tok = t[i]
            if tok.kind == "NEWLINE":
                i += 1
                continue
            if tok.kind == "RPAREN":
                return True                 # ⊞() is fine too
            if tok.kind != "NUM":
                return False
            i += 1
            while t[i].kind == "NEWLINE":
                i += 1
            nxt = t[i]
            if nxt.kind == "RPAREN":
                return True
            if nxt.kind == "COMMA" or (nxt.kind == "OP" and nxt.val == ","):
                i += 1
                continue
            return False

    def _number_run(self):
        """Parse `( n , n , n )` as a flat list of literals, if that is what
        it is.  Returns None when the group is anything more interesting, so
        the ordinary parser handles it."""
        i = self.i + 1
        t = self.t
        n = len(t)
        items = []
        while True:
            tok = t[i]
            if tok.kind != "NUM":
                return None
            items.append(("num", tok.val))
            i += 1
            nxt = t[i]
            if nxt.kind == "NEWLINE":
                while nxt.kind == "NEWLINE":
                    i += 1
                    nxt = t[i]
            if nxt.kind == "RPAREN":
                self._land(i + 1)
                return items
            if nxt.kind != "COMMA" and not (nxt.kind == "OP" and nxt.val == ","):
                return None
            i += 1
            nxt = t[i]
            if nxt.kind == "NEWLINE":
                while nxt.kind == "NEWLINE":
                    i += 1
                    nxt = t[i]
            if nxt.kind == "RPAREN":           # a trailing comma
                self._land(i + 1)
                return items

    def is_lambda_head(self, start):
        """Is the paren group at `start` followed immediately by => ?

        `( x ) => e` and `( ) => e` are lambdas.  `( x = f )` is a
        parenthesised expression, even when f itself contains arrows."""
        depth = 0
        j = start
        while j < len(self.t):
            k = self.t[j].kind
            if k == "LPAREN":
                depth += 1
            elif k == "RPAREN":
                depth -= 1
                if depth == 0:
                    nxt = self.t[j + 1] if j + 1 < len(self.t) else None
                    return bool(nxt and nxt.kind == "OP" and nxt.val == "=>")
            elif k == "EOF":
                return False
            j += 1
        return False

    # -- program ----------------------------------------------------------
    def program(self):
        stmts = []
        while True:
            if self.peek().kind == "EOF":
                break
            stmts.append(self.expr())
            if self.at_sep():
                self.take_sep()
                continue
            t = self.peek()
            if t.kind == "EOF":
                break
            raise SigmaError("unexpected %s -- put each statement on its own line"
                             % describe(t), t.line, t.col)
        return stmts

    # -- expression ladder -------------------------------------------------
    # expr  <  ternary  <  ∨  <  ∧  <  equality  <  relational
    #      <  additive  <  multiplicative  <  power  <  unary  <  postfix
    def expr(self):
        left = self.test()
        if self.at("OP", "="):
            plain = _strip_parens(left)
            if plain[0] not in ("ident", "devset"):
                raise SigmaError("= defines a name or writes to a port; "
                                 "its left side must be a name or a port")
            self.adv()
            return ("assign", plain, self.expr())
        return left

    def test(self):
        """Everything below a definition: `? :`, or/and, comparisons."""
        cond = self.logic_or()
        if self.op("?"):
            a = self.expr()
            self.eat("OP", ":")
            b = self.expr()
            return ("tern", cond, a, b)
        return cond

    def logic_or(self):
        left = self.logic_and()
        while self.op("∨"):
            left = ("bin", "∨", left, self.logic_and())
        return left

    def logic_and(self):
        left = self.equality()
        while self.op("∧"):
            left = ("bin", "∧", left, self.equality())
        return left

    def equality(self):
        left = self.relational()
        while True:
            t = self.peek()
            if t.kind != "OP" or t.val not in ("=", "≠", "≈"):
                break
            # A bare `=` directly on a name is a definition, so leave it for
            # expr() to take.  Brackets make it a test: ( n = 1 ) ? a : b
            if t.val == "=" and left[0] in ("ident", "devset"):
                break
            self.adv()
            left = ("bin", t.val, left, self.relational())
        return left

    def relational(self):
        left = self.additive()
        while True:
            o = self.op("<", ">", "≤", "≥")
            if not o:
                return left
            left = ("bin", o.val, left, self.additive())

    def additive(self):
        left = self.multiplicative()
        while True:
            o = self.op("+", "-")
            if not o:
                return left
            left = ("bin", o.val, left, self.multiplicative())

    def multiplicative(self):
        left = self.power()
        while True:
            o = self.op("*", "/", "%")
            if not o:
                return left
            left = ("bin", o.val, left, self.power())

    def power(self):
        base = self.unary()
        if self.op("^"):
            return ("bin", "^", base, self.power())      # right associative
        return base

    def unary(self):
        o = self.op("-", "¬")
        if o:
            return ("un", o.val, self.unary())
        return self.postfix()

    def glued(self):
        """Is the `(` we are looking at on this same line as the name before it?

        Without this, `∆(0) = ⊞(10)` on one line followed by `(block(1))` on
        the next would be read as one call with two argument lists."""
        return not self.saw_nl

    def postfix(self):
        node = self.primary()
        while self.at("LPAREN") and self.glued():
            # A call whose arguments are all plain numbers -- ⊞(1, 2, 3) --
            # is worth a shortcut.  Each element would otherwise walk back
            # through the whole precedence ladder to find it is a literal.
            if (node[0] == "glyph" and node[1] == "⊞"
                    and self._plain_list_ahead()):
                run = self._number_run()
                if run is not None:
                    node = ("call", node, run)
                    continue
            self.adv()
            args = []
            if not self.at("RPAREN"):
                while True:
                    args.append(self.expr())
                    if self.op(","):
                        continue
                    break
            self.eat("RPAREN")
            inner = _strip_parens(node)
            if inner[0] == "glyph" and inner[1] in ("Δ", "∆"):
                node = ("devset", args[0])       # becomes a writable port
            else:
                node = ("call", node, args)
        return node

    def body(self, closer):
        """Statements up to `closer`, separated by newlines or commas.

        Sequencing is not a language feature.  It is what you get when an
        expression happens to mention a definition or a port write, since
        those are expressions like any other."""
        out = []
        while True:
            if closer is not None and self.at(closer):
                break
            if closer is None and self.peek().kind == "EOF":
                break
            out.append(self.expr())
            if closer is not None and self.at(closer):
                break
            if self.at_sep():
                self.take_sep()
                continue
            t = self.peek()
            raise SigmaError("expected %s but found %s" % (closer, describe(t)),
                             t.line, t.col)
        return out

    def primary(self):
        t = self.peek()

        if t.kind == "NUM":
            self.adv()
            return ("num", t.val)

        if t.kind == "IDENT":
            self.adv()
            return ("ident", t.val)

        if t.kind == "GLYPH":
            self.adv()
            return ("glyph", t.val)

        if t.kind == "LPAREN":
            if self.is_lambda_head(self.i):
                self.adv()
                params = []
                if not self.at("RPAREN"):
                    while True:
                        params.append(self.eat("IDENT").val)
                        if self.op(","):
                            continue
                        break
                self.eat("RPAREN")
                self.eat("OP", "=>")
                return ("lambda", params, self.expr())
            self.adv()
            items = self.body("RPAREN")
            self.eat("RPAREN")
            # keep the brackets on the node: ( n = 1 ) is a test, n = 1 is a
            # definition, and only the brackets tell them apart
            return ("paren", items[0]) if len(items) == 1 else ("seq", items)

        raise SigmaError("unexpected %s" % describe(t), t.line, t.col)


# --------------------------------------------------------------------------
# the standard library -- every name is standard mathematical notation
# --------------------------------------------------------------------------
def _num(v, who="a number"):
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    raise SigmaError("%s is not a number" % who)


def _int(v, who="a number", wide=False):
    """A Sigma number as a Python int.

    Sigma values are doubles, so a whole number tops out at 2^53.  Functions
    that are *meant* for large inputs (isqrt, fact, comb) pass wide=True and
    work with whatever integer the double actually holds."""
    x = _num(v, who)
    if not wide and abs(x) >= 1e18:
        raise SigmaError("%s is too large to be a whole number" % who)
    return int(x)


def _vec(v, who):
    if isinstance(v, Vec):
        return v.items
    raise SigmaError("%s needs a ( ... ) vector, not %s" % (who, show(v)))


def _truthy(v):
    return not (isinstance(v, (int, float)) and v == 0)


def _flag(b):
    """A truth value as a Sigma number.  Written out so that `sign(-9)` cannot
    silently produce 1 - 1 instead of 0 - 1."""
    return 1.0 if b else 0.0


def _sign(x):
    return 1.0 if x > 0 else (-1.0 if x < 0 else 0.0)


def _mod(a, b):
    return a - b * math.floor(a / b)


def _gcd(a, b):
    a, b = abs(int(a)), abs(int(b))
    while b:
        a, b = b, a % b
    return float(a)


def _isprime(n):
    if n < 2:
        return False
    if n < 4:
        return True
    if n % 2 == 0:
        return False
    f = 3
    while f * f <= n:
        if n % f == 0:
            return False
        f += 2
    return True


def number_to_codes(x, dec=None):
    """( x ) -> the characters of the printed form of x"""
    if dec is None:
        s = fmt(x)
    else:
        s = "%.*f" % (max(0, min(20, dec)), x)
    return [ord(c) for c in s]


NATIVES = []


def native(name, mn, mx=None):
    def deco(fn):
        NATIVES.append(Native(name, fn, mn, mx))
        return fn
    return deco


# --- trigonometry and the usual elementary functions -----------------------
for _nm, _fn in (("sin", math.sin), ("cos", math.cos), ("tan", math.tan),
                 ("asin", math.asin), ("acos", math.acos), ("atan", math.atan),
                 ("sinh", math.sinh), ("cosh", math.cosh), ("tanh", math.tanh),
                 ("ln", math.log), ("exp", math.exp)):
    native(_nm, 1)(lambda I, a, _f=_fn: _f(_num(a[0])))

native("atan2", 2)(lambda I, a: math.atan2(_num(a[0]), _num(a[1])))
native("hypot", 2, None)(lambda I, a: math.hypot(*[_num(x) for x in a]))
native("log", 2)(lambda I, a: math.log(_num(a[0]), _num(a[1])))

# --- signs, rounding, parts ------------------------------------------------
native("abs", 1)(lambda I, a: abs(_num(a[0])))
native("sign", 1)(lambda I, a: _sign(_num(a[0])))
native("floor", 1)(lambda I, a: _num(math.floor(_num(a[0]))))
native("ceil", 1)(lambda I, a: _num(math.ceil(_num(a[0]))))
native("trunc", 1)(lambda I, a: _num(math.trunc(_num(a[0]))))
native("round", 1, 2)(lambda I, a: (_num(round(_num(a[0]), _int(a[1])))
                                   if len(a) > 1 else _num(round(_num(a[0])))))
native("frac", 1)(lambda I, a: _num(a[0]) - math.trunc(_num(a[0])))
native("isint", 1)(lambda I, a: _flag(_num(a[0]) == int(_num(a[0]))))

# --- arithmetic utilities --------------------------------------------------
native("min", 1, None)(lambda I, a: min(_num(x) for x in a))
native("max", 1, None)(lambda I, a: max(_num(x) for x in a))
native("clamp", 3)(lambda I, a: min(max(_num(a[0]), _num(a[1])), _num(a[2])))
native("lerp", 3)(lambda I, a: _num(a[0]) + (_num(a[1]) - _num(a[0])) * _num(a[2]))
native("step", 3)(lambda I, a: _flag(_num(a[2]) >= _num(a[1])))
native("gcd", 2)(lambda I, a: _gcd(_num(a[0]), _num(a[1])))
native("lcm", 2)(lambda I, a: (0.0 if not _num(a[0]) or not _num(a[1]) else
                               abs(_num(a[0]) * _num(a[1])) / _gcd(_num(a[0]), _num(a[1]))))
native("mod", 2)(lambda I, a: _mod(_num(a[0]), _num(a[1])))
native("pow", 2)(lambda I, a: _num(a[0]) ** _num(a[1]))
native("fact", 1)(lambda I, a: _num(math.factorial(int(_num(a[0])))))
native("comb", 2)(lambda I, a: _num(math.comb(int(_num(a[0])), int(_num(a[1])))))
native("isprime", 1)(lambda I, a: _flag(_isprime(_int(a[0]))))
native("isqrt", 1)(lambda I, a: _num(math.isqrt(_int(a[0], "isqrt", wide=True))))

# --- probability: a random variable is still a function -------------------
native("rand", 0, 1)(lambda I, a: I.rng.random() if not a
                      else _num(I.rng.randint(0, _int(a[0]))))


# Binary operators as plain Python functions, so compiled code can call one
# directly instead of dispatching on the operator's name.
def _op_add(a, b):
    return a + b


def _op_sub(a, b):
    return a - b


def _op_mul(a, b):
    return a * b


def _op_div(a, b):
    y = b
    if y == 0:
        x = a
        return float("nan") if x == 0 else (INF if x > 0 else -INF)
    return a / y


def _op_mod(a, b):
    if b == 0:
        return float("nan")
    return math.fmod(a, b)


def _op_pow(a, b):
    return float(a ** b)


BINOPS = {
    "+": _op_add, "-": _op_sub, "*": _op_mul,
    "/": _op_div, "%": _op_mod, "^": _op_pow,
}

_CMP = {
    "<": lambda a, b: a < b, ">": lambda a, b: a > b,
    "≤": lambda a, b: a <= b, "≥": lambda a, b: a >= b,
}


# --------------------------------------------------------------------------
# interpreter
# --------------------------------------------------------------------------
class Interp:
    OUT = 0      # port 0 writes characters
    IN = 1       # port 1 reads one character
    RAND = 2     # port 2 is a random number in [0,1)
    SEED = 3     # port 3 reseeds
    REGS = 64    # the rest is ordinary memory

    def __init__(self, stdin=None, stdout=None):
        self.stdin = stdin if stdin is not None else sys.stdin
        self.out = stdout if stdout is not None else sys.stdout
        self.rng = random.Random(20260910)
        self.regs = [0.0] * self.REGS
        # Natives live outside the scope.  A closure that recurses 20,000 deep
        # then copies a scope holding nothing but its own parameters, instead
        # of re-copying all 36 builtins at every step.
        self.natives = {nat.name: nat for nat in NATIVES}
        self.globals = {}
        self.output = []
        self._cache = {}

# ------------------------------------------------------------------
    # closure compilation
    #
    # `eval` walks the tree once per operation, dispatching on a string for
    # every node it visits.  Compiling replaces that with a tree of Python
    # closures: each node becomes a function that calls its children
    # directly.  Nothing about the language changes -- only the work between
    # the parse and the answer.
    # ------------------------------------------------------------------
    def compile(self, node):
        """Turn an AST into a closure of (env) -> value."""
        k = node[0]

        if k == "num":
            value = node[1]
            return lambda env: value

        if k == "ident":
            name = node[1]
            return self._compile_ident(name)

        if k == "paren":
            inner = self.compile(node[1])
            return lambda env: inner(env)

        if k == "glyph":
            return self._compile_const(node[1])

        if k == "bin":
            op = node[1]
            left = self.compile(node[2])
            right = self.compile(node[3])
            return self._compile_bin(op, left, right)

        if k == "un":
            inner = self.compile(node[2])
            if node[1] == "-":
                return lambda env: -_num(inner(env), "the operand of -")
            return lambda env: 0.0 if _truthy(inner(env)) else 1.0

        if k == "tern":
            cond = self.compile(node[1])
            a = self.compile(node[2])
            b = self.compile(node[3])
            return lambda env: a(env) if _truthy(cond(env)) else b(env)

        if k == "seq":
            parts = [self.compile(st) for st in node[1]]
            if len(parts) == 1:
                return parts[0]

            def run_seq(env, parts=parts):
                value = 0.0
                for part in parts:
                    value = part(env)
                return value
            return run_seq

        if k == "assign":
            return self._compile_assign(node[1], self.compile(node[2]))

        if k == "call":
            fn_node = node[1]
            if fn_node[0] == "glyph" and fn_node[1] in GLYPH_FUNCS:
                return self._compile_glyph_call(fn_node[1],
                                                [self.compile(a) for a in node[2]])
            fn = self.compile(fn_node)
            args = [self.compile(a) for a in node[2]]
            return self._compile_call(fn, args)

        if k == "lambda":
            params = tuple(node[1])
            body = self.compile(node[2])
            # A frame may only be reused when nothing inside could possibly
            # re-enter this function or capture its scope.  Calling any named
            # function qualifies: we cannot know what that function is, and it
            # may well call back.  A body of pure arithmetic is safe.
            fresh = _makes_closure(node[2]) or _calls_any_function(node[2])
            return lambda env: Closure(params, body, env, "", fresh)

        if k == "devset":
            idx = self.compile(node[1])
            return lambda env: self.dev_get(idx(env))

        # anything unforeseen falls back to the interpreter
        return lambda env: self.eval(node, env)

    def _compile_ident(self, name):
        """A name is usually a local cell; natives are the rare case."""
        natives = self.natives

        def read(env, name=name, natives=natives):
            try:
                return env[name].v      # the common case costs no exception
            except KeyError:
                nat = natives.get(name)
                if nat is not None:
                    return nat
                raise SigmaError("%s is undefined" % name)
        return read

    def _compile_const(self, g):
        value = self.glyph(g)
        return lambda env: value

    def _compile_bin(self, op, left, right):
        fn = BINOPS.get(op)
        if fn is not None:
            if fn is _op_add:
                # `+` is also how two vectors are joined
                def add_lr(env, left=left, right=right):
                    a = left(env)
                    b = right(env)
                    if isinstance(a, Vec) and isinstance(b, Vec):
                        return Vec(a.items + b.items)
                    return a + b
                return add_lr

            if fn is _op_pow:
                def pow_lr(env, left=left, right=right):
                    try:
                        return float(_num(left(env), "^") ** _num(right(env), "^"))
                    except (OverflowError, ZeroDivisionError, ValueError):
                        return float("nan")
                return pow_lr

            return lambda env: fn(left(env), right(env))

        if op in ("<", ">", "≤", "≥", "≠", "≈", "=", "∧", "∨"):
            return self._compile_compare(op, left, right)

    def _compile_compare(self, op, left, right):
        if op == "∧":
            return lambda env: _flag(_truthy(left(env)) and _truthy(right(env)))
        if op == "∨":
            return lambda env: _flag(_truthy(left(env)) or _truthy(right(env)))
        if op in ("<", ">", "≤", "≥"):
            cmp = _CMP[op]

            def cmp_lr(env, left=left, right=right, cmp=cmp):
                a = left(env)
                b = right(env)
                if type(a) is float and type(b) is float:
                    return 1.0 if cmp(a, b) else 0.0
                return 1.0 if cmp(_num(a, op), _num(b, op)) else 0.0
            return cmp_lr
        if op == "≠":
            def ne(env, left=left, right=right):
                a = left(env)
                b = right(env)
                if type(a) is float and type(b) is float:
                    return 0.0 if a == b else 1.0
                if isinstance(a, Vec) or isinstance(b, Vec):
                    return 0.0 if (isinstance(a, Vec) and isinstance(b, Vec)
                                   and a.items == b.items) else 1.0
                return 0.0 if _num(a, "≠") == _num(b, "≠") else 1.0
            return ne
        if op == "≈":
            def approx(env, left=left, right=right):
                try:
                    return _flag(math.isclose(_num(left(env), "≈"),
                                              _num(right(env), "≈"),
                                              rel_tol=1e-9, abs_tol=1e-12))
                except (TypeError, ValueError):
                    return 0.0
            return approx
        return lambda env: self.apply("=", left(env), right(env))

    def _compile_assign(self, target, value):
        if target[0] == "ident":
            name = target[1]
            natives = self.natives

            def assign_name(env, name=name, value=value, natives=natives):
                v = value(env)
                cell = env.get(name)
                if cell is not None:
                    cell.v = v               # change the existing box
                elif name in natives:
                    env[name] = Cell(v)
                else:
                    env[name] = Cell(v)
                return v
            return assign_name

        idx = self.compile(target[1])
        setport = self.dev_set

        def assign_port(env, idx=idx, value=value, setport=setport):
            v = value(env)
            setport(idx(env), v)
            return v
        return assign_port

    def _compile_glyph_call(self, g, args):
        table = self._glyph_table()
        fn = table.get(g)
        if fn is None:
            raise SigmaError("%s does not take those arguments" % g)

        if not args:
            return lambda env: fn(())
        if len(args) == 1:
            a0 = args[0]
            return lambda env: fn((a0(env),))
        if len(args) == 2:
            a0, a1 = args
            return lambda env: fn((a0(env), a1(env)))
        if len(args) == 3:
            a0, a1, a2 = args
            return lambda env: fn((a0(env), a1(env), a2(env)))

        def call_g(env, fn=fn, args=args):
            return fn([a(env) for a in args])
        return call_g

    def _compile_call(self, fn, args):
        n = len(args)
        if n == 0:
            return lambda env: self.call(fn(env), [])
        if n == 1:
            a0 = args[0]
            return lambda env: self.call(fn(env), [a0(env)])
        if n == 2:
            a0, a1 = args
            return lambda env: self.call(fn(env), [a0(env), a1(env)])
        if n == 3:
            a0, a1, a2 = args
            return lambda env: self.call(fn(env), [a0(env), a1(env), a2(env)])
        return lambda env: self.call(fn(env), [a(env) for a in args])
    # -- device -----------------------------------------------------------
    def emit(self, codes):
        self.output.extend(codes)

    def dev_get(self, idx):
        if idx is None:
            return DEVICE
        p = _int(idx)
        if p == self.IN:
            ch = self.stdin.read(1)
            return -1.0 if ch == "" else float(ord(ch))
        if p == self.RAND:
            return self.rng.random()
        if p == self.OUT:
            raise SigmaError("port 0 only receives -- write with  ∆(0) = value")
        if p == self.SEED:
            return 0.0
        if 0 <= p < self.REGS:
            return self.regs[p]
        raise SigmaError("there is no port %d" % p)

    def dev_set(self, idx, value):
        p = _int(idx)
        if p == self.OUT:
            self.emit(value.items if isinstance(value, Vec) else [_int(value)])
            return value
        if p == self.SEED:
            self.rng.seed(_int(value))
            return value
        if p == self.IN:
            raise SigmaError("port 1 only reads")
        if 0 <= p < self.REGS:
            self.regs[p] = _num(value)
            return value
        raise SigmaError("there is no port %d" % p)

    # -- evaluation -------------------------------------------------------
    def run(self, program):
        """Run a compiled program: one closure per top-level statement."""
        env = self.globals
        result = 0.0
        for fn in program:
            result = fn(env)
        return result

    def eval(self, node, env):
        k = node[0]

        if k == "num":
            return node[1]

        if k == "ident":
            name = node[1]
            cell = env.get(name)
            if cell is not None:
                return cell.v
            nat = self.natives.get(name)
            if nat is not None:
                return nat
            raise SigmaError("%s is undefined" % name)

        if k == "glyph":
            return self.glyph(node[1])

        if k == "paren":
            return self.eval(node[1], env)

        if k == "seq":
            value = 0.0
            for st in node[1]:
                value = self.eval(st, env)
            return value

        if k == "bin":
            return self.apply(node[1],
                              self.eval(node[2], env),
                              self.eval(node[3], env))

        if k == "un":
            v = self.eval(node[2], env)
            if node[1] == "-":
                return -_num(v, "the operand of -")
            return 0.0 if _truthy(v) else 1.0

        if k == "tern":
            return self.eval(node[2] if _truthy(self.eval(node[1], env)) else node[3], env)

        if k == "assign":
            target = node[1]
            val = self.eval(node[2], env)
            if target[0] == "ident":
                name = target[1]
                if name in env:
                    env[name].v = val          # change the existing box
                else:
                    env[name] = Cell(val)
            else:
                self.dev_set(self.eval(target[1], env), val)
            return val

        if k == "call":
            fn_node = node[1]
            if fn_node[0] == "glyph" and fn_node[1] in GLYPH_FUNCS:
                return self.glyph_call(fn_node[1], [self.eval(a, env) for a in node[2]])
            return self.call(self.eval(fn_node, env),
                             [self.eval(a, env) for a in node[2]])

        if k == "lambda":
            return Closure(node[1], self.compile(node[2]), env)

        if k == "devset":
            # a bare ∆(i) in read position
            return self.dev_get(self.eval(node[1], env))

        raise SigmaError("cannot evaluate %s" % k)

    def call(self, fn, args):
        if type(fn) is Closure:
            params = fn.params
            n = len(args)
            if n != len(params):
                raise SigmaError("this lambda takes %d argument%s, got %d"
                                 % (len(params),
                                    "" if len(params) == 1 else "s", n))
            # Copy the defining scope, then give each parameter a fresh box.
            # This is the only per-call work a Sigma function does.
            if fn.fresh:
                new = dict(fn.env)
            else:
                new = fn.frame
                if new is None:
                    new = fn.frame = dict(fn.env)
            if n == 1:
                cell = new.get(params[0])
                if cell is None:
                    new[params[0]] = Cell(args[0])
                else:
                    cell.v = args[0]
            elif n:
                for name, value in zip(params, args):
                    cell = new.get(name)
                    if cell is None:
                        new[name] = Cell(value)
                    else:
                        cell.v = value
            return fn.body(new)                  # already compiled
        if isinstance(fn, Closure):              # a subclass, say
            new = dict(fn.env)
            for name, value in zip(fn.params, args):
                new[name] = Cell(value)
            return fn.body(new)

        if isinstance(fn, Native):
            if len(args) < fn.mn or (fn.mx is not None and len(args) > fn.mx):
                want = str(fn.mn) if fn.mx == fn.mn else "%d-%s" % (fn.mn, fn.mx or "∞")
                raise SigmaError("%s takes %s argument(s), got %d"
                                 % (fn.name, want, len(args)))
            return fn.fn(self, args)

        if fn is DEVICE:
            return self.dev_get(_int(args[0]) if args else None)

        if isinstance(fn, Vec):
            raise SigmaError("a vector is not callable")

        raise SigmaError("%s is not a function" % show(fn))

    def apply(self, op, a, b):
        if op == "+":
            if isinstance(a, Vec) and isinstance(b, Vec):
                return Vec(a.items + b.items)
            return _num(a, "+") + _num(b, "+")
        if op == "-":
            return _num(a, "-") - _num(b, "-")
        if op == "*":
            return _num(a, "*") * _num(b, "*")
        if op == "/":
            x, y = _num(a, "/"), _num(b, "/")
            if y == 0:
                return float("nan") if x == 0 else (INF if x > 0 else -INF)
            return x / y
        if op == "%":
            x, y = _num(a, "%"), _num(b, "%")
            return float("nan") if y == 0 else math.fmod(x, y)
        if op == "^":
            x, y = _num(a, "^"), _num(b, "^")
            try:
                return float(x ** y)
            except (OverflowError, ZeroDivisionError, ValueError):
                return float("nan")
        if op == "<":
            return _flag(_num(a, "<") < _num(b, "<"))
        if op == ">":
            return _flag(_num(a, ">") > _num(b, ">"))
        if op == "≤":
            return _flag(_num(a, "≤") <= _num(b, "≤"))
        if op == "≥":
            return _flag(_num(a, "≥") >= _num(b, "≥"))
        if op == "=":
            # reached only for a test: expr() takes the definition case, so a
            # bare `=` here is `( n = 1 )` or `a + b = 5`
            if isinstance(a, Vec) or isinstance(b, Vec):
                return _flag(isinstance(a, Vec) and isinstance(b, Vec)
                             and a.items == b.items)
            return _flag(_num(a, "=") == _num(b, "="))
        if op == "≠":
            if isinstance(a, Vec) or isinstance(b, Vec):
                return 0.0 if (isinstance(a, Vec) and isinstance(b, Vec)
                               and a.items == b.items) else 1.0
            return 0.0 if _num(a, "≠") == _num(b, "≠") else 1.0
        if op == "≈":
            try:
                return _flag(math.isclose(_num(a, "≈"), _num(b, "≈"),
                                          rel_tol=1e-9, abs_tol=1e-12))
            except (TypeError, ValueError):
                return 0.0
        if op == "∧":
            return _flag(_truthy(a) and _truthy(b))
        if op == "∨":
            return _flag(_truthy(a) or _truthy(b))
        raise SigmaError("unknown operator %r" % op)

    # -- glyphs -----------------------------------------------------------
    def glyph(self, g):
        if g == "π":
            return math.pi
        if g == "τ":
            return math.tau
        if g == "φ":
            return (1 + math.sqrt(5)) / 2
        if g == "ℯ":
            return math.e
        if g == "∞":
            return INF
        if g == "∅":
            return Vec([])
        if g in ("Δ", "∆"):
            return DEVICE
        if g == "⊘":
            return 0.0                        # the nop is already a value
        raise SigmaError("%s must be called:  %s ( ... )" % (g, g))

    # ---- glyph dispatch table ------------------------------------------
    # One dict lookup instead of thirty string comparisons.
    def _glyph_table(self):
        t = self._cache.get("glyphs")
        if t is None:
            t = {}
            for _name, _glyph in GLYPH_NAMES.items():
                t[_glyph] = getattr(self, "g_" + _name)
            t["Σ"] = self.g_sum          # capital sigma is the same sum
            t["Π"] = self.g_prod         # capital pi is the same product
            t["Δ"] = self.g_dev          # capital delta is the same device
            self._cache["glyphs"] = t
        return t

# -- glyphs, one method each, found through the dispatch table ---------
    def glyph_call(self, g, a):
        fn = self._glyph_table().get(g)
        if fn is None:
            raise SigmaError("%s does not take those arguments" % g)
        return fn(a)

    def g_sqrt(self, a):
        x = _num(a[0], "√")
        return math.sqrt(x) if x >= 0 else float("nan")

    def g_cbrt(self, a):
        x = _num(a[0], "∛")
        return math.copysign(abs(x) ** (1.0 / 3.0), x)

    def g_abs(self, a):
        return abs(_num(a[0], "∣"))

    def g_floor(self, a):
        return _num(math.floor(_num(a[0], "⌊")))

    def g_ceil(self, a):
        return _num(math.ceil(_num(a[0], "⌈")))

    def g_nop(self, a):
        return 0.0

    def g_sum(self, a, product=False):
        g = "∏" if product else "∑"
        if len(a) == 2:
            lo, hi = 1.0, _num(a[1], g)
        elif len(a) == 3:
            lo, hi = _num(a[1], g), _num(a[2], g)
        else:
            raise SigmaError("%s takes ( f, n ) or ( f, a, b )" % g)
        f = a[0]
        acc = 1.0 if product else 0.0
        start = int(lo)
        end = int(hi)
        k = start if end >= start else end
        step = 1 if end >= start else -1
        call = self.call
        while True:
            v = _num(call(f, [float(k)]), g)
            acc = acc * v if product else acc + v
            if k == end:
                return acc
            k += step

    def g_prod(self, a):
        return self.g_sum(a, True)

    def g_diff(self, a):
        f, x = a[0], _num(a[1], "∂")
        h = _num(a[2]) if len(a) > 2 else 1e-6 * max(1.0, abs(x))
        lo = _num(self.call(f, [x - h]), "∂")
        hi = _num(self.call(f, [x + h]), "∂")
        return (hi - lo) / (2 * h)

    def g_int(self, a):
        f, lo, hi = a[0], _num(a[1], "∫"), _num(a[2], "∫")
        n = _int(a[3]) if len(a) > 3 else 2000
        n = max(2, n + (n % 2))
        h = (hi - lo) / n
        call = self.call
        s = _num(call(f, [lo]), "∫") + _num(call(f, [hi]), "∫")
        for i in range(1, n):
            s += (4 if i % 2 else 2) * _num(call(f, [lo + i * h]), "∫")
        return s * h / 3.0

    def g_make(self, a):                        # ⊞ build
        out = []
        for x in a:
            if isinstance(x, Vec):
                out.extend(x.items)
            else:
                out.append(_num(x))
        return Vec(out)

    def g_len(self, a):                         # ⊟ length or element
        v = _vec(a[0], "⊟")
        if len(a) == 1:
            return float(len(v))
        i = _int(a[1])
        return float(v[i - 1]) if 1 <= i <= len(v) else -1.0

    def g_set(self, a):                         # ⊕ update
        """Set element i to x, returning a new vector.

        One element at a time copies the whole vector, which is how a loop
        that appends becomes quadratic.  A caller that is clearly extending a
        vector is therefore allowed to write past the end: ⊕(v, len(v) + 1, x)
        appends.  Nothing that could be read changes meaning."""
        v = _vec(a[0], "⊕")
        i = _int(a[1])
        x = _num(a[2])
        n = len(v)
        if 1 <= i <= n:
            items = list(v)
            items[i - 1] = x
            return Vec(items)
        if i == n + 1:
            return Vec(list(v) + [x])            # append: one copy, not n
        return Vec(v)                            # out of range: leave it alone

    def g_slice(self, a):                       # ⊖
        v = _vec(a[0], "⊖")
        i = max(1, _int(a[1])) if len(a) > 1 else 1
        j = min(len(v), _int(a[2])) if len(a) > 2 else len(v)
        return Vec([] if i > j else v[i - 1:j])

    def g_find(self, a):                        # ⌕
        want = _num(a[1])
        for i, x in enumerate(_vec(a[0], "⌕")):
            if x == want:
                return float(i + 1)
        return -1.0

    def g_sort(self, a):                        # ⊜
        return Vec(sorted(_vec(a[0], "⊜")))

    def g_cat(self, a):                         # ⧺
        out = []
        for x in a:
            out.extend(_vec(x, "⧺"))
        return Vec(out)

    def g_map(self, a):                         # ↦
        f = a[0]
        call = self.call
        return Vec([_num(call(f, [x])) for x in _vec(a[1], "↦")])

    def g_fold(self, a):                        # ⇑
        acc = a[2] if len(a) > 2 else 0.0
        f = a[0]
        call = self.call
        for x in _vec(a[1], "⇑"):
            acc = call(f, [acc, x])
        return acc

    def g_pack(self, a):                        # ⇓
        base = _int(a[1]) if len(a) > 1 else 256
        n = 0.0
        for x in _vec(a[0], "⇓"):
            n = n * base + x
        return n

    def g_unpack(self, a):                      # ⇔
        base = _int(a[1]) if len(a) > 1 else 256
        n = _int(a[0], "⇔")
        if n == 0:
            return Vec([0])
        out = []
        while n > 0:
            out.append(n % base)
            n //= base
        out.reverse()
        return Vec(out)

    def g_text(self, a):                        # ⧢
        return Vec(number_to_codes(_num(a[0]),
                                   _int(a[1]) if len(a) > 1 else None))

    def g_dev(self, a):                         # ∆
        return self.dev_get(_int(a[0]) if a else None)

# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------
def strip_comments(src):
    """Blank out `# ...` to the end of the line, keeping every line number.

    Sigma itself has no comments, because a comment is not mathematics.  The
    file reader offers them anyway, since a language with no strings is
    unreadable without them."""
    if "#" not in src:
        return src
    return "\n".join(line if line.find("#") < 0 else line[:line.find("#")]
                     for line in src.split("\n"))


def run_source(src, interp=None, name="<input>", comments=True):
    interp = interp or Interp()
    if comments:
        src = strip_comments(src)
    program = compile_program(src, interp)
    result = 0.0
    for fn in program:
        result = fn(interp.globals)
    return result, interp


def compile_program(src, interp):
    """Parse and compile a whole program once.

    The result is a list of closures, one per top-level statement.  Running it
    twice costs no parsing and no compiling the second time."""
    stmts = parse(tokenize(src))
    return [interp.compile(st) for st in stmts]


def _write(text, stream):
    try:
        stream.write(text)
        stream.flush()
    except UnicodeEncodeError:
        enc = getattr(stream, "encoding", None) or "utf-8"
        stream.write(text.encode(enc, "replace").decode(enc, "replace"))


def _drain(interp, stream):
    chars = []
    for c in interp.output:
        c = int(c)
        if 0 <= c <= 0x10FFFF:
            chars.append(chr(c))
    interp.output = []
    _write("".join(chars), stream)


def run_file(path):
    with open(path, "r", encoding="utf-8") as fh:
        src = fh.read()
    result, interp = run_source(src, name=path)
    _drain(interp, sys.stdout)
    return result


def repl():
    interp = Interp()
    print("Σ   Ctrl-C to leave.   ∅ is the empty vector, ⊘ is the nop.")
    while True:
        try:
            line = input("Σ› ")
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not line.strip():
            continue
        value = None
        try:
            for st in parse(tokenize(strip_comments(line))):
                value = interp.eval(st, interp.globals)
        except SigmaError as e:
            print("  ! %s" % e)
            continue
        except RecursionError:
            print("  ! recursion ran away")
            continue
        _drain(interp, sys.stdout)
        if value is not None and not isinstance(value, Closure):
            print("  = " + show(value))


def codes(text):
    """Print text as a Sigma vector literal of character codes."""
    print("⊞(" + ", ".join(str(ord(c)) for c in text) + ")")


USAGE = """Sigma -- a programming language made only of mathematics

  python sigma.py program.m          run a program
  python sigma.py -e "expression"    run one expression
  python sigma.py --codes "text"     print text as Sigma character codes
  python sigma.py repl               interactive
  python sigma.py --test             run the test suite
"""


def _dispatch(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        _write(USAGE, sys.stdout)
        return 0

    cmd = argv[1]

    if cmd == "--codes":
        codes(" ".join(argv[2:]))
        return 0

    if cmd == "repl":
        repl()
        return 0

    if cmd == "--test":
        here = os.path.dirname(os.path.abspath(__file__))
        sys.path.insert(0, os.path.join(here, "tests"))
        import unittest
        import test_sigma
        suite = unittest.defaultTestLoader.loadTestsFromModule(test_sigma)
        ok = unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful()
        return 0 if ok else 1

    if cmd == "-e":
        result, interp = run_source(" ".join(argv[2:]))
        _drain(interp, sys.stdout)
        if not isinstance(result, (Closure, Device)):
            _write(show(result) + "\n", sys.stdout)
        return 0

    run_file(cmd)
    return 0


def main(argv):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    # deep Sigma recursion needs a deep native stack
    for size in (512, 256, 128, 64, 16, 8, 0):
        if size:
            try:
                threading.stack_size(size * 1024 * 1024)
            except (ValueError, RuntimeError):
                continue
        box = {}

        def work(box=box):
            try:
                box["code"] = _dispatch(argv)
            except SigmaError as e:
                _write("Sigma error: %s\n" % e, sys.stderr)
                box["code"] = 1
            except FileNotFoundError:
                _write("no such file: %s\n" % argv[1], sys.stderr)
                box["code"] = 1
            except RecursionError:
                _write("Sigma error: recursion ran away (infinite loop?)\n", sys.stderr)
                box["code"] = 1
            except KeyboardInterrupt:
                box["code"] = 130

        try:
            t = threading.Thread(target=work)
            t.start()
            t.join()
            return box.get("code", 1)
        except (RuntimeError, threading.ThreadError):
            continue          # stack size refused; try a smaller one
    return _dispatch(argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv))