const fs=require("fs");
const {Document,Packer,Paragraph,TextRun,AlignmentType,Table,TableRow,TableCell,WidthType,BorderStyle,ShadingType,LevelFormat}=require("docx");
const BRAND=require("./brand.js");

const NAVY="092B49", GOLD="CEB684", SOFT="5A6E84", BODY="1E293B", CODEBG="F4F5F7", WARN="7A5A19", RED="8B1A1A";
const CW=10240;
const bd=()=>({style:BorderStyle.SINGLE,size:4,color:"D8CDB8"});
const cellB={top:bd(),bottom:bd(),left:bd(),right:bd()};

const P=(t,o)=>{o=o||{};return new Paragraph({spacing:{after:o.after==null?110:o.after,before:o.before||0},alignment:o.align,
  children:[new TextRun({text:t,size:o.size||21,color:o.color||BODY,font:"Calibri",bold:o.bold,italics:o.italics})]});};

const H1=t=>new Paragraph({spacing:{before:320,after:130},
  border:{bottom:{style:BorderStyle.SINGLE,size:8,color:GOLD}},
  children:[new TextRun({text:t,bold:true,size:26,color:NAVY,font:"Georgia"})]});

const H2=t=>new Paragraph({spacing:{before:230,after:90},
  children:[new TextRun({text:t,bold:true,size:22,color:NAVY,font:"Georgia"})]});

const pull=(t,color)=>new Paragraph({spacing:{before:120,after:160},
  shading:{type:ShadingType.CLEAR,fill:color==="red"?"FDEAEA":"F4F1EA"},
  border:{left:{style:BorderStyle.SINGLE,size:18,color:color==="red"?"E09A9A":GOLD}},
  indent:{left:200,right:120},
  children:[new TextRun({text:t,size:20,color:color==="red"?RED:NAVY,font:"Calibri",italics:true})]});

const bullet=t=>new Paragraph({numbering:{reference:"b",level:0},spacing:{after:70},
  children:[new TextRun({text:t,size:20,color:BODY,font:"Calibri"})]});

// Monospaced block for SQL and commands. Shaded so it reads as something to run
// rather than something to read.
const code=lines=>new Table({width:{size:CW,type:WidthType.DXA},columnWidths:[CW],
  rows:[new TableRow({children:[new TableCell({width:{size:CW,type:WidthType.DXA},
    borders:{top:bd(),bottom:bd(),left:{style:BorderStyle.SINGLE,size:14,color:NAVY},right:bd()},
    shading:{type:ShadingType.CLEAR,fill:CODEBG},margins:{top:110,bottom:110,left:140,right:120},
    children:lines.map(l=>new Paragraph({spacing:{after:0},
      children:[new TextRun({text:l,size:17,color:"243447",font:"Consolas"})]}))})]})]});

const hdrCell=(t,w)=>new TableCell({width:{size:w,type:WidthType.DXA},borders:cellB,
  shading:{type:ShadingType.CLEAR,fill:NAVY},margins:{top:70,bottom:70,left:110,right:110},
  children:[new Paragraph({children:[new TextRun({text:t,bold:true,size:17,color:"FFFFFF",font:"Calibri"})]})]});

const txtCell=(t,w,o)=>{o=o||{};return new TableCell({width:{size:w,type:WidthType.DXA},borders:cellB,
  shading:o.fill?{type:ShadingType.CLEAR,fill:o.fill}:undefined,
  margins:{top:66,bottom:66,left:110,right:110},
  children:[new Paragraph({alignment:o.align,spacing:{after:0},
    children:[new TextRun({text:t,size:o.size||19,color:o.color||BODY,font:o.mono?"Consolas":"Calibri",bold:o.bold})]})]});};

const table=(cols,rows)=>{
  const widths=cols.map(c=>c.w);
  return new Table({width:{size:CW,type:WidthType.DXA},columnWidths:widths,
    rows:[new TableRow({tableHeader:true,children:cols.map(c=>hdrCell(c.t,c.w))})].concat(
      rows.map(r=>new TableRow({children:r.map((cell,i)=>
        txtCell(String(cell.t!==undefined?cell.t:cell),widths[i],cell.t!==undefined?cell:{}))})))});
};

const k=[];
const add=function(){for(var i=0;i<arguments.length;i++)k.push(arguments[i]);};

