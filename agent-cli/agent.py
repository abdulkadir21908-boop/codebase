#!/usr/bin/env python3
"""oagent - tiny Ollama-native coding agent CLI. Stdlib only, no dependencies.

Usage:
  python agent.py [--project NAME] [--model NAME] [--yes]
  python agent.py --once "task description" [--project NAME]   (headless, for subagents/CI)
  python agent.py --help

Slash commands (the necessary ones, nothing more):
  /read <path>      print a file (confined to project root)
  /write <path>     write a file (multiline, end with a single '.')
  /edit <path>      replace text (prompts for old, then new, end each with '.')
  /list [dir]       list directory contents
  /run <cmd>        run a shell command (asks first, unless --yes)
  /test [cmd]       run tests (auto-detects pytest/npm, or runs given cmd)
  /remember <fact>  save to project memory (auto-loaded every session)
  /recall [word]    search project + global memory
  /agent <task>     spawn a subagent (headless run, returns its result)
  /agents           show subagent history this session
  /projects         list projects
  /use <name>       switch/create project (a directory under projects/)
  /mode [chat|agent]  chat = plain text talk, agent = uses tools (default: agent)
  /model [name]     show/set model
  /status           model, RAM, project, memory lines
  /unload           unload the model from RAM
  /clear            clear conversation
  /help             this list
  /quit             exit

Free text goes to the model. The model can use tools by emitting lines like:
  !tool {"op": "read", "path": "main.py"}
ops: read, list, run, write (needs "content"), edit (needs "old","new").
Tool output is fed back automatically until it answers (max rounds in config).
"""
import datetime
import json
import os
import re
import shlex
import subprocess
import sys
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE, "config.json")
PROJECTS_DIR = os.path.join(BASE, "projects")
GLOBAL_MEM = os.path.join(BASE, "MEMORY.md")

DEFAULT_CONFIG = {
    "model": "granite3.1-moe:3b",
    "host": "http://localhost:11434",
    "num_ctx": 32768,
    "num_predict": 1024,
    "temperature": 0.6,
    "keep_alive": "10m",
    "max_rounds": 6,
}

SYSTEM = (
    "You are oagent, a concise coding assistant running on a small local model. "
    "Be direct. No flattery, no long introductions. "
    "Use the provided tools to act on files and shell instead of describing actions. "
    "After tool results arrive, continue or give the final answer. "
    "Never claim a tool ran unless its result is shown. Keep answers short."
)

CHAT_SYSTEM = (
    "You are a helpful assistant talking with the user. Answer directly in plain text. "
    "No tools, no code unless asked. Short answers unless they ask for detail."
)

TOOLS = [
    {"type": "function", "function": {
        "name": "read", "description": "Read a file (path relative to project root).",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}},
                       "required": ["path"]}}},
    {"type": "function", "function": {
        "name": "list", "description": "List a directory (relative to project root).",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}}},
    {"type": "function", "function": {
        "name": "run", "description": "Run a shell command in the project root.",
        "parameters": {"type": "object", "properties": {"cmd": {"type": "string"}},
                       "required": ["cmd"]}}},
    {"type": "function", "function": {
        "name": "write", "description": "Write content to a file (path relative to project root).",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                       "required": ["path", "content"]}}},
    {"type": "function", "function": {
        "name": "edit", "description": "Replace first occurrence of old text with new text in a file.",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "old": {"type": "string"}, "new": {"type": "string"}},
                       "required": ["path", "old", "new"]}}},
]


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        try:
            cfg.update(json.load(open(CONFIG_PATH)))
        except Exception as e:
            print(f"[warn] bad config.json: {e}")
    return cfg


def api(cfg, path, payload=None, timeout=600):
    url = cfg["host"] + path
    if payload is None:
        req = urllib.request.Request(url, method="GET")
    else:
        data = json.dumps(payload).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def api_stream(cfg, payload, on_token, timeout=600):
    url = cfg["host"] + "/api/chat"
    payload = dict(payload, stream=True)
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    buf = ""
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            chunk = obj.get("message", {}).get("content", "")
            if chunk:
                buf += chunk
                on_token(chunk)
            if obj.get("done"):
                return buf, obj
    return buf, {}


