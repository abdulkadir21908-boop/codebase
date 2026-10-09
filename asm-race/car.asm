# =====================================================================
#   DUST RUNNER   --   a 3D racing game written in raw x86-64 assembly
#
#   Linux / ELF / System V AMD64 ABI.  No libc, no libraries, no
#   runtime, no graphics driver: the only thing this program talks to
#   is the kernel (read/write/ioctl/clock_gettime/open/close/exit).
#
#   Build:  as --64 -o car.o car.asm && ld -o car car.o
#   Play:   ./car
#   Frame:  ./car --shot out.ppm --demo 1200
#
#   What happens inside
#     * software 3D renderer.  The road is projected with a real
#       perspective divide into ~110 depth slices (far -> near), each
#       slice covering a horizontal band of screen rows; bands are
#       painted back to front, so it is an honest painter's algorithm
#       renderer with per-pixel distance fog.
#     * procedural track: per segment curvature (1/R) and gradient,
#       prefix-summed elevation, bell-shaped entry/exit on every bend.
#     * arcade car physics: engine curve, quadratic drag, steering
#       authority that falls off with speed, centrifugal load through
#       corners, off-road drag, collision with traffic and scenery.
#     * props: traffic cars, trees, edge pylons, billboards, all placed
#       in track space and recycled ahead of the player.
#     * 5x7 bitmap font HUD, rendered into the framebuffer, then
#       streamed to the terminal as ANSI truecolour half blocks.
# =====================================================================

.intel_syntax noprefix

.include "font.inc"

# ------------------------------------------------------------------
#                            constants
# ------------------------------------------------------------------
.equ FP,             0x10000            # 16.16 fixed point "one"
.equ SCR_MAXW,       200
.equ SCR_MAXH,       120
.equ CELL_MAX,       12000
.equ OUT_MAX,        (1 << 20)
.equ NSLICE,         128
# Screen-space clamp for the projected slices, in 16.16 pixels.  Must be well
# beyond the screen: at the nearest slice the road sits tens of pixels below
# the horizon, and cx0 alone is half a screen width.
.equ PROJ_CLAMP,     0x2000000
.equ NUM_SEG,        800
.equ SEG_LEN,        12                 # metres per track segment
.equ TRACK_LEN,      9600               # NUM_SEG * SEG_LEN
.equ NUM_OBJ,        260
.equ SEG_LEN16,      (12 * FP)
.equ TRACK_LEN16,    (9600 * FP)
.equ TRACK_LAST,     (9450 * FP)
.equ Z_NEAR,         (2 * FP)
.equ Z_FAR,          (760 * FP)
.equ ROAD_HALF,      (4 * FP)           # 8 m road = 4 lanes
.equ CAM_HEIGHT,     76021               # 1.16 m
.equ CAM_LAG,        0xD000             # camera sits 81% of player x
.equ VMAX,           (94 * FP)          # ~338 km/h
.equ VREV,           (12 * FP)
.equ FOG_START,      (90 * FP)
.equ FOG_SPAN,       (340 * FP)
.equ ACCEL,          (17 * FP)
.equ BRAKE,          (30 * FP)
.equ DRAG,           18                 # 0.00027 /m
.equ ROLL,           2787               # 0.0425  /m
.equ LAT_MAX,        (13 * FP)
.equ CENTRI,         0x5700             # centrifugal coupling gain
.equ OFFROAD_DEC,    (15 * FP)

.equ C_SKY_TOP,      0x1B4A8E
.equ C_SKY_MID,      0x4C8FD2
.equ C_SKY_HORIZ,    0xC6DCF2
.equ C_FOG,          0xB6CFE8
.equ C_GRASS_A,      0x3E8C33
.equ C_GRASS_B,      0x34792B
.equ C_ROAD_A,       0x3C3C46
.equ C_ROAD_B,       0x363640
.equ C_RUMBLE_W,     0xEAEAEE
.equ C_RUMBLE_R,     0xC8342C
.equ C_LINE,         0xDADAE4
.equ C_WHITE,        0xFFFFFF
.equ C_BLACK,        0x0E0E12
.equ C_SHADOW,       0x1A1A22
.equ C_TRUNK,        0x5A3A22
.equ C_LEAF_A,       0x2E7A2A
.equ C_LEAF_B,       0x1F551E
.equ C_GLASS,        0x8FC8E8
.equ C_TAIL,         0xE03028
.equ C_SUN,          0xFFF3C0
.equ C_HUD,          0xE8F4FF
.equ C_ACCENT,       0x50E0A0
.equ C_WARN,         0xFFC040
.equ C_BAD,          0xFF6050
.equ C_BARBG,        0x1A1A22

.equ OBJ_CAR,        0
.equ OBJ_TREE,       1
.equ OBJ_PYLON,      2
.equ OBJ_SIGN,       3

.equ ST_COUNT,       0
.equ ST_RACE,        1
.equ ST_DONE,        2

.equ SYS_read,       0
.equ SYS_write,      1
.equ SYS_open,       2
.equ SYS_close,      3
.equ SYS_ioctl,      16
.equ SYS_exit,       60
.equ SYS_clock,      228
.equ TCGETS,         0x5401
.equ TCSETS,         0x5402
.equ TIOCGWINSZ,     0x5413

# ------------------------------------------------------------------
#                                data
# ------------------------------------------------------------------
# The writable segment must be a real mapping, not a zero-length one.  If
# every writable symbol lives in .bss the linker emits a LOAD segment with
# FileSiz == 0, and some kernels (WSL1 among them) never map it -- every
# write to the framebuffer then faults.  Giving the writable area a page of
# initialised bytes in .data forces a real file-backed mapping.
.section .data
.align 4096
.globl data_pad
data_pad:
    .space 4096

# ------------------------------------------------------------------
#                                bss
# ------------------------------------------------------------------
.section .bss
.align 32
.globl scr_cols
scr_cols:      .space 4
.globl scr_rows
scr_rows:      .space 4
.globl px_w
px_w:          .space 4
.globl px_h
px_h:          .space 4
.globl horizon_y
horizon_y:     .space 4
.globl focal
focal:         .space 4
.globl cx0
cx0:           .space 4
.globl cam_x
cam_x:         .space 4
.globl cam_y
cam_y:         .space 4
.globl nslice
nslice:        .space 4
.globl frame_no
frame_no:      .space 4
.globl fb
fb:            .space (SCR_MAXW * SCR_MAXH * 4)
.globl prev_top
.globl cur_fg
cur_fg:        .space 4      # colour currently selected in the terminal
.globl cur_bg
cur_bg:        .space 4
.globl outbuf
outbuf:        .space OUT_MAX
.globl outlen
outlen:        .space 4
.globl numbuf
numbuf:        .space 32
.globl slice_z
slice_z:       .space (NSLICE * 4)
.globl slice_e
slice_e:       .space (NSLICE * 4)
.globl slice_y
slice_y:       .space (NSLICE * 4)
.globl slice_sx
slice_sx:      .space (NSLICE * 4)
.globl slice_sy
slice_sy:      .space (NSLICE * 4)
.globl slice_hw
slice_hw:      .space (NSLICE * 4)
.globl seg_curve
seg_curve:     .space (NUM_SEG * 4)
.globl seg_hill
seg_hill:      .space (NUM_SEG * 4)
.globl seg_elev
seg_elev:      .space ((NUM_SEG + 1) * 4)
.globl obj_type
obj_type:      .space (NUM_OBJ * 4)
.globl obj_s
obj_s:         .space (NUM_OBJ * 4)
.globl obj_lat
obj_lat:       .space (NUM_OBJ * 4)
.globl obj_spd
obj_spd:       .space (NUM_OBJ * 4)
.globl obj_col
obj_col:       .space (NUM_OBJ * 4)
.globl obj_flag
obj_flag:      .space (NUM_OBJ * 4)
.globl p_s
p_s:           .space 4
.globl p_x
p_x:           .space 4
.globl p_v
p_v:           .space 4
.globl p_steer
p_steer:       .space 4
.globl p_elev
p_elev:        .space 4
.globl shake
shake:         .space 4
.globl crash_t
crash_t:       .space 4
.globl race_time
race_time:     .space 4
.globl finish_time
finish_time:   .space 4
.globl overtakes
overtakes:     .space 4
.globl state
state:         .space 4
.globl countdown
countdown:     .space 4
.globl rng_s
rng_s:         .space 4
.globl key_up
key_up:        .space 4
.globl key_down
key_down:      .space 4
.globl key_left
key_left:      .space 4
.globl key_right
key_right:     .space 4
.globl want_quit
want_quit:     .space 4
.globl want_restart
want_restart:  .space 4
.globl want_shot
want_shot:     .space 4
.globl esc_state
esc_state:     .space 4
.globl keybuf
keybuf:        .space 64
.globl row_f
row_f:         .space 4
.globl row_grass
row_grass:     .space 4
.globl row_road
row_road:      .space 4
.globl row_rumble
row_rumble:    .space 4
.globl row_line
row_line:      .space 4
.globl termios_save
termios_save:  .space 128
.globl termios_new
termios_new:   .space 128
.globl winsize
winsize:       .space 64
.globl tsbuf
tsbuf:         .space 32
.globl rowbuf
rowbuf:        .space (SCR_MAXW * 8)
.globl hdrbuf
hdrbuf:        .space 64
.globl hdroff
hdroff:        .space 4
.globl tty_ok
tty_ok:        .space 1
.globl opt_frames
opt_frames:    .space 4
.globl sticky_throttle
sticky_throttle: .space 4        # headless runs have no keyboard; poll_keys
                                 # re-asserts the throttle from this every frame
.globl opt_cols
opt_cols:      .space 4
.globl opt_rows
opt_rows:      .space 4
.globl opt_demo
opt_demo:      .space 4
.globl opt_seed
opt_seed:      .space 4
.globl opt_shot
opt_shot:      .space 4
.globl shot_path
shot_path:     .space 256

# ------------------------------------------------------------------
#                              rodata
# ------------------------------------------------------------------
.section .rodata
tr_blit:     .asciz "<BLIT>\n"
.globl s_spd
s_spd:      .asciz "SPEED"
.globl s_kmh
s_kmh:      .asciz "KM/H"
.globl s_time
s_time:     .asciz "TIME"
.globl s_dist
s_dist:     .asciz "DIST"
.globl s_km
s_km:       .asciz "KM"
.globl s_over
s_over:     .asciz "OVER"
.globl s_go
s_go:       .asciz "GO!"
.globl s_fin
s_fin:      .asciz "FINISH!"
.globl s_again
s_again:    .asciz "PRESS R"
.globl s_off
s_off:      .asciz "OFF ROAD"
.globl s_crash
s_crash:    .asciz "CRASH!"
.globl s_colon
s_colon:    .asciz ":"
.globl s_dot
s_dot:      .asciz "."
.globl o_frames
o_frames:   .asciz "--frames"
.globl o_shot
o_shot:     .asciz "--shot"
.globl o_cols
o_cols:     .asciz "--cols"
.globl o_rows
o_rows:     .asciz "--rows"
.globl o_demo
o_demo:     .asciz "--demo"
.globl o_seed
o_seed:     .asciz "--seed"
.globl o_help
o_help:     .asciz "--help"
.globl s_help1
s_help1:    .asciz "DUST RUNNER -- a 3D racer written in x86-64 assembly\n"
.globl s_help2
s_help2:    .asciz "                 no libc, no libraries, only syscalls.\n\n"
.globl s_help3
s_help3:    .asciz "   UP / W     accelerate        DOWN / S    brake\n"
.globl s_help4
s_help4:    .asciz "   LEFT / A   steer left        RIGHT / D   steer right\n"
.globl s_help5
s_help5:    .asciz "   P  screenshot -> shot.ppm     R  restart     Q/ESC quit\n\n"
.globl s_help6
s_help6:    .asciz "   ./car --shot out.ppm [--demo metres] [--cols N --rows N]\n"
.globl s_help7
s_help7:    .asciz "   ./car --frames 600 [--seed 7]      headless smoke test\n"
.globl shot_default
shot_default: .asciz "shot.ppm"

# ===================================================================
#                            syscalls
# ===================================================================
.section .text
.global _start

.globl sys_read
sys_read:
    mov eax, SYS_read
    syscall
    ret

.globl sys_write
sys_write:
    mov eax, SYS_write
    syscall
    ret

.globl sys_ioctl
sys_ioctl:
    mov eax, SYS_ioctl
    syscall
    ret

.globl sys_close
sys_close:
    mov eax, SYS_close
    syscall
    ret

.globl sys_exit
sys_exit:
    mov eax, SYS_exit
    syscall

# write_all(fd=edi, buf=rsi, len=rdx)
.globl write_all
write_all:
    push rbx
    push r12
    push r13
    mov r12d, edi
    mov r13, rsi
    mov r8d, edx
.globl write_all_l
write_all_l:
    test r8d, r8d
    jz write_all_done
    mov edi, r12d
    mov rsi, r13
    mov edx, r8d
    call sys_write
    test eax, eax
    jle write_all_done
    add r13, rax
    sub r8d, eax
    jmp write_all_l
.globl write_all_done
write_all_done:
    pop r13
    pop r12
    pop rbx
    ret

# now_ms -> eax  (CLOCK_MONOTONIC in milliseconds)
.globl now_ms
now_ms:
    mov edi, 1                    # CLOCK_MONOTONIC
    lea rsi, [tsbuf]
    xor edx, edx
    mov eax, SYS_clock
    syscall
    # ms = tv_sec * 1000 + tv_nsec / 1000000.  Dividing tv_sec*1000 by 1000000
    # and then adding the raw nanosecond field (which is what this used to do)
    # left the result dominated by tv_nsec's low 32 bits, so consecutive frames
    # saw deltas that were essentially the sub-second nanosecond counter.
    mov rax, [tsbuf]              # tv_sec
    mov rcx, [tsbuf + 8]          # tv_nsec
    mov rbx, 1000
    mul rbx                       # rdx:rax = tv_sec * 1000
    add rax, rcx
    mov rbx, 1000000
    xor edx, edx
    div rbx
    mov eax, eax
    ret

# ===================================================================
#                              maths
# ===================================================================
# mul16(a=edi, b=esi) -> eax = (a*b) >> 16
.globl mul16
mul16:
    imul rsi, rdi
    sar rsi, 16
    mov eax, esi
    ret

# mul_s32(a=edi, b=esi) -> rax  signed 32x32 -> 64 bit product
.globl mul_s32
mul_s32:
    movsxd rax, edi
    movsxd rcx, esi
    imul rax, rcx
    ret

# scale_dt(v16=edi, dt16=esi) -> eax = (v*dt)>>16
.globl scale_dt
scale_dt:
    call mul_s32                 # args forwarded from the caller unchanged
    sar rax, 16
    mov eax, eax
    ret

# div16(a=edi, b=esi) -> eax = (a << 16) / b
.globl div16
div16:
    mov rax, rdi
    shl rax, 16
    cqo
    idiv rsi
    mov eax, eax
    ret

# clamp_i(val=eax, lo=ecx, hi=edx) -> eax
.globl clamp_i
clamp_i:
    cmp eax, ecx
    jl clamp_i_lo
    cmp eax, edx
    jg clamp_i_hi
    ret
.globl clamp_i_lo
clamp_i_lo:
    mov eax, ecx
    ret
.globl clamp_i_hi
clamp_i_hi:
    mov eax, edx
    ret

# abs16(eax) -> eax
.globl abs16
abs16:
    mov ecx, eax
    neg eax
    cmovs eax, ecx
    ret

# isqrt(edi) -> eax
.globl isqrt
isqrt:
    push rbx
    push r12
    mov r12d, edi
    xor ebx, ebx
    mov ecx, 16                # each pass consumes two bits of n, so 16
                               # covers a full 32-bit input
.globl isqrt_lp
isqrt_lp:
    mov edx, ebx
    shl edx, 1
    inc edx
    mov eax, r12d
    sub eax, edx
    jl isqrt_skip
    cmp eax, ebx
    jl isqrt_skip
    sub eax, ebx
    mov r12d, eax
    add ebx, edx
.globl isqrt_skip
isqrt_skip:
    dec ecx
    jg isqrt_lp
    mov eax, ebx
    pop r12
    pop rbx
    ret

# lerp_color(a=edi, b=esi, t=ecx 0..256) -> eax
.globl lerp_color
lerp_color:
    push rbx
    push r8
    push r9
    push r10
    push r11
    mov ebx, edi
    mov r8d, esi
    # blue
    mov r9d, ebx
    and r9d, 0xFF
    mov r10d, r8d
    and r10d, 0xFF
    sub r10d, r9d
    imul r10d, ecx
    sar r10d, 8
    add r9d, r10d
    mov r11d, r9d
    # green
    mov r9d, ebx
    shr r9d, 8
    and r9d, 0xFF
    mov r10d, r8d
    shr r10d, 8
    and r10d, 0xFF
    sub r10d, r9d
    imul r10d, ecx
    sar r10d, 8
    add r9d, r10d
    and r9d, 0xFF
    shl r9d, 8
    or r11d, r9d
    # red
    mov r9d, ebx
    shr r9d, 16
    and r9d, 0xFF
    mov r10d, r8d
    shr r10d, 16
    and r10d, 0xFF
    sub r10d, r9d
    imul r10d, ecx
    sar r10d, 8
    add r9d, r10d
    and r9d, 0xFF
    shl r9d, 16
    or r11d, r9d
    mov eax, r11d
    pop r11
    pop r10
    pop r9
    pop r8
    pop rbx
    ret

