// TitanOS pitch deck — one real screenshot per slide, with talking points.
//
// Every image here was captured from the live demo (titanosdemo.vercel.app) on
// 28 July 2026, signed in as a Titan Expert, with the tenant skinned as Accurate
// Advisory Group. Nothing is a mockup, so nothing in this deck can drift away
// from what the product actually does.
//
// Colours, wordmark and tagline all come from docs/brand.js, so this deck cannot
// drift from the other generated documents. The two navy slides use the brand's
// knockout artwork (white TITAN, gold OS) because the primary logo is
// navy-on-transparent and would vanish on navy.
//
// Usage:  node docs/pitch-deck.js [output.pptx]

const pptxgen = require("pptxgenjs");
const path = require("path");
const brand = require("./brand");

const NAVY  = brand.colors.navy;
const GOLD  = brand.colors.gold;   // brand gold — used on the two navy slides only
// The brand gold on white measures about 1.8:1 contrast, which survives a laptop
// screen and disappears on a projector. BRONZE is the same hue darkened to ~5:1
// so the eyebrow and "SAY THIS" labels stay readable in a boardroom.
const BRONZE = "8A6E3C";
const SOFT  = brand.colors.soft;
const BODY  = brand.colors.body;
const CARD  = "F5F7F9";
const ICE   = "C3D0DD";
const WHITE = "FFFFFF";

const SERIF = "Cambria";
const SANS  = "Calibri";

const HERE   = __dirname;
const FRAMES = path.join(HERE, "pitch-frames");
const img    = f => path.join(FRAMES, f);
const KNOCKOUT = brand.LOGO_KNOCKOUT;

// ── Content ─────────────────────────────────────────────────────────────────
// `points` are the talking points printed on the slide. `say` is the one line to
// land at the end. `notes` is the spoken script, which goes in speaker notes.