def mem_path(project):
    return os.path.join(PROJECTS_DIR, project, "MEMORY.md")


def mem_tail(project, path, limit=40):
    lines = []
    for p in (GLOBAL_MEM, mem_path(project)):
        if p and os.path.exists(p):
            lines += open(p, encoding="utf-8", errors="replace").read().splitlines()[-limit:]
    void = [l for l in lines if l.strip()]
    return "\n".join(void[-limit:])


def safe_path(root, p):
    full = os.path.normpath(os.path.join(root, p or "."))
    if os.path.commonpath([root, full]) != root:
        raise ValueError("path escapes project root")
    return full


def do_tool(cfg, root, call, confirm_run, sub_depth=0):
    op = call.get("op")
    try:
        if op == "read":
            p = safe_path(root, call["path"])
            return open(p, encoding="utf-8", errors="replace").read()[:20000]
        if op == "list":
            p = safe_path(root, call.get("path", "."))
            out = []
            for e in sorted(os.listdir(p)):
                fp = os.path.join(p, e)
                out.append(e + ("/" if os.path.isdir(fp) else f" ({os.path.getsize(fp)}B)"))
            return "\n".join(out) or "(empty)"
        if op == "run":
            cmd = call["cmd"]
            if confirm_run:
                ans = input(f"run `{cmd}`? [y/N] ").strip().lower()
                if ans not in ("y", "yes"):
                    return "(cancelled by user)"
            pr = subprocess.run(cmd, shell=True, cwd=root, capture_output=True,
                                text=True, timeout=300)
            out = (pr.stdout + pr.stderr)[-8000:]
            return f"[exit {pr.returncode}]\n" + (out or "(no output)")
        if op == "write":
            p = safe_path(root, call["path"])
            os.makedirs(os.path.dirname(p) or root, exist_ok=True)
            open(p, "w", encoding="utf-8").write(call.get("content", ""))
            return f"wrote {call['path']} ({len(call.get('content',''))} chars)"
        if op == "edit":
            p = safe_path(root, call["path"])
            s = open(p, encoding="utf-8", errors="replace").read()
            if call["old"] not in s:
                return "ERROR: old text not found"
            open(p, "w", encoding="utf-8").write(s.replace(call["old"], call.get("new", ""), 1))
            return f"edited {call['path']}"
        return f"ERROR: unknown op {op!r}"
    except Exception as e:
        return f"ERROR: {e}"


def extract_tools(text):
    calls, rest = [], []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("!tool "):
            try:
                calls.append(json.loads(s[6:]))
                continue
            except Exception:
                pass
        m = None
        for op in ("list", "read"):
            if s == "!" + op or s.startswith("!" + op + " "):
                arg = s[len(op) + 1:].strip()
                arg = re.sub(r"\s*//.*$", "", arg).strip()
                m = {"op": op, "path": arg or "."}
        if m is None and (s == "!run" or s.startswith("!run ")):
            cmd = re.sub(r"\s*//.*$", "", s[4:]).strip()
            m = {"op": "run", "cmd": cmd}
        if m is None and s.startswith("!write "):
            restw = re.sub(r"\s*//.*$", "", s[7:]).strip()
            qm = re.match(r'^"([^"]+)"\s+(\S+)\s*$', restw)
            if qm:
                m = {"op": "write", "content": qm.group(1).replace("\\n", "\n"), "path": qm.group(2)}
            else:
                qm = re.match(r'^(\S+)\s+"([^"]+)"\s*$', restw)
                if qm:
                    m = {"op": "write", "path": qm.group(1), "content": qm.group(2).replace("\\n", "\n")}
                elif "::" in restw:
                    p, c = restw.split("::", 1)
                    m = {"op": "write", "path": p.strip(), "content": c.strip().replace("\\n", "\n")}
        if m is not None:
            calls.append(m)
            continue
        rest.append(line)
    return calls, "\n".join(rest).strip()


