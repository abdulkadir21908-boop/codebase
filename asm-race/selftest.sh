# selftest.sh -- prove the checkers actually fire.  Each is fed a deliberately
# broken copy of car.asm and must report the problem.  A checker that cannot
# fail is worse than no checker at all.
set -e
cd "$(dirname "$0")"
mkdir -p build
cp car.asm build/car.asm.pristine

restore() { cp build/car.asm.pristine car.asm; }
trap restore EXIT

fail=0

# break car.asm, then require the named check to reject it
expect() {
  local check="$1" what="$2"
  if python3 tools/asmcheck.py "$check" >/dev/null 2>&1; then
    echo "  NOT DETECTED: $what"
    fail=1
  else
    echo "  detected: $what"
  fi
  restore
}

echo "== width: a 64-bit load of a 4-byte object"
sed -i '0,/mov ebx, \[nslice\]/s//mov rbx, [nslice]/' car.asm
expect width "mov rbx, [nslice]"

echo "== width: a 64-bit store into a 4-byte object"
sed -i 's|^frb_idx:     \.space 8.*$|frb_idx:     .space 4|' car.asm
expect width "mov [frb_idx], rcx into a 4-byte object"

echo "== divloop: a divide loop that clobbers its own quotient"
sed -i '0,/add dl, 0x30/s//add al, 0x30/' car.asm
expect divloop "add al,0x30 then test eax,eax"

echo "== muldiv: a helper result not passed on in edi"
python3 - <<'PYEOF'
s = open('car.asm', encoding='utf-8').read()
s = s.replace('    mov edi, eax              # pass the result on in edi\n', '', 1)
open('car.asm', 'w', encoding='utf-8').write(s)
PYEOF
expect muldiv "mul16 -> div16 with edi never reloaded"

echo "== argsites: a helper called with the wrong argument register"
sed -i '0,/^    mov esi, 0xE666$/s//    mov ecx, 0xE666/' car.asm
expect argsites "mul16 called with ecx set instead of esi"

echo "== argbody: a helper that documents ecx but reads esi"
python3 - <<'PYEOF'
import re
s = open('car.asm', encoding='utf-8').read()
s, n = re.subn(r'(# emit_sgr\(base=edi 38/48, colour=ecx\).*?)\n    mov ebx, ecx',
               r'\1\n    mov ebx, esi', s, count=1, flags=re.S)
assert n == 1, "emit_sgr's colour copy-in was not found"
open('car.asm', 'w', encoding='utf-8').write(s)
PYEOF
expect argbody "emit_sgr documented as ecx but reading esi"

echo "== layout: a .space whose expression fails to evaluate"
sed -i 's|^numbuf:\( *\)\.space 32$|numbuf:\1.space NOSUCHCONST|' car.asm
expect layout "numbuf sized by a name that is not defined"

echo "== the real car.asm must pass all of them"
python3 tools/asmcheck.py >/dev/null || {
  echo "  a checker reports a problem in the real car.asm"; fail=1; }

if [ "$fail" -ne 0 ]; then
  echo "SELFTEST FAILED"
  exit 1
fi
echo "every checker fires on a broken file and passes the real one"