const SLIDES = [
  {
    eyebrow: "One client, one screen",
    title: "Everything about a household, the moment you open it",
    file: "screenshot-1785281465902-f3d8e671.jpg",
    points: [
      "Net worth is composed, not typed. $83.31M is real estate plus portfolio plus valuables, less debt — each figure owned by the tab it comes from.",
      "People are first-class records. Charles II carries the PRIMARY badge, so the platform knows who to copy on correspondence without anyone remembering.",
      "Outside counsel, the CPA and the art advisor sit alongside the family, each starred if they lead their discipline.",
      "Tasks near their due date show a clock. No one maintains this screen by hand.",
    ],
    say: "This is what a Titan Expert sees ten seconds after opening a client. No spreadsheet, no digging.",
    notes: "Open here. The point is arrival time. Every other system makes you assemble this picture; this one holds it. Call out the PRIMARY badge specifically — it comes back three slides from now when the platform copies Charles automatically on a wire request.",
  },
  {
    eyebrow: "The working queue",
    title: "The platform tells you what needs you today",
    file: "screenshot-1785281427135-4850f617.jpg",
    points: [
      "The whole book in one band: two families, $46.6M of real estate, $45.6M across seven accounts, six open tasks, three due soon.",
      "“Awaiting your review — 3 items across the book” spans clients, so nothing hides inside a single household.",
      "Late steps carry a warning mark against the date. Jul 21, 23 and 26 are all overdue, and the platform volunteers that rather than waiting to be asked.",
      "One line does the heaviest work: “Approving records your name against the step. Nothing here has been sent yet.”",
    ],
    say: "The system's job is to make the next action obvious — and to never quietly act on your behalf.",
    notes: "Read the review-queue sentence aloud, verbatim. Advisors have been burned by tools that send things. Saying 'nothing here has been sent yet' is on the screen, not in the sales pitch, and that distinction is the whole trust argument.",
  },
  {
    eyebrow: "Human in the loop",
    title: "The platform drafts. A person approves. Then it sends.",
    file: "screenshot-1785282236347-b4bb4663.jpg",
    points: [
      "A $750,000 wire request arrives fully composed — recipient, subject, amount, reference, purpose — assembled from the client's own records.",
      "Where the record couldn't supply a fact it says so in square brackets instead of inventing one, and the body states that no wire instructions are reproduced from memory.",
      "The family's primary contact is copied automatically: Charles Whitmore II, resolved from the household rather than retyped.",
      "Four distinct buttons — re-draft, save without approving, approve but don't send, approve and send. Approval and sending are separate decisions.",
    ],
    say: "This is the slide that answers the compliance question. The platform writes; a licensed human signs.",
    notes: "Slow down here. This is the objection-handling slide. Two things to emphasise: the bracketed placeholders (the model refuses to guess a wire instruction) and the fact that 'approve' and 'send' are different buttons. If someone asks about prompt injection from an uploaded document, mention that outbound recipients are checked against an allowlist of addresses already known for that family.",
  },
  {
    eyebrow: "Recurring work",
    title: "Commitments that carry their own playbook",
    file: "screenshot-1785282187360-b4f3eb5d.jpg",
    points: [
      "A $750,000 capital call due 2 August and a $185,000 ILIT premium due 15 November, each attached to a named playbook rather than a reminder.",
      "The capital call reads At risk and explains itself: “Started late: 'Call notice received and read' was due 2026-07-21.”",
      "The ILIT carries a “crummey required” flag, and that flag decides whether the Crummey steps appear in the cycle at all.",
      "Annual obligations regenerate. Close the 2026 cycle and 2027 is already understood.",
    ],
    say: "Most family offices track this in someone's head or someone's calendar. Here the obligation owns the process.",
    notes: "The self-flagging 'At risk' line is the sell. It is not a dashboard someone has to read — the record noticed it was behind and said which step slipped and when it was due. Nine playbooks ship today: capital calls, ILIT premiums, GRAT annuities, note interest, in-force reviews, RMDs, K-1 chases, policy reviews and tax documents.",
  },
  {
    eyebrow: "Nine steps, real dates",
    title: "An ILIT premium, laid out before anyone touches it",
    file: "screenshot-1785281567906-633617db.jpg",
    points: [
      "Start the cycle and every step takes a date: invoice read 1 Sep, transfer prepared 16 Sep, funds confirmed 26 Sep.",
      "Crummey notices go out 28 September. The withdrawal window closes 28 October — thirty days later, calculated rather than guessed.",
      "The trustee is only asked to authorise on 5 November, after the window has closed. The sequence enforces the doctrine.",
      "Every step names who acts: AI prepares, Expert acts, or waiting on someone else. The three outbound steps read “Prepare draft.”",
    ],
    say: "If you want one screen that shows what this platform actually is, it's this one.",
    notes: "This is the technical high point. An ILIT premium mishandled costs the client the gift-tax exclusion, and the failure mode is almost always sequence: the trustee pays before the withdrawal window lapses. The platform makes that ordering structural instead of remembered. Pause and let them read the dates.",
  },
  {
    eyebrow: "Provenance",
    title: "Every balance points back to the statement it came from",
    file: "screenshot-1785281528582-20e0d7f4.jpg",
    points: [
      "$26,840,000 “as at Jun 30, 2026 · 2026-Q2.” A balance without an as-of date is a rumour.",
      "Balance history keeps one row per statement — four quarters, each with its change, each stamped READ or OPENING and attributed to whoever entered it.",
      "The statements strip links to the filed PDF for every quarter. Click the quarter, read the source.",
      "The account's current balance is maintained by the database itself, so it always agrees with the newest dated row no matter who writes it.",
    ],
    say: "When a client asks where a number came from, you don't reconstruct it — you open it.",
    notes: "Provenance is the quiet differentiator against a spreadsheet. Note that the current balance is enforced by a database trigger, not by application code, which means the invariant holds even if someone loads data another way. Mention that extraction proposes the closing balance and period end from the uploaded statement, and the Expert confirms it — the platform never writes a balance on its own.",
  },
  {
    eyebrow: "The record",
    title: "One document store, and it feeds everything else",
    file: "screenshot-1785282207928-13ea1b87.jpg",
    points: [
      "Thirty-seven documents across eight categories for this household — tax, insurance, real estate, estate planning.",
      "These aren't inert files. A statement filed here is the same object the portfolio balance links to, and the same one an outbound draft attaches.",
      "“Scan 16 for AI” reads the unprocessed documents and proposes fields — a closing balance, a period end — for a person to confirm.",
      "Extraction proposes; the Expert accepts. Nothing is written straight into a live record.",
    ],
    say: "Documents are usually a graveyard. Here they're load-bearing.",
    notes: "Keep this one brief — it is the plumbing slide. The single idea worth landing: CHRIS is not a filing cabinet bolted on the side, it is the same store the balances, the property sections and the outbound attachments all reference.",
  },
  {
    eyebrow: "Projection",
    title: "Cash flow and tax on the same set of assumptions",
    file: "screenshot-1785281620562-36843fec.jpg",
    points: [
      "“3 of 36 months run negative” is the sentence that matters. An average monthly surplus hides liquidity gaps; this names them.",
      "The three deep red spikes in the chart are those months. You see the problem before you read the number.",
      "$282.5K a month in, $189.9K out, $92.6K net — and the cumulative line closing the three-year window at $3.3M.",
      "Ten income and expense events drive it, each on its own cadence. Change the state or the filing status above and the whole projection re-rates.",
    ],
    say: "A planning tool a client will actually sit through, because every input is their own.",
    notes: "Point at the three red spikes, then at the '3 of 36' badge, and let them connect the two themselves. Any tool can show an average monthly surplus; the useful question is which months break. Scroll up in the live demo if they ask about assumptions — three-year window, married filing jointly, Florida at zero, and a relocation comparison that re-rates the whole projection against a second state. If they push on tax accuracy, be straight: this is a projection for planning conversations, not a return.",
  },
  {
    eyebrow: "Scoped by design",
    title: "The assistant answers about one client at a time",
    file: "screenshot-1785282257140-def86f10.jpg",
    points: [
      "Before it will answer anything it asks which client. There is no cross-client question you can accidentally pose.",
      "That isn't a UI nicety — the assistant only ever receives one household's records, so a leak between clients has nowhere to happen.",
      "The Expert sees only their own book, enforced by row-level security in the database, so the rule holds even outside the app.",
      "Each licensed firm runs on its own database and its own deployment. Code is shared between tenants; client data never is.",
    ],
    say: "Every advisor asks about data separation. This is the answer, and it's structural rather than promised.",
    notes: "Lead with the fact that the gate is a design decision, not a limitation. Then go one level down: authorisation lives in the database as row-level security, so it applies to every path into the data, not just the screens. Then one level further: separate Supabase project and separate deployment per firm. Three layers, and only the outermost is UI.",
  },
  {
    eyebrow: "Grounded answers",
    title: "It reconciles — and it volunteers what's wrong",
    file: "screenshot-1785281408098-227d3c07.jpg",
    points: [
      "Asked for net worth it returns $83,310,000, split into real estate, portfolio, valuables and debt — and the total matches the dashboard exactly.",
      "It names all four custodians and itemises $15.25M of debt down to the $6.4M interest-only mortgage on Star Island.",
      "Unprompted, it flags that the 1967 Ferrari 275 GTB at $3.1M is currently uninsured. Nobody asked about insurance.",
      "Print, email or share the answer — and the footer states plainly that this is not financial, tax or legal advice.",
    ],
    say: "The value isn't that it answered quickly. It's that it noticed the uninsured Ferrari.",
    notes: "Close the product walkthrough here. Two beats: first, the total reconciles to the number on the overview slide — go back one slide if you need to prove it. Second, the uninsured Ferrari. That is the difference between a chatbot and something worth paying for: it read the book and told the advisor about an exposure nobody queried.",
  },
];

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";                 // 13.3 x 7.5 — must be set before any slide
pres.author = brand.NAME;
pres.company = brand.NAME;
pres.title = `${brand.NAME} — Product Walkthrough`;
pres.subject = "Live screens captured 28 July 2026";