class Agent:
    def __init__(self, cfg, project, confirm_run=True):
        self.cfg = cfg
        self.project = project
        self.root = os.path.join(PROJECTS_DIR, project)
        os.makedirs(self.root, exist_ok=True)
        if not os.path.exists(mem_path(project)):
            open(mem_path(project), "w").write(f"# {project} memory\n")
        self.confirm_run = confirm_run
        self.history = []
        self.agent_log = []
        self.mode = "agent"

    def system(self):
        return CHAT_SYSTEM if self.mode == "chat" else SYSTEM

    def context_block(self, with_tools=True):
        mem = mem_tail(self.project, None)
        parts = [f"Working directory: {self.root} (all paths relative to it)."]
        if with_tools:
            parts.append(
                "Act with tools, never describe actions. Either call a function, or emit a line like:\n"
                '!tool {"op": "list", "path": "."}  (ops: read, list, run, write, edit)\n'
                "Shorthand also works: !list .  !read main.py  !run python -m pytest -q\n"
                '!write hello.py :: print("hi")  (or !write "content" path)\n'
                "Always write a file before running it. Run python files as: !run python hello.py")
        if mem:
            parts.append(f"Project memory:\n{mem}")
        return "\n".join(parts)

    def messages(self, with_tools=True):
        msgs = [{"role": "system", "content": self.system()}]
        for i, m in enumerate(self.history):
            content = m["content"]
            if i == 0 and m["role"] == "user" and not m.get("_ctx"):
                content = f"[Context]\n{self.context_block(with_tools)}\n\n[Task]\n{content}"
                m["_ctx"] = True
                m["content"] = content
            msgs.append({"role": m["role"], "content": content})
        return msgs

    def chat(self, user_text, stream=True):
        self.history.append({"role": "user", "content": user_text})
        final, last_answer, seen = "", None, set()
        use_tools = self.mode == "agent"
        rounds = self.cfg["max_rounds"] if use_tools else 1
        for _ in range(rounds):
            payload = {"model": self.cfg["model"], "messages": self.messages(use_tools),
                       "keep_alive": self.cfg["keep_alive"],
                       "options": {"num_ctx": self.cfg["num_ctx"], "num_predict": self.cfg["num_predict"],
                                   "temperature": self.cfg["temperature"], "repeat_penalty": 1.1}}
            if use_tools:
                payload["tools"] = TOOLS
            text, calls, meta = "", [], {}
            if stream:
                print("agent: ", end="", flush=True)
                text, calls, meta = self._stream(payload)
                print()
            else:
                obj = api(self.cfg, "/api/chat", dict(payload, stream=False))
                msg = obj.get("message", {})
                text, calls, meta = msg.get("content", "") or "", msg.get("tool_calls", []) or [], obj
                if text:
                    print("agent:", text)
            if not calls:
                tCalls, stripped = extract_tools(text)
                if tCalls:
                    key = json.dumps(tCalls, sort_keys=True)
                    if key in seen:
                        return (stripped or final or "Stopping: repeating the same tool call.") + \
                               " [stopped: loop]"
                    seen.add(key)
                    self.history.append({"role": "assistant", "content": text})
                    for c in tCalls:
                        r = do_tool(self.cfg, self.root, c, self.confirm_run)
                        print(f"[tool {c.get('op')} -> {str(r)[:120].replace(chr(10), ' ')}...]")
                        self.history.append({"role": "user", "content": f"!result {c.get('op')}: {str(r)[:8000]}"})
                    final = stripped or text
                    last_answer = None
                    continue
                answer = (text or "").strip()
                if answer and answer == last_answer:
                    return answer
                if answer:
                    self.history.append({"role": "assistant", "content": answer})
                    last_answer = answer
                self._note_speed(meta)
                return answer or "(no answer)"
            asst = {"role": "assistant", "content": text or ""}
            asst["tool_calls"] = calls
            key = json.dumps(calls, sort_keys=True, default=str)
            if key in seen:
                return (text or final or "Stopping: repeating the same tool call.") + " [stopped: loop]"
            seen.add(key)
            self.history.append(asst)
            for tc in calls:
                fn = (tc.get("function") or {}).get("name", "?")
                args = (tc.get("function") or {}).get("arguments", {})
                r = do_tool(self.cfg, self.root, {"op": fn, **args}, self.confirm_run)
                print(f"[tool {fn} -> {str(r)[:120].replace(chr(10), ' ')}...]")
                self.history.append({"role": "tool", "content": str(r)[:8000]})
            final = text

    def _stream(self, payload):
        url = self.cfg["host"] + "/api/chat"
        req = urllib.request.Request(url, data=json.dumps(dict(payload, stream=True)).encode(),
                                     headers={"Content-Type": "application/json"})
        text, calls, meta = "", [], {}
        with urllib.request.urlopen(req, timeout=600) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                msg = obj.get("message", {})
                chunk = msg.get("content", "")
                if chunk:
                    text += chunk
                    print(chunk, end="", flush=True)
                if msg.get("tool_calls"):
                    calls = msg["tool_calls"]
                if obj.get("done"):
                    meta = obj
        return text, calls, meta

    def _note_speed(self, meta):
        try:
            ev, ed = meta.get("eval_count", 0), meta.get("eval_duration", 0)
            if ev and ed:
                print(f"[~{ev / (ed / 1e9):.1f} tok/s]")
        except Exception:
            pass

    def spawn(self, task):
        stamp = datetime.datetime.now().strftime("%H:%M:%S")
        cmd = [sys.executable, os.path.join(BASE, "agent.py"), "--once", task,
               "--project", self.project, "--max-rounds", "3"]
        if not self.confirm_run:
            cmd.append("--yes")
        try:
            pr = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
            out = (pr.stdout + pr.stderr)[-4000:]
        except Exception as e:
            out = f"subagent failed: {e}"
        self.agent_log.append(f"[{stamp}] {task}\n{out[:500]}")
        return out


