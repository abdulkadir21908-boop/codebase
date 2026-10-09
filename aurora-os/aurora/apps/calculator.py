"""Calculator app."""


class CalculatorApp:
    def __init__(self):
        self.display = "0"
        self.expr = ""
        self.last_op = ""
        self.clear_next = False
        self.buttons = [
            ["C", "\u00B1", "%", "\u00F7"],
            ["7", "8", "9", "\u00D7"],
            ["4", "5", "6", "\u2212"],
            ["1", "2", "3", "+"],
            ["0", ".", "00", "="],
        ]

    def render(self, canvas, x, y, w, h):
        canvas.create_rectangle(x, y, x+w, y+h, fill="#1E1E2E", outline="")

        # Display
        canvas.create_rectangle(x+8, y+8, x+w-8, y+58, fill="#11111B", outline="#313244")
        canvas.create_text(x+w-16, y+33, text=self.display, fill="#CDD6F4",
                           anchor="e", font=("Consolas", 22))

        # Buttons
        bw = (w - 40) // 4
        bh = (h - 80) // 5
        colors = {
            "C": "#F38BA8", "\u00B1": "#45475A", "%": "#45475A", "\u00F7": "#89B4FA",
            "\u00D7": "#89B4FA", "\u2212": "#89B4FA", "+": "#89B4FA", "=": "#A6E3A1",
        }

        for row, line in enumerate(self.buttons):
            for col, btn in enumerate(line):
                bx = x + 10 + col * (bw + 7)
                by = y + 65 + row * (bh + 5)
                bg = colors.get(btn, "#313244")
                canvas.create_rectangle(bx, by, bx+bw, by+bh, fill=bg, outline="#585B70")
                fg = "#1E1E2E" if btn in ("C", "=") else "#CDD6F4"
                canvas.create_text(bx+bw//2, by+bh//2, text=btn,
                                   fill=fg, font=("Segoe UI", 14, "bold"))

    def on_click(self, mx, my, rx, ry):
        bw = 0
        bh = 0
        col = -1
        row_idx = -1

        # Calculate button grid position
        btn_w = 100
        btn_h = 45
        start_x = 10
        start_y = 65

        if ry >= start_y:
            col = (rx - start_x) // (btn_w + 7)
            row_idx = (ry - start_y) // (btn_h + 5)

        if 0 <= row_idx < 5 and 0 <= col < 4:
            btn = self.buttons[row_idx][col]
            self._press(btn)

    def _press(self, btn):
        if btn in "0123456789":
            if self.clear_next or self.display == "0":
                self.display = btn
                self.clear_next = False
            else:
                self.display += btn
        elif btn == ".":
            if self.clear_next:
                self.display = "0."
                self.clear_next = False
            elif "." not in self.display:
                self.display += "."
        elif btn == "C":
            self.display = "0"
            self.expr = ""
            self.clear_next = False
        elif btn in ("\u00F7", "\u00D7", "+", "\u2212", "%"):
            self.expr = self.display + " " + btn + " "
            self.clear_next = True
        elif btn == "=":
            self._calc()
        elif btn == "\u00B1":
            if self.display.startswith("-"):
                self.display = self.display[1:]
            elif self.display != "0":
                self.display = "-" + self.display

    def _calc(self):
        try:
            expr = self.expr + self.display
            expr = expr.replace("\u00D7", "*").replace("\u00F7", "/").replace("\u2212", "-")
            result = eval(expr, {"__builtins__": {}}, {})
            if isinstance(result, float) and result == int(result):
                self.display = str(int(result))
            else:
                self.display = f"{result:.8g}"
            self.expr = ""
            self.clear_next = True
        except Exception:
            self.display = "ERROR"
            self.clear_next = True