const W = 13.3, H = 7.5;

// ── Cover ───────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: NAVY };

  s.addImage({ path: KNOCKOUT, x: 0.9, y: 1.78, w: 4.6, h: 4.6 * (280 / 1500),
               altText: `${brand.NAME} wordmark` });

  s.addText(brand.TAGLINE, {
    x: 0.92, y: 2.78, w: 8, h: 0.26, margin: 0,
    fontFace: SANS, fontSize: 10.5, bold: true, color: GOLD, charSpacing: 2.6,
  });

  s.addText("Every screen in this deck is the live product.", {
    x: 0.9, y: 3.38, w: 10.2, h: 1.45, margin: 0,
    fontFace: SERIF, fontSize: 34, bold: true, color: WHITE, lineSpacingMultiple: 1.12,
  });

  s.addText(
    "Captured 28 July 2026 from the working platform, signed in as a Titan Expert. " +
    "The product is white-label, so it is shown here wearing a licensed firm's branding — Accurate Advisory Group.",
    { x: 0.9, y: 4.92, w: 8.9, h: 1.0, margin: 0,
      fontFace: SANS, fontSize: 13.5, color: ICE, lineSpacingMultiple: 1.3 });

  s.addText("PRIVATE & CONFIDENTIAL", {
    x: 0.92, y: 6.72, w: 5, h: 0.24, margin: 0,
    fontFace: SANS, fontSize: 9, bold: true, color: GOLD, charSpacing: 1.8,
  });

  s.addNotes(
    "Set the frame before the first screen: this is not a concept deck. Ten slides, ten real " +
    "screenshots, taken this afternoon from the running platform. The branding you'll see is " +
    "Accurate Advisory Group because the product is white-label — one codebase, and each firm " +
    "gets its own identity, its own database and its own deployment."
  );
}

