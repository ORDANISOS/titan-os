// Single source for both SOP manuals.
//
// The internal SOP and the handbook issued to licensed firms are rendered from
// this one model so they cannot drift apart. Every capability carries both
// voices: `internal` for our own staff, `firm` for an adviser team using the
// platform under their own brand. The build script fails if either is missing,
// which is what stops one manual quietly falling behind the other.
//
// Voice rules, applied deliberately:
//   internal — procedural, blunt about traps, names the consequence of getting it
//              wrong. Assumes competence, not familiarity.
//   firm     — same facts, no PCM specifics, no platform administration, no table
//              names. Written so a firm can issue it to its own advisers.

module.exports = [
  {
    id: "roles",
    title: "Roles and what each can do",
    purpose:
      "Every rule below is enforced inside the database, not just hidden in the menu. A person cannot reach data outside their role even by going around the screen.",
    roles: [
      ["Administrator", "Everything in the firm, including users, branding and the playbook library."],
      ["Titan Expert", "Only their own book of clients. Full editing on those clients."],
      ["Partner", "Only clients explicitly granted to them. Read-only, plus document upload."],
      ["Client", "Their own household only, read-only."],
    ],
    internal: [
      "Set every client's responsible Expert on the client record. This one field drives who can see the client, who is copied on correspondence, and which address outbound mail is sent from — so an error here has three separate consequences.",
      "Grant a Partner access client by client. There is no firm-wide Partner access and there should not be.",
      "A Partner cannot approve correspondence, record a balance or start a workflow cycle. If one asks why a button is missing, that is why.",
      "Changing a role takes effect immediately, including for scheduled automations already configured.",
    ],
    traps: [
      "An Expert whose email address is not on the firm's verified sending domain cannot send correspondence for their clients. Catch this when the person is set up, not on a live deadline.",
      "Removing a Partner's access to a client does not delete anything they uploaded. That is intended — the documents belong to the client.",
    ],
    firm: [
      "Four roles: Administrator, Adviser, Partner and Client. Access rules are enforced by the platform itself rather than by hiding screens, so an adviser cannot reach a household outside their book by any route.",
      "Each household has one responsible adviser. That determines who can see it, who is copied on correspondence sent about it, and the address correspondence comes from.",
      "Partners — accountants, attorneys, anyone outside the firm you want to give sight of a household — get read-only access to named households, and may upload documents. They cannot approve or send anything.",
      "Clients see their own household only, and cannot change anything.",
    ],
  },

  {
    id: "families",
    title: "Households and their people",
    purpose:
      "The household record is the spine everything else hangs from: properties, accounts, documents, obligations and correspondence are all scoped to it.",
    internal: [
      "Create the household, then set the responsible Expert before adding anything else.",
      "Add members under Members. Mark one as PRIMARY with the star — this is the person copied on every piece of outbound correspondence about the household.",
      "Add professional contacts — accountant, attorney, banker, insurance broker — under Team Member & Contacts. Tick 'Client can email this contact' for anyone the household should be able to reach from the portal.",
      "Add the household's real counterparties as you meet them. Bankers, trustees, carriers and fund administrators all need to be on file before correspondence can be sent to them.",
    ],
    checks: [
      "Every household has a primary member designated, or you know why not.",
      "The primary member has an email address. Without one there is nobody to copy.",
    ],
    traps: [
      "Where several members have email addresses and none is marked primary, the platform copies nobody and says so on the draft. It will not guess between a husband and wife, and you should not want it to.",
      "Contacts are also the recipient allowlist. An address that is not on file for the household will stop a send and ask for explicit confirmation — so keeping contacts current is not housekeeping, it is what keeps correspondence flowing.",
    ],
    firm: [
      "A household record holds the family, its people, and everyone who advises them. Everything else — properties, accounts, documents, obligations — belongs to a household.",
      "Designate one member as the primary contact. They are copied on every piece of correspondence the platform prepares about that household, so the family always sees what is being done in their name.",
      "Record the household's professional contacts and counterparties: accountant, attorney, banker, trustee, insurance broker, fund administrators. Two reasons this matters — the family can email them from the portal, and the platform recognises them as legitimate recipients when correspondence goes out.",
    ],
  },

  {
    id: "properties",
    title: "Properties and the documents behind them",
    purpose:
      "A property is not just an address and a value. It carries a loan, a tax bill, insurance, sometimes flood cover and a tenancy — and each of those has a document that proves it.",
    internal: [
      "Create the property with ownership, type and value. Add loan, tax, insurance, flood and rental detail as you have it.",
      "Add vendors under the property — gardener, manager, contractor. These become click-to-call and click-to-email for whoever is working the household.",
      "Attach the document behind each figure. A paperclip beside an unlinked section takes you to CHRIS with the property and section already chosen.",
      "To pre-fill a property from a closing document or statement, use the extract option on the property form and check every value it proposes before saving.",
    ],
    checks: [
      "Each section that should have a document has one: mortgage note, tax bill, insurance declarations, insurance invoice, flood declarations, tenancy agreement.",
    ],
    traps: [
      "Replacing a document does not delete the old one. It is unlinked and stays in CHRIS, so last year's tax bill and an expired policy remain available. This is deliberate; do not go looking for a delete.",
      "Anything the AI proposes from a document is a proposal. It is right often enough to be useful and wrong often enough that you must read it.",
    ],
    firm: [
      "Each property holds its loan, tax, insurance, flood and tenancy detail, plus the vendors who look after it.",
      "Every figure can carry the document that proves it. Click the icon beside the insurance premium and the declarations page opens — no hunting through a folder.",
      "When next year's bill arrives it replaces this year's in two clicks, and the old one stays on file rather than being overwritten.",
      "Upload a closing document or statement and the platform will read it and propose the property's details for an adviser to check.",
    ],
  },

  {
    id: "portfolio",
    title: "Portfolio accounts, statements and balances",
    purpose:
      "A balance is not a number, it is a number as at a date, from a statement. This is what lets you answer 'where did this figure come from' in a client meeting.",
    internal: [
      "Create the account with institution, type, banker and opening balance.",
      "To record a balance from a statement: open Balance history on the account, choose Statement, and pick the file. It is filed to CHRIS against the account first, then read.",
      "Check the proposed closing balance and period end against the statement, and against the figure already on file — the difference is shown for you. Correct anything wrong, then press Record balance.",
      "To record a figure with no statement — an opening position, or a balance a banker confirmed by phone — use + Balance and leave the document blank.",
      "Give the statement its period label as your firm writes it: 2026-Q2, June 2026, FY26. Whatever you use, use it consistently.",
    ],
    checks: [
      "The account header shows a date, not 'no date on this figure'.",
      "The balance shown matches the statement you just filed.",
    ],
    traps: [
      "Recording a balance for a period that already has one replaces it. That is right for a restated statement, and it means you cannot accidentally end up with two figures both claiming to be Q2.",
      "Removing a balance entry makes the account fall back to the next most recent figure — it does not restore what was there before the history existed.",
      "On a consolidated statement covering several accounts the platform will not add them together. It flags low confidence and says so. Enter the account's own figure yourself.",
    ],
    firm: [
      "Each account shows its balance, the date that balance is good as at, and a link to the statement it came from. Where a figure has no date behind it, the platform says so rather than letting it look authoritative.",
      "Upload a statement and it is filed against the account, then read: the platform proposes the closing balance and the period end for an adviser to confirm. Nothing is recorded until a person accepts it.",
      "Balance history shows every figure held for the account, the change between periods, and the statement behind each one.",
      "A restated statement replaces that period's figure rather than sitting beside it, so there is never more than one number claiming to be the same quarter.",
    ],
  },

  {
    id: "valuables",
    title: "Valuables",
    purpose:
      "Art, jewellery, vehicles and collections, and — more usefully — whether each one is actually insured.",
    internal: [
      "Record each item with category and value, and link it to the schedule or endorsement that covers it.",
      "Anything without cover reads 'Not scheduled' rather than showing nothing, so a gap is visible instead of absent.",
      "Refresh appraisals on the cycle the insurer requires and file the new valuation against the item.",
    ],
    traps: [
      "An unrecognised category falls into 'Other' rather than disappearing. This exists because a vehicle once vanished from a household's list while still counting toward the total — if a figure and a list disagree, that is the first thing to check.",
    ],
    firm: [
      "Valuables are recorded with their value and linked to the schedule that insures them.",
      "Items with no cover on file read 'Not scheduled', so an uninsured piece is visible rather than simply missing from a list.",
    ],
  },

  {
    id: "cashflow",
    title: "Cash flow",
    purpose:
      "What comes in, what goes out, what the firm pays on the household's behalf, and what that looks like over several years.",
    internal: [
      "Record income and expense events with their tax treatment. Recurring items go in once.",
      "Mark items the firm pays on the household's behalf. When paid, the record shows who paid it and when.",
      "Use the multi-year projection before any conversation about a large outflow — a capital call, a tax instalment, a purchase.",
    ],
    firm: [
      "Cash flow holds income and expenses with their tax treatment, and projects them forward over several years.",
      "Where your firm pays a bill on a household's behalf, the record shows it was paid, by whom, and when — so the family can see it was handled without having to ask.",
    ],
  },

  {
    id: "vault",
    title: "CHRIS",
    purpose:
      "One place for every document, organised so it can be found, and readable by the assistant so it can be used.",
    internal: [
      "Upload into the folder matching the document's category. Choosing a property section pre-selects the right folder for you.",
      "Every upload is read — embedded text where it exists, OCR for scans — so the assistant can answer from it afterwards.",
      "Link the document to what it supports: a property section, a valuables schedule, or a portfolio account.",
      "Documents open through short-lived signed links. There are no permanent public URLs to a client's papers.",
      "Every download is logged against the person who opened it.",
    ],
    traps: [
      "An unrecognised category lands in 'Other' rather than vanishing. Same reason as valuables.",
      "A document filed against an account still appears on the account card even if no balance entry references it, so nothing you file becomes invisible.",
    ],
    firm: [
      "CHRIS holds every document for a household, organised into folders.",
      "Each upload is read on arrival, including scans, so the assistant can answer questions from its contents rather than just listing a filename.",
      "Documents link to what they support — a property's insurance section, a valuables schedule, a portfolio account.",
      "Documents open through time-limited links, never permanent public ones, and every download is recorded against the person who opened it.",
    ],
  },

  {
    id: "obligations",
    title: "Obligations and workflow cycles",
    purpose:
      "The difference between software that reminds you and software that carries a commitment to completion. Nine playbooks ship with the platform, covering insurance, trusts and estates, tax and investments.",
    internal: [
      "Create the obligation on the household: what it is, the amount, the due date, how often it recurs, the reference number and counterparty, and the accounts money moves between.",
      "Answer the conditional questions on the obligation before starting a cycle. Does the trust require Crummey notices? Is the annuity paid in kind? Should the accountant sign off? These change every downstream date, which is why they are asked first.",
      "Start the cycle. Every step is laid out against a real calendar date, counted back from the due date.",
      "If a cycle is started too late for its own lead times it flags itself at risk on day one and names the step that has already slipped. Deal with that immediately rather than working through the list.",
      "Steps that do not apply are written as skipped and stay visible, so nothing looks forgotten.",
      "Read the playbook in Resources before running it against a household for the first time.",
    ],
    checks: [
      "The conditional answers on the obligation match the trust document or the client's instruction, not an assumption.",
      "The dates the cycle produced look right for the obligation — a premium 60 days out, a withdrawal window of the length the trust actually specifies.",
    ],
    traps: [
      "Lead times shipped with the platform are a considered starting point, not advice. Have counsel confirm them for the jurisdiction before a playbook runs against a real household. Admins can edit them; others cannot, because changing a lead time changes when client money gets requested.",
      "Amending an obligation does not rewrite a cycle already in flight. The conditional answers are captured when the cycle starts, on purpose.",
      "Partnership K-1 collection uses scheduled follow-ups rather than chasing until a document arrives. Skip the follow-ups that are not needed; a skipped step still shows it was considered.",
    ],
    firm: [
      "An obligation is a recurring commitment — a premium, an annuity payment, a required distribution, a capital call, a tax instalment. Record it once and the platform carries each cycle.",
      "Nine playbooks ship with the platform across insurance, trusts and estates, tax and investments. Starting a cycle lays out every step against a real calendar date, counted back from the due date.",
      "Questions that change the schedule are asked before the dates are set, so a trust's withdrawal window or an accountant's sign-off is built into the timeline rather than remembered later.",
      "A cycle started too late to fit its own lead times says so immediately and names the step that has already slipped.",
      "Steps that do not apply to a particular household stay visible marked as not required, so a short list never looks like a forgotten one.",
      "Playbooks are data, not code. Your administrators can adjust lead times and steps, and add playbooks of your own.",
    ],
  },

  {
    id: "correspondence",
    title: "Preparing, approving and sending correspondence",
    purpose:
      "This is where the platform does the most and is trusted the least by design. It assembles the document; a person decides.",
    internal: [
      "Open the step from the review queue on the dashboard, or from the household's Obligations tab.",
      "Press Prepare draft. The platform assembles the item from the obligation, the funding accounts and the text of the source document on file — a bank transfer request, a trustee instruction, a Crummey notice and an accountant's note are each written differently.",
      "Read it. Square-bracketed placeholders mark anything the record could not supply; complete those before approving.",
      "Check the recipient and the copy. The household's primary contact is copied automatically, unless they are the addressee.",
      "Approve & send delivers it, from the responsible Expert's address on the firm's verified domain, with the supporting document attached. Approve, don't send records the approval and leaves it in the queue.",
    ],
    checks: [
      "No square brackets left in the body.",
      "The To line is a real email address. Descriptions like 'Wire Operations' will be refused.",
      "The figures in the draft match the invoice, not the model's recollection of it.",
    ],
    traps: [
      "Recipients are checked against the addresses on file for that household. An unrecognised address stops the send and shows you the exact address, because draft recipients are drawn partly from uploaded documents. Look at it properly before confirming — that confirmation is recorded against the step.",
      "Approving is not sending. A step that is approved and unsent stays in the review queue reading 'Approved — not sent'.",
      "A send that the provider rejects records the reason and leaves the step approved but unsent. It will not look successful.",
      "Once a message has a delivery reference it cannot be sent again. A double click will not produce a second bank instruction.",
      "The platform prepares payment instructions. It never moves money. Say this out loud to any client or compliance officer who asks.",
    ],
    firm: [
      "The platform assembles the item a step needs — a transfer request to a bank, an instruction to a trustee, a notice to a beneficiary, a note to an accountant — using the obligation, the funding accounts and the document on file. Each is written in the form appropriate to its recipient.",
      "Nothing leaves without a named person approving it. Approval and sending are recorded separately, each attributed.",
      "Correspondence goes out as the responsible adviser, from your firm's own verified domain, with the supporting document attached.",
      "The household's primary contact is copied on everything, so the family sees what is being done in their name.",
      "Recipients are checked against the addresses held for that household. An address the firm has no record of stops the send and asks for explicit confirmation.",
      "A failed send says so and stays outstanding rather than appearing to have worked. A message that has been sent cannot be sent twice.",
      "Anything the platform could not fill in is marked with a placeholder for the adviser to complete. It does not invent an account number, a policy number or a figure.",
      "The platform prepares payment instructions. It does not move money.",
    ],
  },

  {
    id: "assistant",
    title: "The assistant",
    purpose:
      "Answers from one household's own records, and cites the document it used.",
    internal: [
      "Open it from the floating button on any screen. On a firm-wide screen it asks which household first, because it will not answer across relationships.",
      "Ask questions the records can actually answer: what is uninsured, when does this policy lapse, what did we pay last year.",
      "It reads document contents, not just fields, so an endorsement or a dec page is fair game.",
    ],
    traps: [
      "It is scoped to one household and cannot be persuaded otherwise. That is a feature, not a limitation to work around.",
      "It treats document text as data, never as instruction. If a document contains something that looks like a command, it will not follow it.",
    ],
    firm: [
      "Every household has an assistant that answers from that household's own records and documents, and tells you which document it used.",
      "It is scoped to a single household. On a firm-wide screen it asks which one before answering, and it cannot be induced to answer across relationships.",
    ],
  },

  {
    id: "reports",
    title: "Scheduled reports and concierge research",
    purpose:
      "Recurring intelligence delivered on a cadence, as a branded PDF, without anyone remembering to run it.",
    internal: [
      "Create the prompt in Resources, choose its cadence and scope it to a household or the whole book.",
      "Use Run Now to see exactly what a recipient will get before letting a schedule loose.",
      "Concierge research searches the live web for something a client asked the firm to watch, and cites its sources.",
      "Long jobs run in the background, so a multi-minute research run does not time out.",
    ],
    traps: [
      "Whether a Partner may run scheduled reports is a per-person permission, off by default.",
      "A failed run records the reason. Check it rather than assuming the schedule is fine.",
    ],
    firm: [
      "Reports can be scheduled on any cadence and arrive as a branded PDF carrying your firm's identity.",
      "Concierge research monitors the live web for whatever a client has asked you to watch, with sources cited.",
      "Run any report on demand to see exactly what a recipient will receive before scheduling it.",
    ],
  },

  {
    id: "tasks",
    title: "Tasks and deadlines",
    purpose: "The things that are not recurring obligations but still cannot be forgotten.",
    internal: [
      "Record the task against the household with its due date and owner.",
      "Deadlines surface on the dashboard as they approach, and reminders go out on schedule.",
    ],
    firm: [
      "Tasks and deadlines are recorded against a household, surface on the dashboard as they approach, and generate reminders.",
    ],
  },

  {
    id: "portal",
    title: "What the household sees",
    purpose:
      "The client portal carries your brand and shows a read-only view of what the firm holds.",
    internal: [
      "Clients see net worth, properties, accounts, valuables and documents for their own household, read-only.",
      "They can email their own adviser from inside the portal; the primary adviser is always copied. They cannot email other advisers at the firm.",
      "Bills the firm paid on their behalf are marked paid, with who paid and when.",
      "It is mobile responsive throughout — assume a client is looking at it on a phone.",
    ],
    firm: [
      "Households get a read-only portal carrying your firm's brand: net worth, properties, accounts, valuables and documents.",
      "They can email their adviser from inside it, with the primary adviser always copied, and cannot reach other advisers at your firm.",
      "Bills your firm settled on their behalf show as paid, with the date.",
      "It works properly on a phone, which is where most clients will look at it.",
    ],
  },

  {
    id: "branding",
    title: "Branding and the firm's identity",
    purpose:
      "One platform, many firms. Each supplies its own identity and sends as itself.",
    internal: [
      "Brand name, logo, tagline and full colour palette are per firm, and carry through to exported PDFs, print reports, outbound email, link previews and browser icons.",
      "The firm's outbound sending domain must be verified with the email provider before any correspondence can be sent. This is enforced, not advisory.",
      "Runtime brand switching from the admin screen exists on the demonstration instance and is used for concurrent sales cycles. Production tenants take their brand from their own deployment.",
    ],
    traps: [
      "A firm whose sending domain is not verified can draft and approve normally but cannot send. That is the correct state for a firm mid-onboarding, and it is deliberate: an unverified sender bounces or lands in spam, and a bank instruction that silently fails to arrive is the worst outcome available.",
    ],
    firm: [
      "The platform carries your firm's name, logo, tagline and colours throughout — including exported PDFs, reports, outbound email, and the preview that appears when someone shares a link.",
      "Correspondence is sent from your own verified domain, as the responsible adviser, so a banker or trustee sees the person they deal with.",
      "Your environment is yours alone: a separate database, a separate document store, your own assistant. Nothing is shared with another firm.",
    ],
  },

  {
    id: "doc-templates",
    title: "The firm's own document templates",
    purpose:
      "The fillable documents on the Resources tab are the firm's own paperwork, not the platform's. Two of them name a legal entity in their body text, so they cannot be shared between firms at any price.",
    internal: [
      "Seven templates per firm: client services agreement, auto-debit (ACH) authorisation, data completeness checklist, wire instructions, personal financial statement, lifestyle expense worksheet, and the Titan Expert user guide.",
      "Upload them under Resources → Document Templates, as an administrator. Choose 'Project default' for a firm with a single identity; choose a named brand only on an instance that switches brands.",
      "Each upload is read for its form-field names and checked against the fields the platform fills. Anything missing is listed against the card and the Resources tile stays disabled until it is present.",
      "There is no shared fallback. A firm with no template on file gets a disabled tile, never another firm's document.",
      "The agreement and the ACH authorisation must be the firm's own, reviewed by their counsel. Do not re-letterhead someone else's — the contracting party and the receiving bank are named in the prose, not just the header.",
    ],
    checks: [
      "All seven cards read Ready before the firm sees the Resources tab.",
      "The agreement names the firm as the contracting party, and the ACH form names the firm's own bank.",
    ],
    traps: [
      "A template whose form fields have been renamed will still upload. It is the field check that catches it — without that the document generates, reports success, and comes out blank. A blank agreement looks like a formatting glitch rather than a failure, which is why the platform refuses rather than producing one.",
      "Replacing a template does not alter documents already generated from the previous one. Those are finished artefacts and are left alone deliberately.",
      "A template attached to one brand is invisible to every other brand, including when that other brand is the live one. If a tile is unexpectedly disabled, check which brand the template was filed under before re-uploading it.",
    ],
    firm: [
      "The fillable documents on the Resources tab are your firm's own paperwork, uploaded once by an administrator. Your letterhead, your wording, your bank details.",
      "The client services agreement and the auto-debit authorisation name your firm as the contracting party in their text, so these must be your own versions, reviewed by your counsel.",
      "Until a document is loaded its tile stays disabled. The platform will not substitute another firm's paperwork to fill the gap, and will not generate a document it cannot complete correctly.",
      "Each template is checked on upload against the fields the platform fills in for you — the client's name, the fee, the effective date. If a field is missing you are told which, rather than discovering it on a document already in front of a client.",
    ],
  },
];
