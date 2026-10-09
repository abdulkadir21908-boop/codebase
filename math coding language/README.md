# Sigma Σ

A programming language made only of mathematics.

No keywords. No strings. No statements. No library of conveniences.
Every literal in a Sigma program is a number, every operator is one you
already know from school, and the only way to repeat something is
recursion — because recursion is the only loop mathematics offers.

```sigma
fact = (n) => n < 2 ? 1 : n * fact(n - 1)

∆(0) = ⊞(49, 48, 33, 32, 61, 32)
∆(0) = ⧢( fact(10) )
∆(0) = ⊞(10)
```

```
10! = 3628800
```

## Running it

```
python sigma.py examples/hello.m        run a program
python sigma.py -e "sqrt(2)"            run one expression
python sigma.py --codes "Hello"         text -> Sigma character codes
python sigma.py repl                    interactive
python sigma.py --test                  run the test suite
```

Requires Python 3.8+. Nothing else.

## What a program looks like

Every Sigma program is a sequence of expressions separated by newlines.
An expression is a number, a name, an operator applied to expressions, or
one of the mathematical functions below.

```
2 + 3 * 4 ^ 2                          50
x = 5                                  defines x
(x = 5) ? 10 : 20                      10, because (x = 5) is a test
(f = (n) => n < 2 ? 1 : n * f(n-1))(10) 3628800
```

### `=` defines, `≠` and `≈` test

`=` is always a definition: `x = 3` names a value, `∆(0) = 65` writes a port.
Its left side must be a name or a port.

To ask a question, use the mathematical operators:

```
3 ≠ 4        1
1 ≈ 1.0000000001   1
```

Writing `2 + 3 = 5` is also a test, because `2 + 3` cannot be defined.
Brackets make the distinction visible: `n = 1` names, `(n = 1) ? a : b` asks.

### Functions are written as mathematics

```
f = (n) => n < 2 ? 1 : n * f(n - 1)
```

`(x) => e` is the same notation a textbook uses for an unnamed function.
A function may name itself, which is how recursion — the only loop there
is — is written.

### Brackets group statements

An expression that mentions a definition or a port write does that work and
hands back a value, so several things can happen in order:

```
(∆(0) = ⊞(72, 105), ∆(0) = ⊞(10))
```

Newlines separate statements too, so most programs read one per line.

## Text without strings

There are no strings. Text is a vector of character codes, and a vector is
written `⊞(...)`:

```
∆(0) = ⊞(72, 101, 108, 108, 111, 10)     Hello\n
```

That is unreadable, so there is a helper:

```
python sigma.py --codes "Hello"
```

and `tools/say.py` for building whole statements from Python strings.

`⧢(x)` turns a number into the characters of its printed form, which is how
programs print results:

```
∆(0) = ⧢(6 * 7)      42
∆(0) = ⧢(1.23456, 2)      1.23
```

## Talking to the outside world

One symbol, `∆` (Delta), is memory-mapped I/O. This is how real hardware
works, and it is more mathematical than a keyword like `print`.

| Port | Reading `∆(n)` | Writing `∆(n) = v` |
|------|----------------|--------------------|
| 0 | error | writes `v` as characters |
| 1 | next input character, or −1 at end | error |
| 2 | a random number in [0,1) | error |
| 3 | 0 | reseeds the random source |
| 10–63 | that memory cell | sets it |

```sigma
∆(0) = ⧢(∆(1))       read one character and print its code
```

## The standard library

Every name below is standard mathematical notation. Nothing else exists.

**Constants** — `π` `τ` `φ` `ℯ` `∞` `∅` (the empty vector) `⊘` (a nop, worth 0)

**Arithmetic** — `+` `-` `*` `/` `%` `^` `√(x)` `∛(x)` `∣(x)` (absolute value)
`⌊(x)` `⌈(x)`

**Tests** — `<` `>` `≤` `≥` `≠` `≈` `∧` `¬` `∨` and `? :`

**Functions** — `sin` `cos` `tan` `asin` `acos` `atan` `atan2` `sinh` `cosh`
`tanh` `ln` `log(b, x)` `exp` `hypot`

**Rounding** — `abs` `sign` `floor` `ceil` `round` `trunc` `frac` `isint`

**Number theory** — `gcd` `lcm` `mod` (floored, as mathematicians expect)
`fact` `comb` `isprime` `isqrt` `pow`

**Calculus** — `∑(f, n)` `∑(f, a, b)` `∏(f, n)` `∂(f, x)` `∂(f, x, h)`
`∫(f, a, b)` `∫(f, a, b, n)`