def multiline(end="."):
    print(f"(type lines, end with '{end}' alone)")
    lines = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip() == end:
            break
        lines.append(line)
    return "\n".join(lines)


def detect_test(root):
    if os.path.exists(os.path.join(root, "pytest.ini")) or os.path.exists(os.path.join(root, "tests")):
        return "python -m pytest -q"
    if os.path.exists(os.path.join(root, "package.json")):
        return "npm test"
    if os.path.exists(os.path.join(root, "Makefile")):
        return "make test"
    return None


def cmd_status(agent):
    try:
        ps = api(agent.cfg, "/api/ps", None, timeout=10).get("models", [])
    except Exception as e:
        return f"server unreachable: {e}"
    lines = [f"model: {agent.cfg['model']}  project: {agent.project}  ctx: {agent.cfg['num_ctx']}"]
    lines += [f"loaded: {m['name']} ({m.get('size', 0) / 2**30:.1f}GB)" for m in ps] or ["loaded: (none)"]
    try:
        out = subprocess.run(["powershell", "-c", "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory"],
                             capture_output=True, text=True, timeout=30).stdout.strip()
        lines.append(f"free RAM: {int(out) // 1024 // 1024}GB")
    except Exception:
        pass
    n = len(open(mem_path(agent.project), encoding="utf-8", errors="replace").read().splitlines()) if os.path.exists(mem_path(agent.project)) else 0
    lines.append(f"project memory lines: {n}")
    return "\n".join(lines)


