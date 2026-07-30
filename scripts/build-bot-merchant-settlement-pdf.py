#!/usr/bin/env python3
"""
Render docs/bot/crypto-to-merchant-settlement-request.md as a letter PDF.

The markdown stays the source of truth. This script owns presentation only, so
editing the letter means editing the markdown and re-running this — there is
never a second copy of the text to drift.

Typography is chosen for a supervisory reader: serif body at 10.5pt for
sustained reading on paper, a single rule under the letterhead, no colour in
the body, and tables that survive being printed in black and white.
"""

import argparse
import os
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    NextPageTemplate,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "bot", "crypto-to-merchant-settlement-request.md")
LOGO = os.path.join(ROOT, "apps", "web", "public", "ntzs-logo.png")
OUT = os.path.join(
    ROOT, "docs", "bot", "NEDA-Labs-BoT-Merchant-Settlement-Request.pdf"
)

INK = colors.HexColor("#111111")
MUTED = colors.HexColor("#5A5A5A")
RULE = colors.HexColor("#C9C9C9")
BAND = colors.HexColor("#F2F4F3")

PAGE_W, PAGE_H = A4
MARGIN_X = 24 * mm
MARGIN_TOP = 22 * mm
MARGIN_BOTTOM = 22 * mm


# ── Styles ────────────────────────────────────────────────────────────────────

_ss = getSampleStyleSheet()

BODY = ParagraphStyle(
    "Body",
    parent=_ss["Normal"],
    fontName="Times-Roman",
    fontSize=10.5,
    leading=15.5,
    alignment=TA_JUSTIFY,
    textColor=INK,
    spaceAfter=7,
)

H1 = ParagraphStyle(
    "H1",
    parent=BODY,
    fontName="Helvetica-Bold",
    fontSize=13,
    leading=17,
    alignment=0,
    spaceBefore=4,
    spaceAfter=10,
)

H2 = ParagraphStyle(
    "H2",
    parent=BODY,
    fontName="Helvetica-Bold",
    fontSize=10.5,
    leading=14,
    alignment=0,
    spaceBefore=13,
    spaceAfter=5,
)

META = ParagraphStyle(
    "Meta", parent=BODY, fontSize=9.5, leading=14, alignment=0, spaceAfter=1
)

BULLET = ParagraphStyle(
    "Bullet", parent=BODY, leftIndent=11, bulletIndent=1, spaceAfter=4
)

CELL = ParagraphStyle(
    "Cell", parent=BODY, fontSize=9.2, leading=12.8, alignment=0, spaceAfter=0
)

CELL_H = ParagraphStyle(
    "CellH", parent=CELL, fontName="Helvetica-Bold", textColor=INK
)

SIGN = ParagraphStyle(
    "Sign", parent=BODY, alignment=0, spaceAfter=0, leading=14
)


# ── Markdown → flowables ──────────────────────────────────────────────────────


def inline(md: str) -> str:
    """Markdown emphasis → reportlab markup. Escape first so & and < survive."""
    s = md.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(?<![\*\w])\*(?!\s)(.+?)(?<!\s)\*(?![\*\w])", r"<i>\1</i>", s)
    s = re.sub(r"`(.+?)`", r'<font face="Courier" size="9">\1</font>', s)
    # Placeholder blanks in the source read as "[ ]" — render as a fillable rule.
    s = s.replace("[&nbsp;]", "__________")
    return s


def is_continuation(line: str) -> bool:
    """An indented, non-empty line that does not start a new construct."""
    if not line.strip() or not line[:1].isspace():
        return False
    t = line.lstrip()
    return not (t.startswith(("- ", "|", "#")) or re.match(r"^\d+\.\s", t))


