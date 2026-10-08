#!/usr/bin/env python3
"""TitanOS value one-pager for RIAs — benefits, no pricing.

WHAT THIS IS, AND WHAT IT IS NOT
--------------------------------
This is the sheet you leave with a principal after a first conversation. It argues why an RIA should
want this at all. It carries NO pricing, no tier table and no feature list — those live in
docs/build_sales_onepager.py, which is the commercial sheet and comes second in the sequence.

Two sheets rather than one because they answer different questions and get handed over at different
moments. A value sheet that mentions price stops being read as an argument and starts being read as a
quote.

BENEFITS, NOT CAPABILITIES
--------------------------
Every block below is written as something that happens to the FIRM — relationship depth, defensibility,
capacity, referrals — not as something the software has. "CHRIS with expiry tracking" is a capability;
"harder to leave than a performance number" is why a principal cares. Where a capability appears it
is there as evidence for the benefit, never as the point.

CLAIMS DISCIPLINE
-----------------
Nothing here asserts a market statistic. The obvious move on a sheet like this is to open with "72%
of UHNW net worth sits outside managed accounts", and the numbers available for that are all
second-hand — compiled by vendors quoting each other. This sheet goes to buyers who check. The only
figures on the page are the property-management benchmarks, which were sourced directly from
property-management industry pricing guides and are cited in docs/PRICING-per-family.md.

Usage:
  python3 docs/build_ria_value_onepager.py TitanOS_RIA_Value.pdf
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

EYEBROW = "FOR REGISTERED INVESTMENT ADVISERS"

HEADLINE = "Your clients keep asking for things you can't staff."

STANDFIRST = (
    "The insurance renewal. The contractor who will not call back. The K-1 that has not arrived. "
    "The rental that needs a decision this week. You deflect these politely because you cannot "
    "staff them — and every time you do, a piece of the relationship goes to somebody else. A "
    "Titan Expert joins your team and takes them: on your platform, under your brand, reporting "
    "to you."
)

# THE HERO IS THE PERSON, NOT THE SOFTWARE.
#
# An earlier draft led with capabilities and buried the Titan Expert. It also claimed the household
# fee was "revenue the market cannot compress" for the RIA — which is simply wrong. That money pays
# for the platform and the expert; the advisor does not earn a margin on it. Selling a firm on
# revenue it will not receive is the fastest way to lose the second meeting. The benefit is the
# relationship and the moat, so that is what these say.
BENEFITS = [
    ("A specialist joins your team, without a hire",
     "A named Titan Expert works your households as an extension of your firm. No recruiting, no "
     "training, no salary, no management overhead. They introduce themselves as part of your team, "
     "because for that household they are."),
    ("Say yes to what you deflect today",
     "The property tax appeal, the lapsed endorsement, the vendor nobody is chasing, the trust that "
     "was never funded. Each of those is a chance to be indispensable, and today each one is a "
     "polite no."),
    ("You stay the relationship",
     "The Titan Expert reports to you, not around you. Every call made and document handled sits on "
     "your record, under your brand. You are never told about your own client second-hand."),
    ("A moat, not a feature",
     "Hold the documents in CHRIS, the renewal calendar and the vendor register, and a competitor is no "
     "longer pitching against your performance. They are asking a family to rebuild its operating "
     "life. That is a conversation they lose."),
    ("Your advisors get their week back",
     "The platform assembles the report and tracks the renewal; the expert runs what is left. Your "
     "people go back to advising, which is what you hired them for."),
    ("Your centres of influence become a channel",
     "The client's CPA and estate attorney get their own portal into the household you share. You "
     "become the hub of the professional network around that family rather than one spoke in it."),
    ("You finally see the whole balance sheet",
     "Properties with their lenders, taxes, insurers and vendors. Entities, valuables, obligations, "
     "cash flow. Advice improves when you see everything a family owns, not the part you custody."),
    ("Continuity that belongs to the firm",
     "When a household moves to another advisor internally, or the next generation takes over, "
     "nothing important lives in one person's head. And your brand is on all of it — clients never "
     "see the word TitanOS."),
]

# ANSWERING "SO WHO PAYS FOR THIS?" BEFORE THEY ASK IT.
#
# Left unanswered, a principal assumes it comes out of their advisory fee. Said plainly — and
# without pretending it is a profit centre for them — it is disarming rather than awkward.
ECONOMICS_TITLE = "Who pays, plainly"
ECONOMICS = (
    "Billed to the household, and priced to cover the platform and the expert's time. It is not a "
    "mark-up for your firm and it does not come out of your advisory fee. What you get is not a "
    "margin line — it is a household that is very hard to take away from you."
)

# The concrete hook. These are the only numbers on the page and they are the client's costs, not
# ours — sourced from property-management industry pricing guides, cited in PRICING-per-family.md.
HOOK_TITLE = "Where the conversation usually starts"
HOOK = (
    "Ask a client with a rental what they pay their property manager. The standard is 8–12% of "
    "gross rent, and 15–20% once tenant placement and maintenance mark-ups are counted. On "
    "$300,000 of rent that is $30,000 to $60,000 a year — to somebody who does not report to them "
    "and has never spoken to you. Your Titan Expert takes that call instead."
)

CLOSE = (
    "See it on a real household, with real documents, in twenty minutes."
)


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

    def para(self, s, x, y, width, font="Helvetica", size=9, lead=11.8, colour=TEXT_SOFT):
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


def build(path):
    s = Sheet(path)
    c = s.c
    masthead(s)

    y = H - 126
    s.text(EYEBROW, MARGIN, y, font="Helvetica-Bold", size=7.6, colour=GOLD)
    y -= 22

    for line in s.wrap(HEADLINE, "Times-Bold", 21, CONTENT):
        s.text(line, MARGIN, y, font="Times-Bold", size=21, colour=NAVY)
        y -= 25
    y -= 3
    y = s.para(STANDFIRST, MARGIN, y, CONTENT, size=10, lead=13.2, colour=NAVY_MID)
    y -= 14

    c.setFillColor(HexColor(GOLD))
    c.rect(MARGIN, y, CONTENT, 1.6, stroke=0, fill=1)
    y -= 22

    # ── Six benefits, two columns ────────────────────────────────────────────
    # Rows are measured, not assumed: each row starts below the deeper of its two cells, so a
    # wording change cannot silently overlap the next row.
    gap = 26
    col_w = (CONTENT - gap) / 2
    for i in range(0, len(BENEFITS), 2):
        row = BENEFITS[i:i + 2]
        bottoms = []
        for j, (title, body) in enumerate(row):
            x = MARGIN + j * (col_w + gap)
            s.text(title, x, y, font="Helvetica-Bold", size=10, colour=NAVY)
            bottoms.append(s.para(body, x, y - 14, col_w, size=8.7, lead=11.2))
        y = min(bottoms) - 10

    y -= 4

    # ── Who pays ─────────────────────────────────────────────────────────────
    c.setStrokeColor(HexColor(BORDER_LIGHT))
    c.setLineWidth(0.8)
    c.line(MARGIN, y, W - MARGIN, y)
    y -= 15
    s.text(ECONOMICS_TITLE.upper(), MARGIN, y, font="Helvetica-Bold", size=7.4, colour=GOLD)
    y = s.para(ECONOMICS, MARGIN + 92, y, CONTENT - 92, size=8.6, lead=11.2, colour=TEXT_SOFT)
    y -= 12

    # ── The hook ─────────────────────────────────────────────────────────────
    hook_lines = s.wrap(HOOK, "Helvetica", 9, CONTENT - 34)
    hook_h = 22 + len(hook_lines) * 11.8 + 12
    c.setFillColor(HexColor(CREAM))
    c.setStrokeColor(HexColor(BORDER_LIGHT))
    c.setLineWidth(0.8)
    c.rect(MARGIN, y - hook_h, CONTENT, hook_h, stroke=1, fill=1)
    c.setFillColor(HexColor(GOLD))
    c.rect(MARGIN, y - hook_h, 3, hook_h, stroke=0, fill=1)

    hy = y - 17
    s.text(HOOK_TITLE.upper(), MARGIN + 17, hy, font="Helvetica-Bold", size=7.6, colour=NAVY)
    s.para(HOOK, MARGIN + 17, hy - 14, CONTENT - 34, size=9, lead=11.8, colour=NAVY_MID)
    y -= hook_h + 20

    # ── Close ────────────────────────────────────────────────────────────────
    s.text(CLOSE, MARGIN, y, font="Times-Bold", size=12.5, colour=NAVY)
    y -= 15
    s.text(f'{BRAND["site"]}   ·   {BRAND["contact"]}', MARGIN, y, size=9, colour=GOLD)
    y -= 12

    # ── Footer ───────────────────────────────────────────────────────────────
    c.setStrokeColor(HexColor(BORDER))
    c.setLineWidth(0.6)
    c.line(MARGIN, MARGIN - 8, W - MARGIN, MARGIN - 8)
    s.text("Property management fee ranges are industry benchmarks, not a TitanOS quote.",
           MARGIN, MARGIN - 20, size=7, colour=TEXT_MUTE)
    rt = BRAND["name"]
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
    ap.add_argument("out", nargs="?", default="TitanOS_RIA_Value.pdf")
    a = ap.parse_args()
    print(f"wrote {a.out} — single page, content bottom at y={build(a.out):.0f}")