// ── COVER ────────────────────────────────────────────────────────────────────
// Real logo artwork rather than a flat-navy typeset wordmark: the mark is
// two-tone, navy TITAN and gold OS, which one text run cannot express.
BRAND.masthead().forEach(p=>add(p));
add(new Paragraph({spacing:{before:200,after:0},alignment:AlignmentType.CENTER,
  border:{top:{style:BorderStyle.SINGLE,size:6,color:GOLD}},
  children:[new TextRun({text:"New Tenant Onboarding Runbook",bold:true,size:32,color:NAVY,font:"Georgia"})]}));
add(new Paragraph({spacing:{after:180},alignment:AlignmentType.CENTER,
  children:[new TextRun({text:"Internal — Operations.  Not for circulation to client firms.",size:18,color:RED,font:"Calibri",bold:true})]}));
add(P("Every TitanOS client firm runs in its own fully isolated environment: a private database, a private document store (CHRIS), its own AI pipeline and its own sending identity. Nothing is shared between firms. This runbook is the sequence for standing one up, in order, with the exact commands and the checks that prove each step worked.",{size:20}));
add(P("Revised 28 July 2026. Reflects the platform as deployed: workflows, outbound sending, and per-tenant sending domains.",{size:18,color:SOFT,italics:true}));

// ── READ THIS FIRST ──────────────────────────────────────────────────────────
add(H1("Read this first"));
add(pull("The repository does not yet contain a complete schema baseline. PCM production has 22 recorded migrations; five are checked in. The base schema — table definitions, row-level-security helper functions, family scoping, the Partner role, scheduled prompts and the cron job — exists only in that project's migration history. You therefore cannot provision a new tenant from the repository alone today. Step 2 covers the method that does work, and closing this gap is the single highest-value fix to the onboarding process.","red"));
add(P("Two other things worth knowing before you begin:",{after:60}));
add(bullet("Two edge functions — run-scheduled-prompts and admin-set-password — are deployed but have no source in the repository. Copy them from a reference project rather than expecting to find them in git."));
add(bullet("A tenant cannot send email until its domain is verified. This is enforced, not advisory: sender_verified defaults to false and the send function refuses every request while it is. Plan the DNS work early, because it is the one step with a waiting period you do not control."));

// ── SEQUENCE ─────────────────────────────────────────────────────────────────
add(H1("Provisioning sequence"));
add(P("Steps 1–6 are ours and can be done back to back. Steps 7 and 9 involve the firm and have real-world latency, so start them early even though they appear late in the list.",{after:120}));
add(table(
  [{t:"#",w:520},{t:"Step",w:3700},{t:"Owner",w:1700},{t:"Time",w:1300},{t:"Blocks",w:3020}],
  [
   [{t:"1",align:AlignmentType.CENTER},"Create the Supabase project","TitanOS","~10 min","everything"],
   [{t:"2",align:AlignmentType.CENTER},"Apply the schema baseline","TitanOS","~15 min","everything"],
   [{t:"3",align:AlignmentType.CENTER},"Apply the feature migrations","TitanOS","~5 min","workflows, sending"],
   [{t:"4",align:AlignmentType.CENTER},"Set service secrets","TitanOS","~5 min","AI, email"],
   [{t:"5",align:AlignmentType.CENTER},"Deploy the edge functions","TitanOS","~20 min","AI, sending"],
   [{t:"6",align:AlignmentType.CENTER},"Seed the starter playbooks","TitanOS","~2 min","workflows"],
   [{t:"7",align:AlignmentType.CENTER},"Verify the sending domain","Firm + TitanOS",{t:"DNS wait",bold:true},"all outbound mail"],
   [{t:"8",align:AlignmentType.CENTER},"Deploy the branded frontend","TitanOS","~15 min","access"],
   [{t:"9",align:AlignmentType.CENTER},"Connect the firm's subdomain","Firm",{t:"DNS wait",bold:true},"branded access"],
   [{t:"10",align:AlignmentType.CENTER},"Create users and roles","TitanOS + Firm","~30 min","use"],
   [{t:"11",align:AlignmentType.CENTER},"Load families and designate primaries","TitanOS + Firm","1–2 hrs","workflows, CC"],
   [{t:"12",align:AlignmentType.CENTER},"Run pre-flight checks and sign off","TitanOS","~20 min","go-live"],
  ]));

