"""ORDANIS SOP for ORDANIS Experts, Analysts and Onboarding Specialists."""

S = []

S.append(("Your role on the platform", "Expert, Analyst, Onboarding Specialist, and the line you never cross", """
<p class="lede">ORDANIS gives each household one private, organized place for everything it owns, owes, pays and keeps, and
gives you the tools to run that administration well. This guide walks through the platform the way you'll use it.</p>
<table>
<tr><th style="width:26%">Seat</th><th>What it means</th><th style="width:30%">What you see</th></tr>
<tr><td><b>ORDANIS Expert</b></td><td>The household's named administrator on Premier (and on one Core workflow when the family buys Expert assist). Runs bills, documents, deadlines and workflows.</td><td>Every household where you are the Expert</td></tr>
<tr><td><b>Analyst</b></td><td>Supports one Expert. Works the same households alongside them.</td><td>Your Expert's households</td></tr>
<tr><td><b>Onboarding Specialist</b></td><td>Sets a new household up. Access lasts 30 days and an admin can extend it 30 days at a time.</td><td>Only the households you're assigned to</td></tr>
<tr><td><b>Admin</b></td><td>Runs the platform. Admins can also sit in any of the seats above.</td><td>Everything</td></tr>
</table>
<div class="box warn"><span class="t">The line you never cross</span>An ORDANIS Expert is an administrator, <b>not a licensed
investment adviser</b>. Never evaluate an investment, suggest an allocation, or call yourself an "adviser". Investment questions
go to the family's licensed adviser (shown as Lead Advisor) or to the firm. The assistant enforces the same rule.</div>
<h2>Signing in</h2>
<ol class="steps">
<li>Go to <b>portal.ordanisos.com</b> and sign in with your ORDANIS email.</li>
<li>Complete two-step verification. Some admin actions require a session that passed it.</li>
<li>You land on your <b>Dashboard</b>. The left menu holds Client Management (Dashboard, Families, Portfolio, Notes, Tasks) and Resources; admins also see the Admin section.</li>
</ol>
"""))

S.append(("Plans: what each household has", "So you know what to promise, and what not to", """
<table>
<tr><th style="width:18%">Plan</th><th>Includes</th><th style="width:26%">Who does the work</th></tr>
<tr><td><b>Basic</b></td><td>Household record, CHRIS (5 GB), the AI assistant. No workflows, no Expert.</td><td>The family, self-directed</td></tr>
<tr><td><b>Core</b></td><td>Everything in Basic plus 15 GB, workflows (10 included), scheduled prompts, resources, Business Partner seats. Optional ORDANIS Expert on one workflow (Expert assist, one-time fee).</td><td>The family, self-directed</td></tr>
<tr><td><b>Premier</b></td><td>Everything, plus a named ORDANIS Expert, bill pay and the payment register, unlimited workflows.</td><td>You and the family together</td></tr>
</table>
<ul>
<li><b>Every plan can edit its own records.</b> On Premier, whatever the family changes shows up for you (Client Activity, section 07).</li>
<li>A household paid by a firm is billed to that firm at the same plan prices. There is no separate firm price list; never quote one.</li>
<li>Third-party costs (for example Bill.com fees) are separate from the plan fee.</li>
</ul>
"""))

