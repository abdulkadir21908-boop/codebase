"""Finder (file manager) app."""


class FinderApp:
    def __init__(self, fs=None):
        self.fs = fs
        self.items = []
        self.selected = -1
        self.scroll = 0
        self.path = "/"

    def _refresh(self):
        if self.fs:
            self.items = self.fs.ls()
            self.path = self.fs.pwd()

    def on_open(self):
        self._refresh()

    def render(self, canvas, x, y, w, h):
        canvas.create_rectangle(x, y, x+w, y+h, fill="#181825", outline="")

        # Path bar
        canvas.create_rectangle(x, y, x+w, y+28, fill="#313244", outline="")
        canvas.create_text(x+10, y+14, text=self.path, fill="#CDD6F4",
                           anchor="w", font=("Segoe UI", 10))

        # Toolbar buttons
        bx = x + w - 80
        canvas.create_rectangle(bx, y+4, bx+35, y+24, fill="#45475A", outline="#585B70")
        canvas.create_text(bx+17, y+14, text="Back", fill="#CDD6F4", font=("Segoe UI", 9))
        canvas.create_rectangle(bx+40, y+4, bx+75, y+24, fill="#45475A", outline="#585B70")
        canvas.create_text(bx+57, y+14, text="Home", fill="#CDD6F4", font=("Segoe UI", 9))

        # File list
        ly = y + 34
        lh = 26
        for i, item in enumerate(self.items):
            iy = ly + i * lh - self.scroll
            if iy < y + 28 or iy > y + h - lh:
                continue

            bg = "#313244" if i == self.selected else "#1E1E2E"
            canvas.create_rectangle(x, iy, x+w, iy+lh, fill=bg, outline="")

            icon = "\U0001F4C1" if item.is_dir else "\U0001F4C4"
            canvas.create_text(x+10, iy+lh//2, text=icon, anchor="w", font=("Segoe UI Emoji", 11))
            canvas.create_text(x+34, iy+lh//2, text=item.name, fill="#CDD6F4",
                               anchor="w", font=("Segoe UI", 10))
            if not item.is_dir:
                canvas.create_text(x+w-10, iy+lh//2, text=f"{item.size}b",
                                   fill="#6C7086", anchor="e", font=("Segoe UI", 9))

        # Empty state
        if not self.items:
            canvas.create_text(x+w//2, y+h//2, text="Folder is empty",
                               fill="#6C7086", font=("Segoe UI", 12))

    def on_click(self, mx, my, rx, ry):
        if ry < 28:
            # Check toolbar
            return
        ly = ry - 34 + self.scroll
        idx = ly // 26
        if 0 <= idx < len(self.items):
            self.selected = idx
        elif idx == len(self.items):
            self.selected = -1

    def on_double_click(self, mx, my, rx, ry):
        if ry < 28:
            return
        ly = ry - 34 + self.scroll
        idx = ly // 26
        if 0 <= idx < len(self.items) and self.fs:
            item = self.items[idx]
            if item.is_dir:
                self.fs.cd(item.name)
                self._refresh()
                self.selected = -1
                self.scroll = 0

    def on_key(self, key):
        if key == "Up" and self.selected > 0:
            self.selected -= 1
        elif key == "Down" and self.selected < len(self.items) - 1:
            self.selected += 1
        elif key == "Return":
            if 0 <= self.selected < len(self.items) and self.fs:
                item = self.items[self.selected]
                if item.is_dir:
                    self.fs.cd(item.name)
                    self._refresh()
                    self.selected = -1
                    self.scroll = 0
        elif key == "BackSpace":
            if self.fs:
                self.fs.cd("..")
                self._refresh()
                self.selected = -1
                self.scroll = 0