def split_row(line: str):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def build_table(header, rows):
    ncols = len(header)
    # Two-column tables are label/value; give the explanation the room.
    if ncols == 2:
        widths = [58 * mm, None]
    elif ncols == 4:
        widths = [32 * mm, 18 * mm, 20 * mm, None]
    else:
        widths = [None] * ncols

    avail = PAGE_W - 2 * MARGIN_X
    fixed = sum(w for w in widths if w)
    flex = [i for i, w in enumerate(widths) if w is None]
    if flex:
        each = (avail - fixed) / len(flex)
        for i in flex:
            widths[i] = each

    data = [[Paragraph(inline(c), CELL_H) for c in header]]
    for r in rows:
        data.append([Paragraph(inline(c), CELL) for c in r])

    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), BAND),
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, RULE),
                ("LINEBELOW", (0, 1), (-1, -2), 0.25, RULE),
                ("BOX", (0, 0), (-1, -1), 0.6, RULE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return t


def parse(md: str):
    """Walk the markdown once, emitting flowables. Handles the subset the
    letter actually uses: headings, paragraphs, bullets, ordered lists,
    tables, rules — and stops at the signature block, which is laid out
    separately so it never breaks across a page."""
    flow = []
    lines = md.split("\n")
    i = 0
    in_meta = False

    while i < len(lines):
        line = lines[i].rstrip()

        # Contact block — stacked lines, not a reflowed paragraph, and held
        # together so the name never lands alone on a new page.
        if line.strip() == "**Contact**":
            block = [Paragraph("<b>Contact</b>", SIGN)]
            i += 1
            while i < len(lines):
                if not lines[i].strip():
                    i += 1
                    continue
                block.append(Paragraph(inline(lines[i].strip()), SIGN))
                i += 1
            flow.append(Spacer(1, 10))
            flow.append(KeepTogether(block))
            continue

        if not line.strip():
            i += 1
            continue

        if line.strip() == "---":
            flow.append(Spacer(1, 4))
            i += 1
            continue

        if line.startswith("# "):
            flow.append(Paragraph(inline(line[2:].strip()), H1))
            i += 1
            continue

        if line.startswith("## "):
            flow.append(Paragraph(inline(line[3:].strip()), H2))
            i += 1
            continue

        # The To/From/Subject/Classification block — tighter leading, no
        # justification. Fields wrap in the source, so continuation lines are
        # folded in here; otherwise the next field gets swallowed into a
        # paragraph and stops looking like a field at all.
        if re.match(r"^\*\*(To|From|Subject|Classification):\*\*", line):
            in_meta = True
            buf = [line.strip()]
            i += 1
            while (
                i < len(lines)
                and lines[i].strip()
                and not re.match(r"^\*\*(To|From|Subject|Classification):\*\*", lines[i])
            ):
                buf.append(lines[i].strip())
                i += 1
            flow.append(Paragraph(inline(" ".join(buf)), META))
            continue
        if in_meta:
            in_meta = False
            flow.append(Spacer(1, 6))

        # Table
        if line.startswith("|"):
            header = split_row(line)
            i += 1  # separator row
            if i < len(lines) and set(lines[i].replace("|", "").strip()) <= set("-: "):
                i += 1
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            flow.append(Spacer(1, 3))
            flow.append(build_table(header, rows))
            flow.append(Spacer(1, 9))
            continue

        # Bullets
        if line.lstrip().startswith("- "):
            while i < len(lines) and lines[i].lstrip().startswith("- "):
                buf = [lines[i].lstrip()[2:].strip()]
                i += 1
                while i < len(lines) and is_continuation(lines[i]):
                    buf.append(lines[i].strip())
                    i += 1
                flow.append(Paragraph(inline(" ".join(buf)), BULLET, bulletText="•"))
            flow.append(Spacer(1, 4))
            continue

        # Ordered list
        m = re.match(r"^(\d+)\.\s+(.*)$", line.lstrip())
        if m:
            while i < len(lines):
                m = re.match(r"^(\d+)\.\s+(.*)$", lines[i].lstrip())
                if not m:
                    break
                num, buf = m.group(1), [m.group(2).strip()]
                i += 1
                while i < len(lines) and is_continuation(lines[i]):
                    buf.append(lines[i].strip())
                    i += 1
                flow.append(Paragraph(inline(" ".join(buf)), BULLET, bulletText=f"{num}."))
            flow.append(Spacer(1, 4))
            continue

        # Paragraph — join continuation lines.
        buf = [line.strip()]
        i += 1
        while (
            i < len(lines)
            and lines[i].strip()
            and not lines[i].lstrip().startswith(("#", "|", "- "))
            and not re.match(r"^\d+\.\s", lines[i].lstrip())
        ):
            buf.append(lines[i].strip())
            i += 1
        flow.append(Paragraph(inline(" ".join(buf)), BODY))

    return flow


# ── Page furniture ────────────────────────────────────────────────────────────

HEADER_H = 26 * mm


def letterhead(canvas, doc):
    canvas.saveState()

    if doc.page == 1:
        y = PAGE_H - MARGIN_TOP
        if os.path.exists(LOGO):
            size = 15 * mm
            canvas.drawImage(
                LOGO,
                MARGIN_X,
                y - size + 2 * mm,
                width=size,
                height=size,
                mask="auto",
            )
            text_x = MARGIN_X + size + 6 * mm
        else:
            text_x = MARGIN_X

        canvas.setFillColor(INK)
        canvas.setFont("Helvetica-Bold", 14)
        canvas.drawString(text_x, y - 4 * mm, "NEDA LABS LIMITED")
        canvas.setFont("Helvetica", 8.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(
            text_x, y - 8.6 * mm, "nTZS — Tanzanian Shilling Stablecoin"
        )
        canvas.drawString(
            text_x,
            y - 12.4 * mm,
            "Dar es Salaam, United Republic of Tanzania",
        )

        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.8)
        canvas.line(
            MARGIN_X, y - 17.5 * mm, PAGE_W - MARGIN_X, y - 17.5 * mm
        )

    # Footer: confidentiality mark + page number.
    canvas.setFont("Helvetica", 7.8)
    canvas.setFillColor(MUTED)
    canvas.drawString(
        MARGIN_X,
        MARGIN_BOTTOM - 8 * mm,
        "NEDA Labs Limited — confidential. Prepared for the Bank of Tanzania.",
    )
    canvas.drawRightString(
        PAGE_W - MARGIN_X, MARGIN_BOTTOM - 8 * mm, f"Page {doc.page}"
    )
    canvas.restoreState()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--test-ref",
        help=(
            "Reference for the merchant-leg test, e.g. "
            "'Test payment of TZS 5,000 on 30 July 2026, Selcom reference ABC123.' "
            "Omit and the sentence claiming a test is dropped entirely — the "
            "letter must never assert a test that has not happened."
        ),
    )
    args = ap.parse_args()

    with open(SRC, "r", encoding="utf-8") as f:
        md = f.read()

    # The evidence sentence is present only when there is evidence. Dropping it
    # is the safe default: a letter to a regulator must never claim a test that
    # has not been run, and a forgotten placeholder is how that happens.
    if args.test_ref:
        md = md.replace("MERCHANT_TEST_REF", f" {args.test_ref.strip()}")
    else:
        md = re.sub(
            r"\nWe have also exercised the merchant leg[^\n]*MERCHANT_TEST_REF\n", "\n", md
        )

    # The markdown carries its own signature lines; the PDF lays them out.

    doc = BaseDocTemplate(
        OUT,
        pagesize=A4,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        title="Request to test settlement of inbound digital-asset value to Tanzanian merchants",
        author="NEDA Labs Limited",
        subject="Bank of Tanzania Regulatory Sandbox",
    )

    first = Frame(
        MARGIN_X,
        MARGIN_BOTTOM,
        PAGE_W - 2 * MARGIN_X,
        PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - HEADER_H,
        id="first",
        showBoundary=0,
    )
    rest = Frame(
        MARGIN_X,
        MARGIN_BOTTOM,
        PAGE_W - 2 * MARGIN_X,
        PAGE_H - MARGIN_TOP - MARGIN_BOTTOM,
        id="rest",
        showBoundary=0,
    )

    doc.addPageTemplates(
        [
            PageTemplate(id="first", frames=[first], onPage=letterhead),
            PageTemplate(id="rest", frames=[rest], onPage=letterhead),
        ]
    )

    story = [NextPageTemplate("rest")] + parse(md)
    doc.build(story)

    size_kb = os.path.getsize(OUT) / 1024
    print(f"Wrote {os.path.relpath(OUT, ROOT)}  ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