# shade(color=edi, k=esi 16.16) -> eax
.globl shade
shade:
    push rbx
    push r8
    push r9
    push r10
    mov ebx, edi
    mov r8d, esi
    mov r9d, ebx
    and r9d, 0xFF
    imul r9d, r8d
    sar r9d, 16
    cmp r9d, 255
    jle shade_b1
    mov r9d, 255
.globl shade_b1
shade_b1:
    mov r10d, ebx
    shr r10d, 8
    and r10d, 0xFF
    imul r10d, r8d
    sar r10d, 16
    cmp r10d, 255
    jle shade_g1
    mov r10d, 255
.globl shade_g1
shade_g1:
    shl r10d, 8
    mov ebx, ebx
    shr ebx, 16
    and ebx, 0xFF
    imul ebx, r8d
    sar ebx, 16
    cmp ebx, 255
    jle shade_r1
    mov ebx, 255
.globl shade_r1
shade_r1:
    shl ebx, 16
    mov eax, r9d
    or eax, r10d
    or eax, ebx
    pop r10
    pop r9
    pop r8
    pop rbx
    ret

# fog_mix(color=edi, f=esi 0..256) -> eax
.globl fog_mix
fog_mix:
    push rbx
    push r8
    push r9
    push r10
    push r11
    mov ebx, edi
    mov r8d, C_FOG
    mov r11d, esi
    mov r9d, ebx
    and r9d, 0xFF
    mov r10d, r8d
    and r10d, 0xFF
    sub r10d, r9d
    imul r10d, r11d
    sar r10d, 8
    add r9d, r10d
    and r9d, 0xFF
    mov eax, r9d
    mov r9d, ebx
    shr r9d, 8
    and r9d, 0xFF
    mov r10d, r8d
    shr r10d, 8
    and r10d, 0xFF
    sub r10d, r9d
    imul r10d, r11d
    sar r10d, 8
    add r9d, r10d
    and r9d, 0xFF
    shl r9d, 8
    or eax, r9d
    mov r9d, ebx
    shr r9d, 16
    and r9d, 0xFF
    mov r10d, r8d
    shr r10d, 16
    and r10d, 0xFF
    sub r10d, r9d
    imul r10d, r11d
    sar r10d, 8
    add r9d, r10d
    and r9d, 0xFF
    shl r9d, 16
    or eax, r9d
    pop r11
    pop r10
    pop r9
    pop r8
    pop rbx
    ret

# fog_amt(z16=eax) -> eax in 0..256
.globl fog_amt
fog_amt:
    sub eax, FOG_START
    jle fog_amt_zero
    cmp eax, FOG_SPAN
    jge fog_amt_full
    shl eax, 8
    xor edx, edx
    mov ecx, FOG_SPAN
    div ecx
    ret
.globl fog_amt_zero
fog_amt_zero:
    xor eax, eax
    ret
.globl fog_amt_full
fog_amt_full:
    mov eax, 256
    ret

# ===================================================================
#                            random
# ===================================================================
.globl rng_next
rng_next:                          # -> eax
    mov eax, [rng_s]
    mov ecx, eax
    shl ecx, 13
    xor eax, ecx
    mov ecx, eax
    shr ecx, 17
    xor eax, ecx
    mov ecx, eax
    shl ecx, 5
    xor eax, ecx
    mov [rng_s], eax
    ret

.globl rng_max
rng_max:                           # (n=edi) -> eax in [0,n)
    push rbx
    push rcx
    mov ebx, edi
    call rng_next
    xor edx, edx
    div ebx
    mov eax, edx
    pop rcx
    pop rbx
    ret

.globl rng_range
rng_range:                         # (lo=edi, span=esi) -> eax
    push rbx
    mov ebx, esi
    call rng_next
    xor edx, edx
    div ebx
    add eax, edi
    pop rbx
    ret

# ------------------------------------------------------------------
# fill32(rdi = dst, ecx = count, eax = value)
# An explicit loop rather than `rep stosd`.  The string-operation fast path is
# not reliable everywhere: on WSL1 `rep stosd` consumes the count but executes
# the body exactly once, so every block fill silently painted a single pixel.
# An explicit dec/jnz loop behaves identically on every machine.
# ------------------------------------------------------------------
.globl fill32
fill32:
    push rdi
    push rcx
    test ecx, ecx
    jz fill32_done
.fill32_lp:
    mov [rdi], eax
    add rdi, 4
    dec ecx
    jnz .fill32_lp
fill32_done:
    pop rcx
    pop rdi
    ret

# ===================================================================
#                           framebuffer
# ===================================================================
# put_px(x=edi, y=esi, colour=edx)   -- clobbers rcx
.globl put_px
put_px:
    mov ecx, esi
    cmp ecx, 0
    jl put_px_skip
    cmp ecx, [px_h]
    jge put_px_skip
    test edi, edi
    js put_px_skip
    cmp edi, [px_w]
    jge put_px_skip
    mov eax, ecx              # y
    imul eax, [px_w]          # 32-bit: y * width.  A 64-bit imul here would
    add eax, edi              # load 8 bytes at px_w and pick up px_h too.
    mov [fb + rax*4], edx
put_px_skip:
    ret
.globl blend_px
blend_px:
    mov r8d, [fb + rcx*4]
    mov r9d, edi
    mov r10d, esi
    mov edx, r8d
    and edx, 0xFF
    mov ebx, r9d
    and ebx, 0xFF
    sub ebx, edx
    imul ebx, r10d
    sar ebx, 8
    add edx, ebx
    and edx, 0xFF
    mov eax, edx
    mov edx, r8d
    shr edx, 8
    and edx, 0xFF
    mov ebx, r9d
    shr ebx, 8
    and ebx, 0xFF
    sub ebx, edx
    imul ebx, r10d
    sar ebx, 8
    add edx, ebx
    and edx, 0xFF
    shl edx, 8
    or eax, edx
    mov edx, r8d
    shr edx, 16
    and edx, 0xFF
    mov ebx, r9d
    shr ebx, 16
    and ebx, 0xFF
    sub ebx, edx
    imul ebx, r10d
    sar ebx, 8
    add edx, ebx
    and edx, 0xFF
    shl edx, 16
    or eax, edx
    mov [fb + rcx*4], eax
    ret

# hline(x0=edi, x1=esi exclusive, y=edx, colour=ecx)
.globl hline
hline:                    # (x0=edi, x1=esi, y=edx, colour=ecx)
    cmp edx, 0
    jl hline_done
    cmp edx, [px_h]
    jge hline_done
    xor r8d, r8d
    test edi, edi
    cmovs edi, r8d              # x0 = max(x0, 0)
    cmp esi, [px_w]
    jle hline_len
    mov esi, [px_w]             # x1 = min(x1, width)
hline_len:
    cmp edi, esi
    jge hline_done
    mov r8d, ecx               # stash the colour
    mov ecx, esi
    sub ecx, edi               # span length, before rdi is reused
    mov eax, edx
    mov edx, [px_w]
    imul eax, edx
    add rax, rdi
    lea rdi, [fb + rax*4]
    mov eax, r8d
    call fill32
hline_done:
    ret
.globl fill_rect
fill_rect:
    push rbx
    push r12
    push r13
    push r14
    mov r12d, edi
    mov r13d, esi
    mov r14d, edx
    mov ebx, ecx
    mov r9d, r8d
    xor eax, eax
    test r12d, r12d
    cmovs r12d, eax
    mov ecx, [px_w]
    cmp r14d, ecx
    jle fill_rect_cx
    mov r14d, ecx
.globl fill_rect_cx
fill_rect_cx:
    cmp r12d, r14d
    jge fill_rect_done
    xor eax, eax
    test r13d, r13d
    cmovs r13d, eax
    cmp ebx, [px_h]
    jle fill_rect_cy
    mov ebx, [px_h]
.globl fill_rect_cy
fill_rect_cy:
    cmp r13d, ebx
    jge fill_rect_done
    mov r10d, r13d
.globl fill_rect_row
fill_rect_row:
    cmp r10d, ebx
    jge fill_rect_done
    mov edi, r12d
    mov esi, r14d
    mov edx, r10d
    mov ecx, r9d
    call hline
    inc r10d
    jmp fill_rect_row
.globl fill_rect_done
fill_rect_done:
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# fill_rect_blend(x0=edi, y0=esi, dx=edx, dy=ecx, colour=r8d, alpha=r9d)
# Sizes, not end coordinates: that leaves a register spare for the caller
# (circle_blend needs x0, x1, y0, y1, colour and alpha all at once).
.globl fill_rect_blend
fill_rect_blend:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov r12d, edi              # x0
    mov r13d, esi              # y0
    mov r14d, edi
    add r14d, edx              # x1 = x0 + dx
    mov r15d, esi
    add r15d, ecx              # y1 = y0 + dy
    mov [frb_col], r8d
    mov [frb_alpha], r9d
    xor eax, eax
    test r12d, r12d
    cmovs r12d, eax
    mov eax, [px_w]
    cmp r14d, eax
    jle fill_rect_blend_cx
    mov r14d, eax
fill_rect_blend_cx:
    cmp r12d, r14d
    jge fill_rect_blend_done
    xor eax, eax
    test r13d, r13d
    cmovs r13d, eax
    mov eax, [px_h]
    cmp r15d, eax
    jle fill_rect_blend_cy
    mov r15d, eax
fill_rect_blend_cy:
    cmp r13d, r15d
    jge fill_rect_blend_done
    mov [frb_row], r13d
fill_rect_blend_row:
    mov eax, [frb_row]
    cmp eax, r15d
    jge fill_rect_blend_done
    mov ebx, r14d
    sub ebx, r12d
    mov [frb_cnt], ebx
    mov ecx, [px_w]
    imul ecx, eax
    mov edx, r12d
    add rcx, rdx
    mov [frb_idx], rcx
fill_rect_blend_px:
    mov eax, [frb_cnt]
    test eax, eax
    jz fill_rect_blend_nextrow
    mov rcx, [frb_idx]
    mov edi, [frb_col]
    mov esi, [frb_alpha]
    call blend_px
    inc dword ptr [frb_idx]
    dec dword ptr [frb_cnt]
    jmp fill_rect_blend_px
fill_rect_blend_nextrow:
    inc dword ptr [frb_row]
    jmp fill_rect_blend_row
fill_rect_blend_done:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret
# circle_fill(cx=edi, cy=esi, r=edx, colour=ecx)
.globl circle_fill
circle_fill:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov r12d, edi
    mov r13d, esi
    mov r14d, edx
    mov r15d, ecx
    mov r9d, edx
    neg r9d
    add r9d, esi               # y0 = cy - r
    mov r10d, r9d
    xor eax, eax
    test r10d, r10d
    cmovs r10d, eax
    lea r11d, [r13 + r14 + 1]
    cmp r11d, [px_h]
    jle circle_fill_r1
    mov r11d, [px_h]
circle_fill_r1:
.globl circle_fill_row
circle_fill_row:
    cmp r10d, r11d
    jge circle_fill_done
    mov eax, r10d
    sub eax, r13d
    imul eax, eax
    mov ecx, r14d
    imul ecx, ecx
    sub ecx, eax
    cmp ecx, 0
    jl circle_fill_nextrow
    call isqrt
    mov ebx, eax               # half width
    mov edi, r12d
    sub edi, ebx
    mov edx, r12d
    add edx, ebx
    mov esi, r10d              # hline takes (x0, x1, y, colour)
    mov ecx, r15d
    call hline
.globl circle_fill_nextrow
circle_fill_nextrow:
    inc r10d
    jmp circle_fill_row
.globl circle_fill_done
circle_fill_done:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# circle_blend(cx=edi, cy=esi, r=edx, colour=ecx, alpha=r8d)
.globl circle_blend
circle_blend:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov r12d, edi              # cx
    mov r13d, esi              # cy
    mov r14d, edx              # radius
    mov r15d, ecx              # colour
    mov [cb_alpha], r8d        # alpha lives in bss
    mov r10d, esi
    sub r10d, edx
    xor eax, eax
    test r10d, r10d
    cmovs r10d, eax
    mov [cb_row], r10d
    lea r11d, [r13 + r14 + 1]
    cmp r11d, [px_h]
    jle circle_blend_r1
    mov r11d, [px_h]
circle_blend_r1:
    mov [cb_end], r11d
circle_blend_row:
    mov r10d, [cb_row]
    cmp r10d, [cb_end]
    jge circle_blend_done
    mov eax, r10d
    sub eax, r13d
    imul eax, eax
    mov ecx, r14d
    imul ecx, ecx
    sub ecx, eax
    cmp ecx, 0
    jl circle_blend_nextrow
    call isqrt
    mov ebx, eax
    mov edi, r12d
    sub edi, ebx              # x0
    mov edx, ebx
    shl edx, 1
    inc edx                   # dx = 2*r+1
    mov esi, r10d             # y0 = this row
    mov ecx, 1                # dy = one row
    mov r8d, r15d             # colour
    mov r9d, [cb_alpha]       # alpha
    call fill_rect_blend
circle_blend_nextrow:
    mov eax, [cb_row]
    inc eax
    mov [cb_row], eax
    jmp circle_blend_row
circle_blend_done:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret
# ===================================================================
#                                text
# ===================================================================
# blit_px(x=edi, y=esi, colour=edx, scale=ecx)
.globl blit_px
blit_px:                    # (x=edi, y=esi, colour=edx, scale=ecx)
    push rbx                 # draw_text keeps its glyph pointer in rdi and its
    push r8                  # loop state in r8/r9/r10, so blit_px hands all of
    push r9                  # them back untouched even though the ABI allows
    push r10                 # them to be clobbered
    push r11
    push r12
    push r13
    push rdi
    push rsi
    mov r12d, edi            # origin x
    mov r13d, esi            # origin y
    mov ebx, ecx             # scale
    mov r8d, edx             # colour
    xor r9d, r9d             # dy
blit_px_oy:
    cmp r9d, ebx
    jge blit_px_done
    xor r10d, r10d           # dx
blit_px_ox:
    cmp r10d, ebx
    jge blit_px_nexty
    mov edi, r12d
    add edi, r10d
    mov esi, r13d
    add esi, r9d
    mov edx, r8d
    call put_px              # only clobbers rcx and rax
    inc r10d
    jmp blit_px_ox
blit_px_nexty:
    inc r9d
    jmp blit_px_oy
blit_px_done:
    pop rsi
    pop rdi
    pop r13
    pop r12
    pop r11
    pop r10
    pop r9
    pop r8
    pop rbx
    ret
.globl draw_text
draw_text:                    # (x=edi, y=esi, str=rdx, colour=ecx, scale=r8d)
    push rbx
    push rbp                 # glyph pointer -- rbp because rdi is spent on
    push r12                 # the per-pixel argument to blit_px
    push r13
    push r14
    push r15
    mov r12d, edi              # pen x
    mov r13d, esi              # pen y
    mov rbx, rdx               # string cursor
    mov r14d, ecx              # colour
    mov r15d, r8d              # scale
draw_text_chr:
    movzx eax, byte ptr [rbx]
    test eax, eax
    jz draw_text_done
    inc rbx
    cmp eax, 32
    jge draw_text_g0
    jmp draw_text_adv
draw_text_g0:
    cmp eax, 96
    jl draw_text_g1
    jmp draw_text_adv
draw_text_g1:
    sub eax, 32
    imul rax, 5
    lea rbp, [font5x7 + rax]
    xor r8d, r8d               # glyph column
draw_text_col:
    cmp r8d, 5
    jge draw_text_adv
    movzx r9d, byte ptr [rbp + r8]
    test r9d, r9d
    jz draw_text_nextcol
    xor r10d, r10d             # glyph row
draw_text_row:
    cmp r10d, 7
    jge draw_text_nextcol
    mov ecx, r10d              # bit index of this row
    mov r11d, r9d
    shr r11d, cl
    test r11d, 1
    jz draw_text_nextrow
    mov eax, r12d
    mov edx, r8d
    imul edx, r15d             # x = pen_x + column * scale
    add eax, edx               # NOT (pen_x + column) * scale: pen_x is a pixel
    mov r11d, r13d             # position, and scaling it too shifted every
    mov edx, r10d              # scale-2 glyph 4 pixels right of where it was
    imul edx, r15d             # asked for -- and the y side below does not do
    add r11d, edx              # it, which is what made the two inconsistent
    mov edi, eax
    mov esi, r11d
    mov edx, r14d
    mov ecx, r15d
    call blit_px
draw_text_nextrow:
    inc r10d
    jmp draw_text_row
draw_text_nextcol:
    inc r8d
    jmp draw_text_col
draw_text_adv:
    mov eax, r15d
    shl eax, 2
    add eax, r15d              # 5 * scale
    add r12d, eax
    add r12d, r15d             # + scale  ->  6 * scale per glyph
    jmp draw_text_chr
draw_text_done:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbp
    pop rbx
    ret
.globl draw_char
draw_char:                    # (x=edi, y=esi, ch=rdx, colour=ecx, scale=r8d)
    push rbx
    push r12
    push r13
    mov r12d, ecx              # colour
    mov r13d, r8d              # scale
    lea rbx, [numbuf]
    mov al, [rdx]
    mov byte ptr [rbx], al
    mov byte ptr [rbx + 1], 0
    mov rdx, rbx
    mov ecx, r12d
    mov r8d, r13d
    call draw_text
    pop r13
    pop r12
    pop rbx
    ret
