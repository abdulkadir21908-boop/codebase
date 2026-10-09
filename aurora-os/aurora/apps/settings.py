"""Settings app."""


class SettingsApp:
    def __init__(self):
        self.sections = {
            "System": {"OS Version": "Aurora OS v0.1.0", "Kernel": "AISA-64", "Build": "2026.07.12"},
            "Display": {"Resolution": "80x25", "Color Depth": "16 colors", "Font": "Consolas"},
            "User": {"Username": "user", "Shell": "aurora-sh", "Home": "/home/user"},
            "About": {"Name": "Aurora OS", "Author": "Abdul Kadir", "License": "Open Source"},
        }
        self.selected_section = "System"
        self.sections_list = list(self.sections.keys())

    def render(self, canvas, x, y, w, h):
        canvas.create_rectangle(x, y, x+w, y+h, fill="#181825", outline="")

        # Sidebar
        sw = 140
        canvas.create_rectangle(x, y, x+sw, y+h, fill="#1E1E2E", outline="#313244")

        for i, sec in enumerate(self.sections_list):
            sy = y + 10 + i * 32
            bg = "#45475A" if sec == self.selected_section else "#1E1E2E"
            canvas.create_rectangle(x+5, sy, x+sw-5, sy+26, fill=bg, outline="")
            canvas.create_text(x+sw//2, sy+13, text=sec, fill="#CDD6F4",
                               font=("Segoe UI", 10))

        # Content
        cx = x + sw + 15
        cy = y + 15
        cw = w - sw - 30

        canvas.create_text(cx, cy, text=self.selected_section, fill="#CDD6F4",
                           font=("Segoe UI", 16, "bold"))

        vals = self.sections.get(self.selected_section, {})
        row = 0
        for k, v in vals.items():
            ry = cy + 40 + row * 36
            canvas.create_text(cx, ry, text=k, fill="#89B4FA",
                               anchor="w", font=("Segoe UI", 10))
            canvas.create_text(cx + cw, ry, text=str(v), fill="#CDD6F4",
                               anchor="e", font=("Consolas", 10))
            canvas.create_line(cx, ry+18, cx+cw, ry+18, fill="#313244")
            row += 1

        if not vals:
            canvas.create_text(cx, cy+40, text="No settings available",
                               fill="#6C7086", font=("Segoe UI", 11))

    def on_click(self, mx, my, rx, ry):
        if rx < 140:
            idx = (ry - 10) // 32
            if 0 <= idx < len(self.sections_list):
                self.selected_section = self.sections_list[idx]

    def on_key(self, key):
        pass