// ── 1 ────────────────────────────────────────────────────────────────────────
add(H1("1.  Create the Supabase project"));
add(bullet("One project per firm. Name it for the firm; the project name cannot contain a hyphen in some flows, so prefer a single word."));
add(bullet("Choose the region nearest the firm's staff, not nearest you — it determines latency on every page load."));
add(bullet("Record the project URL and the anon (publishable) key immediately. You will need both for the frontend in step 8, and the anon key is awkward to find later."));
add(pull("The service role key is never used by the frontend and must never appear in a Vercel variable. It belongs only in edge function secrets."));

// ── 2 ────────────────────────────────────────────────────────────────────────
add(H1("2.  Apply the schema baseline"));
add(P("Because the repository has no baseline (see Read this first), the reliable method is to copy the schema from a reference project. Use PCM production as the reference — it is the most current.",{after:110}));
add(code([
 "# Dump schema only, no data, from the reference project",
 "pg_dump --schema-only --no-owner --no-privileges \\",
 "        --schema=public \\",
 "        \"$REFERENCE_DB_URL\" > baseline.sql",
 "",
 "# Review it, then apply to the new project",
 "psql \"$NEW_DB_URL\" -f baseline.sql",
]));
add(P("Then confirm the pieces that everything else depends on. All three functions must exist and be SECURITY DEFINER, or every row-level-security policy will fail at query time — in front of a client, not at deploy time.",{after:110}));
add(code([
 "select proname, prosecdef as security_definer",
 "  from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
 " where n.nspname = 'public'",
 "   and proname in ('is_admin','current_user_role',",
 "                   'current_user_allowed_family_ids');",
 "-- expect 3 rows, security_definer = true on each",
]));

// ── 3 ────────────────────────────────────────────────────────────────────────
add(H1("3.  Apply the feature migrations"));
add(P("These are in the repository, under supabase/migrations. Apply in filename order.",{after:110}));
add(table(
  [{t:"File",w:4200},{t:"What it adds",w:6040}],
  [
   [{t:"20260728_workflows.sql",mono:true,size:17},"Obligations, playbook templates, cycles and cycle steps, with RLS"],
   [{t:"20260728_workflows_starter_templates.sql",mono:true,size:17},"The four playbooks that ship with the product (see step 6)"],
   [{t:"20260728_primary_contact_cc.sql",mono:true,size:17},"contacts.is_primary, one-per-family constraint, and the draft CC line"],
   [{t:"20260728_outbound_email.sql",mono:true,size:17},"Sending identity, send-outcome columns, known-recipient lookup"],
   [{t:"20260728_playbooks_uhnw_batch2.sql",mono:true,size:17},"Five further playbooks, and the obligation kinds they need"],
  ]));
add(pull("There is no documents_property_section migration file, though PCM has that column. If the baseline you dumped in step 2 predates it, add the column manually — the frontend sends it on every document upload and inserts fail without it."));
add(code([
 "alter table public.documents",
 "  add column if not exists property_section text;",
 "create index if not exists documents_property_section_idx",
 "  on public.documents(property_id, property_section)",
 "  where property_section is not null;",
]));

// ── 4 ────────────────────────────────────────────────────────────────────────
add(H1("4.  Set service secrets"));
add(P("Edge function secrets, set in the new project's dashboard. SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically — do not set them by hand.",{after:110}));
add(table(
  [{t:"Secret",w:3200},{t:"Required",w:1300},{t:"Purpose",w:5740}],
  [
   [{t:"ANTHROPIC_API_KEY",mono:true,size:17},{t:"Yes",bold:true,align:AlignmentType.CENTER},"AI assistant, document reading, workflow drafting"],
   [{t:"RESEND_API_KEY",mono:true,size:17},{t:"Yes",bold:true,align:AlignmentType.CENTER},"All outbound mail: workflow sends, reports, reminders"],
   [{t:"ADVISOR_EMAIL_FROM",mono:true,size:17},{t:"Yes",align:AlignmentType.CENTER},"Sender for the client portal's email-my-adviser feature"],
   [{t:"ASSISTANT_MODEL",mono:true,size:17},{t:"No",align:AlignmentType.CENTER},"Overrides the default model for assistant and drafting"],
   [{t:"DOC_EXTRACT_MODEL",mono:true,size:17},{t:"No",align:AlignmentType.CENTER},"Overrides the model used to read uploaded documents"],
   [{t:"BRAND_NAME",mono:true,size:17},{t:"No",align:AlignmentType.CENTER},"Legacy fallback only. The frontend now sends the firm name."],
  ]));

