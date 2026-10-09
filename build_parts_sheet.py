"""
Builds: Max-RAM-Laptop-Parts.xlsx

Concept: a laptop where RAM is the HOT tier (everything you're actively working
on) and the NVMe SSD is the COLD tier (spillover + everything inactive).

Sheets:
  1. Parts List  - part / recommended spec / purpose / priority
  2. Memory Plan - how the hot-cold tiering works + capacity maths
"""

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

OUT = "Max-RAM-Laptop-Parts.xlsx"

# ---------------------------------------------------------------- styling ----
HDR_FILL = PatternFill("solid", fgColor="1F3864")
HDR_FONT = Font(bold=True, color="FFFFFF", size=11)
TITLE_FONT = Font(bold=True, size=14, color="1F3864")
NOTE_FONT = Font(italic=True, size=10, color="595959")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

PRIORITY_FILL = {
    "Essential": PatternFill("solid", fgColor="FCE4D6"),
    "Recommended": PatternFill("solid", fgColor="FFF2CC"),
    "Optional": PatternFill("solid", fgColor="E2EFDA"),
}

# ------------------------------------------------------------------ data ----
# (part, recommended spec, purpose, priority)
PARTS = [
    (
        "Motherboard (workstation-class mobile)",
        "4x SO-DIMM slots, dual/quad-channel, high-density DDR5 support",
        "This sets your ceiling. Consumer laptop boards usually only have 2 slots, "
        "which caps total RAM no matter how big the modules are.",
        "Essential",
    ),
    (
        "DDR5 SO-DIMM modules",
        "4 x 32GB = 128GB, or 4 x 48GB = 192GB. Match speed and CL across all four.",
        "The HOT tier - this is the working set. Size it so everything you actively "
        "use fits at once and never spills to the SSD.",
        "Essential",
    ),
    (
        "RAM heat spreaders / active RAM cooling",
        "Tall anodised heat spreaders or a powered RAM cooling bar",
        "192GB of densely-packed DDR5 gets very hot. Throttled or thermally-cycled "
        "memory will corrupt the hot tier or crash the machine.",
        "Recommended",
    ),
    (
        "CPU with high memory bandwidth",
        "Workstation mobile CPU, 8 memory channels, large L3 cache",
        "The memory controller and L3 are what actually make a big pool usable. "
        "Without bandwidth, a huge RAM pool feels no faster than a small one.",
        "Essential",
    ),
    (
        "Discrete GPU with large VRAM",
        "24-48GB VRAM workstation GPU",
        "VRAM is a second hot tier sitting right next to system RAM. Pushing "
        "frames/datasets into VRAM keeps them off the SSD entirely.",
        "Recommended",
    ),
    (
        "NVMe SSDs (2x or 4x)",
        "Gen4 or Gen5 NVMe, 2-4TB each, TLC preferred over QLC",
        "The COLD tier. Holds the spillover, the pagefile, and every app and file "
        "you are not currently touching. Cheap and fast - treat it as overflow.",
        "Essential",
    ),
    (
        "Storage controller / RAID",
        "Hardware RAID, or software striped volume across the NVMe drives",
        "Fuses the drives into one large fast volume so the cold tier doesn't "
        "become a random I/O bottleneck when it spills back into RAM.",
        "Recommended",
    ),
    (
        "M.2 expansion bays",
        "2-4 accessible M.2 2280 slots, tool-less access where possible",
        "Cold storage always grows. More bays means you can add drives later "
        "instead of replacing them.",
        "Essential",
    ),
    (
        "Power adapter",
        "180-300W for the architecture, plus USB-C PD as backup",
        "CPU, GPU and a fully populated RAM board all draw at once. A weak adapter "
        "throttles the entire configuration under load.",
        "Essential",
    ),
    (
        "Large internal battery",
        "99Wh-class, removable if the chassis allows",
        "Acts as a mini-UPS. The hot tier is volatile and vanishes on power loss, so "
        "ride-through time prevents losing hours of in-memory work.",
        "Recommended",
    ),
    (
        "Cooling system",
        "Large vapour chamber, liquid-metal or high-quality paste, dual fans",
        "Sustained full power with 192GB of RAM needs real thermal headroom. Once "
        "the CPU or memory throttles, the extra capacity stops paying off.",
        "Essential",
    ),
    (
        "Thermal pads and ducting",
        "Correct pad thickness per component, direct-on-die where supported",
        "The hot/cold split only works if RAM, SSD and GPU all stay inside their "
        "temperature limits. Pads are cheaper than the data you would lose.",
        "Recommended",
    ),
    (
        "RAMDisk software",
        "ImDisk or Dataram RAMDisk on Windows; tmpfs / zram on Linux",
        "This is what actually CREATES the hot tier - a drive that literally lives "
        "in RAM. Without it you have big RAM but no hot tier.",
        "Essential",
    ),
    (
        "Spillover configuration",
        "Large pagefile on the NVMe, memory-mapped files, zram enabled",
        "Defines the RAM-to-SSD handoff. Lets the OS page cold data out to the SSD "
        "instead of running out of memory and failing.",
        "Essential",
    ),
    (
        "Networking",
        "2.5GbE, 10GbE if the chassis supports it",
        "Lets cold data be offloaded to a NAS or server over fast Ethernet, so the "
        "SSD does not have to be a permanent archive.",
        "Recommended",
    ),
    (
        "Chassis / tool-less expandability",
        "Direct access to RAM slots and M.2 bays",
        "You will need to open the machine to add RAM and drives as your data grows. "
        "Glued-down panels make upgrades painful.",
        "Recommended",
    ),
    (
        "Virtualisation support (VT-x / VT-d, IOMMU)",
        "Enabled in BIOS",
        "Only needed if you run VMs - it lets guest machines share the big RAM pool "
        "instead of each one being capped at a fixed slice.",
        "Optional",
    ),
    (
        "External UPS or surge protection",
        "Any UPS with pass-through on the charger input",
        "Desktop-grade protection for the RAM cache and the NVMe cold tier during "
        "mains cuts and brownouts.",
        "Optional",
    ),
]

