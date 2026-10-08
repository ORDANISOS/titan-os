
const fs=require("fs");
const {Document,Packer,Paragraph,TextRun,AlignmentType,Table,TableRow,TableCell,WidthType,BorderStyle,ShadingType,LevelFormat}=require("docx");
const BRAND=require("./brand.js");

const NAVY="092B49", GOLD="CEB684", SOFT="5A6E84", BODY="1E293B";
const CW=10240;
const bd=()=>({style:BorderStyle.SINGLE,size:4,color:"D8CDB8"});
const cellB={top:bd(),bottom:bd(),left:bd(),right:bd()};

const P=(t,o)=>{o=o||{};return new Paragraph({spacing:{after:o.after||110},alignment:o.align,
  children:[new TextRun({text:t,size:o.size||21,color:o.color||BODY,font:"Calibri",bold:o.bold,italics:o.italics})]});};
const H1=t=>new Paragraph({spacing:{before:320,after:130},
  border:{bottom:{style:BorderStyle.SINGLE,size:8,color:GOLD}},
  children:[new TextRun({text:t,bold:true,size:26,color:NAVY,font:"Georgia"})]});
const pull=t=>new Paragraph({spacing:{before:120,after:160},
  shading:{type:ShadingType.CLEAR,fill:"F4F1EA"},
  border:{left:{style:BorderStyle.SINGLE,size:18,color:GOLD}},
  indent:{left:200},
  children:[new TextRun({text:t,size:20,color:NAVY,font:"Calibri",italics:true})]});
const bullet=t=>new Paragraph({numbering:{reference:"b",level:0},spacing:{after:70},
  children:[new TextRun({text:t,size:20,color:BODY,font:"Calibri"})]});

const STATUS={LIVE:{fill:"E2F2E8",color:"115C33"},DEMO:{fill:"FBF3E3",color:"7A5A19"},BUILDING:{fill:"EDEFF3",color:"4A5568"}};
const hdrCell=(t,w)=>new TableCell({width:{size:w,type:WidthType.DXA},borders:cellB,
  shading:{type:ShadingType.CLEAR,fill:NAVY},margins:{top:70,bottom:70,left:110,right:110},
  children:[new Paragraph({children:[new TextRun({text:t,bold:true,size:17,color:"FFFFFF",font:"Calibri"})]})]});
const txtCell=(t,w,o)=>{o=o||{};return new TableCell({width:{size:w,type:WidthType.DXA},borders:cellB,
  margins:{top:70,bottom:70,left:110,right:110},
  children:[new Paragraph({alignment:o.align,children:[new TextRun({text:t,size:o.size||19,color:o.color||BODY,font:"Calibri",bold:o.bold})]})]});};
const statusCell=(s,w)=>{const st=STATUS[s]||STATUS.BUILDING;
  return new TableCell({width:{size:w,type:WidthType.DXA},borders:cellB,
    shading:{type:ShadingType.CLEAR,fill:st.fill},margins:{top:70,bottom:70,left:110,right:110},
    children:[new Paragraph({alignment:AlignmentType.CENTER,
      children:[new TextRun({text:s,bold:true,size:16,color:st.color,font:"Calibri"})]})]});};
const capTable=rows=>new Table({width:{size:CW,type:WidthType.DXA},columnWidths:[8240,2000],
  rows:[new TableRow({tableHeader:true,children:[hdrCell("Capability",8240),hdrCell("Status",2000)]})].concat(
    rows.map(r=>new TableRow({children:[txtCell(r[0],8240),statusCell(r[1],2000)]})))});

const k=[];
const add=function(){for(var i=0;i<arguments.length;i++)k.push(arguments[i]);};

add(
 // Real logo artwork. This cover previously approximated the two-tone wordmark
 // with Arial Black and put the tagline in grey, while three sibling documents
 // set it flat navy in Georgia with a gold tagline. One source now, one look.
 ...BRAND.masthead(),
 new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:40},
   border:{bottom:{style:BorderStyle.SINGLE,size:8,color:GOLD}},
   children:[new TextRun({text:"Capability Overview",bold:true,size:32,color:NAVY,font:"Georgia"})]}),
 new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:100,after:250},
   children:[new TextRun({text:"28 July 2026  ·  Confidential",size:17,color:SOFT,font:"Calibri"})]}),
 P("TitanOS is the operating system behind a modern advisory firm: one place for a client's whole balance sheet, documents attached to the numbers they support, an assistant that answers from the firm's own records, and workflows that carry recurring obligations to completion under human approval."),
 P("Every firm runs in its own isolated environment under its own brand. PCM Family Office is the pilot client."),
 new Paragraph({spacing:{before:170,after:70},children:[new TextRun({text:"Reading the status column",bold:true,size:19,color:NAVY,font:"Calibri"})]}),
 new Table({width:{size:CW,type:WidthType.DXA},columnWidths:[1700,8540],rows:[
   new TableRow({children:[statusCell("LIVE",1700),txtCell("In production today, carrying real client data",8540)]}),
   new TableRow({children:[statusCell("DEMO",1700),txtCell("Built and working on the demonstration instance",8540)]}),
   new TableRow({children:[statusCell("BUILDING",1700),txtCell("In active development",8540)]})
 ]})
);