S.append(("Setting up a new household", "Onboarding, step by step", """
<p class="lede">Onboarding is where the household's trust is won. The goal is a complete, accurate record with every
supporting document in CHRIS, in the first 30 days.</p>
<ol class="steps">
<li><b>Create the household.</b> Admin: Families → <b>New Family</b>. Set the plan and, for Premier, the ORDANIS Expert.</li>
<li><b>Assign the Onboarding Specialist.</b> On the household's Overview, an admin names the specialist (an admin, Expert or Analyst). Access runs 30 days; both get an email when it is ending, and the admin can choose <b>Extend 30 days</b>.</li>
<li><b>Invite the family's primary user.</b> From the household, send the invite. The family sets their own password; nobody at ORDANIS ever chooses or sees it. For card-paid households, the family is asked for a card in their portal.</li>
<li><b>Gather the paper.</b> Ask for: deeds and mortgage statements, property tax bills, insurance declarations (home, flood, auto, umbrella, valuables), brokerage and bank statements, loan and credit line statements, estate documents, and recurring bills.</li>
<li><b>Load CHRIS with "Snap or add several".</b> Photograph pages one after another or pick a stack of PDFs. CHRIS reads each one and proposes a name, summary, folder and the record it belongs to. Check each card and tap <b>File</b> (section 05).</li>
<li><b>Build the records</b> in this order: Properties (with mortgage), Portfolio accounts, Loans &amp; Lines, Valuables, Cash Flow (income and bills), then Tasks and workflows.</li>
<li><b>Pin documents to figures</b> as you go: the paperclip beside a figure opens an upload already pointed at that spot.</li>
<li><b>Hand over.</b> Walk the family through their portal, confirm who in the household needs a login and with which permissions, and note anything outstanding as Tasks.</li>
</ol>
<div class="box"><span class="t">Onboarding checklist</span>
☐ Plan and Expert set &nbsp; ☐ Specialist assigned &nbsp; ☐ Primary invited and signed in &nbsp; ☐ Properties with mortgages &nbsp;
☐ Accounts with dated balances &nbsp; ☐ Loans and lines with what secures them &nbsp; ☐ Valuables with policies &nbsp;
☐ Bills and income in Cash Flow &nbsp; ☐ Key documents pinned &nbsp; ☐ Family users and permissions &nbsp; ☐ Open items as Tasks</div>
"""))

S.append(("Working a household", "Every tab on the household screen, and what it's for", """
<p>Open a household from <b>Families</b>. The tabs run left to right:</p>
<table>
<tr><th style="width:22%">Tab</th><th>Use it to</th></tr>
<tr><td>Overview</td><td>See net worth, upcoming deadlines, family members and contacts, tasks and notes; manage the Onboarding Specialist and private-household settings (admins).</td></tr>
<tr><td>Properties</td><td>Each property with value, mortgage, second mortgage/HELOC, taxes, insurance, flood, rental income and vendors. Paperclips pin documents to each figure. Loans secured by the property are listed on its card.</td></tr>
<tr><td>Portfolio</td><td>Accounts with dated balances and history. Upload a statement and the platform proposes the closing balance for you to confirm.</td></tr>
<tr><td>Loans &amp; Lines</td><td>All debt. Adding a mortgage asks which property it's on and saves it on that property. Other loans and lines record what secures them: unsecured, a property, a portfolio account or a valuable.</td></tr>
<tr><td>Cash Flow</td><td>Income and bills with recurrence and tax treatment; projections; mark bills paid (who paid and when is recorded).</td></tr>
<tr><td>Workflows</td><td>Each workflow, laid out step by step against real dates (Core and Premier).</td></tr>
<tr><td>Valuables</td><td>Art, jewelry, vehicles and the policy that covers each.</td></tr>
<tr><td>Notes, Tasks</td><td>Running notes (with attachments) and tasks with reminders.</td></tr>
<tr><td><b>Client Activity</b></td><td>Everything the family changed themselves, newest first (section 07).</td></tr>
<tr><td><b>CHRIS</b></td><td>The household's documents (section 05).</td></tr>
<tr><td>Prompts</td><td>Scheduled reports the assistant writes on a cadence.</td></tr>
<tr><td>Ask &lt;name&gt;</td><td>The household's assistant, answering from this family's records and documents.</td></tr>
</table>
<div class="box"><span class="t">One number, one home</span>A property's mortgage lives on the property and is shown under Loans &amp; Lines
too, counted once in Total Debt. If a property already has a mortgage, edit it there rather than adding a second one.</div>
"""))

