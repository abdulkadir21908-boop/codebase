"""Compiles Aurora assembly source into machine code."""

import re


OPCODES = {
    "stop": 0x00, "set": 0x01, "setb": 0x02,
    "load": 0x03, "loadb": 0x04, "store": 0x05, "storeb": 0x06,
    "add": 0x07, "sub": 0x08, "mul": 0x09, "div": 0x0A,
    "and": 0x0B, "or": 0x0C, "xor": 0x0D, "not": 0x0E,
    "shift": 0x0F, "cmp": 0x10,
    "goto": 0x11, "jmp": 0x12, "jz": 0x13, "jnz": 0x14,
    "jlt": 0x15, "jgt": 0x16,
    "call": 0x17, "back": 0x18, "push": 0x19, "pop": 0x1A,
    "readp": 0x1B, "writep": 0x1C, "trap": 0x1D, "tick": 0x1E,
    "debug": 0x1F,
}


class Compiler:
    def __init__(self):
        self.errors = []

    def compile(self, source):
        labels = {}
        entries = []

        for raw in source.splitlines():
            line = raw.split(";")[0].strip()
            if not line:
                continue
            if line.endswith(":"):
                entries.append(("label", line[:-1], None))
            elif line.lower().startswith("db "):
                entries.append(("data", None, line[3:].strip()))
            else:
                entries.append(("inst", None, line))

        addr = 0
        for entry in entries:
            kind, name, val = entry
            if kind == "label":
                labels[name] = addr
            elif kind == "data":
                raw_str = val
                if raw_str.startswith('"') or raw_str.startswith("'"):
                    q = raw_str[0]
                    end = raw_str.rfind(q)
                    string_part = raw_str[1:end] if end > 0 else raw_str[1:]
                    rest = raw_str[end + 1:].strip() if end > 0 else ""
                    if rest.startswith("0"):
                        addr += len(string_part) + 1
                    else:
                        addr += len(string_part) + 1
                else:
                    try:
                        int_val = int(raw_str)
                        addr += 5
                    except ValueError:
                        addr += len(raw_str) + 1
            elif kind == "inst":
                addr += 5

        bytecode = bytearray()
        for entry in entries:
            kind, name, val = entry
            if kind == "label":
                continue
            elif kind == "data":
                self._emit_data(bytecode, val)
            elif kind == "inst":
                try:
                    inst = self._assemble_line(val, labels)
                    bytecode.extend(inst)
                except Exception as e:
                    self.errors.append(f"Error: {e} -- {val}")
                    bytecode.extend(bytes(5))

        return bytes(bytecode), self.errors

    def _emit_data(self, bytecode, val):
        raw_str = val
        if raw_str.startswith('"') or raw_str.startswith("'"):
            q = raw_str[0]
            end = raw_str.rfind(q)
            string_part = raw_str[1:end] if end > 0 else raw_str[1:]
            rest = raw_str[end + 1:].strip() if end > 0 else ""
            for ch in string_part:
                bytecode.extend([ord(ch)])
            bytecode.extend([0])
        else:
            try:
                int_val = int(raw_str)
                bytecode.extend([int_val & 0xFF])
            except ValueError:
                for ch in raw_str:
                    bytecode.extend([ord(ch)])
                bytecode.extend([0])

    def _assemble_line(self, line, labels):
        parts = line.replace(",", " ").split()
        op = parts[0].lower()

        if op not in OPCODES:
            raise ValueError(f"Unknown: {op}")

        opcode = OPCODES[op]
        rd = 0
        rs = 0
        rt = 0
        imm = 0

        args = parts[1:]

        if op in ("stop", "back", "not", "tick", "debug"):
            pass

        elif op in ("set",):
            rd = self._reg(args[0])
            imm = self._val(args[1], labels)

        elif op == "setb":
            rd = int(args[0])
            imm = self._val(args[1], labels)
            hi = (imm >> 8) & 0xFF
            lo = imm & 0xFF
            return bytes([opcode, rd, 0, hi, lo])

        elif op in ("load", "loadb", "store", "storeb"):
            if len(args) >= 3:
                rd = self._reg(args[0])
                rs = self._reg(args[1])
                imm = self._val(args[2], labels)
            elif len(args) == 2:
                rd = self._reg(args[0])
                rs = self._reg(args[0])
                imm = self._val(args[1], labels)
            else:
                rd = self._reg(args[0])
                imm = 0

        elif op in ("add", "sub", "mul", "div", "and", "or", "xor"):
            rd = self._reg(args[0])
            rs = self._reg(args[1])
            if len(args) > 2:
                rt = self._reg(args[2])
            else:
                rt = rs
                rs = rd

        elif op == "shift":
            rd = self._reg(args[0])
            rs = self._reg(args[1])
            imm = self._val(args[2], labels)

        elif op == "cmp":
            rd = self._reg(args[0])
            rs = self._reg(args[1])

        elif op in ("goto", "jmp", "jz", "jnz", "jlt", "jgt", "call"):
            imm = self._val(args[0], labels)

        elif op == "push":
            rd = self._reg(args[0])

        elif op == "pop":
            rd = self._reg(args[0])

        elif op == "trap":
            rd = int(args[0]) if args else 0
            if len(args) > 1:
                try:
                    imm = self._val(args[1], labels)
                except ValueError:
                    rs = self._reg(args[1])
            if len(args) > 2:
                imm = self._val(args[2], labels)

        elif op in ("readp", "writep"):
            rd = self._reg(args[0])
            if len(args) > 1:
                imm = self._val(args[1], labels)

        hi = (imm >> 8) & 0xFF
        lo = imm & 0xFF
        return bytes([opcode, rd & 0xF, rs & 0xF, hi, lo])

    def _reg(self, s):
        s = s.strip().lower()
        if s.startswith("r"):
            return int(s[1:])
        return int(s)

    def _val(self, s, labels):
        s = s.strip()
        if s in labels:
            return labels[s] & 0xFFFF
        if s.startswith("0x"):
            return int(s, 16)
        if s.startswith("-"):
            return -int(s[1:]) & 0xFFFF
        return int(s) & 0xFFFF

    def assemble_file(self, path):
        with open(path, "r") as f:
            source = f.read()
        return self.compile(source)

    def save(self, bytecode, path):
        with open(path, "wb") as f:
            f.write(bytecode)