add(H1("1.  White-label, genuinely"));
add(P("The product is TitanOS. Every firm — including PCM — is a tenant that supplies its own identity. Nothing in the codebase treats one firm as special."));
add(capTable([["Brand name, logo, tagline and full colour palette per tenant","LIVE"],["Runtime brand switching from an admin screen — no rebuild, no developer","DEMO"],["Several saved brands, switched in one click, for concurrent sales cycles","DEMO"],["Branding carries through to exported PDFs, print reports and outbound email","LIVE"],["Branded link previews, favicons and browser chrome per tenant","LIVE"],["Dedicated database per firm — no shared tables, no shared rows","LIVE"]]));
add(pull("Every client firm gets an isolated environment with its own database, provisioned in under a day, carrying their brand end to end — down to the PDF a client opens on their phone."));
add(H1("2.  One place for the whole balance sheet"));
add(capTable([["Properties with loan, tax, insurance, flood and rental detail","LIVE"],["Portfolio accounts, with lines of credit correctly excluded from asset totals","LIVE"],["Valuables, flagged insured or not scheduled","LIVE"],["Cash flow modelling with tax treatment and multi-year projection","LIVE"],["Deals pipeline and prospect tracking","LIVE"],["Tasks, deadlines and recurring obligations","LIVE"],["Professional contacts and property vendors, click to call and click to email","LIVE"]]));
add(H1("3.  Documents attached to the numbers"));
add(P("Most platforms give you a folder. This links a document to the figure it supports."));
add(capTable([["CHRIS organised into folders by category","LIVE"],["AI reads uploaded documents — embedded text, and OCR for scans","LIVE"],["Documents linked to a specific property section: mortgage, tax bill, insurance declarations, insurance invoice, flood, rental agreement","LIVE"],["Valuables linked to the schedule that covers them","LIVE"],["Account balances are dated and traceable to the statement they came from","LIVE"],["Balance history per account, showing the change between periods","LIVE"],["Upload a statement and the AI proposes the closing balance for a person to confirm","LIVE"],["A corrected statement replaces that period's figure rather than sitting beside it","LIVE"],["Statements sit in CHRIS, so they are AI-readable and their downloads are logged","LIVE"],["Attach from the figure itself — a paperclip beside Property Taxes opens a pre-filled upload","LIVE"],["Replacing a document keeps the previous one on file, unlinked, for history","LIVE"],["Download audit log — who opened which document, and when","LIVE"],["Time-limited signed links; no permanent public file URLs","LIVE"]]));
add(pull("Demo moment: open a property, click the icon beside the insurance premium, and the declarations page opens. Next year's bill replaces it in two clicks and last year's stays on file."));
add(pull("And the question every client eventually asks: where did this number come from. An account shows its balance, the date it is good as at, and a link to the statement behind it. Upload the next statement and the figure is read for an adviser to confirm, then filed as a dated entry beside the last one. A figure with no statement behind it says so."));
add(H1("4.  AI that works from the client's own records"));
add(P("Not a chatbot bolted on. It answers from one family's data and names the document it used."));
add(capTable([["Per-family assistant answering from that family's records and document contents","LIVE"],["Strictly scoped to one family — it cannot answer across relationships","LIVE"],["Floating assistant on every page; firm-wide screens ask which client first","LIVE"],["Named per family, so the client meets a consistent assistant","LIVE"],["Scheduled reports on a cadence, delivered as branded PDFs","LIVE"],["Concierge research — live web search for what a client asked the firm to watch for, with sources","LIVE"],["Document field extraction to pre-fill property records from a statement","LIVE"],["Treats document text strictly as data, never as instructions","LIVE"]]));
add(pull("Demo moment: ask “is anything uninsured?” and it names the vehicle missing from the schedule, because it read the endorsement."));
add(H1("5.  Workflows: obligations carried to completion"));
add(P("The difference between software that tells you something and software that gets something done."));
add(capTable([["Recurring obligations: premiums, estimated tax, RMDs, capital calls, loan payments","LIVE"],["Nine starter playbooks ship with the product, across four disciplines","LIVE"],["Lead times measured back from the due date, per playbook","LIVE"],["Conditional steps — Crummey notices only where the trust requires them","LIVE"],["Conditions resolved before dates are set, because they change the schedule","LIVE"],["Flagged at risk on day one when a cycle starts too late to fit its own lead times","LIVE"],["Every outbound item held for named human approval","LIVE"],["Sends from the platform, as the responsible Titan Expert on the firm's own verified domain","LIVE"],["Supporting documents pulled from CHRIS and attached to the message","LIVE"],["Approval and sending recorded separately, each attributed to a named person","LIVE"],["Sent means the provider accepted it, with a delivery reference recorded","LIVE"],["Recipients checked against the client's known contacts; an unfamiliar address stops the send","LIVE"],["A failed send stays in the queue rather than looking successful","LIVE"],["Re-sending the same instruction twice is not possible","LIVE"],["Every outbound item copies the family principal, so the client sees what is done in their name","LIVE"],["Refuses to guess the principal where a family has several members on file","LIVE"],["Skipped steps stay visible, so nothing looks forgotten","LIVE"],["Template library in Resources: read the exact playbook before it runs","LIVE"],["Steps read in plain language — 60 days before, who acts, and to whom","LIVE"],["Admins edit lead times, actors, recipients and conditions; others read only","LIVE"],["New playbooks are rows, not code — the firm adds its own","LIVE"],["Review queue on the dashboard: everything awaiting a person, across the book","LIVE"],["Playbooks provision from one migration file, identical across every tenant","LIVE"]]));
add(pull("Two things to say out loud: nothing sends without a named approval, and the platform prepares payment instructions but never moves money. Those are the reasons a compliance officer says yes."));
add(H1("6.  Roles and permissions enforced at the data layer"));
add(P("Access rules live in the database, so they hold even if the application layer is bypassed."));
add(capTable([["Four roles: Admin, Titan Expert, Partner, Client","LIVE"],["Row-level security per family, enforced in Postgres","LIVE"],["Titan Experts see only their own book","LIVE"],["Partners: read-only, per-family grants, document upload only","LIVE"],["Clients: their own family, read-only","LIVE"],["Permission changes take effect immediately, including for scheduled automations","LIVE"],["Per-partner feature permissions, such as who may run scheduled reports","LIVE"],["Admin screens gated on role at the view, not only in the menu","LIVE"],["Clients may email their own advisor, never other advisors at the firm","LIVE"]]));
add(H1("7.  Client experience"));
add(capTable([["Branded client portal carrying the firm's identity","LIVE"],["Read-only net worth, properties, accounts, valuables and documents","LIVE"],["Email their advisor from inside the portal; primary advisor always copied","LIVE"],["Mobile responsive throughout","LIVE"],["Firm-paid bills marked paid, recording who paid and when","LIVE"]]));
add(H1("8.  Operational quality"));
add(P("Unglamorous, and the reason it survives a real deployment."));
add(capTable([["Long AI jobs run in the background — no timeouts on multi-minute research","LIVE"],["Every build stamped; open tabs are told when a newer version is live","LIVE"],["Cache rules: immutable hashed assets, never-cached entry point","LIVE"],["Brand artwork versioned, so a replaced logo appears immediately","LIVE"],["Artwork failure falls back to the brand name rather than a blank header","LIVE"],["Unsaved brand edits survive leaving the page","DEMO"],["Unrecognised categories fall into Other rather than hiding an asset","LIVE"]]));
add(new Paragraph({spacing:{before:220,after:90},children:[new TextRun({text:"Starter playbooks",bold:true,size:22,color:NAVY,font:"Georgia"})]}));
add(new Table({width:{size:CW,type:WidthType.DXA},columnWidths:[3500,2150,900,1400,2290],rows:[
 new TableRow({tableHeader:true,children:[hdrCell("Playbook",3500),hdrCell("Discipline",2150),hdrCell("Steps",900),hdrCell("Lead time",1400),hdrCell("Conditional",2290)]}),
 new TableRow({children:[txtCell("ILIT Premium Funding",3500),txtCell("Insurance",2150),txtCell("9",900,{align:AlignmentType.CENTER}),txtCell("75 days",1400),txtCell("Crummey notices",2290)]}),
 new TableRow({children:[txtCell("Property Insurance Renewal",3500),txtCell("Insurance",2150),txtCell("8",900,{align:AlignmentType.CENTER}),txtCell("75 days",1400),txtCell("Market check",2290)]}),
 new TableRow({children:[txtCell("Life Insurance In-Force Review",3500),txtCell("Insurance",2150),txtCell("8",900,{align:AlignmentType.CENTER}),txtCell("90 days",1400),txtCell("Remediation, trust-owned",2290)]}),
 new TableRow({children:[txtCell("GRAT Annuity Payment",3500),txtCell("Trusts & Estates",2150),txtCell("8",900,{align:AlignmentType.CENTER}),txtCell("60 days",1400),txtCell("In-kind, final year",2290)]}),
 new TableRow({children:[txtCell("Intra-Family Loan Interest",3500),txtCell("Trusts & Estates",2150),txtCell("7",900,{align:AlignmentType.CENTER}),txtCell("45 days",1400),txtCell("Maturity within a year",2290)]}),
 new TableRow({children:[txtCell("Required Minimum Distribution",3500),txtCell("Tax",2150),txtCell("8",900,{align:AlignmentType.CENTER}),txtCell("90 days",1400),txtCell("CPA sign-off, charitable",2290)]}),
 new TableRow({children:[txtCell("Partnership K-1 Collection",3500),txtCell("Tax",2150),txtCell("8",900,{align:AlignmentType.CENTER}),txtCell("75 days",1400),txtCell("—",2290)]}),
 new TableRow({children:[txtCell("Quarterly Estimated Tax",3500),txtCell("Tax",2150),txtCell("5",900,{align:AlignmentType.CENTER}),txtCell("30 days",1400),txtCell("CPA sign-off",2290)]}),
 new TableRow({children:[txtCell("Private Fund Capital Call",3500),txtCell("Investments",2150),txtCell("5",900,{align:AlignmentType.CENTER}),txtCell("12 days",1400),txtCell("—",2290)]})
]}));
add(P("Chosen by consequence of failure rather than frequency. A missed GRAT annuity can unwind the whole structure; unpaid intra-family loan interest can be recharacterised as a gift years later; an unreviewed universal life policy lapses quietly on an elderly insured; a short required distribution carries a penalty; and one late partnership document holds up an entire return. None of them announce themselves, which is exactly why they are worth automating.",{after:60}));
add(P("Lead times are a considered starting point rather than advice. Deadlines vary by jurisdiction and change with legislation, so each firm should have its own tax and legal counsel confirm them before a playbook runs against a real family. That is one reason playbooks are held as data a firm can edit, not code it cannot.",{after:60,size:19,color:SOFT}));