# draw_uint(x=edi, y=esi, value=edx, scale=ecx, colour=r8d)
.globl draw_uint
draw_uint:                    # (x=edi, y=esi, value=edx, scale=ecx, colour=r8d)                    # (x=edi, y=esi, value=edx, scale=ecx, colour=r8d)
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov r12d, edi              # pen x
    mov r13d, esi              # pen y
    mov r15d, ecx              # scale
    mov [du_colour], r8d
    lea rbx, [numbuf + 16]
    mov byte ptr [rbx], 0
    mov eax, edx
    test eax, eax
    jnz draw_uint_digits
    dec rbx
    mov byte ptr [rbx], 0x30
    jmp draw_uint_print
draw_uint_digits:
    mov ecx, 10
draw_uint_div:
    xor edx, edx
    div ecx                     # eax = quotient, edx = remainder
    add dl, 0x30                # the remainder becomes the digit.  It has to be
    dec rbx                     # edx, not al: eax still holds the quotient that
    mov [rbx], dl               # the loop condition tests.
    test eax, eax
    jnz draw_uint_div
draw_uint_print:
    lea r14, [numbuf + 16]     # end of the digit string
draw_uint_emit:
    mov edi, r12d
    mov esi, r13d
    mov rdx, rbx
    mov ecx, [du_colour]
    mov r8d, r15d
    call draw_char
    lea eax, [r15d + r15d]     # 6 * scale: a digit is 5 pixels plus a gap, and
    shl eax, 1                 # at scale 2 a fixed 6 would overlap the digits
    add r12d, eax
    inc rbx
    cmp rbx, r14
    jb draw_uint_emit
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret
# draw_uint_end(x_right=edi, y=esi, value=edx, scale=ecx, colour=r8d)
.globl draw_uint_end
draw_uint_end:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov r12d, edi              # x cursor, right edge
    mov r13d, esi              # y
    mov ebx, edx               # value
    mov r14d, ecx              # scale
    mov r15d, r8d              # colour
    # ---- count digits
    mov eax, ebx
    test eax, eax
    jns draw_uint_end_cnt0
    xor eax, eax
.globl draw_uint_end_cnt0
draw_uint_end_cnt0:
    mov ecx, 1
    mov r9d, 10
.globl draw_uint_end_cnt
draw_uint_end_cnt:
    xor edx, edx
    div r9d
    test eax, eax
    jz draw_uint_end_cntdone
    inc ecx
    jmp draw_uint_end_cnt
.globl draw_uint_end_cntdone
draw_uint_end_cntdone:
    mov eax, ecx
    shl eax, 1
    add eax, ecx               # 3 * digits
    shl eax, 1                 # 6 * digits
    imul eax, r14d
    mov r12d, r12d
    sub r12d, eax
    add r12d, r14d
    mov edi, r12d
    mov esi, r13d
    mov edx, ebx
    mov ecx, r14d
    mov r8d, r15d
    call draw_uint
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# draw_text_end(x_right=edi, y=esi, str=rsi, colour=edx, scale=ecx)
.globl draw_text_end
draw_text_end:                # (x_right=edi, y=esi, str=rdx, colour=ecx, scale=r8d)
    push rbx
    push r12
    push r13
    push r14
    mov r12d, edi              # right edge
    mov rbx, rdx               # string
    mov r13d, ecx              # colour
    mov r14d, r8d              # scale
    xor eax, eax
draw_text_end_len:
    cmp byte ptr [rbx + rax], 0
    je draw_text_end_lend
    inc eax
    jmp draw_text_end_len
draw_text_end_lend:
    lea ecx, [rax + rax]
    add eax, ecx
    add eax, ecx               # 6 * characters
    imul eax, r14d
    sub r12d, eax
    add r12d, r14d
    mov edi, r12d
    mov rdx, rbx
    mov ecx, r13d
    mov r8d, r14d
    call draw_text
    pop r14
    pop r13
    pop r12
    pop rbx
    ret
# ===================================================================
#                        terminal output
# ===================================================================
# out_byte(dil)
.globl out_byte
out_byte:
    push rax
    push rcx
    mov eax, [outlen]
    cmp eax, OUT_MAX - 32
    jae out_byte_skip
    mov byte ptr [outbuf + rax], dil
    inc dword ptr [outlen]
.globl out_byte_skip
out_byte_skip:
    pop rcx
    pop rax
    ret

# out_num(edi)
.globl out_num
out_num:
    push rbx
    push rcx
    push rdi
    lea rbx, [numbuf + 24]       # rbx is the cursor; rdi is the argument
    mov byte ptr [rbx], 0        # register that out_byte reads
    mov eax, edi
    cmp eax, 10
    jl out_num_one
    mov ecx, 10
out_num_dv:
    xor edx, edx
    div ecx                     # eax = quotient, edx = remainder
    add dl, 0x30                # digit comes from edx; eax keeps the quotient
    dec rbx                     # that the loop condition tests
    mov [rbx], dl
    test eax, eax
    jnz out_num_dv
    lea rsi, [numbuf + 24]
out_num_emit:
    mov al, [rbx]
    mov edi, eax
    call out_byte
    inc rbx
    cmp rbx, rsi
    jb out_num_emit
    jmp out_num_fin
out_num_one:
    add eax, 0x30
    mov edi, eax
    call out_byte
out_num_fin:
    pop rdi
    pop rcx
    pop rbx
    ret

# emit_sgr(base=edi 38/48, colour=ecx)
# The colour must be read out of ecx and stashed before the first out_num call:
# out_num leaves a scratch address in rsi and a divide remainder in edx, so
# reading either after any emit gives garbage rather than what the caller asked
# for.  For the same reason the whole-routine scratch registers are preserved:
# present keeps a cell's two colours in ebx and rbp across these calls.
.globl emit_sgr
emit_sgr:
    push rbx
    push rbp
    push r12
    mov ebx, ecx             # the colour
    mov r12d, edi            # 38 for the foreground, 48 for the background
    mov edi, 27
    call out_byte
    mov edi, 91
    call out_byte
    mov edi, r12d
    call out_num             # base number: 38 (fg) or 48 (bg), as digits
    mov edi, 59
    call out_byte            # ';'
    mov edi, 50
    call out_byte            # '2'
    mov edi, 59
    call out_byte
    mov edi, ebx
    shr edi, 16
    call out_num
    mov edi, 59
    call out_byte
    mov edi, ebx
    shr edi, 8
    and edi, 0xFF
    call out_num
    mov edi, 59
    call out_byte
    mov edi, ebx
    and edi, 0xFF
    call out_num
    mov edi, 109
    call out_byte            # 'm'
    pop r12
    pop rbp
    pop rbx
    ret

# present(): framebuffer -> ANSI truecolour half blocks
.globl present
present:
    push rbx
    push rbp
    push r12
    push r13
    push r14
    push r15
    mov dword ptr [outlen], 0
    mov edi, 27
    call out_byte
    mov edi, 91
    call out_byte
    mov edi, 72
    call out_byte               # ESC [ H
    # The terminal's colour state is whatever the last frame left behind, and
    # we cannot know it.  Emit one reset so the first cells are certainly right.
    mov edi, 27
    call out_byte
    mov edi, 91
    call out_byte
    mov edi, 48
    call out_byte
    mov edi, 109
    call out_byte               # ESC [ 0 m
    mov dword ptr [cur_fg], -1
    mov dword ptr [cur_bg], -1
    mov r12d, [scr_rows]
    xor r13d, r13d
.globl present_rloop
present_rloop:
    mov r14d, [px_w]
    imul r14d, r13d
    shl r14d, 1                # row base = 2*cy*px_w
    xor r15d, r15d
.globl present_cloop
present_cloop:
    mov eax, r14d
    add eax, r15d
    mov ebx, [fb + rax*4]        # top pixel = fb[2*cy][cx]
    lea eax, [2 * r13 + 1]       # row index of the lower half
    cmp eax, [px_h]
    jl present_have2
    mov rbp, rbx                # bottom = top when the lower half is off screen
    jmp present_have
.globl present_have2
present_have2:
    mov eax, r14d
    add eax, r15d
    add eax, [px_w]             # linear index of the bottom pixel
    mov rbp, [fb + rax*4]
.globl present_have
present_have:
    # SGR is global state, and every cell below is repainted with a half-block
    # character whether or not its colour changed.  So the test is "is this the
    # colour already in effect?", not "did this cell change since last frame?" --
    # comparing against a per-cell cache left untouched cells showing whatever
    # colour happened to be emitted last, and the screen washed out to it.
    #
    # The two colours ride in ebx and rbp, never in esi/edx: emit_sgr goes out
    # to out_num, whose divide loop leaves the remainder in edx.  Holding the
    # lower half of the cell there across the foreground emit_sgr replaced it
    # with the remainder of an unrelated division, and the lower half of every
    # cell whose foreground had just changed came out as whatever garbage that
    # was -- which is how half the pixels of the HUD's own glyphs went missing.
    mov esi, ebx
    cmp esi, [cur_fg]
    je present_nt
    mov [cur_fg], esi
    mov edi, 38
    mov ecx, esi
    call emit_sgr
.globl present_nt
present_nt:
    mov edx, ebp
    cmp edx, [cur_bg]
    je present_nb
    mov [cur_bg], edx
    mov edi, 48
    mov ecx, edx
    call emit_sgr
.globl present_nb
present_nb:
    mov edi, 0xE2
    call out_byte
    mov edi, 0x96
    call out_byte
    mov edi, 0x80
    call out_byte               # U+2580 upper half block
    inc r15d
    cmp r15d, [scr_cols]
    jl present_cloop
    inc r13d
    cmp r13d, r12d
    jl present_rloop
    mov edi, 1
    lea rsi, [outbuf]
    mov edx, [outlen]
    call write_all
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbp
    pop rbx
    ret

# ===================================================================
#                        string / parse helpers
# ===================================================================
# streq(rdi, rsi) -> eax = 1 if equal
.globl streq
streq:
    xor ecx, ecx
.globl streq_l
streq_l:
    mov al, [rdi + rcx]
    cmp al, [rsi + rcx]
    jne streq_no
    test al, al
    jz streq_yes
    inc ecx
    jmp streq_l
.globl streq_yes
streq_yes:
    mov eax, 1
    ret
.globl streq_no
streq_no:
    xor eax, eax
    ret

# str2int(rsi) -> eax
# str2int(rdi = string) -> eax      ASCII digits only; stops at the first other byte
.globl str2int
str2int:
    xor eax, eax
    xor ecx, ecx
.globl str2int_l
str2int_l:
    movzx edx, byte ptr [rdi + rcx]
    cmp edx, 0x30
    jl str2int_done
    cmp edx, 0x39
    jg str2int_done
    imul eax, eax, 10
    sub edx, 0x30
    add eax, edx
    inc ecx
    jmp str2int_l
.globl str2int_done
str2int_done:
    ret

# strcpy(rdi=dst, rsi=src)
.globl strcpy
strcpy:
    xor ecx, ecx
.globl strcpy_l
strcpy_l:
    mov al, [rsi + rcx]
    mov [rdi + rcx], al
    test al, al
    jz strcpy_done
    inc ecx
    cmp ecx, 250
    jl strcpy_l
    mov byte ptr [rdi + 250], 0
.globl strcpy_done
strcpy_done:
    ret

# print(rdi = NUL terminated string)
.globl print
print:
    push rbx
    push rcx
    push rsi
    mov rbx, rdi
    mov rcx, rdi
.globl print_len
print_len:
    cmp byte ptr [rcx], 0
    je print_go
    inc rcx
    jmp print_len
.globl print_go
print_go:
    mov edi, 1                      # stdout
    mov rsi, rbx
    mov rdx, rcx
    sub rdx, rbx
    call write_all
    pop rsi
    pop rcx
    pop rbx
    ret

# hdr_ch(dil)  append to hdrbuf
.globl hdr_ch
hdr_ch:
    push rax
    mov eax, [hdroff]           # 32-bit: an 8-byte load reads past the counter
    mov byte ptr [hdrbuf + rax], dil
    inc dword ptr [hdroff]
    pop rax
    ret

# hdr_num(edi)  append decimal
.globl hdr_num
hdr_num:
    push rbx
    push rcx
    push rdi
    lea rbx, [numbuf + 24]       # rbx is the cursor; rdi is the argument
    mov byte ptr [rbx], 0        # register that hdr_ch reads
    mov eax, edi
    cmp eax, 10
    jl hdr_num_one
    mov ecx, 10
.globl hdr_num_dv
hdr_num_dv:
    xor edx, edx
    div ecx                     # eax = quotient, edx = remainder
    add dl, 0x30                # digit comes from edx; eax keeps the quotient
    dec rbx                     # that the loop condition tests
    mov [rbx], dl
    test eax, eax
    jnz hdr_num_dv
    lea rsi, [numbuf + 24]
.globl hdr_num_emit
hdr_num_emit:
    mov al, [rbx]
    mov edi, eax
    call hdr_ch
    inc rbx
    cmp rbx, rsi
    jb hdr_num_emit
    jmp hdr_num_fin
.globl hdr_num_one
hdr_num_one:
    add eax, 0x30
    mov edi, eax
    call hdr_ch
.globl hdr_num_fin
hdr_num_fin:
    pop rdi
    pop rcx
    pop rbx
    ret

# ===================================================================
#                         procedural track
# ===================================================================
.section .bss
.globl tmp_a
tmp_a:      .space 4
.globl tmp_b
tmp_b:      .space 4
prev_ms:    .space 4      # wall clock of the previous frame
.globl tmp_c
tmp_c:      .space 4
.globl tmp_d
tmp_d:      .space 4
.globl tmp_e
tmp_e:      .space 4
.globl tmp_f
tmp_f:      .space 4        # glyph offset of the DIST readout's decimal point
.globl tmp_k
tmp_k:      .space 4        # current bend magnitude
.globl tmp_s
tmp_s:      .space 4        # current gradient magnitude
.globl tmp_ks
tmp_ks:     .space 4        # bend sign selector
.globl tmp_ss
tmp_ss:     .space 4        # gradient sign selector
.globl tmp_dt
tmp_dt:     .space 4
.globl tmp_end
tmp_end:    .space 4
.globl ob_d
ob_d:       .space 4
.globl ob_ppm
ob_ppm:     .space 4
.globl ob_x
ob_x:       .space 4
.globl ob_y
ob_y:       .space 4
.globl tc_x
tc_x:       .space 4
.globl tc_hw
tc_hw:      .space 4
.globl tc_z
tc_z:       .space 4
.globl sc
sc:         .space 64       # 16 scratch words for the prop drawers
.globl horizon16
horizon16:  .space 4

.section .text

# seg_at(s16 = edi) -> eax  segment index
.globl seg_at
seg_at:
    mov eax, edi
    sar eax, 16
    xor edx, edx
    mov ecx, SEG_LEN
    div ecx
    cmp eax, NUM_SEG
    jle seg_at_ok
    mov eax, NUM_SEG
.globl seg_at_ok
seg_at_ok:
    ret

# elev_at(s16 = edi) -> eax  road elevation in metres (16.16)
.globl elev_at
elev_at:
    mov eax, edi
    sar eax, 16
    xor edx, edx
    mov ecx, SEG_LEN
    div ecx                       # eax = segment, edx = metres into it
    cmp eax, NUM_SEG
    jle elev_at_ok
    mov eax, NUM_SEG
.globl elev_at_ok
elev_at_ok:
    mov [tmp_end], eax
    mov eax, [seg_elev + rax*4]
    mov edi, [seg_hill + rcx*4]
    mov esi, edx
    shl esi, 16                   # metres into segment, as 16.16
    push rax
    call mul16
    pop rcx
    add eax, ecx
    ret

# gen_track(): lay out curvature + gradient + elevation
.globl gen_track
gen_track:
    push rbx
    push r12
    push r13
    xor r12d, r12d                # segment cursor
.globl gen_track_run
gen_track_run:
    cmp r12d, NUM_SEG
    jge gen_track_fin
    mov edi, 70
    call rng_max
    add eax, 24                    # 24..93 segments long
    mov r13d, eax
    mov edi, 150
    call rng_max
    add eax, 38                    # |curvature| 38..187  (R = 350..1750 m)
    mov [tmp_k], eax
    mov edi, 2
    call rng_max
    mov [tmp_ks], eax
    mov edi, 60
    call rng_max
    add eax, 8                     # |gradient| 8..67 (0.12% .. 1.0%)
    mov [tmp_s], eax
    mov edi, 3
    call rng_max
    mov [tmp_ss], eax
    xor ebx, ebx                   # j
.globl gen_track_inner
gen_track_inner:
    cmp ebx, r13d
    jge gen_track_run
    cmp r12d, NUM_SEG
    jge gen_track_run
    mov eax, ebx
    shl eax, 16
    xor edx, edx
    div r13d                      # t = j / len
    mov [tmp_a], eax
    mov esi, FP
    sub esi, eax                   # 1 - t
    mov edi, eax
    call mul16
    shl eax, 2                     # bell shape 4t(1-t), 0 .. 65536
    mov [tmp_b], eax
    mov edi, eax
    mov esi, [tmp_k]
    call mul16
    cmp dword ptr [tmp_ks], 0
    je gen_track_cv_ok
    neg eax
