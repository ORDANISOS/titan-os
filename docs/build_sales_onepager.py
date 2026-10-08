#!/usr/bin/env python3
"""TitanOS sales one-pager — what it is, then what it costs.

WHAT CHANGED, AND WHY
---------------------
The first version of this sheet opened with two price cards. It answered "what does it cost" before
it had answered "what is it", which only works on a reader who already knows. A firm seeing the name
for the first time got mechanics and had to infer the product from a feature list. This version puts
the positioning first and compresses the tiers to what a reader needs once they understand what they
are buying — the detail belongs in the conversation the sheet is meant to start.

AUDIENCE IS THE FIRM, NOT THE FAMILY
------------------------------------
The per-household prices here are what an advisory firm pays. Their clients never see this sheet, and
never see the name TitanOS at all — which is the point of the white-label and is said on the page.

IT MUST BE ONE PAGE
-------------------
Overflow is a defect, not a formatting preference. Three guards at the end of build(): page count,
content clearing the footer rule, and each tier card reporting where its content actually ended. The
third one earned its place — at one point Core's last bullet was being drawn onto the card border,
which looked almost right.

FIGURES ARE THE FIRM'S COMMERCIAL CALL, NOT THE MODEL'S
-------------------------------------------------------
docs/pricing_model.py recommends different numbers ($750 / $2,500) off the market analysis. The ones
below are what the firm chose to sell at. Kept here in one place so the sheet cannot drift from
itself; if a price changes, change it here and regenerate. Do not "correct" these to match the model.

WINANSI ONLY
------------
Standard PDF fonts throw on anything outside WinAnsi. A tick (U+2713) is outside it; the bullet
(U+2022) and multiplication sign (U+00D7) are inside, so inclusions read as bullets and exclusions
as crosses.

Usage:
  python3 docs/build_sales_onepager.py TitanOS_Sales_OnePager.pdf
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

import brand_kit as BK

W, H = letter
MARGIN = 48.0
CONTENT = W - MARGIN * 2

# ── The brand, as recorded on the TitanOS brand_profiles row ──────────────────
BRAND = BK.BRAND

NAVY = BK.NAVY
NAVY_MID = BK.SLATE          # the kit has no mid-navy; Slate is its supporting-copy colour
GOLD = BK.GOLD
CREAM = BK.CREAM
BORDER = BK.BORDER
BORDER_LIGHT = BK.BORDER_LIGHT
TEXT_SOFT = BK.SLATE         # 7.74:1 on white, up from 5a6e84
TEXT_MUTE = BK.TEXT_MUTE
WHITE = BK.WHITE

# ── What it is ────────────────────────────────────────────────────────────────
HEADLINE = "Everything a family owns, and everyone who looks after it, on one record."

STANDFIRST = (
    "TitanOS is the system a private wealth firm runs its households on. Properties, portfolio, "
    "cash flow, documents, obligations and the people around them — in one place, under your own "
    "name. Not a reporting tool bolted onto a practice. The practice itself, running."
)

# Three, not five. A one-pager that claims five differentiators is claiming none.
PILLARS = [
    ("One record, not five tools",
     "Properties with their lenders, taxes, insurers and vendors. Portfolio with balance history. "
     "Cash flow with projections. CHRIS, which knows what expires and when. The assistant answers "
     "from that record and nothing else — ask what the household spends on landscaping and you get "
     "a real figure, traced to named vendors, not an estimate."),
    ("It does the work, not just the reporting",
     "Obligations and workflows run a premium call or a K-1 chase end to end: draft, review, send, "
     "record. That is the part reporting platforms hand back to your staff, and it is the "
     "difference between an expert carrying eight households and carrying twenty-five."),
    # NOTE ON THE LAST SENTENCE. It first read "Three firms run off this one codebase today", which
    # is not true: three BRANDS are configured, but only one firm is live in production. A checkable
    # claim that does not survive checking is worse than no claim, and this sheet goes to buyers who
    # will ask for references. The wording now says exactly what the architecture does.
    ("Your name on all of it",
     "Your palette, logo, templates, sending domain and client-facing PDFs, resolved per firm at "
     "runtime from a single record — no rebuild, no fork. Your own database and your own "
     "deployment, not a shared tenancy. Your clients never see the word TitanOS."),
]

# ── The offer ─────────────────────────────────────────────────────────────────
# Tier names match the platform exactly. A prospect sold "Premier" logs in and sees "Premier" on the
# family record and on their own banner; a sheet saying "Premium" would not.
TIERS = [
    {
        "name": "Core", "lead": "Financial advisor led",
        "monthly": 1000, "onboarding": 1000,
        "includes": [
            "The full record, and both portals",
            "Client and Partner access",
            "The advisor keeps the relationship",
        ],
        "excludes": ["Scheduled prompts", "Workflows and obligations",
                     "Property management", "Bill pay"],
        "accent": False,
    },
    {
        "name": "Premier", "lead": "Titan Expert led",
        "monthly": 2000, "onboarding": 2000,
        "includes": [
            "Everything in Core",
            "A named Titan Expert on the household",
            "Workflows, obligations and scheduled prompts",
            "Property management oversight and bill pay",
            "Client activity reporting",
        ],
        "excludes": [],
        "accent": True,
    },
]

FIRM = {
    "fee": 50000,
    "label": "One-time firm onboarding",
    "items": [
        ("Dedicated server space", "Your own database and deployment. No shared tenancy, no "
                                   "commingled client data."),
        ("Quarterly training", "Live sessions for advisors and staff, every quarter, for as long "
                               "as you are on the platform."),
        ("Full white-label", "Configured to your brand before your first household is loaded."),
    ],
}

money = lambda n: f"${n:,}"


class Sheet:
    def __init__(self, path):
        self.c = canvas.Canvas(path, pagesize=letter)
        self.pages = 1

    def wrap(self, text, font, size, width):
        words = str(text).split()
        if not words:
            return [""]
        lines, cur = [], words[0]
        for w in words[1:]:
            if stringWidth(cur + " " + w, font, size) <= width:
                cur += " " + w
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
        return lines

    def text(self, s, x, y, font="Helvetica", size=9, colour=NAVY):
        self.c.setFont(font, size)
        self.c.setFillColor(HexColor(colour))
        self.c.drawString(x, y, str(s))

    def para(self, s, x, y, width, font="Helvetica", size=8.4, lead=11, colour=TEXT_SOFT):
        """Returns the y after drawing, so blocks stack without anyone guessing heights."""
        for line in self.wrap(s, font, size, width):
            self.text(line, x, y, font=font, size=size, colour=colour)
            y -= lead
        return y


def masthead(s):
    """Navy band with the reversed lockup, drawn as vector from the kit rather than placed as a PNG.

    The old version loaded titanos-logo-knockout.png and fell back to type if the file was missing.
    Drawing it removes the file dependency and the fallback branch entirely, and it stays crisp at
    any size. Note the lockup is Times-Bold here: Georgia is the specified face but is not available
    to a server-side renderer — see the docstring in brand_kit.py.
    """
    c = s.c
    c.setFillColor(HexColor(NAVY))
    c.rect(0, H - 104, W, 104, stroke=0, fill=1)

    lock_w = 208.0
    BK.draw_lockup(c, MARGIN + lock_w / 2, H - 24, lock_w, reversed_=True)

    right = f'{BRAND["site"]}   \u00b7   {BRAND["contact"]}'
    s.text(right, W - MARGIN - stringWidth(right, "Helvetica", 7.6), H - 62,
           size=7.6, colour=BK.MIST)


def tier_card(s, t, x, y, w, h):
    """One tier. Height is fixed and passed in so both cards align; returns its content bottom."""
    c = s.c
    c.setFillColor(HexColor(CREAM if t["accent"] else WHITE))
    c.setStrokeColor(HexColor(GOLD if t["accent"] else BORDER))
    c.setLineWidth(1.2 if t["accent"] else 1)
    c.rect(x, y - h, w, h, stroke=1, fill=1)
    # Gold rule on the fuller tier, navy on the entry tier. Carries the hierarchy without a
    # "recommended" badge, which reads as a sales device rather than a fact.
    c.setFillColor(HexColor(GOLD if t["accent"] else NAVY_MID))
    c.rect(x, y - 3, w, 3, stroke=0, fill=1)

    pad = 14
    ix, iw = x + pad, w - pad * 2
    cy = y - 21

    s.text(t["name"].upper(), ix, cy, font="Helvetica-Bold", size=12.5, colour=NAVY)
    cy -= 12
    s.text(t["lead"], ix, cy, font="Helvetica-Bold", size=8,
           colour=GOLD if t["accent"] else TEXT_SOFT)
    cy -= 16

    s.text(money(t["monthly"]), ix, cy - 6, font="Times-Bold", size=25, colour=NAVY)
    px = ix + stringWidth(money(t["monthly"]), "Times-Bold", 25) + 6
    s.text("/ month", px, cy + 2, size=8.2, colour=TEXT_SOFT)
    s.text("per household", px, cy - 7, size=8.2, colour=TEXT_SOFT)
    cy -= 21

    s.text(f'+ {money(t["onboarding"])} one-time onboarding', ix, cy, size=8.2, colour=NAVY_MID)
    cy -= 13

    c.setStrokeColor(HexColor(BORDER_LIGHT))
    c.setLineWidth(0.8)
    c.line(ix, cy, ix + iw, cy)
    cy -= 14

    for item in t["includes"]:
        # Bullet and cross are both inside WinAnsi. A tick is not, and throws at draw time.
        s.text("•", ix, cy, size=9, colour=GOLD)
        for i, line in enumerate(s.wrap(item, "Helvetica", 8.8, iw - 12)):
            s.text(line, ix + 12, cy, size=8.8, colour=NAVY if i == 0 else TEXT_SOFT)
            cy -= 11.2
        cy -= 2

    if t["excludes"]:
        cy -= 3
        s.text("NOT INCLUDED", ix, cy, font="Helvetica-Bold", size=7, colour=NAVY_MID)
        cy -= 11
        for item in t["excludes"]:
            s.text("×", ix + 1, cy, size=9, colour=TEXT_MUTE)
            s.text(item, ix + 12, cy, size=8.8, colour=TEXT_MUTE)
            cy -= 11.6
    return cy


def build(path):
    s = Sheet(path)
    c = s.c
    masthead(s)

    # ── What it is ───────────────────────────────────────────────────────────
    y = H - 128
    for line in s.wrap(HEADLINE, "Times-Bold", 19, CONTENT):
        s.text(line, MARGIN, y, font="Times-Bold", size=19, colour=NAVY)
        y -= 23
    y -= 2
    y = s.para(STANDFIRST, MARGIN, y, CONTENT, size=9.4, lead=12.4, colour=NAVY_MID)
    y -= 12

    c.setFillColor(HexColor(GOLD))
    c.rect(MARGIN, y, CONTENT, 1.6, stroke=0, fill=1)
    y -= 18

    # ── Three pillars, in columns ────────────────────────────────────────────
    gap = 18
    col_w = (CONTENT - gap * 2) / 3
    bottoms = []
    for i, (label, blurb) in enumerate(PILLARS):
        x = MARGIN + i * (col_w + gap)
        s.text(label, x, y, font="Helvetica-Bold", size=9.2, colour=NAVY)
        bottoms.append(s.para(blurb, x, y - 13, col_w, size=8.1, lead=10.4))
    y = min(bottoms) - 12

    # ── The two tiers ────────────────────────────────────────────────────────
    card_w = (CONTENT - gap) / 2
    card_h = 214
    ends = [tier_card(s, TIERS[0], MARGIN, y, card_w, card_h),
            tier_card(s, TIERS[1], MARGIN + card_w + gap, y, card_w, card_h)]
    floor = y - card_h
    for t, end in zip(TIERS, ends):
        if end < floor + 4:
            raise SystemExit(f'{t["name"]} card overflows: content ends at {end:.0f}, floor is '
                             f'{floor:.0f}. Raise card_h.')
    y -= card_h + 8
    # The one line about the tiers that is worth the space: the limits are real.
    y = s.para("Tier limits are enforced in the database, not hidden in the interface — a Core "
               "household cannot hold a workflow or a bill-pay instruction by any route. Moving up "
               "to Premier takes effect immediately, with no second onboarding fee.",
               MARGIN, y, CONTENT, size=8, lead=10.4, colour=TEXT_MUTE)
    y -= 10

    # ── Firm engagement ──────────────────────────────────────────────────────
    strip_h = 80
    c.setFillColor(HexColor(NAVY))
    c.rect(MARGIN, y - strip_h, CONTENT, strip_h, stroke=0, fill=1)
    c.setFillColor(HexColor(GOLD))
    c.rect(MARGIN, y - 3, CONTENT, 3, stroke=0, fill=1)

    fy = y - 21
    s.text(FIRM["label"].upper(), MARGIN + 16, fy, font="Helvetica-Bold", size=7.4, colour=GOLD)
    s.text(money(FIRM["fee"]), MARGIN + 16, fy - 27, font="Times-Bold", size=25, colour=WHITE)
    s.text("charged once, per firm", MARGIN + 16, fy - 40, size=7.6, colour="#8fa8bf")

    col_x = MARGIN + 148
    fcol_w = (CONTENT - 164) / 3 - 12
    for i, (label, blurb) in enumerate(FIRM["items"]):
        x = col_x + i * (fcol_w + 18)
        s.text(label, x, fy, font="Helvetica-Bold", size=8.4, colour=WHITE)
        yy = fy - 12
        for line in s.wrap(blurb, "Helvetica", 7.7, fcol_w):
            s.text(line, x, yy, size=7.7, colour="#a9bccf")
            yy -= 9.8
    y -= strip_h

    # ── Footer ───────────────────────────────────────────────────────────────
    c.setStrokeColor(HexColor(BORDER))
    c.setLineWidth(0.6)
    c.line(MARGIN, MARGIN - 8, W - MARGIN, MARGIN - 8)
    s.text("Pricing current as at August 2026. Figures exclude applicable taxes.",
           MARGIN, MARGIN - 20, size=7, colour=TEXT_MUTE)
    rt = f'{BRAND["name"]}  ·  {BRAND["contact"]}'
    s.text(rt, W - MARGIN - stringWidth(rt, "Helvetica", 7), MARGIN - 20, size=7, colour=TEXT_MUTE)

    c.showPage()
    c.save()

    if s.pages != 1:
        raise SystemExit(f"Refusing to write a {s.pages}-page one-pager. Tighten the content.")
    if y < MARGIN + 6:
        raise SystemExit(f"Content overruns the footer (bottom at y={y:.0f}, floor {MARGIN + 6}).")
    return y


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default="TitanOS_Sales_OnePager.pdf")
    a = ap.parse_args()
    print(f"wrote {a.out} — single page, content bottom at y={build(a.out):.0f}")
