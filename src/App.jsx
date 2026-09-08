// PCM Family Office Platform — App.jsx
// BUILD 2026-05-05 · Cash Flow (income+expenses+reorder) · MoneyInput commas · smart chart axis · client read-only · mobile
import { useState, useEffect, useMemo, useCallback, useRef, Component } from "react";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { buildActivityReportPdf, AR_PERIODS, fig as arFig } from "./activityReport.js";
import { derivePropertyEvents, findProbableDuplicates } from "./propertyCashFlow.js";
import { validateFolderName, buildFolderRows, folderSummary, canDeleteFolder } from "./vaultFolders.js";
import { PLANS, PLAN_BLURB, planAllows, planLabel } from "./plans.js";
// PCM Platform v5.0 — build 20260429
//
// Nothing PCM-specific is imported here any more, and that is deliberate.
//
// This file used to import six base64-encoded PDF templates (pcm*Template.js,
// ~3.4MB) plus PCM_LOGO/PCM_MARK from logo.js (~528KB). Because they were
// bundled rather than looked up, every white-label tenant shipped and served
// PCM's paperwork: a licensed firm generating a Client Services Agreement got a
// contract naming PCM Family Office as the counterparty, and an ACH form
// authorising debits to PCM's account. The logo constants were worse than
// unnecessary — they were imported and never referenced, so PCM's mark sat
// inside every tenant's JS bundle for no reason at all.
//
// Document templates are now per-tenant data resolved at runtime from
// brand_documents (see BRAND_DOCS below). A tenant with no template on file gets
// a blocked tile, never another firm's contract.

// Backend + brand are env-overridable so the exact same codebase can be
// deployed as a white-label instance (e.g. Ordanis demo) from a second Vercel
// project with different VITE_* env vars — with NO env vars set, everything
// defaults to the PCM production values below, so this deploy is unaffected.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://unkirihxtruhdjeldfpm.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVua2lyaWh4dHJ1aGRqZWxkZnBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTA3MjUsImV4cCI6MjA5MTcyNjcyNX0._Ve9Pr3ooja-YdHYFIupebaZRhDjmJDnz2b-vzrhY04";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── WHITE-LABEL BRAND CONFIG ─────────────────────────────────────────────────
// Ordanis is the product. Every deployment — including PCM's own — is a tenant
// that supplies its own identity through these env vars; with none set you get
// plain Ordanis. (PCM_LOGO/PCM_MARK stay bundled only as the last-resort image
// fallback so the app never renders a broken logo.)
const BRAND = {
  name: import.meta.env.VITE_BRAND_NAME || "Ordanis",
  short: import.meta.env.VITE_BRAND_SHORT || "Ordanis",
  tagline: import.meta.env.VITE_BRAND_TAGLINE || "PRIVATE WEALTH OPERATING SYSTEM",
  contactEmail: import.meta.env.VITE_BRAND_CONTACT_EMAIL || "",
  emailDomain: import.meta.env.VITE_BRAND_EMAIL_DOMAIN || "ordanisos.com",
  logo: import.meta.env.VITE_BRAND_LOGO_URL || "/ordanis-logo.png",
  mark: import.meta.env.VITE_BRAND_MARK_URL || "/ordanis-mark.png",
  favicon: import.meta.env.VITE_BRAND_FAVICON_URL || "",
};

// ── MOBILE DETECTION ──────────────────────────────────────────────────────────
const MOBILE_BREAKPOINT = 768;
// MOBILE_LAYOUT_PATCH — breakpoint is a parameter so callers that need a different
// threshold (Modal switches to a bottom sheet at 640, not 768) can still get a
// reactive value instead of computing one by hand and missing resize events.
function useIsMobile(bp=MOBILE_BREAKPOINT){
  const[isMobile,setIsMobile]=useState(typeof window!=="undefined"&&window.innerWidth<bp);
  useEffect(()=>{
    const onResize=()=>setIsMobile(window.innerWidth<bp);
    window.addEventListener("resize",onResize);
    return()=>window.removeEventListener("resize",onResize);
  },[bp]);
  return isMobile;
}

// ── BRAND PALETTE ─────────────────────────────────────────────────────────────
// Every colour here is env-overridable so a white-label tenant can be re-skinned
// without touching code. Defaults are PCM's exact original values, so a deploy
// with no VITE_BRAND_* colour vars set renders identically to before.
// The keys keep their original names (navy/gold) for compatibility with the ~250
// existing references; semantically they are now "primary" and "accent".
const hexToRgb=h=>{
  const s=String(h||"").replace("#","");
  const full=s.length===3?s.split("").map(c=>c+c).join(""):s;
  const i=parseInt(full,16);
  return Number.isNaN(i)?[9,43,73]:[(i>>16)&255,(i>>8)&255,i&255];
};
const PRIMARY=import.meta.env.VITE_BRAND_PRIMARY||"#092b49";
const PRIMARY_MID=import.meta.env.VITE_BRAND_PRIMARY_MID||"#293d5c";
const ACCENT=import.meta.env.VITE_BRAND_ACCENT||"#ceb684";
const _pr=hexToRgb(PRIMARY);
const B = {
  navy:PRIMARY,navyMid:PRIMARY_MID,gold:ACCENT,
  goldLight:import.meta.env.VITE_BRAND_ACCENT_LIGHT||"#dfc99a",
  white:"#ffffff",text:PRIMARY,textMid:PRIMARY_MID,
  textSoft:import.meta.env.VITE_BRAND_TEXT_SOFT||"#5a6e84",
  textMute:import.meta.env.VITE_BRAND_TEXT_MUTE||"#8fa0b2",
  border:import.meta.env.VITE_BRAND_BORDER||"#d8cdb8",
  borderLight:import.meta.env.VITE_BRAND_BORDER_LIGHT||"#ede8de",
  bg:import.meta.env.VITE_BRAND_BG||"#f9f7f3",bgCard:"#ffffff",
  shadow:`0 2px 16px rgba(${_pr[0]},${_pr[1]},${_pr[2]},0.07)`,
  shadowMd:`0 8px 40px rgba(${_pr[0]},${_pr[1]},${_pr[2]},0.13)`,
};

// ── BUILD VERSION / UPDATE DETECTION ─────────────────────────────────────────
// This app is typically left open for hours, so a deploy would otherwise go
// unnoticed until someone happened to reload. The build id is stamped into the
// bundle at build time and also published as /version.json; polling that file
// tells a running tab that a newer build is live.
// eslint-disable-next-line no-undef
const BUILD_ID=typeof __BUILD_ID__!=="undefined"?__BUILD_ID__:"dev";
// Clears everything a browser might replay from an earlier build before reloading:
// the Cache Storage entries the service worker keeps, and the worker itself.
async function hardReload(){
  try{
    if("caches" in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
    if(navigator.serviceWorker){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(async r=>{
        if(r.waiting)r.waiting.postMessage("SKIP_WAITING");
        try{await r.update();}catch(_e){}
      }));
    }
  }catch(_e){/* a failed cleanup shouldn't block the reload */}
  window.location.reload();
}
function useBuildUpdate(){
  const[stale,setStale]=useState(false);
  useEffect(()=>{
    if(BUILD_ID==="dev")return;           // no deploys to detect while developing
    let stopped=false;
    const check=async()=>{
      if(stopped||document.hidden)return;
      try{
        const r=await fetch("/version.json",{cache:"no-store"});
        if(!r.ok)return;
        const j=await r.json();
        if(j&&j.build&&j.build!==BUILD_ID)setStale(true);
      }catch(_e){/* offline or blocked — try again next tick */}
    };
    check();
    const id=setInterval(check,120000);            // every two minutes
    document.addEventListener("visibilitychange",check);
    return()=>{stopped=true;clearInterval(id);document.removeEventListener("visibilitychange",check);};
  },[]);
  return stale;
}
function UpdateBanner(){
  const stale=useBuildUpdate();
  if(!stale)return null;
  return <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:1200,background:B.navy,color:B.white,
    padding:"11px 18px",display:"flex",alignItems:"center",justifyContent:"center",gap:14,flexWrap:"wrap",
    boxShadow:"0 -4px 18px rgba(0,0,0,0.22)",borderTop:`2px solid ${B.gold}`}}>
    <span style={{fontSize:13}}>A newer version of {BRAND.name} is available.</span>
    <button onClick={hardReload} style={{background:B.gold,color:B.navy,border:"none",borderRadius:7,
      padding:"7px 16px",fontSize:12.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit",letterSpacing:"0.03em"}}>
      Reload now
    </button>
  </div>;
}

// ── RUNTIME BRAND PROFILES ───────────────────────────────────────────────────
// Opt-in (VITE_BRAND_RUNTIME=1) database-driven branding, used on the demo /
// pitch instance so it can be re-skinned for a different prospect instantly,
// with no rebuild, and switched back and forth between concurrent sales cycles.
// Deployments without the flag (i.e. PCM production) never query for it and
// behave exactly as before.
const RUNTIME_BRAND = String(import.meta.env.VITE_BRAND_RUNTIME||"")==="1";

// Whether the Branding SWITCHER is offered, which is a separate question from
// whether branding is read at runtime.
//
// Every client instance needs RUNTIME_BRAND: without it the app falls back to the
// bundled defaults and serves the vendor's own logo to the client's families. But
// none of them should get the admin screen — branding is applied by us at
// provisioning, and a firm that can change its own skin can set an unreadable
// palette or another firm's identity on its own production instance.
//
// Set VITE_BRAND_ADMIN=1 on the demo only.
const BRAND_ADMIN = String(import.meta.env.VITE_BRAND_ADMIN||"")==="1";
// BRAND and B are plain objects referenced by identity throughout the app, so
// applying a profile is an in-place merge — no re-plumbing of the hundreds of
// existing B.navy / BRAND.name references, and one re-render picks it all up.
function applyBrandProfile(row){
  if(!row)return;
  const set=(obj,key,val)=>{if(val!==null&&val!==undefined&&val!=="")obj[key]=val;};
  // A tenant replacing their logo keeps the same filename, so the browser would
  // happily go on showing the previous image. Tagging the URL with the profile's
  // updated_at changes the URL whenever the brand record changes, which forces a
  // fresh fetch exactly when it matters and still allows caching in between.
  const stamp=row.updated_at?String(Date.parse(row.updated_at)||"").slice(-8):"";
  const bust=u=>{
    if(!u||!stamp)return u;
    if(u.startsWith("data:"))return u;          // inline images have nothing to revalidate
    return u+(u.includes("?")?"&":"?")+"v="+stamp;
  };
  set(BRAND,"name",row.brand_name);
  set(BRAND,"short",row.brand_short);
  set(BRAND,"tagline",row.tagline);
  set(BRAND,"contactEmail",row.contact_email);
  set(BRAND,"emailDomain",row.email_domain);
  set(BRAND,"logo",bust(row.logo_url));
  set(BRAND,"mark",bust(row.mark_url));
  // BRAND_FAVICON_PATCH
  // Separate asset because the two surfaces need opposite artwork; see the
  // brand_favicon_separate_from_mark migration.
  set(BRAND,"favicon",bust(row.favicon_url));
  set(B,"navy",row.color_primary);
  set(B,"text",row.color_primary);
  set(B,"navyMid",row.color_primary_mid);
  set(B,"textMid",row.color_primary_mid);
  set(B,"gold",row.color_accent);
  set(B,"goldLight",row.color_accent_light);
  set(B,"bg",row.color_bg);
  set(B,"border",row.color_border);
  set(B,"borderLight",row.color_border_light);
  set(B,"textSoft",row.color_text_soft);
  set(B,"textMute",row.color_text_mute);
  const rgb=hexToRgb(B.navy);
  B.shadow=`0 2px 16px rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.07)`;
  B.shadowMd=`0 8px 40px rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.13)`;
  // `inp` (the shared text-input style) snapshots B's values when this module is
  // first evaluated, which happens before the profile is fetched — so it has to
  // be re-synced explicitly or every input would keep the previous palette.
  inp.background=B.bg;inp.border=`1px solid ${B.border}`;inp.color=B.text;
  if(typeof document!=="undefined"){
    document.title=BRAND.name;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute("content",B.navy);
    // Swap the tab icon to the tenant's mark as well. Note this only affects a
    // live browser session — link-preview crawlers and the initial favicon come
    // from the build-time <head> (see vite.config.js).
    // Prefer the dedicated favicon; fall back to the mark so a brand that has not
    // supplied one behaves exactly as before.
    const _tabIcon=BRAND.favicon||BRAND.mark;
    if(_tabIcon){
      document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]')
        .forEach(l=>l.setAttribute("href",_tabIcon));
    }
  }
}
// Read the active profile. Anonymous-readable by design: the login screen has to
// be branded before anyone signs in. Any failure is non-fatal — the app simply
// keeps its build-time branding rather than failing to load.
async function loadActiveBrandProfile(){
  if(!RUNTIME_BRAND)return;
  try{
    const{data,error}=await sb.from("brand_profiles").select("*").eq("is_active",true).maybeSingle();
    if(error||!data)return;
    applyBrandProfile(data);
  }catch(_e){/* keep build-time branding */}
}

// ── PER-TENANT DOCUMENT TEMPLATES ────────────────────────────────────────────
// The fillable client documents on the Resources tab are the tenant firm's own
// paperwork — their letterhead, and in the agreement and ACH forms their legal
// entity named as the counterparty. They are therefore data, held in the
// brand_documents table and the private `brand-documents` Storage bucket, and
// resolved per brand by the active_brand_documents() function.
//
// Unlike loadActiveBrandProfile this is NOT gated on RUNTIME_BRAND: a tenant
// that brands itself purely through build-time env vars still stores its
// templates here, as the project default (brand_profile_id IS NULL).
//
// `loaded` is tracked separately from emptiness so the UI can distinguish "still
// fetching" from "this firm has supplied nothing", and never implies the latter
// while the former is true.
const BRAND_DOCS={loaded:false,error:null,byKey:{}};

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

// ── THE FIRM'S STANDARD FEE ──────────────────────────────────────────────────
// Pre-fills the fee on the Client Services Agreement and the ACH authorisation.
// Held on the brand record because it is the firm's commercial term, not the
// platform's: it used to be hardcoded as PCM's 5,000.00 / 60,000.00, which every
// tenant inherited as the suggested figure on a document about to be signed.
//
// Like the document templates, and for the same reason, this is NOT gated on
// RUNTIME_BRAND — a deployment that brands itself from build-time env vars still
// keeps its commercial terms in the database, and gating the read would have made
// the value unreachable on exactly that deployment.
//
// null means the firm has not set one. The field is then left blank for the Expert
// to complete, which is visible and harmless. There is deliberately no fallback.
const FIRM_DEFAULTS={loaded:false,monthlyFee:null,onboardingFee:null,
  // Opt-in per firm. Default false so a tenant that has not categorised its
  // expenses keeps exactly the numbers it had before this feature existed.
  derivePropertyCosts:false};

async function loadFirmDefaults(){
  try{
    const{data,error}=await sb.from("brand_profiles")
      .select("default_monthly_fee, default_onboarding_fee, derive_property_costs").eq("is_active",true).maybeSingle();
    if(error)throw error;
    const num=v=>{ if(v==null)return null; const n=Number(v); return Number.isFinite(n)?n:null; };
    FIRM_DEFAULTS.monthlyFee=num(data?.default_monthly_fee);
    FIRM_DEFAULTS.onboardingFee=num(data?.default_onboarding_fee);
    FIRM_DEFAULTS.derivePropertyCosts=data?.derive_property_costs===true;
  }catch(_e){
    // No brand row, no column, or no access: behave as "not set" rather than
    // guessing a number onto a contract.
    FIRM_DEFAULTS.monthlyFee=null;
    FIRM_DEFAULTS.onboardingFee=null;
    // Fail CLOSED: an unreadable brand row must not switch on a behaviour that
    // changes what a client is told they spend.
    FIRM_DEFAULTS.derivePropertyCosts=false;
  }finally{
    FIRM_DEFAULTS.loaded=true;
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
const PRIORITY_COLORS={
  High:{bg:"#fde8e8",text:"#8b1a1a",dot:"#d43030"},
  Medium:{bg:"#fef3e2",text:"#8a5c00",dot:"#d4900a"},
  Low:{bg:"#e8f0f8",text:"#293d5c",dot:"#293d5c"},
};
const PROP_TYPES=["Residential","Commercial","Industrial","Land","Mixed Use","Vacation","Boat","Car","Plane"];
const LOAN_TYPES=["Fixed","ARM","Interest Only","Balloon","Bridge","HELOC"];
const VALUABLE_CATS=["Car / Vehicle","Jewelry","Art","Watch","Boat / Watercraft","Other"];
const ACCT_TYPES=["Investment","Brokerage","Retirement (IRA)","401(k)","Trust","Savings","Other","Checking","Money Market","Line of Credit"];

// ── CASH FLOW ─────────────────────────────────────────────────────────────────
const CF_EVENT_TYPES=["Salary","Bonus","Sale","RSU","Grant","PE Deal","Rental Income","Distribution","Other Income","Other Expense"];
const CF_EXPENSE_CATEGORIES=["Rent/Mortgage","Utilities","Storage","House Cleaning","Car","School","Life Insurance","Other Insurance","Grocery","Misc","Legal","Shopping","Personal Care","Gym/Spa","Investments","Savings","Other"];
const CF_FREQUENCIES=[
  {value:"once",label:"One-time"},
  {value:"weekly",label:"Weekly"},
  {value:"biweekly",label:"Bi-weekly"},
  {value:"monthly",label:"Monthly"},
  {value:"quarterly",label:"Quarterly"},
  {value:"annually",label:"Annually"},
];
const CF_TAX_TREATMENTS=[
  {value:"ordinary",label:"Ordinary Income (W-2, Salary, Bonus, RSU vesting)"},
  {value:"ltcg",label:"Long-Term Capital Gains (held >1 year)"},
  {value:"stcg",label:"Short-Term Capital Gains (held <1 year, taxed as ordinary)"},
  {value:"qualified_div",label:"Qualified Dividends (LTCG rates)"},
  {value:"none",label:"Non-taxable / Already taxed"},
];
const CF_PROJECTION_OPTIONS=[
  {value:12,label:"12 Months"},
  {value:24,label:"2 Years"},
  {value:36,label:"3 Years"},
  {value:60,label:"5 Years"},
  {value:84,label:"7 Years"},
  {value:120,label:"10 Years"},
];

// 2026 Federal Tax Brackets (projected based on inflation adjustments from 2025)
// Source: IRS Rev. Proc. 2025-32 (official 2026 tax year brackets, OBBBA-permanent structure)
const TAX_BRACKETS_2026={
  single:[
    {min:0,max:12400,rate:0.10},
    {min:12400,max:50400,rate:0.12},
    {min:50400,max:105700,rate:0.22},
    {min:105700,max:201775,rate:0.24},
    {min:201775,max:256225,rate:0.32},
    {min:256225,max:640600,rate:0.35},
    {min:640600,max:Infinity,rate:0.37},
  ],
  mfj:[
    {min:0,max:24800,rate:0.10},
    {min:24800,max:100800,rate:0.12},
    {min:100800,max:211400,rate:0.22},
    {min:211400,max:403550,rate:0.24},
    {min:403550,max:512450,rate:0.32},
    {min:512450,max:768700,rate:0.35},
    {min:768700,max:Infinity,rate:0.37},
  ],
};
// 2026 federal standard deduction (IRS Rev. Proc. 2025-32 / OBBBA). Applied to ordinary income event income, once per tax year, before federal brackets. State/local rates apply to full gross.
const STANDARD_DEDUCTION_2026={single:16100,mfj:32200};
// Long-term capital gains brackets for 2026 (IRS Rev. Proc. 2025-32)
const LTCG_BRACKETS_2026={
  single:[
    {min:0,max:49450,rate:0.00},
    {min:49450,max:545500,rate:0.15},
    {min:545500,max:Infinity,rate:0.20},
  ],
  mfj:[
    {min:0,max:98900,rate:0.00},
    {min:98900,max:613700,rate:0.15},
    {min:613700,max:Infinity,rate:0.20},
  ],
};
// Net Investment Income Tax (NIIT) thresholds — 3.8% on capital gains above this
const NIIT_THRESHOLD={single:200000,mfj:250000};
const NIIT_RATE=0.038;

// State income tax — top marginal rates as of 2025-2026.
// Values are top brackets; using these for high-income family-office clients.
// Sources: state revenue dept publications. Rates change yearly — review annually.
const STATE_TAX_RATES=[
  {code:"AL",name:"Alabama",rate:5.0},
  {code:"AK",name:"Alaska",rate:0.0},
  {code:"AZ",name:"Arizona",rate:2.5},
  {code:"AR",name:"Arkansas",rate:3.9},
  {code:"CA",name:"California",rate:13.3},
  {code:"CO",name:"Colorado",rate:4.4},
  {code:"CT",name:"Connecticut",rate:6.99},
  {code:"DE",name:"Delaware",rate:6.6},
  {code:"DC",name:"District of Columbia",rate:10.75},
  {code:"FL",name:"Florida",rate:0.0},
  {code:"GA",name:"Georgia",rate:5.39},
  {code:"HI",name:"Hawaii",rate:11.0},
  {code:"ID",name:"Idaho",rate:5.695},
  {code:"IL",name:"Illinois",rate:4.95},
  {code:"IN",name:"Indiana",rate:3.0},
  {code:"IA",name:"Iowa",rate:3.8},
  {code:"KS",name:"Kansas",rate:5.58},
  {code:"KY",name:"Kentucky",rate:4.0},
  {code:"LA",name:"Louisiana",rate:3.0},
  {code:"ME",name:"Maine",rate:7.15},
  {code:"MD",name:"Maryland",rate:5.75},
  {code:"MA",name:"Massachusetts",rate:9.0},
  {code:"MI",name:"Michigan",rate:4.25},
  {code:"MN",name:"Minnesota",rate:9.85},
  {code:"MS",name:"Mississippi",rate:4.4},
  {code:"MO",name:"Missouri",rate:4.7},
  {code:"MT",name:"Montana",rate:5.9},
  {code:"NE",name:"Nebraska",rate:5.2},
  {code:"NV",name:"Nevada",rate:0.0},
  {code:"NH",name:"New Hampshire",rate:0.0},
  {code:"NJ",name:"New Jersey",rate:10.75},
  {code:"NM",name:"New Mexico",rate:5.9},
  {code:"NY",name:"New York",rate:10.9},
  {code:"NC",name:"North Carolina",rate:4.5},
  {code:"ND",name:"North Dakota",rate:2.5},
  {code:"OH",name:"Ohio",rate:3.5},
  {code:"OK",name:"Oklahoma",rate:4.75},
  {code:"OR",name:"Oregon",rate:9.9},
  {code:"PA",name:"Pennsylvania",rate:3.07},
  {code:"RI",name:"Rhode Island",rate:5.99},
  {code:"SC",name:"South Carolina",rate:6.2},
  {code:"SD",name:"South Dakota",rate:0.0},
  {code:"TN",name:"Tennessee",rate:0.0},
  {code:"TX",name:"Texas",rate:0.0},
  {code:"UT",name:"Utah",rate:4.55},
  {code:"VT",name:"Vermont",rate:8.75},
  {code:"VA",name:"Virginia",rate:5.75},
  {code:"WA",name:"Washington",rate:0.0},
  {code:"WV",name:"West Virginia",rate:5.12},
  {code:"WI",name:"Wisconsin",rate:7.65},
  {code:"WY",name:"Wyoming",rate:0.0},
];

// Calculate marginal federal tax on an additional dollar at given income level
function marginalRate(income,brackets){
  for(const b of brackets){if(income>=b.min&&income<b.max)return b.rate;}
  return brackets[brackets.length-1].rate;
}
// Calculate effective tax owed on an amount given a base income (for marginal stacking)
function calcOrdinaryTax(amount,baseIncome,filingStatus){
  const brackets=TAX_BRACKETS_2026[filingStatus]||TAX_BRACKETS_2026.mfj;
  let remaining=amount;let tax=0;let cur=baseIncome;
  for(const b of brackets){
    if(remaining<=0)break;
    if(cur>=b.max)continue;
    const room=b.max-Math.max(cur,b.min);
    const inThisBracket=Math.min(remaining,room);
    if(inThisBracket>0){tax+=inThisBracket*b.rate;remaining-=inThisBracket;cur+=inThisBracket;}
  }
  return tax;
}
function calcLTCGTax(amount,baseIncome,filingStatus){
  const brackets=LTCG_BRACKETS_2026[filingStatus]||LTCG_BRACKETS_2026.mfj;
  let remaining=amount;let tax=0;let cur=baseIncome;
  for(const b of brackets){
    if(remaining<=0)break;
    if(cur>=b.max)continue;
    const room=b.max-Math.max(cur,b.min);
    const inThisBracket=Math.min(remaining,room);
    if(inThisBracket>0){tax+=inThisBracket*b.rate;remaining-=inThisBracket;cur+=inThisBracket;}
  }
  return tax;
}
function calcNIIT(capGainsAmount,totalIncome,filingStatus){
  const threshold=NIIT_THRESHOLD[filingStatus]||NIIT_THRESHOLD.mfj;
  if(totalIncome<=threshold)return 0;
  const aboveThreshold=totalIncome-threshold;
  const taxable=Math.min(capGainsAmount,aboveThreshold);
  return Math.max(0,taxable)*NIIT_RATE;
}
// Calculate total tax + net for a single event given the family's tax context
function calcEventTax(grossAmount,treatment,baseIncome,filingStatus,stateRate,localRate){
  const gross=Number(grossAmount)||0;
  if(gross<=0||treatment==="none")return{tax:0,fedTax:0,stateTax:0,localTax:0,niit:0,net:gross};
  let fedTax=0;let niit=0;
  if(treatment==="ordinary"||treatment==="stcg"){
    fedTax=calcOrdinaryTax(gross,baseIncome,filingStatus);
  }else if(treatment==="ltcg"||treatment==="qualified_div"){
    fedTax=calcLTCGTax(gross,baseIncome,filingStatus);
    niit=calcNIIT(gross,baseIncome+gross,filingStatus);
  }
  const stateTax=gross*((Number(stateRate)||0)/100);
  const localTax=gross*((Number(localRate)||0)/100);
  const totalTax=fedTax+stateTax+localTax+niit;
  return{tax:totalTax,fedTax,stateTax,localTax,niit,net:gross-totalTax};
}
// Annualized ordinary income (ordinary + short-term gains) from the projected events, used to place the marginal bracket.
function annualOrdinaryIncome(enrichedEvents,projectionMode,projectionMonths){
  const years=Math.max(1,(projectionMode==="year"?12:(Number(projectionMonths)||12))/12);
  const ord=(enrichedEvents||[]).filter(e=>!e._excluded&&!e._baseSalary&&e.direction!=="expense"&&(e.taxTreatment==="ordinary"||e.taxTreatment==="stcg")).reduce((s,e)=>s+(Number(e.projectedGross)||0),0);
  return ord/years;
}
// All-in marginal rate (%): federal bracket on the next dollar of ordinary income (base salary + annualized ordinary income, after the standard deduction) plus state and local rates.
function marginalTaxRate(baseIncome,annualOrdinary,filingStatus,stateRate,localRate){
  const stdDed=STANDARD_DEDUCTION_2026[filingStatus]||STANDARD_DEDUCTION_2026.mfj;
  const taxable=Math.max(0,(Number(baseIncome)||0)+(Number(annualOrdinary)||0)-stdDed);
  const fed=marginalRate(taxable,TAX_BRACKETS_2026[filingStatus]||TAX_BRACKETS_2026.mfj);
  return fed*100+(Number(stateRate)||0)+(Number(localRate)||0);
}
// Expand a recurring event into monthly occurrences within projection window
// Parse a YYYY-MM-DD string as LOCAL midnight (not UTC) to avoid timezone day/month shifts
function parseLocalDate(s){
  if(!s)return new Date(NaN);
  if(typeof s==="string"){const m=s.slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(m)return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));}
  return new Date(s);
}
function expandEvent(event,projectionStart,monthsOut){
  const occurrences=[];
  const start=parseLocalDate(event.startDate);
  if(isNaN(start))return occurrences;
  const end=event.endDate?parseLocalDate(event.endDate):null;
  const projEnd=new Date(projectionStart);projEnd.setMonth(projEnd.getMonth()+monthsOut);
  const amount=Number(event.amount)||0;
  if(event.frequency==="once"){
    if(start>=projectionStart&&start<=projEnd&&(!end||start<=end)){
      occurrences.push({date:start,amount});
    }
    return occurrences;
  }
  // Recurring — advance through dates
  let cur=new Date(start);
  let safety=600; // max iterations
  while(cur<=projEnd&&safety-->0){
    if(cur>=projectionStart&&(!end||cur<=end)){
      occurrences.push({date:new Date(cur),amount});
    }
    if(event.frequency==="weekly")cur.setDate(cur.getDate()+7);
    else if(event.frequency==="biweekly")cur.setDate(cur.getDate()+14);
    else if(event.frequency==="monthly")cur.setMonth(cur.getMonth()+1);
    else if(event.frequency==="quarterly")cur.setMonth(cur.getMonth()+3);
    else if(event.frequency==="annually")cur.setFullYear(cur.getFullYear()+1);
    else break;
  }
  return occurrences;
}

// Build a month-by-month cash flow projection. Tax rates are passed in so the same
// inputs can be projected under different state/local tax scenarios (for Compare).
function buildProjection(allEvents,settings,stateRate,localRate){
  const yearMode=settings.projectionMode==="year";
  const start=new Date();
  if(yearMode){start.setMonth(0,1);}else{start.setDate(1);}
  start.setHours(0,0,0,0);
  const projMonths=yearMode?12:settings.projectionMonths;
  const months=[];
  for(let i=0;i<projMonths;i++){
    const d=new Date(start);d.setMonth(d.getMonth()+i);
    months.push({date:new Date(d),label:d.toLocaleDateString("en-US",{month:"short",year:"2-digit"}),income:0,tax:0,expense:0,gross:0,net:0});
  }
  const baseIncome=Number(settings.baseIncome)||0;
  const filing=settings.filingStatus;
  const stdDed=STANDARD_DEDUCTION_2026[filing]||STANDARD_DEDUCTION_2026.mfj;
  const sRate=(Number(stateRate)||0)/100;
  const lRate=(Number(localRate)||0)/100;
  // The standard deduction is consumed by the base salary first (it's the bottom of the income stack);
  // ordinary income events then stack on the post-deduction floor and draw any leftover deduction.
  const floor=Math.max(0,baseIncome-stdDed);
  const eventDedPerYear=Math.max(0,stdDed-baseIncome);
  const salaryIncluded=settings.includeIncome!==false;

  // Base salary: spread evenly across the projection months and taxed as ordinary income (federal from $0 after
  // the standard deduction, plus state/local on full salary). Surfaced as a read-only "Base Salary" income line.
  let salaryEvent=null;
  if(baseIncome>0){
    const monthlyBase=baseIncome/12;
    const annualBaseTax=calcOrdinaryTax(floor,0,filing)+baseIncome*(sRate+lRate);
    const monthlyBaseTax=annualBaseTax/12;
    if(salaryIncluded){months.forEach(m=>{m.income+=monthlyBase;m.gross+=monthlyBase;m.tax+=monthlyBaseTax;m.net+=monthlyBase-monthlyBaseTax;});}
    salaryEvent={id:"__base_salary",eventType:"Base Salary",direction:"income",frequency:"monthly",taxTreatment:"ordinary",amount:monthlyBase,startDate:start.toISOString().slice(0,10),endDate:null,_synthetic:true,_baseSalary:true,_excluded:!salaryIncluded,description:"Annual base salary, spread monthly",projectedGross:salaryIncluded?monthlyBase*projMonths:0,projectedTax:salaryIncluded?monthlyBaseTax*projMonths:0,projectedNet:salaryIncluded?(monthlyBase-monthlyBaseTax)*projMonths:0};
  }

  // Pass 1: expand events into occurrences. Tally expenses immediately; queue income for a chronological pass
  // so the annual standard deduction can be drawn down in date order across all income events.
  const perEvent=new Map();
  const incomeOccs=[];
  allEvents.forEach(ev=>{
    const pe={projGross:0,projTax:0,projExpense:0,excluded:false};perEvent.set(ev,pe);
    const isExpense=ev.direction==="expense";
    const excluded=isExpense?(settings.includeExpense===false):(!ev._synthetic&&settings.includeIncome===false);
    if(excluded){pe.excluded=true;return;}
    expandEvent(ev,start,projMonths).forEach(occ=>{
      const monthIdx=(occ.date.getFullYear()-start.getFullYear())*12+(occ.date.getMonth()-start.getMonth());
      if(monthIdx<0||monthIdx>=months.length)return;
      if(isExpense){
        const amt=Math.abs(Number(occ.amount)||0);
        pe.projExpense+=amt;months[monthIdx].expense+=amt;months[monthIdx].net-=amt;
      }else{
        incomeOccs.push({ev,date:occ.date,amount:Number(occ.amount)||0,treatment:ev.taxTreatment,monthIdx});
      }
    });
  });

  // Pass 2: income in date order. Ordinary income events stack on the post-deduction floor; any standard deduction
  // not used by the base salary shields the first events of each calendar year. State & local apply to full gross.
  incomeOccs.sort((a,b)=>a.date-b.date);
  const dedLeft={};
  incomeOccs.forEach(o=>{
    const pe=perEvent.get(o.ev);
    const gross=o.amount;
    months[o.monthIdx].gross+=gross;months[o.monthIdx].income+=gross;pe.projGross+=gross;
    if(gross<=0||o.treatment==="none"){months[o.monthIdx].net+=gross;return;}
    const yr=o.date.getFullYear();
    if(dedLeft[yr]===undefined)dedLeft[yr]=eventDedPerYear;
    let fedTax=0,niit=0;
    if(o.treatment==="ordinary"||o.treatment==="stcg"){
      const shield=Math.min(dedLeft[yr],gross);dedLeft[yr]-=shield;
      fedTax=calcOrdinaryTax(gross-shield,floor,filing);
    }else if(o.treatment==="ltcg"||o.treatment==="qualified_div"){
      fedTax=calcLTCGTax(gross,floor,filing);
      niit=calcNIIT(gross,baseIncome+gross,filing);
    }
    const tax=fedTax+gross*sRate+gross*lRate+niit;
    months[o.monthIdx].tax+=tax;months[o.monthIdx].net+=gross-tax;pe.projTax+=tax;
  });

  const enriched=allEvents.map(ev=>{
    const pe=perEvent.get(ev);
    if(pe.excluded)return{...ev,projectedGross:0,projectedTax:0,projectedExpense:0,projectedNet:0,_excluded:true};
    if(ev.direction==="expense")return{...ev,projectedGross:0,projectedTax:0,projectedExpense:pe.projExpense,projectedNet:-pe.projExpense};
    return{...ev,projectedGross:pe.projGross,projectedTax:pe.projTax,projectedNet:pe.projGross-pe.projTax};
  });
  if(salaryEvent)enriched.unshift(salaryEvent);
  return{monthlyData:months,enrichedEvents:enriched};
}

const REMINDER_OPTIONS=[
  {label:"1 day before",days:1},
  {label:"3 days before",days:3},
  {label:"7 days before",days:7},
  {label:"14 days before",days:14},
  {label:"30 days before",days:30},
  {label:"60 days before",days:60},
];

// Dates are stored as calendar dates ("2026-06-30"), not instants. new Date() parses
// that form as UTC midnight, so toLocaleDateString rendered it in the browser's zone
// and every user west of UTC saw the previous day: a premium due 30 June displayed as
// 29 June, and 1 January as 31 December of the PRIOR YEAR. On a tax deadline or a
// withdrawal window that is not cosmetic.
//
// parseLocalDate (defined above for cash-flow projections) already solved this. It
// simply was not used here, so every date outside the cash-flow charts was wrong.
const fmt=iso=>{
  if(!iso)return"—";
  const d=parseLocalDate(iso);
  return isNaN(d.getTime())?"—":d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
};
const fmtMoney=n=>n!=null&&n!==""?`$${Number(n).toLocaleString()}`:"—";
// Report-grade currency: always 2 decimals + thousands separators ($1,324,486.40). Avoids ragged decimals from raw toLocaleString().
const fmtUSD=n=>n!=null&&n!==""?`$${Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`:"—";
// Smart-abbreviated money for chart axis labels: $5K, $500K, $5M, $1.5M
const fmtMoneyShort=n=>{
  if(n==null||n==="")return"$0";
  const num=Number(n);
  const abs=Math.abs(num);
  const sign=num<0?"-":"";
  if(abs>=1e9)return`${sign}$${(abs/1e9).toFixed(abs>=1e10?0:1).replace(/\.0$/,"")}B`;
  if(abs>=1e6)return`${sign}$${(abs/1e6).toFixed(abs>=1e7?0:1).replace(/\.0$/,"")}M`;
  if(abs>=1e3)return`${sign}$${(abs/1e3).toFixed(abs>=1e4?0:1).replace(/\.0$/,"")}K`;
  return`${sign}$${abs.toFixed(0)}`;
};
const fmtPct=n=>n!=null&&n!==""?`${Number(n).toFixed(2)}%`:"—";
const pctChange=(s,c)=>{const sv=Number(s)||0;const cv=Number(c)||0;if(!sv)return null;return(((cv-sv)/sv)*100).toFixed(2);};

const toClient=obj=>{
  if(!obj)return obj;
  const m={family_id:"familyId",contact_id:"contactId",account_id:"accountId",account_period:"accountPeriod",as_of:"asOf",balance_as_of:"balanceAsOf",source_document_id:"sourceDocumentId",balance_source_document_id:"balanceSourceDocumentId",entered_by:"enteredBy",close_date:"closeDate",due_date:"dueDate",created_at:"createdAt",uploaded_at:"uploadedAt",advisor_name:"advisorName",advisor_email:"advisorEmail",owner_name:"ownerName",property_type:"propertyType",property_id:"propertyId",purchase_price:"purchasePrice",purchase_date:"purchaseDate",current_value:"currentValue",loan_balance:"loanBalance",interest_rate:"interestRate",loan_payment:"loanPayment",loan_maturity_date:"loanMaturityDate",loan_type:"loanType",rental_income:"rentalIncome",property_taxes:"propertyTaxes",flood_insurance:"floodInsurance",insurance_company:"insuranceCompany",insurance_premium:"insurancePremium",flood_insurance_company:"floodInsuranceCompany",flood_insurance_premium:"floodInsurancePremium",insurance_expiration:"insuranceExpiration",flood_insurance_expiration:"floodInsuranceExpiration",account_type:"accountType",starting_balance:"startingBalance",current_balance:"currentBalance",banker_name:"bankerName",make_model:"makeModel",estimated_value:"estimatedValue",file_type:"fileType",extracted_text:"extractedText",reminder_days:"reminderDays",reminder_sent:"reminderSent",full_name:"fullName",file_path:"filePath",file_size:"fileSize",uploaded_by:"uploadedBy",event_type:"eventType",start_date:"startDate",end_date:"endDate",tax_treatment:"taxTreatment",filing_status:"filingStatus",state_tax_rate:"stateTaxRate",base_income:"baseIncome",cash_flow_settings:"cashFlowSettings",hoa_fee:"hoaFee",property_management_fee_pct:"propertyManagementFeePct",include_mortgage_in_cashflow:"includeMortgageInCashflow",sort_order:"sortOrder",note_id:"noteId",recurrence_interval:"recurrenceInterval",recurrence_unit:"recurrenceUnit",completed_at:"completedAt",completed_by:"completedBy",item_key:"itemKey",item_label:"itemLabel",item_type:"itemType",occurrence_date:"occurrenceDate",second_mortgage_balance:"secondMortgageBalance",second_mortgage_payment:"secondMortgagePayment",assistant_name:"assistantName",is_advisor:"isAdvisor",is_primary:"isPrimary",updated_at:"updatedAt",is_secondary:"isSecondary",pcm_responsible:"pcmResponsible",paid_at:"paidAt",paid_by:"paidBy",vendor_family_contact_id:"vendorFamilyContactId",vendor_property_contact_id:"vendorPropertyContactId",event_id:"eventId",document_id:"documentId",downloaded_by:"downloadedBy",downloaded_at:"downloadedAt",owner_user_id:"ownerUserId",owner_email:"ownerEmail",owner_role:"ownerRole",prompt_type:"promptType",template_key:"templateKey",custom_prompt:"customPrompt",schedule_preset:"schedulePreset",schedule_dow:"scheduleDow",schedule_hour_utc:"scheduleHourUtc",last_run_at:"lastRunAt",last_run_status:"lastRunStatus",last_run_error:"lastRunError",data_source:"dataSource",can_run_scheduled_prompts:"canRunScheduledPrompts",property_section:"propertySection",expiry_date:"expiryDate",doc_type:"docType",mime_type:"mimeType"};
  return Object.fromEntries(Object.entries(obj).map(([k,v])=>[m[k]||k,v]));
};

const TABLES=["families","contacts","properties","deals","notes","tasks","portfolio_accounts","account_balances","valuables","documents","cash_flow_events","cash_flow_payment_log","note_attachments","deadline_acks","family_contacts","property_contacts"];
const FAMILY_SCOPED=["contacts","properties","deals","notes","tasks","portfolio_accounts","account_balances","valuables","documents","cash_flow_events","cash_flow_payment_log","deadline_acks","family_contacts","property_contacts"];
// Display label of the signed-in user, set at login; used to stamp task completions.
let CURRENT_USER_LABEL="";
// Display-only rename: the underlying role value stored in the DB/permissions stays "advisor";
// only the label shown to users reads "Ordanis Expert".
const ROLE_LABELS={admin:"Admin",advisor:"Ordanis Expert",client:"Client",partner:"Partner"};
const roleLabel=r=>ROLE_LABELS[(r||"").toLowerCase()]||r;


// ── UI PRIMITIVES ─────────────────────────────────────────────────────────────
function Badge({children,scheme}){
  const s=scheme||{bg:B.borderLight,text:B.navyMid,dot:B.navyMid};
  return <span style={{display:"inline-flex",alignItems:"center",gap:5,background:s.bg,color:s.text,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700,letterSpacing:"0.04em",whiteSpace:"nowrap"}}><span style={{width:6,height:6,borderRadius:"50%",background:s.dot,flexShrink:0}}/>{children}</span>;
}
function GoldLine(){return <div style={{height:1,background:`linear-gradient(90deg,transparent,${B.gold},transparent)`,margin:"0 0 16px"}}/>;}
function Spinner({size=34}){return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",flexDirection:"column",gap:14}}><div style={{width:size,height:size,border:`3px solid ${B.borderLight}`,borderTop:`3px solid ${B.gold}`,borderRadius:"50%",animation:"pcmspin 0.8s linear infinite"}}/><style>{`@keyframes pcmspin{to{transform:rotate(360deg)}}`}</style></div>;}
function Toast({msg,type}){return <div style={{position:"fixed",bottom:24,right:24,zIndex:9000,background:type==="error"?"#fde8e8":B.navy,color:type==="error"?"#8b1a1a":B.white,padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:600,boxShadow:B.shadowMd,border:`1px solid ${type==="error"?"#f5c6c6":"rgba(206,182,132,0.3)"}`}}>{type==="error"?"⚠ ":"✓ "}{msg}</div>;}

function Modal({title,onClose,wide,children}){
  const mobile=useIsMobile(640);
  return <div style={{position:"fixed",inset:0,background:"rgba(9,43,73,0.45)",zIndex:1000,display:"flex",alignItems:mobile?"flex-end":"center",justifyContent:"center",backdropFilter:"blur(3px)",padding:mobile?0:20,overflowY:"auto"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:B.white,borderRadius:mobile?"16px 16px 0 0":16,padding:mobile?"24px 20px 32px":36,width:"100%",maxWidth:mobile?"100%":wide?780:540,boxShadow:B.shadowMd,border:`1px solid ${B.borderLight}`,margin:mobile?0:"auto",maxHeight:mobile?"90vh":"none",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>{title}</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:B.textMute,fontSize:20,cursor:"pointer"}}>✕</button>
      </div>
      <GoldLine/>{children}
    </div>
  </div>;
}

const inp={width:"100%",background:B.bg,border:`1px solid ${B.border}`,borderRadius:8,padding:"9px 13px",color:B.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
// Merge (not replace) any caller-supplied style, so passing e.g. style={{flex:1}}
// for layout doesn't strip the standard background/border/padding everywhere else.
const Inp=p=><input {...p} style={{...inp,...(p.style||{})}}/>;
// Formats numbers as US dollars with commas while user types. Stores the raw numeric value (no commas) on change.
function MoneyInput({value,onChange,placeholder,style,disabled}){
  // Format number for display: 1234567.89 → "1,234,567.89"
  const fmt=(v)=>{
    if(v===""||v===null||v===undefined)return"";
    const s=String(v);
    // Allow trailing decimal point and trailing zeros
    const negative=s.startsWith("-");
    const abs=negative?s.slice(1):s;
    if(abs===""||abs===".")return s;
    const parts=abs.split(".");
    const whole=parts[0]||"0";
    const decimal=parts.length>1?"."+parts[1]:"";
    const wholeWithCommas=whole.replace(/\B(?=(\d{3})+(?!\d))/g,",");
    return(negative?"-":"")+wholeWithCommas+decimal;
  };
  // Strip non-numeric (allow leading -, decimal point) on change
  const handleChange=(e)=>{
    let raw=e.target.value;
    // Allow user to type freely; strip commas and any character not digit/period/minus
    raw=raw.replace(/,/g,"").replace(/[^0-9.\-]/g,"");
    // Only one minus, only at start
    if(raw.indexOf("-")>0)raw=raw.replace(/-/g,"");
    // Only one decimal
    const firstDot=raw.indexOf(".");
    if(firstDot!==-1){
      raw=raw.slice(0,firstDot+1)+raw.slice(firstDot+1).replace(/\./g,"");
    }
    // Pass back the cleaned numeric string (or empty)
    onChange&&onChange({target:{value:raw}});
  };
  return <input type="text" inputMode="decimal" style={style||inp} disabled={disabled} value={fmt(value)} onChange={handleChange} placeholder={placeholder||"0"}/>;
}
const Sel=({children,...p})=><select {...p} style={{...inp,cursor:"pointer",...(p.style||{})}}>{children}</select>;
function AdvisorScopeBar({userProfile,value,onChange,label="Ordanis Expert"}){
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
        <option value="">All Ordanis Experts</option>
        {advisors.map(a=><option key={a.id} value={(a.email||"").toLowerCase()}>{a.full_name||a.email}</option>)}
      </Sel>
    </div>
  </div>;
}
const Tex=p=><textarea style={{...inp,minHeight:80,resize:"vertical"}} {...p}/>;
function Field({label,children}){return <div style={{marginBottom:14}}><label style={{display:"block",fontSize:11,color:B.textSoft,marginBottom:5,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>{label}</label>{children}</div>;}
function Grid2({children}){
  return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(220px,100%),1fr))",gap:12}}>{children}</div>;
}
function Btn({children,onClick,variant="primary",small,disabled,style:ex}){
  const v={primary:{background:B.navy,color:B.white,border:"none"},ghost:{background:"transparent",color:B.navyMid,border:`1px solid ${B.border}`},danger:{background:"#fde8e8",color:"#8b1a1a",border:"1px solid #f5c6c6"},gold:{background:B.gold,color:B.navy,border:"none"}};
  return <button onClick={onClick} disabled={disabled} style={{...v[variant],borderRadius:8,padding:small?"5px 13px":"9px 20px",fontSize:small?12:13,fontWeight:700,cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",letterSpacing:"0.03em",opacity:disabled?.65:1,...ex}} onMouseEnter={e=>{if(!disabled)e.currentTarget.style.opacity=".82";}} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>{children}</button>;
}
function IRow({label,value}){return <div style={{display:"flex",gap:10,fontSize:13,padding:"5px 0",borderBottom:`1px solid ${B.borderLight}`}}><span style={{color:B.textSoft,minWidth:120,flexShrink:0,fontSize:12}}>{label}</span><span style={{color:B.text,fontWeight:600}}>{value}</span></div>;}
// Click-to-call: renders any phone number as a tel: link so it dials directly on mobile
// and prompts a calling app on desktop. Falls back to plain text if the value doesn't
// contain any digits. stopPropagation keeps taps from also triggering a parent row's
// onClick (e.g. an editable list item) when the link itself is tapped.
// PHONE_FORMAT_PATCH
// Formats as you type, and leaves alone anything it does not recognise.
//
// Only US 10-digit and 1+10 are reshaped. An extension, an international number or
// a half-typed entry is returned untouched — a formatter that rewrites input it
// does not understand is worse than none, because the user cannot correct it
// except by fighting the field.
//
// Digits are counted, not characters, so backspacing through "(239) " deletes a
// digit rather than stalling on punctuation the formatter immediately re-adds.
function formatPhoneInput(raw){
  const s=String(raw||"");
  // Let anything with a letter, extension or explicit country code pass through:
  // "+44 20 7946 0958", "555-0142 x203".
  if(/[a-zA-Z]/.test(s))return s;
  if(s.trim().startsWith("+")&&!/^\+1\b/.test(s.trim()))return s;

  const d=s.replace(/\D/g,"");
  const us=d.length===11&&d.startsWith("1")?d.slice(1):d;
  if(us.length>10)return s;                       // not a US number; leave it

  if(us.length<=3)return us;
  if(us.length<=6)return `(${us.slice(0,3)}) ${us.slice(3)}`;
  return `(${us.slice(0,3)}) ${us.slice(3,6)}-${us.slice(6,10)}`;
}

// Display form for numbers already stored in another shape. Same rules, so a list
// mixing "(239) 555-0142", "813-244-3798" and "8132500577" reads uniformly without
// anything being rewritten in the database.
function formatPhoneDisplay(raw){
  const out=formatPhoneInput(raw);
  return out||String(raw||"");
}

function PhoneLink({value,style}){
  if(!value)return null;
  const href=String(value).replace(/[^\d+]/g,"");
  if(!href)return <span style={style}>{value}</span>;
  // The tel: href keeps the raw digits; only the visible text is normalised.
  const shown=formatPhoneDisplay(value);
  return <a href={`tel:${href}`} onClick={e=>e.stopPropagation()} style={{color:"inherit",textDecoration:"none",cursor:"pointer",...style}} onMouseEnter={e=>e.currentTarget.style.textDecoration="underline"} onMouseLeave={e=>e.currentTarget.style.textDecoration="none"}>{shown}</a>;
}
// Opens a stored file in a new tab through a short-lived signed URL. Used by the
// inline "supporting document" links that sit next to figures on the property and
// valuables cards, so a user can go from a number straight to its source document
// without hunting through the Vault.
async function openStoredDoc(doc,toast){
  if(!doc?.filePath){toast&&toast("No file on record for this document","error");return;}
  const{data,error}=await sb.storage.from("documents").createSignedUrl(doc.filePath,300);
  if(error||!data?.signedUrl){toast&&toast(error?.message||"Could not open that document","error");return;}
  window.open(data.signedUrl,"_blank","noopener");
}
// Shown in place of DocLink when a section has no document yet: jumps to the
// Vault with the property and section pre-selected, so attaching a bill is one
// click from the figure it belongs to rather than a hunt through the Vault.
function AttachLink({onClick,section}){
  return <button onClick={e=>{e.stopPropagation();onClick();}} title={`Attach ${sectionLabel(section)}`}
    style={{background:"none",border:"none",padding:0,marginLeft:5,cursor:"pointer",color:B.textMute,fontSize:10.5,lineHeight:1,verticalAlign:"middle"}}
    onMouseEnter={e=>e.currentTarget.style.color=B.navy}
    onMouseLeave={e=>e.currentTarget.style.color=B.textMute}>📎</button>;
}
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

  // Upload → file lands in the Vault against this account → AI proposes figures.
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
    const bal=Number(String(form.balance).replace(/[^0-9.\-]/g,""));
    if(!form.asOf){toast("An as-of date is required — a balance without one cannot be placed in time","error");return;}
    if(!Number.isFinite(bal)){toast("Enter a balance","error");return;}
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
      // Record the period label on the document, so the Vault reads sensibly.
      if(form.documentId&&form.period){
        await sb.from("documents").update({account_period:form.period}).eq("id",form.documentId);
      }
      toast("Balance recorded");
      setForm(null);setProposal(null);
      reload("account_balances");reload("portfolio_accounts");reload("documents");
    }catch(e){toast(e.message,"error");}
    setBusy(false);
  };

  const removeEntry=async(row)=>{
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
        <Field label="Balance"><Inp value={form.balance} onChange={e=>setForm(f=>({...f,balance:e.target.value}))} placeholder="0.00"/></Field>
        <Field label="As at"><Inp type="date" value={form.asOf} onChange={e=>setForm(f=>({...f,asOf:e.target.value}))}/></Field>
      </Grid2>
      {form.documentId&&<Field label="Statement period as the firm labels it">
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

function DocLink({doc,toast,label}){
  if(!doc)return null;
  return <button onClick={e=>{e.stopPropagation();openStoredDoc(doc,toast);}} title={`Open: ${doc.name}`}
    style={{background:"none",border:"none",padding:0,marginLeft:5,cursor:"pointer",color:B.gold,fontSize:10.5,lineHeight:1,verticalAlign:"middle"}}>
    {label||"📄"}
  </button>;
}
// Click-to-email: opens the user's mail client pre-addressed to the contact.
// Mirrors PhoneLink — same stopPropagation reasoning, and falls back to plain
// text if the value isn't a usable address.
function EmailLink({value,style}){
  if(!value)return null;
  const addr=String(value).trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr))return <span style={style}>{value}</span>;
  return <a href={`mailto:${addr}`} onClick={e=>e.stopPropagation()} style={{color:"inherit",textDecoration:"none",cursor:"pointer",...style}} onMouseEnter={e=>e.currentTarget.style.textDecoration="underline"} onMouseLeave={e=>e.currentTarget.style.textDecoration="none"}>{value}</a>;
}
function SectionLabel({children}){return <div style={{fontSize:10,fontWeight:800,color:B.textMute,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8,marginTop:18,paddingBottom:4,borderBottom:`1px solid ${B.borderLight}`}}>{children}</div>;}
function Empty({text}){return <div style={{fontSize:13,color:B.textMute,padding:"12px 0",textAlign:"center"}}>{text}</div>;}
function StatBox({label,value,accent}){
  return <div style={{background:B.white,borderRadius:10,padding:"12px 14px",border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${accent||B.gold}`,boxShadow:B.shadow}}>
    <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>{label}</div>
    <div style={{fontSize:20,fontFamily:"'Cormorant Garamond',serif",color:B.navy,fontWeight:600,lineHeight:1}}>{value}</div>
  </div>;
}

// If the branded artwork fails to load (network blip, a tenant URL that has gone
// away), fall back to the brand name as text rather than leaving an empty gap
// where the logo should be — a blank header looks broken in front of a client.
function BrandImg({src,alt,style}){
  const[failed,setFailed]=useState(false);
  if(!src||failed)return <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:600,color:B.navy,whiteSpace:"nowrap"}}>{alt}</span>;
  return <img src={src} alt={alt} style={style} onError={()=>setFailed(true)}/>;
}
function PCMLogo({dark=false,compact=false}){
  // max constraints (not a fixed height) so wide white-label wordmarks scale
  // down to fit their container instead of overflowing the sidebar.
  if(dark)return <div style={{background:"rgba(255,255,255,0.97)",borderRadius:8,padding:"8px 14px",display:"inline-block"}}><BrandImg src={BRAND.logo} alt={BRAND.name} style={{maxHeight:64,maxWidth:"100%",width:"auto",height:"auto",display:"block"}}/></div>;
  if(compact)return <BrandImg src={BRAND.logo} alt={BRAND.name} style={{maxHeight:64,maxWidth:"100%",width:"auto",height:"auto",display:"block"}}/>;
  return <BrandImg src={BRAND.logo} alt={BRAND.name} style={{maxHeight:110,maxWidth:"100%",width:"auto",height:"auto",display:"block",margin:"0 auto"}}/>;
}

// ── LOGIN INTRO (tumbling cubes) ────────────────────────────────────────────
// Pure helper functions (no React/DOM-framework state) that power a one-time
// "cubes fly in from across the screen while the PCM logo fades in" intro on
// the login screen. Silent by design — browsers block audio autoplay until
// the visitor interacts, and there's no reliable way to sync a pre-scheduled
// sound to an unpredictable first click, so we dropped audio rather than
// risk a garbled/mistimed sting. Deliberately does NOT sample the logo's
// exact pixels into a mosaic either — that was fragile (occasionally hung
// and never revealed the sign-in form). Cubes just converge loosely toward
// the logo's position as a decorative burst while the crisp logo image
// fades in normally underneath/over it.
function _easeOutCubic(t){return 1-Math.pow(1-t,3);}
function _drawIntroCube(ctx,x,y,s,rot,hex,alpha){
  ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.globalAlpha=alpha;
  ctx.fillStyle=hex;ctx.fillRect(-s/2,-s/2,s,s);
  ctx.fillStyle="rgba(255,255,255,0.35)";ctx.fillRect(-s/2,-s/2,s,s*0.3);
  ctx.fillStyle="rgba(0,0,0,0.22)";ctx.fillRect(-s/2,s/2-s*0.28,s,s*0.28);
  ctx.restore();
}

// ── LOGIN SCREEN ──────────────────────────────────────────────────────────────
function LoginScreen(){
  const[mode,setMode]=useState("login");
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[error,setError]=useState("");
  const[loading,setLoading]=useState(false);
  const[resetSent,setResetSent]=useState(false);

  // Cube intro: auto-plays the moment this screen mounts (no click
  // required), once per browser session. If sessionStorage is unavailable
  // (privacy mode, sandboxed frame) it falls back straight to "done" so the
  // sign-in form is never blocked by the animation.
  // Everything here is driven by fixed wall-clock timers (not "wait until
  // every particle reports done") and wrapped in try/catch that always
  // falls through to "done" — the sign-in form must never be stuck behind
  // this animation, no matter what goes wrong.
  const[introPhase,setIntroPhase]=useState(()=>{
    try{return sessionStorage.getItem("pcmIntroSeen")==="1"?"done":"playing";}
    catch(_e){return "done";}
  });
  const[logoVisible,setLogoVisible]=useState(()=>{
    try{return sessionStorage.getItem("pcmIntroSeen")==="1";}catch(_e){return true;}
  });
  const canvasRef=useRef(null);
  const logoSlotRef=useRef(null);

  useEffect(()=>{
    if(introPhase!=="playing")return;
    let cancelled=false;
    let rafId=null;
    let logoTimer=null;
    let doneTimer=null;
    let resize=()=>{};

    const goDone=()=>{
      if(cancelled)return;
      try{sessionStorage.setItem("pcmIntroSeen","1");}catch(_e){}
      setLogoVisible(true);
      setIntroPhase("done");
    };

    try{
      const canvas=canvasRef.current;
      if(!canvas)throw new Error("no canvas");
      const ctx=canvas.getContext("2d");
      const dpr=window.devicePixelRatio||1;
      resize=()=>{
        canvas.width=window.innerWidth*dpr;canvas.height=window.innerHeight*dpr;
        canvas.style.width=window.innerWidth+"px";canvas.style.height=window.innerHeight+"px";
        ctx.setTransform(dpr,0,0,dpr,0,0);
      };
      resize();
      window.addEventListener("resize",resize);

      const TOTAL_MS=4900;      // hard cap — form + logo reveal no matter what
      const LOGO_FADE_AT=3700;  // logo starts fading in while cubes are still flying (original 1200ms + 500ms + 1000ms + another 1000ms hold)

      // Target = around the logo slot's own box (falls back to screen
      // centre if for some reason it isn't measurable yet) — no pixel
      // sampling of the logo image, so nothing here depends on image
      // loading succeeding.
      const rect=logoSlotRef.current?logoSlotRef.current.getBoundingClientRect():null;
      const W=window.innerWidth,H=window.innerHeight;
      const tcx=rect?rect.left+rect.width/2:W/2;
      const tcy=rect?rect.top+rect.height/2:H/2;
      const spreadX=rect?Math.max(rect.width*0.55,60):120;
      const spreadY=rect?Math.max(rect.height*0.9,40):50;

      const COUNT=380;
      const particles=[];
      for(let i=0;i<COUNT;i++){
        const angle=Math.random()*Math.PI*2;
        const radius=Math.max(W,H)*(0.55+Math.random()*0.55);
        particles.push({
          sx:W/2+Math.cos(angle)*radius, sy:H/2+Math.sin(angle)*radius,
          tx:tcx+(Math.random()-0.5)*2*spreadX,
          ty:tcy+(Math.random()-0.5)*2*spreadY,
          color:Math.random()<0.6?B.navy:B.gold,
          size:3+Math.random()*3,
          rotSeed:(Math.random()>0.5?1:-1)*(1.2+Math.random()*1.8),
          delay:Math.random()*500,
          dur:TOTAL_MS-500+Math.random()*500,
          fadeFrom:0.7+Math.random()*0.2,
        });
      }

      const startTime=performance.now();

      const render=(now)=>{
        if(cancelled)return;
        const elapsed=now-startTime;
        ctx.clearRect(0,0,window.innerWidth,window.innerHeight);
        for(const p of particles){
          const t=Math.min(1,Math.max(0,(elapsed-p.delay)/p.dur));
          const e=_easeOutCubic(t);
          const x=p.sx+(p.tx-p.sx)*e;
          const y=p.sy+(p.ty-p.sy)*e;
          const rot=p.rotSeed*(1-e)*Math.PI*0.9;
          const scale=1+(1-e)*0.7;
          let alpha=0.85;
          if(t>p.fadeFrom)alpha=0.85*Math.max(0,1-(t-p.fadeFrom)/(1-p.fadeFrom));
          _drawIntroCube(ctx,x,y,p.size*scale,rot,p.color,alpha);
        }
        if(elapsed<TOTAL_MS)rafId=requestAnimationFrame(render);
        else ctx.clearRect(0,0,window.innerWidth,window.innerHeight);
      };
      rafId=requestAnimationFrame(render);

      logoTimer=setTimeout(()=>{if(!cancelled)setLogoVisible(true);},LOGO_FADE_AT);
      doneTimer=setTimeout(()=>{
        if(cancelled)return;
        goDone();
      },TOTAL_MS);
    }catch(_e){
      // Anything unexpected — skip straight to the normal login screen
      // rather than ever leaving the visitor stuck behind the animation.
      goDone();
    }

    return()=>{
      cancelled=true;
      if(rafId)cancelAnimationFrame(rafId);
      if(logoTimer)clearTimeout(logoTimer);
      if(doneTimer)clearTimeout(doneTimer);
      window.removeEventListener("resize",resize);
    };
  },[introPhase]);

  const handleLogin=async()=>{
    if(!email||!password)return setError("Please enter your email and password.");
    setLoading(true);setError("");
    const{error:e}=await sb.auth.signInWithPassword({email,password});
    setLoading(false);
    if(e)setError(e.message);
  };
  const handleReset=async()=>{
    if(!email)return setError("Please enter your email address.");
    setLoading(true);setError("");
    const{error:e}=await sb.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});
    setLoading(false);
    if(e)setError(e.message);else setResetSent(true);
  };

  const introDone=introPhase==="done";
  return(
    <div style={{minHeight:"100vh",background:B.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans','Helvetica Neue',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <div style={{position:"fixed",inset:0,backgroundImage:`radial-gradient(circle at 20% 80%,rgba(206,182,132,0.16) 0%,transparent 50%)`,pointerEvents:"none"}}/>
      {introPhase==="playing"&&<canvas ref={canvasRef} style={{position:"fixed",inset:0,zIndex:5,pointerEvents:"none"}}/>}
      <div style={{background:B.white,borderRadius:20,padding:"32px 24px",width:"100%",maxWidth:420,boxShadow:B.shadowMd,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${B.gold}`,position:"relative",zIndex:1,margin:"0 16px"}}>
        <div style={{textAlign:"center",marginBottom:introDone?32:0}}>
          <div ref={logoSlotRef} style={{position:"relative",height:110,display:"flex",justifyContent:"center",alignItems:"center",marginBottom:introDone?20:0}}>
            <div style={{opacity:logoVisible?1:0,transition:"opacity .7s ease"}}><PCMLogo/></div>
          </div>
          {introDone&&<>
            <div style={{height:1,background:`linear-gradient(90deg,transparent,${B.gold},transparent)`,marginBottom:18}}/>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>{mode==="reset"?"Reset Password":"Client Portal"}</div>
            <div style={{fontSize:11,color:B.textMute,letterSpacing:"0.1em",marginTop:3}}>{mode==="reset"?"ENTER YOUR EMAIL":"SECURE ACCESS"}</div>
          </>}
        </div>
        {introDone&&(resetSent?(
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:12}}>📧</div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,marginBottom:8}}>Check your email</div>
            <div style={{fontSize:13,color:B.textSoft,marginBottom:20}}>Password reset link sent to <strong>{email}</strong></div>
            <Btn onClick={()=>{setMode("login");setResetSent(false);}}>Back to Sign In</Btn>
          </div>
        ):(
          <>
            <Field label="Email"><input type="email" value={email} onChange={e=>{setEmail(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&(mode==="login"?handleLogin():handleReset())} placeholder={"you@"+BRAND.emailDomain} autoFocus style={{...inp,fontSize:15,padding:"13px 16px"}}/></Field>
            {mode==="login"&&<Field label="Password"><input type="password" value={password} onChange={e=>{setPassword(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="••••••••" style={{...inp,fontSize:15,padding:"13px 16px"}}/></Field>}
            {error&&<div style={{fontSize:12,color:"#d43030",marginBottom:12,fontWeight:600,padding:"8px 12px",background:"#fde8e8",borderRadius:8}}>{error}</div>}
            <button onClick={mode==="login"?handleLogin:handleReset} disabled={loading} style={{width:"100%",background:`linear-gradient(135deg,${B.navy},${B.navyMid})`,color:B.white,border:"none",borderRadius:10,padding:"13px",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",fontFamily:"inherit",letterSpacing:"0.06em",marginBottom:16,opacity:loading?.7:1}}>
              {loading?"Please wait…":mode==="login"?"SIGN IN":"SEND RESET LINK"}
            </button>
            <div style={{textAlign:"center"}}>
              {mode==="login"?<button onClick={()=>{setMode("reset");setError("");}} style={{background:"none",border:"none",color:B.textSoft,fontSize:12,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>Forgot your password?</button>:<button onClick={()=>{setMode("login");setError("");}} style={{background:"none",border:"none",color:B.textSoft,fontSize:12,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>Back to sign in</button>}
            </div>
          </>
        ))}
        {introDone&&<div style={{textAlign:"center",marginTop:24,fontSize:11,color:B.textMute}}>{BRAND.name} · {BRAND.tagline}</div>}
      </div>
    </div>
  );
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
  const totalPortfolio=properties.reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0);
  const totalDebt=properties.reduce((s,p)=>s+(Number(p.loanBalance)||0)+(Number(p.secondMortgageBalance)||0),0)+accounts.filter(a=>a.accountType==="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
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
      <div style="text-align:right"><h1>${family.name}</h1><div class="advisor">Ordanis Expert: ${family.advisorName||"—"} | ${family.advisorEmail||""}</div><div class="date">${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-l">Real Estate Value</div><div class="stat-v">${fmtMoney(totalPortfolio)}</div></div>
      <div class="stat"><div class="stat-l">Total Debt</div><div class="stat-v">${fmtMoney(totalDebt)}</div></div>
      <div class="stat"><div class="stat-l">Portfolio Value</div><div class="stat-v">${fmtMoney(totalAccounts)}</div></div>
      <div class="stat"><div class="stat-l">Valuables</div><div class="stat-v">${fmtMoney(totalValuables)}</div></div>
    </div>
    <h2>Contacts & Members</h2>
    <table><thead><tr><th>Name</th><th>Type</th><th>Email</th><th>Phone</th></tr></thead><tbody>
    ${contacts.map(c=>`<tr><td>${c.name}</td><td>${c.type}</td><td>${c.email||"—"}</td><td>${c.phone||"—"}</td></tr>`).join("")||"<tr><td colspan='4' style='color:#8fa0b2'>No contacts</td></tr>"}
    </tbody></table>
    <h2>Properties</h2>
    ${properties.map(p=>`<table style="margin-bottom:14px"><thead><tr><th colspan="4">${p.address}${p.ownerName?` — ${p.ownerName}`:""}</th></tr></thead><tbody>
    <tr><td><b>Type</b></td><td>${p.propertyType}</td><td><b>Purchase Price</b></td><td>${fmtMoney(p.purchasePrice)}</td></tr>
    <tr><td><b>Current Value</b></td><td>${fmtMoney(p.currentValue)}</td><td><b>Purchase Date</b></td><td>${fmt(p.purchaseDate)}</td></tr>
    <tr><td><b>Lender</b></td><td>${p.lender||"—"}</td><td><b>Loan Type</b></td><td>${p.loanType}</td></tr>
    <tr><td><b>Loan Balance</b></td><td>${fmtMoney(p.loanBalance)}</td><td><b>Interest Rate</b></td><td>${fmtPct(p.interestRate)}</td></tr>
    <tr><td><b>Monthly Payment</b></td><td>${fmtMoney(p.loanPayment)}</td><td><b>Loan Maturity</b></td><td>${fmt(p.loanMaturityDate)}</td></tr>
    ${Number(p.secondMortgageBalance)>0?`<tr><td><b>2nd Mortgage</b></td><td>${fmtMoney(p.secondMortgageBalance)}</td><td><b>2nd Mtg Payment</b></td><td>${p.secondMortgagePayment?`${fmtMoney(p.secondMortgagePayment)}/mo`:"—"}</td></tr>`:""}
    <tr><td><b>Rental Income</b></td><td>${fmtMoney(p.rentalIncome)}/mo</td><td><b>Property Taxes</b></td><td>${fmtMoney(p.propertyTaxes)}/yr</td></tr>
    <tr><td><b>Insurance</b></td><td>${p.insuranceCompany||"—"}</td><td><b>Flood Insurance</b></td><td>${p.floodInsurance?"Yes":"No"}</td></tr>
    </tbody></table>`).join("")||"<p style='color:#8fa0b2;margin-bottom:12px'>No properties</p>"}
    <h2>Portfolio Accounts</h2>
    <table><thead><tr><th>Institution</th><th>Type</th><th>Banker</th><th>Starting</th><th>Current</th><th>Change</th></tr></thead><tbody>
    ${accounts.map(a=>{const pct=pctChange(a.startingBalance,a.currentBalance);return`<tr><td>${a.institution}</td><td>${a.accountType}</td><td>${a.bankerName||"—"}</td><td>${fmtMoney(a.startingBalance)}</td><td>${fmtMoney(a.currentBalance)}</td><td style="color:${Number(pct)>=0?"#18a850":"#d43030"};font-weight:700">${pct!==null?(Number(pct)>=0?"+":"")+pct+"%":"—"}</td></tr>`;}).join("")||"<tr><td colspan='6' style='color:#8fa0b2'>No accounts</td></tr>"}
    </tbody></table>
    <h2>Valuables</h2>
    <table><thead><tr><th>Category</th><th>Description</th><th>Year</th><th>Est. Value</th><th>Insured</th></tr></thead><tbody>
    ${valuables.map(v=>`<tr><td>${v.category}</td><td>${v.description}</td><td>${v.year||"—"}</td><td>${fmtMoney(v.estimatedValue)}</td><td>${v.insured?"Yes":"No"}</td></tr>`).join("")||"<tr><td colspan='5' style='color:#8fa0b2'>No valuables</td></tr>"}
    </tbody></table>
    <h2>Open Deals</h2>
    <table><thead><tr><th>Deal</th><th>Stage</th><th>Value</th><th>Close Date</th></tr></thead><tbody>
    ${deals.filter(d=>d.stage!=="Closed Lost"&&d.stage!=="Closed Won").map(d=>`<tr><td>${d.title}</td><td>${d.stage}</td><td>${fmtMoney(d.value)}</td><td>${fmt(d.closeDate)}</td></tr>`).join("")||"<tr><td colspan='4' style='color:#8fa0b2'>No open deals</td></tr>"}
    </tbody></table>
    <h2>Pending Tasks & Deadlines</h2>
    <table><thead><tr><th>Task</th><th>Priority</th><th>Due Date</th><th>Reminder</th></tr></thead><tbody>
    ${tasks.sort((a,b)=>a.dueDate>b.dueDate?1:-1).map(t=>`<tr><td>${t.title}</td><td>${t.priority}</td><td>${fmt(t.dueDate)}</td><td>${t.reminderDays?t.reminderDays+" days before":"—"}</td></tr>`).join("")||"<tr><td colspan='4' style='color:#8fa0b2'>No pending tasks</td></tr>"}
    </tbody></table>
    <h2>Activity Notes</h2>
    ${notes.slice(0,10).map(n=>`<div class="note"><div>${n.body}</div><div class="note-date">${fmt(n.createdAt)}</div></div>`).join("")||"<p style='color:#8fa0b2'>No notes</p>"}
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

// The expense categories, and the ONLY place they are listed.
//
// Must stay in step with cash_flow_events_category_chk. A value the database accepts
// but this list omits is a category nobody can select; a value here the database
// rejects is an error at save time. The constraint is what makes a category total
// trustworthy — free text would fragment "landscaping" across four spellings and
// produce four partial answers to one question.
const EXPENSE_CATEGORIES=[
  ["landscaping","Landscaping & grounds"],
  ["housekeeping","Housekeeping"],
  ["pool_spa","Pool & spa"],
  ["security","Security"],
  ["maintenance","Maintenance & repairs"],
  ["utilities","Utilities"],
  ["property_management","Property management"],
  ["insurance","Insurance"],
  ["taxes","Taxes"],
  ["household_payroll","Household payroll"],
  ["professional_fees","Professional fees"],
  ["healthcare","Healthcare"],
  ["education","Education"],
  ["travel","Travel"],
  ["charitable","Charitable"],
  ["subscriptions","Subscriptions & dues"],
  ["vehicle","Vehicles"],
  ["debt_service","Debt service"],
  ["other","Other"],
];
const EXPENSE_CATEGORY_LABEL=Object.fromEntries(EXPENSE_CATEGORIES);

// The family's service providers, as pickable options for an expense line.
//
// Providers live in two tables — family_contacts (household-wide) and property_contacts
// (attached to one property) — and cash_flow_events has a separate nullable foreign key
// for each, with a constraint allowing at most one. A single select needs one value, so
// the key is prefixed with which table it came from and split again on save. Storing a
// plain name instead would fragment the vendor total across spellings, which is the same
// mistake free-text categories made.
const vendorKeyFor=e=>e?.vendorFamilyContactId?`f:${e.vendorFamilyContactId}`
  :e?.vendorPropertyContactId?`p:${e.vendorPropertyContactId}`:"";
const splitVendorKey=key=>{
  const[kind,id]=String(key||"").split(":");
  return{
    vendor_family_contact_id:kind==="f"&&id?id:null,
    vendor_property_contact_id:kind==="p"&&id?id:null,
  };
};
function buildVendorOptions(data,familyId){
  const label=c=>c.company&&c.name&&c.company!==c.name?`${c.company} (${c.name})`
    :c.company||c.name||c.role||"Unnamed provider";
  const fam=(data?.family_contacts||[]).filter(c=>c.familyId===familyId&&!c.isAdvisor)
    .map(c=>({key:`f:${c.id}`,label:label(c),group:"Household"}));
  const byProp=Object.fromEntries((data?.properties||[]).map(p=>[p.id,p.address]));
  const prop=(data?.property_contacts||[]).filter(c=>c.familyId===familyId)
    .map(c=>({key:`p:${c.id}`,label:label(c),group:byProp[c.propertyId]||"Property"}));
  return [...fam,...prop].sort((a,b)=>a.group.localeCompare(b.group)||a.label.localeCompare(b.label));
}

// Occurrences per year for each frequency the app supports.
//
// `once` is deliberately absent rather than mapped to 1: a single payment is not an
// annual run rate, and treating it as one would inflate a category total for a year
// in which it will not recur. annualise() returns null for it, and the caller must
// present that as a one-off instead of adding it in.
const FREQ_PER_YEAR={weekly:52,biweekly:26,monthly:12,quarterly:4,semiannually:2,annually:1,yearly:1};
const annualise=(amount,frequency)=>{
  const per=FREQ_PER_YEAR[String(frequency||"").toLowerCase()];
  return per?Math.round(amount*per):null;
};

// Add the monthly view to a rollup group, and say whether it is a real payment.
//
// "How much do we pay monthly?" has two different answers and conflating them puts a
// false statement in front of a client. Florida Power & Light is billed monthly, so
// annual/12 IS the payment. Chubb's premium is annual: $14,200/12 = $1,183 is a smoothed
// average and nobody pays Chubb $1,183 in any month.
//
// So the field is called monthlyAverage rather than monthly, and `everyLineIsMonthly`
// tells the caller which of the two situations it is in. A figure that is only an average
// must never be described as what is paid each month.
const withMonthly=g=>{
  const freqs=[...(g.frequencies||[])];
  return{
    ...g,
    frequencies:freqs,
    monthlyAverage:Math.round(g.annualised/12),
    everyLineIsMonthly:freqs.length>0&&freqs.every(f=>String(f).toLowerCase()==="monthly"),
  };
};

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

// ── FAMILY DASHBOARD ──────────────────────────────────────────────────────────
// ── AI HELP CENTER ────────────────────────────────────────────────────────────
// Builds a compact, family-scoped snapshot of everything on the dashboard, then
// lets the user ask natural-language questions answered by the family-ai-assistant
// Supabase Edge Function. Read-only; no data ever leaves the family's own scope.
function buildFamilySnapshot(family,data){
  const fid=family.id;
  const today=new Date(); today.setHours(0,0,0,0);
  const daysFromNow=d=>{ if(!d)return null; const t=new Date(d); if(isNaN(t.getTime()))return null; const t0=new Date(t.getFullYear(),t.getMonth(),t.getDate()); return Math.round((t0-today)/86400000); };
  const num=v=>{ const n=Number(v); return Number.isFinite(n)?n:0; };

  // The plan the household is on, and whether bill pay is part of it.
  //
  // This matters more here than anywhere else in the app. If the assistant is handed
  // pcmResponsibleForPayment or a paymentRegister for a Core household, it will answer "yes, we
  // paid your insurance in March" about a bill the firm has no mandate to pay — a false statement
  // about client money, delivered in the firm's own voice. Suppressed rather than passed through
  // with a caveat, because a caveat in the data is something the model may or may not repeat.
  const plan=family.plan;
  const billPay=planAllows(plan,"billPay");

  const properties=(data.properties||[]).filter(p=>p.familyId===fid).map(p=>({
    // id is REQUIRED, not cosmetic. derivePropertyEvents builds its line ids and its
    // suppression key from it. Without it every property emitted the same id
    // ("prop_undefined_propertyTaxesAnnual") and every suppression key collapsed to
    // "undefined::utilities", which could never match a manual line's real propertyId —
    // so the suppression rule never fired in the live app and an itemised cost was
    // counted twice, once as vendor lines and once as the property's blended figure.
    // The unit tests passed because their fixtures supply an id the snapshot did not.
    id:p.id,
    address:p.address||null, owner:p.ownerName||null, type:p.propertyType||null,
    purchasePrice:num(p.purchasePrice), purchaseDate:p.purchaseDate||null,
    currentValue:num(p.currentValue)||num(p.purchasePrice),
    lender:p.lender||null, loanBalance:num(p.loanBalance),
    interestRatePct:(p.interestRate===""||p.interestRate==null)?null:num(p.interestRate),
    monthlyPayment:num(p.loanPayment), loanType:p.loanType||null,
    loanMaturityDate:p.loanMaturityDate||null, daysUntilLoanMaturity:daysFromNow(p.loanMaturityDate),
    secondMortgageBalance:num(p.secondMortgageBalance), secondMortgagePaymentMonthly:num(p.secondMortgagePayment),
    rentalIncomeMonthly:num(p.rentalIncome), propertyTaxesAnnual:num(p.propertyTaxes), utilitiesMonthly:num(p.utilities),
    insuranceCompany:p.insuranceCompany||null, insurancePremiumAnnual:num(p.insurancePremium),
    insuranceExpirationDate:p.insuranceExpiration||null, daysUntilInsuranceExpiration:daysFromNow(p.insuranceExpiration),
    floodInsurance:!!p.floodInsurance, floodInsuranceCompany:p.floodInsuranceCompany||null,
    floodInsurancePremiumAnnual:num(p.floodInsurancePremium),
    floodInsuranceExpirationDate:p.floodInsuranceExpiration||null, daysUntilFloodInsuranceExpiration:daysFromNow(p.floodInsuranceExpiration),
    hoaFeeMonthly:num(p.hoaFee),
    propertyManagementFeePct:(p.propertyManagementFeePct===""||p.propertyManagementFeePct==null)?null:num(p.propertyManagementFeePct),
    notes:p.notes||null,
  }));

  const portfolioAccounts=(data.portfolio_accounts||[]).filter(a=>a.familyId===fid).map(a=>({
    institution:a.institution||null, type:a.accountType||null, banker:a.bankerName||null,
    startingBalance:num(a.startingBalance), currentBalance:num(a.currentBalance),
    gainSinceInception:num(a.currentBalance)-num(a.startingBalance),
  }));

  const valuables=(data.valuables||[]).filter(v=>v.familyId===fid).map(v=>({
    category:v.category||null, description:v.description||null, makeModel:v.makeModel||null,
    year:v.year||null, estimatedValue:num(v.estimatedValue),
    insured:!!v.insured, insuranceCompany:v.insuranceCompany||null,
  }));

  const tasks=(data.tasks||[]).filter(t=>t.familyId===fid&&!t.done).map(t=>{
    const d=daysFromNow(t.dueDate);
    return { title:t.title||null, dueDate:t.dueDate||null, daysUntilDue:d, priority:t.priority||null,
      status:(d==null)?"open":(d<0?"overdue":(d<=30?"due_soon":"open")) };
  });

  const paymentLogByEvent={};
  (data.cash_flow_payment_log||[]).filter(p=>p.familyId===fid).forEach(p=>{(paymentLogByEvent[p.eventId]=paymentLogByEvent[p.eventId]||[]).push(p);});
  // Vendor and property lookups for cash-flow lines. Built once rather than searched
  // per row, and resolved from the contact tables so a renamed vendor is renamed
  // everywhere it is reported.
  const propertyAddressById=Object.fromEntries(properties.map(p=>[p.id,p.address]));
  const famContactById=Object.fromEntries((data.family_contacts||[]).filter(c=>c.familyId===fid).map(c=>[c.id,c]));
  const propContactById=Object.fromEntries((data.property_contacts||[]).filter(c=>c.familyId===fid).map(c=>[c.id,c]));
  const vendorNameFor=e=>{
    const c=e.vendorFamilyContactId?famContactById[e.vendorFamilyContactId]
           :e.vendorPropertyContactId?propContactById[e.vendorPropertyContactId]:null;
    if(!c)return null;
    // Company is what appears on an invoice; the person is a fallback.
    return c.company||c.name||null;
  };

  const cashFlowEvents=(data.cash_flow_events||[]).filter(e=>e.familyId===fid).map(e=>{
    // firmPays gates every bill-pay field below in one place. On a Core household it is always
    // false, so the register is not built and none of the paid fields are emitted at all.
    const firmPays=billPay&&e.direction==="expense"&&!!e.pcmResponsible;
    const isRegisterFreq=firmPays&&["monthly","quarterly","annually"].includes(e.frequency);
    let paymentRegister;
    if(isRegisterFreq){
      const winStart=new Date();winStart.setHours(0,0,0,0);winStart.setDate(1);winStart.setMonth(winStart.getMonth()-6);
      const occs=expandEvent(e,winStart,18);
      const rows=paymentLogByEvent[e.id]||[];
      const byPeriod={};rows.forEach(r=>{byPeriod[(r.period||"").slice(0,10)]=r;});
      const seen=new Set();
      const todayFirst=new Date();todayFirst.setHours(0,0,0,0);todayFirst.setDate(1);
      const periods=occs.map(o=>{
        const pd=new Date(o.date.getFullYear(),o.date.getMonth(),1);
        const key=`${pd.getFullYear()}-${String(pd.getMonth()+1).padStart(2,"0")}-01`;
        if(seen.has(key))return null;seen.add(key);
        const row=byPeriod[key];
        return{period:key,paid:!!row?.paid,overdue:!row?.paid&&pd<todayFirst};
      }).filter(Boolean);
      paymentRegister={
        periodsTracked:periods.length,
        paidCount:periods.filter(p=>p.paid).length,
        overduePeriods:periods.filter(p=>p.overdue).map(p=>p.period),
      };
    }
    return{
      // `description` is the human label — "Housekeeper + grounds", "Pool service".
      //
      // This used to read `e.name||e.label||e.title`, and a cash-flow event has none
      // of those fields: the client shape carries eventType and description. So every
      // expense reached the assistant as {name: null, type: "Household Payroll"} and
      // the only text that identifies what the money was actually for was dropped
      // entirely. That single line is why "How much do I spend on landscaping?" could
      // not be answered for any household — the model never saw the word.
      description:e.description||null, type:e.eventType||null,
      category:e.category||null,
      notes:e.notes||null,
      propertyId:e.propertyId||null,
      property:e.propertyId?(propertyAddressById[e.propertyId]||null):null,
      // Who is paid. Resolved from the contact record rather than parsed out of the
      // description, so spend-per-vendor is a fact and not a string match.
      vendor:vendorNameFor(e),
      amount:num(e.amount),
      // Annualised in code rather than left to the model. Multiplying by a frequency
      // is exactly the arithmetic an LLM does confidently and occasionally wrongly,
      // and the error is invisible in the answer.
      annualisedAmount:annualise(num(e.amount),e.frequency),
      startDate:e.startDate||null, endDate:e.endDate||null, taxTreatment:e.taxTreatment||null,
      direction:e.direction||"income", frequency:e.frequency||null,
      // Omitted entirely on Core rather than sent as false. `false` would still invite the
      // assistant to discuss who pays this bill; absent, there is nothing to discuss.
      pcmResponsibleForPayment:billPay&&e.direction==="expense"?!!e.pcmResponsible:undefined,
      // For one-time (or weekly/biweekly) PCM-responsible expenses: single paid flag.
      paidByPcm:firmPays&&!isRegisterFreq?!!e.paid:undefined,
      paidDate:firmPays&&!isRegisterFreq?(e.paidAt||null):undefined,
      paidBy:firmPays&&!isRegisterFreq?(e.paidBy||null):undefined,
      // For monthly/quarterly/annual PCM-responsible expenses: per-period register summary
      // (last 6 months through next 12 months); overduePeriods lists unpaid periods already in the past.
      paymentRegister,
    };
  });

  // ORDER MATTERS: this block must stay ABOVE expenseByCategory.
  //
  // expenseByCategory spreads ...derivedPropertyEvents. With this declared after it, the
  // const sat in its temporal dead zone and buildFamilySnapshot threw
  // "Cannot access 'derivedPropertyEvents' before initialization" on every single call.
  // FamilyDashboard calls it on mount, so clicking a family rendered a blank panel.
  //
  // Neither guard caught it. Vite does not check that identifiers resolve, and no-undef
  // cannot see a TDZ error because the identifier IS declared — just not yet initialised.
  // What catches it now is docs/test_family_snapshot.mjs, which calls this function for
  // real instead of re-implementing what it does.
  // Property costs, via the SAME derivation the Cash Flow tab uses.
  //
  // These were previously totalled separately as propertyCarriedCosts, which meant a
  // category could have two competing totals and the assistant had to be told never to
  // add them. Now both sources feed one rollup, each item labelled with where it came
  // from, so "what do we spend on insurance?" has a single answer that includes the
  // property-held premiums.
  //
  // forProjection is false on purpose: the projection honours the user's includeRental
  // toggle, but a client asking what they actually spend must not get a different
  // answer because a modelling checkbox was unticked.
  // Computed either way. When the firm has opted in these are merged into the spend
  // totals; when it has not, they are still needed for an honest answer — otherwise the
  // assistant would tell a client "no utilities spend is recorded" while $33,600 a year
  // sits on their property records. Saying nothing is recorded is a definite answer, and
  // it would be wrong. So the figures are named in dataSourceNotes instead.
  const propertyHeldCosts=derivePropertyEvents(properties,{forProjection:false,
      manualEvents:cashFlowEvents})
    .filter(e=>e.direction==="expense");

  const derivedPropertyEvents=!FIRM_DEFAULTS.derivePropertyCosts?[]:derivePropertyEvents(properties,{
      forProjection:false,
      // Itemised lines win: a property+category a firm has broken out by vendor must not
      // ALSO contribute the property record's single blended figure.
      manualEvents:cashFlowEvents,
    })
    .filter(e=>e.direction==="expense")
    .map(e=>({...e,
      annualisedAmount:annualise(e.amount,e.frequency),
      source:"property record",
      property:e._propertyAddress,
      vendor:e.vendor||null,
      billedFrequency:e.billedFrequency||"monthly",
      field:e._field}));

  // Manual lines and derived lines can still describe the same obligation, because a
  // firm may have typed the cost in by hand before this existed. Flagged, never
  // silently merged or dropped: a "Property Tax Reserve" line might duplicate the
  // property's tax figure, or be a separate reserve funded on top of it. Only a person
  // can tell, so both are reported and the overlap is named.
  const duplicateWarnings=findProbableDuplicates(
    cashFlowEvents.filter(e=>e.direction==="expense"),
    derivedPropertyEvents);

  // Spend by category, totalled here rather than by the model.
  //
  // This is the difference between answering "How much do I spend on landscaping?"
  // and appearing to. The model is good at finding the relevant rows and bad at
  // reliably multiplying nine of them by their frequencies — and when it slips, the
  // answer still reads perfectly. So the arithmetic is done in code and the model is
  // handed the total.
  //
  // Three properties this rollup has to preserve:
  //   * one-off costs are listed but NOT added to the annual figure, because a single
  //     payment is not a run rate
  //   * uncategorised spend is its own line, never folded into a category
  //   * `lines` is included so the model can say how many items make up a total, and
  //     a client can ask to see them
  const expenseByCategory=(()=>{
    const acc={};
    [...cashFlowEvents.filter(e=>e.direction==="expense"),
     ...derivedPropertyEvents].forEach(e=>{
      const key=e.category||"uncategorised";
      const a=acc[key]||(acc[key]={category:key,
        label:EXPENSE_CATEGORY_LABEL[key]||"Uncategorised",
        annualised:0, lines:0, oneOffTotal:0, oneOffCount:0, items:[],
        // Every distinct billing frequency in this group. It is what decides whether a
        // monthly figure is a real payment or a smoothed average.
        frequencies:new Set()});
      a.lines++;
      // billedFrequency where present. A property-derived line smooths an annual figure
      // into a monthly amount, so its `frequency` says monthly and would misreport an
      // annual premium as a monthly payment. A manual line has no billedFrequency — the
      // frequency chosen on the form IS its billing cadence.
      const billed=e.billedFrequency||e.frequency;
      if(billed)a.frequencies.add(billed);
      if(e.annualisedAmount==null){ a.oneOffTotal+=e.amount; a.oneOffCount++; }
      else a.annualised+=e.annualisedAmount;
      a.items.push({description:e.description,amount:e.amount,frequency:e.frequency,
        annualisedAmount:e.annualisedAmount,
        // Every figure names where it came from, so a client told a number can go and
        // look at it — the Cash Flow tab or a specific property record.
        source:e.source||"cash flow",property:e.property||undefined});
    });
    return Object.values(acc).map(withMonthly).sort((x,y)=>y.annualised-x.annualised);
  })();
  const uncategorisedExpenses=expenseByCategory.find(c=>c.category==="uncategorised")||null;

  // Spend per vendor — the other axis families ask about. "How much do we pay ABC
  // Landscaping?" is a different question from "what do we spend on landscaping?", and
  // one category can span several vendors.
  //
  // Totalled in code for the same reason the category rollup is: the model should quote
  // a figure, not compute one. Lines with no vendor recorded are grouped under a null
  // vendor rather than dropped, so a vendor total is never quietly incomplete.
  const spendByVendor=(()=>{
    const acc={};
    [...cashFlowEvents.filter(e=>e.direction==="expense"),...derivedPropertyEvents].forEach(e=>{
      if(!e.vendor)return;
      const a=acc[e.vendor]||(acc[e.vendor]={vendor:e.vendor,annualised:0,lines:0,
        categories:new Set(),properties:new Set(),items:[],frequencies:new Set()});
      if(e.annualisedAmount!=null)a.annualised+=e.annualisedAmount;
      a.lines++;
      // billedFrequency where present. A property-derived line smooths an annual figure
      // into a monthly amount, so its `frequency` says monthly and would misreport an
      // annual premium as a monthly payment. A manual line has no billedFrequency — the
      // frequency chosen on the form IS its billing cadence.
      const billed=e.billedFrequency||e.frequency;
      if(billed)a.frequencies.add(billed);
      if(e.category)a.categories.add(EXPENSE_CATEGORY_LABEL[e.category]||e.category);
      if(e.property)a.properties.add(e.property);
      a.items.push({description:e.description,annualisedAmount:e.annualisedAmount,
        source:e.source||"cash flow",property:e.property||undefined});
    });
    return Object.values(acc)
      .map(v=>withMonthly({...v,categories:[...v.categories],properties:[...v.properties]}))
      .sort((x,y)=>y.annualised-x.annualised);
  })();

  // Expense lines with no vendor recorded. Named so the assistant can say a
  // spend-per-vendor answer is partial rather than presenting it as the full list.
  const expensesWithoutVendor=[...cashFlowEvents.filter(e=>e.direction==="expense"),...derivedPropertyEvents]
    .filter(e=>!e.vendor).length;

  // Include document CONTENTS (extracted at upload) so the assistant can answer
  // from inside files. Bounded by a per-document cap and a global budget so the
  // prompt stays a sane size even with dozens of documents.
  const PER_DOC=40000, DOC_BUDGET=160000;
  let docTextUsed=0;
  const documents=(data.documents||[]).filter(d=>d.familyId===fid).map(d=>{
    const out={ name:d.name||null, category:d.category||null, fileType:d.fileType||null,
      description:d.description||null, uploadedAt:d.uploadedAt||d.createdAt||null };
    const raw=(d.extractedText||"").trim();
    if(!raw){ out.contentsAvailable=false; return out; }
    if(docTextUsed>=DOC_BUDGET){ out.contentsAvailable=true; out.contents="[not included — document-text budget reached; ask about this document specifically]"; return out; }
    let txt=raw.slice(0,PER_DOC);
    if(raw.length>PER_DOC) txt+="…[truncated]";
    docTextUsed+=txt.length;
    out.contentsAvailable=true; out.contents=txt;
    return out;
  });

  // ── PEOPLE AND SERVICE PROVIDERS ───────────────────────────────────────────
  // The family's own people and the firms that work for them live in three
  // separate tables, all of which were already being fetched and family-scoped —
  // and none of which reached the assistant. So "who are my service providers?"
  // got answered from whatever names happened to be embedded in property and
  // account fields (the insurance carrier, the banker) while every actual
  // contact record was invisible: the trust counsel, the CPA, the art advisor,
  // and every per-property vendor.
  //
  // The three are kept distinct rather than flattened. contacts are the family
  // themselves, and a model handed one undifferentiated list will sooner or later
  // introduce a family member as a vendor.
  const trimOrNull=v=>{ const s=String(v==null?"":v).trim(); return s||null; };
  const propertyNameById=id=>{
    if(!id)return null;
    const p=(data.properties||[]).find(x=>x.id===id);
    return p?trimOrNull(p.name)||trimOrNull(p.address):null;
  };
  const mapProvider=(c,extra)=>({
    name:trimOrNull(c.name), role:trimOrNull(c.role), company:trimOrNull(c.company),
    email:trimOrNull(c.email), phone:trimOrNull(c.phone), notes:trimOrNull(c.notes),
    ...extra,
  });

  // contacts — the household's own members, not providers.
  // NOTES_IN_SNAPSHOT
  // The running record of what was discussed and agreed. Newest first, because a
  // household's recent history is what questions are usually about, and because
  // truncating from the oldest end loses least.
  //
  // Budgeted the same way document text is: a long meeting write-up should not
  // crowd out the rest of the snapshot, and the edge function rejects an oversized
  // payload outright rather than degrading.
  const NOTE_BUDGET=32000, PER_NOTE=1600;
  let noteTextUsed=0, notesOmitted=0;
  const notes=[...(data.notes||[]).filter(n=>n.familyId===fid)]
    .sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")))
    .map(n=>{
      const who=n.contactId?(data.contacts||[]).find(c=>c.id===n.contactId):null;
      const out={ date:(n.createdAt||"").slice(0,10) };
      if(who&&who.name)out.about=who.name;
      // An edited note is flagged so the assistant can say the record was revised
      // rather than presenting it as contemporaneous.
      if(n.updatedAt)out.editedOn=String(n.updatedAt).slice(0,10);
      if(noteTextUsed>=NOTE_BUDGET){ notesOmitted++; return null; }
      let txt=String(n.body||"").trim().slice(0,PER_NOTE);
      if(String(n.body||"").trim().length>PER_NOTE)txt+="…[truncated]";
      noteTextUsed+=txt.length;
      out.body=txt;
      return out;
    }).filter(Boolean);
  // Saying how many were dropped is the difference between an incomplete answer
  // and a wrong one — the assistant can flag that older notes exist.
  if(notesOmitted>0)notes.push({note:`[${notesOmitted} older note(s) omitted — note-text budget reached. Ask about a specific date or topic.]`});

  const familyMembers=(data.contacts||[]).filter(c=>c.familyId===fid).map(c=>({
    name:trimOrNull(c.name), email:trimOrNull(c.email), phone:trimOrNull(c.phone),
    isPrimaryContact:!!c.isPrimary,
  }));

  // family_contacts — the professional team retained across the household rather
  // than tied to one asset. isAdvisor marks whoever leads that discipline.
  const householdProviders=(data.family_contacts||[]).filter(c=>c.familyId===fid)
    .map(c=>mapProvider(c,{ scope:"household", isLeadForDiscipline:!!c.isAdvisor }));

  // property_contacts — vendors attached to a single property.
  const propertyProviders=(data.property_contacts||[]).filter(c=>c.familyId===fid)
    .map(c=>mapProvider(c,{ scope:"property", attachedToProperty:propertyNameById(c.propertyId) }));

  const serviceProviders=[...householdProviders,...propertyProviders];

  const totalRE=properties.reduce((s,p)=>s+(p.currentValue||p.purchasePrice||0),0);
  const totalDebt=properties.reduce((s,p)=>s+p.loanBalance+p.secondMortgageBalance,0)
    +portfolioAccounts.filter(a=>a.type==="Line of Credit").reduce((s,a)=>s+a.currentBalance,0);
  const totalPortfolio=portfolioAccounts.filter(a=>a.type!=="Line of Credit").reduce((s,a)=>s+a.currentBalance,0);
  const totalValuables=valuables.reduce((s,v)=>s+v.estimatedValue,0);
  const netWorth=totalRE-totalDebt+totalPortfolio+totalValuables;

  // Tell the model which things are genuinely not in the data, so it answers honestly.
  const notTracked=[];
  const anyInsExp=properties.some(p=>p.insuranceExpirationDate||p.floodInsuranceExpirationDate);
  if(!anyInsExp) notTracked.push("insurance policy expiration / renewal dates (only carrier and annual premium are stored)");
  // Said explicitly, because the alternative is the model assembling a plausible
  // answer out of insurance carriers and banker names and presenting it as the
  // provider list — which is how this gap stayed invisible.
  if(!serviceProviders.length) notTracked.push("service providers / vendors (no contact records are on file for this family; insurance carriers and banker names appearing elsewhere are not the same thing)");

  // Say plainly when a spend total is incomplete. Without this the assistant would
  // quote a category figure that silently excludes uncategorised lines, and it would
  // look authoritative.

  // Not notTracked entries. notTracked means "the platform holds no such data" and the
  // prompt answers "that isn't tracked yet"; these describe data that IS held, and where
  // it came from. Two instructions in conflict on one question would leave the model to
  // pick a winner.
  const dataSourceNotes=[];
  if(!FIRM_DEFAULTS.derivePropertyCosts&&propertyHeldCosts.length){
    const byCat={};
    propertyHeldCosts.forEach(e=>{
      const k=EXPENSE_CATEGORY_LABEL[e.category]||e.category;
      byCat[k]=(byCat[k]||0)+(annualise(e.amount,e.frequency)||0);
    });
    dataSourceNotes.push(
      `This firm records property costs on the PROPERTY record and does NOT feed them into the `+
      `Cash Flow tab, so they are absent from expenseByCategory and spendByVendor. They ARE held, `+
      `with these annual figures: `+
      Object.entries(byCat).map(([k,v])=>`${k} $${v.toLocaleString()}`).join("; ")+
      `. If asked about one of these, answer from this note, say the figure comes from the property `+
      `record rather than the cash-flow ledger, and do NOT say that nothing is recorded. Do not add `+
      `these to a cash-flow total — a manual line may already cover the same money.`);
  }
  if(derivedPropertyEvents.length) dataSourceNotes.push(
    `${derivedPropertyEvents.length} expense line(s) are derived from property records rather than typed `+
    `into the Cash Flow tab (property tax, insurance, flood, utilities, HOA, mortgage). They ARE included `+
    `in expenseByCategory and each item carries source:"property record" and the property address. When `+
    `you quote a figure, say which source it came from.`);
  // Where a monthly figure is a smoothed average rather than a payment.
  //
  // Every group carries monthlyAverage = annualised/12. For a monthly-billed cost that
  // IS the payment. For an annual insurance premium it is not: $14,200/12 = $1,183, and
  // nobody pays the carrier $1,183 in any month. Saying "you pay $1,183 a month" is a
  // false statement about a client's money, so the groups where that applies are named
  // here explicitly rather than left for the model to work out from the frequencies.
  //
  // Data-driven rather than a static prompt rule, so it names the actual categories and
  // vendors affected and cannot go stale as the data changes.
  [["category",expenseByCategory,g=>g.label],["vendor",spendByVendor,g=>g.vendor]]
    .forEach(([kind,groups,name])=>{
      const smoothed=groups.filter(g=>!g.everyLineIsMonthly&&g.annualised>0);
      if(!smoothed.length)return;
      dataSourceNotes.push(
        `For these ${kind===
          "category"?"categories":"vendors"}, monthlyAverage is a SMOOTHED average and NOT what is paid `+
        `each month, because the underlying items are not all billed monthly: `+
        smoothed.map(g=>`${name(g)} ($${g.monthlyAverage.toLocaleString()}/mo average, `+
          `$${g.annualised.toLocaleString()}/yr, billed ${g.frequencies.join(" and ")})`).join("; ")+
        `. Describe these as an average and name the billing frequency. Never say the client pays that `+
        `amount monthly. Every other ${kind} has everyLineIsMonthly=true, where the monthly figure is a `+
        `real payment and may be stated plainly.`);
    });

  if(expensesWithoutVendor) dataSourceNotes.push(
    `${expensesWithoutVendor} expense line(s) have no vendor recorded, so spendByVendor does NOT `+
    `account for all spend. If asked what is paid to a particular vendor, answer from spendByVendor; `+
    `if asked to list every vendor or to reconcile vendor spend against a category total, say that `+
    `some lines have no vendor recorded.`);
  duplicateWarnings.forEach(d=>dataSourceNotes.push(
    `${EXPENSE_CATEGORY_LABEL[d.category]||d.category} has spend from BOTH a manual cash-flow line `+
    `($${Math.round(d.manual).toLocaleString()}/yr: ${d.manualLines.join("; ")}) AND property records `+
    `($${Math.round(d.derived).toLocaleString()}/yr: ${d.derivedLines.join("; ")}). `+
    (d.likelySameMoney
      ? `The two figures agree, so this is very likely ONE obligation recorded twice and the category total `+
        `above DOUBLE-COUNTS it. Say so, give the single figure, and suggest the manual line be removed.`
      : `The figures differ, so they may be separate costs or one may be incomplete. Give the breakdown by `+
        `source and say it needs checking. Do not present the combined total as certain.`)));

  if(uncategorisedExpenses) notTracked.push(
    `${uncategorisedExpenses.lines} expense line(s) have no category, so they are NOT included in any category total. `+
    `They are listed under expenseByCategory as "uncategorised". If a category total is quoted and this entry exists, `+
    `say that some spend is uncategorised rather than presenting the total as complete.`);

  // A vendor on file with no matching spend, and vice versa. Both are common and both
  // produce a confidently wrong answer if the assistant fills the gap by inference —
  // which is exactly what "How much do I spend on landscaping?" invites when there is a
  // landscaper on file and no landscaping line.
  {
    const catsWithSpend=new Set(expenseByCategory.map(c=>c.category));
    // Only the vendor roles that map cleanly onto a category. A deliberately short
    // list: guessing that "Handyman" means maintenance is the sort of inference this
    // whole block exists to prevent.
    const ROLE_TO_CATEGORY=[
      [/landscap|grounds|lawn|garden/i,"landscaping"],
      [/housekeep|cleaner|cleaning|housemaid/i,"housekeeping"],
      [/pool|spa service/i,"pool_spa"],
      [/security/i,"security"],
      [/property manager|property management/i,"property_management"],
    ];
    const missing=[];
    serviceProviders.forEach(p=>{
      const hay=`${p.role||""} ${p.company||""}`;
      ROLE_TO_CATEGORY.forEach(([re,cat])=>{
        if(re.test(hay)&&!catsWithSpend.has(cat)
           &&!missing.some(m=>m.category===cat)){
          missing.push({category:cat,provider:p.company||p.name||p.role});
        }
      });
    });
    missing.forEach(m=>notTracked.push(
      `a ${EXPENSE_CATEGORY_LABEL[m.category]||m.category} provider is on file (${m.provider}) but NO expense is `+
      `categorised as ${EXPENSE_CATEGORY_LABEL[m.category]||m.category}. Say the vendor exists and the cost is not `+
      `recorded. Do not estimate it, and do not attribute part of another line to it.`));
  }

  return {
    today:today.toISOString().slice(0,10),
    // servicePlan is stated so the assistant can answer "do you pay my bills?" and "do you run my
    // renewals?" correctly instead of inferring it from the absence of data. Absence of a payment
    // register could mean Core, or it could mean nothing has been recorded yet, and those two
    // deserve different answers.
    family:{ name:family.name||null, servicePlan:planLabel(plan),
             firmPaysBills:billPay, runsWorkflows:planAllows(plan,"workflows") },
    totals:{ netWorth, realEstate:totalRE, totalDebt, portfolio:totalPortfolio, valuables:totalValuables },
    counts:{ properties:properties.length, portfolioAccounts:portfolioAccounts.length, valuables:valuables.length, openTasks:tasks.length, documents:documents.length,
             familyMembers:familyMembers.length, serviceProviders:serviceProviders.length,
             notes:(data.notes||[]).filter(n=>n.familyId===fid).length },
    properties, portfolioAccounts, valuables, tasks, cashFlowEvents, documents,
    familyMembers, serviceProviders,
    // The Notes tab: what was discussed, decided and agreed, newest first.
    notes,
    // Pre-totalled spend by category. Use these figures directly; do not re-derive
    // them from cashFlowEvents.
    expenseByCategory,
    // Categories where a manual line and a property-derived line overlap, which means
    // the total above may double-count. Flagged, not silently resolved.
    probableDuplicateSpend:duplicateWarnings,
    // Spend per vendor, pre-totalled. Answers "how much do we pay X?".
    spendByVendor,
    // Where a figure lives, and where two figures describe the same money. Distinct
    // from notTracked: these describe data that IS held, just not where you'd look.
    dataSourceNotes,
    notTracked,
  };
}

// Light formatter: preserves newlines (pre-wrap on container) and renders **bold**.
function renderRich(text){
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((p,i)=>
    (p.startsWith("**")&&p.endsWith("**"))
      ? <strong key={i}>{p.slice(2,-2)}</strong>
      : <span key={i}>{p}</span>);
}

const ASSISTANT_SUGGESTIONS=[
  "What is my current estimated net worth, and how is it broken down?",
  "Do I have any tasks overdue or due in the next 30 days?",
  "List my properties with their current value and loan balance.",
  "Which properties have flood insurance, and with which carrier?",
  "What are my total annual property insurance premiums?",
  "Which loans mature within the next 12 months?",
];

function FamilyAssistant({family,data,reload,compact,toast}){
  const isMobile=useIsMobile();
  // Read the family from the live data set so a rename reflects immediately
  // (the `family` prop passed by parents can be a stale snapshot).
  const fam=(data.families||[]).find(x=>x.id===family.id)||family;
  const assistantName=(fam.assistantName||"").trim()||"Ordanis";
  const[messages,setMessages]=useState([]); // {role:"user"|"assistant", content}
  const[input,setInput]=useState("");
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState(null);
  const[editingName,setEditingName]=useState(false);
  const[nameInput,setNameInput]=useState(assistantName);
  const[savingName,setSavingName]=useState(false);
  const[nameErr,setNameErr]=useState(null);
  const scrollRef=useRef(null);
  const snapshot=useMemo(()=>buildFamilySnapshot(family,data),[family,data]);

  const saveName=async()=>{
    const nm=(nameInput||"").trim().slice(0,40);
    if(!nm){setEditingName(false);setNameInput(assistantName);return;}
    if(nm===assistantName){setEditingName(false);return;}
    setSavingName(true);setNameErr(null);
    try{
      const{error}=await sb.from("families").update({assistant_name:nm}).eq("id",family.id);
      if(error)throw error;
      if(reload)await reload("families");
      setEditingName(false);
    }catch(e){setNameErr(e&&e.message?e.message:"Couldn't save the name.");}
    finally{setSavingName(false);}
  };

  useEffect(()=>{ if(scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight; },[messages,busy]);

  // Print / email / share a single answer. Kept local to this component since
  // they close over assistantName and the family name for the header/subject.
  const printAnswer=(content)=>{
    const w=window.open("","_blank","width=680,height=820");
    if(!w)return;
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(assistantName)} — Answer</title><style>
body{font-family:'DM Sans',Helvetica,Arial,sans-serif;color:${B.navy};padding:36px;line-height:1.6;}
h1{font-family:Georgia,serif;font-size:20px;margin:0 0 4px;}
p.meta{color:#5a6e84;font-size:12px;margin:0 0 24px;}
div.body{font-size:14px;white-space:pre-wrap;}
</style></head><body><h1>${esc(fam.name||"Family")} — ${esc(assistantName)}</h1><p class="meta">${esc(new Date().toLocaleString())}</p><div class="body">${esc(content)}</div></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(()=>w.print(),250);
  };

  const emailAnswer=(content)=>{
    const subject=encodeURIComponent(`${assistantName} — ${fam.name||"Family"} answer`);
    const body=encodeURIComponent(content);
    window.location.href=`mailto:?subject=${subject}&body=${body}`;
  };

  const shareAnswer=async(content)=>{
    if(navigator.share){
      try{ await navigator.share({title:`${assistantName} — Answer`,text:content}); }catch(e){ /* user cancelled */ }
      return;
    }
    try{
      await navigator.clipboard.writeText(content);
      toast&&toast("Copied — paste it into Messages, WhatsApp, or any app");
    }catch(e){
      toast&&toast("Couldn't share automatically — copy the text manually","error");
    }
  };

  const ask=async(q)=>{
    const question=((q!=null?q:input)||"").trim();
    if(!question||busy)return;
    setError(null);
    const history=messages.map(m=>({role:m.role,content:m.content}));
    setMessages(m=>[...m,{role:"user",content:question}]);
    setInput("");
    setBusy(true);
    try{
      const{data:resp,error:fnErr}=await sb.functions.invoke("family-ai-assistant",{body:{question,snapshot,history,assistantName}});
      if(fnErr)throw new Error("Please contact your Ordanis Expert for that information.");
      if(resp&&resp.error)throw new Error("Please contact your Ordanis Expert for that information.");
      setMessages(m=>[...m,{role:"assistant",content:(resp&&resp.answer)||"No response."}]);
    }catch(e){
      setError("Please contact your Ordanis Expert for that information.");
    }finally{
      setBusy(false);
    }
  };

  const onKey=e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); ask(); } };

  return <div style={{maxWidth:820,margin:"0 auto"}}>
    {!compact&&<><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6,flexWrap:"wrap"}}>
      {editingName
        ? <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?22:26,color:B.navy,fontWeight:600}}>Ask</span>
            <input autoFocus value={nameInput} onChange={e=>setNameInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveName();if(e.key==="Escape"){setEditingName(false);setNameInput(assistantName);}}} maxLength={40} placeholder="Ordanis"
              style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?20:24,color:B.navy,fontWeight:600,border:`1px solid ${B.border}`,borderRadius:8,padding:"2px 8px",width:160,outline:"none"}}/>
            <Btn small onClick={saveName} disabled={savingName}>{savingName?"…":"Save"}</Btn>
            <button onClick={()=>{setEditingName(false);setNameInput(assistantName);}} style={{background:"none",border:"none",color:B.textSoft,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
          </div>
        : <>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?22:26,color:B.navy,fontWeight:600}}>Ask {assistantName}</div>
            <button onClick={()=>{setNameInput(assistantName==="Ordanis"?"":assistantName);setEditingName(true);}} title="Rename your assistant" style={{background:"none",border:"none",color:B.gold,fontSize:14,cursor:"pointer",padding:"2px 4px"}}>✎</button>
          </>}
      <span style={{fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:B.navy,background:"rgba(206,182,132,0.22)",border:`1px solid ${B.gold}`,borderRadius:20,padding:"2px 9px"}}>Beta</span>
    </div>
    {nameErr&&<div style={{fontSize:12,color:"#8b1a1a",marginBottom:8}}>⚠ {nameErr}</div>}
    <div style={{fontSize:13,color:B.textSoft,marginBottom:16}}>
      {assistantName} answers questions about this family's dashboard — net worth, properties, loans, insurance, tasks, and documents. Answers come only from the data on file and are read-only.
    </div></>}

    {/* Conversation */}
    <div ref={scrollRef} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:14,boxShadow:B.shadow,padding:isMobile?16:22,minHeight:200,maxHeight:isMobile?"46vh":"52vh",overflowY:"auto",marginBottom:14}}>
      {messages.length===0&&!busy&&<div>
        <div style={{fontSize:12,fontWeight:800,color:B.textMute,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Try asking</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {ASSISTANT_SUGGESTIONS.map(s=><button key={s} onClick={()=>ask(s)} style={{textAlign:"left",background:B.bg,border:`1px solid ${B.border}`,borderRadius:10,padding:"9px 13px",fontSize:13,color:B.navy,cursor:"pointer",fontFamily:"inherit",lineHeight:1.35}}>{s}</button>)}
        </div>
      </div>}

      {messages.map((m,i)=>m.role==="user"
        ? <div key={i} style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
            <div style={{background:B.navy,color:B.white,borderRadius:"14px 14px 4px 14px",padding:"10px 14px",fontSize:14,maxWidth:"82%",lineHeight:1.45}}>{m.content}</div>
          </div>
        : <div key={i} style={{display:"flex",gap:10,marginBottom:14,alignItems:"flex-start"}}>
            <div style={{width:26,height:26,borderRadius:"50%",background:`linear-gradient(135deg,${B.navy},${B.navyMid})`,color:B.gold,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0,marginTop:1}}>✦</div>
            <div style={{maxWidth:"88%"}}>
              <div style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:"14px 14px 14px 4px",padding:"11px 15px",fontSize:14,color:B.text,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{renderRich(m.content)}</div>
              <div style={{display:"flex",gap:14,marginTop:6,paddingLeft:4}}>
                <button onClick={()=>printAnswer(m.content)} title="Print this answer" style={{background:"none",border:"none",color:B.textMute,fontSize:11,cursor:"pointer",fontFamily:"inherit",padding:0,display:"flex",alignItems:"center",gap:4}}>🖨 Print</button>
                <button onClick={()=>emailAnswer(m.content)} title="Email this answer" style={{background:"none",border:"none",color:B.textMute,fontSize:11,cursor:"pointer",fontFamily:"inherit",padding:0,display:"flex",alignItems:"center",gap:4}}>✉ Email</button>
                <button onClick={()=>shareAnswer(m.content)} title="Share this answer" style={{background:"none",border:"none",color:B.textMute,fontSize:11,cursor:"pointer",fontFamily:"inherit",padding:0,display:"flex",alignItems:"center",gap:4}}>↗ Share</button>
              </div>
            </div>
          </div>)}

      {busy&&<div style={{display:"flex",gap:10,alignItems:"center",color:B.textSoft,fontSize:13}}>
        <div style={{width:26,height:26,borderRadius:"50%",background:`linear-gradient(135deg,${B.navy},${B.navyMid})`,color:B.gold,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>✦</div>
        <span style={{fontStyle:"italic"}}>Reviewing the dashboard…</span>
      </div>}
    </div>

    {error&&<div style={{background:"#fde8e8",border:"1px solid #f5c6c6",color:"#8b1a1a",borderRadius:10,padding:"10px 14px",fontSize:13,marginBottom:12}}>⚠ {error}</div>}

    {/* Input */}
    <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
      <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onKey} placeholder="Ask about net worth, a property, a loan, insurance, tasks…" rows={2}
        style={{flex:1,resize:"none",border:`1px solid ${B.border}`,borderRadius:10,padding:"11px 14px",fontSize:14,fontFamily:"inherit",color:B.text,background:B.white,outline:"none",lineHeight:1.4}}/>
      <Btn onClick={()=>ask()} disabled={busy||!input.trim()}>{busy?"…":"Ask"}</Btn>
    </div>
    <div style={{fontSize:11,color:B.textMute,marginTop:8,lineHeight:1.4}}>
      Answers are generated from your dashboard data and may not reflect changes made elsewhere. Not financial, tax, or legal advice — verify important figures with your advisor.
    </div>
  </div>;
}

// Tracks which families have already been greeted this browser session, so the
// welcome popup appears once per login (per family) rather than on every view.
const _greetedFamilies=new Set();

function AssistantWelcome({family,data,reload,onClose,userProfile,toast}){
  const assistantName=(((data.families||[]).find(x=>x.id===family.id)||family).assistantName||"").trim()||"Ordanis";
  const[emailOpen,setEmailOpen]=useState(false);
  const isClient=userProfile&&userProfile.role==="client";
  return <Modal title={`Hi — I'm ${assistantName}`} onClose={onClose} wide>
    <div style={{fontSize:14,color:B.text,lineHeight:1.55,marginBottom:16}}>
      Anything I can help you find before you dive in? Ask me about your net worth, properties, loans, insurance, tasks, or documents — or head straight to the dashboard.
    </div>
    <FamilyAssistant family={family} data={data} reload={reload} compact toast={toast}/>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginTop:16,flexWrap:"wrap"}}>
      {isClient?<Btn variant="ghost" onClick={()=>setEmailOpen(true)}>✉ Email my Ordanis Expert</Btn>:<span/>}
      <Btn onClick={onClose}>Take me to the dashboard →</Btn>
    </div>
    {emailOpen&&<EmailAdvisorModal family={family} userProfile={userProfile} data={data} onClose={()=>setEmailOpen(false)}/>}
  </Modal>;
}

// ── FLOATING ASSISTANT ────────────────────────────────────────────────────────
// A persistent, brand-marked button that opens the AI assistant from anywhere.
//
// The assistant is strictly per-family (it answers from ONE family's snapshot),
// but the firm-wide screens — dashboard, portfolio, pipeline — have no family in
// context. So when a family is supplied (client portal, or an advisor drilled
// into a relationship) it opens straight into the chat; otherwise it first asks
// which client to talk about. That keeps the button available on every page
// without ever letting the assistant answer across families.
function FloatingAssistant({family,families,data,reload,toast,userProfile}){
  const[open,setOpen]=useState(false);
  const[picked,setPicked]=useState(null);
  const[q,setQ]=useState("");
  const isMobile=useIsMobile();
  const active=family||picked;
  const list=(families||[]).filter(f=>!q.trim()||(f.name||"").toLowerCase().includes(q.trim().toLowerCase()));
  const assistantName=((active&&active.assistantName)||"").trim()||"Ordanis";
  const close=()=>{setOpen(false);setPicked(null);setQ("");};

  return <>
    <button onClick={()=>setOpen(true)} title={`Ask ${assistantName}`} aria-label={`Ask ${assistantName}`}
      style={{position:"fixed",bottom:isMobile?18:26,right:isMobile?18:26,zIndex:900,width:isMobile?54:60,height:isMobile?54:60,
        borderRadius:"50%",border:`2px solid ${B.gold}`,background:B.navy,cursor:"pointer",padding:0,overflow:"hidden",
        boxShadow:"0 6px 22px rgba(0,0,0,0.28)",display:"flex",alignItems:"center",justifyContent:"center",transition:"transform .15s ease"}}
      onMouseEnter={e=>e.currentTarget.style.transform="scale(1.07)"}
      onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
      {BRAND.mark
        ? <img src={BRAND.mark} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
        : <span style={{color:B.gold,fontSize:22}}>✦</span>}
    </button>

    {open&&<Modal wide title={active?`Ask ${assistantName} — ${(active.name||"").replace(" [DEMO]","")}`:`Ask ${assistantName}`} onClose={close}>
      {active
        ? <>
            <FamilyAssistant family={active} data={data} reload={reload} toast={toast} compact/>
            {!family&&<div style={{marginTop:14,textAlign:"center"}}>
              <Btn small variant="ghost" onClick={()=>{setPicked(null);setQ("");}}>← Choose a different client</Btn>
            </div>}
          </>
        : <>
            <div style={{fontSize:12.5,color:B.textSoft,marginBottom:12,lineHeight:1.5}}>
              {assistantName} answers from one client's records at a time. Which client?
            </div>
            {(families||[]).length>6&&<Inp autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search clients…" style={{marginBottom:10}}/>}
            <div style={{maxHeight:340,overflowY:"auto",display:"flex",flexDirection:"column",gap:7}}>
              {list.map(f=><button key={f.id} onClick={()=>setPicked(f)}
                style={{textAlign:"left",background:B.bg,border:`1px solid ${B.borderLight}`,borderLeft:`3px solid ${f.color||B.gold}`,
                  borderRadius:8,padding:"11px 13px",cursor:"pointer",fontFamily:"inherit"}}
                onMouseEnter={e=>e.currentTarget.style.background=B.white}
                onMouseLeave={e=>e.currentTarget.style.background=B.bg}>
                <div style={{fontSize:14,color:B.navy,fontWeight:600}}>{f.name}</div>
                {f.advisorName&&<div style={{fontSize:11,color:B.textSoft,marginTop:1}}>{roleLabel("advisor")}: {f.advisorName}</div>}
              </button>)}
              {!list.length&&<Empty text="No clients match that search."/>}
            </div>
          </>}
    </Modal>}
  </>;
}

// Compose an email to your designated advisor (or anyone else) and send it
// through the platform. Defaults to the primary advisor on the relationship;
// the dropdown otherwise only offers contacts flagged as an advisor under
// Team Member & Contacts — never other advisors from the firm at
// large. The primary advisor is ALWAYS cc'd (locked) unless they're already
// the direct recipient — this cannot be turned off client-side, and the
// server enforces it independently regardless of what's submitted.
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function EmailAdvisorModal({family,userProfile,data,onClose}){
  const primaryName=(family.advisorName||"").trim();
  const primaryEmailRaw=(family.advisorEmail||"").trim();
  const primaryEmail=primaryEmailRaw.toLowerCase();

  // Dropdown options: the primary advisor first, then any Team Member &
  // Contacts entry flagged as an advisor for this family.
  const flagged=((data&&data.family_contacts)||[]).filter(c=>c.familyId===family.id&&c.isAdvisor&&(c.email||"").trim());
  const options=useMemo(()=>{
    const seen=new Set();
    const out=[];
    if(primaryEmailRaw){ seen.add(primaryEmail); out.push({name:primaryName||primaryEmailRaw,email:primaryEmail,primary:true}); }
    flagged.forEach(c=>{ const e=(c.email||"").trim().toLowerCase(); if(e&&!seen.has(e)){ seen.add(e); out.push({name:c.name||c.email,email:e,primary:false}); } });
    return out;
  },[flagged,primaryEmail,primaryEmailRaw,primaryName]);

  const clientName=(userProfile&&userProfile.fullName)||family.name||"";
  const clientEmail=(userProfile&&userProfile.email)||"";
  const[toEmail,setToEmail]=useState(options[0]?options[0].email:"");
  const selected=options.find(o=>o.email===toEmail)||options[0]||null;

  const[customs,setCustoms]=useState([]); // [{name,email}]
  const[customName,setCustomName]=useState("");
  const[customEmail,setCustomEmail]=useState("");
  const[addErr,setAddErr]=useState(null);
  const[subject,setSubject]=useState(`Message from ${family.name||clientName||"client"}`);
  const[msg,setMsg]=useState("");
  const[sending,setSending]=useState(false);
  const[err,setErr]=useState(null);
  const[sent,setSent]=useState(false);

  const addCustom=()=>{
    const email=customEmail.trim().toLowerCase();
    setAddErr(null);
    if(!email||!EMAIL_RE.test(email)){ setAddErr("Enter a valid email address."); return; }
    if((selected&&email===selected.email)||customs.some(c=>c.email===email)){ setAddErr("That person is already included."); return; }
    setCustoms(list=>[...list,{name:customName.trim()||email,email}]);
    setCustomName("");setCustomEmail("");
  };
  const removeCustom=email=>setCustoms(list=>list.filter(c=>c.email!==email));

  // Final recipients: the dropdown selection plus anyone added manually.
  const seenR=new Set();
  const recipients=[selected,...customs].filter(Boolean).filter(r=>{ if(seenR.has(r.email))return false; seenR.add(r.email); return true; });
  const ccPrimary=(primaryEmailRaw&&!recipients.some(r=>r.email===primaryEmail))?{name:primaryName||primaryEmailRaw,email:primaryEmail}:null;

  const send=async()=>{
    if(!recipients.length||sending||!msg.trim())return;
    setSending(true);setErr(null);
    try{
      const{data:resp,error}=await sb.functions.invoke("send-advisor-email",{body:{toEmails:recipients.map(r=>r.email),subject,message:msg}});
      if(error)throw new Error(error.message||"Could not send.");
      if(resp&&resp.error)throw new Error(resp.detail||resp.error);
      setSent(true);
    }catch(e){ setErr(e&&e.message?e.message:"Could not send the email."); }
    finally{ setSending(false); }
  };

  return <Modal title="Email your Ordanis Expert" onClose={onClose}>
    {sent?<div style={{textAlign:"center",padding:"12px 0"}}>
      <div style={{fontSize:40,marginBottom:8}}>✓</div>
      <div style={{fontSize:16,color:B.navy,fontWeight:600,fontFamily:"'Cormorant Garamond',serif"}}>Message sent</div>
      <div style={{fontSize:13,color:B.textSoft,marginTop:6,lineHeight:1.5}}>Your message went to <strong>{recipients.map(r=>r.name).join(", ")}</strong>{ccPrimary?<>, with <strong>{ccPrimary.name}</strong> copied</>:null}. They can reply directly to your email.</div>
      <div style={{marginTop:18}}><Btn onClick={onClose}>Done</Btn></div>
    </div>:<>
      <Field label="To">
        {options.length>0
          ? <Sel value={toEmail} onChange={e=>setToEmail(e.target.value)}>{options.map(o=><option key={o.email} value={o.email}>{o.name}{o.primary?" (primary Ordanis Expert)":""} · {o.email}</option>)}</Sel>
          : <div style={{fontSize:13,color:B.textMute,padding:"9px 0"}}>No designated Ordanis Expert is on file yet — add one under Team Member & Contacts, or add someone below.</div>}
      </Field>
      {ccPrimary&&<div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:B.navy,background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:8,padding:"9px 12px",marginBottom:12}}>
        <span style={{fontSize:13}}>🔒</span>
        <div style={{minWidth:0}}>
          <div><span style={{fontWeight:700}}>Cc:</span> {ccPrimary.name} · {ccPrimary.email}</div>
          <div style={{fontSize:11,color:B.textMute,marginTop:1}}>Your primary Ordanis Expert is always copied and can't be removed.</div>
        </div>
      </div>}
      {customs.length>0&&<div style={{marginBottom:10}}>
        {customs.map(c=><div key={c.email} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 10px",background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:8,marginBottom:6}}>
          <div style={{minWidth:0}}>
            <span style={{fontSize:13,color:B.navy,fontWeight:600}}>{c.name}</span>
            <span style={{fontSize:11,color:B.textMute}}> · {c.email}</span>
          </div>
          <button onClick={()=>removeCustom(c.email)} title="Remove" style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:13,flexShrink:0}}>✕</button>
        </div>)}
      </div>}
      <Field label="Add Someone Else (optional)">
        <div style={{display:"flex",gap:8}}>
          <Inp placeholder="Name (optional)" value={customName} onChange={e=>setCustomName(e.target.value)} style={{flex:1}}/>
          <Inp placeholder="email@example.com" value={customEmail} onChange={e=>setCustomEmail(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addCustom();}}} style={{flex:1}}/>
          <Btn small variant="ghost" onClick={addCustom}>+ Add</Btn>
        </div>
        {addErr&&<div style={{fontSize:11,color:"#8b1a1a",marginTop:5}}>{addErr}</div>}
      </Field>
      {!ccPrimary&&!primaryEmailRaw&&<div style={{fontSize:11,color:B.textMute,marginBottom:12}}>No primary Ordanis Expert is on file for your account yet — this will go out without an automatic copy.</div>}
      <Field label="Subject"><Inp value={subject} onChange={e=>setSubject(e.target.value)}/></Field>
      <Field label="Message"><textarea value={msg} onChange={e=>setMsg(e.target.value)} rows={7} placeholder="Write your message…" style={{width:"100%",resize:"vertical",border:`1px solid ${B.border}`,borderRadius:8,padding:"11px 13px",fontSize:14,fontFamily:"inherit",color:B.text,background:B.white,outline:"none",lineHeight:1.5}}/></Field>
      <div style={{fontSize:11,color:B.textMute,margin:"6px 0 14px"}}>{clientEmail?<>Sent from your address (<strong>{clientEmail}</strong>) — recipients can reply straight to you.</>:"Recipients can reply straight to you."}</div>
      {err&&<div style={{background:"#fde8e8",border:"1px solid #f5c6c6",color:"#8b1a1a",borderRadius:8,padding:"9px 12px",fontSize:12,marginBottom:12}}>⚠ {err}</div>}
      <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
        <button onClick={onClose} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
        <Btn onClick={send} disabled={sending||!recipients.length||!subject.trim()||!msg.trim()}>{sending?"Sending…":"✉ Send email"}</Btn>
      </div>
    </>}
  </Modal>;
}

function FamilyDashboard({family,data,reload,toast,onBack,userProfile,initialTab}){
  const isMobile=useIsMobile();
  // Partner role: full read access to everything in this dashboard, but no
  // create/edit/delete anywhere except uploading documents (handled separately
  // below). Enforced for real via RLS (write_access policies exclude partner);
  // this just keeps the UI from showing controls that would fail server-side.
  const canEdit=userProfile?.role!=="partner";
  // PROVIDERS_COLLAPSE
  // Keyed by property and defaulting closed. A Set rather than a single id because
  // comparing two properties' vendors means having both open at once.
  const[openProviders,setOpenProviders]=useState(()=>new Set());
  const toggleProviders=id=>setOpenProviders(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});
  const[activeTab,setActiveTab]=useState(initialTab||"overview");
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
    const d=new Date(c.dob); if(isNaN(d.getTime()))return null;
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

  const totalRE=properties.reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0);
  const totalDebt=properties.reduce((s,p)=>s+(Number(p.loanBalance)||0)+(Number(p.secondMortgageBalance)||0),0)+accounts.filter(a=>a.accountType==="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const totalAccounts=accounts.filter(a=>a.accountType!=="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const totalValuables=valuables.reduce((s,v)=>s+(Number(v.estimatedValue)||0),0);
  const netWorth=totalRE-totalDebt+totalAccounts+totalValuables;
  const overdueTasks=pendingTasks.filter(t=>t.dueDate&&new Date(t.dueDate)<new Date());
  const soonTasks=pendingTasks.filter(t=>t.dueDate&&!overdueTasks.includes(t)&&(new Date(t.dueDate)-new Date())/(86400000)<=30);

  // Scheduled Prompts is visible to every Ordanis Expert/Admin, and to a Partner
  // only when an admin has flipped their can_run_scheduled_prompts toggle on.
  const canSeePrompts=userProfile?.role==="advisor"||userProfile?.role==="admin"||(userProfile?.role==="partner"&&userProfile?.canRunScheduledPrompts);
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

  // "Ask Ordanis" is the internal key, not the label — the label resolves to this household's
  // assistant name at render, so a family whose assistant is called Nova reads "Ask Nova"
  // while the tab id stays "askordanis" and existing links keep working.
  //
  // It sits LAST, after Prompts. The records tabs are a set of ledgers; the assistant is a
  // different kind of thing, and putting it at the end stops the eye reading twelve equal
  // siblings. The star marks it as the AI feature.
  //
  // Obligations is absent entirely on Core rather than shown disabled. A locked door on every
  // visit is worse than no door, and the tab row is already the tightest thing on this screen.
  const TABS=["Overview","Properties","Portfolio","Cash Flow",...(hasWorkflows?["Obligations"]:[]),"Valuables","Deals","Notes","Tasks","Vault",...(canSeePrompts?["Prompts"]:[]),"Ask Ordanis"];
  const assistantName=(familyRow.assistantName||"").trim()||"Ordanis";
  const[showWelcome,setShowWelcome]=useState(false);
  // Carries "attach a document to this property section" from the Properties tab
  // over to the Vault tab, which owns the upload form.
  const[attachIntent,setAttachIntent]=useState(null);
  // Tab ids are the lowercased, de-spaced label (see the TABS map below).
  const startAttach=(propertyId,section)=>{setAttachIntent({propertyId,section});setActiveTab("vault");};
  useEffect(()=>{
    if(!family?.id)return;
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
    const path=`note-attachments/${family.id}/${Date.now()}_${Math.random().toString(36).slice(2,8)}_${file.name.replace(/\s+/g,"_")}`;
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
    if(!body){toast("A note cannot be empty. Delete it instead.","error");return;}
    if(body===(n.body||"")){cancelEditNote();return;}   // nothing changed, do not stamp an edit
    const{error}=await sb.from("notes")
      .update({body,updated_at:new Date().toISOString()}).eq("id",n.id);
    if(error){toast(error.message,"error");return;}
    toast("Note updated");
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
      toast("Note added");
    }
    setNoteBody("");setPendingNoteFiles([]);
    reload("notes");reload("note_attachments");
  };
  // Download a note attachment via signed URL
  const downloadNoteAttachment=async(att)=>{
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
    const{error}=await sb.from("tasks").insert({family_id:family.id,contact_id:f.contactId||null,title:f.title,due_date:f.dueDate||null,priority:f.priority,reminder_days:f.reminderDays||7,done:false,recurrence:f.recurrence||null,recurrence_interval:f.recurrence==="Custom"?(Number(f.recurrenceInterval)||1):null,recurrence_unit:f.recurrence==="Custom"?(f.recurrenceUnit||"week"):null});
    if(error)toast(error.message,"error");else{toast("Task added");reload("tasks");}
  };
  const toggleTask=async(t)=>{
    const marking=!t.done;
    const{error}=await sb.from("tasks").update(marking?{done:true,completed_at:new Date().toISOString(),completed_by:CURRENT_USER_LABEL||null}:{done:false,completed_at:null,completed_by:null}).eq("id",t.id);
    if(error){toast(error.message,"error");return;}
    if(marking&&t.recurrence){
      const nd=nextRecurrence(t.dueDate,t.recurrence,t.recurrenceInterval,t.recurrenceUnit);
      if(nd){await sb.from("tasks").insert({family_id:t.familyId||family.id,contact_id:t.contactId||null,title:t.title,due_date:nd,priority:t.priority,reminder_days:t.reminderDays||7,done:false,recurrence:t.recurrence,recurrence_interval:t.recurrence==="Custom"?(t.recurrenceInterval||1):null,recurrence_unit:t.recurrence==="Custom"?(t.recurrenceUnit||"week"):null});toast("Next occurrence: "+fmt(nd));}
    }
    reload("tasks");
  };
  const delTask=async(id)=>{
    const{error}=await sb.from("tasks").delete().eq("id",id);
    if(error)toast(error.message,"error");else reload("tasks");
  };
  const delNote=async(id)=>{
    const{error}=await sb.from("notes").delete().eq("id",id);
    if(error)toast(error.message,"error");else reload("notes");
  };

  // Add/remove members
  const addMember=async(f)=>{
    const{error}=await sb.from("contacts").insert({family_id:family.id,name:f.name,email:f.email||null,phone:f.phone||null,company:f.company||null,type:f.type||"Individual",dob:f.dob||null,anniversary:f.anniversary||null,address:f.address||null,is_advisor:!!f.isAdvisor,tags:null});
    if(error)toast(error.message,"error");else{toast("Member added");reload("contacts");}
  };
  const delMember=async(id)=>{
    const{error}=await sb.from("contacts").delete().eq("id",id);
    if(error)toast(error.message,"error");else{toast("Member removed");reload("contacts");}
  };
  const editMember=async(f)=>{
    const{error}=await sb.from("contacts").update({name:f.name,email:f.email||null,phone:f.phone||null,company:f.company||null,type:f.type||"Individual",dob:f.dob||null,anniversary:f.anniversary||null,address:f.address||null,is_advisor:!!f.isAdvisor}).eq("id",editM.id);
    if(error)toast(error.message,"error");else{toast("Member updated");reload("contacts");}
  };
  const toggleMemberAdvisor=async(c)=>{
    if(!c.email){toast("Add an email to this contact first — the client emails them here.","error");return;}
    const{error}=await sb.from("contacts").update({is_advisor:!c.isAdvisor}).eq("id",c.id);
    if(error)toast(error.message,"error");else{toast(!c.isAdvisor?"Marked as an emailable Ordanis Expert":"Removed as Ordanis Expert option");reload("contacts");}
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
  const addFamilyContact=async(f)=>{const{error}=await sb.from("family_contacts").insert({family_id:family.id,name:f.name,role:f.role||null,company:f.company||null,email:f.email||null,phone:f.phone||null,is_advisor:!!f.isAdvisor,notes:f.notes||null});if(error)toast(error.message,"error");else{toast("Contact added");reload("family_contacts");}};
  const editFamilyContact=async(f)=>{const{error}=await sb.from("family_contacts").update({name:f.name,role:f.role||null,company:f.company||null,email:f.email||null,phone:f.phone||null,is_advisor:!!f.isAdvisor,notes:f.notes||null}).eq("id",editFC.id);if(error)toast(error.message,"error");else{toast("Contact updated");reload("family_contacts");}};
  const delFamilyContact=async(id)=>{const{error}=await sb.from("family_contacts").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Contact removed");reload("family_contacts");}};
  const toggleFCAdvisor=async(c)=>{if(!c.email){toast("Add an email to this contact first — the client emails them here.","error");return;}const{error}=await sb.from("family_contacts").update({is_advisor:!c.isAdvisor}).eq("id",c.id);if(error)toast(error.message,"error");else{toast(!c.isAdvisor?"Marked as an emailable Ordanis Expert":"Removed as Ordanis Expert option");reload("family_contacts");}};

  const propContactsFor=(pid)=>(data.property_contacts||[]).filter(pc=>pc.propertyId===pid);
  // Supporting document behind a given figure on a property card (mortgage note,
  // tax bill, insurance dec page, invoice, flood dec, rental agreement).
  const docForSection=(pid,section)=>(data.documents||[]).find(d=>d.propertyId===pid&&d.propertySection===section);
  // The family's scheduled-personal-property endorsement, linked from Valuables.
  const valuablesPolicyDoc=()=>(data.documents||[]).find(d=>d.familyId===family.id&&d.propertySection==="valuables_schedule");
  const addPropertyContact=async(pid,f)=>{const{error}=await sb.from("property_contacts").insert({property_id:pid,family_id:family.id,name:f.name,role:f.role||null,company:f.company||null,email:f.email||null,phone:f.phone||null,notes:f.notes||null});if(error)toast(error.message,"error");else{toast("Contact added");reload("property_contacts");}};
  const editPropertyContact=async(id,f)=>{const{error}=await sb.from("property_contacts").update({name:f.name,role:f.role||null,company:f.company||null,email:f.email||null,phone:f.phone||null,notes:f.notes||null}).eq("id",id);if(error)toast(error.message,"error");else{toast("Contact updated");reload("property_contacts");}};
  const delPropertyContact=async(id)=>{const{error}=await sb.from("property_contacts").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Contact removed");reload("property_contacts");}};

  // Add property
  const addProperty=async(f)=>{
    const row={family_id:family.id,owner_name:f.ownerName||null,address:f.address,property_type:f.propertyType,purchase_price:f.purchasePrice||null,purchase_date:f.purchaseDate||null,current_value:f.currentValue||null,lender:f.lender||null,loan_balance:f.loanBalance||null,interest_rate:f.interestRate||null,loan_payment:f.loanPayment||null,loan_maturity_date:f.loanMaturityDate||null,loan_type:f.loanType,rental_income:f.rentalIncome||null,property_taxes:f.propertyTaxes||null,utilities:f.utilities||null,insurance_company:f.insuranceCompany||null,insurance_premium:f.insurancePremium||null,insurance_expiration:f.insuranceExpiration||null,flood_insurance:!!f.floodInsurance,flood_insurance_company:f.floodInsuranceCompany||null,flood_insurance_premium:f.floodInsurancePremium||null,flood_insurance_expiration:f.floodInsuranceExpiration||null,hoa_fee:Number(f.hoaFee)||0,property_management_fee_pct:Number(f.propertyManagementFeePct)||0,include_mortgage_in_cashflow:f.includeMortgageInCashflow!==false,second_mortgage_balance:f.secondMortgageBalance||null,second_mortgage_payment:f.secondMortgagePayment||null,notes:f.notes||null};
    const{error}=await sb.from("properties").insert(row);
    if(error)toast(error.message,"error");else{toast("Property added");reload("properties");}
  };
  const editProperty=async(id,f)=>{
    const row={owner_name:f.ownerName||null,address:f.address,property_type:f.propertyType,purchase_price:f.purchasePrice||null,purchase_date:f.purchaseDate||null,current_value:f.currentValue||null,lender:f.lender||null,loan_balance:f.loanBalance||null,interest_rate:f.interestRate||null,loan_payment:f.loanPayment||null,loan_maturity_date:f.loanMaturityDate||null,loan_type:f.loanType,rental_income:f.rentalIncome||null,property_taxes:f.propertyTaxes||null,utilities:f.utilities||null,insurance_company:f.insuranceCompany||null,insurance_premium:f.insurancePremium||null,insurance_expiration:f.insuranceExpiration||null,flood_insurance:!!f.floodInsurance,flood_insurance_company:f.floodInsuranceCompany||null,flood_insurance_premium:f.floodInsurancePremium||null,flood_insurance_expiration:f.floodInsuranceExpiration||null,hoa_fee:Number(f.hoaFee)||0,property_management_fee_pct:Number(f.propertyManagementFeePct)||0,include_mortgage_in_cashflow:f.includeMortgageInCashflow!==false,second_mortgage_balance:f.secondMortgageBalance||null,second_mortgage_payment:f.secondMortgagePayment||null,notes:f.notes||null};
    const{error}=await sb.from("properties").update(row).eq("id",id);
    if(error)toast(error.message,"error");else{toast("Property updated");reload("properties");}
  };
  const delProperty=async(id)=>{
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
    const{error}=await sb.from("valuables").insert({family_id:family.id,category:f.category,description:f.description,make_model:f.makeModel||null,year:f.year||null,estimated_value:f.estimatedValue||null,insured:!!f.insured,insurance_company:f.insuranceCompany||null,notes:f.notes||null});
    if(error)toast(error.message,"error");else{toast("Valuable added");reload("valuables");}
  };
  const editValuable=async(id,f)=>{
    const{error}=await sb.from("valuables").update({category:f.category,description:f.description,make_model:f.makeModel||null,year:f.year||null,estimated_value:f.estimatedValue||null,insured:!!f.insured,insurance_company:f.insuranceCompany||null,notes:f.notes||null}).eq("id",id);
    if(error)toast(error.message,"error");else{toast("Valuable updated");reload("valuables");}
  };
  const delValuable=async(id)=>{
    const{error}=await sb.from("valuables").delete().eq("id",id);
    if(error)toast(error.message,"error");else reload("valuables");
  };

  // Add deal
  const addDeal=async(f)=>{
    const{error}=await sb.from("deals").insert({family_id:family.id,contact_id:f.contactId||null,title:f.title,value:f.value||null,stage:f.stage,close_date:f.closeDate||null});
    if(error)toast(error.message,"error");else{toast("Deal added");reload("deals");}
  };
  const moveDeal=async(deal,dir)=>{
    const idx=STAGES.indexOf(deal.stage);const next=STAGES[idx+dir];if(!next)return;
    const{error}=await sb.from("deals").update({stage:next}).eq("id",deal.id);
    if(error)toast(error.message,"error");else reload("deals");
  };
  const delDeal=async(id)=>{
    const{error}=await sb.from("deals").delete().eq("id",id);
    if(error)toast(error.message,"error");else reload("deals");
  };

  // Add portfolio account
  const addAccount=async(f)=>{
    const{error}=await sb.from("portfolio_accounts").insert({family_id:family.id,institution:f.institution,banker_name:f.bankerName||null,account_type:f.accountType,starting_balance:f.startingBalance||null,current_balance:f.currentBalance||null,notes:f.notes||null});
    if(error)toast(error.message,"error");else{toast("Account added");reload("portfolio_accounts");}
  };
  const editAccount=async(id,f)=>{
    const{error}=await sb.from("portfolio_accounts").update({institution:f.institution,banker_name:f.bankerName||null,account_type:f.accountType,starting_balance:f.startingBalance||null,current_balance:f.currentBalance||null,notes:f.notes||null}).eq("id",id);
    if(error)toast(error.message,"error");else{toast("Account updated");reload("portfolio_accounts");}
  };
  const delAccount=async(id)=>{
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
          {/* On Core the expert-of-record exists only so staff can open the household; naming them
              here as the household's Ordanis Expert would contradict the tier that was sold. */}
          {!isMobile&&<div style={{fontSize:12,color:B.textSoft,marginTop:2}}>
            {hasAssignedExpert
              ? <>Ordanis Expert: {family.advisorName||"—"}{family.advisorEmail?` · ${family.advisorEmail}`:""}</>
              : <>Partner-led · no assigned Ordanis Expert on this plan</>}
          </div>}
          {isMobile&&hasAssignedExpert&&family.advisorName&&<div style={{fontSize:11,color:B.textSoft,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{family.advisorName}</div>}
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          {overdueTasks.length>0&&<Badge scheme={{bg:"#fde8e8",text:"#8b1a1a",dot:"#d43030"}}>{overdueTasks.length} overdue</Badge>}
          {soonTasks.length>0&&<Badge scheme={{bg:"#fef3e2",text:"#8a5c00",dot:"#d4900a"}}>{soonTasks.length} due soon</Badge>}
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
      <div style={{borderBottom:`1px solid ${B.border}`,background:B.bg,padding:isMobile?"6px 8px 0":"8px 28px 0",display:"flex",gap:2,alignItems:"flex-end",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        {TABS.map(t=>{
          const id=t.toLowerCase().replace(/\s+/g,"");
          const on=activeTab===id;
          const isAssistant=t==="Ask Ordanis";
          const label=isAssistant?("Ask "+assistantName):t;
          return <button key={t} onClick={()=>setActiveTab(id)} aria-current={on?"page":undefined}
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
              // Covers the container's bottom border, which is what turns a butted edge into
              // a continuous surface. Without it the tab looks stuck on rather than attached.
              marginBottom:-1,
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
      </div>

      {/* Content */}
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>

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
              {contacts.length===0?<Empty text="No members yet — add the first one"/>:contacts.map(c=><div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${B.borderLight}`,gap:10,flexWrap:"wrap"}}>
                {/* MEMBER_ROW_RESPONSIVE: minWidth:0 is what actually lets this column
                    shrink — a flex item defaults to min-width:auto and will refuse to go
                    below its content width, which is what pushed the action buttons off
                    the edge rather than wrapping them. */}
                <div style={{flex:"1 1 200px",minWidth:0}}>
                  <div style={{fontWeight:600,color:B.navy,fontSize:13}}>{c.name}{c.dob&&(()=>{const d=new Date(c.dob);if(isNaN(d))return null;const t=new Date();let a=t.getFullYear()-d.getFullYear();const m=t.getMonth()-d.getMonth();if(m<0||(m===0&&t.getDate()<d.getDate()))a--;return a>=0?<span style={{fontWeight:400,color:B.textSoft,fontSize:11,marginLeft:6}}>· {a} yrs</span>:null;})()}
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
              {famContacts.length===0?<Empty text="No contacts yet — add team members, CPA, attorney…"/>:famContacts.map(c=><div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${B.borderLight}`,gap:8}}>
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
              {pendingTasks.length===0?<Empty text="No pending tasks"/>:[...pendingTasks].sort((a,b)=>a.dueDate>b.dueDate?1:-1).slice(0,5).map(t=>{
                const isOD=t.dueDate&&new Date(t.dueDate)<new Date();
                const isSoon=!isOD&&t.dueDate&&(new Date(t.dueDate)-new Date())/(86400000)<=30;
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
            {famNotes.length===0?<Empty text="No notes yet"/>:[...famNotes].sort((a,b)=>b.createdAt>a.createdAt?1:-1).slice(0,4).map(n=><div key={n.id} style={{padding:"10px 0",borderBottom:`1px solid ${B.borderLight}`,display:"flex",justifyContent:"space-between",gap:10}}>
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
        </div>}

        {/* PROPERTIES TAB */}
        {activeTab==="properties"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:13,color:B.textSoft}}>{properties.length} properties · {fmtMoney(totalRE)} total · {fmtMoney(totalDebt)} debt</div>
            {canEdit&&<Btn onClick={()=>setModal("property")}>+ Add Property</Btn>}
          </div>
          {properties.length===0?<Empty text="No properties yet. Add the first one."/>:(()=>{
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
          {accounts.length===0?<Empty text="No portfolio accounts yet."/>:accounts.map(a=>{
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
        {activeTab==="obligations"&&hasWorkflows&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
          <ObligationsSection family={family} data={data} toast={toast} canEdit={canEdit} userProfile={userProfile}/>
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
              {items.map(v=><div key={v.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid #8b5cf6`,borderRadius:10,padding:"14px 18px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"flex-start",boxShadow:B.shadow}}>
                <div>
                  <div style={{fontWeight:700,color:B.navy,fontSize:13}}>{v.description}</div>
                  {v.makeModel&&<div style={{fontSize:12,color:B.textSoft}}>{v.makeModel}{v.year?` · ${v.year}`:""}</div>}
                  {v.insured?<div style={{fontSize:11,color:"#18a850",fontWeight:600,marginTop:3}}>✓ Insured{v.insuranceCompany?` — ${v.insuranceCompany}`:""}<DocLink doc={valuablesPolicyDoc()} toast={toast} label="📄 policy"/></div>:<div style={{fontSize:11,color:"#b4551f",fontWeight:600,marginTop:3}}>⚠ Not scheduled<DocLink doc={valuablesPolicyDoc()} toast={toast} label="📄 policy"/></div>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontSize:15,fontWeight:700,color:B.navy}}>{fmtMoney(v.estimatedValue)}</div>
                  {canEdit&&<Btn small variant="ghost" onClick={()=>setModal({type:"editValuable",valuable:v})}>Edit</Btn>}
                  {canEdit&&<Btn small variant="danger" onClick={()=>delValuable(v.id)}>✕</Btn>}
                </div>
              </div>)}
            </div>;
          })}
          {valuables.length===0&&<Empty text="No valuables recorded yet."/>}
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
            {famNotes.length===0?<Empty text="No notes yet."/>:[...famNotes].sort((a,b)=>b.createdAt>a.createdAt?1:-1).map(n=>{
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
          {famTasks.length===0?<Empty text="No tasks yet."/>:famTasks.map(t=>{
            const isOD=!t.done&&t.dueDate&&new Date(t.dueDate)<new Date();
            const isSoon=!t.done&&!isOD&&t.dueDate&&(new Date(t.dueDate)-new Date())/(86400000)<=30;
            return <div key={t.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",marginBottom:8,background:B.white,border:`1px solid ${isOD?"#f5c6c6":B.borderLight}`,borderLeft:`3px solid ${isOD?"#d43030":isSoon?"#d4900a":PRIORITY_COLORS[t.priority]?.dot||B.gold}`,borderRadius:10,opacity:t.done?.55:1,boxShadow:B.shadow}}>
              <input type="checkbox" checked={!!t.done} onChange={()=>toggleTask(t)} disabled={!canEdit} style={{width:16,height:16,accentColor:B.navy,cursor:"pointer",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,color:B.navy,textDecoration:t.done?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                <div style={{fontSize:12,color:B.textSoft,marginTop:2,display:"flex",gap:10}}>
                  {t.dueDate&&<span style={{color:isOD?"#d43030":isSoon?"#d4900a":B.textSoft}}>{isOD?"⚠ Overdue · ":isSoon?"⏰ · ":""}{fmt(t.dueDate)}</span>}
                  {t.reminderDays&&<span style={{color:B.textMute}}>🔔 {t.reminderDays}d reminder</span>}
                </div>
              </div>
              <Badge scheme={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
              {canEdit&&<Btn small variant="danger" onClick={()=>delTask(t.id)}>✕</Btn>}
            </div>;
          })}
        </div>}
      </div>

      {/* VAULT TAB */}
      {activeTab==="vault"&&<div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
        <DocumentsView familyId={family.id} readOnly={false} canUpload={true} canDelete={canEdit} canScan={canEdit} canEditMetadata={canEdit} toast={toast} reload={reload}
          attachIntent={attachIntent} onAttachHandled={()=>setAttachIntent(null)}/>
      </div>}

      {activeTab==="askordanis"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
        <FamilyAssistant family={family} data={data} reload={reload} toast={toast}/>
      </div>}

      {/* PROMPTS TAB — Ordanis Experts/Admins always; Partners only if permitted */}
      {activeTab==="prompts"&&<div style={{padding:isMobile?"16px 14px":"24px 28px"}}>
        <ScheduledPromptsSection userProfile={userProfile} families={data.families||[]} toast={toast} lockFamilyId={userProfile?.role==="partner"?family.id:undefined}/>
      </div>}

      {/* Modals */}
      {showWelcome&&<AssistantWelcome family={family} data={data} reload={reload} onClose={()=>setShowWelcome(false)} toast={toast}/>}
      {modal==="familyContact"&&<Modal title={editFC?"Edit Contact":"Add Contact"} onClose={()=>{setModal(null);setEditFC(null);}}><FamilyContactForm initial={editFC?{name:editFC.name||"",role:editFC.role||"",company:editFC.company||"",email:editFC.email||"",phone:editFC.phone||"",isAdvisor:!!editFC.isAdvisor,notes:editFC.notes||""}:null} onSave={async f=>{editFC?await editFamilyContact(f):await addFamilyContact(f);setModal(null);setEditFC(null);}} onClose={()=>{setModal(null);setEditFC(null);}}/></Modal>}
      {modal==="member"&&<Modal title={editM?"Edit Member":"Add Member"} onClose={()=>{setModal(null);setEditM(null);}}>
        <MemberForm initial={editM?{name:editM.name||"",email:editM.email||"",phone:editM.phone||"",company:editM.company||"",type:editM.type||"Individual",dob:editM.dob||"",anniversary:editM.anniversary||"",address:editM.address||"",isAdvisor:!!editM.isAdvisor}:null} onSave={async f=>{editM?await editMember(f):await addMember(f);setModal(null);setEditM(null);}} onClose={()=>{setModal(null);setEditM(null);}}/>
      </Modal>}
      {modal==="task"&&<Modal title="New Task" onClose={()=>setModal(null)}><TaskForm contacts={contacts} onSave={async f=>{await addTask(f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
      {modal==="property"&&<Modal title="Add Property" onClose={()=>setModal(null)} wide><PropertyForm canExtract={true} onSave={async f=>{await addProperty(f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
      {modal&&modal.type==="editProperty"&&<Modal title="Edit Property" onClose={()=>setModal(null)} wide><PropertyForm initial={modal.property} canExtract={true} onSave={async f=>{await editProperty(modal.property.id,f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
      {modal==="valuable"&&<Modal title="Add Valuable" onClose={()=>setModal(null)}><ValuableForm onSave={async f=>{await addValuable(f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
      {modal&&modal.type==="propertyContact"&&<Modal title={modal.contact?"Edit Service Provider":"Add Service Provider"} onClose={()=>setModal(null)}><PropertyContactForm initial={modal.contact?{name:modal.contact.name||"",role:modal.contact.role||"",company:modal.contact.company||"",email:modal.contact.email||"",phone:modal.contact.phone||"",notes:modal.contact.notes||""}:null} onSave={async f=>{modal.contact?await editPropertyContact(modal.contact.id,f):await addPropertyContact(modal.propertyId,f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
      {modal&&modal.type==="editValuable"&&<Modal title="Edit Valuable" onClose={()=>setModal(null)}><ValuableForm initial={modal.valuable} onSave={async f=>{await editValuable(modal.valuable.id,f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
      {modal==="deal"&&<Modal title="Add Deal" onClose={()=>setModal(null)}><SimpleDealForm contacts={contacts} onSave={async f=>{await addDeal(f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
      {modal==="account"&&<Modal title="Add Portfolio Account" onClose={()=>setModal(null)}><AccountForm onSave={async f=>{await addAccount(f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
      {modal&&modal.type==="editAccount"&&<Modal title="Edit Portfolio Account" onClose={()=>setModal(null)}><AccountForm initial={modal.account} onSave={async f=>{await editAccount(modal.account.id,f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
      {reportOpen&&<FamilyReport family={family} data={data} onClose={()=>setReportOpen(false)}/>}
    </div>
  );
}

// ── MEMBER FORM ───────────────────────────────────────────────────────────────
function PropertyContactForm({initial,onSave,onClose}){
  const[f,setF]=useState(initial||{name:"",role:"",company:"",email:"",phone:"",notes:""});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const save=async()=>{if(!f.name.trim())return;setSaving(true);await onSave(f);onClose();};
  return <div>
    <Field label="Name"><Inp placeholder="ABC Landscaping" value={f.name} onChange={set("name")}/></Field>
    <Grid2>
      <Field label="Service / Role"><Inp placeholder="Landscaper · Pool · Manager" value={f.role||""} onChange={set("role")}/></Field>
      <Field label="Company"><Inp placeholder="Company name" value={f.company||""} onChange={set("company")}/></Field>
    </Grid2>
    <Grid2>
      <Field label="Phone"><Inp placeholder="(555) 000-0000" value={f.phone||""} onChange={e=>set("phone")({target:{value:formatPhoneInput(e.target.value)}})}/></Field>
      <Field label="Email"><Inp type="email" placeholder="contact@company.com" value={f.email||""} onChange={set("email")}/></Field>
    </Grid2>
    <Field label="Notes"><Inp placeholder="Optional — schedule, gate code, account #…" value={f.notes||""} onChange={set("notes")}/></Field>
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn onClick={save} disabled={saving}>{saving?"Saving…":initial?"Save Changes":"Add Provider"}</Btn>
    </div>
  </div>;
}

function FamilyContactForm({initial,onSave,onClose,hideAdvisor=false,rolePlaceholder="CPA · Estate Attorney · Wealth Advisor"}){
  const[f,setF]=useState(initial||{name:"",role:"",company:"",email:"",phone:"",isAdvisor:false,notes:""});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const save=async()=>{if(!f.name.trim())return;setSaving(true);await onSave(f);onClose();};
  return <div>
    <Field label="Name"><Inp placeholder="John Smith" value={f.name} onChange={set("name")}/></Field>
    <Grid2>
      <Field label="Role / Title"><Inp placeholder={rolePlaceholder} value={f.role||""} onChange={set("role")}/></Field>
      <Field label="Company / Firm"><Inp placeholder="Smith & Co." value={f.company||""} onChange={set("company")}/></Field>
    </Grid2>
    <Grid2>
      <Field label="Email"><Inp type="email" placeholder="john@firm.com" value={f.email||""} onChange={set("email")}/></Field>
      <Field label="Phone"><Inp placeholder="(555) 000-0000" value={f.phone||""} onChange={e=>set("phone")({target:{value:formatPhoneInput(e.target.value)}})}/></Field>
    </Grid2>
    <Field label="Notes"><Inp placeholder="Optional" value={f.notes||""} onChange={set("notes")}/></Field>
    {!hideAdvisor&&<label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"10px 14px",background:f.isAdvisor?"rgba(206,182,132,0.15)":B.bg,borderRadius:8,border:`1px solid ${f.isAdvisor?B.gold:B.border}`,marginBottom:4}}>
      <input type="checkbox" checked={!!f.isAdvisor} onChange={e=>setF(p=>({...p,isAdvisor:e.target.checked}))} style={{width:16,height:16,accentColor:B.navy}}/>
      <span style={{fontSize:13,color:B.navy,fontWeight:600}}>Client can email this contact</span>
      <span style={{fontSize:11,color:B.textMute}}>appears in the client's "Email my Ordanis Expert"</span>
    </label>}
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
  const save=async()=>{if(!f.name.trim())return;setSaving(true);await onSave(f);onClose();};
  return <div>
    <Field label="Full Name"><Inp placeholder="Jane Smith" value={f.name} onChange={set("name")}/></Field>
    <Grid2>
      <Field label="Email"><Inp type="email" placeholder="jane@email.com" value={f.email||""} onChange={set("email")}/></Field>
      <Field label="Phone"><Inp placeholder="(555) 000-0000" value={f.phone||""} onChange={e=>set("phone")({target:{value:formatPhoneInput(e.target.value)}})}/></Field>
    </Grid2>
    <Grid2>
      <Field label="Company / LLC"><Inp placeholder="Smith Holdings LLC" value={f.company||""} onChange={set("company")}/></Field>
      <Field label="Type"><Sel value={f.type} onChange={set("type")}><option>Individual</option><option>Business</option></Sel></Field>
    </Grid2>
    <Grid2>
      <Field label="Date of Birth"><Inp type="date" value={f.dob||""} onChange={set("dob")}/></Field>
      <Field label="Anniversary"><Inp type="date" value={f.anniversary||""} onChange={set("anniversary")}/></Field>
      <Field label="Address"><Inp placeholder="123 Main St, Tampa, FL" value={f.address||""} onChange={set("address")}/></Field>
    </Grid2>
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn onClick={save} disabled={saving}>{saving?"Saving…":initial?"Save Changes":"Add Member"}</Btn>
    </div>
  </div>;
}

// ── TASK FORM (with reminder) ─────────────────────────────────────────────────
// Compute the next due date for a recurring task. Returns YYYY-MM-DD or null.
function nextRecurrence(dateStr,recurrence,interval,unit){
  if(!recurrence)return null;
  const base=dateStr?new Date(dateStr+"T00:00:00"):new Date();
  if(isNaN(base))return null;
  let n=1,u="day";
  if(recurrence==="Daily")u="day";
  else if(recurrence==="Weekly")u="week";
  else if(recurrence==="Monthly")u="month";
  else if(recurrence==="Annual")u="year";
  else if(recurrence==="Custom"){n=Math.max(1,Number(interval)||1);u=unit||"week";}
  else return null;
  const d=new Date(base);
  if(u==="day")d.setDate(d.getDate()+n);
  else if(u==="week")d.setDate(d.getDate()+7*n);
  else if(u==="month")d.setMonth(d.getMonth()+n);
  else if(u==="year")d.setFullYear(d.getFullYear()+n);
  const p=x=>String(x).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
const RECUR_OPTS=["Daily","Weekly","Monthly","Annual","Custom"];
const recurLabel=t=>!t.recurrence?"":(t.recurrence==="Custom"?`Every ${t.recurrenceInterval||1} ${(t.recurrenceUnit||"week")}${(t.recurrenceInterval||1)>1?"s":""}`:t.recurrence);

function RecurrenceField({f,setF}){
  return <Field label="Repeat">
    <Sel value={f.recurrence||""} onChange={e=>setF(p=>({...p,recurrence:e.target.value}))}>
      <option value="">Does not repeat</option>
      {RECUR_OPTS.map(o=><option key={o} value={o}>{o}</option>)}
    </Sel>
    {f.recurrence==="Custom"&&<div style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}>
      <span style={{fontSize:13,color:B.textSoft}}>Every</span>
      <input type="number" min={1} value={f.recurrenceInterval||1} onChange={e=>setF(p=>({...p,recurrenceInterval:Math.max(1,Number(e.target.value)||1)}))} style={{width:70,padding:"8px 10px",borderRadius:8,border:`1px solid ${B.border}`,fontSize:14,fontFamily:"'DM Sans',sans-serif"}}/>
      <Sel value={f.recurrenceUnit||"week"} onChange={e=>setF(p=>({...p,recurrenceUnit:e.target.value}))}>
        <option value="day">day(s)</option>
        <option value="week">week(s)</option>
        <option value="month">month(s)</option>
        <option value="year">year(s)</option>
      </Sel>
    </div>}
  </Field>;
}

function TaskForm({initial,contacts=[],onSave,onClose}){
  const[f,setF]=useState(initial||{title:"",contactId:"",dueDate:"",priority:"Medium",reminderDays:7,done:false,recurrence:"",recurrenceInterval:1,recurrenceUnit:"week"});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const save=async()=>{if(!f.title.trim())return;setSaving(true);await onSave(f);onClose();};
  return <div>
    <Field label="Task"><Inp placeholder="Follow up on loan maturity" value={f.title} onChange={set("title")}/></Field>
    {contacts.length>0&&<Field label="Contact"><Sel value={f.contactId||""} onChange={set("contactId")}><option value="">— None —</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Sel></Field>}
    <Grid2>
      <Field label="Due Date"><Inp type="date" value={f.dueDate||""} onChange={set("dueDate")}/></Field>
      <Field label="Priority"><Sel value={f.priority} onChange={set("priority")}><option>Low</option><option>Medium</option><option>High</option></Sel></Field>
    </Grid2>
    <Field label="Email Reminder">
      <Sel value={f.reminderDays||7} onChange={e=>setF(p=>({...p,reminderDays:Number(e.target.value)}))}>
        <option value={0}>No reminder</option>
        {REMINDER_OPTIONS.map(r=><option key={r.days} value={r.days}>{r.label}</option>)}
      </Sel>
    </Field>
    {f.reminderDays>0&&f.dueDate&&<div style={{background:"#e8f0f8",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:B.navyMid}}>
      🔔 Ordanis Expert will be emailed on {(()=>{const b=parseLocalDate(f.dueDate);if(isNaN(b.getTime()))return new Date(NaN);const r=new Date(b);r.setDate(r.getDate()-f.reminderDays);return r;})().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
    </div>}
    <RecurrenceField f={f} setF={setF}/>
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Task"}</Btn>
    </div>
  </div>;
}

// ── PROPERTY FORM ─────────────────────────────────────────────────────────────
function PropertyForm({initial,onSave,onClose,canExtract=false}){
  const blank={ownerName:"",address:"",propertyType:"Residential",purchasePrice:"",purchaseDate:"",currentValue:"",lender:"",loanBalance:"",interestRate:"",loanPayment:"",loanMaturityDate:"",loanType:"Fixed",secondMortgageBalance:"",secondMortgagePayment:"",rentalIncome:"",propertyTaxes:"",utilities:"",insuranceCompany:"",insurancePremium:"",insuranceExpiration:"",floodInsurance:false,floodInsuranceCompany:"",floodInsurancePremium:"",floodInsuranceExpiration:"",hoaFee:"",propertyManagementFeePct:"",includeMortgageInCashflow:true,notes:""};
  const[f,setF]=useState(()=>{
    // Merge initial with defaults to ensure new fields have sensible values
    return initial?{...blank,...initial,includeMortgageInCashflow:initial.includeMortgageInCashflow!==false}:blank;
  });
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const setChk=k=>e=>setF(p=>({...p,[k]:e.target.checked}));
  const save=async()=>{if(!f.address.trim())return;setSaving(true);await onSave(f);onClose();};
  const[extracting,setExtracting]=useState(false);
  const[extractMsg,setExtractMsg]=useState(null); // {type:"success"|"error", text}
  const fileRef=useRef(null);
  const FILLABLE=["ownerName","address","propertyType","purchasePrice","purchaseDate","currentValue","lender","loanBalance","interestRate","loanPayment","loanMaturityDate","loanType","secondMortgageBalance","secondMortgagePayment","rentalIncome","propertyTaxes","insuranceCompany","insurancePremium","insuranceExpiration","floodInsuranceCompany","floodInsurancePremium","floodInsuranceExpiration"];
  const handleExtract=async(file)=>{
    if(!file)return;
    const okTypes=["application/pdf","image/png","image/jpeg","image/jpg","image/webp"];
    if(!okTypes.includes(file.type)){setExtractMsg({type:"error",text:"Please upload a PDF, PNG, JPG, or WebP file."});if(fileRef.current)fileRef.current.value="";return;}
    if(file.size>15*1024*1024){setExtractMsg({type:"error",text:"File is too large (max 15 MB)."});if(fileRef.current)fileRef.current.value="";return;}
    setExtracting(true);setExtractMsg(null);
    try{
      const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(",")[1]);r.onerror=()=>rej(new Error("Could not read file."));r.readAsDataURL(file);});
      const mediaType=file.type==="image/jpg"?"image/jpeg":file.type;
      const{data:resp,error}=await sb.functions.invoke("extract-property-fields",{body:{fileBase64:base64,mediaType,fileName:file.name}});
      if(error)throw new Error(error.message||"Extraction failed.");
      if(resp&&resp.error)throw new Error(resp.error);
      const fields=(resp&&resp.fields)||{};
      const applied=[];
      setF(prev=>{const next={...prev};FILLABLE.forEach(k=>{const v=fields[k];if(v!==undefined&&v!==null&&String(v).trim()!==""){next[k]=v;applied.push(k);if((k==="floodInsuranceCompany"||k==="floodInsurancePremium"||k==="floodInsuranceExpiration"))next.floodInsurance=true;}});return next;});
      setExtractMsg(applied.length?{type:"success",text:`Filled ${applied.length} field${applied.length>1?"s":""} from the document. Review every value before saving — extracted figures can be misread.`}:{type:"error",text:"No matching property fields were found in that document."});
    }catch(e){setExtractMsg({type:"error",text:e&&e.message?e.message:"Extraction failed."});}
    finally{setExtracting(false);if(fileRef.current)fileRef.current.value="";}
  };
  // Calculate net rental for preview
  const grossRental=Number(f.rentalIncome)||0;
  const taxesM=(Number(f.propertyTaxes)||0)/12;
  const insM=(Number(f.insurancePremium)||0)/12;
  const floodM=(Number(f.floodInsurancePremium)||0)/12;
  const hoaM=Number(f.hoaFee)||0;
  const pmM=grossRental*((Number(f.propertyManagementFeePct)||0)/100);
  const mortgageM=f.includeMortgageInCashflow?((Number(f.loanPayment)||0)+(Number(f.secondMortgagePayment)||0)):0;
  const netRental=grossRental-taxesM-insM-floodM-hoaM-pmM-mortgageM;
  return <div style={{maxHeight:"70vh",overflowY:"auto",paddingRight:4}}>
    {canExtract&&<><input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" style={{display:"none"}} onChange={e=>handleExtract(e.target.files&&e.target.files[0])}/>
    <div style={{background:"linear-gradient(135deg,rgba(9,43,73,0.04),rgba(206,182,132,0.10))",border:`1px dashed ${B.gold}`,borderRadius:10,padding:"12px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <div style={{fontSize:20}}>✦</div>
      <div style={{flex:1,minWidth:180}}>
        <div style={{fontSize:13,fontWeight:700,color:B.navy}}>Auto-fill from a document</div>
        <div style={{fontSize:11,color:B.textSoft,lineHeight:1.4}}>Upload an insurance declaration, mortgage statement, or closing document and AI will pre-fill the fields below for your review.</div>
      </div>
      <Btn small variant="ghost" onClick={()=>fileRef.current&&fileRef.current.click()} disabled={extracting}>{extracting?"Reading…":"Upload document"}</Btn>
    </div>
    {extractMsg&&<div style={{background:extractMsg.type==="success"?"#e0f5e9":"#fde8e8",border:`1px solid ${extractMsg.type==="success"?"#2e9e57":"#d43030"}`,color:extractMsg.type==="success"?"#0d5c2b":"#8b1a1a",borderRadius:8,padding:"10px 13px",fontSize:12,marginBottom:14,lineHeight:1.4}}>{extractMsg.type==="success"?"✓ ":"⚠ "}{extractMsg.text}</div>}</>}
    <Grid2><Field label="Owner / LLC"><Inp placeholder="Smith Holdings LLC" value={f.ownerName||""} onChange={set("ownerName")}/></Field><Field label="Property Type"><Sel value={f.propertyType} onChange={set("propertyType")}>{[...PROP_TYPES,"Other"].map(t=><option key={t}>{t}</option>)}</Sel></Field></Grid2>
    <Field label="Address"><Inp placeholder="123 Main St, Tampa FL" value={f.address} onChange={set("address")}/></Field>
    <Grid2><Field label="Purchase Price"><MoneyInput value={f.purchasePrice||""} onChange={set("purchasePrice")}/></Field><Field label="Current Value"><MoneyInput value={f.currentValue||""} onChange={set("currentValue")}/></Field></Grid2>
    <Grid2><Field label="Purchase Date"><Inp type="date" value={f.purchaseDate||""} onChange={set("purchaseDate")}/></Field><Field label="Loan Type"><Sel value={f.loanType} onChange={set("loanType")}>{LOAN_TYPES.map(t=><option key={t}>{t}</option>)}</Sel></Field></Grid2>
    <Grid2><Field label="Lender"><Inp value={f.lender||""} onChange={set("lender")}/></Field><Field label="Loan Balance"><MoneyInput value={f.loanBalance||""} onChange={set("loanBalance")}/></Field></Grid2>
    <Grid2><Field label="Interest Rate (%)"><Inp type="number" step="0.01" value={f.interestRate||""} onChange={set("interestRate")}/></Field><Field label="Monthly Payment"><MoneyInput value={f.loanPayment||""} onChange={set("loanPayment")}/></Field></Grid2>
    <Grid2><Field label="Second Mortgage Balance"><MoneyInput value={f.secondMortgageBalance||""} onChange={set("secondMortgageBalance")}/></Field><Field label="Second Mortgage Payment/mo"><MoneyInput value={f.secondMortgagePayment||""} onChange={set("secondMortgagePayment")}/></Field></Grid2>
    <Grid2><Field label="Loan Maturity Date"><Inp type="date" value={f.loanMaturityDate||""} onChange={set("loanMaturityDate")}/></Field><Field label="Rental Income/mo"><MoneyInput value={f.rentalIncome||""} onChange={set("rentalIncome")}/></Field></Grid2>
    <Grid2><Field label="Property Taxes/yr"><MoneyInput value={f.propertyTaxes||""} onChange={set("propertyTaxes")}/></Field><Field label="Utilities/mo"><MoneyInput value={f.utilities||""} onChange={set("utilities")}/></Field></Grid2>
    <Grid2><Field label="Insurance Company"><Inp value={f.insuranceCompany||""} onChange={set("insuranceCompany")}/></Field><Field label="Insurance Premium/yr"><MoneyInput value={f.insurancePremium||""} onChange={set("insurancePremium")}/></Field></Grid2>
    <Grid2><Field label="Insurance Expiration"><Inp type="date" value={f.insuranceExpiration||""} onChange={set("insuranceExpiration")}/></Field><div/></Grid2>
    <div style={{marginBottom:14}}><label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"10px 14px",background:f.floodInsurance?"#e8f0f8":B.bg,borderRadius:8,border:`1px solid ${f.floodInsurance?B.navyMid:B.border}`}}><input type="checkbox" checked={!!f.floodInsurance} onChange={setChk("floodInsurance")} style={{width:16,height:16,accentColor:B.navy}}/><span style={{fontSize:13,color:B.navy,fontWeight:600}}>Flood Insurance</span></label></div>
    {f.floodInsurance&&<Grid2><Field label="Flood Insurance Co."><Inp value={f.floodInsuranceCompany||""} onChange={set("floodInsuranceCompany")}/></Field><Field label="Flood Premium/yr"><MoneyInput value={f.floodInsurancePremium||""} onChange={set("floodInsurancePremium")}/></Field></Grid2>}
    {f.floodInsurance&&<Grid2><Field label="Flood Insurance Expiration"><Inp type="date" value={f.floodInsuranceExpiration||""} onChange={set("floodInsuranceExpiration")}/></Field><div/></Grid2>}

    {/* Rental Expenses section */}
    <div style={{marginTop:18,marginBottom:8,paddingTop:14,borderTop:`1px solid ${B.borderLight}`}}>
      <div style={{fontSize:11,fontWeight:800,color:B.textMute,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Rental Expenses (used in Cash Flow projections)</div>
    </div>
    <Grid2>
      <Field label="HOA / Monthly Fee ($)"><MoneyInput placeholder="350" value={f.hoaFee||""} onChange={set("hoaFee")}/></Field>
      <Field label="Property Management Fee (%)"><Inp type="number" step="0.1" placeholder="e.g., 8" value={f.propertyManagementFeePct||""} onChange={set("propertyManagementFeePct")}/></Field>
    </Grid2>
    <div style={{marginBottom:14}}>
      <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"10px 14px",background:f.includeMortgageInCashflow?"#e8f0f8":B.bg,borderRadius:8,border:`1px solid ${f.includeMortgageInCashflow?B.navyMid:B.border}`}}>
        <input type="checkbox" checked={!!f.includeMortgageInCashflow} onChange={setChk("includeMortgageInCashflow")} style={{width:16,height:16,accentColor:B.navy}}/>
        <span style={{fontSize:13,color:B.navy,fontWeight:600}}>Subtract mortgage payment from rental cash flow</span>
      </label>
    </div>
    {grossRental>0&&<div style={{background:netRental>=0?"#e0f5e9":"#fde8e8",border:`1px solid ${netRental>=0?"#2e9e57":"#d43030"}`,borderRadius:8,padding:"12px 14px",marginBottom:14,fontSize:12}}>
      <div style={{fontSize:10,fontWeight:800,color:B.textMute,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>Estimated Monthly Net Rental</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:4,color:B.textMid,fontFamily:"inherit"}}>
        <span>Gross rental</span><span style={{fontWeight:600,textAlign:"right"}}>{fmtMoney(grossRental)}</span>
        <span>– Property taxes (1/12)</span><span style={{textAlign:"right"}}>−{fmtMoney(taxesM)}</span>
        <span>– Insurance (1/12)</span><span style={{textAlign:"right"}}>−{fmtMoney(insM)}</span>
        {floodM>0&&<><span>– Flood insurance (1/12)</span><span style={{textAlign:"right"}}>−{fmtMoney(floodM)}</span></>}
        <span>– HOA</span><span style={{textAlign:"right"}}>−{fmtMoney(hoaM)}</span>
        <span>– Property mgmt ({Number(f.propertyManagementFeePct)||0}%)</span><span style={{textAlign:"right"}}>−{fmtMoney(pmM)}</span>
        {f.includeMortgageInCashflow&&<><span>– Mortgage payment</span><span style={{textAlign:"right"}}>−{fmtMoney(mortgageM)}</span></>}
        <span style={{fontWeight:700,paddingTop:4,borderTop:`1px solid ${netRental>=0?"#2e9e57":"#d43030"}`,color:netRental>=0?"#0d5c2b":"#8b1a1a"}}>Net per month</span>
        <span style={{fontWeight:700,paddingTop:4,borderTop:`1px solid ${netRental>=0?"#2e9e57":"#d43030"}`,textAlign:"right",color:netRental>=0?"#0d5c2b":"#8b1a1a"}}>{netRental<0?"−":""}{fmtMoney(Math.abs(netRental))}</span>
      </div>
    </div>}

    <Field label="Notes"><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Property"}</Btn></div>
  </div>;
}

// ── VALUABLE FORM ─────────────────────────────────────────────────────────────
function ValuableForm({initial,onSave,onClose}){
  const[f,setF]=useState(initial||{category:"Car / Vehicle",description:"",makeModel:"",year:"",estimatedValue:"",insured:false,insuranceCompany:"",notes:""});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const save=async()=>{if(!f.description.trim())return;setSaving(true);await onSave(f);onClose();};
  return <div>
    <Grid2><Field label="Category"><Sel value={f.category} onChange={set("category")}>{VALUABLE_CATS.map(c=><option key={c}>{c}</option>)}</Sel></Field><Field label="Year"><Inp type="number" placeholder="2023" value={f.year||""} onChange={set("year")}/></Field></Grid2>
    <Field label="Description"><Inp placeholder="2023 Ferrari Roma" value={f.description} onChange={set("description")}/></Field>
    <Grid2><Field label="Make / Model"><Inp value={f.makeModel||""} onChange={set("makeModel")}/></Field><Field label="Estimated Value"><MoneyInput value={f.estimatedValue||""} onChange={set("estimatedValue")}/></Field></Grid2>
    <div style={{marginBottom:14}}><label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"10px 14px",background:f.insured?"#e8f0f8":B.bg,borderRadius:8,border:`1px solid ${f.insured?B.navyMid:B.border}`}}><input type="checkbox" checked={!!f.insured} onChange={e=>setF(p=>({...p,insured:e.target.checked}))} style={{width:16,height:16,accentColor:B.navy}}/><span style={{fontSize:13,color:B.navy,fontWeight:600}}>Insured</span></label></div>
    {f.insured&&<Field label="Insurance Company"><Inp value={f.insuranceCompany||""} onChange={set("insuranceCompany")}/></Field>}
    <Field label="Notes"><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</Btn></div>
  </div>;
}

// ── SIMPLE DEAL FORM ──────────────────────────────────────────────────────────
function SimpleDealForm({contacts=[],onSave,onClose}){
  const[f,setF]=useState({contactId:"",title:"",value:"",stage:"Lead",closeDate:""});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const save=async()=>{if(!f.title.trim())return;setSaving(true);await onSave(f);onClose();};
  return <div>
    <Field label="Deal Title"><Inp placeholder="Estate planning engagement" value={f.title} onChange={set("title")}/></Field>
    {contacts.length>0&&<Field label="Contact"><Sel value={f.contactId||""} onChange={set("contactId")}><option value="">— None —</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Sel></Field>}
    <Grid2><Field label="Value ($)"><MoneyInput value={f.value||""} onChange={set("value")}/></Field><Field label="Close Date"><Inp type="date" value={f.closeDate||""} onChange={set("closeDate")}/></Field></Grid2>
    <Field label="Stage"><Sel value={f.stage} onChange={set("stage")}>{STAGES.map(s=><option key={s}>{s}</option>)}</Sel></Field>
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Deal"}</Btn></div>
  </div>;
}

// ── ACCOUNT FORM ──────────────────────────────────────────────────────────────
function AccountForm({initial,onSave,onClose}){
  const[f,setF]=useState(initial||{institution:"",bankerName:"",accountType:"Investment",startingBalance:"",currentBalance:"",notes:""});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const save=async()=>{if(!f.institution.trim())return;setSaving(true);await onSave(f);onClose();};
  const pct=pctChange(f.startingBalance,f.currentBalance);
  return <div>
    <Grid2><Field label="Institution"><Inp placeholder="Merrill Lynch" value={f.institution} onChange={set("institution")}/></Field><Field label="Banker Name"><Inp value={f.bankerName||""} onChange={set("bankerName")}/></Field></Grid2>
    <Field label="Account Type"><Sel value={f.accountType} onChange={set("accountType")}>{ACCT_TYPES.map(t=><option key={t}>{t}</option>)}</Sel></Field>
    <Grid2><Field label="Starting Balance"><MoneyInput value={f.startingBalance||""} onChange={set("startingBalance")}/></Field><Field label="Current Balance"><MoneyInput value={f.currentBalance||""} onChange={set("currentBalance")}/></Field></Grid2>
    {pct!==null&&<div style={{background:Number(pct)>=0?"#e0f5e9":"#fde8e8",border:`1px solid ${Number(pct)>=0?"#2e9e57":"#d43030"}`,borderRadius:8,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:20}}>{Number(pct)>=0?"📈":"📉"}</span>
      <div style={{fontSize:18,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,color:Number(pct)>=0?"#0d5c2b":"#8b1a1a"}}>{Number(pct)>=0?"+":""}{pct}% performance</div>
    </div>}
    <Field label="Notes"><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Account"}</Btn></div>
  </div>;
}

// ── CASH FLOW EVENT FORM ──────────────────────────────────────────────────────
// billPay defaults TRUE so an existing call site that has not been updated keeps the checkbox
// rather than silently losing it. The database is what actually refuses the flag on a Core
// household, so a stale caller here is a cosmetic slip, whereas defaulting to false would hide
// bill pay from a paying household and look like the feature had broken.
function CashFlowEventForm({initial,onSave,onClose,properties=[],vendors=[],billPay=true}){
  const blank={direction:"income",eventType:"Salary",description:"",amount:"",frequency:"once",startDate:new Date().toISOString().slice(0,10),endDate:"",taxTreatment:"ordinary",notes:"",pcmResponsible:false,category:"",propertyId:"",vendorKey:""};
  const[f,setF]=useState(()=>{
    if(!initial)return blank;
    return{...blank,...initial,direction:initial.direction||"income",
      propertyId:initial.propertyId||"",
      // One select, two possible foreign keys — recombined into a prefixed key so the
      // form has a single value to bind to, and split again on save.
      vendorKey:vendorKeyFor(initial)};
  });
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  // When user switches direction, swap default eventType to a sensible value
  const setDirection=(dir)=>{
    setF(p=>{
      const next={...p,direction:dir};
      // If the eventType doesn't fit the new direction, switch to a default
      if(dir==="expense"&&!CF_EXPENSE_CATEGORIES.includes(p.eventType))next.eventType="Rent/Mortgage";
      if(dir==="income"&&!CF_EVENT_TYPES.includes(p.eventType))next.eventType="Salary";
      // cash_flow_events_category_expense_chk forbids a category on income, so
      // flipping the direction has to clear it or the save fails on a constraint
      // the user never saw.
      if(dir==="income"){next.category="";next.vendorKey="";}
      return next;
    });
  };
  const save=async()=>{if(!f.amount||!f.startDate)return;setSaving(true);await onSave(f);onClose();};
  const isExpense=f.direction==="expense";
  const typeOptions=isExpense?CF_EXPENSE_CATEGORIES:CF_EVENT_TYPES;
  return <div>
    {/* Direction toggle */}
    <Field label="Type">
      <div style={{display:"flex",gap:8,background:B.bg,borderRadius:8,padding:4}}>
        <button type="button" onClick={()=>setDirection("income")} style={{flex:1,background:!isExpense?B.white:"transparent",border:!isExpense?`1px solid ${B.border}`:"1px solid transparent",borderRadius:6,padding:"8px 12px",fontSize:13,fontWeight:!isExpense?700:500,color:!isExpense?"#0d5c2b":B.textSoft,cursor:"pointer",fontFamily:"inherit",boxShadow:!isExpense?B.shadow:"none"}}>📈 Income</button>
        <button type="button" onClick={()=>setDirection("expense")} style={{flex:1,background:isExpense?B.white:"transparent",border:isExpense?`1px solid ${B.border}`:"1px solid transparent",borderRadius:6,padding:"8px 12px",fontSize:13,fontWeight:isExpense?700:500,color:isExpense?"#8b1a1a":B.textSoft,cursor:"pointer",fontFamily:"inherit",boxShadow:isExpense?B.shadow:"none"}}>📉 Expense</button>
      </div>
    </Field>
    <Grid2>
      {/* This field is event_type. It used to be labelled "Category" for expenses,
          which is how the confusion started: it has no database constraint, the seed
          data bypassed the picklist entirely ("Mortgage Payment", "Property Tax
          Reserve" — none of them in CF_EXPENSE_CATEGORIES), and so it cannot be
          totalled reliably. It is a label. "Spend category" below is the field that
          groups. */}
      <Field label={isExpense?"Type":"Event Type"}><Sel value={f.eventType} onChange={set("eventType")}>{typeOptions.map(t=><option key={t}>{t}</option>)}</Sel></Field>
      <Field label="Frequency"><Sel value={f.frequency} onChange={set("frequency")}>{CF_FREQUENCIES.map(fr=><option key={fr.value} value={fr.value}>{fr.label}</option>)}</Sel></Field>
    </Grid2>
    {/* The grouping key, constrained in the database so a total can be trusted.
        Left blank the line is reported as uncategorised rather than guessed at —
        which is why there is no default value here. */}
    {isExpense&&<Field label="Spend category — what this money is for">
      <Sel value={f.category||""} onChange={set("category")}>
        <option value="">Not categorised</option>
        {EXPENSE_CATEGORIES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
      </Sel>
      <div style={{fontSize:10.5,color:B.textMute,marginTop:4}}>
        Used to answer questions like “how much do we spend on landscaping?”. Uncategorised
        lines are excluded from category totals and reported as uncategorised.
      </div>
    </Field>}
    {/* Vendor and property. Together these make an expense line granular: spend per
        vendor becomes answerable, and naming the property lets this line REPLACE the
        blended figure on that property record for this category — so a family with
        three utility vendors itemises all three without the property's single
        `utilities` number being counted on top. */}
    {isExpense&&<Grid2>
      <Field label="Vendor — who is paid">
        <Sel value={f.vendorKey||""} onChange={set("vendorKey")}>
          <option value="">Not specified</option>
          {vendors.map(v=><option key={v.key} value={v.key}>{v.group} · {v.label}</option>)}
        </Sel>
        {!vendors.length&&<div style={{fontSize:10.5,color:B.textMute,marginTop:4}}>
          No service providers on file for this family yet — add them as contacts first.
        </div>}
      </Field>
      <Field label="Property (optional)">
        <Sel value={f.propertyId||""} onChange={set("propertyId")}>
          <option value="">Not property-specific</option>
          {properties.map(p=><option key={p.id} value={p.id}>{p.address}</option>)}
        </Sel>
      </Field>
    </Grid2>}
    {isExpense&&f.propertyId&&f.category&&<div style={{fontSize:10.5,color:"#8a5c00",
        background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"8px 12px",marginBottom:14}}>
      This line covers {EXPENSE_CATEGORY_LABEL[f.category]||f.category} for that property, so the
      matching figure on the property record will no longer be added separately. Itemise the rest
      of that category the same way, or the remainder will be missing.
    </div>}
    <Field label="Description"><Inp placeholder={isExpense?"e.g., Monthly grocery budget":"e.g., Acme Corp Q4 Bonus"} value={f.description||""} onChange={set("description")}/></Field>
    {isExpense?
      <>
      <Field label="Amount ($)"><MoneyInput value={f.amount||""} onChange={set("amount")}/></Field>
      {billPay&&<label style={{display:"flex",alignItems:"center",gap:8,margin:"2px 0 10px",cursor:"pointer",fontSize:13,color:B.text}}>
        <input type="checkbox" checked={!!f.pcmResponsible} onChange={e=>setF(p=>({...p,pcmResponsible:e.target.checked}))} style={{width:16,height:16,accentColor:B.navy}}/>
        <span>{BRAND.short} is responsible for making this payment</span>
      </label>}
      </>
    :<Grid2>
      <Field label="Gross Amount ($)"><MoneyInput value={f.amount||""} onChange={set("amount")}/></Field>
      <Field label="Tax Treatment"><Sel value={f.taxTreatment} onChange={set("taxTreatment")}>{CF_TAX_TREATMENTS.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</Sel></Field>
    </Grid2>}
    <Grid2>
      <Field label={f.frequency==="once"?"Date":"Start Date"}><Inp type="date" value={f.startDate||""} onChange={set("startDate")}/></Field>
      {f.frequency!=="once"&&<Field label="End Date (optional)"><Inp type="date" value={f.endDate||""} onChange={set("endDate")}/></Field>}
    </Grid2>
    <Field label="Notes"><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn onClick={save} disabled={saving||!f.amount||!f.startDate}>{saving?"Saving…":"Save"}</Btn>
    </div>
  </div>;
}

// ── CASH FLOW REPORT (printable) ──────────────────────────────────────────────
function CashFlowReport({family,projectionMonths,projectionMode,filingStatus,baseIncome,stateRate,stateName,localRate,monthlyData,events,onClose}){
  const totalIncome=monthlyData.reduce((s,m)=>s+(m.income||0),0);
  const totalGross=monthlyData.reduce((s,m)=>s+m.gross,0);
  const totalTax=monthlyData.reduce((s,m)=>s+m.tax,0);
  const totalExpense=monthlyData.reduce((s,m)=>s+(m.expense||0),0);
  const totalNet=monthlyData.reduce((s,m)=>s+m.net,0);
  const marginalAllIn=marginalTaxRate(baseIncome,annualOrdinaryIncome(events,projectionMode,projectionMonths),filingStatus,Number(stateRate)||0,Number(localRate)||0);
  const incomeEvents=events.filter(e=>e.direction!=="expense");
  const expenseEvents=events.filter(e=>e.direction==="expense");
  const projOption=CF_PROJECTION_OPTIONS.find(o=>o.value===projectionMonths);
  const projectionLabel=projectionMode==="year"?`Current Year (${new Date().getFullYear()})`:(projOption?projOption.label:projectionMonths+" months");
  const filingLabel=filingStatus==="mfj"?"Married Filing Jointly":"Single";
  const print=()=>{
    const w=window.open("","_blank");
    // Build SVG bar chart (stacked: income gold positive; expenses red negative)
    const chartW=700,chartH=200,padL=50,padR=10,padT=20,padB=40;
    const innerW=chartW-padL-padR;
    const innerH=chartH-padT-padB;
    const barW=innerW/monthlyData.length;
    const incomeNet=monthlyData.map(m=>(m.income||0)-(m.tax||0));
    const expenseArr=monthlyData.map(m=>m.expense||0);
    const maxPos=Math.max(...incomeNet,0);
    const maxNeg=Math.max(...expenseArr,0)+Math.max(...incomeNet.map(v=>v<0?Math.abs(v):0),0);
    const range=maxPos+maxNeg;
    const zeroY=range>0?padT+innerH-(maxNeg/range)*innerH:padT+innerH;
    const cumulative=[];
    let runTotal=0;
    monthlyData.forEach(m=>{runTotal+=m.net;cumulative.push(runTotal);});
    const minCum=Math.min(...cumulative,0);
    const maxCum2=Math.max(...cumulative,0);
    const cumRange=maxCum2-minCum||1;
    const cumPath=cumulative.map((v,i)=>{
      const x=padL+barW*i+barW/2;
      const y=padT+innerH-((v-minCum)/cumRange)*innerH;
      return(i===0?"M":"L")+x.toFixed(1)+","+y.toFixed(1);
    }).join(" ");
    const bars=monthlyData.map((m,i)=>{
      if(range<=0)return"";
      const x=padL+barW*i+1;
      const w=barW-2;
      const inc=incomeNet[i];
      const exp=expenseArr[i];
      let svg="";
      if(inc>=0){
        const h=(inc/range)*innerH;
        svg+=`<rect x="${x}" y="${zeroY-h}" width="${w}" height="${h}" fill="#1f9d57" opacity="0.85"/>`;
      }else{
        const h=(Math.abs(inc)/range)*innerH;
        svg+=`<rect x="${x}" y="${zeroY}" width="${w}" height="${h}" fill="#d43030" opacity="0.55"/>`;
      }
      if(exp>0){
        const h=(exp/range)*innerH;
        const yStart=inc<0?zeroY+(Math.abs(inc)/range)*innerH:zeroY;
        svg+=`<rect x="${x}" y="${yStart}" width="${w}" height="${h}" fill="#d43030" opacity="0.78"/>`;
      }
      return svg;
    }).join("");
    const yLabels=`<text x="${padL-6}" y="${padT+10}" font-size="9" fill="#8fa0b2" text-anchor="end">${fmtMoneyShort(maxPos)}</text>
      <text x="${padL-6}" y="${zeroY+3}" font-size="9" fill="#8fa0b2" text-anchor="end">$0</text>
      ${maxNeg>0?`<text x="${padL-6}" y="${padT+innerH-3}" font-size="9" fill="#8fa0b2" text-anchor="end">−${fmtMoneyShort(maxNeg)}</text>`:""}`;
    const xLabels=monthlyData.filter((_,i)=>i%Math.max(1,Math.floor(monthlyData.length/8))===0).map((m,idx,arr)=>{
      const realIdx=monthlyData.findIndex(x=>x.label===m.label);
      const x=padL+barW*realIdx+barW/2;
      return`<text x="${x}" y="${padT+innerH+15}" font-size="8" fill="#8fa0b2" text-anchor="middle">${m.label}</text>`;
    }).join("");
    const zeroLine=maxNeg>0?`<line x1="${padL}" x2="${chartW-padR}" y1="${zeroY}" y2="${zeroY}" stroke="#5a6e84" stroke-width="0.5" stroke-dasharray="2,2"/>`:"";
    w.document.write(`<!DOCTYPE html><html><head><title> </title>
    <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Georgia,serif;color:${B.navy};background:#fff;padding:40px;font-size:12px;line-height:1.6;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid ${B.gold};}
    .logo-img{height:120px;width:auto;display:block;}
    h1{font-size:22px;font-weight:700;margin-bottom:2px;}
    .sub{font-size:12px;color:#5a6e84;margin-top:4px;}
    .date{font-size:11px;color:#8fa0b2;margin-top:2px;}
    h2{font-size:13px;font-weight:800;color:${B.navy};margin:18px 0 8px;padding-bottom:4px;border-bottom:1px solid ${B.gold};letter-spacing:.06em;text-transform:uppercase;}
    .assumptions{background:${B.bg};border-radius:8px;padding:12px 16px;margin-bottom:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(110px,100%),1fr));gap:10px;}
    .a-l{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#8fa0b2;margin-bottom:3px;}
    .a-v{font-size:13px;font-weight:700;color:${B.navy};white-space:nowrap;overflow:visible;}
    .stats{display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap;}
    .stat{background:${B.bg};border-radius:8px;padding:12px 16px;flex:1;min-width:120px;border-top:2px solid ${B.gold};}
    .stat-l{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#8fa0b2;margin-bottom:4px;}
    .stat-v{font-size:18px;font-weight:700;color:${B.navy};white-space:nowrap;overflow:visible;}
    .stat-red{border-top-color:#d43030;}
    table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px;}
    th{background:${B.navy};color:${B.gold};padding:6px 10px;text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase;}
    td{padding:5px 10px;border-bottom:1px solid #ede8de;color:#293d5c;vertical-align:top;}
    tr:nth-child(even) td{background:${B.bg};}
    .num{text-align:right;font-variant-numeric:tabular-nums;}
    .neg{color:#8b1a1a;}
    .legend{display:flex;gap:14px;font-size:9px;color:#5a6e84;margin-top:6px;}
    .legend span{display:flex;align-items:center;gap:4px;}
    .legend i{display:inline-block;width:8px;height:8px;border-radius:1px;}
    .chart-box{background:${B.bg};border-radius:8px;padding:14px;margin-bottom:14px;}
    .disclaimer{margin-top:24px;padding:12px 14px;background:#fef3e2;border:1px solid #fcd97d;border-radius:6px;font-size:10px;color:#8a5c00;line-height:1.5;}
    @media print{body{padding:20px;}}
    </style></head><body>
    <div class="header">
      <div><img src="${BRAND.logo}" alt="${BRAND.name}" class="logo-img"/></div>
      <div style="text-align:right"><h1>Cash Flow Projection</h1><div class="sub">${family.name}</div><div class="date">${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div></div>
    </div>
    <div class="assumptions">
      <div><div class="a-l">Projection</div><div class="a-v">${projectionLabel}</div></div>
      <div><div class="a-l">Filing Status</div><div class="a-v">${filingLabel}</div></div>
      <div><div class="a-l">Base Income</div><div class="a-v">${fmtUSD(baseIncome)}</div></div>
      <div><div class="a-l">State (${stateName||"—"})</div><div class="a-v">${(Number(stateRate)||0).toFixed(2)}%</div></div>
      <div><div class="a-l">Local / City</div><div class="a-v">${(Number(localRate)||0).toFixed(2)}%</div></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-l">Total Gross Income</div><div class="stat-v">${fmtUSD(totalGross)}</div></div>
      <div class="stat stat-red"><div class="stat-l">Total Tax</div><div class="stat-v">${fmtUSD(totalTax)}</div></div>
      <div class="stat stat-red"><div class="stat-l">Total Expenses</div><div class="stat-v">${fmtUSD(totalExpense)}</div></div>
      <div class="stat"><div class="stat-l">Total Net</div><div class="stat-v ${totalNet<0?"neg":""}">${totalNet<0?"−":""}${fmtUSD(Math.abs(totalNet))}</div></div>
      <div class="stat"><div class="stat-l">Marginal Rate</div><div class="stat-v">${marginalAllIn.toFixed(1)}%</div></div>
    </div>
    <h2>Cash Flow by Month</h2>
    <div class="chart-box">
      <svg viewBox="0 0 ${chartW} ${chartH}" width="100%" style="display:block">
        ${bars}
        ${zeroLine}
        <path d="${cumPath}" fill="none" stroke="${B.navy}" stroke-width="1.5"/>
        ${yLabels}
        ${xLabels}
      </svg>
      <div class="legend"><span><i style="background:#1f9d57"></i>Income (net)</span><span><i style="background:#d43030"></i>Expenses</span><span><i style="background:${B.navy};width:14px;height:2px;border-radius:0"></i>Cumulative</span></div>
    </div>
    ${incomeEvents.length>0?`<h2>Income Events</h2>
    <table><thead><tr><th>Type</th><th>Description</th><th>Frequency</th><th>Start</th><th class="num">Gross</th><th>Tax</th><th class="num">Net (proj.)</th></tr></thead><tbody>
    ${incomeEvents.map(e=>{
      const treatLabel=CF_TAX_TREATMENTS.find(t=>t.value===e.taxTreatment)?.label.split(" (")[0]||e.taxTreatment;
      const freqLabel=CF_FREQUENCIES.find(fr=>fr.value===e.frequency)?.label||e.frequency;
      return`<tr><td>${e.eventType}</td><td>${e.description||"—"}</td><td>${freqLabel}</td><td>${fmt(e.startDate)}</td><td class="num">${fmtUSD(e.amount)}</td><td>${treatLabel}</td><td class="num">${fmtUSD(e.projectedNet||0)}</td></tr>`;
    }).join("")}
    </tbody></table>`:""}
    ${expenseEvents.length>0?`<h2>Expense Items</h2>
    <table><thead><tr><th>Category</th><th>Description</th><th>Frequency</th><th>Start</th><th class="num">Amount</th><th class="num">Total (proj.)</th></tr></thead><tbody>
    ${expenseEvents.map(e=>{
      const freqLabel=CF_FREQUENCIES.find(fr=>fr.value===e.frequency)?.label||e.frequency;
      return`<tr><td>${e.eventType}</td><td>${e.description||"—"}</td><td>${freqLabel}</td><td>${fmt(e.startDate)}</td><td class="num neg">−${fmtUSD(e.amount)}</td><td class="num neg">−${fmtUSD(Math.abs(e.projectedNet||0))}</td></tr>`;
    }).join("")}
    </tbody></table>`:""}
    <h2>Monthly Breakdown</h2>
    <table><thead><tr><th>Month</th><th class="num">Income</th><th class="num">Tax</th><th class="num">Expenses</th><th class="num">Net</th><th class="num">Cumulative</th></tr></thead><tbody>
    ${(()=>{let cum=0;return monthlyData.map(m=>{cum+=m.net;const negNet=m.net<0;const negCum=cum<0;return`<tr><td>${m.label}</td><td class="num">${fmtUSD(m.income||0)}</td><td class="num">${fmtUSD(m.tax)}</td><td class="num neg">${m.expense?"−"+fmtUSD(m.expense):"$0"}</td><td class="num ${negNet?"neg":""}">${negNet?"−":""}${fmtUSD(Math.abs(m.net))}</td><td class="num ${negCum?"neg":""}"><strong>${negCum?"−":""}${fmtUSD(Math.abs(cum))}</strong></td></tr>`;}).join("");})()}
    </tbody></table>
    <div class="disclaimer">
      <strong>Disclaimer:</strong> This cash flow projection is a planning estimate only and is not tax advice. Tax calculations use 2026 federal brackets applied marginally on top of base income, with the federal standard deduction for the filing status applied to ordinary income once per tax year (state and local rates apply to full gross). Expenses are treated as after-tax outflows. Actual taxes vary based on deductions, credits, AMT, phase-outs, additional Medicare tax, state-specific rules, and other factors. Consult a qualified tax professional before making decisions based on these figures.
    </div>
    </body></html>`);
    w.document.close();w.focus();
    // Shrink-to-fit: any stat/assumption value wider than its tile gets stepped down (to a 9px floor) so large figures never clip.
    setTimeout(()=>{
      try{
        w.document.querySelectorAll(".stat-v,.a-v").forEach(el=>{
          let size=parseFloat(w.getComputedStyle(el).fontSize)||18;let guard=0;
          while(el.scrollWidth>el.clientWidth+1&&size>9&&guard<40){size-=0.5;el.style.fontSize=size+"px";guard++;}
        });
      }catch(e){}
      w.print();
    },400);
  };

  return <Modal title="Cash Flow Report" onClose={onClose} wide>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(140px,100%),1fr))",gap:12,marginBottom:24}}>
      <StatBox label="Total Gross" value={fmtMoney(totalGross)} accent={B.gold}/>
      <StatBox label="Total Tax" value={fmtMoney(totalTax)} accent="#d43030"/>
      <StatBox label="Total Expenses" value={fmtMoney(totalExpense)} accent="#d43030"/>
      <StatBox label="Total Net" value={(totalNet<0?"−":"")+fmtMoney(Math.abs(totalNet))} accent={B.navy}/>
    </div>
    <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn variant="gold" onClick={print}>🖨 Print Report</Btn>
    </div>
  </Modal>;
}

// ── CASH FLOW VIEW (the tab content) ──────────────────────────────────────────
function CashFlowView({family,events,paymentLog=[],properties,vendors=[],reload,toast,readOnly=false}){
  const isMobile=useIsMobile();
  // Bill pay is a Premier-plan feature. The database refuses pcm_responsible on a Core household
  // and refuses the downgrade of a household that already has such expenses, so on Core no row can
  // carry the flag and the badges below are inert anyway. This const is belt as well as braces: it
  // keeps the control out of the form, so nobody ticks a box and gets a raw Postgres error back.
  const billPay=planAllows(family?.plan,"billPay");
  const[modal,setModal]=useState(null);
  const[reportOpen,setReportOpen]=useState(false);
  const[expandedBreakdowns,setExpandedBreakdowns]=useState({});
  const toggleBreakdown=(id)=>setExpandedBreakdowns(p=>({...p,[id]:!p[id]}));
  const[expandedRegisters,setExpandedRegisters]=useState({});
  const toggleRegister=(id)=>setExpandedRegisters(p=>({...p,[id]:!p[id]}));
  // Payment register: for recurring (monthly/quarterly/annually) PCM-responsible expenses,
  // track paid status per occurrence period instead of a single paid flag on the event.
  const paymentsByEvent=useMemo(()=>{
    const m={};
    paymentLog.forEach(p=>{(m[p.eventId]=m[p.eventId]||[]).push(p);});
    return m;
  },[paymentLog]);
  const getRegisterPeriods=(event)=>{
    // 6 months back (so recently-paid bills stay visible) through 12 months ahead.
    const winStart=new Date();winStart.setHours(0,0,0,0);winStart.setDate(1);winStart.setMonth(winStart.getMonth()-6);
    const occs=expandEvent(event,winStart,18);
    const rows=paymentsByEvent[event.id]||[];
    const byPeriod={};rows.forEach(r=>{byPeriod[(r.period||"").slice(0,10)]=r;});
    const seen=new Set();
    const todayFirst=new Date();todayFirst.setHours(0,0,0,0);todayFirst.setDate(1);
    return occs.map(o=>{
      const periodDate=new Date(o.date.getFullYear(),o.date.getMonth(),1);
      const periodKey=`${periodDate.getFullYear()}-${String(periodDate.getMonth()+1).padStart(2,"0")}-01`;
      if(seen.has(periodKey))return null; // multiple occurrences in the same month (shouldn't happen for monthly/quarterly/annually)
      seen.add(periodKey);
      const row=byPeriod[periodKey]||null;
      return{
        periodKey,periodDate,
        label:periodDate.toLocaleDateString("en-US",{month:"long",year:"numeric"}),
        paid:!!row?.paid, paidAt:row?.paidAt||null, paidBy:row?.paidBy||null,
        overdue:!row?.paid&&periodDate<todayFirst,
      };
    }).filter(Boolean).sort((a,b)=>a.periodDate-b.periodDate);
  };
  const togglePeriodPaid=async(event,period,currentlyPaid)=>{
    const marking=!currentlyPaid;
    const{error}=await sb.from("cash_flow_payment_log").upsert(
      {event_id:event.id,family_id:family.id,period,paid:marking,paid_at:marking?new Date().toISOString():null,paid_by:marking?(CURRENT_USER_LABEL||null):null},
      {onConflict:"event_id,period"}
    );
    if(error)toast(error.message,"error");else{toast(marking?"Marked paid":"Marked unpaid");reload("cash_flow_payment_log");}
  };
  // Monthly/quarterly/annual recurring expenses get a per-period register; weekly/biweekly/once keep the single paid flag.
  const isRegisterFreq=ev=>["monthly","quarterly","annually"].includes(ev.frequency);
  // Settings: DB (family.cashFlowSettings) is source of truth, localStorage is fallback
  const settingsKey=`cf_settings_${family.id}`;
  const defaults={projectionMonths:60,projectionMode:"rolling",filingStatus:"mfj",baseIncome:0,stateCode:"FL",stateTaxRate:0,localTaxRate:0,localTaxLabel:"",includeRental:false,includeIncome:true,includeExpense:true,compareStateCode:"",compareLocalTaxRate:0};
  const loadSettings=()=>{
    // 1) Try DB
    if(family.cashFlowSettings&&typeof family.cashFlowSettings==="object"){
      return{...defaults,...family.cashFlowSettings};
    }
    // 2) Fallback to localStorage
    try{const s=JSON.parse(localStorage.getItem(settingsKey)||"{}");return{...defaults,...s};}
    catch{return defaults;}
  };
  const[settings,setSettings]=useState(loadSettings);
  // Reload settings when family.cashFlowSettings changes (e.g., after advisor saves and client reloads)
  useEffect(()=>{setSettings(loadSettings());// eslint-disable-next-line
  },[family.id,family.cashFlowSettings]);
  const updateSetting=async(k,v)=>{
    if(readOnly)return;
    const next={...settings,[k]:v};
    setSettings(next);
    // Save to localStorage (immediate UX) and DB (so client view sees same)
    try{localStorage.setItem(settingsKey,JSON.stringify(next));}catch{}
    const{error}=await sb.from("families").update({cash_flow_settings:next}).eq("id",family.id);
    if(error){toast&&toast("Could not save settings: "+error.message,"error");return;}
    if(reload)reload("families");
  };
  const updateSettings=async(patch)=>{
    if(readOnly)return;
    const next={...settings,...patch};
    setSettings(next);
    try{localStorage.setItem(settingsKey,JSON.stringify(next));}catch{}
    const{error}=await sb.from("families").update({cash_flow_settings:next}).eq("id",family.id);
    if(error){toast&&toast("Could not save settings: "+error.message,"error");return;}
    if(reload)reload("families");
  };

  // Add synthetic rental events if toggled (with full expense math)
  const allEvents=useMemo(()=>{
    // Backfill direction='income' for any legacy events without it; sort by sortOrder asc
    const e=events.map(ev=>({...ev,direction:ev.direction||"income"}));
    // Property costs come from ONE shared derivation, also used by the AI snapshot.
    //
    // This used to net every property cost inside a single "Rental Income (Net)" line
    // and emit nothing at all for a property without rent. Both meant a property cost
    // could not be totalled by category, so firms retyped the cost into this tab by
    // hand — giving two records of one obligation, and on the demo's Harrington family
    // a genuine double-count of Gulf Shore's property tax.
    //
    // Now every cost is its own line, derived at read time, so it appears exactly once
    // and the screen and the assistant cannot disagree.
    // Opt-in per firm: a tenant that has not categorised its expenses would otherwise
    // get these lines ADDED to bundled manual lines it already has, double-counting.
    if(FIRM_DEFAULTS.derivePropertyCosts)e.push(...derivePropertyEvents(properties,{
      includeRental:settings.includeRental,
      forProjection:true,
    }));
    // Sort: synthetic events go after manual events by their sortOrder
    return e.sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0));
  },[events,settings.includeRental,properties]);

  // Comparison scenario: same inputs under a different state's tax (and no/explicit city tax)
  const compareState=settings.compareStateCode?STATE_TAX_RATES.find(st=>st.code===settings.compareStateCode):null;
  const compareActive=!!compareState;
  const compareLocalRate=Number(settings.compareLocalTaxRate)||0;
  // Build month-by-month projection (current state)
  const{monthlyData,enrichedEvents}=useMemo(()=>buildProjection(allEvents,settings,Number(settings.stateTaxRate)||0,Number(settings.localTaxRate)||0),[allEvents,settings]);
  // Comparison projection (only when a compare state is chosen)
  const compareProj=useMemo(()=>compareActive?buildProjection(allEvents,settings,compareState.rate,compareLocalRate):null,[allEvents,settings,compareActive,compareLocalRate]);

  const totalIncome=monthlyData.reduce((s,m)=>s+m.income,0);
  const totalGross=monthlyData.reduce((s,m)=>s+m.gross,0);
  const totalTax=monthlyData.reduce((s,m)=>s+m.tax,0);
  const totalExpense=monthlyData.reduce((s,m)=>s+m.expense,0);
  const totalNet=monthlyData.reduce((s,m)=>s+m.net,0);
  const marginalAllIn=marginalTaxRate(settings.baseIncome,annualOrdinaryIncome(enrichedEvents,settings.projectionMode,settings.projectionMonths),settings.filingStatus,Number(settings.stateTaxRate)||0,Number(settings.localTaxRate)||0);
  // For chart scaling: max positive (income net), min (expenses + negative net rentals)
  const cumulative=[];let run=0;monthlyData.forEach(m=>{run+=m.net;cumulative.push(run);});
  // Comparison scenario totals + cumulative
  const cTotalTax=compareProj?compareProj.monthlyData.reduce((s,m)=>s+m.tax,0):0;
  const cTotalNet=compareProj?compareProj.monthlyData.reduce((s,m)=>s+m.net,0):0;
  const compareCumulative=[];if(compareProj){let cr=0;compareProj.monthlyData.forEach(m=>{cr+=m.net;compareCumulative.push(cr);});}
  const netDelta=cTotalNet-totalNet; // positive = comparison state keeps more (saves)
  // Standalone print: side-by-side relocation tax comparison (current state vs compare state)
  const printComparison=()=>{
    if(!compareActive){toast&&toast("Select a comparison state first.");return;}
    const w=window.open("","_blank");
    const curName=STATE_TAX_RATES.find(s=>s.code===settings.stateCode)?.name||settings.stateCode||"Current State";
    const curRate=Number(settings.stateTaxRate)||0;
    const curLocal=Number(settings.localTaxRate)||0;
    const cmpRate=Number(compareState.rate)||0;
    const cmpLocal=Number(compareLocalRate)||0;
    const cTotalGross=totalGross; // identical income base; only the tax jurisdiction differs
    const curEff=totalGross>0?(totalTax/totalGross)*100:0;
    const cmpEff=cTotalGross>0?(cTotalTax/cTotalGross)*100:0;
    const projOption=CF_PROJECTION_OPTIONS.find(o=>o.value===settings.projectionMonths);
    const projectionLabel=settings.projectionMode==="year"?`Current Year (${new Date().getFullYear()})`:(projOption?projOption.label:settings.projectionMonths+" months");
    const filingLabel=settings.filingStatus==="mfj"?"Married Filing Jointly":"Single";
    const saves=netDelta>=0;
    const taxDiff=totalTax-cTotalTax; // positive = compare state has the lower tax
    const cMonthly=compareProj?compareProj.monthlyData:[];
    const rows=monthlyData.map((m,i)=>{
      const cn=cMonthly[i]?cMonthly[i].net:0;
      const diff=cn-m.net;
      const negA=m.net<0,negB=cn<0,negD=diff<0;
      return `<tr><td>${m.label}</td><td class="num ${negA?"neg":""}">${negA?"−":""}${fmtUSD(Math.abs(m.net))}</td><td class="num ${negB?"neg":""}">${negB?"−":""}${fmtUSD(Math.abs(cn))}</td><td class="num ${negD?"neg":"pos"}">${diff>=0?"+":"−"}${fmtUSD(Math.abs(diff))}</td></tr>`;
    }).join("");
    w.document.write(`<!DOCTYPE html><html><head><title> </title>
    <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Georgia,serif;color:${B.navy};background:#fff;padding:40px;font-size:12px;line-height:1.6;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid ${B.gold};}
    .logo-img{height:120px;width:auto;display:block;}
    h1{font-size:22px;font-weight:700;margin-bottom:2px;}
    .sub{font-size:12px;color:#5a6e84;margin-top:4px;}
    .date{font-size:11px;color:#8fa0b2;margin-top:2px;}
    h2{font-size:13px;font-weight:800;color:${B.navy};margin:18px 0 8px;padding-bottom:4px;border-bottom:1px solid ${B.gold};letter-spacing:.06em;text-transform:uppercase;}
    .assumptions{background:${B.bg};border-radius:8px;padding:12px 16px;margin-bottom:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(110px,100%),1fr));gap:10px;}
    .a-l{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#8fa0b2;margin-bottom:3px;}
    .a-v{font-size:13px;font-weight:700;color:${B.navy};white-space:nowrap;overflow:visible;}
    .cols{display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap;}
    .col{flex:1;min-width:220px;background:${B.bg};border-radius:10px;padding:16px 18px;border-top:3px solid ${B.gold};}
    .col.cmp{border-top-color:${B.navy};}
    .col-name{font-size:15px;font-weight:800;color:${B.navy};margin-bottom:2px;}
    .col-meta{font-size:10px;color:#8fa0b2;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;}
    .line{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:5px 0;border-bottom:1px solid #ede8de;overflow:hidden;}
    .line:last-child{border-bottom:none;}
    .line .k{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#5a6e84;flex:0 0 auto;}
    .line .v{font-size:15px;font-weight:700;color:${B.navy};white-space:nowrap;text-align:right;}
    .line .v.tax{color:#8b1a1a;}
    .verdict{border-radius:10px;padding:16px 20px;margin-bottom:16px;text-align:center;}
    .verdict.save{background:#e0f5e9;border:1px solid #18a850;}
    .verdict.cost{background:#fde8e8;border:1px solid #d43030;}
    .verdict-l{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#5a6e84;margin-bottom:4px;}
    .verdict-v{font-size:26px;font-weight:800;white-space:nowrap;}
    .verdict.save .verdict-v{color:#0d5c2b;}
    .verdict.cost .verdict-v{color:#8b1a1a;}
    .verdict-sub{font-size:11px;color:#5a6e84;margin-top:4px;}
    table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px;}
    th{background:${B.navy};color:${B.gold};padding:6px 10px;text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase;}
    td{padding:5px 10px;border-bottom:1px solid #ede8de;color:#293d5c;}
    tr:nth-child(even) td{background:${B.bg};}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
    .neg{color:#8b1a1a;}.pos{color:#0d5c2b;}
    tfoot td{font-weight:800;border-top:2px solid ${B.navy};background:#fff;}
    .disclaimer{margin-top:24px;padding:12px 14px;background:#fef3e2;border:1px solid #fcd97d;border-radius:6px;font-size:10px;color:#8a5c00;line-height:1.5;}
    @media print{body{padding:20px;}}
    </style></head><body>
    <div class="header">
      <div><img src="${BRAND.logo}" alt="${BRAND.name}" class="logo-img"/></div>
      <div style="text-align:right"><h1>Relocation Tax Comparison</h1><div class="sub">${family.name}</div><div class="date">${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div></div>
    </div>
    <div class="assumptions">
      <div><div class="a-l">Projection</div><div class="a-v">${projectionLabel}</div></div>
      <div><div class="a-l">Filing Status</div><div class="a-v">${filingLabel}</div></div>
      <div><div class="a-l">Base Income</div><div class="a-v">${fmtUSD(settings.baseIncome)}</div></div>
      <div><div class="a-l">Projected Gross</div><div class="a-v">${fmtUSD(totalGross)}</div></div>
    </div>
    <h2>Scenario Comparison</h2>
    <div class="cols">
      <div class="col">
        <div class="col-name">${curName}</div>
        <div class="col-meta">Current &middot; ${curRate.toFixed(2)}% state${curLocal>0?` + ${curLocal.toFixed(2)}% local`:""}</div>
        <div class="line"><span class="k">Total Tax</span><span class="v tax">${fmtUSD(totalTax)}</span></div>
        <div class="line"><span class="k">Effective Rate</span><span class="v">${curEff.toFixed(1)}%</span></div>
        <div class="line"><span class="k">Net (after tax)</span><span class="v">${fmtUSD(totalNet)}</span></div>
      </div>
      <div class="col cmp">
        <div class="col-name">${compareState.name}</div>
        <div class="col-meta">Relocation &middot; ${cmpRate.toFixed(2)}% state${cmpLocal>0?` + ${cmpLocal.toFixed(2)}% local`:" &middot; no city tax"}</div>
        <div class="line"><span class="k">Total Tax</span><span class="v tax">${fmtUSD(cTotalTax)}</span></div>
        <div class="line"><span class="k">Effective Rate</span><span class="v">${cmpEff.toFixed(1)}%</span></div>
        <div class="line"><span class="k">Net (after tax)</span><span class="v">${fmtUSD(cTotalNet)}</span></div>
      </div>
    </div>
    <div class="verdict ${saves?"save":"cost"}">
      <div class="verdict-l">${saves?`Potential Net Gain &mdash; Relocating to ${compareState.name}`:`Additional Net Cost &mdash; Relocating to ${compareState.name}`}</div>
      <div class="verdict-v">${saves?"+":"−"}${fmtUSD(Math.abs(netDelta))}</div>
      <div class="verdict-sub">${Math.abs(taxDiff)>0.005?`${fmtUSD(Math.abs(taxDiff))} ${taxDiff>0?"less":"more"} tax`:"Identical tax burden"} &middot; ${settings.projectionMode==="year"?`calendar year ${new Date().getFullYear()}`:`${settings.projectionMonths}-month projection`}</div>
    </div>
    <h2>Monthly Net &mdash; Side by Side</h2>
    <table><thead><tr><th>Month</th><th class="num">${curName} Net</th><th class="num">${compareState.name} Net</th><th class="num">Difference</th></tr></thead><tbody>
    ${rows}
    </tbody><tfoot><tr><td>Total</td><td class="num ${totalNet<0?"neg":""}">${totalNet<0?"−":""}${fmtUSD(Math.abs(totalNet))}</td><td class="num ${cTotalNet<0?"neg":""}">${cTotalNet<0?"−":""}${fmtUSD(Math.abs(cTotalNet))}</td><td class="num ${netDelta<0?"neg":"pos"}">${netDelta>=0?"+":"−"}${fmtUSD(Math.abs(netDelta))}</td></tr></tfoot></table>
    <div class="disclaimer">
      <strong>Disclaimer:</strong> This relocation comparison models identical income and expense inputs under each state's tax rate (plus any specified local tax), using 2026 federal brackets applied marginally on top of base income, with the federal standard deduction for the filing status applied to ordinary income once per tax year (state and local rates apply to full gross). It does not account for differences in property tax, sales tax, cost of living, homestead or residency-establishment rules, part-year allocation, or state-specific deductions and credits. It is a planning estimate only and not tax or relocation advice. Consult a qualified tax professional before acting on these figures.
    </div>
    </body></html>`);
    w.document.close();w.focus();
    setTimeout(()=>{
      try{
        w.document.querySelectorAll(".a-v,.verdict-v,.col .v").forEach(el=>{
          let size=parseFloat(w.getComputedStyle(el).fontSize)||14;let guard=0;
          while(el.scrollWidth>el.clientWidth+1&&size>9&&guard<40){size-=0.5;el.style.fontSize=size+"px";guard++;}
        });
      }catch(e){}
      w.print();
    },400);
  };
  // Monthly net breakdown
  const monthsCount=monthlyData.length||1;
  const avgInflow=(totalIncome-totalTax)/monthsCount;
  const avgOutflow=totalExpense/monthsCount;
  const avgNet=totalNet/monthsCount;
  const negMonths=monthlyData.filter(m=>m.net<0).length;

  // Add/edit/delete/reorder event
  const addEvent=async(f)=>{
    // New events go to the end of the list
    const maxSort=Math.max(0,...events.map(e=>Number(e.sortOrder)||0));
    const{error}=await sb.from("cash_flow_events").insert({family_id:family.id,direction:f.direction||"income",event_type:f.eventType,description:f.description||null,amount:Number(f.amount)||0,frequency:f.frequency,start_date:f.startDate,end_date:f.endDate||null,tax_treatment:f.taxTreatment||"ordinary",notes:f.notes||null,sort_order:maxSort+10,pcm_responsible:f.direction==="expense"?!!f.pcmResponsible:false,category:f.direction==="expense"?(f.category||null):null,property_id:f.propertyId||null,...(f.direction==="expense"?splitVendorKey(f.vendorKey):{vendor_family_contact_id:null,vendor_property_contact_id:null})});
    if(error)toast(error.message,"error");else{toast("Event added");reload("cash_flow_events");}
  };
  const editEvent=async(id,f)=>{
    const{error}=await sb.from("cash_flow_events").update({direction:f.direction||"income",event_type:f.eventType,description:f.description||null,amount:Number(f.amount)||0,frequency:f.frequency,start_date:f.startDate,end_date:f.endDate||null,tax_treatment:f.taxTreatment||"ordinary",notes:f.notes||null,pcm_responsible:f.direction==="expense"?!!f.pcmResponsible:false,category:f.direction==="expense"?(f.category||null):null,property_id:f.propertyId||null,...(f.direction==="expense"?splitVendorKey(f.vendorKey):{vendor_family_contact_id:null,vendor_property_contact_id:null})}).eq("id",id);
    if(error)toast(error.message,"error");else{toast("Event updated");reload("cash_flow_events");}
  };
  const delEvent=async(id)=>{
    const{error}=await sb.from("cash_flow_events").delete().eq("id",id);
    if(error)toast(error.message,"error");else{toast("Event deleted");reload("cash_flow_events");}
  };
  // Mark/unmark a PCM-responsible expense as paid — mirrors the tasks done/completed_by pattern.
  const togglePaid=async(ev)=>{
    const marking=!ev.paid;
    const{error}=await sb.from("cash_flow_events").update(marking?{paid:true,paid_at:new Date().toISOString(),paid_by:CURRENT_USER_LABEL||null}:{paid:false,paid_at:null,paid_by:null}).eq("id",ev.id);
    if(error)toast(error.message,"error");else{toast(marking?"Marked paid":"Marked unpaid");reload("cash_flow_events");}
  };
  // Reorder: swap sort_order with neighbor (within same direction list, in user-visible order)
  const moveEvent=async(eventId,direction)=>{
    // Build sorted list per direction so up/down only moves within income or within expenses
    const list=[...events].sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0));
    const idx=list.findIndex(e=>e.id===eventId);
    if(idx===-1)return;
    const target=direction==="up"?idx-1:idx+1;
    if(target<0||target>=list.length)return;
    // Swap sort_order values
    const a=list[idx];
    const b=list[target];
    const aSort=Number(a.sortOrder)||0;
    const bSort=Number(b.sortOrder)||0;
    const{error:e1}=await sb.from("cash_flow_events").update({sort_order:bSort}).eq("id",a.id);
    const{error:e2}=await sb.from("cash_flow_events").update({sort_order:aSort}).eq("id",b.id);
    if(e1||e2){toast((e1||e2).message,"error");return;}
    reload("cash_flow_events");
  };

  return <div style={{padding:readOnly?0:(isMobile?"16px 14px":"24px 28px")}}>
    {/* Settings Bar */}
    <div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:isMobile?14:18,marginBottom:18,boxShadow:B.shadow}}>
      <div style={{fontSize:11,fontWeight:800,color:B.textMute,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Projection Settings{readOnly?" (read-only)":""}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(160px,100%),1fr))",gap:12}}>
        <Field label="Projection Window">
          <Sel value={settings.projectionMode==="year"?"year":String(settings.projectionMonths)} disabled={readOnly} onChange={e=>{const v=e.target.value;if(v==="year")updateSettings({projectionMode:"year"});else updateSettings({projectionMode:"rolling",projectionMonths:Number(v)});}}>
            <option value="year">Current Year ({new Date().getFullYear()})</option>
            {CF_PROJECTION_OPTIONS.map(o=><option key={o.value} value={String(o.value)}>{o.label}</option>)}
          </Sel>
        </Field>
        <Field label="Filing Status">
          <Sel value={settings.filingStatus} disabled={readOnly} onChange={e=>updateSetting("filingStatus",e.target.value)}>
            <option value="mfj">Married Filing Jointly</option>
            <option value="single">Single</option>
          </Sel>
        </Field>
        <Field label="Base Annual Income">
          <MoneyInput disabled={readOnly} value={settings.baseIncome||""} onChange={e=>updateSetting("baseIncome",Number(e.target.value)||0)} placeholder="0"/>
        </Field>
        <Field label="State">
          <Sel value={settings.stateCode} disabled={readOnly} onChange={e=>{
            const code=e.target.value;
            const st=STATE_TAX_RATES.find(s=>s.code===code);
            updateSettings({stateCode:code,stateTaxRate:st?st.rate:0});
          }}>
            {STATE_TAX_RATES.map(s=><option key={s.code} value={s.code}>{s.name} ({s.rate.toFixed(2)}%)</option>)}
          </Sel>
        </Field>
        <Field label="Local / City Tax (%)">
          <Inp type="number" step="0.01" disabled={readOnly} value={settings.localTaxRate||""} onChange={e=>updateSetting("localTaxRate",Number(e.target.value)||0)} placeholder="e.g., NYC 3.876"/>
        </Field>
      </div>
      <div style={{marginTop:12,display:"flex",gap:14,flexWrap:"wrap",alignItems:"center"}}>
        <label style={{display:"flex",alignItems:"center",gap:8,cursor:readOnly?"not-allowed":"pointer",fontSize:13,color:B.text,opacity:readOnly?0.7:1}}>
          <input type="checkbox" disabled={readOnly} checked={!!settings.includeRental} onChange={e=>updateSetting("includeRental",e.target.checked)} style={{width:16,height:16,accentColor:B.navy}}/>
          <span>Include rental income from properties</span>
        </label>
        <label style={{display:"flex",alignItems:"center",gap:8,cursor:readOnly?"not-allowed":"pointer",fontSize:13,color:B.text,opacity:readOnly?0.7:1}}>
          <input type="checkbox" disabled={readOnly} checked={settings.includeIncome!==false} onChange={e=>updateSetting("includeIncome",e.target.checked)} style={{width:16,height:16,accentColor:B.navy}}/>
          <span>Include income items</span>
        </label>
        <label style={{display:"flex",alignItems:"center",gap:8,cursor:readOnly?"not-allowed":"pointer",fontSize:13,color:B.text,opacity:readOnly?0.7:1}}>
          <input type="checkbox" disabled={readOnly} checked={settings.includeExpense!==false} onChange={e=>updateSetting("includeExpense",e.target.checked)} style={{width:16,height:16,accentColor:B.navy}}/>
          <span>Include expense items</span>
        </label>
        {!readOnly&&<div style={{fontSize:11,color:B.textSoft,marginLeft:"auto"}}>State rate auto-fills from selection. Common local rates: NYC 3.876% · Philadelphia 3.75% · Detroit 2.4%</div>}
      </div>
      <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${B.borderLight}`,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(160px,100%),1fr))",gap:12,alignItems:"end"}}>
        <Field label="Compare To (relocation)">
          <Sel value={settings.compareStateCode||""} disabled={readOnly} onChange={e=>{
            const code=e.target.value;const st=STATE_TAX_RATES.find(s=>s.code===code);
            updateSettings({compareStateCode:code,compareStateRate:st?st.rate:0});
          }}>
            <option value="">— Off —</option>
            {STATE_TAX_RATES.map(s=><option key={s.code} value={s.code}>{s.name} ({s.rate.toFixed(2)}%)</option>)}
          </Sel>
        </Field>
        {compareActive&&<Field label="Compare Local / City Tax (%)">
          <Inp type="number" step="0.01" disabled={readOnly} value={settings.compareLocalTaxRate||""} onChange={e=>updateSetting("compareLocalTaxRate",Number(e.target.value)||0)} placeholder="0 (no city tax)"/>
        </Field>}
        {compareActive&&<div style={{fontSize:11,color:B.textSoft}}>Models the identical inputs as if the client were taxed in {compareState.name}{compareLocalRate>0?` + ${compareLocalRate}% local`:" with no city tax"}.</div>}
      </div>
    </div>

    {/* Comparison summary */}
    {compareActive&&<div style={{background:"linear-gradient(135deg,#f9f7f3,#f2ede3)",border:`1px solid ${B.gold}`,borderRadius:12,padding:isMobile?16:20,marginBottom:18,boxShadow:B.shadow}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:8,marginBottom:14}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?17:20,color:B.navy,fontWeight:600}}>Relocation Comparison</div>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div style={{fontSize:12,color:B.textSoft}}>{settings.projectionMode==="year"?`calendar year ${new Date().getFullYear()}`:`over ${settings.projectionMonths}-month projection`}</div>
          <Btn small variant="gold" onClick={printComparison}>🖨 Print Comparison</Btn>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(150px,100%),1fr))",gap:12}}>
        <div style={{background:B.white,borderRadius:10,padding:"14px 16px",border:`1px solid ${B.borderLight}`}}>
          <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>{STATE_TAX_RATES.find(s=>s.code===settings.stateCode)?.name||settings.stateCode} · Current</div>
          <div style={{fontSize:13,color:B.textSoft}}>Tax <strong style={{color:"#8b1a1a"}}>{fmtMoney(totalTax)}</strong></div>
          <div style={{fontSize:20,fontFamily:"'Cormorant Garamond',serif",color:B.navy,fontWeight:700,marginTop:4}}>{fmtMoney(totalNet)} <span style={{fontSize:11,color:B.textSoft,fontWeight:400}}>net</span></div>
        </div>
        <div style={{background:B.white,borderRadius:10,padding:"14px 16px",border:`1px solid ${B.gold}`}}>
          <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>{compareState.name} · Compare</div>
          <div style={{fontSize:13,color:B.textSoft}}>Tax <strong style={{color:"#8b1a1a"}}>{fmtMoney(cTotalTax)}</strong></div>
          <div style={{fontSize:20,fontFamily:"'Cormorant Garamond',serif",color:B.navy,fontWeight:700,marginTop:4}}>{fmtMoney(cTotalNet)} <span style={{fontSize:11,color:B.textSoft,fontWeight:400}}>net</span></div>
        </div>
        <div style={{background:netDelta>=0?"#e0f5e9":"#fde8e8",borderRadius:10,padding:"14px 16px",border:`1px solid ${netDelta>=0?"#18a850":"#d43030"}`,display:"flex",flexDirection:"column",justifyContent:"center"}}>
          <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>{netDelta>=0?"Potential Savings":"Additional Cost"}</div>
          <div style={{fontSize:24,fontFamily:"'Cormorant Garamond',serif",color:netDelta>=0?"#0d5c2b":"#8b1a1a",fontWeight:700}}>{netDelta>=0?"+":"−"}{fmtMoney(Math.abs(netDelta))}</div>
          <div style={{fontSize:11,color:B.textSoft,marginTop:2}}>{Math.abs(totalTax-cTotalTax)>0?`${fmtMoney(Math.abs(totalTax-cTotalTax))} ${cTotalTax<totalTax?"less":"more"} tax`:"Same tax"}</div>
        </div>
      </div>
    </div>}

    {/* Stats */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(140px,100%),1fr))",gap:12,marginBottom:18}}>
      <StatBox label="Projected Gross" value={fmtMoney(totalGross)} accent={B.gold}/>
      <StatBox label="Projected Tax" value={fmtMoney(totalTax)} accent="#d43030"/>
      <StatBox label="Projected Net" value={fmtMoney(totalNet)} accent={B.navy}/>
      <StatBox label="Marginal Rate" value={marginalAllIn.toFixed(1)+"%"} accent={B.navyMid}/>
    </div>

    {/* Monthly net breakdown */}
    {monthlyData.length>0&&<div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:isMobile?14:16,marginBottom:18,boxShadow:B.shadow}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:B.navy,fontWeight:600}}>Average Monthly Net</div>
        {negMonths>0?<div style={{fontSize:12,color:"#8b1a1a",fontWeight:700,background:"#fde8e8",padding:"3px 10px",borderRadius:14}}>{negMonths} of {monthlyData.length} months run negative</div>
          :<div style={{fontSize:12,color:"#0d5c2b",fontWeight:700,background:"#e0f5e9",padding:"3px 10px",borderRadius:14}}>All months positive</div>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:isMobile?10:16,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:120}}>
          <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:3}}>Inflow (income net)</div>
          <div style={{fontSize:isMobile?17:20,fontFamily:"'Cormorant Garamond',serif",fontWeight:700,color:"#1f9d57"}}>+{fmtMoney(avgInflow)}<span style={{fontSize:11,color:B.textSoft,fontWeight:400}}>/mo</span></div>
        </div>
        <div style={{fontSize:22,color:B.textMute,fontWeight:300}}>−</div>
        <div style={{flex:1,minWidth:120}}>
          <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:3}}>Outflow (expenses)</div>
          <div style={{fontSize:isMobile?17:20,fontFamily:"'Cormorant Garamond',serif",fontWeight:700,color:"#d43030"}}>−{fmtMoney(avgOutflow)}<span style={{fontSize:11,color:B.textSoft,fontWeight:400}}>/mo</span></div>
        </div>
        <div style={{fontSize:22,color:B.textMute,fontWeight:300}}>=</div>
        <div style={{flex:1,minWidth:120,background:avgNet>=0?"#e0f5e9":"#fde8e8",borderRadius:10,padding:"8px 12px",border:`1px solid ${avgNet>=0?"#18a850":"#d43030"}`}}>
          <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:3}}>Net per month</div>
          <div style={{fontSize:isMobile?18:22,fontFamily:"'Cormorant Garamond',serif",fontWeight:700,color:avgNet>=0?"#0d5c2b":"#8b1a1a"}}>{avgNet>=0?"+":"−"}{fmtMoney(Math.abs(avgNet))}<span style={{fontSize:11,color:B.textSoft,fontWeight:400}}>/mo</span></div>
        </div>
      </div>
      {avgNet<0&&<div style={{fontSize:12,color:B.textSoft,marginTop:10,lineHeight:1.5}}>The cumulative line declines because average monthly outflow exceeds inflow.</div>}
    </div>}

    {/* Chart */}
    {monthlyData.length>0&&<div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:isMobile?14:20,marginBottom:18,boxShadow:B.shadow}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Cash Flow by Month</div>
        <div style={{display:"flex",gap:14,fontSize:11,color:B.textSoft,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,background:"#1f9d57",borderRadius:2,display:"inline-block"}}/>Income (net)</span>
          <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,background:"#d43030",borderRadius:2,display:"inline-block"}}/>Expenses</span>
          <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:16,height:2.5,background:B.navy,display:"inline-block",borderRadius:2}}/>Cumulative net</span>
          {compareActive&&<span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:16,height:0,borderTop:`2.5px dashed ${B.gold}`,display:"inline-block"}}/>{compareState.name}</span>}
        </div>
      </div>
      <GoldLine/>
      <svg viewBox={`0 0 ${Math.max(720,monthlyData.length*18)} 260`} style={{width:"100%",height:isMobile?200:270,display:"block"}}>
        {(() => {
          const W=Math.max(720,monthlyData.length*18);const H=260;const padL=60,padR=compareActive?64:54,padT=18,padB=34;
          const innerW=W-padL-padR;const innerH=H-padT-padB;
          const barW=innerW/monthlyData.length;
          const incomeNetByMonth=monthlyData.map(m=>m.income-m.tax);
          const maxPos=Math.max(...incomeNetByMonth,0);
          const minNeg=-Math.max(...monthlyData.map(m=>m.expense),0);
          const rentalNegativeFloor=Math.min(...monthlyData.map(m=>Math.min(0,m.income-m.tax)),0);
          const minOverall=Math.min(minNeg,rentalNegativeFloor);
          const range=(maxPos-minOverall)||1;
          const zeroY=padT+innerH-(Math.abs(minOverall)/range)*innerH;
          // Shared cumulative scale across current + comparison lines
          const allCum=compareActive?cumulative.concat(compareCumulative):cumulative;
          const cMin=Math.min(...allCum,0);const cMax=Math.max(...allCum,0);const cRange=(cMax-cMin)||1;
          const cumY=v=>padT+innerH-((v-cMin)/cRange)*innerH;
          const lineFor=arr=>arr.map((v,i)=>{const x=padL+barW*i+barW/2;return(i===0?"M":"L")+x.toFixed(1)+","+cumY(v).toFixed(1);}).join(" ");
          const cumPath=lineFor(cumulative);
          const comparePath=compareActive?lineFor(compareCumulative):"";
          const lastX=padL+barW*(monthlyData.length-1)+barW/2;
          const areaPath=`${cumPath} L${lastX.toFixed(1)},${cumY(cMin).toFixed(1)} L${(padL+barW/2).toFixed(1)},${cumY(cMin).toFixed(1)} Z`;
          const stepLabel=Math.max(1,Math.floor(monthlyData.length/(isMobile?6:12)));
          const yTicks=[0,0.25,0.5,0.75,1].map(p=>minOverall+p*range);
          const cTicks=[cMin,cMin+cRange/2,cMax].filter((v,i,a)=>a.indexOf(v)===i);
          return <>
            <defs>
              <linearGradient id="cfIncome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34b36b"/><stop offset="100%" stopColor="#1f9d57"/></linearGradient>
              <linearGradient id="cfExpense" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e05a5a"/><stop offset="100%" stopColor="#c92e2e"/></linearGradient>
              <linearGradient id="cfArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={B.navy} stopOpacity="0.16"/><stop offset="100%" stopColor={B.navy} stopOpacity="0"/></linearGradient>
            </defs>
            {/* Horizontal gridlines + left $ axis */}
            {yTicks.map((v,i)=>{const y=padT+innerH-((v-minOverall)/range)*innerH;return <g key={i}>
              <line x1={padL} x2={W-padR} y1={y} y2={y} stroke={B.borderLight} strokeWidth={Math.abs(v)<0.01?0.9:0.5} strokeDasharray={Math.abs(v)<0.01?"0":"3,3"}/>
              <text x={padL-8} y={y+3} fontSize="9" fill={B.textMute} textAnchor="end">{fmtMoneyShort(v)}</text>
            </g>;})}
            {/* Bars */}
            {monthlyData.map((m,i)=>{
              const x=padL+barW*i+barW*0.16;const w=barW*0.68;
              const incomeNet=m.income-m.tax;const expense=m.expense;const els=[];
              if(incomeNet>=0){const h=(incomeNet/range)*innerH;if(h>0.4)els.push(<rect key={`ig-${i}`} x={x} y={zeroY-h} width={w} height={h} rx={Math.min(2.5,w/2)} fill="url(#cfIncome)"/>);}
              else{const h=(Math.abs(incomeNet)/range)*innerH;els.push(<rect key={`in-${i}`} x={x} y={zeroY} width={w} height={h} rx={Math.min(2.5,w/2)} fill="url(#cfExpense)" opacity="0.6"/>);}
              if(expense>0){const h=(expense/range)*innerH;const yStart=incomeNet<0?zeroY+(Math.abs(incomeNet)/range)*innerH:zeroY;els.push(<rect key={`ex-${i}`} x={x} y={yStart} width={w} height={h} rx={Math.min(2.5,w/2)} fill="url(#cfExpense)"/>);}
              return els;
            })}
            {/* Zero baseline */}
            <line x1={padL} x2={W-padR} y1={zeroY} y2={zeroY} stroke={B.navyMid} strokeWidth="0.8"/>
            {/* Cumulative area + line (current) */}
            <path d={areaPath} fill="url(#cfArea)" stroke="none"/>
            {compareActive&&comparePath&&<path d={comparePath} fill="none" stroke={B.gold} strokeWidth="2.2" strokeDasharray="6,4" strokeLinejoin="round" strokeLinecap="round"/>}
            <path d={cumPath} fill="none" stroke={B.navy} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
            {/* End-point markers + labels */}
            <circle cx={lastX} cy={cumY(cumulative[cumulative.length-1])} r="3" fill={B.navy}/>
            {compareActive&&<circle cx={lastX} cy={cumY(compareCumulative[compareCumulative.length-1])} r="3" fill={B.gold}/>}
            {/* Right axis cumulative ticks */}
            {cTicks.map((v,i)=><text key={i} x={W-padR+6} y={cumY(v)+3} fontSize="9" fill={B.textMute} textAnchor="start">{fmtMoneyShort(v)}</text>)}
            {/* X axis labels */}
            {monthlyData.map((m,i)=>i%stepLabel!==0?null:<text key={i} x={padL+barW*i+barW/2} y={padT+innerH+15} fontSize="9" fill={B.textMute} textAnchor="middle">{m.label}</text>)}
            <line x1={padL} x2={W-padR} y1={padT+innerH} y2={padT+innerH} stroke={B.border} strokeWidth="1"/>
          </>;
        })()}
      </svg>
    </div>}

    {/* Events Table */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:10,flexWrap:"wrap"}}>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Events ({events.length})</div>
      {!readOnly&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Btn variant="gold" onClick={()=>setReportOpen(true)}>🖨 Print Report</Btn>
        <Btn onClick={()=>setModal({type:"add"})}>+ New Event</Btn>
      </div>}
    </div>

    {enrichedEvents.length===0?<Empty text={readOnly?"No cash flow events yet.":"No cash flow events yet. Add your first event."}/>:enrichedEvents.map((e,idx)=>{
      const freqLabel=CF_FREQUENCIES.find(fr=>fr.value===e.frequency)?.label||e.frequency;
      const treatLabel=CF_TAX_TREATMENTS.find(t=>t.value===e.taxTreatment)?.label.split(" (")[0]||e.taxTreatment;
      const isExpense=e.direction==="expense";
      const isNegative=Number(e.amount)<0;
      const isExpanded=!!expandedBreakdowns[e.id];
      const bd=e._breakdown;
      // Real (non-synthetic) events that can be reordered
      const reorderable=!e._synthetic&&!readOnly;
      // Find prev/next reorderable event in the visible list
      const reorderableEvents=enrichedEvents.filter(ev=>!ev._synthetic);
      const myReorderIdx=reorderableEvents.findIndex(ev=>ev.id===e.id);
      const canMoveUp=reorderable&&myReorderIdx>0;
      const canMoveDown=reorderable&&myReorderIdx<reorderableEvents.length-1;
      const accentColor=isExpense?"#d43030":(e._synthetic?(isNegative?"#d43030":B.navyMid):B.gold);
      return <div key={e.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${accentColor}`,borderRadius:10,padding:isMobile?14:16,marginBottom:8,boxShadow:B.shadow,opacity:e._excluded?0.55:1}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
              <span style={{fontWeight:700,color:B.navy,fontSize:14}}>{e.eventType}</span>
              <Badge scheme={isExpense?{bg:"#fde8e8",text:"#8b1a1a",dot:"#d43030"}:{bg:"#e0f5e9",text:"#0d5c2b",dot:"#18a850"}}>{isExpense?"Expense":"Income"}</Badge>
              <Badge scheme={{bg:"#e8f0f8",text:B.navyMid,dot:B.navyMid}}>{freqLabel}</Badge>
              {e._synthetic&&<Badge scheme={{bg:"#fef3e2",text:"#8a5c00",dot:"#d4900a"}}>Auto</Badge>}
              {e._synthetic&&isNegative&&<Badge scheme={{bg:"#fde8e8",text:"#8b1a1a",dot:"#d43030"}}>Net Outflow</Badge>}
              {e._excluded&&<Badge scheme={{bg:B.bg,text:B.textMute,dot:B.textMute}}>Excluded</Badge>}
              {isExpense&&billPay&&e.pcmResponsible&&!e._synthetic&&!isRegisterFreq(e)&&(e.paid
                ?<Badge scheme={{bg:"#e0f5e9",text:"#0d5c2b",dot:"#18a850"}}>✓ Paid by {BRAND.short}</Badge>
                :<Badge scheme={{bg:"#e8f0f8",text:B.navy,dot:B.navy}}>{BRAND.short} Pays</Badge>)}
              {isExpense&&billPay&&e.pcmResponsible&&!e._synthetic&&isRegisterFreq(e)&&<Badge scheme={{bg:"#e8f0f8",text:B.navy,dot:B.navy}}>{BRAND.short} Pays · {e.frequency}</Badge>}
            </div>
            {e.description&&<div style={{fontSize:13,color:B.textMid,marginBottom:4}}>{e.description}</div>}
            <div style={{fontSize:11,color:B.textSoft}}>{fmt(e.startDate)}{e.endDate?` → ${fmt(e.endDate)}`:""}{!isExpense?` · ${treatLabel}`:""}</div>
            {isExpense&&billPay&&e.pcmResponsible&&!e._synthetic&&!isRegisterFreq(e)&&e.paid&&e.paidAt&&<div style={{fontSize:11,color:"#0d5c2b",marginTop:3,fontWeight:600}}>✓ Paid {fmt(e.paidAt)}{e.paidBy?` · by ${e.paidBy}`:""}</div>}
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:12,color:B.textSoft}}>{e.frequency==="once"?"Amount":"Per occurrence"}</div>
            <div style={{fontSize:16,fontWeight:700,color:isExpense||isNegative?"#8b1a1a":B.navy}}>{isExpense?"−":(isNegative?"−":"")}{fmtMoney(Math.abs(e.amount))}</div>
            <div style={{fontSize:11,color:B.textSoft,marginTop:6}}>Projected ({CF_PROJECTION_OPTIONS.find(o=>o.value===settings.projectionMonths)?.label||""})</div>
            <div style={{fontSize:13,fontWeight:700,color:e.projectedNet>=0?"#0d5c2b":"#8b1a1a"}}>{e.projectedNet<0?"−":""}{fmtMoney(Math.abs(e.projectedNet||0))} <span style={{fontSize:10,color:B.textSoft,fontWeight:400}}>{isExpense?"total":"net"}</span></div>
          </div>
        </div>
        {/* Breakdown for synthetic rental events */}
        {e._synthetic&&bd&&<div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${B.borderLight}`}}>
          <button onClick={()=>toggleBreakdown(e.id)} style={{background:"none",border:"none",color:B.navyMid,fontSize:12,fontWeight:600,cursor:"pointer",padding:0,fontFamily:"inherit"}}>
            {isExpanded?"▼ Hide calculation":"▶ Show calculation"}
          </button>
          {isExpanded&&<div style={{marginTop:8,background:B.bg,borderRadius:8,padding:"10px 14px",fontSize:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:4,color:B.textMid}}>
              <span>Gross rental</span><span style={{fontWeight:600,textAlign:"right"}}>{fmtMoney(bd.grossRental)}</span>
              <span>– Property taxes (1/12)</span><span style={{textAlign:"right"}}>−{fmtMoney(bd.propertyTaxesMonthly)}</span>
              <span>– Insurance (1/12)</span><span style={{textAlign:"right"}}>−{fmtMoney(bd.insuranceMonthly)}</span>
              {bd.floodInsuranceMonthly>0&&<><span>– Flood insurance (1/12)</span><span style={{textAlign:"right"}}>−{fmtMoney(bd.floodInsuranceMonthly)}</span></>}
              <span>– HOA</span><span style={{textAlign:"right"}}>−{fmtMoney(bd.hoaMonthly)}</span>
              <span>– Property mgmt ({bd.pmFeePct}%)</span><span style={{textAlign:"right"}}>−{fmtMoney(bd.pmFeeMonthly)}</span>
              {bd.includesMortgage&&<><span>– Mortgage payment</span><span style={{textAlign:"right"}}>−{fmtMoney(bd.mortgageMonthly)}</span></>}
              <span style={{fontWeight:700,paddingTop:4,borderTop:`1px solid ${B.border}`,color:bd.netRental>=0?"#0d5c2b":"#8b1a1a"}}>Net per month</span>
              <span style={{fontWeight:700,paddingTop:4,borderTop:`1px solid ${B.border}`,textAlign:"right",color:bd.netRental>=0?"#0d5c2b":"#8b1a1a"}}>{bd.netRental<0?"−":""}{fmtMoney(Math.abs(bd.netRental))}</span>
            </div>
            <div style={{marginTop:8,fontSize:10,color:B.textMute,fontStyle:"italic"}}>To change these, edit the property in the Properties tab.</div>
          </div>}
        </div>}
        {/* Monthly/quarterly/annual payment register for PCM-responsible recurring expenses */}
        {isExpense&&billPay&&e.pcmResponsible&&!e._synthetic&&isRegisterFreq(e)&&(()=>{
          const periods=getRegisterPeriods(e);
          const paidCount=periods.filter(p=>p.paid).length;
          const overdueCount=periods.filter(p=>p.overdue).length;
          const lastPaid=periods.filter(p=>p.paid&&p.paidAt).sort((a,b)=>new Date(b.paidAt)-new Date(a.paidAt))[0];
          const regOpen=!!expandedRegisters[e.id];
          return <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${B.borderLight}`}}>
            <button onClick={()=>toggleRegister(e.id)} style={{background:"none",border:"none",color:B.navyMid,fontSize:12,fontWeight:600,cursor:"pointer",padding:0,fontFamily:"inherit"}}>
              {regOpen?"▼ Hide":"▶ Show"} payment register ({paidCount}/{periods.length} paid{overdueCount>0?`, ${overdueCount} overdue`:""})
            </button>
            {lastPaid&&<div style={{fontSize:10,color:B.textMute,marginTop:2}}>Last marked paid by {lastPaid.paidBy||"—"} · {fmt(lastPaid.paidAt)} ({lastPaid.label})</div>}
            {regOpen&&<div style={{marginTop:8,background:B.bg,borderRadius:8,padding:"6px 12px"}}>
              {periods.map(p=><div key={p.periodKey} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"6px 0",borderBottom:`1px solid ${B.borderLight}`}}>
                <div>
                  <div style={{fontSize:12,fontWeight:600,color:B.text}}>{p.label}</div>
                  {p.paid&&p.paidAt?<div style={{fontSize:10,color:"#0d5c2b"}}>✓ Paid {fmt(p.paidAt)}{p.paidBy?` · by ${p.paidBy}`:""}</div>
                    :p.overdue?<div style={{fontSize:10,color:"#8b1a1a",fontWeight:600}}>Overdue</div>
                    :<div style={{fontSize:10,color:B.textMute}}>Unpaid</div>}
                </div>
                {!readOnly&&<Btn small variant={p.paid?"ghost":"primary"} onClick={()=>togglePeriodPaid(e,p.periodKey,p.paid)}>{p.paid?"Mark Unpaid":"Mark Paid"}</Btn>}
              </div>)}
            </div>}
          </div>;
        })()}
        {/* Action row: reorder + edit + delete (only for non-synthetic, non-readOnly) */}
        {reorderable&&<div style={{display:"flex",gap:6,marginTop:10,paddingTop:10,borderTop:`1px solid ${B.borderLight}`,justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>moveEvent(e.id,"up")} disabled={!canMoveUp} title="Move up" style={{background:"none",border:`1px solid ${B.border}`,borderRadius:6,padding:"4px 10px",cursor:canMoveUp?"pointer":"not-allowed",color:canMoveUp?B.navy:B.textMute,fontSize:13,fontFamily:"inherit",opacity:canMoveUp?1:0.4}}>↑</button>
            <button onClick={()=>moveEvent(e.id,"down")} disabled={!canMoveDown} title="Move down" style={{background:"none",border:`1px solid ${B.border}`,borderRadius:6,padding:"4px 10px",cursor:canMoveDown?"pointer":"not-allowed",color:canMoveDown?B.navy:B.textMute,fontSize:13,fontFamily:"inherit",opacity:canMoveDown?1:0.4}}>↓</button>
          </div>
          <div style={{display:"flex",gap:6}}>
            {isExpense&&billPay&&e.pcmResponsible&&!isRegisterFreq(e)&&<Btn small variant={e.paid?"ghost":"primary"} onClick={()=>togglePaid(e)}>{e.paid?"Mark Unpaid":"Mark Paid"}</Btn>}
            <Btn small variant="ghost" onClick={()=>setModal({type:"edit",event:e})}>Edit</Btn>
            <Btn small variant="danger" onClick={()=>{if(confirm("Delete this event?"))delEvent(e.id);}}>Delete</Btn>
          </div>
        </div>}
      </div>;
    })}

    {/* Disclaimer */}
    <div style={{background:"#fef3e2",border:"1px solid #fcd97d",borderRadius:8,padding:"10px 14px",marginTop:18,fontSize:11,color:"#8a5c00",lineHeight:1.5}}>
      <strong>Planning estimate only.</strong> Tax calculations use 2026 federal brackets applied marginally on top of base income, with the federal standard deduction for the filing status applied to ordinary income once per tax year (state and local rates apply to full gross). Actual taxes vary based on deductions, credits, AMT, phase-outs, additional Medicare tax, and other factors. Not tax advice — consult a qualified tax professional.
    </div>

    {/* Modals */}
    {modal&&modal.type==="add"&&<Modal title="New Cash Flow Event" onClose={()=>setModal(null)} wide><CashFlowEventForm properties={properties} vendors={vendors} billPay={billPay} onSave={async f=>{await addEvent(f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
    {modal&&modal.type==="edit"&&<Modal title={modal.event.direction==="expense"?"Edit Expense":"Edit Income Event"} onClose={()=>setModal(null)} wide><CashFlowEventForm initial={modal.event} properties={properties} vendors={vendors} billPay={billPay} onSave={async f=>{await editEvent(modal.event.id,f);setModal(null);}} onClose={()=>setModal(null)}/></Modal>}
    {reportOpen&&<CashFlowReport family={family} projectionMonths={settings.projectionMonths} projectionMode={settings.projectionMode} filingStatus={settings.filingStatus} baseIncome={settings.baseIncome} stateRate={settings.stateTaxRate} stateName={STATE_TAX_RATES.find(s=>s.code===settings.stateCode)?.name||settings.stateCode} localRate={settings.localTaxRate} monthlyData={monthlyData} events={enrichedEvents} onClose={()=>setReportOpen(false)}/>}
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
  const canSave=!!f.name.trim()&&PLANS.includes(f.plan);
  const save=async()=>{if(!canSave)return;setSaving(true);await onSave(f);onClose();};
  return <div>
    <Field label="Family Name"><Inp placeholder="The Smith Family" value={f.name} onChange={set("name")}/></Field>
    <Field label="Plan">
      <div style={{display:"grid",gap:8}}>
        {PLANS.map(p=>{
          const on=f.plan===p;
          return <button key={p} type="button" onClick={()=>setF(prev=>({...prev,plan:p}))}
            style={{textAlign:"left",padding:"10px 12px",borderRadius:8,cursor:"pointer",
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
      ? <Field label="Assign Ordanis Expert">
          <select value={f.advisorEmail||""} onChange={pickAdvisor} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${B.border}`,fontSize:14,fontFamily:"'DM Sans',sans-serif",background:B.white,color:B.navy}}>
            <option value="">— Select a Ordanis Expert —</option>
            {advisors.map(a=><option key={a.id} value={a.email}>{(a.full_name||a.email)}{a.full_name?` (${a.email})`:""}</option>)}
          </select>
        </Field>
      : <Field label="Ordanis Expert"><Inp value={userProfile?.fullName||userProfile?.email||""} disabled/></Field>
    }
    <Field label="Notes"><Tex value={f.notes||""} onChange={set("notes")}/></Field>
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
  const families=(data.families||[]).filter(f=>(f.advisorEmail||"")===email);
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
  const overdue=openTasks.filter(t=>t.dueDate&&new Date(t.dueDate)<now);
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
    <div style="text-align:right"><h1>Ordanis Expert Activity Report</h1><div class="advisor">${esc(adv.name||email)}${email?` | ${esc(email)}`:""}</div><div class="date">${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div></div>
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
  ${openTasks.sort((a,b)=>(a.dueDate||"")>(b.dueDate||"")?1:-1).map(t=>{const od=t.dueDate&&new Date(t.dueDate)<now;return`<tr><td>${esc(t.title)}</td><td>${esc(relOf(t))}</td><td>${esc(t.priority)||"—"}</td><td style="${od?"color:#8b1a1a;font-weight:700":""}">${fmtD(t.dueDate)}${od?" (overdue)":""}</td></tr>`;}).join("")||"<tr><td colspan='4' style='color:#8fa0b2'>No open tasks</td></tr>"}
  </tbody></table>
  <h2>Recent Notes (${Math.min(notes.length,15)} of ${notes.length})</h2>
  ${notes.slice(0,15).map(n=>`<div class="note"><div>${esc(n.body)}</div><div class="note-meta">${esc(relOf(n))} · ${fmtD(n.createdAt)}</div></div>`).join("")||"<p style='color:#8fa0b2'>No notes</p>"}
  </body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),400);
}

function FamiliesView({data,reload,toast,userProfile,navIntent,onNavConsumed}){
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
  const filtered=useMemo(()=>families.filter(f=>{
    if(advisorFilter&&(f.advisorEmail||"")!==advisorFilter)return false;
    return [f.name,f.advisorName,f.advisorEmail].join(" ").toLowerCase().includes(search.toLowerCase());
  }),[families,search,advisorFilter]);

  // Per-advisor roll-up (admin only)
  const advisorSummary=useMemo(()=>{
    const statsFor=f=>{
      const props=(data.properties||[]).filter(p=>p.familyId===f.id);
      const accts=(data.portfolio_accounts||[]).filter(a=>a.familyId===f.id);
      const openTasks=(data.tasks||[]).filter(t=>t.familyId===f.id&&!t.done);
      const overdue=openTasks.filter(t=>t.dueDate&&new Date(t.dueDate)<new Date());
      const value=props.reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0)+
                  accts.reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
      return{value,openTasks:openTasks.length,overdue:overdue.length};
    };
    const groups={};
    families.forEach(f=>{
      const key=f.advisorEmail||"__unassigned__";
      if(!groups[key])groups[key]={email:f.advisorEmail||"",name:f.advisorName||"Unassigned",unassigned:!f.advisorEmail,families:0,value:0,openTasks:0,overdue:0};
      const st=statsFor(f);
      groups[key].families+=1;groups[key].value+=st.value;groups[key].openTasks+=st.openTasks;groups[key].overdue+=st.overdue;
    });
    advisors.forEach(a=>{if(!groups[a.email])groups[a.email]={email:a.email,name:a.full_name||a.email,unassigned:false,families:0,value:0,openTasks:0,overdue:0};});
    return Object.values(groups).sort((a,b)=>(b.value-a.value)||(b.families-a.families));
  },[families,data,advisors]);

  // advisor_email is written on BOTH plans, including Core. On Core the client is never shown a
  // Ordanis Expert and no expert-led feature turns on, but somebody at the firm still has to be able
  // to open the household: fetchTable scopes an advisor's families by advisor_email, so a null
  // there would make every Core family invisible to everyone but an admin the moment it was
  // created. Expert of record for access, not a service level.
  const add=async f=>{const{error}=await sb.from("families").insert({name:f.name,plan:f.plan,advisor_name:f.advisorName||null,advisor_email:f.advisorEmail||null,notes:f.notes||null});if(error)toast(error.message,"error");else{toast("Family added");reload("families");}};
  const edit=async f=>{const{error}=await sb.from("families").update({name:f.name,plan:f.plan,advisor_name:f.advisorName||null,advisor_email:f.advisorEmail||null,notes:f.notes||null}).eq("id",modal.id);if(error)toast(error.message,"error");else{toast("Updated");reload("families");}};
  const del=async id=>{const{error}=await sb.from("families").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Deleted");reload("families");if(selected?.id===id)setSelected(null);}};

  // If a family is selected, show its dashboard
  if(selected) return <ViewErrorBoundary label="the family dashboard" onBack={()=>setSelected(null)}>
    <FamilyDashboard family={selected} data={data} reload={reload} toast={toast} onBack={()=>{setSelected(null);setIntentTab(null);}} userProfile={userProfile} initialTab={intentTab}/>
  </ViewErrorBoundary>;

  const getStats=f=>({
    properties:(data.properties||[]).filter(p=>p.familyId===f.id).length,
    accounts:(data.portfolio_accounts||[]).filter(a=>a.familyId===f.id).length,
    tasks:(data.tasks||[]).filter(t=>t.familyId===f.id&&!t.done).length,
    value:(data.properties||[]).filter(p=>p.familyId===f.id).reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0)+
          (data.portfolio_accounts||[]).filter(a=>a.familyId===f.id).reduce((s,a)=>s+(Number(a.currentBalance)||0),0),
  });

  return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
    <div style={{padding:"14px 24px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      {isAdmin&&<div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
        {[{k:"families",l:"Families"},{k:"advisors",l:"By Ordanis Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"7px 14px",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
      </div>}
      {viewMode==="families"&&<>
        <Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search families…" style={{flex:1,minWidth:160}}/>
        {advisorFilter&&<button onClick={()=>setAdvisorFilter("")} style={{border:`1px solid ${B.gold}`,background:"#fbf6ec",color:B.navy,borderRadius:16,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{(advisorSummary.find(a=>a.email===advisorFilter)?.name)||advisorFilter} ✕</button>}
        <Btn onClick={()=>setModal("add")}>+ New Family</Btn>
      </>}
      {viewMode==="advisors"&&<div style={{flex:1,fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Ordanis Expert Summary</div>}
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"16px 24px"}}>
      {viewMode==="advisors"&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(320px,100%),1fr))",gap:16}}>
        {advisorSummary.length===0&&<Empty text="No Ordanis Experts or families yet."/>}
        {advisorSummary.map(a=>(
          <div key={a.email||"unassigned"} onClick={()=>{if(!a.unassigned){setAdvisorFilter(a.email);setViewMode("families");}}}
            style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${a.unassigned?B.textMute:B.gold}`,padding:20,cursor:a.unassigned?"default":"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
            onMouseEnter={e=>{if(!a.unassigned)e.currentTarget.style.boxShadow=B.shadowMd;}}
            onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
            <div style={{marginBottom:12}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:a.unassigned?B.textMute:B.navy,fontWeight:600,marginBottom:2}}>{a.name}</div>
              <div style={{fontSize:12,color:B.textSoft}}>{a.email||"Families with no Ordanis Expert assigned"}</div>
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
      {filtered.length===0&&<Empty text={advisorFilter?"No families for this Ordanis Expert.":"No families yet. Add your first one."}/>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(300px,100%),1fr))",gap:16}}>
        {filtered.map(f=>{
          const s=getStats(f);
          const overdue=(data.tasks||[]).filter(t=>t.familyId===f.id&&!t.done&&t.dueDate&&new Date(t.dueDate)<new Date()).length;
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
                {/* On Core there is no assigned expert to name, so the row says who leads instead
                    of showing the expert-of-record we keep for access. */}
                <div style={{fontSize:12,color:B.textSoft}}>
                  {planAllows(f.plan,"assignedExpert")
                    ? (f.advisorName||"No Ordanis Expert assigned")
                    : "Partner-led"}
                </div>
              </div>
              <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                <Btn small variant="ghost" onClick={()=>setModal(f)}>Edit</Btn>
                <Btn small variant="danger" onClick={()=>del(f.id)}>✕</Btn>
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

// ── PORTFOLIO ACCOUNT FORM (top-level) ──────────────────────────────────────
function PortfolioAccountForm({initial,families=[],onSave,onClose}){
  const[f,setF]=useState(initial||{familyId:"",institution:"",bankerName:"",accountType:"Investment",startingBalance:"",currentBalance:"",notes:""});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const save=async()=>{if(!f.institution.trim())return;setSaving(true);await onSave(f);onClose();};
  const pct=pctChange(f.startingBalance,f.currentBalance);
  return <div>
    {families.length>0&&<Field label="Family"><Sel value={f.familyId||""} onChange={set("familyId")}><option value="">— No family —</option>{families.map(fm=><option key={fm.id} value={fm.id}>{fm.name}</option>)}</Sel></Field>}
    <Grid2><Field label="Institution"><Inp placeholder="Merrill Lynch" value={f.institution} onChange={set("institution")}/></Field><Field label="Banker Name"><Inp value={f.bankerName||""} onChange={set("bankerName")}/></Field></Grid2>
    <Field label="Account Type"><Sel value={f.accountType} onChange={set("accountType")}>{ACCT_TYPES.map(t=><option key={t}>{t}</option>)}</Sel></Field>
    <Grid2><Field label="Starting Balance"><MoneyInput value={f.startingBalance||""} onChange={set("startingBalance")}/></Field><Field label="Current Balance"><MoneyInput value={f.currentBalance||""} onChange={set("currentBalance")}/></Field></Grid2>
    {pct!==null&&<div style={{background:Number(pct)>=0?"#e0f5e9":"#fde8e8",border:`1px solid ${Number(pct)>=0?"#2e9e57":"#d43030"}`,borderRadius:8,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:20}}>{Number(pct)>=0?"📈":"📉"}</span><div style={{fontSize:18,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,color:Number(pct)>=0?"#0d5c2b":"#8b1a1a"}}>{Number(pct)>=0?"+":""}{pct}% performance</div></div>}
    <Field label="Notes"><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</Btn></div>
  </div>;
}

// ── PORTFOLIO VIEW (global) ───────────────────────────────────────────────────
function PortfolioView({data,reload,toast,userProfile}){
  const isMobile=useIsMobile();
  const{families,portfolio_accounts=[]}=data;
  const[modal,setModal]=useState(null);
  const[filterFamily,setFilterFamily]=useState("all");
  const[advScope,setAdvScope]=useState("");
  const[selected,setSelected]=useState(null);
  const gf=id=>families.find(f=>f.id===id);
  const accounts=portfolio_accounts.filter(a=>(filterFamily==="all"||a.familyId===filterFamily)&&(!advScope||(gf(a.familyId)?.advisorEmail||"").toLowerCase()===advScope));
  const totalValue=accounts.reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const totalStart=accounts.reduce((s,a)=>s+(Number(a.startingBalance)||0),0);
  const totalPct=totalStart>0?(((totalValue-totalStart)/totalStart)*100).toFixed(2):null;

  const add=async f=>{const{error}=await sb.from("portfolio_accounts").insert({family_id:f.familyId||null,institution:f.institution,banker_name:f.bankerName||null,account_type:f.accountType,starting_balance:f.startingBalance||null,current_balance:f.currentBalance||null,notes:f.notes||null});if(error)toast(error.message,"error");else{toast("Account added");reload("portfolio_accounts");}};
  const edit=async f=>{const{error}=await sb.from("portfolio_accounts").update({family_id:f.familyId||null,institution:f.institution,banker_name:f.bankerName||null,account_type:f.accountType,starting_balance:f.startingBalance||null,current_balance:f.currentBalance||null,notes:f.notes||null}).eq("id",modal.id);if(error)toast(error.message,"error");else{toast("Updated");reload("portfolio_accounts");setSelected({...selected,...f});}};
  const del=async id=>{const{error}=await sb.from("portfolio_accounts").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Deleted");reload("portfolio_accounts");if(selected?.id===id)setSelected(null);}};

  return <div style={{display:"flex",height:"100%",minHeight:0}}>
    {/* List (hidden on mobile when detail is showing) */}
    {(!isMobile||!selected)&&<div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",borderRight:isMobile?"none":`1px solid ${B.borderLight}`}}>
      <div style={{padding:isMobile?"10px 14px":"12px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <Sel value={filterFamily} onChange={e=>setFilterFamily(e.target.value)} style={{width:isMobile?"100%":200,order:isMobile?2:0}}><option value="all">All Families</option>{families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Sel>
        <AdvisorScopeBar userProfile={userProfile} value={advScope} onChange={setAdvScope}/>
        <div style={{flex:1,fontSize:12,color:B.textSoft,order:isMobile?1:0}}>Total: <strong style={{color:B.navy}}>{fmtMoney(totalValue)}</strong>{totalPct!==null&&<span style={{color:Number(totalPct)>=0?"#18a850":"#d43030",fontWeight:700,marginLeft:8}}>{Number(totalPct)>=0?"+":""}{totalPct}%</span>}</div>
        <Btn onClick={()=>setModal("add")}>+ New Account</Btn>
      </div>
      <div style={{overflowY:"auto",flex:1}}>
        {accounts.length===0&&<Empty text="No portfolio accounts yet."/>}
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
function NotesView({data,reload,toast,userProfile,prospectMode=false}){
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
    const path=`note-attachments/${familyIdForPath||"general"}/${Date.now()}_${Math.random().toString(36).slice(2,8)}_${file.name.replace(/\s+/g,"_")}`;
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
      toast("Note added");
    }
    setBody("");setPendingFiles([]);setSaving(false);
    reload("notes");reload("note_attachments");
  };
  const del=async id=>{const{error}=await sb.from("notes").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Deleted");reload("notes");reload("note_attachments");}};
  const saveEdit=async id=>{if(!editBody.trim())return;const{error}=await sb.from("notes").update({body:editBody}).eq("id",id);if(error)toast(error.message,"error");else{toast("Note updated");setEditId(null);setEditBody("");reload("notes");}};
  const download=async(att)=>{
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
    return n.body.toLowerCase().includes(search.toLowerCase())||(gc(n.contactId)?.name||"").toLowerCase().includes(search.toLowerCase())||(gf(n.familyId)?.name||"").toLowerCase().includes(search.toLowerCase());
  });
  if(adminProspect&&viewMode==="advisors"){
    return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
          {[{k:"notes",l:"Notes"},{k:"advisors",l:"By Ordanis Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
        </div>
        <div style={{flex:1,fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Notes by Ordanis Expert</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(300px,100%),1fr))",gap:16}}>
          {advisorSummary.length===0&&<Empty text="No Ordanis Experts or notes yet."/>}
          {advisorSummary.map(a=>(
            <div key={a.email||"unassigned"} onClick={()=>{if(!a.unassigned){setAdvisorFilter(a.email);setViewMode("notes");}}}
              style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${a.unassigned?B.textMute:B.gold}`,padding:20,cursor:a.unassigned?"default":"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
              onMouseEnter={e=>{if(!a.unassigned)e.currentTarget.style.boxShadow=B.shadowMd;}}
              onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
              <div style={{marginBottom:12}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:a.unassigned?B.textMute:B.navy,fontWeight:600,marginBottom:2}}>{a.name}</div>
                <div style={{fontSize:12,color:B.textSoft}}>{a.email||"Notes not linked to a Ordanis Expert's contact"}</div>
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
        {[{k:"notes",l:"Notes"},{k:"advisors",l:"By Ordanis Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
      </div>
      {advisorFilter&&<button onClick={()=>setAdvisorFilter("")} style={{border:`1px solid ${B.gold}`,background:"#fbf6ec",color:B.navy,borderRadius:16,padding:"5px 11px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>{(advisorSummary.find(a=>a.email===advisorFilter)?.name)||advisorFilter} ✕</button>}
    </div>}
    {!prospectMode&&userProfile?.role==="admin"&&<div style={{padding:"10px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      <AdvisorScopeBar userProfile={userProfile} value={cmAdvScope} onChange={setCmAdvScope}/>
      {cmAdvScope&&<span style={{fontSize:12,color:B.textSoft}}>Showing notes for this Ordanis Expert's families</span>}
    </div>}
    <div style={{padding:isMobile?"14px 14px":"20px 28px",borderBottom:`1px solid ${B.borderLight}`,background:B.white}}>
      <div style={{maxWidth:800,margin:"0 auto"}}>
        <div style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:12,overflow:"hidden",boxShadow:B.shadow}}>
          <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Write a note or activity log entry…" style={{width:"100%",minHeight:88,background:"transparent",border:"none",padding:"14px 16px",color:B.text,fontSize:14,outline:"none",resize:"none",fontFamily:"inherit",lineHeight:1.65,boxSizing:"border-box"}}/>
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
              <input type="file" multiple onChange={e=>{
                const files=Array.from(e.target.files||[]);
                if(files.length===0)return;
                setPendingFiles([...pendingFiles,...files.map(f=>({file:f,category:"General"}))]);
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
                    <textarea value={editBody} onChange={e=>setEditBody(e.target.value)}
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
function TasksView({data,reload,toast,userProfile,prospectMode=false}){
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
  const oc=tasks.filter(t=>!t.done&&t.dueDate&&new Date(t.dueDate)<new Date()).length;
  const soon=tasks.filter(t=>!t.done&&t.dueDate&&(new Date(t.dueDate)-new Date())/(86400000)<=30&&new Date(t.dueDate)>=new Date()).length;
  const advisorSummary=useMemo(()=>{
    const groups={};const now=new Date();
    tasks.forEach(t=>{
      const c=contacts.find(x=>x.id===t.contactId);
      const adv=c&&c.advisorEmail?{email:c.advisorEmail,name:c.advisorName||c.advisorEmail}:null;
      const key=adv?adv.email:"__unassigned__";
      if(!groups[key])groups[key]={email:adv?adv.email:"",name:adv?adv.name:"Unassigned",unassigned:!adv,open:0,overdue:0,done:0};
      if(t.done)groups[key].done+=1;
      else{groups[key].open+=1;if(t.dueDate&&new Date(t.dueDate)<now)groups[key].overdue+=1;}
    });
    advisors.forEach(a=>{if(!groups[a.email])groups[a.email]={email:a.email,name:a.full_name||a.email,unassigned:false,open:0,overdue:0,done:0};});
    return Object.values(groups).sort((a,b)=>(b.open-a.open)||(b.overdue-a.overdue));
  },[tasks,contacts,advisors]);

  const add=async f=>{const{error}=await sb.from("tasks").insert({family_id:f.familyId||null,contact_id:f.contactId||null,title:f.title,due_date:f.dueDate||null,priority:f.priority,reminder_days:Number(f.reminderDays)||7,done:false,recurrence:f.recurrence||null,recurrence_interval:f.recurrence==="Custom"?(Number(f.recurrenceInterval)||1):null,recurrence_unit:f.recurrence==="Custom"?(f.recurrenceUnit||"week"):null});if(error)toast(error.message,"error");else{toast("Task added");reload("tasks");}};
  const tog=async t=>{const marking=!t.done;const{error}=await sb.from("tasks").update(marking?{done:true,completed_at:new Date().toISOString(),completed_by:CURRENT_USER_LABEL||null}:{done:false,completed_at:null,completed_by:null}).eq("id",t.id);if(error){toast(error.message,"error");return;}if(marking&&t.recurrence){const nd=nextRecurrence(t.dueDate,t.recurrence,t.recurrenceInterval,t.recurrenceUnit);if(nd){await sb.from("tasks").insert({family_id:t.familyId||null,contact_id:t.contactId||null,title:t.title,due_date:nd,priority:t.priority,reminder_days:t.reminderDays||7,done:false,recurrence:t.recurrence,recurrence_interval:t.recurrence==="Custom"?(t.recurrenceInterval||1):null,recurrence_unit:t.recurrence==="Custom"?(t.recurrenceUnit||"week"):null});toast("Next occurrence: "+fmt(nd));}}reload("tasks");};
  const del=async id=>{const{error}=await sb.from("tasks").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Deleted");reload("tasks");}};


  if(adminProspect&&viewMode==="advisors"){
    return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
          {[{k:"tasks",l:"Tasks"},{k:"advisors",l:"By Ordanis Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
        </div>
        <div style={{flex:1,fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Tasks by Ordanis Expert</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(300px,100%),1fr))",gap:16}}>
          {advisorSummary.length===0&&<Empty text="No Ordanis Experts or tasks yet."/>}
          {advisorSummary.map(a=>(
            <div key={a.email||"unassigned"} onClick={()=>{if(!a.unassigned){setAdvisorFilter(a.email);setViewMode("tasks");}}}
              style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${a.unassigned?B.textMute:B.gold}`,padding:20,cursor:a.unassigned?"default":"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
              onMouseEnter={e=>{if(!a.unassigned)e.currentTarget.style.boxShadow=B.shadowMd;}}
              onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
              <div style={{marginBottom:12}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:a.unassigned?B.textMute:B.navy,fontWeight:600,marginBottom:2}}>{a.name}</div>
                <div style={{fontSize:12,color:B.textSoft}}>{a.email||"Tasks not linked to a Ordanis Expert's contact"}</div>
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
        {[{k:"tasks",l:"Tasks"},{k:"advisors",l:"By Ordanis Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"5px 11px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
      </div>}
      {adminProspect&&advisorFilter&&<button onClick={()=>setAdvisorFilter("")} style={{border:`1px solid ${B.gold}`,background:"#fbf6ec",color:B.navy,borderRadius:16,padding:"5px 11px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>{(advisorSummary.find(a=>a.email===advisorFilter)?.name)||advisorFilter} ✕</button>}
      <div style={{display:"flex",gap:5}}>{["Pending","Done","All"].map(s=><button key={s} onClick={()=>setFilter(s)} style={{background:filter===s?B.navy:"transparent",border:`1px solid ${filter===s?B.navy:B.border}`,color:filter===s?B.white:B.textSoft,borderRadius:20,padding:"4px 14px",fontSize:11,cursor:"pointer",fontWeight:700,fontFamily:"inherit"}}>{s}</button>)}</div>
      <Sel value={filterFamily} onChange={e=>setFilterFamily(e.target.value)} style={{width:170}}><option value="all">All Families</option>{families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Sel>
      {!prospectMode&&<AdvisorScopeBar userProfile={userProfile} value={cmAdvScope} onChange={setCmAdvScope}/>}
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
        const isOD=!t.done&&t.dueDate&&new Date(t.dueDate)<new Date();
        const isSoon=!t.done&&!isOD&&t.dueDate&&(new Date(t.dueDate)-new Date())/(86400000)<=30;
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
  const save=async()=>{if(!f.title.trim())return;setSaving(true);await onSave(f);onClose();};
  return <div>
    <Grid2><Field label="Family"><Sel value={f.familyId||""} onChange={set("familyId")}><option value="">— None —</option>{families.map(fm=><option key={fm.id} value={fm.id}>{fm.name}</option>)}</Sel></Field>
    <Field label="Contact"><Sel value={f.contactId||""} onChange={set("contactId")}><option value="">— None —</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Sel></Field></Grid2>
    <Field label="Task"><Inp placeholder="Follow up on loan maturity" value={f.title} onChange={set("title")}/></Field>
    <Grid2><Field label="Due Date"><Inp type="date" value={f.dueDate||""} onChange={set("dueDate")}/></Field><Field label="Priority"><Sel value={f.priority} onChange={set("priority")}><option>Low</option><option>Medium</option><option>High</option></Sel></Field></Grid2>
    <Field label="Email Reminder"><Sel value={f.reminderDays||7} onChange={e=>setF(p=>({...p,reminderDays:Number(e.target.value)}))}><option value={0}>No reminder</option>{REMINDER_OPTIONS.map(r=><option key={r.days} value={r.days}>{r.label}</option>)}</Sel></Field>
    {Number(f.reminderDays)>0&&f.dueDate&&<div style={{background:"#e8f0f8",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:B.navyMid}}>🔔 Ordanis Expert emailed on {new Date(new Date(f.dueDate).setDate(new Date(f.dueDate).getDate()-Number(f.reminderDays))).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>}
    <RecurrenceField f={f} setF={setF}/>
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
  const save=async()=>{if(!f.name.trim())return;setSaving(true);await onSave(f);onClose();};
  return <div>
    <Grid2><Field label="Full Name"><Inp placeholder="Jane Smith" value={f.name} onChange={set("name")}/></Field><Field label="Company"><Inp value={f.company||""} onChange={set("company")}/></Field></Grid2>
    <Grid2><Field label="Email"><Inp type="email" value={f.email||""} onChange={set("email")}/></Field><Field label="Phone"><Inp placeholder="(555) 000-0000" value={f.phone||""} onChange={e=>set("phone")({target:{value:formatPhoneInput(e.target.value)}})}/></Field></Grid2>
    <Grid2><Field label="Type"><Sel value={f.type} onChange={set("type")}><option>Individual</option><option>Business</option></Sel></Field><Field label="Lead Source"><Inp placeholder="Referral, LinkedIn…" value={f.source||""} onChange={set("source")}/></Field></Grid2>
    {isAdmin
      ? <Field label="Assign Ordanis Expert">
          <select value={f.advisorEmail||""} onChange={pickAdvisor} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${B.border}`,fontSize:14,fontFamily:"'DM Sans',sans-serif",background:B.white,color:B.navy}}>
            <option value="">— Select a Ordanis Expert —</option>
            {advisors.map(a=><option key={a.id} value={a.email}>{(a.full_name||a.email)}{a.full_name?` (${a.email})`:""}</option>)}
          </select>
        </Field>
      : <Field label="Ordanis Expert"><Inp value={f.advisorName||f.advisorEmail||userProfile?.fullName||userProfile?.email||""} disabled/></Field>
    }
    <Field label="Tags"><Inp placeholder="warm-lead, vip" value={f.tags||""} onChange={set("tags")}/></Field>
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
  const add=async f=>{const{error}=await sb.from("contacts").insert({family_id:null,name:f.name,company:f.company||null,email:f.email||null,phone:f.phone||null,type:f.type,tags:f.tags||null,advisor_email:f.advisorEmail||null,advisor_name:f.advisorName||null});if(error)toast(error.message,"error");else{toast("Contact added");reload("contacts");}};
  const edit=async f=>{const{error}=await sb.from("contacts").update({name:f.name,company:f.company||null,email:f.email||null,phone:f.phone||null,type:f.type,tags:f.tags||null,advisor_email:f.advisorEmail||null,advisor_name:f.advisorName||null}).eq("id",modal.id);if(error)toast(error.message,"error");else{toast("Updated");reload("contacts");setSelected({...selected,...f});}};
  const del=async id=>{const{error}=await sb.from("contacts").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Deleted");reload("contacts");if(selected?.id===id)setSelected(null);}};

  if(isAdmin&&viewMode==="advisors"){
    return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
      <div style={{padding:isMobile?"12px 14px":"14px 20px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
          {[{k:"contacts",l:"Contacts"},{k:"advisors",l:"By Ordanis Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"7px 14px",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
        </div>
        <div style={{flex:1,fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Prospecting by Ordanis Expert</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(320px,100%),1fr))",gap:16}}>
          {advisorSummary.length===0&&<Empty text="No Ordanis Experts or prospects yet."/>}
          {advisorSummary.map(a=>(
            <div key={a.email||"unassigned"} onClick={()=>{if(!a.unassigned){setAdvisorFilter(a.email);setViewMode("contacts");}}}
              style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${a.unassigned?B.textMute:B.gold}`,padding:20,cursor:a.unassigned?"default":"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
              onMouseEnter={e=>{if(!a.unassigned)e.currentTarget.style.boxShadow=B.shadowMd;}}
              onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
              <div style={{marginBottom:12}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:a.unassigned?B.textMute:B.navy,fontWeight:600,marginBottom:2}}>{a.name}</div>
                <div style={{fontSize:12,color:B.textSoft}}>{a.email||"Prospects with no Ordanis Expert assigned"}</div>
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
          {[{k:"contacts",l:"Contacts"},{k:"advisors",l:"By Ordanis Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
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
  const save=async()=>{if(!f.title.trim())return;setSaving(true);await onSave(f);onClose();};
  return <div>
    <Field label="Opportunity Title"><Inp value={f.title} onChange={set("title")}/></Field>
    <Field label="Contact"><Sel value={f.contactId||""} onChange={set("contactId")}><option value="">— None —</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Sel></Field>
    <Grid2><Field label="Value ($)"><MoneyInput value={f.value||""} onChange={set("value")}/></Field><Field label="Close Date"><Inp type="date" value={f.closeDate||""} onChange={set("closeDate")}/></Field></Grid2>
    <Field label="Stage"><Sel value={f.stage} onChange={set("stage")}>{STAGES.map(s=><option key={s}>{s}</option>)}</Sel></Field>
    {isAdmin
      ? <Field label="Assign Ordanis Expert">
          <select value={f.advisorEmail||""} onChange={pickAdvisor} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${B.border}`,fontSize:14,fontFamily:"'DM Sans',sans-serif",background:B.white,color:B.navy}}>
            <option value="">— Select a Ordanis Expert —</option>
            {advisors.map(a=><option key={a.id} value={a.email}>{(a.full_name||a.email)}{a.full_name?` (${a.email})`:""}</option>)}
          </select>
        </Field>
      : <Field label="Ordanis Expert"><Inp value={f.advisorName||f.advisorEmail||userProfile?.fullName||userProfile?.email||""} disabled/></Field>
    }
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

  const add=async f=>{const{error}=await sb.from("deals").insert({family_id:null,contact_id:f.contactId||null,title:f.title,value:f.value||null,stage:f.stage,close_date:f.closeDate||null,advisor_email:f.advisorEmail||null,advisor_name:f.advisorName||null});if(error)toast(error.message,"error");else{toast("Opportunity added");reload("deals");}};
  const edit=async f=>{const{error}=await sb.from("deals").update({contact_id:f.contactId||null,title:f.title,value:f.value||null,stage:f.stage,close_date:f.closeDate||null,advisor_email:f.advisorEmail||null,advisor_name:f.advisorName||null}).eq("id",modal.id);if(error)toast(error.message,"error");else{toast("Updated");reload("deals");}};
  const del=async id=>{const{error}=await sb.from("deals").delete().eq("id",id);if(error)toast(error.message,"error");else{toast("Deleted");reload("deals");}};
  const move=async(deal,dir)=>{const idx=STAGES.indexOf(deal.stage);const next=STAGES[idx+dir];if(!next)return;const{error}=await sb.from("deals").update({stage:next}).eq("id",deal.id);if(error)toast(error.message,"error");else reload("deals");};

  if(isAdmin&&viewMode==="advisors"){
    return <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",background:B.white}}>
        <div style={{display:"flex",background:B.bg,borderRadius:8,padding:3,border:`1px solid ${B.borderLight}`}}>
          {[{k:"pipeline",l:"Pipeline"},{k:"advisors",l:"By Ordanis Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
        </div>
        <div style={{flex:1,fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Pipeline by Ordanis Expert</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(320px,100%),1fr))",gap:16}}>
          {advisorSummary.length===0&&<Empty text="No Ordanis Experts or deals yet."/>}
          {advisorSummary.map(a=>(
            <div key={a.email||"unassigned"} onClick={()=>{if(!a.unassigned){setAdvisorFilter(a.email);setViewMode("pipeline");}}}
              style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${a.unassigned?B.textMute:B.gold}`,padding:20,cursor:a.unassigned?"default":"pointer",boxShadow:B.shadow,transition:"box-shadow .15s"}}
              onMouseEnter={e=>{if(!a.unassigned)e.currentTarget.style.boxShadow=B.shadowMd;}}
              onMouseLeave={e=>e.currentTarget.style.boxShadow=B.shadow}>
              <div style={{marginBottom:12}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:a.unassigned?B.textMute:B.navy,fontWeight:600,marginBottom:2}}>{a.name}</div>
                <div style={{fontSize:12,color:B.textSoft}}>{a.email||"Opportunities not linked to a Ordanis Expert's contact"}</div>
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
        {[{k:"pipeline",l:"Pipeline"},{k:"advisors",l:"By Ordanis Expert"}].map(t=><button key={t.k} onClick={()=>setViewMode(t.k)} style={{border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",background:viewMode===t.k?B.navy:"transparent",color:viewMode===t.k?B.white:B.textSoft}}>{t.l}</button>)}
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

// Bills the firm is responsible for, due inside the window and not yet settled.
// One-offs carry their own paid flag; recurring bills record each period in
// cash_flow_payment_log, so the two are checked differently.
function collectBills({events=[],families=[],paymentLog=[],windowDays=45}){
  const today=new Date(); today.setHours(12,0,0,0);
  const famName=id=>{const f=families.find(x=>x.id===id);return f?f.name:null;};
  const paidPeriods=new Set((paymentLog||[]).filter(l=>l&&l.paid).map(l=>`${l.eventId}|${l.period}`));
  const out=[];
  (events||[]).forEach(e=>{
    if(!e||e.direction!=="expense"||!e.pcmResponsible)return;
    const due=nextBillDue(e.startDate,e.frequency,e.endDate,today);
    if(!due)return;
    const d=new Date(due+"T12:00:00");
    const days=Math.round((d-today)/86400000);
    if(days>windowDays)return;
    const oneOff=["once","one-time","onetime",""].includes(String(e.frequency||"once").toLowerCase());
    const settled=oneOff?!!e.paid:paidPeriods.has(`${e.id}|${due}`);
    if(settled)return;
    out.push({
      key:`bill:${e.id}:${due}`,id:e.id,dateISO:due,days,
      label:e.description||e.eventType||"Bill",
      amount:Number(e.amount)||0,frequency:e.frequency,category:e.category,
      familyId:e.familyId,familyName:famName(e.familyId),
      overdue:days<0,
    });
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
function collectDeadlines({tasks=[],properties=[],deals=[],contacts=[],families=[],acks=[],windowDays=60}){
  const today=new Date(); today.setHours(0,0,0,0);
  const famName=id=>{const f=families.find(x=>x.id===id);return f?f.name:null;};
  const toISO=dt=>`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
  const ackMap={}; (acks||[]).forEach(a=>{if(a&&a.itemKey)ackMap[a.itemKey]=a;});
  const items=[];
  const pushOnce=(dateStr,label,type,familyId,entityId)=>{
    if(!dateStr)return; const t=new Date(dateStr); if(isNaN(t.getTime()))return;
    const t0=new Date(t.getFullYear(),t.getMonth(),t.getDate());
    const days=Math.round((t0-today)/86400000);
    if(days>windowDays)return;
    const dateISO=toISO(t0); const key=`${type}:${entityId}:${dateISO}`;
    const ack=ackMap[key];
    items.push({key,dateISO,days,label,type,familyName:famName(familyId),overdue:!ack&&days<0,done:!!ack,completedBy:ack?ack.completedBy:null,completedAt:ack?ack.completedAt:null,familyId,occurrenceDate:dateISO});
  };
  const pushAnnual=(dateStr,label,type,familyId,entityId)=>{
    if(!dateStr)return; const t=new Date(dateStr); if(isNaN(t.getTime()))return;
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
    const dt=new Date(t.dueDate); if(isNaN(dt.getTime()))return;
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
  const famName=id=>(families.find(f=>f.id===id)?.name||"").replace(" [DEMO]","");

  const load=async()=>{
    // RLS already limits this to the caller's own families, so no client-side
    // filtering is needed — and none should be relied on.
    //
    // No plan filter either, and that is not an oversight. Core households cannot hold workflow
    // instances (the trigger refuses the insert) and a household holding instances cannot be moved
    // to Core (the downgrade trigger refuses that too), so no step reaching this query can belong
    // to a Core family. Filtering here would need an extra instance -> family lookup that could
    // never remove a row. See the note at the foot of src/plans.js.
    const{data}=await sb.from("workflow_instance_steps")
      .select("*")
      // 'approved' belongs here: approving no longer means sent, so an approved
      // draft still needs someone to send it. Omitting it would make the step
      // vanish from the queue while the work was still outstanding.
      .in("status",["ready","awaiting_approval","approved","blocked"])
      .order("due_on")
      .limit(40);
    setRows(data||[]);
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

function Dashboard({data,userProfile,reload,toast,onOpenFamily}){
  const isMobile=useIsMobile();
  const{families:_families,contacts:_contacts,properties:_properties,deals:_deals,notes:_notes,tasks:_tasks,portfolio_accounts:_accts=[]}=data;
  const isAdmin=userProfile?.role==="admin";
  const myEmail=(userProfile?.email||"").toLowerCase();
  // Admins default to "All Ordanis Experts" and can switch; non-admins are locked to their own scope so unscoped prospect records (family_id null) don't leak in.
  const[scope,setScope]=useState(isAdmin?"":myEmail);
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
  const totalDebt=properties.reduce((s,p)=>s+(Number(p.loanBalance)||0)+(Number(p.secondMortgageBalance)||0),0)+portfolio_accounts.filter(a=>a.accountType==="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const totalPortfolio=portfolio_accounts.filter(a=>a.accountType!=="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const pending=tasks.filter(t=>!t.done);
  const overdue=pending.filter(t=>t.dueDate&&new Date(t.dueDate)<new Date());
  const dueSoon=pending.filter(t=>t.dueDate&&!overdue.includes(t)&&(new Date(t.dueDate)-new Date())/(86400000)<=30);
  const _famIdSet=new Set(families.map(f=>f.id));
  const deadlineContacts=(_contacts||[]).filter(c=>!scope||_famIdSet.has(c.familyId)||(c.advisorEmail||"").toLowerCase()===scope);
  const _acks=data.deadline_acks||[];
  const deadlines=collectDeadlines({tasks,properties,deals,contacts:deadlineContacts,families,acks:_acks,windowDays:60});
  const bills=collectBills({events:(data.cash_flow_events||[]).filter(e=>!scope||_famIdSet.has(e.familyId)),families,paymentLog:data.cash_flow_payment_log||[],windowDays:45});
  const billsTotal=bills.reduce((s,b)=>s+b.amount,0);
  const userLabel=(userProfile&&(userProfile.fullName||userProfile.email))||"";
  const completeDeadline=async d=>{
    try{
      if(d.isTask&&d.task){
        const t=d.task;
        const{error}=await sb.from("tasks").update({done:true,completed_at:new Date().toISOString(),completed_by:userLabel||null}).eq("id",t.id);
        if(error)throw error;
        if(t.recurrence){const nd=nextRecurrence(t.dueDate,t.recurrence,t.recurrenceInterval,t.recurrenceUnit);if(nd){await sb.from("tasks").insert({family_id:t.familyId||null,contact_id:t.contactId||null,title:t.title,due_date:nd,priority:t.priority,reminder_days:t.reminderDays||7,done:false,recurrence:t.recurrence,recurrence_interval:t.recurrence==="Custom"?(t.recurrenceInterval||1):null,recurrence_unit:t.recurrence==="Custom"?(t.recurrenceUnit||"week"):null});}}
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
  const gf=id=>families.find(f=>f.id===id);
  const hr=new Date().getHours();

  return <div style={{overflowY:"auto",height:"100%",padding:isMobile?"18px 14px 32px":"26px 30px 48px"}}>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:isMobile?16:24}}>
      <div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?22:28,color:B.navy,fontWeight:600,marginBottom:4}}>Good {hr<12?"Morning":hr<17?"Afternoon":"Evening"}</div>
        <div style={{color:B.textSoft,fontSize:isMobile?12:14}}>{BRAND.name} — Portfolio & Client Overview{isAdmin&&scope?" · filtered by Ordanis Expert":""}</div>
        <div style={{height:2,width:56,background:B.gold,marginTop:10,borderRadius:2}}/>
      </div>
      <AdvisorScopeBar userProfile={userProfile} value={scope} onChange={setScope}/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(140px,100%),1fr))",gap:14,marginBottom:24}}>
      {[{label:"Families",value:families.length,sub:`${contacts.length} contacts`,accent:B.navy},{label:"Real Estate",value:fmtMoney(totalRE),sub:`${properties.length} properties`,accent:B.gold},{label:"Portfolio",value:fmtMoney(totalPortfolio),sub:`${portfolio_accounts.length} accounts`,accent:B.navyMid},{label:"Open Tasks",value:pending.length,sub:overdue.length>0?`${overdue.length} overdue`:dueSoon.length>0?`${dueSoon.length} due soon`:"All on track",accent:overdue.length>0?"#d43030":dueSoon.length>0?"#d4900a":B.navyMid}].map(s=><div key={s.label} style={{background:B.bgCard,borderRadius:12,padding:"20px 22px",border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,borderTop:`3px solid ${s.accent}`}}>
        <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>{s.label}</div>
        <div style={{fontSize:26,fontFamily:"'Cormorant Garamond',serif",color:B.navy,fontWeight:600,lineHeight:1}}>{s.value}</div>
        <div style={{fontSize:11,color:B.textSoft,marginTop:5}}>{s.sub}</div>
      </div>)}
    </div>
    <ReviewQueue families={families} toast={toast} userProfile={userProfile}/>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(280px,100%),1fr))",gap:18,marginBottom:18}}>
      {/* PIPELINE_CARD_REMOVED — the deal pipeline card was admin-only, so the
          dashboard showed a prospecting CRM to admins and not to anyone else.
          Ordanis does not sell pipeline management. */}
      {bills.length>0&&<div style={{background:B.bgCard,borderRadius:12,padding:24,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,marginBottom:18}}>
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
      <div style={{background:B.bgCard,borderRadius:12,padding:24,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600,marginBottom:4}}>Upcoming Deadlines</div>
        <GoldLine/>
        {deadlines.length===0&&<Empty text="No upcoming deadlines."/>}
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
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(280px,100%),1fr))",gap:18}}>
      <div style={{background:B.bgCard,borderRadius:12,padding:24,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
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
      </div>
      <div style={{background:B.bgCard,borderRadius:12,padding:24,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600,marginBottom:4}}>Recent Notes</div>
        <GoldLine/>
        {[...notes].sort((a,b)=>b.createdAt>a.createdAt?1:-1).slice(0,4).map(n=>{const fam=gf(n.familyId);const goN=()=>{if(onOpenFamily&&n.familyId)onOpenFamily(n.familyId,"notes");};
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
        {notes.length===0&&<Empty text="No notes yet."/>}
      </div>
    </div>
  </div>;
}

// ── USER MANAGEMENT ───────────────────────────────────────────────────────────
function UserManagementView({userProfile,data={},toast}){
  const families=data.families||[];
  const[users,setUsers]=useState([]);
  const[loading,setLoading]=useState(true);
  const[modal,setModal]=useState(null);
  const[familyFilter,setFamilyFilter]=useState(""); // narrows the grouped lists below to users linked to one family
  // Partner-to-family links (many-to-many, via family_partners junction table)
  const[familyPartners,setFamilyPartners]=useState([]);
  // New user form state
  const[newEmail,setNewEmail]=useState("");
  const[newName,setNewName]=useState("");
  const[newRole,setNewRole]=useState("advisor");
  const[newFamily,setNewFamily]=useState("");
  const[newPartnerFamilies,setNewPartnerFamilies]=useState([]); // family ids, role="partner" only
  const[newCanRunPrompts,setNewCanRunPrompts]=useState(false); // role="partner" only — Scheduled Prompts access
  const[newPassword,setNewPassword]=useState("");
  const[creating,setCreating]=useState(false);
  const[created,setCreated]=useState(null);

  const loadUsers=async()=>{
    const{data:rows}=await sb.from("user_profiles").select("*").order("created_at",{ascending:false});
    if(rows)setUsers(rows);
    setLoading(false);
  };
  const loadFamilyPartners=async()=>{
    const{data:rows}=await sb.from("family_partners").select("*");
    if(rows)setFamilyPartners(rows);
  };
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
  useEffect(()=>{loadUsers();loadFamilyPartners();loadPlatformCfg();},[]);

  const toggleActive=async u=>{
    const{error}=await sb.from("user_profiles").update({active:!u.active}).eq("id",u.id);
    if(error)toast(error.message,"error");else{toast(u.active?"Deactivated":"Activated");loadUsers();}
  };
  const changeRole=async(u,role)=>{
    const{error}=await sb.from("user_profiles").update({role}).eq("id",u.id);
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
  // The Ordanis Expert on the family record runs administration and is deliberately
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
  // Prompts. Not all Partners should have this — off by default. Ordanis Experts
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
    if(newPassword.length<8)return toast("Password must be at least 8 characters","error");
    setCreating(true);
    // Sign up the new user
    const{data:authData,error:authError}=await sb.auth.signUp({
      email:newEmail.trim(),
      password:newPassword,
      options:{data:{full_name:newName,role:newRole}}
    });
    if(authError){setCreating(false);return toast(authError.message,"error");}
    // Insert/update their profile with role and family
    const userId=authData?.user?.id;
    if(userId){
      await sb.from("user_profiles").upsert({
        id:userId,
        email:newEmail.trim(),
        full_name:newName||newEmail.trim(),
        role:newRole,
        family_id:newRole==="client"?(newFamily||null):null,
        active:true,
        can_run_scheduled_prompts:newRole==="partner"?newCanRunPrompts:false,
      });
      if(newRole==="partner"&&newPartnerFamilies.length>0){
        await sb.from("family_partners").insert(newPartnerFamilies.map(fid=>({user_id:userId,family_id:fid})));
      }
    }
    setCreating(false);
    setCreated({email:newEmail,role:newRole,password:newPassword});
    setNewEmail("");setNewName("");setNewRole("advisor");setNewFamily("");setNewPartnerFamilies([]);setNewCanRunPrompts(false);setNewPassword("");
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
  const openSetPassword=u=>{ setPwUser(u); setTempPassword(Math.random().toString(36).slice(2,10)+"Aa1!"); setPwErr(null); setPwDone(false); };
  const setTempPasswordNow=async()=>{
    if(!pwUser||tempPassword.length<8)return setPwErr("Password must be at least 8 characters.");
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
          <Sel value={familyFilter} onChange={e=>setFamilyFilter(e.target.value)} style={{minWidth:180}}>
            <option value="">All Families</option>
            {families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
          </Sel>
          <Btn onClick={()=>setModal("create")}>+ Add User</Btn>
        </div>
      </div>

      {/* Users grouped by access level: Admin · Ordanis Expert (role="advisor" internally) · Partner · Client */}
      {loading?<Spinner/>:(()=>{
        const HEADERS=["Name","Email","Role","Family (clients)","Status","Actions"];
        const COLS="1.2fr 1.4fr 130px 1fr 110px 130px";
        const renderRow=u=>{
          const pFamilyIds=partnerFamilyIdsFor(u.id);
          return (
          <div key={u.id} style={{display:"grid",gridTemplateColumns:COLS,padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,alignItems:"center",gap:8,opacity:u.active?1:0.6}}>
            <div>
              <div style={{fontWeight:700,color:B.navy,fontSize:13}}>{u.full_name||"—"}</div>
              {u.id===userProfile?.id&&<div style={{fontSize:10,color:B.gold,fontWeight:700}}>You</div>}
            </div>
            <div style={{fontSize:12,color:B.textMid,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
            <div>
              {u.id===userProfile?.id
                ?<Badge scheme={{bg:"#e8f0f8",text:B.navyMid,dot:B.navyMid}}>{roleLabel(u.role)}</Badge>
                :<select value={u.role||"advisor"} onChange={e=>changeRole(u,e.target.value)} style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:6,padding:"4px 8px",fontSize:12,color:B.text,outline:"none",fontFamily:"inherit",cursor:"pointer",width:"100%"}}>
                  <option value="admin">Admin</option>
                  <option value="advisor">Ordanis Expert</option>
                  <option value="partner">Partner</option>
                  <option value="client">Client</option>
                </select>}
            </div>
            <div>
              {u.role==="client"
                ?<select value={u.family_id||""} onChange={e=>assignFamily(u,e.target.value)} style={{background:B.bg,border:`1px solid ${B.border}`,borderRadius:6,padding:"4px 8px",fontSize:11,color:B.text,outline:"none",fontFamily:"inherit",cursor:"pointer",width:"100%"}}>
                  <option value="">— Assign Family —</option>
                  {families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
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
              </>}
            </div>
          </div>
          );
        };
        const renderSection=(label,accent,desc,list,key)=>(
          <div key={key} style={{background:B.white,borderRadius:12,border:`1px solid ${B.borderLight}`,boxShadow:B.shadow,overflow:"hidden",marginBottom:18}}>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 20px",borderBottom:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${accent}`,flexWrap:"wrap"}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:700}}>{label}</div>
              <div style={{background:accent,color:B.white,borderRadius:20,minWidth:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,padding:"0 7px"}}>{list.length}</div>
              <div style={{fontSize:11,color:B.textMute,marginLeft:4}}>{desc}</div>
            </div>
            {list.length>0?<>
              <div style={{display:"grid",gridTemplateColumns:COLS,padding:"10px 20px",background:B.bg,borderBottom:`1px solid ${B.borderLight}`,gap:8}}>
                {HEADERS.map(h=><div key={h} style={{fontSize:10,fontWeight:800,color:B.textMute,letterSpacing:"0.08em",textTransform:"uppercase"}}>{h}</div>)}
              </div>
              {list.map(renderRow)}
            </>:<div style={{padding:"16px 20px",color:B.textMute,fontSize:13}}>No {label.toLowerCase()} in this group yet.</div>}
          </div>
        );
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
          {key:"advisor",label:"Ordanis Experts",accent:B.gold,desc:"Scoped to their assigned families and prospects"},
          {key:"partner",label:"Partners",accent:"#7a8fa6",desc:"View-only across linked families; can upload & download documents"},
          {key:"client",label:"Clients",accent:B.navyMid,desc:"Read-only portal access to their own family"},
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
          return role==="admin"; // admins have access to every family regardless of filter
        };
        const others=users.filter(u=>!known.includes(roleOf(u)));
        return <div style={{marginBottom:24}}>
          {LICENCE_PANEL}
          {GROUPS.map(g=>renderSection(g.label,g.accent,g.desc,users.filter(u=>roleOf(u)===g.key&&linkedToFamily(u)),g.key))}
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
              <Field label="Email Address"><Inp type="email" placeholder="jane@email.com" value={newEmail} onChange={e=>setNewEmail(e.target.value)}/></Field>
            </Grid2>
            <Field label="Temporary Password">
              <div style={{display:"flex",gap:8}}>
                <Inp placeholder="Min 8 characters" value={newPassword} onChange={e=>setNewPassword(e.target.value)} style={{flex:1}}/>
                <Btn variant="ghost" onClick={()=>setNewPassword(Math.random().toString(36).slice(2,10)+"Aa1!")}>Generate</Btn>
              </div>
            </Field>
            <Grid2>
              <Field label="Role">
                <Sel value={newRole} onChange={e=>setNewRole(e.target.value)}>
                  <option value="advisor">Ordanis Expert — sees assigned families</option>
                  <option value="partner">Partner — view-only, upload/download docs only</option>
                  <option value="admin">Admin — sees everything</option>
                  <option value="client">Client — read-only portal</option>
                </Sel>
              </Field>
              {newRole==="client"&&<Field label="Assign to Family">
                <Sel value={newFamily} onChange={e=>setNewFamily(e.target.value)}>
                  <option value="">— Select family —</option>
                  {families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
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
                    {f.name}
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
              <div style={{fontSize:11,color:B.textMute,marginTop:4}}>Off by default — most Partners shouldn't have this. Ordanis Experts and Admins already can, and always see every Partner's scheduled prompts for their families.</div>
            </Field>}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={createUser} disabled={creating||!newEmail||!newPassword}>{creating?"Creating…":"Create User"}</Btn>
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
                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
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
                <Inp placeholder="Min 8 characters" value={tempPassword} onChange={e=>setTempPassword(e.target.value)} style={{flex:1}}/>
                <Btn variant="ghost" onClick={()=>setTempPassword(Math.random().toString(36).slice(2,10)+"Aa1!")}>Generate</Btn>
              </div>
            </Field>
            {pwErr&&<div style={{background:"#fde8e8",border:"1px solid #f5c6c6",color:"#8b1a1a",borderRadius:8,padding:"9px 12px",fontSize:12,marginBottom:12}}>⚠ {pwErr}</div>}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
              <Btn variant="ghost" onClick={()=>setPwUser(null)}>Cancel</Btn>
              <Btn onClick={setTempPasswordNow} disabled={settingPw||tempPassword.length<8}>{settingPw?"Setting…":"Set Password"}</Btn>
            </div>
          </div>
        )}
      </Modal>}
    </div>
  </div>;
}

// ── DOCUMENTS VIEW ────────────────────────────────────────────────────────────
const DOC_CATEGORIES = ["General","Tax","Legal","Insurance","Investment","Real Estate","Estate Planning","Other"];
// A document may be pinned to one specific section of a property (or to the
// family's valuables schedule), which is what makes the supporting-document
// links appear next to the figures on the property and valuables cards.
// `suggestCategory` pre-selects a sensible Vault folder when a section is chosen
// so the user isn't asked the same thing twice.
const DOC_SECTIONS=[
  {key:"mortgage",          label:"Mortgage / Loan Document", scope:"property", suggestCategory:"Real Estate"},
  {key:"tax",               label:"Property Tax Bill",        scope:"property", suggestCategory:"Tax"},
  {key:"insurance_dec",     label:"Insurance Declarations",   scope:"property", suggestCategory:"Insurance"},
  {key:"insurance_invoice", label:"Insurance Invoice",        scope:"property", suggestCategory:"Insurance"},
  {key:"flood_dec",         label:"Flood Declarations",       scope:"property", suggestCategory:"Insurance"},
  {key:"rental",            label:"Rental Agreement",         scope:"property", suggestCategory:"Real Estate"},
  {key:"valuables_schedule",label:"Valuables Schedule",       scope:"family",   suggestCategory:"Insurance"},
];
const sectionLabel=k=>DOC_SECTIONS.find(s=>s.key===k)?.label||k;

// Loads pdf.js from CDN once (no build dependency). Used to extract PDF text
// directly in the browser — no size, page, or server-timeout limit.
let _pdfjsPromise=null;
function loadPdfJs(){
  if(typeof window!=="undefined"&&window.pdfjsLib)return Promise.resolve(window.pdfjsLib);
  if(_pdfjsPromise)return _pdfjsPromise;
  _pdfjsPromise=new Promise((resolve,reject)=>{
    try{
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload=()=>{
        if(window.pdfjsLib){
          try{ window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; }catch(_e){}
          resolve(window.pdfjsLib);
        } else reject(new Error("pdf.js unavailable"));
      };
      s.onerror=()=>reject(new Error("pdf.js failed to load"));
      document.head.appendChild(s);
    }catch(e){reject(e);}
  });
  return _pdfjsPromise;
}
// Extract embedded text from a PDF in the browser. Returns "" for scanned/image
// PDFs (no text layer) so callers fall back to the vision extractor.
async function extractPdfText(arrayBuffer){
  const pdfjs=await loadPdfJs();
  const pdf=await pdfjs.getDocument({data:arrayBuffer}).promise;
  const maxPages=Math.min(pdf.numPages,400);
  let out="";
  for(let i=1;i<=maxPages;i++){
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    out+=content.items.map(it=>it.str).join(" ")+"\n";
    if(out.length>200000){ out=out.slice(0,200000)+"\n…[truncated]"; break; }
  }
  return out.trim();
}

// Scanned/image PDFs have no text layer. Render each page to an image in the
// browser and send them to the vision extractor in small batches, so no single
// request is large enough to time out. Handles long documents (e.g. trusts).
const SCANNED_PAGE_CAP=150;   // max pages we vision-scan per document
const SCAN_BATCH=4;           // pages per request
async function extractScannedPdfText(arrayBuffer,onProgress){
  const pdfjs=await loadPdfJs();
  const pdf=await pdfjs.getDocument({data:arrayBuffer}).promise;
  const total=Math.min(pdf.numPages,SCANNED_PAGE_CAP);
  const renderPage=async i=>{
    const page=await pdf.getPage(i);
    const viewport=page.getViewport({scale:1.6});
    const canvas=document.createElement("canvas");
    canvas.width=viewport.width; canvas.height=viewport.height;
    const ctx=canvas.getContext("2d");
    await page.render({canvasContext:ctx,viewport}).promise;
    const dataUrl=canvas.toDataURL("image/jpeg",0.8);
    canvas.width=0; canvas.height=0; // free memory
    return dataUrl.split(",")[1];
  };
  let combined="";
  for(let start=1;start<=total;start+=SCAN_BATCH){
    const end=Math.min(start+SCAN_BATCH-1,total);
    if(onProgress)onProgress(start,total);
    const images=[];
    for(let p=start;p<=end;p++){ images.push({data:await renderPage(p),mediaType:"image/jpeg"}); }
    const{data:exResp,error:exErr}=await sb.functions.invoke("extract-document-text",{body:{images}});
    if(exErr)throw new Error(exErr.message||"Scan failed");
    if(exResp&&exResp.error)throw new Error(exResp.detail||exResp.error);
    if(exResp&&exResp.text)combined+=(combined?"\n":"")+exResp.text;
    if(combined.length>400000){ combined=combined.slice(0,400000)+"\n…[truncated]"; break; }
  }
  const truncated=pdf.numPages>SCANNED_PAGE_CAP;
  return { text:combined.trim(), pagesScanned:total, totalPages:pdf.numPages, truncated };
}

function DocumentsView({familyId,readOnly=false,canUpload,canDelete,canScan,canEditMetadata,toast,reload,attachIntent,onAttachHandled}){
  // Backward compat: if readOnly passed, default canUpload=false canDelete=false
  // If canUpload/canDelete passed explicitly, use those
  const allowUpload=canUpload!==undefined?canUpload:!readOnly;
  const allowDelete=canDelete!==undefined?canDelete:!readOnly;
  const allowScan=canScan!==undefined?canScan:allowUpload; // scanning is advisor-side only
  const allowEditMeta=canEditMetadata!==undefined?canEditMetadata:allowUpload; // renaming/re-categorizing docs; partner gets upload but not this
  const[docs,setDocs]=useState([]);
  const[downloads,setDownloads]=useState([]); // document_downloads log rows, newest first
  const[loading,setLoading]=useState(true);
  const[uploading,setUploading]=useState(false);
  const[modal,setModal]=useState(null);
  const[openFolder,setOpenFolder]=useState(null); // null = folder list; else a folder name
  // Folders this household has added, beyond the built-in eight. Per household by design,
  // so one client's taxonomy never shows up on another's Vault.
  const[customFolders,setCustomFolders]=useState([]);
  const[newFolderName,setNewFolderName]=useState("");
  const[folderErr,setFolderErr]=useState("");
  const[savingFolder,setSavingFolder]=useState(false);
  const loadFolders=useCallback(async()=>{
    if(!familyId){setCustomFolders([]);return;}
    const{data,error}=await sb.from("document_folders")
      .select("id,name,sort_order").eq("family_id",familyId).order("name");
    // A failure here must not blank the Vault — the built-in folders still work, so fall
    // back to just those rather than throwing away the whole page.
    setCustomFolders(error?[]:(data||[]));
  },[familyId]);
  useEffect(()=>{loadFolders();},[loadFolders]);

  const createFolder=async()=>{
    const v=validateFolderName(newFolderName,customFolders.map(f=>f.name));
    if(!v.ok){setFolderErr(v.reason);return;}
    setSavingFolder(true);
    const{error}=await sb.from("document_folders").insert({family_id:familyId,name:v.name});
    setSavingFolder(false);
    if(error){
      // The unique index and the built-in check also live in the database, because the UI is
      // not the only writer. Translate rather than surfacing a Postgres message.
      setFolderErr(/duplicate key/i.test(error.message)?`${v.name} already exists.`
        :/not_builtin/i.test(error.message)?`${v.name} already exists as a standard folder.`
        :error.message);
      return;
    }
    setModal(null);
    await loadFolders();
    toast(`Folder "${v.name}" added`);
  };

  const removeFolder=async row=>{
    const gate=canDeleteFolder(row);
    if(!gate.ok){toast(gate.reason,"error");return;}
    const f=customFolders.find(x=>x.name===row.name);
    if(!f)return;
    const{error}=await sb.from("document_folders").delete().eq("id",f.id);
    if(error){toast(error.message,"error");return;}
    if(openFolder===row.name)setOpenFolder(null);
    await loadFolders();
    toast(`Folder "${row.name}" removed`);
  };
  const[name,setName]=useState("");
  const[description,setDescription]=useState("");
  const[category,setCategory]=useState("General");
  const[file,setFile]=useState(null);
  const[uploadPhase,setUploadPhase]=useState("");
  // Optional link to a property section / valuables schedule.
  const[linkPropertyId,setLinkPropertyId]=useState("");
  const[linkSection,setLinkSection]=useState("");
  const[properties,setProperties]=useState([]);
  // Set when the chosen section already has a document, so we ask before
  // displacing it rather than silently swapping what the client sees.
  const[conflictDoc,setConflictDoc]=useState(null);

  const loadDocs=async()=>{
    const q=sb.from("documents").select("*").order("created_at",{ascending:false});
    if(familyId) q.eq("family_id",familyId);
    const dq=sb.from("document_downloads").select("*").order("downloaded_at",{ascending:false});
    if(familyId) dq.eq("family_id",familyId);
    const[{data},{data:dlData}]=await Promise.all([q,dq]);
    if(data)setDocs(data.map(toClient));
    if(dlData)setDownloads(dlData.map(toClient));
    setLoading(false);
  };
  useEffect(()=>{loadDocs();},[familyId]);
  // Property list for the link picker. Only meaningful within one family.
  useEffect(()=>{
    if(!familyId){setProperties([]);return;}
    sb.from("properties").select("id,name,address,city").eq("family_id",familyId)
      .then(({data})=>setProperties((data||[]).map(toClient)));
  },[familyId]);

  // Arriving from the paperclip on a property section: open the upload form with
  // the property and section already chosen.
  useEffect(()=>{
    if(!attachIntent)return;
    const sec=DOC_SECTIONS.find(x=>x.key===attachIntent.section);
    setLinkSection(attachIntent.section||"");
    setLinkPropertyId(sec&&sec.scope==="property"?(attachIntent.propertyId||""):"");
    if(sec&&sec.suggestCategory)setCategory(sec.suggestCategory);
    setOpenFolder(null);
    setModal("upload");
    if(onAttachHandled)onAttachHandled();
  },[attachIntent]);

  const propLabel=p=>p.name||[p.address,p.city].filter(Boolean).join(", ")||"Property";
  // The document currently occupying a given section, ignoring the one being edited.
  const occupantOf=(section,propertyId,exceptId)=>docs.find(d=>
    d.propertySection===section&&
    (section==="valuables_schedule"?true:d.propertyId===propertyId)&&
    d.id!==exceptId);
  // Selecting a section implies a Vault folder; only pre-fill it if the user
  // hasn't deliberately chosen one already.
  const chooseSection=(key,touchedCategory)=>{
    setLinkSection(key);
    const s=DOC_SECTIONS.find(x=>x.key===key);
    if(s&&s.suggestCategory&&!touchedCategory)setCategory(s.suggestCategory);
    if(s&&s.scope==="family")setLinkPropertyId("");
  };
  const resetForm=()=>{
    setName("");setDescription("");setCategory("General");setFile(null);
    setLinkPropertyId("");setLinkSection("");setConflictDoc(null);
  };
  // Most recent download of a given document, if any (downloads is pre-sorted newest first).
  const lastDownloadFor=docId=>downloads.find(d=>d.documentId===docId)||null;

  const upload=async()=>{
    if(!file||!name.trim())return;
    setUploading(true);
    try{
      // Upload file to Supabase storage
      const ext=file.name.split(".").pop();
      const path=`${familyId||"general"}/${Date.now()}_${file.name.replace(/\s+/g,"_")}`;
      setUploadPhase("Uploading…");
      const{error:uploadError}=await sb.storage.from("documents").upload(path,file,{upsert:false});
      if(uploadError)throw new Error(uploadError.message);
      // Extract text so the family's AI assistant can answer from this document's
      // contents. PDFs and images only; other types are stored without text.
      // Non-fatal: if extraction fails, the document still uploads.
      let extractedText=null;
      const mt=file.type==="image/jpg"?"image/jpeg":file.type;
      if(allowScan&&mt==="application/pdf"){
        // Fast, unlimited browser text extraction first; batched vision scan
        // only for scanned PDFs that have no embedded text.
        try{
          setUploadPhase("Reading document…");
          const buf=await file.arrayBuffer();
          const t=await extractPdfText(buf);
          if(t&&t.length>=20)extractedText=t;
        }catch(_e){/* fall through to vision */}
        if(!extractedText){
          try{
            const buf2=await file.arrayBuffer();
            const r=await extractScannedPdfText(buf2,(p,tot)=>setUploadPhase(`Scanning page ${p} of ${tot}…`));
            if(r&&r.text)extractedText=r.text;
          }catch(_e){}
        }
      } else if(allowScan&&["image/png","image/jpeg","image/webp"].includes(mt)){
        try{
          setUploadPhase("Scanning for AI assistant…");
          const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(",")[1]);r.onerror=()=>rej(new Error("read failed"));r.readAsDataURL(file);});
          const{data:exResp,error:exErr}=await sb.functions.invoke("extract-document-text",{body:{fileBase64:b64,mediaType:mt}});
          if(!exErr&&exResp&&exResp.text)extractedText=exResp.text;
        }catch(_e){}
      }
      // Save record
      setUploadPhase("Saving…");
      // Displacing an existing section document: unlink it rather than delete it.
      // Prior-year tax bills and expired policies still have real value, so they
      // stay in the Vault — they just stop being the one shown on the card.
      const section=linkSection||null;
      const propId=section&&DOC_SECTIONS.find(s=>s.key===section)?.scope==="property"?(linkPropertyId||null):null;
      let displaced=null;
      if(section){
        const occ=occupantOf(section,propId);
        if(occ){
          await sb.from("documents").update({property_section:null}).eq("id",occ.id);
          displaced=occ.name;
        }
      }
      const{error:dbError}=await sb.from("documents").insert({family_id:familyId||null,name,description:description||null,category,file_path:path,file_size:file.size,file_type:file.type||ext,extracted_text:extractedText,uploaded_by:CURRENT_USER_LABEL||null,property_id:propId,property_section:section});
      if(dbError)throw new Error(dbError.message);
      toast(displaced
        ?`Uploaded and linked. "${displaced}" is still in the Vault, no longer linked.`
        :(section?`Uploaded and linked to ${sectionLabel(section)}`:(extractedText?"Document uploaded and scanned":"Document uploaded")));
      setModal(null);resetForm();
      loadDocs();
      if(reload)reload("documents"); // refresh global data so the AI assistant snapshot includes this document
    }catch(e){toast(e.message,"error");}
    setUploadPhase("");
    setUploading(false);
  };

  const download=async(doc)=>{
    try{
      const{data,error}=await sb.storage.from("documents").createSignedUrl(doc.filePath,300,{download:doc.name||true});
      if(error||!data?.signedUrl){toast("Could not get download link","error");return;}
      // Use anchor element to bypass popup blockers
      const a=document.createElement("a");
      a.href=data.signedUrl;
      a.download=doc.name||"document";
      a.target="_blank";
      a.rel="noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Log the download (append-only table, not a column on documents) so "Last
      // Downloaded"/"Downloaded By" stay accurate for every role -- including
      // partner, who has no UPDATE access on the documents row itself.
      const{error:logErr}=await sb.from("document_downloads").insert({document_id:doc.id,family_id:familyId||null,downloaded_by:CURRENT_USER_LABEL||null});
      if(!logErr)loadDocs();
    }catch(e){toast("Download failed: "+e.message,"error");}
  };

  const del=async(doc)=>{
    await sb.storage.from("documents").remove([doc.filePath]);
    await sb.from("documents").delete().eq("id",doc.id);
    toast("Document deleted");loadDocs();
    if(reload)reload("documents");
  };

  const openEdit=doc=>{setName(doc.name||"");setDescription(doc.description||"");setCategory(doc.category||"General");setLinkSection(doc.propertySection||"");setLinkPropertyId(doc.propertyId||"");setConflictDoc(null);setModal({edit:doc});};
  const saveEdit=async()=>{
    const doc=modal?.edit;if(!doc||!name.trim())return;
    setUploading(true);
    const section=linkSection||null;
    const propId=section&&DOC_SECTIONS.find(s=>s.key===section)?.scope==="property"?(linkPropertyId||null):null;
    // Same rule as upload: the document being displaced is unlinked, never
    // deleted, so history stays in the Vault.
    let displaced=null;
    if(section){
      const occ=occupantOf(section,propId,doc.id);
      if(occ){
        await sb.from("documents").update({property_section:null}).eq("id",occ.id);
        displaced=occ.name;
      }
    }
    const{error}=await sb.from("documents").update({name:name.trim(),description:description||null,category,property_id:propId,property_section:section}).eq("id",doc.id);
    if(error){toast(error.message,"error");setUploading(false);return;}
    toast(displaced?`Saved. "${displaced}" is still in the Vault, no longer linked.`:"Document updated");
    setModal(null);resetForm();
    loadDocs();setUploading(false);
    if(reload)reload("documents"); // property cards read links from global data
  };

  // Shared by the upload and edit forms: optionally pin this document to one
  // section of a property (or the family's valuables schedule) so it surfaces
  // next to the figure it supports, instead of only living in the Vault.
  const linkFields=(exceptId)=>{
    if(!familyId)return null;
    const sec=DOC_SECTIONS.find(s=>s.key===linkSection);
    const needsProperty=sec&&sec.scope==="property";
    const occ=linkSection&&(!needsProperty||linkPropertyId)?occupantOf(linkSection,needsProperty?linkPropertyId:null,exceptId):null;
    return <>
      <SectionLabel>Link to a record (optional)</SectionLabel>
      <Grid2>
        <Field label="Section">
          <Sel value={linkSection} onChange={e=>chooseSection(e.target.value,category!=="General")}>
            <option value="">Not linked — Vault only</option>
            {DOC_SECTIONS.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
          </Sel>
        </Field>
        {needsProperty&&<Field label="Property">
          <Sel value={linkPropertyId} onChange={e=>setLinkPropertyId(e.target.value)}>
            <option value="">Select a property…</option>
            {properties.map(p=><option key={p.id} value={p.id}>{propLabel(p)}</option>)}
          </Sel>
        </Field>}
      </Grid2>
      {needsProperty&&linkSection&&!linkPropertyId&&
        <div style={{fontSize:11.5,color:"#8b1a1a",marginTop:-6,marginBottom:12}}>Choose a property to complete the link.</div>}
      {occ&&<div style={{fontSize:11.5,color:B.navy,background:"rgba(206,182,132,0.16)",border:`1px solid ${B.gold}`,borderRadius:8,padding:"9px 12px",marginBottom:12,lineHeight:1.5}}>
        <strong>{sectionLabel(linkSection)}</strong> is already linked to “{occ.name}”. Saving will make this document the linked one — “{occ.name}” stays in the Vault, just unlinked.
      </div>}
      {linkSection&&!occ&&<div style={{fontSize:11.5,color:B.textSoft,marginBottom:12,lineHeight:1.5}}>
        This will appear as the supporting document next to {sectionLabel(linkSection)}.
      </div>}
    </>;
  };

  const fmtSize=bytes=>{if(!bytes)return"—";if(bytes<1024)return bytes+"B";if(bytes<1024*1024)return(bytes/1024).toFixed(1)+"KB";return(bytes/(1024*1024)).toFixed(1)+"MB";};
  const fileLabel=(type,name)=>{const t=(type||"").toLowerCase();const ext=(name||"").split(".").pop().toLowerCase();if(t.includes("pdf")||ext==="pdf")return"PDF";if(t.includes("image")||["png","jpg","jpeg","gif","webp","svg","heic","bmp","tiff"].includes(ext))return"IMAGE";if(t.includes("word")||["doc","docx"].includes(ext))return"WORD";if(t.includes("sheet")||t.includes("excel")||["xls","xlsx","csv"].includes(ext))return"EXCEL";if(t.includes("presentation")||["ppt","pptx","key"].includes(ext))return"SLIDES";if(["zip","rar","7z","gz"].includes(ext))return"ARCHIVE";if(["txt","rtf","md"].includes(ext))return"TEXT";return ext&&ext.length<=4?ext.toUpperCase():"FILE";};

  const[scanningId,setScanningId]=useState(null);
  const[bulkScan,setBulkScan]=useState(null); // {done,total} | null
  // Map a stored document to a media type the extractor supports (PDF/images).
  const guessMedia=doc=>{
    const ft=(doc.fileType||"").toLowerCase();
    if(ft.includes("pdf"))return "application/pdf";
    if(ft.includes("png"))return "image/png";
    if(ft.includes("webp"))return "image/webp";
    if(ft.includes("jpeg")||ft.includes("jpg"))return "image/jpeg";
    const p=(doc.filePath||"").toLowerCase();
    if(p.endsWith(".pdf"))return "application/pdf";
    if(p.endsWith(".png"))return "image/png";
    if(p.endsWith(".webp"))return "image/webp";
    if(p.endsWith(".jpg")||p.endsWith(".jpeg"))return "image/jpeg";
    return null;
  };
  const needsScan=doc=>!!guessMedia(doc)&&!((doc.extractedText||"").trim());
  // Backfill: scan an EXISTING document in place — download it, extract text,
  // and store it on the same row. No re-upload, no duplicate.
  const scanExisting=async (doc,onProgress)=>{
    const mt=guessMedia(doc);
    if(!mt)return false;
    const{data:signed,error:sErr}=await sb.storage.from("documents").createSignedUrl(doc.filePath,300);
    if(sErr||!signed?.signedUrl)throw new Error("Could not open file");
    const resp=await fetch(signed.signedUrl);
    const blob=await resp.blob();
    let text="";
    if(mt==="application/pdf"){
      // Browser text extraction first (free, no limit); batched vision scan for
      // scanned PDFs with no text layer.
      try{ const buf=await blob.arrayBuffer(); const t=await extractPdfText(buf); if(t&&t.length>=20)text=t; }catch(_e){}
      if(!text){
        const buf2=await blob.arrayBuffer();
        const r=await extractScannedPdfText(buf2,onProgress);
        if(r&&r.text)text=r.text;
      }
    } else {
      if(blob.size>15*1024*1024)throw new Error("Image too large to scan (max 15 MB)");
      const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(",")[1]);r.onerror=()=>rej(new Error("read failed"));r.readAsDataURL(blob);});
      const{data:exResp,error:exErr}=await sb.functions.invoke("extract-document-text",{body:{fileBase64:b64,mediaType:mt}});
      if(exErr)throw new Error(exErr.message||"Scan failed");
      if(exResp&&exResp.error)throw new Error(exResp.error);
      text=(exResp&&exResp.text)||"";
    }
    const{error:uErr}=await sb.from("documents").update({extracted_text:text||null}).eq("id",doc.id);
    if(uErr)throw new Error(uErr.message);
    return true;
  };
  const[scanMsg,setScanMsg]=useState("");
  const scanOne=async doc=>{
    setScanningId(doc.id); setScanMsg("");
    try{ await scanExisting(doc,(p,t)=>setScanMsg(`page ${p}/${t}`)); toast("Document scanned"); loadDocs(); if(reload)reload("documents"); }
    catch(e){ toast(e.message||"Scan failed","error"); }
    finally{ setScanningId(null); setScanMsg(""); }
  };
  const scanAllUnscanned=async()=>{
    const targets=docs.filter(needsScan);
    if(!targets.length){ toast("No documents need scanning"); return; }
    setBulkScan({done:0,total:targets.length});
    let ok=0;
    for(let i=0;i<targets.length;i++){
      setBulkScan({done:i,total:targets.length});
      try{ await scanExisting(targets[i],(p,t)=>setScanMsg(`p${p}/${t}`)); ok++; }catch(_e){}
      setScanMsg("");
    }
    setBulkScan(null); setScanMsg("");
    toast(`Scanned ${ok} of ${targets.length} document${targets.length>1?"s":""}`);
    loadDocs(); if(reload)reload("documents");
  };
  const unscannedCount=docs.filter(needsScan).length;

  // The "Other" folder also collects any document whose category is not one of
  // the known folders (legacy or imported values), so no file becomes
  // unreachable in the folder view.
  // "Other" is the catch-all: anything whose category matches no folder on file lands there,
  // so a document is never invisible. Custom folders match by name, which is what
  // documents.category stores.
  const inFolder=(d,cat)=>{
    const known=[...DOC_CATEGORIES,...customFolders.map(f=>f.name)];
    return cat==="Other"
      ? (!known.includes(d.category)||d.category==="Other")
      : d.category===cat;
  };
  const folderCount=cat=>docs.filter(d=>inFolder(d,cat)).length;

  return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
    <style>{`.pcm-folder-card{transition:transform .15s ease, box-shadow .15s ease;}.pcm-folder-card:hover{transform:translateY(-3px);box-shadow:0 8px 22px rgba(9,43,73,0.13);}`}</style>
    <div style={{padding:"14px 24px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{flex:1,display:"flex",alignItems:"center",gap:10,minWidth:0}}>
        {openFolder&&<button onClick={()=>setOpenFolder(null)} style={{background:"none",border:`1px solid ${B.border}`,color:B.textSoft,cursor:"pointer",fontSize:13,fontFamily:"inherit",padding:"6px 10px",borderRadius:6,flexShrink:0}}>← Vault</button>}
        {openFolder&&<div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{openFolder}</div>}
        {openFolder&&<span style={{fontSize:12,color:B.textMute,flexShrink:0}}>{folderCount(openFolder)} file{folderCount(openFolder)!==1?"s":""}</span>}
        {openFolder&&customFolders.some(f=>f.name===openFolder)&&folderCount(openFolder)===0&&
          <button onClick={()=>removeFolder({name:openFolder,custom:true,count:0})}
            style={{background:"none",border:`1px solid ${B.borderLight}`,color:B.textSoft,cursor:"pointer",
              fontSize:11.5,fontFamily:"inherit",padding:"4px 9px",borderRadius:6,flexShrink:0}}>
            Remove folder</button>}
      </div>
      {allowUpload&&<Btn onClick={()=>{setCategory(openFolder||"General");setModal("upload");}}>⬆ Upload Document</Btn>}
      {allowScan&&unscannedCount>0&&<Btn variant="ghost" onClick={scanAllUnscanned} disabled={!!bulkScan} title="Extract text from existing documents so the AI assistant can read them">{bulkScan?`Scanning ${bulkScan.done}/${bulkScan.total}${scanMsg?" · "+scanMsg:""}…`:`✦ Scan ${unscannedCount} for AI`}</Btn>}
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
      {loading?<Spinner/>:openFolder===null?
      /* Folder rows, not a card grid.
         The grid gave an empty folder the same visual weight as one holding twelve
         documents, stranded the eighth card alone on a second row, and used stock 3D
         folder clipart. Rows carry a count, a last-updated date and a relative bar, sort
         by what is actually in them, and collapse the empty folders into one muted line. */
      (()=>{
        const rows=buildFolderRows(docs,customFolders);
        const filled=rows.filter(r=>r.count>0), empty=rows.filter(r=>r.count===0);
        const sum=folderSummary(rows);
        const fmtDate=v=>{ if(!v)return "—"; const d=new Date(v);
          return isNaN(d)?"—":d.toLocaleDateString("en-US",{day:"numeric",month:"short"}); };
        return <div>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:14}}>
            <div style={{fontSize:13,color:B.textSoft}}>
              {sum.total} document{sum.total===1?"":"s"}
              {/* Called out separately because "Other" holding nearly half the vault is the
                  real problem, and a single total hides it. */}
              {sum.unfiled>0&&<> · <span style={{color:"#8a5c00"}}>{sum.unfiled} unfiled</span></>}
              {sum.expiring>0&&<> · <span style={{color:"#8a5c00"}}>{sum.expiring} expiring within 90 days</span></>}
              {/* Separate from expiring on purpose: a lapsed policy is a live gap, not
                  something coming up, and the softer word would hide the worse case. */}
              {sum.expired>0&&<> · <span style={{color:"#8b1a1a"}}>{sum.expired} expired</span></>}
            </div>
            <button onClick={()=>{setNewFolderName("");setFolderErr("");setModal("folder");}}
              style={{background:"none",border:`1px solid ${B.border}`,color:B.navy,cursor:"pointer",
                fontSize:12,fontFamily:"inherit",padding:"7px 12px",borderRadius:8}}>+ New folder</button>
          </div>
          {filled.map(r=><div key={r.name} role="button" tabIndex={0}
            onClick={()=>setOpenFolder(r.name)}
            onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")setOpenFolder(r.name);}}
            style={{display:"flex",alignItems:"center",gap:12,padding:"12px 4px",cursor:"pointer",
              borderBottom:`1px solid ${B.borderLight}`}}>
            <div style={{flex:1,minWidth:0}}>
              <span style={{fontSize:14,color:B.navy}}>{r.name}</span>
              {r.name==="Other"&&<span style={{fontSize:11.5,color:"#8a5c00",marginLeft:8}}>needs filing</span>}
              {r.expired>0&&<span style={{fontSize:11.5,color:"#8b1a1a",marginLeft:8}}>{r.expired} expired</span>}
              {r.expiring>0&&<span style={{fontSize:11.5,color:"#8a5c00",marginLeft:8}}>{r.expiring} expiring</span>}
              {r.custom&&<span style={{fontSize:10.5,color:B.textMute,marginLeft:8,border:`1px solid ${B.borderLight}`,borderRadius:4,padding:"1px 5px"}}>added</span>}
            </div>
            <div style={{width:110,height:4,background:B.bg,borderRadius:2,overflow:"hidden",flexShrink:0}}>
              <div style={{width:`${Math.round(r.share*100)}%`,height:"100%",
                background:(r.name==="Other"||r.expiring>0||r.expired>0)?"#d4900a":B.gold}}/>
            </div>
            <div style={{fontSize:13,color:B.textSoft,width:56,textAlign:"right",flexShrink:0}}>{r.count} file{r.count===1?"":"s"}</div>
            <div style={{fontSize:11.5,color:B.textMute,width:64,textAlign:"right",flexShrink:0}}>{fmtDate(r.lastAt)}</div>
          </div>)}
          {/* Empty folders are demoted, not hidden. Hiding them is tidier but then nobody
              knows Estate Planning exists as a destination. */}
          {empty.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",padding:"14px 4px 0"}}>
            <span style={{fontSize:11.5,color:B.textMute}}>Empty</span>
            {empty.map(r=><button key={r.name} onClick={()=>setOpenFolder(r.name)}
              style={{background:"none",border:`1px solid ${B.borderLight}`,color:B.textSoft,
                cursor:"pointer",fontSize:11.5,fontFamily:"inherit",padding:"4px 9px",borderRadius:6}}>
              {r.name}{r.custom?" ·":""}
            </button>)}
          </div>}
        </div>;
      })()
      :(()=>{
        const list=docs.filter(d=>inFolder(d,openFolder));
        return list.length===0
          ? <div style={{padding:"60px 0",textAlign:"center",color:B.textMute}}><div style={{fontSize:40,marginBottom:12}}>📁</div>No documents in this folder yet.</div>
          : <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {list.map(doc=>{
                const dl=lastDownloadFor(doc.id);
                return <div key={doc.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:18,boxShadow:B.shadow}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
                    <div style={{display:"flex",gap:12,alignItems:"flex-start",minWidth:0}}>
                      <div style={{flexShrink:0,width:46,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                        <img src={BRAND.mark} alt={BRAND.short} style={{height:40,width:"auto",display:"block"}}/>
                        <span style={{fontSize:8.5,fontWeight:800,letterSpacing:"0.06em",color:B.navyMid,background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:4,padding:"1px 5px",lineHeight:1.45,whiteSpace:"nowrap"}}>{fileLabel(doc.fileType,doc.name)}</span>
                      </div>
                      <div style={{minWidth:0}}>
                        <div style={{fontWeight:700,color:B.navy,fontSize:15}}>{doc.name}</div>
                        {doc.description&&<div style={{fontSize:12,color:B.textSoft,marginTop:2}}>{doc.description}</div>}
                        {/* Makes it obvious which Vault files are the ones being
                            surfaced on a property or valuables card. */}
                        {doc.propertySection&&<div style={{fontSize:11,color:B.navy,marginTop:4,display:"inline-flex",alignItems:"center",gap:5,background:"rgba(206,182,132,0.18)",border:`1px solid ${B.gold}`,borderRadius:20,padding:"2px 9px"}}>
                          🔗 {sectionLabel(doc.propertySection)}
                          {doc.propertyId&&properties.length>0&&(()=>{const pp=properties.find(x=>x.id===doc.propertyId);return pp?<span style={{color:B.textSoft}}>· {propLabel(pp)}</span>:null;})()}
                        </div>}
                      </div>
                    </div>
                    <span style={{fontSize:11,color:B.textMute,flexShrink:0}}>{fmtSize(doc.fileSize)}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(150px,100%),1fr))",gap:8,marginTop:14}}>
                    {[["Date Uploaded",fmt(doc.createdAt)],["Uploaded By",doc.uploadedBy||"—"],["Last Downloaded",dl?fmt(dl.downloadedAt):"Never"],["Downloaded By",dl?(dl.downloadedBy||"—"):"—"]].map(([l,v])=><div key={l} style={{background:B.bg,borderRadius:8,padding:"8px 10px"}}>
                      <div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{l}</div>
                      <div style={{fontSize:12,color:B.text,fontWeight:600}}>{v}</div>
                    </div>)}
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:14,alignItems:"center",flexWrap:"wrap"}}>
                    <Btn small onClick={()=>download(doc)}>⬇ Download</Btn>
                    {allowScan&&needsScan(doc)&&<Btn small variant="ghost" onClick={()=>scanOne(doc)} disabled={scanningId===doc.id} title="Make this document readable by the AI assistant">{scanningId===doc.id?(scanMsg?`Scanning ${scanMsg}…`:"Scanning…"):"✦ Scan"}</Btn>}
                    {allowScan&&(doc.extractedText||"").trim()&&<span title="The assistant can read this document" style={{fontSize:10,fontWeight:800,letterSpacing:"0.04em",color:B.navyMid,background:"rgba(206,182,132,0.18)",border:`1px solid ${B.gold}`,borderRadius:12,padding:"2px 7px"}}>✦ AI</span>}
                    {allowEditMeta&&<Btn small variant="ghost" onClick={()=>openEdit(doc)}>✏ Edit</Btn>}
                    {allowDelete&&<Btn small variant="danger" onClick={()=>del(doc)}>✕</Btn>}
                  </div>
                </div>;
              })}
            </div>;
      })()}
    </div>

    {modal==="folder"&&<Modal title="New folder" onClose={()=>setModal(null)}>
      <Field label="Folder name">
        <Inp placeholder="Aircraft" value={newFolderName} autoFocus
          onChange={e=>{setNewFolderName(e.target.value);setFolderErr("");}}
          onKeyDown={e=>{if(e.key==="Enter"&&!savingFolder)createFolder();}}/>
      </Field>
      <div style={{fontSize:11.5,color:B.textMute,marginTop:-6,marginBottom:12}}>
        Only this household sees it. Documents you file here keep the folder name as their category.
      </div>
      {folderErr&&<div style={{fontSize:12,color:"#8b1a1a",background:"#fff5f5",
        border:"1px solid #f3c2c2",borderRadius:8,padding:"8px 10px",marginBottom:12}}>{folderErr}</div>}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn variant="ghost" onClick={()=>setModal(null)} disabled={savingFolder}>Cancel</Btn>
        <Btn onClick={createFolder} disabled={savingFolder||!newFolderName.trim()}>
          {savingFolder?"Adding…":"Add folder"}</Btn>
      </div>
    </Modal>}

    {modal==="upload"&&<Modal title="Upload Document" onClose={()=>{setModal(null);resetForm();}}>
      <Field label="Document Name"><Inp placeholder="Q4 2024 Statement" value={name} onChange={e=>setName(e.target.value)}/></Field>
      <Field label="Category"><Sel value={category} onChange={e=>setCategory(e.target.value)}>{[...DOC_CATEGORIES,...customFolders.map(f=>f.name)].map(c=><option key={c}>{c}</option>)}</Sel></Field>
      <Field label="Description"><Inp placeholder="Optional description" value={description} onChange={e=>setDescription(e.target.value)}/></Field>
      {linkFields()}
      <Field label="File">
        <div style={{border:`2px dashed ${file?B.gold:B.border}`,borderRadius:10,padding:"20px",textAlign:"center",cursor:"pointer",background:file?"#fef9f0":B.bg,transition:"all .2s"}} onClick={()=>document.getElementById("file-upload").click()}>
          <input id="file-upload" type="file" style={{display:"none"}} onChange={e=>setFile(e.target.files[0])}/>
          {file?<><div style={{fontSize:24,marginBottom:6}}>✅</div><div style={{fontSize:13,color:B.navy,fontWeight:600}}>{file.name}</div><div style={{fontSize:11,color:B.textSoft}}>{(file.size/1024/1024).toFixed(2)} MB</div></>:<><div style={{fontSize:32,marginBottom:6}}>📁</div><div style={{fontSize:13,color:B.textSoft}}>Click to select a file</div><div style={{fontSize:11,color:B.textMute,marginTop:4}}>PDF, Word, Excel, images supported</div></>}
        </div>
      </Field>
      <div style={{background:"#e8f0f8",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:B.navyMid}}>
        ⚠️ First create a Storage bucket named <strong>documents</strong> in Supabase → Storage → New Bucket (Private)
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
        <Btn onClick={upload} disabled={uploading||!file||!name.trim()}>{uploading?(uploadPhase||"Uploading…"):"Upload"}</Btn>
      </div>
    </Modal>}

    {modal&&modal.edit&&<Modal title="Edit Document" onClose={()=>{setModal(null);resetForm();}}>
      <Field label="Document Name"><Inp placeholder="Q4 2024 Statement" value={name} onChange={e=>setName(e.target.value)}/></Field>
      <Field label="Category"><Sel value={category} onChange={e=>setCategory(e.target.value)}>{[...DOC_CATEGORIES,...customFolders.map(f=>f.name)].map(c=><option key={c}>{c}</option>)}</Sel></Field>
      <Field label="Description"><Inp placeholder="Optional description" value={description} onChange={e=>setDescription(e.target.value)}/></Field>
      {linkFields(modal.edit.id)}
      <div style={{fontSize:11,color:B.textMute,marginBottom:14}}>Renaming changes the display title only; the stored file itself is unchanged.</div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn variant="ghost" onClick={()=>{setModal(null);resetForm();}}>Cancel</Btn>
        <Btn onClick={saveEdit} disabled={uploading||!name.trim()}>{uploading?"Saving…":"Save"}</Btn>
      </div>
    </Modal>}
  </div>;
}

// ── CLIENT DASHBOARD ──────────────────────────────────────────────────────────
function ClientDashboard({family,data,userProfile,logout,toast,reload}){
  const isMobile=useIsMobile();
  // Needed because this view renders CashFlowView too. The client view is read-only, so
  // the picker never opens here — but the prop still has to resolve, and an undefined
  // identifier would take the whole dashboard down rather than degrade.
  const vendorOptions=buildVendorOptions(data,family.id);
  const[activeTab,setActiveTab]=useState("summary");
  const[emailAdvisorOpen,setEmailAdvisorOpen]=useState(false);
  const fam=(data.families||[]).find(x=>x.id===family.id)||family;
  const rawAssistantName=(fam.assistantName||"").trim();
  const assistantName=rawAssistantName||"Ordanis";
  // Read from `fam`, not the `family` prop, so a plan change lands without a re-login.
  //
  // On Core the household is Partner-led. The expert-of-record on the row exists only so staff
  // can open the file, so anything on this screen that offers the client "your Ordanis Expert" would
  // point them at someone who is not their lead — the one place where the wrong copy sends a real
  // email to the wrong person.
  const clientPlan=fam.plan;
  const clientHasExpert=planAllows(clientPlan,"assignedExpert");
  // Supporting document behind a figure on a property card, and the family's
  // scheduled-personal-property endorsement linked from Valuables.
  const docForSection=(pid,section)=>(data.documents||[]).find(d=>d.propertyId===pid&&d.propertySection===section);
  const valuablesPolicyDoc=()=>(data.documents||[]).find(d=>d.familyId===family.id&&d.propertySection==="valuables_schedule");
  const[namePromptDismissed,setNamePromptDismissed]=useState(false);
  const[welcomeName,setWelcomeName]=useState("");
  const[savingWelcome,setSavingWelcome]=useState(false);
  const showNamePrompt=!rawAssistantName && !namePromptDismissed;
  const saveWelcomeName=async(useDefault)=>{
    const nm=useDefault?"Ordanis":((welcomeName||"").trim().slice(0,40)||"Ordanis");
    setSavingWelcome(true);
    try{ await sb.from("families").update({assistant_name:nm}).eq("id",family.id); if(reload)await reload("families"); }
    catch(e){}
    finally{ setSavingWelcome(false); setNamePromptDismissed(true); }
  };
  const[showAssistantGreeting,setShowAssistantGreeting]=useState(false);
  useEffect(()=>{
    if(!family?.id)return;
    if(showNamePrompt){ _greetedFamilies.add(family.id); return; } // first-login naming serves as the greeting
    if(_greetedFamilies.has(family.id))return;
    _greetedFamilies.add(family.id);
    setShowAssistantGreeting(true);
  },[family?.id,showNamePrompt]);
  const properties=(data.properties||[]).filter(p=>p.familyId===family.id);
  const accounts=(data.portfolio_accounts||[]).filter(a=>a.familyId===family.id);
  const valuables=(data.valuables||[]).filter(v=>v.familyId===family.id);
  const tasks=(data.tasks||[]).filter(t=>t.familyId===family.id&&!t.done);
  const totalRE=properties.reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0);
  const totalDebt=properties.reduce((s,p)=>s+(Number(p.loanBalance)||0)+(Number(p.secondMortgageBalance)||0),0)+accounts.filter(a=>a.accountType==="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const totalAccounts=accounts.filter(a=>a.accountType!=="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const totalValuables=valuables.reduce((s,v)=>s+(Number(v.estimatedValue)||0),0);
  const netWorth=totalRE-totalDebt+totalAccounts+totalValuables;
  const overdue=tasks.filter(t=>t.dueDate&&new Date(t.dueDate)<new Date());
  const soon=tasks.filter(t=>!overdue.includes(t)&&t.dueDate&&(new Date(t.dueDate)-new Date())/(86400000)<=30);

  const TABS=[
    {id:"summary",   label:"Summary",    icon:"◈"},
    {id:"portfolio", label:"Portfolio",  icon:"◇"},
    {id:"properties",label:"Properties", icon:"⌂"},
    {id:"cashflow",  label:"Cash Flow",  icon:"$"},
    {id:"valuables", label:"Valuables",  icon:"◆"},
    {id:"tasks",     label:"Tasks",      icon:"◻"},
    {id:"documents", label:"Vault",  icon:"📁"},
    // Last in the row on purpose, and flagged so the renderer can mark it with a star: the
    // other tabs are ledgers, this one is the assistant.
    {id:"assistant", label:"Ask "+assistantName,   icon:"✦", assistant:true},
  ];

  return <div style={{minHeight:"100vh",background:B.bg,fontFamily:"'DM Sans','Helvetica Neue',sans-serif",paddingBottom:isMobile?70:0}}>

    {showNamePrompt&&<Modal title="Meet your assistant" onClose={()=>setNamePromptDismissed(true)}>
      <div style={{fontSize:14,color:B.text,lineHeight:1.55,marginBottom:18}}>
        You have a personal AI assistant that can answer questions about your dashboard — your net worth, properties, loans, insurance, tasks, and documents. It only ever sees your own information.
        <br/><br/>
        What would you like to call it? You can always change this later.
      </div>
      <Field label="Assistant name">
        <Inp autoFocus placeholder="e.g. Ordanis, Ace, Atlas…" value={welcomeName} maxLength={40}
          onChange={e=>setWelcomeName(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!savingWelcome)saveWelcomeName(false);}}/>
      </Field>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",alignItems:"center",marginTop:18}}>
        <button onClick={()=>saveWelcomeName(true)} disabled={savingWelcome} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Skip — use "Ordanis"</button>
        <Btn onClick={()=>saveWelcomeName(false)} disabled={savingWelcome}>{savingWelcome?"Saving…":"Save name"}</Btn>
      </div>
    </Modal>}

    {showAssistantGreeting&&!showNamePrompt&&<AssistantWelcome family={family} data={data} reload={reload} userProfile={userProfile} onClose={()=>setShowAssistantGreeting(false)} toast={toast}/>}
    {emailAdvisorOpen&&<EmailAdvisorModal family={family} userProfile={userProfile} data={data} onClose={()=>setEmailAdvisorOpen(false)}/>}
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>

    {/* Header (white banner with logo, family name, sign out) */}
    <div style={{background:B.white,padding:isMobile?"0 16px":"0 32px",borderBottom:`1px solid ${B.borderLight}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:isMobile?"12px 0":"16px 0",gap:10,flexWrap:isMobile?"wrap":"nowrap"}}>
        <PCMLogo compact/>
        <div style={{display:"flex",alignItems:"center",gap:isMobile?8:16,flex:isMobile?"1 1 auto":"none",justifyContent:isMobile?"flex-end":"flex-start"}}>
          <div style={{textAlign:"right",minWidth:0}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?16:22,color:B.navy,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{family.name}</div>
            {/* The relationship, on the client's own banner. Small, but on every screen they see.
                Gold fill for Premier, gold outline for Core — both read as a membership mark rather
                than as a limit, which matters because the client sees this one and the tier below
                should not look like a demotion. */}
            <div style={{fontSize:isMobile?10:11,color:B.textSoft,marginTop:3,display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end",flexWrap:"wrap"}}>
              <span style={{fontSize:isMobile?9:9.5,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
                padding:"2px 7px",borderRadius:3,whiteSpace:"nowrap",
                background:clientHasExpert?B.gold:"transparent",
                border:`1px solid ${B.gold}`,
                color:B.navy}}>{planLabel(clientPlan)}</span>
              <span>·</span>
              <span>{isMobile?"Client Portal":`Client Portal · ${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}`}</span>
            </div>
          </div>
          {clientHasExpert&&<button onClick={()=>setEmailAdvisorOpen(true)} style={{background:"rgba(206,182,132,0.15)",border:`1px solid ${B.gold}`,color:B.navy,borderRadius:8,padding:isMobile?"6px 10px":"6px 14px",fontSize:11,cursor:"pointer",fontFamily:"inherit",flexShrink:0,fontWeight:600}}>{isMobile?"✉ Ordanis Expert":"✉ Email my Ordanis Expert"}</button>}
          <button onClick={logout} style={{background:"transparent",border:`1px solid ${B.border}`,color:B.textSoft,borderRadius:8,padding:isMobile?"6px 10px":"6px 14px",fontSize:11,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>Sign Out</button>
        </div>
      </div>
    </div>

    {/* Gold accent line */}
    <div style={{height:2,background:`linear-gradient(90deg,${B.gold},${B.goldLight}55,transparent)`}}/>

    {/* Top Tabs (desktop only) — folder tabs, matching the advisor view.
        The active tab's bottom border is the page colour, so it merges into the content
        below rather than sitting on a line above it. */}
    {!isMobile&&<div style={{borderBottom:`1px solid ${B.border}`,background:B.bg,padding:"8px 32px 0",display:"flex",gap:2,alignItems:"flex-end",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
      {TABS.map(t=>{
        const on=activeTab===t.id;
        return <button key={t.id} onClick={()=>setActiveTab(t.id)} aria-current={on?"page":undefined}
          style={{
            background:on?B.white:"transparent",
            border:on?`1px solid ${B.border}`:"1px solid transparent",
            borderBottom:on?`1px solid ${B.white}`:"1px solid transparent",
            borderTop:on?`2px solid ${B.gold}`:"2px solid transparent",
            borderRadius:"8px 8px 0 0",
            color:on?B.navy:B.textSoft,
            fontFamily:"inherit", fontSize:13, fontWeight:on?600:400,
            padding:on?"11px 17px 10px":"9px 16px 9px",
            cursor:"pointer",
            // Covers the container's bottom border, which is what makes the join continuous.
            marginBottom:-1,
            whiteSpace:"nowrap", flexShrink:0,
            marginLeft:t.assistant?10:0,
            transition:"background 120ms ease, color 120ms ease",
          }}>
          {t.assistant&&<span aria-hidden="true" style={{
            // Gold measures 1.97:1 on white, so the star only goes gold on the active tab,
            // where it sits on a white fill under a gold cap and reads as decoration.
            color:on?B.gold:B.navyMid, marginRight:5, fontSize:12,
          }}>✦</span>}
          {t.label}</button>;
      })}
    </div>}

    {/* Bottom Tab Bar (mobile only) */}
    {isMobile&&<div style={{position:"fixed",bottom:0,left:0,right:0,background:B.white,borderTop:`1px solid ${B.borderLight}`,display:"flex",justifyContent:"space-around",padding:"8px 4px 10px",zIndex:50,boxShadow:"0 -2px 12px rgba(0,0,0,0.08)",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
      {TABS.map(t=><button key={t.id} onClick={()=>setActiveTab(t.id)} style={{background:"none",border:"none",borderTop:activeTab===t.id?`2px solid ${B.gold}`:"2px solid transparent",cursor:"pointer",padding:"8px 6px",display:"flex",alignItems:"center",justifyContent:"center",flex:1,minWidth:0,color:activeTab===t.id?B.navy:B.textSoft,fontFamily:"inherit",marginTop:-2}}>
        <span style={{fontSize:11,fontWeight:activeTab===t.id?800:600,letterSpacing:"0.02em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%"}}>{t.label}</span>
      </button>)}
    </div>}

    {/* Content */}
    <div style={{maxWidth:1100,margin:"0 auto",padding:isMobile?"16px 14px":"28px 24px"}}>

      {/* SUMMARY */}
      {activeTab==="summary"&&<div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,color:B.navy,fontWeight:600,marginBottom:6}}>
          Good {new Date().getHours()<12?"Morning":new Date().getHours()<17?"Afternoon":"Evening"}
        </div>
        <div style={{color:B.textSoft,fontSize:14,marginBottom:24}}>Here is your financial overview as of {new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>

        {/* Net Worth Hero */}
        <div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderTop:`4px solid ${B.gold}`,borderRadius:16,padding:isMobile?"22px 20px":"32px 36px",marginBottom:isMobile?16:24,position:"relative",overflow:"hidden",boxShadow:B.shadow}}>
          <div style={{position:"absolute",right:-20,top:-20,width:200,height:200,borderRadius:"50%",background:"rgba(206,182,132,0.08)"}}/>
          <div style={{fontSize:isMobile?11:12,color:B.textMute,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8,position:"relative",zIndex:1}}>Estimated Net Worth</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?36:52,color:B.navy,fontWeight:600,lineHeight:1,marginBottom:8,position:"relative",zIndex:1}}>{fmtMoney(netWorth)}</div>
          <div style={{height:1,background:B.borderLight,margin:"18px 0",position:"relative",zIndex:1}}/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(150px,100%),1fr))",gap:12,marginTop:4,position:"relative",zIndex:1}}>
            {[{l:"Real Estate",v:fmtMoney(totalRE)},{l:"Total Debt",v:fmtMoney(totalDebt),neg:true},{l:"Portfolio",v:fmtMoney(totalAccounts)},{l:"Valuables",v:fmtMoney(totalValuables)}].map(s=><div key={s.l} style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>{s.l}</div>
              <div style={{fontSize:isMobile?19:23,fontFamily:"'Cormorant Garamond',serif",color:s.neg?"#d43030":B.navy,fontWeight:600,lineHeight:1}}>{s.neg?"−":""}{s.v}</div>
            </div>)}
          </div>
        </div>

        {/* Alert banners */}
        {overdue.length>0&&<div style={{background:"#fde8e8",border:"1px solid #f5c6c6",borderRadius:10,padding:"12px 18px",marginBottom:12,display:"flex",alignItems:"center",gap:12}}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d43030" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><path d="M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          <div><div style={{fontWeight:700,color:"#8b1a1a",fontSize:14}}>Overdue Tasks</div><div style={{fontSize:13,color:"#8b1a1a"}}>{overdue.length} task{overdue.length>1?"s":""} past due — please contact {clientHasExpert?"your Ordanis Expert":"your lead partner"}.</div></div>
        </div>}
        {soon.length>0&&<div style={{background:"#fef3e2",border:"1px solid #fcd97d",borderRadius:10,padding:"12px 18px",marginBottom:12,display:"flex",alignItems:"center",gap:12}}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d4900a" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3 2"/></svg>
          <div><div style={{fontWeight:700,color:"#8a5c00",fontSize:14}}>Upcoming Deadlines</div><div style={{fontSize:13,color:"#8a5c00"}}>{soon.length} task{soon.length>1?"s":""} due within 30 days.</div></div>
        </div>}

        {/* Quick stats grid */}
        <style>{`.pcm-stat-card{transition:transform .15s ease, box-shadow .15s ease;}.pcm-stat-card:hover{transform:translateY(-3px);box-shadow:0 8px 22px rgba(9,43,73,0.13);}.pcm-stat-card:active{transform:translateY(-1px);}`}</style>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(180px,100%),1fr))",gap:14}}>
          {[
            {l:"Properties",v:properties.length,tab:"properties",icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/></svg>},
            {l:"Portfolio Accounts",v:accounts.length,tab:"portfolio",icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18 10 12l3.5 3.5L20 9"/><path d="M15.5 9H20v4.5"/></svg>},
            {l:"Valuables",v:valuables.length,tab:"valuables",icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l3 5.5-9 12.5L3 8.5z"/><path d="M3 8.5h18"/><path d="M9.5 3 8 8.5l4 12.5 4-12.5L14.5 3"/></svg>},
            {l:"Pending Tasks",v:tasks.length,tab:"tasks",icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>}
          ].map(s=><div key={s.l} className="pcm-stat-card" onClick={()=>setActiveTab(s.tab)} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")setActiveTab(s.tab);}} style={{background:B.white,borderRadius:14,padding:"18px 20px",border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${B.gold}`,boxShadow:B.shadow,display:"flex",alignItems:"center",gap:14,cursor:"pointer"}}>
            <div style={{width:46,height:46,borderRadius:"50%",background:"rgba(206,182,132,0.15)",border:`1px solid rgba(206,182,132,0.55)`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:B.navy}}>{s.icon}</div>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,color:B.navy,fontWeight:600,lineHeight:1}}>{s.v}</div>
              <div style={{fontSize:10.5,color:B.textMute,marginTop:4,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase"}}>{s.l}</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={B.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,opacity:0.55}}><path d="M9 6l6 6-6 6"/></svg>
          </div>)}
        </div>
      </div>}

      {/* PORTFOLIO */}
      {activeTab==="portfolio"&&<div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:20}}>Investment Portfolio</div>
        {accounts.length===0?<Empty text="No portfolio accounts on file."/>:accounts.map(a=>{
          const pct=pctChange(a.startingBalance,a.currentBalance);
          const gain=(Number(a.currentBalance)||0)-(Number(a.startingBalance)||0);
          return <div key={a.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${B.gold}`,borderRadius:12,padding:24,marginBottom:16,boxShadow:B.shadow}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
              <div><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600}}>{a.institution}</div><div style={{fontSize:13,color:B.textSoft}}>{a.accountType}{a.bankerName?` · ${a.bankerName}`:""}</div></div>
              <div style={{textAlign:"right"}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,color:B.navy,fontWeight:600}}>{fmtMoney(a.currentBalance)}</div>
                {pct!==null&&<div style={{fontSize:13,fontWeight:700,color:Number(pct)>=0?"#18a850":"#d43030"}}>{Number(pct)>=0?"+":""}{pct}% ({Number(gain)>=0?"+":"-"}{fmtMoney(Math.abs(gain))})</div>}
              </div>
            </div>
            {pct!==null&&<div style={{background:Number(pct)>=0?"#e0f5e9":"#fde8e8",borderRadius:10,padding:"14px 18px",display:"flex",alignItems:"center",gap:16}}>
              <div style={{fontSize:32}}>{Number(pct)>=0?"📈":"📉"}</div>
              <div>
                <div style={{fontSize:11,color:B.textMute,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>Performance Since Inception</div>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:Number(pct)>=0?"#0d5c2b":"#8b1a1a",fontWeight:600}}>{Number(pct)>=0?"+":""}{pct}%</div>
                <div style={{fontSize:12,color:B.textSoft}}>Starting balance: {fmtMoney(a.startingBalance)}</div>
              </div>
            </div>}
          </div>;
        })}
        <div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:20,boxShadow:B.shadow,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:14,color:B.textSoft,fontWeight:600}}>Total Portfolio Value</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,color:B.navy,fontWeight:600}}>{fmtMoney(totalAccounts)}</div>
        </div>
      </div>}

      {/* PROPERTIES */}
      {activeTab==="properties"&&<div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:20}}>Property Holdings</div>
        {properties.length===0?<Empty text="No properties on file."/>:(()=>{
          const bySort=(a,b)=>((Number.isFinite(Number(a.sortOrder))?Number(a.sortOrder):1e9)-(Number.isFinite(Number(b.sortOrder))?Number(b.sortOrder):1e9))||(new Date(a.createdAt||0)-new Date(b.createdAt||0));
          const groups=[...PROP_TYPES,"Other"].map(type=>({type,list:properties.filter(p=>type==="Other"?!PROP_TYPES.includes(p.propertyType):p.propertyType===type).sort(bySort)})).filter(g=>g.list.length>0);
          const card=p=><div key={p.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${B.gold}`,borderRadius:12,padding:24,marginBottom:16,boxShadow:B.shadow}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
            <div><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600}}>{p.address}</div>{p.ownerName&&<div style={{fontSize:13,color:B.textSoft,marginTop:2}}>{p.ownerName}</div>}</div>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>{fmtMoney(p.currentValue||p.purchasePrice)}</div>
              <div style={{fontSize:12,color:B.textSoft}}>Current Value</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(140px,100%),1fr))",gap:10}}>
            {[["Property Type",p.propertyType],["Purchase Price",fmtMoney(p.purchasePrice)],["Purchase Date",fmt(p.purchaseDate)],["Lender",p.lender||"—","mortgage"],["Loan Balance",fmtMoney(p.loanBalance),"mortgage"],["Interest Rate",fmtPct(p.interestRate)],["Monthly Payment",fmtMoney(p.loanPayment)],...(Number(p.secondMortgageBalance)>0?[["2nd Mtg Balance",fmtMoney(p.secondMortgageBalance)],["2nd Mtg Payment",p.secondMortgagePayment?`${fmtMoney(p.secondMortgagePayment)}/mo`:"—"]]:[]),["Loan Maturity",fmt(p.loanMaturityDate)],["Rental Income",p.rentalIncome?`${fmtMoney(p.rentalIncome)}/mo`:"—","rental"],["Property Taxes",p.propertyTaxes?`${fmtMoney(p.propertyTaxes)}/yr`:"—","tax"],["Insurance",p.insuranceCompany||"—","insurance_dec"],["Insurance Expires",p.insuranceExpiration?fmt(p.insuranceExpiration):"—"],["Flood Insurance",p.floodInsurance?"Yes":"No","flood_dec"]].map(([l,v,sec])=><div key={l} style={{background:B.bg,borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:3}}>{l}<DocLink doc={sec?docForSection(p.id,sec):null} toast={toast}/></div>
              <div style={{fontSize:13,color:B.text,fontWeight:600}}>{v}</div>
            </div>)}
          </div>
          {(()=>{const vendors=(data.property_contacts||[]).filter(pc=>pc.propertyId===p.id);return <div style={{marginTop:16,paddingTop:12,borderTop:`1px solid ${B.borderLight}`}}>
            <div style={{fontSize:11,color:B.textMute,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:8}}>Vendors & Service Providers</div>
            {vendors.length===0
              ? <div style={{fontSize:12,color:B.textMute}}>None on file yet.</div>
              : <div style={{display:"flex",flexDirection:"column",gap:6}}>{vendors.map(c=><div key={c.id} style={{background:B.bg,borderRadius:6,padding:"6px 10px"}}>
                  <div style={{fontSize:12,fontWeight:600,color:B.navy}}>{c.name}{c.role&&<span style={{fontWeight:400,color:B.textSoft,marginLeft:6}}>· {c.role}</span>}</div>
                  <div style={{fontSize:11,color:B.textSoft,display:"flex",gap:10,flexWrap:"wrap",marginTop:1}}>{c.company&&<span>{c.company}</span>}{c.phone&&<span>📞 <PhoneLink value={c.phone}/></span>}{c.email&&<span>✉ <EmailLink value={c.email}/></span>}</div>
                </div>)}</div>}
          </div>;})()}
        </div>;
          return groups.map(g=><div key={g.type} style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:6,borderBottom:`2px solid ${B.gold}`}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:700}}>{g.type}</div>
              <div style={{background:B.navy,color:B.white,borderRadius:20,minWidth:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,padding:"0 7px"}}>{g.list.length}</div>
            </div>
            {g.list.map(card)}
          </div>);
        })()}
      </div>}

      {/* CASH FLOW (read-only) */}
      {activeTab==="cashflow"&&<div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:8}}>Cash Flow Projection</div>
        <div style={{fontSize:14,color:B.textSoft,marginBottom:20}}>Projection of expected cash flow events configured by {clientHasExpert?"your Ordanis Expert":"your lead partner"}.</div>
        {/* fam, not the `family` prop, so the bill-pay gate reads the current plan. */}
        <CashFlowView family={fam} events={(data.cash_flow_events||[]).filter(e=>e.familyId===family.id)} paymentLog={(data.cash_flow_payment_log||[]).filter(p=>p.familyId===family.id)} properties={properties} vendors={vendorOptions} reload={()=>{}} toast={toast||(()=>{})} readOnly={true}/>
      </div>}

      {/* VALUABLES */}
      {activeTab==="valuables"&&<div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:8}}>Personal Property & Valuables</div>
        <div style={{fontSize:14,color:B.textSoft,marginBottom:20}}>Total estimated value: <strong style={{color:B.navy}}>{fmtMoney(totalValuables)}</strong></div>
        {valuables.length===0?<Empty text="No valuables on file."/>:VALUABLE_CATS.map(cat=>{
          // "Other" absorbs unrecognised categories so nothing is hidden.
          const items=valuables.filter(v=>cat==="Other"?!VALUABLE_CATS.includes(v.category)||v.category==="Other":v.category===cat);
          if(!items.length)return null;
          return <div key={cat} style={{marginBottom:20}}>
            <div style={{fontSize:12,fontWeight:800,color:B.textMute,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>{cat}</div>
            {items.map(v=><div key={v.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid #8b5cf6`,borderRadius:10,padding:"16px 20px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:B.shadow}}>
              <div>
                <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{v.description}</div>
                {v.makeModel&&<div style={{fontSize:12,color:B.textSoft}}>{v.makeModel}{v.year?` · ${v.year}`:""}</div>}
                {v.insured?<div style={{fontSize:11,color:"#18a850",fontWeight:600,marginTop:3}}>✓ Insured{v.insuranceCompany?` — ${v.insuranceCompany}`:""}<DocLink doc={valuablesPolicyDoc()} toast={toast} label="📄 policy"/></div>:<div style={{fontSize:11,color:"#b4551f",fontWeight:600,marginTop:3}}>⚠ Not scheduled<DocLink doc={valuablesPolicyDoc()} toast={toast} label="📄 policy"/></div>}
              </div>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600}}>{fmtMoney(v.estimatedValue)}</div>
            </div>)}
          </div>;
        })}
      </div>}

      {/* TASKS */}
      {activeTab==="tasks"&&<div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:20}}>Tasks & Deadlines</div>
        {tasks.length===0?<div style={{textAlign:"center",padding:"60px 0",color:B.textMute}}><div style={{fontSize:40,marginBottom:12}}>✅</div>All caught up — no pending tasks.</div>:[...tasks].sort((a,b)=>a.dueDate>b.dueDate?1:-1).map(t=>{
          const isOD=t.dueDate&&new Date(t.dueDate)<new Date();
          const isSoon=!isOD&&t.dueDate&&(new Date(t.dueDate)-new Date())/(86400000)<=30;
          return <div key={t.id} style={{background:B.white,border:`1px solid ${isOD?"#f5c6c6":B.borderLight}`,borderLeft:`4px solid ${isOD?"#d43030":isSoon?"#d4900a":PRIORITY_COLORS[t.priority]?.dot||B.gold}`,borderRadius:10,padding:"16px 20px",marginBottom:10,boxShadow:B.shadow}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{t.title}</div>
                {t.dueDate&&<div style={{fontSize:12,color:isOD?"#d43030":isSoon?"#d4900a":B.textSoft,marginTop:4,fontWeight:isOD||isSoon?700:400}}>{isOD?"⚠ Overdue · ":isSoon?"⏰ Due soon · ":""}{fmt(t.dueDate)}</div>}
              </div>
              <Badge scheme={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
            </div>
          </div>;
        })}
      </div>}

      {/* VAULT */}
      {activeTab==="documents"&&<div style={{height:"calc(100vh - 200px)"}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:20}}>Vault</div>
        <DocumentsView familyId={family.id} canUpload={true} canDelete={false} canScan={false} toast={toast||(()=>{})} reload={reload}/>
      </div>}

      {/* ASK AI */}
      {activeTab==="assistant"&&<FamilyAssistant family={family} data={data} reload={reload} toast={toast}/>}

    </div>

    {/* Footer */}
    <div style={{background:B.white,borderTop:`1px solid ${B.borderLight}`,padding:isMobile?"12px 16px":"16px 32px",display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:isMobile?20:40,gap:8,flexDirection:isMobile?"column":"row",textAlign:"center"}}>
      <div style={{fontSize:isMobile?10:11,color:B.textMute}}>{BRAND.name} · {BRAND.contactEmail}</div>
      <div style={{fontSize:isMobile?9:10,color:B.textMute,letterSpacing:"0.1em"}}>CONFIDENTIAL · FOR AUTHORIZED RECIPIENTS ONLY</div>
    </div>
  </div>;
}

// ── PARTNER (view-only across one or more linked families, upload/download docs only) ──
// data.families is already scoped to this partner's linked families via RLS
// (current_user_allowed_family_ids(), joined through the family_partners table),
// so no extra client-side filtering is needed here — same trust model as the
// client and advisor branches above.
function PartnerDashboard({data,userProfile,logout,toast,reload}){
  const myFamilies=data.families||[];
  const[selectedId,setSelectedId]=useState(null);
  useEffect(()=>{
    if(selectedId===null&&myFamilies.length===1)setSelectedId(myFamilies[0].id);
  },[myFamilies.length]);
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
      <button onClick={logout} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:B.textSoft}}>Sign Out</button>
    </div>
  </div>;

  if(selected){
    return <div style={{height:"100vh",display:"flex",flexDirection:"column",background:B.bg,fontFamily:"'DM Sans','Helvetica Neue',sans-serif"}}>
      <HeaderBar>
        {myFamilies.length>1&&<button onClick={()=>setSelectedId(null)} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:B.navy,fontWeight:600}}>← Switch Family</button>}
      </HeaderBar>
      <div style={{flex:1,minHeight:0}}>
        <ViewErrorBoundary label="the family dashboard" onBack={()=>setSelectedId(null)}>
          <FamilyDashboard family={selected} data={data} reload={reload} toast={toast} onBack={()=>setSelectedId(null)} userProfile={userProfile}/>
        </ViewErrorBoundary>
      </div>
    </div>;
  }

  return <div style={{minHeight:"100vh",background:B.bg,fontFamily:"'DM Sans','Helvetica Neue',sans-serif"}}>
    <HeaderBar/>
    <div style={{padding:24,maxWidth:960,margin:"0 auto"}}>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600,marginBottom:16}}>Select a Family</div>
      {myFamilies.length===0&&<Empty text={`No families are linked to your account yet. Contact your ${BRAND.short} representative.`}/>}
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
      {key:"effective_date",label:"Effective Date",       pdfField:"effective_date", type:"date", default:()=>new Date().toISOString().slice(0,10)},
      {key:"client_address",label:"Client Address",       pdfField:"client_address", default:(f,c)=>c?.address||""},
      {key:"governing_state",label:"Governing State",     pdfField:"governing_state",placeholder:"e.g. Florida", default:(f,c)=>guessState(c?.address)},
      {key:"svc_portfolio",   label:"Include: Portfolio oversight",     pdfField:null, type:"checkbox", default:()=>true},
      {key:"svc_property",    label:"Include: Property & asset tracking", pdfField:null, type:"checkbox", default:()=>true},
      {key:"svc_documents",   label:"Include: Document management",     pdfField:null, type:"checkbox", default:()=>true},
      {key:"svc_planning",    label:"Include: Financial planning",      pdfField:null, type:"checkbox", default:()=>true},
      {key:"svc_portal",      label:"Include: Client portal & Ask Ordanis",pdfField:null, type:"checkbox", default:()=>true},
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
      {key:"advisor_name", label:"Ordanis Expert",       pdfField:"advisor_name",  default:(f,c,u)=>f.advisorName||u?.fullName||u?.email||""},
      {key:"date_reviewed",label:"Date Reviewed",         pdfField:"date_reviewed", type:"date", default:()=>new Date().toISOString().slice(0,10)},
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
      {key:"wire_date",     label:"Wire Date",       pdfField:"wire_date_14",    type:"date", default:()=>new Date().toISOString().slice(0,10)},
    ],
  },
  pfs:{
    label:"Personal Financial Statement",icon:"doc",
    desc:"Fillable assets, liabilities, income & expense statement",
    docKey:"pfs",
    fields:[
      {key:"prepared_for",label:"Prepared For",   pdfField:"Text1",              default:(f)=>f.name||""},
      {key:"as_of",       label:"Statement Date", pdfField:"as of mmddyyyy1",    type:"date", default:()=>new Date().toISOString().slice(0,10)},
    ],
  },
  lifestyle:{
    label:"Lifestyle Expense Worksheet",icon:"chart",
    desc:"Fillable monthly/annual expense worksheet for clients",
    docKey:"lifestyle",
    fields:[
      {key:"as_of",label:"As Of Date", pdfField:"Date", type:"date", default:()=>new Date().toISOString().slice(0,10)},
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
  {label:"Ordanis Expert User Guide",icon:"book",desc:"Full platform walkthrough for Ordanis Experts",docKey:"user_guide"},
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
  // come back per role (self-owned always; admin: everything; Ordanis Expert:
  // also Partner-owned rows for families they're allowed to see; Partner:
  // self-owned only, never a Ordanis Expert's). When locked to one family (the
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
  const del=async p=>{
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
        {[["Obligations discharged",S.obligations_closed],
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

function ResourcesView({data,userProfile,toast}){
  const isMobile=useIsMobile();
  const[familyId,setFamilyId]=useState("");
  const[activeDoc,setActiveDoc]=useState(null);
  const families=data.families||[];
  const family=families.find(f=>f.id===familyId)||null;
  const contacts=(data.contacts||[]).filter(c=>c.familyId===familyId);
  const primaryContact=contacts.find(c=>!c.isAdvisor)||contacts[0]||null;
  // Prefer an actual bank-type account (Checking/Savings/Money Market) for
  // sender/institution defaults — falls back to the highest-balance account
  // of any type if the family has no plain bank account on file.
  const familyAccounts=(data.portfolio_accounts||[]).filter(a=>a.familyId===familyId);
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

// ── WORKFLOW ENGINE (shared) ─────────────────────────────────────────────────
const addDays=(iso,n)=>{const d=new Date(iso+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+(Number(n)||0));return d.toISOString().slice(0,10);};
const todayISO=()=>new Date().toISOString().slice(0,10);

// One definition of the timestamps a step carries when its status changes.
//
// A step can be advanced from two places — the review queue and the cycle detail
// — and they had drifted into recording the same two things and missing the same
// third. Both stamped approved_at and sent_at; neither stamped when the step
// actually finished. Those two columns only exist when a person approved
// something or something went out, so a step the platform completed on its own
// carried no date at all and could not be placed in a reporting period. The
// client activity report consequently printed "0 automated steps" over the top of
// work that had happened, which is the worst kind of wrong: it reads as evidence
// of nothing rather than as an absence of evidence.
//
// Any future path that advances a step must go through here rather than building
// its own patch, or the third copy will miss a column the same way.
const stepTransitionPatch=(to,actorLabel)=>{
  const now=new Date().toISOString();
  const p={status:to,updated_at:now};
  // Terminal states get a completion time whether a person or the platform got
  // them there. "skipped" deliberately does not: it was never completed, and the
  // report must not be able to count it as work.
  p.completed_at=(to==="done"||to==="sent")?now:null;
  if(to==="sent"||to==="approved"){p.approved_by=actorLabel;p.approved_at=now;}
  if(to==="sent")p.sent_at=now;
  return p;
};

// Must stay in step with the obligations_kind_check constraint. A kind the
// database accepts but this list omits is a kind nobody can select.
const OBLIGATION_KINDS=[
  {v:"premium",label:"Insurance premium"},{v:"tax",label:"Tax payment"},
  {v:"rmd",label:"Required distribution"},{v:"capital_call",label:"Capital call"},
  {v:"loan_payment",label:"Loan payment"},
  {v:"grat_annuity",label:"GRAT annuity"},
  {v:"note_interest",label:"Intra-family loan interest"},
  {v:"policy_review",label:"Policy review"},
  {v:"tax_document",label:"Tax document collection"},
  {v:"other",label:"Other"},
];
const RECURRENCES=[
  {v:"once",label:"One-off"},{v:"monthly",label:"Monthly"},{v:"quarterly",label:"Quarterly"},
  {v:"semiannually",label:"Twice yearly"},{v:"annually",label:"Annually"},
];
const STEP_STATUS_TINT={
  pending:{bg:"#eef0f4",text:"#4a5568"}, ready:{bg:"#e8f0f8",text:"#293d5c"},
  awaiting_approval:{bg:"rgba(206,182,132,0.28)",text:"#7a5a19"},
  approved:{bg:"#e0f0e6",text:"#1d5c34"}, sent:{bg:"#e0f5e9",text:"#0d5c2b"},
  done:{bg:"#e0f5e9",text:"#0d5c2b"}, skipped:{bg:"#f1f1ee",text:"#8a8a80"},
  blocked:{bg:"#fde8e8",text:"#8b1a1a"},
};
const statusWord=s=>({awaiting_approval:"Needs approval",ready:"Ready",pending:"Upcoming",
  // Approved is not finished. It is approved and still sitting there unsent, and the
  // label has to say so or a clear-looking queue will be hiding outstanding work.
  approved:"Approved — not sent",sent:"Sent",done:"Done",skipped:"Not required",blocked:"Blocked"}[s]||s);

// Builds one cycle from a playbook. Conditional steps whose flag isn't set are
// written as 'skipped' rather than omitted, so the record shows they were
// considered. If the cycle is being started too late for its own lead times, it
// is flagged at_risk immediately with the step that has already slipped named —
// the failure mode this is meant to prevent is discovering that in week six.
async function generateWorkflowCycle({template,obligation,dueDate,familyId}){
  const opts=obligation.options||{};
  const defs=(Array.isArray(template.steps)?template.steps:[])
    .slice().sort((a,b)=>(Number(a.offset_days)||0)-(Number(b.offset_days)||0));
  const today=todayISO();

  const rows=defs.map((s,i)=>{
    const applies=!s.requires||opts[s.requires]===true;
    const due=addDays(dueDate,s.offset_days);
    return {
      step_key:s.key||`step_${i}`, seq:i, title:s.title||`Step ${i+1}`,
      actor:s.actor||"expert", kind:s.kind||"confirm", recipient:s.recipient||null,
      due_on:due, notes:s.note||null,
      status:!applies?"skipped":(due<=today?(s.actor==="expert"?"awaiting_approval":"ready"):"pending"),
    };
  });

  const slipped=rows.filter(r=>r.status!=="skipped"&&r.due_on<today);
  const risk=slipped.length
    ? `Started late: "${slipped[0].title}" was due ${slipped[0].due_on}.`
    : null;

  const{data:inst,error}=await sb.from("workflow_instances").insert({
    template_id:template.id, obligation_id:obligation.id, family_id:familyId,
    cycle_label:`${new Date(dueDate+"T00:00:00Z").getUTCFullYear()} ${obligation.name}`,
    due_date:dueDate, resolved_options:opts,
    status:risk?"at_risk":"active", risk_note:risk,
  }).select().single();
  if(error)throw new Error(error.message);

  const{error:sErr}=await sb.from("workflow_instance_steps")
    .insert(rows.map(r=>({...r,instance_id:inst.id,family_id:familyId})));
  if(sErr)throw new Error(sErr.message);
  return inst;
}

// ── DRAFT REVIEW ─────────────────────────────────────────────────────────────
// Where a person actually reads what the AI wrote, edits it, and decides. The
// approve action is deliberately the only route to "sent": there is no path that
// dispatches a draft without someone putting their name to it.
const OUTBOUND_KINDS=["draft_email","draft_letter","draft_document"];
const isOutbound=k=>OUTBOUND_KINDS.includes(k);

function DraftReviewModal({step,onClose,onApproved,toast,userProfile}){
  const[to,setTo]=useState(step.draftTo||step.draft_to||"");
  const[cc,setCc]=useState(step.draftCc||step.draft_cc||"");
  const[subject,setSubject]=useState(step.draftSubject||step.draft_subject||"");
  const[body,setBody]=useState(step.draftBody||step.draft_body||"");
  const[drafting,setDrafting]=useState(false);
  const[busy,setBusy]=useState(false);
  const[attached,setAttached]=useState(null);
  // Why the copy line is empty, when it is. An unexplained blank field invites the
  // reviewer to assume the copy is handled.
  const[ccStatus,setCcStatus]=useState(null);
  // Recipients the firm has no record of for this client. Held here so the reviewer
  // must look at them before a second, explicit send.
  const[unknownTo,setUnknownTo]=useState(null);
  const[sentInfo,setSentInfo]=useState(null);
  const hasDraft=!!String(body||"").trim();
  const alreadySent=step.status==="sent"||!!step.sent_message_id;
  const isApproved=step.status==="approved";

  const generate=async()=>{
    setDrafting(true);
    try{
      // Send the firm name with the request. The tenant's identity lives in this
      // deployment's brand config, so it is authoritative here; the function used
      // to read it from its own env var and fell back to the product name, which
      // meant a tenant provisioned without that secret signed letters "Ordanis".
      const{data,error}=await sb.functions.invoke("draft-workflow-step",{
        body:{stepId:step.id,brandName:BRAND.name}});
      if(error)throw new Error(error.message||"Could not prepare a draft");
      if(data?.error)throw new Error(data.error);
      setTo(data.to||"");setSubject(data.subject||"");setBody(data.body||"");
      setCc(data.cc||"");setCcStatus(data.ccStatus||null);
      setAttached(data.attached||null);
      toast(data.attached?`Draft prepared — ${data.attached} attached`:"Draft prepared");
    }catch(e){toast(e.message||"Drafting failed","error");}
    setDrafting(false);
  };

  // Saving edits without approving: the reviewer can park a revision and come back.
  const persist=async(extra)=>{
    const{error}=await sb.from("workflow_instance_steps").update({
      draft_to:to||null,draft_cc:cc||null,draft_subject:subject||null,draft_body:body||null,
      updated_at:new Date().toISOString(),...extra,
    }).eq("id",step.id);
    if(error)throw new Error(error.message);
  };

  const saveOnly=async()=>{
    setBusy(true);
    try{await persist({});toast("Draft saved");onApproved&&onApproved();onClose();}
    catch(e){toast(e.message,"error");}
    setBusy(false);
  };

  // Approving and sending are separate acts, recorded separately. Approve used to
  // set status 'sent' and a sent_at timestamp while nothing was dispatched, which
  // left the record asserting a communication that never happened.
  const approveOnly=async(silent)=>{
    if(!hasDraft){toast("Prepare or write a draft first","error");return false;}
    await persist({status:"approved",approved_by:CURRENT_USER_LABEL||userProfile?.email||"—",
      approved_at:new Date().toISOString()});
    if(!silent)toast("Approved — recorded against your name. Not sent yet.");
    return true;
  };

  // Sends through the platform. `confirm` re-submits past the unknown-recipient
  // check after the reviewer has looked at the addresses.
  const doSend=async(confirm)=>{
    const{data,error}=await sb.functions.invoke("send-workflow-step",
      {body:{stepId:step.id,confirmUnverifiedRecipients:!!confirm}});
    // A 409 carrying unknownRecipients is not a failure: it is the platform asking
    // a question, because a draft recipient partly derives from document text.
    const payload=data||{};
    if(payload.needsConfirmation){setUnknownTo(payload.unknownRecipients||[]);return false;}
    if(payload.error)throw new Error(payload.error);
    if(error)throw new Error(error.message||"Could not send");
    setSentInfo(payload);
    toast(payload.alreadySent?"Already sent — not sent again"
      :`Sent${payload.attached?.length?` with ${payload.attached.length} attachment${payload.attached.length>1?"s":""}`:""}`);
    onApproved&&onApproved();
    return true;
  };

  const approveAndSend=async()=>{
    setBusy(true);
    try{
      if(await approveOnly(true)){
        if(await doSend(false))onClose();
      }
    }catch(e){toast(e.message,"error");}
    setBusy(false);
  };

  const confirmAndSend=async()=>{
    setBusy(true);
    try{ if(await doSend(true))onClose(); }
    catch(e){toast(e.message,"error");}
    setBusy(false);
  };

  const approveNoSend=async()=>{
    setBusy(true);
    try{ if(await approveOnly(false)){onApproved&&onApproved();onClose();} }
    catch(e){toast(e.message,"error");}
    setBusy(false);
  };

  return <Modal wide title={step.title} onClose={onClose}>
    <div style={{fontSize:11.5,color:B.textSoft,marginBottom:14,lineHeight:1.55}}>
      {kindLabel(step.kind)}{step.recipient?` · to ${step.recipient}`:""} · scheduled {fmt(step.dueOn||step.due_on)}
      {step.notes?<div style={{marginTop:6,color:B.textMute}}>{step.notes}</div>:null}
    </div>

    {!hasDraft&&<div style={{background:B.bg,border:`1px dashed ${B.border}`,borderRadius:10,padding:"18px",textAlign:"center",marginBottom:14}}>
      <div style={{fontSize:12.5,color:B.textSoft,marginBottom:10,lineHeight:1.55}}>
        Nothing drafted yet. Ordanis will assemble this from the obligation, the funding
        accounts and the source document on file — then you review it.
      </div>
      <Btn onClick={generate} disabled={drafting}>{drafting?"Preparing…":"✦ Prepare draft"}</Btn>
    </div>}

    {hasDraft&&<>
      <Grid2>
        <Field label="To"><Inp value={to} onChange={e=>setTo(e.target.value)} placeholder="Recipient"/></Field>
        <Field label="Subject"><Inp value={subject} onChange={e=>setSubject(e.target.value)}/></Field>
      </Grid2>
      <Field label="Cc — the family's primary contact, copied on outbound correspondence">
        <Inp value={cc} onChange={e=>setCc(e.target.value)} placeholder="Nobody copied"/>
      </Field>
      {ccStatus==="no_primary_on_file"&&<div style={{fontSize:11,color:"#7A5A19",background:"#FBF3E3",border:"1px solid #E4CE9A",borderRadius:8,padding:"8px 11px",marginBottom:12,lineHeight:1.5}}>
        This family has no primary contact designated, so nothing was copied. Set one with ★ in Members, or type an address above.
      </div>}
      {ccStatus==="addressed_directly"&&<div style={{fontSize:11,color:B.textMute,marginBottom:12,lineHeight:1.5}}>
        The primary contact is the addressee here, so they have not also been copied.
      </div>}
      <Field label="Draft — edit freely before approving">
        <textarea value={body} onChange={e=>setBody(e.target.value)} rows={16}
          style={{...inp,resize:"vertical",fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",fontSize:12.5,lineHeight:1.6}}/>
      </Field>
      {attached&&<div style={{fontSize:11.5,color:B.navy,background:"rgba(206,182,132,0.18)",border:`1px solid ${B.gold}`,borderRadius:8,padding:"8px 12px",marginBottom:12}}>
        📎 {attached} will go with this
      </div>}
      <div style={{fontSize:11,color:B.textMute,marginBottom:14,lineHeight:1.5}}>
        Square-bracketed placeholders mark anything the record could not supply — complete those before approving.
        Approving records your name and time against this step; sending goes out from this client's Ordanis Expert.
      </div>

      {/* A draft recipient is partly derived from uploaded document text, so an
          address the firm has no record of is stopped and shown before sending. */}
      {unknownTo&&unknownTo.length>0&&<div style={{fontSize:12,color:"#8b1a1a",background:"#fdeaea",border:"1px solid #f0b4b4",borderRadius:8,padding:"11px 13px",marginBottom:12,lineHeight:1.55}}>
        <div style={{fontWeight:700,marginBottom:5}}>Not on file for this client</div>
        <div style={{marginBottom:7}}>
          {unknownTo.map(e=><div key={e} style={{fontFamily:"ui-monospace, Menlo, monospace",fontSize:11.5}}>{e}</div>)}
        </div>
        Check these carefully. Draft recipients are drawn partly from uploaded documents,
        so an unexpected address here is worth pausing on. Sending will record that you
        approved an unrecognised recipient.
        <div style={{marginTop:9,display:"flex",gap:8}}>
          <Btn small variant="gold" onClick={confirmAndSend} disabled={busy}>{busy?"Sending…":"I've checked — send anyway"}</Btn>
          <Btn small variant="ghost" onClick={()=>setUnknownTo(null)} disabled={busy}>Cancel</Btn>
        </div>
      </div>}

      {step.send_error&&!alreadySent&&<div style={{fontSize:11.5,color:"#8b1a1a",background:"#fdeaea",border:"1px solid #f0b4b4",borderRadius:8,padding:"9px 12px",marginBottom:12,lineHeight:1.5}}>
        Last send attempt failed: {step.send_error}
      </div>}

      {(alreadySent||sentInfo)&&<div style={{fontSize:11.5,color:"#0d5c2b",background:"#e0f5e9",border:"1px solid #a8ddbd",borderRadius:8,padding:"9px 12px",marginBottom:12,lineHeight:1.5}}>
        Sent{step.sent_from||sentInfo?.from?` from ${step.sent_from||sentInfo.from}`:""}
        {step.sent_recipients?` · ${step.sent_recipients}`:""}
        {(step.sent_message_id||sentInfo?.messageId)?<div style={{color:B.textMute,fontSize:10.5,marginTop:3}}>Provider reference {step.sent_message_id||sentInfo.messageId}</div>:null}
      </div>}
    </>}

    <div style={{display:"flex",gap:10,justifyContent:"space-between",flexWrap:"wrap"}}>
      <div style={{display:"flex",gap:8}}>
        {hasDraft&&!alreadySent&&<Btn small variant="ghost" onClick={generate} disabled={drafting}>{drafting?"Re-drafting…":"↻ Re-draft"}</Btn>}
      </div>
      <div style={{display:"flex",gap:10}}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Close</Btn>
        {hasDraft&&!alreadySent&&<Btn variant="ghost" onClick={saveOnly} disabled={busy}>Save without approving</Btn>}
        {hasDraft&&!alreadySent&&!isApproved&&<Btn variant="ghost" onClick={approveNoSend} disabled={busy}>Approve, don't send</Btn>}
        {hasDraft&&!alreadySent&&!unknownTo&&<Btn variant="gold" onClick={isApproved?confirmAndSend:approveAndSend} disabled={busy}>
          {busy?"…":isApproved?"Send now":"Approve & send"}
        </Btn>}
      </div>
    </div>
  </Modal>;
}

// ── OBLIGATIONS + LIVE CYCLES (per family) ───────────────────────────────────
const BLANK_OBLIGATION={
  name:"",kind:"premium",amount:"",due_date:"",recurrence:"annually",
  reference_number:"",counterparty:"",grace_date:"",template_key:"",
  destination_account_id:"",source_account_id:"",notes:"",options:{},
};

function ObligationsSection({family,data,toast,canEdit,userProfile}){
  const[obs,setObs]=useState([]);
  const[templates,setTemplates]=useState([]);
  const[instances,setInstances]=useState([]);
  const[steps,setSteps]=useState([]);
  const[loading,setLoading]=useState(true);
  const[modal,setModal]=useState(null);
  const[saving,setSaving]=useState(false);
  const[openInst,setOpenInst]=useState(null);
  const[review,setReview]=useState(null);   // outbound step being read before approval
  const accounts=(data.portfolio_accounts||[]).filter(a=>a.familyId===family.id);

  const load=async()=>{
    const[o,t,i]=await Promise.all([
      sb.from("obligations").select("*").eq("family_id",family.id).order("due_date"),
      sb.from("workflow_templates").select("*").eq("active",true).order("name"),
      sb.from("workflow_instances").select("*").eq("family_id",family.id).order("due_date",{ascending:false}),
    ]);
    setObs(o.data||[]);setTemplates(t.data||[]);setInstances(i.data||[]);
    const ids=(i.data||[]).map(x=>x.id);
    if(ids.length){
      const{data:st}=await sb.from("workflow_instance_steps").select("*").in("instance_id",ids).order("seq");
      setSteps(st||[]);
    } else setSteps([]);
    setLoading(false);
  };
  useEffect(()=>{load();},[family.id]);

  const tplFor=key=>templates.find(t=>t.key===key);
  // Flags a playbook can ask about, so the form only offers relevant questions.
  const flagsFor=key=>{
    const t=tplFor(key);
    if(!t)return [];
    return [...new Set((Array.isArray(t.steps)?t.steps:[]).map(s=>s.requires).filter(Boolean))];
  };

  const save=async()=>{
    const f=modal.row;
    if(!f.name.trim()||!f.due_date){toast("Name and due date are required","error");return;}
    setSaving(true);
    const payload={
      family_id:family.id,name:f.name.trim(),kind:f.kind,
      amount:f.amount===""?null:Number(f.amount),
      due_date:f.due_date,recurrence:f.recurrence,
      reference_number:f.reference_number||null,counterparty:f.counterparty||null,
      grace_date:f.grace_date||null,template_key:f.template_key||null,
      destination_account_id:f.destination_account_id||null,
      source_account_id:f.source_account_id||null,
      notes:f.notes||null,options:f.options||{},updated_at:new Date().toISOString(),
    };
    const q=modal.isNew
      ? sb.from("obligations").insert(payload)
      : sb.from("obligations").update(payload).eq("id",f.id);
    const{error}=await q;
    if(error)toast(error.message,"error");
    else{toast(modal.isNew?"Obligation added":"Obligation saved");setModal(null);load();}
    setSaving(false);
  };

  const startCycle=async ob=>{
    const t=tplFor(ob.template_key);
    if(!t){toast("Choose a playbook on this obligation first","error");return;}
    if(instances.some(i=>i.obligation_id===ob.id&&i.due_date===ob.due_date)){
      toast("This cycle already exists","error");return;}
    try{
      const inst=await generateWorkflowCycle({template:t,obligation:ob,dueDate:ob.due_date,familyId:family.id});
      toast(inst.status==="at_risk"?"Cycle started — flagged at risk":"Cycle started");
      setOpenInst(inst.id);load();
    }catch(e){toast(e.message||"Could not start the cycle","error");}
  };

  // Approving records WHO approved it, which is the point of the gate.
  const advance=async(st,to)=>{
    const patch=stepTransitionPatch(to,CURRENT_USER_LABEL||userProfile?.email||"—");
    const{error}=await sb.from("workflow_instance_steps").update(patch).eq("id",st.id);
    if(error){toast(error.message,"error");return;}
    // Close the cycle once nothing actionable remains.
    const remaining=steps.filter(x=>x.instance_id===st.instance_id&&x.id!==st.id
      &&!["done","sent","skipped"].includes(x.status));
    if(!remaining.length&&["done","sent"].includes(to)){
      await sb.from("workflow_instances").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",st.instance_id);
      toast("Cycle complete");
    }
    load();
  };

  if(loading)return <div style={{padding:30}}><Spinner/></div>;

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:12,flexWrap:"wrap",marginBottom:6}}>
      <div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600}}>Obligations</div>
        <div style={{fontSize:12,color:B.textSoft,marginTop:2,maxWidth:640,lineHeight:1.5}}>
          Recurring commitments and the playbook that carries each one. Starting a cycle lays out every
          step with its date; outbound steps wait for your approval.
        </div>
      </div>
      {canEdit&&<Btn onClick={()=>setModal({row:{...BLANK_OBLIGATION},isNew:true})}>+ New Obligation</Btn>}
    </div>
    <GoldLine/>

    {!obs.length&&<Empty text="No obligations on file for this client yet."/>}

    <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:14}}>
      {obs.map(ob=>{
        const t=tplFor(ob.template_key);
        const cycles=instances.filter(i=>i.obligation_id===ob.id);
        return <div key={ob.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${B.navy}`,borderRadius:12,padding:"16px 18px",boxShadow:B.shadow}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:19,color:B.navy,fontWeight:600}}>{ob.name}</div>
              <div style={{fontSize:11.5,color:B.textSoft,marginTop:3}}>
                {OBLIGATION_KINDS.find(k=>k.v===ob.kind)?.label||ob.kind}
                {ob.counterparty?` · ${ob.counterparty}`:""}
                {ob.reference_number?` · ${ob.reference_number}`:""}
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600}}>{ob.amount?fmtMoney(ob.amount):"—"}</div>
              <div style={{fontSize:11,color:B.textSoft}}>due {fmt(ob.due_date)} · {RECURRENCES.find(r=>r.v===ob.recurrence)?.label}</div>
            </div>
          </div>

          <div style={{fontSize:11.5,color:B.textSoft,marginTop:10,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            {t
              ? <span style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:20,padding:"3px 10px"}}>▦ {t.name}</span>
              : <span style={{color:"#8b1a1a"}}>No playbook selected</span>}
            {Object.entries(ob.options||{}).filter(([,v])=>v===true).map(([k])=>
              <span key={k} style={{background:"rgba(206,182,132,0.20)",border:`1px solid ${B.gold}`,borderRadius:20,padding:"3px 10px",color:"#7a5a19"}}>{k.replace(/_/g," ")}</span>)}
          </div>

          <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:12}}>
            {canEdit&&<Btn small variant="ghost" onClick={()=>setModal({row:{...ob,amount:ob.amount??"",options:ob.options||{}},isNew:false})}>Edit</Btn>}
            {canEdit&&t&&<Btn small variant="gold" onClick={()=>startCycle(ob)}>▶ Start cycle</Btn>}
          </div>

          {cycles.map(inst=>{
            const mine=steps.filter(s=>s.instance_id===inst.id);
            const open=openInst===inst.id;
            const doneCount=mine.filter(s=>["done","sent","skipped"].includes(s.status)).length;
            return <div key={inst.id} style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${B.borderLight}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{fontSize:12.5,color:B.text,fontWeight:600}}>
                  {inst.cycle_label}
                  <span style={{marginLeft:8,fontSize:10.5,fontWeight:600,borderRadius:20,padding:"2px 9px",
                    background:inst.status==="at_risk"?"#fde8e8":inst.status==="completed"?"#e0f5e9":"#e8f0f8",
                    color:inst.status==="at_risk"?"#8b1a1a":inst.status==="completed"?"#0d5c2b":"#293d5c"}}>
                    {inst.status==="at_risk"?"At risk":inst.status==="completed"?"Complete":"In progress"}
                  </span>
                  <span style={{marginLeft:8,fontSize:11,color:B.textMute}}>{doneCount}/{mine.length} steps</span>
                </div>
                <Btn small variant="ghost" onClick={()=>setOpenInst(open?null:inst.id)}>{open?"Hide":"View timeline"}</Btn>
              </div>
              {inst.risk_note&&<div style={{fontSize:11.5,color:"#8b1a1a",marginTop:5}}>{inst.risk_note}</div>}

              {open&&<div style={{marginTop:10}}>
                {mine.map(s=>{
                  const tint=STEP_STATUS_TINT[s.status]||STEP_STATUS_TINT.pending;
                  const outbound=["draft_email","draft_letter","draft_document"].includes(s.kind);
                  const finished=["done","sent","skipped"].includes(s.status);
                  return <div key={s.id} style={{display:"flex",gap:11,alignItems:"flex-start",padding:"8px 0",borderBottom:`1px solid ${B.borderLight}`}}>
                    <div style={{minWidth:74,fontSize:11,color:B.textSoft,paddingTop:3}}>{fmt(s.due_on)}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12.5,color:B.text,fontWeight:600}}>{s.title}</div>
                      <div style={{fontSize:11,color:B.textSoft,marginTop:2}}>
                        {actorLabel(s.actor)} · {kindLabel(s.kind)}{s.recipient?` · to ${s.recipient}`:""}
                        {s.approved_by?` · approved by ${s.approved_by}`:""}
                      </div>
                    </div>
                    <span style={{fontSize:10,fontWeight:700,borderRadius:20,padding:"3px 9px",background:tint.bg,color:tint.text,whiteSpace:"nowrap"}}>{statusWord(s.status)}</span>
                    {canEdit&&!finished&&<Btn small variant={outbound?"gold":"ghost"}
                      onClick={()=>outbound?setReview(s):advance(s,"done")}>
                      {outbound?(s.status==="approved"?"Send":s.draft_body?"Review draft":"Prepare draft"):"Mark done"}
                    </Btn>}
                  </div>;
                })}
              </div>}
            </div>;
          })}
        </div>;
      })}
    </div>

    {review&&<DraftReviewModal step={review} toast={toast} userProfile={userProfile}
      onClose={()=>setReview(null)} onApproved={load}/>}

    {modal&&<Modal wide title={modal.isNew?"New Obligation":`Edit — ${modal.row.name}`} onClose={()=>setModal(null)}>
      <Grid2>
        <Field label="Name"><Inp value={modal.row.name} onChange={e=>setModal(m=>({...m,row:{...m.row,name:e.target.value}}))} placeholder="ILIT premium — Pacific Life"/></Field>
        <Field label="Type"><Sel value={modal.row.kind} onChange={e=>setModal(m=>({...m,row:{...m.row,kind:e.target.value}}))}>{OBLIGATION_KINDS.map(k=><option key={k.v} value={k.v}>{k.label}</option>)}</Sel></Field>
        <Field label="Amount"><MoneyInput value={modal.row.amount} onChange={v=>setModal(m=>({...m,row:{...m.row,amount:v}}))} placeholder="48,000"/></Field>
        <Field label="Due date"><Inp type="date" value={modal.row.due_date||""} onChange={e=>setModal(m=>({...m,row:{...m.row,due_date:e.target.value}}))}/></Field>
        <Field label="Recurrence"><Sel value={modal.row.recurrence} onChange={e=>setModal(m=>({...m,row:{...m.row,recurrence:e.target.value}}))}>{RECURRENCES.map(r=><option key={r.v} value={r.v}>{r.label}</option>)}</Sel></Field>
        <Field label="Grace date (if later)"><Inp type="date" value={modal.row.grace_date||""} onChange={e=>setModal(m=>({...m,row:{...m.row,grace_date:e.target.value}}))}/></Field>
        <Field label="Counterparty"><Inp value={modal.row.counterparty||""} onChange={e=>setModal(m=>({...m,row:{...m.row,counterparty:e.target.value}}))} placeholder="Pacific Life"/></Field>
        <Field label="Reference (policy no., EIN, fund)"><Inp value={modal.row.reference_number||""} onChange={e=>setModal(m=>({...m,row:{...m.row,reference_number:e.target.value}}))}/></Field>
      </Grid2>

      <SectionLabel>Funding</SectionLabel>
      <Grid2>
        <Field label="Money comes from">
          <Sel value={modal.row.source_account_id||""} onChange={e=>setModal(m=>({...m,row:{...m.row,source_account_id:e.target.value}}))}>
            <option value="">— not tracked —</option>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.institution} · {a.accountType}</option>)}
          </Sel>
        </Field>
        <Field label="Money goes to">
          <Sel value={modal.row.destination_account_id||""} onChange={e=>setModal(m=>({...m,row:{...m.row,destination_account_id:e.target.value}}))}>
            <option value="">— not tracked —</option>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.institution} · {a.accountType}</option>)}
          </Sel>
        </Field>
      </Grid2>

      <SectionLabel>Playbook</SectionLabel>
      <Field label="Which workflow carries this">
        <Sel value={modal.row.template_key||""} onChange={e=>setModal(m=>({...m,row:{...m.row,template_key:e.target.value}}))}>
          <option value="">— none, track the date only —</option>
          {templates.map(t=><option key={t.key} value={t.key}>{t.name}</option>)}
        </Sel>
      </Field>
      {/* Conditional questions are asked HERE, before any cycle exists, because
          the answer changes every downstream date. */}
      {flagsFor(modal.row.template_key).map(flag=>
        <label key={flag} style={{display:"flex",gap:9,alignItems:"flex-start",background:B.bg,border:`1px solid ${B.border}`,borderRadius:8,padding:"10px 13px",marginBottom:10,cursor:"pointer"}}>
          <input type="checkbox" checked={!!(modal.row.options||{})[flag]}
            onChange={e=>setModal(m=>({...m,row:{...m.row,options:{...(m.row.options||{}),[flag]:e.target.checked}}}))}
            style={{marginTop:2}}/>
          <span style={{fontSize:12.5,color:B.text}}>
            <strong style={{textTransform:"capitalize"}}>{flag.replace(/_/g," ")}</strong>
            <span style={{display:"block",fontSize:11,color:B.textSoft,marginTop:2}}>
              Answered before a cycle starts, because it changes the schedule. Steps that depend on it are skipped when unticked, and stay visible as "not required".
            </span>
          </span>
        </label>)}

      <Field label="Notes"><textarea value={modal.row.notes||""} onChange={e=>setModal(m=>({...m,row:{...m.row,notes:e.target.value}}))} rows={2} style={{...inp,resize:"vertical",fontFamily:"inherit"}}/></Field>

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn variant="ghost" onClick={()=>setModal(null)} disabled={saving}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving?"Saving…":modal.isNew?"Add obligation":"Save"}</Btn>
      </div>
    </Modal>}
  </div>;
}

// ── WORKFLOW TEMPLATE LIBRARY ────────────────────────────────────────────────
// The playbooks behind recurring obligations. Read-only for Ordanis Experts and
// Partners so they can see exactly what a workflow will do before it runs;
// editable by admins, because changing a lead time changes what happens to real
// client money.
const STEP_ACTORS=[
  {v:"ai",      label:"AI prepares"},
  {v:"expert",  label:"Expert acts"},
  {v:"external",label:"Waiting on someone else"},
];
const STEP_KINDS=[
  {v:"extract",       label:"Read a document"},
  {v:"check",         label:"Verify / sanity-check"},
  {v:"draft_document",label:"Draft a document"},
  {v:"draft_email",   label:"Draft an email"},
  {v:"draft_letter",  label:"Draft a letter"},
  {v:"confirm",       label:"Confirm something happened"},
  {v:"file",          label:"File / record"},
];
const STEP_RECIPIENTS=["","bank","grantor","beneficiaries","trustee","carrier","internal"];
const actorLabel=v=>STEP_ACTORS.find(a=>a.v===v)?.label||v;
const kindLabel=v=>STEP_KINDS.find(a=>a.v===v)?.label||v;
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

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(320px,100%),1fr))",gap:14,marginTop:14}}>
      {rows.map(t=>{
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
  {key:"user_guide",label:"Ordanis Expert User Guide",required:[],legal:false},
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
      Pre-fills the Client Services Agreement and the Auto-Debit form. A Ordanis Expert can change either figure
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
      letterhead — the agreement defines the contracting party and the ACH form authorises debits to a named bank.
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

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:18}}>
      <div>
        <div style={{fontSize:13,color:B.textSoft,maxWidth:620,lineHeight:1.5}}>
          Save a brand for each firm you're pitching and switch the whole platform over in one click —
          logo, name, colours, and exported reports. Nothing here touches client data.
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

      <SectionLabel>Colours</SectionLabel>
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
  </div>;
}

const NAV_SECTIONS=[
  {section:"CLIENT MANAGEMENT",items:[
    {id:"dashboard",label:"Dashboard",icon:"⬡"},
    {id:"families", label:"Families", icon:"⌂"},
    {id:"portfolio",label:"Portfolio",icon:"◇"},
    {id:"cm-notes", label:"Notes",    icon:"◧"},
    {id:"cm-tasks", label:"Tasks",    icon:"◻"},
  ]},
  // PROSPECTING_REMOVED
  // The Prospecting section (Contacts / Pipeline / Notes / Tasks) is gone for
  // every role, admins included. It was previously admin-only, which meant the
  // product looked like it had a prospecting CRM or not depending on who was
  // signed in. Ordanis is a family office administrative platform; lead
  // management belongs in whatever CRM the firm already runs.
  {section:"RESOURCES",items:[
    {id:"resources",label:"Resources",icon:"▥"},
  ]},
  {section:"ADMIN",items:[
    {id:"users",label:"Users",icon:"⊕"},
    // Only surfaced on instances running database-driven branding (the demo /
    // pitch instance); a normal tenant deploy has no use for it.
    ...(BRAND_ADMIN?[{id:"branding",label:"Branding",icon:"◐"}]:[]),
  ]},
];
const ALL_NAV=NAV_SECTIONS.flatMap(s=>s.items);

// ── APP ────────────────────────────────────────────────────────────────────────
export default function App(){
  const[tab,setTab]=useState("dashboard");
  const[data,setData]=useState({families:[],contacts:[],properties:[],deals:[],notes:[],tasks:[],portfolio_accounts:[],valuables:[],documents:[],cash_flow_events:[],cash_flow_payment_log:[],note_attachments:[]});
  const[loading,setLoading]=useState(true);
  const[toastState,setToastState]=useState(null);
  const[authed,setAuthed]=useState(false);
  const[userProfile,setUserProfile]=useState(null);
  const[authLoading,setAuthLoading]=useState(true);
  const[sidebarOpen,setSidebarOpen]=useState(false);
  // Runtime branding must be applied before the first paint, otherwise the login
  // screen would flash the previous tenant's colours. Instances without
  // VITE_BRAND_RUNTIME resolve immediately and never wait on a request.
  const[brandReady,setBrandReady]=useState(!RUNTIME_BRAND);
  const isAdminRole=userProfile?.role==="admin";
  // Which nav items this role may actually reach. Derived from the same filter
  // the sidebar uses so the two can't drift apart.
  const allowedTabIds=NAV_SECTIONS
    .filter(s=>(s.section!=="ADMIN"&&s.section!=="PROSPECTING")||isAdminRole)
    .flatMap(s=>s.items.map(i=>i.id));
  // Bumped on every sidebar nav click (even re-clicking the current section) and
  // used as a remount `key` for the active view below. This forces views like
  // FamiliesView to drop any drilled-in state (e.g. an open family dashboard)
  // and return to their top-level list — clicking "Families" while inside a
  // family's dashboard should always bounce you back out, same for every item.
  const[navNonce,setNavNonce]=useState(0);
  // A one-shot request to open a particular family, cleared as soon as it lands.
  const[navIntent,setNavIntent]=useState(null);
  const isMobile=useIsMobile();
  // Reset the view on the way out so nothing from this session is left on screen
  // for whoever signs in next.
  const logout=async()=>{await sb.auth.signOut();setAuthed(false);setUserProfile(null);setTab("dashboard");};
  const showToast=useCallback((msg,type="success")=>{setToastState({msg,type});setTimeout(()=>setToastState(null),3500);},[]);

  const profileRef=useRef(null);
  const allowedFamilyIdsRef=useRef(null); // null = unrestricted (admin)

  const loadProfile=useCallback(async userId=>{
    const{data:d}=await sb.from("user_profiles").select("*").eq("id",userId).single();
    if(d){
      const p={id:d.id,email:d.email,role:d.role,fullName:d.full_name,active:d.active,familyId:d.family_id,canRunScheduledPrompts:!!d.can_run_scheduled_prompts};
      profileRef.current=p;
      // Supabase re-emits auth events whenever the browser tab regains focus, so
      // this runs again every time the user comes back from another tab. Keep the
      // previous object when nothing actually changed — replacing it re-renders
      // the whole app for no reason, which is what was interrupting open forms.
      setUserProfile(prev=>prev&&JSON.stringify(prev)===JSON.stringify(p)?prev:p);
      CURRENT_USER_LABEL=(d.full_name||d.email||"").trim();
    }
  },[]);

  useEffect(()=>{
    if(!RUNTIME_BRAND)return;
    let cancelled=false;
    loadActiveBrandProfile().finally(()=>{if(!cancelled)setBrandReady(true);});
    return()=>{cancelled=true;};
  },[]);

  // Send the user back to the dashboard whenever the current tab isn't one their
  // role is allowed to open — which is what happens after a sign-out/sign-in,
  // since this component (and therefore `tab`) is never torn down.
  useEffect(()=>{
    if(!userProfile)return;
    if(!allowedTabIds.includes(tab))setTab("dashboard");
  },[userProfile,tab,allowedTabIds]);

  useEffect(()=>{
    sb.auth.getSession().then(({data:{session}})=>{if(session?.user){setAuthed(true);loadProfile(session.user.id);}setAuthLoading(false);});
    const{data:{subscription}}=sb.auth.onAuthStateChange((_,session)=>{if(session?.user){setAuthed(true);loadProfile(session.user.id);}else{setAuthed(false);setUserProfile(null);}setAuthLoading(false);});
    return()=>subscription.unsubscribe();
  },[loadProfile]);

  const fetchTable=useCallback(async table=>{
    const prof=profileRef.current;
    let q=sb.from(table).select("*").order("created_at",{ascending:false});
    if(prof?.role==="advisor"){
      if(table==="families"){
        q=q.eq("advisor_email",prof.email);
      } else if(FAMILY_SCOPED.includes(table)){
        const ids=allowedFamilyIdsRef.current||[];
        const idList=ids.length?ids.join(","):"00000000-0000-0000-0000-000000000000";
        q=q.or(`family_id.is.null,family_id.in.(${idList})`);
      }
    } else if(prof?.role==="client"){
      // A client may only ever load their OWN family's data. Without this,
      // select("*") would pull every family's rows into the client's browser.
      const fid=prof.familyId||"00000000-0000-0000-0000-000000000000";
      if(table==="families"){
        q=q.eq("id",fid);
      } else if(FAMILY_SCOPED.includes(table)){
        q=q.eq("family_id",fid);
      } else {
        // Non-family-scoped tables (e.g. note_attachments) aren't used by the
        // client UI; don't load them at all.
        setData(p=>({...p,[table]:[]}));
        return;
      }
    }
    const{data:rows,error}=await q;
    if(error){showToast(`Error loading ${table}`,"error");return;}
    if(table==="families"&&prof?.role==="advisor")allowedFamilyIdsRef.current=rows.map(r=>r.id);
    setData(p=>({...p,[table]:rows.map(toClient)}));
  },[showToast]);

  const reload=useCallback(async table=>{
    if(table){await fetchTable(table);return;}
    await fetchTable("families"); // load families first so allowed-id cache is set
    await Promise.all(TABLES.filter(t=>t!=="families").map(fetchTable));
  },[fetchTable]);

  useEffect(()=>{
    if(!authed||!userProfile)return;
    (async()=>{
      setLoading(true);
      if(userProfile.role==="client"){
        // Client: only load their family's data
        await Promise.all(TABLES.map(fetchTable));
      } else {
        await reload();
      }
      setLoading(false);
    })();
  },[authed,userProfile]);

  const _isAdmin=userProfile?.role==="admin";
  const _myEmail=(userProfile?.email||"").toLowerCase();
  const _contactAdv=id=>{const c=data.contacts.find(x=>x.id===id);return (c?.advisorEmail||"").toLowerCase();};
  const _dealAdv=d=>(d.advisorEmail||"").toLowerCase();
  const _mine=e=>_isAdmin||(!!e&&e===_myEmail);
  const cmStats={families:data.families.length,portfolio:(data.portfolio_accounts||[]).length,"cm-notes":data.notes.filter(n=>n.familyId).length,"cm-tasks":data.tasks.filter(t=>t.familyId&&!t.done).length};
  const pStats={"p-contacts":data.contacts.filter(c=>!c.familyId&&_mine((c.advisorEmail||"").toLowerCase())).length,"p-pipeline":data.deals.filter(d=>!d.familyId&&d.stage!=="Closed Lost"&&_mine(_dealAdv(d))).length,"p-notes":data.notes.filter(n=>!n.familyId&&_mine(_contactAdv(n.contactId))).length,"p-tasks":data.tasks.filter(t=>!t.familyId&&!t.done&&_mine(_contactAdv(t.contactId))).length};
  const allStats={...cmStats,...pStats,users:0};
  const overdue=data.tasks.filter(t=>t.familyId&&!t.done&&t.dueDate&&new Date(t.dueDate)<new Date()).length;
  const currentLabel=ALL_NAV.find(n=>n.id===tab)?.label||"";
  const currentSection=NAV_SECTIONS.find(s=>s.items.some(i=>i.id===tab))?.section||"";

  // Hold the first paint until runtime branding has resolved, so the login
  // screen never flashes the previously active tenant's colours or logo.
  if(!brandReady||authLoading)return <div style={{minHeight:"100vh",background:B.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><Spinner/></div>;
  if(!authed||!userProfile)return <LoginScreen/>;
  if(userProfile.active===false)return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:B.bg,fontFamily:"'DM Sans',sans-serif",color:B.navy,fontSize:16,flexDirection:"column",gap:12}}><div style={{fontSize:40}}>🔒</div>Your account has been deactivated. Contact your administrator.</div>;

  // Client role — show read-only family dashboard
  if(userProfile.role==="client"){
    const clientFamily=data.families.find(f=>f.id===userProfile.familyId);
    if(loading)return <div style={{minHeight:"100vh",background:B.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><Spinner/></div>;
    if(!clientFamily)return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:B.bg,flexDirection:"column",gap:12,color:B.navy,fontFamily:"'DM Sans',sans-serif"}}><PCMLogo/><div style={{marginTop:20,fontSize:16}}>No family assigned to your account. Contact your Ordanis Expert.</div><button onClick={logout} style={{marginTop:12,background:"none",border:`1px solid ${B.border}`,borderRadius:8,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit",color:B.textSoft}}>Sign Out</button></div>;
    return <><ClientDashboard family={clientFamily} data={data} userProfile={userProfile} logout={logout} toast={showToast} reload={reload}/><FloatingAssistant family={clientFamily} data={data} reload={reload} toast={showToast} userProfile={userProfile}/>{toastState&&<Toast msg={toastState.msg} type={toastState.type}/>}<UpdateBanner/></>;
  }

  // Partner role — view-only across their linked family/families; can upload/download documents only
  if(userProfile.role==="partner"){
    if(loading)return <div style={{minHeight:"100vh",background:B.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><Spinner/></div>;
    return <><PartnerDashboard data={data} userProfile={userProfile} logout={logout} toast={showToast} reload={reload}/><FloatingAssistant families={data.families||[]} data={data} reload={reload} toast={showToast} userProfile={userProfile}/>{toastState&&<Toast msg={toastState.msg} type={toastState.type}/>}<UpdateBanner/></>;
  }


  // For families tab, header shows differently when inside a family dashboard
  const isFamiliesTab=tab==="families";

  return <div style={{display:"flex",height:"100vh",background:B.bg,fontFamily:"'DM Sans','Helvetica Neue',sans-serif",color:B.text,overflow:"hidden",flexDirection:"row"}}>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>

    {/* Mobile backdrop */}
    {isMobile&&sidebarOpen&&<div onClick={()=>setSidebarOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:99,backdropFilter:"blur(2px)"}}/>}

    {/* Sidebar */}
    <div style={{width:isMobile?260:232,background:B.white,borderRight:`1px solid ${B.borderLight}`,display:"flex",flexDirection:"column",flexShrink:0,position:isMobile?"fixed":"relative",top:0,bottom:0,left:isMobile?(sidebarOpen?0:-280):0,zIndex:100,transition:isMobile?"left 0.25s ease":"none",boxShadow:isMobile&&sidebarOpen?"4px 0 24px rgba(0,0,0,0.15)":"none"}}>
      <div style={{padding:"14px 16px 12px",borderBottom:`1px solid ${B.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
        <div style={{flex:1}}>
          <PCMLogo compact/>
          {/* SIDEBAR_TAGLINE_REMOVED — the lockup artwork already contains
              the tagline, so a text line here printed it twice. */}
        </div>
        {isMobile&&<button onClick={()=>setSidebarOpen(false)} style={{background:"none",border:"none",color:B.textMute,fontSize:22,cursor:"pointer",padding:4,marginTop:-2}}>✕</button>}
      </div>
      <nav style={{flex:1,padding:"8px",overflowY:"auto"}}>
        {NAV_SECTIONS.filter(s=>(s.section!=="ADMIN"&&s.section!=="PROSPECTING")||userProfile?.role==="admin").map(({section,items})=><div key={section} style={{marginBottom:10}}>
          <div style={{fontSize:9,fontWeight:800,color:B.textMute,letterSpacing:"0.16em",padding:"10px 10px 6px",textTransform:"uppercase"}}>{section}</div>
          {items.map(item=><button key={item.id} onClick={()=>{setTab(item.id);setNavNonce(n=>n+1);if(isMobile)setSidebarOpen(false);}} style={{width:"100%",display:"flex",alignItems:"center",gap:9,padding:isMobile?"13px 14px":"10px 14px",borderRadius:8,border:`1px solid ${tab===item.id?B.gold:"transparent"}`,cursor:"pointer",background:tab===item.id?"rgba(206,182,132,0.13)":"transparent",color:tab===item.id?B.navy:B.textMid,fontFamily:"inherit",fontSize:isMobile?15:13,fontWeight:tab===item.id?700:400,marginBottom:6,textAlign:"left"}}>
            <span style={{flex:1}}>{item.label}</span>
            {item.id==="cm-tasks"&&overdue>0?<span style={{background:"#d43030",borderRadius:10,padding:"1px 6px",fontSize:9,color:"#fff",fontWeight:700}}>{overdue}</span>:allStats[item.id]>0?<span style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"1px 6px",fontSize:9,color:B.textMid}}>{allStats[item.id]}</span>:null}
          </button>)}
        </div>)}
      </nav>
      <div style={{padding:"10px 16px",borderTop:`1px solid ${B.borderLight}`}}>
        {userProfile&&<div style={{marginBottom:8}}><div style={{fontSize:11,color:B.navy,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userProfile.fullName||userProfile.email}</div><div style={{fontSize:9,color:B.navyMid,letterSpacing:"0.1em",textTransform:"uppercase",marginTop:1}}>{roleLabel(userProfile.role)}</div></div>}
        <div style={{fontSize:9,color:B.textMute,marginBottom:4}}>{data.families.length} families · {(data.portfolio_accounts||[]).length} accounts</div>
        <div style={{display:"flex",justifyContent:"space-between"}}>
          <button onClick={()=>reload()} style={{background:"none",border:"none",color:B.navyMid,fontSize:9,cursor:"pointer",padding:0,fontFamily:"inherit"}}>↺ Refresh</button>
          <button onClick={logout} style={{background:"none",border:"none",color:B.textMute,fontSize:9,cursor:"pointer",padding:0,fontFamily:"inherit"}}>Sign Out</button>
        </div>
      </div>
    </div>

    {/* Main */}
    <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>
      {/* Only show header when NOT in families tab (family dashboard has its own header) */}
      {tab!=="families"&&<>
        <div style={{padding:isMobile?"10px 14px":"13px 28px 11px",borderBottom:`1px solid ${B.borderLight}`,background:B.white,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0,flex:1}}>
            {isMobile&&<button onClick={()=>setSidebarOpen(true)} style={{background:"none",border:"none",cursor:"pointer",padding:6,fontSize:22,color:B.navy,flexShrink:0,display:"flex",alignItems:"center"}} aria-label="Open menu">☰</button>}
            <div style={{minWidth:0}}>
              {!isMobile&&<div style={{fontSize:9,color:B.textMute,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:1}}>{currentSection}</div>}
              <h1 style={{margin:0,fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?18:22,color:B.navy,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentLabel}</h1>
            </div>
          </div>
          {!isMobile&&<div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{fontSize:11,color:B.textMute}}>{new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
            {userProfile&&<div style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:20,padding:"4px 12px",display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:"#18a850"}}/>
              <span style={{fontSize:11,color:B.textMid,fontWeight:600}}>{userProfile.fullName||userProfile.email}</span>
              <span style={{fontSize:10,color:B.textMute,background:B.borderLight,borderRadius:10,padding:"1px 6px"}}>{roleLabel(userProfile.role)}</span>
            </div>}
          </div>}
        </div>
        <div style={{height:2,background:`linear-gradient(90deg,${B.gold},${B.goldLight}55,transparent)`}}/>
      </>}

      {/* Mobile-only floating hamburger when in families tab (which has its own header) */}
      {isMobile&&tab==="families"&&<button onClick={()=>setSidebarOpen(true)} style={{position:"fixed",top:14,left:14,zIndex:50,background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:8,padding:"8px 10px",fontSize:18,color:B.navy,cursor:"pointer",boxShadow:B.shadow,display:"flex",alignItems:"center"}} aria-label="Open menu">☰</button>}

      <div style={{flex:1,minHeight:0,overflow:"hidden",background:B.bg,paddingBottom:"0"}}>
        {loading&&tab!=="families"&&tab!=="users"?<Spinner/>:<>
          {tab==="dashboard"   &&<Dashboard key={navNonce} data={data} userProfile={userProfile} reload={reload} toast={showToast} onOpenFamily={(familyId,subTab)=>{setNavIntent({familyId,subTab});setTab("families");}}/>}
          {tab==="families"    &&<FamiliesView key={navNonce} data={data} reload={reload} toast={showToast} userProfile={userProfile} navIntent={navIntent} onNavConsumed={()=>setNavIntent(null)}/>}
          {tab==="portfolio"   &&<PortfolioView key={navNonce} data={data} reload={reload} toast={showToast} userProfile={userProfile}/>}
          {tab==="cm-notes"    &&<NotesView key={navNonce} data={{...data,notes:data.notes.filter(n=>n.familyId)}} reload={reload} toast={showToast} userProfile={userProfile}/>}
          {tab==="cm-tasks"    &&<TasksView key={navNonce} data={{...data,tasks:data.tasks.filter(t=>t.familyId)}} reload={reload} toast={showToast} userProfile={userProfile}/>}
          {/* Admin-only screens are gated on the role here as well as in the
              sidebar. The sidebar alone isn't sufficient: `tab` is state on a
              component that never unmounts, so it survives a sign-out and the
              next user would otherwise land on whatever the previous one had
              open. */}
          {tab==="users"       &&isAdminRole&&<UserManagementView key={navNonce} userProfile={userProfile} data={data} toast={showToast}/>}
          {tab==="branding"    &&isAdminRole&&BRAND_ADMIN&&<BrandingView key={navNonce} toast={showToast}/>}
          {tab==="resources"   &&<ResourcesView key={navNonce} data={data} userProfile={userProfile} toast={showToast}/>}
          {tab==="p-contacts"  &&<ProspectContactsView key={navNonce} data={data} reload={reload} toast={showToast} userProfile={userProfile}/>}
          {tab==="p-pipeline"  &&<ProspectPipelineView key={navNonce} data={data} reload={reload} toast={showToast} userProfile={userProfile}/>}
          {tab==="p-notes"     &&<NotesView key={navNonce} data={{...data,notes:data.notes.filter(n=>!n.familyId),families:[]}} reload={reload} toast={showToast} userProfile={userProfile} prospectMode={true}/>}
          {tab==="p-tasks"     &&<TasksView key={navNonce} data={{...data,tasks:data.tasks.filter(t=>!t.familyId),families:[]}} reload={reload} toast={showToast} userProfile={userProfile} prospectMode={true}/>}
        </>}
      </div>
    </div>
    <FloatingAssistant families={data.families||[]} data={data} reload={reload} toast={showToast} userProfile={userProfile}/>
    {toastState&&<Toast msg={toastState.msg} type={toastState.type}/>}<UpdateBanner/>
  </div>;
}