add(H1("Known gaps"));
add(P("Named here so they are raised by us rather than discovered by a prospect. Each has a credible answer."));
add(bullet("Cross-firm single sign-on. A Titan Expert serving clients through several branded instances signs into each separately. Deliberate isolation today; central identity is on the roadmap."));
add(bullet("Multi-factor authentication and a full change-history audit. Document downloads and task completions are attributed today; a complete record of field-level changes is not yet built."));
add(bullet("Cash flow line items are not yet linked to source documents the way properties, valuables and portfolio accounts are."));
add(bullet("Backup and recovery policy should be stated explicitly for an enterprise buyer."));
add(bullet("Delivery confirmation. The platform records that the email provider accepted a message, which is not the same as it arriving. Bounce and complaint handling is the next piece of work; until then a bounced item would sit looking sent."));
add(P("Fixed since the last revision, recorded because a technical buyer will probe it: outbound drafts used to take the firm name from a server-side setting, and fell back to the product name if it was unset. The tenant's own deployment now supplies it, so a firm's letters carry the firm's name with nothing to configure.",{after:60}));

add(new Paragraph({spacing:{before:320},alignment:AlignmentType.CENTER,
  border:{top:{style:BorderStyle.SINGLE,size:6,color:GOLD}},
  children:[new TextRun({text:"TitanOS  ·  Confidential  ·  Pilot client: PCM Family Office",size:17,color:SOFT,font:"Calibri"})]}));

const doc=new Document({
  numbering:{config:[{reference:"b",levels:[{level:0,format:LevelFormat.BULLET,text:"•",style:{paragraph:{indent:{left:340,hanging:190}}}}]}]},
  sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:1000,bottom:900,left:1000,right:1000}}},children:k}]
});
Packer.toBuffer(doc).then(b=>{fs.writeFileSync("TitanOS_Capability_Overview.docx",b);console.log("written");});
