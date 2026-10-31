// Client activity report — the PDF renderer.
//
// A document a household reads and, if it lands, stops them asking what the fee
// is for. That makes every line a claim about work performed, so it may only
// assert what there is a dated record of.
//
// WHY THIS IS ITS OWN MODULE, NOT PART OF App.jsx
//
// It contains no JSX and touches no React, which means it can be exercised in node
// against a real payload pulled from the database. A renderer embedded in the
// component tree can only be tested by clicking through a deployed site, and this
// one has to be right the first time it is shown to a client.
//
// WHY IT RENDERS IN THE BROWSER RATHER THAN AN EDGE FUNCTION
//
// The report is generated on demand during a meeting. An edge function means a cold
// start and a round trip on a platform where "Run Now" has already produced a 504
// once, and pdf-lib is already in the app for the AcroForm templates. Rendering
// locally is instant, uses the brand already loaded in the session, and cannot
// time out.
//
// SECTION ORDER, WHICH IS THE ARGUMENT
//
// 01 Obligations discharged — strongest material, because it has sequence and
//    dates. "Notices issued 26 Sep, window closed 27 Oct, trustee authorised
//    3 Nov" is diligence a client's attorney recognises on sight.
// 02 Exposures raised and closed — the section that justifies the fee. Risk
//    avoided, not work completed.
// 03 The numbers behind the reporting — provenance. Every balance with its as-of
//    date and whether a statement backs it.
// 04 Still in flight — open items, stated plainly. A report showing only wins
//    reads as marketing; showing what is open is what makes the rest believable.
//
// The obvious version of this document is a count sheet — "142 documents filed, 38
// tasks completed" — which reads as busywork and invites "I'm paying you to upload
// files?". Counts appear only as supporting detail under a claim.

// pdf-lib is about a quarter of the app's download, so it is fetched the first time a report is built rather than
// with the app (scaling step 3). The helpers below use rgb only while a report is being built, after this has run.
let PDFDocument, StandardFonts, rgb;
async function loadPdfLib() {
  if (PDFDocument) return;
  try { ({ PDFDocument, StandardFonts, rgb } = await import("pdf-lib")); }
  catch (_e) { throw new Error("ORDANIS was updated since this page opened. Please reload the page and try again."); }
}

const PAGE = [612, 792], MARGIN = 54;
const CONTENT = PAGE[0] - MARGIN * 2;

