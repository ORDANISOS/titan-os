// ORDANIS staff screens (scaling step 3, docs/PLAN-SCALING-STEP2.md follow-on).
//
// Moved verbatim out of App.jsx so that clients never download them: App.jsx loads this file the first time a staff,
// firm administrator or partner screen is drawn (see "STAFF SCREENS: A SEPARATE DOWNLOAD" there). Shared building
// blocks (theme, buttons, the Supabase client, helpers) stay in App.jsx and are imported back below.
import { useState, useCallback, useEffect, useRef, Component, useMemo } from "react";
import { planAllows, planLabel, normalisePlan, PLANS, PLAN_BLURB } from "./plans.js";
import { createClient } from "@supabase/supabase-js";
import { buildActivityReportPdf, fig as arFig, AR_PERIODS } from "./activityReport.js";
import { ACCT_TYPES, AssistantWelcome, AttachLink, B, BRAND, BRAND_DOCS, Badge, Btn, CURRENT_USER_LABEL, CashFlowView, CollapseBox, DEBT_LINE_KINDS, DOC_CATEGORIES, DOC_UPLOAD_EXTS, DocLink, DocumentsView, DraftReviewModal, EMAIL_RE, EmailLink, Empty, FAMILY_SCOPED, FIRM_DEFAULTS, FIRM_GATE_MSG, FULL_H, FamilyAssistant, Field, GoldLine, Grid2, HouseholdSectionMenu, Inp, JOINED_VIA_TEXT, LoanForm, LoansPanel, MFA_CARD, MFA_ERR, MFA_REQUIRED_ROLES, MIN_PASSWORD_LENGTH, MfaCodeInput, Modal, MoneyInput, ObligationsSection, PCMLogo, PRIORITY_COLORS, PROP_TYPES, PhoneLink, PropertyContactForm, PropertyForm, PropertySecuredLoans, REMINDER_OPTIONS, RecurrenceField, ReqHint, SIGNUP_PLAN_ORDER, STEP_ACTORS, STEP_KINDS, STEP_STATUS_TINT, SUPABASE_KEY, SUPABASE_URL, SectionLabel, SecurityButton, Sel, Spinner, StatBox, TAB_MOTION_CSS, TaskForm, Tex, VALUABLE_CATS, ValuableForm, ValuablePolicyDetails, _greetedFamilies, actorLabel, buildVendorOptions, callFirmJoin, contactProblem, dateOnly, docFileProblem, dueEnd, escHtml, fetchAllRows, firmDocGate, fmt, fmtMoney, fmtPct, formatPhoneInput, inp, isActiveFamily, isValidPhone, kindLabel, loadFirmDefaults, loadHouseholdBundle, loadNoteAttachments, loanOnListedProperty, loanRowFromForm, loanTitle, loansDebt, localDayISO, localISODate, mfaCodeMessage, mfaStatus, mortgageOntoProperty, nextRecurrence, numOrNull, parseLocalDate, pctChange, reminderDaysOr7, roleLabel, sb, scheduleNextOccurrence, statusWord, stepTransitionPatch, toClient, todayISO, useIsMobile, useTabEntrance, valuableRowFromForm } from "./App.jsx";

// pdf-lib is loaded the first time a form template is read or filled (scaling step 3), not with the app.
const loadPdfDocument=()=>import("pdf-lib").then(m=>m.PDFDocument,()=>{throw new Error("ORDANIS was updated since this page opened. Please reload the page and try again.");});
// Temporary passwords come from the browser's secure random source, not Math.random().
const genTempPassword = () => {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const b = new Uint32Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, n => a[n % a.length]).join("");
};

async function loadBrandDocuments(){
  try{
    const{data,error}=await sb.rpc("active_brand_documents");
    if(error)throw error;
    const byKey={};
    (data||[]).forEach(r=>{
      byKey[r.doc_key]={
        storagePath:r.storage_path,
        filename:r.original_filename||"",
        fieldNames:r.field_names||[],
        missingFields:r.missing_fields||[],
        uploadedAt:r.uploaded_at,
        isProjectDefault:!!r.is_project_default,
      };
    });
    BRAND_DOCS.byKey=byKey;
    BRAND_DOCS.error=null;
  }catch(e){
    // Record the failure rather than swallowing it. An empty template set and a
    // failed lookup look identical from the outside but mean different things:
    // one is "upload your documents", the other is "something is broken".
    BRAND_DOCS.byKey={};
    BRAND_DOCS.error=e?.message||"Couldn't load document templates";
  }finally{
    BRAND_DOCS.loaded=true;
  }
}

// Two documents, two conventions: the agreement prints the amount bare, the ACH
// form prints it with a currency symbol. Formatting sits here rather than in the
// stored value so the number stays a number.
const feePlain=n=>n==null?"":Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const feeCurrency=n=>n==null?"":`$${feePlain(n)}`;
const feeAnnualPlain=n=>n==null?"":feePlain(Number(n)*12);

// The bucket is private, so bytes come through a short-lived signed URL rather
// than a public path. 60s is ample for a click-to-generate and leaves nothing
// durable to share around.
async function fetchTemplateBytes(docKey){
  const rec=BRAND_DOCS.byKey[docKey];
  if(!rec)throw new Error(`No template is on file for this document. An administrator needs to upload it under Branding.`);
  const{data,error}=await sb.storage.from("brand-documents").createSignedUrl(rec.storagePath,60);
  if(error||!data?.signedUrl)throw new Error("Couldn't open the template — "+(error?.message||"no signed URL returned"));
  const res=await fetch(data.signedUrl);
  if(!res.ok)throw new Error(`Couldn't download the template (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

const STAGES=["Lead","Qualified","Proposal","Negotiation","Closed Won","Closed Lost"];
const STAGE_COLORS={
  "Lead":{bg:"#e8f0f8",text:"#293d5c",dot:"#293d5c"},
  "Qualified":{bg:"#e8f2ec",text:"#1d6b3a",dot:"#2e9e57"},
  "Proposal":{bg:"#fef3e2",text:"#8a5c00",dot:"#d4900a"},
  "Negotiation":{bg:"#fde8d8",text:"#8b3a12",dot:"#d45d1a"},
  "Closed Won":{bg:"#e0f5e9",text:"#0d5c2b",dot:"#18a850"},
  "Closed Lost":{bg:"#fde8e8",text:"#8b1a1a",dot:"#d43030"},
};
// For values that may be either a calendar date ("2026-11-01") or a full timestamp. A bare date is a day
// on the calendar and is read in local time; new Date("2026-11-01") reads it as UTC midnight, which in
// the US is the evening before, so dates showed a day early. A timestamp is a moment and is read as-is.
function asDate(v){return typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)?parseLocalDate(v):new Date(v);}
// Several households' rows for a few tables (the Expert print report). Ids go in groups so the request stays short.
async function loadFamiliesTables(famIds,tables){
  const out={};
  for(const t of tables){
    out[t]=[];
    for(let i=0;i<famIds.length;i+=150){
      const ids=famIds.slice(i,i+150);
      out[t].push(...(await fetchAllRows(()=>sb.from(t).select("*").in("family_id",ids).order("created_at",{ascending:false}).order("id"))).map(toClient));
    }
  }
  return out;
}
function AdvisorScopeBar({userProfile,value,onChange,label="ORDANIS Expert"}){
  const[advisors,setAdvisors]=useState([]);
  const isAdmin=userProfile?.role==="admin";
  useEffect(()=>{
    if(isAdmin)sb.from("user_profiles").select("id,email,full_name,role").in("role",["advisor","admin"]).then(({data:rows,error})=>{if(!error&&rows)setAdvisors(rows);});
  },[isAdmin]);
  if(!isAdmin)return null;
  return <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
    <span style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>{label}</span>
    <div style={{minWidth:150}}>
      <Sel value={value} onChange={e=>onChange(e.target.value)}>
        <option value="">All ORDANIS Experts</option>
        {advisors.map(a=><option key={a.id} value={(a.email||"").toLowerCase()}>{a.full_name||a.email}</option>)}
      </Sel>
    </div>
  </div>;
}
function IRow({label,value}){return <div style={{display:"flex",gap:10,fontSize:13,padding:"5px 0",borderBottom:`1px solid ${B.borderLight}`}}><span style={{color:B.textSoft,minWidth:120,flexShrink:0,fontSize:12}}>{label}</span><span style={{color:B.text,fontWeight:600}}>{value}</span></div>;}
// Renders nothing when there is no supporting document, so the UI never shows a
// link that leads nowhere.
// ── ACCOUNT BALANCE HISTORY ──────────────────────────────────────────────────
// A balance is not a number, it is a number as at a date, from a statement. This
// panel is where that becomes visible: every figure the firm has held for an
// account, what it came from, and who put it there.
//
// Recording a balance writes to account_balances; a database trigger mirrors the
// newest entry onto the account so net worth figures elsewhere stay correct
// without this component knowing anything about them.
function AccountBalancesPanel({account,family,history,documents,reload,toast,canEdit,userProfile}){
  const[open,setOpen]=useState(false);
  const[busy,setBusy]=useState(false);
  const[reading,setReading]=useState(false);
  // A proposal read from a statement, held here until a person accepts it. The
  // platform never writes a balance straight from an extraction.
  const[proposal,setProposal]=useState(null);
  const[form,setForm]=useState(null);
  const fileRef=useRef(null);

  const rows=(history||[]).slice().sort((a,b)=>String(b.asOf||"").localeCompare(String(a.asOf||"")));
  const docById=id=>(documents||[]).find(d=>d.id===id)||null;

  const startManual=()=>{setProposal(null);setForm({asOf:todayISO(),balance:"",documentId:"",note:"",source:"manual"});};

  // Upload → file lands in CHRIS against this account → AI proposes figures.
  const handleFile=async(file)=>{
    if(!file)return;
    const ok=["application/pdf","image/png","image/jpeg","image/jpg","image/webp"];
    if(!ok.includes(file.type)){toast("Please choose a PDF, PNG, JPG or WebP file","error");if(fileRef.current)fileRef.current.value="";return;}
    if(file.size>15*1024*1024){toast("That file is over 15 MB","error");if(fileRef.current)fileRef.current.value="";return;}
    setReading(true);
    try{
      // Store it first. Even if the read fails the statement is filed, which is
      // the more important of the two outcomes.
      const path=`${family.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g,"_")}`;
      const{error:upErr}=await sb.storage.from("documents").upload(path,file,{upsert:false});
      if(upErr)throw new Error(upErr.message);
      const{data:docRow,error:docErr}=await sb.from("documents").insert({
        family_id:family.id,name:file.name,category:"Statements",
        account_id:account.id,file_path:path,file_type:file.type,file_size:file.size,
        uploaded_by:CURRENT_USER_LABEL||userProfile?.email||null,
      }).select("id").single();
      if(docErr)throw new Error(docErr.message);

      const base64=await new Promise((res,rej)=>{const r=new FileReader();
        r.onload=()=>res(String(r.result).split(",")[1]);
        r.onerror=()=>rej(new Error("Could not read that file"));r.readAsDataURL(file);});
      const mediaType=file.type==="image/jpg"?"image/jpeg":file.type;
      const{data:resp,error}=await sb.functions.invoke("extract-statement-fields",{body:{fileBase64:base64,mediaType,fileName:file.name}});
      reload("documents");

      if(error||resp?.error){
        // Filed but unread: say so, and let them type the figure.
        toast(`Statement filed. Could not read it automatically — enter the balance yourself.`,"error");
        setForm({asOf:todayISO(),balance:"",documentId:docRow.id,note:"",source:"manual"});
        return;
      }
      const f=resp?.fields||{};
      setProposal({...f,documentId:docRow.id,usable:!!resp?.usable,fileName:file.name});
      setForm({
        asOf:f.periodEnd||todayISO(),
        balance:f.closingBalance!=null?String(f.closingBalance):"",
        documentId:docRow.id,
        period:f.periodLabel||"",
        note:"",
        source:resp?.usable?"extracted":"manual",
      });
      toast(resp?.usable?"Statement filed and read — check the figures":"Statement filed. Some figures could not be read.");
    }catch(e){toast(e.message||"Upload failed","error");}
    finally{setReading(false);if(fileRef.current)fileRef.current.value="";}
  };

  const save=async()=>{
    if(!form.asOf){toast("An as-of date is required — a balance without one cannot be placed in time","error");return;}
    if(form.asOf>todayISO()){toast("The as-of date can't be in the future.","error");return;}
    const balText=String(form.balance==null?"":form.balance).replace(/[$,\s]/g,"");
    if(!/^-?\d+(\.\d{1,2})?$/.test(balText)){toast("Enter the balance as a number, like 125000.50","error");return;}
    const bal=Number(balText);
    setBusy(true);
    try{
      // Upsert on (account_id, as_of): a corrected statement for a period replaces
      // the earlier figure instead of sitting beside it.
      const{error}=await sb.from("account_balances").upsert({
        account_id:account.id,family_id:family.id,as_of:form.asOf,balance:bal,
        source_document_id:form.documentId||null,source:form.source||"manual",
        entered_by:CURRENT_USER_LABEL||userProfile?.email||null,
        note:form.note||null,
      },{onConflict:"account_id,as_of"});
      if(error)throw new Error(error.message);
      // Record the period label on the document, so CHRIS reads sensibly.
      if(form.documentId&&form.period){
        await sb.from("documents").update({account_period:form.period}).eq("id",form.documentId);
      }
      toast("Balance recorded");
      setForm(null);setProposal(null);
      reload("account_balances");reload("portfolio_accounts");reload("documents");
    }catch(e){toast(e.message,"error");}
    setBusy(false);
  };

  const removeEntry=async(row)=>{if(!confirm("Remove this balance entry? This can't be undone."))return;
    setBusy(true);
    try{
      const{error}=await sb.from("account_balances").delete().eq("id",row.id);
      if(error)throw new Error(error.message);
      toast("Entry removed. The account now reflects the next most recent figure.");
      reload("account_balances");reload("portfolio_accounts");
    }catch(e){toast(e.message,"error");}
    setBusy(false);
  };

  return <div style={{marginTop:12,borderTop:`1px solid ${B.borderLight}`,paddingTop:10}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{background:"none",border:"none",padding:0,cursor:"pointer",
        fontSize:11.5,fontWeight:700,color:B.navy,letterSpacing:"0.04em",textTransform:"uppercase",fontFamily:"inherit"}}>
        {open?"▾":"▸"} Balance history{rows.length?` · ${rows.length}`:""}
      </button>
      {canEdit&&<div style={{display:"flex",gap:7}}>
        <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style={{display:"none"}}
          onChange={e=>handleFile(e.target.files&&e.target.files[0])}/>
        <Btn small variant="ghost" onClick={()=>fileRef.current&&fileRef.current.click()} disabled={reading||busy}>
          {reading?"Reading…":"↑ Statement"}
        </Btn>
        <Btn small variant="ghost" onClick={startManual} disabled={busy}>+ Balance</Btn>
      </div>}
    </div>

    {/* What the statement appeared to say, next to what is on file. The Expert
        decides; nothing has been written to the balance record yet. */}
    {form&&<div style={{marginTop:10,background:B.bg,border:`1px solid ${B.border}`,borderRadius:10,padding:"12px 14px"}}>
      {proposal&&<div style={{fontSize:11,color:B.textSoft,marginBottom:9,lineHeight:1.5}}>
        Read from <strong>{proposal.fileName}</strong>
        {proposal.confidence?<span style={{marginLeft:6,fontSize:9.5,fontWeight:700,letterSpacing:0.4,padding:"1px 5px",borderRadius:4,
          background:proposal.confidence==="high"?"#e0f5e9":proposal.confidence==="medium"?"#FBF3E3":"#fdeaea",
          color:proposal.confidence==="high"?"#0d5c2b":proposal.confidence==="medium"?"#7A5A19":"#8b1a1a"}}>
          {String(proposal.confidence).toUpperCase()} CONFIDENCE</span>:null}
        {proposal.institution?<div style={{marginTop:4}}>Statement names {proposal.institution}{proposal.accountMask?` · ${proposal.accountMask}`:""}</div>:null}
        {proposal.notes?<div style={{marginTop:4,color:"#7A5A19"}}>{proposal.notes}</div>:null}
        {!proposal.usable?<div style={{marginTop:4,color:"#8b1a1a"}}>Not everything could be read — complete the fields below.</div>:null}
      </div>}
      <Grid2>
        <Field label="Balance" required><Inp inputMode="decimal" value={form.balance} onChange={e=>setForm(f=>({...f,balance:e.target.value}))} placeholder="0.00"/></Field>
        <Field label="As at" required><Inp type="date" max={todayISO()} value={form.asOf} onChange={e=>setForm(f=>({...f,asOf:e.target.value}))}/></Field>
      </Grid2>
      {form.documentId&&<Field label="Statement period as the firm labels it" optional>
        <Inp value={form.period||""} onChange={e=>setForm(f=>({...f,period:e.target.value}))} placeholder="2026-Q2"/>
      </Field>}
      <Field label="Note (optional)">
        <Inp value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))} placeholder="Anything a reader should know about this figure"/>
      </Field>
      {(()=>{
        const bal=Number(String(form.balance).replace(/[^0-9.\-]/g,""));
        const cur=Number(account.currentBalance)||0;
        if(!Number.isFinite(bal)||!cur||bal===cur)return null;
        const diff=bal-cur;
        return <div style={{fontSize:11.5,color:B.textSoft,marginBottom:10,lineHeight:1.5}}>
          On file now: <strong>{fmtMoney(cur)}</strong>{account.balanceAsOf?` as at ${fmt(account.balanceAsOf)}`:""} ·
          this entry is <strong style={{color:diff>=0?"#18a850":"#d43030"}}>{diff>=0?"+":"−"}{fmtMoney(Math.abs(diff))}</strong> against it
        </div>;
      })()}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <Btn small variant="ghost" onClick={()=>{setForm(null);setProposal(null);}} disabled={busy}>Cancel</Btn>
        <Btn small variant="gold" onClick={save} disabled={busy}>{busy?"Saving…":"Record balance"}</Btn>
      </div>
    </div>}

    {open&&<div style={{marginTop:10}}>
      {rows.length===0
        ? <div style={{fontSize:11.5,color:B.textMute,lineHeight:1.5}}>
            No dated balances yet. The figure shown above came from the account record rather than a statement — record one to give it a date and a source.
          </div>
        : rows.map((r,i)=>{
            const prev=rows[i+1];
            const diff=prev?(Number(r.balance)||0)-(Number(prev.balance)||0):null;
            const doc=docById(r.sourceDocumentId);
            return <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,
              padding:"7px 0",borderBottom:`1px solid ${B.borderLight}`}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:12.5,color:B.text,fontWeight:600}}>
                  {fmtMoney(r.balance)}
                  {diff!==null&&<span style={{marginLeft:7,fontSize:11,fontWeight:700,color:diff>=0?"#18a850":"#d43030"}}>
                    {diff>=0?"+":"−"}{fmtMoney(Math.abs(diff))}</span>}
                </div>
                <div style={{fontSize:11,color:B.textSoft,marginTop:2}}>
                  as at {fmt(r.asOf)}
                  {doc?<> · <DocLink doc={doc} toast={toast} label={doc.accountPeriod||doc.name}/></>
                       :<span style={{color:B.textMute}}> · no statement on file</span>}
                </div>
                {r.note?<div style={{fontSize:10.5,color:B.textMute,marginTop:2}}>{r.note}</div>:null}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:7,flexShrink:0}}>
                <span title={r.source==="extracted"?"Read from a statement and confirmed by a person":r.source==="opening"?"Opening figure":"Entered by hand"}
                  style={{fontSize:9,fontWeight:700,letterSpacing:0.4,padding:"1px 5px",borderRadius:4,
                    background:r.source==="extracted"?"#e8f0f8":r.source==="opening"?"#f1f1ee":"#eef0f4",
                    color:r.source==="extracted"?"#293d5c":"#4a5568"}}>
                  {r.source==="extracted"?"READ":r.source==="opening"?"OPENING":"MANUAL"}
                </span>
                {r.enteredBy?<span style={{fontSize:10,color:B.textMute}}>{r.enteredBy}</span>:null}
                {canEdit&&<button onClick={()=>removeEntry(r)} disabled={busy} title="Remove this entry"
                  style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:12}}>✕</button>}
              </div>
            </div>;
          })}
    </div>}
  </div>;
}
// Opening a private household (phase 3): staff named on it enter a fresh two-step code first, and the
// opening is logged (private_household_open checks the code is under 5 minutes old). The household stays
// open while it is on screen and asks again next time. Ordinary households pass straight through.
// The database rule (phase 1) is what keeps everyone else out; this is the extra gate for those allowed in.
function PrivateGate({familyId,onBack,children}){
  const[state,setState]=useState("checking"); // checking | open | locked
  const[code,setCode]=useState("");
  const[err,setErr]=useState("");
  const[busy,setBusy]=useState(false);
  useEffect(()=>{
    let stop=false;setState("checking");setCode("");setErr("");
    sb.rpc("private_household_check",{p_family_id:familyId}).then(({data,error})=>{
      if(stop)return;
      // Missing function (not on this database yet) or not private: nothing to gate.
      setState(!error&&data===true?"locked":"open");
    });
    return()=>{stop=true;};
  },[familyId]);
  const unlock=async e=>{
    e?.preventDefault?.();
    if(code.length!==6)return;
    setBusy(true);setErr("");
    try{
      const st=await mfaStatus();
      const f=st.verified[0];
      if(!f){setErr("Set up two-step sign-in first (Security), then try again.");return;}
      const{error:v}=await sb.auth.mfa.challengeAndVerify({factorId:f.id,code});
      if(v){setErr(mfaCodeMessage(v));setCode("");return;}
      const{error:o}=await sb.rpc("private_household_open",{p_family_id:familyId});
      if(o){setErr(o.message);setCode("");return;}
      setState("open");
    }catch(x){setErr(x?.message||"Something went wrong. Please try again.");}
    finally{setBusy(false);}
  };
  if(state==="open")return children;
  if(state==="checking")return <div style={{padding:40}}><Spinner/></div>;
  return <div style={{display:"flex",justifyContent:"center",padding:"48px 16px"}}>
    <form onSubmit={unlock} style={{...MFA_CARD,textAlign:"left"}}>
      <div style={{fontSize:30,marginBottom:6}}>🔒</div>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:6}}>Private household</div>
      <div style={{fontSize:13,color:B.textSoft,marginBottom:16,lineHeight:1.5}}>Enter the 6-digit code from your authenticator app to open it. Each opening is logged.</div>
      {err&&<div style={MFA_ERR}>{err}</div>}
      <MfaCodeInput value={code} onChange={setCode} autoFocus/>
      <Btn onClick={unlock} disabled={busy||code.length!==6}>{busy?"Checking…":"Open household"}</Btn>
      {onBack&&<button type="button" onClick={onBack} style={{display:"block",margin:"14px auto 0",background:"none",border:"none",color:B.textSoft,fontSize:12,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>Back</button>}
    </form>
  </div>;
}

// Onboarding Specialist (migration 20261022140000): an admin names an Expert or Analyst who may open and edit this
// household for 30 days to help set it up. Day 30: the admin who named them and the specialist are emailed
// (onboarding-notices); an admin can extend 30 days or end it here. A specialist sees only their own line.
function OnboardingSpecialistPanel({familyRow,userProfile,toast}){
  const isAdmin=userProfile?.role==="admin";
  const[rows,setRows]=useState(null);
  const[staff,setStaff]=useState([]);
  const[pick,setPick]=useState("");
  const[busy,setBusy]=useState("");
  const load=useCallback(async()=>{
    const{data,error}=await sb.rpc("onboarding_specialist_list",{p_family_id:familyRow.id});
    if(error&&(error.code==="PGRST202"||/could not find the function|does not exist/i.test(error.message||""))){setRows("unavailable");return;}
    setRows(error?[]:(data||[]));
  },[familyRow.id]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{
    if(!isAdmin)return;
    sb.from("user_profiles").select("id,full_name,email,role,active").in("role",["admin","advisor","analyst"]).order("full_name")
      .then(({data})=>setStaff((data||[]).filter(u=>u.active!==false)));
  },[isAdmin]);
  const call=async(key,fn,args,ok)=>{
    setBusy(key);
    const{error}=await sb.rpc(fn,args);
    setBusy("");
    if(error){toast(error.message,"error");return;}
    toast(ok);setPick("");load();
  };
  if(rows==="unavailable"||rows===null)return null;
  const live=rows.filter(r=>r.live);
  const lapsed=rows.filter(r=>!r.live&&!r.ended_at);
  if(!isAdmin&&!live.length)return null;
  const day=v=>new Date(v).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
  const daysLeft=v=>Math.max(0,Math.ceil((new Date(v)-new Date())/86400000));
  const liveIds=new Set(live.map(r=>r.staff_id));
  return <div style={{background:B.white,borderRadius:12,padding:20,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,marginBottom:20}}>
    <div style={{fontSize:10,fontWeight:800,color:B.textMute,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>Onboarding Specialist</div>
    {!isAdmin&&live.map(r=><div key={r.id} style={{fontSize:13,color:B.navy,lineHeight:1.55}}>You're helping set up this household until <strong>{day(r.expires_at)}</strong> ({daysLeft(r.expires_at)} day{daysLeft(r.expires_at)===1?"":"s"} left). Ask an admin if you need more time.</div>)}
    {isAdmin&&<>
      {live.length===0&&lapsed.length===0&&<div style={{fontSize:12.5,color:B.textSoft,marginBottom:10}}>No one is helping set up this household. Name an Expert or Analyst to give them 30 days to add vendors, properties and the rest, without making them its Expert.</div>}
      {[...live,...lapsed].map(r=><div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",padding:"8px 0",borderBottom:`1px solid ${B.borderLight}`}}>
        <div style={{fontSize:13,color:B.navy,minWidth:0}}><strong>{r.staff_name}</strong> <span style={{color:B.textSoft}}>· {r.staff_role==="analyst"?"Analyst":r.staff_role==="admin"?"Admin":"Expert"}</span>
          <div style={{fontSize:11.5,color:r.live?(daysLeft(r.expires_at)<=5?"#8a5c00":B.textMute):"#8b1a1a"}}>
            {r.live?`Until ${day(r.expires_at)} · ${daysLeft(r.expires_at)} day${daysLeft(r.expires_at)===1?"":"s"} left`:`Access ended ${day(r.expires_at)}`}
            {r.extended_count>0?` · extended ${r.extended_count}×`:""}{r.assigned_by_name?` · named by ${r.assigned_by_name}`:""}</div></div>
        <div style={{display:"flex",gap:8}}>
          <Btn small disabled={!!busy} onClick={()=>call("x"+r.id,"onboarding_specialist_extend",{p_id:r.id},"Extended 30 days")}>{busy==="x"+r.id?"Extending…":"Extend 30 days"}</Btn>
          <Btn small variant="ghost" disabled={!!busy} onClick={()=>{if(confirm(`End ${r.staff_name}'s onboarding access to ${familyRow.name}?`))call("e"+r.id,"onboarding_specialist_end",{p_id:r.id},"Onboarding access ended");}}>End</Btn>
        </div>
      </div>)}
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:12}}>
        <Sel value={pick} onChange={e=>setPick(e.target.value)} style={{flex:"1 1 220px"}}>
          <option value="">Name an Onboarding Specialist…</option>
          {staff.filter(u=>!liveIds.has(u.id)).map(u=><option key={u.id} value={u.id}>{u.full_name||u.email} ({u.role==="analyst"?"Analyst":u.role==="admin"?"Admin":"Expert"})</option>)}
        </Sel>
        <Btn small disabled={!pick||!!busy} onClick={()=>call("a","onboarding_specialist_assign",{p_family_id:familyRow.id,p_staff_id:pick},"Onboarding Specialist named for 30 days")}>{busy==="a"?"Saving…":"Give 30 days"}</Btn>
      </div>
      <div style={{fontSize:11,color:B.textMute,marginTop:8,lineHeight:1.5}}>On day 30 you and the specialist get an email. Access ends by itself unless you extend it. Everything is recorded in the access log.</div>
    </>}
  </div>;
}

function InviteClientCard({familyRow,toast,isMobile}){
  const[logins,setLogins]=useState(null);
  const[open,setOpen]=useState(false);
  const[f,setF]=useState({name:"",email:"",phone:"",card:true});
  const[busy,setBusy]=useState(false);
  const firmPaid=familyRow.paidBy==="enterprise"||familyRow.paid_by==="enterprise";
  const hasSub=!!familyRow.stripe_subscription_id;
  const[resending,setResending]=useState("");
  const load=useCallback(async()=>{
    // From the server so each login's status (invited, opened, last signed in) is known; falls back to the profiles.
    const{data:resp}=await sb.functions.invoke("invite-client",{body:{action:"list",family_id:familyRow.id}});
    if(resp?.success){setLogins(resp.logins||[]);return;}
    const{data}=await sb.from("user_profiles").select("id,full_name,email,active").eq("family_id",familyRow.id).eq("role","client");
    setLogins(data||[]);
  },[familyRow.id]);
  const resend=async u=>{
    setResending(u.id);
    const{data:resp,error}=await sb.functions.invoke("invite-client",{body:{action:"resend",family_id:familyRow.id,user_id:u.id,redirect_to:window.location.origin}});
    setResending("");
    if(error||!resp?.success){
      let msg=resp?.error||error?.message||"The email could not be sent";
      try{const b=await error?.context?.json?.();if(b?.error)msg=b.error;}catch(_e){}
      toast(msg,"error");return;
    }
    toast(resp.sent==="invite"?`Invite resent to ${resp.email}`:`Email sent to ${resp.email} to set a new password`);
  };
  const shortDate=v=>v?new Date(v).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"";
  const statusText=u=>u.active===false?"deactivated":u.last_sign_in_at?`last signed in ${shortDate(u.last_sign_in_at)}`
    :u.opened_at?"opened the invite":u.invited_at?`invited ${shortDate(u.invited_at)}, not opened yet`:"";
  useEffect(()=>{load();},[load]);
  const valid=f.name.trim().length>1&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())&&String(f.phone).trim()&&isValidPhone(f.phone);
  const send=async()=>{
    setBusy(true);
    const{data:resp,error}=await sb.functions.invoke("invite-client",{body:{family_id:familyRow.id,full_name:f.name.trim(),email:f.email.trim(),phone:f.phone,
      pays_by_card:!firmPaid&&!hasSub&&f.card,redirect_to:window.location.origin}});
    setBusy(false);
    if(error||!resp?.success){
      let msg=resp?.error||error?.message||"The invite could not be sent";
      try{const b=await error?.context?.json?.();if(b?.error)msg=b.error;}catch(_e){}
      toast(msg,"error");return;
    }
    toast(`Invite sent to ${resp.invited}${resp.pays_by_card?". They'll be asked to add a card when they sign in.":""}`);
    if(resp.note)toast(resp.note,"error");
    setF({name:"",email:"",phone:"",card:true});setOpen(false);load();
  };
  return <div style={{background:B.white,borderRadius:12,padding:20,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,marginBottom:20}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}>
      <div style={{fontSize:10,fontWeight:800,color:B.textMute,letterSpacing:"0.12em",textTransform:"uppercase"}}>Family logins</div>
      {!open&&<Btn small onClick={()=>setOpen(true)}>Invite family</Btn>}
    </div>
    {logins===null?<div style={{fontSize:12.5,color:B.textMute}}>Loading…</div>
      :logins.length===0?<div style={{fontSize:12.5,color:B.textSoft}}>No family login yet. Invite the family so they can sign in and see their household.</div>
      :<div style={{display:"flex",flexDirection:"column",gap:8}}>{logins.map(u=><div key={u.id} style={{fontSize:13,color:B.navy,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <span style={{minWidth:0}}><strong>{u.full_name||u.email}</strong>{u.full_name?<span style={{color:B.textSoft}}> · {u.email}</span>:null}
          {statusText(u)&&<span style={{display:"block",fontSize:11.5,color:u.opened_at||u.last_sign_in_at?B.textMute:"#8a5c00"}}>{statusText(u)}</span>}</span>
        {u.active!==false&&<button onClick={()=>resend(u)} disabled={resending===u.id} style={{background:"none",border:`1px solid ${B.border}`,color:B.navy,borderRadius:6,padding:"4px 10px",fontSize:11.5,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
          {resending===u.id?"Sending…":(u.opened_at||u.last_sign_in_at)?"Send password reset":"Resend invite"}</button>}
      </div>)}</div>}
    {familyRow.billing_setup_required&&!hasSub&&<div style={{fontSize:12,color:"#8a5c00",marginTop:8}}>Waiting for the client to add a card.</div>}
    {open&&<div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${B.borderLight}`}}>
      <div style={{fontSize:12.5,color:B.textSoft,lineHeight:1.55,marginBottom:12}}>They get an email invite and set their own password. Nobody else ever sees it.</div>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:"0 14px"}}>
        <Field label="Name"><Inp value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Jordan Smith"/></Field>
        <Field label="Email"><Inp type="email" autoComplete="off" value={f.email} onChange={e=>setF({...f,email:e.target.value})} placeholder="jordan@example.com"/></Field>
        <Field label="Phone" required><Inp value={f.phone} onChange={e=>setF({...f,phone:formatPhoneInput(e.target.value)})} placeholder="(555) 123-4567"/></Field>
      </div>
      {firmPaid?<div style={{fontSize:12,color:B.textSoft,marginBottom:12}}>This household's plan is paid by its firm, so the family won't be asked for a card.</div>
        :hasSub?<div style={{fontSize:12,color:B.textSoft,marginBottom:12}}>This household already has a card subscription.</div>
        :<label style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:12.5,color:B.text,cursor:"pointer",marginBottom:12}}>
          <input type="checkbox" checked={f.card} onChange={e=>setF({...f,card:e.target.checked})} style={{marginTop:2}}/>
          <span>The family pays by card. They'll be asked to add one when they sign in (promotion codes work there). Untick for a complimentary or staff-run household.</span>
        </label>}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn variant="ghost" onClick={()=>setOpen(false)} disabled={busy}>Cancel</Btn>
        <Btn onClick={send} disabled={busy||!valid}>{busy?"Sending…":"Send invite"}</Btn>
      </div>
    </div>}
  </div>;
}

function PrivateHouseholdPanel({familyId,familyName,toast,isMobile}){
  const[st,setSt]=useState(null);
  const[err,setErr]=useState("");
  const[staff,setStaff]=useState([]);
  const[editing,setEditing]=useState(false);
  const[picked,setPicked]=useState([]);
  const[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    const{data,error}=await sb.rpc("household_privacy_status",{p_family_id:familyId});
    // Not on this database yet (the migration has not been applied): show nothing rather than an error.
    if(error&&(error.code==="PGRST202"||/could not find the function|does not exist/i.test(error.message||""))){setSt("unavailable");return;}
    if(error){setErr(error.message);return;}
    setSt(data);setPicked((data.viewers||[]).map(v=>v.id));
  },[familyId]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{
    if(!editing||staff.length)return;
    // Active staff only: a deactivated login can't be named (the database refuses it too).
    sb.from("user_profiles").select("id,full_name,email,role,active").in("role",["admin","advisor","analyst"]).neq("active",false).order("full_name")
      .then(({data})=>setStaff(data||[]));
  },[editing,staff.length]);
  const save=async makePrivate=>{
    if(!makePrivate&&!confirm(`Make ${familyName} an ordinary household again? Every admin, its Expert and its firm will be able to see it.`))return;
    setBusy(true);setErr("");
    const{data,error}=await sb.rpc("household_privacy_set",{p_family_id:familyId,p_private:makePrivate,p_viewers:makePrivate?picked:null});
    setBusy(false);
    if(error){setErr(/two-step/i.test(error.message)?"Sign out and sign in again with your two-step code, then try again.":error.message);return;}
    setSt(data);setPicked((data.viewers||[]).map(v=>v.id));setEditing(false);
    toast&&toast(makePrivate?"Private household saved":"No longer private");
  };
  const roleWord=r=>r==="advisor"?"ORDANIS Expert":r==="analyst"?"Analyst":"Admin";
  const[log,setLog]=useState(null);
  const loadLog=async()=>{const{data,error}=await sb.rpc("private_household_access_log",{p_family_id:familyId,p_limit:30});setLog(error?[]:(data||[]));};
  if(st==="unavailable")return null;
  const box={background:B.bgCard,borderRadius:12,padding:isMobile?"18px 16px":"20px 22px",border:`1px solid ${st&&st.is_private?"#c9b37a":B.borderLight}`,boxShadow:B.shadow,marginBottom:16};
  return <div style={box}>
    <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>🔒 Private household</div>
    {err&&<div style={{fontSize:12.5,color:"#8b1a1a",marginBottom:10}}>{err}</div>}
    {!st?<div style={{fontSize:12.5,color:B.textSoft}}>Loading…</div>:<>
      <div style={{fontSize:13,color:B.text,lineHeight:1.55,marginBottom:12}}>
        {st.is_private
          ?<>Only the household itself and the people below can see <strong>{familyName}</strong>. Everyone else on staff, including other admins, Experts and its firm, sees nothing.</>
          :<>Make this household visible only to people you choose, for clients who want no other eyes on their records. The household itself always keeps its access.</>}
      </div>
      {st.is_private&&!editing&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
        {(st.viewers||[]).map(v=><span key={v.id} style={{fontSize:12,background:B.white,border:`1px solid ${B.border}`,borderRadius:20,padding:"4px 10px",color:B.navy}}>{v.name} · {roleWord(v.role)}</span>)}
      </div>}
      {editing&&<div style={{marginBottom:12}}>
        <div style={{fontSize:12,color:B.textSoft,marginBottom:8}}>Who can see it (you are always included):</div>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:220,overflowY:"auto"}}>
          {staff.map(u=><label key={u.id} style={{display:"flex",alignItems:"center",gap:10,fontSize:13,color:B.text,cursor:"pointer"}}>
            <input type="checkbox" checked={picked.includes(u.id)} onChange={e=>setPicked(p=>e.target.checked?[...p,u.id]:p.filter(x=>x!==u.id))} style={{width:16,height:16,accentColor:B.navy}}/>
            {u.full_name||u.email} <span style={{color:B.textMute,fontSize:11.5}}>· {roleWord(u.role)}</span>
          </label>)}
        </div>
      </div>}
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        {!editing&&!st.is_private&&<Btn small onClick={()=>setEditing(true)}>Make private…</Btn>}
        {!editing&&st.is_private&&<Btn small variant="ghost" onClick={()=>setEditing(true)}>Change who can see it</Btn>}
        {!editing&&st.is_private&&<Btn small variant="ghost" disabled={busy} onClick={()=>save(false)}>Make ordinary again</Btn>}
        {editing&&<Btn small disabled={busy} onClick={()=>save(true)}>{busy?"Saving…":st.is_private?"Save":"Make private"}</Btn>}
        {editing&&<Btn small variant="ghost" disabled={busy} onClick={()=>{setEditing(false);setPicked((st.viewers||[]).map(v=>v.id));}}>Cancel</Btn>}
        {!editing&&st.is_private&&<Btn small variant="ghost" onClick={()=>log?setLog(null):loadLog()}>{log?"Hide access log":"Access log"}</Btn>}
      </div>
      {log&&<div style={{marginTop:12,borderTop:`1px solid ${B.borderLight}`,paddingTop:10,maxHeight:240,overflowY:"auto"}}>
        {log.length===0?<div style={{fontSize:12,color:B.textMute}}>No entries yet.</div>:log.map((r,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12,padding:"5px 0",borderBottom:`1px solid ${B.borderLight}`}}>
          <span style={{color:B.text}}><strong>{r.who}</strong> · {r.action}</span>
          <span style={{color:B.textMute,whiteSpace:"nowrap"}}>{new Date(r.at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</span>
        </div>)}
      </div>}
    </>}
  </div>;
}

// ── FAMILY REPORT ─────────────────────────────────────────────────────────────
function FamilyReport({family,data,onClose}){
  const contacts=data.contacts.filter(c=>c.familyId===family.id);
  const properties=data.properties.filter(p=>p.familyId===family.id);
  // Providers this family can be billed by, for the vendor picker on an expense line.
  const vendorOptions=buildVendorOptions(data,family.id);
  const deals=data.deals.filter(d=>d.familyId===family.id);
  const tasks=data.tasks.filter(t=>t.familyId===family.id&&!t.done);
  const notes=data.notes.filter(n=>n.familyId===family.id);
  const accounts=(data.portfolio_accounts||[]).filter(a=>a.familyId===family.id);
  const valuables=(data.valuables||[]).filter(v=>v.familyId===family.id);
  const loans=(data.loans||[]).filter(l=>l.familyId===family.id);
  const totalPortfolio=properties.reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0);
  const totalDebt=properties.reduce((s,p)=>s+(Number(p.loanBalance)||0)+(Number(p.secondMortgageBalance)||0),0)+accounts.filter(a=>a.accountType==="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0)+loansDebt(loans);
  const totalAccounts=accounts.filter(a=>a.accountType!=="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const totalValuables=valuables.reduce((s,v)=>s+(Number(v.estimatedValue)||0),0);

  const print=()=>{
    const w=window.open("","_blank");
    w.document.write(`<!DOCTYPE html><html><head><title> </title>
    <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Georgia,serif;color:${B.navy};background:#fff;padding:40px;font-size:13px;line-height:1.6;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid ${B.gold};}
    .logo{font-size:26px;font-weight:700;color:${B.navy};}
    .logo-sub{font-size:9px;letter-spacing:.18em;color:#8fa0b2;margin-top:3px;}
    .logo-img{height:120px;width:auto;display:block;}
    h1{font-size:22px;font-weight:700;margin-bottom:2px;}
    .advisor{font-size:12px;color:#5a6e84;margin-top:4px;}
    .date{font-size:11px;color:#8fa0b2;margin-top:2px;}
    h2{font-size:14px;font-weight:800;color:${B.navy};margin:20px 0 8px;padding-bottom:4px;border-bottom:1px solid ${B.gold};letter-spacing:.06em;text-transform:uppercase;}
    table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:12px;}
    th{background:${B.navy};color:${B.gold};padding:6px 10px;text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase;}
    td{padding:6px 10px;border-bottom:1px solid #ede8de;color:#293d5c;vertical-align:top;}
    tr:nth-child(even) td{background:${B.bg};}
    .stats{display:flex;gap:16px;margin-bottom:20px;}
    .stat{background:${B.bg};border-radius:8px;padding:12px 16px;flex:1;border-top:2px solid ${B.gold};}
    .stat-l{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#8fa0b2;margin-bottom:4px;}
    .stat-v{font-size:18px;font-weight:700;color:${B.navy};}
    .note{padding:8px 0;border-bottom:1px solid #ede8de;}
    .note-date{font-size:10px;color:#8fa0b2;margin-top:2px;}
    .footer{margin-top:40px;padding-top:14px;border-top:2px solid ${B.gold};display:flex;justify-content:space-between;align-items:center;position:fixed;bottom:20px;left:40px;right:40px;}
    .footer-l{font-size:10px;color:#8fa0b2;line-height:1.6;}
    .footer-c{font-size:11px;font-weight:800;color:${B.navy};letter-spacing:0.12em;text-transform:uppercase;text-align:right;}
    @media print{body{padding:20px;}}
    </style></head><body>
    <div class="header">
      <div><img src="${BRAND.logo}" alt="${BRAND.name}" class="logo-img"/></div>
      <div style="text-align:right"><h1>${escHtml(family.name)}</h1><div class="advisor">ORDANIS Expert: ${escHtml(family.advisorName||"—")} | ${escHtml(family.advisorEmail||"")}</div><div class="date">${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-l">Real Estate Value</div><div class="stat-v">${fmtMoney(totalPortfolio)}</div></div>
      <div class="stat"><div class="stat-l">Total Debt</div><div class="stat-v">${fmtMoney(totalDebt)}</div></div>
      <div class="stat"><div class="stat-l">Portfolio Value</div><div class="stat-v">${fmtMoney(totalAccounts)}</div></div>
      <div class="stat"><div class="stat-l">Valuables</div><div class="stat-v">${fmtMoney(totalValuables)}</div></div>
    </div>
    <h2>Contacts & Members</h2>
    <table><thead><tr><th>Name</th><th>Type</th><th>Email</th><th>Phone</th></tr></thead><tbody>
    ${contacts.map(c=>`<tr><td>${escHtml(c.name)}</td><td>${escHtml(c.type)}</td><td>${escHtml(c.email||"—")}</td><td>${escHtml(c.phone||"—")}</td></tr>`).join("")||"<tr><td colspan='4' style='color:#8fa0b2'>No contacts</td></tr>"}
    </tbody></table>
    <h2>Properties</h2>
    ${properties.map(p=>`<table style="margin-bottom:14px"><thead><tr><th colspan="4">${escHtml(p.address)}${p.ownerName?` — ${escHtml(p.ownerName)}`:""}</th></tr></thead><tbody>
    <tr><td><b>Type</b></td><td>${escHtml(p.propertyType)}</td><td><b>Purchase Price</b></td><td>${fmtMoney(p.purchasePrice)}</td></tr>
    <tr><td><b>Current Value</b></td><td>${fmtMoney(p.currentValue)}</td><td><b>Purchase Date</b></td><td>${fmt(p.purchaseDate)}</td></tr>
    <tr><td><b>Lender</b></td><td>${escHtml(p.lender||"—")}</td><td><b>Loan Type</b></td><td>${escHtml(p.loanType)}</td></tr>
    <tr><td><b>Loan Balance</b></td><td>${fmtMoney(p.loanBalance)}</td><td><b>Interest Rate</b></td><td>${fmtPct(p.interestRate)}</td></tr>
    <tr><td><b>Monthly Payment</b></td><td>${fmtMoney(p.loanPayment)}</td><td><b>Loan Maturity</b></td><td>${fmt(p.loanMaturityDate)}</td></tr>
    ${Number(p.secondMortgageBalance)>0?`<tr><td><b>2nd Mortgage</b></td><td>${fmtMoney(p.secondMortgageBalance)}</td><td><b>2nd Mtg Payment</b></td><td>${p.secondMortgagePayment?`${fmtMoney(p.secondMortgagePayment)}/mo`:"—"}</td></tr>`:""}
    <tr><td><b>Rental Income</b></td><td>${fmtMoney(p.rentalIncome)}/mo</td><td><b>Property Taxes</b></td><td>${fmtMoney(p.propertyTaxes)}/yr</td></tr>
    <tr><td><b>Insurance</b></td><td>${escHtml(p.insuranceCompany||"—")}</td><td><b>Flood Insurance</b></td><td>${p.floodInsurance?"Yes":"No"}</td></tr>
    </tbody></table>`).join("")||"<p style='color:#8fa0b2;margin-bottom:12px'>No properties</p>"}
    <h2>Portfolio Accounts</h2>
    <table><thead><tr><th>Institution</th><th>Type</th><th>Banker</th><th>Starting</th><th>Current</th><th>Change</th></tr></thead><tbody>
    ${accounts.map(a=>{const pct=pctChange(a.startingBalance,a.currentBalance);return`<tr><td>${escHtml(a.institution)}</td><td>${escHtml(a.accountType)}</td><td>${escHtml(a.bankerName||"—")}</td><td>${fmtMoney(a.startingBalance)}</td><td>${fmtMoney(a.currentBalance)}</td><td style="color:${Number(pct)>=0?"#18a850":"#d43030"};font-weight:700">${pct!==null?(Number(pct)>=0?"+":"")+pct+"%":"—"}</td></tr>`;}).join("")||"<tr><td colspan='6' style='color:#8fa0b2'>No accounts</td></tr>"}
    </tbody></table>
    <h2>Loans & Lines of Credit</h2>
    <table><thead><tr><th>Loan</th><th>Type</th><th>Lender</th><th>Balance</th><th>Limit</th><th>Rate</th><th>Payment</th><th>Matures</th></tr></thead><tbody>
    ${loans.map(l=>`<tr><td>${escHtml(loanTitle(l))}</td><td>${escHtml(l.loanType)}</td><td>${escHtml(l.lender||"—")}</td><td>${fmtMoney(l.currentBalance)}</td><td>${l.creditLimit!=null&&l.creditLimit!==""?fmtMoney(l.creditLimit):"—"}</td><td>${fmtPct(l.interestRate)}</td><td>${l.paymentAmount!=null&&l.paymentAmount!==""?`${fmtMoney(l.paymentAmount)} ${escHtml((l.paymentFrequency||"").toLowerCase())}`:"—"}</td><td>${fmt(l.maturityDate)}</td></tr>`).join("")||"<tr><td colspan='8' style='color:#8fa0b2'>No loans or lines on file</td></tr>"}
    </tbody></table>
    <h2>Valuables</h2>
    <table><thead><tr><th>Category</th><th>Description</th><th>Year</th><th>Est. Value</th><th>Insured</th></tr></thead><tbody>
    ${valuables.map(v=>`<tr><td>${escHtml(v.category)}</td><td>${escHtml(v.description)}</td><td>${escHtml(v.year||"—")}</td><td>${fmtMoney(v.estimatedValue)}</td><td>${v.insured?"Yes":"No"}</td></tr>`).join("")||"<tr><td colspan='5' style='color:#8fa0b2'>No valuables</td></tr>"}
    </tbody></table>
    <h2>Open Deals</h2>
    <table><thead><tr><th>Deal</th><th>Stage</th><th>Value</th><th>Close Date</th></tr></thead><tbody>
    ${deals.filter(d=>d.stage!=="Closed Lost"&&d.stage!=="Closed Won").map(d=>`<tr><td>${escHtml(d.title)}</td><td>${escHtml(d.stage)}</td><td>${fmtMoney(d.value)}</td><td>${fmt(d.closeDate)}</td></tr>`).join("")||"<tr><td colspan='4' style='color:#8fa0b2'>No open deals</td></tr>"}
    </tbody></table>
    <h2>Pending Tasks & Deadlines</h2>
    <table><thead><tr><th>Task</th><th>Priority</th><th>Due Date</th><th>Reminder</th></tr></thead><tbody>
    ${tasks.sort((a,b)=>a.dueDate>b.dueDate?1:-1).map(t=>`<tr><td>${escHtml(t.title)}</td><td>${escHtml(t.priority)}</td><td>${fmt(t.dueDate)}</td><td>${t.reminderDays?t.reminderDays+" days before":"—"}</td></tr>`).join("")||"<tr><td colspan='4' style='color:#8fa0b2'>No pending tasks</td></tr>"}
    </tbody></table>
    <h2>Activity Notes</h2>
    ${notes.slice(0,10).map(n=>`<div class="note"><div>${escHtml(n.body)}</div><div class="note-date">${fmt(n.createdAt)}</div></div>`).join("")||"<p style='color:#8fa0b2'>No notes</p>"}
    </body></html>`);
    w.document.close();w.focus();setTimeout(()=>w.print(),400);
  };

  return <Modal title={`Report — ${family.name}`} onClose={onClose} wide>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(140px,100%),1fr))",gap:12,marginBottom:24}}>
      {[{l:"Properties",v:properties.length},{l:"Real Estate",v:fmtMoney(totalPortfolio)},{l:"Portfolio",v:fmtMoney(totalAccounts)},{l:"Open Tasks",v:tasks.length}].map(s=><StatBox key={s.l} label={s.l} value={s.v}/>)}
    </div>
    <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn variant="gold" onClick={print}>🖨 Print Report</Btn>
    </div>
  </Modal>;
}

// Show a render error instead of a blank screen.
//
// There was no error boundary anywhere in the app. When a view threw during render, React
// unmounted the tree and the user got an empty panel with no explanation — the failure
// mode reported as "I click a family and nothing comes up". The only evidence was a
// console message the person seeing the problem was never going to open.
//
// This does not prevent the crash. It makes the crash legible: the message, where it
// happened, and a way back. A blank screen is the least debuggable outcome there is, and
// on a client-facing platform it is also the least trustworthy.
class ViewErrorBoundary extends Component {
  constructor(props){ super(props); this.state={err:null,info:null}; }
  static getDerivedStateFromError(err){ return {err}; }
  componentDidCatch(err,info){
    this.setState({info});
    // Keep the console trace too — it has the component stack, which the panel truncates.
    console.error(`[${this.props.label||"view"}] render failed:`, err, info?.componentStack);
  }
  render(){
    if(!this.state.err) return this.props.children;
    const msg=String(this.state.err?.message||this.state.err);
    const where=String(this.state.info?.componentStack||"").trim().split("\n").slice(0,4).join("\n");
    return <div style={{padding:24,maxWidth:820,margin:"0 auto"}}>
      <div style={{background:"#fff5f5",border:"1px solid #f3c2c2",borderTop:"3px solid #b93a3a",
          borderRadius:12,padding:20}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:19,color:"#8b1a1a",fontWeight:600}}>
          This screen didn’t load</div>
        <div style={{fontSize:12.5,color:"#7a3030",marginTop:6,lineHeight:1.5}}>
          Something in {this.props.label||"this view"} failed while rendering. Nothing was saved or
          changed. The details below are what an engineer needs — copy them as they are.
        </div>
        <pre style={{marginTop:14,padding:"10px 12px",background:"#fff",border:"1px solid #f0d4d4",
            borderRadius:8,fontSize:11.5,color:"#5a2020",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
{msg}{where?"\n\n"+where:""}</pre>
        <div style={{display:"flex",gap:10,marginTop:14,flexWrap:"wrap"}}>
          <button onClick={()=>{
              navigator.clipboard?.writeText(msg+(where?"\n\n"+where:""));
            }} style={{background:"#fff",color:"#8b1a1a",border:"1px solid #d99",borderRadius:8,
              padding:"9px 16px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            Copy details</button>
          {this.props.onBack&&<button onClick={this.props.onBack}
            style={{background:"#8b1a1a",color:"#fff",border:"none",borderRadius:8,
              padding:"9px 16px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            Go back</button>}
        </div>
      </div>
    </div>;
  }
}

// Client Activity (migration 20261029100000): what the family's own logins added, changed or removed, newest first.
// Only admins and the household's Expert / Analyst / Onboarding Specialist can read it; field names only, no values.
const ACTIVITY_KIND={properties:"Property",portfolio_accounts:"Account",account_balances:"Account balance",valuables:"Valuable",
  loans:"Loan or line",cash_flow_events:"Cash flow event",cash_flow_payment_log:"Bill payment",contacts:"Family member",
  family_contacts:"Contact",property_contacts:"Property vendor",entities:"Entity",entity_members:"Entity member",deals:"Deal",
  tasks:"Task",notes:"Note",obligations:"Obligation",documents:"Document",document_folders:"Document folder"};
const activityField=k=>String(k).replace(/_id$/,"").replace(/_/g," ");
function ClientActivityPanel({familyId,toast}){
  const[rows,setRows]=useState(null);
  const[limit,setLimit]=useState(100);
  useEffect(()=>{let live=true;
    sb.from("household_activity").select("id,actor_name,actor_email,table_name,action,record_label,fields,created_at")
      .eq("family_id",familyId).order("created_at",{ascending:false}).limit(limit)
      .then(({data,error})=>{if(!live)return;if(error){toast&&toast(error.message||"Could not load client activity","error");setRows([]);}else setRows(data||[]);});
    return()=>{live=false;};
  },[familyId,limit]);
  const color={added:"#2e7d4f",changed:B.navy,removed:"#b03a2e"};
  return <div>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600,marginBottom:4}}>Client Activity</div>
    <div style={{fontSize:13,color:B.textSoft,marginBottom:16}}>Changes the family made themselves, newest first. Shows which fields changed, not the values; open the record to see it now.</div>
    {rows===null?<div style={{fontSize:13,color:B.textMute}}>Loading…</div>
    :rows.length===0?<Empty text="No changes by the family yet."/>
    :<div style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:10,overflow:"hidden"}}>
      {rows.map(r=><div key={r.id} style={{display:"flex",gap:12,padding:"10px 14px",borderBottom:`1px solid ${B.borderLight}`,alignItems:"baseline",flexWrap:"wrap"}}>
        <div style={{fontSize:12,color:B.textMute,width:140,flexShrink:0}}>{new Date(r.created_at).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}</div>
        <div style={{flex:"1 1 260px",minWidth:0,fontSize:13,color:B.text}}>
          <span style={{fontWeight:700}}>{r.actor_name||r.actor_email||"A family user"}</span>{" "}
          <span style={{color:color[r.action]||B.navy,fontWeight:600}}>{r.action}</span>{" "}
          {(ACTIVITY_KIND[r.table_name]||activityField(r.table_name)).toLowerCase()}
          {r.record_label?<> <span style={{fontWeight:600}}>“{r.record_label}”</span></>:null}
          {r.action==="changed"&&r.fields?.length?<div style={{fontSize:12,color:B.textSoft,marginTop:2}}>Changed: {r.fields.map(activityField).join(", ")}</div>:null}
        </div>
      </div>)}
    </div>}
    {rows&&rows.length>=limit&&<div style={{marginTop:12}}><Btn small variant="ghost" onClick={()=>setLimit(l=>l+100)}>Show more</Btn></div>}
  </div>;
}

function FamilyDashboard({family,data,reload,toast,onBack,userProfile,initialTab}){
  const isMobile=useIsMobile();
  // Partner role: full read access to everything in this dashboard, but no
  // create/edit/delete anywhere except uploading documents (handled separately
  // below). Enforced for real via RLS (write_access policies exclude partner);
  // this just keeps the UI from showing controls that would fail server-side.
  const canEdit=userProfile?.role!=="partner"&&userProfile?.role!=="enterprise_admin"; // firm administrators are view only, enforced by the database as well
  // PROVIDERS_COLLAPSE
  // Keyed by property and defaulting closed. A Set rather than a single id because
  // comparing two properties' vendors means having both open at once.
  const[openProviders,setOpenProviders]=useState(()=>new Set());
  const toggleProviders=id=>setOpenProviders(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});
  const[activeTab,setActiveTab]=useState(initialTab||"overview");
  const tabPanelRef=useTabEntrance(activeTab);
  const[reportOpen,setReportOpen]=useState(false);
  const[modal,setModal]=useState(null);
  const[editM,setEditM]=useState(null);

  const _rawContacts=data.contacts.filter(c=>c.familyId===family.id);

  // MEMBER_SORT_PATCH
  // Both lists previously rendered in whatever order the database returned, which
  // is stable but arbitrary — on a household with a dozen members you end up
  // scanning rather than looking.
  //
  // The default is not plain alphabetical: the primary contact leads, because that
  // is who workflow drafts copy and who the Expert deals with most. Alphabetical
  // within that.
  const [memberSort,setMemberSort]=useState("name");
  const [contactSort,setContactSort]=useState("name");

  // localeCompare, not <, so accented and non-ASCII names order correctly rather
  // than being pushed to the end by their code points.
  const _byName=(a,b)=>String(a.name||"").localeCompare(String(b.name||""),undefined,{sensitivity:"base"});
  const _ageOf=c=>{
    if(!c.dob)return null;
    const d=parseLocalDate(c.dob); if(isNaN(d.getTime()))return null;
    const t=new Date(); let a=t.getFullYear()-d.getFullYear();
    const m=t.getMonth()-d.getMonth();
    if(m<0||(m===0&&t.getDate()<d.getDate()))a--;
    return a;
  };
  // PRINCIPALS_PINNED
  // The rank is applied before the chosen sort in every mode, so the couple always
  // heads the household and the sort only ever reorders the dependants beneath
  // them. Who heads a household is a fact about the relationship rather than an
  // ordering preference, and having the spouse drop into the middle of the list
  // when someone switched to Age was the thing that made the list hard to read.
  const _rank=c=>c.isPrimary?0:c.isSecondary?1:2;
  const contacts=[..._rawContacts].sort((a,b)=>{
    const ra=_rank(a), rb=_rank(b);
    if(ra!==rb)return ra-rb;
    // Two rows can only share rank 0 or 1 if the database constraints were
    // bypassed; treat them as equal rather than reordering the pair.
    if(ra<2)return 0;

    if(memberSort==="age"||memberSort==="ageAsc"){
      const aa=_ageOf(a), ba=_ageOf(b);
      // Members with no date of birth sort last either way — an unknown age is not
      // a young age, and floating them to the top would be misleading.
      if(aa===null&&ba===null)return _byName(a,b);
      if(aa===null)return 1;
      if(ba===null)return -1;
      if(aa!==ba)return memberSort==="age"?ba-aa:aa-ba;
      return _byName(a,b);
    }
    return _byName(a,b);
  });
  const properties=data.properties.filter(p=>p.familyId===family.id);
  // Providers this family can be billed by, for the vendor picker on an expense line.
  const vendorOptions=buildVendorOptions(data,family.id);
  const deals=data.deals.filter(d=>d.familyId===family.id);
  const openDeals=deals.filter(d=>d.stage!=="Closed Lost"&&d.stage!=="Closed Won");
  const famNotes=data.notes.filter(n=>n.familyId===family.id);
  const noteAttachments=data.note_attachments||[];
  const famTasks=data.tasks.filter(t=>t.familyId===family.id);
  const pendingTasks=famTasks.filter(t=>!t.done);
  const accounts=(data.portfolio_accounts||[]).filter(a=>a.familyId===family.id);
  const valuables=(data.valuables||[]).filter(v=>v.familyId===family.id);
  const loans=(data.loans||[]).filter(l=>l.familyId===family.id);

  const totalRE=properties.reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0);
  const totalDebt=properties.reduce((s,p)=>s+(Number(p.loanBalance)||0)+(Number(p.secondMortgageBalance)||0),0)+accounts.filter(a=>a.accountType==="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0)+loansDebt(loans);
  const totalAccounts=accounts.filter(a=>a.accountType!=="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const totalValuables=valuables.reduce((s,v)=>s+(Number(v.estimatedValue)||0),0);
  const netWorth=totalRE-totalDebt+totalAccounts+totalValuables;
  const overdueTasks=pendingTasks.filter(t=>t.dueDate&&dueEnd(t.dueDate)<new Date());
  const soonTasks=pendingTasks.filter(t=>t.dueDate&&!overdueTasks.includes(t)&&(dueEnd(t.dueDate)-new Date())/(86400000)<=30);

  // Scheduled Prompts is visible to every ORDANIS Expert/Admin, and to a Partner
  // only when an admin has flipped their can_run_scheduled_prompts toggle on.
  const canSeePrompts=userProfile?.role==="advisor"||userProfile?.role==="analyst"||userProfile?.role==="admin"||(userProfile?.role==="partner"&&userProfile?.canRunScheduledPrompts);
  // ORDER MATTERS: familyRow and plan must stay ABOVE TABS, which reads plan to decide whether the
  // Obligations tab exists. Declared after it, the const would sit in its temporal dead zone and
  // every render would throw "Cannot access 'plan' before initialization" — the exact failure that
  // took down the family card once already in this file.
  //
  // Read from data.families rather than the `family` prop so a plan change on the edit form takes
  // effect without reselecting the household. Same reason assistantName does it.
  const familyRow=(data.families||[]).find(x=>x.id===family.id)||family;
  const plan=familyRow.plan;
  const hasWorkflows=planAllows(plan,"workflows");
  const hasBillPay=planAllows(plan,"billPay");
  const hasAssignedExpert=planAllows(plan,"assignedExpert");

  // "Ask ORDANIS" is the internal key, not the label — the label resolves to this household's
  // assistant name at render, so a family whose assistant is called Nova reads "Ask Nova"
  // while the tab id stays "askordanis" and existing links keep working.
  //
  // It sits LAST, after Prompts. The records tabs are a set of ledgers; the assistant is a
  // different kind of thing, and putting it at the end stops the eye reading twelve equal
  // siblings. The star marks it as the AI feature.
  //
  // Obligations is absent entirely on Core rather than shown disabled. A locked door on every
  // visit is worse than no door, and the tab row is already the tightest thing on this screen.
  const TABS=["Overview","Properties","Portfolio","Loans & Lines","Cash Flow",...(hasWorkflows?["Workflows"]:[]),"Valuables","Notes","Tasks",...(["admin","advisor","analyst"].includes(userProfile?.role)?["Client Activity"]:[]),"CHRIS",...(canSeePrompts?["Prompts"]:[]),...(userProfile?.role==="enterprise_admin"?[]:["Ask ORDANIS"])];
  const assistantName=(familyRow.assistantName||"").trim()||"ORDANIS";
  const[showWelcome,setShowWelcome]=useState(false);
  // Carries "attach a document to this property section" from the Properties tab
  // over to the CHRIS tab, which owns the upload form.
  const[attachIntent,setAttachIntent]=useState(null);
  // Tab ids are the lowercased, de-spaced label (see the TABS map below).
  const startAttach=(propertyId,section)=>{setAttachIntent({propertyId,section});setActiveTab("vault");};
  useEffect(()=>{
    if(!family?.id)return;
    // Firm administrators have view-only access and no assistant (the Ask ORDANIS tab is removed for
    // them above). The greeting embeds a working assistant, so it must not open for them either.
    if(userProfile?.role==="enterprise_admin")return;
    if(_greetedFamilies.has(family.id))return;   // already greeted this session
    _greetedFamilies.add(family.id);
    setShowWelcome(true);
  },[family?.id]);

  // Quick add note (with optional file attachments)
  const[noteBody,setNoteBody]=useState("");
  // pendingNoteFiles: array of {file, category}
  const[pendingNoteFiles,setPendingNoteFiles]=useState([]);
  const[noteAttachingId,setNoteAttachingId]=useState(null); // existing note ID we're attaching to
  // Upload a single file as an attachment to a given note
  const uploadNoteAttachment=async(noteId,file,category)=>{
    const ext=file.name.split(".").pop();
    // Household folder FIRST: every storage rule (read, upload, delete, the firm gate and the storage
    // quota) reads the household from the first folder of the path. Under note-attachments/<household>/
    // only admins could upload or open these, and a firm admin's download always failed.
    const path=`${family.id}/note-attachments/${Date.now()}_${Math.random().toString(36).slice(2,8)}_${file.name.replace(/\s+/g,"_")}`;
    const{error:uploadError}=await sb.storage.from("documents").upload(path,file,{upsert:false});
    if(uploadError)throw new Error(uploadError.message);
    const{error:dbError}=await sb.from("note_attachments").insert({note_id:noteId,name:file.name,category:category||"General",file_path:path,file_size:file.size,file_type:file.type||ext});
    if(dbError)throw new Error(dbError.message);
  };
  // NOTE_EDIT_PATCH
  // Notes are a record of what was said and agreed, so they were write-once. But
  // that meant the only way to fix a typo was to delete and retype, which discards
  // the original timestamp and any attachments — so in practice errors stayed.
  // Editing keeps the record and stamps when it changed.
  const[editingNote,setEditingNote]=useState(null);   // note id
  const[editNoteBody,setEditNoteBody]=useState("");
  const beginEditNote=(n)=>{setEditingNote(n.id);setEditNoteBody(n.body||"");};
  const cancelEditNote=()=>{setEditingNote(null);setEditNoteBody("");};
  const saveEditNote=async(n)=>{
    const body=editNoteBody.trim();
    if(!body){toast("A note needs a few words in it. If you no longer need it, you can delete it instead.","error");return;}
    if(body===(n.body||"")){cancelEditNote();return;}   // nothing changed, do not stamp an edit
    const{error}=await sb.from("notes")
      .update({body,updated_at:new Date().toISOString()}).eq("id",n.id);
    if(error){toast(error.message,"error");return;}
    toast("Note updated. All saved.");
    cancelEditNote();
    reload("notes");
  };
  const addNote=async()=>{
    if(!noteBody.trim())return;
    const{data,error}=await sb.from("notes").insert({body:noteBody,family_id:family.id,contact_id:null}).select().single();
    if(error){toast(error.message,"error");return;}
    // Upload any pending attachments
    if(pendingNoteFiles.length>0&&data){
      try{
        for(const pf of pendingNoteFiles){await uploadNoteAttachment(data.id,pf.file,pf.category);}
        toast(`Note added with ${pendingNoteFiles.length} attachment${pendingNoteFiles.length>1?"s":""}`);
      }catch(e){toast("Note saved but attachment failed: "+e.message,"error");}
    }else{
      toast("Note saved. Thanks for keeping this up to date.");
    }
    setNoteBody("");setPendingNoteFiles([]);
    reload("notes");reload("note_attachments");
  };
  // Download a note attachment via signed URL
  const downloadNoteAttachment=async(att)=>{
    if(!await firmDocGate(att.filePath,att.name,"download_document")){toast(FIRM_GATE_MSG,"error");return;}
    const{data,error}=await sb.storage.from("documents").createSignedUrl(att.filePath,300,{download:att.name||true});
    if(error){toast(error.message,"error");return;}
    const a=document.createElement("a");a.href=data.signedUrl;a.download=att.name||"file";document.body.appendChild(a);a.click();document.body.removeChild(a);
  };
  // Delete a note attachment (file + DB row)
  const delNoteAttachment=async(att)=>{
    await sb.storage.from("documents").remove([att.filePath]);
    const{error}=await sb.from("note_attachments").delete().eq("id",att.id);
    if(error)toast(error.message,"error");else{toast("Attachment removed");reload("note_attachments");}
  };
  // Attach a file to an existing note (with category)
  const attachToExistingNote=async(noteId,file,category)=>{
    try{
      await uploadNoteAttachment(noteId,file,category);
      toast("File attached");
      reload("note_attachments");
    }catch(e){toast(e.message,"error");}
  };

  // Quick add task
  const addTask=async(f)=>{
    const{error}=await sb.from("tasks").insert({family_id:family.id,contact_id:f.contactId||null,title:f.title,due_date:f.dueDate||null,priority:f.priority,reminder_days:reminderDaysOr7(f.reminderDays),done:false,recurrence:f.recurrence||null,recurrence_interval:f.recurrence==="Custom"?(Number(f.recurrenceInterval)||1):null,recurrence_unit:f.recurrence==="Custom"?(f.recurrenceUnit||"week"):null});
    if(error){toast(error.message,"error");return false;}else{toast("Task added. You're all set.");reload("tasks");}
  };
  const toggleTask=async(t)=>{
    const marking=!t.done;
    const{error}=await sb.from("tasks").update(marking?{done:true,completed_at:new Date().toISOString(),completed_by:CURRENT_USER_LABEL||null}:{done:false,completed_at:null,completed_by:null}).eq("id",t.id);
    if(error){toast(error.message,"error");return;}
    if(marking&&t.recurrence){
      const nd=nextRecurrence(t.dueDate,t.recurrence,t.recurrenceInterval,t.recurrenceUnit);
      if(nd)await scheduleNextOccurrence(t,t.familyId||family.id,nd,toast);
    }
    reload("tasks");
  };
  const delTask=async(id)=>{if(!confirm("Delete this task? This can't be undone."))return;
    const{error}=await sb.from("tasks").delete().eq("id",id);
    if(error)toast(error.message,"error");else reload("tasks");
  };
  const delNote=async(id)=>{if(!confirm("Delete this note? This can't be undone."))return;
    const{error}=await sb.from("notes").delete().eq("id",id);
    if(error)toast(error.message,"error");else reload("notes");
  };

  // Add/remove members
  const addMember=async(f)=>{
    const{error}=await sb.from("contacts").insert({family_id:family.id,name:f.name,email:f.email||null,phone:f.phone||null,company:f.company||null,type:f.type||"Individual",dob:f.dob||null,anniversary:f.anniversary||null,address:f.address||null,is_advisor:!!f.isAdvisor,tags:null});
    if(error){toast(error.message,"error");return false;}else{toast("Member added. Welcome to the household record.");reload("contacts");}
  };
  const delMember=async(id)=>{if(!confirm("Remove this family member? This can't be undone."))return;
    const{error}=await sb.from("contacts").delete().eq("id",id);
    if(error)toast(error.message,"error");else{toast("Member removed");reload("contacts");}
  };
  const editMember=async(f)=>{
    const{error}=await sb.from("contacts").update({name:f.name,email:f.email||null,phone:f.phone||null,company:f.company||null,type:f.type||"Individual",dob:f.dob||null,anniversary:f.anniversary||null,address:f.address||null,is_advisor:!!f.isAdvisor}).eq("id",editM.id);
    if(error){toast(error.message,"error");return false;}else{toast("Member updated. All saved.");reload("contacts");}
  };
  const toggleMemberAdvisor=async(c)=>{
    if(!c.email){toast("Add an email to this contact first — the client emails them here.","error");return;}
    const{error}=await sb.from("contacts").update({is_advisor:!c.isAdvisor}).eq("id",c.id);
    if(error)toast(error.message,"error");else{toast(!c.isAdvisor?"Marked as an emailable ORDANIS Expert":"Removed as ORDANIS Expert option");reload("contacts");}
  };
  // The family principal, copied on every outbound workflow draft. A partial unique
  // index allows only one per family, so the previous holder is cleared first
  // rather than letting the database reject the second write.
  const toggleMemberPrimary=async(c)=>{
    if(!c.isPrimary&&!c.email){
      toast("Add an email to this member first — the copy has nowhere to go.","error");return;
    }
    const clearing=!!c.isPrimary;
    const{error:clearErr}=await sb.from("contacts")
      .update({is_primary:false}).eq("family_id",family.id).eq("is_primary",true);
    if(clearErr){toast(clearErr.message,"error");return;}
    if(!clearing){
      const{error}=await sb.from("contacts").update({is_primary:true}).eq("id",c.id);
      if(error){toast(error.message,"error");reload("contacts");return;}
    }
    toast(clearing
      ?"No primary contact set — workflow drafts will go out without a copy"
      :`${c.name} will be copied on workflow correspondence`);
    reload("contacts");
  };
  // The second household principal — typically a spouse. Deliberately does NOT
  // affect workflow copies: that routing belongs to the primary alone, and giving
  // two people the copy would change who receives client correspondence rather
  // than just who appears at the top of a list.
  //
  // A partial unique index allows one per family, so the incumbent is cleared
  // first rather than letting the second write be rejected. A database check also
  // forbids holding both designations, so primary is stood down explicitly here
  // instead of surfacing a constraint violation to the user.
  const toggleMemberSecondary=async(c)=>{
    const clearing=!!c.isSecondary;
    const{error:clearErr}=await sb.from("contacts")
      .update({is_secondary:false}).eq("family_id",family.id).eq("is_secondary",true);
    if(clearErr){toast(clearErr.message,"error");return;}
    if(!clearing){
      const patch={is_secondary:true};
      if(c.isPrimary)patch.is_primary=false;
      const{error}=await sb.from("contacts").update(patch).eq("id",c.id);
      if(error){toast(error.message,"error");reload("contacts");return;}
    }
    toast(clearing
      ?`${c.name} is no longer a household principal`
      :(c.isPrimary
          ? `${c.name} moved from primary to secondary — set a primary contact so workflow drafts still get copied`
          : `${c.name} set as secondary principal`));
    reload("contacts");
  };
  const[editFC,setEditFC]=useState(null);
  const _rawFamContacts=(data.family_contacts||[]).filter(fc=>fc.familyId===family.id);
  const famContacts=[..._rawFamContacts].sort((a,b)=>{
    if(contactSort==="role"){
      const r=String(a.role||"").localeCompare(String(b.role||""),undefined,{sensitivity:"base"});
      // Blank roles last rather than first, so the sort surfaces the categorised
      // contacts instead of burying them under the uncategorised ones.
      if(!a.role!==!b.role)return a.role?-1:1;
      if(r)return r;
      return _byName(a,b);
    }
    if(contactSort==="company"){
      if(!a.company!==!b.company)return a.company?-1:1;
      const r=String(a.company||"").localeCompare(String(b.company||""),undefined,{sensitivity:"base"});
      if(r)return r;
      return _byName(a,b);
    }
    return _byName(a,b);
  });
  const addFamilyContact=async(f)=>{const{error}=await sb.from("family_contacts").insert({family_id:family.id,name:f.name,role:f.role||null,company:f.company||null,email:f.email||null,phone:f.phone||null,is_advisor:!!f.isAdvisor,notes:f.notes||null});if(error){toast(error.message,"error");return false;}else{toast("Contact added. Your team is easy to find now.");reload("family_contacts");}};
  const editFamilyContact=async(f)=>{const{error}=await sb.from("family_contacts").update({name:f.name,role:f.role||null,company:f.company||null,email:f.email||null,phone:f.phone||null,is_advisor:!!f.isAdvisor,notes:f.notes||null}).eq("id",editFC.id);if(error){toast(error.message,"error");return false;}else{toast("Contact updated. All saved.");reload("family_contacts");}};
  const delFamilyContact=async(id)=>{if(!confirm("Remove this contact from the household? This can't be undone."))return;const{error}=await sb.from("family_contacts").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Contact removed");reload("family_contacts");}};
  const toggleFCAdvisor=async(c)=>{if(!c.email){toast("Add an email to this contact first — the client emails them here.","error");return;}const{error}=await sb.from("family_contacts").update({is_advisor:!c.isAdvisor}).eq("id",c.id);if(error)toast(error.message,"error");else{toast(!c.isAdvisor?"Marked as an emailable ORDANIS Expert":"Removed as ORDANIS Expert option");reload("family_contacts");}};

  const propContactsFor=(pid)=>(data.property_contacts||[]).filter(pc=>pc.propertyId===pid);
  // Supporting document behind a given figure on a property card (mortgage note,
  // tax bill, insurance dec page, invoice, flood dec, rental agreement).
  const docForSection=(pid,section)=>(data.documents||[]).find(d=>d.propertyId===pid&&d.propertySection===section);
  // The family's scheduled-personal-property endorsement, linked from Valuables.
  const valuablesPolicyDoc=()=>(data.documents||[]).find(d=>d.familyId===family.id&&d.propertySection==="valuables_schedule");
  const addPropertyContact=async(pid,f)=>{const{error}=await sb.from("property_contacts").insert({property_id:pid,family_id:family.id,name:f.name,role:f.role||null,company:f.company||null,email:f.email||null,phone:f.phone||null,notes:f.notes||null});if(error){toast(error.message,"error");return false;}else{toast("Contact added. Your team is easy to find now.");reload("property_contacts");}};
  const editPropertyContact=async(id,f)=>{const{error}=await sb.from("property_contacts").update({name:f.name,role:f.role||null,company:f.company||null,email:f.email||null,phone:f.phone||null,notes:f.notes||null}).eq("id",id);if(error){toast(error.message,"error");return false;}else{toast("Contact updated. All saved.");reload("property_contacts");}};
  const delPropertyContact=async(id)=>{if(!confirm("Remove this contact from the property? This can't be undone."))return;const{error}=await sb.from("property_contacts").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Contact removed");reload("property_contacts");}};

  // Add property
  const addProperty=async(f)=>{
    const row={family_id:family.id,owner_name:f.ownerName||null,address:f.address,property_type:f.propertyType,purchase_price:numOrNull(f.purchasePrice),purchase_date:f.purchaseDate||null,current_value:numOrNull(f.currentValue),lender:f.lender||null,loan_balance:numOrNull(f.loanBalance),interest_rate:numOrNull(f.interestRate),loan_payment:numOrNull(f.loanPayment),loan_maturity_date:f.loanMaturityDate||null,loan_type:f.loanType,rental_income:numOrNull(f.rentalIncome),property_taxes:numOrNull(f.propertyTaxes),utilities:numOrNull(f.utilities),insurance_company:f.insuranceCompany||null,insurance_premium:numOrNull(f.insurancePremium),insurance_expiration:f.insuranceExpiration||null,flood_insurance:!!f.floodInsurance,flood_insurance_company:f.floodInsurance?(f.floodInsuranceCompany||null):null,flood_insurance_premium:f.floodInsurance?numOrNull(f.floodInsurancePremium):null,flood_insurance_expiration:f.floodInsurance?(f.floodInsuranceExpiration||null):null,hoa_fee:Number(f.hoaFee)||0,property_management_fee_pct:Number(f.propertyManagementFeePct)||0,include_mortgage_in_cashflow:f.includeMortgageInCashflow!==false,second_mortgage_balance:numOrNull(f.secondMortgageBalance),second_mortgage_payment:numOrNull(f.secondMortgagePayment),notes:f.notes||null};
    const{error}=await sb.from("properties").insert(row);
    if(error){toast(error.message,"error");return false;}else{toast("Property added. Your record is looking more complete.");reload("properties");}
  };
  const editProperty=async(id,f)=>{
    const row={owner_name:f.ownerName||null,address:f.address,property_type:f.propertyType,purchase_price:numOrNull(f.purchasePrice),purchase_date:f.purchaseDate||null,current_value:numOrNull(f.currentValue),lender:f.lender||null,loan_balance:numOrNull(f.loanBalance),interest_rate:numOrNull(f.interestRate),loan_payment:numOrNull(f.loanPayment),loan_maturity_date:f.loanMaturityDate||null,loan_type:f.loanType,rental_income:numOrNull(f.rentalIncome),property_taxes:numOrNull(f.propertyTaxes),utilities:numOrNull(f.utilities),insurance_company:f.insuranceCompany||null,insurance_premium:numOrNull(f.insurancePremium),insurance_expiration:f.insuranceExpiration||null,flood_insurance:!!f.floodInsurance,flood_insurance_company:f.floodInsurance?(f.floodInsuranceCompany||null):null,flood_insurance_premium:f.floodInsurance?numOrNull(f.floodInsurancePremium):null,flood_insurance_expiration:f.floodInsurance?(f.floodInsuranceExpiration||null):null,hoa_fee:Number(f.hoaFee)||0,property_management_fee_pct:Number(f.propertyManagementFeePct)||0,include_mortgage_in_cashflow:f.includeMortgageInCashflow!==false,second_mortgage_balance:numOrNull(f.secondMortgageBalance),second_mortgage_payment:numOrNull(f.secondMortgagePayment),notes:f.notes||null};
    const{error}=await sb.from("properties").update(row).eq("id",id);
    if(error){toast(error.message,"error");return false;}else{toast("Property updated. All saved.");reload("properties");}
  };
  const delProperty=async(id)=>{if(!confirm("Delete this property and its details? This can't be undone."))return;
    const{error}=await sb.from("properties").delete().eq("id",id);
    if(error)toast(error.message,"error");else reload("properties");
  };
  // Order within a type section: saved sort_order first (unset goes last), then by creation date.
  const propBySort=(a,b)=>((Number.isFinite(Number(a.sortOrder))?Number(a.sortOrder):1e9)-(Number.isFinite(Number(b.sortOrder))?Number(b.sortOrder):1e9))||(new Date(a.createdAt||0)-new Date(b.createdAt||0));
  const moveProperty=async(p,dir)=>{
    const section=properties.filter(x=>x.propertyType===p.propertyType).sort(propBySort);
    const idx=section.findIndex(x=>x.id===p.id);
    const swap=dir==="up"?idx-1:idx+1;
    if(swap<0||swap>=section.length)return;
    const reordered=[...section];[reordered[idx],reordered[swap]]=[reordered[swap],reordered[idx]];
    const results=await Promise.all(reordered.map((x,i)=>sb.from("properties").update({sort_order:i}).eq("id",x.id)));
    if(results.some(r=>r.error))toast("Reorder couldn't be saved — the properties table needs a sort_order column.","error");
    reload("properties");
  };

  // Add valuable
  const addValuable=async(f)=>{
    const{error}=await sb.from("valuables").insert({family_id:family.id,...valuableRowFromForm(f)});
    if(error){toast(error.message,"error");return false;}else{toast("Valuable added. One more thing safely on file.");reload("valuables");}
  };
  const editValuable=async(id,f)=>{
    const{error}=await sb.from("valuables").update(valuableRowFromForm(f)).eq("id",id);
    if(error){toast(error.message,"error");return false;}else{toast("Valuable updated. All saved.");reload("valuables");}
  };
  const delValuable=async(id)=>{if(!confirm("Delete this valuable? This can't be undone."))return;
    const{error}=await sb.from("valuables").delete().eq("id",id);
    if(error)toast(error.message,"error");else reload("valuables");
  };
  // Loans & Lines: same form and columns as the client side (loanRowFromForm).
  const[loanModal,setLoanModal]=useState(null); // {loan?}
  const saveLoan=async(m,f)=>{
    if(loanOnListedProperty(m,f)){
      const e=await mortgageOntoProperty(family.id,properties.find(p=>`p:${p.id}`===f.securedBy),f);
      if(e){toast(e,"error");return false;}
      toast("Saved on the property.");reload("properties");return;
    }
    const row=loanRowFromForm(f);
    const{error}=m.loan?await sb.from("loans").update(row).eq("id",m.loan.id).eq("family_id",family.id)
      :await sb.from("loans").insert({family_id:family.id,...row});
    if(error){toast(error.message,"error");return false;}
    toast(m.loan?"Loan updated. All saved.":"Loan added.");reload("loans");
  };
  const delLoan=async l=>{if(!confirm(`Remove ${loanTitle(l)}? Its statements stay in CHRIS. This can't be undone.`))return;
    const{error}=await sb.from("loans").delete().eq("id",l.id).eq("family_id",family.id);
    if(error)toast(error.message,"error");else{toast("Loan removed");reload("loans");}
  };

  // Add deal
  const addDeal=async(f)=>{
    const{error}=await sb.from("deals").insert({family_id:family.id,contact_id:f.contactId||null,title:f.title,value:f.value||null,stage:f.stage,close_date:f.closeDate||null});
    if(error){toast(error.message,"error");return false;}else{toast("Deal added");reload("deals");}
  };
  const moveDeal=async(deal,dir)=>{
    const idx=STAGES.indexOf(deal.stage);const next=STAGES[idx+dir];if(!next)return;
    const{error}=await sb.from("deals").update({stage:next}).eq("id",deal.id);
    if(error)toast(error.message,"error");else reload("deals");
  };
  const delDeal=async(id)=>{if(!confirm("Delete this deal? This can't be undone."))return;
    const{error}=await sb.from("deals").delete().eq("id",id);
    if(error)toast(error.message,"error");else reload("deals");
  };

  // Add portfolio account
  const addAccount=async(f)=>{
    const{error}=await sb.from("portfolio_accounts").insert({family_id:family.id,institution:f.institution,banker_name:f.bankerName||null,account_type:f.accountType,starting_balance:numOrNull(f.startingBalance),current_balance:numOrNull(f.currentBalance),account_advisor_name:f.accountAdvisorName||null,account_advisor_phone:f.accountAdvisorPhone||null,account_advisor_email:f.accountAdvisorEmail||null,notes:f.notes||null});
    if(error){toast(error.message,"error");return false;}else{toast("Account added. Your record is looking more complete.");reload("portfolio_accounts");}
  };
  const editAccount=async(id,f)=>{
    const{error}=await sb.from("portfolio_accounts").update({institution:f.institution,banker_name:f.bankerName||null,account_type:f.accountType,starting_balance:numOrNull(f.startingBalance),current_balance:numOrNull(f.currentBalance),account_advisor_name:f.accountAdvisorName||null,account_advisor_phone:f.accountAdvisorPhone||null,account_advisor_email:f.accountAdvisorEmail||null,notes:f.notes||null}).eq("id",id);
    if(error){toast(error.message,"error");return false;}else{toast("Account updated. All saved.");reload("portfolio_accounts");}
  };
  const delAccount=async(id)=>{if(!confirm("Delete this account? This can't be undone."))return;
    const{error}=await sb.from("portfolio_accounts").delete().eq("id",id);
    if(error)toast(error.message,"error");else reload("portfolio_accounts");
  };

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      {/* Header */}
      <div style={{padding:isMobile?"12px 16px":"14px 28px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",alignItems:"center",gap:isMobile?10:16,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{background:"none",border:`1px solid ${B.border}`,color:B.textSoft,cursor:"pointer",fontSize:13,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:6,flexShrink:0}}>←</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?18:22,color:B.navy,fontWeight:600,lineHeight:1.1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{family.name}</div>
            <span style={{flexShrink:0,fontSize:9,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
              padding:"3px 7px",borderRadius:4,
              background:hasWorkflows?B.gold:B.borderLight,color:hasWorkflows?B.navy:B.textSoft}}>{planLabel(plan)}</span>
          </div>
          {/* On Basic/Core the expert-of-record exists only so staff can open the household; naming
              them here as the household's ORDANIS Expert would contradict the tier that was sold --
              both tiers are self-directed, not staff-led, per plans.js's PLAN_BLURB. */}
          {!isMobile&&<div style={{fontSize:12,color:B.textSoft,marginTop:2}}>
            {hasAssignedExpert
              ? <>ORDANIS Expert: {family.advisorName||"—"}{family.advisorEmail?` · ${family.advisorEmail}`:""}</>
              : <>Self-directed · no assigned ORDANIS Expert on this plan</>}
          </div>}
          {isMobile&&hasAssignedExpert&&family.advisorName&&<div style={{fontSize:11,color:B.textSoft,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{family.advisorName}</div>}
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          {/* Clicking either badge jumps straight to the Tasks tab, where the
              overdue/due-soon items they're summarizing actually live -- otherwise
              they're a count with no way to act on it from here. */}
          {overdueTasks.length>0&&<Badge scheme={{bg:"#fde8e8",text:"#8b1a1a",dot:"#d43030"}} onClick={()=>setActiveTab("tasks")}>{overdueTasks.length} overdue</Badge>}
          {soonTasks.length>0&&<Badge scheme={{bg:"#fef3e2",text:"#8a5c00",dot:"#d4900a"}} onClick={()=>setActiveTab("tasks")}>{soonTasks.length} due soon</Badge>}
          <Btn variant="gold" small={isMobile} onClick={()=>setReportOpen(true)}>🖨{!isMobile&&" Print Report"}</Btn>
        </div>
      </div>

      {/* Tabs — folder tabs, not flat text.
          Depth comes from the active tab losing its bottom border and merging into the
          content surface below, so page and tab read as one continuous sheet. That is a
          structural cue rather than a shadow, which matters because this palette's gold is
          1.97:1 on white and soft grey shadows go muddy on the cream page — both disappear
          on a projector, and these screens end up in decks and screenshots.

          The bar sits on the page background so the inactive tabs read as recessed behind
          the active one. The 1px overlap on the active tab is what covers the container's
          bottom border, which is what makes the join look continuous rather than butted. */}
      {/* The baseline is an inset shadow, not a border: the row scrolls sideways (overflow-x), and a scrolling
          box clips anything outside its padding, so the active tab could never overlap a real border and a line
          showed under it. An inset shadow is painted beneath the tabs, so the active tab's white bottom covers it. */}
      {/* Phones: one menu button for the household's sections instead of a sideways-scrolling tab row. */}
      {isMobile&&<HouseholdSectionMenu tabs={TABS} activeTab={activeTab} onPick={setActiveTab} assistantName={assistantName}/>}
      {!isMobile&&<div style={{boxShadow:`inset 0 -1px 0 ${B.border}`,background:B.bg,padding:isMobile?"6px 8px 0":"8px 28px 0",display:"flex",gap:2,alignItems:"flex-end",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        {TABS.map(t=>{
          const id=t==="CHRIS"?"vault":t.toLowerCase().replace(/\s+/g,"");
          const on=activeTab===id;
          const isAssistant=t==="Ask ORDANIS";
          const label=isAssistant?("Ask "+assistantName):t;
          return <button key={t} className="pcm-tab" onClick={()=>setActiveTab(id)} aria-current={on?"page":undefined}
            style={{
              background:on?B.white:"transparent",
              // A tab with no fill and no border reads as a label, not a target. Inactive
              // tabs get a hairline so the row still looks like a set of tabs.
              border:on?`1px solid ${B.border}`:"1px solid transparent",
              borderBottom:on?`1px solid ${B.white}`:"1px solid transparent",
              // The gold cap sits on top, where it is decoration rather than text.
              borderTop:on?`2px solid ${B.gold}`:"2px solid transparent",
              borderRadius:"8px 8px 0 0",
              color:on?B.navy:B.textSoft,
              fontFamily:"inherit",
              fontSize:13,
              fontWeight:on?600:400,
              padding:isMobile?(on?"11px 12px 10px":"9px 12px 9px"):(on?"11px 16px 10px":"9px 15px 9px"),
              cursor:"pointer",
              // The active tab's white bottom edge sits over the row's inset baseline, so the tab
              // joins the page below as one surface.
              whiteSpace:"nowrap",
              flexShrink:0,
              // A small gap sets the assistant apart from the ledger tabs without a divider,
              // which would read as a hard boundary in a row that already scrolls.
              marginLeft:isAssistant?10:0,
              transition:"background 120ms ease, color 120ms ease",
            }}>
            {isAssistant&&<span aria-hidden="true" style={{
              // Gold on white is 1.97:1, so the star is navy-toned when the tab is inactive
              // and only goes gold on the active tab, where it sits against a white fill
              // beneath a gold cap and reads as part of that treatment rather than as text.
              color:on?B.gold:B.navyMid,
              marginRight:5,
              fontSize:12,
            }}>✦</span>}
            {label}</button>;
        })}
      </div>}

      {/* Content */}
      <style>{TAB_MOTION_CSS}</style>
      <div ref={tabPanelRef} style={{flex:1,overflowY:"auto",minHeight:0}}>

        {/* OVERVIEW TAB */}
        {activeTab==="overview"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(140px,100%),1fr))",gap:14,marginBottom:24}}>
            <StatBox label="Net Worth Est." value={fmtMoney(netWorth)} accent={B.navy}/>
            <StatBox label="Real Estate" value={fmtMoney(totalRE)} accent={B.gold}/>
            <StatBox label="Portfolio" value={fmtMoney(totalAccounts)} accent={B.navyMid}/>
            <StatBox label="Valuables" value={fmtMoney(totalValuables)} accent="#8b5cf6"/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(280px,100%),1fr))",gap:20,marginBottom:20}}>
            {/* Members */}
            <div style={{background:B.white,borderRadius:12,padding:20,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Members</div>
                <div style={{marginLeft:"auto",marginRight:8}}>
                  <select value={memberSort} onChange={e=>setMemberSort(e.target.value)}
                    aria-label="Sort members" title="Sort members"
                    style={{font:"inherit",fontSize:11,color:B.textSoft,background:"transparent",border:`1px solid ${B.borderLight}`,borderRadius:6,padding:"2px 6px",cursor:"pointer",maxWidth:130}}>
                    <option value="name">Name A–Z</option>
                    <option value="age">Age, oldest</option>
                    <option value="ageAsc">Age, youngest</option>
                  </select>
                </div>
                {canEdit&&<Btn small onClick={()=>{setEditM(null);setModal("member");}}>+ Add</Btn>}
              </div>
              <GoldLine/>
              {contacts.length===0?<Empty text="No members yet. Add the first one whenever you're ready."/>:contacts.map(c=><div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${B.borderLight}`,gap:10,flexWrap:"wrap"}}>
                {/* MEMBER_ROW_RESPONSIVE: minWidth:0 is what actually lets this column
                    shrink — a flex item defaults to min-width:auto and will refuse to go
                    below its content width, which is what pushed the action buttons off
                    the edge rather than wrapping them. */}
                <div style={{flex:"1 1 200px",minWidth:0}}>
                  <div style={{fontWeight:600,color:B.navy,fontSize:13}}>{c.name}{c.dob&&(()=>{const d=parseLocalDate(c.dob);if(isNaN(d))return null;const t=new Date();let a=t.getFullYear()-d.getFullYear();const m=t.getMonth()-d.getMonth();if(m<0||(m===0&&t.getDate()<d.getDate()))a--;return a>=0?<span style={{fontWeight:400,color:B.textSoft,fontSize:11,marginLeft:6}}>· {a} yrs</span>:null;})()}
                    {c.isPrimary&&<span style={{fontSize:9.5,fontWeight:700,letterSpacing:0.4,color:B.navy,background:"rgba(206,182,132,0.3)",border:`1px solid ${B.gold}`,borderRadius:4,padding:"1px 5px",marginLeft:7,verticalAlign:"middle"}}>PRIMARY</span>}
                    {/* Deliberately quieter than PRIMARY — an outline rather than a
                        fill. The two are not equivalent: only the primary is copied
                        on correspondence, and identical styling would imply they are. */}
                    {c.isSecondary&&<span style={{fontSize:9.5,fontWeight:700,letterSpacing:0.4,color:B.navyMid,background:"transparent",border:`1px solid ${B.border}`,borderRadius:4,padding:"1px 5px",marginLeft:7,verticalAlign:"middle"}}>SECONDARY</span>}
                  </div>
                  <div style={{fontSize:11,color:B.textSoft,marginTop:2,display:"flex",gap:10,flexWrap:"wrap",minWidth:0}}>
                    {c.email&&<span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%"}}>✉ <EmailLink value={c.email}/></span>}
                    {/* A phone number broken across two lines is unreadable and
                        un-tappable, so it is kept whole even when the email truncates. */}
                    {c.phone&&<span style={{whiteSpace:"nowrap",flexShrink:0}}>📞 <PhoneLink value={c.phone}/></span>}
                  </div>
                  {c.company&&<div style={{fontSize:11,color:B.textSoft}}>{c.company}</div>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0,marginLeft:"auto"}}>
                  <Badge scheme={c.type==="Business"?{bg:"#e8f0f8",text:B.navyMid,dot:B.navyMid}:{bg:"#f3edf7",text:"#5c2d91",dot:"#8b5cf6"}}>{c.type}</Badge>
                  {canEdit&&<button onClick={()=>toggleMemberPrimary(c)}
                    title={c.isPrimary?"Primary contact — copied on workflow correspondence. Click to unset.":"Make this the primary contact, copied on workflow correspondence"}
                    style={{background:"none",border:"none",color:c.isPrimary?B.gold:B.textMute,cursor:"pointer",fontSize:13,opacity:c.isPrimary?1:0.55}}>★</button>}
                  {canEdit&&<button onClick={()=>toggleMemberSecondary(c)}
                    title={c.isSecondary?"Secondary principal — sorts beneath the primary. Click to unset.":"Mark as the second household principal, typically a spouse"}
                    style={{background:"none",border:"none",color:c.isSecondary?B.navyMid:B.textMute,cursor:"pointer",fontSize:12,fontWeight:700,opacity:c.isSecondary?1:0.55,letterSpacing:0.3}}>2°</button>}
                  {canEdit&&<button onClick={()=>{setEditM(c);setModal("member");}} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:13}} title="Edit member">✎</button>}
                  {canEdit&&<button onClick={()=>delMember(c.id)} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:13}}>✕</button>}
                </div>
              </div>)}
              {/* Workflow drafts copy the principal, so an undesignated family is a
                  gap worth naming here rather than discovering on a draft. */}
              {contacts.length>0&&!contacts.some(c=>c.isPrimary)&&<div style={{marginTop:10,fontSize:11,color:B.textSoft,background:B.bg,border:`1px dashed ${B.border}`,borderRadius:8,padding:"8px 10px",lineHeight:1.5}}>
                No primary contact set. Workflow drafts copy the family principal — use ★ to choose who that is.
              </div>}
            </div>
            {/* Team Member & Contacts (professional contacts linked to this family) */}
            <div style={{background:B.white,borderRadius:12,padding:20,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Team Member &amp; Contacts</div>
                <div style={{marginLeft:"auto",marginRight:8}}>
                  <select value={contactSort} onChange={e=>setContactSort(e.target.value)}
                    aria-label="Sort contacts" title="Sort contacts"
                    style={{font:"inherit",fontSize:11,color:B.textSoft,background:"transparent",border:`1px solid ${B.borderLight}`,borderRadius:6,padding:"2px 6px",cursor:"pointer",maxWidth:130}}>
                    <option value="name">Name A–Z</option>
                    <option value="role">Role</option>
                    <option value="company">Firm</option>
                  </select>
                </div>
                {canEdit&&<Btn small onClick={()=>{setEditFC(null);setModal("familyContact");}}>+ Add</Btn>}
              </div>
              <GoldLine/>
              {famContacts.length===0?<Empty text="No contacts yet. Add your team, CPA, attorney and others whenever you're ready."/>:famContacts.map(c=><div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${B.borderLight}`,gap:8}}>
                <div style={{minWidth:0}}>
                  <div style={{fontWeight:600,color:B.navy,fontSize:13}}>{c.name}{c.role&&<span style={{fontWeight:400,color:B.textSoft,fontSize:11,marginLeft:6}}>· {c.role}</span>}</div>
                  <div style={{fontSize:11,color:B.textSoft,marginTop:2,display:"flex",gap:10,flexWrap:"wrap"}}>
                    {c.company&&<span>{c.company}</span>}
                    {c.email&&<span>✉ <EmailLink value={c.email}/></span>}
                    {c.phone&&<span>📞 <PhoneLink value={c.phone}/></span>}
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                  {canEdit&&<button onClick={()=>toggleFCAdvisor(c)} title={c.isAdvisor?"Client can email this contact — click to remove":"Let the client email this contact"} style={{background:c.isAdvisor?"rgba(206,182,132,0.22)":"none",border:`1px solid ${c.isAdvisor?B.gold:B.border}`,color:c.isAdvisor?B.navy:B.textMute,cursor:"pointer",fontSize:13,fontWeight:600,borderRadius:20,width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",padding:0,fontFamily:"inherit"}}>{c.isAdvisor?"★":"☆"}</button>}
                  {canEdit&&<button onClick={()=>{setEditFC(c);setModal("familyContact");}} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:13}} title="Edit contact">✎</button>}
                  {canEdit&&<button onClick={()=>delFamilyContact(c.id)} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:13}}>✕</button>}
                </div>
              </div>)}
            </div>

            {/* Upcoming Tasks */}
            <div style={{background:B.white,borderRadius:12,padding:20,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Upcoming Tasks</div>
                {canEdit&&<Btn small onClick={()=>setModal("task")}>+ Add</Btn>}
              </div>
              <GoldLine/>
              {pendingTasks.length===0?<Empty text="You're all caught up. Nothing pending right now."/>:[...pendingTasks].sort((a,b)=>a.dueDate>b.dueDate?1:-1).slice(0,5).map(t=>{
                const isOD=t.dueDate&&dueEnd(t.dueDate)<new Date();
                const isSoon=!isOD&&t.dueDate&&(dueEnd(t.dueDate)-new Date())/(86400000)<=30;
                return <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:`1px solid ${B.borderLight}`}}>
                  <input type="checkbox" checked={!!t.done} disabled={!canEdit} onChange={()=>toggleTask(t)} style={{accentColor:B.navy,cursor:canEdit?"pointer":"default",flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,color:B.navy,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                    {t.dueDate&&<div style={{fontSize:11,color:isOD?"#d43030":isSoon?"#d4900a":B.textSoft}}>{isOD?"⚠ Overdue · ":isSoon?"⏰ ":" "}{fmt(t.dueDate)}</div>}
                  </div>
                  <Badge scheme={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
                </div>;
              })}
            </div>
          </div>
          {/* Recent Notes */}
          <div style={{background:B.white,borderRadius:12,padding:20,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,marginBottom:20}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600,marginBottom:4}}>Recent Notes</div>
            <GoldLine/>
            {canEdit&&<div style={{display:"flex",gap:10,marginBottom:14}}>
              <textarea value={noteBody} onChange={e=>setNoteBody(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();addNote();}}}
                rows={noteBody.includes("\n")||noteBody.length>90?4:2}
                placeholder="Quick note… (⌘/Ctrl + Enter to save)"
                style={{...inp,flex:1,minHeight:38,resize:"vertical",fontFamily:"inherit",lineHeight:1.55,paddingTop:9,paddingBottom:9}}/>
              <Btn onClick={addNote} disabled={!noteBody.trim()}>Add</Btn>
            </div>}
            {famNotes.length===0?<Empty text="No notes yet. Jot down anything worth remembering."/>:[...famNotes].sort((a,b)=>b.createdAt>a.createdAt?1:-1).slice(0,4).map(n=><div key={n.id} style={{padding:"10px 0",borderBottom:`1px solid ${B.borderLight}`,display:"flex",justifyContent:"space-between",gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                {editingNote===n.id
                  ? <div>
                      <textarea value={editNoteBody} onChange={e=>setEditNoteBody(e.target.value)}
                        onKeyDown={e=>{if(e.key==="Escape")cancelEditNote();if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();saveEditNote(n);}}}
                        autoFocus rows={4}
                        style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.gold}`,borderRadius:8,padding:"9px 11px",color:B.text,fontSize:13,lineHeight:1.6,fontFamily:"inherit",resize:"vertical",outline:"none"}}/>
                      <div style={{display:"flex",gap:8,marginTop:6,alignItems:"center"}}>
                        <Btn onClick={()=>saveEditNote(n)}>Save</Btn>
                        <button onClick={cancelEditNote} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:12}}>Cancel</button>
                        <span style={{fontSize:10.5,color:B.textMute,marginLeft:"auto"}}>⌘/Ctrl + Enter to save · Esc to cancel</span>
                      </div>
                    </div>
                  : <NoteBody body={n.body} color={B.textMid}/>}
                <div style={{fontSize:11,color:B.textMute,marginTop:3}}>
                  {fmt(n.createdAt)}{n.updatedAt&&<span title={`Edited ${fmt(n.updatedAt)}`}> · edited</span>}
                  {canEdit&&editingNote!==n.id&&<button onClick={()=>beginEditNote(n)}
                    style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:11,marginLeft:8,textDecoration:"underline"}}>edit</button>}
                </div>
              </div>
              {canEdit&&<button onClick={()=>delNote(n.id)} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button>}
            </div>)}
          </div>
          {/* Housekeeping, at the bottom of the Overview: the firm (membership and who pays), client logins,
              the Onboarding Specialist and private-household settings. */}
          <div style={{marginTop:24}}>
            {userProfile?.role==="admin"&&<FirmMembershipCard familyRow={familyRow} toast={toast} reload={reload}/>}
            {familyRow.enterprise_id&&(userProfile?.role==="admin"||userProfile?.role==="advisor"||userProfile?.role==="analyst")&&<PayerCard familyRow={familyRow} userProfile={userProfile} toast={toast} reload={reload}/>}
            {(userProfile?.role==="admin"||(userProfile?.role==="advisor"&&String(familyRow.advisorEmail||"").toLowerCase()===String(userProfile?.email||"").toLowerCase()))&&<InviteClientCard familyRow={familyRow} toast={toast} isMobile={isMobile}/>}
            {["admin","advisor","analyst"].includes(userProfile?.role)&&<OnboardingSpecialistPanel familyRow={familyRow} userProfile={userProfile} toast={toast}/>}
            {/* Private household: on the household's own page too, since top clients are usually team-onboarded
                and never appear on the Signups page. Admins only; the panel hides where the migration isn't applied. */}
            {userProfile?.role==="admin"&&<PrivateHouseholdPanel familyId={familyRow.id} familyName={familyRow.name} toast={toast} isMobile={isMobile}/>}
          </div>
        </div>}

        {/* PROPERTIES TAB */}
        {activeTab==="properties"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:13,color:B.textSoft}}>{properties.length} properties · {fmtMoney(totalRE)} total · {fmtMoney(totalDebt)} debt</div>
            {canEdit&&<Btn onClick={()=>setModal("property")}>+ Add Property</Btn>}
          </div>
          {properties.length===0?<Empty text="No properties yet. Add the first one whenever you're ready."/>:(()=>{
            const groups=[...PROP_TYPES,"Other"].map(type=>({type,list:properties.filter(p=>type==="Other"?!PROP_TYPES.includes(p.propertyType):p.propertyType===type).sort(propBySort)})).filter(g=>g.list.length>0);
            const card=(p,section,i)=><div key={p.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${B.gold}`,borderRadius:12,padding:20,marginBottom:14,boxShadow:B.shadow}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                  {canEdit&&<div style={{display:"flex",flexDirection:"column",gap:2}}>
                    <button onClick={()=>moveProperty(p,"up")} disabled={i===0} style={{cursor:i===0?"default":"pointer",opacity:i===0?0.3:1,background:B.bg,border:`1px solid ${B.border}`,borderRadius:5,width:24,height:20,fontSize:11,color:B.navy,lineHeight:1,fontFamily:"inherit"}}>↑</button>
                    <button onClick={()=>moveProperty(p,"down")} disabled={i===section.length-1} style={{cursor:i===section.length-1?"default":"pointer",opacity:i===section.length-1?0.3:1,background:B.bg,border:`1px solid ${B.border}`,borderRadius:5,width:24,height:20,fontSize:11,color:B.navy,lineHeight:1,fontFamily:"inherit"}}>↓</button>
                  </div>}
                  <div>
                    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>{p.address}</div>
                    {p.ownerName&&<div style={{fontSize:12,color:B.textSoft,marginTop:2}}>{p.ownerName}</div>}
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:16,fontWeight:700,color:B.navy}}>{fmtMoney(p.currentValue||p.purchasePrice)}</div>
                    {p.loanBalance&&<div style={{fontSize:11,color:B.textSoft}}>Balance: {fmtMoney(p.loanBalance)}</div>}
                  </div>
                  <Btn small variant="ghost" onClick={()=>window.open(`https://www.zillow.com/homes/${encodeURIComponent(p.address||"")}_rb/`,"_blank","noopener,noreferrer")}>🔗 Zillow</Btn>
                  <Btn small variant="ghost" onClick={()=>window.open(`https://www.google.com/search?q=${encodeURIComponent(`"${p.address||""}" property tax records`)}`,"_blank","noopener,noreferrer")}>🏛 Tax Records</Btn>
                  {canEdit&&<Btn small variant="ghost" onClick={()=>setModal({type:"editProperty",property:p})}>Edit</Btn>}
                  {canEdit&&<Btn small variant="danger" onClick={()=>delProperty(p.id)}>✕</Btn>}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(140px,100%),1fr))",gap:8}}>
                {[["Type",p.propertyType],["Purchase Price",fmtMoney(p.purchasePrice)],["Purchase Date",fmt(p.purchaseDate)],["Lender",p.lender||"—","mortgage"],["Loan Type",p.loanType],["Interest Rate",fmtPct(p.interestRate)],["Monthly Payment",fmtMoney(p.loanPayment)],...(Number(p.secondMortgageBalance)>0?[["2nd Mtg Balance",fmtMoney(p.secondMortgageBalance)],["2nd Mtg Payment",p.secondMortgagePayment?`${fmtMoney(p.secondMortgagePayment)}/mo`:"—"]]:[]),["Loan Maturity",fmt(p.loanMaturityDate)],["Rental Income",p.rentalIncome?`${fmtMoney(p.rentalIncome)}/mo`:"—","rental"],["Property Taxes",p.propertyTaxes?`${fmtMoney(p.propertyTaxes)}/yr`:"—","tax"],["Utilities",p.utilities?`${fmtMoney(p.utilities)}/mo`:"—"],["Insurance Co.",p.insuranceCompany||"—","insurance_dec"],["Ins. Premium",p.insurancePremium?`${fmtMoney(p.insurancePremium)}/yr`:"—","insurance_invoice"],["Flood Insurance",p.floodInsurance?`Yes${p.floodInsuranceCompany?` — ${p.floodInsuranceCompany}`:""}`:("No"),"flood_dec"]].map(([l,v,sec])=><div key={l} style={{background:B.bg,borderRadius:6,padding:"8px 10px"}}>
                  <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{l}{sec&&(docForSection(p.id,sec)?<DocLink doc={docForSection(p.id,sec)} toast={toast}/>:(canEdit?<AttachLink section={sec} onClick={()=>startAttach(p.id,sec)}/>:null))}</div>
                  <div style={{fontSize:12,color:B.text,fontWeight:600}}>{v}</div>
                </div>)}
              </div>
              {p.notes&&<div style={{marginTop:12,fontSize:13,color:B.textSoft,fontStyle:"italic"}}>{p.notes}</div>}
              <PropertySecuredLoans loans={loans} propertyId={p.id} onOpen={canEdit?l=>{setActiveTab("loans&lines");setLoanModal({loan:l});}:null}/>
              <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${B.borderLight}`}}>
                {(()=>{
                  const _pc=propContactsFor(p.id);
                  const _open=openProviders.has(p.id);
                  // Roles are what distinguishes one vendor from another at a glance,
                  // so the closed summary names them rather than only counting. Capped
                  // at three: past that the summary is longer than the list it stands in
                  // for, which defeats the point.
                  const _roles=[...new Set(_pc.map(c=>String(c.role||"").trim()).filter(Boolean))];
                  const _summary=_roles.length?`${_roles.slice(0,3).join(", ")}${_roles.length>3?` +${_roles.length-3} more`:""}`:"";
                  return <>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:_open?8:0}}>
                      <button onClick={()=>toggleProviders(p.id)}
                        style={{background:"none",border:"none",color:B.navyMid,fontSize:12,fontWeight:600,cursor:"pointer",padding:0,fontFamily:"inherit",textAlign:"left"}}>
                        {_open?"\u25BC Hide":"\u25B6 Show"} service providers ({_pc.length})
                      </button>
                      {/* Add is only offered once the list is open. Offering it while
                          collapsed invites adding a vendor that is already there. */}
                      {canEdit&&_open&&<button onClick={()=>setModal({type:"propertyContact",propertyId:p.id})} style={{background:"none",border:`1px solid ${B.border}`,color:B.navy,borderRadius:6,padding:"3px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:600,flexShrink:0}}>+ Add</button>}
                    </div>
                    {!_open&&<div style={{fontSize:10,color:B.textMute,marginTop:2}}>
                      {_pc.length===0?"None yet \u2014 add a landscaper, pool service, property manager\u2026":_summary||"No roles recorded"}
                    </div>}
                    {_open&&<>
                {propContactsFor(p.id).length===0
                  ? <div style={{fontSize:12,color:B.textMute}}>None yet — add a landscaper, pool service, property manager…</div>
                  : <div style={{display:"flex",flexDirection:"column",gap:6}}>{propContactsFor(p.id).map(c=><div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,background:B.bg,borderRadius:6,padding:"6px 10px"}}>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,color:B.navy}}>{c.name}{c.role&&<span style={{fontWeight:400,color:B.textSoft,marginLeft:6}}>· {c.role}</span>}</div>
                        <div style={{fontSize:11,color:B.textSoft,display:"flex",gap:10,flexWrap:"wrap",marginTop:1}}>{c.company&&<span>{c.company}</span>}{c.phone&&<span>📞 <PhoneLink value={c.phone}/></span>}{c.email&&<span>✉ <EmailLink value={c.email}/></span>}</div>
                      </div>
                      {canEdit&&<div style={{display:"flex",gap:6,flexShrink:0}}>
                        <button onClick={()=>setModal({type:"propertyContact",propertyId:p.id,contact:c})} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:13}} title="Edit">✎</button>
                        <button onClick={()=>delPropertyContact(c.id)} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:13}}>✕</button>
                      </div>}
                    </div>)}</div>}
                    </>}
                  </>;
                })()}
              </div>
            </div>;
            return groups.map(g=><div key={g.type} style={{marginBottom:22}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:6,borderBottom:`2px solid ${B.gold}`}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:19,color:B.navy,fontWeight:700}}>{g.type}</div>
                <div style={{background:B.navy,color:B.white,borderRadius:20,minWidth:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,padding:"0 7px"}}>{g.list.length}</div>
                <div style={{fontSize:12,color:B.textSoft,marginLeft:"auto"}}>{fmtMoney(g.list.reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0))}</div>
              </div>
              {g.list.map((p,i)=>card(p,g.list,i))}
            </div>);
          })()}
        </div>}

        {/* PORTFOLIO TAB */}
        {activeTab==="portfolio"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:13,color:B.textSoft}}>{accounts.length} accounts · {fmtMoney(totalAccounts)} total</div>
            {canEdit&&<Btn onClick={()=>setModal("account")}>+ Add Account</Btn>}
          </div>
          {accounts.length===0?<Empty text="No portfolio accounts yet. Add one to start building the picture."/>:accounts.map(a=>{
            const pct=pctChange(a.startingBalance,a.currentBalance);
            const gain=(Number(a.currentBalance)||0)-(Number(a.startingBalance)||0);
            return <div key={a.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${B.navyMid}`,borderRadius:12,padding:20,marginBottom:12,boxShadow:B.shadow}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>{a.institution}</div>
                  <div style={{fontSize:12,color:B.textSoft}}>{a.accountType}{a.bankerName?` · ${a.bankerName}`:""}</div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:16,fontWeight:700,color:B.navy}}>{fmtMoney(a.currentBalance)}</div>
                    {pct!==null&&<div style={{fontSize:12,fontWeight:700,color:Number(pct)>=0?"#18a850":"#d43030"}}>{Number(pct)>=0?"+":""}{pct}% ({Number(gain)>=0?"+":"-"}{fmtMoney(Math.abs(gain))})</div>}
                    {/* A figure with no date behind it is the thing this replaces.
                        Say plainly which it is rather than leaving it ambiguous. */}
                    {a.balanceAsOf
                      ? <div style={{fontSize:10.5,color:B.textSoft,marginTop:2}}>
                          as at {fmt(a.balanceAsOf)}
                          {(()=>{const d=(data.documents||[]).find(x=>x.id===a.balanceSourceDocumentId);
                            return d?<> · <DocLink doc={d} toast={toast} label={d.accountPeriod||"statement"}/></>:null;})()}
                        </div>
                      : <div style={{fontSize:10.5,color:B.textMute,marginTop:2}}>no date on this figure</div>}
                  </div>
                  {canEdit&&<Btn small variant="ghost" onClick={()=>setModal({type:"editAccount",account:a})}>Edit</Btn>}
                  {canEdit&&<Btn small variant="danger" onClick={()=>delAccount(a.id)}>✕</Btn>}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(150px,100%),1fr))",gap:8}}>
                {[["Starting Balance",fmtMoney(a.startingBalance)],["Current Balance",fmtMoney(a.currentBalance)],["Performance",pct!==null?`${Number(pct)>=0?"+":""}${pct}%`:"—"]].map(([l,v,sec])=><div key={l} style={{background:B.bg,borderRadius:6,padding:"8px 10px"}}>
                  <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{l}</div>
                  <div style={{fontSize:13,color:B.text,fontWeight:700}}>{v}</div>
                </div>)}
              </div>
              <AccountBalancesPanel account={a} family={family}
                history={(data.account_balances||[]).filter(b=>b.accountId===a.id)}
                documents={(data.documents||[]).filter(d=>d.familyId===family.id)}
                reload={reload} toast={toast} canEdit={canEdit} userProfile={userProfile}/>
              {/* Statements filed against this account, including any not tied to a
                  balance entry. Otherwise a filed statement could be invisible here. */}
              {(()=>{
                const stmts=(data.documents||[]).filter(d=>d.accountId===a.id);
                if(!stmts.length)return null;
                return <div style={{marginTop:8,fontSize:11,color:B.textSoft}}>
                  <span style={{fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",fontSize:9.5,color:B.textMute}}>Statements</span>
                  <div style={{marginTop:4,display:"flex",flexWrap:"wrap",gap:10}}>
                    {stmts.slice().sort((x,y)=>String(y.createdAt||"").localeCompare(String(x.createdAt||""))).map(d=>
                      <DocLink key={d.id} doc={d} toast={toast} label={d.accountPeriod||d.name}/>)}
                  </div>
                </div>;
              })()}
            </div>;
          })}
        </div>}

        {/* CASH FLOW TAB */}
        {/* familyRow, not the `family` prop: CashFlowView reads family.plan to decide whether bill
            pay exists, and the prop is a snapshot taken when the household was selected. */}
        {activeTab==="cashflow"&&<CashFlowView family={familyRow} events={(data.cash_flow_events||[]).filter(e=>e.familyId===family.id)} paymentLog={(data.cash_flow_payment_log||[]).filter(p=>p.familyId===family.id)} properties={properties} vendors={vendorOptions} reload={reload} toast={toast} readOnly={!canEdit}/>}

        {/* OBLIGATIONS TAB */}
        {/* hasWorkflows is checked here as well as in TABS. Without it, a household whose plan
            changed while this tab was open would keep rendering the panel: TABS would no longer
            offer Obligations, but activeTab would still hold the string. */}
        {activeTab==="workflows"&&hasWorkflows&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
          <ObligationsSection family={family} data={data} toast={toast} canEdit={canEdit} userProfile={userProfile}/>
        </div>}

        {/* LOANS & LINES TAB */}
        {activeTab==="loans&lines"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
          <LoansPanel loans={loans} properties={properties} valuables={valuables} accounts={accounts} documents={(data.documents||[]).filter(d=>d.familyId===family.id)}
            locAccounts={accounts.filter(a=>a.accountType==="Line of Credit")} toast={toast}
            onAdd={canEdit?kind=>setLoanModal({kind}):null} onEdit={canEdit?l=>setLoanModal({loan:l}):null} onDelete={canEdit?delLoan:null}
            onEditProperty={canEdit?p=>setModal({type:"editProperty",property:p}):null}
            onAttach={canEdit?l=>{setAttachIntent({loanId:l.id,section:"loan_statement"});setActiveTab("vault");}:null}/>
          {loanModal&&canEdit&&<Modal title={loanModal.loan?"Edit loan or line":({"Credit Card":"Add a credit card","Auto Loan":"Add a car loan","Line of Credit":"Add a line of credit",Mortgage:"Add a mortgage"}[loanModal.kind]||"Add a loan")} onClose={()=>setLoanModal(null)}>
            <LoanForm initial={loanModal.loan} defaultType={loanModal.kind||"Auto Loan"} properties={properties} valuables={valuables} accounts={accounts}
              statement={loanModal.loan?{familyId:family.id,loanId:loanModal.loan.id,toast,onUploaded:()=>reload("documents"),
                doc:(data.documents||[]).find(d=>d.loanId===loanModal.loan.id&&d.propertySection==="loan_statement")||null}:null}
              onSave={f=>saveLoan(loanModal,f)} onClose={()=>setLoanModal(null)}/>
          </Modal>}
        </div>}

        {/* VALUABLES TAB */}
        {activeTab==="valuables"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:13,color:B.textSoft}}>{valuables.length} items · {fmtMoney(totalValuables)} est. value</div>
            {canEdit&&<Btn onClick={()=>setModal("valuable")}>+ Add Valuable</Btn>}
          </div>
          {VALUABLE_CATS.map(cat=>{
            // "Other" also absorbs any unrecognised category, so a typo or an
            // imported value can never hide an asset from this tab while still
            // counting toward the totals above.
            const items=valuables.filter(v=>cat==="Other"?!VALUABLE_CATS.includes(v.category)||v.category==="Other":v.category===cat);
            if(!items.length)return null;
            return <div key={cat} style={{marginBottom:20}}>
              <div style={{fontSize:11,fontWeight:800,color:B.textMute,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>{cat}</div>
              {items.map(v=><div key={v.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid #8b5cf6`,borderRadius:10,padding:"14px 18px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,boxShadow:B.shadow}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,color:B.navy,fontSize:13}}>{v.description}</div>
                  {v.makeModel&&<div style={{fontSize:12,color:B.textSoft}}>{v.makeModel}{v.year?` · ${v.year}`:""}</div>}
                  {v.insured?<div style={{fontSize:11,color:"#18a850",fontWeight:600,marginTop:3}}>✓ Insured{v.insuranceCompany?` — ${v.insuranceCompany}`:""}<DocLink doc={valuablesPolicyDoc()} toast={toast} label="📄 policy"/></div>:<div style={{fontSize:11,color:"#b4551f",fontWeight:600,marginTop:3}}>⚠ Not scheduled<DocLink doc={valuablesPolicyDoc()} toast={toast} label="📄 policy"/></div>}
                  <ValuablePolicyDetails v={v} doc={(data.documents||[]).find(d=>d.valuableId===v.id&&d.propertySection==="valuable_policy")} toast={toast}
                    onAttach={canEdit?()=>{setAttachIntent({valuableId:v.id,section:"valuable_policy"});setActiveTab("vault");}:null}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontSize:15,fontWeight:700,color:B.navy}}>{fmtMoney(v.estimatedValue)}</div>
                  {canEdit&&<Btn small variant="ghost" onClick={()=>setModal({type:"editValuable",valuable:v})}>Edit</Btn>}
                  {canEdit&&<Btn small variant="danger" onClick={()=>delValuable(v.id)}>✕</Btn>}
                </div>
              </div>)}
            </div>;
          })}
          {valuables.length===0&&<Empty text="No valuables recorded yet. Add the first one whenever you're ready."/>}
        </div>}

        {/* DEALS TAB */}
        {activeTab==="deals"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:13,color:B.textSoft}}>{openDeals.length} open deals · {fmtMoney(openDeals.reduce((s,d)=>s+(Number(d.value)||0),0))} pipeline</div>
            {canEdit&&<Btn onClick={()=>setModal("deal")}>+ Add Deal</Btn>}
          </div>
          {deals.length===0?<Empty text="No deals yet."/>:STAGES.map(stage=>{
            const list=deals.filter(d=>d.stage===stage);
            if(!list.length)return null;
            return <div key={stage} style={{marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:STAGE_COLORS[stage].dot}}/>
                <span style={{fontSize:11,fontWeight:800,color:STAGE_COLORS[stage].dot,letterSpacing:"0.1em",textTransform:"uppercase"}}>{stage}</span>
              </div>
              {list.map(d=><div key={d.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`3px solid ${STAGE_COLORS[d.stage].dot}`,borderRadius:10,padding:"12px 16px",marginBottom:6,display:"flex",alignItems:"center",gap:12,boxShadow:B.shadow}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,color:B.navy}}>{d.title}</div>
                  {d.closeDate&&<div style={{fontSize:12,color:B.textSoft}}>Close: {fmt(d.closeDate)}</div>}
                </div>
                {d.value&&<div style={{fontWeight:800,color:B.navy}}>{fmtMoney(d.value)}</div>}
                {canEdit&&<div style={{display:"flex",gap:4}}>
                  <button onClick={()=>moveDeal(d,-1)} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:15}}>←</button>
                  <button onClick={()=>moveDeal(d,1)}  style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:15}}>→</button>
                  <Btn small variant="danger" onClick={()=>delDeal(d.id)}>✕</Btn>
                </div>}
              </div>)}
            </div>;
          })}
        </div>}

        {/* NOTES TAB */}
        {activeTab==="notes"&&<div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
          {canEdit&&<div style={{padding:isMobile?"14px 14px":"20px 28px",borderBottom:`1px solid ${B.borderLight}`,background:B.white}}>
            <div style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:12,overflow:"hidden",boxShadow:B.shadow}}>
              <textarea value={noteBody} onChange={e=>setNoteBody(e.target.value)} placeholder="Write a note or activity log entry…" style={{width:"100%",minHeight:80,background:"transparent",border:"none",padding:"14px 16px",color:B.text,fontSize:14,outline:"none",resize:"none",fontFamily:"inherit",lineHeight:1.65,boxSizing:"border-box"}}/>
              {/* Pending files preview */}
              {pendingNoteFiles.length>0&&<div style={{padding:"8px 14px",borderTop:`1px solid ${B.borderLight}`,background:"#f9f7f3"}}>
                <div style={{fontSize:10,fontWeight:800,color:B.textMute,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>Attachments ({pendingNoteFiles.length})</div>
                {pendingNoteFiles.map((pf,idx)=><div key={idx} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:idx===pendingNoteFiles.length-1?"none":`1px solid ${B.borderLight}`,flexWrap:"wrap"}}>
                  <span style={{fontSize:13,color:B.navy,fontWeight:600,flex:"1 1 200px",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📎 {pf.file.name}</span>
                  <span style={{fontSize:11,color:B.textSoft}}>{(pf.file.size/1024).toFixed(1)}KB</span>
                  <select value={pf.category} onChange={e=>{const next=[...pendingNoteFiles];next[idx]={...next[idx],category:e.target.value};setPendingNoteFiles(next);}} style={{...inp,padding:"4px 8px",fontSize:12,width:"auto",height:"auto"}}>
                    {DOC_CATEGORIES.map(c=><option key={c}>{c}</option>)}
                  </select>
                  <button onClick={()=>setPendingNoteFiles(pendingNoteFiles.filter((_,i)=>i!==idx))} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:14}}>✕</button>
                </div>)}
              </div>}
              <div style={{padding:"10px 14px",borderTop:`1px solid ${B.borderLight}`,background:B.white,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <label style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",background:B.bg,border:`1px solid ${B.border}`,borderRadius:6,cursor:"pointer",fontSize:12,color:B.navy,fontWeight:600}}>
                  📎 Attach file(s)
                  <input type="file" multiple onChange={e=>{
                    const files=Array.from(e.target.files||[]);
                    if(files.length===0)return;
                    setPendingNoteFiles([...pendingNoteFiles,...files.map(f=>({file:f,category:"General"}))]);
                    e.target.value="";
                  }} style={{display:"none"}}/>
                </label>
                <Btn onClick={addNote} disabled={!noteBody.trim()}>Log Note{pendingNoteFiles.length>0?` + ${pendingNoteFiles.length} file${pendingNoteFiles.length>1?"s":""}`:""}</Btn>
              </div>
            </div>
          </div>}
          <div style={{flex:1,overflowY:"auto",padding:isMobile?"14px 14px":"20px 28px"}}>
            {famNotes.length===0?<Empty text="No notes yet. Jot down anything worth remembering."/>:[...famNotes].sort((a,b)=>b.createdAt>a.createdAt?1:-1).map(n=>{
              const atts=noteAttachments.filter(a=>a.noteId===n.id);
              return <div key={n.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,marginBottom:12,boxShadow:B.shadow,overflow:"hidden"}}>
                <div style={{height:3,background:`linear-gradient(90deg,${B.gold},${B.goldLight})`}}/>
                <div style={{padding:"16px 20px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:10,marginBottom:8}}>
                    {editingNote===n.id
                      ? <div style={{flex:1}}>
                          <textarea value={editNoteBody} onChange={e=>setEditNoteBody(e.target.value)}
                            onKeyDown={e=>{if(e.key==="Escape")cancelEditNote();if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();saveEditNote(n);}}}
                            autoFocus rows={Math.min(16,Math.max(4,String(n.body||"").split("\n").length+1))}
                            style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.gold}`,borderRadius:8,padding:"11px 13px",color:B.text,fontSize:14,lineHeight:1.7,fontFamily:"inherit",resize:"vertical",outline:"none"}}/>
                          <div style={{display:"flex",gap:8,marginTop:8,alignItems:"center",flexWrap:"wrap"}}>
                            <Btn onClick={()=>saveEditNote(n)}>Save</Btn>
                            <button onClick={cancelEditNote} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:12.5}}>Cancel</button>
                            <span style={{fontSize:11,color:B.textMute,marginLeft:"auto"}}>⌘/Ctrl + Enter to save · Esc to cancel</span>
                          </div>
                        </div>
                      : <div style={{flex:1,minWidth:0}}>
                          <NoteBody body={n.body} size={14} clampChars={520} color={B.text}/>
                          <div style={{fontSize:11,color:B.textMute,marginTop:6}}>
                            {fmt(n.createdAt)}{n.updatedAt&&<span title={`Edited ${fmt(n.updatedAt)}`}> · edited</span>}
                            {canEdit&&<button onClick={()=>beginEditNote(n)}
                              style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:11,marginLeft:8,textDecoration:"underline"}}>edit</button>}
                          </div>
                        </div>}
                    {canEdit&&<button onClick={()=>delNote(n.id)} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button>}
                  </div>
                  {/* Attachments list */}
                  {atts.length>0&&<div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${B.borderLight}`}}>
                    {atts.map(a=><div key={a.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",flexWrap:"wrap"}}>
                      <span style={{fontSize:13,color:B.navy,fontWeight:600,flex:"1 1 200px",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📎 {a.name}</span>
                      <Badge scheme={{bg:"#e8f0f8",text:B.navyMid,dot:B.navyMid}}>{a.category}</Badge>
                      {a.fileSize&&<span style={{fontSize:10,color:B.textSoft}}>{(a.fileSize/1024).toFixed(1)}KB</span>}
                      <button onClick={()=>downloadNoteAttachment(a)} style={{background:"none",border:`1px solid ${B.border}`,color:B.navy,cursor:"pointer",fontSize:11,padding:"3px 10px",borderRadius:6,fontFamily:"inherit"}}>↓ Download</button>
                      {canEdit&&<button onClick={()=>{if(confirm("Remove this attachment?"))delNoteAttachment(a);}} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:13}}>✕</button>}
                    </div>)}
                  </div>}
                  {/* Meta row + add-attachment button */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,flexWrap:"wrap",gap:8}}>
                    <div style={{fontSize:11,color:B.textMute}}>🕐 {fmt(n.createdAt)}</div>
                    {canEdit&&<label style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 10px",background:"transparent",border:`1px dashed ${B.border}`,borderRadius:6,cursor:"pointer",fontSize:11,color:B.textSoft}}>
                      📎 Add file
                      <input type="file" onChange={e=>{
                        const file=e.target.files&&e.target.files[0];
                        if(!file)return;
                        const category=prompt("Category for this file?\n\nOptions: "+DOC_CATEGORIES.join(", "),"General");
                        if(!category){e.target.value="";return;}
                        // Sanitize: ensure it's a known category, else default to "General"
                        const cat=DOC_CATEGORIES.includes(category)?category:"General";
                        attachToExistingNote(n.id,file,cat);
                        e.target.value="";
                      }} style={{display:"none"}}/>
                    </label>}
                  </div>
                </div>
              </div>;
            })}
          </div>
        </div>}

        {/* TASKS TAB */}
        {activeTab==="tasks"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{display:"flex",gap:8}}>
              {overdueTasks.length>0&&<Badge scheme={{bg:"#fde8e8",text:"#8b1a1a",dot:"#d43030"}}>{overdueTasks.length} overdue</Badge>}
              {soonTasks.length>0&&<Badge scheme={{bg:"#fef3e2",text:"#8a5c00",dot:"#d4900a"}}>{soonTasks.length} due in 30 days</Badge>}
            </div>
            {canEdit&&<Btn onClick={()=>setModal("task")}>+ New Task</Btn>}
          </div>
          {famTasks.length===0?<Empty text="No tasks yet. Add one to keep something on track."/>:famTasks.map(t=>{
            const isOD=!t.done&&t.dueDate&&dueEnd(t.dueDate)<new Date();
            const isSoon=!t.done&&!isOD&&t.dueDate&&(dueEnd(t.dueDate)-new Date())/(86400000)<=30;
            return <div key={t.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",marginBottom:8,background:B.white,border:`1px solid ${isOD?"#f5c6c6":B.borderLight}`,borderLeft:`3px solid ${isOD?"#d43030":isSoon?"#d4900a":PRIORITY_COLORS[t.priority]?.dot||B.gold}`,borderRadius:10,opacity:t.done?.55:1,boxShadow:B.shadow}}>
              <input type="checkbox" checked={!!t.done} onChange={()=>toggleTask(t)} disabled={!canEdit} style={{width:16,height:16,accentColor:B.navy,cursor:"pointer",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,color:B.navy,textDecoration:t.done?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                <div style={{fontSize:12,color:B.textSoft,marginTop:2,display:"flex",gap:10}}>
                  {t.dueDate&&<span style={{color:isOD?"#d43030":isSoon?"#d4900a":B.textSoft}}>{isOD?"⚠ Overdue · ":isSoon?"⏰ · ":""}{fmt(t.dueDate)}</span>}
                  {t.reminderDays>0&&<span style={{color:B.textMute}}>🔔 {t.reminderDays}d reminder</span>}
                </div>
              </div>
              <Badge scheme={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
              {canEdit&&<Btn small variant="danger" onClick={()=>delTask(t.id)}>✕</Btn>}
            </div>;
          })}
        </div>}
      </div>

      {/* CHRIS TAB */}
      {activeTab==="vault"&&<div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
        <DocumentsView familyId={family.id} readOnly={false} canUpload={userProfile?.role!=="enterprise_admin"} canDelete={canEdit} canScan={canEdit} canEditMetadata={canEdit} toast={toast} reload={reload}
          attachIntent={attachIntent} onAttachHandled={()=>setAttachIntent(null)}/>
      </div>}

      {activeTab==="clientactivity"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
        <ClientActivityPanel familyId={family.id} toast={toast}/>
      </div>}

      {activeTab==="askordanis"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
        <FamilyAssistant family={family} data={data} reload={reload} toast={toast}/>
      </div>}

      {/* PROMPTS TAB — ORDANIS Experts/Admins always; Partners only if permitted */}
      {activeTab==="prompts"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
        <ScheduledPromptsSection userProfile={userProfile} families={data.families||[]} toast={toast} lockFamilyId={userProfile?.role==="partner"?family.id:undefined}/>
      </div>}

      {/* Modals */}
      {showWelcome&&<AssistantWelcome family={family} data={data} reload={reload} onClose={()=>setShowWelcome(false)} toast={toast}/>}
      {modal==="familyContact"&&<Modal title={editFC?"Edit Contact":"Add Contact"} onClose={()=>{setModal(null);setEditFC(null);}}><FamilyContactForm initial={editFC?{name:editFC.name||"",role:editFC.role||"",company:editFC.company||"",email:editFC.email||"",phone:editFC.phone||"",isAdvisor:!!editFC.isAdvisor,notes:editFC.notes||""}:null} onSave={async f=>{editFC?await editFamilyContact(f):await addFamilyContact(f);setModal(null);setEditFC(null);}} onClose={()=>{setModal(null);setEditFC(null);}}/></Modal>}
      {modal==="member"&&<Modal title={editM?"Edit Member":"Add Member"} onClose={()=>{setModal(null);setEditM(null);}}>
        <MemberForm initial={editM?{name:editM.name||"",email:editM.email||"",phone:editM.phone||"",company:editM.company||"",type:editM.type||"Individual",dob:editM.dob||"",anniversary:editM.anniversary||"",address:editM.address||"",isAdvisor:!!editM.isAdvisor}:null} onSave={async f=>{editM?await editMember(f):await addMember(f);setModal(null);setEditM(null);}} onClose={()=>{setModal(null);setEditM(null);}}/>
      </Modal>}
      {modal==="task"&&<Modal title="New Task" onClose={()=>setModal(null)}><TaskForm contacts={contacts} onSave={async f=>{const r=await addTask(f);if(r!==false)setModal(null);return r;}} onClose={()=>setModal(null)}/></Modal>}
      {modal==="property"&&<Modal title="Add Property" onClose={()=>setModal(null)} wide><PropertyForm canExtract={true} onSave={async f=>{const r=await addProperty(f);if(r!==false)setModal(null);return r;}} onClose={()=>setModal(null)}/></Modal>}
      {modal&&modal.type==="editProperty"&&<Modal title="Edit Property" onClose={()=>setModal(null)} wide><PropertyForm initial={modal.property} canExtract={true} onSave={async f=>{const r=await editProperty(modal.property.id,f);if(r!==false)setModal(null);return r;}} onClose={()=>setModal(null)}/></Modal>}
      {modal==="valuable"&&<Modal title="Add Valuable" onClose={()=>setModal(null)}><ValuableForm onSave={async f=>{const r=await addValuable(f);if(r!==false)setModal(null);return r;}} onClose={()=>setModal(null)}/></Modal>}
      {modal&&modal.type==="propertyContact"&&<Modal title={modal.contact?"Edit Service Provider":"Add Service Provider"} onClose={()=>setModal(null)}><PropertyContactForm initial={modal.contact?{name:modal.contact.name||"",role:modal.contact.role||"",company:modal.contact.company||"",email:modal.contact.email||"",phone:modal.contact.phone||"",notes:modal.contact.notes||""}:null} onSave={async f=>{modal.contact?await editPropertyContact(modal.contact.id,f):await addPropertyContact(modal.propertyId,f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
      {modal&&modal.type==="editValuable"&&<Modal title="Edit Valuable" onClose={()=>setModal(null)}><ValuableForm initial={modal.valuable} policy={{familyId:family.id,valuableId:modal.valuable.id,toast,onUploaded:()=>reload("documents"),
        doc:(data.documents||[]).find(d=>d.valuableId===modal.valuable.id&&d.propertySection==="valuable_policy")||null}}
        onSave={async f=>{const r=await editValuable(modal.valuable.id,f);if(r!==false)setModal(null);return r;}} onClose={()=>setModal(null)}/></Modal>}
      {modal==="deal"&&<Modal title="Add Deal" onClose={()=>setModal(null)}><SimpleDealForm contacts={contacts} onSave={async f=>{const r=await addDeal(f);if(r!==false)setModal(null);return r;}} onClose={()=>setModal(null)}/></Modal>}
      {modal==="account"&&<Modal title="Add Portfolio Account" onClose={()=>setModal(null)}><AccountForm onSave={async f=>{const r=await addAccount(f);if(r!==false)setModal(null);return r;}} onClose={()=>setModal(null)}/></Modal>}
      {modal&&modal.type==="editAccount"&&<Modal title="Edit Portfolio Account" onClose={()=>setModal(null)}><AccountForm initial={modal.account} onSave={async f=>{const r=await editAccount(modal.account.id,f);if(r!==false)setModal(null);return r;}} onClose={()=>setModal(null)}/></Modal>}
      {reportOpen&&<FamilyReport family={family} data={data} onClose={()=>setReportOpen(false)}/>}
    </div>
  );
}

function FamilyContactForm({initial,onSave,onClose,hideAdvisor=false,rolePlaceholder="CPA · Estate Attorney · Wealth Advisor"}){
  const[f,setF]=useState(initial||{name:"",role:"",company:"",email:"",phone:"",isAdvisor:false,notes:""});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const[showReq,setShowReq]=useState(false);
  const[err,setErr]=useState("");
  const save=async()=>{if(!f.name.trim()){setShowReq(true);return;}const pr=contactProblem(f);if(pr){setErr(pr);return;}setErr("");setSaving(true);const ok=await onSave({...f,email:String(f.email||"").trim().toLowerCase()});if(ok===false){setSaving(false);return;}onClose();};
  return <div>
    <Field label="Name" required><Inp placeholder="John Smith" value={f.name} maxLength={120} onChange={set("name")}/></Field>
    <Grid2>
      <Field label="Role / Title" optional><Inp placeholder={rolePlaceholder} value={f.role||""} onChange={set("role")}/></Field>
      <Field label="Company / Firm" optional><Inp placeholder="Smith & Co." value={f.company||""} onChange={set("company")}/></Field>
    </Grid2>
    <Grid2>
      <Field label="Email" optional><Inp type="email" autoComplete="off" placeholder="john@firm.com" value={f.email||""} onChange={set("email")}/></Field>
      <Field label="Phone" optional><Inp placeholder="(555) 000-0000" value={f.phone||""} onChange={e=>set("phone")({target:{value:formatPhoneInput(e.target.value)}})}/></Field>
    </Grid2>
    <Field label="Notes" optional><Inp placeholder="Optional" value={f.notes||""} onChange={set("notes")}/></Field>
    {!hideAdvisor&&<label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"10px 14px",background:f.isAdvisor?"rgba(206,182,132,0.15)":B.bg,borderRadius:8,border:`1px solid ${f.isAdvisor?B.gold:B.border}`,marginBottom:4}}>
      <input type="checkbox" checked={!!f.isAdvisor} onChange={e=>setF(p=>({...p,isAdvisor:e.target.checked}))} style={{width:16,height:16,accentColor:B.navy}}/>
      <span style={{fontSize:13,color:B.navy,fontWeight:600}}>Client can email this contact</span>
      <span style={{fontSize:11,color:B.textMute}}>appears in the client's "Email my ORDANIS Expert"</span>
    </label>}
    {showReq&&<ReqHint/>}
    {err&&<div style={{fontSize:12,color:"#8b1a1a",background:"#fff5f5",border:"1px solid #f3c2c2",borderRadius:8,padding:"8px 10px",marginTop:8}}>{err}</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn onClick={save} disabled={saving}>{saving?"Saving…":initial?"Save Changes":"Add Contact"}</Btn>
    </div>
  </div>;
}

function MemberForm({initial,onSave,onClose}){
  const[f,setF]=useState(initial||{name:"",email:"",phone:"",company:"",type:"Individual",dob:"",anniversary:"",address:"",isAdvisor:false});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const[showReq,setShowReq]=useState(false);
  const[err,setErr]=useState("");
  const save=async()=>{if(!f.name.trim()){setShowReq(true);return;}const pr=contactProblem(f);if(pr){setErr(pr);return;}setErr("");setSaving(true);const ok=await onSave({...f,email:String(f.email||"").trim().toLowerCase()});if(ok===false){setSaving(false);return;}onClose();};
  return <div>
    <Field label="Full Name" required><Inp placeholder="Jane Smith" value={f.name} maxLength={120} onChange={set("name")}/></Field>
    <Grid2>
      <Field label="Email" optional><Inp type="email" autoComplete="off" placeholder="jane@email.com" value={f.email||""} onChange={set("email")}/></Field>
      <Field label="Phone" optional><Inp placeholder="(555) 000-0000" value={f.phone||""} onChange={e=>set("phone")({target:{value:formatPhoneInput(e.target.value)}})}/></Field>
    </Grid2>
    <Grid2>
      <Field label="Company / LLC" optional><Inp placeholder="Smith Holdings LLC" value={f.company||""} onChange={set("company")}/></Field>
      <Field label="Type"><Sel value={f.type} onChange={set("type")}><option>Individual</option><option>Business</option></Sel></Field>
    </Grid2>
    <Grid2>
      <Field label="Date of Birth" optional><Inp type="date" max={todayISO()} value={f.dob||""} onChange={set("dob")}/></Field>
      <Field label="Anniversary" optional><Inp type="date" max={todayISO()} value={f.anniversary||""} onChange={set("anniversary")}/></Field>
      <Field label="Address" optional><Inp placeholder="123 Main St, Tampa, FL" value={f.address||""} onChange={set("address")}/></Field>
    </Grid2>
    {showReq&&<ReqHint/>}
    {err&&<div style={{fontSize:12,color:"#8b1a1a",background:"#fff5f5",border:"1px solid #f3c2c2",borderRadius:8,padding:"8px 10px",marginTop:8}}>{err}</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn onClick={save} disabled={saving}>{saving?"Saving…":initial?"Save Changes":"Add Member"}</Btn>
    </div>
  </div>;
}
const recurLabel=t=>!t.recurrence?"":(t.recurrence==="Custom"?`Every ${t.recurrenceInterval||1} ${(t.recurrenceUnit||"week")}${(t.recurrenceInterval||1)>1?"s":""}`:t.recurrence);

// ── SIMPLE DEAL FORM ──────────────────────────────────────────────────────────
function SimpleDealForm({contacts=[],onSave,onClose}){
  const[f,setF]=useState({contactId:"",title:"",value:"",stage:"Lead",closeDate:""});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const[showReq,setShowReq]=useState(false);
  const save=async()=>{if(!f.title.trim()){setShowReq(true);return;}setSaving(true);const ok=await onSave(f);if(ok===false){setSaving(false);return;}onClose();};
  return <div>
    <Field label="Deal Title" required><Inp placeholder="Estate planning engagement" value={f.title} onChange={set("title")}/></Field>
    {contacts.length>0&&<Field label="Contact" optional><Sel value={f.contactId||""} onChange={set("contactId")}><option value="">— None —</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Sel></Field>}
    <Grid2><Field label="Value ($)" optional><MoneyInput value={f.value||""} onChange={set("value")}/></Field><Field label="Close Date" optional><Inp type="date" value={f.closeDate||""} onChange={set("closeDate")}/></Field></Grid2>
    <Field label="Stage"><Sel value={f.stage} onChange={set("stage")}>{STAGES.map(s=><option key={s}>{s}</option>)}</Sel></Field>
    {showReq&&<ReqHint/>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Deal"}</Btn></div>
  </div>;
}

// ── ACCOUNT FORM ──────────────────────────────────────────────────────────────
function AccountForm({initial,onSave,onClose}){
  const[f,setF]=useState(initial||{institution:"",bankerName:"",accountType:"Investment",startingBalance:"",currentBalance:"",accountAdvisorName:"",accountAdvisorPhone:"",accountAdvisorEmail:"",notes:""});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const advisorPhoneOk=isValidPhone(f.accountAdvisorPhone||"");
  const advisorEmailOk=!(f.accountAdvisorEmail||"").trim()||EMAIL_RE.test((f.accountAdvisorEmail||"").trim());
  const[showReq,setShowReq]=useState(false);
  const save=async()=>{if(!f.institution.trim()||!advisorPhoneOk||!advisorEmailOk){setShowReq(true);return;}setSaving(true);const ok=await onSave(f);if(ok===false){setSaving(false);return;}onClose();};
  const pct=pctChange(f.startingBalance,f.currentBalance);
  return <div>
    <Grid2><Field label="Institution" required><Inp placeholder="Merrill Lynch" value={f.institution} onChange={set("institution")}/></Field><Field label="Banker Name" optional><Inp value={f.bankerName||""} onChange={set("bankerName")}/></Field></Grid2>
    <Field label="Account Type"><Sel value={f.accountType} onChange={set("accountType")}>{ACCT_TYPES.map(t=><option key={t}>{t}</option>)}</Sel></Field>
    <Grid2><Field label="Starting Balance" optional><MoneyInput allowNegative value={f.startingBalance||""} onChange={set("startingBalance")}/></Field><Field label="Current Balance" optional><MoneyInput allowNegative value={f.currentBalance||""} onChange={set("currentBalance")}/></Field></Grid2>
    {pct!==null&&<div style={{background:Number(pct)>=0?"#e0f5e9":"#fde8e8",border:`1px solid ${Number(pct)>=0?"#2e9e57":"#d43030"}`,borderRadius:8,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:20}}>{Number(pct)>=0?"📈":"📉"}</span>
      <div style={{fontSize:18,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,color:Number(pct)>=0?"#0d5c2b":"#8b1a1a"}}>{Number(pct)>=0?"+":""}{pct}% performance</div>
    </div>}
    <div style={{fontSize:11,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",margin:"4px 0 8px"}}>Household's advisor on this account</div>
    <Grid2>
      <Field label="Advisor Name" optional><Inp value={f.accountAdvisorName||""} onChange={set("accountAdvisorName")}/></Field>
      <Field label="Advisor Phone" optional>
        <Inp value={f.accountAdvisorPhone||""} onChange={e=>setF(p=>({...p,accountAdvisorPhone:formatPhoneInput(e.target.value)}))} placeholder="(555) 123-4567"/>
        {!advisorPhoneOk&&<div style={{fontSize:11,color:"#b4551f",marginTop:4}}>Enter a valid phone number, or leave it blank.</div>}
      </Field>
      <Field label="Advisor Email" optional>
        <Inp type="email" autoComplete="off" value={f.accountAdvisorEmail||""} onChange={set("accountAdvisorEmail")}/>
        {!advisorEmailOk&&<div style={{fontSize:11,color:"#b4551f",marginTop:4}}>Enter a valid email address, or leave it blank.</div>}
      </Field>
    </Grid2>
    <Field label="Notes" optional><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    {showReq&&<ReqHint/>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Account"}</Btn></div>
  </div>;
}

// ── FAMILY FORM ──────────────────────────────────────────────────────────────
function FamilyForm({initial,onSave,onClose,userProfile,advisors=[]}){
  const isAdmin=userProfile?.role==="admin";
  // plan starts EMPTY on a new family rather than defaulting to one of the tiers. Whoever
  // onboards the household has to say which plan was sold; a pre-selected default would be picked
  // by inaction, and the two tiers are priced differently. On edit, initial.plan is already set.
  const[f,setF]=useState(initial||{
    name:"",
    plan:"",
    advisorName: isAdmin ? "" : (userProfile?.fullName||""),
    advisorEmail: isAdmin ? "" : (userProfile?.email||""),
    notes:""
  });
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const pickAdvisor=e=>{
    const email=e.target.value;
    const adv=advisors.find(a=>a.email===email);
    setF(p=>({...p,advisorEmail:email,advisorName:adv?(adv.full_name||""):""}));
  };
  const stripeLocked=!!(initial&&(initial.stripe_subscription_id||initial.stripeSubscriptionId));
  const canSave=!!f.name.trim()&&PLANS.includes(f.plan);
  const[showReq,setShowReq]=useState(false);
  const save=async()=>{if(!canSave){setShowReq(true);return;}setSaving(true);const ok=await onSave(f);if(ok===false){setSaving(false);return;}onClose();};
  return <div>
    <Field label="Family Name" required><Inp placeholder="The Smith Family" value={f.name} onChange={set("name")}/></Field>
    <Field label="Plan">
      {/* A household paying through Stripe changes plan through Plan requests or its Billing tab, which move the
          subscription too. Changing it here would switch the portal only and leave Stripe billing the old plan. */}
      {stripeLocked&&<div style={{fontSize:12,color:B.textSoft,background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:8,padding:"8px 10px",marginBottom:8,lineHeight:1.5}}>
        This household pays through Stripe, so its plan can't be changed here. Use <strong>Plan requests</strong> (or the household's Billing tab) so billing moves with it.
      </div>}
      <div style={{display:"grid",gap:8}}>
        {PLANS.map(p=>{
          const on=f.plan===p;
          return <button key={p} type="button" disabled={stripeLocked&&!on} onClick={()=>{if(!stripeLocked)setF(prev=>({...prev,plan:p}));}}
            style={{textAlign:"left",padding:"10px 12px",borderRadius:8,cursor:stripeLocked?"default":"pointer",opacity:stripeLocked&&!on?0.45:1,
              border:`1px solid ${on?B.gold:B.border}`,background:on?B.bg:B.white,
              borderLeft:`3px solid ${on?B.gold:"transparent"}`,fontFamily:"'DM Sans',sans-serif"}}>
            <div style={{fontSize:13,fontWeight:700,color:B.navy}}>{planLabel(p)}</div>
            <div style={{fontSize:11,color:B.textSoft,marginTop:2,lineHeight:1.45}}>{PLAN_BLURB[p]}</div>
          </button>;
        })}
      </div>
      {/* Named here rather than discovered as a failed save. Moving a household down a tier while
          it still holds workflows or bill-pay expenses is refused by the database, because that
          data would otherwise sit on file with no screen drawing it. */}
      {initial&&initial.plan==="premier"&&f.plan==="core"&&
        <div style={{marginTop:8,fontSize:11,color:"#8b1a1a",background:"#fde8e8",borderRadius:6,padding:"8px 10px",lineHeight:1.5}}>
          Moving to Core removes the assigned expert, workflows and bill pay. If this household
          already has obligations, open workflows or expenses marked as paid by {BRAND.short}, the
          change will be refused until those are cleared.
        </div>}
    </Field>
    {isAdmin
      ? <Field label="Assign ORDANIS Expert" optional>
          <select value={f.advisorEmail||""} onChange={pickAdvisor} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${B.border}`,fontSize:14,fontFamily:"'DM Sans',sans-serif",background:B.white,color:B.navy}}>
            <option value="">— Select a ORDANIS Expert —</option>
            {advisors.map(a=><option key={a.id} value={a.email}>{(a.full_name||a.email)}{a.full_name?` (${a.email})`:""}</option>)}
          </select>
        </Field>
      : <Field label="ORDANIS Expert"><Inp value={userProfile?.fullName||userProfile?.email||""} disabled/></Field>
    }
    <Field label="Notes" optional><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",alignItems:"center",marginTop:10}}>
      {!canSave&&<span style={{fontSize:11,color:B.textMute,marginRight:"auto"}}>
        {f.name.trim()?"Choose a plan to continue.":"A name and a plan are required."}
      </span>}
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn onClick={save} disabled={saving||!canSave}>{saving?"Saving…":"Save Family"}</Btn>
    </div>
  </div>;
}

// ── FAMILIES LIST VIEW ────────────────────────────────────────────────────────
function printAdvisorReport(adv,data){
  const email=adv.email||"";
  // Same calendar-date handling as fmt(); this formatter had the identical bug.
  const fmtD=d=>{if(!d)return"—";const x=parseLocalDate(d);
    return isNaN(x.getTime())?"—":x.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"});};
  const esc=s=>String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  const families=(data.families||[]).filter(f=>(f.advisorEmail||"")===email&&isActiveFamily(f));
  const famIds=new Set(families.map(f=>f.id));
  const prospects=(data.contacts||[]).filter(c=>!c.familyId&&(c.advisorEmail||"")===email);
  const prospectIds=new Set(prospects.map(c=>c.id));
  const cById=id=>(data.contacts||[]).find(c=>c.id===id);
  const fById=id=>(data.families||[]).find(f=>f.id===id);
  const mine=rec=>rec.familyId?famIds.has(rec.familyId):(rec.contactId&&prospectIds.has(rec.contactId));
  const deals=(data.deals||[]).filter(mine);
  const tasks=(data.tasks||[]).filter(mine);
  const notes=(data.notes||[]).filter(mine).sort((a,b)=>(b.createdAt||"")>(a.createdAt||"")?1:-1);
  const now=new Date();
  const famStat=f=>{
    const props=(data.properties||[]).filter(p=>p.familyId===f.id);
    const accts=(data.portfolio_accounts||[]).filter(a=>a.familyId===f.id);
    const openT=(data.tasks||[]).filter(t=>t.familyId===f.id&&!t.done).length;
    const value=props.reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0)+accts.reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
    return{props:props.length,accts:accts.length,openT,value};
  };
  const aum=families.reduce((s,f)=>s+famStat(f).value,0);
  const openDeals=deals.filter(d=>d.stage!=="Closed Won"&&d.stage!=="Closed Lost");
  const wonDeals=deals.filter(d=>d.stage==="Closed Won");
  const pipelineVal=openDeals.reduce((s,d)=>s+(Number(d.value)||0),0);
  const openTasks=tasks.filter(t=>!t.done);
  const overdue=openTasks.filter(t=>t.dueDate&&dueEnd(t.dueDate)<now);
  const relOf=rec=>rec.familyId?(fById(rec.familyId)?.name||"—"):(cById(rec.contactId)?.name||"—");
  const stat=(l,v)=>`<div class="stat"><div class="stat-l">${l}</div><div class="stat-v">${v}</div></div>`;
  const w=window.open("","_blank");
  w.document.write(`<!DOCTYPE html><html><head><title> </title>
  <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Georgia,serif;color:${B.navy};background:#fff;padding:40px;font-size:13px;line-height:1.6;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid ${B.gold};}
  .logo-img{height:110px;width:auto;display:block;}
  h1{font-size:22px;font-weight:700;margin-bottom:2px;}
  .advisor{font-size:12px;color:#5a6e84;margin-top:4px;}
  .date{font-size:11px;color:#8fa0b2;margin-top:2px;}
  h2{font-size:14px;font-weight:800;color:${B.navy};margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid ${B.gold};letter-spacing:.06em;text-transform:uppercase;}
  table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:12px;}
  th{background:${B.navy};color:${B.gold};padding:6px 10px;text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase;}
  td{padding:6px 10px;border-bottom:1px solid #ede8de;color:#293d5c;vertical-align:top;}
  tr:nth-child(even) td{background:${B.bg};}
  .stats{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px;}
  .stat{background:${B.bg};border-radius:8px;padding:12px 16px;flex:1;min-width:120px;border-top:2px solid ${B.gold};}
  .stat-l{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#8fa0b2;margin-bottom:4px;}
  .stat-v{font-size:18px;font-weight:700;color:${B.navy};}
  .note{padding:8px 0;border-bottom:1px solid #ede8de;}
  .note-meta{font-size:10px;color:#8fa0b2;margin-top:2px;}
  @media print{body{padding:20px;}}
  </style></head><body>
  <div class="header">
    <div><img src="${BRAND.logo}" alt="${BRAND.name}" class="logo-img"/></div>
    <div style="text-align:right"><h1>ORDANIS Expert Activity Report</h1><div class="advisor">${esc(adv.name||email)}${email?` | ${esc(email)}`:""}</div><div class="date">${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div></div>
  </div>
  <div class="stats">
    ${stat("Families",families.length)}${stat("AUM (Est.)",fmtMoney(aum))}${stat("Prospects",prospects.length)}${stat("Open Deals",openDeals.length)}${stat("Pipeline $",fmtMoney(pipelineVal))}${stat("Open Tasks",openTasks.length)}${stat("Overdue",overdue.length)}
  </div>
  <h2>Families (${families.length})</h2>
  <table><thead><tr><th>Family</th><th>Properties</th><th>Accounts</th><th>Est. Value</th><th>Open Tasks</th></tr></thead><tbody>
  ${families.map(f=>{const s=famStat(f);return`<tr><td>${esc(f.name)}</td><td>${s.props}</td><td>${s.accts}</td><td>${fmtMoney(s.value)}</td><td>${s.openT}</td></tr>`;}).join("")||"<tr><td colspan='5' style='color:#8fa0b2'>No families assigned</td></tr>"}
  </tbody></table>
  <h2>Prospects (${prospects.length})</h2>
  <table><thead><tr><th>Name</th><th>Company</th><th>Type</th><th>Email</th><th>Phone</th></tr></thead><tbody>
  ${prospects.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.company)||"—"}</td><td>${esc(c.type)||"—"}</td><td>${esc(c.email)||"—"}</td><td>${esc(c.phone)||"—"}</td></tr>`).join("")||"<tr><td colspan='5' style='color:#8fa0b2'>No prospects</td></tr>"}
  </tbody></table>
  <h2>Pipeline — Open Deals (${openDeals.length}) · Won (${wonDeals.length})</h2>
  <table><thead><tr><th>Deal</th><th>Related To</th><th>Stage</th><th>Value</th><th>Close Date</th></tr></thead><tbody>
  ${deals.sort((a,b)=>(b.value||0)-(a.value||0)).map(d=>`<tr><td>${esc(d.title)}</td><td>${esc(relOf(d))}</td><td>${esc(d.stage)}</td><td>${fmtMoney(d.value)}</td><td>${fmtD(d.closeDate)}</td></tr>`).join("")||"<tr><td colspan='5' style='color:#8fa0b2'>No deals</td></tr>"}
  </tbody></table>
  <h2>Open Tasks (${openTasks.length})</h2>
  <table><thead><tr><th>Task</th><th>Related To</th><th>Priority</th><th>Due Date</th></tr></thead><tbody>
  ${openTasks.sort((a,b)=>(a.dueDate||"")>(b.dueDate||"")?1:-1).map(t=>{const od=t.dueDate&&dueEnd(t.dueDate)<now;return`<tr><td>${esc(t.title)}</td><td>${esc(relOf(t))}</td><td>${esc(t.priority)||"—"}</td><td style="${od?"color:#8b1a1a;font-weight:700":""}">${fmtD(t.dueDate)}${od?" (overdue)":""}</td></tr>`;}).join("")||"<tr><td colspan='4' style='color:#8fa0b2'>No open tasks</td></tr>"}
  </tbody></table>
  <h2>Recent Notes (${Math.min(notes.length,15)} of ${notes.length})</h2>
  ${notes.slice(0,15).map(n=>`<div class="note"><div>${esc(n.body)}</div><div class="note-meta">${esc(relOf(n))} · ${fmtD(n.createdAt)}</div></div>`).join("")||"<p style='color:#8fa0b2'>No notes</p>"}
  </body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),400);
}

function FamiliesView({data,reload,toast,userProfile,navIntent,onNavConsumed}){
  const isMobile=useIsMobile();
  const{families}=data;
  const[advisors,setAdvisors]=useState([]);
  useEffect(()=>{
    if(userProfile?.role==="admin"){
      sb.from("user_profiles").select("id,email,full_name,role").in("role",["advisor","admin"]).then(({data:rows,error})=>{if(!error&&rows)setAdvisors(rows);});
    }
  },[userProfile]);
  const[selected,setSelected]=useState(null);
  // Somewhere else in the app (a bill on the dashboard) can ask for a specific
  // family to be opened on a specific tab. The request is consumed immediately so
  // that going back to the list and picking a different family isn't hijacked by
  // a stale intent still sitting in state.
  const[intentTab,setIntentTab]=useState(null);
  useEffect(()=>{
    if(!navIntent||!navIntent.familyId)return;
    const target=families.find(f=>f.id===navIntent.familyId);
    if(target){setSelected(target);setIntentTab(navIntent.subTab||null);}
    if(onNavConsumed)onNavConsumed();
  },[navIntent,families]);
  const[modal,setModal]=useState(null);
  const[search,setSearch]=useState("");
  const isAdmin=userProfile?.role==="admin";
  const[viewMode,setViewMode]=useState("families"); // admin only: "families" | "advisors"
  const[advisorFilter,setAdvisorFilter]=useState(""); // when set, families list is scoped to this advisor email
  // Archived households are billing-cancelled and login-disabled; they stay in the data (purge is a
  // separate, deliberate step) but are hidden from the working list unless the admin asks for them.
  const[showArchived,setShowArchived]=useState(false);
  const archivedCount=families.filter(f=>f.archived_at||f.archivedAt).length;
  const filtered=useMemo(()=>families.filter(f=>{
    if(!showArchived&&(f.archived_at||f.archivedAt))return false;
    if(advisorFilter&&(f.advisorEmail||"")!==advisorFilter)return false;
    return [f.name,f.advisorName,f.advisorEmail].join(" ").toLowerCase().includes(search.toLowerCase());
  }),[families,search,advisorFilter,showArchived]);

  // Per-advisor roll-up (admin only)
  const advisorSummary=useMemo(()=>{
    const statsFor=f=>{
      const props=(data.properties||[]).filter(p=>p.familyId===f.id);
      const accts=(data.portfolio_accounts||[]).filter(a=>a.familyId===f.id);
      const openTasks=(data.tasks||[]).filter(t=>t.familyId===f.id&&!t.done);
      const overdue=openTasks.filter(t=>t.dueDate&&dueEnd(t.dueDate)<new Date());
      const value=props.reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0)+
                  accts.reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
      return{value,openTasks:openTasks.length,overdue:overdue.length};
    };
    const groups={};
    families.forEach(f=>{
      if(!isActiveFamily(f))return;
      const key=f.advisorEmail||"__unassigned__";
      if(!groups[key])groups[key]={email:f.advisorEmail||"",name:f.advisorName||"Unassigned",unassigned:!f.advisorEmail,families:0,value:0,openTasks:0,overdue:0};
      const st=statsFor(f);
      groups[key].families+=1;groups[key].value+=st.value;groups[key].openTasks+=st.openTasks;groups[key].overdue+=st.overdue;
    });
    advisors.forEach(a=>{if(!groups[a.email])groups[a.email]={email:a.email,name:a.full_name||a.email,unassigned:false,families:0,value:0,openTasks:0,overdue:0};});
    return Object.values(groups).sort((a,b)=>(b.value-a.value)||(b.families-a.families));
  },[families,data,advisors]);

  // advisor_email is written on BOTH plans, including Core. On Core the client is never shown a
  // ORDANIS Expert and no expert-led feature turns on, but somebody at the firm still has to be able
  // to open the household: fetchTable scopes an advisor's families by advisor_email, so a null
  // there would make every Core family invisible to everyone but an admin the moment it was
  // created. Expert of record for access, not a service level.
  const add=async f=>{const{error}=await sb.from("families").insert({name:f.name,plan:f.plan,advisor_name:f.advisorName||null,advisor_email:f.advisorEmail||null,notes:f.notes||null});if(error){toast(error.message,"error");return false;}else{toast("Family added");reload("families");}};
  const edit=async f=>{const{error}=await sb.from("families").update({name:f.name,plan:f.plan,advisor_name:f.advisorName||null,advisor_email:f.advisorEmail||null,notes:f.notes||null}).eq("id",modal.id);if(error){toast(error.message,"error");return false;}else{toast("Updated");reload("families");}};

  // If a family is selected, show its dashboard
  if(selected) return <ViewErrorBoundary label="the family dashboard" onBack={()=>setSelected(null)}>
    <PrivateGate familyId={selected.id} onBack={()=>{setSelected(null);setIntentTab(null);}}><FamilyDashboard family={selected} data={data} reload={reload} toast={toast} onBack={()=>{setSelected(null);setIntentTab(null);}} userProfile={userProfile} initialTab={intentTab}/></PrivateGate>
  </ViewErrorBoundary>;

  const getStats=f=>({
    properties:(data.properties||[]).filter(p=>p.familyId===f.id).length,
    accounts:(data.portfolio_accounts||[]).filter(a=>a.familyId===f.id).length,
    tasks:(data.tasks||[]).filter(t=>t.familyId===f.id&&!t.done).length,
    value:(data.properties||[]).filter(p=>p.familyId===f.id).reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0)+
          (data.portfolio_accounts||[]).filter(a=>a.familyId===f.id).reduce((s,a)=>s+(Number(a.currentBalance)||0),0),
  });

  return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
    {/* On phones the floating menu button sits at the top left of this view, so the header starts to its right. */}
    <div style={{padding:isMobile?"14px 16px 14px 72px":"14px 24px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      {isAdmin&&<div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
        {[{k:"families",l:"Families"},{k:"advisors",l:"By ORDANIS Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"7px 14px",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
      </div>}
      {viewMode==="families"&&<>
        <Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search families…" style={{flex:1,minWidth:160}}/>
        {advisorFilter&&<button onClick={()=>setAdvisorFilter("")} style={{border:`1px solid ${B.gold}`,background:"#fbf6ec",color:B.navy,borderRadius:16,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{(advisorSummary.find(a=>a.email===advisorFilter)?.name)||advisorFilter} ✕</button>}
        {isAdmin&&archivedCount>0&&<button onClick={()=>setShowArchived(v=>!v)} style={{border:`1px solid ${B.borderLight}`,background:showArchived?"#fde8e8":"transparent",color:B.textSoft,borderRadius:16,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{showArchived?"Hide":"Show"} archived ({archivedCount})</button>}
        <Btn onClick={()=>setModal("add")}>+ New Family</Btn>
      </>}
      {viewMode==="advisors"&&<div style={{flex:1,fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>ORDANIS Expert Summary</div>}
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"16px 24px"}}>
      {viewMode==="advisors"&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(320px,100%),1fr))",gap:16}}>
        {advisorSummary.length===0&&<Empty text="No ORDANIS Experts or families yet."/>}
        {advisorSummary.map(a=>(
          <div key={a.email||"unassigned"} onClick={()=>{if(!a.unassigned){setAdvisorFilter(a.email);setViewMode("families");}}}
            style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${a.unassigned?B.textMute:B.gold}`,padding:20,cursor:a.unassigned?"default":"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
            onMouseEnter={e=>{if(!a.unassigned)e.currentTarget.style.boxShadow=B.shadowMd;}}
            onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
            <div style={{marginBottom:12}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:a.unassigned?B.textMute:B.navy,fontWeight:600,marginBottom:2}}>{a.name}</div>
              <div style={{fontSize:12,color:B.textSoft}}>{a.email||"Families with no ORDANIS Expert assigned"}</div>
            </div>
            <div style={{height:1,background:`linear-gradient(90deg,${a.unassigned?B.textMute:B.gold},transparent)`,marginBottom:12}}/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(170px,100%),1fr))",gap:8}}>
              {[{l:"AUM (Est.)",v:fmtMoney(a.value)},{l:"Families",v:a.families},{l:"Open Tasks",v:a.openTasks},{l:"Overdue",v:a.overdue}].map(item=>(
                <div key={item.l} style={{background:B.bg,borderRadius:6,padding:"8px 10px"}}>
                  <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{item.l}</div>
                  <div style={{fontSize:15,fontFamily:"'Cormorant Garamond',serif",color:item.l==="Overdue"&&a.overdue>0?"#8b1a1a":B.navy,fontWeight:600}}>{item.v}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              {!a.unassigned&&<div style={{fontSize:12,color:B.gold,fontWeight:600}}>View families →</div>}
              <button onClick={e=>{e.stopPropagation();printAdvisorReport(a,data);}} style={{marginLeft:"auto",border:`1px solid ${B.navy}`,background:B.white,color:B.navy,borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>🖨 Print Report</button>
            </div>
          </div>
        ))}
      </div>}
      {viewMode!=="advisors"&&<>
      {filtered.length===0&&<Empty text={advisorFilter?"No families for this ORDANIS Expert.":"No families yet. Add your first one."}/>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(300px,100%),1fr))",gap:16}}>
        {filtered.map(f=>{
          const s=getStats(f);
          const overdue=(data.tasks||[]).filter(t=>t.familyId===f.id&&!t.done&&t.dueDate&&dueEnd(t.dueDate)<new Date()).length;
          return <div key={f.id} onClick={()=>setSelected(f)} style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${B.gold}`,padding:20,cursor:"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
            onMouseEnter={e=>e.currentTarget.style.boxShadow=B.shadowMd}
            onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600}}>{f.name}</div>
                  {/* Gold for Premier, quiet grey for Core — the badge should read as a tier, not
                      as a warning. */}
                  <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
                    padding:"3px 7px",borderRadius:4,
                    background:planAllows(f.plan,"workflows")?B.gold:B.borderLight,
                    color:planAllows(f.plan,"workflows")?B.navy:B.textSoft}}>{planLabel(f.plan)}</span>
                </div>
                {/* On Basic/Core there is no assigned expert to name -- both are self-directed, so the
                    row says that instead of showing the expert-of-record we keep for access. */}
                <div style={{fontSize:12,color:B.textSoft}}>
                  {planAllows(f.plan,"assignedExpert")
                    ? (f.advisorName||"No ORDANIS Expert assigned")
                    : "Self-directed"}
                </div>
              </div>
              <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                <Btn small variant="ghost" onClick={()=>setModal(f)}>Edit</Btn>
              </div>
            </div>
            <div style={{height:1,background:`linear-gradient(90deg,${B.gold},transparent)`,marginBottom:12}}/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(280px,100%),1fr))",gap:8,marginBottom:12}}>
              {[{l:"Est. Value",v:fmtMoney(s.value)},{l:"Properties",v:s.properties},{l:"Accounts",v:s.accounts},{l:"Open Tasks",v:s.tasks}].map(item=><div key={item.l} style={{background:B.bg,borderRadius:6,padding:"8px 10px"}}>
                <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{item.l}</div>
                <div style={{fontSize:15,fontFamily:"'Cormorant Garamond',serif",color:B.navy,fontWeight:600}}>{item.v}</div>
              </div>)}
            </div>
            {overdue>0&&<Badge scheme={{bg:"#fde8e8",text:"#8b1a1a",dot:"#d43030"}}>{overdue} overdue task{overdue>1?"s":""}</Badge>}
            <div style={{marginTop:10,fontSize:12,color:B.gold,fontWeight:600}}>Click to open dashboard →</div>
          </div>;
        })}
      </div>
      </>}
    </div>
    {modal==="add"&&<Modal title="New Family" onClose={()=>setModal(null)}><FamilyForm userProfile={userProfile} advisors={advisors} onSave={add} onClose={()=>setModal(null)}/></Modal>}
    {modal&&modal!=="add"&&<Modal title="Edit Family" onClose={()=>setModal(null)}><FamilyForm initial={modal} userProfile={userProfile} advisors={advisors} onSave={edit} onClose={()=>setModal(null)}/></Modal>}
  </div>;
}

// ── STAFF: ONE HOUSEHOLD, LOADED WHEN OPENED (scaling step 2) ─────────────────
// Loads the household's records when it is opened and hands them to the same FamilyDashboard the old full download
// fed. reload(table) refreshes that table for this household only.
function StaffHousehold({family,userProfile,toast,onBack,initialTab,onFamilyChanged}){
  const[bundle,setBundle]=useState(null);
  const[err,setErr]=useState("");
  const famRef=useRef(family);
  const loadAll=useCallback(async()=>{
    try{setBundle(await loadHouseholdBundle(famRef.current));setErr("");}
    catch(e){setErr(e.message||"Could not open this household.");}
  },[]);
  useEffect(()=>{loadAll();},[loadAll]);
  const reload=useCallback(async table=>{
    try{
      if(!table){await loadAll();return;}
      if(table==="families"){
        const{data:row,error}=await sb.from("families").select("*").eq("id",famRef.current.id).maybeSingle();
        if(error)throw error;
        if(row){famRef.current=toClient(row);setBundle(b=>b&&{...b,families:[famRef.current]});if(onFamilyChanged)onFamilyChanged(famRef.current);}
        return;
      }
      if(table==="note_attachments"){
        const ids=(bundle?.notes||[]).map(n=>n.id);
        const rows=await loadNoteAttachments(ids);
        setBundle(b=>b&&{...b,note_attachments:rows});
        return;
      }
      if(!FAMILY_SCOPED.includes(table))return;
      const rows=(await fetchAllRows(()=>sb.from(table).select("*").eq("family_id",famRef.current.id).order("created_at",{ascending:false}).order("id"))).map(toClient);
      setBundle(b=>b&&{...b,[table]:rows});
    }catch(e){toast(`Error loading ${table||"this household"}`,"error");}
  },[loadAll,bundle,toast,onFamilyChanged]);
  if(err)return <div style={{padding:40,textAlign:"center"}}><div style={{color:"#8b1a1a",marginBottom:14}}>{err}</div><Btn onClick={onBack}>Back to families</Btn></div>;
  if(!bundle)return <Spinner/>;
  return <ViewErrorBoundary label="the family dashboard" onBack={onBack}>
    <PrivateGate familyId={family.id} onBack={onBack}><FamilyDashboard family={bundle.families[0]} data={bundle} reload={reload} toast={toast} onBack={onBack} userProfile={userProfile} initialTab={initialTab}/></PrivateGate>
  </ViewErrorBoundary>;
}

// ── STAFF: FAMILIES LIST, ONE PAGE AT A TIME (scaling step 2) ─────────────────
// Used instead of FamiliesView when platform_config.staff_on_demand is on. The list, its counts, search and the Expert
// filter come from staff_household_page (runs as the signed-in person, so the same access rules apply); the admin
// "By ORDANIS Expert" cards from staff_expert_rollup.
const FAMILIES_PAGE=50;
function FamiliesPagedView({userProfile,toast,navIntent,onNavConsumed}){
  const isMobile=useIsMobile();
  const isAdmin=userProfile?.role==="admin";
  const[advisors,setAdvisors]=useState([]);
  useEffect(()=>{
    if(isAdmin)sb.from("user_profiles").select("id,email,full_name,role").in("role",["advisor","admin"]).then(({data:rows,error})=>{if(!error&&rows)setAdvisors(rows);});
  },[isAdmin]);
  const[selected,setSelected]=useState(null);
  const[intentTab,setIntentTab]=useState(null);
  useEffect(()=>{
    if(!navIntent||!navIntent.familyId)return;
    sb.from("families").select("*").eq("id",navIntent.familyId).maybeSingle().then(({data:row})=>{
      if(row){setSelected(toClient(row));setIntentTab(navIntent.subTab||null);}
    });
    if(onNavConsumed)onNavConsumed();
  },[navIntent]);
  const[modal,setModal]=useState(null);
  const[search,setSearch]=useState("");
  const[query,setQuery]=useState("");
  useEffect(()=>{const t=setTimeout(()=>setQuery(search.trim()),300);return()=>clearTimeout(t);},[search]);
  const[viewMode,setViewMode]=useState("families");
  const[advisorFilter,setAdvisorFilter]=useState("");
  const[showArchived,setShowArchived]=useState(false);
  const[sort,setSort]=useState("name");
  const[page,setPage]=useState(0);
  useEffect(()=>{setPage(0);},[query,advisorFilter,showArchived,sort]);
  const[rows,setRows]=useState([]);
  const[total,setTotal]=useState(0);
  const[loading,setLoading]=useState(true);
  const[archivedCount,setArchivedCount]=useState(0);
  const[rollup,setRollup]=useState([]);
  const[nonce,setNonce]=useState(0);
  const refresh=()=>setNonce(n=>n+1);
  useEffect(()=>{
    let gone=false;
    setLoading(true);
    sb.rpc("staff_household_page",{p_search:query||null,p_expert:advisorFilter||null,p_show_archived:showArchived,p_sort:sort,p_limit:FAMILIES_PAGE,p_offset:page*FAMILIES_PAGE,p_today:localISODate()}).then(({data,error})=>{
      if(gone)return;
      if(error){toast("Could not load families","error");setLoading(false);return;}
      setRows((data||[]).map(r=>({fam:toClient(r.family),properties:Number(r.properties)||0,accounts:Number(r.accounts)||0,tasks:Number(r.open_tasks)||0,overdue:Number(r.overdue)||0,value:Number(r.value)||0})));
      setTotal(Number((data||[])[0]?.total_count)||0);
      setLoading(false);
    });
    return()=>{gone=true;};
  },[query,advisorFilter,showArchived,sort,page,nonce]);
  useEffect(()=>{
    if(!isAdmin)return;
    sb.from("families").select("id",{count:"exact",head:true}).not("archived_at","is",null).then(({count})=>setArchivedCount(count||0));
  },[isAdmin,nonce]);
  useEffect(()=>{
    if(!isAdmin||viewMode!=="advisors")return;
    sb.rpc("staff_expert_rollup",{p_today:localISODate()}).then(({data,error})=>{
      if(error){toast("Could not load the ORDANIS Expert summary","error");return;}
      const groups={};
      (data||[]).forEach(r=>{const key=r.email||"__unassigned__";groups[key]={email:r.email||"",name:r.email?r.name:"Unassigned",unassigned:!r.email,families:Number(r.families)||0,value:Number(r.value)||0,openTasks:Number(r.open_tasks)||0,overdue:Number(r.overdue)||0};});
      advisors.forEach(a=>{if(!groups[a.email])groups[a.email]={email:a.email,name:a.full_name||a.email,unassigned:false,families:0,value:0,openTasks:0,overdue:0};});
      setRollup(Object.values(groups).sort((a,b)=>(b.value-a.value)||(b.families-a.families)));
    });
  },[isAdmin,viewMode,advisors,nonce]);
  // The print report needs that Expert's households and their records: loaded when asked for, not at sign-in.
  const printReport=async a=>{
    try{
      const fams=(await fetchAllRows(()=>sb.from("families").select("*").eq("advisor_email",a.email).is("archived_at",null).order("name").order("id"))).map(toClient);
      const t=await loadFamiliesTables(fams.map(f=>f.id),["contacts","deals","tasks","notes","properties","portfolio_accounts"]);
      printAdvisorReport(a,{families:fams,...t});
    }catch(e){toast(e.message||"Could not build the report","error");}
  };
  const add=async f=>{const{error}=await sb.from("families").insert({name:f.name,plan:f.plan,advisor_name:f.advisorName||null,advisor_email:f.advisorEmail||null,notes:f.notes||null});if(error){toast(error.message,"error");return false;}else{toast("Family added");refresh();}};
  const edit=async f=>{const{error}=await sb.from("families").update({name:f.name,plan:f.plan,advisor_name:f.advisorName||null,advisor_email:f.advisorEmail||null,notes:f.notes||null}).eq("id",modal.id);if(error){toast(error.message,"error");return false;}else{toast("Updated");refresh();}};
  const back=()=>{setSelected(null);setIntentTab(null);refresh();};

  if(selected)return <StaffHousehold key={selected.id} family={selected} userProfile={userProfile} toast={toast} onBack={back} initialTab={intentTab}/>;

  const pages=Math.max(1,Math.ceil(total/FAMILIES_PAGE));
  const pill=on=>({border:`1px solid ${on?B.gold:B.borderLight}`,background:on?"#fbf6ec":"transparent",color:on?B.navy:B.textSoft,borderRadius:16,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"});
  return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
    <div style={{padding:isMobile?"14px 16px 14px 72px":"14px 24px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      {isAdmin&&<div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
        {[{k:"families",l:"Families"},{k:"advisors",l:"By ORDANIS Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"7px 14px",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.white:"transparent",color:viewMode===t.k?B.navy:B.textSoft,boxShadow:viewMode===t.k?B.shadow:"none"}}>{t.l}</button>)}
      </div>}
      {viewMode==="families"&&<>
        <Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search families…" style={{flex:1,minWidth:160}}/>
        <button onClick={()=>setSort(s=>s==="name"?"urgent":"name")} style={pill(sort==="urgent")} title="Change the order of the list">{sort==="urgent"?"Most urgent first":"A–Z"}</button>
        {advisorFilter&&<button onClick={()=>setAdvisorFilter("")} style={pill(true)}>{advisorFilter} ✕</button>}
        {isAdmin&&archivedCount>0&&<button onClick={()=>setShowArchived(v=>!v)} style={{...pill(false),background:showArchived?"#fde8e8":"transparent"}}>{showArchived?"Hide":"Show"} archived ({archivedCount})</button>}
        <Btn onClick={()=>setModal("add")}>+ New Family</Btn>
      </>}
      {viewMode==="advisors"&&<div style={{flex:1,fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>ORDANIS Expert Summary</div>}
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"16px 24px"}}>
      {viewMode==="advisors"&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(320px,100%),1fr))",gap:16}}>
        {rollup.length===0&&<Empty text="No ORDANIS Experts or families yet."/>}
        {rollup.map(a=><div key={a.email||"unassigned"} onClick={()=>{if(!a.unassigned){setAdvisorFilter(a.email);setViewMode("families");}}}
          style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${a.unassigned?B.textMute:B.gold}`,padding:20,cursor:a.unassigned?"default":"pointer",boxShadow:B.shadow}}>
          <div style={{marginBottom:12}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:a.unassigned?B.textMute:B.navy,fontWeight:600,marginBottom:2}}>{a.name}</div>
            <div style={{fontSize:12,color:B.textSoft}}>{a.email||"Families with no ORDANIS Expert assigned"}</div>
          </div>
          <div style={{height:1,background:`linear-gradient(90deg,${a.unassigned?B.textMute:B.gold},transparent)`,marginBottom:12}}/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(170px,100%),1fr))",gap:8}}>
            {[{l:"AUM (Est.)",v:fmtMoney(a.value)},{l:"Families",v:a.families},{l:"Open Tasks",v:a.openTasks},{l:"Overdue",v:a.overdue}].map(item=><div key={item.l} style={{background:B.bg,borderRadius:6,padding:"8px 10px"}}>
              <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{item.l}</div>
              <div style={{fontSize:15,fontFamily:"'Cormorant Garamond',serif",color:item.l==="Overdue"&&a.overdue>0?"#8b1a1a":B.navy,fontWeight:600}}>{item.v}</div>
            </div>)}
          </div>
          <div style={{marginTop:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
            {!a.unassigned&&<div style={{fontSize:12,color:B.gold,fontWeight:600}}>View families →</div>}
            {!a.unassigned&&<button onClick={e=>{e.stopPropagation();printReport(a);}} style={{marginLeft:"auto",border:`1px solid ${B.navy}`,background:B.white,color:B.navy,borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>🖨 Print Report</button>}
          </div>
        </div>)}
      </div>}
      {viewMode!=="advisors"&&<>
        {loading&&rows.length===0&&<Spinner/>}
        {!loading&&rows.length===0&&<Empty text={query?"No families match that search.":advisorFilter?"No families for this ORDANIS Expert.":"No families yet. Add your first one."}/>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(300px,100%),1fr))",gap:16,opacity:loading?0.6:1}}>
          {rows.map(({fam:f,...s})=><div key={f.id} onClick={()=>setSelected(f)} style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${B.gold}`,padding:20,cursor:"pointer",boxShadow:B.shadow}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600}}>{f.name}</div>
                  <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",padding:"3px 7px",borderRadius:4,background:planAllows(f.plan,"workflows")?B.gold:B.borderLight,color:planAllows(f.plan,"workflows")?B.navy:B.textSoft}}>{planLabel(f.plan)}</span>
                  {(f.archived_at||f.archivedAt)&&<span style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",padding:"3px 7px",borderRadius:4,background:"#fde8e8",color:"#8b1a1a"}}>Archived</span>}
                </div>
                <div style={{fontSize:12,color:B.textSoft}}>{planAllows(f.plan,"assignedExpert")?(f.advisorName||"No ORDANIS Expert assigned"):"Self-directed"}</div>
              </div>
              <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}><Btn small variant="ghost" onClick={()=>setModal(f)}>Edit</Btn></div>
            </div>
            <div style={{height:1,background:`linear-gradient(90deg,${B.gold},transparent)`,marginBottom:12}}/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(280px,100%),1fr))",gap:8,marginBottom:12}}>
              {[{l:"Est. Value",v:fmtMoney(s.value)},{l:"Properties",v:s.properties},{l:"Accounts",v:s.accounts},{l:"Open Tasks",v:s.tasks}].map(item=><div key={item.l} style={{background:B.bg,borderRadius:6,padding:"8px 10px"}}>
                <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{item.l}</div>
                <div style={{fontSize:15,fontFamily:"'Cormorant Garamond',serif",color:B.navy,fontWeight:600}}>{item.v}</div>
              </div>)}
            </div>
            {s.overdue>0&&<Badge scheme={{bg:"#fde8e8",text:"#8b1a1a",dot:"#d43030"}}>{s.overdue} overdue task{s.overdue>1?"s":""}</Badge>}
            <div style={{marginTop:10,fontSize:12,color:B.gold,fontWeight:600}}>Click to open dashboard →</div>
          </div>)}
        </div>
        {total>FAMILIES_PAGE&&<div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:12,margin:"20px 0 8px"}}>
          <Btn small variant="ghost" disabled={page===0||loading} onClick={()=>setPage(p=>Math.max(0,p-1))}>← Previous</Btn>
          <span style={{fontSize:13,color:B.textSoft}}>Page {page+1} of {pages} · {total.toLocaleString()} families</span>
          <Btn small variant="ghost" disabled={page>=pages-1||loading} onClick={()=>setPage(p=>Math.min(pages-1,p+1))}>Next →</Btn>
        </div>}
      </>}
    </div>
    {modal==="add"&&<Modal title="New Family" onClose={()=>setModal(null)}><FamilyForm userProfile={userProfile} advisors={advisors} onSave={add} onClose={()=>setModal(null)}/></Modal>}
    {modal&&modal!=="add"&&<Modal title="Edit Family" onClose={()=>setModal(null)}><FamilyForm initial={modal} userProfile={userProfile} advisors={advisors} onSave={edit} onClose={()=>setModal(null)}/></Modal>}
  </div>;
}

// ── PORTFOLIO ACCOUNT FORM (top-level) ──────────────────────────────────────
function PortfolioAccountForm({initial,families=[],onSave,onClose}){
  const[f,setF]=useState(initial||{familyId:"",institution:"",bankerName:"",accountType:"Investment",startingBalance:"",currentBalance:"",notes:""});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const[showReq,setShowReq]=useState(false);
  const save=async()=>{if(!f.institution.trim()){setShowReq(true);return;}setSaving(true);const ok=await onSave(f);if(ok===false){setSaving(false);return;}onClose();};
  const pct=pctChange(f.startingBalance,f.currentBalance);
  return <div>
    {families.length>0&&<Field label="Family"><Sel value={f.familyId||""} onChange={set("familyId")}><option value="">— No family —</option>{families.map(fm=><option key={fm.id} value={fm.id}>{fm.name}</option>)}</Sel></Field>}
    <Grid2><Field label="Institution" required><Inp placeholder="Merrill Lynch" value={f.institution} onChange={set("institution")}/></Field><Field label="Banker Name" optional><Inp value={f.bankerName||""} onChange={set("bankerName")}/></Field></Grid2>
    <Field label="Account Type"><Sel value={f.accountType} onChange={set("accountType")}>{ACCT_TYPES.map(t=><option key={t}>{t}</option>)}</Sel></Field>
    <Grid2><Field label="Starting Balance" optional><MoneyInput allowNegative value={f.startingBalance||""} onChange={set("startingBalance")}/></Field><Field label="Current Balance" optional><MoneyInput allowNegative value={f.currentBalance||""} onChange={set("currentBalance")}/></Field></Grid2>
    {pct!==null&&<div style={{background:Number(pct)>=0?"#e0f5e9":"#fde8e8",border:`1px solid ${Number(pct)>=0?"#2e9e57":"#d43030"}`,borderRadius:8,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:20}}>{Number(pct)>=0?"📈":"📉"}</span><div style={{fontSize:18,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,color:Number(pct)>=0?"#0d5c2b":"#8b1a1a"}}>{Number(pct)>=0?"+":""}{pct}% performance</div></div>}
    <Field label="Notes" optional><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    {showReq&&<ReqHint/>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</Btn></div>
  </div>;
}

// ── PORTFOLIO VIEW (global) ───────────────────────────────────────────────────
function PortfolioView({data,reload,toast,userProfile,hideScope}){
  const isMobile=useIsMobile();
  const{portfolio_accounts=[]}=data;
  const families=(data.families||[]).filter(isActiveFamily);
  const[modal,setModal]=useState(null);
  const[filterFamily,setFilterFamily]=useState("all");
  const[advScope,setAdvScope]=useState("");
  const[selected,setSelected]=useState(null);
  const gf=id=>families.find(f=>f.id===id);
  const accounts=portfolio_accounts.filter(a=>(filterFamily==="all"||a.familyId===filterFamily)&&(!advScope||(gf(a.familyId)?.advisorEmail||"").toLowerCase()===advScope));
  const totalValue=accounts.reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const totalStart=accounts.reduce((s,a)=>s+(Number(a.startingBalance)||0),0);
  const totalPct=totalStart>0?(((totalValue-totalStart)/totalStart)*100).toFixed(2):null;

  const add=async f=>{const{error}=await sb.from("portfolio_accounts").insert({family_id:f.familyId||null,institution:f.institution,banker_name:f.bankerName||null,account_type:f.accountType,starting_balance:numOrNull(f.startingBalance),current_balance:numOrNull(f.currentBalance),notes:f.notes||null});if(error){toast(error.message,"error");return false;}else{toast("Account added. Your record is looking more complete.");reload("portfolio_accounts");}};
  const edit=async f=>{const{error}=await sb.from("portfolio_accounts").update({family_id:f.familyId||null,institution:f.institution,banker_name:f.bankerName||null,account_type:f.accountType,starting_balance:numOrNull(f.startingBalance),current_balance:numOrNull(f.currentBalance),notes:f.notes||null}).eq("id",modal.id);if(error){toast(error.message,"error");return false;}else{toast("Updated");reload("portfolio_accounts");setSelected({...selected,...f});}};
  const del=async id=>{if(!confirm("Delete this account? This can't be undone."))return;const{error}=await sb.from("portfolio_accounts").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Deleted");reload("portfolio_accounts");if(selected?.id===id)setSelected(null);}};

  return <div style={{display:"flex",height:"100%",minHeight:0}}>
    {/* List (hidden on mobile when detail is showing) */}
    {(!isMobile||!selected)&&<div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",borderRight:isMobile?"none":`1px solid ${B.borderLight}`}}>
      <div style={{padding:isMobile?"10px 14px":"12px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <Sel value={filterFamily} onChange={e=>setFilterFamily(e.target.value)} style={{width:isMobile?"100%":200,order:isMobile?2:0}}><option value="all">All Families</option>{families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Sel>
        {!hideScope&&<AdvisorScopeBar userProfile={userProfile} value={advScope} onChange={setAdvScope}/>}
        <div style={{flex:1,fontSize:12,color:B.textSoft,order:isMobile?1:0}}>Total: <strong style={{color:B.navy}}>{fmtMoney(totalValue)}</strong>{totalPct!==null&&<span style={{color:Number(totalPct)>=0?"#18a850":"#d43030",fontWeight:700,marginLeft:8}}>{Number(totalPct)>=0?"+":""}{totalPct}%</span>}</div>
        <Btn onClick={()=>setModal("add")}>+ New Account</Btn>
      </div>
      <div style={{overflowY:"auto",flex:1}}>
        {accounts.length===0&&<Empty text="No portfolio accounts yet. Add one to start building the picture."/>}
        {ACCT_TYPES.map(type=>{
          const list=accounts.filter(a=>a.accountType===type);
          if(!list.length)return null;
          return <div key={type}>
            <div style={{padding:isMobile?"10px 14px 4px":"10px 20px 4px",display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:11,fontWeight:800,color:B.textMute,letterSpacing:"0.1em",textTransform:"uppercase"}}>{type}</span>
              <span style={{fontSize:11,color:B.textSoft,fontWeight:700}}>{fmtMoney(list.reduce((s,a)=>s+(Number(a.currentBalance)||0),0))}</span>
            </div>
            {list.map(a=>{const pct=pctChange(a.startingBalance,a.currentBalance);const fam=gf(a.familyId);return <div key={a.id} onClick={()=>setSelected(a)} style={{padding:isMobile?"14px 14px":"12px 20px",cursor:"pointer",borderBottom:`1px solid ${B.borderLight}`,background:selected?.id===a.id?B.bg:B.white,borderLeft:`3px solid ${B.gold}`}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
                <div style={{minWidth:0}}><div style={{fontWeight:700,color:B.navy,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.institution}</div><div style={{fontSize:12,color:B.textSoft,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.bankerName?`${a.bankerName} · `:""}{fam?fam.name:""}</div></div>
                <div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:14,fontWeight:700,color:B.navy}}>{fmtMoney(a.currentBalance)}</div>{pct!==null&&<div style={{fontSize:11,fontWeight:700,color:Number(pct)>=0?"#18a850":"#d43030"}}>{Number(pct)>=0?"+":""}{pct}%</div>}</div>
              </div>
            </div>;})}
          </div>;
        })}
      </div>
    </div>}
    {/* Detail panel — full width on mobile, fixed sidebar on desktop */}
    {selected?(
      <div style={{width:isMobile?"100%":360,overflowY:"auto",flexShrink:0,background:B.bg,padding:isMobile?16:22}}>
        {isMobile&&<button onClick={()=>setSelected(null)} style={{background:"none",border:`1px solid ${B.border}`,color:B.textSoft,cursor:"pointer",fontSize:13,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:6,marginBottom:14}}>← Back</button>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,gap:10}}>
          <div style={{minWidth:0}}><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{selected.institution}</div><div style={{fontSize:12,color:B.textSoft}}>{selected.accountType}</div></div>
          <div style={{display:"flex",gap:6,flexShrink:0}}><Btn small variant="ghost" onClick={()=>setModal(selected)}>Edit</Btn><Btn small variant="danger" onClick={()=>del(selected.id)}>Delete</Btn></div>
        </div>
        <div style={{height:2,background:`linear-gradient(90deg,${B.gold},transparent)`,marginBottom:14}}/>
        {(()=>{const pct=pctChange(selected.startingBalance,selected.currentBalance);const gain=(Number(selected.currentBalance)||0)-(Number(selected.startingBalance)||0);return pct!==null&&<div style={{background:Number(pct)>=0?"#e0f5e9":"#fde8e8",border:`1px solid ${Number(pct)>=0?"#2e9e57":"#d43030"}`,borderRadius:10,padding:"14px 18px",marginBottom:16,display:"flex",gap:14,alignItems:"center"}}><div style={{fontSize:28}}>{Number(pct)>=0?"📈":"📉"}</div><div><div style={{fontSize:24,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,color:Number(pct)>=0?"#0d5c2b":"#8b1a1a"}}>{Number(pct)>=0?"+":""}{pct}%</div><div style={{fontSize:12,color:Number(pct)>=0?"#18a850":"#d43030",fontWeight:700}}>{Number(gain)>=0?"+":"-"}{fmtMoney(Math.abs(gain))}</div></div></div>;})()}
        <IRow label="Family" value={gf(selected.familyId)?.name||"—"}/>
        <IRow label="Banker" value={selected.bankerName||"—"}/>
        <IRow label="Starting Balance" value={fmtMoney(selected.startingBalance)}/>
        <IRow label="Current Balance" value={fmtMoney(selected.currentBalance)}/>
        {selected.notes&&<><SectionLabel>Notes</SectionLabel><div style={{fontSize:13,color:B.textMid,lineHeight:1.6}}>{selected.notes}</div></>}
      </div>
    ):(!isMobile&&<div style={{width:360,display:"flex",alignItems:"center",justifyContent:"center",color:B.textMute,fontSize:13,background:B.bg}}>Select an account</div>)}
    {modal==="add"&&<Modal title="New Portfolio Account" onClose={()=>setModal(null)}><PortfolioAccountForm families={families} onSave={add} onClose={()=>setModal(null)}/></Modal>}
    {modal&&modal!=="add"&&<Modal title="Edit Portfolio Account" onClose={()=>setModal(null)}><PortfolioAccountForm initial={modal} families={families} onSave={edit} onClose={()=>setModal(null)}/></Modal>}
  </div>;
}

// ── NOTES VIEW ────────────────────────────────────────────────────────────────
function NotesView({data,reload,toast,userProfile,prospectMode=false,hideScope}){
  const isMobile=useIsMobile();
  const{contacts,families,notes}=data;
  const noteAttachments=data.note_attachments||[];
  const[body,setBody]=useState("");const[cid,setCid]=useState("");const[fid,setFid]=useState("");const[search,setSearch]=useState("");const[saving,setSaving]=useState(false);
  const[editId,setEditId]=useState(null);const[editBody,setEditBody]=useState("");
  const[pendingFiles,setPendingFiles]=useState([]);
  const gc=id=>contacts.find(c=>c.id===id);const gf=id=>families.find(f=>f.id===id);
  const adminProspect=prospectMode&&userProfile?.role==="admin";
  const[viewMode,setViewMode]=useState("notes");
  const[advisorFilter,setAdvisorFilter]=useState("");
  const[advisors,setAdvisors]=useState([]);
  useEffect(()=>{if(adminProspect){sb.from("user_profiles").select("id,email,full_name,role").in("role",["advisor","admin"]).then(({data:rows,error})=>{if(!error&&rows)setAdvisors(rows);});}},[adminProspect]);
  const advisorOfNote=n=>{const c=contacts.find(x=>x.id===n.contactId);return c&&c.advisorEmail?{email:c.advisorEmail,name:c.advisorName||c.advisorEmail}:null;};
  const[cmAdvScope,setCmAdvScope]=useState("");
  // NOTES_FAMILY_FILTER
  // Free-text search already matches the family name, but it also matches any note
  // whose body happens to mention them, so it cannot answer "show me only this
  // household". This is an explicit scope, kept separate from search so the two
  // compose: pick a family, then search within it.
  const[noteFamilyFilter,setNoteFamilyFilter]=useState("");
  // NOTES_CONSOLIDATED
  // Which notes are open. A Set rather than a single id, because reading a hub
  // usually means opening two or three and comparing them - closing one to see
  // another would make that impossible.
  const[openNotes,setOpenNotes]=useState(()=>new Set());
  const toggleNote=id=>setOpenNotes(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});
  const advisorSummary=useMemo(()=>{
    const groups={};
    notes.forEach(n=>{
      const c=contacts.find(x=>x.id===n.contactId);
      const adv=c&&c.advisorEmail?{email:c.advisorEmail,name:c.advisorName||c.advisorEmail}:null;
      const key=adv?adv.email:"__unassigned__";
      if(!groups[key])groups[key]={email:adv?adv.email:"",name:adv?adv.name:"Unassigned",unassigned:!adv,notes:0,contacts:new Set()};
      groups[key].notes+=1; if(n.contactId)groups[key].contacts.add(n.contactId);
    });
    advisors.forEach(a=>{if(!groups[a.email])groups[a.email]={email:a.email,name:a.full_name||a.email,unassigned:false,notes:0,contacts:new Set()};});
    return Object.values(groups).map(g=>({...g,contacts:g.contacts.size})).sort((a,b)=>b.notes-a.notes);
  },[notes,contacts,advisors]);
  const uploadAttachment=async(noteId,file,category,familyIdForPath)=>{
    const ext=file.name.split(".").pop();
    // Household folder first, for the same reason as the household Notes tab (see addNote's path).
    const path=`${familyIdForPath||"general"}/note-attachments/${Date.now()}_${Math.random().toString(36).slice(2,8)}_${file.name.replace(/[^A-Za-z0-9._-]+/g,"_")}`;
    const{error:uploadError}=await sb.storage.from("documents").upload(path,file,{upsert:false});
    if(uploadError)throw new Error(uploadError.message);
    const{error:dbError}=await sb.from("note_attachments").insert({note_id:noteId,name:file.name,category:category||"General",file_path:path,file_size:file.size,file_type:file.type||ext});
    if(dbError)throw new Error(dbError.message);
  };
  const add=async()=>{
    if(!body.trim())return;
    setSaving(true);
    const{data:noteRow,error}=await sb.from("notes").insert({body,contact_id:cid||null,family_id:fid||null}).select().single();
    if(error){toast(error.message,"error");setSaving(false);return;}
    if(pendingFiles.length>0&&noteRow){
      try{
        for(const pf of pendingFiles){await uploadAttachment(noteRow.id,pf.file,pf.category,fid);}
        toast(`Note added with ${pendingFiles.length} attachment${pendingFiles.length>1?"s":""}`);
      }catch(e){toast("Note saved but attachment failed: "+e.message,"error");}
    }else{
      toast("Note saved. Thanks for keeping this up to date.");
    }
    setBody("");setPendingFiles([]);setSaving(false);
    reload("notes");reload("note_attachments");
  };
  const del=async id=>{if(!confirm("Delete this note? This can't be undone."))return;const{error}=await sb.from("notes").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Deleted");reload("notes");reload("note_attachments");}};
  const saveEdit=async id=>{if(!editBody.trim())return;const{error}=await sb.from("notes").update({body:editBody}).eq("id",id);if(error)toast(error.message,"error");else{toast("Note updated. All saved.");setEditId(null);setEditBody("");reload("notes");}};
  const download=async(att)=>{
    if(!await firmDocGate(att.filePath,att.name,"download_document")){toast(FIRM_GATE_MSG,"error");return;}
    const{data,error}=await sb.storage.from("documents").createSignedUrl(att.filePath,300,{download:att.name||true});
    if(error){toast(error.message,"error");return;}
    const a=document.createElement("a");a.href=data.signedUrl;a.download=att.name||"file";document.body.appendChild(a);a.click();document.body.removeChild(a);
  };
  const delAtt=async(att)=>{
    await sb.storage.from("documents").remove([att.filePath]);
    const{error}=await sb.from("note_attachments").delete().eq("id",att.id);
    if(error)toast(error.message,"error");else{toast("Attachment removed");reload("note_attachments");}
  };
  const attachToExisting=async(noteId,file,category,famId)=>{
    try{await uploadAttachment(noteId,file,category,famId);toast("File attached");reload("note_attachments");}
    catch(e){toast(e.message,"error");}
  };
  const filtered=notes.filter(n=>{
    // "__none__" is a real answer, not an absence: notes logged against no family
    // are otherwise invisible the moment any family is chosen.
    if(noteFamilyFilter==="__none__"){ if(n.familyId)return false; }
    else if(noteFamilyFilter&&n.familyId!==noteFamilyFilter)return false;
    if(advisorFilter&&(advisorOfNote(n)?.email||"")!==advisorFilter)return false;
    if(prospectMode&&userProfile?.role!=="admin"&&(advisorOfNote(n)?.email||"").toLowerCase()!==(userProfile?.email||"").toLowerCase())return false;
    if(!prospectMode&&cmAdvScope&&(gf(n.familyId)?.advisorEmail||"").toLowerCase()!==cmAdvScope)return false;
    return String(n.body||"").toLowerCase().includes(search.toLowerCase())||(gc(n.contactId)?.name||"").toLowerCase().includes(search.toLowerCase())||(gf(n.familyId)?.name||"").toLowerCase().includes(search.toLowerCase());
  });
  if(adminProspect&&viewMode==="advisors"){
    return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
          {[{k:"notes",l:"Notes"},{k:"advisors",l:"By ORDANIS Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
        </div>
        <div style={{flex:1,fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Notes by ORDANIS Expert</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(300px,100%),1fr))",gap:16}}>
          {advisorSummary.length===0&&<Empty text="No ORDANIS Experts or notes yet."/>}
          {advisorSummary.map(a=>(
            <div key={a.email||"unassigned"} onClick={()=>{if(!a.unassigned){setAdvisorFilter(a.email);setViewMode("notes");}}}
              style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${a.unassigned?B.textMute:B.gold}`,padding:20,cursor:a.unassigned?"default":"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
              onMouseEnter={e=>{if(!a.unassigned)e.currentTarget.style.boxShadow=B.shadowMd;}}
              onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
              <div style={{marginBottom:12}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:a.unassigned?B.textMute:B.navy,fontWeight:600,marginBottom:2}}>{a.name}</div>
                <div style={{fontSize:12,color:B.textSoft}}>{a.email||"Notes not linked to a ORDANIS Expert's contact"}</div>
              </div>
              <div style={{height:1,background:`linear-gradient(90deg,${a.unassigned?B.textMute:B.gold},transparent)`,marginBottom:12}}/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(170px,100%),1fr))",gap:8}}>
                {[{l:"Notes",v:a.notes},{l:"Contacts",v:a.contacts}].map(item=>(
                  <div key={item.l} style={{background:B.bg,borderRadius:6,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{item.l}</div>
                    <div style={{fontSize:15,fontFamily:"'Cormorant Garamond',serif",color:B.navy,fontWeight:600}}>{item.v}</div>
                  </div>
                ))}
              </div>
              {!a.unassigned&&<div style={{marginTop:10,fontSize:12,color:B.gold,fontWeight:600}}>View notes →</div>}
            </div>
          ))}
        </div>
      </div>
    </div>;
  }

  return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
    {adminProspect&&<div style={{padding:"10px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
        {[{k:"notes",l:"Notes"},{k:"advisors",l:"By ORDANIS Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
      </div>
      {advisorFilter&&<button onClick={()=>setAdvisorFilter("")} style={{border:`1px solid ${B.gold}`,background:"#fbf6ec",color:B.navy,borderRadius:16,padding:"5px 11px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>{(advisorSummary.find(a=>a.email===advisorFilter)?.name)||advisorFilter} ✕</button>}
    </div>}
    {!prospectMode&&userProfile?.role==="admin"&&<div style={{padding:"10px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      {!hideScope&&<AdvisorScopeBar userProfile={userProfile} value={cmAdvScope} onChange={setCmAdvScope}/>}
      {cmAdvScope&&<span style={{fontSize:12,color:B.textSoft}}>Showing notes for this ORDANIS Expert's families</span>}
    </div>}
    <div style={{padding:isMobile?"14px 14px":"20px 28px",borderBottom:`1px solid ${B.borderLight}`,background:B.white}}>
      <div style={{maxWidth:800,margin:"0 auto"}}>
        <div style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:12,overflow:"hidden",boxShadow:B.shadow}}>
          <textarea maxLength={20000} value={body} onChange={e=>setBody(e.target.value)} placeholder="Write a note or activity log entry…" style={{width:"100%",minHeight:88,background:"transparent",border:"none",padding:"14px 16px",color:B.text,fontSize:14,outline:"none",resize:"none",fontFamily:"inherit",lineHeight:1.65,boxSizing:"border-box"}}/>
          {pendingFiles.length>0&&<div style={{padding:"8px 14px",borderTop:`1px solid ${B.borderLight}`,background:"#f9f7f3"}}>
            <div style={{fontSize:10,fontWeight:800,color:B.textMute,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>Attachments ({pendingFiles.length})</div>
            {pendingFiles.map((pf,idx)=><div key={idx} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:idx===pendingFiles.length-1?"none":`1px solid ${B.borderLight}`,flexWrap:"wrap"}}>
              <span style={{fontSize:13,color:B.navy,fontWeight:600,flex:"1 1 200px",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📎 {pf.file.name}</span>
              <span style={{fontSize:11,color:B.textSoft}}>{(pf.file.size/1024).toFixed(1)}KB</span>
              <select value={pf.category} onChange={e=>{const next=[...pendingFiles];next[idx]={...next[idx],category:e.target.value};setPendingFiles(next);}} style={{...inp,padding:"4px 8px",fontSize:12,width:"auto",height:"auto"}}>
                {DOC_CATEGORIES.map(c=><option key={c}>{c}</option>)}
              </select>
              <button onClick={()=>setPendingFiles(pendingFiles.filter((_,i)=>i!==idx))} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:14}}>✕</button>
            </div>)}
          </div>}
          <div style={{display:"flex",gap:8,alignItems:"center",padding:"10px 14px",borderTop:`1px solid ${B.borderLight}`,background:B.white,flexWrap:"wrap"}}>
            <select value={fid} onChange={e=>setFid(e.target.value)} style={{...inp,flex:1,minWidth:130,padding:"6px 10px",fontSize:13}}><option value="">🏠 Family</option>{families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>
            <select value={cid} onChange={e=>setCid(e.target.value)} style={{...inp,flex:1,minWidth:130,padding:"6px 10px",fontSize:13}}><option value="">👤 Contact</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <label style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",background:B.bg,border:`1px solid ${B.border}`,borderRadius:6,cursor:"pointer",fontSize:12,color:B.navy,fontWeight:600,flexShrink:0}}>
              📎 Attach
              <input type="file" multiple accept={DOC_UPLOAD_EXTS.map(x=>"."+x).join(",")} onChange={e=>{
                const picked=Array.from(e.target.files||[]);
                if(picked.length===0)return;
                const files=[];
                for(const f of picked){const pr=docFileProblem(f);if(pr)toast(`${f.name}: ${pr}`,"error");else files.push(f);}
                if(files.length)setPendingFiles([...pendingFiles,...files.map(f=>({file:f,category:"General"}))]);
                e.target.value="";
              }} style={{display:"none"}}/>
            </label>
            <Btn onClick={add} disabled={saving||!body.trim()}>{saving?"Saving…":`Log Note${pendingFiles.length>0?` + ${pendingFiles.length}`:""}`}</Btn>
          </div>
        </div>
      </div>
    </div>
    <div style={{flex:1,overflowY:"auto",padding:isMobile?"14px 14px":"20px 28px"}}>
      <div style={{maxWidth:800,margin:"0 auto"}}>
        {/* Sticky: on a long list the search and family filter scrolled away exactly
            when they became useful. */}
        <div style={{marginBottom:12,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",position:"sticky",top:0,zIndex:5,background:B.bg,paddingTop:4,paddingBottom:8}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search notes…" style={{...inp,padding:"9px 14px",boxShadow:B.shadow,flex:"1 1 220px",minWidth:0}}/>
          <select value={noteFamilyFilter} onChange={e=>setNoteFamilyFilter(e.target.value)}
            aria-label="Filter notes by family" title="Show notes for one family"
            style={{...inp,padding:"9px 12px",boxShadow:B.shadow,flex:"0 1 200px",minWidth:150,cursor:"pointer"}}>
            <option value="">All families</option>
            {[...(families||[])].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),undefined,{sensitivity:"base"}))
              .map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
            <option value="__none__">— No family —</option>
          </select>
          {(noteFamilyFilter||search)&&<button
            onClick={()=>{setNoteFamilyFilter("");setSearch("");}}
            title="Clear filters"
            style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:12,textDecoration:"underline",flexShrink:0}}>Clear</button>}
        </div>
        {/* Without this, a filter that hides everything looks identical to a family
            with no notes, and the reflex is to re-type the note rather than clear
            the filter. */}
        {(noteFamilyFilter||search)&&<div style={{fontSize:11.5,color:B.textMute,marginTop:-8,marginBottom:12}}>
          Showing {filtered.length} of {notes.length} note{notes.length===1?"":"s"}
          {noteFamilyFilter&&noteFamilyFilter!=="__none__"&&` · ${gf(noteFamilyFilter)?.name||"selected family"}`}
          {noteFamilyFilter==="__none__"&&" · not linked to a family"}
        </div>}
        {filtered.length===0&&<div style={{padding:"60px 0",textAlign:"center",color:B.textMute}}><div style={{fontSize:32,marginBottom:12}}>📝</div>No notes yet.</div>}
        {filtered.map(n=>{
          const contact=gc(n.contactId);const fam=gf(n.familyId);
          const atts=noteAttachments.filter(a=>a.noteId===n.id);
          const expanded=openNotes.has(n.id);
          const bodyText=String(n.body||"");
          const isLong=bodyText.length>220||bodyText.split("\n").length>3;
          return <div key={n.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:9,marginBottom:7,overflow:"hidden"}}>
            <div style={{padding:"10px 13px"}}>
              {editId===n.id
                ? <div>
                    <textarea maxLength={20000} value={editBody} onChange={e=>setEditBody(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Escape"){setEditId(null);setEditBody("");}if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();saveEdit(n.id);}}}
                      autoFocus rows={Math.min(14,Math.max(4,bodyText.split("\n").length+1))}
                      style={{width:"100%",boxSizing:"border-box",background:B.white,border:`1px solid ${B.gold}`,borderRadius:7,padding:"9px 11px",color:B.text,fontSize:13.5,lineHeight:1.6,fontFamily:"inherit",resize:"vertical",outline:"none"}}/>
                    <div style={{display:"flex",gap:8,marginTop:7,alignItems:"center",flexWrap:"wrap"}}>
                      <Btn small onClick={()=>saveEdit(n.id)} disabled={!editBody.trim()}>Save</Btn>
                      <Btn small variant="ghost" onClick={()=>{setEditId(null);setEditBody("");}}>Cancel</Btn>
                      <span style={{fontSize:10.5,color:B.textMute,marginLeft:"auto"}}>Cmd/Ctrl + Enter to save</span>
                    </div>
                  </div>
                : <>
                    {/* Clamped, not truncated: a meeting write-up should not turn ten
                        notes into a page of scrolling, but nothing is lost and one
                        click opens it in place. */}
                    <div onClick={()=>isLong&&toggleNote(n.id)}
                      style={{fontSize:13.5,color:B.text,lineHeight:1.55,whiteSpace:"pre-wrap",wordBreak:"break-word",cursor:isLong?"pointer":"default",
                        ...(isLong&&!expanded?{display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden"}:{})}}>{bodyText}</div>

                    {/* One meta line carrying what previously occupied three. */}
                    <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap",marginTop:5,fontSize:11,color:B.textMute}}>
                      {isLong&&<button onClick={()=>toggleNote(n.id)}
                        style={{background:"none",border:"none",padding:0,color:"#8a7333",cursor:"pointer",fontSize:11,fontWeight:600}}>
                        {expanded?"Less":"More"}</button>}
                      <span>{fmt(n.createdAt)}</span>
                      {n.updatedAt&&<span title={`Edited ${fmt(n.updatedAt)}`}>edited</span>}
                      {fam&&<span style={{background:"#e8f0f8",color:B.navyMid,borderRadius:4,padding:"1px 7px",fontSize:10.5,fontWeight:700}}>{fam.name}</span>}
                      {contact&&<span style={{background:"#fef3e2",color:"#8a5c00",borderRadius:4,padding:"1px 7px",fontSize:10.5,fontWeight:700}}>{contact.name}</span>}
                      {/* Attachments collapse to a count. Listing every file inline was
                          the biggest consumer of vertical space on notes that had them,
                          and the count is usually all you need. */}
                      {atts.length>0&&<button onClick={()=>toggleNote(n.id)}
                        style={{background:"none",border:`1px solid ${B.borderLight}`,borderRadius:4,padding:"1px 7px",fontSize:10.5,fontWeight:700,color:B.navy,cursor:"pointer"}}>
                        {atts.length} file{atts.length===1?"":"s"}</button>}
                      <span style={{marginLeft:"auto",display:"flex",gap:8,flexShrink:0}}>
                        <button onClick={()=>{setEditId(n.id);setEditBody(n.body);}} title="Edit note"
                          style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:11,padding:0}}>Edit</button>
                        <button onClick={()=>del(n.id)} title="Delete note"
                          style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:11,padding:0}}>Delete</button>
                      </span>
                    </div>

                    {/* Attachments and the upload control appear only once opened, so a
                        note with neither costs nothing to scroll past. */}
                    {expanded&&<div style={{marginTop:9,paddingTop:9,borderTop:`1px solid ${B.borderLight}`}}>
                      {atts.map(a=><div key={a.id} style={{display:"flex",alignItems:"center",gap:7,padding:"3px 0",flexWrap:"wrap"}}>
                        <span style={{fontSize:12,color:B.navy,fontWeight:600,flex:"1 1 180px",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>
                        <span style={{background:"#e8f0f8",color:B.navyMid,borderRadius:4,padding:"1px 7px",fontSize:10.5,fontWeight:700}}>{a.category}</span>
                        {a.fileSize&&<span style={{fontSize:10,color:B.textSoft}}>{(a.fileSize/1024).toFixed(1)}KB</span>}
                        <button onClick={()=>download(a)} style={{background:"none",border:`1px solid ${B.border}`,color:B.navy,cursor:"pointer",fontSize:10.5,borderRadius:4,padding:"1px 8px"}}>Download</button>
                        <button onClick={()=>{if(confirm("Remove this attachment?"))delAtt(a);}} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:12}}>&times;</button>
                      </div>)}
                      <label style={{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 9px",marginTop:atts.length?6:0,background:"transparent",border:`1px dashed ${B.border}`,borderRadius:5,cursor:"pointer",fontSize:11,color:B.textSoft}}>
                        Add file
                        <input type="file" onChange={e=>{
                          const file=e.target.files&&e.target.files[0];
                          if(!file)return;
                          const category=prompt("Category for this file?","General");
                          if(!category){e.target.value="";return;}
                          const cat=DOC_CATEGORIES.includes(category)?category:"General";
                          attachToExisting(n.id,file,cat,n.familyId);
                          e.target.value="";
                        }} style={{display:"none"}}/>
                      </label>
                    </div>}
                  </>}
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}

// ── TASKS VIEW ────────────────────────────────────────────────────────────────
function TasksView({data,reload,toast,userProfile,prospectMode=false,hideScope}){
  const{contacts,families,tasks}=data;
  const[modal,setModal]=useState(null);const[filter,setFilter]=useState("Pending");const[filterFamily,setFilterFamily]=useState("all");
  const adminProspect=prospectMode&&userProfile?.role==="admin";
  const[viewMode,setViewMode]=useState("tasks");
  const[advisorFilter,setAdvisorFilter]=useState("");
  const[advisors,setAdvisors]=useState([]);
  useEffect(()=>{if(adminProspect){sb.from("user_profiles").select("id,email,full_name,role").in("role",["advisor","admin"]).then(({data:rows,error})=>{if(!error&&rows)setAdvisors(rows);});}},[adminProspect]);
  const advisorOfTask=t=>{const c=contacts.find(x=>x.id===t.contactId);return c&&c.advisorEmail?{email:c.advisorEmail,name:c.advisorName||c.advisorEmail}:null;};
  const gc=id=>contacts.find(c=>c.id===id);const gf=id=>families.find(f=>f.id===id);
  const[cmAdvScope,setCmAdvScope]=useState("");
  const list=tasks.filter(t=>(filter==="All"||(filter==="Pending"?!t.done:t.done))&&(filterFamily==="all"||t.familyId===filterFamily)&&(!advisorFilter||(advisorOfTask(t)?.email||"")===advisorFilter)&&(prospectMode||!cmAdvScope||(gf(t.familyId)?.advisorEmail||"").toLowerCase()===cmAdvScope)&&(!prospectMode||userProfile?.role==="admin"||(advisorOfTask(t)?.email||"").toLowerCase()===(userProfile?.email||"").toLowerCase()));
  const oc=tasks.filter(t=>!t.done&&t.dueDate&&dueEnd(t.dueDate)<new Date()).length;
  const soon=tasks.filter(t=>!t.done&&t.dueDate&&(dueEnd(t.dueDate)-new Date())/(86400000)<=30&&dueEnd(t.dueDate)>=new Date()).length;
  const advisorSummary=useMemo(()=>{
    const groups={};const now=new Date();
    tasks.forEach(t=>{
      const c=contacts.find(x=>x.id===t.contactId);
      const adv=c&&c.advisorEmail?{email:c.advisorEmail,name:c.advisorName||c.advisorEmail}:null;
      const key=adv?adv.email:"__unassigned__";
      if(!groups[key])groups[key]={email:adv?adv.email:"",name:adv?adv.name:"Unassigned",unassigned:!adv,open:0,overdue:0,done:0};
      if(t.done)groups[key].done+=1;
      else{groups[key].open+=1;if(t.dueDate&&dueEnd(t.dueDate)<now)groups[key].overdue+=1;}
    });
    advisors.forEach(a=>{if(!groups[a.email])groups[a.email]={email:a.email,name:a.full_name||a.email,unassigned:false,open:0,overdue:0,done:0};});
    return Object.values(groups).sort((a,b)=>(b.open-a.open)||(b.overdue-a.overdue));
  },[tasks,contacts,advisors]);

  const add=async f=>{const{error}=await sb.from("tasks").insert({family_id:f.familyId||null,contact_id:f.contactId||null,title:f.title,due_date:f.dueDate||null,priority:f.priority,reminder_days:reminderDaysOr7(f.reminderDays),done:false,recurrence:f.recurrence||null,recurrence_interval:f.recurrence==="Custom"?(Number(f.recurrenceInterval)||1):null,recurrence_unit:f.recurrence==="Custom"?(f.recurrenceUnit||"week"):null});if(error){toast(error.message,"error");return false;}else{toast("Task added. You're all set.");reload("tasks");}};
  const tog=async t=>{const marking=!t.done;const{error}=await sb.from("tasks").update(marking?{done:true,completed_at:new Date().toISOString(),completed_by:CURRENT_USER_LABEL||null}:{done:false,completed_at:null,completed_by:null}).eq("id",t.id);if(error){toast(error.message,"error");return;}if(marking&&t.recurrence){const nd=nextRecurrence(t.dueDate,t.recurrence,t.recurrenceInterval,t.recurrenceUnit);if(nd)await scheduleNextOccurrence(t,t.familyId||null,nd,toast);}reload("tasks");};
  const del=async id=>{if(!confirm("Delete this task? This can't be undone."))return;const{error}=await sb.from("tasks").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Deleted");reload("tasks");}};


  if(adminProspect&&viewMode==="advisors"){
    return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
          {[{k:"tasks",l:"Tasks"},{k:"advisors",l:"By ORDANIS Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
        </div>
        <div style={{flex:1,fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Tasks by ORDANIS Expert</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(300px,100%),1fr))",gap:16}}>
          {advisorSummary.length===0&&<Empty text="No ORDANIS Experts or tasks yet."/>}
          {advisorSummary.map(a=>(
            <div key={a.email||"unassigned"} onClick={()=>{if(!a.unassigned){setAdvisorFilter(a.email);setViewMode("tasks");}}}
              style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${a.unassigned?B.textMute:B.gold}`,padding:20,cursor:a.unassigned?"default":"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
              onMouseEnter={e=>{if(!a.unassigned)e.currentTarget.style.boxShadow=B.shadowMd;}}
              onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
              <div style={{marginBottom:12}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:a.unassigned?B.textMute:B.navy,fontWeight:600,marginBottom:2}}>{a.name}</div>
                <div style={{fontSize:12,color:B.textSoft}}>{a.email||"Tasks not linked to a ORDANIS Expert's contact"}</div>
              </div>
              <div style={{height:1,background:`linear-gradient(90deg,${a.unassigned?B.textMute:B.gold},transparent)`,marginBottom:12}}/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(150px,100%),1fr))",gap:8}}>
                {[{l:"Open",v:a.open},{l:"Overdue",v:a.overdue},{l:"Done",v:a.done}].map(item=>(
                  <div key={item.l} style={{background:B.bg,borderRadius:6,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{item.l}</div>
                    <div style={{fontSize:15,fontFamily:"'Cormorant Garamond',serif",color:item.l==="Overdue"&&a.overdue>0?"#8b1a1a":B.navy,fontWeight:600}}>{item.v}</div>
                  </div>
                ))}
              </div>
              {!a.unassigned&&<div style={{marginTop:10,fontSize:12,color:B.gold,fontWeight:600}}>View tasks →</div>}
            </div>
          ))}
        </div>
      </div>
    </div>;
  }

  return <div style={{maxWidth:760,margin:"0 auto",padding:"20px",height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
      {adminProspect&&<div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
        {[{k:"tasks",l:"Tasks"},{k:"advisors",l:"By ORDANIS Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"5px 11px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
      </div>}
      {adminProspect&&advisorFilter&&<button onClick={()=>setAdvisorFilter("")} style={{border:`1px solid ${B.gold}`,background:"#fbf6ec",color:B.navy,borderRadius:16,padding:"5px 11px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>{(advisorSummary.find(a=>a.email===advisorFilter)?.name)||advisorFilter} ✕</button>}
      <div style={{display:"flex",gap:5}}>{["Pending","Done","All"].map(s=><button key={s} onClick={()=>setFilter(s)} style={{background:filter===s?B.navy:"transparent",border:`1px solid ${filter===s?B.navy:B.border}`,color:filter===s?B.white:B.textSoft,borderRadius:20,padding:"4px 14px",fontSize:11,cursor:"pointer",fontWeight:700,fontFamily:"inherit"}}>{s}</button>)}</div>
      <Sel value={filterFamily} onChange={e=>setFilterFamily(e.target.value)} style={{width:170}}><option value="all">All Families</option>{families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Sel>
      {!prospectMode&&!hideScope&&<AdvisorScopeBar userProfile={userProfile} value={cmAdvScope} onChange={setCmAdvScope}/>}
      <div style={{flex:1,display:"flex",gap:8}}>
        {oc>0&&<Badge scheme={{bg:"#fde8e8",text:"#8b1a1a",dot:"#d43030"}}>{oc} overdue</Badge>}
        {soon>0&&<Badge scheme={{bg:"#fef3e2",text:"#8a5c00",dot:"#d4900a"}}>{soon} due in 30 days</Badge>}
      </div>
      <Btn onClick={()=>setModal("add")}>+ New Task</Btn>
    </div>
    <div style={{overflowY:"auto",flex:1}}>
      {list.length===0&&<div style={{padding:"60px 0",textAlign:"center",color:B.textMute,fontSize:14}}>No tasks here.</div>}
      {(filter==="Done"?[...list].sort((a,b)=>new Date(b.completedAt||0)-new Date(a.completedAt||0)):list).flatMap((t,idx,arr)=>{
        const contact=gc(t.contactId);const fam=gf(t.familyId);
        const isOD=!t.done&&t.dueDate&&dueEnd(t.dueDate)<new Date();
        const isSoon=!t.done&&!isOD&&t.dueDate&&(dueEnd(t.dueDate)-new Date())/(86400000)<=30;
        const yr=t.completedAt?new Date(t.completedAt).getFullYear():null;
        const showYear=filter==="Done"&&yr&&(idx===0||new Date(arr[idx-1].completedAt||0).getFullYear()!==yr);
        const nodes=[];
        if(showYear)nodes.push(<div key={"yr"+idx} style={{fontSize:12,fontWeight:800,letterSpacing:"0.08em",color:B.textMute,textTransform:"uppercase",margin:"14px 0 8px",paddingBottom:4,borderBottom:`1px solid ${B.borderLight}`}}>Completed in {yr}</div>);
        nodes.push(<div key={t.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",marginBottom:8,background:B.white,border:`1px solid ${isOD?"#f5c6c6":B.borderLight}`,borderLeft:`3px solid ${isOD?"#d43030":isSoon?"#d4900a":PRIORITY_COLORS[t.priority]?.dot||B.gold}`,borderRadius:10,opacity:t.done?.7:1,boxShadow:B.shadow}}>
          <input type="checkbox" checked={!!t.done} onChange={()=>tog(t)} style={{width:16,height:16,accentColor:B.navy,cursor:"pointer",flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:700,color:B.navy,textDecoration:t.done?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
            <div style={{fontSize:12,color:B.textSoft,marginTop:2,display:"flex",gap:10,flexWrap:"wrap"}}>
              {fam&&<span style={{color:B.navyMid,fontWeight:600}}>{fam.name}</span>}
              {contact&&<span>{contact.name}</span>}
              {t.dueDate&&<span style={{color:isOD?"#d43030":isSoon?"#d4900a":B.textSoft}}>{isOD?"⚠ ":isSoon?"⏰ ":""}{fmt(t.dueDate)}</span>}
              {t.reminderDays>0&&!t.done&&<span style={{color:B.textMute}}>🔔 {t.reminderDays}d</span>}
              {t.recurrence&&<span style={{color:B.gold,fontWeight:600}}>↻ {recurLabel(t)}</span>}
              {t.done&&t.completedAt&&<span style={{color:"#2e9e57",fontWeight:600}}>✓ Completed {fmt(t.completedAt)}{t.completedBy?` · by ${t.completedBy}`:""}</span>}
            </div>
          </div>
          <Badge scheme={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
          <Btn small variant="danger" onClick={()=>del(t.id)}>✕</Btn>
        </div>);
        return nodes;
      })}
    </div>
    {modal==="add"&&<Modal title="New Task" onClose={()=>setModal(null)}><GlobalTaskForm families={families} contacts={contacts} onSave={add} onClose={()=>setModal(null)}/></Modal>}
  </div>;
}

// ── GLOBAL TASK FORM (top-level) ─────────────────────────────────────────────
function GlobalTaskForm({initial,families=[],contacts=[],onSave,onClose}){
  const[f,setF]=useState(initial||{familyId:"",contactId:"",title:"",dueDate:"",priority:"Medium",reminderDays:7,done:false,recurrence:"",recurrenceInterval:1,recurrenceUnit:"week"});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const[showReq,setShowReq]=useState(false);
  const save=async()=>{if(!f.title.trim()){setShowReq(true);return;}setSaving(true);const ok=await onSave(f);if(ok===false){setSaving(false);return;}onClose();};
  return <div>
    <Grid2><Field label="Family" optional><Sel value={f.familyId||""} onChange={set("familyId")}><option value="">— None —</option>{families.map(fm=><option key={fm.id} value={fm.id}>{fm.name}</option>)}</Sel></Field>
    <Field label="Contact" optional><Sel value={f.contactId||""} onChange={set("contactId")}><option value="">— None —</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Sel></Field></Grid2>
    <Field label="Task" required><Inp maxLength={200} placeholder="Follow up on loan maturity" value={f.title} onChange={set("title")}/></Field>
    <Grid2><Field label="Due Date" optional><Inp type="date" value={f.dueDate||""} onChange={set("dueDate")}/></Field><Field label="Priority"><Sel value={f.priority} onChange={set("priority")}><option>Low</option><option>Medium</option><option>High</option></Sel></Field></Grid2>
    <Field label="Email Reminder"><Sel value={reminderDaysOr7(f.reminderDays)} onChange={e=>setF(p=>({...p,reminderDays:Number(e.target.value)}))}><option value={0}>No reminder</option>{REMINDER_OPTIONS.map(r=><option key={r.days} value={r.days}>{r.label}</option>)}</Sel></Field>
    {Number(f.reminderDays)>0&&f.dueDate&&<div style={{background:"#e8f0f8",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:B.navyMid}}>🔔 ORDANIS Expert emailed on {new Date(parseLocalDate(f.dueDate).setDate(parseLocalDate(f.dueDate).getDate()-Number(f.reminderDays))).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>}
    <RecurrenceField f={f} setF={setF}/>
    {showReq&&<ReqHint/>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Task"}</Btn></div>
  </div>;
}

// ── PROSPECT VIEWS ────────────────────────────────────────────────────────────
function ProspectContactForm({initial,onSave,onClose,userProfile,advisors=[]}){
  const isAdmin=userProfile?.role==="admin";
  const[f,setF]=useState(initial||{name:"",company:"",email:"",phone:"",type:"Individual",tags:"",source:"",
    advisorName:isAdmin?"":(userProfile?.fullName||""),advisorEmail:isAdmin?"":(userProfile?.email||"")});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const pickAdvisor=e=>{const email=e.target.value;const adv=advisors.find(a=>a.email===email);setF(p=>({...p,advisorEmail:email,advisorName:adv?(adv.full_name||""):""}));};
  const[showReq,setShowReq]=useState(false);
  const[err,setErr]=useState("");
  const save=async()=>{if(!f.name.trim()){setShowReq(true);return;}const pr=contactProblem(f);if(pr){setErr(pr);return;}setErr("");setSaving(true);const ok=await onSave({...f,email:String(f.email||"").trim().toLowerCase()});if(ok===false){setSaving(false);return;}onClose();};
  return <div>
    <Grid2><Field label="Full Name" required><Inp maxLength={120} placeholder="Jane Smith" value={f.name} onChange={set("name")}/></Field><Field label="Company" optional><Inp value={f.company||""} onChange={set("company")}/></Field></Grid2>
    <Grid2><Field label="Email" optional><Inp type="email" autoComplete="off" value={f.email||""} onChange={set("email")}/></Field><Field label="Phone" optional><Inp placeholder="(555) 000-0000" value={f.phone||""} onChange={e=>set("phone")({target:{value:formatPhoneInput(e.target.value)}})}/></Field></Grid2>
    <Grid2><Field label="Type"><Sel value={f.type} onChange={set("type")}><option>Individual</option><option>Business</option></Sel></Field><Field label="Lead Source" optional><Inp placeholder="Referral, LinkedIn…" value={f.source||""} onChange={set("source")}/></Field></Grid2>
    {isAdmin
      ? <Field label="Assign ORDANIS Expert">
          <select value={f.advisorEmail||""} onChange={pickAdvisor} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${B.border}`,fontSize:14,fontFamily:"'DM Sans',sans-serif",background:B.white,color:B.navy}}>
            <option value="">— Select a ORDANIS Expert —</option>
            {advisors.map(a=><option key={a.id} value={a.email}>{(a.full_name||a.email)}{a.full_name?` (${a.email})`:""}</option>)}
          </select>
        </Field>
      : <Field label="ORDANIS Expert"><Inp value={f.advisorName||f.advisorEmail||userProfile?.fullName||userProfile?.email||""} disabled/></Field>
    }
    <Field label="Tags" optional><Inp placeholder="warm-lead, vip" value={f.tags||""} onChange={set("tags")}/></Field>
    {showReq&&<ReqHint/>}
    {err&&<div style={{fontSize:12,color:"#8b1a1a",background:"#fff5f5",border:"1px solid #f3c2c2",borderRadius:8,padding:"8px 10px",marginTop:8}}>{err}</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</Btn></div>
  </div>;
}

function ProspectContactsView({data,reload,toast,userProfile}){
  const isMobile=useIsMobile();
  const isAdmin=userProfile?.role==="admin";
  const prospects=data.contacts.filter(c=>!c.familyId&&(isAdmin||(c.advisorEmail||"").toLowerCase()===(userProfile?.email||"").toLowerCase()));
  const[modal,setModal]=useState(null);const[search,setSearch]=useState("");const[selected,setSelected]=useState(null);
  const[viewMode,setViewMode]=useState("contacts"); // admin only: "contacts" | "advisors"
  const[advisorFilter,setAdvisorFilter]=useState("");
  const[advisors,setAdvisors]=useState([]);
  useEffect(()=>{
    if(isAdmin){
      sb.from("user_profiles").select("id,email,full_name,role").in("role",["advisor","admin"]).then(({data:rows,error})=>{if(!error&&rows)setAdvisors(rows);});
    }
  },[isAdmin]);
  const filtered=useMemo(()=>prospects.filter(c=>{
    if(advisorFilter&&(c.advisorEmail||"")!==advisorFilter)return false;
    return [c.name,c.company,c.email,c.tags].join(" ").toLowerCase().includes(search.toLowerCase());
  }),[prospects,search,advisorFilter]);
  const advisorSummary=useMemo(()=>{
    const dealsFor=id=>data.deals.filter(d=>!d.familyId&&d.contactId===id);
    const groups={};
    prospects.forEach(c=>{
      const key=c.advisorEmail||"__unassigned__";
      if(!groups[key])groups[key]={email:c.advisorEmail||"",name:c.advisorName||"Unassigned",unassigned:!c.advisorEmail,prospects:0,openDeals:0,pipeline:0,won:0};
      groups[key].prospects+=1;
      dealsFor(c.id).forEach(d=>{
        if(d.stage==="Closed Won")groups[key].won+=1;
        else if(d.stage!=="Closed Lost"){groups[key].openDeals+=1;groups[key].pipeline+=Number(d.value)||0;}
      });
    });
    advisors.forEach(a=>{if(!groups[a.email])groups[a.email]={email:a.email,name:a.full_name||a.email,unassigned:false,prospects:0,openDeals:0,pipeline:0,won:0};});
    return Object.values(groups).sort((a,b)=>(b.pipeline-a.pipeline)||(b.prospects-a.prospects));
  },[prospects,data.deals,advisors]);
  const add=async f=>{const{error}=await sb.from("contacts").insert({family_id:null,name:f.name,company:f.company||null,email:f.email||null,phone:f.phone||null,type:f.type,tags:f.tags||null,advisor_email:f.advisorEmail||null,advisor_name:f.advisorName||null});if(error){toast(error.message,"error");return false;}else{toast("Contact added. Your team is easy to find now.");reload("contacts");}};
  const edit=async f=>{const{error}=await sb.from("contacts").update({name:f.name,company:f.company||null,email:f.email||null,phone:f.phone||null,type:f.type,tags:f.tags||null,advisor_email:f.advisorEmail||null,advisor_name:f.advisorName||null}).eq("id",modal.id);if(error){toast(error.message,"error");return false;}else{toast("Updated");reload("contacts");setSelected({...selected,...f});}};
  const del=async id=>{if(!confirm("Delete this contact? This can't be undone."))return;const{error}=await sb.from("contacts").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Deleted");reload("contacts");if(selected?.id===id)setSelected(null);}};

  if(isAdmin&&viewMode==="advisors"){
    return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
      <div style={{padding:isMobile?"12px 14px":"14px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
          {[{k:"contacts",l:"Contacts"},{k:"advisors",l:"By ORDANIS Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"7px 14px",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
        </div>
        <div style={{flex:1,fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Prospecting by ORDANIS Expert</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(320px,100%),1fr))",gap:16}}>
          {advisorSummary.length===0&&<Empty text="No ORDANIS Experts or prospects yet."/>}
          {advisorSummary.map(a=>(
            <div key={a.email||"unassigned"} onClick={()=>{if(!a.unassigned){setAdvisorFilter(a.email);setViewMode("contacts");}}}
              style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${a.unassigned?B.textMute:B.gold}`,padding:20,cursor:a.unassigned?"default":"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
              onMouseEnter={e=>{if(!a.unassigned)e.currentTarget.style.boxShadow=B.shadowMd;}}
              onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
              <div style={{marginBottom:12}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:a.unassigned?B.textMute:B.navy,fontWeight:600,marginBottom:2}}>{a.name}</div>
                <div style={{fontSize:12,color:B.textSoft}}>{a.email||"Prospects with no ORDANIS Expert assigned"}</div>
              </div>
              <div style={{height:1,background:`linear-gradient(90deg,${a.unassigned?B.textMute:B.gold},transparent)`,marginBottom:12}}/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(170px,100%),1fr))",gap:8}}>
                {[{l:"Prospects",v:a.prospects},{l:"Open Deals",v:a.openDeals},{l:"Pipeline $",v:fmtMoney(a.pipeline)},{l:"Won",v:a.won}].map(item=>(
                  <div key={item.l} style={{background:B.bg,borderRadius:6,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{item.l}</div>
                    <div style={{fontSize:15,fontFamily:"'Cormorant Garamond',serif",color:B.navy,fontWeight:600}}>{item.v}</div>
                  </div>
                ))}
              </div>
              {!a.unassigned&&<div style={{marginTop:10,fontSize:12,color:B.gold,fontWeight:600}}>View prospects →</div>}
            </div>
          ))}
        </div>
      </div>
      {modal==="add"&&<Modal title="New Prospect" onClose={()=>setModal(null)}><ProspectContactForm userProfile={userProfile} advisors={advisors} onSave={add} onClose={()=>setModal(null)}/></Modal>}
    </div>;
  }

  const cDeals=selected?data.deals.filter(d=>d.contactId===selected.id):[];
  const cNotes=selected?data.notes.filter(n=>n.contactId===selected.id):[];
  return <div style={{display:"flex",height:"100%",minHeight:0}}>
    {(!isMobile||!selected)&&<div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",borderRight:isMobile?"none":`1px solid ${B.borderLight}`}}>
      <div style={{padding:isMobile?"12px 14px":"14px 20px",display:"flex",gap:10,alignItems:"center",borderBottom:`1px solid ${B.borderLight}`,background:B.white,flexWrap:"wrap"}}>
        {isAdmin&&<div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
          {[{k:"contacts",l:"Contacts"},{k:"advisors",l:"By ORDANIS Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
        </div>}
        <Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search prospects…" style={{flex:1,minWidth:140}}/>
        {advisorFilter&&<button onClick={()=>setAdvisorFilter("")} style={{border:`1px solid ${B.gold}`,background:"#fbf6ec",color:B.navy,borderRadius:16,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>{(advisorSummary.find(a=>a.email===advisorFilter)?.name)||advisorFilter} ✕</button>}
        <Btn onClick={()=>setModal("add")}>+ New</Btn>
      </div>
      <div style={{overflowY:"auto",flex:1}}>
        {filtered.length===0&&<Empty text="No prospect contacts yet."/>}
        {filtered.map(c=><div key={c.id} onClick={()=>setSelected(c)} style={{padding:isMobile?"14px 14px":"13px 20px",cursor:"pointer",borderBottom:`1px solid ${B.borderLight}`,background:selected?.id===c.id?B.bg:B.white}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div style={{minWidth:0}}><div style={{fontWeight:700,color:B.navy,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</div><div style={{fontSize:12,color:B.textSoft,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.company||c.email||"—"}</div></div>
            <Badge scheme={c.type==="Business"?{bg:"#e8f0f8",text:B.navyMid,dot:B.navyMid}:{bg:"#f3edf7",text:"#5c2d91",dot:"#8b5cf6"}}>{c.type}</Badge>
          </div>
        </div>)}
      </div>
    </div>}
    {selected?<div style={{width:isMobile?"100%":360,padding:isMobile?16:22,overflowY:"auto",flexShrink:0,background:B.bg}}>
      {isMobile&&<button onClick={()=>setSelected(null)} style={{background:"none",border:`1px solid ${B.border}`,color:B.textSoft,cursor:"pointer",fontSize:13,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:6,marginBottom:14}}>← Back</button>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,gap:10}}>
        <div style={{minWidth:0}}><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{selected.name}</div><div style={{fontSize:12,color:B.textSoft}}>{selected.company}</div></div>
        <div style={{display:"flex",gap:6,flexShrink:0}}><Btn small variant="ghost" onClick={()=>setModal(selected)}>Edit</Btn><Btn small variant="danger" onClick={()=>del(selected.id)}>Delete</Btn></div>
      </div>
      <div style={{height:2,background:`linear-gradient(90deg,${B.gold},transparent)`,marginBottom:12}}/>
      {selected.email&&<IRow label="Email" value={<EmailLink value={selected.email}/>}/>}
      {selected.phone&&<IRow label="Phone" value={<PhoneLink value={selected.phone}/>}/>}
      {selected.tags&&<IRow label="Tags" value={selected.tags}/>}
      <SectionLabel>Deals ({cDeals.length})</SectionLabel>
      {cDeals.length===0?<Empty text="No deals"/>:cDeals.map(d=><div key={d.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${B.borderLight}`}}><span style={{fontSize:13}}>{d.title}</span><Badge scheme={STAGE_COLORS[d.stage]}>{d.stage}</Badge></div>)}
      <SectionLabel>Notes ({cNotes.length})</SectionLabel>
      {cNotes.length===0?<Empty text="No notes"/>:cNotes.slice(0,3).map(n=><div key={n.id} style={{padding:"6px 0",borderBottom:`1px solid ${B.borderLight}`}}><div style={{fontSize:13,color:B.textMid}}>{n.body}</div><div style={{fontSize:11,color:B.textMute,marginTop:2}}>{fmt(n.createdAt)}</div></div>)}
    </div>:(!isMobile&&<div style={{width:360,display:"flex",alignItems:"center",justifyContent:"center",color:B.textMute,fontSize:13,background:B.bg}}>Select a contact</div>)}
    {modal==="add"&&<Modal title="New Prospect" onClose={()=>setModal(null)}><ProspectContactForm userProfile={userProfile} advisors={advisors} onSave={add} onClose={()=>setModal(null)}/></Modal>}
    {modal&&modal!=="add"&&<Modal title="Edit Contact" onClose={()=>setModal(null)}><ProspectContactForm initial={modal} userProfile={userProfile} advisors={advisors} onSave={edit} onClose={()=>setModal(null)}/></Modal>}
  </div>;
}

function ProspectDealForm({initial,contacts=[],onSave,onClose,userProfile,advisors=[]}){
  const isAdmin=userProfile?.role==="admin";
  const[f,setF]=useState(initial||{contactId:"",title:"",value:"",stage:"Lead",closeDate:"",
    advisorName:isAdmin?"":(userProfile?.fullName||""),advisorEmail:isAdmin?"":(userProfile?.email||"")});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const pickAdvisor=e=>{const email=e.target.value;const adv=advisors.find(a=>a.email===email);setF(p=>({...p,advisorEmail:email,advisorName:adv?(adv.full_name||""):""}));};
  const[showReq,setShowReq]=useState(false);
  const save=async()=>{if(!f.title.trim()){setShowReq(true);return;}setSaving(true);const ok=await onSave(f);if(ok===false){setSaving(false);return;}onClose();};
  return <div>
    <Field label="Opportunity Title" required><Inp maxLength={150} value={f.title} onChange={set("title")}/></Field>
    <Field label="Contact" optional><Sel value={f.contactId||""} onChange={set("contactId")}><option value="">— None —</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Sel></Field>
    <Grid2><Field label="Value ($)" optional><MoneyInput value={f.value||""} onChange={set("value")}/></Field><Field label="Close Date" optional><Inp type="date" value={f.closeDate||""} onChange={set("closeDate")}/></Field></Grid2>
    <Field label="Stage"><Sel value={f.stage} onChange={set("stage")}>{STAGES.map(s=><option key={s}>{s}</option>)}</Sel></Field>
    {isAdmin
      ? <Field label="Assign ORDANIS Expert">
          <select value={f.advisorEmail||""} onChange={pickAdvisor} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${B.border}`,fontSize:14,fontFamily:"'DM Sans',sans-serif",background:B.white,color:B.navy}}>
            <option value="">— Select a ORDANIS Expert —</option>
            {advisors.map(a=><option key={a.id} value={a.email}>{(a.full_name||a.email)}{a.full_name?` (${a.email})`:""}</option>)}
          </select>
        </Field>
      : <Field label="ORDANIS Expert"><Inp value={f.advisorName||f.advisorEmail||userProfile?.fullName||userProfile?.email||""} disabled/></Field>
    }
    {showReq&&<ReqHint/>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</Btn></div>
  </div>;
}

function ProspectPipelineView({data,reload,toast,userProfile}){
  const isAdmin=userProfile?.role==="admin";
  const allContacts=data.contacts.filter(c=>!c.familyId);
  const contacts=allContacts;
  const[modal,setModal]=useState(null);const[fs,setFs]=useState("All");
  const[viewMode,setViewMode]=useState("pipeline"); // admin only: "pipeline" | "advisors"
  const[advisorFilter,setAdvisorFilter]=useState("");
  const[advisors,setAdvisors]=useState([]);
  useEffect(()=>{if(isAdmin){sb.from("user_profiles").select("id,email,full_name,role").in("role",["advisor","admin"]).then(({data:rows,error})=>{if(!error&&rows)setAdvisors(rows);});}},[isAdmin]);
  const advisorOf=d=>{if(d.advisorEmail)return{email:d.advisorEmail,name:d.advisorName||d.advisorEmail};const c=allContacts.find(x=>x.id===d.contactId);return c&&c.advisorEmail?{email:c.advisorEmail,name:c.advisorName||c.advisorEmail}:null;};
  const myEmail=(userProfile?.email||"").toLowerCase();
  // Visibility is authoritative on the deal's OWN advisor stamp — no live contact fallback, which leaked legacy/contact-derived deals across advisors. Admin still sees all.
  const allDeals=data.deals.filter(d=>!d.familyId).filter(d=>isAdmin||(d.advisorEmail||"").toLowerCase()===myEmail);
  const deals=allDeals.filter(d=>!advisorFilter||(advisorOf(d)?.email||"")===advisorFilter);
  const filtered=useMemo(()=>deals.filter(d=>fs==="All"||d.stage===fs),[deals,fs]);
  const byStage=STAGES.reduce((acc,s)=>({...acc,[s]:filtered.filter(d=>d.stage===s)}),{});
  const pipeline=deals.filter(d=>d.stage!=="Closed Lost").reduce((s,d)=>s+(Number(d.value)||0),0);
  const gc=id=>allContacts.find(c=>c.id===id);
  const advisorSummary=useMemo(()=>{
    const groups={};
    allDeals.forEach(d=>{
      const c=allContacts.find(x=>x.id===d.contactId);
      const adv=d.advisorEmail?{email:d.advisorEmail,name:d.advisorName||d.advisorEmail}:(c&&c.advisorEmail?{email:c.advisorEmail,name:c.advisorName||c.advisorEmail}:null);
      const key=adv?adv.email:"__unassigned__";
      if(!groups[key])groups[key]={email:adv?adv.email:"",name:adv?adv.name:"Unassigned",unassigned:!adv,deals:0,openDeals:0,pipeline:0,won:0,lost:0};
      groups[key].deals+=1;
      if(d.stage==="Closed Won")groups[key].won+=1;
      else if(d.stage==="Closed Lost")groups[key].lost+=1;
      else{groups[key].openDeals+=1;groups[key].pipeline+=Number(d.value)||0;}
    });
    advisors.forEach(a=>{if(!groups[a.email])groups[a.email]={email:a.email,name:a.full_name||a.email,unassigned:false,deals:0,openDeals:0,pipeline:0,won:0,lost:0};});
    return Object.values(groups).sort((a,b)=>(b.pipeline-a.pipeline)||(b.openDeals-a.openDeals));
  },[allDeals,allContacts,advisors]);

  const add=async f=>{const{error}=await sb.from("deals").insert({family_id:null,contact_id:f.contactId||null,title:f.title,value:f.value||null,stage:f.stage,close_date:f.closeDate||null,advisor_email:f.advisorEmail||null,advisor_name:f.advisorName||null});if(error){toast(error.message,"error");return false;}else{toast("Opportunity added");reload("deals");}};
  const edit=async f=>{const{error}=await sb.from("deals").update({contact_id:f.contactId||null,title:f.title,value:f.value||null,stage:f.stage,close_date:f.closeDate||null,advisor_email:f.advisorEmail||null,advisor_name:f.advisorName||null}).eq("id",modal.id);if(error){toast(error.message,"error");return false;}else{toast("Updated");reload("deals");}};
  const del=async id=>{if(!confirm("Delete this deal? This can't be undone."))return;const{error}=await sb.from("deals").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Deleted");reload("deals");}};
  const move=async(deal,dir)=>{const idx=STAGES.indexOf(deal.stage);const next=STAGES[idx+dir];if(!next)return;const{error}=await sb.from("deals").update({stage:next}).eq("id",deal.id);if(error)toast(error.message,"error");else reload("deals");};

  if(isAdmin&&viewMode==="advisors"){
    return <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",background:B.white}}>
        <div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
          {[{k:"pipeline",l:"Pipeline"},{k:"advisors",l:"By ORDANIS Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
        </div>
        <div style={{flex:1,fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Pipeline by ORDANIS Expert</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(320px,100%),1fr))",gap:16}}>
          {advisorSummary.length===0&&<Empty text="No ORDANIS Experts or deals yet."/>}
          {advisorSummary.map(a=>(
            <div key={a.email||"unassigned"} onClick={()=>{if(!a.unassigned){setAdvisorFilter(a.email);setViewMode("pipeline");}}}
              style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${a.unassigned?B.textMute:B.gold}`,padding:20,cursor:a.unassigned?"default":"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
              onMouseEnter={e=>{if(!a.unassigned)e.currentTarget.style.boxShadow=B.shadowMd;}}
              onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
              <div style={{marginBottom:12}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:a.unassigned?B.textMute:B.navy,fontWeight:600,marginBottom:2}}>{a.name}</div>
                <div style={{fontSize:12,color:B.textSoft}}>{a.email||"Opportunities not linked to a ORDANIS Expert's contact"}</div>
              </div>
              <div style={{height:1,background:`linear-gradient(90deg,${a.unassigned?B.textMute:B.gold},transparent)`,marginBottom:12}}/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(170px,100%),1fr))",gap:8}}>
                {[{l:"Open Opps",v:a.openDeals},{l:"Pipeline $",v:fmtMoney(a.pipeline)},{l:"Won",v:a.won},{l:"Lost",v:a.lost}].map(item=>(
                  <div key={item.l} style={{background:B.bg,borderRadius:6,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{item.l}</div>
                    <div style={{fontSize:15,fontFamily:"'Cormorant Garamond',serif",color:B.navy,fontWeight:600}}>{item.v}</div>
                  </div>
                ))}
              </div>
              {!a.unassigned&&<div style={{marginTop:10,fontSize:12,color:B.gold,fontWeight:600}}>View pipeline →</div>}
            </div>
          ))}
        </div>
      </div>
      {modal==="add"&&<Modal title="New Opportunity" onClose={()=>setModal(null)}><ProspectDealForm contacts={contacts} userProfile={userProfile} advisors={advisors} onSave={add} onClose={()=>setModal(null)}/></Modal>}
    </div>;
  }

  return <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
    <div style={{padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",background:B.white}}>
      {isAdmin&&<div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
        {[{k:"pipeline",l:"Pipeline"},{k:"advisors",l:"By ORDANIS Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
      </div>}
      <div style={{flex:1,display:"flex",gap:5,flexWrap:"wrap"}}>{["All",...STAGES].map(s=><button key={s} onClick={()=>setFs(s)} style={{background:fs===s?(STAGE_COLORS[s]?.bg||B.borderLight):"transparent",border:`1px solid ${fs===s?(STAGE_COLORS[s]?.dot||B.navy):B.border}`,color:fs===s?(STAGE_COLORS[s]?.text||B.navy):B.textSoft,borderRadius:20,padding:"3px 12px",fontSize:11,cursor:"pointer",fontWeight:700,fontFamily:"inherit"}}>{s}</button>)}</div>
      {advisorFilter&&<button onClick={()=>setAdvisorFilter("")} style={{border:`1px solid ${B.gold}`,background:"#fbf6ec",color:B.navy,borderRadius:16,padding:"5px 11px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>{(advisorSummary.find(a=>a.email===advisorFilter)?.name)||advisorFilter} ✕</button>}
      <div style={{fontSize:12,color:B.textSoft}}>Pipeline: <strong style={{color:B.navy}}>{fmtMoney(pipeline)}</strong></div>
      <Btn onClick={()=>setModal("add")}>+ New Opportunity</Btn>
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"6px 0"}}>
      {filtered.length===0&&<Empty text="No prospect opportunities yet."/>}
      {STAGES.map(stage=>{const list=byStage[stage];if(!list?.length)return null;return <div key={stage}>
        <div style={{padding:"8px 20px 3px",display:"flex",alignItems:"center",gap:7}}><span style={{width:7,height:7,borderRadius:"50%",background:STAGE_COLORS[stage].dot}}/><span style={{fontSize:11,fontWeight:800,color:STAGE_COLORS[stage].dot,letterSpacing:"0.1em",textTransform:"uppercase"}}>{stage}</span></div>
        {list.map(deal=>{const contact=gc(deal.contactId);return <div key={deal.id} style={{margin:"3px 20px",padding:"12px 15px",background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`3px solid ${STAGE_COLORS[deal.stage].dot}`,borderRadius:10,display:"flex",alignItems:"center",gap:10,boxShadow:B.shadow}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,color:B.navy,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{deal.title}</div><div style={{fontSize:12,color:B.textSoft}}>{contact?contact.name:"No contact"}{deal.closeDate?` · ${fmt(deal.closeDate)}`:""}</div>{isAdmin&&<div style={{fontSize:11,color:deal.advisorEmail?B.gold:B.textMute,fontWeight:600,marginTop:2}}>{deal.advisorName||deal.advisorEmail||"Unassigned"}</div>}</div>
          {deal.value&&<div style={{color:B.navy,fontWeight:800,fontSize:14}}>{fmtMoney(deal.value)}</div>}
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>move(deal,-1)} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:14}}>←</button>
            <button onClick={()=>move(deal,1)} style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:14}}>→</button>
            <Btn small variant="ghost" onClick={()=>setModal(deal)}>Edit</Btn>
            <Btn small variant="danger" onClick={()=>del(deal.id)}>✕</Btn>
          </div>
        </div>;})}
      </div>;})}
    </div>
    {modal==="add"&&<Modal title="New Opportunity" onClose={()=>setModal(null)}><ProspectDealForm contacts={contacts} userProfile={userProfile} advisors={advisors} onSave={add} onClose={()=>setModal(null)}/></Modal>}
    {modal&&modal!=="add"&&<Modal title="Edit Opportunity" onClose={()=>setModal(null)}><ProspectDealForm initial={modal} contacts={contacts} userProfile={userProfile} advisors={advisors} onSave={edit} onClose={()=>setModal(null)}/></Modal>}
  </div>;
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
// Collects every hard date across the platform into one upcoming-deadline feed:
// task due dates, loan maturities, insurance + flood expirations, deal close
// dates (one-time), and recurring annual birthdays + anniversaries.
// ── BILLS ─────────────────────────────────────────────────────────────────────
// Bills are deliberately NOT folded into collectDeadlines. A household's recurring
// bills turn over every month, so a combined list would be mostly bills and the
// one-off deadlines that actually need a decision would be buried in them. They
// also demand a different action: a deadline is acknowledged, a bill is paid and
// recorded.
//
// nextBillDue mirrors the SQL function of the same name (see the bill_payment_reminders
// migration) so the dashboard and the reminder emails can never disagree about when
// something is due. Month-based frequencies re-anchor on the ORIGINAL day of month
// and clamp to the month's length, because repeatedly adding a month to 31 January
// walks to the 28th and stays there — which would quietly move every month-end
// mortgage three days early, forever.
function nextBillDue(startDate,frequency,endDate,fromDate){
  if(!startDate)return null;
  const freq=String(frequency||"once").toLowerCase();
  const parse=s=>{const d=new Date(s+"T12:00:00");return isNaN(d.getTime())?null:d;};
  const start=parse(startDate); if(!start)return null;
  const from=fromDate?new Date(fromDate):new Date(); from.setHours(12,0,0,0);
  const end=endDate?parse(endDate):null;
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const done=d=>(end&&d>end)?null:iso(d);

  if(["once","one-time","onetime",""].includes(freq)) return start>=from?done(start):null;

  const months={monthly:1,quarterly:3,semiannually:6,"semi-annually":6,annually:12,yearly:12}[freq];
  if(months){
    const anchorDay=start.getDate();
    let n=Math.max(0,Math.floor(((from.getFullYear()-start.getFullYear())*12+(from.getMonth()-start.getMonth()))/months)-1);
    for(let guard=0;guard<2000;guard++){
      const m=new Date(start.getFullYear(),start.getMonth()+months*n,1,12,0,0);
      const dim=new Date(m.getFullYear(),m.getMonth()+1,0).getDate();
      const cand=new Date(m.getFullYear(),m.getMonth(),Math.min(anchorDay,dim),12,0,0);
      if(cand>=from) return done(cand);
      n++;
    }
    return null;
  }

  const weeks={weekly:7,biweekly:14}[freq];
  // An unrecognised frequency must not quietly behave like a one-off; skip it rather
  // than announcing a due date nobody is expecting.
  if(!weeks)return null;
  let d=new Date(start);
  if(d<from){
    const steps=Math.max(0,Math.floor((from-d)/(weeks*86400000))-1);
    d=new Date(d.getTime()+steps*weeks*86400000);
    let guard=0;
    while(d<from&&guard++<5000) d=new Date(d.getTime()+weeks*86400000);
  }
  return done(d);
}

// Bills the firm is responsible for: unpaid ones from the last 90 days (shown as overdue) and
// those due inside the window. How "paid" is recorded depends on the frequency, and this must
// match the Cash Flow tab exactly:
//   * monthly / quarterly / annually: the payment register, one cash_flow_payment_log row per
//     period, keyed by the FIRST of the due month (getRegisterPeriods). Before 2026-10-14 this
//     compared the exact due date instead, so only bills due on the 1st ever showed as paid.
//   * one-offs, weekly, biweekly, semiannual: the single paid flag on the expense itself.
// Each occurrence is checked separately, so last month's unpaid bill stays on the list as overdue
// rather than being replaced by next month's date.
const BILL_REGISTER_FREQS=["monthly","quarterly","annually"];
const BILL_LOOKBACK_DAYS=90;
function collectBills({events=[],families=[],paymentLog=[],windowDays=45}){
  const today=new Date(); today.setHours(12,0,0,0);
  const lookFrom=new Date(today); lookFrom.setDate(lookFrom.getDate()-BILL_LOOKBACK_DAYS);
  const famName=id=>{const f=families.find(x=>x.id===id);return f?f.name:null;};
  const paidPeriods=new Set((paymentLog||[]).filter(l=>l&&l.paid).map(l=>`${l.eventId}|${String(l.period||"").slice(0,10)}`));
  const periodOf=iso=>iso.slice(0,7)+"-01";
  const out=[];
  (events||[]).forEach(e=>{
    if(!e||e.direction!=="expense"||!e.pcmResponsible)return;
    const freq=String(e.frequency||"once").toLowerCase();
    const oneOff=["once","one-time","onetime",""].includes(freq);
    const register=BILL_REGISTER_FREQS.includes(freq);
    let cursor=new Date(lookFrom);
    for(let guard=0;guard<120;guard++){
      const due=nextBillDue(e.startDate,e.frequency,e.endDate,cursor);
      if(!due)break;
      const d=new Date(due+"T12:00:00");
      const days=Math.round((d-today)/86400000);
      if(days>windowDays)break;
      const settled=register?paidPeriods.has(`${e.id}|${periodOf(due)}`):!!e.paid;
      // Weekly and biweekly bills have no per-occurrence record, so only their next date is shown.
      const pastWithoutRecord=!register&&!oneOff&&days<0;
      if(!settled&&!pastWithoutRecord){
        out.push({
          key:`bill:${e.id}:${due}`,id:e.id,dateISO:due,days,
          label:e.description||e.eventType||"Bill",
          amount:Number(e.amount)||0,frequency:e.frequency,category:e.category,
          familyId:e.familyId,familyName:famName(e.familyId),
          overdue:days<0,
        });
      }
      if(oneOff)break;
      cursor=new Date(d); cursor.setDate(cursor.getDate()+1);
    }
  });
  out.sort((a,b)=>a.days-b.days);
  return out;
}

// Where a deadline is actually dealt with. A renewal is edited on the property,
// not in a list of renewals, so the row opens the tab holding the record rather
// than a tab named after the deadline. Birthdays have no record to open, so they
// land on Overview.
const DEADLINE_TAB={task:"tasks",loan:"properties",insurance:"properties",flood:"properties",deal:"deals",birthday:"overview",anniversary:"overview"};
// Renders a note body with its paragraphs intact and collapses the long ones.
//
// pre-wrap rather than splitting on newlines and emitting <p> elements: the text is
// whatever someone typed, so honouring it exactly is more predictable than
// inferring structure from blank lines. Long notes are clamped rather than
// truncated, so nothing is lost — a meeting write-up should not turn a list of six
// notes into a page of scrolling, but neither should reading it require a click.
function NoteBody({body,size=13,clampChars=280,color}){
  const text=String(body||"");
  const [open,setOpen]=useState(false);
  const long=text.length>clampChars||text.split("\n").length>6;
  return <div>
    <div style={{fontSize:size,color,lineHeight:size>13?1.7:1.55,whiteSpace:"pre-wrap",wordBreak:"break-word",
      ...(long&&!open?{display:"-webkit-box",WebkitLineClamp:6,WebkitBoxOrient:"vertical",overflow:"hidden"}:{})}}>{text}</div>
    {long&&<button onClick={e=>{e.stopPropagation();setOpen(!open);}}
      style={{background:"none",border:"none",padding:0,marginTop:4,color:"#8a7333",cursor:"pointer",fontSize:11,fontWeight:600}}>
      {open?"Show less":"Show more"}
    </button>}
  </div>;
}

const DEADLINE_TAG={task:"Task",loan:"Loan maturity",insurance:"Insurance",flood:"Flood insurance",deal:"Deal close",birthday:"Birthday",anniversary:"Anniversary"};
function collectDeadlines({tasks=[],properties=[],loans=[],deals=[],contacts=[],families=[],acks=[],windowDays=60}){
  const today=new Date(); today.setHours(0,0,0,0);
  const famName=id=>{const f=families.find(x=>x.id===id);return f?f.name:null;};
  const toISO=dt=>`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
  const ackMap={}; (acks||[]).forEach(a=>{if(a&&a.itemKey)ackMap[a.itemKey]=a;});
  const items=[];
  const pushOnce=(dateStr,label,type,familyId,entityId)=>{
    if(!dateStr)return; const t=parseLocalDate(dateStr); if(isNaN(t.getTime()))return;
    const t0=new Date(t.getFullYear(),t.getMonth(),t.getDate());
    const days=Math.round((t0-today)/86400000);
    if(days>windowDays)return;
    const dateISO=toISO(t0); const key=`${type}:${entityId}:${dateISO}`;
    const ack=ackMap[key];
    items.push({key,dateISO,days,label,type,familyName:famName(familyId),overdue:!ack&&days<0,done:!!ack,completedBy:ack?ack.completedBy:null,completedAt:ack?ack.completedAt:null,familyId,occurrenceDate:dateISO});
  };
  const pushAnnual=(dateStr,label,type,familyId,entityId)=>{
    if(!dateStr)return; const t=parseLocalDate(dateStr); if(isNaN(t.getTime()))return;
    let next=new Date(today.getFullYear(),t.getMonth(),t.getDate());
    if(next<today) next=new Date(today.getFullYear()+1,t.getMonth(),t.getDate());
    const days=Math.round((next-today)/86400000);
    if(days>windowDays)return;
    const dateISO=toISO(next); const key=`${type}:${entityId}:${dateISO}`;
    const ack=ackMap[key];
    items.push({key,dateISO,days,label,type,familyName:famName(familyId),overdue:false,done:!!ack,completedBy:ack?ack.completedBy:null,completedAt:ack?ack.completedAt:null,familyId,occurrenceDate:dateISO});
  };
  // Tasks are their own completion model (done + completed_by/at); show pending only.
  (tasks||[]).filter(t=>!t.done&&t.dueDate).forEach(t=>{
    const dt=parseLocalDate(t.dueDate); if(isNaN(dt.getTime()))return;
    const t0=new Date(dt.getFullYear(),dt.getMonth(),dt.getDate());
    const days=Math.round((t0-today)/86400000);
    if(days>windowDays)return;
    items.push({key:`task:${t.id}`,dateISO:toISO(t0),days,label:t.title||"Task",type:"task",familyName:famName(t.familyId),overdue:days<0,done:false,isTask:true,task:t,familyId:t.familyId});
  });
  (properties||[]).forEach(p=>{
    const addr=p.address||"property";
    pushOnce(p.loanMaturityDate,`Loan matures — ${addr}`,"loan",p.familyId,p.id);
    pushOnce(p.insuranceExpiration,`Insurance renews — ${addr}`,"insurance",p.familyId,p.id);
    pushOnce(p.floodInsuranceExpiration,`Flood insurance renews — ${addr}`,"flood",p.familyId,p.id);
  });
  (loans||[]).forEach(l=>pushOnce(l.maturityDate,`${DEBT_LINE_KINDS.has(l.loanType)?"Line renews / ends":"Loan matures"} — ${loanTitle(l)}`,"loan",l.familyId,l.id));
  (deals||[]).filter(d=>d.stage!=="Closed Won"&&d.stage!=="Closed Lost").forEach(d=>pushOnce(d.closeDate,`Deal close — ${d.title||"deal"}`,"deal",d.familyId,d.id));
  (contacts||[]).forEach(c=>{
    pushAnnual(c.dob,`${c.name||"Client"} — birthday`,"birthday",c.familyId,c.id);
    pushAnnual(c.anniversary,`${c.name||"Client"} — anniversary`,"anniversary",c.familyId,c.id);
  });
  // Pending first (soonest), then done items (soonest), so completed ones sink.
  items.sort((a,b)=>(a.done?1:0)-(b.done?1:0)||a.days-b.days);
  return items;
}

// ── REVIEW QUEUE ─────────────────────────────────────────────────────────────
// The first thing an Expert should see: every workflow step anywhere in their book
// that is waiting on a person. Renders nothing when the queue is empty, so a clear
// desk looks like a clear desk rather than an empty panel.
function ReviewQueue({families,toast,userProfile}){
  const[rows,setRows]=useState([]);
  const[busy,setBusy]=useState(null);
  const[review,setReview]=useState(null);
  // Names come from the households already loaded; with staff data on demand that list can be empty, so any missing
  // ones are looked up for just the steps shown.
  const[extraNames,setExtraNames]=useState({});
  const famName=id=>(families.find(f=>f.id===id)?.name||extraNames[id]||"").replace(" [DEMO]","");

  const load=async()=>{
    // RLS already limits this to the caller's own families, so no client-side
    // filtering is needed — and none should be relied on.
    //
    // No plan filter either, and that is not an oversight. A household on a plan without workflow
    // support can still have workflow_instance rows on file (a downgrade pauses them rather than
    // being refused), but pausing an instance also pauses its still-open steps to 'paused' -- a
    // status this query's .in(...) list does not include -- so no step reaching this query can
    // belong to such a household. Filtering here would need an extra instance -> family lookup
    // that could never remove a row. See the note at the foot of src/plans.js, and the
    // sync_plan_capabilities_on_change DB trigger.
    const{data}=await sb.from("workflow_instance_steps")
      .select("*")
      // 'approved' belongs here: approving no longer means sent, so an approved
      // draft still needs someone to send it. Omitting it would make the step
      // vanish from the queue while the work was still outstanding.
      .in("status",["ready","awaiting_approval","approved","blocked"])
      .order("due_on")
      .limit(40);
    setRows(data||[]);
    const missing=[...new Set((data||[]).map(r=>r.family_id).filter(id=>id&&!families.some(f=>f.id===id)))];
    if(missing.length){
      const{data:fs}=await sb.from("families").select("id,name").in("id",missing);
      const m={};(fs||[]).forEach(f=>{m[f.id]=f.name;});setExtraNames(m);
    }
  };
  useEffect(()=>{load();},[]);

  const act=async(st,to)=>{
    setBusy(st.id);
    const patch=stepTransitionPatch(to,CURRENT_USER_LABEL||userProfile?.email||"—");
    const{error}=await sb.from("workflow_instance_steps").update(patch).eq("id",st.id);
    if(error)toast(error.message,"error");else{toast(to==="sent"?"Approved and sent":"Marked done");}
    setBusy(null);load();
  };

  if(!rows.length)return null;
  const today=todayISO();

  return <div style={{background:B.bgCard,borderRadius:12,padding:"20px 24px",border:`1px solid ${B.gold}`,borderTop:`3px solid ${B.gold}`,boxShadow:B.shadow,marginBottom:20}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:19,color:B.navy,fontWeight:600}}>
        Awaiting your review
      </div>
      <div style={{fontSize:11.5,color:B.textSoft}}>{rows.length} item{rows.length===1?"":"s"} across the book</div>
    </div>
    <GoldLine/>
    <div style={{marginTop:4}}>
      {rows.map(s=>{
        const late=s.due_on&&s.due_on<today;
        const outbound=["draft_email","draft_letter","draft_document"].includes(s.kind);
        return <div key={s.id} style={{display:"flex",gap:12,alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${B.borderLight}`,flexWrap:"wrap"}}>
          <div style={{minWidth:78,fontSize:11,fontWeight:late?700:400,color:late?"#8b1a1a":B.textSoft}}>
            {fmt(s.due_on)}{late?" ⚠":""}
          </div>
          <div style={{flex:1,minWidth:180}}>
            <div style={{fontSize:13,color:B.text,fontWeight:600}}>{s.title}</div>
            <div style={{fontSize:11,color:B.textSoft,marginTop:2}}>
              {famName(s.family_id)} · {kindLabel(s.kind)}{s.recipient?` · to ${s.recipient}`:""}
            </div>
          </div>
          <span style={{fontSize:10,fontWeight:700,borderRadius:20,padding:"3px 9px",
            background:(STEP_STATUS_TINT[s.status]||STEP_STATUS_TINT.pending).bg,
            color:(STEP_STATUS_TINT[s.status]||STEP_STATUS_TINT.pending).text,whiteSpace:"nowrap"}}>
            {statusWord(s.status)}
          </span>
          <Btn small variant={outbound?"gold":"ghost"} disabled={busy===s.id}
            onClick={()=>outbound?setReview(s):act(s,"done")}>
            {busy===s.id?"…":outbound?(s.status==="approved"?"Send":s.draft_body?"Review draft":"Prepare draft"):"Mark done"}
          </Btn>
        </div>;
      })}
    </div>
    <div style={{fontSize:11,color:B.textMute,marginTop:10,lineHeight:1.5}}>
      Approving records your name against the step. Nothing here has been sent yet.
    </div>
    {review&&<DraftReviewModal step={review} toast={toast} userProfile={userProfile}
      onClose={()=>setReview(null)} onApproved={load}/>}
  </div>;
}

// summary / scopeState / listsLocked / recentNotes come from DashboardOnDemand (scaling step 2); without them the
// dashboard works from the full download exactly as before.
function Dashboard({data,userProfile,reload,toast,onOpenFamily,summary,scopeState,listsLocked,recentNotes}){
  const isMobile=useIsMobile();
  const{families:_allFamilies,contacts:_contacts,properties:_properties,deals:_deals,notes:_notes,tasks:_tasks,portfolio_accounts:_accts=[]}=data;
  const isAdmin=userProfile?.role==="admin";
  const myEmail=(userProfile?.email||"").toLowerCase();
  // Admins default to "All ORDANIS Experts" and can switch; non-admins are locked to their own scope so unscoped prospect records (family_id null) don't leak in.
  // An Analyst's households all belong to other people (their Experts), so an own-email scope would show
  // nothing; their data is already limited to their Experts' households by the database.
  const[ownScope,setOwnScope]=useState(isAdmin||userProfile?.role==="analyst"?"":myEmail);
  const[scope,setScope]=scopeState||[ownScope,setOwnScope];
  const _families=(_allFamilies||[]).filter(f=>!(f.archived_at||f.archivedAt));
  const _famIds=new Set(_families.filter(f=>!scope||(f.advisorEmail||"").toLowerCase()===scope).map(f=>f.id));
  const _cAdv=id=>{const c=_contacts.find(x=>x.id===id);return (c?.advisorEmail||"").toLowerCase();};
  const families=scope?_families.filter(f=>(f.advisorEmail||"").toLowerCase()===scope):_families;
  const contacts=scope?_contacts.filter(c=>(c.advisorEmail||"").toLowerCase()===scope):_contacts;
  const properties=scope?_properties.filter(p=>_famIds.has(p.familyId)):_properties;
  const portfolio_accounts=scope?_accts.filter(a=>_famIds.has(a.familyId)):_accts;
  const notes=scope?_notes.filter(n=>n.familyId?_famIds.has(n.familyId):_cAdv(n.contactId)===scope):_notes;
  const tasks=scope?_tasks.filter(t=>t.familyId?_famIds.has(t.familyId):_cAdv(t.contactId)===scope):_tasks;
  const deals=scope?_deals.filter(d=>d.familyId?_famIds.has(d.familyId):((d.advisorEmail||"").toLowerCase()===scope)):_deals;
  const openDeals=deals.filter(d=>d.stage!=="Closed Lost"&&d.stage!=="Closed Won");
  const pipeline=openDeals.reduce((s,d)=>s+(Number(d.value)||0),0);
  const totalRE=properties.reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0);
  const totalDebt=properties.reduce((s,p)=>s+(Number(p.loanBalance)||0)+(Number(p.secondMortgageBalance)||0),0)+portfolio_accounts.filter(a=>a.accountType==="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0)+loansDebt(scope?(data.loans||[]).filter(l=>_famIds.has(l.familyId)):(data.loans||[]));
  const totalPortfolio=portfolio_accounts.filter(a=>a.accountType!=="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const pending=tasks.filter(t=>!t.done);
  const overdue=pending.filter(t=>t.dueDate&&dueEnd(t.dueDate)<new Date());
  const dueSoon=pending.filter(t=>t.dueDate&&!overdue.includes(t)&&(dueEnd(t.dueDate)-new Date())/(86400000)<=30);
  const _famIdSet=new Set(families.map(f=>f.id));
  const deadlineContacts=(_contacts||[]).filter(c=>!scope||_famIdSet.has(c.familyId)||(c.advisorEmail||"").toLowerCase()===scope);
  const _acks=data.deadline_acks||[];
  const deadlines=collectDeadlines({tasks,properties,loans:(data.loans||[]).filter(l=>_famIdSet.has(l.familyId)),deals,contacts:deadlineContacts,families,acks:_acks,windowDays:60});
  const bills=collectBills({events:(data.cash_flow_events||[]).filter(e=>!scope||_famIdSet.has(e.familyId)),families,paymentLog:data.cash_flow_payment_log||[],windowDays:45});
  const billsTotal=bills.reduce((s,b)=>s+b.amount,0);
  const userLabel=(userProfile&&(userProfile.fullName||userProfile.email))||"";
  const completeDeadline=async d=>{
    try{
      if(d.isTask&&d.task){
        const t=d.task;
        const{error}=await sb.from("tasks").update({done:true,completed_at:new Date().toISOString(),completed_by:userLabel||null}).eq("id",t.id);
        if(error)throw error;
        if(t.recurrence){const nd=nextRecurrence(t.dueDate,t.recurrence,t.recurrenceInterval,t.recurrenceUnit);if(nd)await scheduleNextOccurrence(t,t.familyId||null,nd,toast);}
        if(reload)reload("tasks");
        if(toast)toast("Task completed");
      } else {
        const{error}=await sb.from("deadline_acks").insert({family_id:d.familyId||null,item_key:d.key,item_label:d.label,item_type:d.type,occurrence_date:d.occurrenceDate||null,completed_by:userLabel||null,completed_at:new Date().toISOString()});
        if(error)throw error;
        if(reload)reload("deadline_acks");
        if(toast)toast("Marked handled");
      }
    }catch(e){ if(toast)toast(e.message||"Could not update","error"); }
  };
  const undoDeadline=async d=>{
    try{
      const{error}=await sb.from("deadline_acks").delete().eq("item_key",d.key);
      if(error)throw error;
      if(reload)reload("deadline_acks");
    }catch(e){ if(toast)toast(e.message||"Could not undo","error"); }
  };
  const stageCounts=STAGES.map(s=>({stage:s,count:deals.filter(d=>d.stage===s).length,value:deals.filter(d=>d.stage===s).reduce((sum,d)=>sum+(Number(d.value)||0),0)}));
  const maxC=Math.max(1,...stageCounts.map(s=>s.count));
  const gf=id=>families.find(f=>f.id===id)||(recentNotes&&recentNotes.famById[id]);
  const hr=new Date().getHours();
  // The four totals cards: the server's figures when on demand, otherwise counted here as before.
  const S=summary||{families:families.length,contacts:contacts.length,realEstate:totalRE,properties:properties.length,portfolio:totalPortfolio,accounts:portfolio_accounts.length,openTasks:pending.length,overdue:overdue.length,dueSoon:dueSoon.length};
  const lockedCard=title=><div key={title} style={{background:B.bgCard,borderRadius:12,padding:24,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600,marginBottom:4}}>{title}</div>
    <GoldLine/>
    <div style={{fontSize:13,color:B.textSoft,lineHeight:1.6}}>Choose an ORDANIS Expert at the top of the page to see this list for their households.</div>
  </div>;

  return <div style={{overflowY:"auto",height:"100%",padding:isMobile?"18px 14px 32px":"26px 30px 48px"}}>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:isMobile?16:24}}>
      <div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?22:28,color:B.navy,fontWeight:600,marginBottom:4}}>Good {hr<12?"Morning":hr<17?"Afternoon":"Evening"}</div>
        <div style={{color:B.textSoft,fontSize:isMobile?12:14}}>{BRAND.name} — Portfolio & Client Overview{isAdmin&&scope?" · filtered by ORDANIS Expert":""}</div>
        <div style={{height:2,width:56,background:B.gold,marginTop:10,borderRadius:2}}/>
      </div>
      <AdvisorScopeBar userProfile={userProfile} value={scope} onChange={setScope}/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(140px,100%),1fr))",gap:14,marginBottom:24}}>
      {[{label:"Families",value:S.families,sub:`${S.contacts} contacts`,accent:B.navy},{label:"Real Estate",value:fmtMoney(S.realEstate),sub:`${S.properties} properties`,accent:B.gold},{label:"Portfolio",value:fmtMoney(S.portfolio),sub:`${S.accounts} accounts`,accent:B.navyMid},{label:"Open Tasks",value:S.openTasks,sub:S.overdue>0?`${S.overdue} overdue`:S.dueSoon>0?`${S.dueSoon} due soon`:"All on track",accent:S.overdue>0?"#d43030":S.dueSoon>0?"#d4900a":B.navyMid}].map(s=><div key={s.label} style={{background:B.bgCard,borderRadius:12,padding:"20px 22px",border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,borderTop:`3px solid ${s.accent}`}}>
        <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>{s.label}</div>
        <div style={{fontSize:26,fontFamily:"'Cormorant Garamond',serif",color:B.navy,fontWeight:600,lineHeight:1}}>{s.value}</div>
        <div style={{fontSize:11,color:B.textSoft,marginTop:5}}>{s.sub}</div>
      </div>)}
    </div>
    <ReviewQueue families={families} toast={toast} userProfile={userProfile}/>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(280px,100%),1fr))",gap:18,marginBottom:18}}>
      {/* PIPELINE_CARD_REMOVED — the deal pipeline card was admin-only, so the
          dashboard showed a prospecting CRM to admins and not to anyone else.
          ORDANIS does not sell pipeline management. */}
      {listsLocked&&lockedCard("Bills Due")}
      {listsLocked&&lockedCard("Upcoming Deadlines")}
      {!listsLocked&&bills.length>0&&<div style={{background:B.bgCard,borderRadius:12,padding:24,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4,gap:12,flexWrap:"wrap"}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Bills Due</div>
          <div style={{fontSize:12,color:B.textSoft}}><span style={{fontWeight:700,color:B.navy}}>{fmtMoney(billsTotal)}</span> across {bills.length} bill{bills.length===1?"":"s"}</div>
        </div>
        <GoldLine/>
        {bills.slice(0,10).map(b=>{
          const col=b.overdue?"#d43030":b.days<=3?"#d4900a":B.navyMid;
          const go=()=>onOpenFamily&&onOpenFamily(b.familyId,"cashflow");
          // Rendered as a real button so it is reachable by keyboard and announced
          // as an action, rather than a div that happens to respond to clicks.
          return <button key={b.key} onClick={go} disabled={!onOpenFamily}
            title={onOpenFamily?`Open ${b.familyName||"this family"} — Cash Flow`:undefined}
            style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${B.borderLight}`,width:"100%",background:"none",border:"none",borderRadius:0,textAlign:"left",font:"inherit",color:"inherit",cursor:onOpenFamily?"pointer":"default"}}
            onMouseEnter={e=>{if(onOpenFamily)e.currentTarget.style.background=B.bg;}}
            onMouseLeave={e=>{e.currentTarget.style.background="none";}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:col,flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,color:B.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.label}</div>
              <div style={{fontSize:11,color:B.textMute}}>{[b.familyName,b.category,b.frequency].filter(Boolean).join(" · ")}</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:13,color:B.navy,fontWeight:700,whiteSpace:"nowrap"}}>{fmtMoney(b.amount)}</div>
              <div style={{fontSize:10,color:col,fontWeight:600,whiteSpace:"nowrap"}}>{b.overdue?`⚠ ${Math.abs(b.days)}d overdue`:b.days===0?"due today":`in ${b.days}d`} · {fmt(b.dateISO)}</div>
            </div>
            {onOpenFamily&&<span aria-hidden="true" style={{color:B.textMute,fontSize:14,flexShrink:0}}>›</span>}
          </button>;
        })}
        {bills.length>10&&<div style={{fontSize:11,color:B.textMute,paddingTop:8}}>+{bills.length-10} more in Cash Flow</div>}
        <div style={{fontSize:11,color:B.textMute,paddingTop:10}}>Mark each bill paid in Cash Flow once settled.</div>
      </div>}
      {!listsLocked&&<div style={{background:B.bgCard,borderRadius:12,padding:24,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600,marginBottom:4}}>Upcoming Deadlines</div>
        <GoldLine/>
        {deadlines.length===0&&<Empty text="No upcoming deadlines right now."/>}
        {deadlines.slice(0,10).map((d,i)=>{const soon=d.days<=14;const col=d.done?"#2e9e57":d.overdue?"#d43030":soon?"#d4900a":B.navyMid;const goD=()=>{if(onOpenFamily&&d.familyId)onOpenFamily(d.familyId,DEADLINE_TAB[d.type]||"overview");};
        const openable=!!(onOpenFamily&&d.familyId);
        return <div key={d.key||i}
          onClick={openable?goD:undefined}
          role={openable?"button":undefined} tabIndex={openable?0:undefined}
          onKeyDown={openable?(e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();goD();}}):undefined}
          title={openable?`Open ${d.familyName||"this family"}`:undefined}
          onMouseEnter={e=>{if(openable)e.currentTarget.style.background=B.bg;}}
          onMouseLeave={e=>{e.currentTarget.style.background="none";}}
          style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${B.borderLight}`,opacity:d.done?0.62:1,cursor:openable?"pointer":"default"}}>
          {/* stopPropagation matters: ticking an item off should not also navigate
              away from the list the user is working down. */}
          <button onClick={e=>{e.stopPropagation();d.done?undoDeadline(d):completeDeadline(d);}} title={d.done?"Undo":"Mark done"} style={{width:18,height:18,borderRadius:"50%",flexShrink:0,cursor:"pointer",border:`2px solid ${d.done?"#2e9e57":col}`,background:d.done?"#2e9e57":"transparent",color:"#fff",fontSize:11,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>{d.done?"✓":""}</button>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,color:B.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:d.done?"line-through":"none"}}>{d.label}</div><div style={{fontSize:11,color:B.textMute}}>{d.done?`✓ ${DEADLINE_TAG[d.type]||d.type} · done${d.completedBy?` by ${d.completedBy}`:""}`:[DEADLINE_TAG[d.type]||d.type,d.familyName].filter(Boolean).join(" · ")}</div></div>
          <div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:11,color:col,fontWeight:700,whiteSpace:"nowrap"}}>{!d.done&&d.overdue?"⚠ ":""}{fmt(d.dateISO)}</div><div style={{fontSize:10,color:B.textMute}}>{d.done?"handled":d.overdue?`${Math.abs(d.days)}d ago`:d.days===0?"today":`in ${d.days}d`}</div></div>
        </div>;})}
      </div>}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(280px,100%),1fr))",gap:18}}>
      {listsLocked&&lockedCard("Portfolio by Family")}
      {!listsLocked&&<div style={{background:B.bgCard,borderRadius:12,padding:24,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600,marginBottom:4}}>Portfolio by Family</div>
        <GoldLine/>
        {families.map(f=>{const val=properties.filter(p=>p.familyId===f.id).reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0)+portfolio_accounts.filter(a=>a.familyId===f.id).reduce((s,a)=>s+(Number(a.currentBalance)||0),0);const pct=totalRE+totalPortfolio>0?Math.round((val/(totalRE+totalPortfolio))*100):0;const goP=()=>{if(onOpenFamily)onOpenFamily(f.id,"portfolio");};
        return <div key={f.id}
          onClick={onOpenFamily?goP:undefined}
          role={onOpenFamily?"button":undefined} tabIndex={onOpenFamily?0:undefined}
          onKeyDown={onOpenFamily?(e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();goP();}}):undefined}
          title={onOpenFamily?`Open ${f.name} — Portfolio`:undefined}
          style={{marginBottom:12,cursor:onOpenFamily?"pointer":"default"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:13,color:B.textMid,fontWeight:600}}>{f.name}</span><span style={{fontSize:12,color:B.textSoft}}>{fmtMoney(val)}</span></div>
          <div style={{height:6,background:B.borderLight,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:B.navy,borderRadius:3}}/></div>
        </div>;})}
        {families.length===0&&<Empty text="No families yet."/>}
      </div>}
      <div style={{background:B.bgCard,borderRadius:12,padding:24,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600,marginBottom:4}}>Recent Notes</div>
        <GoldLine/>
        {(recentNotes?recentNotes.rows:[...notes].sort((a,b)=>b.createdAt>a.createdAt?1:-1).slice(0,4)).map(n=>{const fam=gf(n.familyId);const goN=()=>{if(onOpenFamily&&n.familyId)onOpenFamily(n.familyId,"notes");};
        const openN=!!(onOpenFamily&&n.familyId);
        return <div key={n.id}
          onClick={openN?goN:undefined}
          role={openN?"button":undefined} tabIndex={openN?0:undefined}
          onKeyDown={openN?(e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();goN();}}):undefined}
          title={openN?`Open ${fam?fam.name:"this family"} — Notes`:undefined}
          onMouseEnter={e=>{if(openN)e.currentTarget.style.background=B.bg;}}
          onMouseLeave={e=>{e.currentTarget.style.background="none";}}
          style={{padding:"8px 0",borderBottom:`1px solid ${B.borderLight}`,cursor:openN?"pointer":"default"}}>
          <div style={{fontSize:13,color:B.textMid,lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{n.body}</div>
          <div style={{display:"flex",gap:8,marginTop:3}}><span style={{fontSize:11,color:B.textMute}}>{fmt(n.createdAt)}</span>{fam&&<span style={{fontSize:11,color:B.gold,fontWeight:700}}>{fam.name}</span>}</div>
        </div>;})}
        {(recentNotes?recentNotes.rows:notes).length===0&&<Empty text="No notes yet. Jot down anything worth remembering."/>}
      </div>
    </div>
  </div>;
}

// ── STAFF DASHBOARD ON DEMAND (scaling step 2) ────────────────────────────────
// The totals cards come from staff_dashboard_summary. Bills Due, Upcoming Deadlines and Portfolio by Family need the
// households' records, so they load for the households in scope: an Expert's own book, an Analyst's Experts, or the
// Expert an admin picks. An admin on "All ORDANIS Experts" sees the totals and is asked to pick an Expert for those
// lists (Will, 2026-10-31). Everything is then drawn by the same Dashboard as before.
const DASHBOARD_TABLES=["contacts","properties","deals","notes","tasks","portfolio_accounts","loans","cash_flow_events","cash_flow_payment_log","deadline_acks"];
const likeExact=v=>String(v||"").replace(/[\\%_]/g,c=>"\\"+c);
function DashboardOnDemand({userProfile,toast,onOpenFamily}){
  const isAdmin=userProfile?.role==="admin";
  const myEmail=(userProfile?.email||"").toLowerCase();
  const scopeState=useState(isAdmin||userProfile?.role==="analyst"?"":myEmail);
  const scope=scopeState[0];
  const listsLocked=isAdmin&&!scope;
  const[summary,setSummary]=useState(null);
  const[data,setData]=useState(null);
  const[recentNotes,setRecentNotes]=useState(undefined);
  const[nonce,setNonce]=useState(0);
  useEffect(()=>{
    let gone=false;
    (async()=>{
      try{
        const{data:s,error}=await sb.rpc("staff_dashboard_summary",{p_scope:scope||null,p_today:localISODate()});
        if(error)throw error;
        if(!gone)setSummary({families:Number(s.families)||0,contacts:Number(s.contacts)||0,realEstate:Number(s.real_estate)||0,properties:Number(s.properties)||0,portfolio:Number(s.portfolio)||0,accounts:Number(s.accounts)||0,openTasks:Number(s.open_tasks)||0,overdue:Number(s.overdue)||0,dueSoon:Number(s.due_soon)||0});
        if(listsLocked){
          // Just the four newest notes, with their household names.
          const{data:ns,error:ne}=await sb.from("notes").select("*").not("family_id","is",null).order("created_at",{ascending:false}).limit(4);
          if(ne)throw ne;
          const ids=[...new Set((ns||[]).map(n=>n.family_id))];
          const{data:fs}=ids.length?await sb.from("families").select("id,name").in("id",ids):{data:[]};
          const famById={};(fs||[]).forEach(f=>{famById[f.id]=f;});
          if(!gone){setRecentNotes({rows:(ns||[]).map(toClient),famById});setData({families:[],...Object.fromEntries(DASHBOARD_TABLES.map(t=>[t,[]]))});}
          return;
        }
        let fq=()=>{let q=sb.from("families").select("*").is("archived_at",null);if(scope)q=q.ilike("advisor_email",likeExact(scope));return q.order("name").order("id");};
        const fams=(await fetchAllRows(fq)).map(toClient);
        const t=await loadFamiliesTables(fams.map(f=>f.id),DASHBOARD_TABLES);
        if(!gone){setRecentNotes(undefined);setData({families:fams,...t});}
      }catch(e){if(!gone)toast("Could not load the dashboard","error");}
    })();
    return()=>{gone=true;};
  },[scope,nonce]);
  const reload=useCallback(async()=>{setNonce(n=>n+1);},[]);
  if(!summary||!data)return <Spinner/>;
  return <Dashboard data={data} userProfile={userProfile} reload={reload} toast={toast} onOpenFamily={onOpenFamily}
    summary={summary} scopeState={scopeState} listsLocked={listsLocked} recentNotes={recentNotes}/>;
}

// ── STAFF LISTS ACROSS HOUSEHOLDS, ON DEMAND (scaling step 2) ─────────────────
// Portfolio, Notes and Tasks across households: the households in scope (an Expert's own book, an Analyst's Experts,
// or the Expert an admin picks here) and the listed tables are loaded when the screen opens, then the same screen as
// before draws them. An admin chooses an Expert first, as on the dashboard.
function ScopedStaffView({userProfile,toast,tables,what,render}){
  const isAdmin=userProfile?.role==="admin";
  const myEmail=(userProfile?.email||"").toLowerCase();
  const[scope,setScope]=useState(isAdmin||userProfile?.role==="analyst"?"":myEmail);
  const locked=isAdmin&&!scope;
  const[data,setData]=useState(null);
  const[nonce,setNonce]=useState(0);
  useEffect(()=>{
    if(locked){setData(null);return;}
    let gone=false;
    setData(null);
    (async()=>{
      try{
        const fq=()=>{let q=sb.from("families").select("*").is("archived_at",null);if(scope)q=q.ilike("advisor_email",likeExact(scope));return q.order("name").order("id");};
        const fams=(await fetchAllRows(fq)).map(toClient);
        const t=await loadFamiliesTables(fams.map(f=>f.id),tables);
        const extra=tables.includes("notes")?{note_attachments:await loadNoteAttachments((t.notes||[]).map(n=>n.id))}:{};
        if(!gone)setData({families:fams,contacts:[],...t,...extra});
      }catch(e){if(!gone)toast(`Could not load ${what}`,"error");}
    })();
    return()=>{gone=true;};
  },[scope,locked,nonce]);
  const reload=useCallback(async()=>{setNonce(n=>n+1);},[]);
  return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
    {isAdmin&&<div style={{padding:"10px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",justifyContent:"flex-end"}}>
      <AdvisorScopeBar userProfile={userProfile} value={scope} onChange={setScope}/>
    </div>}
    <div style={{flex:1,minHeight:0}}>
      {locked?<div style={{padding:40,textAlign:"center",color:B.textSoft,fontSize:14,lineHeight:1.6}}>Choose an ORDANIS Expert above to see {what} for their households.</div>
        :!data?<Spinner/>:render(data,reload)}
    </div>
  </div>;
}

// Every household the person can see (names, plans, billing fields), for the admin screens that pick or name
// households. Loaded when one of those screens opens, page by page, instead of at sign-in.
function useAllFamilies(enabled){
  const[fams,setFams]=useState(null);
  const[nonce,setNonce]=useState(0);
  useEffect(()=>{
    if(!enabled)return;
    let gone=false;
    fetchAllRows(()=>sb.from("families").select("*").order("name").order("id")).then(rows=>{if(!gone)setFams(rows.map(toClient));}).catch(()=>{if(!gone)setFams([]);});
    return()=>{gone=true;};
  },[enabled,nonce]);
  return[fams,()=>setNonce(n=>n+1)];
}

// Signups & Revenue: every household (archived included, as before) plus, per household, whether it has anything in
// each feature area (staff_family_activity_flags), shaped like the old download so the screen is unchanged. Loaded
// when the screen opens.
function SignupsOnDemand({userProfile,toast}){
  const[fams,refresh]=useAllFamilies(true);
  const[flags,setFlags]=useState(null);
  useEffect(()=>{
    fetchAllRows(()=>sb.rpc("staff_family_activity_flags")).then(setFlags).catch(()=>{toast("Could not load household activity","error");setFlags([]);});
  },[fams]);
  if(!fams||!flags)return <Spinner/>;
  const rowsFor=k=>flags.filter(f=>f[k]).map(f=>({familyId:f.family_id}));
  const data={families:fams,properties:rowsFor("has_properties"),portfolio_accounts:rowsFor("has_accounts"),valuables:rowsFor("has_valuables"),
    documents:rowsFor("has_documents"),tasks:rowsFor("has_tasks"),notes:rowsFor("has_notes"),cash_flow_events:rowsFor("has_billpay").map(r=>({...r,pcmResponsible:true}))};
  return <SignupsRevenueView data={data} toast={toast} userProfile={userProfile} reload={refresh}/>;
}

function WithAllFamilies({children}){
  const[fams,refresh]=useAllFamilies(true);
  if(!fams)return <Spinner/>;
  return children(fams,refresh);
}

// ── USER MANAGEMENT ───────────────────────────────────────────────────────────
function UserManagementView({userProfile,data={},toast}){
  const families=(data.families||[]).filter(isActiveFamily);
  const[users,setUsers]=useState([]);
  const[loading,setLoading]=useState(true);
  const[modal,setModal]=useState(null);
  const[familyFilter,setFamilyFilter]=useState(""); // narrows the grouped lists below to users linked to one family
  // Search across every group (name, email, role, a client's household). While a search is typed, groups with
  // matches open and empty groups hide.
  const[userSearch,setUserSearch]=useState("");
  // Each role group can be minimised; remembered on this device so a long list stays tidy between visits.
  const USERS_COLLAPSE_KEY="ordanis_users_collapsed";
  const[collapsedGroups,setCollapsedGroups]=useState(()=>{try{return JSON.parse(localStorage.getItem(USERS_COLLAPSE_KEY)||"{}")||{};}catch(e){return {};}});
  const toggleGroup=key=>setCollapsedGroups(prev=>{const next={...prev,[key]:!prev[key]};try{localStorage.setItem(USERS_COLLAPSE_KEY,JSON.stringify(next));}catch(e){}return next;});
  // Partner-to-family links (many-to-many, via family_partners junction table)
  const[familyPartners,setFamilyPartners]=useState([]);
  // New user form state
  const[newEmail,setNewEmail]=useState("");
  const[newName,setNewName]=useState("");
  const[newRole,setNewRole]=useState("advisor");
  const[newFamily,setNewFamily]=useState("");
  const[newFirm,setNewFirm]=useState("");
  const[firms,setFirms]=useState([]);
  const[newPartnerFamilies,setNewPartnerFamilies]=useState([]); // family ids, role="partner" only
  const[newCanRunPrompts,setNewCanRunPrompts]=useState(false); // role="partner" only — Scheduled Prompts access
  const[newPassword,setNewPassword]=useState("");
  const[creating,setCreating]=useState(false);
  const[created,setCreated]=useState(null);

  const loadUsers=async()=>{
    const{data:rows}=await sb.from("user_profiles").select("*").order("created_at",{ascending:false});
    if(rows)setUsers(rows);
    setLoading(false);
    loadMfaUsers();
  };
  // Who has two-step sign-in set up (admin_mfa_users), and the lost-phone reset (admin_reset_mfa).
  const[mfaUsers,setMfaUsers]=useState(()=>new Set());
  const loadMfaUsers=async()=>{
    const{data:rows,error}=await sb.rpc("admin_mfa_users");
    if(!error)setMfaUsers(new Set((rows||[]).map(r=>r.user_id)));
  };
  const resetMfa=async u=>{
    if(!window.confirm(`Reset two-step sign-in for ${u.full_name||u.email}?\n\nUse this when they've lost or replaced their phone. They'll be signed out everywhere and asked to set it up again at their next sign-in.`))return;
    const{error}=await sb.rpc("admin_reset_mfa",{p_user_id:u.id});
    if(error)return toast(error.message,"error");
    toast(`Two-step sign-in reset for ${u.email}`);
    loadMfaUsers();
  };
  const loadFamilyPartners=async()=>{
    const{data:rows}=await sb.from("family_partners").select("*");
    if(rows)setFamilyPartners(rows);
  };
  // Expert -> Analyst links (expert_analysts): each Expert has one Analyst, an Analyst may support several
  // Experts and automatically has all of their households. The Expert stays the point person.
  const[expertAnalysts,setExpertAnalysts]=useState([]);
  const loadExpertAnalysts=async()=>{
    const{data:rows,error}=await sb.from("expert_analysts").select("expert_id,analyst_id");
    if(!error)setExpertAnalysts(rows||[]);
  };
  const analystOf=expertId=>(expertAnalysts.find(r=>r.expert_id===expertId)||{}).analyst_id||"";
  const expertsOfAnalyst=analystId=>expertAnalysts.filter(r=>r.analyst_id===analystId).map(r=>users.find(u=>u.id===r.expert_id)).filter(Boolean);
  const setAnalystFor=async(expert,analystId)=>{
    const{error}=analystId
      ?await sb.from("expert_analysts").upsert({expert_id:expert.id,analyst_id:analystId},{onConflict:"expert_id"})
      :await sb.from("expert_analysts").delete().eq("expert_id",expert.id);
    if(error){toast(error.message,"error");return;}
    toast(analystId?"Analyst assigned":"Analyst removed");loadExpertAnalysts();
  };

  // Household name alone isn't always enough to tell two families apart (similar names, a
  // household renamed, etc.) -- when linking a partner to families, or assigning a client to one,
  // the admin needs the client's own name and the family's customer number to be sure they're
  // connecting the correct household. family_id -> the client user_profiles row for that family
  // (role="client"), built from users already loaded above rather than a second query.
  const clientByFamily=useMemo(()=>{
    const m={};
    users.forEach(u=>{ if(u.role==="client"&&u.family_id&&!m[u.family_id])m[u.family_id]=u; });
    return m;
  },[users]);
  const familyIdentity=f=>{
    const c=clientByFamily[f.id];
    const clientName=c?.full_name||c?.email||"no client on file";
    return `#${f.customer_number??"—"} · ${clientName}`;
  };
  const familyOptionLabel=f=>`${f.name} — ${familyIdentity(f)}`;
  // ADMIN_CAPACITY_PATCH
  const[platformCfg,setPlatformCfg]=useState(null);
  const loadPlatformCfg=async()=>{
    // Tolerate the column or table being absent: an instance provisioned before the
    // licensing migration should still render this screen rather than white-screen
    // on one missing number.
    try{
      const{data:row}=await sb.from("platform_config").select("*").maybeSingle();
      setPlatformCfg(row||null);
    }catch(_e){setPlatformCfg(null);}
  };
  useEffect(()=>{loadUsers();loadFamilyPartners();loadExpertAnalysts();loadPlatformCfg();sb.from("enterprises").select("id,name").order("name").then(r=>{if(!r.error)setFirms(r.data||[]);});},[]);

  const toggleActive=async u=>{
    const{error}=await sb.from("user_profiles").update({active:!u.active}).eq("id",u.id);
    if(error)toast(error.message,"error");else{toast(u.active?"Deactivated":"Activated");loadUsers();}
  };
  const changeRole=async(u,role)=>{
    const{error}=await sb.from("user_profiles").update(u.role==="enterprise_admin"&&role!=="enterprise_admin"?{role,enterprise_id:null}:{role}).eq("id",u.id);
    if(error)toast(error.message,"error");else{toast("Role updated");loadUsers();}
  };
  const assignFamily=async(u,familyId)=>{
    const{error}=await sb.from("user_profiles").update({family_id:familyId||null}).eq("id",u.id);
    if(error)toast(error.message,"error");else{toast("Family assigned");loadUsers();}
  };
  const partnerFamilyIdsFor=userId=>familyPartners.filter(fp=>fp.user_id===userId).map(fp=>fp.family_id);
  const togglePartnerFamily=async(u,familyId,linked)=>{
    if(linked){
      const{error}=await sb.from("family_partners").delete().eq("user_id",u.id).eq("family_id",familyId);
      if(error)toast(error.message,"error");else loadFamilyPartners();
    } else {
      const{error}=await sb.from("family_partners").insert({user_id:u.id,family_id:familyId});
      if(error)toast(error.message,"error");else loadFamilyPartners();
    }
  };
  // Lead Advisor designation. This is a LABEL, not a permission: the partner stays
  // read-only exactly as before. It decides who the AI assistant hands investment
  // questions to, and who the family record shows as owning the relationship.
  // The ORDANIS Expert on the family record runs administration and is deliberately
  // NOT the fallback for investment questions.
  const partnerLinkFor=(userId,familyId)=>familyPartners.find(fp=>fp.user_id===userId&&fp.family_id===familyId);
  const setLeadAdvisor=async(u,familyId,makeLead)=>{
    // One lead per family is enforced by a partial unique index in Postgres, so
    // clear the incumbent first rather than letting the write collide.
    if(makeLead){
      const{error:clearErr}=await sb.from("family_partners").update({is_lead_advisor:false}).eq("family_id",familyId).eq("is_lead_advisor",true);
      if(clearErr){toast(clearErr.message,"error");return;}
    }
    const{error}=await sb.from("family_partners").update({is_lead_advisor:makeLead}).eq("user_id",u.id).eq("family_id",familyId);
    if(error)toast(error.message,"error");
    else{toast(makeLead?"Lead Advisor set":"Lead Advisor cleared");loadFamilyPartners();}
  };

  // Per-Partner toggle: whether this Partner is allowed to create/run Scheduled
  // Prompts. Not all Partners should have this — off by default. ORDANIS Experts
  // and Admins always have it implicitly (not stored on their row).
  // Blank clears the cap; zero is a real and different instruction - "may hold no
  // families" - so the two are never conflated.
  const setFamilyCap=async(u,raw)=>{
    const t=String(raw).trim();
    const val=t===""?null:parseInt(t,10);
    if(t!==""&&(!Number.isFinite(val)||val<0)){toast("Cap must be a whole number, or blank for no limit.","error");return;}
    const{error}=await sb.from("user_profiles").update({family_cap:val}).eq("id",u.id);
    if(error){toast(error.message,"error");loadUsers();return;}
    toast(val===null?`${u.full_name||u.email}: no cap`:`${u.full_name||u.email} capped at ${val}`);
    loadUsers();
  };

  const setPartnerKind=async(u,kind)=>{
    const{error}=await sb.from("user_profiles").update({partner_kind:kind||null}).eq("id",u.id);
    // The database refuses clearing this on someone who currently leads a family, so
    // surface the message instead of letting the select snap back unexplained.
    if(error){toast(error.message,"error");loadUsers();return;}
    toast(kind==="adviser"?"Marked as firm adviser - can lead relationships"
         :kind==="professional"?"Marked as outside professional - visibility only"
         :"Partner type cleared");
    loadUsers();
  };

  const setLicensedFamilies=async(raw)=>{
    const t=String(raw).trim();
    const val=t===""?null:parseInt(t,10);
    if(t!==""&&(!Number.isFinite(val)||val<0)){toast("Contracted families must be a whole number, or blank.","error");return;}
    const{error}=await sb.from("platform_config").update({licensed_families:val}).eq("id",true);
    if(error){toast(error.message,"error");return;}
    toast(val===null?"Contracted family count cleared":`Contracted for ${val} families`);
    loadPlatformCfg();
  };

  const togglePromptAccess=async u=>{
    const{error}=await sb.from("user_profiles").update({can_run_scheduled_prompts:!u.can_run_scheduled_prompts}).eq("id",u.id);
    if(error)toast(error.message,"error");else{toast(u.can_run_scheduled_prompts?"Scheduled Prompts access removed":"Scheduled Prompts access granted");loadUsers();}
  };

  const createUser=async()=>{
    if(!newEmail.trim()||!newPassword.trim())return toast("Email and password are required","error");
    if(newRole==="enterprise_admin"&&!newFirm)return toast("Choose which firm this administrator belongs to","error");
    if(newPassword.length<MIN_PASSWORD_LENGTH)return toast(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`,"error");
    setCreating(true);
    // Sign up the new user on a throwaway client that never stores a session. On the shared client, a
    // sign-up that returns a session (email confirmation off) signed THIS browser in as the new user:
    // the admin was silently switched, and the profile write below then ran as the new user and was
    // refused. The admin's own session stays untouched this way.
    const signupClient=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:"ordanis-admin-create-user"}});
    const{data:authData,error:authError}=await signupClient.auth.signUp({
      email:newEmail.trim(),
      password:newPassword,
      options:{data:{full_name:newName,role:newRole}}
    });
    if(authError){setCreating(false);return toast(authError.message,"error");}
    // Insert/update their profile with role and family
    const userId=authData?.user?.id;
    // Both writes are checked. They used to be ignored, so "User Created!" showed even when the role or
    // household never saved, leaving the person as a plain client with no household.
    const problems=[];
    if(!userId)problems.push("the sign-in account was not returned");
    if(userId){
      const{error:profErr}=await sb.from("user_profiles").upsert({
        id:userId,
        email:newEmail.trim(),
        full_name:newName||newEmail.trim(),
        role:newRole,
        family_id:newRole==="client"?(newFamily||null):null,
        ...(newRole==="enterprise_admin"?{enterprise_id:newFirm}:{}),
        active:true,
        can_run_scheduled_prompts:newRole==="partner"?newCanRunPrompts:false,
      });
      if(profErr)problems.push("their role and household were not saved ("+profErr.message+")");
      if(newRole==="partner"&&newPartnerFamilies.length>0){
        const{error:linkErr}=await sb.from("family_partners").insert(newPartnerFamilies.map(fid=>({user_id:userId,family_id:fid})));
        if(linkErr)problems.push("their household links were not saved ("+linkErr.message+")");
      }
    }
    setCreating(false);
    if(problems.length){
      toast(`The login for ${newEmail.trim()} was created, but ${problems.join("; ")}. Set it from their row in Users before sharing the login.`,"error");
      setTimeout(()=>{loadUsers();loadFamilyPartners();},800);
      return;
    }
    setCreated({email:newEmail,role:newRole,password:newPassword});
    setNewEmail("");setNewName("");setNewRole("advisor");setNewFamily("");setNewFirm("");setNewPartnerFamilies([]);setNewCanRunPrompts(false);setNewPassword("");
    setTimeout(()=>{loadUsers();loadFamilyPartners();},1500);
  };

  const resetPass=u=>{
    sb.auth.resetPasswordForEmail(u.email,{redirectTo:window.location.origin});
    toast(`Password reset email sent to ${u.email}`);
  };

  // Set a temporary password directly, with no email going out — the admin
  // shares it with the person themselves (e.g. over the phone).
  const[pwUser,setPwUser]=useState(null);
  const[tempPassword,setTempPassword]=useState("");
  const[settingPw,setSettingPw]=useState(false);
  const[pwErr,setPwErr]=useState(null);
  const[pwDone,setPwDone]=useState(false);
  const openSetPassword=u=>{ setPwUser(u); setTempPassword(genTempPassword()); setPwErr(null); setPwDone(false); };
  const setTempPasswordNow=async()=>{
    if(!pwUser||tempPassword.length<MIN_PASSWORD_LENGTH)return setPwErr(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    setSettingPw(true);setPwErr(null);
    try{
      const{data:resp,error}=await sb.functions.invoke("admin-set-password",{body:{targetUserId:pwUser.id,newPassword:tempPassword}});
      if(error)throw new Error(error.message||"Could not set password.");
      if(resp&&resp.error)throw new Error(resp.error);
      setPwDone(true);
    }catch(e){ setPwErr(e&&e.message?e.message:"Could not set password."); }
    finally{ setSettingPw(false); }
  };

  if(!userProfile)return <Spinner/>;
  if(userProfile.role!=="admin")return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",flexDirection:"column",gap:12,color:B.textMute}}>
      <div style={{fontSize:40}}>🔒</div>
      <div style={{fontSize:16,color:B.navy,fontWeight:600}}>Admin Access Only</div>
    </div>
  );

  return <div style={{height:"100%",overflow:"auto",padding:"28px 32px"}}>
    <div style={{maxWidth:920,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,flexWrap:"wrap",gap:12}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,color:B.navy,fontWeight:600}}>User Management</div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <Inp type="search" autoComplete="off" placeholder="Search users" aria-label="Search users" value={userSearch}
            onChange={e=>setUserSearch(e.target.value)} style={{minWidth:200,width:220}}/>
          <Sel value={familyFilter} onChange={e=>setFamilyFilter(e.target.value)} style={{minWidth:180}}>
            <option value="">All Families</option>
            {families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
          </Sel>
          <Btn onClick={()=>setModal("create")}>+ Add User</Btn>
        </div>
      </div>

      {/* Users grouped by access level: Admin · ORDANIS Expert (role="advisor" internally) · Partner · Client */}
      {loading?<Spinner/>:(()=>{
        const HEADERS=["Name","Email","Role","Family (clients)","Status","Actions"];
        const COLS="1.2fr 1.4fr 130px 1fr 110px 130px";
        // Families: no Role column (a family login is changed from its household, not here).
        const FAM_HEADERS=["Name","Email","Household","Status","Actions"];
        const FAM_COLS="1.2fr 1.4fr 1.1fr 110px 130px";
        const renderRow=(u,famOnly)=>{
          const pFamilyIds=partnerFamilyIdsFor(u.id);
          return (
          <div key={u.id} style={{display:"grid",gridTemplateColumns:famOnly?FAM_COLS:COLS,padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,alignItems:"center",gap:8,opacity:u.active?1:0.6}}>
            <div>
              <div style={{fontWeight:700,color:B.navy,fontSize:13}}>{u.full_name||"—"}</div>
              {u.id===userProfile?.id&&<div style={{fontSize:10,color:B.gold,fontWeight:700}}>You</div>}
              {famOnly&&u.family_id&&<div style={{fontSize:10,color:B.textMute,fontWeight:700}}>{u.household_role==="primary"?"Primary user":"Family user"}</div>}
              {mfaUsers.has(u.id)
                ?<div title="Signs in with a code from an authenticator app" style={{fontSize:10,color:"#1E6B3A",fontWeight:700}}>🔒 2-step on</div>
                :MFA_REQUIRED_ROLES.includes(u.role)&&<div title="Will be asked to set up two-step sign-in at their next sign-in" style={{fontSize:10,color:"#8A5A00",fontWeight:700}}>2-step not set up</div>}
            </div>
            <div style={{fontSize:12,color:B.textMid,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
            {!famOnly&&<div>
              {u.id===userProfile?.id
                ?<Badge scheme={{bg:"#e8f0f8",text:B.navyMid,dot:B.navyMid}}>{roleLabel(u.role)}</Badge>
                :<select value={u.role||"advisor"} onChange={e=>changeRole(u,e.target.value)} style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:6,padding:"4px 8px",fontSize:12,color:B.text,outline:"none",fontFamily:"inherit",cursor:"pointer",width:"100%"}}>
                  <option value="admin">Admin</option>
                  <option value="advisor">ORDANIS Expert</option>
                  <option value="analyst">ORDANIS Analyst</option>
                  <option value="partner">Partner</option>
                  <option value="client">Family</option>
                  {u.role==="enterprise_admin"&&<option value="enterprise_admin">Firm Administrator</option>}
                </select>}
            </div>}
            <div>
              {u.role==="client"
                ?<select value={u.family_id||""} onChange={e=>assignFamily(u,e.target.value)} style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:6,padding:"4px 8px",fontSize:11,color:B.text,outline:"none",fontFamily:"inherit",cursor:"pointer",width:"100%"}}>
                  <option value="">— Assign Family —</option>
                  {families.map(f=><option key={f.id} value={f.id}>{familyOptionLabel(f)}</option>)}
                </select>
                :u.role==="partner"
                ?<Btn small variant="ghost" onClick={()=>setModal({type:"managePartner",user:u})}>{pFamilyIds.length>0?`${pFamilyIds.length} linked`:"Link families"}</Btn>
                :<span style={{fontSize:11,color:B.textMute}}>—</span>}
            </div>
            <div>
              <span style={{background:u.active?"#e0f5e9":"#fde8e8",color:u.active?"#0d5c2b":"#8b1a1a",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700}}>
                {u.active?"Active":"Inactive"}
              </span>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {(u.role==="advisor"||u.role==="admin")&&<select value={analystOf(u.id)} onChange={e=>setAnalystFor(u,e.target.value)} title="This Expert's Analyst: same access to the Expert's households. The Expert stays the point person."
                style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:6,padding:"3px 6px",fontSize:11,color:B.textMid,fontFamily:"inherit",maxWidth:170}}>
                <option value="">Analyst: none</option>
                {users.filter(a=>(a.role==="analyst"||a.role==="admin")&&a.active!==false&&a.id!==u.id).map(a=><option key={a.id} value={a.id}>Analyst: {a.full_name||a.email}</option>)}
              </select>}
              {(u.role==="analyst"||(u.role==="admin"&&expertsOfAnalyst(u.id).length>0))&&<span title="Experts this Analyst supports" style={{fontSize:11,color:B.textMute,whiteSpace:"nowrap"}}>
                Supports: {expertsOfAnalyst(u.id).map(x=>x.full_name||x.email).join(", ")||"no Expert yet"}
              </span>}
              {/* Load against cap, editable in place. Only for roles that hold
                  families - a client or partner has no capacity to speak of. */}
              {(u.role==="advisor"||u.role==="admin")&&(()=>{
                const load=families.filter(f=>String(f.advisorEmail||"").toLowerCase()===String(u.email||"").toLowerCase()).length;
                const cap=u.family_cap;
                const atCap=cap!=null&&load>=cap;
                return <span title="Families held, and the cap. Blank means no limit."
                  style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:11,color:atCap?"#8b1a1a":B.textMute,whiteSpace:"nowrap"}}>
                  <span style={{fontWeight:atCap?700:600}}>{load}</span>
                  <span>/</span>
                  <input defaultValue={cap==null?"":String(cap)} placeholder="--"
                    onBlur={e=>{const v=e.target.value.trim();const cur=cap==null?"":String(cap);if(v!==cur)setFamilyCap(u,v);}}
                    onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}
                    style={{width:36,padding:"2px 3px",fontSize:11,textAlign:"center",borderRadius:4,border:`1px solid ${atCap?"#e0a0a0":B.border}`,background:B.bg,color:"inherit",fontFamily:"inherit"}}/>
                </span>;
              })()}
              {/* Only an adviser may hold Lead Advisor; the database enforces it, so
                  this is where the distinction gets recorded. */}
              {u.role==="partner"&&<select value={u.partner_kind||""} onChange={e=>setPartnerKind(u,e.target.value)}
                title="An adviser can lead a family's investment relationship. A professional (CPA, attorney) has visibility only."
                style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:6,padding:"3px 6px",fontSize:11,color:B.text,fontFamily:"inherit",cursor:"pointer"}}>
                <option value="">Type not set</option>
                <option value="adviser">Firm adviser</option>
                <option value="professional">CPA / Attorney</option>
              </select>}
              {u.role==="partner"&&<Btn small variant={u.can_run_scheduled_prompts?"gold":"ghost"} onClick={()=>togglePromptAccess(u)}>{u.can_run_scheduled_prompts?"✓ Prompts On":"Prompts Off"}</Btn>}
              {u.id!==userProfile?.id&&<>
                <Btn small variant={u.active?"danger":"ghost"} onClick={()=>toggleActive(u)}>{u.active?"Deactivate":"Activate"}</Btn>
                <Btn small variant="ghost" onClick={()=>resetPass(u)}>Reset PW</Btn>
                <Btn small variant="ghost" onClick={()=>openSetPassword(u)}>Set Temp PW</Btn>
                {mfaUsers.has(u.id)&&<Btn small variant="ghost" onClick={()=>resetMfa(u)}>Reset 2-step</Btn>}
              </>}
            </div>
          </div>
          );
        };
        const searching=!!userSearch.trim();
        const renderSection=(label,accent,desc,list,key)=>{
          if(searching&&!list.length)return null;
          const collapsed=!searching&&!!collapsedGroups[key];
          return (
          <div key={key} style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,overflow:"hidden",marginBottom:18}}>
            <div role="button" tabIndex={0} aria-expanded={!collapsed} onClick={()=>toggleGroup(key)}
              onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();toggleGroup(key);}}}
              title={collapsed?"Show this group":"Minimize this group"}
              style={{display:"flex",alignItems:"center",gap:10,padding:"12px 20px",borderBottom:collapsed?"none":`1px solid ${B.borderLight}`,borderLeft:`4px solid ${accent}`,flexWrap:"wrap",cursor:"pointer",userSelect:"none"}}>
              <span aria-hidden="true" style={{display:"inline-block",width:12,color:B.textMute,fontSize:11,transform:collapsed?"rotate(-90deg)":"none",transition:"transform .15s"}}>▼</span>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:700}}>{label}</div>
              <div style={{background:accent,color:B.white,borderRadius:20,minWidth:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,padding:"0 7px"}}>{list.length}</div>
              <div style={{fontSize:11,color:B.textMute,marginLeft:4}}>{desc}</div>
            </div>
            {collapsed?null:list.length>0?<>
              <div style={{display:"grid",gridTemplateColumns:key==="client"?FAM_COLS:COLS,padding:"10px 20px",background:B.bg,borderBottom:`1px solid ${B.borderLight}`,gap:8}}>
                {(key==="client"?FAM_HEADERS:HEADERS).map(h=><div key={h} style={{fontSize:10,fontWeight:800,color:B.textMute,letterSpacing:"0.08em",textTransform:"uppercase"}}>{h}</div>)}
              </div>
              {key==="client"?(()=>{
                // Families: one block per household (primary user first), logins with no household last.
                const byFam={};
                list.forEach(u=>{(byFam[u.family_id||""]=byFam[u.family_id||""]||[]).push(u);});
                const famName=id=>(families.find(f=>f.id===id)||{}).name||"Household";
                const ids=Object.keys(byFam).sort((a,b)=>!a?1:!b?-1:famName(a).localeCompare(famName(b)));
                return ids.map(id=><div key={id||"none"}>
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 20px",background:B.bgCard||B.bg,borderBottom:`1px solid ${B.borderLight}`,borderTop:`1px solid ${B.borderLight}`}}>
                    <span style={{fontSize:12.5,fontWeight:700,color:id?B.navy:"#8A5A00"}}>{id?famName(id):"No household yet"}</span>
                    <span style={{fontSize:11,color:B.textMute}}>{byFam[id].length} login{byFam[id].length===1?"":"s"}</span>
                  </div>
                  {byFam[id].slice().sort((a,b)=>(a.household_role==="primary"?0:1)-(b.household_role==="primary"?0:1)).map(u=>renderRow(u,true))}
                </div>);
              })():list.map(u=>renderRow(u,false))}
            </>:<div style={{padding:"16px 20px",color:B.textMute,fontSize:13}}>No {label.toLowerCase()} in this group yet.</div>}
          </div>);
        };
        if(users.length===0)return <div style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,padding:"40px",textAlign:"center",color:B.textMute,fontSize:14,marginBottom:24}}>No users yet. Add your first user above.</div>;
        // Contracted versus actual. Reports rather than blocks: exceeding what a firm
        // paid for is an invoice, and refusing an onboarding over it would present a
        // billing question as a system fault.
        const LICENCE_PANEL=(()=>{
          if(!platformCfg)return null;
          const total=families.length;
          const lic=platformCfg.licensed_families;
          const over=lic!=null&&total>lic;
          return <div style={{background:over?"#fde8e8":B.white,border:`1px solid ${over?"#e0a0a0":B.borderLight}`,borderRadius:9,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:over?"#8b1a1a":B.textMute}}>Families</span>
            <span style={{fontSize:15,fontWeight:700,color:over?"#8b1a1a":B.navy}}>{total}</span>
            <span style={{fontSize:12,color:B.textMute}}>of</span>
            <input defaultValue={lic==null?"":String(lic)} placeholder="not set"
              onBlur={e=>{const v=e.target.value.trim();const cur=lic==null?"":String(lic);if(v!==cur)setLicensedFamilies(v);}}
              onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}
              title="How many families this firm has contracted for. Reporting only - it never blocks an onboarding."
              style={{width:66,padding:"3px 6px",fontSize:13,textAlign:"center",borderRadius:5,border:`1px solid ${B.border}`,background:B.bg,color:B.navy,fontFamily:"inherit",fontWeight:600}}/>
            <span style={{fontSize:12,color:B.textMute}}>contracted</span>
            {over&&<span style={{fontSize:11.5,fontWeight:700,color:"#8b1a1a",marginLeft:"auto"}}>Over by {total-lic} - invoice needs updating</span>}
          </div>;
        })();
        const GROUPS=[
          {key:"admin",label:"Admins",accent:B.navy,desc:"Full access to all families, users, and settings"},
          {key:"advisor",label:"ORDANIS Experts",accent:B.gold,desc:"Scoped to their assigned families and prospects"},
          {key:"analyst",label:"ORDANIS Analysts",accent:"#5b7a99",desc:"Work alongside their Expert, with the same access to all of that Expert's households"},
          {key:"partner",label:"Partners",accent:"#7a8fa6",desc:"View-only across linked families; can upload & download documents"},
          {key:"client",label:"Families",accent:B.navyMid,desc:"Portal access to their own household"},
        ];
        const known=GROUPS.map(g=>g.key);
        const roleOf=u=>(u.role||"").toLowerCase();
        // "Categorize by family": when a family filter is set, narrow each group
        // to users actually tied to that family (client assignment, partner link,
        // or the advisor whose email matches the family's advisor_email).
        const linkedToFamily=u=>{
          if(!familyFilter)return true;
          const role=roleOf(u);
          if(role==="client")return u.family_id===familyFilter;
          if(role==="partner")return partnerFamilyIdsFor(u.id).includes(familyFilter);
          if(role==="advisor"){
            const fam=families.find(f=>f.id===familyFilter);
            return!!fam&&(fam.advisorEmail||"").toLowerCase()===(u.email||"").toLowerCase();
          }
          if(role==="analyst"){
            const fam=families.find(f=>f.id===familyFilter);
            const mine=new Set(expertsOfAnalyst(u.id).map(x=>(x.email||"").toLowerCase()));
            return!!fam&&mine.has((fam.advisorEmail||"").toLowerCase());
          }
          return role==="admin"; // admins have access to every family regardless of filter
        };
        // Search: name, email, role label, or the household a client belongs to.
        const q=userSearch.trim().toLowerCase();
        const matchesSearch=u=>{
          if(!q)return true;
          const fam=u.family_id?families.find(f=>f.id===u.family_id):null;
          return [u.full_name,u.email,roleLabel(u.role),fam&&fam.name].some(v=>String(v||"").toLowerCase().includes(q));
        };
        const others=users.filter(u=>!known.includes(roleOf(u))&&matchesSearch(u));
        return <div style={{marginBottom:24}}>
          {LICENCE_PANEL}
          {GROUPS.map(g=>renderSection(g.label,g.accent,g.desc,users.filter(u=>roleOf(u)===g.key&&linkedToFamily(u)&&matchesSearch(u)),g.key))}
          {searching&&!users.some(u=>matchesSearch(u))&&<div style={{padding:"18px 4px",color:B.textMute,fontSize:13}}>No users match “{userSearch.trim()}”.</div>}
          {others.length>0&&!familyFilter&&renderSection("Unassigned",B.textMute,"Users with no recognized role — set one below",others,"__unassigned")}
        </div>;
      })()}

      {/* Create User Modal */}
      {modal==="create"&&<Modal title="Add New User" onClose={()=>{setModal(null);setCreated(null);}}>
        {created?(
          <div style={{textAlign:"center",padding:"10px 0"}}>
            <div style={{fontSize:48,marginBottom:16}}>✅</div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,marginBottom:8}}>User Created!</div>
            <div style={{fontSize:13,color:B.textSoft,marginBottom:20}}>Share these credentials with <strong>{created.email}</strong></div>
            <div style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:10,padding:"16px 20px",textAlign:"left",marginBottom:20}}>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${B.borderLight}`}}>
                <span style={{fontSize:12,color:B.textSoft}}>Email</span>
                <span style={{fontSize:13,fontWeight:700,color:B.navy}}>{created.email}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${B.borderLight}`}}>
                <span style={{fontSize:12,color:B.textSoft}}>Password</span>
                <span style={{fontSize:13,fontWeight:700,color:B.navy,fontFamily:"monospace"}}>{created.password}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0"}}>
                <span style={{fontSize:12,color:B.textSoft}}>Role</span>
                <span style={{fontSize:13,fontWeight:700,color:B.navy}}>{roleLabel(created.role)}</span>
              </div>
            </div>
            <div style={{background:"#fef3e2",border:"1px solid #fcd97d",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#8a5c00",marginBottom:20,textAlign:"left"}}>
              ⚠️ Save this password now — it cannot be retrieved later. The user can reset it from the login screen.
            </div>
            <Btn onClick={()=>{setModal(null);setCreated(null);}}>Done</Btn>
          </div>
        ):(
          <div>
            <Grid2>
              <Field label="Full Name"><Inp placeholder="Jane Smith" value={newName} onChange={e=>setNewName(e.target.value)}/></Field>
              <Field label="Email Address"><Inp type="email" autoComplete="off" placeholder="jane@email.com" value={newEmail} onChange={e=>setNewEmail(e.target.value)}/></Field>
            </Grid2>
            <Field label="Temporary Password">
              <div style={{display:"flex",gap:8}}>
                <Inp autoComplete="off" placeholder={`Min ${MIN_PASSWORD_LENGTH} characters`} value={newPassword} onChange={e=>setNewPassword(e.target.value)} style={{flex:1}}/>
                <Btn variant="ghost" onClick={()=>setNewPassword(genTempPassword())}>Generate</Btn>
              </div>
            </Field>
            <Grid2>
              <Field label="Role">
                <Sel value={newRole} onChange={e=>setNewRole(e.target.value)}>
                  <option value="advisor">ORDANIS Expert — sees assigned families</option>
                  <option value="analyst">ORDANIS Analyst — same access as their Expert; assign the Expert after creating</option>
                  <option value="partner">Partner — view-only, upload/download docs only</option>
                  <option value="admin">Admin — sees everything</option>
                  <option value="client">Family — their own household portal</option>
                  <option value="enterprise_admin">Firm Administrator — one firm's households, view only</option>
                </Sel>
              </Field>
              {newRole==="enterprise_admin"&&<Field label="Firm">
                <Sel value={newFirm} onChange={e=>setNewFirm(e.target.value)}>
                  <option value="">— Select firm —</option>
                  {firms.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
                </Sel>
              </Field>}
              {newRole==="client"&&<Field label="Assign to Family">
                <Sel value={newFamily} onChange={e=>setNewFamily(e.target.value)}>
                  <option value="">— Select family —</option>
                  {families.map(f=><option key={f.id} value={f.id}>{familyOptionLabel(f)}</option>)}
                </Sel>
              </Field>}
            </Grid2>
            {newRole==="client"&&!newFamily&&<div style={{background:"#fef3e2",border:"1px solid #fcd97d",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#8a5c00",marginBottom:14}}>Select a family so the client can see their portal.</div>}
            {newRole==="partner"&&<Field label="Linked Families (one login can switch between all of these)">
              <div style={{border:`1px solid ${B.border}`,borderRadius:8,maxHeight:180,overflowY:"auto",padding:"6px 4px"}}>
                {families.length===0&&<div style={{padding:"8px 10px",fontSize:12,color:B.textMute}}>No families yet.</div>}
                {families.map(f=>{
                  const checked=newPartnerFamilies.includes(f.id);
                  return <label key={f.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",fontSize:13,color:B.text,cursor:"pointer"}}>
                    <input type="checkbox" checked={checked} onChange={()=>setNewPartnerFamilies(checked?newPartnerFamilies.filter(id=>id!==f.id):[...newPartnerFamilies,f.id])}/>
                    <span style={{minWidth:0}}>
                      <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                      <div style={{fontSize:11,color:B.textMute}}>{familyIdentity(f)}</div>
                    </span>
                  </label>;
                })}
              </div>
            </Field>}
            {newRole==="partner"&&newPartnerFamilies.length===0&&<div style={{background:"#fef3e2",border:"1px solid #fcd97d",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#8a5c00",marginBottom:14}}>Select at least one family, or link them later from the Family column.</div>}
            {newRole==="partner"&&<Field label="Scheduled Prompts Access">
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:B.text,cursor:"pointer"}}>
                <input type="checkbox" checked={newCanRunPrompts} onChange={e=>setNewCanRunPrompts(e.target.checked)}/>
                Allow this Partner to create and run Scheduled Prompts
              </label>
              <div style={{fontSize:11,color:B.textMute,marginTop:4}}>Off by default — most Partners shouldn't have this. ORDANIS Experts and Admins already can, and always see every Partner's scheduled prompts for their families.</div>
            </Field>}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={createUser} disabled={creating||!newEmail||!newPassword||(newRole==="enterprise_admin"&&!newFirm)}>{creating?"Creating…":"Create User"}</Btn>
            </div>
          </div>
        )}
      </Modal>}

      {/* Manage Partner Families Modal — add/remove which families this partner can switch between */}
      {modal&&modal.type==="managePartner"&&<Modal title={`Linked Families — ${modal.user.full_name||modal.user.email}`} onClose={()=>setModal(null)}>
        <div style={{fontSize:13,color:B.textSoft,marginBottom:14,lineHeight:1.5}}>This partner can sign in once and switch between every family checked below. Access is view-only, except uploading and downloading documents. Marking one as Lead Advisor records who owns the investment relationship for that family \u2014 client investment questions are routed to them, and only one partner can lead each family. It grants no extra permissions.</div>
        <div style={{border:`1px solid ${B.border}`,borderRadius:8,maxHeight:280,overflowY:"auto",padding:"6px 4px",marginBottom:16}}>
          {families.length===0&&<div style={{padding:"8px 10px",fontSize:12,color:B.textMute}}>No families yet.</div>}
          {families.map(f=>{
            const link=partnerLinkFor(modal.user.id,f.id);
            const linked=!!link;
            const isLead=!!link?.is_lead_advisor;
            return <div key={f.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",fontSize:13,color:B.text}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",flex:1,minWidth:0}}>
                <input type="checkbox" checked={linked} onChange={()=>togglePartnerFamily(modal.user,f.id,linked)}/>
                <span style={{minWidth:0}}>
                  <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                  <div style={{fontSize:11,color:B.textMute}}>{familyIdentity(f)}</div>
                </span>
              </label>
              {linked&&<button
                onClick={()=>setLeadAdvisor(modal.user,f.id,!isLead)}
                title={isLead?"Lead Advisor — investment questions from this family route here":"Designate as Lead Advisor for this family"}
                style={{background:isLead?B.gold:"transparent",color:isLead?B.navy:B.textMute,border:`1px solid ${isLead?B.gold:B.border}`,borderRadius:20,padding:"2px 10px",fontSize:10,fontWeight:700,letterSpacing:"0.06em",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                {isLead?"\u2605 LEAD ADVISOR":"SET AS LEAD"}
              </button>}
            </div>;
          })}
        </div>
        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <Btn onClick={()=>setModal(null)}>Done</Btn>
        </div>
      </Modal>}

      {/* Set Temporary Password Modal */}
      {pwUser&&<Modal title={pwDone?"Password Set":"Set Temporary Password"} onClose={()=>setPwUser(null)}>
        {pwDone?(
          <div style={{textAlign:"center",padding:"10px 0"}}>
            <div style={{fontSize:48,marginBottom:16}}>✅</div>
            <div style={{fontSize:13,color:B.textSoft,marginBottom:20}}>Share this password with <strong>{pwUser.email}</strong> yourself — no email was sent.</div>
            <div style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:10,padding:"16px 20px",marginBottom:20}}>
              <span style={{fontSize:18,fontWeight:700,color:B.navy,fontFamily:"monospace"}}>{tempPassword}</span>
            </div>
            <div style={{background:"#fef3e2",border:"1px solid #fcd97d",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#8a5c00",marginBottom:20,textAlign:"left"}}>
              ⚠️ Save this now — it cannot be retrieved later. Encourage them to change it after logging in.
            </div>
            <Btn onClick={()=>setPwUser(null)}>Done</Btn>
          </div>
        ):(
          <div>
            <div style={{fontSize:13,color:B.textSoft,marginBottom:14,lineHeight:1.5}}>Set a new password for <strong>{pwUser.full_name||pwUser.email}</strong> directly — no reset email will be sent. You'll need to share it with them yourself.</div>
            <Field label="New Password">
              <div style={{display:"flex",gap:8}}>
                <Inp placeholder={`Min ${MIN_PASSWORD_LENGTH} characters`} value={tempPassword} onChange={e=>setTempPassword(e.target.value)} style={{flex:1}}/>
                <Btn variant="ghost" onClick={()=>setTempPassword(genTempPassword())}>Generate</Btn>
              </div>
            </Field>
            {pwErr&&<div style={{background:"#fde8e8",border:"1px solid #f5c6c6",color:"#8b1a1a",borderRadius:8,padding:"9px 12px",fontSize:12,marginBottom:12}}>⚠ {pwErr}</div>}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
              <Btn variant="ghost" onClick={()=>setPwUser(null)}>Cancel</Btn>
              <Btn onClick={setTempPasswordNow} disabled={settingPw||tempPassword.length<MIN_PASSWORD_LENGTH}>{settingPw?"Setting…":"Set Password"}</Btn>
            </div>
          </div>
        )}
      </Modal>}
    </div>
  </div>;
}
const SIGNUP_PLAN_COLOR={basic:B.textSoft,core:B.gold,premier:B.navy};
// Blended activity score bucketing -- three bands, always shown with the number and the word
// (never the dot alone), per the house rule that identity/state is never color-only.
const UTIL_SCHEME={
  High:  {bg:"#e0f5e9",text:"#0d5c2b",dot:"#18a850"},
  Medium:{bg:"#fef3e2",text:"#8a5c00",dot:"#d4900a"},
  Low:   {bg:"#fde8e8",text:"#8b1a1a",dot:"#d43030"},
};
// ── PLAN REQUESTS (admin) ────────────────────────────────────────────────
// Households ask for a plan change from their Billing tab (request_plan_change). Moves to or from
// Premier are arranged by the ORDANIS team, so they land here instead of on a self-serve button.
// Approve moves the Stripe subscription through change-subscription-plan, which also records the
// approval. A household with no Stripe subscription (comped, firm-arranged, test) is approved without
// billing: the plan is switched and Stripe is not touched. A decline carries a note the household sees.
function PlanRequestsView({data,toast,reload,onChanged}){
  const isMobile=useIsMobile();
  const[rows,setRows]=useState([]);
  const[loading,setLoading]=useState(true);
  const[show,setShow]=useState("pending");   // pending | recent
  const[sortBy,setSortBy]=useState("oldest"); // oldest | expert
  const[busyId,setBusyId]=useState(null);
  const[acting,setActing]=useState(null);     // {row, kind:"approve"|"decline"}
  const[note,setNote]=useState("");
  const famOf=id=>(data.families||[]).find(f=>f.id===id);
  const load=async()=>{
    setLoading(true);
    let q=sb.from("plan_change_requests").select("*").order("created_at",{ascending:show==="pending"}).limit(200);
    q=show==="pending"?q.eq("status","pending"):q.neq("status","pending");
    const{data:r,error}=await q;
    if(error)toast(error.message,"error"); else setRows(r||[]);
    setLoading(false);
  };
  useEffect(()=>{load();},[show]);
  const expertOf=r=>{const f=famOf(r.family_id);return (f&&(f.advisorName||f.advisorEmail))||"No Expert yet";};
  const list=sortBy==="expert"
    ? [...rows].sort((a,b)=>expertOf(a).localeCompare(expertOf(b))||String(a.created_at).localeCompare(String(b.created_at)))
    : rows;
  const hasStripe=r=>{const f=famOf(r.family_id);return !!(f&&(f.stripeSubscriptionId||f.stripe_subscription_id));};
  const after=async msg=>{toast(msg);setActing(null);setNote("");await load();onChanged&&onChanged();if(reload)await reload("families");};
  const approve=async r=>{
    setBusyId(r.id);
    try{
      const already=(famOf(r.family_id)||{}).plan===r.to_plan;
      if(already){
        // The plan was already changed by hand (Edit Family), so there is nothing to move: record the decision only.
        const{error}=await sb.rpc("decide_plan_change_request",{p_id:r.id,p_status:"approved",p_note:note||null,p_billing:"no_billing"});
        if(error)throw new Error(error.message);
        await after(`Approved. ${famOf(r.family_id)?.name||"The household"} was already on ${planLabel(r.to_plan)}.${hasStripe(r)?" Stripe was not changed, so check that its subscription matches.":""}`);
      }else if(hasStripe(r)){
        const{data:resp,error}=await sb.functions.invoke("change-subscription-plan",{body:{family_id:r.family_id,new_plan:r.to_plan,request_id:r.id,decision_note:note||null}});
        if(error){
          // Show the function's own reason rather than "non-2xx status code".
          let msg=error.message;try{const b=await error.context?.json?.();if(b?.error)msg=b.error;}catch(_e){}
          throw new Error(msg||"Could not change the plan.");
        }
        if(resp&&resp.error)throw new Error(resp.error);
        if(resp&&resp.request_warning)toast(resp.request_warning,"error");
        await after(resp&&resp.pending_plan
          ? `Approved. ${planLabel(r.to_plan)} starts ${fmt(resp.effective_at)}, at the end of the current billing period.`
          : `Approved. ${famOf(r.family_id)?.name||"The household"} is now on ${planLabel(r.to_plan)}; the prorated difference was charged today.`);
      }else{
        const{error}=await sb.rpc("decide_plan_change_request",{p_id:r.id,p_status:"approved",p_note:note||null,p_billing:"no_billing"});
        if(error)throw new Error(error.message);
        await after(`Approved without billing. ${famOf(r.family_id)?.name||"The household"} is now on ${planLabel(r.to_plan)}; Stripe was not changed.`);
      }
    }catch(e){toast(e.message||"Could not approve the request.","error");}
    setBusyId(null);
  };
  const decline=async r=>{
    if(!note.trim()){toast("Add a short note for the household explaining the decision.","error");return;}
    setBusyId(r.id);
    const{error}=await sb.rpc("decide_plan_change_request",{p_id:r.id,p_status:"declined",p_note:note.trim()});
    if(error)toast(error.message,"error"); else await after("Request declined. The household will see your note on its Billing tab.");
    setBusyId(null);
  };
  const statusChip=s=>{const c={approved:["#e0f5e9","#0d5c2b"],declined:["#fde8e8","#8b1a1a"],cancelled:["#eceff3","#5b6573"],pending:["rgba(206,182,129,0.22)","#7a5a19"]}[s]||["#eceff3","#5b6573"];
    return <span style={{fontSize:9.5,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",borderRadius:20,padding:"2px 8px",background:c[0],color:c[1]}}>{s}</span>;};
  return <div style={{height:"100%",overflowY:"auto"}}><div style={{padding:isMobile?16:28,maxWidth:1100}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:12,flexWrap:"wrap",marginBottom:6}}>
      <div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>Plan requests</div>
        <div style={{fontSize:12.5,color:B.textSoft,marginTop:2}}>Households ask from their Billing tab. Moves to or from Premier are decided here.</div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Sel value={show} onChange={e=>setShow(e.target.value)} style={{width:"auto"}}><option value="pending">Waiting for a decision</option><option value="recent">Decided and canceled</option></Sel>
        <Sel value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{width:"auto"}}><option value="oldest">{show==="pending"?"Oldest first":"Newest first"}</option><option value="expert">By ORDANIS Expert</option></Sel>
      </div>
    </div>
    <GoldLine/>
    {loading?<Empty text="Loading…"/>:list.length===0?<Empty text={show==="pending"?"No requests waiting.":"No decided requests yet."}/>:
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {list.map(r=>{const f=famOf(r.family_id);return <div key={r.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:"14px 18px"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"flex-start"}}>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{f?.name||"Household"} <span style={{fontWeight:400,color:B.textSoft}}>· {planLabel(r.from_plan)} → <strong style={{color:B.navy}}>{planLabel(r.to_plan)}</strong></span></div>
            <div style={{fontSize:12,color:B.textSoft,marginTop:3}}>Asked by {r.requested_by_label||"the household"} on {fmt(String(r.created_at).slice(0,10))} · Expert: {expertOf(r)} · {hasStripe(r)?"Card on file with Stripe":"No Stripe subscription"}</div>
            {r.note&&<div style={{fontSize:13,color:B.text,marginTop:8,whiteSpace:"pre-wrap"}}>“{r.note}”</div>}
            {r.status!=="pending"&&<div style={{fontSize:12,color:B.textSoft,marginTop:8}}>{statusChip(r.status)} {r.decided_at?`on ${fmt(String(r.decided_at).slice(0,10))}`:""}{r.decided_by_label?` by ${r.decided_by_label}`:""}{r.billing==="no_billing"?" · without billing":r.billing==="stripe"?" · billed through Stripe":""}{r.decision_note?<> · “{r.decision_note}”</>:null}</div>}
          </div>
          {r.status==="pending"&&<div style={{display:"flex",gap:8,flexShrink:0}}>
            <Btn small variant="ghost" disabled={busyId===r.id} onClick={()=>{setActing({row:r,kind:"decline"});setNote("");}}>Decline</Btn>
            <Btn small disabled={busyId===r.id} onClick={()=>{setActing({row:r,kind:"approve"});setNote("");}}>Approve</Btn>
          </div>}
        </div>
      </div>;})}
    </div>}
    {acting&&<Modal title={acting.kind==="approve"?`Approve ${planLabel(acting.row.to_plan)}`:"Decline request"} onClose={()=>busyId?null:setActing(null)}>
      <div style={{fontSize:13.5,color:B.text,lineHeight:1.6,marginBottom:14}}>
        {acting.kind==="decline"
          ? <>The household stays on {planLabel(acting.row.from_plan)}. Your note is shown to them on their Billing tab.</>
          : hasStripe(acting.row)
            ? (SIGNUP_PLAN_ORDER.indexOf(acting.row.to_plan)>SIGNUP_PLAN_ORDER.indexOf(acting.row.from_plan)
                ? <>{famOf(acting.row.family_id)?.name||"The household"} moves to {planLabel(acting.row.to_plan)} now, and their card is charged the prorated difference today.</>
                : <>{famOf(acting.row.family_id)?.name||"The household"} moves to {planLabel(acting.row.to_plan)} at the end of the current billing period, with no proration.</>)
            : <>This household has no Stripe subscription, so the plan is switched without billing. Arrange any payment separately.</>}
        {acting.kind==="approve"&&acting.row.to_plan==="premier"&&!(famOf(acting.row.family_id)?.advisorEmail)&&<div style={{marginTop:10,color:"#8a5c00"}}>No ORDANIS Expert is assigned yet. Premier promises a named Expert, so assign one on the household after approving.</div>}
      </div>
      <Field label={acting.kind==="decline"?"Note to the household":"Note"} required={acting.kind==="decline"} optional={acting.kind==="approve"}>
        <Tex maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} placeholder={acting.kind==="decline"?"Why, and what they can do instead":"Optional, kept with the request"}/>
      </Field>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn variant="ghost" disabled={!!busyId} onClick={()=>setActing(null)}>Cancel</Btn>
        <Btn disabled={!!busyId} onClick={()=>acting.kind==="approve"?approve(acting.row):decline(acting.row)}>{busyId?"Working…":acting.kind==="approve"?"Approve":"Decline request"}</Btn>
      </div>
    </Modal>}
  </div></div>;
}

function SignupsRevenueView({data,toast,userProfile,reload}){
  const isMobile=useIsMobile();
  const families=(data.families||[]).filter(f=>!(f.archived_at||f.archivedAt));
  // Archived = step 1 of a deletion request done, step 2 (permanent delete) still to do.
  const archivedFamilies=(data.families||[]).filter(f=>f.archived_at||f.archivedAt);
  const[planFeatures,setPlanFeatures]=useState([]);
  const[contacts,setContacts]=useState({}); // family_id -> {id, email, fullName}
  const[workflowByFamily,setWorkflowByFamily]=useState({}); // family_id -> {total, completed}
  const[obligationFamilyIds,setObligationFamilyIds]=useState(()=>new Set()); // family_ids with >=1 obligation on file
  const[lastSignInByUser,setLastSignInByUser]=useState({}); // auth user id -> ISO timestamp | null
  const[loading,setLoading]=useState(true);
  // Drill-down state, entirely local to this view: null (the dashboard), a plan's household
  // list, or one household's detail. Nothing here is routed -- clicking through and back never
  // leaves the Signups & Revenue tab, matching how the rest of the admin shell navigates.
  const[drill,setDrill]=useState(null); // {type:"plan",plan} | {type:"user",familyId}
  const[savingContactId,setSavingContactId]=useState(null); // family_id currently being marked contacted, or null
  // Danger Zone: honoring a household's request to leave the platform. Two separate confirm
  // panels, each gated on typing the household's exact name -- not a single click -- after an
  // earlier unconfirmed one-click delete elsewhere in the admin UI caused a real accidental
  // deletion. See archive-family / purge-family and the family_deletion migration.
  const[showArchiveConfirm,setShowArchiveConfirm]=useState(false);
  const[archiveConfirmText,setArchiveConfirmText]=useState("");
  const[archiving,setArchiving]=useState(false);
  const[showPurgeConfirm,setShowPurgeConfirm]=useState(false);
  const[purgeConfirmText,setPurgeConfirmText]=useState("");
  const[purging,setPurging]=useState(false);
  const[dangerMsg,setDangerMsg]=useState(null); // {type:"success"|"error", text} | null
  // Declared with the other hooks, above the loading return: a hook declared after an early return changes
  // the hook order between renders and crashes the page (it did, 2026-10-21).
  const[adminCancelBusy,setAdminCancelBusy]=useState(false);
  useEffect(()=>{
    let stopped=false;
    (async()=>{
      // Platform Utilization (below) covers every household, not just self-serve ones, so both
      // plan-gated tables are fetched for the whole book now -- this also makes each individual
      // household's own utilization score (further down) accurate for admin-provisioned
      // households, which previously always fell back to the neutral default because
      // workflowByFamily was never populated for them.
      const allFamilyIds=(data.families||[]).map(f=>f.id);
      const[{data:pf,error:pfErr},{data:up,error:upErr},{data:wf,error:wfErr},{data:obl,error:oblErr},{data:act,error:actErr}]=await Promise.all([
        sb.from("plan_features").select("plan,label,monthly_price,sort_order").order("sort_order"),
        sb.from("user_profiles").select("id,family_id,email,full_name").eq("role","client"),
        allFamilyIds.length
          ? sb.from("workflow_instances").select("family_id,status").in("family_id",allFamilyIds)
          : Promise.resolve({data:[],error:null}),
        allFamilyIds.length
          ? sb.from("obligations").select("family_id").in("family_id",allFamilyIds)
          : Promise.resolve({data:[],error:null}),
        // Admin-gated RPC (see admin_user_activity_rpc migration) -- the browser client has no
        // other way to read auth.users.last_sign_in_at for the utilization score below.
        sb.rpc("admin_user_activity"),
      ]);
      if(stopped)return;
      if(pfErr&&toast)toast(pfErr.message||"Could not load plan pricing","error");
      if(upErr&&toast)toast(upErr.message||"Could not load signup contacts","error");
      if(wfErr&&toast)toast(wfErr.message||"Could not load workflow cycle activity","error");
      if(oblErr&&toast)toast(oblErr.message||"Could not load workflow activity","error");
      if(actErr&&toast)toast(actErr.message||"Could not load sign-in activity","error");
      setPlanFeatures(pf||[]);
      const byFamily={};
      (up||[]).forEach(u=>{ if(u.family_id) byFamily[u.family_id]={id:u.id,email:u.email,fullName:u.full_name}; });
      setContacts(byFamily);
      const wfByFamily={};
      (wf||[]).forEach(w=>{
        const b=wfByFamily[w.family_id]||(wfByFamily[w.family_id]={total:0,completed:0});
        b.total++; if(w.status==="completed")b.completed++;
      });
      setWorkflowByFamily(wfByFamily);
      setObligationFamilyIds(new Set((obl||[]).map(o=>o.family_id)));
      const lastSignIn={};
      (act||[]).forEach(r=>{ lastSignIn[r.user_id]=r.last_sign_in_at; });
      setLastSignInByUser(lastSignIn);
      setLoading(false);
    })();
    return()=>{stopped=true;};
  },[]);

  if(loading)return <Spinner/>;

  const priceOf=plan=>Number(planFeatures.find(p=>p.plan===plan)?.monthly_price)||0;
  const labelOf=plan=>planFeatures.find(p=>p.plan===plan)?.label||plan||"—";

  // Blended activity score (0-100): login recency + breadth of modules with any data on file +
  // workflow (or, on a plan with no workflows, task) completion. Each component is a fixed,
  // documented weight rather than something tuned by eye, so the number means the same thing for
  // every household it's shown for.
  const scoreBand=s=>s>=70?"High":s>=40?"Medium":"Low";
  // Two scoring formulas, chosen by plan. Core & Premier run workflows, so their score blends
  // login recency + module breadth + workflow completion. Basic has no workflow engine and
  // nothing meaningfully fills that slot, so its score is login recency + module breadth only,
  // reweighted so the two components still total 100 rather than being diluted by a neutral
  // placeholder for a feature the plan doesn't include.
  const utilizationFor=f=>{
    const contact=contacts[f.id];
    const lastSignIn=contact?.id?(lastSignInByUser[contact.id]||null):null;
    let loginPts=0;
    if(lastSignIn){
      const days=(Date.now()-new Date(lastSignIn).getTime())/86400000;
      loginPts=days<=7?40:days<=30?28:days<=90?14:0;
    }
    const modules=[
      (data.properties||[]).some(p=>p.familyId===f.id),
      (data.portfolio_accounts||[]).some(a=>a.familyId===f.id),
      (data.valuables||[]).some(v=>v.familyId===f.id),
      (data.documents||[]).some(d=>d.familyId===f.id),
      (data.tasks||[]).some(t=>t.familyId===f.id),
    ];
    const moduleCount=modules.filter(Boolean).length;
    const moduleFrac=moduleCount/modules.length;

    if(f.plan==="basic"){
      const score=Math.max(0,Math.min(100,Math.round(loginPts+moduleFrac*60)));
      return{score,band:scoreBand(score),lastSignIn,moduleCount,moduleTotal:modules.length};
    }

    const modulePts=moduleFrac*30;
    // Neutral half-credit when there's nothing yet to grade (a brand-new household with no
    // workflows on file shouldn't score as "unengaged" for having nothing due yet).
    let enginePts=15;
    const wf=workflowByFamily[f.id];
    if(wf&&wf.total>0)enginePts=(wf.completed/wf.total)*30;
    const score=Math.max(0,Math.min(100,Math.round(loginPts+modulePts+enginePts)));
    return{score,band:scoreBand(score),lastSignIn,moduleCount,moduleTotal:modules.length};
  };
  const UtilBadge=({f})=>{
    const u=utilizationFor(f);
    return <Badge scheme={UTIL_SCHEME[u.band]}>{u.band} · {u.score}</Badge>;
  };

  // ── Platform Utilization: adoption of every feature area, across ALL households ───────────
  // Plan-gated areas (workflows, obligations, bill pay) are measured only against households
  // whose plan actually includes them -- a Basic household that can never have bill pay at any
  // price isn't "lacking" it, it was never offered it, so counting it against the total would
  // make a gate working exactly as designed look like a utilization problem.
  const hasFamilyIn=list=>{
    const ids=new Set((list||[]).map(r=>r.familyId).filter(Boolean));
    return id=>ids.has(id);
  };
  // Stable, logical order -- used as-is for a single household's own module breakdown. The
  // aggregate dashboard below re-sorts a copy of this worst-adoption-first; the per-household
  // view stays in this natural order so it reads the same every time you open a profile.
  const PLATFORM_AREA_DEFS=[
    {key:"properties",label:"Properties",eligible:families,has:hasFamilyIn(data.properties)},
    {key:"portfolio",label:"Portfolio Accounts",eligible:families,has:hasFamilyIn(data.portfolio_accounts)},
    {key:"valuables",label:"Valuables",eligible:families,has:hasFamilyIn(data.valuables)},
    {key:"documents",label:"CHRIS Documents",eligible:families,has:hasFamilyIn(data.documents)},
    {key:"tasks",label:"Tasks",eligible:families,has:hasFamilyIn(data.tasks)},
    {key:"notes",label:"Notes",eligible:families,has:hasFamilyIn(data.notes)},
    {key:"workflows",label:"Workflow cycles",gateLabel:"Core & Premier",eligible:families.filter(f=>planAllows(f.plan,"workflows")),has:id=>!!(workflowByFamily[id]&&workflowByFamily[id].total>0)},
    {key:"obligations",label:"Workflows",gateLabel:"Core & Premier",eligible:families.filter(f=>planAllows(f.plan,"obligations")),has:id=>obligationFamilyIds.has(id)},
    {key:"billpay",label:"Bill Pay",gateLabel:"Premier",eligible:families.filter(f=>planAllows(f.plan,"billPay")),has:hasFamilyIn((data.cash_flow_events||[]).filter(e=>e.pcmResponsible))},
  ].map(a=>{
    const total=a.eligible.length;
    const adopted=a.eligible.filter(f=>a.has(f.id)).length;
    const pct=total?Math.round((adopted/total)*100):0;
    return{...a,total,adopted,pct,band:scoreBand(pct)};
  });
  const PLATFORM_AREAS=[...PLATFORM_AREA_DEFS].sort((a,b)=>a.pct-b.pct);

  const selfServe=families.filter(f=>f.acquisition_channel==="self_serve");
  // Everything that isn't self-serve is a household someone on the team put on the platform --
  // an advisor/admin onboarding an existing relationship. Same acquisition_channel column, just
  // the other side of it (see the comment above where it's declared).
  const teamOnboarded=families.filter(f=>f.acquisition_channel!=="self_serve");
  // Counted toward MRR: still paying (active), or Stripe is actively trying to collect (past_due).
  // final_notice / archived / cancelled households are not generating revenue right now.
  const BILLING_STATES=new Set(["active","past_due"]);
  // Promotion codes (copied from Stripe by stripe-webhook): a percent or dollar amount off the plan, until
  // promo_ends_at (none = until Stripe removes it). Every MRR figure on this page is NET of them, so a comped
  // household counts $0; listMrrOf is the list-price figure the promotions are measured against.
  const promoActive=f=>(f.promo_percent_off!=null||f.promo_amount_off!=null)&&(!f.promo_ends_at||new Date(f.promo_ends_at)>new Date());
  const promoOff=f=>{
    if(!promoActive(f))return 0;
    const list=priceOf(f.plan),pct=Number(f.promo_percent_off)||0,amt=Number(f.promo_amount_off)||0;
    return Math.min(list,pct?list*pct/100:amt);
  };
  const netPriceOf=f=>priceOf(f.plan)-promoOff(f);
  const mrrOf=list=>list.filter(f=>BILLING_STATES.has(f.subscription_state)).reduce((s,f)=>s+netPriceOf(f),0);
  const listMrrOf=list=>list.filter(f=>BILLING_STATES.has(f.subscription_state)).reduce((s,f)=>s+priceOf(f.plan),0);
  const promoHouseholds=families.filter(f=>BILLING_STATES.has(f.subscription_state)&&promoActive(f));
  const promoText=f=>{
    const pct=Number(f.promo_percent_off)||0;
    const off=pct?`${pct%1?pct.toFixed(2):pct}% off`:`${fmtMoney(f.promo_amount_off)} off`;
    const until=f.promo_ends_at?`until ${fmtDate(f.promo_ends_at)}`:f.promo_duration==="forever"?"forever":f.promo_duration==="once"?"first bill":"";
    return [off,until].filter(Boolean).join(" ");
  };
  const promoByCode=Object.values(promoHouseholds.reduce((m,f)=>{
    const k=f.promo_code||f.promo_coupon||"(no code)";
    (m[k]=m[k]||{code:k,count:0,lost:0}).count++;m[k].lost+=promoOff(f);return m;},{})).sort((a,b)=>b.lost-a.lost);

  const totalSelfServe=selfServe.length;
  const selfServeMRR=mrrOf(selfServe);
  const teamOnboardedMRR=mrrOf(teamOnboarded);
  const platformMRR=mrrOf(families); // selfServeMRR + teamOnboardedMRR, by construction
  const platformListMRR=listMrrOf(families);
  const promoLostMRR=platformListMRR-platformMRR;

  // Onboarding follow-up: has anyone internally actually reached out to this self-serve household
  // yet? families.onboarding_contacted_at/_by (set only by the "Mark as Contacted" button below)
  // are the sole source of truth -- the automated welcome email, and for Premier the internal
  // Expert-assignment notification, both fire regardless of whether a human ever actually follows
  // up, so this is tracked separately and confirmed by hand. Every self-serve plan is tracked the
  // same way, Premier included -- the Expert notification is a promise to assign someone, not
  // proof that outreach happened.
  const ONBOARDING_SLA_HOURS=48;
  const daysSinceSignup=f=>f.createdAt?Math.floor((Date.now()-new Date(f.createdAt).getTime())/86400000):null;
  const onboardingStatusFor=f=>{
    if(f.onboarding_contacted_at)return{state:"contacted"};
    const hours=f.createdAt?(Date.now()-new Date(f.createdAt).getTime())/3600000:0;
    return{state:hours>=ONBOARDING_SLA_HOURS?"overdue":"new",days:daysSinceSignup(f)};
  };
  const ONBOARDING_SCHEME={
    new:{bg:"#e7f0fb",text:"#1a4c8b",dot:"#2f6fc4"},
    overdue:UTIL_SCHEME.Low,
    contacted:{bg:B.borderLight,text:B.textSoft,dot:B.textSoft},
  };
  const markContacted=async familyId=>{
    setSavingContactId(familyId);
    const{error}=await sb.from("families").update({
      onboarding_contacted_at:new Date().toISOString(),
      onboarding_contacted_by:userProfile?.email||null,
    }).eq("id",familyId);
    setSavingContactId(null);
    if(error){toast&&toast(error.message||"Could not save","error");return;}
    toast&&toast("Marked as contacted");
    if(reload)await reload("families");
  };

  // Step 1: immediate, non-destructive. Cancels billing and disables login; nothing is deleted.
  // Requires typing the household's exact name to confirm, same as the permanent-delete step --
  // this is a real, billing-affecting action and a mis-click here was exactly what caused the
  // earlier accidental deletion, so it gets the same friction as the irreversible step.
  const adminCancel=async(familyId,action)=>{
    setAdminCancelBusy(true);setDangerMsg(null);
    try{
      const{data:resp,error}=await sb.functions.invoke("cancel-subscription",{body:{family_id:familyId,action}});
      let msg=resp&&resp.error;
      if(error&&!msg){try{msg=(await error.context.json()).error;}catch(_e){msg=error.message;}}
      if(msg){setDangerMsg({type:"error",text:msg});return;}
      setDangerMsg({type:"success",text:action==="schedule"?`Scheduled: the subscription ends ${resp.cancel_at?fmtDate(resp.cancel_at):"at the end of the paid month"}.`:"Undone: the subscription continues."});
      toast&&toast(action==="schedule"?"Cancellation scheduled":"Cancellation undone");
      if(reload)await reload("families");
    }finally{setAdminCancelBusy(false);}
  };
  const archiveFamily=async(familyId,familyName)=>{
    setArchiving(true); setDangerMsg(null);
    try{
      const{data:resp,error}=await sb.functions.invoke("archive-family",{body:{familyId,confirmName:archiveConfirmText.trim()}});
      if(error)throw new Error(error.message||"Could not archive this household.");
      if(resp&&resp.error)throw new Error(resp.error);
      setShowArchiveConfirm(false); setArchiveConfirmText("");
      setDangerMsg({type:"success",text:resp?.alreadyArchived?"Already archived.":`Archived. ${resp?.loginsDisabled||0} login${resp?.loginsDisabled===1?"":"s"} disabled.${resp?.stripeError?" (Stripe: "+resp.stripeError+")":""}`});
      toast&&toast("Household archived");
      if(reload)await reload("families");
    }catch(e){ setDangerMsg({type:"error",text:e&&e.message?e.message:"Could not archive this household."}); }
    finally{ setArchiving(false); }
  };

  // Step 2: permanent. The edge function itself refuses unless the family is already archived --
  // this client-side confirm text match is a UX guard against a mis-click, not the real gate.
  const purgeFamily=async(familyId,familyName)=>{
    setPurging(true); setDangerMsg(null);
    try{
      const{data:resp,error}=await sb.functions.invoke("purge-family",{body:{familyId,confirmName:purgeConfirmText.trim()}});
      if(error)throw new Error(error.message||"Could not delete this household.");
      if(resp&&resp.error)throw new Error(resp.error);
      setShowPurgeConfirm(false); setPurgeConfirmText("");
      toast&&toast(`${familyName} permanently deleted`);
      setDrill({type:"plan",plan:families.find(f=>f.id===familyId)?.plan||"basic"});
      if(reload)await reload("families");
    }catch(e){ setDangerMsg({type:"error",text:e&&e.message?e.message:"Could not delete this household."}); }
    finally{ setPurging(false); }
  };

  const byPlan=SIGNUP_PLAN_ORDER.map(plan=>{
    const inPlan=selfServe.filter(f=>f.plan===plan);
    const pending=inPlan.filter(f=>onboardingStatusFor(f).state!=="contacted");
    const overdue=pending.filter(f=>onboardingStatusFor(f).state==="overdue");
    return{plan,label:labelOf(plan),count:inPlan.length,mrr:mrrOf(inPlan),pendingCount:pending.length,overdueCount:overdue.length};
  });
  const maxByPlan=Math.max(1,...byPlan.map(p=>p.count));
  const allPendingOnboarding=selfServe.filter(f=>onboardingStatusFor(f).state!=="contacted");
  const overdueOnboarding=allPendingOnboarding.filter(f=>onboardingStatusFor(f).state==="overdue").sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0));

  // Last 8 ISO (Mon-start) weeks of self-serve signups, oldest first, by createdAt (mapped from
  // families.created_at -- see toClient).
  const weekStart=d=>{const x=new Date(d);const day=(x.getUTCDay()+6)%7;x.setUTCDate(x.getUTCDate()-day);x.setUTCHours(0,0,0,0);return x;};
  const thisWeekStart=weekStart(new Date());
  const weeks=[...Array(8)].map((_,i)=>{
    const start=new Date(thisWeekStart);
    start.setUTCDate(start.getUTCDate()-7*(7-i));
    const end=new Date(start);end.setUTCDate(end.getUTCDate()+7);
    const count=selfServe.filter(f=>{const c=f.createdAt?new Date(f.createdAt):null;return c&&c>=start&&c<end;}).length;
    return{start,count};
  });
  const maxWeek=Math.max(1,...weeks.map(w=>w.count));

  const recent=[...selfServe].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,10);

  const fmtWeek=d=>d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
  const fmtDate=d=>d?asDate(d).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):"—";
  const backBtnStyle={background:"none",border:`1px solid ${B.border}`,color:B.textSoft,cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:6,marginBottom:16};

  // ── Plan drill-down: households on one plan ─────────────────────────────
  if(drill?.type==="plan"){
    const plan=drill.plan;
    const rows=selfServe.filter(f=>f.plan===plan).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
    return <div style={{overflowY:"auto",height:"100%",padding:isMobile?"18px 14px 32px":"26px 30px 48px"}}>
      <button onClick={()=>setDrill(null)} style={backBtnStyle}>← Back to Signups & Revenue</button>
      <div style={{marginBottom:isMobile?16:24}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{width:11,height:11,borderRadius:3,background:SIGNUP_PLAN_COLOR[plan],display:"inline-block"}}/>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?22:28,color:B.navy,fontWeight:600}}>{labelOf(plan)} Households</div>
        </div>
        <div style={{color:B.textSoft,fontSize:isMobile?12:14,marginTop:4}}>{rows.length} household{rows.length===1?"":"s"} on {labelOf(plan)}</div>
        <div style={{height:2,width:56,background:B.gold,marginTop:10,borderRadius:2}}/>
      </div>
      {rows.length===0?<div style={{padding:22,color:B.textSoft,fontSize:13,background:B.bgCard,borderRadius:12,border:`1px solid ${B.borderLight}`}}>No households on this plan yet.</div>:
      <div style={{background:B.bgCard,borderRadius:12,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,overflow:"hidden"}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{textAlign:"left",color:B.textMute,fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase"}}>
              <th style={{padding:"12px 22px"}}>Family #</th><th style={{padding:"12px 12px"}}>Username</th><th style={{padding:"12px 12px"}}>Household</th><th style={{padding:"12px 12px"}}>Signed Up</th><th style={{padding:"12px 12px"}}>Status</th><th style={{padding:"12px 12px"}}>Onboarding</th><th style={{padding:"12px 22px"}}>Utilization</th>
            </tr></thead>
            <tbody>
              {rows.map(f=>{const c=contacts[f.id]||{};const ob=onboardingStatusFor(f);return <tr key={f.id} onClick={()=>setDrill({type:"user",familyId:f.id})} style={{borderTop:`1px solid ${B.borderLight}`,cursor:"pointer"}}>
                <td style={{padding:"10px 22px",color:B.navy,fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>{f.customer_number??"—"}</td>
                <td style={{padding:"10px 12px",color:B.navy,fontWeight:600,textDecoration:"underline",textDecorationColor:B.borderLight}}>{c.fullName||c.email||"—"}</td>
                <td style={{padding:"10px 12px",color:B.textSoft}}>{f.name}</td>
                <td style={{padding:"10px 12px",color:B.textSoft}}>{fmtDate(f.createdAt)}</td>
                <td style={{padding:"10px 12px",color:B.textSoft,textTransform:"capitalize"}}>{(f.subscription_state||"—").replace("_"," ")}</td>
                <td style={{padding:"10px 12px"}}>{ob.state==="contacted"?<Badge scheme={ONBOARDING_SCHEME.contacted}>Contacted</Badge>:<Badge scheme={ob.state==="overdue"?ONBOARDING_SCHEME.overdue:ONBOARDING_SCHEME.new}>{ob.state==="overdue"?"Overdue":"New"} · {ob.days}d</Badge>}</td>
                <td style={{padding:"10px 22px"}}><UtilBadge f={f}/></td>
              </tr>;})}
            </tbody>
          </table>
        </div>
      </div>}
    </div>;
  }

  // ── User drill-down: one household's payment info + utilization ─────────
  if(drill?.type==="user"){
    // Looked up in the FULL list, archived included: archiving is step 1 of a deletion and the
    // permanent-delete button lives on this same page, so dropping archived households here made
    // step 2 unreachable (the page went to "could no longer be found" the moment step 1 finished).
    const family=(data.families||[]).find(f=>f.id===drill.familyId);
    if(!family)return <div style={{padding:isMobile?"18px 14px":"26px 30px"}}>
      <button onClick={()=>setDrill(null)} style={backBtnStyle}>← Back to Signups & Revenue</button>
      <div style={{marginTop:16,color:B.textSoft}}>That household could no longer be found.</div>
    </div>;
    const c=contacts[family.id]||{};
    const u=utilizationFor(family);
    const wfStats=workflowByFamily[family.id];
    const isBasic=family.plan==="basic";
    const engineLabel="Workflow Completion";
    const engineValue=wfStats&&wfStats.total>0?`${wfStats.completed} of ${wfStats.total} complete`:"None on file yet";
    const enginePct=wfStats&&wfStats.total>0?(wfStats.completed/wfStats.total)*100:50;
    const signInPct=u.lastSignIn?Math.max(6,100-Math.min(100,((Date.now()-new Date(u.lastSignIn).getTime())/86400000/90)*100)):0;
    const ob=onboardingStatusFor(family);
    const respondedDays=family.onboarding_contacted_at?Math.max(0,Math.floor((new Date(family.onboarding_contacted_at)-new Date(family.createdAt))/86400000)):null;
    return <PrivateGate familyId={family.id} onBack={()=>setDrill(null)}><div style={{overflowY:"auto",height:"100%",padding:isMobile?"18px 14px 32px":"26px 30px 48px"}}>
      <button onClick={()=>setDrill({type:"plan",plan:family.plan})} style={backBtnStyle}>← Back to {labelOf(family.plan)} Households</button>
      <div style={{marginBottom:isMobile?16:24}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?22:28,color:B.navy,fontWeight:600,marginBottom:4}}>{family.name}{family.customer_number!=null&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:isMobile?14:16,color:B.textSoft,marginLeft:10,fontWeight:600}}>#{family.customer_number}</span>}</div>
        <div style={{color:B.textSoft,fontSize:isMobile?12:14}}>{c.fullName||c.email||"No client contact on file"}{c.fullName&&c.email?` · ${c.email}`:""}</div>
        <div style={{height:2,width:56,background:B.gold,marginTop:10,borderRadius:2}}/>
      </div>

      {family.acquisition_channel==="self_serve"&&<div style={{background:ob.state==="overdue"?UTIL_SCHEME.Low.bg:B.bgCard,borderRadius:12,padding:"16px 22px",border:`1px solid ${ob.state==="overdue"?UTIL_SCHEME.Low.text+"33":B.borderLight}`,boxShadow:B.shadow,marginBottom:18,display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:14}}>
        <div>
          <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>Onboarding Outreach</div>
          {ob.state==="contacted"
            ? <div style={{fontSize:13,color:B.text}}>Contacted {fmtDate(family.onboarding_contacted_at)}{family.onboarding_contacted_by?` by ${family.onboarding_contacted_by}`:""} — {respondedDays===0?"same day as signup":`${respondedDays} day${respondedDays===1?"":"s"} after signup`}</div>
            : <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:8,fontSize:13,color:ob.state==="overdue"?UTIL_SCHEME.Low.text:B.text,fontWeight:ob.state==="overdue"?700:400}}>
                <Badge scheme={ob.state==="overdue"?UTIL_SCHEME.Low:ONBOARDING_SCHEME.new}>{ob.state==="overdue"?"Overdue":"New"}</Badge>
                Signed up {ob.days} day{ob.days===1?"":"s"} ago — {ob.state==="overdue"?"past the 48-hour contact window":"within the 48-hour contact window"}
              </div>}
        </div>
        {ob.state!=="contacted"&&<button onClick={()=>markContacted(family.id)} disabled={savingContactId===family.id}
          style={{background:B.gold,color:"#051423",border:"none",borderRadius:8,padding:"9px 18px",fontSize:12.5,fontWeight:700,cursor:savingContactId===family.id?"default":"pointer",opacity:savingContactId===family.id?0.6:1,fontFamily:"inherit"}}>
          {savingContactId===family.id?"Saving…":"Mark as Contacted"}
        </button>}
      </div>}

      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:18,marginBottom:18,alignItems:"start"}}>
        {/* Payment info */}
        <div style={{background:B.bgCard,borderRadius:12,padding:"20px 22px",border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
          <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Payment Info</div>
          {[
            ["Family #",family.customer_number??"—"],
            ["Plan",labelOf(family.plan)],
            ["Monthly Price",fmtMoney(priceOf(family.plan))],
            ...(promoActive(family)?[["Promotion",`${family.promo_code||family.promo_coupon||"Code"}: ${promoText(family)}`],["Pays Monthly",fmtMoney(netPriceOf(family))]]:[]),
            ["Status",(family.subscription_state||"—").replace("_"," ")],
            ["Signed Up",fmtDate(family.createdAt)],
            ...(family.pending_plan?[["Scheduled Change",`→ ${labelOf(family.pending_plan)} on ${fmtDate(family.pending_plan_effective_at)}`]]:[]),
            ["Stripe Customer",family.stripe_customer_id||"—"],
          ].map(([l,v])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${B.borderLight}`,fontSize:13,gap:12}}>
            <span style={{color:B.textMute}}>{l}</span><span style={{color:B.text,fontWeight:600,textAlign:"right"}}>{v}</span>
          </div>)}
        </div>

        {/* Utilization breakdown */}
        <div style={{background:B.bgCard,borderRadius:12,padding:"20px 22px",border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Utilization of the Platform</div>
            <UtilBadge f={family}/>
          </div>
          {isBasic&&<div style={{fontSize:11,color:B.textMute,marginBottom:12,fontStyle:"italic"}}>Basic has no workflow engine — this score is login recency and module breadth only.</div>}
          {[
            {l:"Last Sign-In",v:u.lastSignIn?fmtDate(u.lastSignIn):"Never signed in",pct:signInPct},
            {l:"Platform Modules Used",v:`${u.moduleCount} of ${u.moduleTotal}`,pct:(u.moduleCount/u.moduleTotal)*100},
            ...(isBasic?[]:[{l:engineLabel,v:engineValue,pct:enginePct}]),
          ].map(row=><div key={row.l} style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:B.text,marginBottom:4}}>
              <span>{row.l}</span><span style={{color:B.textSoft}}>{row.v}</span>
            </div>
            <div style={{height:8,background:B.borderLight,borderRadius:4,overflow:"hidden"}}>
              <div title={`${row.l}: ${row.v}`} style={{width:`${Math.max(4,Math.min(100,row.pct))}%`,height:"100%",background:B.gold,borderRadius:4}}/>
            </div>
          </div>)}
        </div>
      </div>

      {/* Exactly which modules/features this household has touched */}
      <div style={{background:B.bgCard,borderRadius:12,padding:isMobile?"18px 16px":"20px 22px",border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
        <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Modules & Features Used</div>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(2,minmax(0,1fr))",gap:"2px 28px"}}>
          {PLATFORM_AREA_DEFS.map(a=>{
            const eligible=a.eligible.some(ff=>ff.id===family.id);
            const used=eligible&&a.has(family.id);
            const scheme=eligible?(used?UTIL_SCHEME.High:UTIL_SCHEME.Low):undefined;
            const status=eligible?(used?"In use":"Not started"):`Not on ${labelOf(family.plan)}`;
            return <div key={a.key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${B.borderLight}`,opacity:eligible?1:0.55}}>
              <span style={{fontSize:13,color:B.text}}>{a.label}{a.gateLabel&&<span style={{color:B.textMute,fontWeight:400,fontSize:11}}> · {a.gateLabel}</span>}</span>
              <Badge scheme={scheme}>{status}</Badge>
            </div>;
          })}
        </div>
      </div>

      <PrivateHouseholdPanel familyId={family.id} familyName={family.name} toast={toast} isMobile={isMobile}/>

      {/* Danger Zone: honoring a household's request to be removed from the platform. Two
          deliberate steps -- archive (immediate, non-destructive) then, only once archived,
          permanently delete -- and BOTH now require typing the household's exact name to
          confirm, not just a click. See archive-family / purge-family and the family_deletion
          migration. Admin-only: this whole view is already gated to userProfile.role==="admin"
          by the parent shell, and both edge functions re-check that server-side too. */}
      <div style={{background:family.archived_at?"#fde8e8":B.bgCard,borderRadius:12,padding:isMobile?"18px 16px":"20px 22px",border:`1px solid ${family.archived_at?"#f0b8b8":B.borderLight}`,boxShadow:B.shadow,marginTop:18}}>
        <div style={{fontSize:10,color:family.archived_at?"#8b1a1a":B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Danger Zone — Deletion Request</div>

        {family.archived_at?<>
          <div style={{fontSize:13,color:B.text,marginBottom:14,lineHeight:1.5}}>
            Archived {fmtDate(family.archived_at)}{family.archived_by?` by ${family.archived_by}`:""}. Billing is canceled and their login is disabled. No data has been deleted yet.
          </div>
          {!showPurgeConfirm?
            <button onClick={()=>{setShowPurgeConfirm(true);setPurgeConfirmText("");setDangerMsg(null);}} style={{background:"#d43030",color:"#fff",border:"none",borderRadius:8,padding:"9px 18px",fontSize:12.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Permanently Delete All Data…</button>
          :<div style={{background:B.white,border:"1px solid #f0b8b8",borderRadius:10,padding:16}}>
            <div style={{fontSize:13,color:"#8b1a1a",fontWeight:700,marginBottom:8}}>This cannot be undone.</div>
            <div style={{fontSize:12.5,color:B.textSoft,marginBottom:12,lineHeight:1.5}}>This permanently erases every record for <strong>{family.name}</strong> — properties, documents, valuables, tasks, notes, deals, workflows and their cycles, and their login. Type the household name below to confirm.</div>
            <input value={purgeConfirmText} onChange={e=>setPurgeConfirmText(e.target.value)} placeholder={family.name} autoFocus style={{...inp,marginBottom:12,width:"100%"}}/>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button disabled={purging||purgeConfirmText.trim()!==family.name} onClick={()=>purgeFamily(family.id,family.name)} style={{background:"#d43030",color:"#fff",border:"none",borderRadius:8,padding:"9px 18px",fontSize:12.5,fontWeight:700,fontFamily:"inherit",cursor:(purging||purgeConfirmText.trim()!==family.name)?"not-allowed":"pointer",opacity:(purging||purgeConfirmText.trim()!==family.name)?0.5:1}}>{purging?"Deleting…":"Confirm Permanent Deletion"}</button>
              <button onClick={()=>{setShowPurgeConfirm(false);setPurgeConfirmText("");}} style={{background:"none",border:`1px solid ${B.border}`,color:B.textSoft,borderRadius:8,padding:"9px 18px",fontSize:12.5,fontWeight:600,fontFamily:"inherit",cursor:"pointer"}}>Cancel</button>
            </div>
          </div>}
        </>:<>
          {/* End-of-period cancellation: the household keeps access to the end of its paid month, then the
              payment webhook archives it. The "end now" path (archive) stays below for urgent cases. */}
          {family.stripe_subscription_id&&<div style={{marginBottom:16,paddingBottom:14,borderBottom:`1px solid ${B.borderLight}`}}>
            {family.cancel_at?<>
              <div style={{fontSize:13,color:B.text,marginBottom:10,lineHeight:1.5}}>
                <strong style={{color:"#8a5c00"}}>Subscription ends {fmtDate(family.cancel_at)}</strong>{family.cancel_requested_by?` (requested by ${family.cancel_requested_by})`:""}. The household keeps full access until then, and is archived automatically on that date.
              </div>
              <Btn small variant="ghost" disabled={adminCancelBusy} onClick={()=>adminCancel(family.id,"undo")}>{adminCancelBusy?"Working…":"Undo — keep the subscription"}</Btn>
            </>:<>
              <div style={{fontSize:13,color:B.textSoft,marginBottom:10,lineHeight:1.5}}>
                Cancel at the end of the paid month: the household keeps full access until then, isn't charged again, and is archived automatically on that date.
              </div>
              <Btn small variant="ghost" disabled={adminCancelBusy} onClick={()=>{if(confirm(`Cancel ${family.name}'s subscription at the end of their paid month?`))adminCancel(family.id,"schedule");}}>{adminCancelBusy?"Working…":"Cancel at end of paid month"}</Btn>
            </>}
          </div>}
          <div style={{fontSize:13,color:B.textSoft,marginBottom:14,lineHeight:1.5}}>
            To end it right now instead (for example a deletion request), archiving cancels their subscription and disables their login immediately. Their data stays in place until a separate, deliberate step permanently deletes it.
          </div>
          {!showArchiveConfirm?
            <button onClick={()=>{setShowArchiveConfirm(true);setArchiveConfirmText("");setDangerMsg(null);}} style={{background:"none",border:"1px solid #d43030",color:"#d43030",borderRadius:8,padding:"9px 18px",fontSize:12.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Archive This Household…</button>
          :<div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:16}}>
            <div style={{fontSize:12.5,color:B.textSoft,marginBottom:12,lineHeight:1.5}}>Cancels their Stripe subscription and disables sign-in immediately. Nothing is deleted — permanent deletion is a separate step available once this household is archived. Type the household name below to confirm.</div>
            <input value={archiveConfirmText} onChange={e=>setArchiveConfirmText(e.target.value)} placeholder={family.name} autoFocus style={{...inp,marginBottom:12,width:"100%"}}/>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button disabled={archiving||archiveConfirmText.trim()!==family.name} onClick={()=>archiveFamily(family.id,family.name)} style={{background:"#d43030",color:"#fff",border:"none",borderRadius:8,padding:"9px 18px",fontSize:12.5,fontWeight:700,fontFamily:"inherit",cursor:(archiving||archiveConfirmText.trim()!==family.name)?"not-allowed":"pointer",opacity:(archiving||archiveConfirmText.trim()!==family.name)?0.5:1}}>{archiving?"Archiving…":"Confirm Archive"}</button>
              <button onClick={()=>{setShowArchiveConfirm(false);setArchiveConfirmText("");}} style={{background:"none",border:`1px solid ${B.border}`,color:B.textSoft,borderRadius:8,padding:"9px 18px",fontSize:12.5,fontWeight:600,fontFamily:"inherit",cursor:"pointer"}}>Cancel</button>
            </div>
          </div>}
        </>}

        {dangerMsg&&<div style={{marginTop:12,fontSize:12.5,fontWeight:600,padding:"8px 12px",borderRadius:8,color:dangerMsg.type==="error"?"#8b1a1a":"#0d5c2b",background:dangerMsg.type==="error"?"#fde8e8":"#e0f5e9"}}>{dangerMsg.text}</div>}
      </div>

    </div></PrivateGate>;
  }

  // ── Platform Utilization drill-down: every area, all households, gaps sorted to the top ─────
  if(drill?.type==="utilization"){
    return <div style={{overflowY:"auto",height:"100%",padding:isMobile?"18px 14px 32px":"26px 30px 48px"}}>
      <button onClick={()=>setDrill(null)} style={backBtnStyle}>← Back to Signups & Revenue</button>
      <div style={{marginBottom:isMobile?16:24}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?22:28,color:B.navy,fontWeight:600,marginBottom:4}}>Platform Utilization by Area</div>
        <div style={{color:B.textSoft,fontSize:isMobile?12:14,maxWidth:640}}>Every household on the platform, sorted lowest-adoption first so the gaps surface at the top. Plan-gated areas are measured only against households whose plan actually includes them.</div>
        <div style={{height:2,width:56,background:B.gold,marginTop:10,borderRadius:2}}/>
      </div>
      <div style={{background:B.bgCard,borderRadius:12,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,padding:isMobile?"16px 18px":"22px 26px"}}>
        {PLATFORM_AREAS.map(a=><div key={a.key} style={{marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",fontSize:13,color:B.text,marginBottom:5,flexWrap:"wrap",gap:6}}>
            <span style={{fontWeight:600}}>{a.label}{a.gateLabel&&<span style={{color:B.textMute,fontWeight:400}}> · {a.gateLabel} only</span>}</span>
            <Badge scheme={UTIL_SCHEME[a.band]}>{a.band} · {a.pct}%</Badge>
          </div>
          <div style={{fontSize:12,color:B.textSoft,marginBottom:6}}>{a.adopted} of {a.total} eligible household{a.total===1?"":"s"} have at least one on file</div>
          <div style={{height:8,background:B.borderLight,borderRadius:4,overflow:"hidden"}}>
            <div title={`${a.label}: ${a.pct}% adoption`} style={{width:`${a.pct?Math.max(4,Math.min(100,a.pct)):0}%`,height:"100%",background:UTIL_SCHEME[a.band].dot,borderRadius:4}}/>
          </div>
        </div>)}
      </div>
    </div>;
  }

  return <div style={{overflowY:"auto",height:"100%",padding:isMobile?"18px 14px 32px":"26px 30px 48px"}}>
    <div style={{marginBottom:isMobile?16:24}}>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?22:28,color:B.navy,fontWeight:600,marginBottom:4}}>Signups & Revenue</div>
      <div style={{color:B.textSoft,fontSize:isMobile?12:14}}>Households created through the public sign-up flow</div>
      <div style={{height:2,width:56,background:B.gold,marginTop:10,borderRadius:2}}/>
      <div onClick={()=>setDrill({type:"utilization"})} role="button" tabIndex={0}
        onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")setDrill({type:"utilization"});}}
        style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12.5,fontWeight:600,color:B.gold,marginTop:14}}>
        View Platform Utilization by Area
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={B.gold} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      </div>
    </div>

    {archivedFamilies.length>0&&<div style={{background:"#fde8e8",border:"1px solid #f0b8b8",borderRadius:10,padding:"14px 18px",marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:700,color:"#8b1a1a",marginBottom:4}}>
        {archivedFamilies.length} archived household{archivedFamilies.length===1?"":"s"} waiting for permanent deletion
      </div>
      <div style={{fontSize:12,color:B.textSoft,marginBottom:10}}>Billing is canceled and logins are disabled. Open one to permanently delete it, from Danger Zone at the bottom.</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {archivedFamilies.map(f=><span key={f.id} onClick={()=>setDrill({type:"user",familyId:f.id})} role="button" tabIndex={0}
          onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")setDrill({type:"user",familyId:f.id});}}
          style={{cursor:"pointer",fontSize:12,color:"#8b1a1a",background:"#fff",border:"1px solid #f0b8b8",borderRadius:20,padding:"4px 10px"}}>
          {f.name}
        </span>)}
      </div>
    </div>}

    {overdueOnboarding.length>0&&<div style={{background:UTIL_SCHEME.Low.bg,border:`1px solid ${UTIL_SCHEME.Low.text}33`,borderRadius:10,padding:"14px 18px",marginBottom:20}}>
      <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:700,color:UTIL_SCHEME.Low.text,marginBottom:8}}>
        <span style={{width:8,height:8,borderRadius:"50%",background:UTIL_SCHEME.Low.dot,display:"inline-block"}}/>
        {overdueOnboarding.length} household{overdueOnboarding.length===1?"":"s"} past the 48-hour onboarding contact window
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {overdueOnboarding.map(f=><span key={f.id} onClick={()=>setDrill({type:"user",familyId:f.id})} role="button" tabIndex={0}
          onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")setDrill({type:"user",familyId:f.id});}}
          style={{cursor:"pointer",fontSize:12,color:UTIL_SCHEME.Low.text,background:"#fff",border:`1px solid ${UTIL_SCHEME.Low.text}33`,borderRadius:20,padding:"4px 10px"}}>
          {f.name} · {labelOf(f.plan)} · {daysSinceSignup(f)}d
        </span>)}
      </div>
    </div>}

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(180px,100%),1fr))",gap:14,marginBottom:18}}>
      {/* One tile per plan tier -- byPlan already computes mrr correctly per plan (see the
          Signups by Plan breakdown below); previously every self-serve household's revenue was
          lumped into a single "Self-Serve MRR" tile regardless of plan, which read as if
          everyone was on one tier. */}
      {byPlan.map(p=><StatBox key={p.plan} label={`${p.label} MRR`} value={fmtMoney(p.mrr)} accent={SIGNUP_PLAN_COLOR[p.plan]}/>)}
    </div>

    {/* MRR roll-up, laid out as the actual equation rather than three unrelated tiles: households
        that signed themselves up, plus households the team onboarded, equal the platform total.
        Kept out of the auto-fit grid above and given its own flex row so the +/= glyphs can sit
        at a fixed narrow width between tiles instead of claiming a full grid track each. */}
    <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:10,marginBottom:18}}>
      <div style={{flex:"1 1 180px",minWidth:0}}><StatBox label="Self-Directed MRR" value={fmtMoney(selfServeMRR)} accent={B.gold}/></div>
      <div aria-hidden="true" style={{flex:"none",fontSize:20,fontWeight:700,color:B.textMute}}>+</div>
      {/* Team-Onboarded: households an advisor/admin put on the platform for an existing
          relationship, rather than the household signing itself up. This tile plus
          Self-Directed MRR always equals Total Platform MRR, by construction -- see
          teamOnboardedMRR/selfServeMRR/platformMRR. */}
      <div style={{flex:"1 1 180px",minWidth:0}}><StatBox label="Team-Onboarded MRR" value={fmtMoney(teamOnboardedMRR)} accent={B.navy}/></div>
      <div aria-hidden="true" style={{flex:"none",fontSize:20,fontWeight:700,color:B.textMute}}>=</div>
      <div style={{flex:"1 1 180px",minWidth:0}}><StatBox label="Total Platform MRR" value={fmtMoney(platformMRR)} accent={B.navyMid}/></div>
    </div>

    {/* Promotion codes: what list price would bring in, what the codes give away, and what is left. The
        MRR tiles above are already net of promotions; this row shows the gap. */}
    <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:10,marginBottom:promoHouseholds.length?12:18}}>
      <div style={{flex:"1 1 180px",minWidth:0}}><StatBox label="MRR at List Price" value={fmtMoney(platformListMRR)} accent={B.textMute}/></div>
      <div aria-hidden="true" style={{flex:"none",fontSize:20,fontWeight:700,color:B.textMute}}>−</div>
      <div style={{flex:"1 1 180px",minWidth:0}}><StatBox label={`Promo Discounts (${promoHouseholds.length} household${promoHouseholds.length===1?"":"s"})`} value={fmtMoney(promoLostMRR)} accent="#b4551f"/></div>
      <div aria-hidden="true" style={{flex:"none",fontSize:20,fontWeight:700,color:B.textMute}}>=</div>
      <div style={{flex:"1 1 180px",minWidth:0}}><StatBox label="Net Platform MRR" value={fmtMoney(platformMRR)} accent={B.navyMid}/></div>
    </div>
    {promoHouseholds.length>0&&<div style={{background:B.bgCard,borderRadius:12,padding:"16px 20px",border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,marginBottom:18}}>
      <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Promotion codes in use</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
        {promoByCode.map(c=><span key={c.code} style={{fontSize:12,background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:16,padding:"5px 12px",color:B.navy}}>
          <strong>{c.code}</strong> · {c.count} household{c.count===1?"":"s"} · −{fmtMoney(c.lost)}/mo</span>)}
      </div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5,minWidth:520}}>
        <thead><tr>{["Household","Plan","Code","Discount","List","Pays"].map(h=><th key={h} style={{textAlign:h==="List"||h==="Pays"?"right":"left",fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",padding:"6px 8px",borderBottom:`1px solid ${B.border}`}}>{h}</th>)}</tr></thead>
        <tbody>{[...promoHouseholds].sort((a,b)=>promoOff(b)-promoOff(a)).map(f=><tr key={f.id}>
          <td style={{padding:"7px 8px",borderBottom:`1px solid ${B.borderLight}`,color:B.navy,fontWeight:600}}>{f.name}</td>
          <td style={{padding:"7px 8px",borderBottom:`1px solid ${B.borderLight}`}}>{labelOf(f.plan)}</td>
          <td style={{padding:"7px 8px",borderBottom:`1px solid ${B.borderLight}`}}>{f.promo_code||f.promo_coupon||"—"}</td>
          <td style={{padding:"7px 8px",borderBottom:`1px solid ${B.borderLight}`}}>{promoText(f)}</td>
          <td style={{padding:"7px 8px",borderBottom:`1px solid ${B.borderLight}`,textAlign:"right"}}>{fmtMoney(priceOf(f.plan))}</td>
          <td style={{padding:"7px 8px",borderBottom:`1px solid ${B.borderLight}`,textAlign:"right",fontWeight:700}}>{fmtMoney(netPriceOf(f))}</td>
        </tr>)}</tbody>
      </table></div>
      <div style={{fontSize:11,color:B.textMute,marginTop:8,lineHeight:1.5}}>Amounts are per month. When a code's time runs out (for example 3 Months Free), the household drops off this list and counts at full price.</div>
    </div>}

    {/* Operational stats -- household count and onboarding follow-up -- kept in their own row
        below the two MRR sections above rather than mixed into the per-plan grid, so the revenue
        tiles read as one group and this housekeeping trio reads as another. */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(180px,100%),1fr))",gap:14,marginBottom:24}}>
      <StatBox label="Total Households" value={families.length} accent={B.textSoft}/>
      <StatBox label="Pending Onboarding Contact" value={allPendingOnboarding.length} accent={ONBOARDING_SCHEME.new.dot}/>
      <StatBox label="Overdue (48h+)" value={overdueOnboarding.length} accent={UTIL_SCHEME.Low.dot}/>
    </div>

    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1.1fr 1fr",gap:18,marginBottom:18,alignItems:"start"}}>
      {/* Weekly signups -- a single series, so no legend is needed (the title names it). */}
      <div style={{background:B.bgCard,borderRadius:12,padding:"20px 22px",border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
        <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Signups — Last 8 Weeks</div>
        <div style={{display:"flex",alignItems:"flex-end",gap:10,height:140,borderBottom:`1px solid ${B.borderLight}`,paddingBottom:2}}>
          {weeks.map((w,i)=>{
            const h=w.count===0?0:Math.max(6,Math.round((w.count/maxWeek)*120));
            return <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",height:"100%"}}>
              <div style={{fontSize:11,color:B.navy,fontWeight:700,marginBottom:4,visibility:w.count?"visible":"hidden"}}>{w.count}</div>
              <div title={`Week of ${fmtWeek(w.start)}: ${w.count} signup${w.count===1?"":"s"}`} style={{width:"100%",maxWidth:28,height:h,background:B.gold,borderRadius:"4px 4px 0 0"}}/>
            </div>;
          })}
        </div>
        <div style={{display:"flex",gap:10,marginTop:6}}>
          {weeks.map((w,i)=><div key={i} style={{flex:1,textAlign:"center",fontSize:9,color:B.textMute}}>{fmtWeek(w.start)}</div>)}
        </div>
      </div>

      {/* Plan breakdown -- fixed 3-category order and color, never derived from data order.
          Each row drills into that plan's household list (see the drill==="plan" branch above). */}
      <div style={{background:B.bgCard,borderRadius:12,padding:"20px 22px",border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
        <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Signups by Plan</div>
        {byPlan.map(p=><div key={p.plan} onClick={()=>setDrill({type:"plan",plan:p.plan})} role="button" tabIndex={0}
          onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")setDrill({type:"plan",plan:p.plan});}}
          style={{marginBottom:14,cursor:"pointer",borderRadius:6,padding:"4px 6px",margin:"-4px -6px 10px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:B.text,marginBottom:4,flexWrap:"wrap",gap:6}}>
            <span style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:9,height:9,borderRadius:2,background:SIGNUP_PLAN_COLOR[p.plan],display:"inline-block"}}/>{p.label}</span>
            <span style={{display:"flex",alignItems:"center",gap:8}}>
              {p.pendingCount>0&&<Badge scheme={p.overdueCount>0?UTIL_SCHEME.Low:ONBOARDING_SCHEME.new}>{p.pendingCount} new</Badge>}
              <span style={{color:B.textSoft,display:"flex",alignItems:"center",gap:4}}>{p.count} · {fmtMoney(p.mrr)}/mo
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={B.textMute} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
              </span>
            </span>
          </div>
          <div style={{height:8,background:B.borderLight,borderRadius:4,overflow:"hidden"}}>
            <div title={`${p.label}: ${p.count} signup${p.count===1?"":"s"}, ${fmtMoney(p.mrr)}/mo -- click for the household list`} style={{width:`${p.count?Math.max(4,(p.count/maxByPlan)*100):0}%`,height:"100%",background:SIGNUP_PLAN_COLOR[p.plan],borderRadius:4}}/>
          </div>
        </div>)}
      </div>
    </div>

    <div style={{background:B.bgCard,borderRadius:12,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,overflow:"hidden"}}>
      <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",padding:"16px 22px 0"}}>Recent Signups</div>
      {recent.length===0?<div style={{padding:22,color:B.textSoft,fontSize:13}}>No signups yet.</div>:
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,marginTop:10}}>
          <thead><tr style={{textAlign:"left",color:B.textMute,fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase"}}>
            <th style={{padding:"8px 22px"}}>Household</th><th style={{padding:"8px 12px"}}>Contact</th><th style={{padding:"8px 12px"}}>Plan</th><th style={{padding:"8px 12px"}}>Status</th><th style={{padding:"8px 12px"}}>Onboarding</th><th style={{padding:"8px 22px"}}>Signed Up</th>
          </tr></thead>
          <tbody>
            {recent.map(f=>{const c=contacts[f.id]||{};const ob=onboardingStatusFor(f);return <tr key={f.id} onClick={()=>setDrill({type:"user",familyId:f.id})} style={{borderTop:`1px solid ${B.borderLight}`,cursor:"pointer"}}>
              <td style={{padding:"10px 22px",color:B.navy,fontWeight:600,textDecoration:"underline",textDecorationColor:B.borderLight}}>{f.name}</td>
              <td style={{padding:"10px 12px",color:B.textSoft}}>{c.fullName||c.email||"—"}</td>
              <td style={{padding:"10px 12px"}}><span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:2,background:SIGNUP_PLAN_COLOR[f.plan]||B.textMute,display:"inline-block"}}/>{labelOf(f.plan)}</span></td>
              <td style={{padding:"10px 12px",color:B.textSoft,textTransform:"capitalize"}}>{(f.subscription_state||"—").replace("_"," ")}</td>
              <td style={{padding:"10px 12px"}}>{ob.state==="contacted"?<Badge scheme={ONBOARDING_SCHEME.contacted}>Contacted</Badge>:<Badge scheme={ob.state==="overdue"?ONBOARDING_SCHEME.overdue:ONBOARDING_SCHEME.new}>{ob.state==="overdue"?"Overdue":"New"} · {ob.days}d</Badge>}</td>
              <td style={{padding:"10px 22px",color:B.textSoft}}>{fmtDate(f.createdAt)}</td>
            </tr>;})}
          </tbody>
        </table>
      </div>}
    </div>
  </div>;
}

// ── PARTNER (view-only across one or more linked families, upload/download docs only) ──
// data.families is already scoped to this partner's linked families via RLS
// (current_user_allowed_family_ids(), joined through the family_partners table),
// so no extra client-side filtering is needed here — same trust model as the
// client and advisor branches above.
const FIRM_LOG_TEXT={open_household:"Opened household",open_document:"Opened a document",download_document:"Downloaded a document"};
const FIRM_TABLES=["contacts","properties","notes","tasks","portfolio_accounts","account_balances","valuables","loans","documents","cash_flow_events","cash_flow_payment_log","deadline_acks","family_contacts","property_contacts","family_partners"];
// A firm's administrator: the firm's households, view only. What they can read is limited by the database to
// their own firm's households (see 20261010100300_firm_access.sql), and every household they open is recorded
// before any of its data is loaded.
function FirmDashboard({userProfile,logout,toast}){
  const[loading,setLoading]=useState(true);
  const[err,setErr]=useState("");
  const[fams,setFams]=useState([]);
  const[hh,setHh]=useState([]);
  const[taskSum,setTaskSum]=useState({});
  const[wfSum,setWfSum]=useState({});
  const[worth,setWorth]=useState(null);
  const[firmName,setFirmName]=useState("");
  const[log,setLog]=useState([]);
  const[people,setPeople]=useState({});
  const[view,setView]=useState("households");
  const[selectedId,setSelectedId]=useState(null);
  const[fdata,setFdata]=useState(null);
  const[opening,setOpening]=useState(false);

  const loadOverview=useCallback(async()=>{
    setLoading(true);setErr("");
    const[f,h,t,w,n,l,u]=await Promise.all([
      sb.rpc("firm_family_rows"),
      sb.rpc("enterprise_household_list"),
      sb.rpc("enterprise_task_summary"),
      sb.rpc("enterprise_workflow_summary"),
      sb.rpc("enterprise_net_worth"),
      sb.from("firm_access_log").select("*").order("created_at",{ascending:false}).limit(100),
      sb.rpc("enterprise_user_list"),
    ]);
    const bad=[f,h,t,w,n,l,u].find(x=>x.error);
    if(bad){setErr(bad.error.message||"Could not load your households.");setLoading(false);return;}
    setFams((f.data||[]).map(toClient));
    setHh((h.data||[]).filter(r=>!r.archived_at));
    const ts={};(t.data||[]).forEach(r=>{ts[r.family_id]=r;});setTaskSum(ts);
    const ws={};(w.data||[]).forEach(r=>{(ws[r.family_id]=ws[r.family_id]||[]).push(r);});setWfSum(ws);
    const row=(n.data||[])[0]||null;setWorth(row);setFirmName(row?.enterprise_name||"");
    setLog(l.data||[]);
    const pm={};(u.data||[]).forEach(r=>{pm[r.user_id]=r.full_name||r.email;});setPeople(pm);
    setLoading(false);
  },[]);
  useEffect(()=>{loadOverview();},[loadOverview]);

  const loadHousehold=useCallback(async(id,record)=>{
    if(record){
      // Recorded first. If it cannot be recorded, nothing is loaded.
      const{error}=await sb.rpc("firm_log_access",{p_family_id:id,p_action:"open_household",p_detail:null});
      if(error)throw new Error("This could not be recorded, so the household was not opened.");
    }
    const results=await Promise.all(FIRM_TABLES.map(t=>sb.from(t).select("*").eq("family_id",id).order("created_at",{ascending:false})));
    const bundle={families:fams.filter(x=>x.id===id),deals:[],note_attachments:[]};
    FIRM_TABLES.forEach((t,i)=>{
      if(results[i].error)throw new Error(results[i].error.message);
      bundle[t]=(results[i].data||[]).map(toClient);
    });
    const noteIds=(bundle.notes||[]).map(x=>x.id);
    if(noteIds.length){
      const{data,error}=await sb.from("note_attachments").select("*").in("note_id",noteIds);
      if(error)throw new Error(error.message);
      bundle.note_attachments=(data||[]).map(toClient);
    }
    setFdata(bundle);
  },[fams]);

  const open=async id=>{
    setOpening(true);
    try{await loadHousehold(id,true);setSelectedId(id);}
    catch(e){toast(e.message||"Could not open that household","error");}
    setOpening(false);
  };
  const back=()=>{setSelectedId(null);setFdata(null);sb.from("firm_access_log").select("*").order("created_at",{ascending:false}).limit(100).then(r=>{if(!r.error)setLog(r.data||[]);});};
  const reload=useCallback(async()=>{if(selectedId)try{await loadHousehold(selectedId,false);}catch(_e){}},[selectedId,loadHousehold]);

  const Header=({children})=><div style={{padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
    <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
      <PCMLogo compact/>
      {children}
    </div>
    <div style={{display:"flex",alignItems:"center",gap:14}}>
      <div style={{textAlign:"right"}}>
        <div style={{fontSize:12,color:B.navy,fontWeight:600}}>{userProfile.fullName||userProfile.email}</div>
        <div style={{fontSize:9,color:B.navyMid,letterSpacing:"0.1em",textTransform:"uppercase"}}>{firmName?firmName+" · ":""}Firm Administrator · View Only</div>
      </div>
      <SecurityButton role={userProfile.role} toast={toast} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:B.textSoft}}/>
      <button onClick={logout} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:B.textSoft}}>Sign Out</button>
    </div>
  </div>;

  const selected=fams.find(x=>x.id===selectedId);
  if(selected&&fdata){
    return <div style={{height:FULL_H,display:"flex",flexDirection:"column",background:B.bg,fontFamily:"'DM Sans','Helvetica Neue',sans-serif"}}>
      <Header/>
      <div style={{flex:1,minHeight:0}}>
        <ViewErrorBoundary label="the household" onBack={back}>
          <PrivateGate familyId={selected.id} onBack={back}><FamilyDashboard family={selected} data={fdata} reload={reload} toast={toast} onBack={back} userProfile={userProfile}/></PrivateGate>
        </ViewErrorBoundary>
      </div>
    </div>;
  }

  const famName=id=>(fams.find(x=>x.id===id)||{}).name||"A household that has since left the firm";
  const openTasks=Object.values(taskSum).reduce((a,r)=>a+(r.open_tasks||0),0);
  const overdueTasks=Object.values(taskSum).reduce((a,r)=>a+(r.overdue_tasks||0),0);
  const tabBtn=(id,label)=><button key={id} onClick={()=>setView(id)} style={{background:view===id?B.navy:"transparent",color:view===id?B.white:B.navy,border:`1px solid ${view===id?B.navy:B.border}`,borderRadius:8,padding:"7px 14px",fontSize:12.5,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{label}</button>;

  return <div style={{minHeight:"100vh",background:B.bg,fontFamily:"'DM Sans','Helvetica Neue',sans-serif"}}>
    <Header/>
    <div style={{padding:24,maxWidth:1100,margin:"0 auto"}}>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:4}}>{firmName||"Your firm"}</div>
      <div style={{fontSize:12.5,color:B.textSoft,marginBottom:16,lineHeight:1.5}}>You can see everything each household's owner sees. You cannot change anything. ORDANIS records each household and document you open.</div>
      {err&&<div style={{...entCard,color:"#8b1a1a",borderColor:"#e8b4b4"}}>{err}</div>}
      {loading?<div style={{height:200}}><Spinner/></div>:<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,marginBottom:16}}>
          <EntTile label="Households" value={worth?worth.households:fams.length} sub={worth&&worth.households_with_data<worth.households?`${worth.households_with_data} with data entered`:null}/>
          <EntTile label="Combined net worth" value={worth?entMoney0(worth.net_worth):"—"} sub="Entered by households and their Expert, not synced from banks"/>
          <EntTile label="Open tasks" value={openTasks} sub={overdueTasks?`${overdueTasks} overdue`:"None overdue"}/>
        </div>
        {worth&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:16}}>
          <EntTile label="Real estate" value={entMoney0(worth.real_estate)}/>
          <EntTile label="Debt" value={entMoney0(worth.debt)}/>
          <EntTile label="Portfolio" value={entMoney0(worth.portfolio)}/>
          <EntTile label="Valuables" value={entMoney0(worth.valuables)}/>
        </div>}
        <div style={{display:"flex",gap:8,marginBottom:14}}>{tabBtn("households","Households")}{tabBtn("activity","Access record")}</div>
        {view==="households"&&<div style={{...entCard,padding:"8px 14px",overflowX:"auto"}}>
          {hh.length===0?<Empty text="No households have joined your firm yet."/>:<table style={{width:"100%",borderCollapse:"collapse",minWidth:620}}>
            <thead><tr><th style={entTh}>Household</th><th style={entTh}>Plan</th><th style={entTh}>Status</th><th style={entTh}>Open tasks</th><th style={entTh}>Overdue</th><th style={entTh}>Workflows</th><th style={entTh}>Joined</th><th style={entTh}></th></tr></thead>
            <tbody>{hh.map(r=>{const t=taskSum[r.family_id]||{};const w=wfSum[r.family_id]||[];const active=w.reduce((a,x)=>a+(x.instances||0),0);
              return <tr key={r.family_id}>
                <td style={{...entTd,fontWeight:600,color:B.navy}}>{r.name}</td>
                <td style={entTd}>{planLabel(r.plan)}</td>
                <td style={entTd}>{r.subscription_state||"—"}</td>
                <td style={entTd}>{t.open_tasks||0}</td>
                <td style={{...entTd,color:(t.overdue_tasks||0)>0?"#8b1a1a":B.text,fontWeight:(t.overdue_tasks||0)>0?700:400}}>{t.overdue_tasks||0}</td>
                <td style={entTd}>{active}</td>
                <td style={entTd}>{entDay(r.joined_enterprise_at)}</td>
                <td style={entTd}><Btn small variant="gold" disabled={opening} onClick={()=>open(r.family_id)}>{opening?"Opening…":"Open"}</Btn></td>
              </tr>;})}</tbody>
          </table>}
        </div>}
        {view==="activity"&&<div style={{...entCard,padding:"8px 14px",overflowX:"auto"}}>
          <div style={{fontSize:12,color:B.textSoft,padding:"8px 10px"}}>The most recent 100 times someone at your firm opened a household or a document.</div>
          {log.length===0?<Empty text="Nothing has been opened yet."/>:<table style={{width:"100%",borderCollapse:"collapse",minWidth:520}}>
            <thead><tr><th style={entTh}>When</th><th style={entTh}>Who</th><th style={entTh}>What</th><th style={entTh}>Household</th><th style={entTh}>Detail</th></tr></thead>
            <tbody>{log.map(r=><tr key={r.id}>
              <td style={entTd}>{new Date(r.created_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</td>
              <td style={entTd}>{people[r.user_id]||"Firm administrator"}</td>
              <td style={entTd}>{FIRM_LOG_TEXT[r.action]||r.action}</td>
              <td style={entTd}>{famName(r.family_id)}</td>
              <td style={{...entTd,color:B.textSoft}}>{r.detail||""}</td>
            </tr>)}</tbody>
          </table>}
        </div>}
      </>}
    </div>
  </div>;
}

function PartnerDashboard({data,userProfile,logout,toast,reload}){
  // Households waiting for this professional to accept (migration 20261028120000). Nothing of theirs is visible
  // until accepted; the household's name is all that's shown here.
  const[pending,setPending]=useState(null); // null until loaded, so a single household isn't auto-opened over an invitation
  const[answering,setAnswering]=useState("");
  const loadPending=useCallback(()=>{sb.rpc("partner_pending_invitations").then(({data,error})=>{setPending(error?[]:(data||[]));});},[]);
  useEffect(()=>{loadPending();},[loadPending]);
  const respond=async(inv,accept)=>{
    setAnswering(inv.family_id);
    const{data:resp,error}=await sb.functions.invoke("manage-business-partner",{body:{family_id:inv.family_id,action:"respond",accept}});
    setAnswering("");
    if(error||!resp?.success){let msg=resp?.error||error?.message||"That didn't work";try{const b=await error?.context?.json?.();if(b?.error)msg=b.error;}catch(_e){}toast(msg,"error");return;}
    toast(accept?`You now have access to ${inv.family_name}.`:`Declined. ${inv.family_name} has been told nothing else.`);
    loadPending();if(accept)reload();
  };
  const myFamilies=data.families||[];
  const[selectedId,setSelectedId]=useState(null);
  useEffect(()=>{
    if(selectedId===null&&myFamilies.length===1&&pending&&pending.length===0)setSelectedId(myFamilies[0].id);
  },[myFamilies.length,pending]);
  const selected=myFamilies.find(f=>f.id===selectedId);

  const HeaderBar=({children})=><div style={{padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
    <div style={{display:"flex",alignItems:"center",gap:14}}>
      <PCMLogo compact/>
      {children}
    </div>
    <div style={{display:"flex",alignItems:"center",gap:14}}>
      <div style={{textAlign:"right"}}>
        <div style={{fontSize:12,color:B.navy,fontWeight:600}}>{userProfile.fullName||userProfile.email}</div>
        <div style={{fontSize:9,color:B.navyMid,letterSpacing:"0.1em",textTransform:"uppercase"}}>Partner · View Only</div>
      </div>
      <SecurityButton role={userProfile.role} toast={toast} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:B.textSoft}}/>
      <button onClick={logout} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:B.textSoft}}>Sign Out</button>
    </div>
  </div>;

  if(selected){
    return <div style={{height:FULL_H,display:"flex",flexDirection:"column",background:B.bg,fontFamily:"'DM Sans','Helvetica Neue',sans-serif"}}>
      <HeaderBar>
        {myFamilies.length>1&&<button onClick={()=>setSelectedId(null)} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:B.navy,fontWeight:600}}>← Switch Family</button>}
      </HeaderBar>
      <div style={{flex:1,minHeight:0}}>
        <ViewErrorBoundary label="the family dashboard" onBack={()=>setSelectedId(null)}>
          <PrivateGate familyId={selected.id} onBack={()=>setSelectedId(null)}><FamilyDashboard family={selected} data={data} reload={reload} toast={toast} onBack={()=>setSelectedId(null)} userProfile={userProfile}/></PrivateGate>
        </ViewErrorBoundary>
      </div>
    </div>;
  }

  return <div style={{minHeight:"100vh",background:B.bg,fontFamily:"'DM Sans','Helvetica Neue',sans-serif"}}>
    <HeaderBar/>
    <div style={{padding:24,maxWidth:960,margin:"0 auto"}}>
      {pending&&pending.length>0&&<div style={{background:"rgba(206,182,132,0.12)",border:`1px solid ${B.gold}`,borderRadius:12,padding:"14px 18px",marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:700,color:B.navy,marginBottom:8}}>Waiting for you to accept</div>
        {pending.map(inv=><div key={inv.family_id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",padding:"8px 0",borderTop:`1px solid ${B.borderLight}`}}>
          <div style={{fontSize:13.5,color:B.text}}><strong style={{color:B.navy}}>{inv.family_name}</strong> would like to add you as a Business Partner.</div>
          <div style={{display:"flex",gap:8}}>
            <Btn small disabled={!!answering} onClick={()=>respond(inv,true)}>{answering===inv.family_id?"Working…":"Accept"}</Btn>
            <Btn small variant="ghost" disabled={!!answering} onClick={()=>respond(inv,false)}>Decline</Btn>
          </div>
        </div>)}
      </div>}
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600,marginBottom:16}}>Select a Family</div>
      {myFamilies.length===0&&!(pending&&pending.length)&&<Empty text={`No families are linked to your account yet. Contact your ${BRAND.short} representative.`}/>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(280px,100%),1fr))",gap:16}}>
        {myFamilies.map(f=><div key={f.id} onClick={()=>setSelectedId(f.id)} style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${B.gold}`,padding:20,cursor:"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
          onMouseEnter={e=>e.currentTarget.style.boxShadow=B.shadowMd}
          onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:19,color:B.navy,fontWeight:600}}>{f.name}</div>
          <div style={{marginTop:8,fontSize:12,color:B.gold,fontWeight:600}}>Open dashboard →</div>
        </div>)}
      </div>
    </div>
  </div>;
}

// ── RESOURCES (advisor tools + client document generation) ─────────────────
// Reads the AcroForm field names present in a PDF. Used both to validate a
// template at upload time and to check one before filling it.
async function readPdfFieldNames(bytes){
  const PDFDocument=await loadPdfDocument();
  const pdfDoc=await PDFDocument.load(bytes);
  return pdfDoc.getForm().getFields().map(f=>f.getName());
}

// Fills a template and returns a blob: URL for the filled copy.
//
// This used to swallow unknown field names — "so this stays resilient if a
// template's fields are tweaked later". That resilience was the bug. pdf-lib
// throws when a field doesn't exist, so a template whose fields had been renamed
// produced a document that reported success and came out blank: a Client
// Services Agreement with no client, no fee and no date. Silence is the worst
// possible outcome for a document someone is about to sign, so a missing field
// is now a hard error naming exactly what was missing.
async function fillPdfTemplate(bytes,fieldValues,checkboxValues={},opts={}){
  const PDFDocument=await loadPdfDocument();
  const pdfDoc=await PDFDocument.load(bytes);
  const form=pdfDoc.getForm();
  const missing=[];
  // `optional` names may legitimately be absent from an older template. They are
  // still attempted, so a newer template gets them filled, but their absence is
  // not an error.
  const optional=new Set(opts.optional||[]);
  Object.entries(fieldValues).forEach(([name,value])=>{
    try{ form.getTextField(name).setText(value||""); }
    catch(e){ if(!optional.has(name)) missing.push(name); }
  });
  Object.entries(checkboxValues).forEach(([name,checked])=>{
    try{ const f=form.getCheckBox(name); if(checked)f.check(); else f.uncheck(); }catch(e){ missing.push(name); }
  });
  if(missing.length){
    throw new Error(
      `This template is missing ${missing.length} form field${missing.length>1?"s":""} the platform needs to fill: `+
      `${missing.join(", ")}. The document would have been generated blank, so nothing was produced. `+
      `Re-upload the template under Branding with these field names.`);
  }
  form.updateFieldAppearances();
  const outBytes=await pdfDoc.save();
  const blob=new Blob([outBytes],{type:"application/pdf"});
  return URL.createObjectURL(blob);
}

// Line icons matching the stat-card style used elsewhere (stroke=currentColor,
// 24x24 viewBox) — swapped in for the old emoji glyphs on Resources tiles.
const ResIcon=({name})=>{
  const paths={
    doc:<><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/></>,
    bank:<><path d="M3 10 12 4l9 6"/><path d="M4 10v9"/><path d="M9 10v9"/><path d="M15 10v9"/><path d="M20 10v9"/><path d="M2 21h20"/></>,
    book:<><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5V4.5"/></>,
    check:<><path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="m4 6 1 1 2-2"/><path d="m4 12 1 1 2-2"/><path d="m4 18 1 1 2-2"/></>,
    transfer:<><path d="M7 7h12l-3.5-3.5"/><path d="M17 17H5l3.5 3.5"/></>,
    chart:<><path d="M4 20V10"/><path d="M11 20V4"/><path d="M18 20v-7"/><path d="M2 20h20"/></>,
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]||paths.doc}</svg>;
};
function ResIconBadge({name}){
  return <div style={{width:44,height:44,borderRadius:"50%",background:"rgba(206,182,132,0.15)",border:"1px solid rgba(206,182,132,0.55)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:B.navy}}><ResIcon name={name}/></div>;
}

// Best-effort guess at a US state from a free-text address string (e.g.
// "123 Main St, Tampa, FL 33602" -> "FL"). Just a starting point in the
// field — advisors can always overwrite it before generating.
function guessState(address){
  if(!address)return"";
  const m=address.match(/,\s*([A-Za-z]{2})\s*\d{0,5}\s*$/);
  return m?m[1].toUpperCase():"";
}

// Client documents that can be generated, pre-filled, and opened per family.
// Each default(family, contact, userProfile, bankAccount) pulls from real
// platform data where it exists; unmapped fields are left blank for manual
// entry — notably bank account/routing numbers, which this platform does not
// store anywhere (by design, until RLS + encryption are in place).
const DOC_CONFIGS={
  agreement:{
    label:"Client Services Agreement",icon:"doc",
    // No subtitle. It read "$5,000/mo advisory agreement · 6-month minimum",
    // which stated commercial terms on a tile that every tenant firm sees and
    // that no template actually contains — the fee and term are filled in per
    // client when the document is generated, and the agreement PDF itself carries
    // no such wording. Quoting a price in the UI was both wrong for other firms
    // and not something the platform should assert on a firm's behalf.
    desc:"",
    docKey:"agreement",
    fields:[
      {key:"client_name",   label:"Client / Family Name", pdfField:"client_name",    default:(f)=>f.name||""},
      {key:"monthly_fee",   label:"Monthly Fee",          pdfField:"monthly_fee",    default:()=>feePlain(FIRM_DEFAULTS.monthlyFee),
        derives:{key:"annual_fee",compute:(v)=>{ const n=parseFloat(String(v).replace(/[^0-9.]/g,""))||0; return (n*12).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }}},
      {key:"annual_fee",    label:"Annual Fee",           pdfField:"annual_fee",     default:()=>feeAnnualPlain(FIRM_DEFAULTS.monthlyFee)},
      // One-time, and kept out of the annual figure on purpose: folding it in
      // would make the annual number differ from twelve times the monthly one
      // with nothing on the page saying why, and would overstate year two.
      // optionalPdfField because templates uploaded before this field existed
      // must keep working rather than having their tile disabled.
      {key:"onboarding_fee",label:"Onboarding Fee (one-time)", pdfField:"onboarding_fee", optionalPdfField:true,
        default:()=>feePlain(FIRM_DEFAULTS.onboardingFee)},
      {key:"effective_date",label:"Effective Date",       pdfField:"effective_date", type:"date", default:()=>todayISO()},
      {key:"client_address",label:"Client Address",       pdfField:"client_address", default:(f,c)=>c?.address||""},
      {key:"governing_state",label:"Governing State",     pdfField:"governing_state",placeholder:"e.g. Florida", default:(f,c)=>guessState(c?.address)},
      {key:"svc_portfolio",   label:"Include: Portfolio oversight",     pdfField:null, type:"checkbox", default:()=>true},
      {key:"svc_property",    label:"Include: Property & asset tracking", pdfField:null, type:"checkbox", default:()=>true},
      {key:"svc_documents",   label:"Include: Document management",     pdfField:null, type:"checkbox", default:()=>true},
      {key:"svc_planning",    label:"Include: Financial planning",      pdfField:null, type:"checkbox", default:()=>true},
      {key:"svc_portal",      label:"Include: Client portal & Ask ORDANIS",pdfField:null, type:"checkbox", default:()=>true},
      {key:"svc_bookkeeping", label:"Include: Bookkeeping, bill pay & reporting", pdfField:null, type:"checkbox", default:()=>true},
    ],
  },
  ach:{
    label:"Auto-Debit (ACH) Authorization",icon:"bank",
    desc:"Recurring monthly fee authorization",
    docKey:"ach",
    fields:[
      {key:"client_name",         label:"Client / Family Name",  pdfField:"client_name",          default:(f)=>f.name||""},
      {key:"account_holder_name",label:"Account Holder Name",   pdfField:"account_holder_name",  default:(f,c)=>c?.name||f.name||""},
      {key:"billing_address",    label:"Billing Address",       pdfField:"billing_address",      default:(f,c)=>c?.address||""},
      {key:"phone",              label:"Phone",                 pdfField:"phone",                default:(f,c)=>c?.phone||""},
      {key:"email",              label:"Email",                 pdfField:"email",                default:(f,c)=>c?.email||""},
      {key:"bank_name",          label:"Bank Name",             pdfField:"bank_name",            default:(f,c,u,a)=>a?.institution||""},
      {key:"account_type",       label:"Account Type",          pdfField:null, type:"select", options:["Checking","Savings"], default:(f,c,u,a)=>a?.accountType==="Savings"?"Savings":"Checking"},
      {key:"monthly_fee",        label:"Monthly Fee",           pdfField:"monthly_fee",          default:()=>feeCurrency(FIRM_DEFAULTS.monthlyFee)},
      {key:"billing_date",       label:"Billing Date",          pdfField:"billing_date",         placeholder:"e.g. 1st", default:()=>"1st"},
    ],
  },
  checklist:{
    label:"Client Data Completeness Checklist",icon:"check",
    desc:"Audit checklist for onboarding & reviews",
    docKey:"checklist",
    fields:[
      {key:"family_client",label:"Family / Client Name", pdfField:"family_client", default:(f)=>f.name||""},
      {key:"advisor_name", label:"ORDANIS Expert",       pdfField:"advisor_name",  default:(f,c,u)=>f.advisorName||u?.fullName||u?.email||""},
      {key:"date_reviewed",label:"Date Reviewed",         pdfField:"date_reviewed", type:"date", default:()=>todayISO()},
    ],
  },
  wire:{
    label:"Wire Transfer Instructions",icon:"transfer",
    desc:"Fillable remittance form for outgoing/incoming wires",
    docKey:"wire",
    note:"Pre-fills the client as sender, using whatever bank is on file for them — the most common case. If your client is the beneficiary instead, fill in that section directly in the opened PDF. Account and routing numbers are never stored in the platform, so those stay blank here on purpose.",
    fields:[
      {key:"sender_name",   label:"Sender Name",     pdfField:"sender_name_1",   default:(f,c)=>c?.name||f.name||""},
      {key:"sender_address",label:"Sender Address",  pdfField:"sender_address_2",default:(f,c)=>c?.address||""},
      {key:"sender_bank",   label:"Originating Bank",pdfField:"sender_bank_3",   default:(f,c,u,a)=>a?.institution||""},
      {key:"wire_date",     label:"Wire Date",       pdfField:"wire_date_14",    type:"date", default:()=>todayISO()},
    ],
  },
  pfs:{
    label:"Personal Financial Statement",icon:"doc",
    desc:"Fillable assets, liabilities, income & expense statement",
    docKey:"pfs",
    fields:[
      {key:"prepared_for",label:"Prepared For",   pdfField:"Text1",              default:(f)=>f.name||""},
      {key:"as_of",       label:"Statement Date", pdfField:"as of mmddyyyy1",    type:"date", default:()=>todayISO()},
    ],
  },
  lifestyle:{
    label:"Lifestyle Expense Worksheet",icon:"chart",
    desc:"Fillable monthly/annual expense worksheet for clients",
    docKey:"lifestyle",
    fields:[
      {key:"as_of",label:"As Of Date", pdfField:"Date", type:"date", default:()=>todayISO()},
    ],
  },
};

// Every form field the platform writes into a given template, derived from the
// config above so there is exactly one source of truth. Used to validate a
// template on upload and to decide whether generation can proceed.
//
// Deliberately narrower than "all fields in the PDF": PCM's agreement also
// carries pcm_signature / pcm_printed_name / pcm_title, which the platform never
// touches because they are signed by hand. Requiring every field present in one
// firm's template would reject another firm's perfectly good one.
// Fields marked `optionalPdfField` are excluded. A template predating the field
// must keep working: requiring it would have failed validation on every template
// already uploaded and disabled the tile, turning an additive change into an
// outage. So the platform fills it when the template has it and stays quiet when
// it does not.
function requiredFieldsFor(docId){
  const c=DOC_CONFIGS[docId];
  if(!c)return[];
  const text=c.fields.filter(f=>f.pdfField&&!f.optionalPdfField).map(f=>f.pdfField);
  const boxes=c.fields.filter(f=>f.type==="checkbox").map(f=>f.key);
  // FillClientDocModal derives these two from the account_type select rather
  // than from a checkbox field, so they aren't discoverable from `fields`.
  const derived=docId==="ach"?["acct_checking","acct_savings"]:[];
  return[...text,...boxes,...derived];
}

// Static reference material — not tied to a specific family. The guide itself is
// the firm's own document (it carries their branding and their process), so it
// is stored per tenant like the fillable templates rather than served from a
// fixed path under /public.
const RESOURCE_LINKS=[
  {label:"ORDANIS Expert User Guide",icon:"book",desc:"Full platform walkthrough for ORDANIS Experts",docKey:"user_guide"},
];

function FillClientDocModal({docId,family,contact,userProfile,bankAccount,onClose,toast}){
  const config=DOC_CONFIGS[docId];
  const[values,setValues]=useState(()=>{
    const init={};
    config.fields.forEach(f=>{ init[f.key]=f.default?f.default(family,contact,userProfile,bankAccount):""; });
    return init;
  });
  const[generating,setGenerating]=useState(false);
  const set=k=>e=>{
    const val=e.target.value;
    setValues(v=>{
      const next={...v,[k]:val};
      const src=config.fields.find(f=>f.key===k);
      if(src?.derives) next[src.derives.key]=src.derives.compute(val);
      return next;
    });
  };
  const toggle=k=>()=>setValues(v=>({...v,[k]:!v[k]}));

  const regularFields=config.fields.filter(f=>f.type!=="checkbox");
  const checkboxFields=config.fields.filter(f=>f.type==="checkbox");

  const generate=async()=>{
    setGenerating(true);
    try{
      const pdfValues={};
      const checkboxValues={};
      config.fields.forEach(f=>{
        if(f.type==="checkbox") checkboxValues[f.key]=!!values[f.key];
        else if(f.pdfField) pdfValues[f.pdfField]=values[f.key];
      });
      if(docId==="ach"){
        checkboxValues.acct_checking=values.account_type==="Checking";
        checkboxValues.acct_savings=values.account_type==="Savings";
      }
      // The template belongs to whichever firm this deployment is skinned as.
      // fetchTemplateBytes throws if none is on file, and fillPdfTemplate throws
      // if the fields don't line up — both surface to the toast below rather than
      // producing a document that is quietly wrong.
      const bytes=await fetchTemplateBytes(config.docKey);
      const optional=(config.fields||[]).filter(f=>f.optionalPdfField&&f.pdfField).map(f=>f.pdfField);
      const url=await fillPdfTemplate(bytes,pdfValues,checkboxValues,{optional});
      window.open(url,"_blank","noopener,noreferrer");
      toast("Document generated and opened in a new tab");
      onClose();
    }catch(e){
      toast("Couldn't generate the PDF — "+(e.message||"unknown error"),"error");
    }finally{
      setGenerating(false);
    }
  };

  return <Modal title={config.label} onClose={onClose}>
    <div style={{fontSize:13,color:B.textSoft,marginBottom:16,lineHeight:1.5}}>
      Review and adjust the details below, then generate the PDF. It opens in a new tab, pre-filled and ready to use.
    </div>
    {config.note&&<div style={{fontSize:12,color:"#8a5c00",background:"#fef3e2",border:"1px solid #fcd97d",borderRadius:8,padding:"10px 12px",marginBottom:16,lineHeight:1.5}}>{config.note}</div>}
    <Grid2>
      {regularFields.map(f=><Field key={f.key} label={f.label}>
        {f.type==="select"
          ? <Sel value={values[f.key]} onChange={set(f.key)}>{f.options.map(o=><option key={o} value={o}>{o}</option>)}</Sel>
          : <Inp type={f.type||"text"} placeholder={f.placeholder} value={values[f.key]} onChange={set(f.key)}/>}
      </Field>)}
    </Grid2>
    {checkboxFields.length>0&&<div style={{marginTop:6,marginBottom:8}}>
      <label style={{display:"block",fontSize:11,color:B.textSoft,marginBottom:8,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Services Included</label>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(170px,100%),1fr))",gap:8}}>
        {checkboxFields.map(f=><label key={f.key} onClick={toggle(f.key)}
          style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"9px 12px",background:values[f.key]?"#e8f0f8":B.bg,borderRadius:8,border:`1px solid ${values[f.key]?B.navyMid:B.border}`}}>
          <input type="checkbox" checked={!!values[f.key]} onChange={toggle(f.key)} style={{width:15,height:15,accentColor:B.navy,flexShrink:0}}/>
          <span style={{fontSize:12.5,color:B.navy,fontWeight:600}}>{f.label.replace(/^Include:\s*/,"")}</span>
        </label>)}
      </div>
    </div>}
    <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:8}}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn onClick={generate} disabled={generating}>{generating?"Generating…":"Generate & Open →"}</Btn>
    </div>
  </Modal>;
}

// ── SCHEDULED PROMPTS ─────────────────────────────────────────────────────────
const PROMPT_TEMPLATES=[
  {key:"overdue_tasks",label:"Overdue & Upcoming Tasks",desc:"Every open task overdue or due in the next 14 days."},
  {key:"upcoming_deadlines",label:"Upcoming Deadlines",desc:"Loan maturities & insurance expirations in the next 60 days."},
  {key:"portfolio_snapshot",label:"Portfolio Snapshot",desc:"Family count, real estate value, and portfolio value."},
];
const PROMPT_TEMPLATE_MAP=Object.fromEntries(PROMPT_TEMPLATES.map(t=>[t.key,t]));
// Time-of-day presets shown in Eastern Time; stored as the equivalent UTC hour
// (fixed ET = UTC-5 offset, matching the existing daily-8am cron convention
// already used by send-task-reminders).
const PROMPT_HOURS=[6,7,8,9,10,11,12,13,14,15,16,17].map(h=>({
  hourUtc:(h+5)%24,
  label:h<12?`${h}:00 AM ET`:h===12?"12:00 PM ET":`${h-12}:00 PM ET`,
}));
const PROMPT_DOWS=[{v:1,l:"Monday"},{v:2,l:"Tuesday"},{v:3,l:"Wednesday"},{v:4,l:"Thursday"},{v:5,l:"Friday"},{v:6,l:"Saturday"},{v:0,l:"Sunday"}];
// "Concierge" categories — data_source="web_search" rows. Free-text brief +
// category, no book-of-business data involved; Claude searches the live web.
const CONCIERGE_CATEGORIES=[
  {key:"real_estate",label:"Real Estate"},
  {key:"boats",label:"Boats & Yachts"},
  {key:"watches",label:"Watches & Jewelry"},
  {key:"event_tickets",label:"Event Tickets"},
  {key:"other",label:"Other"},
];
const CONCIERGE_CATEGORY_MAP=Object.fromEntries(CONCIERGE_CATEGORIES.map(c=>[c.key,c]));
const scheduleDesc=p=>{
  const hourLabel=(PROMPT_HOURS.find(h=>h.hourUtc===p.scheduleHourUtc)||{}).label||`${p.scheduleHourUtc}:00 UTC`;
  if(p.schedulePreset==="daily")return `Daily at ${hourLabel}`;
  if(p.schedulePreset==="weekdays")return `Weekdays at ${hourLabel}`;
  const dow=(PROMPT_DOWS.find(d=>d.v===p.scheduleDow)||{}).l||"";
  return `Weekly on ${dow} at ${hourLabel}`;
};

function ScheduledPromptsSection({userProfile,families,toast,lockFamilyId}){
  const[prompts,setPrompts]=useState([]);
  const[loading,setLoading]=useState(true);
  const[modal,setModal]=useState(null); // "new" | {edit:row}
  const[runningId,setRunningId]=useState(null);
  const[mode,setMode]=useState("digest"); // "digest" (internal book-of-business) | "concierge" (live web search for one client)
  const[name,setName]=useState("");
  const[promptType,setPromptType]=useState("template");
  const[templateKey,setTemplateKey]=useState(PROMPT_TEMPLATES[0].key);
  const[customPrompt,setCustomPrompt]=useState("");
  const[familyId,setFamilyId]=useState(""); // digest: optional scope to one client; concierge: required
  const[category,setCategory]=useState(CONCIERGE_CATEGORIES[0].key);
  const[schedulePreset,setSchedulePreset]=useState("daily");
  const[scheduleDow,setScheduleDow]=useState(1);
  const[scheduleHourUtc,setScheduleHourUtc]=useState(PROMPT_HOURS[2].hourUtc); // default 8am ET
  const[saving,setSaving]=useState(false);

  // No client-side owner_user_id filter here — RLS governs exactly which rows
  // come back per role (self-owned always; admin: everything; ORDANIS Expert:
  // also Partner-owned rows for families they're allowed to see; Partner:
  // self-owned only, never a ORDANIS Expert's). When locked to one family (the
  // Partner-in-FamilyDashboard case), also narrow to that family client-side.
  const load=async()=>{
    let q=sb.from("scheduled_prompts").select("*").order("created_at",{ascending:false});
    if(lockFamilyId)q=q.eq("family_id",lockFamilyId);
    const{data}=await q;
    if(data)setPrompts(data.map(toClient));
    setLoading(false);
  };
  useEffect(()=>{if(userProfile?.id)load();},[userProfile?.id,lockFamilyId]);

  const resetForm=()=>{setMode("digest");setName("");setPromptType("template");setTemplateKey(PROMPT_TEMPLATES[0].key);setCustomPrompt("");setFamilyId(lockFamilyId||"");setCategory(CONCIERGE_CATEGORIES[0].key);setSchedulePreset("daily");setScheduleDow(1);setScheduleHourUtc(PROMPT_HOURS[2].hourUtc);};
  const openNew=()=>{resetForm();setModal("new");};
  const openEdit=p=>{
    setMode(p.dataSource==="web_search"?"concierge":"digest");
    setName(p.name);setPromptType(p.promptType);setTemplateKey(p.templateKey||PROMPT_TEMPLATES[0].key);setCustomPrompt(p.customPrompt||"");
    setFamilyId(p.familyId||"");setCategory(p.category||CONCIERGE_CATEGORIES[0].key);
    setSchedulePreset(p.schedulePreset);setScheduleDow(p.scheduleDow??1);setScheduleHourUtc(p.scheduleHourUtc);
    setModal({edit:p});
  };

  const invalid=
    !name.trim()||
    (mode==="digest"&&promptType==="custom"&&!customPrompt.trim())||
    (mode==="concierge"&&(!familyId||!customPrompt.trim()));

  const buildRow=()=>mode==="concierge"?{
    owner_user_id:userProfile.id,owner_email:userProfile.email,owner_role:userProfile.role,
    name:name.trim(),data_source:"web_search",prompt_type:"custom",template_key:null,
    custom_prompt:customPrompt.trim(),category,family_id:familyId,
    schedule_preset:schedulePreset,schedule_dow:schedulePreset==="weekly"?scheduleDow:null,schedule_hour_utc:scheduleHourUtc,
  }:{
    owner_user_id:userProfile.id,owner_email:userProfile.email,owner_role:userProfile.role,
    name:name.trim(),data_source:"internal",prompt_type:promptType,
    template_key:promptType==="template"?templateKey:null,
    custom_prompt:promptType==="custom"?customPrompt.trim():null,
    category:null,family_id:familyId||null,
    schedule_preset:schedulePreset,schedule_dow:schedulePreset==="weekly"?scheduleDow:null,schedule_hour_utc:scheduleHourUtc,
  };

  const save=async()=>{
    if(invalid)return;
    setSaving(true);
    const row=buildRow();
    const editing=modal&&modal.edit;
    const{error}=editing?await sb.from("scheduled_prompts").update(row).eq("id",editing.id):await sb.from("scheduled_prompts").insert(row);
    setSaving(false);
    if(error){toast(error.message,"error");return;}
    toast(editing?"Scheduled prompt updated":"Scheduled prompt created");
    setModal(null);load();
  };

  // Saves the prompt (creating it if it's new, or persisting any edits) and
  // immediately forces it to run right here in the form — so a client's
  // urgent request doesn't need to wait for the schedule, and there's no need
  // to save, close the modal, then hunt down the card to run it separately.
  const[runningNow,setRunningNow]=useState(false);
  const runNowFromModal=async()=>{
    if(invalid)return;
    setRunningNow(true);
    try{
      const row=buildRow();
      const editing=modal&&modal.edit;
      let id=editing?editing.id:null;
      if(editing){
        const{error}=await sb.from("scheduled_prompts").update(row).eq("id",editing.id);
        if(error)throw new Error(error.message);
      }else{
        const{data,error}=await sb.from("scheduled_prompts").insert(row).select().single();
        if(error)throw new Error(error.message);
        id=data.id;
      }
      // Runs in the background on the server (a web-search report can take
      // over a minute) — this call just kicks it off, it doesn't wait for it
      // to finish. The card will show the real success/failure once it's
      // done; reload a couple of times to pick that up without a manual refresh.
      const{error}=await sb.functions.invoke("run-scheduled-prompts",{body:{forcePromptId:id}});
      if(error)throw new Error(error.message||"Failed to start the run");
      toast("Running now — "+userProfile.email+" will get an email when it's ready");
      // setModal(null), not closeModal() — there is no closeModal in this component.
      // The old call threw a ReferenceError immediately after the toast, so the modal
      // stayed open and neither load() nor the two delayed reloads below ever ran: the
      // run really had started, but the card never showed its result. Silent because it
      // happened after the success toast, and invisible to the bundler.
      setModal(null);load();
      setTimeout(load,8000);setTimeout(load,25000);
    }catch(e){toast(e.message||"Could not run now","error");}
    finally{setRunningNow(false);}
  };

  const toggleActive=async p=>{
    const{error}=await sb.from("scheduled_prompts").update({active:!p.active}).eq("id",p.id);
    if(error)toast(error.message,"error");else{toast(p.active?"Paused":"Resumed");load();}
  };
  const del=async p=>{if(!confirm("Delete this scheduled prompt? This can't be undone."))return;
    const{error}=await sb.from("scheduled_prompts").delete().eq("id",p.id);
    if(error)toast(error.message,"error");else{toast("Deleted");load();}
  };
  // Forces this prompt to run immediately (ignoring its schedule) and emails
  // the report to the owner right away — for when a client needs something
  // looked into now rather than waiting for the next scheduled time.
  const runNow=async p=>{
    setRunningId(p.id);
    try{
      // Runs in the background on the server (a web-search report can take
      // over a minute) — this call just kicks it off, it doesn't wait for it
      // to finish. Reload a couple of times to pick up the real result
      // (shown in the "Last run" line below) without a manual refresh.
      const{error}=await sb.functions.invoke("run-scheduled-prompts",{body:{forcePromptId:p.id}});
      if(error)throw new Error(error.message||"Failed to start the run");
      toast("Running now — "+p.ownerEmail+" will get an email when it's ready");
      load();
      setTimeout(load,8000);setTimeout(load,25000);
    }catch(e){toast(e.message||"Could not run now","error");}
    finally{setRunningId(null);}
  };

  return <>
    <SectionLabel>Scheduled Prompts</SectionLabel>
    <div style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,padding:20,marginBottom:28}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:10,flexWrap:"wrap"}}>
        <div style={{fontSize:12,color:B.textSoft}}>Automatic AI digests and concierge web searches, emailed to you on a schedule you set.</div>
        <Btn small onClick={openNew}>+ New Scheduled Prompt</Btn>
      </div>
      {loading?<Spinner/>:prompts.length===0?<Empty text="No scheduled prompts yet."/>:
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {prompts.map(p=>{const fam=(families||[]).find(f=>f.id===p.familyId);return <div key={p.id} style={{border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",opacity:p.active?1:0.6}}>
          <div style={{minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{fontWeight:700,color:B.navy,fontSize:14}}>{p.name}</span>
              {p.dataSource==="web_search"
                ? <Badge scheme={{bg:"#fdf2e3",text:"#8a5c00",dot:"#d4900a"}}>🔎 {CONCIERGE_CATEGORY_MAP[p.category]?.label||"Concierge"}</Badge>
                : <Badge scheme={p.promptType==="template"?{bg:"#e8f0f8",text:B.navyMid,dot:B.navyMid}:{bg:"#f3edf7",text:"#5c2d91",dot:"#8b5cf6"}}>{p.promptType==="template"?(PROMPT_TEMPLATE_MAP[p.templateKey]?.label||"Template"):"Custom"}</Badge>}
              {fam&&<Badge scheme={{bg:B.bg,text:B.navy,dot:B.gold}}>{fam.name}</Badge>}
              {p.ownerUserId!==userProfile.id&&<Badge scheme={{bg:"#f3edf7",text:"#5c2d91",dot:"#8b5cf6"}}>{roleLabel(p.ownerRole)} · {p.ownerEmail}</Badge>}
              {!p.active&&<Badge scheme={{bg:B.borderLight,text:B.textMute,dot:B.textMute}}>Paused</Badge>}
            </div>
            <div style={{fontSize:12,color:B.textSoft,marginTop:3}}>{scheduleDesc(p)}</div>
            <div style={{fontSize:11,color:B.textMute,marginTop:2}}>
              {p.lastRunAt?`Last run ${fmt(p.lastRunAt)} · ${p.lastRunStatus==="error"?"⚠ failed":"✓ sent"}`:"Never run yet"}
              {p.lastRunStatus==="error"&&p.lastRunError?` — ${p.lastRunError}`:""}
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0,flexWrap:"wrap"}}>
            <Btn small variant="gold" onClick={()=>runNow(p)} disabled={runningId===p.id}>{runningId===p.id?"Running…":"▶ Run Now"}</Btn>
            <Btn small variant="ghost" onClick={()=>toggleActive(p)}>{p.active?"Pause":"Resume"}</Btn>
            <Btn small variant="ghost" onClick={()=>openEdit(p)}>✏ Edit</Btn>
            <Btn small variant="danger" onClick={()=>del(p)}>✕</Btn>
          </div>
        </div>;})}
      </div>}
    </div>

    {modal&&<Modal title={modal.edit?"Edit Scheduled Prompt":"New Scheduled Prompt"} onClose={()=>setModal(null)}>
      <Field label="Search Type">
        <Sel value={mode} onChange={e=>setMode(e.target.value)}>
          <option value="digest">Book of Business Digest</option>
          <option value="concierge">Concierge Search (for one client)</option>
        </Sel>
        <div style={{fontSize:11,color:B.textMute,marginTop:4}}>{mode==="concierge"?"Searches the live web for something a client asked you to look out for — real estate, boats, watches, tickets, anything.":`Reports on your own book of business (or one client) using data already in ${BRAND.short}.`}</div>
      </Field>
      <Field label="Name"><Inp placeholder={mode==="concierge"?"34' Boat Under $250k":"Monday Overdue Tasks Digest"} value={name} onChange={e=>setName(e.target.value)}/></Field>

      {mode==="concierge"
        ? <>
            <Field label="Client">
              {lockFamilyId
                ? <div style={{fontSize:14,color:B.text,padding:"9px 13px",background:B.bg,border:`1px solid ${B.border}`,borderRadius:8}}>{(families||[]).find(f=>f.id===lockFamilyId)?.name||"This family"}</div>
                : <Sel value={familyId} onChange={e=>setFamilyId(e.target.value)}>
                    <option value="">Choose a family…</option>
                    {(families||[]).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
                  </Sel>}
            </Field>
            <Field label="Category">
              <Sel value={category} onChange={e=>setCategory(e.target.value)}>
                {CONCIERGE_CATEGORIES.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}
              </Sel>
            </Field>
            <Field label="What is the client looking for?">
              <textarea value={customPrompt} onChange={e=>setCustomPrompt(e.target.value)} rows={4} placeholder="e.g. A center-console boat, 30-36 ft, under $250k, located in South Florida." style={{width:"100%",resize:"vertical",border:`1px solid ${B.border}`,borderRadius:8,padding:"11px 13px",fontSize:14,fontFamily:"inherit",color:B.text,background:B.white,outline:"none",lineHeight:1.5}}/>
            </Field>
            <div style={{background:"#fdf2e3",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#8a5c00"}}>
              Results are AI-generated from a live web search and emailed to you (not the client) for review — verify details before sharing anything with them.
            </div>
          </>
        : <>
            <Field label="Client">
              {lockFamilyId
                ? <div style={{fontSize:14,color:B.text,padding:"9px 13px",background:B.bg,border:`1px solid ${B.border}`,borderRadius:8}}>{(families||[]).find(f=>f.id===lockFamilyId)?.name||"This family"}</div>
                : <Sel value={familyId} onChange={e=>setFamilyId(e.target.value)}>
                    <option value="">All my families</option>
                    {(families||[]).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
                  </Sel>}
            </Field>
            <Field label="Type">
              <Sel value={promptType} onChange={e=>setPromptType(e.target.value)}>
                <option value="template">Built-in template</option>
                <option value="custom">Custom prompt</option>
              </Sel>
            </Field>
            {promptType==="template"
              ? <Field label="Template">
                  <Sel value={templateKey} onChange={e=>setTemplateKey(e.target.value)}>
                    {PROMPT_TEMPLATES.map(t=><option key={t.key} value={t.key}>{t.label}</option>)}
                  </Sel>
                  <div style={{fontSize:11,color:B.textMute,marginTop:4}}>{PROMPT_TEMPLATE_MAP[templateKey]?.desc}</div>
                </Field>
              : <Field label="Prompt">
                  <textarea value={customPrompt} onChange={e=>setCustomPrompt(e.target.value)} rows={4} placeholder="e.g. Summarize which of my families have overdue tasks or upcoming loan maturities this week." style={{width:"100%",resize:"vertical",border:`1px solid ${B.border}`,borderRadius:8,padding:"11px 13px",fontSize:14,fontFamily:"inherit",color:B.text,background:B.white,outline:"none",lineHeight:1.5}}/>
                </Field>}
          </>}

      <Field label="Schedule">
        <Sel value={schedulePreset} onChange={e=>setSchedulePreset(e.target.value)}>
          <option value="daily">Daily</option>
          <option value="weekdays">Weekdays (Mon–Fri)</option>
          <option value="weekly">Weekly</option>
        </Sel>
      </Field>
      {schedulePreset==="weekly"&&<Field label="Day">
        <Sel value={scheduleDow} onChange={e=>setScheduleDow(Number(e.target.value))}>
          {PROMPT_DOWS.map(d=><option key={d.v} value={d.v}>{d.l}</option>)}
        </Sel>
      </Field>}
      <Field label="Time">
        <Sel value={scheduleHourUtc} onChange={e=>setScheduleHourUtc(Number(e.target.value))}>
          {PROMPT_HOURS.map(h=><option key={h.hourUtc} value={h.hourUtc}>{h.label}</option>)}
        </Sel>
      </Field>
      <div style={{fontSize:11,color:B.textMute,marginBottom:10}}>Delivered by email to {userProfile.email}. Schedules are checked hourly, so it may arrive up to an hour after the selected time.</div>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:B.bg,border:`1px solid ${B.border}`,borderRadius:8,padding:"10px 14px",marginBottom:16,flexWrap:"wrap"}}>
        <div style={{fontSize:11.5,color:B.textSoft,flex:1,minWidth:180}}>Client needs this right away? Skip the schedule — save and run it now.</div>
        <Btn small variant="gold" onClick={runNowFromModal} disabled={runningNow||saving||invalid}>{runningNow?"Running…":"▶ Run Now"}</Btn>
      </div>

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
        <Btn onClick={save} disabled={saving||runningNow||invalid}>{saving?"Saving…":"Save"}</Btn>
      </div>
    </Modal>}
  </>;
}

function ActivityReportSection({families,toast}){
  const[familyId,setFamilyId]=useState("");
  const[kind,setKind]=useState("trailing_12");
  const[anchor,setAnchor]=useState(todayISO());
  const[from,setFrom]=useState("");
  const[to,setTo]=useState("");
  const[busy,setBusy]=useState(false);
  const[preview,setPreview]=useState(null);
  const family=(families||[]).find(f=>f.id===familyId)||null;

  // Anchor semantics differ per kind and saying so prevents the commonest
  // misreading: that "Monthly" means the last thirty days.
  const anchorHelp={
    trailing_12:"Twelve months ending on this date, inclusive.",
    month:"The whole calendar month containing this date.",
    quarter:"The whole calendar quarter containing this date.",
    year:"The whole calendar year containing this date.",
    custom:"",
  }[kind];

  const run=async(download)=>{
    if(!familyId){toast("Choose a household first","error");return;}
    if(kind==="custom"&&(!from||!to)){toast("A custom range needs both a start and an end","error");return;}
    setBusy(true);
    try{
      // The period is resolved server-side, under the caller's own permissions.
      // security invoker plus family-scoped RLS means an Expert cannot assemble a
      // report for a household outside their book even by passing another id.
      const{data,error}=await sb.rpc("client_activity_payload",{
        p_family_id:familyId,
        p_kind:kind,
        p_anchor:kind==="custom"?todayISO():anchor,
        p_from:kind==="custom"?from:null,
        p_to:kind==="custom"?to:null,
        // Calendar boundaries are a local idea: a monthly report run from Florida
        // must not place an event logged at 8pm on 31 July into August.
        p_tz:Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC",
      });
      if(error)throw new Error(error.message);
      if(!data)throw new Error("No report data came back for that household and period.");
      setPreview(data);
      if(!download){setBusy(false);return;}
      const bytes=await buildActivityReportPdf({
        payload:data,
        brandName:BRAND.name, tagline:BRAND.tagline, logoUrl:BRAND.logo,
        primaryHex:B.navy, accentHex:B.gold,
      });
      const safe=String(data.meta?.household||"household").replace(/[^A-Za-z0-9]+/g,"_").replace(/^_|_$/g,"");
      const url=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
      const a=document.createElement("a");
      a.href=url; a.download=`${safe}_Activity_Report_${(data.period?.from||"")}_to_${(data.period?.to||"")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
      toast("Report generated");
    }catch(e){
      // One codebase serves every tenant, but the reporting functions are applied
      // per project. On a tenant that has the frontend and not the schema, PostgREST
      // returns a schema-cache miss, which as a raw message ("Could not find the
      // function public.client_activity_payload...") reads like a bug in front of a
      // client. Name the actual situation instead. Deliberately not hidden behind a
      // build-time flag: gating the template upload UI that way made it unreachable
      // on PCM, a fail-closed switch with no release valve.
      const m=String(e.message||"");
      if(/Could not find the function|does not exist|schema cache/i.test(m)){
        toast("Activity reporting isn't enabled on this deployment yet — the reporting "+
              "functions haven't been applied to this firm's database.","error");
      }else{
        toast(m||"Could not build the report","error");
      }
    }
    setBusy(false);
  };

  const S=preview?.summary||{};
  // Same null-safe helper the PDF uses, imported rather than re-declared: an
  // on-screen figure and the printed one disagreeing about whether null means
  // zero is exactly the confusion this whole feature exists to avoid.
  const fig=arFig;

  return <div style={{marginTop:26,background:B.white,border:`1px solid ${B.borderLight}`,
      borderTop:`3px solid ${B.gold}`,borderRadius:12,padding:20,boxShadow:B.shadow}}>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>
      Client activity report</div>
    <div style={{fontSize:11.5,color:B.textSoft,marginTop:4,marginBottom:16,maxWidth:620}}>
      What was done for a household over a period — obligations discharged, exposures raised
      and closed, the records behind each balance, and what is still open. Generated on demand
      and reviewed before it goes to the client.
    </div>

    <div style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"flex-end"}}>
      <label style={{fontSize:11,color:B.textSoft}}>
        <div style={{marginBottom:4}}>Household</div>
        <select value={familyId} onChange={e=>{setFamilyId(e.target.value);setPreview(null);}}
          style={{...inp,minWidth:210}}>
          <option value="">Choose…</option>
          {(families||[]).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <label style={{fontSize:11,color:B.textSoft}}>
        <div style={{marginBottom:4}}>Period</div>
        <select value={kind} onChange={e=>{setKind(e.target.value);setPreview(null);}}
          style={{...inp,minWidth:160}}>
          {AR_PERIODS.map(p=><option key={p.kind} value={p.kind}>{p.label}</option>)}
        </select>
      </label>
      {kind==="custom"
        ? <>
            <label style={{fontSize:11,color:B.textSoft}}>
              <div style={{marginBottom:4}}>From</div>
              <input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPreview(null);}} style={{...inp,width:150}}/>
            </label>
            <label style={{fontSize:11,color:B.textSoft}}>
              <div style={{marginBottom:4}}>To (exclusive)</div>
              <input type="date" value={to} onChange={e=>{setTo(e.target.value);setPreview(null);}} style={{...inp,width:150}}/>
            </label>
          </>
        : <label style={{fontSize:11,color:B.textSoft}}>
            <div style={{marginBottom:4}}>Anchor date</div>
            <input type="date" value={anchor} onChange={e=>{setAnchor(e.target.value);setPreview(null);}} style={{...inp,width:150}}/>
          </label>}
      <button onClick={()=>run(false)} disabled={busy}
        style={{background:B.white,color:B.navy,border:`1px solid ${B.border}`,borderRadius:8,
          padding:"9px 16px",fontSize:12,cursor:busy?"wait":"pointer",fontFamily:"inherit"}}>
        {busy?"Working…":"Preview figures"}</button>
      <button onClick={()=>run(true)} disabled={busy}
        style={{background:B.navy,color:B.white,border:"none",borderRadius:8,
          padding:"10px 18px",fontSize:12,cursor:busy?"wait":"pointer",fontFamily:"inherit"}}>
        {busy?"Working…":"Generate PDF"}</button>
    </div>
    {anchorHelp&&<div style={{fontSize:10.5,color:B.textMute,marginTop:8}}>{anchorHelp}</div>}

    {preview&&<div style={{marginTop:18,paddingTop:16,borderTop:`1px solid ${B.borderLight}`}}>
      <div style={{fontSize:12,color:B.navy,fontWeight:600,marginBottom:2}}>
        {preview.meta?.household} · {preview.period?.label_from_db}</div>
      <div style={{fontSize:10.5,color:B.textMute,marginBottom:12}}>
        {preview.period?.from} to {preview.period?.to} (exclusive) · {preview.period?.tz}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
        {[["Workflows completed",S.obligations_closed],
          ["Exposures raised",S.exposures_raised],
          ["Exposures closed",S.exposures_closed],
          ["Open at period end",S.exposures_open],
          ["Approved by adviser",S.approvals],
          // Rendered from the same null-safe helper as the PDF. A dash here means
          // the platform cannot measure it, which is not the same as zero.
          ["Steps done by the platform",S.automated_steps],
          ["Statements reconciled",S.statements]].map(([lab,v])=>
          <div key={lab} style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:8,
              padding:"8px 12px",minWidth:118}}>
            <div style={{fontSize:19,color:B.navy,fontFamily:"'Cormorant Garamond',serif",fontWeight:600}}>{fig(v)}</div>
            <div style={{fontSize:9.5,color:B.textSoft,lineHeight:1.25}}>{lab}</div>
          </div>)}
      </div>
      {!!(preview.data_gaps||[]).length&&
        <div style={{marginTop:12,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 12px"}}>
          <div style={{fontSize:10.5,color:"#8a5c00",fontWeight:600,marginBottom:4}}>Where the record is incomplete</div>
          {preview.data_gaps.map((g,i)=>
            <div key={i} style={{fontSize:10.5,color:"#8a5c00",lineHeight:1.4}}>· {g}</div>)}
        </div>}
    </div>}
  </div>;
}

function ResourcesView({data,userProfile,toast,onDemand}){
  const isMobile=useIsMobile();
  const[familyId,setFamilyId]=useState("");
  const[activeDoc,setActiveDoc]=useState(null);
  const families=(data.families||[]).filter(isActiveFamily);
  const family=families.find(f=>f.id===familyId)||null;
  // With staff data on demand, the chosen household's contacts and accounts are loaded when it is picked.
  const[picked,setPicked]=useState(null);
  useEffect(()=>{
    if(!onDemand||!familyId){setPicked(null);return;}
    let gone=false;
    loadFamiliesTables([familyId],["contacts","portfolio_accounts"]).then(t=>{if(!gone)setPicked(t);}).catch(()=>{if(!gone)setPicked({contacts:[],portfolio_accounts:[]});});
    return()=>{gone=true;};
  },[onDemand,familyId]);
  const src=onDemand?(picked||{contacts:[],portfolio_accounts:[]}):data;
  const contacts=(src.contacts||[]).filter(c=>c.familyId===familyId);
  const primaryContact=contacts.find(c=>!c.isAdvisor)||contacts[0]||null;
  // Prefer an actual bank-type account (Checking/Savings/Money Market) for
  // sender/institution defaults — falls back to the highest-balance account
  // of any type if the family has no plain bank account on file.
  const familyAccounts=(src.portfolio_accounts||[]).filter(a=>a.familyId===familyId);
  const bankAccount=familyAccounts.find(a=>["Checking","Savings","Money Market"].includes(a.accountType))
    || [...familyAccounts].sort((a,b)=>(Number(b.currentBalance)||0)-(Number(a.currentBalance)||0))[0]
    || null;

  // Which templates this firm has on file. BRAND_DOCS is loaded once at sign-in;
  // re-read it here so a fresh upload shows up on the next visit to this tab
  // without a full reload.
  const[docs,setDocs]=useState(BRAND_DOCS.byKey);
  const[docsReady,setDocsReady]=useState(BRAND_DOCS.loaded);
  const[docsError,setDocsError]=useState(BRAND_DOCS.error);
  useEffect(()=>{
    let cancelled=false;
    // The fee must be loaded before a modal can open, since it supplies that
    // modal's initial values — a default computed from an unloaded value would
    // silently render an empty fee on a document that should carry one.
    Promise.all([loadBrandDocuments(),loadFirmDefaults()]).then(()=>{
      if(cancelled)return;
      setDocs({...BRAND_DOCS.byKey});
      setDocsReady(true);
      setDocsError(BRAND_DOCS.error);
    });
    return()=>{cancelled=true;};
  },[]);

  const missingCount=Object.values(DOC_CONFIGS).filter(d=>!docs[d.docKey]).length;
  const docsMsg=!docsReady?null
    :docsError?`Couldn't check which document templates are on file — ${docsError}`
    :missingCount>0
      ? `${missingCount} of ${Object.keys(DOC_CONFIGS).length} document templates haven't been uploaded for your firm yet. `+
        `Those tiles stay disabled: these documents carry your letterhead and, for the agreement and ACH form, name your firm as the counterparty, so the platform won't substitute anyone else's. An administrator can add them under Branding → Document templates.`
      : null;

  return <div style={{padding:isMobile?16:28,overflowY:"auto",height:"100%"}}>
    <SectionLabel>Client Documents</SectionLabel>
    <div style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,padding:20,marginBottom:28}}>
      <Field label="Select Client / Family">
        <Sel value={familyId} onChange={e=>setFamilyId(e.target.value)}>
          <option value="">Choose a family…</option>
          {families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
        </Sel>
      </Field>
      {family
        ? <>
            {docsMsg&&<div style={{fontSize:12,color:"#8a5c00",background:"#fef3e2",border:"1px solid #fcd97d",borderRadius:8,padding:"10px 12px",margin:"10px 0 0",lineHeight:1.55}}>{docsMsg}</div>}
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(min(240px,100%),1fr))",gap:14,marginTop:10}}>
            {Object.entries(DOC_CONFIGS).map(([id,d])=>{
              // A document is available only if this firm has supplied the
              // template. There is no shared default to fall back on: serving
              // another firm's agreement is what this whole change exists to
              // prevent, so an absent template disables the tile.
              const rec=docs[d.docKey];
              const short=rec?(requiredFieldsFor(id).filter(f=>!rec.fieldNames.includes(f))):[];
              const blocked=!rec||short.length>0;
              const why=!docsReady?"Checking for your firm's template…"
                :!rec?"Your firm hasn't uploaded this template yet."
                :`Template is missing ${short.length} required field${short.length>1?"s":""}.`;
              return <button key={id} disabled={blocked}
                title={blocked?why:undefined}
                onClick={()=>{ if(!blocked)setActiveDoc(id); }}
                style={{textAlign:"left",background:blocked?B.bg:B.white,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${blocked?B.border:B.gold}`,borderRadius:12,padding:18,cursor:blocked?"not-allowed":"pointer",boxShadow:blocked?"none":B.shadow,fontFamily:"inherit",display:"flex",alignItems:"center",gap:14,opacity:blocked?0.72:1}}>
                <ResIconBadge name={d.icon}/>
                <div style={{minWidth:0}}>
                  {/* No empty second line when a document has no subtitle — an
                      empty styled div still occupies space and the tile looks
                      broken rather than deliberately spare. */}
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:B.navy,fontWeight:600,marginBottom:(blocked||d.desc)?3:0}}>{d.label}</div>
                  {(blocked||d.desc)&&<div style={{fontSize:11.5,color:blocked?"#8a5c00":B.textSoft}}>{blocked?why:d.desc}</div>}
                </div>
              </button>;
            })}
            </div>
          </>
        : <Empty text="Select a family above to generate a document for them."/>}
    </div>

    <SectionLabel>Tools & Documents</SectionLabel>
    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(min(240px,100%),1fr))",gap:14}}>
      {RESOURCE_LINKS.map(r=>{
        const blocked=!docs[r.docKey];
        const why=!docsReady?"Checking for your firm's copy…":"Your firm hasn't uploaded this guide yet.";
        return <button key={r.label} disabled={blocked}
          title={blocked?why:undefined}
          onClick={async()=>{
            if(blocked)return;
            // Signed URL rather than a static /public path, so one tenant can't
            // read another's guide by guessing the filename.
            try{
              const{data,error}=await sb.storage.from("brand-documents").createSignedUrl(docs[r.docKey].storagePath,60);
              if(error||!data?.signedUrl)throw new Error(error?.message||"no signed URL returned");
              window.open(data.signedUrl,"_blank","noopener,noreferrer");
            }catch(e){ toast("Couldn't open the guide — "+(e.message||"unknown error"),"error"); }
          }}
          style={{textAlign:"left",background:blocked?B.bg:B.white,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${blocked?B.border:B.gold}`,borderRadius:12,padding:18,cursor:blocked?"not-allowed":"pointer",boxShadow:blocked?"none":B.shadow,fontFamily:"inherit",display:"flex",alignItems:"center",gap:14,opacity:blocked?0.72:1}}>
          <ResIconBadge name={r.icon}/>
          <div style={{minWidth:0}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:B.navy,fontWeight:600,marginBottom:3}}>{r.label}</div>
            <div style={{fontSize:11.5,color:blocked?"#8a5c00":B.textSoft}}>{blocked?why:r.desc}</div>
          </div>
        </button>;
      })}
    </div>

    {activeDoc&&family&&<FillClientDocModal docId={activeDoc} family={family} contact={primaryContact} userProfile={userProfile} bankAccount={bankAccount} onClose={()=>setActiveDoc(null)} toast={toast}/>}

    {/* Template administration sits here, next to the tiles it unblocks, rather
        than on the Branding screen — that screen only exists when
        VITE_BRAND_RUNTIME=1, so on a single-identity deployment the upload UI was
        unreachable and the tiles above could never be unblocked. Admins only;
        RLS enforces the same rule server-side regardless of this check. */}
    {userProfile?.role==="admin"&&<BrandDocumentsSection toast={toast}/>}

    <ActivityReportSection families={families} toast={toast}/>

    <ScheduledPromptsSection userProfile={userProfile} families={families} toast={toast}/>
    <WorkflowTemplatesSection userProfile={userProfile} toast={toast}/>
  </div>;
}
const STEP_RECIPIENTS=["","bank","grantor","beneficiaries","trustee","carrier","internal"];
// Negative offsets read as "N days before", which is how the firm talks about them.
const offsetLabel=n=>{
  const d=Number(n)||0;
  if(d<0)return `${Math.abs(d)} days before`;
  if(d>0)return `${d} days after`;
  return "on the due date";
};
const ACTOR_TINT={ai:{bg:"rgba(206,182,132,0.20)",dot:"#c9a878"},expert:{bg:"rgba(9,43,73,0.09)",dot:"#0f2a44"},external:{bg:"rgba(143,160,178,0.16)",dot:"#8fa0b2"}};

function WorkflowTemplatesSection({userProfile,toast}){
  const isAdmin=userProfile?.role==="admin";
  const[rows,setRows]=useState([]);
  const[loading,setLoading]=useState(true);
  const[openKey,setOpenKey]=useState(null);
  const[editing,setEditing]=useState(null);  // {template, steps:[…]}
  const[saving,setSaving]=useState(false);
  // WORKFLOW_FILTERS — the library outgrew a flat grid at ~20 templates.
  const[q,setQ]=useState("");
  const[cat,setCat]=useState("");
  const[trig,setTrig]=useState("");

  const load=async()=>{
    setLoading(true);
    const{data,error}=await sb.from("workflow_templates").select("*").eq("active",true).order("category").order("name");
    if(error)toast(error.message,"error");else setRows(data||[]);
    setLoading(false);
  };
  useEffect(()=>{load();},[]);

  const save=async()=>{
    if(!editing)return;
    // Steps run in date order regardless of how they were entered, so sort before
    // saving rather than trusting the order in the editor.
    const steps=[...editing.steps].sort((a,b)=>(Number(a.offset_days)||0)-(Number(b.offset_days)||0));
    if(steps.some(s=>!String(s.title||"").trim())){toast("Every step needs a title","error");return;}
    setSaving(true);
    const{error}=await sb.from("workflow_templates")
      .update({steps,updated_at:new Date().toISOString()}).eq("id",editing.template.id);
    if(error)toast(error.message,"error");
    else{toast("Playbook updated");setEditing(null);load();}
    setSaving(false);
  };

  const setStep=(i,patch)=>setEditing(e=>({...e,steps:e.steps.map((s,j)=>j===i?{...s,...patch}:s)}));
  const addStep=()=>setEditing(e=>({...e,steps:[...e.steps,
    {key:`step_${Date.now().toString(36)}`,title:"",offset_days:-30,actor:"expert",kind:"draft_email",recipient:"",note:""}]}));
  const removeStep=i=>setEditing(e=>({...e,steps:e.steps.filter((_,j)=>j!==i)}));

  // Categories with counts, so a pill can say how much is behind it.
  const cats=[...rows.reduce((m,t)=>m.set(t.category,(m.get(t.category)||0)+1),new Map())]
    .sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])));

  // Match name, description AND tags. The word someone types is rarely the word in
  // the title — "payroll" should find household staff compliance, "lapse" should
  // find every workflow where something can quietly expire.
  const needle=q.trim().toLowerCase();
  const shown=rows.filter(t=>{
    if(cat&&t.category!==cat)return false;
    if(trig&&t.trigger_kind!==trig)return false;
    if(!needle)return true;
    const tags=Array.isArray(t.tags)?t.tags.join(" "):"";
    return `${t.name} ${t.description||""} ${t.category} ${tags}`.toLowerCase().includes(needle);
  });

  if(loading)return null;

  return <div style={{marginTop:34}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:12,flexWrap:"wrap",marginBottom:6}}>
      <div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600}}>Workflow Playbooks</div>
        <div style={{fontSize:12,color:B.textSoft,marginTop:2,maxWidth:660,lineHeight:1.5}}>
          How a recurring obligation is carried to completion. Every outbound step waits for a named approval —
          nothing is sent, and no money is moved, without a person deciding.
        </div>
      </div>
      {!isAdmin&&<div style={{fontSize:11,color:B.textMute,fontStyle:"italic"}}>View only</div>}
    </div>
    <GoldLine/>

    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginTop:14}}>
      <input value={q} onChange={e=>setQ(e.target.value)}
        placeholder="Search playbooks — try payroll, lapse, trust, death"
        style={{flex:"1 1 260px",minWidth:0,padding:"8px 12px",fontSize:13,
          border:`1px solid ${B.border}`,borderRadius:8,background:B.white,color:B.navy}}/>
      <select value={trig} onChange={e=>setTrig(e.target.value)}
        style={{padding:"8px 10px",fontSize:12.5,border:`1px solid ${B.border}`,
          borderRadius:8,background:B.white,color:B.navy}}>
        <option value="">Any trigger</option>
        <option value="obligation_date">Runs from a date on file</option>
        <option value="manual">You start it</option>
      </select>
      {(q||cat||trig)&&<Btn small variant="ghost" onClick={()=>{setQ("");setCat("");setTrig("");}}>Clear</Btn>}
    </div>

    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:9}}>
      {[["",`All ${rows.length}`],...cats.map(([c,n])=>[c,`${c} ${n}`])].map(([val,lbl])=>
        <button key={val||"all"} onClick={()=>setCat(val)}
          style={{fontSize:11,padding:"4px 11px",borderRadius:20,cursor:"pointer",
            border:`1px solid ${cat===val?B.navy:B.borderLight}`,
            background:cat===val?B.navy:B.white,
            color:cat===val?B.white:B.navyMid}}>{lbl}</button>)}
    </div>

    {/* An empty result should read as an empty result, not a broken screen. */}
    <div style={{fontSize:11.5,color:B.textMute,marginTop:9}}>
      {shown.length===rows.length
        ? `${rows.length} playbooks`
        : `${shown.length} of ${rows.length} playbooks`}
      {shown.length===0&&" — nothing matches. Try a broader word, or clear the filters."}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(320px,100%),1fr))",gap:14,marginTop:14}}>
      {shown.map(t=>{
        const steps=Array.isArray(t.steps)?t.steps:[];
        const earliest=steps.reduce((m,s)=>Math.min(m,Number(s.offset_days)||0),0);
        const conditional=steps.filter(s=>s.requires).length;
        const approvals=steps.filter(s=>s.actor==="expert").length;
        const isOpen=openKey===t.key;
        return <div key={t.id} style={{background:B.white,border:`1px solid ${isOpen?B.gold:B.borderLight}`,borderTop:`3px solid ${B.navy}`,borderRadius:12,padding:"16px 18px",boxShadow:B.shadow,gridColumn:isOpen?"1 / -1":"auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:19,color:B.navy,fontWeight:600,lineHeight:1.2}}>{t.name}</div>
              <div style={{fontSize:11,color:B.textMute,marginTop:2,letterSpacing:"0.06em",textTransform:"uppercase"}}>{t.category}</div>
            </div>
            {t.is_starter&&<Badge scheme={{bg:"rgba(206,182,132,0.22)",text:"#7a5a19",dot:B.gold}}>Included</Badge>}
          </div>

          {t.description&&<div style={{fontSize:12,color:B.textSoft,marginTop:8,lineHeight:1.55}}>{t.description}</div>}

          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:11,marginBottom:11}}>
            {[[`${steps.length} steps`,null],[`starts ${Math.abs(earliest)}d ahead`,null],
              [`${approvals} approvals`,null],...(conditional?[[`${conditional} conditional`,null]]:[])]
              .map(([lbl])=><span key={lbl} style={{fontSize:10.5,color:B.navyMid,background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:20,padding:"3px 9px"}}>{lbl}</span>)}
          </div>

          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            <Btn small variant="ghost" onClick={()=>setOpenKey(isOpen?null:t.key)}>{isOpen?"Hide steps":"View steps"}</Btn>
            {isAdmin&&<Btn small onClick={()=>{setOpenKey(t.key);setEditing({template:t,steps:steps.map(s=>({...s}))});}}>Edit</Btn>}
          </div>

          {isOpen&&<div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${B.borderLight}`}}>
            {steps.map((s,i)=>{
              const tint=ACTOR_TINT[s.actor]||ACTOR_TINT.external;
              return <div key={s.key||i} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"9px 0",borderBottom:i<steps.length-1?`1px solid ${B.borderLight}`:"none"}}>
                <div style={{minWidth:104,textAlign:"right",fontSize:11,fontWeight:700,color:B.navy,paddingTop:2}}>{offsetLabel(s.offset_days)}</div>
                <div style={{width:10,height:10,borderRadius:"50%",background:tint.dot,marginTop:5,flexShrink:0}}/>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:13,color:B.text,fontWeight:600}}>
                    {s.title}
                    {s.requires&&<span style={{marginLeft:7,fontSize:10,color:"#7a5a19",background:"rgba(206,182,132,0.22)",border:`1px solid ${B.gold}`,borderRadius:20,padding:"1px 7px"}}>only if {String(s.requires).replace(/_/g," ")}</span>}
                  </div>
                  <div style={{fontSize:11,color:B.textSoft,marginTop:2}}>
                    <span style={{background:tint.bg,borderRadius:4,padding:"1px 6px"}}>{actorLabel(s.actor)}</span>
                    {" · "}{kindLabel(s.kind)}
                    {s.recipient?` · to ${s.recipient}`:""}
                    {s.opens_window_days?` · opens a ${s.opens_window_days}-day window`:""}
                  </div>
                  {s.note&&<div style={{fontSize:11,color:B.textMute,marginTop:3,lineHeight:1.5}}>{s.note}</div>}
                </div>
              </div>;
            })}
            {!steps.length&&<Empty text="This playbook has no steps yet."/>}
          </div>}
        </div>;
      })}
    </div>

    {editing&&<Modal wide title={`Edit — ${editing.template.name}`} onClose={()=>setEditing(null)}>
      <div style={{fontSize:11.5,color:B.textSoft,marginBottom:14,lineHeight:1.55}}>
        Timing is measured from the obligation's due date. Steps are saved in date order.
        Changing a lead time changes when real client money is requested, so review carefully.
      </div>
      {editing.steps.map((s,i)=><div key={s.key||i} style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderLeft:`3px solid ${(ACTOR_TINT[s.actor]||ACTOR_TINT.external).dot}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
        <Field label={`Step ${i+1} — title`}><Inp value={s.title||""} onChange={e=>setStep(i,{title:e.target.value})} placeholder="Prepare transfer request for the bank"/></Field>
        <Grid2>
          <Field label="Days from due date (negative = before)">
            <Inp type="number" value={s.offset_days??0} onChange={e=>setStep(i,{offset_days:parseInt(e.target.value,10)||0})}/>
          </Field>
          <Field label="Who acts">
            <Sel value={s.actor||"expert"} onChange={e=>setStep(i,{actor:e.target.value})}>
              {STEP_ACTORS.map(a=><option key={a.v} value={a.v}>{a.label}</option>)}
            </Sel>
          </Field>
          <Field label="What happens">
            <Sel value={s.kind||"draft_email"} onChange={e=>setStep(i,{kind:e.target.value})}>
              {STEP_KINDS.map(a=><option key={a.v} value={a.v}>{a.label}</option>)}
            </Sel>
          </Field>
          <Field label="Recipient">
            <Sel value={s.recipient||""} onChange={e=>setStep(i,{recipient:e.target.value})}>
              {STEP_RECIPIENTS.map(r=><option key={r||"none"} value={r}>{r||"— none —"}</option>)}
            </Sel>
          </Field>
          <Field label="Only if this flag is set (optional)">
            <Inp value={s.requires||""} onChange={e=>setStep(i,{requires:e.target.value||undefined})} placeholder="crummey_required"/>
          </Field>
          <Field label="Opens a waiting window (days)">
            <Inp type="number" value={s.opens_window_days??""} onChange={e=>setStep(i,{opens_window_days:e.target.value?parseInt(e.target.value,10):undefined})} placeholder="30"/>
          </Field>
        </Grid2>
        <Field label="Guidance shown to the reviewer">
          <textarea value={s.note||""} onChange={e=>setStep(i,{note:e.target.value})} rows={2}
            style={{...inp,resize:"vertical",fontFamily:"inherit"}}/>
        </Field>
        <div style={{textAlign:"right"}}>
          <Btn small variant="danger" onClick={()=>removeStep(i)}>Remove step</Btn>
        </div>
      </div>)}
      <div style={{display:"flex",gap:10,justifyContent:"space-between",marginTop:6,flexWrap:"wrap"}}>
        <Btn small variant="ghost" onClick={addStep}>+ Add step</Btn>
        <div style={{display:"flex",gap:10}}>
          <Btn variant="ghost" onClick={()=>setEditing(null)} disabled={saving}>Cancel</Btn>
          <Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save playbook"}</Btn>
        </div>
      </div>
    </Modal>}
  </div>;
}

// ── NAV ───────────────────────────────────────────────────────────────────────
// ── BRANDING (white-label profile manager) ───────────────────────────────────
// Admin-only. Lets one deployment be re-skinned for whichever prospect is being
// pitched, keeping every brand saved so concurrent sales cycles can be switched
// back and forth without a rebuild.
const BRAND_COLOR_FIELDS=[
  {key:"color_primary",     label:"Primary"},
  {key:"color_primary_mid", label:"Primary (mid)"},
  {key:"color_accent",      label:"Accent"},
  {key:"color_accent_light",label:"Accent (light)"},
  {key:"color_bg",          label:"Page background"},
  {key:"color_border",      label:"Border"},
  {key:"color_border_light",label:"Border (light)"},
  {key:"color_text_soft",   label:"Text (soft)"},
  {key:"color_text_mute",   label:"Text (muted)"},
];
// Holds a half-finished brand form outside the component. Building a brand means
// fetching a logo and hex codes from elsewhere, so the user routinely leaves this
// screen mid-edit; keeping the draft here means the work survives the view being
// unmounted and remounted. Module-level (not persisted) so it clears on reload.
const _brandDraft={current:null};
const BLANK_BRAND={
  label:"",brand_name:"",brand_short:"",tagline:"",contact_email:"",email_domain:"",
  logo_url:"",mark_url:"",notes:"",
  color_primary:"#0f2a44",color_primary_mid:"#35507f",color_accent:"#c9a878",
  color_accent_light:"#dfc99a",color_bg:"#f8f8f6",color_border:"#d8d3c8",
  color_border_light:"#ecebe6",color_text_soft:"#5a6e84",color_text_mute:"#8fa0b2",
};

function ColorField({label,value,onChange}){
  const v=/^#[0-9a-fA-F]{6}$/.test(value||"")?value:"#000000";
  return <div style={{marginBottom:10}}>
    <label style={{display:"block",fontSize:10,color:B.textSoft,marginBottom:4,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase"}}>{label}</label>
    <div style={{display:"flex",gap:6,alignItems:"center"}}>
      <input type="color" value={v} onChange={e=>onChange(e.target.value)}
        style={{width:36,height:34,padding:0,border:`1px solid ${B.border}`,borderRadius:6,background:B.white,cursor:"pointer",flexShrink:0}}/>
      <input value={value||""} onChange={e=>onChange(e.target.value)} placeholder="#000000"
        style={{...inp,fontFamily:"ui-monospace,monospace",fontSize:12,padding:"7px 10px"}}/>
    </div>
  </div>;
}

// The seven templates a firm supplies, derived from DOC_CONFIGS so this list and
// the Resources tab can never disagree about what exists or what a template needs.
const BRAND_DOC_KEYS=[
  ...Object.entries(DOC_CONFIGS).map(([id,d])=>({
    key:d.docKey,label:d.label,required:requiredFieldsFor(id),
    // The two documents whose body text names a legal entity, rather than merely
    // carrying a letterhead. Called out in the UI because getting these wrong is
    // a contractual problem, not a cosmetic one.
    legal:id==="agreement"||id==="ach",
  })),
  {key:"user_guide",label:"ORDANIS Expert User Guide",required:[],legal:false},
];

// Per-tenant document templates. Attached either to one brand profile or to the
// project as a whole, for a deployment that brands itself through build-time env
// vars and has no brand profiles at all (PCM production).
// The firm's standard fees, editable.
//
// These were added to brand_profiles and read at runtime, with no way to set them
// short of SQL — the same dead end as putting the template upload screen behind a
// flag PCM production does not set. A value that only lives in the database and
// cannot be changed from the product is not configurable, it is just hidden.
//
// Writes to the active brand profile, because that is the row the fee is read
// from. A deployment with no brand row at all has nowhere to store this, and says
// so rather than silently discarding the input.
function FirmFeeDefaults({toast}){
  const isMobile=useIsMobile();
  const[row,setRow]=useState(null);          // {id, monthly, onboarding}
  const[loading,setLoading]=useState(true);
  const[saving,setSaving]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const{data,error}=await sb.from("brand_profiles")
        .select("id, brand_name, default_monthly_fee, default_onboarding_fee")
        .eq("is_active",true).maybeSingle();
      if(error)throw error;
      setRow(data?{id:data.id,name:data.brand_name,
        monthly:data.default_monthly_fee==null?"":String(data.default_monthly_fee),
        onboarding:data.default_onboarding_fee==null?"":String(data.default_onboarding_fee)}:null);
    }catch(_e){ setRow(null); }
    finally{ setLoading(false); }
  },[]);
  useEffect(()=>{load();},[load]);

  // Blank means "no standard fee" and is stored as NULL, not zero. Zero would
  // print 0.00 onto an agreement, which is a stated price of nothing rather than
  // an unanswered question.
  const parse=v=>{
    const s=String(v==null?"":v).replace(/[^0-9.]/g,"").trim();
    if(!s)return null;
    const n=Number(s);
    return Number.isFinite(n)&&n>=0&&n<10000000?n:undefined;   // undefined = invalid
  };

  const save=async()=>{
    if(!row)return;
    const m=parse(row.monthly), o=parse(row.onboarding);
    if(m===undefined||o===undefined){toast("Enter a plain amount, or leave blank for none","error");return;}
    setSaving(true);
    try{
      const{error}=await sb.from("brand_profiles")
        .update({default_monthly_fee:m,default_onboarding_fee:o,updated_at:new Date().toISOString()})
        .eq("id",row.id);
      if(error)throw new Error(error.message);
      // Refresh the in-memory copy so a modal opened straight after this picks up
      // the new figure rather than the one loaded at page load.
      await loadFirmDefaults();
      await load();
      toast("Standard fees saved");
    }catch(e){ toast(e.message||"Couldn't save","error"); }
    finally{ setSaving(false); }
  };

  if(loading)return null;

  return <div style={{marginBottom:30}}>
    <SectionLabel>Standard Fees</SectionLabel>
    <div style={{fontSize:13,color:B.textSoft,maxWidth:760,lineHeight:1.55,marginBottom:12}}>
      Pre-fills the Client Services Agreement and the Auto-Debit form. A ORDANIS Expert can change either figure
      on a particular client before generating. Leave blank for no standard fee and the field starts empty —
      the annual figure on the agreement is always twelve times the monthly one, and the onboarding fee is
      itemised separately rather than folded into it.
    </div>
    {!row
      ? <div style={{fontSize:12,color:"#8a5c00",background:"#fef3e2",border:"1px solid #fcd97d",borderRadius:8,padding:"10px 12px",maxWidth:760,lineHeight:1.5}}>
          No active brand profile on this deployment, so there is nowhere to store a firm-wide fee. The fields on
          each document still work; they just start empty.
        </div>
      : <div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,boxShadow:B.shadow,padding:16,maxWidth:620}}>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14}}>
            <Field label="Monthly advisory fee">
              <input value={row.monthly} placeholder="e.g. 5000"
                onChange={e=>setRow(r=>({...r,monthly:e.target.value}))} style={inp}/>
            </Field>
            <Field label="Onboarding fee (one-time)">
              <input value={row.onboarding} placeholder="e.g. 7500"
                onChange={e=>setRow(r=>({...r,onboarding:e.target.value}))} style={inp}/>
            </Field>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,marginTop:4,flexWrap:"wrap"}}>
            <Btn small variant="gold" onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</Btn>
            <div style={{fontSize:11.5,color:B.textMute}}>
              {row.monthly?`Agreement will show ${feePlain(Number(row.monthly))} monthly · ${feeAnnualPlain(Number(row.monthly))} annually`:"Monthly fee blank — agreement fee fields start empty"}
            </div>
          </div>
          <div style={{fontSize:11,color:B.textMute,marginTop:10,lineHeight:1.5}}>
            Applies to {row.name}. The onboarding fee prints only on an agreement template that carries an
            onboarding_fee field; on an older template it is recorded here and left off the document.
          </div>
        </div>}
  </div>;
}

// `brands` is optional. This section has to work on a deployment that does not
// use runtime brand switching at all — PCM production sets no VITE_BRAND_RUNTIME,
// so the Branding screen never renders there. Managing document templates is
// document administration, not brand switching, and gating it behind that flag
// left the Resources tiles permanently blocked with no way to unblock them. So it
// loads its own brand list when none is handed in.
function BrandDocumentsSection({brands:brandsProp,toast}){
  const isMobile=useIsMobile();
  const[scope,setScope]=useState("");           // "" = project default
  const[rows,setRows]=useState([]);
  const[brands,setBrands]=useState(brandsProp||[]);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState("");

  useEffect(()=>{
    if(brandsProp){setBrands(brandsProp);return;}
    let cancelled=false;
    (async()=>{
      // Absent or unreadable brand_profiles is normal, not an error: the scope
      // selector simply offers "Project default" only, which is the right answer
      // for a single-identity deployment.
      const{data}=await sb.from("brand_profiles").select("id,label,is_active").order("label");
      if(!cancelled)setBrands(data||[]);
    })();
    return()=>{cancelled=true;};
  },[brandsProp]);

  const load=useCallback(async()=>{
    setLoading(true);
    const{data,error}=await sb.from("brand_documents").select("*");
    if(error)toast("Couldn't load document templates — "+error.message,"error");
    setRows(data||[]);
    setLoading(false);
  },[toast]);
  useEffect(()=>{load();},[load]);

  const forScope=rows.filter(r=>scope?r.brand_profile_id===scope:r.brand_profile_id===null);
  const find=key=>forScope.find(r=>r.doc_key===key);

  const upload=async(file,spec)=>{
    if(!file)return;
    if(file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)){
      toast("Templates must be PDFs","error");return;
    }
    if(file.size>15*1024*1024){toast("PDF must be under 15 MB","error");return;}
    setBusy(spec.key);
    try{
      const bytes=new Uint8Array(await file.arrayBuffer());

      // Read the form fields before storing anything. fillPdfTemplate writes by
      // field name, so a template whose fields are named differently produces a
      // blank document. Recording what's missing here means the Resources tile
      // stays disabled with a specific reason instead of failing at generate time.
      let present=[];
      try{ present=await readPdfFieldNames(bytes); }
      catch(e){ throw new Error("Couldn't read this PDF's form fields — "+(e.message||"it may not be a valid PDF")); }
      const missing=spec.required.filter(f=>!present.includes(f));

      const path=`${scope||"project-default"}/${spec.key}.pdf`;
      const{error:upErr}=await sb.storage.from("brand-documents")
        .upload(path,file,{upsert:true,contentType:"application/pdf"});
      if(upErr)throw new Error(upErr.message);

      const{data:me}=await sb.auth.getUser();
      const payload={
        brand_profile_id:scope||null,doc_key:spec.key,storage_path:path,
        original_filename:file.name,byte_size:file.size,
        field_names:present,missing_fields:missing,
        uploaded_by:me?.user?.id||null,uploaded_at:new Date().toISOString(),
      };
      const existing=find(spec.key);
      const{error:dbErr}=existing
        ? await sb.from("brand_documents").update(payload).eq("id",existing.id)
        : await sb.from("brand_documents").insert(payload);
      if(dbErr)throw new Error(dbErr.message);

      await load();
      if(missing.length)
        toast(`Stored, but this template is missing ${missing.length} required field${missing.length>1?"s":""}: ${missing.join(", ")}. The tile stays disabled until they're present.`,"error");
      else toast("Template uploaded");
    }catch(e){toast(e.message||"Upload failed","error");}
    finally{setBusy("");}
  };

  const remove=async spec=>{
    const row=find(spec.key);
    if(!row)return;
    if(!window.confirm(`Remove the ${spec.label} template? The tile will be disabled until a replacement is uploaded.`))return;
    setBusy(spec.key);
    try{
      await sb.storage.from("brand-documents").remove([row.storage_path]);
      const{error}=await sb.from("brand_documents").delete().eq("id",row.id);
      if(error)throw new Error(error.message);
      await load();
      toast("Template removed");
    }catch(e){toast(e.message||"Couldn't remove","error");}
    finally{setBusy("");}
  };

  return <div style={{marginTop:34}}>
    <FirmFeeDefaults toast={toast}/>
    <SectionLabel>Document Templates</SectionLabel>
    <div style={{fontSize:13,color:B.textSoft,maxWidth:760,lineHeight:1.55,marginBottom:8}}>
      The fillable documents on the Resources tab are the firm's own paperwork, so each firm supplies its own.
      Nothing is shared between brands and there is no default: a document with no template here is disabled
      on the Resources tab rather than falling back to another firm's.
    </div>
    <div style={{fontSize:12,color:"#8a5c00",background:"#fef3e2",border:"1px solid #fcd97d",borderRadius:8,padding:"10px 12px",marginBottom:14,lineHeight:1.55,maxWidth:760}}>
      The Client Services Agreement and ACH Authorization name a legal entity in their body text, not just on the
      letterhead — the agreement defines the contracting party and the ACH form authorizes debits to a named bank.
      Upload the firm's own lawyer-reviewed versions; don't re-letterhead someone else's.
    </div>

    <div style={{maxWidth:420,marginBottom:16}}>
      <Field label="Templates for">
        <Sel value={scope} onChange={e=>setScope(e.target.value)}>
          <option value="">Project default — every brand without its own</option>
          {brands.map(b=><option key={b.id} value={b.id}>{b.label}{b.is_active?" (live)":""}</option>)}
        </Sel>
      </Field>
    </div>

    {loading?<Spinner/>:<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(min(330px,100%),1fr))",gap:14}}>
      {BRAND_DOC_KEYS.map(spec=>{
        const row=find(spec.key);
        // Recomputed from the field names found at upload rather than read back
        // from missing_fields, so this agrees with the Resources tile even if the
        // required-field list changes after a template was stored. The stored
        // column is a record of what was true at upload time, not the authority.
        const missing=row?spec.required.filter(f=>!(row.field_names||[]).includes(f)):[];
        const ok=row&&missing.length===0;
        return <div key={spec.key} style={{background:B.white,border:`1px solid ${ok?B.borderLight:B.border}`,borderTop:`3px solid ${ok?"#18a850":(row?"#c9a227":B.border)}`,borderRadius:12,padding:"14px 16px",boxShadow:B.shadow}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:B.navy,fontWeight:600,lineHeight:1.25}}>{spec.label}</div>
            {spec.legal&&<Badge scheme={{bg:"#fdecec",text:"#8B1A1A",dot:"#8B1A1A"}}>Legal</Badge>}
          </div>
          <div style={{fontSize:11.5,color:ok?"#0d5c2b":(row?"#8a5c00":B.textMute),marginBottom:8,lineHeight:1.45}}>
            {!row?"Not uploaded — tile disabled on Resources."
              :missing.length?`Missing ${missing.length} required field${missing.length>1?"s":""}: ${missing.join(", ")}`
              :`Ready · ${row.original_filename||"template.pdf"}`}
          </div>
          {row&&<div style={{fontSize:10.5,color:B.textMute,marginBottom:10}}>
            {spec.required.length?`${spec.required.length} field${spec.required.length>1?"s":""} filled by the platform`:"Reference document — no form fields"}
          </div>}
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <label style={{fontSize:11.5,color:B.navy,cursor:busy?"wait":"pointer",border:`1px solid ${B.border}`,borderRadius:7,padding:"6px 10px",background:B.bg}}>
              {busy===spec.key?"Working…":(row?"Replace":"Upload PDF")}
              <input type="file" accept="application/pdf" disabled={!!busy} style={{display:"none"}}
                onChange={e=>{const f=e.target.files?.[0];e.target.value="";upload(f,spec);}}/>
            </label>
            {row&&<Btn small variant="danger" onClick={()=>remove(spec)} disabled={!!busy}>Remove</Btn>}
          </div>
        </div>;
      })}
    </div>}
  </div>;
}

function BrandingView({toast}){
  const[rows,setRows]=useState([]);
  const[loading,setLoading]=useState(true);
  // Restores an in-progress form if the user left this screen to go look
  // something up (see _brandDraft).
  const[modal,setModal]=useState(()=>_brandDraft.current);
  const[saving,setSaving]=useState(false);
  const[busyId,setBusyId]=useState(null);
  const[uploading,setUploading]=useState("");
  const[restored,setRestored]=useState(!!_brandDraft.current);

  // Mirror the open form into the module-level draft on every keystroke, so
  // navigating away (or anything that remounts this view) doesn't lose it.
  useEffect(()=>{_brandDraft.current=modal;},[modal]);

  const load=async()=>{
    setLoading(true);
    const{data,error}=await sb.from("brand_profiles").select("*").order("label");
    if(error)toast(error.message,"error");else setRows(data||[]);
    setLoading(false);
  };
  useEffect(()=>{load();},[]);

  // Discards the form and its saved draft together.
  const closeModal=()=>{setModal(null);_brandDraft.current=null;setRestored(false);};

  // A switch changes colours captured in module-level style objects, so the only
  // way to guarantee every corner of the UI (and the print/export templates)
  // picks up the new palette is a clean reload.
  const activate=async row=>{
    setBusyId(row.id);
    try{
      const{error}=await sb.rpc("activate_brand_profile",{target:row.id});
      if(error)throw new Error(error.message);
      window.location.reload();
    }catch(e){toast(e.message||"Could not switch brand","error");setBusyId(null);}
  };

  const save=async()=>{
    const r=modal.row;
    if(!r.label.trim()||!r.brand_name.trim()){toast("Profile name and brand name are required","error");return;}
    setSaving(true);
    try{
      const payload={...r};delete payload.id;delete payload.is_active;delete payload.created_at;
      payload.updated_at=new Date().toISOString();
      if(modal.isNew){
        const{error}=await sb.from("brand_profiles").insert(payload);
        if(error)throw new Error(error.message);
      }else{
        const{error}=await sb.from("brand_profiles").update(payload).eq("id",r.id);
        if(error)throw new Error(error.message);
      }
      // Editing the brand that's currently live? Reload so the change is visible.
      if(!modal.isNew&&r.is_active){window.location.reload();return;}
      toast(modal.isNew?"Brand profile created":"Brand profile saved");
      closeModal();load();
    }catch(e){toast(e.message||"Could not save","error");}
    finally{setSaving(false);}
  };

  const remove=async row=>{
    if(row.is_active){toast("Switch to another brand before deleting this one","error");return;}
    if(!window.confirm(`Delete the "${row.label}" brand profile?`))return;
    const{error}=await sb.from("brand_profiles").delete().eq("id",row.id);
    if(error)toast(error.message,"error");else{toast("Brand profile deleted");load();}
  };

  const duplicate=row=>{
    const copy={...row,label:`${row.label} (copy)`};
    delete copy.id;delete copy.created_at;copy.is_active=false;
    setModal({row:copy,isNew:true});
  };

  const uploadAsset=async(file,field)=>{
    if(!file)return;
    if(!/^image\//.test(file.type)){toast("Please choose an image file","error");return;}
    if(file.size>4*1024*1024){toast("Image must be under 4 MB","error");return;}
    setUploading(field);
    try{
      const ext=(file.name.split(".").pop()||"png").toLowerCase();
      const path=`${Date.now()}-${field}.${ext}`;
      const{error}=await sb.storage.from("brand").upload(path,file,{upsert:true,contentType:file.type});
      if(error)throw new Error(error.message);
      const{data}=sb.storage.from("brand").getPublicUrl(path);
      setModal(m=>({...m,row:{...m.row,[field]:data.publicUrl}}));
      toast("Image uploaded");
    }catch(e){toast(e.message||"Upload failed","error");}
    finally{setUploading("");}
  };

  const set=(k,v)=>setModal(m=>({...m,row:{...m.row,[k]:v}}));

  if(loading)return <div style={{padding:40}}><Spinner/></div>;

  return <div style={{height:"100%",overflowY:"auto"}}><div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:18}}>
      <div>
        <div style={{fontSize:13,color:B.textSoft,maxWidth:620,lineHeight:1.5}}>
          Save a brand for each firm you're pitching and switch the whole platform over in one click —
          logo, name, colors, and exported reports. Nothing here touches client data.
        </div>
      </div>
      <Btn onClick={()=>setModal({row:{...BLANK_BRAND},isNew:true})}>+ New Brand</Btn>
    </div>

    {rows.length===0&&<Empty text="No brand profiles yet. Create one to get started."/>}

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(320px,100%),1fr))",gap:14}}>
      {rows.map(r=><div key={r.id} style={{background:B.white,border:`1px solid ${r.is_active?B.gold:B.borderLight}`,borderTop:`3px solid ${r.color_primary}`,borderRadius:12,padding:"16px 18px",boxShadow:B.shadow}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
          <div style={{minWidth:0}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600,lineHeight:1.2}}>{r.label}</div>
            <div style={{fontSize:12,color:B.textSoft,marginTop:2}}>{r.brand_name}</div>
          </div>
          {r.is_active&&<Badge scheme={{bg:"#e0f5e9",text:"#0d5c2b",dot:"#18a850"}}>Live</Badge>}
        </div>

        {r.logo_url&&<div style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:8,padding:"10px 12px",marginBottom:10,textAlign:"center"}}>
          <img src={r.logo_url} alt={r.brand_name} style={{maxHeight:38,maxWidth:"100%",width:"auto",display:"inline-block"}}/>
        </div>}

        <div style={{display:"flex",gap:5,marginBottom:12}}>
          {["color_primary","color_primary_mid","color_accent","color_accent_light","color_bg"].map(k=>
            <div key={k} title={r[k]} style={{width:26,height:26,borderRadius:6,background:r[k],border:`1px solid ${B.borderLight}`}}/>)}
        </div>

        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {!r.is_active&&<Btn small variant="gold" onClick={()=>activate(r)} disabled={busyId===r.id}>{busyId===r.id?"Switching…":"Make Live"}</Btn>}
          <Btn small variant="ghost" onClick={()=>setModal({row:{...r},isNew:false})}>Edit</Btn>
          <Btn small variant="ghost" onClick={()=>duplicate(r)}>Duplicate</Btn>
          {!r.is_active&&<Btn small variant="danger" onClick={()=>remove(r)}>Delete</Btn>}
        </div>
      </div>)}
    </div>

    {/* Document templates are administered from the Resources tab, so they stay
        reachable on deployments that never render this screen. Not duplicated
        here: one home for it, or the two copies drift. */}

    {modal&&<Modal wide title={modal.isNew?"New Brand Profile":`Edit — ${modal.row.label}`} onClose={closeModal}>
      {restored&&<div style={{fontSize:11.5,color:B.navy,background:"rgba(206,182,132,0.16)",border:`1px solid ${B.gold}`,borderRadius:8,padding:"8px 12px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
        <span>Picked up where you left off — your unsaved changes are still here.</span>
        <button onClick={()=>setRestored(false)} style={{background:"none",border:"none",color:B.textSoft,cursor:"pointer",fontSize:14,lineHeight:1}}>✕</button>
      </div>}
      <SectionLabel>Identity</SectionLabel>
      <Grid2>
        <Field label="Profile Name (internal)"><Inp value={modal.row.label||""} onChange={e=>set("label",e.target.value)} placeholder="Accurate Advisory Group"/></Field>
        <Field label="Brand Name (shown in app)"><Inp value={modal.row.brand_name||""} onChange={e=>set("brand_name",e.target.value)} placeholder="Accurate Advisory Group"/></Field>
        <Field label="Short Name"><Inp value={modal.row.brand_short||""} onChange={e=>set("brand_short",e.target.value)} placeholder="Accurate"/></Field>
        <Field label="Tagline"><Inp value={modal.row.tagline||""} onChange={e=>set("tagline",e.target.value)} placeholder="GUIDANCE FOR A LIFETIME"/></Field>
        <Field label="Contact Email"><Inp value={modal.row.contact_email||""} onChange={e=>set("contact_email",e.target.value)} placeholder="info@firm.com"/></Field>
        <Field label="Email Domain"><Inp value={modal.row.email_domain||""} onChange={e=>set("email_domain",e.target.value)} placeholder="firm.com"/></Field>
      </Grid2>

      <SectionLabel>Logo</SectionLabel>
      <Grid2>
        {[{f:"logo_url",l:"Full Logo (sidebar & login)"},{f:"mark_url",l:"Icon / Mark (optional)"}].map(({f,l})=>
          <Field key={f} label={l}>
            {modal.row[f]&&<div style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:8,padding:10,marginBottom:8,textAlign:"center"}}>
              <img src={modal.row[f]} alt="" style={{maxHeight:44,maxWidth:"100%",width:"auto"}}/>
            </div>}
            <input type="file" accept="image/*" onChange={e=>uploadAsset(e.target.files?.[0],f)} disabled={!!uploading}
              style={{fontSize:12,marginBottom:6,width:"100%",color:B.textSoft}}/>
            {uploading===f&&<div style={{fontSize:11,color:B.textSoft,marginBottom:4}}>Uploading…</div>}
            <Inp value={modal.row[f]||""} onChange={e=>set(f,e.target.value)} placeholder="…or paste an image URL"
              style={{fontSize:12}}/>
          </Field>)}
      </Grid2>
      <div style={{fontSize:11,color:B.textMute,marginTop:-4,marginBottom:4,lineHeight:1.5}}>
        Use a logo that reads on a light background — transparent PNG works best. Leave the mark blank to reuse the full logo.
      </div>

      <SectionLabel>Colors</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(190px,100%),1fr))",gap:"0 14px"}}>
        {BRAND_COLOR_FIELDS.map(({key,label})=>
          <ColorField key={key} label={label} value={modal.row[key]} onChange={v=>set(key,v)}/>)}
      </div>

      <SectionLabel>Notes</SectionLabel>
      <Field label="Internal Notes (optional)">
        <textarea value={modal.row.notes||""} onChange={e=>set("notes",e.target.value)} rows={2}
          placeholder="Pitch date, contacts, anything worth remembering"
          style={{...inp,resize:"vertical",fontFamily:"inherit"}}/>
      </Field>

      {!modal.isNew&&modal.row.is_active&&<div style={{fontSize:11.5,color:B.textSoft,background:B.bg,border:`1px solid ${B.border}`,borderRadius:8,padding:"9px 12px",marginBottom:14}}>
        This brand is currently live — saving will reload the page to apply your changes.
      </div>}

      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:8}}>
        <Btn variant="ghost" onClick={closeModal} disabled={saving}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving?"Saving…":modal.isNew?"Create":"Save"}</Btn>
      </div>
    </Modal>}
  </div></div>;
}

// ── STATE RULE REVIEW ────────────────────────────────────────────────────────
// The admin screen for the part of state-rule maintenance that needs judgement.
//
// The agent proposes; nothing here is fact until a person approves it. The queue
// arrives already triaged by state_review_queue() — priority 1 needs a person,
// priority 3 is routine — so the reviewer is not sorting a flat list in their head.
//
// Rejecting deliberately leaves the rule UNVERIFIED rather than stale: a failed
// check is not a verification, and pretending otherwise is how a reference table
// starts quietly asserting wrong figures with citations attached.
function StateRulesView({userProfile,toast}){
  const[summary,setSummary]=useState(null);
  const[queue,setQueue]=useState([]);
  const[loading,setLoading]=useState(true);
  const[busyId,setBusyId]=useState(null);
  const[note,setNote]=useState({});

  const load=useCallback(async()=>{
    setLoading(true);
    const[{data:s,error:se},{data:q,error:qe}]=await Promise.all([
      sb.rpc("state_review_summary"),
      sb.rpc("state_review_queue"),
    ]);
    if(se||qe)toast((se||qe).message,"error");
    setSummary(s?.[0]||null);
    setQueue(q||[]);
    setLoading(false);
  },[toast]);
  useEffect(()=>{load();},[load]);

  const decide=async(id,approve)=>{
    setBusyId(id);
    const{data,error}=await sb.rpc(approve?"approve_state_rule_proposal":"reject_state_rule_proposal",{
      p_proposal_id:id,p_reviewer:userProfile?.email||"unknown",p_note:note[id]||null,
    });
    setBusyId(null);
    if(error)toast(error.message,"error"); else toast(data||"Saved");
    load();
  };

  const clearRoutine=async()=>{
    if(!window.confirm("Approve every unchanged, high-confidence proposal?\n\nEach one stamps a verification date on its rule. Spot-check a few first — that is the step that makes the data trustworthy."))return;
    setBusyId("bulk");
    const{data,error}=await sb.rpc("approve_routine_state_proposals",{p_reviewer:userProfile?.email||"unknown",p_note:null});
    setBusyId(null);
    if(error)toast(error.message,"error");
    else toast(`Cleared ${data?.[0]?.approved||0}. ${data?.[0]?.skipped||0} still need a person.`);
    load();
  };

  const bandFor=(p)=>p===1?{bg:"#fdf0ee",bd:"#b3261e",label:"Needs a person"}
                 :p===2?{bg:"rgba(206,182,132,0.12)",bd:B.gold,label:"Confirm the change"}
                       :{bg:B.bg,bd:B.border,label:"Routine"};

  if(loading)return <Spinner/>;

  // The admin content area doesn't scroll by itself (overflow hidden); each view scrolls its own content.
  return <div style={{height:"100%",overflowY:"auto"}}><div style={{maxWidth:980,padding:"24px 28px"}}>
    <h2 style={{fontSize:22,fontWeight:700,color:B.navy,margin:"0 0 4px",letterSpacing:"-0.01em"}}>State Rule Review</h2>
    <p style={{fontSize:13,color:B.textSoft,margin:"0 0 16px",maxWidth:680,lineHeight:1.6}}>
      The agent checks each published fact against its source and proposes what it found.
      Nothing is treated as verified until you approve it — and rejecting leaves the rule
      unverified rather than stale.
    </p>
    <GoldLine/>

    {summary&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:18}}>
      {[["Waiting",summary.pending],["Need a decision",summary.needs_judgement],
        ["Routine",summary.routine],["Never verified",summary.rules_unverified]].map(([l,n])=>
        <div key={l} style={{background:B.bgCard,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"14px 16px",boxShadow:B.shadow}}>
          <div style={{fontSize:24,fontWeight:700,color:B.navy,lineHeight:1.1}}>{n}</div>
          <div style={{fontSize:11,color:B.textMute,marginTop:2}}>{l}</div>
        </div>)}
    </div>}

    {summary?.routine>0&&<div style={{display:"flex",alignItems:"center",gap:14,marginBottom:18}}>
      <Btn variant="ghost" small disabled={busyId==="bulk"} onClick={clearRoutine}>
        {busyId==="bulk"?"Clearing…":`Clear ${summary.routine} routine`}
      </Btn>
      <span style={{fontSize:12,color:B.textMute}}>Unchanged and high confidence. Spot-check a few before clearing the rest.</span>
    </div>}

    {queue.length===0
      ?<div style={{background:B.bgCard,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"28px 20px",textAlign:"center",boxShadow:B.shadow}}>
         <div style={{fontSize:15,fontWeight:700,color:B.navy}}>Nothing waiting</div>
         <Empty text="The queue is clear. The agent runs annually, or whenever you trigger it."/>
       </div>
      :queue.map(p=>{
        const b=bandFor(p.priority);
        return <div key={p.id} style={{background:b.bg,border:`1px solid ${B.borderLight}`,borderLeft:`3px solid ${b.bd}`,borderRadius:10,padding:"16px 18px",marginBottom:12,boxShadow:B.shadow}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div style={{fontSize:15,fontWeight:700,color:B.navy}}>
              {p.state_code} · {String(p.topic||"").replace(/_/g," ")}
              {p.applies_to?<span style={{color:B.textMute,fontWeight:400}}> · {p.applies_to}</span>:null}
            </div>
            <Badge scheme={p.priority===1?{bg:"#fde8e8",text:"#8b1a1a",dot:"#b3261e"}
                          :p.priority===2?{bg:"rgba(206,182,132,0.3)",text:B.navy,dot:B.gold}
                                         :{bg:B.borderLight,text:B.navyMid,dot:B.navyMid}}>{b.label}</Badge>
          </div>

          <div style={{fontSize:12.5,color:B.textMid,marginTop:6,lineHeight:1.55}}>{p.attention}</div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:12}}>
            <div><div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:B.textMute}}>On record</div>
              <div style={{fontSize:13,color:B.text,fontWeight:600}}>{p.current_value||"—"}</div></div>
            <div><div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:B.gold}}>Agent proposes</div>
              <div style={{fontSize:13,color:B.text,fontWeight:600}}>{p.proposed_value||(p.finding==="unchanged"?"no change":"—")}</div></div>
          </div>

          {p.evidence&&<div style={{fontSize:12.5,fontStyle:"italic",color:B.textSoft,marginTop:10,lineHeight:1.55}}>“{p.evidence}”</div>}

          {p.source_url&&<div style={{marginTop:8}}>
            <a href={p.source_url} target="_blank" rel="noreferrer" style={{fontSize:12,color:B.navyMid,fontWeight:600}}>Open the source the agent read →</a>
          </div>}

          <input type="text" placeholder="Note (optional) — what you checked, or why you are rejecting"
            value={note[p.id]||""} onChange={e=>setNote({...note,[p.id]:e.target.value})}
            style={{width:"100%",boxSizing:"border-box",marginTop:12,padding:"9px 12px",fontSize:13,
                    fontFamily:"inherit",color:B.text,border:`1px solid ${B.border}`,borderRadius:8,background:B.white}}/>

          <div style={{display:"flex",gap:10,marginTop:12,alignItems:"center",flexWrap:"wrap"}}>
            <Btn variant="gold" small disabled={busyId===p.id} onClick={()=>decide(p.id,true)}>
              {busyId===p.id?"Saving…":"Approve & verify"}
            </Btn>
            <Btn variant="ghost" small disabled={busyId===p.id} onClick={()=>decide(p.id,false)}>Reject</Btn>
            <span style={{fontSize:11.5,color:B.textMute}}>Rejecting leaves the rule unverified — the honest outcome of a failed check.</span>
          </div>
        </div>;
      })}
  </div></div>;
}

// ── FIRM BILLING (Phase 8b) ────────────────────────────────────────────────
// Who pays for a household, and the firm's monthly invoice. The amounts are computed in the database
// (enterprise_invoice_preview) and the invoice is built by the enterprise-invoice function; nothing
// here can alter a figure, it can only ask for a preview, a draft, a finalize or a void.
async function callEnterpriseInvoice(body){
  const{data,error}=await sb.functions.invoke("enterprise-invoice",{body});
  if(error){
    let msg=error.message;
    try{const b=await error.context.json();if(b&&b.error)msg=b.error;}catch(_e){}
    throw new Error(msg);
  }
  if(data&&data.error)throw new Error(data.error);
  return data;
}
const money2=n=>{const v=Number(n)||0;return (v<0?"-":"")+"$"+Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});};
const monthStartISO=offset=>{const d=new Date();return new Date(Date.UTC(d.getFullYear(),d.getMonth()+offset,1)).toISOString().slice(0,10);};
const monthLabelOf=iso=>new Date(iso+"T00:00:00Z").toLocaleString("en-US",{month:"long",year:"numeric",timeZone:"UTC"});
const INVOICE_STATUS_TINT={draft:{bg:"#eef0f4",text:"#5b6573",label:"Draft"},open:{bg:"rgba(206,182,129,0.22)",text:"#7a5a19",label:"Sent, unpaid"},paid:{bg:"#e0f5e9",text:"#0d5c2b",label:"Paid"},void:{bg:"#fde8e8",text:"#8b1a1a",label:"Voided"}};

// How the client gave their agreement to be moved into a firm. A fixed list, not free text, so the
// log reads the same every time. The log also records who recorded it and when.
const AGREEMENT_METHODS=["Verbal - Phone","Verbal - In person","Written"];
const agreementSelect=(value,onChange)=><select value={value} onChange={e=>onChange(e.target.value)}
  style={{width:"100%",maxWidth:360,boxSizing:"border-box",marginTop:8,padding:"8px 10px",border:`1px solid ${B.border}`,borderRadius:8,fontSize:13,fontFamily:"inherit",color:B.text,background:B.white}}>
  <option value="">How did the client agree?</option>
  {AGREEMENT_METHODS.map(m=><option key={m} value={m}>{m}</option>)}
</select>;

// What an ORDANIS admin sees on a household: its firm, the log of how it got there, and the only
// ways to move it in or out. The move records that the client agreed; the server refuses without it.
function FirmMembershipCard({familyRow,toast,reload}){
  const[firms,setFirms]=useState([]);
  const[events,setEvents]=useState([]);
  const[target,setTarget]=useState("");
  const[agreed,setAgreed]=useState(false);
  const[note,setNote]=useState("");
  const[removeNote,setRemoveNote]=useState("");
  const[confirmRemove,setConfirmRemove]=useState(false);
  const[busy,setBusy]=useState(false);
  const firmId=familyRow.enterprise_id||null;
  const firmPaid=familyRow.paidBy==="enterprise";
  const load=async()=>{
    const[f,e]=await Promise.all([
      sb.from("enterprises").select("id,name,active").order("name"),
      sb.from("enterprise_membership_events").select("id,event_type,how,created_at,consent_note,from_enterprise_id,to_enterprise_id,actor_role")
        .eq("family_id",familyRow.id).order("created_at",{ascending:false}).limit(6),
    ]);
    if(!f.error&&f.data)setFirms(f.data);
    if(!e.error&&e.data)setEvents(e.data);
  };
  useEffect(()=>{load();},[familyRow.id,firmId]);
  const nameOf=id=>(firms.find(f=>f.id===id)||{}).name||"a firm";
  const options=firms.filter(f=>f.active&&f.id!==firmId);
  const canMove=!!target&&agreed&&AGREEMENT_METHODS.includes(note)&&!busy&&!firmPaid;
  const move=async()=>{
    setBusy(true);
    try{
      const r=await callFirmJoin({action:"admin_move",family_id:familyRow.id,enterprise_id:target,client_agreed:true,note:note.trim()});
      toast((r.status==="moved"?"Moved to ":"Added to ")+(r.firm_name||"the firm"));
      setTarget("");setAgreed(false);setNote("");
      await load();if(reload)await reload("families");
    }catch(e){toast(e.message,"error");}
    setBusy(false);
  };
  const remove=async()=>{
    setBusy(true);
    try{
      await callFirmJoin({action:"admin_remove",family_id:familyRow.id,note:removeNote.trim()});
      toast("Removed from the firm");
      setConfirmRemove(false);setRemoveNote("");
      await load();if(reload)await reload("families");
    }catch(e){toast(e.message,"error");}
    setBusy(false);
  };
  const EVENT_TEXT={joined:"Joined",moved:"Moved",removed:"Removed"};
  return <CollapseBox id="adminFirm"
    box={{background:B.white,borderRadius:12,padding:"14px 20px",border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,marginBottom:12}}
    head={<div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Firm</div>}
    badge={<span style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",borderRadius:20,padding:"3px 10px",background:firmId?"rgba(206,182,129,0.22)":"#eceff3",color:firmId?"#7a5a19":"#5b6573"}}>
        {firmId?nameOf(firmId):"Not in a firm"}
      </span>}
    summary={!firmId&&<div style={{fontSize:12,color:B.textSoft}}>Open this to add the household to a firm.</div>}>
    <div style={{fontSize:12,color:B.textSoft,lineHeight:1.55,marginBottom:12}}>
      {firmId
        ? "The firm's administrators can view what the household owner can see, view only."
        : "A household joins a firm by entering the firm's code, or here, once the client has agreed."}
      {firmPaid&&" This household's plan is paid by its firm, so it cannot be moved or removed until it pays for itself again."}
    </div>

    {!firmPaid&&<div style={{borderTop:`1px solid ${B.borderLight}`,paddingTop:12}}>
      <div style={{fontSize:12,fontWeight:700,color:B.navy,marginBottom:8}}>{firmId?"Move to another firm":"Move into a firm"}</div>
      <select value={target} onChange={e=>setTarget(e.target.value)} style={{width:"100%",maxWidth:360,padding:"8px 10px",border:`1px solid ${B.border}`,borderRadius:8,fontSize:13,fontFamily:"inherit",color:B.text,background:B.white}}>
        <option value="">Choose a firm…</option>
        {options.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {target&&<div style={{marginTop:10}}>
        <label style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:12.5,color:B.text,cursor:"pointer"}}>
          <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{marginTop:2}}/>
          The client has agreed to share this household's summary information with {nameOf(target)}.
        </label>
        {agreementSelect(note,setNote)}
        <div style={{marginTop:8}}><Btn small onClick={move} disabled={!canMove}>{busy?"Saving…":(firmId?"Move household":"Add to firm")}</Btn></div>
      </div>}
    </div>}

    {firmId&&!firmPaid&&<div style={{borderTop:`1px solid ${B.borderLight}`,paddingTop:12,marginTop:12}}>
      {!confirmRemove
        ? <Btn small variant="danger" onClick={()=>setConfirmRemove(true)}>Remove from {nameOf(firmId)}</Btn>
        : <div>
            <div style={{fontSize:12.5,color:B.text,marginBottom:8}}>Remove this household from {nameOf(firmId)}? The firm loses access right away. The household keeps its plan and its data.</div>
            <input value={removeNote} onChange={e=>setRemoveNote(e.target.value)} maxLength={300} placeholder="Reason (optional, recorded in the log)"
              style={{width:"100%",maxWidth:520,boxSizing:"border-box",padding:"8px 10px",border:`1px solid ${B.border}`,borderRadius:8,fontSize:12.5,fontFamily:"inherit",color:B.text}}/>
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <Btn small variant="danger" onClick={remove} disabled={busy}>{busy?"Removing…":"Yes, remove"}</Btn>
              <Btn small variant="ghost" onClick={()=>{setConfirmRemove(false);setRemoveNote("");}} disabled={busy}>Cancel</Btn>
            </div>
          </div>}
    </div>}

    {events.length>0&&<div style={{borderTop:`1px solid ${B.borderLight}`,paddingTop:12,marginTop:12}}>
      <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Firm history</div>
      {events.map(ev=><div key={ev.id} style={{fontSize:12,color:B.textSoft,padding:"4px 0",lineHeight:1.5}}>
        <strong style={{color:B.text}}>{EVENT_TEXT[ev.event_type]||ev.event_type}</strong>
        {ev.event_type==="removed"?` from ${nameOf(ev.from_enterprise_id)}`:` ${ev.event_type==="moved"?`from ${nameOf(ev.from_enterprise_id)} to `:"into "}${nameOf(ev.to_enterprise_id)}`}
        {" · "}{dateOnly(ev.created_at)}{ev.how&&JOINED_VIA_TEXT[ev.how]?` · ${JOINED_VIA_TEXT[ev.how]}`:""}
        {ev.consent_note?<div style={{color:B.textMute,fontSize:11.5}}>{ev.consent_note}</div>:null}
      </div>)}
    </div>}
  </CollapseBox>;
}

function PayerCard({familyRow,userProfile,toast,reload}){
  const isAdmin=userProfile?.role==="admin";
  const[firmName,setFirmName]=useState("");
  const[payer,setPayer]=useState(familyRow.paidBy||"family");
  const[note,setNote]=useState(familyRow.paid_by_note||"");
  const[code,setCode]=useState(familyRow.discount_code||"");
  const[pct,setPct]=useState(String(Number(familyRow.discount_percent)||0));
  const[cap,setCap]=useState(familyRow.monthly_spend_cap==null?"":String(familyRow.monthly_spend_cap));
  const[saving,setSaving]=useState(false);
  useEffect(()=>{
    setPayer(familyRow.paidBy||"family");setNote(familyRow.paid_by_note||"");setCode(familyRow.discount_code||"");
    setPct(String(Number(familyRow.discount_percent)||0));setCap(familyRow.monthly_spend_cap==null?"":String(familyRow.monthly_spend_cap));
  },[familyRow.paidBy,familyRow.paid_by_note,familyRow.discount_code,familyRow.discount_percent,familyRow.monthly_spend_cap]);
  useEffect(()=>{
    let stopped=false;
    const q=isAdmin
      ? sb.from("enterprises").select("name").eq("id",familyRow.enterprise_id).maybeSingle().then(({data})=>data&&data.name)
      : sb.rpc("family_payer_info",{p_family_id:familyRow.id}).then(({data})=>data&&data[0]&&data[0].firm_name);
    q.then(n=>{if(!stopped&&n)setFirmName(n);});
    return()=>{stopped=true;};
  },[familyRow.enterprise_id,familyRow.id,isAdmin]);
  const firmPaid=familyRow.paidBy==="enterprise";
  const label=firmName||"the firm";
  // Premier includes unlimited workflows, so there are no extra-workflow charges to limit (Will, 2026-10-30: the
  // limit showed red on Premier households).
  const unlimited=normalisePlan(familyRow.plan)==="premier";
  const save=async()=>{
    const p=Number(pct)||0;
    if(payer==="enterprise"&&!(p>=0&&p<=100)){toast("The discount must be between 0 and 100 percent","error");return;}
    // A code with 0% used to be dropped without a word (the code is only a label for the percent on the firm's invoice).
    if(payer==="enterprise"&&code.trim()&&!(p>0)){toast(`Enter the percent off for ${code.trim().toUpperCase()}, or clear the code`,"error");return;}
    if(!unlimited&&cap!==""&&!(Number(cap)>=0)){toast("The monthly limit must be a number","error");return;}
    setSaving(true);
    const firm=payer==="enterprise";
    const{error}=await sb.from("families").update({
      paid_by:payer,
      paid_by_note:firm?(note.trim()||null):null,
      discount_code:firm&&p>0?(code.trim().toUpperCase()||null):null,
      discount_percent:firm?p:0,
      monthly_spend_cap:cap===""?null:Number(cap),
    }).eq("id",familyRow.id);
    setSaving(false);
    if(error){
      toast(/cancel_subscription_first/.test(error.message)
        ?"This household still has its own live Stripe subscription. Cancel it in Stripe first, then switch who pays, or they would be billed twice."
        :error.message,"error");
      return;
    }
    toast("Saved");
    if(reload)await reload("families");
  };
  const dirty=payer!==(familyRow.paidBy||"family")||note!==(familyRow.paid_by_note||"")||code!==(familyRow.discount_code||"")
    ||(Number(pct)||0)!==(Number(familyRow.discount_percent)||0)||(cap===""?null:Number(cap))!==(familyRow.monthly_spend_cap==null?null:Number(familyRow.monthly_spend_cap));
  return <CollapseBox id="payerCard"
    box={{background:B.white,borderRadius:12,padding:"14px 20px",border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,marginBottom:12}}
    head={<div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Who pays</div>}
    badge={<span style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",borderRadius:20,padding:"3px 10px",
        background:firmPaid?"rgba(206,182,129,0.22)":"#eceff3",color:firmPaid?"#7a5a19":"#5b6573"}}>
        {firmPaid?`Paid by ${label}`:"Paid by the household"}
      </span>}>
    <div style={{fontSize:12,color:B.textSoft,lineHeight:1.55,marginBottom:isAdmin?14:0}}>
      {firmPaid
        ? `${label} is invoiced monthly for this household's plan and any extra workflows. No card is charged here.`
        : `This household belongs to ${label}, but pays its own plan on its own card.`}
      {!isAdmin&&" Only an ORDANIS admin can change this."}
    </div>
    {isAdmin&&<>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[["family","The household pays (own card)"],["enterprise",`${firmName||"The firm"} pays (monthly invoice)`]].map(([v,l])=>{
          const on=payer===v;
          return <button key={v} type="button" onClick={()=>setPayer(v)} style={{flex:"1 1 200px",textAlign:"left",padding:"10px 12px",borderRadius:8,cursor:"pointer",border:`1px solid ${on?B.gold:B.border}`,background:on?B.bg:B.white,borderLeft:`3px solid ${on?B.gold:"transparent"}`,fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,color:B.navy}}>{l}</button>;
        })}
      </div>
      {payer==="enterprise"&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(180px,100%),1fr))",gap:12}}>
        <Field label="Discount code"><Inp placeholder="e.g. FOUNDERS" value={code} onChange={e=>setCode(e.target.value)}/></Field>
        <Field label="Percent off plan fee"><Inp type="number" min="0" max="100" step="0.5" value={pct} onChange={e=>setPct(e.target.value)}/></Field>
      </div>}
      {unlimited
        ? <div style={{fontSize:12,color:B.textSoft,lineHeight:1.5,marginBottom:12}}>Premier includes unlimited workflows, so no monthly limit is needed.</div>
        : <Field label="Monthly limit for extra workflows ($)">
        <Inp type="number" min="0" step="1" placeholder="Plan default" value={cap} onChange={e=>setCap(e.target.value)}/>
        {payer==="enterprise"&&<div style={{fontSize:11,color:cap===""?"#8b1a1a":B.textMute,marginTop:4,lineHeight:1.45}}>
          {cap===""?"Required for this household to add extra workflows while a firm pays. Until it is set, they cannot.":"The most extra-workflow charges this household can add to the firm's invoice each month."}
        </div>}
      </Field>}
      {payer==="enterprise"&&<Field label="Note (kept with the change history)"><Inp placeholder="e.g. Covered under the Accurate Advisory agreement" value={note} onChange={e=>setNote(e.target.value)}/></Field>}
      {payer==="enterprise"&&Number(pct)>0&&<div style={{fontSize:11.5,color:B.textSoft,marginBottom:12,lineHeight:1.5}}>The discount applies to the plan fee only. Extra workflows stay at list price.</div>}
      <div style={{display:"flex",justifyContent:"flex-end"}}><Btn small disabled={saving||!dirty} onClick={save}>{saving?"Saving…":dirty?"Save":"✓ Saved"}</Btn></div>
    </>}
  </CollapseBox>;
}

// ── Household utilization (admin) ─────────────────────────────────────────────────
// What each household uses and doesn't, so its ORDANIS Expert can raise it with the family.
// Data: family_utilization() (admin + MFA only). "Use" = records added, changed or completed, or a
// sign-in; simply viewing isn't recorded. Two signals per feature: ever used, and used in the last 30 days.
function UtilizationView({toast}){
  const[rows,setRows]=useState(null);
  const[q,setQ]=useState("");
  const[plan,setPlan]=useState("");
  const[expert,setExpert]=useState("");
  const[open,setOpen]=useState(null);
  useEffect(()=>{
    sb.rpc("family_utilization",{p_family_id:null}).then(({data,error})=>{
      if(error){toast(error.message,"error");setRows([]);return;}
      setRows(data||[]);
    });
  },[]);
  if(rows===null)return <Spinner/>;
  const byFam=new Map();
  rows.forEach(r=>{if(!byFam.has(r.family_id))byFam.set(r.family_id,[]);byFam.get(r.family_id).push(r);});
  const fams=[...byFam.values()].map(fr=>{
    const inc=fr.filter(r=>r.included&&r.feature!=="assistant");
    const ever=inc.filter(r=>r.ever_used).length, active=inc.filter(r=>r.used_30d===true).length;
    return {id:fr[0].family_id,name:fr[0].family_name,plan:fr[0].plan,expert:fr[0].expert_name||"",rows:fr,inc:inc.length,ever,active,
      never:inc.filter(r=>!r.ever_used).map(r=>r.label),quiet:inc.filter(r=>r.ever_used&&r.used_30d===false).map(r=>r.label),
      share:inc.length?active/inc.length:0};
  }).sort((a,b)=>a.share-b.share||a.name.localeCompare(b.name));
  const experts=[...new Set(fams.map(f=>f.expert).filter(Boolean))].sort();
  const shown=fams.filter(f=>(!plan||f.plan===plan)&&(!expert||f.expert===expert)&&(!q.trim()||f.name.toLowerCase().includes(q.trim().toLowerCase())));
  const card={background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:14,boxShadow:B.shadow,marginBottom:12,overflow:"hidden"};
  const chip=(t,tone)=><span key={t} style={{display:"inline-block",fontSize:11,padding:"2px 8px",borderRadius:999,margin:"2px 4px 2px 0",
    background:tone==="never"?"#FBEAEA":tone==="quiet"?"#FFF5DF":"#EAF5EE",color:tone==="never"?"#9B2C2C":tone==="quiet"?"#8A5A00":"#1E6B3A"}}>{t}</span>;
  const meter=(n,d)=><div style={{display:"flex",alignItems:"center",gap:8}}>
    <div style={{width:70,height:6,borderRadius:3,background:B.borderLight,overflow:"hidden"}}><div style={{width:`${d?Math.round(n/d*100):0}%`,height:"100%",background:B.gold}}/></div>
    <span style={{fontSize:12,color:B.textSoft,whiteSpace:"nowrap"}}>{n} of {d}</span></div>;
  const day=t=>t?new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"—";
  const planLbl=p=>p?p.charAt(0).toUpperCase()+p.slice(1):"—";
  return <div style={{height:"100%",overflowY:"auto"}}><div style={{maxWidth:1040,padding:"24px 28px"}}>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,color:B.navy,fontWeight:600,marginBottom:4}}>Utilization</div>
    <p style={{fontSize:13,color:B.textSoft,margin:"0 0 16px",maxWidth:760,lineHeight:1.6}}>
      What each household uses and doesn't, so its ORDANIS Expert can raise it with the family. Least used first.
      For each feature its plan includes: <b>ever used</b>, and <b>used in the last 30 days</b>. "Use" means adding, changing or
      completing something, or signing in; simply viewing a page isn't recorded.
    </p>
    <GoldLine/>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
      <div style={{flex:"2 1 240px"}}><Field label="Search households"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Household name…" style={inp}/></Field></div>
      <div style={{flex:"1 1 150px"}}><Field label="Plan"><Sel value={plan} onChange={e=>setPlan(e.target.value)}><option value="">All plans</option><option value="basic">Basic</option><option value="core">Core</option><option value="premier">Premier</option></Sel></Field></div>
      <div style={{flex:"1 1 200px"}}><Field label="ORDANIS Expert"><Sel value={expert} onChange={e=>setExpert(e.target.value)}><option value="">All Experts</option>{experts.map(x=><option key={x} value={x}>{x}</option>)}</Sel></Field></div>
    </div>
    {!shown.length&&<Empty text="No households match."/>}
    {shown.map(f=><div key={f.id} style={card}>
      <button onClick={()=>setOpen(open===f.id?null:f.id)} aria-expanded={open===f.id} style={{all:"unset",cursor:"pointer",display:"grid",gridTemplateColumns:"minmax(160px,1.4fr) 80px minmax(110px,1fr) 130px 130px",gap:12,alignItems:"center",padding:"14px 20px",width:"100%",boxSizing:"border-box"}}>
        <div><div style={{fontWeight:600,color:B.navy,fontSize:14}}>{f.name}</div>
          {f.never.length>0&&<div style={{marginTop:4}}>{f.never.slice(0,4).map(t=>chip(t,"never"))}{f.never.length>4&&<span style={{fontSize:11,color:B.textMute}}>+{f.never.length-4} more</span>}</div>}</div>
        <div style={{fontSize:12,color:B.textSoft}}>{planLbl(f.plan)}</div>
        <div style={{fontSize:12,color:B.textSoft}}>{f.expert||"—"}</div>
        <div><div style={{fontSize:10,color:B.textMute,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:3}}>Ever used</div>{meter(f.ever,f.inc)}</div>
        <div><div style={{fontSize:10,color:B.textMute,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:3}}>Last 30 days</div>{meter(f.active,f.inc)}</div>
      </button>
      {open===f.id&&<div style={{borderTop:`1px solid ${B.borderLight}`,padding:"12px 20px 16px",overflowX:"auto"}}>
        {(f.never.length>0||f.quiet.length>0)&&<div style={{fontSize:13,color:B.text,marginBottom:10,lineHeight:1.6}}>
          {f.never.length>0&&<div><b>Never used (in their plan):</b> {f.never.map(t=>chip(t,"never"))}</div>}
          {f.quiet.length>0&&<div><b>Used before, quiet for 30+ days:</b> {f.quiet.map(t=>chip(t,"quiet"))}</div>}
        </div>}
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:560}}>
          <thead><tr style={{textAlign:"left",color:B.textMute,fontSize:11,textTransform:"uppercase",letterSpacing:"0.06em"}}>
            <th style={{padding:"6px 8px"}}>Feature</th><th style={{padding:"6px 8px"}}>In plan</th><th style={{padding:"6px 8px"}}>Ever used</th><th style={{padding:"6px 8px"}}>Last 30 days</th><th style={{padding:"6px 8px"}}>Items</th><th style={{padding:"6px 8px"}}>Last activity</th></tr></thead>
          <tbody>{f.rows.map(r=><tr key={r.feature} style={{borderTop:`1px solid ${B.borderLight}`,opacity:r.included?1:0.5}}>
            <td style={{padding:"6px 8px"}}>{r.label}</td>
            <td style={{padding:"6px 8px"}}>{r.included?"Yes":"No"}</td>
            <td style={{padding:"6px 8px"}}>{r.ever_used?"✓":"—"}</td>
            <td style={{padding:"6px 8px"}}>{r.used_30d===null?"Not tracked":r.used_30d?"✓":"—"}</td>
            <td style={{padding:"6px 8px"}}>{r.item_count}</td>
            <td style={{padding:"6px 8px"}}>{r.feature==="assistant"?"—":day(r.last_activity)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </div>)}
  </div></div>;
}

function FirmBillingView({toast}){
  const[firms,setFirms]=useState(null);
  const[firmId,setFirmId]=useState("");
  const[period,setPeriod]=useState(monthStartISO(1));
  const[pv,setPv]=useState(null);
  const[pvErr,setPvErr]=useState("");
  const[invoices,setInvoices]=useState([]);
  const[billing,setBilling]=useState(null);
  const[email,setEmail]=useState("");
  const[terms,setTerms]=useState("30");
  const[busy,setBusy]=useState("");
  const[confirm,setConfirm]=useState(null);
  useEffect(()=>{
    sb.from("enterprises").select("id,name").order("name").then(({data,error})=>{
      if(error){toast(error.message,"error");setFirms([]);return;}
      setFirms(data||[]);
      if(data&&data.length===1)setFirmId(data[0].id);
    });
  },[]);
  const loadFirm=useCallback(async()=>{
    if(!firmId){setPv(null);setInvoices([]);setBilling(null);return;}
    setPvErr("");
    const[b,i]=await Promise.all([
      sb.from("enterprise_billing").select("stripe_customer_id,billing_email,payment_terms_days").eq("enterprise_id",firmId).maybeSingle(),
      sb.from("enterprise_invoices").select("id,period_month,status,total,subtotal,discount_total,line_count,created_at,stripe_invoice_id").eq("enterprise_id",firmId).order("period_month",{ascending:false}).order("created_at",{ascending:false}),
    ]);
    setBilling(b.data||null);
    if(b.data){setEmail(b.data.billing_email||"");setTerms(String(b.data.payment_terms_days||30));}
    setInvoices(i.data||[]);
    try{setPv(await callEnterpriseInvoice({action:"preview",enterprise_id:firmId,period}));}
    catch(e){setPv(null);setPvErr(e.message);}
  },[firmId,period]);
  useEffect(()=>{loadFirm();},[loadFirm]);
  const run=async(key,body,okMsg)=>{
    setBusy(key);
    try{const r=await callEnterpriseInvoice(body);toast(typeof okMsg==="function"?okMsg(r):okMsg);await loadFirm();return r;}
    catch(e){toast(e.message,"error");}
    finally{setBusy("");}
  };
  const setupBilling=()=>run("setup",{action:"ensure_customer",enterprise_id:firmId,billing_email:email.trim(),payment_terms_days:Number(terms)||30},r=>r.created?"Invoicing set up for this firm":"Saved");
  const createDraft=()=>run("draft",{action:"create_draft",enterprise_id:firmId,period},r=>`Draft created for ${money2(r.total)}. Review it, then finalize to send it.`);
  const doConfirm=async()=>{
    const c=confirm;setConfirm(null);
    if(c.kind==="finalize")await run("fin"+c.inv.id,{action:"finalize",invoice_id:c.inv.id},r=>r.emailed===false?"Finalized, but the email could not be sent. Send it from Stripe.":"Finalized and sent to the firm");
    else await run("void"+c.inv.id,{action:"void",invoice_id:c.inv.id},"Invoice voided");
  };
  const lines=(pv&&pv.lines)||[];
  const byFamily=[];
  lines.forEach(l=>{let g=byFamily.find(x=>x.id===l.family_id);if(!g){g={id:l.family_id,name:l.family_name,rows:[]};byFamily.push(g);}g.rows.push(l);});
  const blocked=!!(pv&&pv.blocking&&pv.blocking.length);
  const canDraft=pv&&pv.billing_ready&&!blocked&&lines.length>0&&pv.total>0&&!pv.existing_invoice;
  const card={background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:14,padding:"20px 24px",marginBottom:16,boxShadow:B.shadow};
  const lab={fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10};
  if(firms===null)return <Spinner/>;
  return <div style={{height:"100%",overflowY:"auto"}}><div style={{maxWidth:860,padding:"24px 28px"}}>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,color:B.navy,fontWeight:600,marginBottom:4}}>Firm billing</div>
    <p style={{fontSize:13,color:B.textSoft,margin:"0 0 16px",maxWidth:680,lineHeight:1.6}}>
      Each firm that pays for its households gets one invoice a month, billed in advance, with a line per household.
      An invoice is built here as a draft. Nothing reaches the firm until you finalize it.
    </p>
    <GoldLine/>
    {!firms.length&&<Empty text="No firms yet."/>}
    {firms.length>0&&<div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
      <div style={{flex:"1 1 260px"}}><Field label="Firm"><Sel value={firmId} onChange={e=>setFirmId(e.target.value)}><option value="">Choose a firm…</option>{firms.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Sel></Field></div>
      <div style={{flex:"1 1 200px"}}><Field label="Invoice month"><Sel value={period} onChange={e=>setPeriod(e.target.value)}>
        <option value={monthStartISO(0)}>{monthLabelOf(monthStartISO(0))} (this month)</option>
        <option value={monthStartISO(1)}>{monthLabelOf(monthStartISO(1))} (next month)</option>
      </Sel></Field></div>
    </div>}

    {firmId&&<>
      <div style={card}>
        <div style={lab}>Billing details</div>
        {billing&&billing.stripe_customer_id&&<div style={{fontSize:12,color:B.textSoft,marginBottom:10}}>Set up in Stripe. Customer <span style={{fontFamily:"monospace"}}>{billing.stripe_customer_id}</span></div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(220px,100%),1fr))",gap:12}}>
          <Field label="Billing email (invoices are sent here)"><Inp type="email" autoComplete="off" placeholder="accounts@firm.com" value={email} onChange={e=>setEmail(e.target.value)}/></Field>
          <Field label="Payment terms (days)"><Inp type="number" min="1" max="90" value={terms} onChange={e=>setTerms(e.target.value)}/></Field>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <Btn small disabled={busy==="setup"||!email.trim()} onClick={setupBilling}>{busy==="setup"?"Saving…":billing&&billing.stripe_customer_id?"Save changes":"Set up invoicing"}</Btn>
        </div>
      </div>

      <div style={card}>
        <div style={lab}>Preview, {monthLabelOf(period)}</div>
        {pvErr&&<div style={{background:"#fde8e8",border:"1px solid #f5c6c6",color:"#8b1a1a",borderRadius:10,padding:"10px 14px",fontSize:13}}>{pvErr}</div>}
        {pv&&<>
          {pv.blocking.map((b,i)=><div key={i} style={{background:"#fde8e8",border:"1px solid #f5c6c6",color:"#8b1a1a",borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:13,lineHeight:1.5}}>{b.description}</div>)}
          {pv.warnings.map((w,i)=><div key={i} style={{background:"#fef3e2",border:"1px solid #fcd97d",color:"#8a5c00",borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:13,lineHeight:1.5}}>{w.description}</div>)}
          {pv.existing_invoice&&<div style={{background:"#e8f0f8",border:"1px solid #c7dcef",color:"#1d3a5c",borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:13,lineHeight:1.5}}>There is already a {INVOICE_STATUS_TINT[pv.existing_invoice.status]?.label.toLowerCase()} invoice for this month ({money2(pv.existing_invoice.total)}). Void it below to rebuild it.</div>}
          {!lines.length&&<Empty text="Nothing to invoice for this month. Households appear here once a firm pays for them."/>}
          {byFamily.map(g=><div key={g.id||g.name} style={{marginBottom:12}}>
            <div style={{fontWeight:700,color:B.navy,fontSize:13.5,marginBottom:4}}>{g.name}</div>
            {g.rows.map((r,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",gap:12,fontSize:12.5,color:B.text,padding:"4px 0",borderBottom:`1px solid ${B.borderLight}`}}>
              <span style={{minWidth:0}}>{r.description}{Number(r.quantity)>1?`  (× ${Number(r.quantity)})`:""}</span>
              <span style={{fontWeight:600,color:Number(r.amount)<0?"#0d5c2b":B.navy,whiteSpace:"nowrap"}}>{money2(r.amount)}</span>
            </div>)}
          </div>)}
          {lines.length>0&&<div style={{marginTop:6,paddingTop:10,borderTop:`2px solid ${B.border}`,fontSize:13}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:B.textSoft}}>Subtotal</span><span>{money2(pv.subtotal)}</span></div>
            {pv.discount_total!==0&&<div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:B.textSoft}}>Discounts</span><span style={{color:"#0d5c2b"}}>{money2(pv.discount_total)}</span></div>}
            <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,color:B.navy,fontSize:15,marginTop:4}}><span>Total</span><span>{money2(pv.total)}</span></div>
          </div>}
          <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:12,marginTop:14,flexWrap:"wrap"}}>
            {!pv.billing_ready&&<span style={{fontSize:12,color:"#8b1a1a"}}>Set up billing details first.</span>}
            <Btn variant="gold" disabled={!canDraft||busy==="draft"} onClick={createDraft}>{busy==="draft"?"Creating…":"Create draft invoice"}</Btn>
          </div>
        </>}
      </div>

      <div style={card}>
        <div style={lab}>Invoices</div>
        {!invoices.length&&<Empty text="No invoices yet."/>}
        {invoices.map(inv=>{const t=INVOICE_STATUS_TINT[inv.status]||INVOICE_STATUS_TINT.draft;return <div key={inv.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",padding:"10px 0",borderBottom:`1px solid ${B.borderLight}`}}>
          <div>
            <div style={{fontWeight:700,color:B.navy,fontSize:13.5}}>{monthLabelOf(String(inv.period_month).slice(0,10))}</div>
            <div style={{fontSize:11.5,color:B.textSoft}}>{inv.line_count} line{inv.line_count===1?"":"s"} · created {fmt(String(inv.created_at).slice(0,10))}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>{money2(inv.total)}</span>
            <span style={{fontSize:9.5,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",borderRadius:20,padding:"2px 9px",background:t.bg,color:t.text}}>{t.label}</span>
            {inv.status==="draft"&&<Btn small variant="gold" disabled={!!busy} onClick={()=>setConfirm({kind:"finalize",inv})}>Finalize and send</Btn>}
            {(inv.status==="draft"||inv.status==="open")&&<Btn small variant="ghost" disabled={!!busy} onClick={()=>setConfirm({kind:"void",inv})}>Void</Btn>}
          </div>
        </div>;})}
      </div>
    </>}

    {confirm&&<Modal title={confirm.kind==="finalize"?"Finalize and send?":"Void this invoice?"} onClose={()=>setConfirm(null)}>
      <div style={{fontSize:14,color:B.text,lineHeight:1.6,marginTop:6}}>
        {confirm.kind==="finalize"
          ? <>This locks the {monthLabelOf(String(confirm.inv.period_month).slice(0,10))} invoice for <strong>{money2(confirm.inv.total)}</strong> and emails it to the firm's billing address. It can be voided afterwards, but they will already have received it.</>
          : <>This cancels the {monthLabelOf(String(confirm.inv.period_month).slice(0,10))} invoice for <strong>{money2(confirm.inv.total)}</strong>. Any extra-workflow charges on it become billable again on the next invoice.</>}
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20,flexWrap:"wrap"}}>
        <Btn variant="ghost" onClick={()=>setConfirm(null)}>Cancel</Btn>
        <Btn variant={confirm.kind==="finalize"?"gold":"danger"} onClick={doConfirm}>{confirm.kind==="finalize"?"Finalize and send":"Void invoice"}</Btn>
      </div>
    </Modal>}
  </div></div>;
}

// ── ENTERPRISES (Phase 7) ──────────────────────────────────────────────────
// ORDANIS admin only. One row per firm plus ORDANIS direct, and a firm page that opens from each row.
// Every revenue and net worth figure comes from a database function (enterprise_revenue,
// enterprise_net_worth, enterprise_platform_totals), so the list, the firm page and the platform total
// are computed in one place. Nothing here edits a figure.
const entCard={background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:14,padding:"20px 24px",marginBottom:16,boxShadow:B.shadow};
const entLab={fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10};
const entTh={textAlign:"left",fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",padding:"8px 10px",borderBottom:`2px solid ${B.border}`,whiteSpace:"nowrap"};
const entTd={fontSize:12.5,color:B.text,padding:"9px 10px",borderBottom:`1px solid ${B.borderLight}`,verticalAlign:"top"};
const entMoney0=n=>(Number(n)<0?"-":"")+"$"+Math.abs(Math.round(Number(n)||0)).toLocaleString("en-US");
const ENT_HOW={signup_code:"Code at signup",client_join:"Client joined with code",admin_move:"Admin move",admin_created:"Admin created"};
const ENT_EVENT={joined:"Joined",moved:"Moved",removed:"Removed",code_rotated:"Code rotated",default_expert_set:"Default Expert set",skin_linked:"Skin or domain linked",status_changed:"Status changed"};
const entDay=v=>v?asDate(v).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}):"—";
const entCodeLink=code=>`${window.location.origin}/signup?code=${encodeURIComponent(code)}`;
// Same formula the household's own dashboard uses.
function entNetWorth(props,accts,vals,loans=[]){
  const re=props.reduce((s,p)=>s+(Number(p.current_value)||Number(p.purchase_price)||0),0);
  const debt=props.reduce((s,p)=>s+(Number(p.loan_balance)||0)+(Number(p.second_mortgage_balance)||0),0)+accts.filter(a=>a.account_type==="Line of Credit").reduce((s,a)=>s+(Number(a.current_balance)||0),0)
    +loans.reduce((s,l)=>s+(Number(l.current_balance)||0),0);
  const pf=accts.filter(a=>a.account_type!=="Line of Credit").reduce((s,a)=>s+(Number(a.current_balance)||0),0);
  const va=vals.reduce((s,v)=>s+(Number(v.estimated_value)||0),0);
  return re-debt+pf+va;
}
function EntTile({label,value,sub}){
  return <div style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"12px 14px",minWidth:0}}>
    <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>{label}</div>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600,lineHeight:1.15}}>{value}</div>
    {sub&&<div style={{fontSize:11,color:B.textSoft,marginTop:3,lineHeight:1.4}}>{sub}</div>}
  </div>;
}
function entContractStatus(e){
  if(!e)return"";
  if(!e.active)return"Inactive";
  if(!e.contract_signed_at)return"Not signed";
  if(Number(e.build_fee)>0&&!e.build_fee_paid_at)return"Build fee unpaid";
  return"Active";
}

function EnterprisesView({toast,userProfile,onOpenBranding}){
  const[data,setData]=useState(null);
  const[err,setErr]=useState("");
  const[openKey,setOpenKey]=useState(null);
  // New firm: created switched off with its signup code off, like Accurate was. Contract, fees, default
  // Expert and the code itself are then set on the firm's own page. Admins only (enterprises_admin_all).
  const[newFirm,setNewFirm]=useState(null); // {name, slug, skin, domain}
  const[newFirmBusy,setNewFirmBusy]=useState(false);
  const slugify=v=>String(v||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40);
  const createFirm=async()=>{
    const name=newFirm.name.trim(),slug=slugify(newFirm.slug||newFirm.name),domain=newFirm.domain.trim().toLowerCase().replace(/^https?:\/\//,"").replace(/\/.*$/,"");
    if(name.length<2){toast("Enter the firm's name","error");return;}
    if(!slug){toast("Enter a short id using letters and numbers","error");return;}
    if(domain&&!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)){toast("The web domain should look like portal.example.com","error");return;}
    if((data.ents||[]).some(e=>(e.slug||"")===slug||(e.name||"").toLowerCase()===name.toLowerCase())){toast("A firm with that name or id already exists","error");return;}
    const code=Array.from(crypto.getRandomValues(new Uint8Array(5))).map(b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
    setNewFirmBusy(true);
    const{data:row,error}=await sb.from("enterprises").insert({name,slug,active:false,brand_profile_id:newFirm.skin||null,domain:domain||null,
      signup_code:code,signup_code_active:false,contract_notes:`Created ${new Date().toISOString().slice(0,10)}, inactive until go-live. Contract dates and fees not yet entered.`}).select("id").single();
    setNewFirmBusy(false);
    if(error){toast(error.message,"error");return;}
    toast(`${name} created. It stays off until you switch it on.`);
    setNewFirm(null);await load();setOpenKey(row.id);
  };
  const load=useCallback(async()=>{
    const month=monthStartISO(0);
    const[ents,rev,nw,plat,fams,users,plans,skins]=await Promise.all([
      sb.from("enterprises").select("*").order("name"),
      sb.rpc("enterprise_revenue",{p_month:month}),
      sb.rpc("enterprise_net_worth"),
      sb.rpc("enterprise_platform_totals",{p_month:month}),
      sb.from("families").select("id,name,enterprise_id,plan,subscription_state,created_at,joined_enterprise_at,joined_via,archived_at,customer_number,advisor_name,advisor_email,paid_by,onboarding_contacted_at").is("archived_at",null),
      sb.from("user_profiles").select("id,email,full_name,role,active,family_id,enterprise_id"),
      sb.from("plan_features").select("plan,label,monthly_price"),
      sb.from("brand_profiles").select("id,brand_name"),
    ]);
    const bad=[ents,rev,nw,plat,fams,users].find(r=>r.error);
    if(bad){setErr(bad.error.message);setData({failed:true});return;}
    setErr("");
    setData({month,ents:ents.data||[],rev:rev.data||[],nw:nw.data||[],plat:(plat.data||[])[0]||null,fams:fams.data||[],users:users.data||[],plans:plans.data||[],skins:skins.data||[]});
  },[]);
  useEffect(()=>{load();},[load]);

  const rows=useMemo(()=>{
    if(!data||data.failed)return[];
    const since=Date.now()-30*86400000;
    const mk=(id,name,ent)=>{
      const same=x=>(x.enterprise_id||null)===id;
      const r=data.rev.find(same)||{};
      const n=data.nw.find(same)||{};
      const fams=data.fams.filter(same);
      const famIds=new Set(fams.map(f=>f.id));
      const users=data.users.filter(u=>(id?u.enterprise_id===id:false)||(u.family_id&&famIds.has(u.family_id)));
      const skin=ent&&ent.brand_profile_id?(data.skins.find(s=>s.id===ent.brand_profile_id)||{}).brand_name||"":"";
      return{key:id||"direct",id,name,ent,rev:r,nw:n,fams,users,
        signups30:fams.filter(f=>new Date(f.joined_enterprise_at||f.created_at).getTime()>=since).length,skinName:skin};
    };
    return[...data.ents.map(e=>mk(e.id,e.name,e)),mk(null,"ORDANIS direct",null)];
  },[data]);

  const check=useMemo(()=>{
    if(!data||data.failed||!data.plat)return null;
    const sum=f=>rows.reduce((s,r)=>s+(Number(f(r))||0),0);
    const pairs=[
      ["Households",sum(r=>r.nw.households),data.plat.households],
      ["Plan MRR",sum(r=>r.rev.plan_mrr),data.plat.plan_mrr],
      ["Revenue this month",sum(r=>r.rev.total_revenue),data.plat.total_revenue],
      ["Net worth",sum(r=>r.nw.net_worth),data.plat.net_worth],
      ["Real estate",sum(r=>r.nw.real_estate),data.plat.real_estate],
      ["Debt",sum(r=>r.nw.debt),data.plat.debt],
      ["Portfolio",sum(r=>r.nw.portfolio),data.plat.portfolio],
      ["Valuables",sum(r=>r.nw.valuables),data.plat.valuables],
    ];
    const off=pairs.filter(([,a,b])=>Math.abs(Number(a)-Number(b))>0.005);
    return{ok:!off.length,off};
  },[data,rows]);

  if(data===null)return <Spinner/>;
  if(data.failed)return <div style={{padding:"24px 28px"}}><div style={{background:"#fde8e8",border:"1px solid #f5c6c6",color:"#8b1a1a",borderRadius:10,padding:"12px 16px",fontSize:13}}>Could not load enterprises: {err}</div></div>;

  const open=openKey?rows.find(r=>r.key===openKey):null;
  if(open)return <EntFirmPage row={open} rows={rows} data={data} toast={toast} onBack={()=>setOpenKey(null)} onChanged={load} onOpenBranding={onOpenBranding}/>;

  const plat=data.plat;
  return <div style={{height:"100%",overflowY:"auto"}}><div style={{maxWidth:1180,padding:"24px 28px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:4}}>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,color:B.navy,fontWeight:600}}>Enterprises</div>
      <Btn small onClick={()=>setNewFirm({name:"",slug:"",skin:"",domain:""})}>+ New firm</Btn>
    </div>
    {newFirm&&<Modal title="New firm" onClose={()=>!newFirmBusy&&setNewFirm(null)}>
      <div style={{fontSize:12.5,color:B.textSoft,lineHeight:1.55,marginBottom:14}}>The firm is created switched off, with its signup code off. Open it afterwards to add the contract, default Expert and billing, and switch it on when it goes live.</div>
      <Field label="Firm name" required><Inp value={newFirm.name} onChange={e=>setNewFirm({...newFirm,name:e.target.value})} placeholder="e.g. Smith Wealth Partners"/></Field>
      <Grid2>
        <Field label="Short id" optional><Inp value={newFirm.slug} onChange={e=>setNewFirm({...newFirm,slug:e.target.value})} placeholder={slugify(newFirm.name)||"smith-wealth"}/></Field>
        <Field label="Skin" optional><Sel value={newFirm.skin} onChange={e=>setNewFirm({...newFirm,skin:e.target.value})}>
          <option value="">ORDANIS (no firm skin)</option>
          {(data.skins||[]).map(s=><option key={s.id} value={s.id}>{s.brand_name}</option>)}
        </Sel></Field>
      </Grid2>
      <Field label="Web domain" optional><Inp value={newFirm.domain} onChange={e=>setNewFirm({...newFirm,domain:e.target.value})} placeholder="portal.examplefirm.com (only once its DNS points here)"/></Field>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:8}}>
        <Btn variant="ghost" onClick={()=>setNewFirm(null)} disabled={newFirmBusy}>Cancel</Btn>
        <Btn onClick={createFirm} disabled={newFirmBusy||newFirm.name.trim().length<2}>{newFirmBusy?"Creating…":"Create firm"}</Btn>
      </div>
    </Modal>}
    <p style={{fontSize:13,color:B.textSoft,margin:"0 0 16px",maxWidth:720,lineHeight:1.6}}>
      Each advisory firm on the platform, with ORDANIS direct as the last row, so the rows add up to the whole platform. Open a firm to see its households, revenue, net worth and contract.
    </p>
    <GoldLine/>
    {check&&<div style={{background:check.ok?"#e0f5e9":"#fde8e8",border:`1px solid ${check.ok?"#bfe8cf":"#f5c6c6"}`,color:check.ok?"#0d5c2b":"#8b1a1a",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,lineHeight:1.5}}>
      {check.ok?"Firms plus ORDANIS direct add up to the platform for households, plan MRR, this month's revenue, net worth and each of its parts."
        :`Firms plus ORDANIS direct do not add up to the platform for: ${check.off.map(([k,a,b])=>`${k} (rows ${Number(a).toLocaleString()}, platform ${Number(b).toLocaleString()})`).join("; ")}. Tell the developer.`}
    </div>}
    <div style={entCard}>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:1340}}>
          <thead><tr>
            {["Firm","Skin","Domain","Code","Households","Users","Plan MRR","Usage (month)","Net worth","Real estate","Debt","Portfolio","Valuables","New, 30 days","Contract"].map(h=><th key={h} style={entTh}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(r=><tr key={r.key} onClick={()=>setOpenKey(r.key)} style={{cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background=B.bg} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <td style={{...entTd,fontWeight:700,color:B.navy}}>{r.name}{r.ent&&!r.ent.active&&<span style={{marginLeft:8,fontSize:9.5,fontWeight:700,textTransform:"uppercase",background:"#eceff3",color:"#5b6573",borderRadius:20,padding:"2px 8px"}}>Inactive</span>}</td>
              <td style={entTd}>{r.ent?(r.skinName||"—"):"ORDANIS"}</td>
              <td style={entTd}>{r.ent?(r.ent.domain||"—"):"—"}</td>
              <td style={entTd}>{r.ent?(r.ent.signup_code_active?"On":"Off"):"—"}</td>
              <td style={entTd}>{r.nw.households||0}</td>
              <td style={entTd}>{r.users.length}</td>
              <td style={entTd}>{money2(r.rev.plan_mrr)}</td>
              <td style={entTd}>{money2(r.rev.usage_revenue)}</td>
              <td style={{...entTd,fontWeight:600}}>{entMoney0(r.nw.net_worth)}</td>
              <td style={entTd}>{entMoney0(r.nw.real_estate)}</td>
              <td style={entTd}>{entMoney0(r.nw.debt)}</td>
              <td style={entTd}>{entMoney0(r.nw.portfolio)}</td>
              <td style={entTd}>{entMoney0(r.nw.valuables)}</td>
              <td style={entTd}>{r.signups30}</td>
              <td style={entTd}>{r.ent?entContractStatus(r.ent):"—"}</td>
            </tr>)}
          </tbody>
          {plat&&<tfoot><tr>
            <td style={{...entTd,fontWeight:700,color:B.navy,borderTop:`2px solid ${B.border}`,borderBottom:"none"}} colSpan={4}>Platform</td>
            <td style={{...entTd,fontWeight:700,borderTop:`2px solid ${B.border}`,borderBottom:"none"}}>{plat.households}</td>
            <td style={{...entTd,fontWeight:700,borderTop:`2px solid ${B.border}`,borderBottom:"none"}}>{data.users.filter(u=>u.role==="client"||u.role==="partner"||u.role==="enterprise_admin").length}</td>
            <td style={{...entTd,fontWeight:700,borderTop:`2px solid ${B.border}`,borderBottom:"none"}}>{money2(plat.plan_mrr)}</td>
            <td style={{...entTd,fontWeight:700,borderTop:`2px solid ${B.border}`,borderBottom:"none"}}>{money2(rows.reduce((s,r)=>s+(Number(r.rev.usage_revenue)||0),0))}</td>
            <td style={{...entTd,fontWeight:700,borderTop:`2px solid ${B.border}`,borderBottom:"none"}}>{entMoney0(plat.net_worth)}</td>
            <td style={{...entTd,fontWeight:700,borderTop:`2px solid ${B.border}`,borderBottom:"none"}}>{entMoney0(plat.real_estate)}</td>
            <td style={{...entTd,fontWeight:700,borderTop:`2px solid ${B.border}`,borderBottom:"none"}}>{entMoney0(plat.debt)}</td>
            <td style={{...entTd,fontWeight:700,borderTop:`2px solid ${B.border}`,borderBottom:"none"}}>{entMoney0(plat.portfolio)}</td>
            <td style={{...entTd,fontWeight:700,borderTop:`2px solid ${B.border}`,borderBottom:"none"}}>{entMoney0(plat.valuables)}</td>
            <td style={{...entTd,borderTop:`2px solid ${B.border}`,borderBottom:"none"}} colSpan={2}/>
          </tr></tfoot>}
        </table>
      </div>
      <div style={{fontSize:11.5,color:B.textSoft,marginTop:12,lineHeight:1.55}}>
        Plan MRR is list price for active and past-due households. Usage is what was actually billed this month (extra workflows, storage, partner seats) and reads zero until the billing ledger is being written from Stripe. Net worth is what households and the team have entered, not a bank feed.
      </div>
    </div>
  </div></div>;
}

function EntFirmPage({row,rows,data,toast,onBack,onChanged,onOpenBranding}){
  const isFirm=!!row.id;
  const e=row.ent;
  const TABS=isFirm?["Overview","Signups","Households and users","Expert","Skin and domain","Contract and fees","Activity"]:["Overview","Signups"];
  const[tab,setTab]=useState("Overview");
  const[busy,setBusy]=useState("");
  const[confirm,setConfirm]=useState(null);
  const[newCode,setNewCode]=useState("");
  const call=async(key,fn,args,ok)=>{
    setBusy(key);
    try{const{data:d,error}=await sb.rpc(fn,args);if(error)throw new Error(error.message);toast(ok);await onChanged();return d;}
    catch(x){toast(x.message,"error");}
    finally{setBusy("");}
  };
  const rotate=async()=>{setConfirm(null);const code=await call("rot","enterprise_rotate_code",{p_enterprise_id:row.id},"Code rotated. The old code no longer works.");if(code)setNewCode(code);};
  const toggleCode=()=>call("cd","enterprise_set_status",{p_enterprise_id:row.id,p_what:"code_active",p_value:!e.signup_code_active},e.signup_code_active?"Code switched off":"Code switched on");
  const setActive=async v=>{setConfirm(null);await call("act","enterprise_set_status",{p_enterprise_id:row.id,p_what:"active",p_value:v},v?"Firm reactivated":"Firm deactivated");};
  const copy=async txt=>{try{await navigator.clipboard.writeText(txt);toast("Copied");}catch(_x){toast("Could not copy. Select the text and copy it.","error");}};
  const common={row,rows,data,toast,onChanged};
  return <div style={{height:"100%",overflowY:"auto"}}><div style={{maxWidth:1180,padding:"24px 28px"}}>
    <div style={{marginBottom:10}}><Btn small variant="ghost" onClick={onBack}>← All enterprises</Btn></div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:8}}>
      <div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,color:B.navy,fontWeight:600}}>{row.name}</div>
        <div style={{fontSize:12.5,color:B.textSoft,marginTop:2}}>
          {isFirm?<>{entContractStatus(e)}{e.domain?` · ${e.domain}`:""}{row.skinName?` · skin: ${row.skinName}`:""}</>:"Households that belong to no firm"}
        </div>
      </div>
      {isFirm&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Btn small variant="ghost" disabled={!!busy} onClick={()=>setConfirm("rotate")}>Rotate code</Btn>
        <Btn small variant="ghost" disabled={!!busy} onClick={toggleCode}>{e.signup_code_active?"Switch code off":"Switch code on"}</Btn>
        {e.active
          ?<Btn small variant="danger" disabled={!!busy} onClick={()=>setConfirm("deactivate")}>Deactivate firm</Btn>
          :<Btn small variant="gold" disabled={!!busy} onClick={()=>setActive(true)}>Reactivate firm</Btn>}
      </div>}
    </div>
    {isFirm&&<div style={{...entCard,padding:"12px 16px",marginBottom:12,display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{fontSize:12,color:B.textSoft}}>Firm code <strong style={{fontFamily:"monospace",fontSize:13,color:B.navy,marginLeft:4}}>{e.signup_code}</strong> <span style={{marginLeft:6}}>({e.signup_code_active?"on":"off"})</span></div>
      <Btn small variant="ghost" onClick={()=>copy(e.signup_code)}>Copy code</Btn>
      <Btn small variant="ghost" onClick={()=>copy(entCodeLink(e.signup_code))}>Copy signup link</Btn>
    </div>}
    <GoldLine/>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
      {TABS.map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"7px 14px",borderRadius:20,border:`1px solid ${tab===t?B.navy:B.border}`,background:tab===t?B.navy:B.white,color:tab===t?B.white:B.navyMid,fontSize:12.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{t}</button>)}
    </div>
    {tab==="Overview"&&<EntOverview {...common}/>}
    {tab==="Signups"&&<EntSignups {...common}/>}
    {tab==="Households and users"&&isFirm&&<EntPeople {...common}/>}
    {tab==="Expert"&&isFirm&&<EntExpert {...common}/>}
    {tab==="Skin and domain"&&isFirm&&<EntSkin {...common} onOpenBranding={onOpenBranding}/>}
    {tab==="Contract and fees"&&isFirm&&<EntContract {...common}/>}
    {tab==="Activity"&&isFirm&&<EntActivity {...common}/>}

    {confirm==="rotate"&&<Modal title="Rotate the firm code?" onClose={()=>setConfirm(null)}>
      <div style={{fontSize:14,color:B.text,lineHeight:1.6,marginTop:6}}>The current code stops working at once, including any link or message that already carries it. Households already in the firm stay in. You will be shown the new code once, to send to the firm.</div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}><Btn variant="ghost" onClick={()=>setConfirm(null)}>Cancel</Btn><Btn variant="gold" onClick={rotate}>Rotate code</Btn></div>
    </Modal>}
    {confirm==="deactivate"&&<Modal title="Deactivate this firm?" onClose={()=>setConfirm(null)}>
      <div style={{fontSize:14,color:B.text,lineHeight:1.6,marginTop:6}}>Nobody can join {row.name} while it is inactive. Its households stay where they are and keep their plans. You can reactivate it at any time.</div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}><Btn variant="ghost" onClick={()=>setConfirm(null)}>Cancel</Btn><Btn variant="danger" onClick={()=>setActive(false)}>Deactivate</Btn></div>
    </Modal>}
    {newCode&&<Modal title="New firm code" onClose={()=>setNewCode("")}>
      <div style={{fontSize:13,color:B.textSoft,lineHeight:1.6,marginTop:6}}>Send this to the firm. It is also shown on this page.</div>
      <div style={{fontFamily:"monospace",fontSize:20,color:B.navy,fontWeight:700,margin:"12px 0"}}>{newCode}</div>
      <div style={{fontSize:12,color:B.textSoft,wordBreak:"break-all"}}>{entCodeLink(newCode)}</div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:18}}><Btn variant="ghost" onClick={()=>copy(entCodeLink(newCode))}>Copy link</Btn><Btn onClick={()=>setNewCode("")}>Done</Btn></div>
    </Modal>}
  </div></div>;
}

function EntOverview({row,data,toast,onChanged}){
  const r=row.rev,n=row.nw,plat=data.plat;
  const[snaps,setSnaps]=useState(null);
  const[busy,setBusy]=useState(false);
  const loadSnaps=useCallback(async()=>{
    let q=sb.from("enterprise_snapshots").select("snapshot_month,households,plan_mrr,usage_revenue,total_revenue,net_worth").order("snapshot_month",{ascending:false}).limit(6);
    q=row.id?q.eq("enterprise_id",row.id):q.is("enterprise_id",null);
    const{data:d}=await q;setSnaps(d||[]);
  },[row.id]);
  useEffect(()=>{loadSnaps();},[loadSnaps]);
  const takeSnapshot=async()=>{
    setBusy(true);
    const{error}=await sb.rpc("enterprise_snapshot_run",{p_month:monthStartISO(0)});
    setBusy(false);
    if(error){toast(error.message,"error");return;}
    toast("Snapshot saved for "+monthLabelOf(monthStartISO(0)));await loadSnaps();
  };
  const usage=Number(r.usage_revenue)||0,mrr=Number(r.plan_mrr)||0;
  const shareH=plat&&plat.households?Math.round(100*(n.households||0)/plat.households):0;
  const shareR=plat&&Number(plat.total_revenue)>0?Math.round(100*(Number(r.total_revenue)||0)/Number(plat.total_revenue)):null;
  const none=!(n.households>0);
  return <div>
    <div style={entCard}>
      <div style={entLab}>{monthLabelOf(data.month)}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(170px,100%),1fr))",gap:10}}>
        <EntTile label="Households" value={n.households||0} sub={`${shareH}% of the platform`}/>
        <EntTile label="Users" value={row.users.length}/>
        <EntTile label="Plan MRR" value={money2(mrr)} sub="List price, active and past due"/>
        <EntTile label="Usage billed" value={money2(usage)} sub="Extra workflows, storage, seats"/>
        <EntTile label="Revenue billed" value={money2(r.total_revenue)} sub={shareR==null?"Billing ledger is empty":`${shareR}% of the platform`}/>
        <EntTile label="Annualised" value={money2((mrr+usage)*12)} sub="(Plan MRR + usage) × 12"/>
      </div>
      {row.id&&<div style={{fontSize:12,color:B.textSoft,marginTop:12}}>Paid by the firm {money2(r.paid_by_firm)} · paid by households {money2(r.paid_by_families)}</div>}
    </div>
    <div style={entCard}>
      <div style={entLab}>Net worth under administration</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(170px,100%),1fr))",gap:10}}>
        <EntTile label="Net worth" value={entMoney0(n.net_worth)} sub={none?"No households yet":`${entMoney0((Number(n.net_worth)||0)/Math.max(1,n.households||1))} per household`}/>
        <EntTile label="Real estate" value={entMoney0(n.real_estate)}/>
        <EntTile label="Debt" value={entMoney0(n.debt)}/>
        <EntTile label="Portfolio" value={entMoney0(n.portfolio)}/>
        <EntTile label="Valuables" value={entMoney0(n.valuables)}/>
      </div>
      <div style={{fontSize:11.5,color:B.textSoft,marginTop:12,lineHeight:1.55}}>
        {n.households_with_data||0} of {n.households||0} households have entered any data. These figures are entered by clients or the team, not synced from banks or county records.
        {n.accounts_total>0?` ${n.accounts_with_date} of ${n.accounts_total} portfolio accounts carry a balance date${n.oldest_balance_date?`, the oldest ${entDay(n.oldest_balance_date)}`:""}.`:""}
        {" "}Property values and valuables carry no date.
      </div>
    </div>
    <div style={entCard}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <div style={entLab}>Monthly snapshots</div>
        <Btn small variant="ghost" disabled={busy} onClick={takeSnapshot}>{busy?"Saving…":"Save this month's snapshot now"}</Btn>
      </div>
      {snaps===null?<Empty text="Loading…"/>:!snaps.length?<Empty text="No snapshots yet. One is saved automatically at 06:15 UTC on the 1st of each month, and trends start from the first one."/>:
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:520}}>
          <thead><tr>{["Month","Households","Plan MRR","Usage","Revenue","Net worth"].map(h=><th key={h} style={entTh}>{h}</th>)}</tr></thead>
          <tbody>{snaps.map(s=><tr key={s.snapshot_month}>
            <td style={entTd}>{monthLabelOf(String(s.snapshot_month).slice(0,10))}</td><td style={entTd}>{s.households}</td>
            <td style={entTd}>{money2(s.plan_mrr)}</td><td style={entTd}>{money2(s.usage_revenue)}</td><td style={entTd}>{money2(s.total_revenue)}</td><td style={entTd}>{entMoney0(s.net_worth)}</td>
          </tr>)}</tbody></table></div>}
    </div>
  </div>;
}

function EntSignups({row,data}){
  const[x,setX]=useState(null);
  useEffect(()=>{
    let stop=false;
    const ids=row.fams.map(f=>f.id);
    if(!ids.length){setX({nw:{},usage:{},notice:{}});return;}
    Promise.all([
      sb.from("properties").select("family_id,current_value,purchase_price,loan_balance,second_mortgage_balance").in("family_id",ids),
      sb.from("portfolio_accounts").select("family_id,account_type,current_balance").in("family_id",ids),
      sb.from("valuables").select("family_id,estimated_value").in("family_id",ids),
      sb.from("billing_ledger").select("family_id,amount,line_type").eq("period_month",data.month).in("family_id",ids),
      sb.from("enterprise_membership_events").select("family_id,event_type,how,detail,created_at").in("family_id",ids).in("event_type",["joined","moved"]).order("created_at",{ascending:false}),
      sb.from("signup_disclosures").select("id,version").eq("kind","firm_data_sharing"),
      sb.from("loans").select("family_id,current_balance").in("family_id",ids),
    ]).then(([p,a,v,l,ev,dc,ln])=>{
      if(stop)return;
      const by=(arr,id)=>(arr.data||[]).filter(q=>q.family_id===id);
      const nw={},usage={},notice={};
      ids.forEach(id=>{
        nw[id]=entNetWorth(by(p,id),by(a,id),by(v,id),by(ln,id));
        usage[id]=by(l,id).reduce((s,q)=>s+(Number(q.amount)||0),0);
        const e=(ev.data||[]).find(q=>q.family_id===id);
        if(e){const d=(dc.data||[]).find(q=>q.id===(e.detail&&e.detail.notice_id));notice[id]=d?`Notice v${d.version}`:(e.how==="admin_move"?"Recorded by admin":"—");}
      });
      setX({nw,usage,notice});
    });
    return()=>{stop=true;};
  },[row.key,data.month]);
  const price=plan=>Number((data.plans.find(p=>p.plan===plan)||{}).monthly_price)||0;
  const planLabel=plan=>(data.plans.find(p=>p.plan===plan)||{}).label||plan;
  const list=[...row.fams].sort((a,b)=>new Date(b.joined_enterprise_at||b.created_at)-new Date(a.joined_enterprise_at||a.created_at));
  return <div style={entCard}>
    <div style={entLab}>{row.id?"Households that joined this firm":"ORDANIS direct households"}</div>
    {!list.length?<Empty text="No households yet."/>:
    <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:1020}}>
      <thead><tr>{["Joined","No.","Household","Plan","How","Billing","Plan MRR","Usage","Expert","Onboarded","Consent","Net worth"].map(h=><th key={h} style={entTh}>{h}</th>)}</tr></thead>
      <tbody>{list.map(f=>{const live=f.subscription_state==="active"||f.subscription_state==="past_due";return <tr key={f.id}>
        <td style={entTd}>{entDay(f.joined_enterprise_at||f.created_at)}</td>
        <td style={entTd}>{f.customer_number||"—"}</td>
        <td style={{...entTd,fontWeight:700,color:B.navy}}>{f.name}{f.paid_by==="enterprise"&&<span style={{marginLeft:6,fontSize:9.5,fontWeight:700,textTransform:"uppercase",background:"rgba(206,182,129,0.22)",color:"#7a5a19",borderRadius:20,padding:"2px 7px"}}>Firm pays</span>}</td>
        <td style={entTd}>{planLabel(f.plan)}</td>
        <td style={entTd}>{f.joined_via?ENT_HOW[f.joined_via]||f.joined_via:(row.id?"—":"Direct")}</td>
        <td style={entTd}>{f.subscription_state||"—"}</td>
        <td style={entTd}>{live?money2(price(f.plan)):money2(0)}</td>
        <td style={entTd}>{x?money2(x.usage[f.id]||0):"…"}</td>
        <td style={entTd}>{f.advisor_name||f.advisor_email||"—"}</td>
        <td style={entTd}>{f.onboarding_contacted_at?"Yes":"No"}</td>
        <td style={entTd}>{row.id?(x?(x.notice[f.id]||"—"):"…"):"—"}</td>
        <td style={entTd}>{x?entMoney0(x.nw[f.id]||0):"…"}</td>
      </tr>;})}</tbody></table></div>}
  </div>;
}

function EntPeople({row,data,toast,onChanged}){
  const[target,setTarget]=useState("");
  const[agreed,setAgreed]=useState(false);
  const[note,setNote]=useState("");
  const[busy,setBusy]=useState(false);
  const todayIso=localDayISO();
  const blankEnroll={hh:"",owner:"",email:"",plan:"",start:todayIso,agreed:false,how:""};
  const[en,setEn]=useState(blankEnroll);
  const[enBusy,setEnBusy]=useState(false);
  const enValid=en.hh.trim().length>1&&en.owner.trim().length>1&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(en.email.trim())&&en.plan&&en.start&&en.agreed&&AGREEMENT_METHODS.includes(en.how);
  const enroll=async()=>{
    setEnBusy(true);
    try{
      const r=await callFirmJoin({action:"admin_enroll",enterprise_id:row.id,household_name:en.hh.trim(),owner_full_name:en.owner.trim(),owner_email:en.email.trim(),plan:en.plan,start_date:en.start,client_agreed:true,note:en.how,redirect_to:window.location.origin});
      toast(r.household_name+" enrolled. An invite was emailed to "+r.invited);
      setEn(blankEnroll);await onChanged();
    }catch(x){toast(x.message,"error");}
    setEnBusy(false);
  };
  const[removing,setRemoving]=useState(null);
  const[removeNote,setRemoveNote]=useState("");
  const others=data.fams.filter(f=>f.enterprise_id!==row.id&&f.paid_by!=="enterprise");
  const firmName=id=>id?((data.ents.find(x=>x.id===id)||{}).name||"another firm"):"ORDANIS direct";
  const move=async()=>{
    setBusy(true);
    try{
      const r=await callFirmJoin({action:"admin_move",family_id:target,enterprise_id:row.id,client_agreed:true,note:note.trim()});
      toast((r.status==="moved"?"Moved into ":"Added to ")+(r.firm_name||row.name));
      setTarget("");setAgreed(false);setNote("");await onChanged();
    }catch(x){toast(x.message,"error");}
    setBusy(false);
  };
  const remove=async()=>{
    setBusy(true);
    try{
      await callFirmJoin({action:"admin_remove",family_id:removing.id,note:removeNote.trim()});
      toast("Removed from "+row.name);setRemoving(null);setRemoveNote("");await onChanged();
    }catch(x){toast(x.message,"error");}
    setBusy(false);
  };
  const famName=id=>(data.fams.find(f=>f.id===id)||{}).name||"—";
  const users=[...row.users].sort((a,b)=>(a.role==="enterprise_admin"?0:1)-(b.role==="enterprise_admin"?0:1)||String(a.email).localeCompare(String(b.email)));
  return <div>
    <div style={entCard}>
      <div style={entLab}>Households ({row.fams.length})</div>
      {!row.fams.length?<Empty text="No households in this firm."/>:row.fams.map(f=><div key={f.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",padding:"8px 0",borderBottom:`1px solid ${B.borderLight}`}}>
        <div style={{fontSize:13,color:B.navy,fontWeight:700}}>{f.name}<span style={{fontWeight:400,color:B.textSoft,marginLeft:8,fontSize:12}}>{f.paid_by==="enterprise"?"Plan paid by the firm":"Pays its own plan"}</span></div>
        {f.paid_by!=="enterprise"
          ?<Btn small variant="ghost" disabled={busy} onClick={()=>{setRemoving(f);setRemoveNote("");}}>Remove from firm</Btn>
          :<span style={{fontSize:11.5,color:B.textMute}}>Can't be removed while the firm pays</span>}
      </div>)}
    </div>
    <div style={entCard}>
      <div style={entLab}>Enroll a new client in {row.name}</div>
      <div style={{fontSize:12,color:B.textSoft,lineHeight:1.55,marginBottom:12}}>Creates the household and the owner's login, emails the owner an invite to set a password, places the household in {row.name}, and makes {row.name} pay for the plan at list price with no discount. It goes on the firm's monthly invoice, prorated from the start date. Only with the client's agreement.</div>
      {/* Two even rows of three (one column on a phone): who, then the terms. Short labels so every box lines up. */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(240px,100%),1fr))",gap:"0 16px",maxWidth:900,alignItems:"end"}}>
        <Field label="Household name"><Inp value={en.hh} onChange={e=>setEn({...en,hh:e.target.value})} placeholder="e.g. The Smith Family"/></Field>
        <Field label="Owner's full name"><Inp value={en.owner} onChange={e=>setEn({...en,owner:e.target.value})} placeholder="e.g. Jordan Smith"/></Field>
        <Field label="Owner's email"><Inp type="email" autoComplete="off" value={en.email} onChange={e=>setEn({...en,email:e.target.value})} placeholder="name@example.com"/></Field>
        <Field label="Plan"><Sel value={en.plan} onChange={e=>setEn({...en,plan:e.target.value})}>
          <option value="">Choose a plan…</option>
          {data.plans.map(p=><option key={p.plan} value={p.plan}>{p.label} - {money2(p.monthly_price)}/mo</option>)}
        </Sel></Field>
        <Field label="Start date"><Inp type="date" value={en.start} onChange={e=>setEn({...en,start:e.target.value})}/></Field>
        <Field label="How the client agreed"><Sel value={en.how} onChange={e=>setEn({...en,how:e.target.value})}>
          <option value="">Choose…</option>
          {AGREEMENT_METHODS.map(m=><option key={m} value={m}>{m}</option>)}
        </Sel></Field>
      </div>
      <div style={{fontSize:11.5,color:B.textMute,margin:"-4px 0 12px"}}>The first month is prorated from the start date.</div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",maxWidth:900}}>
        <label style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:12.5,color:B.text,cursor:"pointer",flex:"1 1 320px"}}><input type="checkbox" checked={en.agreed} onChange={e=>setEn({...en,agreed:e.target.checked})} style={{marginTop:2}}/>The client has agreed to share this household's information with {row.name}.</label>
        <Btn small disabled={enBusy||!enValid} onClick={enroll}>{enBusy?"Enrolling…":"Enroll client"}</Btn>
      </div>
    </div>
    <div style={entCard}>
      <div style={entLab}>Move a household into {row.name}</div>
      <div style={{fontSize:12,color:B.textSoft,lineHeight:1.55,marginBottom:10}}>Only with the client's agreement. Firm-paid households can't be moved. The move is written to the log with how the client agreed.</div>
      <div style={{maxWidth:420}}><Sel value={target} onChange={e=>setTarget(e.target.value)}>
        <option value="">Choose a household…</option>
        {others.map(f=><option key={f.id} value={f.id}>{f.name} (now in {firmName(f.enterprise_id)})</option>)}
      </Sel></div>
      {target&&<div style={{marginTop:10}}>
        <label style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:12.5,color:B.text,cursor:"pointer"}}><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{marginTop:2}}/>The client has agreed to share this household's information with {row.name}.</label>
        {agreementSelect(note,setNote)}
        <div style={{marginTop:8}}><Btn small disabled={busy||!agreed||!AGREEMENT_METHODS.includes(note)} onClick={move}>{busy?"Saving…":"Move household"}</Btn></div>
      </div>}
    </div>
    <div style={entCard}>
      <div style={entLab}>People ({users.length})</div>
      {!users.length?<Empty text="No users yet."/>:<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:560}}>
        <thead><tr>{["Name","Email","Role","Household","Active"].map(h=><th key={h} style={entTh}>{h}</th>)}</tr></thead>
        <tbody>{users.map(u=><tr key={u.id}>
          <td style={{...entTd,fontWeight:700,color:B.navy}}>{u.full_name||"—"}</td><td style={entTd}>{u.email}</td>
          <td style={entTd}>{u.role==="enterprise_admin"?<span style={{fontSize:9.5,fontWeight:700,textTransform:"uppercase",background:"rgba(206,182,129,0.22)",color:"#7a5a19",borderRadius:20,padding:"2px 8px"}}>Firm admin</span>:u.role}</td>
          <td style={entTd}>{u.family_id?famName(u.family_id):"—"}</td><td style={entTd}>{u.active===false?"No":"Yes"}</td>
        </tr>)}</tbody></table></div>}
      <div style={{fontSize:11.5,color:B.textSoft,marginTop:10}}>Firm admin accounts are created by an ORDANIS admin from the Users screen.</div>
    </div>
    {removing&&<Modal title="Remove from firm?" onClose={()=>setRemoving(null)}>
      <div style={{fontSize:14,color:B.text,lineHeight:1.6,marginTop:6}}>Remove <strong>{removing.name}</strong> from {row.name}? The firm loses access right away. The household keeps its plan and its data.</div>
      <input value={removeNote} onChange={e=>setRemoveNote(e.target.value)} maxLength={300} placeholder="Reason (optional, recorded in the log)" style={{width:"100%",boxSizing:"border-box",marginTop:12,padding:"8px 10px",border:`1px solid ${B.border}`,borderRadius:8,fontSize:13,fontFamily:"inherit",color:B.text}}/>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:18}}><Btn variant="ghost" onClick={()=>setRemoving(null)}>Cancel</Btn><Btn variant="danger" disabled={busy} onClick={remove}>{busy?"Removing…":"Remove"}</Btn></div>
    </Modal>}
  </div>;
}

function EntExpert({row,data,toast,onChanged}){
  const e=row.ent;
  const experts=data.users.filter(u=>u.role==="advisor"&&u.active!==false&&u.email).sort((a,b)=>String(a.full_name||a.email).localeCompare(String(b.full_name||b.email)));
  const[pick,setPick]=useState(e.default_expert_email||"");
  const[apply,setApply]=useState(false);
  const[busy,setBusy]=useState(false);
  const[result,setResult]=useState(null);
  const current=experts.find(u=>String(u.email).toLowerCase()===String(e.default_expert_email||"").toLowerCase());
  const setBy=e.default_expert_set_by?data.users.find(u=>u.id===e.default_expert_set_by):null;
  const needsApply=row.fams.filter(f=>String(f.advisor_email||"").toLowerCase()!==String(pick||"").toLowerCase()).length;
  const save=async()=>{
    setBusy(true);setResult(null);
    const{data:d,error}=await sb.rpc("enterprise_set_default_expert",{p_enterprise_id:row.id,p_email:pick||null,p_apply_existing:apply&&!!pick});
    setBusy(false);
    if(error){toast(error.message==="expert_not_found"?"That person is not an active Expert.":error.message,"error");return;}
    setResult(d);toast(pick?"Default Expert saved":"Default Expert cleared");setApply(false);await onChanged();
  };
  return <div style={entCard}>
    <div style={entLab}>Assign Expert</div>
    <p style={{fontSize:12.5,color:B.textSoft,margin:"0 0 12px",lineHeight:1.6,maxWidth:640}}>
      The default Expert is given to every household that signs up with this firm's code. Any single household can still be changed on its own page.
      {e.default_expert_email?` Right now: ${current?(current.full_name||current.email):e.default_expert_email}${e.default_expert_set_at?`, set ${entDay(e.default_expert_set_at)}${setBy?` by ${setBy.full_name||setBy.email}`:""}`:""}.`:" No default Expert is set."}
    </p>
    <div style={{maxWidth:420}}><Field label="Default Expert"><Sel value={pick} onChange={ev=>setPick(ev.target.value)}>
      <option value="">None</option>
      {experts.map(u=><option key={u.id} value={u.email}>{u.full_name||u.email}</option>)}
    </Sel></Field></div>
    {pick&&row.fams.length>0&&<label style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:12.5,color:B.text,cursor:"pointer",marginBottom:12}}>
      <input type="checkbox" checked={apply} onChange={ev=>setApply(ev.target.checked)} style={{marginTop:2}}/>
      Also give this Expert to the {needsApply} existing household{needsApply===1?"":"s"} in the firm that {needsApply===1?"has":"have"} a different Expert. An Expert's household limit still applies.
    </label>}
    <Btn small disabled={busy||pick===(e.default_expert_email||"")&&!apply} onClick={save}>{busy?"Saving…":"Save"}</Btn>
    {result&&<div style={{marginTop:12,fontSize:12.5,color:B.text,lineHeight:1.6}}>
      {result.applied>0&&<div>Given to {result.applied} existing household{result.applied===1?"":"s"}.</div>}
      {result.could_not_apply&&result.could_not_apply.length>0&&<div style={{color:"#8b1a1a"}}>Could not be given (the Expert's limit or a conflict): {result.could_not_apply.join(", ")}.</div>}
    </div>}
  </div>;
}

function EntSkin({row,data,toast,onChanged,onOpenBranding}){
  const e=row.ent;
  const[skin,setSkin]=useState(e.brand_profile_id||"");
  const[domain,setDomain]=useState(e.domain||"");
  const[busy,setBusy]=useState(false);
  const save=async()=>{
    setBusy(true);
    const{error}=await sb.rpc("enterprise_link_skin",{p_enterprise_id:row.id,p_brand_profile_id:skin||null,p_domain:domain.trim()||null});
    setBusy(false);
    if(error){toast(/enterprises_domain_key/.test(error.message)?"Another firm already uses that domain.":/enterprises_domain_check/.test(error.message)?"Enter just the host name, like portal.firm.com.":error.message,"error");return;}
    toast("Saved");await onChanged();
  };
  return <div style={entCard}>
    <div style={entLab}>Skin and domain</div>
    <p style={{fontSize:12.5,color:B.textSoft,margin:"0 0 12px",lineHeight:1.6,maxWidth:640}}>The skin is the firm's look: name, colors, logo. The domain is the web address the firm's households use. Linking them here records the choice; showing the skin by address comes with the domain work.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(260px,100%),1fr))",gap:12,maxWidth:760}}>
      <Field label="Skin"><Sel value={skin} onChange={ev=>setSkin(ev.target.value)}><option value="">None</option>{data.skins.map(s=><option key={s.id} value={s.id}>{s.brand_name}</option>)}</Sel></Field>
      <Field label="Domain"><Inp placeholder="portal.firm.com" value={domain} onChange={ev=>setDomain(ev.target.value)}/></Field>
    </div>
    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
      <Btn small disabled={busy||(skin===(e.brand_profile_id||"")&&domain.trim().toLowerCase()===(e.domain||""))} onClick={save}>{busy?"Saving…":"Save"}</Btn>
      {onOpenBranding&&<Btn small variant="ghost" onClick={onOpenBranding}>Edit skins in Branding</Btn>}
    </div>
  </div>;
}

function entRebateWindow(e){
  const now=new Date();
  let due;
  if(e.maintenance_start_date){
    due=new Date(e.maintenance_start_date+"T00:00:00Z");
    while(due<now)due=new Date(Date.UTC(due.getUTCFullYear()+1,due.getUTCMonth(),due.getUTCDate()));
  }else due=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
  const from=new Date(Date.UTC(due.getUTCFullYear()-1,due.getUTCMonth(),due.getUTCDate()));
  return{due,from,fromISO:from.toISOString().slice(0,10),dueISO:due.toISOString().slice(0,10),hasDue:!!e.maintenance_start_date};
}
function EntContract({row,toast,onChanged}){
  const e=row.ent;
  const blank=v=>v==null?"":String(v);
  const[f,setF]=useState({contract_signed_at:blank(e.contract_signed_at),build_fee:blank(e.build_fee),build_fee_paid_at:blank(e.build_fee_paid_at),maintenance_fee:blank(e.maintenance_fee),maintenance_start_date:blank(e.maintenance_start_date),rebate_threshold:blank(e.rebate_threshold),contract_notes:blank(e.contract_notes)});
  const[busy,setBusy]=useState(false);
  const[win,setWin]=useState(null);
  const w=entRebateWindow(e);
  useEffect(()=>{
    sb.from("billing_ledger").select("amount").eq("enterprise_id",row.id).gte("period_month",w.fromISO).lt("period_month",w.dueISO).then(({data:d})=>setWin((d||[]).reduce((s,x)=>s+(Number(x.amount)||0),0)));
  },[row.id,e.maintenance_start_date]);
  const set=k=>ev=>setF(p=>({...p,[k]:ev.target.value}));
  const save=async()=>{
    const num=k=>f[k]===""?null:Number(f[k]);
    for(const k of["build_fee","maintenance_fee","rebate_threshold"])if(f[k]!==""&&!(Number(f[k])>=0)){toast("Fees and the threshold must be zero or more","error");return;}
    setBusy(true);
    const{error}=await sb.from("enterprises").update({
      contract_signed_at:f.contract_signed_at||null,build_fee:num("build_fee"),build_fee_paid_at:f.build_fee_paid_at||null,
      maintenance_fee:num("maintenance_fee"),maintenance_start_date:f.maintenance_start_date||null,rebate_threshold:num("rebate_threshold"),
      contract_notes:f.contract_notes.trim()||null,
    }).eq("id",row.id);
    setBusy(false);
    if(error){toast(error.message,"error");return;}
    toast("Saved");await onChanged();
  };
  const thr=Number(e.rebate_threshold)||0;
  const runRate=(Number(row.rev.total_revenue)||0)*12;
  const pct=thr>0&&win!=null?Math.min(100,Math.round(100*win/thr)):0;
  return <div>
    <div style={entCard}>
      <div style={entLab}>Rebate test</div>
      <p style={{fontSize:12.5,color:B.textSoft,margin:"0 0 12px",lineHeight:1.6,maxWidth:700}}>
        Revenue billed through ORDANIS to this firm's households (plan fees plus usage, from the billing ledger), over the 12 months before the maintenance fee is due. It leaves out the build and maintenance fees the firm itself pays.
        {w.hasDue?` Window: ${entDay(w.fromISO)} to ${entDay(w.dueISO)} (next fee due).`:" Set a maintenance start date to measure the right window. Until then this shows the next 12 months back from the end of this month."}
      </p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(190px,100%),1fr))",gap:10}}>
        <EntTile label="Revenue in the window" value={win==null?"…":money2(win)} sub={win===0?"Nothing in the ledger yet":undefined}/>
        <EntTile label="Threshold" value={thr>0?money2(thr):"Not set"}/>
        <EntTile label="Still to reach" value={thr>0&&win!=null?money2(Math.max(0,thr-win)):"—"}/>
        <EntTile label="Run rate" value={money2(runRate)} sub="This month's billed revenue × 12"/>
      </div>
      {thr>0&&<div style={{marginTop:14}}><div style={{height:8,background:B.borderLight,borderRadius:8,overflow:"hidden"}}><div style={{width:pct+"%",height:"100%",background:B.gold}}/></div><div style={{fontSize:11.5,color:B.textSoft,marginTop:5}}>{pct}% of the threshold</div></div>}
    </div>
    <div style={entCard}>
      <div style={entLab}>Contract and fees</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(220px,100%),1fr))",gap:12,maxWidth:900}}>
        <Field label="Contract signed"><Inp type="date" value={f.contract_signed_at} onChange={set("contract_signed_at")}/></Field>
        <Field label="Build fee ($)"><Inp type="number" min="0" step="0.01" value={f.build_fee} onChange={set("build_fee")}/></Field>
        <Field label="Build fee paid on"><Inp type="date" value={f.build_fee_paid_at} onChange={set("build_fee_paid_at")}/></Field>
        <Field label="Maintenance fee ($ a year)"><Inp type="number" min="0" step="0.01" value={f.maintenance_fee} onChange={set("maintenance_fee")}/></Field>
        <Field label="Maintenance starts"><Inp type="date" value={f.maintenance_start_date} onChange={set("maintenance_start_date")}/></Field>
        <Field label="Rebate threshold ($)"><Inp type="number" min="0" step="1" value={f.rebate_threshold} onChange={set("rebate_threshold")}/></Field>
      </div>
      <Field label="Notes"><textarea value={f.contract_notes} onChange={set("contract_notes")} rows={3} style={{width:"100%",maxWidth:900,boxSizing:"border-box",padding:"8px 10px",border:`1px solid ${B.border}`,borderRadius:8,fontSize:13,fontFamily:"inherit",color:B.text,resize:"vertical"}}/></Field>
      <Btn small disabled={busy} onClick={save}>{busy?"Saving…":"Save contract terms"}</Btn>
    </div>
  </div>;
}

function EntActivity({row,data}){
  const[ev,setEv]=useState(null);
  useEffect(()=>{
    sb.from("enterprise_membership_events").select("id,event_type,how,family_name,from_enterprise_id,to_enterprise_id,actor_id,actor_role,consent_note,detail,created_at")
      .or(`to_enterprise_id.eq.${row.id},from_enterprise_id.eq.${row.id}`).order("created_at",{ascending:false}).limit(80).then(({data:d})=>setEv(d||[]));
  },[row.id]);
  const who=id=>{const u=data.users.find(x=>x.id===id);return u?(u.full_name||u.email):"System";};
  const firm=id=>id?((data.ents.find(x=>x.id===id)||{}).name||"another firm"):"ORDANIS direct";
  const line=x=>{
    const d=x.detail||{};
    if(x.event_type==="joined")return`${x.family_name} joined (${ENT_HOW[x.how]||x.how||""})`;
    if(x.event_type==="moved")return`${x.family_name} moved from ${firm(x.from_enterprise_id)} to ${firm(x.to_enterprise_id)} (${ENT_HOW[x.how]||x.how||""})`;
    if(x.event_type==="removed")return`${x.family_name} removed from ${firm(x.from_enterprise_id)}`;
    if(x.event_type==="default_expert_set")return d.expert_email?`Default Expert set to ${d.expert_email}${d.applied_to_existing?`, given to ${d.applied_to_existing} existing household${d.applied_to_existing===1?"":"s"}`:""}`:"Default Expert cleared";
    if(x.event_type==="status_changed")return`${d.field==="code_active"?"Code":"Firm"} switched ${d.value?"on":"off"}`;
    if(x.event_type==="skin_linked")return`Skin or domain linked${d.domain?` (${d.domain})`:""}`;
    return ENT_EVENT[x.event_type]||x.event_type;
  };
  return <div style={entCard}>
    <div style={entLab}>Activity</div>
    {ev===null?<Empty text="Loading…"/>:!ev.length?<Empty text="Nothing yet."/>:ev.map(x=><div key={x.id} style={{padding:"9px 0",borderBottom:`1px solid ${B.borderLight}`}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div style={{fontSize:13,color:B.text}}><strong style={{color:B.navy}}>{ENT_EVENT[x.event_type]||x.event_type}</strong> · {line(x)}</div>
        <div style={{fontSize:11.5,color:B.textMute,whiteSpace:"nowrap"}}>{entDay(x.created_at)} · {x.actor_id?who(x.actor_id):"Stripe or system"}</div>
      </div>
      {x.consent_note&&<div style={{fontSize:11.5,color:B.textSoft,marginTop:2}}>{x.consent_note}</div>}
    </div>)}
  </div>;
}

export { BrandingView, Dashboard, DashboardOnDemand, EnterprisesView, FamiliesPagedView, FamiliesView, FirmBillingView, NotesView, PlanRequestsView, PortfolioView, ProspectContactsView, ProspectPipelineView, ResourcesView, ScopedStaffView, SignupsOnDemand, SignupsRevenueView, StateRulesView, TasksView, UserManagementView, UtilizationView, WithAllFamilies, FirmDashboard, PartnerDashboard };
