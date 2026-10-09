"""System layer - ties core, screen, and system routines together."""

from .core import Core
from .display import Screen, BASE as SCREEN_BASE

SCREEN_W = 80
SCREEN_H = 25


def bios_trap(core, func, val, imm):
    """System call handler - TRAP instruction routes here."""
    if func == 0:
        _vga_putc(core, val)
    elif func == 1:
        _vga_puts(core, val)
    elif func == 2:
        _vga_clear(core)
    elif func == 3:
        _vga_set_color(core, val, imm)


def _vga_putc(core, ch, attr=0x07):
    """Write one character to the VGA screen."""
    cursor = core.regs[15]

    if ch == 10:
        row = cursor // SCREEN_W
        core.regs[15] = (row + 1) * SCREEN_W
        return

    row = cursor // SCREEN_W
    col = cursor % SCREEN_W
    if 0 <= row < SCREEN_H and 0 <= col < SCREEN_W:
        offset = SCREEN_BASE + (row * SCREEN_W + col) * 2
        core.memory[offset] = ch & 0xFF
        core.memory[offset + 1] = attr & 0xFF
        core.screen_dirty = True
    core.regs[15] = cursor + 1


def _vga_puts(core, addr):
    """Write a null-terminated string from memory to screen."""
    i = 0
    while True:
        ch = core.memory[addr + i]
        if ch == 0:
            break
        _vga_putc(core, ch)
        i += 1


def _vga_clear(core):
    """Clear the entire screen."""
    for i in range(SCREEN_W * SCREEN_H * 2):
        core.memory[SCREEN_BASE + i] = 0
    core.regs[15] = 0
    core.screen_dirty = True


def _vga_set_color(core, fg, bg):
    """Set foreground/background color (stored in r14)."""
    core.regs[14] = (bg << 4) | (fg & 0x0F)


class System:
    def __init__(self):
        self.core = Core()
        self.core.trap_handler = bios_trap
        self.screen = None

    def load_program(self, bytecode, offset=0):
        self.core.load(bytecode, offset)

    def start(self):
        self.screen = Screen(self.core)
        self.screen.run()
