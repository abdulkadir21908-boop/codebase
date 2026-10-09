#!/bin/bash
# run.sh -- build, then run.  Handy on WSL where the working directory has a
# space in it and a plain `wsl -e bash -lc 'cd ...'` will not survive.
#
#   ./run.sh                          play
#   ./run.sh --frames 600             headless smoke test
#   ./run.sh --demo 9300 --frames 90  start near the finish line
#   ./run.sh --check                  static checks only
set -e
cd "$(dirname "$0")"
mkdir -p build

./build.sh

if [ "$1" = "--check" ]; then
  exec ./check.sh
fi

exec ./car "$@"