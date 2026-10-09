#!/usr/bin/env python3
"""asmcheck.py -- static checks on car.asm.

Each check guards a class of bug that actually occurred while writing this
program and that reading the disassembly did not catch.  They are deliberately
narrow: a linter that cries wolf gets ignored.

  width      a 64-bit load or store naming an object narrower than 8 bytes
             silently pulls in -- or overwrites -- its neighbour.  `imul rax,
             [nslice]` folded slice_e's low half into the slice count and every
             projection went out of bounds two frames in.

  divloop    a divide loop that converts the remainder in al and then tests eax
             never terminates, because the conversion clobbers the quotient the
             loop condition reads.  The pointer then walks off the end of .bss.

  muldiv     a helper that returns its result in eax is fed straight into
             another helper that takes its argument in edi, without a
             `mov edi, eax` in between.

  argsites   a maths helper is called without its documented argument registers
             written in the same basic block.  render_frame loaded 0xE666 into
             ecx and called mul16, which reads esi: focal came out 0 and the
             road vanished.

  argbody    the other half of that contract: a helper does not actually read
              the registers it is documented to read.  emit_sgr read its colour
              out of esi while every call site passed it in ecx, so each
              background SGR carried whatever stale pointer out_num had left
              behind -- a constant field of garbage green across the screen.

  overlap    two .bss objects intersect.  The framebuffer, the sprite tables and
             the output buffer all sit next to each other.

Usage:
  python3 tools/asmcheck.py [width|divloop|muldiv|argsites|argbody|overlap|all]
"""

import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.abspath(os.path.join(HERE, ".."))
ASM = os.path.join(PROJ, "car.asm")
OBJ = "/tmp/asmcheck.o"


# --------------------------------------------------------------------------
# sizes of the .space-declared objects
# --------------------------------------------------------------------------
def load_constants(text):
    consts = {}
    for m in re.finditer(r"^\.equ\s+([A-Za-z_]\w*)\s*,\s*(.+?)\s*(?:#.*)?$", text, re.M):
        consts[m.group(1)] = m.group(2).strip()
    return consts


def evaluate(expr, consts, depth=0):
    """Evaluate a .equ or .space expression: numbers, names, * and <<."""
    expr = expr.strip()
    if depth > 8:
        return 0
    if re.fullmatch(r"\d+", expr):
        return int(expr)
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", expr):
        return int(expr, 16)
    if "<<" in expr:                       # left shift, e.g. OUT_MAX = 1 << 20
        lhs, rhs = expr.split("<<", 1)
        return evaluate(lhs, consts, depth + 1) << evaluate(rhs, consts, depth + 1)
    if "+" in expr:                         # sum, e.g. (NUM_SEG + 1) * 4
        return sum(evaluate(p, consts, depth + 1) for p in expr.split("+"))
    total = 1
    for part in expr.replace("(", " ").replace(")", " ").split("*"):
        key = part.strip()
        if re.fullmatch(r"\d+", key):
            total *= int(key)
        elif re.fullmatch(r"0[xX][0-9a-fA-F]+", key):
            total *= int(key, 16)
        elif key in consts:
            total *= evaluate(consts[key], consts, depth + 1)
        else:
            total *= 0
    return total


def declared_sizes(text):
    consts = load_constants(text)
    sizes = {}
    for m in re.finditer(r"^([A-Za-z_]\w*):\s*\.space\s+(.+?)\s*(?:#.*)?$", text, re.M):
        sizes[m.group(1)] = evaluate(m.group(2), consts)
    return sizes


def run(*args):
    return subprocess.run(args, cwd=PROJ, check=True, capture_output=True, text=True).stdout


def section_indices(obj):
    """section number -> section name."""
    idx = {}
    for line in run("readelf", "-SW", obj).splitlines():
        m = re.match(r"\s*\[\s*(\d+)\]\s+(\S+)", line)
        if m:
            idx[int(m.group(1))] = m.group(2)
    return idx


def bss_offsets(obj):
    """symbol -> byte offset inside .bss."""
    sections = section_indices(obj)
    offsets = {}
    for line in run("readelf", "-sW", obj).splitlines():
        m = re.match(r"\s*\d+:\s+([0-9a-f]+)\s+\d+\s+\S+\s+\S+\s+\S+\s+(\S+)\s+(\S+)\s*$", line)
        if not m:
            continue
        ndx, name = m.group(2), m.group(3)
        if ndx.isdigit() and sections.get(int(ndx)) == ".bss":
            offsets[name] = int(m.group(1), 16)
    return offsets