// ── 5 ────────────────────────────────────────────────────────────────────────
add(H1("5.  Deploy the edge functions"));
add(table(
  [{t:"Function",w:3400},{t:"JWT",w:900},{t:"Purpose",w:5940}],
  [
   [{t:"family-ai-assistant",mono:true,size:17},{t:"Yes",align:AlignmentType.CENTER},"Per-family assistant, scoped to one family's records"],
   [{t:"extract-document-text",mono:true,size:17},{t:"Yes",align:AlignmentType.CENTER},"Reads uploaded documents, including OCR for scans"],
   [{t:"extract-property-fields",mono:true,size:17},{t:"Yes",align:AlignmentType.CENTER},"Pre-fills property records from a statement"],
   [{t:"send-advisor-email",mono:true,size:17},{t:"Yes",align:AlignmentType.CENTER},"Client emails their adviser from the portal"],
   [{t:"draft-workflow-step",mono:true,size:17},{t:"Yes",align:AlignmentType.CENTER},"Prepares a workflow draft and parks it for approval"],
   [{t:"send-workflow-step",mono:true,size:17},{t:"Yes",align:AlignmentType.CENTER},"Sends an approved draft with its attachments"],
   [{t:"send-task-reminders",mono:true,size:17},{t:"No",align:AlignmentType.CENTER},"Scheduled reminders. No JWT: invoked by cron."],
   [{t:"run-scheduled-prompts",mono:true,size:17},{t:"No",align:AlignmentType.CENTER},"Scheduled reports and concierge research. Cron-invoked."],
   [{t:"admin-set-password",mono:true,size:17},{t:"Yes",align:AlignmentType.CENTER},"Admin sets a user's password"],
  ]));
add(pull("run-scheduled-prompts and admin-set-password have no source in the repository. Copy them from a reference project. Also re-create the cron schedule for run-scheduled-prompts — it is a database job and does not travel with the function."));

// ── 6 ────────────────────────────────────────────────────────────────────────
add(H1("6.  Seed the starter playbooks"));
add(P("Nine playbooks ship with the product, spanning insurance, trusts and estates, tax and investments. They are rows rather than schema, so they are seeded. Running the files twice updates them in place rather than duplicating.",{after:110}));
add(table(
  [{t:"Playbook",w:3400},{t:"Discipline",w:2100},{t:"Steps",w:800},{t:"Lead time",w:1300},{t:"Conditional",w:2640}],
  [
   ["ILIT Premium Funding","Insurance",{t:"9",align:AlignmentType.CENTER},"75 days","Crummey notices"],
   ["Property Insurance Renewal","Insurance",{t:"8",align:AlignmentType.CENTER},"75 days","Market check"],
   ["Life Insurance In-Force Review","Insurance",{t:"8",align:AlignmentType.CENTER},"90 days","Remediation, trust-owned"],
   ["GRAT Annuity Payment","Trusts & Estates",{t:"8",align:AlignmentType.CENTER},"60 days","In-kind, final year"],
   ["Intra-Family Loan Interest","Trusts & Estates",{t:"7",align:AlignmentType.CENTER},"45 days","Maturity within a year"],
   ["Required Minimum Distribution","Tax",{t:"8",align:AlignmentType.CENTER},"90 days","CPA sign-off, charitable"],
   ["Partnership K-1 Collection","Tax",{t:"8",align:AlignmentType.CENTER},"75 days","—"],
   ["Quarterly Estimated Tax","Tax",{t:"5",align:AlignmentType.CENTER},"30 days","CPA sign-off"],
   ["Private Fund Capital Call","Investments",{t:"5",align:AlignmentType.CENTER},"12 days","—"],
  ]));
add(P("Confirm they landed, and that they match the reference tenant exactly. Identical digests mean the step definitions transferred without corruption:",{after:110}));
add(code([
 "select key, jsonb_array_length(steps) as steps,",
 "       md5(steps::text) as digest",
 "  from public.workflow_templates",
 " where is_starter order by key;",
 "-- 9 rows, 66 steps total; digests must match the reference",
]));