.globl gen_track_cv_ok
gen_track_cv_ok:
    mov [seg_curve + r12*4], eax
    mov edi, [tmp_b]
    mov esi, [tmp_b]
    call mul16                     # shape squared, gentler hills
    mov edi, eax
    mov esi, [tmp_s]
    call mul16
    cmp dword ptr [tmp_ss], 0
    je gen_track_hl_ok
    neg eax
.globl gen_track_hl_ok
gen_track_hl_ok:
    mov [seg_hill + r12*4], eax
    inc r12d
    inc ebx
    jmp gen_track_inner
.globl gen_track_fin
gen_track_fin:
    # ---- flatten the start straight and the run to the flag
    xor r12d, r12d
.globl gen_track_flat1
gen_track_flat1:
    cmp r12d, 24
    jge gen_track_flat2
    mov dword ptr [seg_curve + r12*4], 0
    mov dword ptr [seg_hill + r12*4], 0
    inc r12d
    jmp gen_track_flat1
.globl gen_track_flat2
gen_track_flat2:
    mov r12d, NUM_SEG
.globl gen_track_flat3
gen_track_flat3:
    cmp r12d, NUM_SEG - 20
    jle gen_track_flat4
    mov dword ptr [seg_curve + r12*4 - 80], 0
    mov dword ptr [seg_hill + r12*4 - 80], 0
    dec r12d
    jmp gen_track_flat3
.globl gen_track_flat4
gen_track_flat4:
    # ---- prefix sums of the gradient -> elevation
    mov dword ptr [seg_elev], 0
    xor r12d, r12d
.globl gen_track_elev
gen_track_elev:
    cmp r12d, NUM_SEG
    jge gen_track_elev_done
    mov edi, [seg_hill + r12*4]
    mov esi, SEG_LEN16
    call mul16
    add eax, [seg_elev + r12*4]
    mov [seg_elev + r12*4 + 4], eax
    inc r12d
    jmp gen_track_elev
.globl gen_track_elev_done
gen_track_elev_done:
    pop r13
    pop r12
    pop rbx
    ret

# ===================================================================
#                     traffic and scenery objects
# ===================================================================
# spawn_obj(k = edi)
.globl spawn_obj
spawn_obj:
    push rbx
    push r12
    mov r12d, edi
    # ---- position: 300..519 m in front of the player
    mov edi, 220
    call rng_max
    add eax, 300
    shl eax, 16
    add eax, [p_s]
    mov ecx, TRACK_LAST
    cmp eax, ecx
    jle spawn_pos_ok
    mov eax, ecx
.globl spawn_pos_ok
spawn_pos_ok:
    mov [obj_s + r12*4], eax
    # ---- type
    mov edi, 100
    call rng_max
    cmp eax, 40
    jle spawn_car
    cmp eax, 72
    jle spawn_tree
    cmp eax, 92
    jle spawn_pylon
    # ---- billboard
    mov dword ptr [obj_type + r12*4], OBJ_SIGN
    mov edi, 2
    call rng_max
    add eax, 7                      # 7..8 m out
    shl eax, 16
    cmp dword ptr [tmp_ks], 0
    je spawn_sign_ok
    neg eax
.globl spawn_sign_ok
spawn_sign_ok:
    mov [obj_lat + r12*4], eax
    mov dword ptr [obj_spd + r12*4], 0
    mov edi, 120
    call rng_max
    add eax, 0x20000
    mov [obj_col + r12*4], eax
    jmp spawn_obj_done
.globl spawn_car
spawn_car:
    mov dword ptr [obj_type + r12*4], OBJ_CAR
    mov edi, 4
    call rng_max
    shl eax, 1
    sub eax, 3                      # lanes at -3, -1, 1, 3 m
    shl eax, 16
    mov [obj_lat + r12*4], eax
    mov edi, 12
    call rng_max
    add eax, 20                     # 20..31 m/s, i.e. 72..112 km/h
    shl eax, 16
    mov [obj_spd + r12*4], eax
    mov dword ptr [obj_flag + r12*4], 0
    mov edi, 5
    call rng_max
    shl eax, 16
    mov [tmp_a], eax                # green..blue channel
    mov edi, 96
    call rng_max
    add eax, 96                     # 96..190 red channel
    shl eax, 8
    or eax, [tmp_a]
    or eax, 0x000028
    mov [obj_col + r12*4], eax
    jmp spawn_obj_done
.globl spawn_tree
spawn_tree:
    mov dword ptr [obj_type + r12*4], OBJ_TREE
    mov edi, 260
    call rng_max
    add eax, 60                     # 9.1..13 m from the centre line
    shl eax, 16
    cmp dword ptr [tmp_ks], 0
    je spawn_tree_ok
    neg eax
.globl spawn_tree_ok
spawn_tree_ok:
    mov [obj_lat + r12*4], eax
    mov dword ptr [obj_spd + r12*4], 0
    mov edi, 40
    call rng_max
    add eax, 0x10000
    mov [obj_col + r12*4], eax      # size jitter
    jmp spawn_obj_done
.globl spawn_pylon
spawn_pylon:
    mov dword ptr [obj_type + r12*4], OBJ_PYLON
    mov edi, 2
    call rng_max
    mov [tmp_a], eax
    mov eax, 0x60000                # 6 m, just off the tarmac
    cmp dword ptr [tmp_a], 0
    je spawn_pylon_ok
    neg eax
.globl spawn_pylon_ok
spawn_pylon_ok:
    mov [obj_lat + r12*4], eax
    mov dword ptr [obj_spd + r12*4], 0
    mov dword ptr [obj_col + r12*4], C_WHITE
.globl spawn_obj_done
spawn_obj_done:
    pop r12
    pop rbx
    ret

# init_objects()
.globl init_objects
init_objects:
    push rbx
    xor ebx, ebx
.globl init_objects_lp
init_objects_lp:
    cmp ebx, NUM_OBJ
    jge init_objects_done
    mov edi, ebx
    call spawn_obj
    inc ebx
    jmp init_objects_lp
.globl init_objects_done
init_objects_done:
    pop rbx
    ret

# update_objects(dt16 = edi)
.globl update_objects
update_objects:
    push rbx
    push r12
    push r13
    push r14
    mov r13d, edi
    xor r12d, r12d
.globl update_objects_lp
update_objects_lp:
    cmp r12d, NUM_OBJ
    jge update_objects_done
    mov eax, [obj_type + r12*4]
    cmp eax, OBJ_CAR
    jne update_objects_test
    mov edi, [obj_spd + r12*4]
    mov esi, r13d
    call scale_dt
    add [obj_s + r12*4], eax
    # overtake bookkeeping: once it is behind us, count it
    cmp dword ptr [obj_flag + r12*4], 0
    jne update_objects_test
    mov eax, [obj_s + r12*4]
    sub eax, [p_s]
    cmp eax, -0x20000             # -2 m
    jg update_objects_test
    inc dword ptr [overtakes]
    mov dword ptr [obj_flag + r12*4], 1
.globl update_objects_test
update_objects_test:
    mov eax, [obj_s + r12*4]
    sub eax, [p_s]
    cmp eax, -0x280000            # 40 m behind -> recycle
    jge update_objects_far
    jmp update_objects_respawn
.globl update_objects_far
update_objects_far:
    cmp eax, 0x1200000            # 288 m ahead  -> recycle
    jle update_objects_next
.globl update_objects_respawn
update_objects_respawn:
    mov edi, r12d
    call spawn_obj
.globl update_objects_next
update_objects_next:
    inc r12d
    jmp update_objects_lp
.globl update_objects_done
update_objects_done:
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# ===================================================================
#                         car physics
# ===================================================================
# collide(): traffic + scenery contacts
.globl collide
collide:
    push rbx
    push r12
    push r13
    push r14
    xor r12d, r12d
    mov r13d, [crash_t]
.globl collide_lp
collide_lp:
    cmp r12d, NUM_OBJ
    jge collide_done
    mov eax, [obj_s + r12*4]
    sub eax, [p_s]
    mov [tmp_a], eax               # depth
    mov eax, [obj_type + r12*4]
    cmp eax, OBJ_CAR
    je collide_car
    cmp eax, OBJ_TREE
    je collide_tree
    cmp eax, OBJ_PYLON
    je collide_pylon
    mov r14d, 0x14000              # billboard: 1.25 m
    jmp collide_test
.globl collide_car
collide_car:
    mov r14d, 0x2E000              # car: 2.8 m long
    jmp collide_test
.globl collide_tree
collide_tree:
    mov r14d, 0x18000              # tree trunk: 1.5 m
    jmp collide_test
.globl collide_pylon
collide_pylon:
    mov r14d, 0x12000              # pylon: 1.1 m
.globl collide_test
collide_test:
    mov eax, [tmp_a]
    call abs16
    cmp eax, r14d
    jg collide_next
    mov eax, [obj_lat + r12*4]
    sub eax, [p_x]
    call abs16
    cmp eax, 0x24000               # 2.25 m sideways
    jg collide_next
    test r13d, r13d
    jg collide_next                 # still recovering from a crash
    # ---- contact
    mov edi, [p_v]
    mov esi, 0x47AE                 # keep 28% of the speed
    call mul_s32                 # args forwarded from the caller unchanged
    sar rax, 16
    mov [p_v], eax
    mov dword ptr [crash_t], 0x7000
    mov dword ptr [shake], 0x10000
    mov eax, [obj_type + r12*4]
    cmp eax, OBJ_CAR
    jne collide_next
    mov eax, [obj_lat + r12*4]
    sub eax, [p_x]
    test eax, eax
    jle collide_shove_left
    mov eax, 0x28000                # 2.5 m
    jmp collide_shove
.globl collide_shove_left
collide_shove_left:
    mov eax, -0x28000
.globl collide_shove
collide_shove:
    add [obj_lat + r12*4], eax
    mov dword ptr [obj_spd + r12*4], 0xFFFF0000   # spun out at -1 m/s
    mov dword ptr [obj_flag + r12*4], 1
.globl collide_next
collide_next:
    inc r12d
    jmp collide_lp
.globl collide_done
collide_done:
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# step_game(dt16 = edi)
.globl step_game
step_game:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov r12d, edi
    # ---- decay timers
    mov eax, [shake]
    sub eax, r12d
    cmp eax, 0
    jge step_shake_ok
    xor eax, eax
.globl step_shake_ok
step_shake_ok:
    mov [shake], eax
    mov eax, [crash_t]
    sub eax, r12d
    cmp eax, 0
    jge step_crash_ok
    xor eax, eax
.globl step_crash_ok
step_crash_ok:
    mov [crash_t], eax
    mov eax, [state]
    cmp eax, ST_COUNT
    je step_countdown
    cmp eax, ST_DONE
    je step_out
    # =================== racing ===================
    add [race_time], r12d
    # ---- steering: ease towards the input
    mov eax, [key_right]
    sub eax, [key_left]
    mov ebx, eax
    mov edi, ebx
    shl edi, 16
    sub edi, [p_steer]
    mov esi, r12d
    shl esi, 2
    add esi, r12d
    shl esi, 1                      # dt * 6
    imul rdi, rsi
    sar rdi, 16
    add [p_steer], edi
    # ---- throttle / brake / coast
    cmp dword ptr [key_up], 0
    je step_no_accel
    mov edi, [p_v]
    mov esi, VMAX
    call div16                      # speed fraction
    mov esi, eax
    mov edi, 0x999A                 # 0.6
    call mul16
    mov ecx, FP
    sub ecx, eax
    mov edi, ecx
    mov esi, ACCEL
    call mul16
    mov edi, eax              # pass the result on in edi
    mov esi, r12d
    call scale_dt
    add [p_v], eax
    jmp step_long_done
.globl step_no_accel
step_no_accel:
    cmp dword ptr [key_down], 0
    je step_coast
    cmp dword ptr [p_v], 0x2000
    jl step_reverse
    mov edi, BRAKE
    mov esi, r12d
    call scale_dt
    sub [p_v], eax
    jmp step_long_done
.globl step_reverse
step_reverse:
    mov edi, ACCEL
    mov esi, r12d
    call scale_dt
    sar eax, 1
    sub [p_v], eax
    cmp dword ptr [p_v], -VREV
    jge step_long_done
    mov dword ptr [p_v], -VREV
    jmp step_long_done
.globl step_coast
step_coast:
    mov edi, DRAG
    mov esi, [p_v]
    call mul16
    mov edi, eax
    mov esi, [p_v]
    call mul16
    mov r13d, eax
    mov edi, ROLL
    mov esi, [p_v]
    call mul16
    add r13d, eax
    imul r13d, r12d
    sar r13d, 16
    sub [p_v], r13d
.globl step_long_done
step_long_done:
    cmp dword ptr [p_v], VMAX
    jle step_v_ok
    mov dword ptr [p_v], VMAX
.globl step_v_ok
step_v_ok:
    cmp dword ptr [p_v], -VREV
    jge step_v_lo_ok
    mov dword ptr [p_v], -VREV
.globl step_v_lo_ok
step_v_lo_ok:
    # ---- lateral motion: steer * authority
    mov edi, [p_v]
    mov esi, VMAX
    call div16
    mov ecx, 0xB333                # 0.70
    imul rcx, rax
    sar rcx, 16
    add ecx, 0x4CCD                 # + 0.30
    mov [tmp_a], ecx
    mov edi, [p_steer]
    mov esi, LAT_MAX
    call mul16
    mov edi, eax
    mov esi, [tmp_a]
    call mul16
    mov edi, eax              # pass the result on in edi
    mov esi, r12d
    call scale_dt
    add [p_x], eax
    # ---- centrifugal load through the corner
    mov edi, [p_s]
    call seg_at
    mov ecx, eax
    mov edi, [seg_curve + rcx*4]
    mov esi, [p_v]
    call mul16
    mov edi, eax
    mov esi, [p_v]
    call mul16
    mov edi, eax
    mov esi, [p_v]
    call mul16
    mov edi, CENTRI
    call mul16
    mov edi, eax              # pass the result on in edi
    mov esi, r12d
    call scale_dt
    neg eax
    add [p_x], eax
    # ---- off road handling
    mov eax, [p_x]
    call abs16
    cmp eax, ROAD_HALF
    jle step_on_road
.globl step_on_road_off
step_on_road_off:
    mov edi, OFFROAD_DEC
    mov esi, r12d
    call scale_dt
    sub [p_v], eax
    mov edi, 0xC000
    mov esi, r12d
    call scale_dt
    add [shake], eax
    cmp dword ptr [shake], 0x28000
    jle step_on_road
    mov dword ptr [shake], 0x28000
.globl step_on_road
step_on_road:
    cmp dword ptr [p_x], 0xA0000
    jle step_lim_lo
    mov dword ptr [p_x], 0xA0000
    jmp step_collide
.globl step_lim_lo
step_lim_lo:
    cmp dword ptr [p_x], -0xA0000
    jge step_collide
    mov dword ptr [p_x], -0xA0000
.globl step_collide
step_collide:
    call collide
    # ---- advance along the track
    mov edi, [p_v]
    mov esi, r12d
    call scale_dt
    add [p_s], eax
    mov eax, TRACK_LEN16
    cmp [p_s], eax
    jl step_out
    mov [p_s], eax
    mov eax, [race_time]
    mov [finish_time], eax
    mov dword ptr [state], ST_DONE
    jmp step_out
.globl step_countdown
step_countdown:
    mov eax, [countdown]
    sub eax, r12d
    mov [countdown], eax
    jge step_out
    mov dword ptr [state], ST_RACE
.globl step_out
step_out:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# reset_race()
.globl reset_race
reset_race:
    push rbx
    mov dword ptr [p_s], 0
    mov dword ptr [p_x], 0
    mov dword ptr [p_v], 0
    mov dword ptr [p_steer], 0
    mov dword ptr [shake], 0
    mov dword ptr [crash_t], 0
    mov dword ptr [race_time], 0
    mov dword ptr [overtakes], 0
    mov dword ptr [state], ST_COUNT
    mov dword ptr [countdown], 0x30000         # 3 seconds
    call init_objects
    pop rbx
    ret

# ===================================================================
#                            renderer
# ===================================================================
.section .bss
.globl sc2_0
sc2_0:       .space 4
.globl sc2_1
sc2_1:       .space 4
.globl sc2_2
sc2_2:       .space 4
.globl sc2_3
sc2_3:       .space 4
.globl sc2_4
sc2_4:       .space 4
.globl sc2_5
sc2_5:       .space 4
.globl sc2_6
sc2_6:       .space 4
.globl sc2_7
sc2_7:       .space 4
frb_col:     .space 4
frb_alpha:   .space 4
frb_row:     .space 4
frb_cnt:     .space 4
frb_idx:     .space 8     # 64-bit: it holds px_w*row + x0
cb_row:      .space 4
cb_end:      .space 4
cb_alpha:    .space 4
dt_x:        .space 4
dt_ground:   .space 4
dt_ppm:      .space 4
dt_tint:     .space 4
dt_th:       .space 4
dt_apex:     .space 4
.globl du_colour
du_colour:   .space 4
.globl dbg_s1
.globl dbg_s2
tb_yf:       .space 4
tb_yn:       .space 4
tb_rows:     .space 4
tb_end:      .space 4
tb_zf:       .space 4
tb_xf:       .space 4
tb_hwf:      .space 4
tb_dz:       .space 4
tb_dx:       .space 4
tb_dhw:      .space 4
ob_hw:       .space 4
.globl scr_top
scr_top:     .space 4
.globl scr_bot
scr_bot:     .space 4

