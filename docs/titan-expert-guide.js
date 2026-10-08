// Titan Expert User Guide.
//
// Replaces the 5-page "Advisor User Guide" of 6 July 2026, which still used the
// old "Advisor" label and predated obligations and workflow cycles, correspondence
// approval and sending, statement provenance on balances, the CHRIS redesign,
// scheduled reports, per-tenant branding and per-tenant document templates —
// roughly half of what an Expert now does daily.
//
// Rendered from docs/sop-content.js, the same model behind the internal SOP and
// the firm handbook, so the guide cannot drift away from them. It uses the `firm`
// voice: the facts, with no platform administration and no references to our own
// operations. Administration is confined to a clearly marked appendix at the back,
// because an Expert cannot perform it and should not have to read past it.
//
// Branding comes from docs/brand.js, so the same generator produces the copy a
// firm issues under its own identity:
//
//   node docs/titan-expert-guide.js                       -> TitanOS master
//   BRAND_NAME="PCM Family Office" \
//   BRAND_TAGLINE="DISCOVER · SIMPLIFY · EXECUTE" \
//   BRAND_LOGO=../public/pcm-logo-full.png \
//   node docs/titan-expert-guide.js PCM_Titan_Expert_User_Guide.docx
//
// Usage: node docs/titan-expert-guide.js [output.docx]

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, LevelFormat,
  PageBreak, Footer, Header, PageNumber, TableOfContents,
} = require("docx");

const BRAND = require("./brand.js");
const CAPS = require("./sop-content.js");

const C = BRAND.colors;
const CW = 9360;                          // content width, twips

// ── The role label ──────────────────────────────────────────────────────────
// sop-content's firm voice says "adviser" to stay free of our own vocabulary.
// The product labels the role "Titan Expert" on every screen in every tenant, so
// a guide that says "adviser" describes a button that does not exist. Substituted
// here rather than in the shared model, so the SOP manuals keep their wording and
// this stays a rendering decision rather than a content edit.
const ROLE = "Titan Expert";
const roleWords = s => String(s)
  .replace(/\bresponsible adviser\b/g, `responsible ${ROLE}`)
  .replace(/\bthe adviser\b/g, `the ${ROLE}`)
  .replace(/\ban adviser\b/g, `a ${ROLE}`)
  .replace(/\badvisers\b/g, `${ROLE}s`)
  .replace(/\badviser\b/g, ROLE)
  .replace(/\bAdvisers\b/g, `${ROLE}s`)
  .replace(/\bAdviser\b/g, ROLE);

// ── Typography helpers ──────────────────────────────────────────────────────
const P = (text, o = {}) => new Paragraph({
  alignment: o.align,
  spacing: { before: o.before || 0, after: o.after == null ? 120 : o.after },
  children: [new TextRun({
    text: String(text), size: o.size || 21, color: o.color || C.body,
    font: o.font || "Calibri", bold: !!o.bold, italics: !!o.italic,
  })],
});

// Sections flow rather than each starting a fresh page. A page break per section
// looked orderly and produced a document that was two thirds white space, since
// most sections are half a page. Generous space above the heading separates them
// without spending a sheet on each. `newPage` is used only where a real division
// exists — the appendix.
const H1 = (text, o = {}) => new Paragraph({
  pageBreakBefore: !!o.newPage,
  heading: HeadingLevel.HEADING_1,
  spacing: { before: o.newPage ? 0 : 460, after: 160 },
  keepNext: true,
  children: [new TextRun({ text, size: 32, bold: true, color: C.navy, font: "Cambria" })],
});

const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 260, after: 100 },
  children: [new TextRun({ text, size: 23, bold: true, color: C.navy, font: "Calibri" })],
});

const eyebrow = (text) => new Paragraph({
  spacing: { before: 0, after: 60 },
  children: [new TextRun({
    text: text.toUpperCase(), size: 15, bold: true, color: C.gold,
    font: "Calibri", characterSpacing: 30,
  })],
});

const bullet = (text) => new Paragraph({
  numbering: { reference: "b", level: 0 },
  spacing: { after: 90 },
  children: [new TextRun({ text: roleWords(text), size: 21, color: C.body, font: "Calibri" })],
});

