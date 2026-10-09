"""Window manager - handles windows, dragging, focus, z-order."""

import tkinter as tk


class Window:
    _next_id = 0

    def __init__(self, title, x, y, w, h, app=None, bg="#1E1E2E"):
        Window._next_id += 1
        self.id = Window._next_id
        self.title = title
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.app = app
        self.visible = True
        self.focused = False
        self.minimized = False
        self.bg = bg
        self.widgets = []
        self.canvas = None
        self.title_h = 32
        self.on_close = None
        self.on_focus = None

    def contains(self, mx, my):
        return self.x <= mx <= self.x + self.w and self.y <= my <= self.y + self.h

    def title_contains(self, mx, my):
        return (self.x <= mx <= self.x + self.w and
                self.y <= my <= self.y + self.title_h)

    def client_contains(self, mx, my):
        return (self.x <= mx <= self.x + self.w and
                self.y + self.title_h <= my <= self.y + self.h)


class WindowManager:
    def __init__(self, canvas):
        self.canvas = canvas
        self.windows = []
        self.focused = None
        self.dragging = None
        self.drag_off = (0, 0)
        self.z_order = []

    def add(self, win):
        self.windows.append(win)
        self.z_order.append(win.id)
        self.focus(win)
        return win

    def remove(self, win):
        if win in self.windows:
            self.windows.remove(win)
        if win.id in self.z_order:
            self.z_order.remove(win.id)
        if self.focused == win:
            self.focused = None

    def focus(self, win):
        if self.focused:
            self.focused.focused = False
        self.focused = win
        win.focused = True
        if win.id in self.z_order:
            self.z_order.remove(win.id)
        self.z_order.append(win.id)
        if win.on_focus:
            win.on_focus(win)

    def get_at(self, mx, my):
        for wid in reversed(self.z_order):
            for w in self.windows:
                if w.id == wid and w.visible and w.contains(mx, my):
                    return w
        return None

    def get_title_at(self, mx, my):
        for wid in reversed(self.z_order):
            for w in self.windows:
                if w.id == wid and w.visible and w.title_contains(mx, my):
                    return w
        return None

    def start_drag(self, mx, my):
        win = self.get_title_at(mx, my)
        if win:
            self.dragging = win
            self.drag_off = (mx - win.x, my - win.y)
            self.focus(win)
            return True
        return False

    def drag(self, mx, my):
        if self.dragging:
            self.dragging.x = mx - self.drag_off[0]
            self.dragging.y = my - self.drag_off[1]
            return True
        return False

    def end_drag(self):
        self.dragging = None

    def render(self):
        for wid in self.z_order:
            for w in self.windows:
                if w.id == wid and w.visible and not w.minimized:
                    self._draw_window(w)

    def _draw_window(self, win):
        c = self.canvas
        x, y, w, h = win.x, win.y, win.w, win.h
        th = win.title_h

        # Shadow
        c.create_rectangle(x+3, y+3, x+w+3, y+h+3, fill="#0A0A12", outline="")

        # Window body
        c.create_rectangle(x, y, x+w, y+h, fill=win.bg, outline="#313244", width=1)

        # Title bar
        if win.focused:
            title_bg = "#45475A"
        else:
            title_bg = "#313244"
        c.create_rectangle(x, y, x+w, y+th, fill=title_bg, outline="")

        # Traffic lights
        c.create_oval(x+12, y+10, x+22, y+20, fill="#F38BA8", outline="")
        c.create_oval(x+28, y+10, x+38, y+20, fill="#F9E2AF", outline="")
        c.create_oval(x+44, y+10, x+54, y+20, fill="#A6E3A1", outline="")

        # Title text
        c.create_text(x + w//2, y + th//2, text=win.title,
                      fill="#CDD6F4", font=("Segoe UI", 10, "bold"))

        # Render app content
        if win.app and hasattr(win.app, 'render'):
            win.app.render(c, x, y + th, w, h - th)