// ── 7 ────────────────────────────────────────────────────────────────────────
add(H1("7.  Verify the sending domain"));
add(P("Workflow correspondence goes out as the responsible Titan Expert, from their own address, on the firm's own verified domain — a banker or trustee should see the name of the person they deal with, not a shared robot mailbox and not another firm's domain. Providers verify domains rather than individual mailboxes, so one verified domain covers every Expert on it.",{after:110}));
add(P("Start this early. It is the only step gated on DNS propagation and on someone at the firm doing work.",{after:110,bold:true}));
add(bullet("Agree the domain. It must be one the firm controls, because verification requires DNS records."));
add(bullet("Add the domain in Resend and give the firm the DKIM and SPF records it generates."));
add(bullet("Wait for the provider to report the domain as verified. Do not proceed on trust."));
add(bullet("Only then set the row below. sender_verified is never set by code — it records that a human confirmed it."));
add(code([
 "update public.outbound_email_settings",
 "   set sending_domain   = 'clientfirm.com',",
 "       from_mode        = 'advisor',   -- send as each client's Expert",
 "       from_org_label   = 'Client Firm Wealth',",
 "       fixed_from_email = 'clientservices@clientfirm.com',  -- fallback",
 "       sender_verified  = true,        -- ONLY after provider confirms",
 "       updated_by       = 'you@titanos.com',",
 "       updated_at       = now()",
 " where id;",
]));
add(P("Then catch any Expert whose address is not on the verified domain. Their sends fall back to the firm address, or are refused if none is set. Far better to find this now than on a live premium deadline:",{after:110}));
add(code([
 "select f.name, f.advisor_email",
 "  from public.families f",
 " where f.advisor_email is not null",
 "   and lower(split_part(f.advisor_email,'@',2)) <>",
 "       (select lower(sending_domain)",
 "          from public.outbound_email_settings);",
 "-- expect zero rows",
]));
add(pull("While sender_verified is false the platform still drafts and approves normally — it simply refuses to send, with a message naming the reason. That is the intended state for a tenant mid-onboarding, so you can demonstrate the workflow before DNS is done."));

// ── 8 ────────────────────────────────────────────────────────────────────────
add(H1("8.  Deploy the branded frontend"));
add(P("One codebase, one deployment per tenant. Only environment variables differ. Set these in Vercel before the first build — the brand tokens are baked into the HTML at build time, because link-preview crawlers do not execute JavaScript.",{after:110}));
add(table(
  [{t:"Variable",w:3500},{t:"Example",w:3400},{t:"Notes",w:3340}],
  [
   [{t:"VITE_SUPABASE_URL",mono:true,size:17},{t:"https://xxx.supabase.co",mono:true,size:16},"From step 1"],
   [{t:"VITE_SUPABASE_ANON_KEY",mono:true,size:17},{t:"eyJ…",mono:true,size:16},"Anon key only, never service role"],
   [{t:"VITE_BRAND_NAME",mono:true,size:17},"Client Firm Wealth","Also used as the drafting firm name"],
   [{t:"VITE_BRAND_SHORT",mono:true,size:17},"CFW","Mobile app title"],
   [{t:"VITE_BRAND_TAGLINE",mono:true,size:17},"PRIVATE WEALTH OFFICE","Rendered as text, not baked into the logo"],
   [{t:"VITE_BRAND_LOGO_URL",mono:true,size:17},{t:"/cfw-logo-full.png",mono:true,size:16},"Transparent PNG, wordmark without tagline"],
   [{t:"VITE_BRAND_MARK_URL",mono:true,size:17},{t:"/cfw-mark.png",mono:true,size:16},"Square mark for the assistant button"],
   [{t:"VITE_BRAND_PRIMARY",mono:true,size:17},{t:"#253978",mono:true,size:16},"Sample from a high-resolution original, not a screenshot"],
   [{t:"VITE_BRAND_ACCENT",mono:true,size:17},{t:"#CEB684",mono:true,size:16},"Secondary/accent colour"],
   [{t:"VITE_BRAND_SITE_URL",mono:true,size:17},{t:"https://portal.clientfirm.com",mono:true,size:16},"Required: link previews need absolute URLs"],
   [{t:"VITE_BRAND_OG_IMAGE",mono:true,size:17},{t:"/cfw-og.png",mono:true,size:16},"1200×630 share image"],
   [{t:"VITE_BRAND_RUNTIME",mono:true,size:17},{t:"unset",mono:true,size:16},"Set to 1 only for the demo instance"],
  ]));