// ── What this is, and who it is for ─────────────────────────────────────────
// The room is senior advisers. Four headings they asked for, with bullets under
// each — but the first pass laid them out at even weight and it read like a
// well-organised memo rather than a pitch. Nothing dominated. So: one large claim
// carries the slide, every bullet is cut to a single line, and size contrast does
// the work. The screens that follow carry the detail; this page only has to make
// them want to see them.
{
  const s = pres.addSlide();
  s.background = { color: NAVY };
  const PANEL = "0E3557";              // a step up from the background, not a stripe

  const kicker = (text, y) => s.addText(text, {
    x: 0.72, y, w: 11.9, h: 0.28, margin: 0,
    fontFace: SANS, fontSize: 12, bold: true, color: GOLD, charSpacing: 2.6,
  });

  // bullet: true rather than a character code — the code rendered as nothing at
  // all in the first pass, and an invisible bullet is worse than a plain one.
  // Note when reviewing a LibreOffice-rendered preview: the bullets ARE in the
  // file (buChar in the slide XML) and PowerPoint draws them. LibreOffice omits
  // them because pptxgenjs emits no buFont. Do not "fix" what the preview hides.
  const bullets = (items, o) => s.addText(
    items.map(([lead, rest], i) => ([
      { text: lead, options: { bold: true, color: WHITE, bullet: true } },
      { text: rest, options: { color: ICE, breakLine: i !== items.length - 1 } },
    ])).flat(),
    { margin: 0, valign: "top", fontFace: SANS, fontSize: o.size || 12.5,
      lineSpacingMultiple: 1.16, paraSpaceAfter: 7, ...o }
  );

  // ── What is TitanOS ──────────────────────────────────────────────────────
  kicker("WHAT IS TITANOS", 0.46);
  s.addText("A family office that runs under your name.", {
    x: 0.72, y: 0.8, w: 11.9, h: 0.72, margin: 0,
    fontFace: SERIF, fontSize: 37, bold: true, color: WHITE,
  });
  bullets([
    ["Holds the whole household. ", "Property, portfolio, valuables, documents, obligations, correspondence."],
    ["Does the recurring work. ", "Reads the statements, drafts the letters, tracks the dates."],
    ["Sends nothing without your approval. ", "Every approval and send recorded against a name."],
  ], { x: 0.72, y: 1.68, w: 11.9, h: 1.2, size: 13 });

  // ── Who it benefits ──────────────────────────────────────────────────────
  kicker("WHO IT BENEFITS", 3.16);

  const COLS = [
    {
      x: 0.72,
      label: "YOUR CLIENTS",
      lines: [
        ["One balance sheet, current. ", "Not last quarter's spreadsheet."],
        ["Every number traces to its document. ", "One click, not a reconstruction."],
        ["Obligations that flag themselves. ", "Premiums, capital calls, renewals."],
        ["Answers from their own records. ", "Including what nobody asked about."],
      ],
    },
    {
      x: 6.94,
      label: "YOUR BOOK",
      lines: [
        ["Capacity back. ", "It reads, drafts and files. You advise."],
        ["A deeper hold on the household. ", "The full picture lives with you."],
        ["Nine UHNW playbooks, running. ", "ILITs, GRATs, capital calls, RMDs, K-1s."],
        ["Work you can show. ", "An audit trail without keeping one."],
      ],
    },
  ];

  COLS.forEach(col => {
    s.addShape(pres.ShapeType.roundRect, {
      x: col.x, y: 3.6, w: 5.64, h: 2.44,
      fill: { color: PANEL }, line: { color: PANEL }, rectRadius: 0.08,
    });
    s.addText(col.label, {
      x: col.x + 0.34, y: 3.82, w: 5, h: 0.32, margin: 0,
      fontFace: SANS, fontSize: 17, bold: true, color: GOLD, charSpacing: 1.9,
    });
    bullets(col.lines, { x: col.x + 0.34, y: 4.28, w: 4.96, h: 1.9, size: 12 });
  });

  s.addText(
    "Your logo. Your letterhead. Your sending domain. Your own database. Nothing shared with another firm.",
    { x: 0.72, y: 6.66, w: 11.9, h: 0.32, margin: 0,
      fontFace: SANS, fontSize: 12.5, bold: true, color: GOLD, charSpacing: 0.4 });

  s.addNotes(
    "Say the headline and stop. Let it sit. Most of these advisers already tell clients they run a " +
    "family office; this is the part that makes it true, and it does it under their name rather than ours.\n\n" +
    "Take the two columns in order and do not rush the second. The client column sells the room; the " +
    "book column is what gets it bought — capacity back, and a deeper hold on the household. If anyone " +
    "is doing the maths on fees, the second column is the answer.\n\n" +
    "The line along the bottom kills the white-label objection before it is raised: their logo, their " +
    "domain sends the mail, their own database holds the data. Say it plainly, then go to the screens."
  );
}

