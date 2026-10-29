#!/usr/bin/env python3
"""Builds the three ORDANIS SOPs (technical, Expert / Onboarding Specialist, client) as PDFs.

Content lives in the three *_content.py modules next to this file; this script wraps each in the shared ORDANIS
layout (cover, contents, running footer) and prints it to PDF with headless Chrome.

    python3 docs/sops/build_sops.py          # writes docs/sops/ORDANIS_SOP_*.pdf

Brand: navy #0A2540, gold #C9A961, paper #F8F6F1; Georgia headings, Arial body (CLAUDE.md).
"""
import base64, datetime, html, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

def data_uri(path):
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()

LOGO = data_uri(os.path.join(ROOT, "public", "ordanis-logo.png"))
MARK = data_uri(os.path.join(ROOT, "public", "ordanis-mark.png"))

CSS = """
@page { size: Letter; margin: 0.75in 0.8in 0.85in 0.8in;
  @bottom-left { content: "ORDANIS  ·  __TITLE__"; font-family: Arial, sans-serif; font-size: 7.5pt; color: #8fa0b2; letter-spacing: 0.04em; border-top: 1px solid #E6E0D2; vertical-align: top; padding-top: 6pt; }
  @bottom-right { content: "__CLASS__  ·  Page " counter(page); font-family: Arial, sans-serif; font-size: 7.5pt; color: #8fa0b2; border-top: 1px solid #E6E0D2; vertical-align: top; padding-top: 6pt; }
}
@page :first { margin: 0; @bottom-left { content: none; border: none; } @bottom-right { content: none; border: none; } }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, Helvetica, sans-serif; color: #1E293B; font-size: 10.5pt; line-height: 1.55; margin: 0; }
h1, h2, h3 { font-family: Georgia, 'Times New Roman', serif; color: #0A2540; font-weight: normal; }
h1 { font-size: 22pt; margin: 0 0 4pt; padding-bottom: 6pt; border-bottom: 2px solid #C9A961; break-after: avoid; }
h1 .num { color: #C9A961; margin-right: 8pt; }
h2 { font-size: 14pt; margin: 18pt 0 6pt; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; font-family: Arial, sans-serif; font-weight: bold; color: #0A2540; break-after: avoid; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
li { margin: 0 0 3pt; }
ol li::marker { color: #9a7b34; font-weight: bold; }
ul li::marker { color: #C9A961; }
code { font-family: Menlo, Consolas, monospace; font-size: 8.8pt; background: #F1EDE3; padding: 0 3pt; border-radius: 3pt; color: #0A2540; word-break: break-word; }
pre { font-family: Menlo, Consolas, monospace; font-size: 8.4pt; background: #0A2540; color: #F8F6F1; padding: 8pt 10pt; border-radius: 6pt; white-space: pre-wrap; word-break: break-word; margin: 4pt 0 10pt; break-inside: avoid; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 12pt; font-size: 9.5pt; break-inside: auto; }
th { background: #0A2540; color: #fff; text-align: left; font-weight: bold; padding: 5pt 7pt; }
td { padding: 5pt 7pt; border-bottom: 1px solid #E6E0D2; vertical-align: top; }
tr:nth-child(even) td { background: #FBFAF6; }
tr { break-inside: avoid; }
.section { break-before: page; }
.lede { font-size: 11.5pt; color: #3d4f63; margin-bottom: 12pt; }
.box { border-left: 4px solid #C9A961; background: #F8F6F1; padding: 8pt 12pt; margin: 8pt 0 12pt; border-radius: 0 6pt 6pt 0; break-inside: avoid; }
.box.warn { border-left-color: #b03a2e; background: #FDF4F2; }
.box.ok { border-left-color: #2e7d4f; background: #F2F8F4; }
.box .t { font-weight: bold; color: #0A2540; display: block; margin-bottom: 2pt; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.06em; }
.box.warn .t { color: #8b1a1a; }
.chris { border: 1.5px solid #C9A961; border-radius: 10pt; padding: 12pt 14pt; margin: 10pt 0 14pt; background: linear-gradient(180deg, #FFFDF8, #F8F6F1); break-inside: avoid; }
.chris .head { display: flex; align-items: center; gap: 8pt; margin-bottom: 6pt; }
.chris .head img { width: 22pt; height: 22pt; }
.chris .head span { font-family: Georgia, serif; font-size: 13pt; color: #0A2540; }
.steps { counter-reset: s; list-style: none; padding-left: 0; }
.steps > li { counter-increment: s; position: relative; padding-left: 26pt; margin-bottom: 6pt; }
.steps > li::before { content: counter(s); position: absolute; left: 0; top: 0; width: 17pt; height: 17pt; border-radius: 50%; background: #0A2540; color: #C9A961; font-weight: bold; font-size: 8.5pt; text-align: center; line-height: 17pt; }
.footer { position: fixed; bottom: -0.55in; left: 0; right: 0; font-size: 7.5pt; color: #8fa0b2; display: flex; justify-content: space-between; border-top: 1px solid #E6E0D2; padding-top: 4pt; letter-spacing: 0.04em; }
.footer b { color: #0A2540; letter-spacing: 0.14em; }
/* Cover */
.cover { height: 11in; width: 8.5in; position: relative; background: #F8F6F1; break-after: page; overflow: hidden; }
.cover .band { position: absolute; left: 0; right: 0; bottom: 0; height: 3.1in; background: #0A2540; }
.cover .band::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 5pt; background: #C9A961; }
.cover .logo { position: absolute; top: 1.35in; left: 0; right: 0; text-align: center; }
.cover .logo img { width: 4.6in; }
.cover .kind { position: absolute; top: 4.05in; left: 0; right: 0; text-align: center; font-size: 10pt; letter-spacing: 0.32em; color: #9a7b34; text-transform: uppercase; }
.cover .title { position: absolute; top: 4.45in; left: 0.9in; right: 0.9in; text-align: center; font-family: Georgia, serif; font-size: 30pt; color: #0A2540; line-height: 1.2; }
.cover .sub { position: absolute; top: 5.85in; left: 1.1in; right: 1.1in; text-align: center; font-size: 12pt; color: #3d4f63; line-height: 1.5; }
.cover .meta { position: absolute; bottom: 1.05in; left: 0.9in; right: 0.9in; color: #F8F6F1; font-size: 9.5pt; line-height: 1.7; }
.cover .meta b { color: #C9A961; font-weight: normal; letter-spacing: 0.14em; text-transform: uppercase; font-size: 8pt; display: inline-block; width: 1.35in; }
.cover .mark { position: absolute; bottom: 0.95in; right: 0.9in; width: 0.95in; opacity: 0.95; background: #F8F6F1; border-radius: 50%; padding: 6pt; }
/* Contents */
.toc { break-after: page; }
.toc ol { list-style: none; padding: 0; counter-reset: t; margin-top: 14pt; }
.toc li { counter-increment: t; padding: 7pt 0; border-bottom: 1px dotted #D8CDB8; font-size: 11pt; display: flex; gap: 12pt; }
.toc li::before { content: counter(t, decimal-leading-zero); color: #C9A961; font-family: Georgia, serif; width: 22pt; }
.toc li span { color: #5a6e84; font-size: 9.5pt; margin-left: auto; text-align: right; max-width: 55%; }
"""

