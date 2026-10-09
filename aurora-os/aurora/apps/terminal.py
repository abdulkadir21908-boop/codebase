"""Terminal app - command line interface for Aurora OS."""

import time


class TerminalApp:
    def __init__(self, fs=None):
        self.fs = fs
        self.lines = ["Aurora Terminal v0.1.0", ""]
        self.input_line = ""
        self.cursor = 0
        self.prompt = "$ "
        self.max_lines = 20
        self.selected = False

    def render(self, canvas, x, y, w, h):
        canvas.create_rectangle(x, y, x+w, y+h, fill="#1E1E2E", outline="")

        pad = 10
        line_h = 18
        visible_lines = h // line_h - 1

        all_lines = self.lines + [self.prompt + self.input_line]
        showing = all_lines[-visible_lines:]

        for i, line in enumerate(showing):
            ty = y + pad + i * line_h
            color = "#CDD6F4"
            if line.startswith("ERROR"):
                color = "#F38BA8"
            elif line.startswith("OK:") or line.startswith("Aurora"):
                color = "#A6E3A1"
            elif line.startswith("$"):
                color = "#89B4FA"
            canvas.create_text(x + pad, ty, text=line, fill=color,
                               anchor="w", font=("Consolas", 11))

        # Cursor
        prompt_len = len(self.prompt) + self.cursor
        cur_x = x + pad + prompt_len * 7
        cur_y = y + pad + len(showing) * line_h
        canvas.create_text(x + pad, cur_y,
                           text=self.prompt + self.input_line[:self.cursor] + "|",
                           fill="#89B4FA", anchor="w", font=("Consolas", 11))

    def on_key(self, key):
        if key == "Return":
            self._exec(self.input_line)
            self.input_line = ""
            self.cursor = 0
        elif key == "BackSpace":
            if self.cursor > 0:
                self.input_line = self.input_line[:self.cursor-1] + self.input_line[self.cursor:]
                self.cursor -= 1
        elif key == "Delete":
            if self.cursor < len(self.input_line):
                self.input_line = self.input_line[:self.cursor] + self.input_line[self.cursor+1:]
        elif key == "Left":
            self.cursor = max(0, self.cursor - 1)
        elif key == "Right":
            self.cursor = min(len(self.input_line), self.cursor + 1)
        elif key == "Home":
            self.cursor = 0
        elif key == "End":
            self.cursor = len(self.input_line)
        elif len(key) == 1 and key.isprintable():
            self.input_line = self.input_line[:self.cursor] + key + self.input_line[self.cursor:]
            self.cursor += 1

    def _out(self, text):
        for line in str(text).split("\n"):
            self.lines.append(line)
        if len(self.lines) > 100:
            self.lines = self.lines[-100:]

    def _exec(self, cmd):
        self.lines.append(self.prompt + cmd)
        parts = cmd.strip().split()
        if not parts:
            return
        c = parts[0].lower()
        args = parts[1:]

        if c == "help":
            self._out("Commands: help, ls, cd, pwd, cat, echo, mkdir, rm,")
            self._out("          clear, time, tree, uname, whoami, date")
        elif c == "clear":
            self.lines = []
        elif c == "ls":
            path = args[0] if args else None
            if self.fs:
                items = self.fs.ls(path)
                names = []
                for item in items:
                    n = item.name + "/" if item.is_dir else item.name
                    names.append(n)
                self._out("  ".join(names) if names else "(empty)")
            else:
                self._out("(no filesystem)")
        elif c == "cd":
            if self.fs and args:
                if self.fs.cd(args[0]):
                    pass
                else:
                    self._out("ERROR: directory not found")
            elif self.fs:
                self.fs.cd("/")
        elif c == "pwd":
            if self.fs:
                self._out(self.fs.pwd())
        elif c == "cat":
            if self.fs and args:
                content = self.fs.cat(args[0])
                if content is not None:
                    self._out(content)
                else:
                    self._out("ERROR: file not found")
        elif c == "echo":
            self._out(" ".join(args))
        elif c == "mkdir":
            if self.fs and args:
                if self.fs.mkdir(args[0]):
                    self._out("OK: created")
                else:
                    self._out("ERROR: could not create")
        elif c == "rm":
            if self.fs and args:
                if self.fs.rm(args[0]):
                    self._out("OK: removed")
                else:
                    self._out("ERROR: not found")
        elif c == "time":
            self._out(time.strftime("%H:%M:%S"))
        elif c == "date":
            self._out(time.strftime("%Y-%m-%d %H:%M:%S"))
        elif c == "uname":
            self._out("Aurora OS v0.1.0 (aurora-x86_64)")
        elif c == "whoami":
            self._out("user")
        elif c == "tree":
            if self.fs:
                lines = self.fs.tree(args[0] if args else None)
                for l in lines:
                    self._out(l)
                if not lines:
                    self._out("(empty)")
        elif c == "write":
            if self.fs and len(args) >= 2:
                content = " ".join(args[1:])
                self.fs.write(args[0], content)
                self._out("OK: written")
            else:
                self._out("Usage: write <file> <content>")
        else:
            self._out(f"ERROR: unknown command '{c}'. Type 'help' for commands.")
