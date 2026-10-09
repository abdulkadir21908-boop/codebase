#!/bin/bash
# bssinfo.sh BIN -- show where the writable segment ends and the addresses of
# the symbols most likely to sit at its edge.
cd "$(dirname "$0")/.."
BIN=${1:-/tmp/p58v.bin}
echo "== segments"
readelf -lW "$BIN" | grep LOAD
echo
echo "== sections"
readelf -SW "$BIN" | grep -E "bss|data"
echo
echo "== symbols of interest"
for s in numbuf dbg_s1 dbg_s2 outbuf outlen du_colour fb; do
  nm "$BIN" | grep -w "$s" || true
done
echo
echo "== last few bss symbols by address"
nm -n "$BIN" | grep -iE " [bB] " | tail -6