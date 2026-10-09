"""Screen display - renders the text grid from memory."""

import tkinter as tk

SCREEN_W = 80
SCREEN_H = 25
CELL_W = 10
CELL_H = 18
BASE = 0xF0000

COLORS = [
    "#000000", "#0000AA", "#00AA00", "#00AAAA",
    "#AA0000", "#AA00AA", "#AA5500", "#AAAAAA",
    "#555555", "#5555FF", "#55FF55", "#55FFFF",
    "#FF5555", "#FF55FF", "#FFFF55", "#FFFFFF",
]


class Screen:
    def __init__(self, core):
        self.core = core
        self.root = tk.Tk()
        self.root.title("Aurora OS")
        self.root.configure(bg="#000000")
        self.root.resizable(False, False)
        self.canvas = tk.Canvas(
            self.root,
            width=SCREEN_W * CELL_W,
            height=SCREEN_H * CELL_H,
            bg="#000000",
            highlightthickness=0,
        )
        self.canvas.pack()
        self.cells = [[None] * SCREEN_W for _ in range(SCREEN_H)]
        for row in range(SCREEN_H):
            for col in range(SCREEN_W):
                x = col * CELL_W
                y = row * CELL_H
                tid = self.canvas.create_text(
                    x + CELL_W // 2, y + CELL_H // 2,
                    text=" ", fill="#AAAAAA",
                    anchor="center",
                    font=("Courier", 11, "bold"),
                )
                self.cells[row][col] = tid

    def refresh(self):
        mem = self.core.memory
        for row in range(SCREEN_H):
            for col in range(SCREEN_W):
                offset = BASE + (row * SCREEN_W + col) * 2
                ch = chr(mem[offset]) if mem[offset] else " "
                attr = mem[offset + 1]
                fg = attr & 0x0F
                bg = (attr >> 4) & 0x0F
                fg_color = COLORS[fg] if fg < len(COLORS) else "#AAAAAA"
                bg_color = COLORS[bg] if bg < len(COLORS) else "#000000"
                self.canvas.itemconfig(
                    self.cells[row][col],
                    text=ch,
                    fill=fg_color,
                )
        self.core.screen_dirty = False

    def tick(self):
        if self.core.screen_dirty:
            self.refresh()
        self.root.after(16, self.tick)

    def run(self):
        self.refresh()
        self.tick()
        self.root.mainloop()
