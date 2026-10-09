#!/bin/bash
# check.sh -- static checks on car.asm.  Each one guards a class of bug that
# actually bit during development and that reading the disassembly did not
# catch.  See tools/asmcheck.py for what each one looks for.
set -e
cd "$(dirname "$0")"

if [ $# -gt 0 ]; then
  exec python3 tools/asmcheck.py "$@"
fi

python3 tools/asmcheck.py
echo "all checks passed"