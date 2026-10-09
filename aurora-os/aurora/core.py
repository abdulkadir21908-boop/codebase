"""The execution core - runs Aurora programs instruction by instruction."""

STOP   = 0x00
SET    = 0x01
SETB   = 0x02
LOAD   = 0x03
LOADB  = 0x04
STORE  = 0x05
STOREB = 0x06
ADD    = 0x07
SUB    = 0x08
MUL    = 0x09
DIV    = 0x0A
AND    = 0x0B
OR     = 0x0C
XOR    = 0x0D
NOT    = 0x0E
SHIFT  = 0x0F
CMP    = 0x10
GOTO   = 0x11
JMP    = 0x12
JZ     = 0x13
JNZ    = 0x14
JLT    = 0x15
JGT    = 0x16
CALL   = 0x17
BACK   = 0x18
PUSH   = 0x19
POP    = 0x1A
READP  = 0x1B
WRITEP = 0x1C
TRAP   = 0x1D
TICK   = 0x1E
DEBUG  = 0x1F

MEM_SIZE    = 1024 * 1024
STACK_BOT   = 0x80000
SCREEN_BASE = 0xF0000
SCREEN_W    = 80
SCREEN_H    = 25
SCREEN_END  = SCREEN_BASE + SCREEN_W * SCREEN_H * 2


class Core:
    def __init__(self):
        self.regs = [0] * 16
        self.regs[1] = STACK_BOT
        self.pc = 0
        self.flags = {"zero": False, "neg": False, "pos": False}
        self.memory = bytearray(MEM_SIZE)
        self.running = False
        self.steps = 0
        self.trap_handler = None
        self.screen_dirty = False

    def load(self, data, offset=0):
        self.memory[offset:offset + len(data)] = data

    def fetch(self):
        p = self.pc
        return (self.memory[p], self.memory[p+1], self.memory[p+2],
                self.memory[p+3], self.memory[p+4])

    def u16(self, hi, lo):
        return (hi << 8) | lo

    def s16(self, hi, lo):
        val = (hi << 8) | lo
        return val - 0x10000 if val >= 0x8000 else val

    def _update_flags(self, val):
        val = val & 0xFFFFFFFF
        self.flags["zero"] = val == 0
        self.flags["neg"] = (val & 0x80000000) != 0
        self.flags["pos"] = val != 0 and not self.flags["neg"]

    def _read_u32(self, addr):
        m = self.memory
        return m[addr] | (m[addr+1] << 8) | (m[addr+2] << 16) | (m[addr+3] << 24)

    def _write_u32(self, addr, val):
        m = self.memory
        m[addr]   = val & 0xFF
        m[addr+1] = (val >> 8) & 0xFF
        m[addr+2] = (val >> 16) & 0xFF
        m[addr+3] = (val >> 24) & 0xFF

    def step(self):
        op, rd, rs, b3, b4 = self.fetch()
        imm = self.s16(b3, b4)
        uimm = self.u16(b3, b4)
        next_pc = self.pc + 5

        if op == STOP:
            self.running = False
            return False

        elif op == SET:
            self.regs[rd] = imm & 0xFFFFFFFF

        elif op == SETB:
            addr = (SCREEN_BASE + rd * 2) & 0xFFFFFF
            self.memory[addr] = b3
            self.memory[addr + 1] = b4
            self.screen_dirty = True

        elif op == LOAD:
            addr = (self.regs[rs] + imm) & 0xFFFFFF
            self.regs[rd] = self._read_u32(addr)

        elif op == LOADB:
            addr = (self.regs[rs] + imm) & 0xFFFFFF
            self.regs[rd] = self.memory[addr]

        elif op == STORE:
            addr = (self.regs[rd] + imm) & 0xFFFFFF
            self._write_u32(addr, self.regs[rs])
            if SCREEN_BASE <= addr < SCREEN_END:
                self.screen_dirty = True

        elif op == STOREB:
            addr = (self.regs[rd] + imm) & 0xFFFFFF
            self.memory[addr] = self.regs[rs] & 0xFF
            if SCREEN_BASE <= addr < SCREEN_END:
                self.screen_dirty = True

        elif op == ADD:
            self.regs[rd] = (self.regs[rs] + self.regs[b3]) & 0xFFFFFFFF

        elif op == SUB:
            self.regs[rd] = (self.regs[rs] - self.regs[b3]) & 0xFFFFFFFF

        elif op == MUL:
            self.regs[rd] = (self.regs[rs] * self.regs[b3]) & 0xFFFFFFFF

        elif op == DIV:
            d = self.regs[b3]
            self.regs[rd] = (self.regs[rs] // d) if d else 0

        elif op == AND:
            self.regs[rd] = self.regs[rs] & self.regs[b3]

        elif op == OR:
            self.regs[rd] = self.regs[rs] | self.regs[b3]

        elif op == XOR:
            self.regs[rd] = self.regs[rs] ^ self.regs[b3]

        elif op == NOT:
            self.regs[rd] = (~self.regs[rs]) & 0xFFFFFFFF

        elif op == SHIFT:
            if imm > 0:
                self.regs[rd] = (self.regs[rs] << imm) & 0xFFFFFFFF
            else:
                self.regs[rd] = (self.regs[rs] >> (-imm)) & 0xFFFFFFFF

        elif op == CMP:
            diff = self.regs[rd] - self.regs[rs]
            self._update_flags(diff & 0xFFFFFFFF)

        elif op == GOTO:
            next_pc = uimm

        elif op == JMP:
            if self.flags["zero"]:
                next_pc = uimm

        elif op == JZ:
            if self.flags["zero"]:
                next_pc = uimm

        elif op == JNZ:
            if not self.flags["zero"]:
                next_pc = uimm

        elif op == JLT:
            if self.flags["neg"]:
                next_pc = uimm

        elif op == JGT:
            if self.flags["pos"]:
                next_pc = uimm

        elif op == CALL:
            sp = self.regs[1] - 4
            self._write_u32(sp, next_pc)
            self.regs[1] = sp
            next_pc = uimm

        elif op == BACK:
            sp = self.regs[1]
            next_pc = self._read_u32(sp)
            self.regs[1] = sp + 4

        elif op == PUSH:
            sp = self.regs[1] - 4
            self._write_u32(sp, self.regs[rd])
            self.regs[1] = sp

        elif op == POP:
            sp = self.regs[1]
            self.regs[rd] = self._read_u32(sp)
            self.regs[1] = sp + 4

        elif op == TRAP:
            if self.trap_handler:
                val = self.regs[rs] if rs != 0 else imm
                self.trap_handler(self, rd, val, imm)

        elif op == TICK:
            self.steps += 1

        self.regs[0] = 0
        self.pc = next_pc
        self.steps += 1
        return True

    def run(self, max_steps=100000):
        self.running = True
        self.steps = 0
        while self.running and self.steps < max_steps:
            if not self.step():
                break