# --------------------------------------------------------------------------
# helpers: the maths routines and the registers they read
# --------------------------------------------------------------------------
HELPERS = {
    "mul16": ["edi", "esi"],
    "div16": ["edi", "esi"],
    "mul_s32": ["edi", "esi"],
    "scale_dt": ["edi", "esi"],
    "fog_mix": ["edi", "esi"],
    "shade": ["edi", "esi"],
    "lerp_color": ["edi", "esi", "ecx"],
    "seg_at": ["edi"],
    "elev_at": ["edi"],
    "fog_amt": ["eax"],
    "px16": ["eax"],
    "abs16": ["eax"],
    "out_byte": ["edi"],
    "out_num": ["edi"],
    "emit_sgr": ["edi", "ecx"],
}
# helpers that leave their result in eax
RET_EAX = ["mul16", "div16", "mul_s32", "scale_dt", "shade", "lerp_color", "seg_at", "elev_at"]
# helpers that take their first argument in edi
TAKE_EDI = ["mul16", "div16", "mul_s32", "scale_dt", "fog_mix", "shade",
            "lerp_color", "seg_at", "elev_at"]

R64 = r"r(?:ax|bx|cx|dx|si|di|bp|sp|[89]|1[0-5])\b"   # \b stops r8d matching as r8
ALU = r"(?:imul|mov|add|sub|and|or|xor|cmp|test|adc|sbb|neg|not|bt|sh[lrd]|ro[lr]|sal|sar)"
NAME = r"([A-Za-z_]\w*)"


def check_width(lines, sizes, _):
    load = re.compile(r"^\s+" + ALU + r"\s+" + R64 + r"\s*,\s*(?:qword ptr\s*)?\[\s*"
                      + NAME + r"\s*(\s*\+\s*\d+)?\s*\]")
    store = re.compile(r"^\s+" + ALU + r"\s+(?:qword ptr\s+)?\[\s*"
                       + NAME + r"\s*(\s*\+\s*\d+)?\s*\]\s*,\s*" + R64)
    narrow = re.compile(r"^\s+(?:inc|dec|add|sub)\s+dword ptr\s+\[\s*" + NAME + r"\s*\]")
    bad = 0
    for i, line in enumerate(lines):
        if re.match(r"^\s*#", line):
            continue
        m = load.match(line) or store.match(line)
        if m:
            sym = m.group(1)
            if sym in sizes and sizes[sym] < 8:
                kind = "write" if store.match(line) else "read"
                print(f"  car.asm:{i + 1}: 64-bit {kind} of {sizes[sym]}-byte '{sym}'"
                      f"  ->  {line.strip()}")
                bad += 1
                continue
        k = narrow.match(line)
        if k and k.group(1) in sizes and sizes[k.group(1)] < 4:
            print(f"  car.asm:{i + 1}: dword access to {sizes[k.group(1)]}-byte '{k.group(1)}'"
                  f"  ->  {line.strip()}")
            bad += 1
    if bad == 0:
        print(f"  checked {len(sizes)} sized symbols: no over-wide accesses")
    else:
        print(f"  {bad} over-wide access(es)")
    return bad


def check_divloop(lines, _sizes, _):
    # a function body runs from its label to the next .globl for a different name
    starts = []
    for i, line in enumerate(lines):
        m = re.match(r"^([A-Za-z_]\w*):", line)
        if m and not re.match(r"^\.globl\s+(\w+)\s*$", lines[i - 1] if i else ""):
            starts.append((i, m.group(1)))
    bounds = {}
    for i, name in starts:
        end = len(lines)
        for k in range(i + 1, len(lines)):
            g = re.match(r"^\.globl\s+([A-Za-z_]\w*)\s*$", lines[k])
            if g and g.group(1) != name and not g.group(1).startswith(name + "_"):
                end = k
                break
        bounds[i] = end

    bad = 0
    for i, name in starts:
        body = lines[i:bounds[i]]
        if not any(re.match(r"^\s+div\s", l) for l in body):
            continue
        conv = next((k for k, l in enumerate(body)
                     if re.match(r"^\s+add\s+al\s*,\s*0x30", l)), None)
        if conv is None:
            continue
        tst = next((k for k in range(conv + 1, len(body))
                    if re.match(r"^\s+test\s+eax\s*,\s*eax", body[k])), None)
        if tst is None:
            continue
        if any(re.match(r"^\s+mov\s+eax\s*,\s*\[", body[k]) for k in range(conv + 1, tst)):
            continue
        print(f"  car.asm:{i + 1}: {name}: add al,0x30 at line {i + conv + 1} then"
              f" test eax,eax at line {i + tst + 1} with no reload -- the loop never ends")
        bad += 1
    if bad == 0:
        print("  no self-terminating divide loops found")
    else:
        print(f"  {bad} broken divide loop(s)")
    return bad


