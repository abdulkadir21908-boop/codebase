#!/bin/bash
# build.sh -- assemble and link DUST RUNNER.  No libc, no libraries, no runtime:
# `as` and `ld` are the only tools involved.
#
#   ./build.sh            build ./car
#   ./build.sh -o out     build ./out
set -e
cd "$(dirname "$0")"
mkdir -p build

OUT=car
if [ "$1" = "-o" ]; then OUT=$2; fi

as --64 -o build/car.o car.asm
ld -o "$OUT" build/car.o
echo "built ./$OUT  ($(wc -c < "$OUT") bytes)"