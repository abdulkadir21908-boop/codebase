"""Aurora OS Desktop Environment."""

import tkinter as tk
import time

from aurora.windowmanager import Window, WindowManager
from aurora.apps.terminal import TerminalApp
from aurora.apps.finder import FinderApp
from aurora.apps.calculator import CalculatorApp
from aurora.apps.settings import SettingsApp


class Desktop:
    BG = "#11111B"
    ACCENT = "#89B4FA"
    PANEL_BG = "#181825"
    DOCK_BG = "#1E1E2E"

    def __init__(self, fs=None):
        self.fs = fs
        self.root = tk.Tk()
        self.root.title("Aurora OS")
        self.root.configure(bg=self.BG)

        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        w, h = min(sw - 40, 1200), min(sh - 80, 800)
        x = (sw - w) // 2
        y = (sh - h) // 2
        self.root.geometry(f"{w}x{h}+{x}+{y}")
        self.root.minsize(800, 500)

        self.W = w
        self.H = h

        self.canvas = tk.Canvas(self.root, width=w, height=h,
                                bg=self.BG, highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)

        self.wm = WindowManager(self.canvas)
        self.menu_h = 28
        self.dock_h = 56
        self.time_str = ""

        self.clock_id = None
        self._setup_bindings()

        self.dock_apps = [
            ("Finder", self._open_finder),
            ("Terminal", self._open_terminal),
            ("Calculator", self._open_calculator),
            ("Settings", self._open_settings),
        ]
        self.dock_hover = -1

        self._boot_screen()

    def _boot_screen(self):
        self.canvas.delete("all")
        self._draw_background()
        cx, cy = self.W // 2, self.H // 2

        self.canvas.create_text(cx, cy - 60, text="A U R O R A", fill="#CDD6F4",
                                font=("Segoe UI", 36, "bold"))
        self.canvas.create_text(cx, cy, text="OS v0.1.0", fill="#89B4FA",
                                font=("Segoe UI", 14))
        self.canvas.create_text(cx, cy + 30, text="Loading desktop...", fill="#6C7086",
                                font=("Segoe UI", 10))
        self.root.after(1200, self._start_desktop)

    def _start_desktop(self):
        self._draw()

    def _draw_background(self):
        c = self.canvas
        c.delete("bg")
        w, h = self.W, self.H
        c.create_rectangle(0, 0, w, h, fill=self.BG, outline="", tags="bg")

        # Gradient accent line at top
        for i in range(w):
            r = int(137 + (180 - 137) * i / w)
            g = int(180 + (130 - 180) * i / w)
            b = int(250 + (244 - 250) * i / w)
            color = f"#{r:02x}{g:02x}{b:02x}"
            c.create_line(i, 0, i, 2, fill=color, tags="bg")

    def _draw(self):
        c = self.canvas
        c.delete("all")
        self._draw_background()
        self._draw_menu_bar()
        self._draw_dock()
        self.wm.render()
        self._update_clock()

    def _draw_menu_bar(self):
        c = self.canvas
        w = self.W
        c.create_rectangle(0, 0, w, self.menu_h, fill=self.PANEL_BG, outline="")

        # Apple-style logo
        c.create_text(16, self.menu_h // 2, text="\u2726", fill=self.ACCENT,
                      font=("Segoe UI", 13, "bold"))

        # Menu items
        menus = ["Aurora", "File", "Edit", "View", "Help"]
        mx = 38
        for m in menus:
            c.create_text(mx, self.menu_h // 2, text=m, fill="#CDD6F4",
                          anchor="w", font=("Segoe UI", 10))
            mx += len(m) * 8 + 18

        # Clock on right
        self._update_clock()

    def _update_clock(self):
        if self.clock_id:
            self.canvas.after_cancel(self.clock_id)
        self.time_str = time.strftime("%a %b %d  %H:%M")
        self.canvas.delete("clock")
        self.canvas.create_rectangle(self.W - 160, 0, self.W, self.menu_h,
                                     fill=self.PANEL_BG, outline="", tags="clock")
        self.canvas.create_text(self.W - 10, self.menu_h // 2, text=self.time_str,
                                fill="#CDD6F4", anchor="e", font=("Segoe UI", 10),
                                tags="clock")
        self.clock_id = self.canvas.after(10000, self._update_clock)

    def _draw_dock(self):
        c = self.canvas
        w, h = self.W, self.H
        dock_w = len(self.dock_apps) * 60 + 20
        dx = (w - dock_w) // 2
        dy = h - self.dock_h - 8

        # Dock background
        c.create_rectangle(dx, dy, dx + dock_w, dy + self.dock_h,
                           fill=self.DOCK_BG, outline="#313244", width=1,
                           tags="dock")

        # App icons
        for i, (name, _) in enumerate(self.dock_apps):
            ix = dx + 15 + i * 60
            iy = dy + 8

            if i == self.dock_hover:
                c.create_rectangle(ix-2, iy-2, ix+44, iy+42, fill="#45475A", outline="")

            # Icon bg
            colors = ["#A6E3A1", "#89B4FA", "#F9E2AF", "#CBA6F7"]
            c.create_rectangle(ix, iy, ix+40, iy+34, fill=colors[i % len(colors)],
                               outline="")
            # Icon letter
            c.create_text(ix+20, iy+17, text=name[0], fill="#1E1E2E",
                          font=("Segoe UI", 14, "bold"))
            # Name
            c.create_text(ix+20, iy+44, text=name, fill="#6C7086",
                          font=("Segoe UI", 8))

    def _open_terminal(self):
        app = TerminalApp(self.fs)
        win = Window("Terminal", 120, 80, 580, 420, app=app, bg="#1E1E2E")
        self.wm.add(win)
        self._draw()

    def _open_finder(self):
        app = FinderApp(self.fs)
        app.on_open()
        win = Window("Finder", 180, 100, 520, 400, app=app, bg="#181825")
        self.wm.add(win)
        self._draw()

    def _open_calculator(self):
        app = CalculatorApp()
        win = Window("Calculator", 300, 120, 280, 380, app=app, bg="#1E1E2E")
        self.wm.add(win)
        self._draw()

    def _open_settings(self):
        app = SettingsApp()
        win = Window("Settings", 220, 90, 500, 360, app=app, bg="#181825")
        self.wm.add(win)
        self._draw()

    def _setup_bindings(self):
        self.canvas.bind("<Button-1>", self._on_click)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)
        self.canvas.bind("<Double-Button-1>", self._on_double_click)
        self.canvas.bind("<Motion>", self._on_motion)
        self.root.bind("<Key>", self._on_key)

    def _on_click(self, e):
        # Dock click
        dock_w = len(self.dock_apps) * 60 + 20
        dx = (self.W - dock_w) // 2
        dy = self.H - self.dock_h - 8
        if dy <= e.y <= dy + self.dock_h and dx <= e.x <= dx + dock_w:
            idx = (e.x - dx - 15) // 60
            if 0 <= idx < len(self.dock_apps):
                self.dock_apps[idx][1]()
                return

        # Menu bar click (close focused window on "Aurora" menu)
        if e.y < self.menu_h:
            return

        # Window click
        win = self.wm.get_title_at(e.x, e.y)
        if win:
            self.wm.start_drag(e.x, e.y)
            self._draw()
            return

        # Client area click
        win = self.wm.get_at(e.x, e.y)
        if win:
            self.wm.focus(win)
            if win.app and hasattr(win.app, 'on_click'):
                rx = e.x - win.x
                ry = e.y - win.y - win.title_h
                win.app.on_click(e.x, e.y, rx, ry)
            self._draw()

    def _on_drag(self, e):
        if self.wm.dragging:
            self.wm.drag(e.x, e.y)
            self._draw()

    def _on_release(self, e):
        self.wm.end_drag()

    def _on_double_click(self, e):
        win = self.wm.get_at(e.x, e.y)
        if win and win.app and hasattr(win.app, 'on_double_click'):
            rx = e.x - win.x
            ry = e.y - win.y - win.title_h
            win.app.on_double_click(e.x, e.y, rx, ry)
            self._draw()

    def _on_motion(self, e):
        dock_w = len(self.dock_apps) * 60 + 20
        dx = (self.W - dock_w) // 2
        dy = self.H - self.dock_h - 8
        old = self.dock_hover
        if dy <= e.y <= dy + self.dock_h and dx <= e.x <= dx + dock_w:
            self.dock_hover = (e.x - dx - 15) // 60
        else:
            self.dock_hover = -1
        if self.dock_hover != old:
            self._draw()

    def _on_key(self, e):
        win = self.wm.focused
        if win and win.app and hasattr(win.app, 'on_key'):
            key = e.keysym
            if len(key) == 1:
                key = e.char
            win.app.on_key(key)
            self._draw()

    def run(self):
        self.root.mainloop()