// A tinted block, used for the "watch for" notes. Not a coloured edge stripe —
// a full tint reads as a deliberate aside rather than decoration.
const callout = (label, lines, tint, textColor) => new Table({
  width: { size: CW, type: WidthType.DXA },
  columnWidths: [CW],
  borders: {
    top: { style: BorderStyle.SINGLE, size: 2, color: tint },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: tint },
    left: { style: BorderStyle.SINGLE, size: 2, color: tint },
    right: { style: BorderStyle.SINGLE, size: 2, color: tint },
  },
  rows: [new TableRow({
    // Keep the block whole. Left to split, a "watch for" note breaks across the
    // page boundary mid-sentence — and these are the paragraphs most worth
    // reading without interruption.
    cantSplit: true,
    children: [new TableCell({
      width: { size: CW, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: tint },
      margins: { top: 140, bottom: 140, left: 180, right: 180 },
      children: [
        new Paragraph({
          spacing: { after: 70 },
          children: [new TextRun({
            text: label.toUpperCase(), size: 14, bold: true,
            color: textColor, font: "Calibri", characterSpacing: 24,
          })],
        }),
        ...lines.map((l, i) => new Paragraph({
          spacing: { after: i === lines.length - 1 ? 0 : 70 },
          children: [new TextRun({ text: roleWords(l), size: 19, color: textColor, font: "Calibri" })],
        })),
      ],
    })],
  })],
});

const rule = () => new Paragraph({
  spacing: { before: 60, after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: C.gold } },
  children: [new TextRun({ text: "" })],
});

// ── Which capabilities belong to the Expert, and in what order ──────────────
// Deliberately not sop-content's order, which is built for a manual read
// cover-to-cover. This follows the shape of the working day: who you are, the
// household, its assets, then the work the platform generates for you, then the
// things that answer questions about it.
const EXPERT_ORDER = [
  "roles", "families", "properties", "portfolio", "valuables", "cashflow",
  "vault", "obligations", "correspondence", "assistant", "reports", "tasks",
  "portal",
];
// Administration an Expert cannot perform. Held back for the appendix.
const ADMIN_ORDER = ["branding", "doc-templates"];

const byId = Object.fromEntries(CAPS.map(c => [c.id, c]));

// Fail loudly on a mismatch. A capability silently dropped from the guide is the
// same class of bug as the templates that were never in the snapshot: the
// document still builds and simply omits something an Expert needs.
const known = new Set(CAPS.map(c => c.id));
const placed = new Set([...EXPERT_ORDER, ...ADMIN_ORDER]);
const missing = [...known].filter(id => !placed.has(id));
const bogus = [...placed].filter(id => !known.has(id));
if (missing.length) {
  throw new Error(
    `sop-content.js has capabilities this guide does not place: ${missing.join(", ")}.\n` +
    `Add them to EXPERT_ORDER or ADMIN_ORDER — refusing to build a guide that ` +
    `silently omits a capability.`);
}
if (bogus.length) {
  throw new Error(`This guide references capabilities that no longer exist: ${bogus.join(", ")}`);
}

// ── Document body ───────────────────────────────────────────────────────────
const k = [];
const add = (...xs) => xs.forEach(x => k.push(x));