.section .text

# px16(eax) -> eax    pixels -> 16.16
.globl px16
px16:
    shl eax, 16
    ret

# px_mix16(a=edi, b=esi, t=ecx 0..65536) -> eax
.globl px_mix16
px_mix16:
    mov eax, edi
    sub eax, esi
    imul rax, rcx
    sar rax, 16
    add eax, esi
    ret

# draw_text_center(str=rdi, y=esi, colour=edx, scale=ecx)
.globl draw_text_center
draw_text_center:            # (str=rdi, y=esi, colour=edx, scale=ecx)
    push rbx
    push r12
    push r13
    push r14
    mov rbx, rdi               # string
    mov r12d, esi              # y
    mov r14d, edx              # colour
    mov r13d, ecx              # scale
    xor eax, eax
draw_text_center_len:
    cmp byte ptr [rbx + rax], 0
    je draw_text_center_lend
    inc eax
    jmp draw_text_center_len
draw_text_center_lend:
    lea ecx, [rax + rax]
    add eax, ecx
    add eax, ecx               # 6 * characters
    imul eax, r13d
    mov ecx, [px_w]
    sub ecx, eax
    shr ecx, 1
    mov edi, ecx
    mov esi, r12d
    mov rdx, rbx
    mov ecx, r14d
    mov r8d, r13d
    call draw_text
    pop r14
    pop r13
    pop r12
    pop rbx
    ret
# ------------------------------------------------------------------
# build_slices(): walk the track forward from the car and record the
# world position of the road at a set of geometrically spaced depths
# ------------------------------------------------------------------
.globl build_slices
build_slices:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov r12d, [p_s]           # player distance along the track
    mov edi, r12d
    call elev_at
    mov [p_elev], eax
    add eax, CAM_HEIGHT
    mov [cam_y], eax
    mov edi, [p_x]
    mov esi, CAM_LAG
    call mul16
    mov [cam_x], eax
    mov r13d, eax              # elevation
    xor r14d, r14d             # lateral offset of the road centre
    mov r15d, Z_NEAR           # depth of this slice
    xor ebp, ebp               # slice index (callee saved: seg_at uses ecx)
    xor r8d, r8d               # slices filled
build_slices_lp:
    cmp ebp, NSLICE
    jge build_slices_done
    mov [slice_z + rbp*4], r15d
    mov [slice_e + rbp*4], r13d
    mov [slice_y + rbp*4], r14d
    inc ebp
    inc r8d
    mov [nslice], r8d
    mov eax, r15d
    sar eax, 4                 # next slice is 1/16 further away
    add r15d, eax
    cmp r15d, Z_FAR
    jge build_slices_done
    mov r9d, r15d
    sub r9d, [slice_z + rbp*4 - 4]     # dz
    mov eax, [slice_z + rbp*4 - 4]
    add eax, r9d
    sar eax, 1
    add eax, r12d
    mov r11d, eax              # distance along the track at mid slice
    mov edi, r11d
    call seg_at
    mov r10d, eax
    mov edi, [seg_hill + r10*4]
    mov esi, r9d
    call mul16
    add r13d, eax              # elevation += slope * dz
    mov edi, [seg_curve + r10*4]
    mov esi, r11d
    call mul16
    mov edi, eax
    mov esi, r9d
    call mul16
    add r14d, eax              # lateral offset += k * s * dz
    jmp build_slices_lp
build_slices_done:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret
# project_slices(): perspective divide every slice
.globl project_slices
project_slices:
    push rbx
    push r12
    push r13
    mov r12d, [nslice]
    mov eax, [px_w]
    shr eax, 1
    call px16    # args: eax is the pixel height computed at entry
    mov ebx, eax
    mov [cx0], eax
    xor r13d, r13d
.globl project_slices_lp
project_slices_lp:
    cmp r13d, r12d
    jge project_slices_done
    # ---- screen x of the road centre
    mov edi, [slice_y + r13*4]
    sub edi, [cam_x]
    mov esi, [focal]
    call mul16
    mov edi, eax              # pass the result on in edi
    mov esi, [slice_z + r13*4]
    call div16
    add eax, ebx
    cmp eax, -PROJ_CLAMP
    jge project_slices_sx_ok
    mov eax, -PROJ_CLAMP
.globl project_slices_sx_ok
project_slices_sx_ok:
    cmp eax, PROJ_CLAMP
    jle project_slices_sx_st
    mov eax, PROJ_CLAMP
.globl project_slices_sx_st
project_slices_sx_st:
    mov [slice_sx + r13*4], eax
    # ---- screen y of the road surface
    # The camera is above the road, so the road projects below the horizon:
    # y = horizon + (cam_y - road_y) * focal / z.  No negation here.
    mov edi, [cam_y]
    sub edi, [slice_e + r13*4]
    mov esi, [focal]
    call mul16
    mov edi, eax              # pass the result on in edi
    mov esi, [slice_z + r13*4]
    call div16
    add eax, [horizon16]
    cmp eax, -PROJ_CLAMP
    jge project_slices_sy_ok
    mov eax, -PROJ_CLAMP
.globl project_slices_sy_ok
project_slices_sy_ok:
    cmp eax, PROJ_CLAMP
    jle project_slices_sy_st
    mov eax, PROJ_CLAMP
.globl project_slices_sy_st
project_slices_sy_st:
    mov [slice_sy + r13*4], eax
    # ---- half width of the road on screen
    mov edi, [focal]
    mov esi, ROAD_HALF
    call mul16
    mov edi, eax              # pass the result on in edi
    mov esi, [slice_z + r13*4]
    call div16
    cmp eax, PROJ_CLAMP
    jle project_slices_hw_st
    mov eax, PROJ_CLAMP
.globl project_slices_hw_st
project_slices_hw_st:
    mov [slice_hw + r13*4], eax
    inc r13d
    jmp project_slices_lp
.globl project_slices_done
project_slices_done:
    pop r13
    pop r12
    pop rbx
    ret

# ------------------------------------------------------------------
# draw_sky(): vertical gradient, sun, a few clouds
# ------------------------------------------------------------------
.globl draw_sky
draw_sky:
    push rbx
    push r12
    push r13
    push r14
    mov r12d, [px_h]
    mov r13d, [horizon_y]
    cmp r13d, 4
    jge draw_sky_ok
    mov r13d, 4
.globl draw_sky_ok
draw_sky_ok:
    mov r14d, r13d
    shr r14d, 1
    cmp r14d, 1
    jge draw_sky_half_ok
    mov r14d, 1
.globl draw_sky_half_ok
draw_sky_half_ok:
    xor ebx, ebx
.globl draw_sky_lp
draw_sky_lp:
    cmp ebx, r13d
    jge draw_sky_sun
    mov ecx, 256
    cmp ebx, r14d
    jge draw_sky_lower
    mov eax, ebx
    shl eax, 9              # t = row * 512, so 256 lands mid-sky
    xor edx, edx
    div r14d
    cmp eax, 256
    jle draw_sky_t1
    mov eax, 256
.globl draw_sky_t1
draw_sky_t1:
    mov ecx, eax            # lerp_color's t comes from ecx, not eax
    mov edi, C_SKY_TOP
    mov esi, C_SKY_MID
    call lerp_color    # args: ecx is the blend factor set by the caller
    jmp draw_sky_paint
.globl draw_sky_lower
draw_sky_lower:
    mov eax, ebx
    sub eax, r14d
    shl eax, 9
    xor edx, edx
    div r14d
    cmp eax, 256
    jle draw_sky_t2
    mov eax, 256
.globl draw_sky_t2
draw_sky_t2:
    mov ecx, eax            # lerp_color's t comes from ecx, not eax
    mov edi, C_SKY_MID
    mov esi, C_SKY_HORIZ
    call lerp_color    # args: ecx is the blend factor set by the caller
.globl draw_sky_paint
draw_sky_paint:
    xor edi, edi
    mov esi, [px_w]
    mov edx, ebx
    mov ecx, eax
    call hline
    inc ebx
    jmp draw_sky_lp
.globl draw_sky_sun
draw_sky_sun:
    # sun position
    mov eax, [px_w]
    imul eax, eax, 3
    shr eax, 2                    # three quarters across, so it stays on screen
    mov [sc2_0], eax              # x
    mov eax, r13d
    shr eax, 3
    add eax, 3
    mov [sc2_1], eax              # y
    mov eax, r12d
    shr eax, 4
    add eax, 3
    mov [sc2_2], eax              # radius
    # glow
    mov edi, [sc2_0]
    mov esi, [sc2_1]
    mov edx, [sc2_2]
    shl edx, 2
    mov ecx, C_SUN
    mov r8d, 26
    call circle_blend
    mov edi, [sc2_0]
    mov esi, [sc2_1]
    mov edx, [sc2_2]
    add edx, edx
    mov ecx, C_SUN
    mov r8d, 60
    call circle_blend
    mov edi, [sc2_0]
    mov esi, [sc2_1]
    mov edx, [sc2_2]
    mov ecx, C_SUN
    call circle_fill
    # ---- clouds
    mov edi, 0
    call draw_cloud
    mov edi, 1
    call draw_cloud
    mov edi, 2
    call draw_cloud
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# draw_cloud(index = edi)
.globl draw_cloud
draw_cloud:
    push rbx
    push r12
    mov r12d, edi
    mov eax, r12d
    shl eax, 4
    lea rbx, [cloud_tab + rax]
    mov edi, [rbx]
    imul edi, [px_w]
    shr edi, 8
    mov [sc2_3], edi              # x
    mov esi, [rbx + 4]
    imul esi, [horizon_y]
    shr esi, 7
    mov [sc2_4], esi              # y
    mov edx, [rbx + 8]
    imul edx, [px_w]
    shr edx, 8
    mov [sc2_5], edx              # radius
    mov ecx, [rbx + 12]
    mov r8d, 150
    call circle_blend
    # second puff, slightly lower and to the right
    mov edi, [sc2_3]
    add edi, [sc2_5]
    mov esi, [sc2_4]
    add esi, 2
    mov edx, [sc2_5]
    shr edx, 1
    mov ecx, [rbx + 12]
    mov r8d, 150
    call circle_blend
    pop r12
    pop rbx
    ret

.section .rodata
.globl cloud_tab
cloud_tab:
    # Three clouds, 16 bytes each: x, y and radius in 8.8 fixed point, then a
    # 32-bit 0x00RRGGBB colour.  draw_cloud reads them with a 16-byte stride,
    # so the records have to be that wide.
    .word 0x0014, 0x0022, 0x000B, 0x0000
    .byte 0xF0, 0xF8, 0xFF, 0x00
    .word 0x003E, 0x001A, 0x000D, 0x0000
    .byte 0xFF, 0xFF, 0xFF, 0x00
    .word 0x0062, 0x0011, 0x0009, 0x0000
    .byte 0xE0, 0xEE, 0xFA, 0x00
.section .text

# ------------------------------------------------------------------
# fill_fog_rows(y0=edi, y1=esi)
# ------------------------------------------------------------------
.globl fill_fog_rows
fill_fog_rows:
    push rbx
    push r12
    push r13
    mov r12d, edi
    mov r13d, esi
    cmp r12d, r13d
    jg fill_fog_rows_done
    mov ebx, r12d
.globl fill_fog_rows_lp
fill_fog_rows_lp:
    cmp ebx, r13d
    jg fill_fog_rows_done
    xor edi, edi
    mov esi, [px_w]
    mov edx, ebx
    mov ecx, C_FOG
    call hline
    inc ebx
    jmp fill_fog_rows_lp
.globl fill_fog_rows_done
fill_fog_rows_done:
    pop r13
    pop r12
    pop rbx
    ret

# fill_rows_const(y0=edi, y1=esi, x16=edx, hw16=ecx, z16=r8d)
.globl fill_rows_const
fill_rows_const:
    push rbx
    push r12
    push r13
    push r14
    mov r12d, edi
    mov r13d, esi
    mov [tc_x], edx
    mov [tc_hw], ecx
    mov [tc_z], r8d
    mov edi, [p_s]
    add edi, r8d
    call seg_at
    mov r14d, eax
    cmp r12d, r13d
    jg fill_rows_const_done
    mov ebx, r12d
.globl fill_rows_const_lp
fill_rows_const_lp:
    cmp ebx, r13d
    jg fill_rows_const_done
    mov edi, ebx
    mov esi, [tc_x]
    mov edx, [tc_hw]
    mov ecx, r14d
    mov r8d, [tc_z]
    call draw_row
    inc ebx
    jmp fill_rows_const_lp
.globl fill_rows_const_done
fill_rows_const_done:
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# ------------------------------------------------------------------
# draw_row(y=edi, x16=rsi, hw16=rdx, segment=rcx, z16=r8d)
# ------------------------------------------------------------------
.globl draw_row
draw_row:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov r12d, edi              # y
    mov r13d, esi              # centre x (16.16)
    mov r14d, edx              # half width (16.16)
    mov ebx, ecx               # segment index
    mov eax, r8d
    call fog_amt
    mov esi, eax
    mov [row_f], eax
    # ---- grass
    mov edi, C_GRASS_A
    test ebx, 1
    jz draw_row_g1
    mov edi, C_GRASS_B
.globl draw_row_g1
draw_row_g1:
    call fog_mix    # args: edi here, esi is the fog amount computed at entry
    mov [row_grass], eax
    # ---- tarmac
    mov edi, C_ROAD_A
    test ebx, 1
    jz draw_row_r1
    mov edi, C_ROAD_B
.globl draw_row_r1
draw_row_r1:
    call fog_mix    # args: edi here, esi is the fog amount computed at entry
    mov [row_road], eax
    # ---- kerb
    mov edi, C_RUMBLE_W
    test ebx, 1
    jz draw_row_u1
    mov edi, C_RUMBLE_R
.globl draw_row_u1
draw_row_u1:
    call fog_mix    # args: edi here, esi is the fog amount computed at entry
    mov [row_rumble], eax
    # ---- lane paint
    mov edi, C_LINE
    call fog_mix    # args: edi here, esi is the fog amount computed at entry
    mov [row_line], eax
    # ---- kerb width in pixels
    mov eax, r14d
    shr eax, 5
    cmp eax, 1
    jl draw_row_rw1
    mov eax, 1
.globl draw_row_rw1
draw_row_rw1:
    cmp eax, 4
    jle draw_row_rw2
    mov eax, 4
.globl draw_row_rw2
draw_row_rw2:
    mov r15d, eax
    # ---- grass left
    mov eax, r13d
    sub eax, r14d
    sar eax, 16
    sub eax, r15d
    mov esi, eax
    xor edi, edi
    mov edx, r12d
    mov ecx, [row_grass]
    call hline
    # ---- kerb left
    mov eax, r13d
    sub eax, r14d
    sar eax, 16
    mov edi, eax
    mov esi, eax
    add esi, r15d
    mov edx, r12d
    mov ecx, [row_rumble]
    call hline
    # ---- tarmac
    mov eax, r13d
    sub eax, r14d
    sar eax, 16
    add eax, r15d
    mov edi, eax
    mov eax, r13d
    add eax, r14d
    sar eax, 16
    sub eax, r15d
    mov esi, eax
    mov edx, r12d
    mov ecx, [row_road]
    call hline
    # ---- kerb right
    mov eax, r13d
    add eax, r14d
    sar eax, 16
    mov edi, eax
    mov esi, eax
    add esi, r15d
    mov edx, r12d
    mov ecx, [row_rumble]
    call hline
    # ---- grass right
    mov eax, r13d
    add eax, r14d
    sar eax, 16
    add eax, r15d
    mov edi, eax
    mov esi, [px_w]
    mov edx, r12d
    mov ecx, [row_grass]
    call hline
    # ---- dashed lane markings
    mov eax, ebx
    mov ecx, 6
    xor edx, edx
    div ecx
    cmp eax, 3
    jge draw_row_done
    mov eax, r14d
    shr eax, 22
    cmp eax, 1
    jl draw_row_lw1
    jmp draw_row_lw2
.globl draw_row_lw1
draw_row_lw1:
    mov eax, 1
.globl draw_row_lw2
draw_row_lw2:
    mov ebx, eax                 # lane paint width
    # left lane
    mov eax, r13d
    mov edx, r14d
    shr edx, 1
    sub eax, edx
    sar eax, 16
    sub eax, ebx
    mov edi, eax
    mov esi, eax
    add esi, ebx
    mov edx, r12d
    mov ecx, [row_line]
    call hline
    # right lane
    mov eax, r13d
    mov edx, r14d
    shr edx, 1
    add eax, edx
    sar eax, 16
    sub eax, ebx
    mov edi, eax
    mov esi, eax
    add esi, ebx
    mov edx, r12d
    mov ecx, [row_line]
    call hline
.globl draw_row_done
draw_row_done:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# ------------------------------------------------------------------
# render_road(): slice bands, far to near
# ------------------------------------------------------------------
.globl render_road
render_road:
    push rbx
    push rbp
    push r12
    push r13
    push r14
    push r15
    mov r15d, [horizon_y]      # topmost row still unpainted
    mov ebx, [nslice]           # 32-bit: an 8-byte load would pick up slice_e
    dec ebx                    # slice index, far to near
