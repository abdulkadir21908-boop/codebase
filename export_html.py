"""Renders Max-RAM-Laptop-Parts.xlsx into Max-RAM-Laptop-Parts.html so the
content is visible in a browser / review pane (xlsx cannot be previewed there)."""

import html
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

SRC = "Max-RAM-Laptop-Parts.xlsx"
OUT = "Max-RAM-Laptop-Parts.html"

PRIO_CLASS = {"Essential": "ess", "Recommended": "rec", "Optional": "opt"}

CSS = """
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0;
       padding: 32px; background: #f4f6f8; color: #1a1a1a; }
h1 { font-size: 24px; color: #1F3864; margin: 0 0 4px; }
h2 { font-size: 18px; color: #1F3864; margin: 36px 0 10px;
     border-bottom: 2px solid #1F3864; padding-bottom: 6px; }
.sub { color: #595959; font-style: italic; margin: 0 0 22px; font-size: 13px;
       max-width: 900px; }
table { border-collapse: collapse; width: 100%; background: #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,.12); margin-bottom: 8px; }
th { background: #1F3864; color: #fff; font-size: 12px; text-transform: uppercase;
     letter-spacing: .04em; padding: 10px 11px; text-align: left;
     border: 1px solid #16305c; }
td { padding: 10px 11px; border: 1px solid #d9dde1; font-size: 13px;
     vertical-align: top; }
tr:nth-child(even) td { background: #fafbfc; }
td.num { text-align: center; color: #6b7280; width: 42px; }
td.part { font-weight: 600; width: 24%; }
td.spec { width: 26%; color: #333; }
td.purpose { width: 38%; color: #444; }
td.prio { text-align: center; font-weight: 600; font-size: 12px; white-space: nowrap; }
.ess { background: #fce4d6 !important; color: #9c3d16; }
.rec { background: #fff2cc !important; color: #8a6100; }
.opt { background: #e2efda !important; color: #2f6b2f; }
td.tier { font-weight: 600; }
td.role { color: #444; white-space: nowrap; }
.notes { background: #fff; padding: 14px 20px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.notes li { margin: 6px 0; font-size: 13px; line-height: 1.5; }
.tag { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px;
       border-radius: 9px; letter-spacing: .04em; }
.tag.hot { background: #fce4d6; color: #9c3d16; }
.tag.cold { background: #dbe9f7; color: #1c4e80; }
footer { margin-top: 30px; color: #7a8288; font-size: 11px; }
"""


def esc(v):
    return html.escape(str(v)) if v is not None else ""


def row_html(ws, r, cls_map=None):
    """Render one worksheet row; returns list of <tr> strings."""
    out = []
    for c in range(1, ws.max_column + 1):
        cell = ws.cell(row=r, column=c)
        v = cell.value
        if v is None or v == "":
            continue
        txt = esc(v)
        if isinstance(v, str) and v.startswith("="):
            # evaluate the simple product formulas for display
            try:
                b = ws.cell(row=r, column=c - 2).value or 0
                a = ws.cell(row=r, column=c - 1).value or 0
                txt = str(int(a) * int(b))
            except Exception:
                pass
        col = get_column_letter(c)
        if cls_map and col in cls_map:
            out.append(f'<td class="{cls_map[col]}">{txt}</td>')
        else:
            out.append(f"<td>{txt}</td>")
    return "".join(out)


def main():
    wb = load_workbook(SRC)
    p = []
    p.append("<!DOCTYPE html><html><head><meta charset='utf-8'>")
    p.append(f"<title>{esc(SRC[:-5])}</title>")
    p.append(f"<style>{CSS}</style></head><body>")

    # ---- Parts List ----
    ws = wb["Parts List"]
    p.append("<h1>Max-RAM Laptop &mdash; Parts List</h1>")
    p.append("<p class='sub'><b>Goal:</b> RAM holds the <span class='tag hot'>HOT</span> "
             "data (what you are working on right now); the NVMe SSD holds the "
             "<span class='tag cold'>COLD</span> data (spillover + inactive). "
             "Priority is a recommendation, not a price.</p>")
    p.append("<table><thead><tr><th>#</th><th>Part / Component</th>"
             "<th>Recommended Spec</th><th>Purpose (why you need it)</th>"
             "<th>Priority</th></tr></thead><tbody>")
    for r in range(5, ws.max_row + 1):
        num = esc(ws.cell(row=r, column=1).value)
        p.append(f"<tr><td class='num'>{num}</td>"
                 f"<td class='part'>{esc(ws.cell(row=r, column=2).value)}</td>"
                 f"<td class='spec'>{esc(ws.cell(row=r, column=3).value)}</td>"
                 f"<td class='purpose'>{esc(ws.cell(row=r, column=4).value)}</td>")
        prio = esc(ws.cell(row=r, column=5).value)
        p.append(f"<td class='prio {PRIO_CLASS.get(prio,'')}'>{prio}</td></tr>")
    p.append("</tbody></table>")

    # ---- Memory Plan ----
    ws2 = wb["Memory Plan"]
    p.append("<h2>How the RAM / SSD split works</h2>")
    p.append("<p class='sub'>Speed order, fastest to slowest. You want active data at the top.</p>")
    p.append("<table><thead><tr><th>Tier</th><th>Role</th><th>What lives there</th>"
             "</tr></thead><tbody>")
    for r in range(5, 9):
        tier = esc(ws2.cell(row=r, column=1).value)
        role = esc(ws2.cell(row=r, column=2).value)
        badge = ("<span class='tag hot'>HOT</span>" if "hot" in role.lower()
                 else "<span class='tag cold'>COLD</span>")
        role = role.split("(")[0].strip()
        p.append(f"<tr><td class='tier'>{tier}</td><td class='role'>{role} {badge}</td>"
                 f"<td>{esc(ws2.cell(row=r, column=3).value)}</td></tr>")
    p.append("</tbody></table>")

    p.append("<h2>Capacity combinations</h2>")
    p.append("<p class='sub'>Total is a live formula in the .xlsx &mdash; change "
             "GB-per-module or slot count and it recalculates.</p>")
    p.append("<table><thead><tr><th>Config</th><th>GB per module</th><th>Slots used</th>"
             "<th>Total RAM (GB)</th></tr></thead><tbody>")
    for r in range(13, 18):
        label = esc(ws2.cell(row=r, column=1).value)
        a = ws2.cell(row=r, column=2).value or 0
        b = ws2.cell(row=r, column=3).value or 0
        p.append(f"<tr><td class='tier'>{label}</td>"
                 f"<td class='num'>{a}</td><td class='num'>{b}</td>"
                 f"<td class='num'><b>{int(a) * int(b)}</b></td></tr>")
    p.append("</tbody></table>")

    p.append("<h2>Realistic ceiling</h2><div class='notes'><ul>")
    for r in range(20, ws2.max_row + 1):
        v = ws2.cell(row=r, column=1).value
        if v:
            p.append(f"<li>{esc(v.lstrip('- '))}</li>")
    p.append("</ul></div>")

    p.append(f"<footer>Source workbook: {esc(SRC)} &mdash; 2 sheets, 18 parts. "
             "No prices included.</footer>")
    p.append("</body></html>")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(p))
    print("Wrote", OUT)


if __name__ == "__main__":
    main()