// Cover
add(...BRAND.masthead({ align: AlignmentType.CENTER }));
add(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 900, after: 60 },
  children: [new TextRun({ text: `${ROLE} User Guide`, size: 56, bold: true, color: C.navy, font: "Cambria" })],
}));
add(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 700 },
  children: [new TextRun({ text: BRAND.NAME, size: 26, color: C.soft, font: "Calibri" })],
}));
add(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 40 },
  children: [new TextRun({
    text: `Everything in this guide describes what the platform does today. Where something is deliberately not tracked, it says so.`,
    size: 20, italics: true, color: C.soft, font: "Calibri",
  })],
}));
add(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 1200 },
  children: [new TextRun({
    text: `Issued ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    size: 18, color: C.soft, font: "Calibri",
  })],
}));

// Contents
add(new Paragraph({ children: [new PageBreak()] }));
add(new Paragraph({
  spacing: { after: 200 },
  children: [new TextRun({ text: "Contents", size: 34, bold: true, color: C.navy, font: "Cambria" })],
}));
// A written-out list, not a Word TOC field. A field only populates when the file
// is opened in Word and told to update; the PDF is generated headlessly, so a
// field TOC shipped a blank Contents page in the copy that actually gets issued.
// Page numbers are omitted rather than guessed — a wrong number is worse than none.
add(...[
  ...EXPERT_ORDER.map((id, i) => ({ n: `${i + 1}.`, t: byId[id].title })),
  { n: "", t: "Appendix — administration" },
  ...ADMIN_ORDER.map(id => ({ n: "", t: `      ${byId[id].title}` })),
].map(({ n, t }) => new Paragraph({
  spacing: { after: 80 },
  children: [
    new TextRun({ text: n ? `${n}  ` : "", size: 21, bold: true, color: C.gold, font: "Calibri" }),
    new TextRun({ text: t, size: 21, color: n ? C.body : C.navy, bold: !n, font: "Calibri" }),
  ],
})));

// How to read this
add(H1("Before you start",{newPage:true}));
add(eyebrow("How this guide is arranged"));
add(P(`This guide follows the shape of the working day rather than the shape of the menu: who you are and what you can reach, then the household and its assets, then the work the platform generates for you, then the tools that answer questions about it.`));
add(P(`Two conventions are used throughout. A ${"“"}Watch for${"”"} block marks something that fails quietly if you get it wrong — those are the parts worth reading twice. A ${"“"}Before you move on${"”"} block is a short check you can run against a household to see whether it is properly set up.`));
add(P(`Administration — users, the firm's identity, document templates and outbound email — sits in the appendix. It is there for completeness; a ${ROLE} cannot perform it.`, { after: 200 }));
add(callout("The one rule behind everything", [
  `The platform prepares; a person decides. It will draft correspondence, lay out a workflow on real dates, read a statement and propose a balance, and answer questions from a household's own records. It does not send, approve, or write a figure into a live record on its own. Approval and sending are separate acts, and both are recorded against your name.`,
], "F4F1E9", C.navy));

// Expert sections
EXPERT_ORDER.forEach(id => {
  const c = byId[id];
  add(H1(c.title));
  if (c.purpose) add(P(roleWords(c.purpose), { italic: true, color: C.soft, after: 160 }));
  add(rule());

  if (c.roles) {
    add(H2("Who can do what"));
    add(new Table({
      width: { size: CW, type: WidthType.DXA },
      columnWidths: [2600, CW - 2600],
      rows: [
        new TableRow({
          tableHeader: true,
          children: ["Role", "What they can reach"].map((h, i) => new TableCell({
            width: { size: i === 0 ? 2600 : CW - 2600, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: C.navy },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: h, size: 18, bold: true, color: "FFFFFF", font: "Calibri" })] })],
          })),
        }),
        ...c.roles.map(([r, d]) => new TableRow({
          children: [r, d].map((t, i) => new TableCell({
            width: { size: i === 0 ? 2600 : CW - 2600, type: WidthType.DXA },
            margins: { top: 90, bottom: 90, left: 140, right: 140 },
            children: [new Paragraph({ children: [new TextRun({ text: roleWords(t), size: 19, bold: i === 0, color: i === 0 ? C.navy : C.body, font: "Calibri" })] })],
          })),
        })),
      ],
    }));
    add(P("", { after: 160 }));
  }

  add(H2("What you do here"));
  c.firm.forEach(line => add(bullet(line)));

  if (c.checks && c.checks.length) {
    add(P("", { after: 80 }));
    add(callout("Before you move on", c.checks, "EDF3EE", "1E4B2E"));
    add(P("", { after: 80 }));
  }
  if (c.traps && c.traps.length) {
    add(P("", { after: 80 }));
    add(callout("Watch for", c.traps, "FEF3E2", "7A5A19"));
  }
});

// Appendix
add(H1("Appendix — administration",{newPage:true}));
add(P(`These screens are open to administrators only. They are described here so you know what exists and who to ask, not because a ${ROLE} is expected to use them.`, { italic: true, color: C.soft, after: 160 }));
add(rule());
ADMIN_ORDER.forEach(id => {
  const c = byId[id];
  add(H2(c.title));
  if (c.purpose) add(P(roleWords(c.purpose), { italic: true, color: C.soft, after: 120 }));
  c.firm.forEach(line => add(bullet(line)));
  if (c.traps && c.traps.length) {
    add(P("", { after: 80 }));
    add(callout("Watch for", c.traps, "FEF3E2", "7A5A19"));
    add(P("", { after: 120 }));
  }
});

// ── Assemble ────────────────────────────────────────────────────────────────
const OUT = process.argv[2] || `${BRAND.NAME.replace(/[^A-Za-z0-9]+/g, "_")}_${ROLE.replace(/\s+/g, "_")}_User_Guide.docx`;

const doc = new Document({
  creator: BRAND.NAME,
  title: `${ROLE} User Guide`,
  description: `${BRAND.NAME} — ${ROLE} User Guide`,
  features: { updateFields: true },      // so the TOC populates on first open
  numbering: {
    config: [{
      reference: "b",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "•",
        style: { paragraph: { indent: { left: 360, hanging: 200 } } },
      }],
    }],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } } },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: C.gold } },
          spacing: { before: 120 },
          children: [
            new TextRun({ text: `${BRAND.NAME}  ·  ${ROLE} User Guide  ·  `, size: 16, color: C.soft, font: "Calibri" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: C.soft, font: "Calibri" }),
          ],
        })],
      }),
    },
    children: k,
  }],
});

Packer.toBuffer(doc).then(b => {
  fs.writeFileSync(OUT, b);
  const expert = EXPERT_ORDER.length, admin = ADMIN_ORDER.length;
  console.log(`wrote ${OUT}`);
  console.log(`  brand: ${BRAND.NAME}`);
  console.log(`  ${expert + admin} capability areas (${expert} expert-facing, ${admin} in the appendix)`);
  console.log(`  all ${CAPS.length} capabilities in sop-content.js are placed`);
});