render_road_loop:
    test rbx, rbx
    jz render_road_after
    # ---- screen rows of this depth slice
    mov eax, [slice_sy + rbx*4]
    sar eax, 16
    mov [tb_yf], eax           # far edge of the band
    mov eax, [slice_sy + rbx*4 - 4]
    sar eax, 16
    mov [tb_yn], eax           # near edge of the band
    # ---- haze above the band
    mov edi, r15d
    cmp edi, [tb_yf]
    jge render_road_nohaze
    mov esi, [tb_yf]
    dec esi
    call fill_fog_rows
render_road_nohaze:
    mov eax, [tb_yn]
    sub eax, [tb_yf]
    mov ecx, eax               # signed row count
    cmp eax, 700
    jle render_road_rc1
    mov eax, 700
render_road_rc1:
    cmp ecx, -700
    jge render_road_rows
    mov eax, -700
render_road_rows:
    test eax, eax
    jz render_road_step
    mov [tb_rows], eax
    mov r12d, [tb_yf]          # first row of the band
    cmp [tb_yn], r12d
    jge render_road_st_ok
    mov r12d, [tb_yn]
render_road_st_ok:
    mov eax, r12d
    add eax, [tb_rows]
    mov [tb_end], eax
    mov eax, 0x10000
    cdq
    idiv dword ptr [tb_rows]  # dt = 1/rows
    mov ebp, eax               # dt
    xor r13d, r13d             # t = 0
    # ---- interpolation bases and deltas
    mov esi, [slice_z + rbx*4]
    mov [tb_zf], esi
    mov edi, [slice_z + rbx*4 - 4]
    sub edi, esi
    mov [tb_dz], edi
    mov esi, [slice_sx + rbx*4]
    mov [tb_xf], esi
    mov edi, [slice_sx + rbx*4 - 4]
    sub edi, esi
    mov [tb_dx], edi
    mov esi, [slice_hw + rbx*4]
    mov [tb_hwf], esi
    mov edi, [slice_hw + rbx*4 - 4]
    sub edi, esi
    mov [tb_dhw], edi
render_road_row:
    cmp r12d, [tb_end]
    jge render_road_band_end
    mov edi, [tb_dz]
    mov esi, r13d
    call mul16
    add eax, [tb_zf]
    mov [ob_d], eax
    mov edi, [tb_dx]
    mov esi, r13d
    call mul16
    add eax, [tb_xf]
    mov [ob_x], eax
    mov edi, [tb_dhw]
    mov esi, r13d
    call mul16
    add eax, [tb_hwf]
    mov [ob_hw], eax
    mov edi, [p_s]
    add edi, [ob_d]
    call seg_at
    mov edi, r12d
    mov esi, [ob_x]
    mov edx, [ob_hw]
    mov ecx, eax
    mov r8d, [ob_d]
    call draw_row
    inc r12d
    add r13d, ebp
    jmp render_road_row
render_road_band_end:
    mov edi, ebx
    call draw_band_objs
    mov r15d, [tb_yn]
    dec rbx
    jmp render_road_loop
render_road_step:
    mov edi, ebx
    call draw_band_objs
    mov r15d, [tb_yn]
    dec rbx
    jmp render_road_loop
render_road_after:
    # ---- below the nearest slice: extrapolate the last band
    mov eax, [slice_sy]
    sar eax, 16
    cmp r15d, eax
    jle render_road_last
    mov r15d, eax
render_road_last:
    mov edi, r15d
    mov esi, [px_h]
    dec esi
    cmp edi, esi
    jg render_road_out
    mov edx, [slice_sx]
    mov ecx, [slice_hw]
    mov r8d, [slice_z]
    call fill_rows_const
render_road_out:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbp
    pop rbx
    ret
# ------------------------------------------------------------------
# draw_band_objs(i = edi): every prop whose depth falls in slice band i
# ------------------------------------------------------------------
.globl draw_band_objs
draw_band_objs:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov r12d, edi
    mov r13d, [slice_z + r12*4]   # far edge of the band
    xor ebx, ebx
.globl draw_band_objs_lp
draw_band_objs_lp:
    cmp ebx, NUM_OBJ
    jge draw_band_objs_done
    mov eax, [obj_s + rbx*4]
    sub eax, [p_s]
    cmp eax, Z_NEAR
    jl draw_band_objs_next
    cmp eax, r13d
    jg draw_band_objs_next
    mov [ob_d], eax
    mov edi, [focal]
    mov esi, eax
    call div16
    cmp eax, 0xC000               # under ~0.75 px per metre: too small
    jl draw_band_objs_next
    mov [ob_ppm], eax
    mov eax, [ob_d]
    call fog_amt
    mov [sc2_7], eax
    # ---- screen position
    mov edi, [slice_y + r12*4 - 4]
    add edi, [obj_lat + rbx*4]
    sub edi, [cam_x]
    mov esi, [focal]
    call mul16
    mov edi, eax              # pass the result on in edi
    mov esi, [ob_d]
    call div16
    add eax, [cx0]
    mov [ob_x], eax
    mov edi, [cam_y]
    sub edi, [slice_e + r12*4 - 4]
    mov esi, [focal]
    call mul16
    mov edi, eax              # pass the result on in edi
    mov esi, [ob_d]
    call div16
    neg eax
    add eax, [horizon16]
    mov [ob_y], eax
    # ---- cull off screen
    mov eax, [ob_x]
    cmp eax, -0x40000
    jl draw_band_objs_next
    cmp eax, 0xC0000
    jg draw_band_objs_next
    mov eax, [ob_y]
    cmp eax, -0x40000
    jl draw_band_objs_next
    cmp eax, 0xC0000
    jg draw_band_objs_next
    # ---- draw
    mov eax, [obj_type + rbx*4]
    mov r9d, [sc2_7]
    cmp eax, OBJ_CAR
    je draw_band_objs_car
    cmp eax, OBJ_TREE
    je draw_band_objs_tree
    cmp eax, OBJ_PYLON
    je draw_band_objs_pylon
    mov edi, [ob_x]
    mov esi, [ob_y]
    mov edx, [ob_ppm]
    mov ecx, [obj_col + rbx*4]
    call draw_sign
    jmp draw_band_objs_next
.globl draw_band_objs_car
draw_band_objs_car:
    mov edi, [ob_x]
    mov esi, [ob_y]
    mov edx, [ob_ppm]
    mov ecx, [obj_col + rbx*4]
    xor r8d, r8d
    call draw_car
    jmp draw_band_objs_next
.globl draw_band_objs_tree
draw_band_objs_tree:
    mov edi, [ob_x]
    mov esi, [ob_y]
    mov edx, [ob_ppm]
    mov ecx, [obj_col + rbx*4]
    call draw_tree
    jmp draw_band_objs_next
.globl draw_band_objs_pylon
draw_band_objs_pylon:
    mov edi, [ob_x]
    mov esi, [ob_y]
    mov edx, [ob_ppm]
    xor ecx, ecx
    call draw_pylon
.globl draw_band_objs_next
draw_band_objs_next:
    inc ebx
    jmp draw_band_objs_lp
.globl draw_band_objs_done
draw_band_objs_done:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# ------------------------------------------------------------------
# draw_car(x16=edi, y16=esi, ppm16=edx, colour=ecx, flag=r8d, fog=r9d)
# ------------------------------------------------------------------
.globl draw_car
draw_car:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov [sc], edi
    mov eax, esi
    sar eax, 16
    mov [sc + 4], eax
    mov [sc + 8], edx
    mov [sc + 12], r9d
    mov [sc + 13*4], r8d
    # ---- colours
    mov edi, ecx
    mov esi, [sc + 12]
    call fog_mix    # args: edi here, esi is the fog amount computed at entry
    mov [sc + 3*4], eax
    mov edi, ecx
    mov esi, 0x9E70                # 0.62
    call shade
    mov edi, eax
    mov esi, [sc + 12]
    call fog_mix    # args: edi here, esi is the fog amount computed at entry
    mov [sc + 4*4], eax
    mov edi, C_GLASS
    mov esi, [sc + 12]
    call fog_mix    # args: edi here, esi is the fog amount computed at entry
    mov [sc + 11*4], eax
    mov edi, C_TAIL
    mov esi, [sc + 12]
    call fog_mix    # args: edi here, esi is the fog amount computed at entry
    mov [sc2_2], eax
    # ---- metrics
    mov edi, [sc + 8]
    mov esi, 0xF5C2                # 0.96 m half width
    call mul16
    mov [sc + 5*4], eax
    mov eax, eax
    sar eax, 16
    mov [sc + 6*4], eax
    mov edi, [sc + 8]
    mov esi, 0xB333                # 0.70 m half cabin width
    call mul16
    mov [sc + 7*4], eax
    mov eax, eax
    sar eax, 16
    mov [sc + 8*4 - 4], eax
    mov edi, [sc + 8]
    mov esi, 0x9EB8                # 0.62 m body height
    call mul16
    sar rax, 16
    mov [sc + 9*4], eax
    mov edi, [sc + 8]
    mov esi, 0x852F                # 0.52 m cabin height
    call mul16
    sar rax, 16
    mov [sc + 10*4], eax
    # ---- body roll for the player's car
    cmp dword ptr [sc + 13*4], 0
    je draw_car_no_lean
    mov eax, [p_steer]
    sar eax, 15                   # half a pixel per unit of steer
    mov ecx, [sc + 8]
    shr ecx, 16
    shr ecx, 5
    add ecx, 3
    imul eax, ecx
    mov [sc2_0], eax
    jmp draw_car_lean_done
.globl draw_car_no_lean
draw_car_no_lean:
    mov dword ptr [sc2_0], 0
.globl draw_car_lean_done
draw_car_lean_done:
    # ---- ground shadow
    mov eax, [sc + 6*4]
    add eax, eax
    add eax, 2
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_1], eax
    mov edi, [sc]
    sub edi, [sc2_1]
    mov esi, [sc]
    add esi, [sc2_1]
    mov edx, [sc + 4]
    mov ecx, [sc + 4]
    add ecx, 3
    mov r8d, C_SHADOW
    mov r9d, 120
    call fill_rect_blend
    # ---- body
    mov eax, [sc + 4]
    sub eax, [sc + 9*4]
    mov [sc + 15*4], eax
    mov edi, [sc]
    sub edi, [sc + 5*4]
    mov esi, [sc + 15*4]
    mov edx, [sc]
    add edx, [sc + 5*4]
    mov ecx, [sc + 4]
    mov r8d, [sc + 3*4]
    call fill_rect
    # ---- cabin
    mov eax, [sc + 4]
    sub eax, [sc + 9*4]
    sub eax, [sc + 10*4]
    mov [sc2_3], eax
    mov eax, [sc + 7*4]
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_1], eax
    mov edi, [sc]
    sub edi, [sc2_1]
    add edi, [sc2_0]
    mov esi, [sc]
    add esi, [sc2_1]
    add esi, [sc2_0]
    mov edx, [sc2_3]
    mov ecx, [sc + 15*4]
    inc ecx
    mov r8d, [sc + 4*4]
    call fill_rect
    # ---- windscreen
    mov eax, [sc + 7*4]
    call px16    # args: eax is the pixel height computed at entry
    mov ecx, eax
    mov edi, [sc]
    sub edi, ecx
    add edi, [sc2_0]
    mov esi, [sc]
    add esi, ecx
    add esi, [sc2_0]
    mov edx, [sc2_3]
    add edx, 2
    mov ecx, [sc2_3]
    add ecx, [sc + 10*4]
    shr ecx, 1
    mov r8d, [sc + 11*4]
    call fill_rect
    # ---- tail lights
    mov eax, [sc + 15*4]
    add eax, [sc + 9*4]
    shr eax, 2
    mov [sc2_4], eax
    mov edi, [sc]
    sub edi, [sc + 5*4]
    mov esi, edi
    add esi, 0x3800
    mov edx, [sc2_4]
    mov ecx, edx
    add ecx, 3
    mov r8d, [sc2_2]
    call fill_rect
    mov edi, [sc]
    add edi, [sc + 5*4]
    mov esi, edi
    sub esi, 0x3800
    mov edx, [sc2_4]
    mov ecx, edx
    add ecx, 3
    mov r8d, [sc2_2]
    call fill_rect
    # ---- wheels
    mov eax, [sc + 15*4]
    add eax, [sc + 9*4]
    shr eax, 2
    mov [sc2_5], eax
    mov eax, [sc + 5*4]
    shr eax, 16
    shr eax, 1
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_6], eax
    mov edi, [sc]
    sub edi, [sc2_6]
    mov esi, edi
    add esi, 0x3800
    mov edx, [sc2_5]
    mov ecx, [sc + 4]
    mov r8d, C_BLACK
    call fill_rect
    mov edi, [sc]
    add edi, [sc2_6]
    mov esi, edi
    sub esi, 0x3800
    mov edx, [sc2_5]
    mov ecx, [sc + 4]
    mov r8d, C_BLACK
    call fill_rect
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# ------------------------------------------------------------------
# draw_tree(x16=edi, y16=esi, ppm16=edx, tint=ecx, fog=r9d)
# ------------------------------------------------------------------
.globl draw_tree
draw_tree:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov [dt_x], edi            # screen x (16.16)
    mov eax, esi
    sar eax, 16
    mov [dt_ground], eax       # ground line
    mov [dt_ppm], edx          # pixels per metre
    mov [dt_tint], ecx
    # ---------------- trunk
    mov eax, [dt_ppm]
    shr eax, 4
    cmp eax, 1
    jl draw_tree_tw1
    jmp draw_tree_tw2
draw_tree_tw1:
    mov eax, 1
draw_tree_tw2:
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_0], eax           # trunk half width (16.16)
    mov edi, C_TRUNK
    mov esi, r9d
    call fog_mix    # args: edi here, esi is the fog amount computed at entry
    mov [sc2_1], eax           # trunk colour
    mov eax, [dt_ppm]
    shr eax, 1
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_2], eax           # trunk height (16.16)
    mov eax, [sc2_2]
    sar eax, 16
    mov [dt_th], eax           # trunk height px
    mov edi, [dt_x]
    sub edi, [sc2_0]
    mov esi, [dt_ground]
    sub esi, [dt_th]
    mov edx, [dt_x]
    add edx, [sc2_0]
    mov ecx, [dt_ground]
    mov r8d, [sc2_1]
    call fill_rect
    # ---------------- canopy
    mov eax, [dt_ppm]
    imul eax, eax, 23
    shr eax, 3                 # canopy height ~ 2.9 m
    mov [sc2_3], eax
    mov eax, [dt_th]
    add eax, [sc2_3]
    mov [dt_apex], eax
    mov eax, [dt_ppm]
    imul eax, eax, 3
    shr eax, 1                 # base half width ~ 1.5 m
    mov [sc2_5], eax
    mov eax, [sc2_3]
    test eax, eax
    jg draw_tree_rows
    mov eax, 1
draw_tree_rows:
    mov ebp, eax               # rows (callee saved)
    mov eax, 0x10000
    cdq
    idiv ebp                   # fraction step (0..65536 == 0..1)
    mov [sc2_6], eax
    xor ebx, ebx               # fraction accumulator
    mov r12d, [dt_apex]        # current row
draw_tree_row:
    cmp r12d, [dt_ground]
    jge draw_tree_done
    mov eax, [sc2_5]
    imul rax, rbx
    sar rax, 16                # half width in pixels
    mov [sc2_7], eax
    mov ecx, ebx
    shr ecx, 8
    cmp ecx, 256
    jle draw_tree_tint
    mov ecx, 256
draw_tree_tint:
    mov edi, C_LEAF_A
    mov esi, C_LEAF_B
    call lerp_color    # args: ecx is the blend factor set by the caller
    mov edi, eax
    mov esi, r9d
    call fog_mix    # args: edi here, esi is the fog amount computed at entry
    mov [sc2_1], eax           # leaf colour for this row
    mov eax, [sc2_7]
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_0], eax
    mov edi, [dt_x]
    sub edi, [sc2_0]
    mov esi, [dt_x]
    add esi, [sc2_0]
    mov edx, r12d
    mov ecx, [sc2_1]
    call hline
    inc r12d
    add ebx, [sc2_6]
    jmp draw_tree_row
draw_tree_done:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret
# ------------------------------------------------------------------
# draw_pylon(x16=edi, y16=esi, ppm16=edx, unused=ecx, fog=r9d)
# ------------------------------------------------------------------
.globl draw_pylon
draw_pylon:
    push rbx
    push r12
    push r13
    mov r12d, edi
    mov eax, esi
    sar eax, 16
    mov r13d, eax
    mov ebx, edx
    shr ebx, 16
    shr ebx, 3
    cmp ebx, 1
    jl draw_pylon_w1
    jmp draw_pylon_w2
.globl draw_pylon_w1
draw_pylon_w1:
    mov ebx, 1
.globl draw_pylon_w2
draw_pylon_w2:
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_0], eax
    mov eax, ebx
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_1], eax
    mov edi, r12d
    sub edi, [sc2_0]
    mov esi, r13d
    sub esi, [sc2_1]
    mov edx, r12d
    add edx, [sc2_0]
    mov ecx, r13d
    mov r8d, C_WHITE
    call fill_rect
    mov edi, r12d
    sub edi, [sc2_0]
    mov esi, r13d
    sub esi, [sc2_1]
    mov edx, r12d
    add edx, [sc2_0]
    mov ecx, esi
    add ecx, [sc2_1]
    shr ecx, 2
    cmp ecx, esi
    jg draw_pylon_done
    mov r8d, C_RUMBLE_R
    call fill_rect
