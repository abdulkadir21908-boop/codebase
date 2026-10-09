"""Aurora OS - Real shell: built-ins + PowerShell passthrough."""

import os
import re
import sys
import fnmatch
import time
import subprocess


class Shell:
    def __init__(self, fs):
        self.fs = fs
        self.env = {
            "HOME": "/home/user",
            "USER": os.getenv("USERNAME", "user"),
            "SHELL": "bash",
            "TERM": "aurora-term",
            "PATH": os.getenv("PATH", ""),
            "HOSTNAME": os.getenv("COMPUTERNAME", "aurora"),
            "LANG": "en_US.UTF-8",
            "EDITOR": "nano",
        }
        self.aliases = {
            "ll": "ls -la",
            "la": "ls -a",
            "..": "cd ..",
            "...": "cd ../..",
            "cls": "clear",
        }
        self.history = []
        self.last_exit_code = 0
        self._real_cwd = os.path.expanduser("~")

    def execute(self, line):
        line = line.strip()
        if not line:
            return ""

        self.history.append(line)

        line = self._expand_vars(line)
        line = self._expand_aliases(line)

        commands = self._split_chain(line)
        output = ""
        for cmd in commands:
            cmd = cmd.strip()
            if not cmd:
                continue
            result = self._run_pipeline(cmd)
            if output and result:
                output += "\n"
            output += result
            if result.startswith("__EXIT__:"):
                code = int(result.split(":")[1])
                self.last_exit_code = code
                if "&&" in line and code != 0:
                    break

        return output.rstrip("\n")

    def _expand_vars(self, line):
        in_single = False
        in_double = False
        result = []
        i = 0
        while i < len(line):
            ch = line[i]
            if ch == "'" and not in_double:
                in_single = not in_single
                result.append(ch)
            elif ch == '"' and not in_single:
                in_double = not in_double
                result.append(ch)
            elif ch == '$' and not in_single:
                i += 1
                if i < len(line) and line[i] == '{':
                    i += 1
                    end = line.find('}', i)
                    if end == -1:
                        end = len(line)
                    varname = line[i:end]
                    i = end + 1
                    result.append(self.env.get(varname, ""))
                else:
                    varname = ""
                    while i < len(line) and (line[i].isalnum() or line[i] == '_'):
                        varname += line[i]
                        i += 1
                    result.append(self.env.get(varname, ""))
                continue
            else:
                result.append(ch)
            i += 1
        return "".join(result)

    def _expand_aliases(self, line):
        parts = line.split(None, 1)
        if parts and parts[0] in self.aliases:
            return self.aliases[parts[0]] + (" " + parts[1] if len(parts) > 1 else "")
        return line

    def _split_chain(self, line):
        tokens = []
        current = ""
        in_sq = False
        in_dq = False
        i = 0
        while i < len(line):
            ch = line[i]
            if ch == "'" and not in_dq:
                in_sq = not in_sq
                current += ch
            elif ch == '"' and not in_sq:
                in_dq = not in_dq
                current += ch
            elif not in_sq and not in_dq:
                if ch == ';' or (ch == '&' and i + 1 < len(line) and line[i + 1] == '&'):
                    tokens.append(current)
                    current = ""
                    i += 2 if ch == '&' else 1
                    continue
                elif ch == '\\' and i + 1 < len(line):
                    current += line[i + 1]
                    i += 2
                    continue
            current += ch
            i += 1
        if current.strip():
            tokens.append(current)
        return tokens

    def _run_pipeline(self, cmd):
        segments = self._split_pipe(cmd)
        if len(segments) == 1:
            return self._run_single(segments[0].strip())

        stdin_data = ""
        for seg in segments:
            seg = seg.strip()
            redirect = self._parse_redirect(seg)
            if redirect:
                seg = redirect["cmd"]
            output = self._run_single(seg, stdin_data)
            if redirect:
                self._do_redirect(redirect, output)
                output = ""
            stdin_data = output
        return stdin_data

    def _split_pipe(self, cmd):
        parts = []
        current = ""
        in_sq = False
        in_dq = False
        i = 0
        while i < len(cmd):
            ch = cmd[i]
            if ch == "'" and not in_dq:
                in_sq = not in_sq
            elif ch == '"' and not in_sq:
                in_dq = not in_dq
            elif ch == '|' and not in_sq and not in_dq:
                parts.append(current)
                current = ""
                i += 1
                continue
            current += ch
            i += 1
        parts.append(current)
        return parts

    def _parse_redirect(self, cmd):
        in_sq = False
        in_dq = False
        for i, ch in enumerate(cmd):
            if ch == "'" and not in_dq:
                in_sq = not in_sq
            elif ch == '"' and not in_sq:
                in_dq = not in_dq
            elif not in_sq and not in_dq:
                if ch == '>' and i + 1 < len(cmd) and cmd[i + 1] == '>':
                    return {"cmd": cmd[:i].strip(), "file": cmd[i + 2:].strip(), "append": True}
                elif ch == '>' and (i == 0 or cmd[i - 1] != '2'):
                    return {"cmd": cmd[:i].strip(), "file": cmd[i + 1:].strip(), "append": False}
        return None

    def _do_redirect(self, redirect, content):
        path = redirect["file"]
        node = self.fs._resolve(path)
        if node and not node.is_dir:
            if redirect["append"]:
                existing = node.read_text()
                node.write(existing + content + "\n")
            else:
                node.write(content + "\n")
        else:
            self.fs.write(path, content + "\n")

    def _parse_args(self, cmd):
        args = []
        current = ""
        in_sq = False
        in_dq = False
        i = 0
        while i < len(cmd):
            ch = cmd[i]
            if ch == "'" and not in_dq:
                in_sq = not in_sq
            elif ch == '"' and not in_sq:
                in_dq = not in_dq
            elif ch == '\\' and not in_sq and i + 1 < len(cmd):
                current += cmd[i + 1]
                i += 2
                continue
            elif ch in (' ', '\t') and not in_sq and not in_dq:
                if current:
                    args.append(current)
                    current = ""
            else:
                current += ch
            i += 1
        if current:
            args.append(current)
        return args

    def _glob(self, pattern):
        node = self.fs.cwd
        if '/' in pattern:
            parts = pattern.rsplit('/', 1)
            dir_node = self.fs._resolve(parts[0])
            pat = parts[1]
            if dir_node and dir_node.is_dir:
                node = dir_node
            else:
                return [pattern]
        else:
            pat = pattern

        if not node or not node.is_dir:
            return [pattern]

        matches = []
        for name in sorted(node.children.keys()):
            if fnmatch.fnmatch(name, pat):
                if '/' in pattern:
                    matches.append(pattern.rsplit('/', 1)[0] + '/' + name)
                else:
                    matches.append(name)
        return matches if matches else [pattern]

    def _run_single(self, cmd, stdin_data=""):
        cmd = cmd.strip()
        if not cmd:
            return ""

        args = self._parse_args(cmd)
        if not args:
            return ""

        # Handle output redirection in the command
        actual_args = []
        redirect = None
        i = 0
        while i < len(args):
            if args[i] == '>' and i + 1 < len(args):
                redirect = {"file": args[i + 1], "append": False}
                i += 2
            elif args[i] == '>>' and i + 1 < len(args):
                redirect = {"file": args[i + 1], "append": True}
                i += 2
            elif args[i].endswith('>') and len(args[i]) > 1 and not args[i].startswith('2'):
                redirect = {"file": args[i][:-1], "append": False}
                i += 1
            elif args[i].startswith('2>') and len(args[i]) > 2:
                i += 1
            else:
                actual_args.append(args[i])
                i += 1

        args = actual_args
        name = args[0]
        argv = args[1:]

        builtins = {
            "cd": self._cd, "pwd": self._pwd, "ls": self._ls, "cat": self._cat,
            "echo": self._echo, "mkdir": self._mkdir, "rm": self._rm,
            "touch": self._touch, "cp": self._cp, "mv": self._mv,
            "clear": self._clear, "help": self._help,
            "export": self._export, "env": self._env, "unset": self._unset,
            "history": self._history, "alias": self._alias, "unalias": self._unalias,
            "grep": self._grep, "wc": self._wc, "head": self._head, "tail": self._tail,
            "sort": self._sort, "uniq": self._uniq, "rev": self._rev,
            "find": self._find, "which": self._which, "type": self._type_cmd,
            "date": self._date, "time_cmd": self._time_cmd, "uname": self._uname,
            "whoami": self._whoami, "hostname": self._hostname,
            "tree": self._tree, "chmod": self._chmod, "ps": self._ps,
            "man": self._man, "true": lambda a: "", "false": lambda a: "__EXIT__:1",
            "yes": self._yes, "seq": self._seq, "sleep": self._sleep,
            "neofetch": self._neofetch, "screenfetch": self._neofetch,
        }

        if name in builtins:
            result = builtins[name](argv)
            if stdin_data and name not in ("cat", "echo"):
                result = self._apply_stdin(name, argv, stdin_data)
        elif name == "test" or name == "[":
            result = self._test(args[1:])
        elif name == "exit":
            return "__EXIT__:0"
        else:
            result = self._run_real_cmd(cmd)
            if redirect:
                self._do_redirect(redirect, result)
                return ""
            return result

        if redirect:
            self._do_redirect(redirect, result)
            return ""

        self.last_exit_code = 0
        return result

    def _run_real_cmd(self, line):
        """Execute a real system command via bash."""
        bash_exe = None
        for p in [
            r"C:\Users\Abdul Kadir\AppData\Local\hermes\git\bin\bash.exe",
            "bash", "C:\\Program Files\\Git\\bin\\bash.exe",
        ]:
            if os.path.isfile(p):
                bash_exe = p
                break
        if not bash_exe:
            bash_exe = "powershell"
        try:
            if bash_exe.endswith("bash.exe"):
                cmd = [bash_exe, "--noprofile", "--norc", "-c", line]
            else:
                cmd = [bash_exe, "-NoProfile", "-Command", line]
            result = subprocess.run(
                cmd,
                capture_output=True, text=True, timeout=30,
                cwd=self._real_cwd,
                encoding="utf-8", errors="replace",
                env={**os.environ, **self.env}
            )
            self.last_exit_code = result.returncode
            output = result.stdout
            if result.stderr:
                if output:
                    output += "\n"
                output += result.stderr
            return output.rstrip("\n")
        except subprocess.TimeoutExpired:
            self.last_exit_code = 124
            return "command timed out after 30s"
        except Exception as e:
            self.last_exit_code = 1
            return "aurora-sh: " + str(e)

    def _apply_stdin(self, name, argv, stdin_data):
        if name == "grep":
            return self._grep(argv, stdin_data)
        elif name == "wc":
            return self._wc(argv, stdin_data)
        elif name == "head":
            return self._head(argv, stdin_data)
        elif name == "tail":
            return self._tail(argv, stdin_data)
        elif name == "sort":
            return self._sort(argv, stdin_data)
        elif name == "uniq":
            return self._uniq(argv, stdin_data)
        elif name == "rev":
            return self._rev(argv, stdin_data)
        return self._run_single(name + " " + " ".join(argv))

    def _cd(self, args):
        target = args[0] if args else self.env.get("HOME", "/")
        if target == "-":
            old = self.env.get("OLDPWD", self.fs.pwd())
            self.env["OLDPWD"] = self.fs.pwd()
            if self.fs.cd(old):
                self._sync_real_cwd()
                return self.fs.pwd()
            return "aurora-sh: cd: " + target + ": no such directory"
        if target.startswith("~"):
            target = self.env.get("HOME", "/home/user") + target[1:]
        self.env["OLDPWD"] = self.fs.pwd()
        if self.fs.cd(target):
            self._sync_real_cwd()
            return ""
        return "aurora-sh: cd: " + target + ": no such directory"

    def _sync_real_cwd(self):
        path = self.fs.pwd()
        real = os.path.expanduser("~")
        if path.startswith("/home/user"):
            real = os.path.join(os.path.expanduser("~"), path[len("/home/user"):].lstrip("/"))
        if os.path.isdir(real):
            self._real_cwd = real

    def _pwd(self, args):
        return self.fs.pwd()

    def _ls(self, args, stdin_data=None):
        show_all = False
        long_format = False
        paths = []
        for a in args:
            if a.startswith("-"):
                if 'a' in a:
                    show_all = True
                if 'l' in a:
                    long_format = True
            else:
                paths.append(a)

        if not paths:
            paths = ["."]

        output_lines = []
        for path in paths:
            node = self.fs._resolve(path)
            if not node:
                output_lines.append("ls: cannot access '" + path + "': No such file or directory")
                continue
            if not node.is_dir:
                if long_format:
                    output_lines.append(self._ls_long_entry(node))
                else:
                    output_lines.append(node.name)
                continue

            items = sorted(node.children.values(), key=lambda n: (not n.is_dir, n.name))
            if not show_all:
                items = [i for i in items if not i.name.startswith(".")]

            if long_format:
                output_lines.append("total " + str(len(items)))
                for item in items:
                    output_lines.append(self._ls_long_entry(item))
            else:
                names = []
                for item in items:
                    names.append(item.name + ("/" if item.is_dir else ""))
                output_lines.append("  ".join(names))

        return "\n".join(output_lines)

    def _ls_long_entry(self, node):
        perm = "drwxr-xr-x" if node.is_dir else "-rw-r--r--"
        size = str(node.size).rjust(6)
        ts = time.strftime("%b %d %H:%M", time.localtime(node.modified))
        name = node.name + ("/" if node.is_dir else "")
        return perm + "  1 user user " + size + " " + ts + " " + name

    def _cat(self, args, stdin_data=None):
        if stdin_data and not args:
            return stdin_data
        if not args:
            return "usage: cat <file> ..."
        outputs = []
        for path in args:
            content = self.fs.cat(path)
            if content is not None:
                outputs.append(content)
            else:
                outputs.append("cat: " + path + ": No such file or directory")
                self.last_exit_code = 1
        return "\n".join(outputs)

    def _echo(self, args):
        return " ".join(args)

    def _mkdir(self, args):
        if not args:
            return "usage: mkdir <directory> ..."
        results = []
        for path in args:
            if self.fs.mkdir(path):
                results.append("")
            else:
                results.append("mkdir: cannot create directory '" + path + "'")
                self.last_exit_code = 1
        return "\n".join(results)

    def _rm(self, args):
        recursive = False
        paths = []
        for a in args:
            if a == "-r" or a == "-rf" or a == "-fr":
                recursive = True
            elif a.startswith("-") and 'r' in a:
                recursive = True
            else:
                paths.append(a)
        if not paths:
            return "usage: rm [-r] <file> ..."
        results = []
        for path in paths:
            node = self.fs._resolve(path)
            if not node:
                results.append("rm: cannot remove '" + path + "': No such file or directory")
                self.last_exit_code = 1
            elif node.is_dir and not recursive:
                results.append("rm: cannot remove '" + path + "': Is a directory")
                self.last_exit_code = 1
            else:
                self.fs.rm(path)
        return "\n".join(results)

    def _touch(self, args):
        if not args:
            return "usage: touch <file> ..."
        for path in args:
            node = self.fs._resolve(path)
            if not node:
                self.fs.write(path, "")
        return ""

    def _cp(self, args):
        if len(args) < 2:
            return "usage: cp <source> <dest>"
        src = args[0]
        dst = args[1]
        content = self.fs.cat(src)
        if content is None:
            return "cp: cannot stat '" + src + "': No such file or directory"
        dst_node = self.fs._resolve(dst)
        if dst_node and dst_node.is_dir:
            name = src.rsplit("/", 1)[-1]
            dst = dst.rstrip("/") + "/" + name
        self.fs.write(dst, content)
        return ""

    def _mv(self, args):
        if len(args) < 2:
            return "usage: mv <source> <dest>"
        result = self._cp(args)
        if not result:
            self.fs.rm(args[0])
        return result

    def _clear(self, args):
        return "__CLEAR__"

    def _help(self, args):
        return (
            "Aurora Shell v1.0\n\n"
            "FILE SYSTEM:  ls, cd, pwd, cat, mkdir, rm, touch, cp, mv, find, tree, chmod\n"
            "TEXT:         echo, grep, wc, head, tail, sort, uniq, rev\n"
            "SYSTEM:       whoami, hostname, uname, date, ps, man, which, type\n"
            "SHELL:        export, env, unset, alias, unalias, history, clear, help\n"
            "UTILITIES:    neofetch, screenfetch, sleep, yes, seq\n"
            "OPERATORS:    | (pipe), > (redirect), >> (append), ; or && (chain)\n"
            "VARIABLES:    $VAR, ${VAR}\n"
            "SHORTCUTS:    Ctrl+L (clear), Tab (complete), Ctrl+C (cancel)\n"
            "Use 'man <cmd>' for details on a command."
        )

    def _export(self, args):
        for arg in args:
            if '=' in arg:
                k, v = arg.split('=', 1)
                self.env[k] = v
            else:
                if arg in self.env:
                    print(self.env[arg])
        return ""

    def _env(self, args):
        return "\n".join(k + "=" + v for k, v in sorted(self.env.items()))

    def _unset(self, args):
        for k in args:
            self.env.pop(k, None)
        return ""

    def _history(self, args):
        lines = []
        for i, cmd in enumerate(self.history):
            lines.append(str(i + 1).rjust(4) + "  " + cmd)
        return "\n".join(lines)

    def _alias(self, args):
        if not args:
            return "\n".join(k + "='" + v + "'" for k, v in sorted(self.aliases.items()))
        for arg in args:
            if '=' in arg:
                k, v = arg.split('=', 1)
                self.aliases[k] = v.strip("'\"")
        return ""

    def _unalias(self, args):
        for k in args:
            self.aliases.pop(k, None)
        return ""

    def _grep(self, args, stdin_data=None):
        ignore_case = False
        invert = False
        show_line = False
        count_only = False
        pattern = None
        files = []

        for a in args:
            if a.startswith("-"):
                if 'i' in a:
                    ignore_case = True
                if 'v' in a:
                    invert = True
                if 'n' in a:
                    show_line = True
                if 'c' in a:
                    count_only = True
            elif pattern is None:
                pattern = a
            else:
                files.append(a)

        if pattern is None:
            return "usage: grep [-invn] <pattern> [file] ..."

        flags = re.IGNORECASE if ignore_case else 0
        try:
            regex = re.compile(pattern, flags)
        except re.error:
            return "grep: invalid pattern"

        lines = []
        if stdin_data:
            lines = stdin_data.split("\n")
        elif files:
            for f in files:
                content = self.fs.cat(f)
                if content is None:
                    return "grep: " + f + ": No such file or directory"
                for line in content.split("\n"):
                    lines.append(f + ":" + line if len(files) > 1 else line)
        else:
            return "usage: grep [-invn] <pattern> [file] ..."

        results = []
        count = 0
        for i, line in enumerate(lines):
            match = bool(regex.search(line))
            if invert:
                match = not match
            if match:
                count += 1
                if not count_only:
                    if show_line:
                        results.append(str(i + 1) + ":" + line)
                    else:
                        results.append(line)

        if count_only:
            return str(count)
        return "\n".join(results)

    def _wc(self, args, stdin_data=None):
        show_lines = True
        show_words = True
        show_chars = True
        files = []

        for a in args:
            if a.startswith("-"):
                if 'l' in a:
                    pass
                elif 'w' in a:
                    pass
                elif 'c' in a:
                    pass
                else:
                    show_lines = show_words = show_chars = True
            else:
                files.append(a)

        text = stdin_data
        if files:
            text = ""
            for f in files:
                content = self.fs.cat(f)
                if content is not None:
                    text += content + "\n"

        if text is None:
            return "wc: missing operand"

        parts = []
        if show_lines:
            parts.append(str(len(text.split("\n"))))
        if show_words:
            parts.append(str(len(text.split())))
        if show_chars:
            parts.append(str(len(text)))

        result = "  ".join(parts)
        if files:
            result += " " + " ".join(files)
        return result

    def _head(self, args, stdin_data=None):
        n = 10
        files = []
        i = 0
        while i < len(args):
            if args[i] == "-n" and i + 1 < len(args):
                n = int(args[i + 1])
                i += 2
            elif args[i].startswith("-") and args[i][1:].isdigit():
                n = int(args[i][1:])
                i += 1
            else:
                files.append(args[i])
                i += 1

        text = stdin_data
        if files:
            text = self.fs.cat(files[0])
            if text is None:
                return "head: " + files[0] + ": No such file or directory"

        if text is None:
            return ""
        return "\n".join(text.split("\n")[:n])

    def _tail(self, args, stdin_data=None):
        n = 10
        files = []
        i = 0
        while i < len(args):
            if args[i] == "-n" and i + 1 < len(args):
                n = int(args[i + 1])
                i += 2
            elif args[i].startswith("-") and args[i][1:].isdigit():
                n = int(args[i][1:])
                i += 1
            else:
                files.append(args[i])
                i += 1

        text = stdin_data
        if files:
            text = self.fs.cat(files[0])
            if text is None:
                return "tail: " + files[0] + ": No such file or directory"

        if text is None:
            return ""
        lines = text.split("\n")
        return "\n".join(lines[-n:])

    def _sort(self, args, stdin_data=None):
        reverse = False
        numeric = False
        files = []
        for a in args:
            if a.startswith("-"):
                if 'r' in a:
                    reverse = True
                if 'n' in a:
                    numeric = True
            else:
                files.append(a)

        text = stdin_data
        if files:
            text = self.fs.cat(files[0])
            if text is None:
                return "sort: " + files[0] + ": No such file or directory"

        if text is None:
            return ""
        lines = text.split("\n")
        if numeric:
            lines.sort(key=lambda x: float(x) if x.replace('.','').replace('-','').isdigit() else 0, reverse=reverse)
        else:
            lines.sort(reverse=reverse)
        return "\n".join(lines)

    def _uniq(self, args, stdin_data=None):
        count_mode = False
        files = []
        for a in args:
            if a == "-c":
                count_mode = True
            elif not a.startswith("-"):
                files.append(a)

        text = stdin_data
        if files:
            text = self.fs.cat(files[0])
            if text is None:
                return "uniq: " + files[0] + ": No such file or directory"

        if text is None:
            return ""
        lines = text.split("\n")
        result = []
        prev = None
        cnt = 0
        for line in lines:
            if line == prev:
                cnt += 1
            else:
                if prev is not None:
                    if count_mode:
                        result.append(str(cnt).rjust(7) + " " + prev)
                    else:
                        result.append(prev)
                prev = line
                cnt = 1
        if prev is not None:
            if count_mode:
                result.append(str(cnt).rjust(7) + " " + prev)
            else:
                result.append(prev)
        return "\n".join(result)

    def _rev(self, args, stdin_data=None):
        text = stdin_data
        if args:
            text = self.fs.cat(args[0])
        if text is None:
            return ""
        return "\n".join(line[::-1] for line in text.split("\n"))

    def _find(self, args):
        start = "."
        name_pattern = None
        type_filter = None

        i = 0
        while i < len(args):
            if args[i] == "-name" and i + 1 < len(args):
                name_pattern = args[i + 1]
                i += 2
            elif args[i] == "-type" and i + 1 < len(args):
                type_filter = args[i + 1]
                i += 2
            else:
                start = args[i]
                i += 1

        results = []
        self._find_recursive(start, name_pattern, type_filter, results)
        return "\n".join(results)

    def _find_recursive(self, path, name_pat, type_filter, results):
        node = self.fs._resolve(path)
        if not node:
            return
        display = path if path != "." else node.name if node.name != "/" else "/"
        if node.name != "/" or path == "/":
            if node.name != "/" and path != ".":
                display = path
            else:
                display = path if path.startswith("/") else "./" + node.name

            match_name = True
            if name_pat:
                match_name = fnmatch.fnmatch(node.name, name_pat)
            match_type = True
            if type_filter == "f" and node.is_dir:
                match_type = False
            elif type_filter == "d" and not node.is_dir:
                match_type = False

            if match_name and match_type:
                results.append(display)

        if node.is_dir:
            for child in sorted(node.children.keys()):
                child_path = path.rstrip("/") + "/" + child
                self._find_recursive(child_path, name_pat, type_filter, results)

    def _which(self, args):
        if not args:
            return ""
        name = args[0]
        builtins = ["cd", "pwd", "ls", "cat", "echo", "mkdir", "rm", "touch", "cp", "mv",
                     "clear", "help", "export", "env", "unset", "history", "alias", "grep",
                     "wc", "head", "tail", "sort", "uniq", "find", "date", "uname", "whoami",
                     "tree", "ps", "man"]
        if name in builtins:
            return "aurora-sh: built-in " + name
        return name + " not found"

    def _type_cmd(self, args):
        if not args:
            return ""
        return self._which(args)

    def _date(self, args):
        format_str = None
        for a in args:
            if not a.startswith("-"):
                format_str = a
        if format_str:
            try:
                return time.strftime(format_str)
            except Exception:
                return time.strftime("%Y-%m-%d %H:%M:%S")
        return time.strftime("%a %b %d %H:%M:%S %Y")

    def _time_cmd(self, args):
        return time.strftime("%H:%M:%S")

    def _uname(self, args):
        if args and args[0] == "-a":
            return "Aurora aurora 0.1.0 Aurora-OS aurora-custom-64"
        return "Aurora-OS"

    def _whoami(self, args):
        return self.env.get("USER", "user")

    def _hostname(self, args):
        return self.env.get("HOSTNAME", "aurora")

    def _tree(self, args):
        path = args[0] if args else "."
        node = self.fs._resolve(path)
        if not node or not node.is_dir:
            return "tree: '" + path + "': not a directory"
        lines = self.fs.tree(path if path != "." else None)
        dirs = sum(1 for l in lines if l.rstrip().endswith("/"))
        files = len(lines) - dirs
        output = path + "\n" + "\n".join(lines)
        output += "\n\n" + str(dirs) + " directories, " + str(files) + " files"
        return output

    def _chmod(self, args):
        return ""

    def _ps(self, args):
        lines = ["  PID TTY          TIME CMD"]
        lines.append("    1 ?        00:00:01 aurora-sh")
        lines.append("    2 ?        00:00:00 aurora-kernel")
        lines.append("    3 ?        00:00:00 window-server")
        return "\n".join(lines)

    def _man(self, args):
        if not args:
            return "What manual page do you want?"
        name = args[0]
        pages = {
            "ls": "ls [-la] [path]        List directory contents\n  -a    Show hidden files\n  -l    Long format",
            "cd": "cd [path]              Change directory\n  cd -  Return to previous directory\n  cd ~  Go to home directory",
            "cat": "cat <file> ...         Concatenate and print files",
            "grep": "grep [-invn] <pat> [file]  Search text\n  -i    Ignore case\n  -v    Invert match\n  -n    Show line numbers\n  -c    Count matches",
            "find": "find [path] [-name p] [-type f|d]  Find files\n  -name Pattern (glob)\n  -type f=file, d=directory",
            "echo": "echo [text ...]        Print text\n  Supports $VAR and ${VAR}",
            "mkdir": "mkdir <dir> ...        Create directories",
            "rm": "rm [-r] <file> ...     Remove files\n  -r    Recursive",
            "cp": "cp <src> <dst>         Copy files",
            "mv": "mv <src> <dst>         Move/rename files",
            "sort": "sort [-rn] [file]      Sort lines\n  -r    Reverse\n  -n    Numeric",
            "wc": "wc [file] ...          Word, line, char count",
            "head": "head [-n N] [file]     First N lines (default 10)",
            "tail": "tail [-n N] [file]     Last N lines (default 10)",
            "export": "export VAR=value      Set environment variable",
            "alias": "alias [name='cmd']     Define command alias",
            "history": "history               Show command history",
            "tree": "tree [path]            Display directory tree",
        }
        if name in pages:
            return pages[name]
        return "No manual entry for " + name

    def _yes(self, args):
        char = args[0] if args else "y"
        return (char + "\n") * 100

    def _seq(self, args):
        if len(args) == 1:
            end = int(args[0])
            return "\n".join(str(i) for i in range(1, end + 1))
        elif len(args) == 2:
            start, end = int(args[0]), int(args[1])
            return "\n".join(str(i) for i in range(start, end + 1))
        elif len(args) == 3:
            start, step, end = int(args[0]), int(args[1]), int(args[2])
            return "\n".join(str(i) for i in range(start, end + 1, step))
        return ""

    def _sleep(self, args):
        return ""

    def _neofetch(self, args):
        import platform
        uname = platform.uname()
        try:
            from aurora import sysmon
            cpu = uname.processor or "Unknown"
            mem = sysmon.virtual_memory()
            mem_used = f"{mem.used // (1024*1024)}MiB / {mem.total // (1024*1024)}MiB"
        except Exception:
            cpu = uname.processor or "Unknown"
            mem_used = "N/A"
        user = os.getenv("USERNAME", "user")
        host = os.getenv("COMPUTERNAME", "aurora")
        kernel = uname.release
        try:
            from aurora import sysmon as _sysmon
            uptime_s = time.time() - _sysmon.boot_time()
        except Exception:
            uptime_s = 0
        days = int(uptime_s // 86400)
        hours = int((uptime_s % 86400) // 3600)
        mins = int((uptime_s % 3600) // 60)
        uptime_str = f"{days}d {hours}h {mins}m" if days else f"{hours}h {mins}m"
        logo = (
            "\x1b[1;36m        .-/+oossssoo+/-.        \x1b[0m  \x1b[1;33m" + user + "\x1b[0m@\x1b[1;33m" + host + "\x1b[0m\n"
            "\x1b[1;36m    `:+ssssssssssssssssss+:`    \x1b[0m  \x1b[1;36m──────────────\x1b[0m\n"
            "\x1b[1;36m  -+ssssssssssssssssssyyssss+-  \x1b[0m  \x1b[1;33mOS:\x1b[0m Aurora OS v0.1.0 Dawn\n"
            "\x1b[1;36m .ossssssssssssssssss\x1b[1;37mdMMMNy\x1b[1;36msssso. \x1b[0m  \x1b[1;33mHost:\x1b[0m " + host + "\n"
            "\x1b[1;36m/sssssssssss\x1b[1;37mhdmmNNmmyNMMMMh\x1b[1;36mssss/\x1b[0m  \x1b[1;33mKernel:\x1b[0m " + kernel + "\n"
            "\x1b[1;36m+sssssssss\x1b[1;37mhm\x1b[1;36myd\x1b[1;37mMMMMMMMNddddy\x1b[1;36mssss+\x1b[0m  \x1b[1;33mUptime:\x1b[0m " + uptime_str + "\n"
            "\x1b[1;36m/ssssssss\x1b[1;37mhNMMM\x1b[1;36myh\x1b[1;37mhyyyyhmNMMMNh\x1b[1;36mssss/\x1b[0m  \x1b[1;33mShell:\x1b[0m bash\n"
            "\x1b[1;36m.ssssssss\x1b[1;37mdMMMNh\x1b[1;36mssssssss\x1b[1;37mhNMMMd\x1b[1;36mssss.\x1b[0m  \x1b[1;33mCPU:\x1b[0m " + cpu + "\n"
            "\x1b[1;36m+sssshh\x1b[1;37myNMMNy\x1b[1;36mssssssssss\x1b[1;37myNMMMy\x1b[1;36msss+\x1b[0m  \x1b[1;33mMemory:\x1b[0m " + mem_used + "\n"
            "\x1b[1;36m.ssssss\x1b[1;37mdMMMNh\x1b[1;36mssssssssss\x1b[1;37mhNMMMd\x1b[1;36msss.\x1b[0m\n"
            "\x1b[1;36m+ssssssss\x1b[1;37mNMMMy\x1b[1;36mssssssssss\x1b[1;37myNMMMy\x1b[1;36msss+\x1b[0m  \x1b[1;35m██████████████████\x1b[0m\n"
            "\x1b[1;36m/ssssssssss\x1b[1;37mNMMMy\x1b[1;36mssssssssss\x1b[1;37mhNMMMd\x1b[1;36mssss/\x1b[0m  \x1b[1;31m██████████████████\x1b[0m\n"
            "\x1b[1;36m+sssssssssssssssssssssssssssssssssssss+\x1b[0m  \x1b[1;32m██████████████████\x1b[0m\n"
            "\x1b[1;36m /+ssssssssssssssssssssssssssssssssss/ \x1b[0m  \x1b[1;33m██████████████████\x1b[0m\n"
            "\x1b[1;36m  .ossssssssssssssssssssssssss+.     \x1b[0m  \x1b[1;34m██████████████████\x1b[0m\n"
            "\x1b[1;36m    -+sssssssssssssssssss+-       \x1b[0m  \x1b[1;35m██████████████████\x1b[0m\n"
            "\x1b[1;36m       `:+ssssssssssss+:`         \x1b[0m\n"
        )
        return logo

    def _test(self, args):
        return ""

    def get_completions(self, partial):
        commands = [
            "ls", "cd", "pwd", "cat", "echo", "mkdir", "rm", "touch", "cp", "mv",
            "clear", "help", "export", "env", "unset", "history", "alias", "unalias",
            "grep", "wc", "head", "tail", "sort", "uniq", "rev", "find", "which",
            "type", "date", "uname", "whoami", "hostname", "tree", "chmod", "ps",
            "man", "exit", "true", "false", "seq", "neofetch", "screenfetch",
            "dir", "cmd", "powershell", "Get-Process", "Get-ChildItem", "Get-Content",
            "pip", "python", "node", "npm", "git", "curl", "wget",
        ]

        parts = partial.rsplit(None, 1)
        if len(parts) < 2:
            return sorted([c for c in commands if c.startswith(partial)])

        prefix = parts[0] + " "
        file_part = parts[1]

        if "/" in file_part:
            dir_path = file_part.rsplit("/", 1)[0]
            name_part = file_part.rsplit("/", 1)[1]
            node = self.fs._resolve(dir_path)
        else:
            dir_path = None
            name_part = file_part
            node = self.fs.cwd

        if not node or not node.is_dir:
            return []

        completions = []
        for name in sorted(node.children.keys()):
            if name.startswith(name_part):
                child = node.get_child(name)
                entry = name + ("/" if child and child.is_dir else "")
                if dir_path:
                    completions.append(prefix + dir_path + "/" + entry)
                else:
                    completions.append(prefix + entry)

        return completions