add(pull("The build fails deliberately if any brand token is left unresolved, rather than shipping literal placeholder text into a page title or a link preview. A failed build here is the guard working."));

// ── 9 ────────────────────────────────────────────────────────────────────────
add(H1("9.  Load the firm's own document templates"));
add(P("The six fillable documents on the Resources tab, plus the Titan Expert user guide, are the firm's own paperwork. They are not shipped with the platform and there is no shared default. Until they are uploaded, those tiles are disabled."));
add(pull("This step is not cosmetic. The Client Services Agreement names the contracting party in its body text, and the ACH authorization names the bank that will be debited. A template borrowed from another firm produces a contract with the wrong legal entity and a debit authority pointing at the wrong account.", RED));
add(P("Sign in as an administrator and open Branding \u2192 Document Templates. Choose the scope \u2014 a specific brand profile, or \u201cProject default\u201d for a deployment that brands itself through build-time env vars \u2014 then upload one PDF per row:"));
add(bullet("Client Services Agreement \u2014 the firm's own, lawyer-reviewed"));
add(bullet("Auto-Debit (ACH) Authorization \u2014 naming the firm's bank"));
add(bullet("Client Data Completeness Checklist"));
add(bullet("Wire Instructions"));
add(bullet("Personal Financial Statement"));
add(bullet("Lifestyle Expense Worksheet"));
add(bullet("Titan Expert User Guide \u2014 reference only, no form fields"));
add(P("Each upload is a fillable PDF whose AcroForm field names must match what the platform writes. The field names are read on upload and any that are missing are listed against the card; the Resources tile stays disabled until they are all present. This matters because the filler sets fields by name \u2014 a template with renamed fields would otherwise generate a document that reported success and came out blank."));
add(P("The required field names per document are derived in the code from DOC_CONFIGS (see requiredFieldsFor in src/App.jsx), so the upload screen and the Resources tab can never disagree about what a template needs."));
add(pull("Templates are stored in the private brand-documents bucket and fetched through 60-second signed URLs, so one tenant cannot read another's letterhead by guessing a path.", WARN));

add(H1("10.  Connect the firm's subdomain"));
add(bullet("The firm adds one CNAME record pointing their chosen subdomain (for example portal.clientfirm.com) at the Vercel deployment."));
add(bullet("Certificates are issued and renewed automatically once the record resolves."));
add(bullet("Confirm the deployed page title and share image show the firm's brand, not TitanOS defaults. Fetch the page and read the title tag; do not judge by the logo alone."));

// ── 10 ───────────────────────────────────────────────────────────────────────
add(H1("11.  Create users and roles"));
add(table(
  [{t:"Role",w:1900},{t:"Sees",w:4200},{t:"Can change",w:4140}],
  [
   ["Admin","Everything in the firm","Everything, including branding and playbooks"],
   ["Titan Expert","Only their own book of families","Their own families' records and workflows"],
   ["Partner","Only families explicitly granted to them","Nothing. Read-only, plus document upload."],
   ["Client","Their own family only","Nothing"],
  ]));
add(bullet("Roles are enforced in the database, not only in the menu. A Partner cannot approve a workflow step even by calling the API directly."));
add(bullet("Set each family's advisor_email to the responsible Expert. This drives both the workflow CC and the From address on outbound mail, so an error here has real consequences."));

// ── 11 ───────────────────────────────────────────────────────────────────────
add(H1("12.  Load families and designate primaries"));
add(P("Every outbound workflow draft copies the family principal. Where several members have an email and none is marked primary, the platform copies nobody and says so on the draft — it does not guess, because putting client correspondence in front of the wrong family member is worse than no copy at all.",{after:110}));
add(P("Designate the principal with the star in the Members card, then confirm none are missing:",{after:110}));
add(code([
 "select f.name as family,",
 "       coalesce(p.name,'*** NONE DESIGNATED ***') as principal,",
 "       p.email",
 "  from public.families f",
 "  left join lateral public.family_primary_contact(f.id) p on true",
 " order by f.name;",
]));
add(P("Also add the firm's real counterparties — bankers, trustees, carriers, CPAs — to each family's contacts. Two reasons: drafts can then address them properly, and the send-time recipient check recognises them. An address the firm has no record of stops the send and asks for explicit confirmation.",{after:110}));