def check_muldiv(lines, _sizes, _):
    bad = 0
    for i, line in enumerate(lines):
        m = re.match(r"^\s*call\s+([A-Za-z_]\w*)\s*(?:#.*)?$", line)
        if not m or m.group(1) not in RET_EAX:
            continue
        for k in range(i + 1, min(i + 6, len(lines))):
            n = re.match(r"^\s*call\s+([A-Za-z_]\w*)\s*(?:#.*)?$", lines[k])
            if not n:
                continue
            if n.group(1) in TAKE_EDI and not any(
                re.match(r"^\s*mov\s+edi\s*,", lines[j]) for j in range(i + 1, k)
            ):
                print(f"  car.asm:{i + 1}: call {m.group(1)} -> call {n.group(1)}"
                      f" at line {k + 1} with edi never reloaded")
                for j in range(i, k + 1):
                    print(f"      {j + 1}: {lines[j]}")
                bad += 1
            break
    if bad == 0:
        print("  every helper chain reloads edi before the next helper reads it")
    else:
        print(f"  {bad} broken helper chain(s)")
    return bad


WRITERS = re.compile(
    r"^\s*(?:mov|movzx|movsxd|lea|xor|shl|shr|sar|sub|add|imul|neg|and|or|not)\s+([a-z]\w*)\b")


def check_argsites(lines, _sizes, _):
    def block_start(i):
        for k in range(i - 1, max(-1, i - 40), -1):
            if re.match(r"^\s*\.globl\s", lines[k]):
                return k + 1
            if re.match(r"^[.?A-Za-z_]\w*:", lines[k]):
                return k + 1
        return max(0, i - 40)

    bad = 0
    for i, line in enumerate(lines):
        m = re.match(r"^\s*call\s+([A-Za-z_]\w*)\s*$", line)
        if not m or m.group(1) not in HELPERS:
            continue
        # an "args ..." comment marks deliberate forwarding or inheritance
        if re.search(r"#\s*args\b", line):
            continue
        last = {}
        for k in range(block_start(i), i):
            w = WRITERS.match(lines[k])
            if w:
                last[w.group(1)] = lines[k].strip()
        missing = [r for r in HELPERS[m.group(1)] if r not in last]
        if missing:
            print(f"  car.asm:{i + 1}: call {m.group(1)} --"
                  f" {', '.join(missing)} not written in this block")
            for k in range(block_start(i), i + 1):
                print(f"      {k + 1}: {lines[k]}")
            print()
            bad += 1
    if bad == 0:
        print("  every maths-helper call sets the registers it reads")
    else:
        print(f"  {bad} suspicious call site(s)")
    return bad


# every sub-register name a documented argument register can appear under
ALIASES = {
    "edi": ("edi", "di", "dil", "rdi"),
    "esi": ("esi", "si", "sil", "rsi"),
    "ecx": ("ecx", "cx", "cl", "ecx", "rcx", "cl", "ch"),
    "edx": ("edx", "dx", "dl", "dh", "rdx"),
    "eax": ("eax", "ax", "al", "ah", "rax"),
    "r8d": ("r8d", "r8d"),
}


def function_body(lines, name):
    """The instructions of `name`, from its label to the ret that ends it."""
    start = None
    for i, line in enumerate(lines):
        if re.match(r"^\s*\.globl\s+" + re.escape(name) + r"\s*$", line):
            start = i + 1
            break
    if start is None:
        for i, line in enumerate(lines):
            if re.match(r"^[.?A-Za-z_]\w*:\s*$", line) and lines[i].strip()[:-1] == name:
                start = i + 1
                break
    if start is None:
        return None
    for k in range(start, len(lines)):
        if re.match(r"^\s*ret\s*$", lines[k]):
            return lines[start:k + 1]
        # a new top-level label before the ret means this body never closed --
        # stop there rather than reading the rest of the program
        if k > start and (re.match(r"^\s*\.globl\s+\w", lines[k])
                          or re.match(r"^[.?A-Za-z_]\w*:", lines[k])):
            return lines[start:k]
    return lines[start:]


def operands(line):
    """The source half of an instruction, with any comment removed.

    Only `mov` and `lea` have their first operand dropped, because only there is
    the first operand a pure destination.  For everything else -- shifts, tests,
    compares, arithmetic -- the first operand is read as well, and hiding it
    would make a helper that genuinely reads its argument look as though it
    never does.
    """
    code = re.split(r"[#;]", line, 1)[0]
    m = re.match(r"^\s*([a-z][a-z0-9.]*)\s+(.+?)\s*$", code)
    if not m:
        return ""
    mnemonic, rest = m.group(1), m.group(2)
    if mnemonic == "lea":
        return ""
    if mnemonic == "mov":
        dest, comma, src = rest.partition(",")
        return src if comma else rest
    return rest