// ── Content slides ──────────────────────────────────────────────────────────
// 7.45" leaves a 0.39" gutter to the card at x=8.34. At 7.6" the gutter was 0.24",
// which read as the screenshot crowding the text.
const IMG_W = 7.45;
const IMG_H = IMG_W * (873 / 1179);          // preserve the capture's own aspect ratio
const RAIL  = 8.58;                          // single left rail for all right-column text

SLIDES.forEach((d, i) => {
  const s = pres.addSlide();
  s.background = { color: WHITE };

  s.addText(d.eyebrow.toUpperCase(), {
    x: 0.55, y: 0.32, w: 8.5, h: 0.24, margin: 0,
    fontFace: SANS, fontSize: 10, bold: true, color: BRONZE, charSpacing: 1.9,
  });

  s.addText(d.title, {
    x: 0.55, y: 0.56, w: 12.2, h: 0.7, margin: 0,
    fontFace: SERIF, fontSize: 25, bold: true, color: NAVY,
  });

  s.addImage({
    path: img(d.file),
    x: 0.5, y: 1.42, w: IMG_W, h: IMG_H,
    altText: `${brand.NAME} screen capture — ${d.title}`,
    shadow: { type: "outer", color: "0B2038", blur: 14, offset: 3, angle: 90, opacity: 0.22 },
  });

  // Talking points, on a quiet card. No edge stripes.
  s.addShape(pres.ShapeType.roundRect, {
    x: 8.34, y: 1.42, w: 4.46, h: 4.46,
    fill: { color: CARD }, line: { color: CARD }, rectRadius: 0.06,
  });

  s.addText(
    d.points.map((p, j) => ({
      text: p,
      options: {
        bullet: { characterCode: "25A0" },     // small filled square
        breakLine: j !== d.points.length - 1,
        paraSpaceAfter: 10,
      },
    })),
    // Centred, not top-aligned. The card is one fixed size across all ten slides so
    // the outer geometry stays put, but the bullet lists differ in length — top
    // alignment left a visible well of dead space at the foot of the shorter ones.
    { x: RAIL, y: 1.62, w: 4.0, h: 4.06, margin: 0, valign: "middle",
      fontFace: SANS, fontSize: 12, color: BODY, lineSpacingMultiple: 1.16 }
  );

  s.addText("SAY THIS", {
    x: RAIL, y: 6.06, w: 4.22, h: 0.22, margin: 0,
    fontFace: SANS, fontSize: 8.5, bold: true, color: BRONZE, charSpacing: 1.6,
  });

  s.addText(d.say, {
    x: RAIL, y: 6.27, w: 4.22, h: 0.76, margin: 0,
    fontFace: SERIF, fontSize: 12.5, italic: true, color: NAVY, lineSpacingMultiple: 1.16,
  });

  // Bottom-right, so it reads as a page number rather than a label stuck to the
  // screenshot's lower edge.
  s.addText(String(i + 1).padStart(2, "0"), {
    x: 12.0, y: 7.04, w: 0.8, h: 0.26, margin: 0, align: "right",
    fontFace: SANS, fontSize: 9, bold: true, color: SOFT,
  });

  s.addNotes(d.notes);
});