// ── 12 ───────────────────────────────────────────────────────────────────────
add(H1("13.  Pre-flight checks and sign-off"));
add(P("Run these against the new tenant before handing it over. Each one has caught a real problem.",{after:110}));
add(code([
 "-- Schema completeness",
 "select",
 "  (select count(*) from information_schema.columns",
 "    where table_name='documents'",
 "      and column_name='property_section')        as doc_section,",
 "  (select count(*) from public.workflow_templates",
 "    where is_starter)                            as playbooks,",
 "  (select count(*) from pg_class c",
 "     join pg_namespace n on n.oid=c.relnamespace",
 "    where n.nspname='public' and c.relrowsecurity",
 "      and c.relname in ('obligations','workflow_templates',",
 "        'workflow_instances','workflow_instance_steps'))  as rls_on;",
 "-- expect 1, 9, 4",
]));
add(P("Then confirm isolation actually holds, by impersonating a real Expert and checking they cannot see another Expert's client. This is the check worth doing properly, because the failure mode is a confidentiality breach rather than an error message:",{after:110}));
add(code([
 "-- inside a transaction, as an authenticated user",
 "select set_config('request.jwt.claims',",
 "  json_build_object('sub','<expert-user-id>',",
 "                    'role','authenticated')::text, true);",
 "set local role authenticated;",
 "select count(*) from public.families;   -- only their own",
 "select count(*) from public.obligations;-- only their own",
]));
add(H2("Sign-off checklist"));
add(bullet("Three RLS helper functions present and SECURITY DEFINER."));
add(bullet("Nine starter playbooks present, 66 steps, digests match the reference tenant."));
add(bullet("documents.property_section present; a test document upload succeeds."));
add(bullet("Sending domain verified with the provider and sender_verified set to true."));
add(bullet("Zero families whose Expert address is off the verified domain."));
add(bullet("Every family has a designated principal, or the omission is deliberate and noted."));
add(bullet("An Expert signing in lands on the dashboard and can see only their own book."));
add(bullet("One workflow cycle started, drafted, approved and sent end to end on demo data."));
add(bullet("All demo and test rows removed, verified by count rather than by eye."));

// ── GAPS ─────────────────────────────────────────────────────────────────────
add(H1("Known gaps in the onboarding process"));
add(P("Named here so they are planned for rather than discovered mid-provisioning.",{after:100}));
add(bullet("No checked-in schema baseline. Provisioning depends on dumping the schema from a reference project, which means the reference project is load-bearing infrastructure. Generating a baseline migration is the highest-value fix to this process."));
add(bullet("Two deployed edge functions have no source in the repository: run-scheduled-prompts and admin-set-password."));
add(bullet("The cron schedule for scheduled reports is a database job and must be re-created per tenant; it does not travel with the function deployment."));
add(bullet("No delivery confirmation. The platform records that the email provider accepted a message, which is not the same as it arriving. A bounced instruction will currently sit looking sent until bounce handling is built."));
add(bullet("No cross-tenant single sign-on. An Expert serving clients through several branded instances signs into each separately."));
add(bullet("Draft recipients are often descriptions rather than addresses (\"First Republic Bank, Wire Operations\"). Sending refuses those until a real address is supplied, so loading counterparty contacts during step 11 materially reduces friction later."));

add(new Paragraph({spacing:{before:320},alignment:AlignmentType.CENTER,
  border:{top:{style:BorderStyle.SINGLE,size:6,color:GOLD}},
  children:[new TextRun({text:"TitanOS  ·  Internal Operations  ·  Not for circulation to client firms",size:17,color:SOFT,font:"Calibri"})]}));

const doc=new Document({
  numbering:{config:[{reference:"b",levels:[{level:0,format:LevelFormat.BULLET,text:"•",style:{paragraph:{indent:{left:340,hanging:190}}}}]}]},
  sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:1000,bottom:900,left:1000,right:1000}}},children:k}]
});
Packer.toBuffer(doc).then(b=>{fs.writeFileSync("TitanOS_Onboarding_Runbook.docx",b);console.log("written");});