const hexToRgb = h => {
  const s = String(h || "").replace("#", "").trim();
  const v = s.length === 3 ? s.split("").map(c => c + c).join("") : s;
  const n = parseInt(v.slice(0, 6) || "000000", 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};
const toRgb = h => { const [r, g, b] = hexToRgb(h); return rgb(r, g, b); };
const mix = (a, b, t) => {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgb(x[0] * (1 - t) + y[0] * t, x[1] * (1 - t) + y[1] * t, x[2] * (1 - t) + y[2] * t);
};
// Relative luminance, so a light brand accent is never used for text. Accurate's
// #b6c1de measures about 1.6:1 on white and would be illegible on a projector —
// the same trap the pitch deck's gold fell into. The accent fills rules and
// panels; text uses the primary or a tone derived from it.
const lum = h => {
  const c = hexToRgb(h).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

// The standard PDF fonts encode WinAnsi only, and pdf-lib THROWS on a character
// outside it. Client data is arbitrary — a pasted name with a Cyrillic character,
// a smart apostrophe from Word, an emoji in a note — and a hard failure halfway
// through would mean the Expert gets no document at all, in front of the client,
// with an error mentioning code points. Substituting the few characters that
// actually occur and replacing anything else keeps the document renderable and
// visibly imperfect rather than absent.
const SUBS = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"',
  "′": "'", "″": '"',
  "‐": "-", "‑": "-", "‒": "-", "―": "-",
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
  "​": "", "‌": "", "‍": "", "﻿": "",
  "−": "-", "⁄": "/",
};
// Present in WinAnsi and worth keeping: — – … · • € † ‡ ‰ ™ © ® ° « » ‹ › ¶ § ¢ £ ¥
const WINANSI_EXTRA = new Set([..."–—…·•€†‡‰™©®°«»‹›¶§¢£¥ƒŠŒŽ‹ˆ˜"]);
export function winAnsi(text) {
  let out = "";
  for (const ch of String(text == null ? "" : text)) {
    if (ch in SUBS) { out += SUBS[ch]; continue; }
    const cp = ch.codePointAt(0);
    // Printable Latin-1 range, plus tab/newline handled by the caller.
    if ((cp >= 0x20 && cp <= 0x7E) || (cp >= 0xA0 && cp <= 0xFF) || WINANSI_EXTRA.has(ch)) {
      out += ch;
    } else {
      out += "?";
    }
  }
  return out;
}

// The heading, DERIVED from the boundaries the data was actually gathered on.
//
// Mirrors report_period() in SQL. A caller that supplies both a range and a
// description can make them disagree, and nothing on the page would reveal it — a
// document titled "Q2" containing five weeks of data looks perfectly fine. So this
// recomputes the label and buildActivityReportPdf cross-checks it against the
// label the database returned; a mismatch refuses to render rather than picking one.
const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
export function periodLabel(kind, dFrom, dTo) {
  if (!dFrom || !dTo) throw new Error("A reporting period needs both a start and an end.");
  const f = new Date(dFrom + "T00:00:00Z"), t = new Date(dTo + "T00:00:00Z");
  if (isNaN(f) || isNaN(t)) throw new Error(`Unreadable period dates: ${dFrom} to ${dTo}.`);
  if (!(t > f)) throw new Error(`Reporting period must end after it starts (got ${dFrom} to ${dTo}).`);
  const end = new Date(t.getTime() - 86400000);
  const long = d => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const fm = f.getUTCMonth(), fd = f.getUTCDate(), fy = f.getUTCFullYear();

  if (kind === "month") {
    if (!(fd === 1 && t.getUTCDate() === 1 && ((t.getUTCMonth() - fm) + 12) % 12 === 1))
      throw new Error(`'month' period is not a whole calendar month: ${dFrom} to ${dTo}.`);
    return `${MONTHS[fm]} ${fy}`;
  }
  if (kind === "quarter") {
    if (!(fd === 1 && [0, 3, 6, 9].includes(fm)))
      throw new Error(`'quarter' period does not start a calendar quarter: ${dFrom}.`);
    return `Q${Math.floor(fm / 3) + 1} ${fy}`;
  }
  if (kind === "year") {
    if (!(fm === 0 && fd === 1))
      throw new Error(`'year' period does not start a calendar year: ${dFrom}.`);
    return `Calendar year ${fy}`;
  }
  if (kind === "trailing_12") return `Twelve months to ${long(end)}`;
  if (kind === "custom") return `${long(f)} to ${long(end)}`;
  throw new Error(`Unknown period kind '${kind}'. Expected month, quarter, year, trailing_12 or custom.`);
}

// A figure the platform could not measure prints as an em dash, never as 0.
// client_activity_payload() returns null rather than 0 when the underlying rows
// cannot be placed in the period; coercing it here would undo the point, since on a
// client-facing document 0 reads as "this did not happen" rather than "we cannot
// evidence this".
export const fig = v => (v === null || v === undefined) ? "—" : String(v);

export async function buildActivityReportPdf({
  payload, brandName, tagline, logoUrl, primaryHex, accentHex, fetchImpl,
}) {
  const per = payload.period || {};
  const label = periodLabel(per.kind, per.from, per.to);
  if (per.label_from_db && per.label_from_db !== label) {
    throw new Error(
      `The reporting period is described two different ways — the database says ` +
      `"${per.label_from_db}" and the dates ${per.from} to ${per.to} describe ` +
      `"${label}". Nothing was produced, because either heading could be the wrong one.`);
  }

  await loadPdfLib();
  const doc = await PDFDocument.create();
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bodyB = await doc.embedFont(StandardFonts.HelveticaBold);
  const head = await doc.embedFont(StandardFonts.TimesRomanBold);

  const PRIMARY = toRgb(primaryHex);
  const ACCENT = toRgb(accentHex);
  const LABEL = lum(accentHex) > 0.45 ? mix(accentHex, primaryHex, 0.72) : ACCENT;
  const SOFT = mix(primaryHex, "#ffffff", 0.42);
  const PANEL = mix(accentHex, "#ffffff", 0.80);
  const RULE = mix(accentHex, "#ffffff", 0.45);
  const HAIR = mix(accentHex, "#ffffff", 0.72);

  let page = doc.addPage(PAGE), y = PAGE[1] - MARGIN;

  const text = (t, o) => page.drawText(winAnsi(t), o);
  const wrap = (txt, font, size, width) => {
    const words = winAnsi(txt).split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines = []; let cur = words[0];
    for (const w of words.slice(1)) {
      if (font.widthOfTextAtSize(cur + " " + w, size) <= width) cur += " " + w;
      else { lines.push(cur); cur = w; }
    }
    lines.push(cur);
    return lines;
  };
  const newPage = () => { page = doc.addPage(PAGE); y = PAGE[1] - MARGIN; };
  const room = n => { if (y - n < MARGIN + 52) newPage(); };
  const para = (txt, { size = 9.2, lead = 12, colour = PRIMARY, font = body, after = 10, width = CONTENT } = {}) => {
    for (const ln of wrap(txt, font, size, width)) {
      room(lead + 2);
      text(ln, { x: MARGIN, y: y - size, size, font, color: colour });
      y -= lead;
    }
    y -= after;
  };

  // ── Masthead ──────────────────────────────────────────────────────────────
  if (logoUrl) {
    // A missing or unreadable logo must not cost the client their report. The
    // document still carries the firm's name in text, so it is never unbranded.
    try {
      const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
      if (f) {
        const res = await f(logoUrl);
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer());
          const img = /\.jpe?g(\?|$)/i.test(logoUrl)
            ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
          const h = 38, w = img.width * (h / img.height);
          page.drawImage(img, { x: MARGIN, y: y - h, width: Math.min(w, 190), height: h });
          y -= h + 12;
        }
      }
    } catch { /* fall through to the text masthead */ }
  }
  text(brandName || "", { x: MARGIN, y: y - 11, size: 11, font: bodyB, color: PRIMARY });
  if (tagline) {
    const t = winAnsi(tagline).toUpperCase();
    text(t, { x: PAGE[0] - MARGIN - body.widthOfTextAtSize(t, 7.6), y: y - 10, size: 7.6, font: body, color: LABEL });
  }
  y -= 24;
  text("Client activity report", { x: MARGIN, y: y - 22, size: 22, font: head, color: PRIMARY });
  y -= 30;
  text(`${payload.meta?.household || "—"}  ·  ${label}`,
    { x: MARGIN, y: y - 11, size: 11, font: body, color: LABEL });
  y -= 20;
  page.drawRectangle({ x: MARGIN, y, width: CONTENT, height: 2, color: ACCENT });
  y -= 24;

  para("This report sets out what was done on your behalf over the period: the " +
    "commitments we discharged, the exposures we identified and closed, and the " +
    "records behind every figure in your reporting. Where something remains open, " +
    "it is listed.", { size: 10.4, lead: 13.4, after: 16 });

  // ── Stat band ─────────────────────────────────────────────────────────────
  const s = payload.summary || {};
  const stats = [
    [fig(s.obligations_closed), "workflows completed"],
    [fig(s.exposures_raised), "exposures raised"],
    [fig(s.exposures_closed), "exposures closed"],
    [fig(s.approvals), "items approved by your adviser"],
    [fig(s.statements), "statements read and reconciled"],
  ];
  room(66);
  {
    const gap = 12, w = (CONTENT - gap * (stats.length - 1)) / stats.length;
    stats.forEach(([v, lab], i) => {
      const x = MARGIN + i * (w + gap);
      page.drawRectangle({ x, y: y - 46, width: w, height: 46, color: PANEL });
      text(v, { x: x + 10, y: y - 25, size: 20, font: head, color: PRIMARY });
      wrap(lab, body, 7.2, w - 20).slice(0, 2).forEach((ln, j) => {
        text(ln, { x: x + 10, y: y - 36 - j * 8.2, size: 7.2, font: body, color: LABEL });
      });
    });
    y -= 66;
  }

  // How much vertical space a table's opening needs: its header plus its first few
  // rows, measured after wrapping. Passed to section() so the heading, its claim
  // and the start of its table are reserved together.
  //
  // Without this the heading fits, the table then breaks the page on its own, and
  // the reader gets a heading stranded at the foot of one page with its content on
  // the next — or a single orphan row followed by half a page of white space, which
  // is what section 02 did on the first render.
  const rowHeight = (r, widths) =>
    Math.max(...r.map((c, i) => wrap(c, body, 8.2, widths[i] - 8).length)) * 10.4 + 6;
  const tableNeed = (rows, widths, maxRows = 3) =>
    17 + rows.slice(0, Math.min(maxRows, rows.length))
             .reduce((a, r) => a + rowHeight(r, widths), 0);

  // A section heading must never be the last thing on a page.
  const section = (num, title, claim, needs = 0) => {
    room(58 + (claim ? wrap(claim, body, 9.6, CONTENT).length * 12.6 : 0) + needs);
    text(num, { x: MARGIN, y: y - 13, size: 13, font: head, color: RULE });
    text(title, { x: MARGIN + 30, y: y - 13, size: 13.4, font: head, color: PRIMARY });
    y -= 20;
    page.drawRectangle({ x: MARGIN, y, width: CONTENT, height: 0.8, color: RULE });
    y -= 14;
    if (claim) para(claim, { size: 9.6, lead: 12.6, after: 10 });
  };

  const header = (cols, widths) => {
    let x = MARGIN;
    cols.forEach((c, i) => {
      text(String(c).toUpperCase(), { x, y: y - 8, size: 6.8, font: bodyB, color: LABEL });
      x += widths[i];
    });
    y -= 13;
    page.drawRectangle({ x: MARGIN, y, width: CONTENT, height: 0.6, color: RULE });
    y -= 4;
  };
  const table = (cols, rows, widths) => {
    header(cols, widths);
    for (const r of rows) {
      // Wrap every cell before measuring so the row is as tall as its tallest
      // cell. A row sized to the first column silently truncates the rest.
      const cells = r.map((c, i) => wrap(c, body, 8.2, widths[i] - 8));
      const lines = Math.max(...cells.map(c => c.length));
      const hgt = lines * 10.4 + 6;
      if (y - hgt < MARGIN + 52) { newPage(); header(cols, widths); }
      let cx = MARGIN;
      cells.forEach((c, i) => {
        c.forEach((ln, j) => {
          text(ln, { x: cx, y: y - 9 - j * 10.4, size: 8.2, font: body, color: i === 0 ? PRIMARY : SOFT });
        });
        cx += widths[i];
      });
      y -= hgt;
      page.drawRectangle({ x: MARGIN, y: y + 2, width: CONTENT, height: 0.4, color: HAIR });
    }
    y -= 12;
  };

  // ── 01 Obligations discharged ─────────────────────────────────────────────
  const obligations = payload.obligations || [];
  {
    const n = obligations.length;
    const claim = n === 0
      ? "No workflow reached completion inside this period. Any cycle still " +
        "running is listed in section 04."
      : n === 1
        ? `The ${obligations[0].cycle} closed on ${obligations[0].closed}, in sequence.`
        : `${n} workflows were completed in this period, each in sequence.`;
    const STEP_W = [186, 52, 62, CONTENT - 300];
    // The wording a step has earned. A ticked checkbox is not proof, and this
    // document may end up in a fee conversation.
    const stepRows = o => (o.steps || []).map(st => [st.title, st.due || "—", st.done || "—",
      st.note || (st.evidenced ? "Evidenced in the record." : "Recorded complete.")]);
    section("01", "Workflows completed", claim,
      n ? tableNeed(stepRows(obligations[0]), STEP_W) : 0);
    obligations.forEach(o => {
      if (n > 1) {
        room(20 + tableNeed(stepRows(o), STEP_W));
        text(o.cycle, { x: MARGIN, y: y - 10, size: 9.4, font: bodyB, color: PRIMARY });
        y -= 17;
      }
      const steps = o.steps || [];
      table(["Step", "Due", "Completed", "Record"], stepRows(o), STEP_W);
      const ev = steps.filter(st => st.evidenced).length;
      const parts = [`${steps.length} step${steps.length === 1 ? "" : "s"}, all recorded complete`];
      if (Number(o.approvals)) parts.push(`${o.approvals} required your adviser's approval before proceeding`);
      if (Number(o.sent)) parts.push(`${o.sent} produced correspondence sent on your behalf`);
      para(`${parts.join("; ")}. ${ev} of ${steps.length} carry a document or a sent message as ` +
        `evidence; the remainder are recorded complete without an attached artefact.`,
        { size: 8.2, lead: 10.6, colour: SOFT, after: 14 });
    });
  }

  // ── 02 Exposures ──────────────────────────────────────────────────────────
  {
    const items = payload.exposures || [];
    const open = Number(s.exposures_open) || 0;
    const claim = items.length === 0
      ? "No exposure was raised in this period."
      : `${items.length} exposure${items.length === 1 ? " was" : "s were"} identified during the ` +
        `period. ${Number(s.exposures_closed) || 0} closed` +
        (open ? `; ${open} remain${open === 1 ? "s" : ""} open and ${open === 1 ? "is" : "are"} listed in section 04.` : ".");
    const EXP_W = [50, 192, 58, CONTENT - 300];
    const expRows = items.map(x => [x.raised || "—", x.title || "—", x.source || "—",
      x.closed
        ? `Closed ${x.closed} — ${x.outcome || ""}`.trim()
        : `Open${x.severity === "urgent" ? ", urgent" : ""} — ${x.outcome || ""}`.trim()]);
    section("02", "Exposures raised, and what happened to them", claim,
      expRows.length ? tableNeed(expRows, EXP_W) : 0);
    if (expRows.length) table(["Raised", "What was noticed", "Noticed by", "Outcome"], expRows, EXP_W);
  }

  // ── 03 Provenance ─────────────────────────────────────────────────────────
  {
    const accts = payload.provenance || [];
    const ACC_W = [150, 74, 74, 84, CONTENT - 382];
    const accRows = accts.map(a => [a.institution || "—", String(a.quarters ?? "—"),
      a.latest_as_of || "—", a.balance || "—",
      // Says outright when a balance is not fully backed by statements, rather
      // than letting "Statement on file" imply all of them are.
      Number(a.sourced) >= Number(a.quarters)
        ? "Statement on file"
        : `${a.sourced || 0} of ${a.quarters || 0} sourced`]);
    section("03", "The numbers behind your reporting",
      accts.length
        ? "Every balance in your reporting carries the date it was true and whether a statement backs it."
        : "No statement covering this period has been filed against an account.",
      accRows.length ? tableNeed(accRows, ACC_W) : 0);
    if (accRows.length) table(["Account", "Quarters on file", "Most recent", "Balance", "Source"], accRows, ACC_W);
  }

  // ── 04 Still in flight ────────────────────────────────────────────────────
  {
    const items = payload.in_flight || [];
    section("04", "Still in flight",
      items.length ? "Open at the close of the period."
                   : "Nothing was open at the close of the period.");
    items.forEach(it => {
      const txt = typeof it === "string" ? it : (it.text || "");
      const lines = wrap(txt, body, 8.8, CONTENT - 14);
      room(lines.length * 11 + 6);
      page.drawRectangle({ x: MARGIN + 1, y: y - 7, width: 3, height: 3, color: ACCENT });
      lines.forEach((ln, j) => {
        text(ln, { x: MARGIN + 12, y: y - 9 - j * 11, size: 8.8, font: body, color: PRIMARY });
      });
      y -= lines.length * 11 + 4;
    });
    y -= 6;
  }

  // ── Data gaps, then the scope note ────────────────────────────────────────
  //
  // Both are mandatory and neither can be switched off. The gaps are the reasons a
  // figure above is absent or lower than it looks; the scope note stops a client
  // mistaking this for a complete account of the relationship.
  const gaps = payload.data_gaps || [];
  if (gaps.length) {
    room(44);
    para("Where the record is incomplete", { size: 9, font: bodyB, colour: PRIMARY, after: 4 });
    gaps.forEach(g => para("· " + g, { size: 8, lead: 10.2, colour: SOFT, after: 2 }));
    y -= 8;
  }
  room(60);
  page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT, height: 0.8, color: RULE });
  y -= 14;
  // Dates in prose, not ISO. period.to is exclusive, so the last day INSIDE the
  // period is the day before it — printing the boundary itself would tell a client
  // the report covers a day it does not, and "(exclusive)" is internal vocabulary
  // that means nothing to them.
  const spanEnd = new Date(new Date(per.to + "T00:00:00Z").getTime() - 86400000);
  const longDate = d => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  para(`This report covers work recorded in the platform between ` +
    `${longDate(new Date(per.from + "T00:00:00Z"))} and ${longDate(spanEnd)}, inclusive. ` +
    `Each item is drawn from a dated record — an approval, a sent message, a filed ` +
    `statement or a logged exception. Meetings, calls and correspondence handled outside ` +
    `the platform are not included, so this is an account of recorded work rather than of ` +
    `the whole relationship.`,
    { size: 7.6, lead: 9.8, colour: SOFT, after: 0 });

  // Page numbers last, once the total is known.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(winAnsi(`${brandName || ""}  ·  ${i + 1} of ${pages.length}`),
      { x: MARGIN, y: 28, size: 7, font: body, color: SOFT });
  });

  return await doc.save();
}

// The five periods, matching report_period()'s kinds exactly. The UI names a kind
// and the database resolves it; nothing here computes a boundary.
export const AR_PERIODS = [
  { kind: "trailing_12", label: "Trailing 12 months" },
  { kind: "month", label: "Monthly" },
  { kind: "quarter", label: "Quarterly" },
  { kind: "year", label: "Annual" },
  { kind: "custom", label: "Custom range" },
];