.globl draw_pylon_done
draw_pylon_done:
    pop r13
    pop r12
    pop rbx
    ret

# ------------------------------------------------------------------
# draw_sign(x16=edi, y16=esi, ppm16=edx, colour=ecx, fog=r9d)
# ------------------------------------------------------------------
.globl draw_sign
draw_sign:
    push rbx
    push r12
    push r13
    push r14
    mov r12d, edi
    mov eax, esi
    sar eax, 16
    mov r13d, eax
    mov r14d, edx                 # ppm
    # ---- board colour, fogged
    mov edi, ecx
    mov esi, r9d
    call fog_mix    # args: edi here, esi is the fog amount computed at entry
    mov [sc2_0], eax
    # ---- posts
    mov eax, r14d
    shr eax, 16
    shr eax, 4
    cmp eax, 1
    jl draw_sign_pw1
    jmp draw_sign_pw2
.globl draw_sign_pw1
draw_sign_pw1:
    mov eax, 1
.globl draw_sign_pw2
draw_sign_pw2:
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_1], eax
    mov eax, r14d
    shr eax, 15                   # ~2.5 m posts
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_2], eax
    mov edi, r12d
    sub edi, [sc2_1]
    mov esi, r13d
    sub esi, [sc2_2]
    mov edx, r12d
    add edx, [sc2_1]
    mov ecx, r13d
    mov r8d, C_SHADOW
    call fill_rect
    # ---- board
    mov eax, r14d
    shr eax, 14                   # ~4 m wide
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_3], eax
    mov eax, r14d
    shr eax, 16
    shr eax, 4
    call px16    # args: eax is the pixel height computed at entry
    mov [sc2_4], eax              # ~1.5 m tall
    mov edi, r12d
    sub edi, [sc2_3]
    mov esi, r13d
    sub esi, [sc2_2]
    mov edx, r12d
    add edx, [sc2_3]
    mov ecx, r13d
    sub ecx, [sc2_2]
    add ecx, [sc2_4]
    mov r8d, [sc2_0]
    call fill_rect
    # ---- white stripe
    mov edi, r12d
    sub edi, [sc2_3]
    mov esi, r13d
    sub esi, [sc2_2]
    add esi, [sc2_4]
    shr esi, 1
    mov edx, r12d
    add edx, [sc2_3]
    mov ecx, esi
    add ecx, 3
    mov r8d, 0xF0F0F0
    call fill_rect
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# ------------------------------------------------------------------
# render_player(): the player's own car, projected like everything else
# ------------------------------------------------------------------
.globl render_player
render_player:
    push rbx
    push r12
    push r13
    mov eax, [p_v]
    shr eax, 6
    add eax, (4 * FP)
    mov [sc2_3], eax              # depth of the car behind the camera
    mov edi, [focal]
    mov esi, [sc2_3]
    call div16
    mov [sc2_4], eax              # pixels per metre
    mov edi, [p_x]
    sub edi, [cam_x]
    mov esi, [focal]
    call mul16
    mov edi, eax              # pass the result on in edi
    mov esi, [sc2_3]
    call div16
    add eax, [cx0]
    mov [sc2_5], eax
    mov edi, [cam_y]
    sub edi, [p_elev]
    mov esi, [focal]
    call mul16
    mov edi, eax              # pass the result on in edi
    mov esi, [sc2_3]
    call div16
    neg eax
    add eax, [horizon16]
    mov [sc2_6], eax
    xor r9d, r9d
    mov edi, [sc2_5]
    mov esi, [sc2_6]
    mov edx, [sc2_4]
    mov ecx, 0xE84028
    mov r8d, 1
    call draw_car
    pop r13
    pop r12
    pop rbx
    ret

# ------------------------------------------------------------------
# render_hud()
# ------------------------------------------------------------------
.globl render_hud
render_hud:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov r12d, [px_w]
    mov r13d, [px_h]
    # ---- impact flash
    mov eax, [crash_t]
    cmp eax, 0x5000
    jl render_hud_flash_done
    xor edi, edi
    xor esi, esi
    mov edx, r12d
    mov ecx, r13d
    mov r8d, C_BAD
    mov r9d, 70
    call fill_rect_blend
.globl render_hud_flash_done
render_hud_flash_done:
    # ---- progress bar
    xor edi, edi
    xor esi, esi
    mov edx, r12d
    mov ecx, 3
    mov r8d, C_BARBG
    call fill_rect
    mov eax, [p_s]              # 32-bit: an 8-byte load reads past it
    mov rcx, r12
    imul rax, rcx                # p_s (16.16) * width
    mov rcx, TRACK_LEN16         # divide by the 16.16 track length, or the bar
    xor edx, edx                 # comes out 65536 times too wide
    div rcx
    cmp eax, 2
    jge render_hud_bar_ok
    mov eax, 2
.globl render_hud_bar_ok
render_hud_bar_ok:
    xor edi, edi
    xor esi, esi
    mov edx, eax
    mov ecx, 3
    mov r8d, C_ACCENT
    call fill_rect
    # ---- speed, bottom left
    mov eax, [p_v]
    mov edi, eax
    mov esi, 0x399CA               # 3.6 -> km/h
    call mul16
    sar rax, 16
    cmp eax, 0
    jge render_hud_kmh_ok
    xor eax, eax
.globl render_hud_kmh_ok
render_hud_kmh_ok:
    mov [tmp_a], eax
    # The bottom corners are two rows: a scale-1 label over a scale-2 number.
    # Putting the unit beside the number on the same row does not fit -- a
    # three-digit scale-2 number is 36 pixels, so KM/H + number + number + TIME
    # comes to about 120 and the default terminal is 100 columns.
    #
    # The label row only appears when there is room for it: below 34 rows the
    # centre message and the labels want the same 12 pixels, and the number
    # matters more than the word next to it.
    cmp r13d, 68
    jl render_hud_no_kmh
    mov edi, 4
    mov esi, r13d
    sub esi, 33
    lea rdx, [s_kmh]
    mov ecx, C_HUD
    mov r8d, 1
    call draw_text
.globl render_hud_no_kmh
render_hud_no_kmh:
    mov edi, 4
    mov esi, r13d
    sub esi, 17
    mov edx, [tmp_a]
    mov ecx, 2
    mov r8d, C_SUN
    call draw_uint
    # ---- time, bottom right
    mov eax, [race_time]
    mov edi, eax
    mov esi, 0xA0000               # tenths of a second.  This was 0xA000, which
    call mul16                     # is 0.625 -- five eighths -- so the clock ran
    sar rax, 16                    # at a sixteenth of the rate it should
    mov [tmp_b], eax
    cmp r13d, 68
    jl render_hud_no_time
    mov edi, r12d
    sub edi, 4
    mov esi, r13d
    sub esi, 33
    lea rdx, [s_time]
    mov ecx, C_HUD
    mov r8d, 1
    call draw_text_end
.globl render_hud_no_time
render_hud_no_time:
    mov edi, r12d
    sub edi, 4
    mov esi, r13d
    sub esi, 17
    mov edx, [tmp_b]
    mov ecx, 2
    mov r8d, C_ACCENT
    call draw_uint_end
    # ---- distance, top left
    mov edi, 4
    mov esi, 4
    lea rdx, [s_dist]
    mov ecx, C_HUD
    mov r8d, 1
    call draw_text
    mov eax, [p_s]
    mov edi, eax
    # metres -> tenths of a kilometre.  mul16 then shifts by 16, so this divides
    # p_s by 65536/K; 65536/656 is 99.94, which is the closest an integer gets to
    # a clean 100 without the quotient overflowing 32 bits.  K = 65536/100 would
    # be exact and also fit, but K has to be an integer, and anything near 0x1999A
    # pushes the result of a 9.6 km run past 2^32 and comes out as noise.
    mov esi, 656
    call mul16
    sar rax, 16
    mov [tmp_c], eax
    mov eax, [tmp_c]
    mov ecx, 10
    xor edx, edx
    div ecx
    mov [tmp_d], eax               # whole kilometres
    mov [tmp_e], edx               # tenths of a kilometre
    # All scale 1 here, so a glyph is 6 pixels including its gap and the whole
    # kilometre part is at most two of them.  The point, the tenths and KM follow
    # the field, shifted by one glyph when it is only one digit wide, so "2.5"
    # does not come out as "2 .5".  KM ends at x=69, clear of OVER at 72 on a
    # 100-column terminal.
    mov edi, 34
    mov esi, 4
    mov edx, [tmp_d]
    mov ecx, 1
    mov r8d, C_HUD
    call draw_uint
    xor dword ptr [tmp_f], 0
    cmp dword ptr [tmp_d], 10
    jl render_hud_dist_narrow
    mov dword ptr [tmp_f], 6
.globl render_hud_dist_narrow
render_hud_dist_narrow:
    mov edi, 40
    add edi, [tmp_f]
    mov esi, 4
    lea rdx, [s_dot]
    mov ecx, C_HUD
    mov r8d, 1
    call draw_text
    mov edi, 46
    add edi, [tmp_f]
    mov esi, 4
    mov edx, [tmp_e]
    mov ecx, 1
    mov r8d, C_HUD
    call draw_uint
    mov edi, 52
    add edi, [tmp_f]
    mov esi, 4
    lea rdx, [s_km]
    mov ecx, C_HUD
    mov r8d, 1
    call draw_text
    # ---- overtakes, top right
    mov edi, r12d
    sub edi, 4
    mov esi, 4
    lea rdx, [s_over]
    mov ecx, C_HUD
    mov r8d, 1
    call draw_text_end
    mov edi, r12d
    sub edi, 4
    mov esi, 11
    mov edx, [overtakes]
    mov ecx, 1
    mov r8d, C_HUD
    call draw_uint_end
    # ---- centre messages
    mov eax, [state]
    cmp eax, ST_COUNT
    je render_hud_countdown
    cmp eax, ST_DONE
    je render_hud_finish
    mov eax, [p_x]
    call abs16
    cmp eax, ROAD_HALF
    jle render_hud_no_off
    mov eax, [frame_no]
    and eax, 6
    jnz render_hud_no_off
    lea rdi, [s_off]
    mov esi, r13d
    shr esi, 2
    add esi, 2               # clear of the top readouts, which end at px_h/8+13
    mov edx, C_WARN
    mov ecx, 2
    call draw_text_center
.globl render_hud_no_off
render_hud_no_off:
    mov eax, [crash_t]
    test eax, eax
    jz render_hud_out
    lea rdi, [s_crash]
    mov esi, r13d
    shr esi, 3
    mov edx, C_BAD
    mov ecx, 2
    call draw_text_center
    jmp render_hud_out
.globl render_hud_countdown
render_hud_countdown:
    mov eax, [countdown]
    sar eax, 16
    cmp eax, 1
    jle render_hud_go
    cmp eax, 2
    jle render_hud_two
    mov eax, 3
    jmp render_hud_show
.globl render_hud_two
render_hud_two:
    mov eax, 2
    jmp render_hud_show
.globl render_hud_go
render_hud_go:
    lea rdi, [s_go]
    mov esi, r13d
    shr esi, 2
    add esi, 2               # clear of the top readouts, which end at px_h/8+13
    mov edx, C_ACCENT
    mov ecx, 3
    call draw_text_center
    jmp render_hud_out
.globl render_hud_show
render_hud_show:
    add eax, 0x30
    mov byte ptr [numbuf], al
    mov byte ptr [numbuf + 1], 0
    lea rdi, [numbuf]
    mov esi, r13d
    shr esi, 2
    add esi, 2               # clear of the top readouts, which end at px_h/8+13
    mov edx, C_HUD
    mov ecx, 3
    call draw_text_center
    jmp render_hud_out
.globl render_hud_finish
render_hud_finish:
    lea rdi, [s_fin]
    mov esi, r13d
    shr esi, 2
    add esi, 2               # clear of the top readouts, which end at px_h/8+13
    mov edx, C_SUN
    mov ecx, 2
    call draw_text_center
    lea rdi, [s_again]
    mov esi, r13d
    sub esi, 24               # just above the bottom readouts, under FINISH
    mov edx, C_HUD
    mov ecx, 1
    call draw_text_center
.globl render_hud_out
render_hud_out:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# ------------------------------------------------------------------
# render_frame(): one complete picture
# ------------------------------------------------------------------
.globl render_frame
render_frame:
    push rbx
    push r12
    push r13
    # ---- focal length: 0.9 screen widths, kept in 16.16 pixels because every
#      projection does mul16/div16 against it
    mov edi, [px_w]              # mul16 takes (edi, esi)
    mov esi, 0xE666
    call mul16
    call px16                    # pixels -> 16.16
    mov [focal], eax
    # ---- horizon, including camera shake
    mov eax, [px_h]
    imul eax, eax, 45
    mov ecx, 100
    xor edx, edx
    div ecx
    mov r12d, eax
    mov edi, [shake]
    mov esi, 0x30000
    call mul16
    add r12d, eax
    cmp r12d, 6
    jge render_frame_hz1
    mov r12d, 6
.globl render_frame_hz1
render_frame_hz1:
    mov eax, [px_h]
    sub eax, 8
    cmp r12d, eax
    jle render_frame_hz2
    mov r12d, eax
.globl render_frame_hz2
render_frame_hz2:
    mov [horizon_y], r12d
    mov eax, r12d
    shl eax, 16
    mov [horizon16], eax
    call draw_sky
    call build_slices
    call project_slices
    call render_road
    call render_player
    call render_hud
    pop r13
    pop r12
    pop rbx
    ret

# ------------------------------------------------------------------
# write_ppm(path = rdi)  -- binary PPM, for screenshots
# ------------------------------------------------------------------
.globl write_ppm
write_ppm:
    push rbx
    push r12
    push r13
    push r14
    push r15
    mov rbx, rdi
    mov edi, 0x241                # O_WRONLY|O_CREAT|O_TRUNC
    mov esi, 0666
    xor edx, edx
    mov eax, SYS_open
    syscall
    test eax, eax
    js write_ppm_fail
    mov r12d, eax
    mov dword ptr [hdroff], 0
    mov edi, 0x50
    call hdr_ch
    mov edi, 0x36
    call hdr_ch
    mov edi, 10
    call hdr_ch
    mov edi, [px_w]
    call hdr_num
    mov edi, 32
    call hdr_ch
    mov edi, [px_h]
    call hdr_num
    mov edi, 10
    call hdr_ch
    mov edi, 255
    call hdr_num
    mov edi, 10
    call hdr_ch
    mov edi, r12d
    lea rsi, [hdrbuf]
    mov edx, [hdroff]
    call write_all
    mov r13d, [px_h]
    xor r14d, r14d
.globl write_ppm_row
write_ppm_row:
    cmp r14d, r13d
    jge write_ppm_close
    mov r15d, [px_w]
    xor ecx, ecx
    xor ebx, ebx
.globl write_ppm_px
write_ppm_px:
    cmp ebx, r15d
    jge write_ppm_px_done
    mov eax, r14d
    imul eax, [px_w]
    add eax, ebx
    mov edx, [fb + rax*4]
    mov byte ptr [rowbuf + rcx], dl
    shr edx, 8
    mov byte ptr [rowbuf + rcx + 1], dl
    shr edx, 8
    mov byte ptr [rowbuf + rcx + 2], dl
    add ecx, 3
    inc ebx
    jmp write_ppm_px
.globl write_ppm_px_done
write_ppm_px_done:
    mov edi, r12d
    lea rsi, [rowbuf]
    mov edx, r15d
    imul edx, edx, 3
    call write_all
    inc r14d
    jmp write_ppm_row
.globl write_ppm_close
write_ppm_close:
    mov edi, r12d
    call sys_close
    jmp write_ppm_out
.globl write_ppm_fail
write_ppm_fail:
    lea rdi, [s_err]
    call print
.globl write_ppm_out
write_ppm_out:
    pop r15
    pop r14
    pop r13
    pop r12
    pop rbx
    ret

# ------------------------------------------------------------------
# terminal setup / teardown
# ------------------------------------------------------------------
# clear_fb(): zero the whole framebuffer.  .bss is zero on a normal load, but
# nothing should depend on that -- leftover bytes show up as garbage wherever
# a frame fails to cover the screen.
.globl clear_fb
clear_fb:
    push rdi
    push rcx
    lea rdi, [fb]
    mov ecx, (SCR_MAXW * SCR_MAXH)
    xor eax, eax
    call fill32
    pop rcx
    pop rdi
    ret

.globl init_term
init_term:
    push rbx
    mov dword ptr [scr_cols], 100
    mov dword ptr [scr_rows], 36
    mov edi, 1
    mov esi, TIOCGWINSZ
    lea rdx, [winsize]
    call sys_ioctl
    test eax, eax
    jnz init_term_size
    movzx eax, word ptr [winsize + 2]
    test eax, eax
    jz init_term_size
    mov [scr_cols], eax
    movzx eax, word ptr [winsize]
    test eax, eax
    jz init_term_size
    mov [scr_rows], eax
.globl init_term_size
init_term_size:
    cmp dword ptr [opt_cols], 0
    je init_term_nocols
    mov eax, [opt_cols]
    mov [scr_cols], eax
.globl init_term_nocols
init_term_nocols:
    cmp dword ptr [opt_rows], 0
    je init_term_clamp
    mov eax, [opt_rows]
    mov [scr_rows], eax
