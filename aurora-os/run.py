#!/usr/bin/env python3
"""
Aurora OS - Boot it.

Usage:
    python run.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from aurora.compiler import Compiler
from aurora.core import Core
from aurora.system import bios_trap

KERNEL_PATH = os.path.join(os.path.dirname(__file__), "kernel", "boot.aur")


def boot_kernel():
    comp = Compiler()
    bytecode, errors = comp.assemble_file(KERNEL_PATH)
    if errors:
        for e in errors:
            print(f"  Error: {e}")
        sys.exit(1)

    core = Core()
    core.trap_handler = bios_trap
    core.load(bytecode)
    core.run(max_steps=5000)

    from aurora.system import SCREEN_BASE
    print()
    print("  Aurora OS")
    print("  Kernel: ", end="")
    for row in range(25):
        line = ""
        for col in range(80):
            offset = SCREEN_BASE + (row * 80 + col) * 2
            ch = core.memory[offset]
            line += chr(ch) if ch else " "
        if line.strip():
            print(line)
    print()


def main():
    boot_kernel()
    print("  Starting Aurora Desktop...")
    print()

    from server import main as server_main
    server_main()


if __name__ == "__main__":
    main()