S.append(("CHRIS: the household's document intelligence", "What CHRIS really does, and how to get the most from it", """
<div class="chris"><div class="head"><img src="__MARK__"><span>CHRIS is not a folder. It reads.</span></div>
CHRIS stands for <b>Centralized Household Records Integration Server</b>. Every document that goes into CHRIS is read (typed PDFs, scans and phone photos alike), given a clear name and a one-line
summary, filed in the right folder, made searchable by what it <i>says</i>, and pinned to the figure it supports. The
household's assistant answers from it. That is the difference between storing paper and knowing what's in it.</div>
<h2>What CHRIS does for you</h2>
<table>
<tr><th style="width:28%">Capability</th><th>In practice</th></tr>
<tr><td>Reads everything</td><td>Typed PDFs, scanned PDFs and photos. A phone picture called "IMG_4821" becomes "2026 Homeowners Declarations – 12 Oak Lane".</td></tr>
<tr><td>Files it for you</td><td>Proposes the folder (or a new one when nothing fits) and how sure it is. Nothing is filed until you tap File.</td></tr>
<tr><td>Links it to the numbers</td><td>Suggests which property section (mortgage, tax bill, insurance declarations, insurance invoice, flood, rental agreement), valuable policy or loan statement it belongs to.</td></tr>
<tr><td>Fills in the record</td><td>Reads a policy to pre-fill carrier, premium, coverage and renewal; reads a statement to propose an account's closing balance. You confirm before anything saves.</td></tr>
<tr><td>Finds by content</td><td>Search looks inside documents. Each result says what it is, where it lives, why it matched, and whether it has been replaced.</td></tr>
<tr><td>Keeps history</td><td>A new policy replaces last year's on the card; the old one stays in CHRIS, marked as replaced, never deleted.</td></tr>
<tr><td>Feeds the assistant</td><td>Ask "when does the umbrella policy renew?" and the assistant answers from the declarations page.</td></tr>
<tr><td>Guards access</td><td>Files are private; links expire; every download is logged. Family members open files only if they have Download permission.</td></tr>
<tr><td>Private folder</td><td>Each family login has a folder only they can see, which AI never reads. You will not see it, by design.</td></tr>
</table>
<h2>Adding documents</h2>
<ol class="steps">
<li><b>Several at once:</b> CHRIS → <b>Snap or add several</b>. Photograph or pick files; review each card's name, folder and link; tap File.</li>
<li><b>From a figure:</b> click the paperclip beside the figure (for example Property Taxes). The upload opens already pointed at that spot.</li>
<li><b>From a valuable or loan:</b> on its form, "Take a photo" or "Choose file". CHRIS files it and links it there.</li>
<li><b>Replacing:</b> add the new one to the same spot. If something is already there, you're asked before it's displaced.</li>
</ol>
<h2>Good habits</h2>
<ul>
<li>Pin every policy, tax bill and statement to its figure; an unpinned document is findable, a pinned one is <i>provable</i>.</li>
<li>Check CHRIS's proposed name and summary. They become how the family and the assistant find the document.</li>
<li>Look for the ✦ badge on a document: it means CHRIS has read it. No badge? Press <b>✦ Scan</b>.</li>
<li>Use household folders for the family's own way of thinking (for example "Lake House"), not one-off names.</li>
</ul>
"""))

S.append(("Workflows, bills and the daily rhythm", "Getting workflows done, on time, with a person approving", """
<h2>Workflows</h2>
<ul>
<li>A workflow (premium, estimated tax, RMD, capital call, loan interest…) follows a ready-made playbook from the library; add one with <b>+ New Workflow</b>. Starting a cycle lays out every step against a real calendar date, measured back from the due date.</li>
<li>Steps that are already late flag the cycle <b>At risk</b> on day one.</li>
<li><b>Nothing sends without a named approval.</b> Drafts wait in the review queue; approving records who approved. Recipients are checked against the family's known contacts, and the family principal is copied.</li>
<li>The platform prepares payment instructions; it <b>never moves money</b>.</li>
</ul>
<h2>Bills (Premier bill pay)</h2>
<ul>
<li>Bills ORDANIS pays are marked in Cash Flow. When paid, choose <b>Mark Paid</b>; who and when is recorded and the family sees it.</li>
<li>A bill you pay that's coming due appears in your daily summary email until it's marked paid.</li>
</ul>
<h2>Your daily summary email</h2>
<p>One email each morning (13:00 UTC: 9 am Eastern in summer, 8 am in winter), only when there's something in it:</p>
<ul><li><b>Task reminders</b> due today, across your households.</li><li><b>Bills you pay</b> coming due, with the total.</li>
<li><b>What your families changed</b> in their records since yesterday.</li></ul>
<h2>A good daily routine</h2>
<ol class="steps"><li>Read the daily summary.</li><li>Clear the review queue on your Dashboard (drafts awaiting approval).</li>
<li>Mark yesterday's payments paid.</li><li>Look over Client Activity for anything that needs a follow-up.</li>
<li>File anything new into CHRIS and pin it.</li></ol>
"""))

