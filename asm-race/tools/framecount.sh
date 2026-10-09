#!/bin/bash
# framecount.sh FILE -- count the half-block glyphs and SGR escapes in a frame
cd "$(dirname "$0")/.."
F=${1:-build/frames/f1.raw}
printf 'bytes            : %s\n' "$(wc -c < "$F")"
printf 'U+2580 half blocks: %s\n' "$(grep -o -a $'\xe2\x96\x80' "$F" | wc -l)"
printf 'fg SGR (38;2;)   : %s\n' "$(grep -o -a '38;2;' "$F" | wc -l)"
printf 'bg SGR (48;2;)   : %s\n' "$(grep -o -a '48;2;' "$F" | wc -l)"
printf 'ESC[H (frames)   : %s\n' "$(grep -o -a $'\033\[H' "$F" | wc -l)"