# (config label, GB per module, slots used)
CONFIGS = [
    ("Entry - 2x32GB", 32, 2),
    ("Entry alt - 4x16GB", 16, 4),
    ("Balanced - 4x32GB", 32, 4),
    ("Maximum - 4x48GB", 48, 4),
    ("Extreme - 8x32GB (rarest boards)", 32, 8),
]

TIERS = [
    ("GPU VRAM", "HOT (fastest, volatile)",
     "Fastest memory on the board. Holds whatever the GPU is actively working on right now."),
    ("System RAM", "HOT tier",
     "Your working set. Everything you are actively using should live here. Lost on power off."),
    ("NVMe SSD", "COLD tier",
     "Spillover and archive. Holds inactive apps, the pagefile and anything not currently in use."),
    ("NAS / server (optional)", "COLD archive",
     "Offloaded via fast Ethernet so the SSD does not have to keep everything forever."),
]


def style_header(ws, row, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HDR_FILL
        cell.font = HDR_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BOX


def build_parts(wb):
    ws = wb.active
    ws.title = "Parts List"

    ws["A1"] = "Max-RAM Laptop - Parts List"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = ("Goal: RAM holds the HOT data (what you're working on now); the NVMe SSD holds "
                "the COLD data (spillover + inactive). Priorities are recommendations, not prices.")
    ws["A2"].font = NOTE_FONT
    ws.merge_cells("A2:E2")
    ws.row_dimensions[2].height = 30
    ws["A2"].alignment = Alignment(vertical="center", wrap_text=True)

    headers = ["#", "Part / Component", "Recommended Spec", "Purpose (why you need it)", "Priority"]
    hrow = 4
    for i, h in enumerate(headers, start=1):
        ws.cell(row=hrow, column=i, value=h)
    style_header(ws, hrow, len(headers))
    ws.row_dimensions[hrow].height = 22

    r = hrow + 1
    for n, (part, spec, purpose, prio) in enumerate(PARTS, start=1):
        ws.cell(row=r, column=1, value=n).alignment = Alignment(horizontal="center", vertical="top")
        ws.cell(row=r, column=2, value=part)
        ws.cell(row=r, column=3, value=spec)
        ws.cell(row=r, column=4, value=purpose)
        p = ws.cell(row=r, column=5, value=prio)
        p.fill = PRIORITY_FILL[prio]
        p.alignment = Alignment(horizontal="center", vertical="center")
        for c in range(1, 6):
            cell = ws.cell(row=r, column=c)
            cell.border = BOX
            if c in (2, 3, 4):
                cell.alignment = Alignment(vertical="top", wrap_text=True)
            if c == 2:
                cell.font = Font(bold=True)
        ws.row_dimensions[r].height = 46
        r += 1

    widths = {"A": 5, "B": 34, "C": 40, "D": 62, "E": 13}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w

    ws.freeze_panes = f"A{hrow + 1}"
    ws.auto_filter.ref = f"A{hrow}:E{r - 1}"
    return ws


def build_plan(wb):
    ws = wb.create_sheet("Memory Plan")

    ws["A1"] = "How the RAM / SSD split works"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = "Speed order, fastest to slowest. You want active data at the top."
    ws["A2"].font = NOTE_FONT
    ws.merge_cells("A2:C2")

    hdr = ["Tier", "Role", "What lives there"]
    for i, h in enumerate(hdr, start=1):
        ws.cell(row=4, column=i, value=h)
    style_header(ws, 4, 3)

    r = 5
    for tier, role, desc in TIERS:
        ws.cell(row=r, column=1, value=tier).font = Font(bold=True)
        ws.cell(row=r, column=2, value=role)
        ws.cell(row=r, column=3, value=desc)
        for c in range(1, 4):
            ws.cell(row=r, column=c).border = BOX
            ws.cell(row=r, column=c).alignment = Alignment(vertical="top", wrap_text=True)
        ws.row_dimensions[r].height = 32
        r += 1

    # capacity table
    cap_title = r + 1
    ws.cell(row=cap_title, column=1, value="Capacity combinations").font = TITLE_FONT
    ws.cell(row=cap_title + 1, column=1,
            value="Total is a live formula - change the per-module GB or slots and it recalculates."
            ).font = NOTE_FONT
    ws.merge_cells(start_row=cap_title + 1, start_column=1, end_row=cap_title + 1, end_column=4)

    ch = cap_title + 2
    for i, h in enumerate(["Config", "GB per module", "Slots used", "Total RAM (GB)"], start=1):
        ws.cell(row=ch, column=i, value=h)
    style_header(ws, ch, 4)

    r = ch + 1
    for label, per, slots in CONFIGS:
        ws.cell(row=r, column=1, value=label).font = Font(bold=True)
        ws.cell(row=r, column=2, value=per)
        ws.cell(row=r, column=3, value=slots)
        ws.cell(row=r, column=4, value=f"=B{r}*C{r}")
        for c in range(1, 5):
            ws.cell(row=r, column=c).border = BOX
            if c in (2, 3):
                ws.cell(row=r, column=c).alignment = Alignment(horizontal="center")
        ws.cell(row=r, column=4).font = Font(bold=True)
        ws.cell(row=r, column=4).alignment = Alignment(horizontal="center")
        r += 1

    # reality check
    note_row = r + 1
    ws.cell(row=note_row, column=1, value="Realistic ceiling").font = TITLE_FONT
    notes = [
        "\"Unlimited\" RAM is not physically possible - the ceiling is (slots x max module size).",
        "Most laptops top out at 4 SO-DIMM slots; 4 x 48GB = 192GB is a realistic high-water mark.",
        "A few workstation boards expose 8 slots (4 soldered + 4 replaceable) for 256GB.",
        "Beyond that, add DIMMs on a desktop board, or move cold data to a NAS.",
        "Budget roughly 1.5-2x your RAM size in NVMe for the cold tier to stay responsive.",
    ]
    nr = note_row + 1
    for n in notes:
        ws.cell(row=nr, column=1, value="- " + n).font = Font(size=10)
        ws.merge_cells(start_row=nr, start_column=1, end_row=nr, end_column=4)
        nr += 1

    for col, w in {"A": 36, "B": 20, "C": 42, "D": 18}.items():
        ws.column_dimensions[col].width = w

    return ws


def main():
    wb = Workbook()
    build_parts(wb)
    build_plan(wb)
    wb.save(OUT)
    print("Wrote", OUT)
    print("Sheets:", wb.sheetnames)


if __name__ == "__main__":
    main()