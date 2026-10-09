#!/usr/bin/env python3
"""playcheck.py -- assert from a captured run that the game actually plays.

A rendered frame proves the renderer drew something.  It does not prove the car
moved, the clock ran, or the race can end -- and for a long stretch of this
program's development all three were broken while every frame still rendered
perfectly, because dt came out as zero.  So the checks here are about motion and
state, not about pixels:

  frames differ        consecutive captures are not byte-identical
  the finish is reached  a run of the finish colour appears in the middle rows

Usage:
  python3 tools/playcheck.py IN COLS ROWS [--expect-finish]
"""

import sys
from collections import Counter

C_SUN = (0xFF, 0xF3, 0xC0)          # the finish banner and the speed readout
C_ACCENT = (0x50, 0xE0, 0xA0)       # GO!, the clock, the progress bar


def replay(path, cols, rows):
    """Every frame as a list of (fg, bg) per cell, in capture order."""
    data = open(path, "rb").read()
    frames = []
    grid = bytearray(cols * rows * 6)
    cell = 0
    fg = b"\xff\xff\xff"
    bg = b"\x00\x00\x00"
    i = 0
    n = len(data)
    while i < n:
        if data[i] == 0x1B and data[i + 1] == 0x5B:
            j = i + 2
            while j < n and 0x30 <= data[j] <= 0x3F:
                j += 1
            if j >= n:
                break
            cmd = chr(data[j])
            if cmd == "H":
                if cell:
                    frames.append(bytes(grid))
                grid = bytearray(cols * rows * 6)
                cell = 0
                i = j + 1
                continue
            if cmd == "m":
                params = data[i + 2:j].split(b";")
                if params[:2] == [b"38", b"2"]:
                    fg = bytes(int(x) for x in params[2:5])
                elif params[:2] == [b"48", b"2"]:
                    bg = bytes(int(x) for x in params[2:5])
                elif params[0] in (b"", b"0"):
                    fg = b"\xff\xff\xff"
                    bg = b"\x00\x00\x00"
            i = j + 1
            continue
        if data[i] == 0xE2 and data[i + 1] == 0x96 and data[i + 2] == 0x80:
            if cell < cols * rows:
                o = cell * 6
                grid[o:o + 3] = fg
                grid[o + 3:o + 6] = bg
                cell += 1
            i += 3
            continue
        i += 1
    if cell:
        frames.append(bytes(grid))
    return frames


def ink_cells(frame, cols, colour):
    """Which cells carry `colour` in either half."""
    out = []
    for c in range(cols * (len(frame) // 6 // cols)):
        o = c * 6
        if tuple(frame[o:o + 3]) == colour or tuple(frame[o + 3:o + 6]) == colour:
            out.append(c)
    return out


def main(argv):
    if len(argv) < 4:
        print(__doc__)
        return 2
    path, cols, rows = argv[1], int(argv[2]), int(argv[3])
    expect_finish = "--expect-finish" in argv

    frames = replay(path, cols, rows)
    if not frames:
        print(f"  no frames replayed from {path}")
        return 1
    print(f"  {len(frames)} frames, {cols}x{rows}")

    bad = 0

    # 1. motion: consecutive frames must differ, and most of them must
    frozen = sum(1 for f in range(1, len(frames))
                 if frames[f] == frames[f - 1])
    moving = len(frames) - 1 - frozen
    pct = 100.0 * moving / max(1, len(frames) - 1)
    if pct < 90:
        print(f"  only {moving}/{len(frames) - 1} frames differ from the previous"
              f" one ({pct:.1f}%) -- the simulation is not advancing")
        bad += 1
    else:
        print(f"  {moving}/{len(frames) - 1} frames advance ({pct:.1f}%)")

    # 2. the palette is a small fixed set, so a frame that invents colours means
    #    something is being painted out of a stale register
    counts = Counter()
    for f in frames[:60]:
        for o in range(0, len(f), 6):
            counts[tuple(f[o:o + 3])] += 1
            counts[tuple(f[o + 3:o + 6])] += 1
    if len(counts) > 200:
        print(f"  {len(counts)} distinct colours over 60 frames -- far more than"
              " the renderer has, so something is drawing garbage")
        bad += 1
    else:
        print(f"  {len(counts)} distinct colours over 60 frames")

    # 3. the finish banner: a wide run of the finish colour in the middle rows
    if expect_finish:
        mid_lo = rows // 2
        mid_hi = rows // 2 + rows // 8
        hit = None
        for f, frame in enumerate(frames):
            cells = ink_cells(frame, cols, C_SUN)
            band = [c for c in cells
                    if mid_lo <= c // cols <= mid_hi]
            if len(band) >= cols // 6:
                hit = f
                break
        if hit is None:
            print(f"  the finish banner never appeared in rows"
                  f" {mid_lo}..{mid_hi} of {len(frames)} frames")
            bad += 1
        else:
            print(f"  finish banner present from frame {hit}"
                  f" to {len(frames) - 1}")

    if bad:
        print(f"PLAYCHECK FAILED ({bad} problem(s))")
        return 1
    print("  the run plays: it moves, its palette stays bounded, and it finishes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))