S.append(("Client Activity and family users", "Seeing what the family changed; who in the family can do what", """
<h2>Client Activity</h2>
<p>Families on every plan can add and edit their own records. Each change a family login makes is logged automatically:
who, when, what kind of record, its name, and which fields changed. Values are deliberately not copied, so account numbers
never appear in the log. Open the household's <b>Client Activity</b> tab, or read it in your daily summary.</p>
<div class="box"><span class="t">What to do with it</span>Most changes are the family keeping things current. Follow up when a change
affects something you run: a bill amount, an insurance policy, a loan payment or a removed record.</div>
<h2>Family users and permissions</h2>
<p>The household's primary user has full control and can invite family members. Each member gets their own login and
whichever of these the primary ticks:</p>
<table>
<tr><th style="width:28%">Permission</th><th>Lets them</th></tr>
<tr><td>Edit records</td><td>Add, change and remove properties, accounts, loans, bills, valuables, tasks and notes.</td></tr>
<tr><td>Upload documents</td><td>Add files to CHRIS.</td></tr>
<tr><td>Download documents</td><td>Open files in CHRIS (otherwise they see names only).</td></tr>
<tr><td>Manage users and billing</td><td>Invite or remove people, change permissions, change plan and card.</td></tr>
</table>
<p><b>Business Partners</b> (an accountant, attorney, or the family's licensed adviser) get a read-only seat and can upload documents.
They're free on Premier.</p>
"""))

S.append(("Admin tasks", "For admins: users, plans and the firm side", """
<table>
<tr><th style="width:24%">Screen</th><th>What you do there</th></tr>
<tr><td>Users</td><td>Every login by role. Families are grouped by household, primary first. Link an Analyst to an Expert. Admins can fill Expert and Analyst seats.</td></tr>
<tr><td>Signups</td><td>New self-serve sign-ups and where they came from.</td></tr>
<tr><td>Plan requests</td><td>Households asking to change plan. Approving moves the Stripe subscription; info@ordanisos.com gets an email for every request.</td></tr>
<tr><td>Enterprises, Firm billing</td><td>Firms, their households and their monthly invoices.</td></tr>
<tr><td>Utilization</td><td>Which features each household uses.</td></tr>
<tr><td>State Rules</td><td>State-specific rules the platform watches.</td></tr>
</table>
<div class="box warn"><span class="t">Plan changes on paying households</span>Don't change a Stripe-paid household's plan in Edit Family (it's
locked for that reason). Use Plan requests or the household's Billing tab so Stripe moves too.</div>
<div class="box warn"><span class="t">Never</span>Never delete a household (archive instead; permanent deletion is the owner's decision),
never set or ask for anyone's password, and never copy demo households into production.</div>
"""))

S.append(("Quick answers", "Common questions from staff", """
<table>
<tr><th style="width:38%">Question</th><th>Answer</th></tr>
<tr><td>A family says they can't edit or upload.</td><td>Check their permissions in the Household tab; only the primary (or someone with Manage users) can change them.</td></tr>
<tr><td>CHRIS search can't find a document I know is there.</td><td>It hasn't been read yet. Press <b>✦ Scan</b> on the document, or the <b>✦ Scan</b> button at the top of CHRIS to read every unread one. A ✦ badge means the assistant and search can read it.</td></tr>
<tr><td>The assistant won't answer an investment question.</td><td>By design. Point the family to their licensed adviser or the firm.</td></tr>
<tr><td>I added a mortgage and it went onto the property.</td><td>Correct: mortgages live on the property so debt is counted once.</td></tr>
<tr><td>My onboarding access disappeared.</td><td>The 30 days ended. Ask the admin who assigned you to extend it.</td></tr>
<tr><td>I didn't get a daily summary.</td><td>There was nothing to report that day. If you expected something, tell an admin.</td></tr>
<tr><td>Something looks wrong or broken.</td><td>Note the household, what you did and what you saw (a screenshot helps), and send it to the platform admin.</td></tr>
</table>
"""))

DOC = dict(file="ORDANIS_SOP_Expert_and_Onboarding.pdf", kind="Standard Operating Procedure · Team",
           title="Working in ORDANIS",
           subtitle="A practical guide for ORDANIS Experts, Analysts and Onboarding Specialists: setting households up, running them day to day, and getting the most from CHRIS, the Centralized Household Records Integration Server.",
           audience="ORDANIS Experts, Analysts and Onboarding Specialists", classification="Internal", sections=S)