def forwards_to(body):
    """The helper a body forwards its arguments to, if it says so.

    scale_dt is three instructions: it hands edi and esi straight to mul_s32 and
    shifts the result.  It never mentions them itself, so demanding that it read
    them would be wrong -- but the contract still has to hold, so the check
    follows the forwarding and verifies the callee it names.
    """
    for line in body:
        if re.search(r"#\s*args\b", line):
            m = re.search(r"\bcall\s+(\w+)", line)
            if m:
                return m.group(1)
    return None


def check_argbody(lines, _sizes, _):
    """A helper must read the registers it is documented to read.

    check_argsites proves the caller sets them; this proves the callee looks at
    them.  Between them a one-sided edit -- caller and callee disagreeing about
    which register an argument travels in -- cannot survive.
    """
    bad = 0
    followed = 0
    for name in sorted(HELPERS):
        body = function_body(lines, name)
        if body is None:
            print(f"  {name}: documented in HELPERS but not defined in car.asm")
            bad += 1
            continue
        target = forwards_to(body)
        if target is not None:
            if target not in HELPERS:
                print(f"  {name}: forwards to {target}, which is not a known helper"
                      " -- nothing verifies the contract past here")
                bad += 1
                continue
            # the contract is enforced against the helper that does the reading
            followed += 1
            continue
        for reg in HELPERS[name]:
            names = "|".join(ALIASES.get(reg, (reg,)))
            if not re.search(r"\b(?:" + names + r")\b", "\n".join(operands(l) for l in body)):
                print(f"  {name}: {reg} is documented as an argument but the body"
                      " never reads it")
                bad += 1
    if bad == 0:
        note = f" ({followed} forwarding, checked against their callee)" if followed else ""
        print(f"  all {len(HELPERS)} documented helpers read their argument registers{note}")
    else:
        print(f"  {bad} argument-contract problem(s)")
    return bad


def check_layout(_lines, sizes, _):
    """Sanity-check the .bss declarations themselves.

    Two sequentially declared objects can never intersect -- widening one just
    shifts everything after it -- so a literal overlap test cannot fail.  What
    can go wrong is the size expression failing to evaluate (an unsupported
    operator, a name that is not an .equ), which silently reports a buffer as
    zero bytes wide and drops it from every other check, or two labels landing
    on the same address.
    """
    subprocess.run(["as", "--64", "-o", OBJ, ASM], cwd=PROJ, check=True)
    offsets = bss_offsets(OBJ)
    text = open(ASM, encoding="utf-8").read()
    consts = load_constants(text)

    bad = 0
    for name, size in sorted(sizes.items()):
        if name not in offsets:
            continue
        if size <= 0:
            expr = re.search(r"^" + re.escape(name) + r":\s*\.space\s+(.+?)\s*(?:#.*)?$",
                             text, re.M)
            print(f"  {name}: .space evaluates to {size}"
                  + (f"  (from '{expr.group(1)}')" if expr else ""))
            bad += 1

    by_off = {}
    for name, off in offsets.items():
        if name in sizes and sizes[name] > 0:
            by_off.setdefault(off, []).append(name)
    for off, names in sorted(by_off.items()):
        if len(names) > 1:
            print(f"  0x{off:x} is claimed by {', '.join(sorted(names))}")
            bad += 1

    rows = sorted((off, sizes[n], n) for n, off in offsets.items()
                  if n in sizes and sizes[n] > 0)
    tail = f"; region 0x0..0x{rows[-1][0] + rows[-1][1]:x}" if rows else ""
    if bad == 0:
        print(f"  {len(rows)} sized .bss objects, all with a non-zero width{tail}")
    else:
        print(f"  {bad} layout problem(s)")
    return bad


CHECKS = {
    "width": check_width,
    "divloop": check_divloop,
    "muldiv": check_muldiv,
    "argsites": check_argsites,
    "argbody": check_argbody,
    "layout": check_layout,
}


def main(argv):
    names = argv[1:] or ["all"]
    if names == ["all"]:
        names = list(CHECKS)
    text = open(ASM, encoding="utf-8").read()
    lines = text.split("\n")
    sizes = declared_sizes(text)
    failed = 0
    for name in names:
        print(f"== {name}")
        failed += CHECKS[name](lines, sizes, None)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))