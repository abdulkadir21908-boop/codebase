#!/bin/bash
# all.sh -- the whole verification sweep, start to finish.
set -e
cd "$(dirname "$0")"

echo "===== build"
./build.sh

echo
echo "===== static checks"
./check.sh

echo
echo "===== checker selftest"
./selftest.sh

echo
echo "===== --help"
./car --help

echo
echo "===== 3000 headless frames"
./car --frames 3000 --cols 100 --rows 30 > build/smoke.raw 2>/dev/null
echo "exit 0, $(wc -c < build/smoke.raw) bytes of ANSI"

echo
echo "===== the run plays (motion, palette, and reaching the finish)"
# Started 100 m short of the line: the sim now really moves, so this reaches the
# finish in about 340 frames of the 5 ms minimum step.
./car --demo 9500 --frames 420 --cols 100 --rows 30 > build/finish.raw 2>/dev/null
python3 tools/playcheck.py build/finish.raw 100 30 --expect-finish

echo
echo "===== probe: the state the loop actually reaches"
as --64 -o build/car.o car.asm
ld -e probe -o build/probe build/car.o
./build/probe < /dev/null

echo
echo "===== ALL GREEN"