**Vectors** — `⊞(...)` build, `⊟(v)` length, `⊟(v, i)` element (1-based),
`⊕(v, i, x)` updated (or append, when `i = ⊟(v) + 1`), `⊖(v, a, b)` slice,
`⌕(v, x)` locate, `⊜(v)` sort, `⧺(...)` concatenate, `↦(f, v)` map,
`⇑(f, v)` fold, `⇓(v)` pack, `⇔(n)` unpack, `⧢(n)` number to characters

Vectors hold numbers, not whole numbers: `vec(0.5, 1.25)` keeps its fractions.
Appending is O(n) per step, so a loop that appends is quadratic — write a long
vector as one `⊞(...)` literal instead.

**Other** — `min` `max` `clamp` `lerp` `step` `rand`

ASCII spellings exist for terminals that mangle Unicode: `pi` `sqrt` `sum`
`int` `vec` `len` `at` `map` `fold` `text` `cat` `sort` `slice` `find`.

## Examples

| File | What it shows |
|------|---------------|
| `examples/hello.m` | text, definitions, factorial |
| `examples/fizzbuzz.m` | recursion as a loop |
| `examples/collatz.m` | recursion returning a count |
| `examples/primes.m` | building and walking a vector |
| `examples/calculus.m` | `∫` `∂` `∑` and friends |
| `examples/mandelbrot.m` | complex arithmetic from plain pairs, drawn as text |

Run the tests with `python sigma.py --test`.

## How it is put together

`sigma.py` is a tree-walking interpreter, but it does not walk the tree at
run time. `Interp.compile` turns each AST node into a Python closure once, so
evaluating a program is a chain of ordinary function calls with no string
dispatch in between. `compile_program` returns a list of closures, one per
top-level statement, and re-running that list costs no parsing.

Six things did the work:

- **Natives live outside the scope.** A closure copies its environment on
  every call, so with 36 builtins in scope a recursive function paid for all
  36 at every step. Keeping them in a separate dict means a call copies only
  its own parameters.
- **Frames are reused when nothing can tell.** Calling a function copies its
  scope and boxes its parameters — the largest single cost in a Sigma program.
  A closure whose body calls nothing named and builds no other function keeps
  its frame and overwrites the boxes next time. That frame cannot escape,
  since only an inner lambda could capture it. Anything that could re-enter
  (a recursive or mutually recursive function) gets a fresh scope.
- **Glyphs are methods found by name.** `↦` and `⊕` dispatch through one dict
  lookup rather than a chain of string comparisons.
- **The token cursor is cached.** `peek()` was 650,000 calls in one profile,
  because every precedence level asks what comes next before deciding it is
  finished.
- **Arithmetic tries the answer before the error message.** `_num()` exists to
  explain that a vector turned up where a number was wanted; compiled code
  does the arithmetic first and only falls back.
- **`⊞(1, 2, 3, ...)` is parsed as a list of literals.** Each element would
  otherwise walk back through eleven precedence levels to discover it is a
  number. Parsing a 50,000-element vector went from 0.40s to 0.06s.

Measured against the version before any of this, on the same machine:

| | before | now |
|---|---|---|
| 20,000 additions | 0.443s | 0.096s |
| fib(24), 150,000 calls | 0.891s | 0.516s |
| `∑ k` to 100,000 | 0.350s | 0.122s |
| build a 50,000-element vector | 1.32s | 0.433s |
| mandelbrot.m | 0.473s | 0.268s |
| recursive call depth | 60,000 | 150,000 |

Still behind CPython: about 23× on `∑`, 29× on fibonacci, 48–78× on large
vectors. Python compiles to machine code; Sigma compiles to Python closures
and runs under an interpreter. Closing that would mean a real backend — emit
bytecode, or compile to C — rather than more work on this one.

### A note on the numbers

The "before" figure for the 50,000-element vector was measured before the
lexer's number scanning was tidied, so tokenize got faster too. Ratios
against CPython move around with the machine; run the comparison yourself
before quoting any of them.

## Notes on the design

**Why recursion for everything.** A `for` loop is not mathematics. So
Sigma has none: every repetition in `fizzbuzz.m` is a function calling itself.

**Why `∆` and not `print`.** I/O is the one thing a purely mathematical
language cannot express, and memory-mapped ports are how a computer already
does it. So output is a write to port 0 rather than a keyword.

**Why the test suite matters.** `π` and `∑` are letters to Python, not
symbols, so they must be recognised before identifiers. Tests are run with
`python sigma.py --test`.

**One thing that is not really mathematics.** The file reader strips `#`
comments before parsing, because programs with no strings are otherwise
unreadable. The language itself has no comment syntax.