def render(doc):
    """doc: dict(file, kind, title, subtitle, audience, classification, sections=[(title, blurb, html)])"""
    today = datetime.date.today().strftime("%B %-d, %Y")
    toc = "".join(f"<li>{html.escape(t)}<span>{html.escape(b)}</span></li>" for t, b, _ in doc["sections"])
    body = "".join(
        f'<div class="section"><h1><span class="num">{i:02d}</span>{html.escape(t)}</h1>{h}</div>'
        for i, (t, _, h) in enumerate(doc["sections"], 1))
    body = body.replace("__MARK__", MARK)
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(doc['title'])}</title><style>{CSS.replace("__TITLE__", doc["title"].replace('"', "")).replace("__CLASS__", doc["classification"])}</style></head><body>
<div class="cover">
  <div class="logo"><img src="{LOGO}"></div>
  <div class="kind">{html.escape(doc['kind'])}</div>
  <div class="title">{html.escape(doc['title'])}</div>
  <div class="sub">{html.escape(doc['subtitle'])}</div>
  <div class="band"></div>
  <div class="meta"><b>For</b>{html.escape(doc['audience'])}<br><b>Version</b>{today}<br><b>Classification</b>{html.escape(doc['classification'])}<br><b>Published by</b>Ordanis OS LLC</div>
  <img class="mark" src="{MARK}">
</div>
<div class="toc"><h1>Contents</h1><ol>{toc}</ol></div>
{body}
</body></html>"""

def main():
    import sop_technical, sop_expert, sop_client
    out = []
    for mod in (sop_technical, sop_expert, sop_client):
        doc = mod.DOC
        page = render(doc)
        with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as t:
            t.write(page); tmp = t.name
        pdf = os.path.join(HERE, doc["file"])
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        f"--print-to-pdf={pdf}", "file://" + tmp], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.unlink(tmp)
        out.append(pdf)
    print("\n".join(out))

if __name__ == "__main__":
    main()