.globl init_term_clamp
init_term_clamp:
    mov eax, [scr_cols]
    cmp eax, 40
    jge init_term_c1
    mov dword ptr [scr_cols], 40
.globl init_term_c1
init_term_c1:
    cmp eax, SCR_MAXW
    jle init_term_c2
    mov dword ptr [scr_cols], SCR_MAXW
.globl init_term_c2
init_term_c2:
    mov eax, [scr_rows]
    cmp eax, 16
    jge init_term_r1
    mov dword ptr [scr_rows], 16
.globl init_term_r1
init_term_r1:
    cmp eax, SCR_MAXH / 2
    jle init_term_r2
    mov dword ptr [scr_rows], SCR_MAXH / 2
.globl init_term_r2
init_term_r2:
    mov eax, [scr_cols]
    mov [px_w], eax
    mov eax, [scr_rows]
    add eax, eax
    mov [px_h], eax
    # ---- raw mode on stdin
    mov edi, 0
    mov esi, TCGETS
    lea rdx, [termios_save]
    call sys_ioctl
    test eax, eax
    jnz init_term_done
    mov byte ptr [tty_ok], 1
    mov rdi, [termios_save]
    mov [termios_new], rdi
    mov rdi, [termios_save + 8]
    mov [termios_new + 8], rdi
    mov rdi, [termios_save + 16]
    mov [termios_new + 16], rdi
    mov rdi, [termios_save + 24]
    mov [termios_new + 24], rdi
    mov eax, [termios_new]
    and eax, 0xFFFFFEFF            # ~ICRNL
    and eax, 0xFFFFFBFF            # ~IXON
    mov [termios_new], eax
    mov eax, [termios_new + 12]
    and eax, 0xFFFFFFF1            # ~ICANON|~ECHO|~ISIG
    mov [termios_new + 12], eax
    mov byte ptr [termios_new + 22], 0   # VTIME
    mov byte ptr [termios_new + 23], 0   # VMIN
    mov edi, 0
    mov esi, TCSETS
    lea rdx, [termios_new]
    call sys_ioctl
.globl init_term_done
init_term_done:
    call clear_fb
    pop rbx
    ret

.globl restore_term
restore_term:
    cmp byte ptr [tty_ok], 0
    je restore_term_done
    mov edi, 0
    mov esi, TCSETS
    lea rdx, [termios_save]
    call sys_ioctl
.globl restore_term_done
restore_term_done:
    ret

# ------------------------------------------------------------------
# keyboard
# ------------------------------------------------------------------
.globl poll_keys
poll_keys:
    push rbx
    push r12
    push r13
    mov dword ptr [key_up], 0
    mov dword ptr [key_down], 0
    mov dword ptr [key_left], 0
    mov dword ptr [key_right], 0
    # The key flags are cleared above and only set by what a read returns, so a
    # throttle latched once from outside is gone by the time the frame looks at
    # it.  Headless mode latches it here instead, every frame.
    cmp dword ptr [sticky_throttle], 0
    je poll_keys_read
    mov dword ptr [key_up], 1
.globl poll_keys_read
poll_keys_read:
    xor edi, edi
    lea rsi, [keybuf]
    mov edx, 8
    call sys_read
    test eax, eax
    jle poll_keys_done
    cmp eax, 8
    jle poll_keys_small
    mov eax, 8
.globl poll_keys_small
poll_keys_small:
    mov r12d, eax
    xor r13d, r13d
.globl poll_keys_ch
poll_keys_ch:
    cmp r13d, r12d
    jge poll_keys_read
    movzx ebx, byte ptr [keybuf + r13]
    call key_handle
    inc r13d
    jmp poll_keys_ch
.globl poll_keys_done
poll_keys_done:
    pop r13
    pop r12
    pop rbx
    ret

# key_handle(byte = bl)
.globl key_handle
key_handle:
    push r12
    movzx eax, bl
    cmp dword ptr [esc_state], 0
    je key_handle_norm
    cmp dword ptr [esc_state], 1
    je key_handle_esc1
    mov dword ptr [esc_state], 0
    cmp al, 'A'
    je key_handle_up
    cmp al, 'B'
    je key_handle_down
    cmp al, 'C'
    je key_handle_right
    cmp al, 'D'
    je key_handle_left
    pop r12
    ret
.globl key_handle_esc1
key_handle_esc1:
    cmp al, '['
    je key_handle_seq
    cmp al, 'O'
    je key_handle_seq
    mov dword ptr [esc_state], 0
    mov dword ptr [want_quit], 1
    pop r12
    ret
.globl key_handle_seq
key_handle_seq:
    mov dword ptr [esc_state], 2
    pop r12
    ret
.globl key_handle_norm
key_handle_norm:
    cmp al, 0x1b
    je key_handle_esc
    cmp eax, 3
    je key_handle_quit
    cmp al, 'q'
    je key_handle_quit
    cmp al, 'Q'
    je key_handle_quit
    cmp al, 'r'
    je key_handle_restart
    cmp al, 'R'
    je key_handle_restart
    cmp al, 'p'
    je key_handle_shot
    cmp al, 'P'
    je key_handle_shot
    cmp al, 'w'
    je key_handle_up
    cmp al, 'W'
    je key_handle_up
    cmp al, 0x20
    je key_handle_up
    cmp al, 's'
    je key_handle_down
    cmp al, 'S'
    je key_handle_down
    cmp al, 'a'
    je key_handle_left
    cmp al, 'A'
    je key_handle_left
    cmp al, 'd'
    je key_handle_right
    cmp al, 'D'
    je key_handle_right
    pop r12
    ret
.globl key_handle_esc
key_handle_esc:
    mov dword ptr [esc_state], 1
    pop r12
    ret
.globl key_handle_up
key_handle_up:
    mov dword ptr [key_up], 1
    pop r12
    ret
.globl key_handle_down
key_handle_down:
    mov dword ptr [key_down], 1
    pop r12
    ret
.globl key_handle_left
key_handle_left:
    mov dword ptr [key_left], 1
    pop r12
    ret
.globl key_handle_right
key_handle_right:
    mov dword ptr [key_right], 1
    pop r12
    ret
.globl key_handle_quit
key_handle_quit:
    mov dword ptr [want_quit], 1
    pop r12
    ret
.globl key_handle_restart
key_handle_restart:
    mov dword ptr [want_restart], 1
    pop r12
    ret
.globl key_handle_shot
key_handle_shot:
    mov dword ptr [want_shot], 1
    pop r12
    ret

# ===================================================================
#                              entry
# ===================================================================
.globl _start
_start:
    mov r12, [rsp]                # argc
    lea r13, [rsp + 8]            # argv
    mov r14d, 1
.globl _start_args
_start_args:
    cmp r14d, r12d
    jge _start_args_done
    mov r15, [r13 + r14*8]
    mov rdi, r15
    lea rsi, [o_help]
    call streq
    test eax, eax
    jnz _start_help
    mov rdi, r15
    lea rsi, [o_frames]
    call streq
    test eax, eax
    jnz _start_frames
    mov rdi, r15
    lea rsi, [o_shot]
    call streq
    test eax, eax
    jnz _start_shot
    mov rdi, r15
    lea rsi, [o_cols]
    call streq
    test eax, eax
    jnz _start_cols
    mov rdi, r15
    lea rsi, [o_rows]
    call streq
    test eax, eax
    jnz _start_rows
    mov rdi, r15
    lea rsi, [o_demo]
    call streq
    test eax, eax
    jnz _start_demo
    mov rdi, r15
    lea rsi, [o_seed]
    call streq
    test eax, eax
    jnz _start_seed
    jmp _start_next
.globl _start_seed
_start_seed:
    inc r14d
    cmp r14d, r12d
    jge _start_args_done
    mov r15, [r13 + r14*8]
    mov rdi, r15
    call str2int
    mov [opt_seed], eax
    jmp _start_next
.globl _start_demo
_start_demo:
    inc r14d
    cmp r14d, r12d
    jge _start_args_done
    mov r15, [r13 + r14*8]
    mov rdi, r15
    call str2int
    mov [opt_demo], eax
    jmp _start_next
.globl _start_rows
_start_rows:
    inc r14d
    cmp r14d, r12d
    jge _start_args_done
    mov r15, [r13 + r14*8]
    mov rdi, r15
    call str2int
    mov [opt_rows], eax
    jmp _start_next
.globl _start_cols
_start_cols:
    inc r14d
    cmp r14d, r12d
    jge _start_args_done
    mov r15, [r13 + r14*8]
    mov rdi, r15
    call str2int
    mov [opt_cols], eax
    jmp _start_next
.globl _start_shot
_start_shot:
    inc r14d
    cmp r14d, r12d
    jge _start_args_done
    mov r15, [r13 + r14*8]
    lea rdi, [shot_path]
    mov rsi, r15
    call strcpy
    mov dword ptr [opt_shot], 1
    jmp _start_next
.globl _start_frames
_start_frames:
    inc r14d
    cmp r14d, r12d
    jge _start_args_done
    mov r15, [r13 + r14*8]
    mov rdi, r15
    call str2int
    mov [opt_frames], eax
    jmp _start_next
.globl _start_help
_start_help:
    lea rdi, [s_help1]
    call print
    lea rdi, [s_help2]
    call print
    lea rdi, [s_help3]
    call print
    lea rdi, [s_help4]
    call print
    lea rdi, [s_help5]
    call print
    lea rdi, [s_help6]
    call print
    lea rdi, [s_help7]
    call print
    mov edi, 0
    call sys_exit
.globl _start_next
_start_next:
    inc r14d
    jmp _start_args
.globl _start_args_done
_start_args_done:
    call init_term
    # ---- seed the generator
    mov eax, [opt_seed]
    test eax, eax
    jnz _start_seed_ok
    mov eax, 0x2545F491
.globl _start_seed_ok
_start_seed_ok:
    mov [rng_s], eax
    call gen_track
    call reset_race
    # Always populate the object table.  Leaving it as whatever the loader put
    # in .bss makes update_objects draw garbage sprites across the screen.
    call init_objects
    # ---- --demo drops the car in at speed for screenshots
    cmp dword ptr [opt_demo], 0
    je _start_nodemo
    mov eax, [opt_demo]
    shl eax, 16
    mov [p_s], eax
    mov dword ptr [p_v], (60 * FP)
    mov dword ptr [state], ST_RACE
.globl _start_nodemo
_start_nodemo:
    cmp dword ptr [opt_shot], 0
    je _start_frames_check
    call render_frame
    lea rdi, [shot_path]
    cmp byte ptr [shot_path], 0
    jne _start_shot_ok
    lea rdi, [shot_default]
.globl _start_shot_ok
_start_shot_ok:
    call write_ppm
    call restore_term
    mov edi, 0
    call sys_exit
.globl _start_frames_check
_start_frames_check:
    cmp dword ptr [opt_frames], 0
    je _start_loop
    # Headless mode has no keyboard, so hold the throttle down: without this the
    # car just sits there and every frame is identical.  poll_keys clears the
    # key flags at the top of every frame, so this latches a sticky flag that it
    # re-asserts rather than setting the key directly.
    mov dword ptr [sticky_throttle], 1
    call now_ms
    mov [prev_ms], eax
    jmp _start_frame
.globl _start_loop
_start_loop:
    call now_ms
    mov [prev_ms], eax
.globl _start_frame
_start_frame:
    call poll_keys
    cmp dword ptr [want_quit], 0
    jne _start_quit
    cmp dword ptr [want_restart], 0
    je _start_norestart
    mov dword ptr [want_restart], 0
    call reset_race
.globl _start_norestart
_start_norestart:
    # ---- frame timing.  Keep the wall clock in prev_ms and take the delta
    # against it; storing the delta back into the clock would make every dt
    # the running sum of all the previous ones.
    call now_ms
    mov ecx, [prev_ms]
    mov [prev_ms], eax
    sub eax, ecx              # delta in milliseconds
    cmp eax, 5
    jge _start_dt_min         # >= 5 is fine; below that the minimum applies.
    mov eax, 5                # This used to be `jl`, which jumped *past* this
.globl _start_dt_min        # mov -- so a sub-millisecond delta, i.e. every frame
_start_dt_min:              # of a fast headless run, reached the game as zero and
    cmp eax, 40               # nothing ever moved.
    jle _start_dt_ok
    mov eax, 40
.globl _start_dt_ok
_start_dt_ok:
    mov [tmp_b], ecx
    mov edi, eax              # the clamped delta, not ecx: ecx is the previous
    mov rax, rdi              # timestamp, and feeding that to step_game as the
    shl rax, 16               # frame time is a very large number of seconds.
    xor edx, edx              # The shift has to be on rax, which div reads as the
    mov ecx, 1000             # dividend -- shifting edi left the dividend
    div ecx                    # unscaled, so the delta came out as delta/1000
    mov edi, eax              # and every frame time was zero
    call step_game
    mov edi, [tmp_b]
    call update_objects
    call render_frame
    call present
    cmp dword ptr [want_shot], 0
    je _start_noshot
    mov dword ptr [want_shot], 0
    lea rdi, [shot_default]
    call write_ppm
.globl _start_noshot
_start_noshot:
    inc dword ptr [frame_no]
    mov eax, [opt_frames]
    test eax, eax
    jz _start_frame
    mov ecx, [frame_no]
    cmp ecx, eax
    jl _start_frame
.globl _start_quit
_start_quit:
    call restore_term
    mov edi, 0
    call sys_exit

# ===================================================================
#                        probe entry point
# ===================================================================
# Linked as `ld -e probe -T car.o`.  It runs the simulation headless with no
# terminal and reports the state the loop actually reaches, which is the one
# question a rendered frame cannot answer: whether the car moved at all.
.section .text
.globl probe
probe:
    mov dword ptr [scr_cols], 100
    mov dword ptr [scr_rows], 36
    mov dword ptr [px_w], 100
    mov dword ptr [px_h], 72
    mov dword ptr [opt_cols], 100
    mov dword ptr [opt_rows], 36
    mov dword ptr [rng_s], 0x2545F491
    call gen_track
    call reset_race
    call init_objects
    mov dword ptr [sticky_throttle], 1
    mov dword ptr [prev_ms], 0xFFFFFFFF     # so the first delta is a large delta
    xor r13d, r13d                          # frame counter
probe_loop:
    call poll_keys                         # the real path, sticky throttle included
    # the real frame timing, copied from _start_frame, so the delta can be seen
    call now_ms
    mov ecx, [prev_ms]
    mov [prev_ms], eax
    sub eax, ecx
    cmp eax, 5
    jge probe_dt_min
    mov eax, 5
probe_dt_min:
    cmp eax, 40
    jle probe_dt_ok
    mov eax, 40
probe_dt_ok:
    mov [tmp_d], eax
    mov edi, eax
    mov rax, rdi
    shl rax, 16
    xor edx, edx
    mov ecx, 1000
    div ecx
    mov edi, eax
    call step_game
    cmp r13d, 3
    jge probe_no_dt
    lea rdi, [probe_msg6]
    call print
    mov edi, [tmp_d]
    call probe_num
    lea rdi, [probe_nl]
    call print
probe_no_dt:
    inc r13d
    cmp r13d, 1200                    # 1200 * 5 ms = 6 s: the countdown is 3 s
    jl probe_loop
    lea rdi, [probe_msg1]
    call print
    mov edi, [state]
    call probe_num
    lea rdi, [probe_msg2]
    call print
    mov edi, [countdown]
    sar edi, 16
    call probe_num
    lea rdi, [probe_msg3]
    call print
    mov edi, [p_v]
    sar edi, 16
    call probe_num
    lea rdi, [probe_msg4]
    call print
    mov eax, [p_s]
    sar eax, 16
    mov edi, eax
    call probe_num
    lea rdi, [probe_msg5]
    call print
    mov edi, [race_time]
    sar edi, 16
    call probe_num
    lea rdi, [probe_nl]
    call print
    mov edi, 0
    call sys_exit

# probe_num(edi)  print a non-negative integer
probe_num:
    push rbx
    push rcx
    push rdi
    lea rbx, [numbuf + 24]
    mov byte ptr [rbx], 0
    mov eax, edi
    cmp eax, 10
    jl probe_num_one
    mov ecx, 10
probe_num_div:
    xor edx, edx
    div ecx
    add dl, 0x30
    dec rbx
    mov [rbx], dl
    test eax, eax
    jnz probe_num_div
    lea rsi, [numbuf + 24]
probe_num_out:
    mov al, [rbx]
    movzx edi, byte ptr [rbx]
    call out_byte
    inc rbx
    cmp rbx, rsi
    jb probe_num_out
    jmp probe_num_done
probe_num_one:
    add eax, 0x30
    mov edi, eax
    call out_byte
probe_num_done:
    # out_byte only appends to outbuf, so the digits have to be pushed out here
    mov edi, 1
    lea rsi, [outbuf]
    mov edx, [outlen]
    call write_all
    mov dword ptr [outlen], 0
    pop rdi
    pop rcx
    pop rbx
    ret

.section .rodata
probe_msg1: .asciz "state="
probe_msg2: .asciz " countdown="
probe_msg3: .asciz " speed="
probe_msg4: .asciz " metres="
probe_msg5: .asciz " seconds="
probe_msg6: .asciz "dt_ms="
probe_nl:   .asciz "\n"
s_err:    .asciz "screenshot failed\n"