// ── Close ───────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: NAVY };

  s.addText("WHERE THIS LEAVES US", {
    x: 0.9, y: 0.92, w: 8, h: 0.26, margin: 0,
    fontFace: SANS, fontSize: 10.5, bold: true, color: GOLD, charSpacing: 2.2,
  });

  s.addText("What you have just been shown", {
    x: 0.9, y: 1.24, w: 11.5, h: 0.8, margin: 0,
    fontFace: SERIF, fontSize: 32, bold: true, color: WHITE,
  });

  const closers = [
    ["A working platform, not a prototype.",
     "Every screenshot in this deck came off the live product on 28 July 2026. Nothing was drawn for the pitch."],
    ["White-label by construction.",
     "One codebase. Each licensed firm gets its own branding, its own database and its own deployment — code travels between tenants, client data never does."],
    ["Nine playbooks for the work UHNW clients actually generate.",
     "Capital calls, ILIT premiums, GRAT annuities, note interest, in-force reviews, RMDs, K-1 chases, policy reviews, tax documents."],
    ["One rule runs through all of it.",
     "The platform prepares. A licensed human decides. Approval and sending are separate acts, and both are recorded against a name."],
  ];

  let y = 2.42;
  closers.forEach(([head, sub]) => {
    s.addShape(pres.ShapeType.rect, {
      x: 0.92, y: y + 0.075, w: 0.1, h: 0.1, fill: { color: GOLD }, line: { color: GOLD },
    });
    s.addText(head, {
      x: 1.22, y: y, w: 10.8, h: 0.28, margin: 0,
      fontFace: SANS, fontSize: 14, bold: true, color: WHITE,
    });
    s.addText(sub, {
      x: 1.22, y: y + 0.3, w: 10.6, h: 0.62, margin: 0,
      fontFace: SANS, fontSize: 11.5, color: ICE, lineSpacingMultiple: 1.22,
    });
    y += 1.06;
  });

  s.addImage({
    path: KNOCKOUT,
    x: 10.62, y: 6.62, w: 2.18, h: 2.18 * (280 / 1500),
    altText: `${brand.NAME} wordmark`,
  });

  s.addNotes(
    "Close on the last line and stop talking: the platform prepares, a licensed human decides. " +
    "If they want to go deeper, the two obvious next steps are a walkthrough on their own data " +
    "and the internal SOP manual, which documents all fourteen capability areas step by step."
  );
}

const OUT = process.argv[2] ||
  path.join(process.cwd(), `${brand.NAME}_Product_Walkthrough.pptx`);
pres.writeFile({ fileName: OUT }).then(() => {
  console.log("wrote", OUT);
  console.log("slides:", pres.slides ? pres.slides.length : SLIDES.length + 3);
});