def repl(agent):
    print(f"oagent [{agent.project}] model={agent.cfg['model']}  (/help for commands)")
    while True:
        try:
            line = input(f"{agent.project}[{agent.mode}]> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not line:
            continue
        if not line.startswith("/"):
            agent.chat(line)
            continue
        parts = line[1:].split(" ", 1)
        cmd, arg = parts[0].lower(), (parts[1] if len(parts) > 1 else "").strip()
        try:
            if cmd in ("quit", "exit", "q"):
                break
            elif cmd == "help":
                print(__doc__)
            elif cmd == "read":
                print(open(safe_path(agent.root, arg), encoding="utf-8", errors="replace").read()[:20000])
            elif cmd == "list":
                print(do_tool(agent.cfg, agent.root, {"op": "list", "path": arg or "."}, False))
            elif cmd == "write":
                if not arg:
                    print("usage: /write <path>"); continue
                content = multiline()
                print(do_tool(agent.cfg, agent.root, {"op": "write", "path": arg, "content": content}, False))
            elif cmd == "edit":
                if not arg:
                    print("usage: /edit <path>"); continue
                print("old text:"); old = multiline()
                print("new text:"); new = multiline()
                print(do_tool(agent.cfg, agent.root, {"op": "edit", "path": arg, "old": old, "new": new}, False))
            elif cmd == "run":
                print(do_tool(agent.cfg, agent.root, {"op": "run", "cmd": arg}, agent.confirm_run))
            elif cmd == "test":
                tcmd = arg or detect_test(agent.root)
                if not tcmd:
                    print("no test setup detected (pytest/tests, package.json, Makefile). usage: /test <cmd>")
                else:
                    print(do_tool(agent.cfg, agent.root, {"op": "run", "cmd": tcmd}, agent.confirm_run))
            elif cmd == "remember":
                with open(mem_path(agent.project), "a", encoding="utf-8") as f:
                    f.write(f"- [{datetime.date.today()}] {arg}\n")
                print("remembered.")
            elif cmd == "recall":
                hits = []
                for p in (GLOBAL_MEM, mem_path(agent.project)):
                    if os.path.exists(p):
                        for l in open(p, encoding="utf-8", errors="replace"):
                            if not arg or arg.lower() in l.lower():
                                hits.append(l.rstrip())
                print("\n".join(hits[-30:]) or "(nothing)")
            elif cmd == "agent":
                print(agent.spawn(arg))
            elif cmd == "agents":
                print("\n---\n".join(agent.agent_log) or "(no subagents yet)")
            elif cmd == "projects":
                ds = sorted(d for d in os.listdir(PROJECTS_DIR) if os.path.isdir(os.path.join(PROJECTS_DIR, d))) if os.path.exists(PROJECTS_DIR) else []
                print("\n".join(("* " + d if d == agent.project else "  " + d) for d in ds) or "(none)")
            elif cmd == "use":
                agent.__init__(agent.cfg, arg or "default", agent.confirm_run)
                print(f"switched to project '{agent.project}'")
            elif cmd == "mode":
                if arg in ("chat", "agent"):
                    agent.mode = arg
                    agent.history = []
                    print(f"mode -> {arg} (conversation cleared)")
                else:
                    print(f"mode: {agent.mode}  (use /mode chat | /mode agent)")
            elif cmd == "model":
                if arg:
                    agent.cfg["model"] = arg
                    json.dump(agent.cfg, open(CONFIG_PATH, "w"), indent=2)
                    print(f"model -> {arg} (saved)")
                else:
                    print(agent.cfg["model"])
            elif cmd == "status":
                print(cmd_status(agent))
            elif cmd == "unload":
                api(agent.cfg, "/api/generate", {"model": agent.cfg["model"], "keep_alive": 0}, timeout=60)
                agent.history = []
                print("unloaded.")
            elif cmd == "clear":
                agent.history = []
                print("conversation cleared.")
            else:
                print(f"unknown /{cmd}  (try /help)")
        except Exception as e:
            print(f"error: {e}")


def main(argv):
    args = " ".join(argv)
    if "--help" in argv or "-h" in argv:
        print(__doc__)
        return
    cfg = load_config()
    project = "default"
    if "--project" in argv:
        project = argv[argv.index("--project") + 1]
    if "--model" in argv:
        cfg["model"] = argv[argv.index("--model") + 1]
    if "--max-rounds" in argv:
        cfg["max_rounds"] = int(argv[argv.index("--max-rounds") + 1])
    confirm = "--yes" not in argv
    agent = Agent(cfg, project, confirm)
    if "--once" in argv:
        task = argv[argv.index("--once") + 1]
        agent.chat(task, stream=False)
        return
    repl(agent)


if __name__ == "__main__":
    main(sys.argv[1:])
