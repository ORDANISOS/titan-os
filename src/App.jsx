// PCM Family Office Platform — App.jsx
// BUILD 2026-05-05 · Cash Flow (income+expenses+reorder) · MoneyInput commas · smart chart axis · client read-only · mobile
import { useState, useEffect, useMemo, useCallback, useRef, useId, Component, Fragment, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@supabase/supabase-js";
import { buildActivityReportPdf, AR_PERIODS, fig as arFig } from "./activityReport.js";
import { derivePropertyEvents, findProbableDuplicates } from "./propertyCashFlow.js";
import { validateFolderName, buildFolderRows, folderSummary, canDeleteFolder } from "./vaultFolders.js";
import { PLANS, PLAN_BLURB, normalisePlan, planAllows, planLabel, planIsSelfServe } from "./plans.js";
import { Capacitor } from "@capacitor/core";
import { useBiometricSetting } from "./BiometricLock.jsx";
import { STARTUP_SOUND_KEY, startupSoundOn } from "./AppAccessGate.jsx";
import { setInPortal } from "./nativeChrome.js";

// ── STAFF SCREENS: A SEPARATE DOWNLOAD (scaling step 3) ───────────────────────
// Everything only staff, firm administrators and partners use lives in staff.jsx and is fetched the first time one
// of these screens is drawn, so a client's phone never downloads it. Each name below stands in for the real screen.
// If the download fails (an update was deployed since this page opened), the page reloads once to pick up the new
// version instead of showing a broken screen.
const loadStaffModule=()=>import("./staff.jsx").catch(e=>{
  try{if(!sessionStorage.getItem("ordanis-staff-reload")){sessionStorage.setItem("ordanis-staff-reload","1");window.location.reload();return new Promise(()=>{});}}catch(_e){}
  throw e;
});
const lazyStaff=name=>lazy(()=>loadStaffModule().then(m=>{try{sessionStorage.removeItem("ordanis-staff-reload");}catch(_e){}return{default:m[name]};}));
const BrandingView=lazyStaff("BrandingView");
const Dashboard=lazyStaff("Dashboard");
const DashboardOnDemand=lazyStaff("DashboardOnDemand");
const EnterprisesView=lazyStaff("EnterprisesView");
const FamiliesPagedView=lazyStaff("FamiliesPagedView");
const FamiliesView=lazyStaff("FamiliesView");
const FirmBillingView=lazyStaff("FirmBillingView");
const NotesView=lazyStaff("NotesView");
const PlanRequestsView=lazyStaff("PlanRequestsView");
const PortfolioView=lazyStaff("PortfolioView");
const ProspectContactsView=lazyStaff("ProspectContactsView");
const ProspectPipelineView=lazyStaff("ProspectPipelineView");
const ResourcesView=lazyStaff("ResourcesView");
const ScopedStaffView=lazyStaff("ScopedStaffView");
const SignupsOnDemand=lazyStaff("SignupsOnDemand");
const SignupsRevenueView=lazyStaff("SignupsRevenueView");
const StateRulesView=lazyStaff("StateRulesView");
const TasksView=lazyStaff("TasksView");
const UserManagementView=lazyStaff("UserManagementView");
const UtilizationView=lazyStaff("UtilizationView");
const WithAllFamilies=lazyStaff("WithAllFamilies");
const FirmDashboard=lazyStaff("FirmDashboard");
const PartnerDashboard=lazyStaff("PartnerDashboard");

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
// deployed as a white-label instance (e.g. ORDANIS demo) from a second Vercel
// project with different VITE_* env vars — with NO env vars set, everything
// defaults to the PCM production values below, so this deploy is unaffected.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://unkirihxtruhdjeldfpm.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVua2lyaWh4dHJ1aGRqZWxkZnBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTA3MjUsImV4cCI6MjA5MTcyNjcyNX0._Ve9Pr3ooja-YdHYFIupebaZRhDjmJDnz2b-vzrhY04";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
// An email invite (invite-client, firm enroll: inviteUserByEmail) lands with "type=invite" in the URL hash.
// supabase-js signs the person in and clears the hash, firing SIGNED_IN rather than PASSWORD_RECOVERY, so nothing
// asked them to choose a password and they could never sign back in. Read here, while the hash is still there,
// and used once (below) to show "Set your password".
let ARRIVED_FROM_INVITE=typeof window!=="undefined"&&/(^|[#&?])type=invite(&|$)/.test(window.location.hash||"");

// ── WHITE-LABEL BRAND CONFIG ─────────────────────────────────────────────────
// ORDANIS is the product. Every deployment — including PCM's own — is a tenant
// that supplies its own identity through these env vars; with none set you get
// plain ORDANIS. (PCM_LOGO/PCM_MARK stay bundled only as the last-resort image
// fallback so the app never renders a broken logo.)
const BRAND = {
  name: import.meta.env.VITE_BRAND_NAME || "ORDANIS",
  short: import.meta.env.VITE_BRAND_SHORT || "ORDANIS",
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
// Set VITE_HIDE_SIGNUP=1 on the demo only: the login screen drops its "Create an Account" link, and
// main.jsx sends /signup to the login screen. Unset (the default, and production) changes nothing.
const HIDE_SIGNUP = String(import.meta.env.VITE_HIDE_SIGNUP||"")==="1"||Capacitor.isNativePlatform();
// INSIDE THE IPHONE / ANDROID APP (Capacitor), nothing is bought (Will, 2026-10-29). Apple and Google take 15-30% of
// digital purchases made inside an app, so every paid action (plan changes, adding a card, extra workflows, the $25
// Expert, professional seats) sends the person to the ORDANIS website in their browser, where Stripe handles it as it
// does today. Linking out to web checkout is allowed in the US App Store and Google Play; the app is meant for the US
// storefronts only. Firm-paid households are billed on the firm's invoice, so their in-app approvals stay as they are.
// The website itself is unchanged: IS_NATIVE_APP is false there.
const IS_NATIVE_APP = Capacitor.isNativePlatform();
// In the app, everything before the portal (sign-in, authenticator, set password, loading) sits on navy (Will).
// A getter, because the brand runtime can change B.bg after load; the website keeps exactly B.bg.
const preBg = () => (IS_NATIVE_APP ? "#0A2540" : B.bg);
// Full-height layouts (the staff portal and the partner / firm views). In the app the page already leaves room for
// the notch and the home indicator (#root padding in index.html), so they fill the space between, not 100vh; a
// 100vh layout made the page taller than the screen and it could scroll up under the status bar.
const FULL_H = IS_NATIVE_APP ? "calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom))" : "100vh";
const WEB_PORTAL_URL = String(import.meta.env.VITE_WEB_PORTAL_URL||"https://portal.ordanisos.com").replace(/\/+$/,"");
// Opens the website in the phone's browser on the given family-portal tab (?go=billing, ?go=workflows, ?go=household),
// already signed in: the app-web-handoff function gives a single-use sign-in pass for this same person, carried after
// "#" so it never reaches a server log (Will, 2026-10-30). If the pass can't be had (offline, an old session), the
// website opens anyway and asks them to sign in, as before. The website exchanges the pass in consumeWebHandoff().
const openOnWeb = async go => {
  const base=`${WEB_PORTAL_URL}/?go=${encodeURIComponent(go||"")}`;
  let url=base;
  try{
    const{data,error}=await sb.functions.invoke("app-web-handoff",{body:{}});
    // A fresh "n" each time: Safari treats an address that differs only after "#" as the same page and doesn't
    // reload it, so a second tap would never reach the website's code.
    if(!error&&data&&typeof data.token_hash==="string"&&data.token_hash)url=`${base}&n=${Date.now().toString(36)}#handoff=${encodeURIComponent(data.token_hash)}`;
  }catch(_e){/* open signed out */}
  // iOS drops everything after "#" when a page asks to open a new window, so the pass would never arrive. The App
  // Launcher plugin hands Safari the full address. Older app builds without the plugin open signed out, as before.
  if(IS_NATIVE_APP){
    try{const{AppLauncher}=await import("@capacitor/app-launcher");await AppLauncher.openUrl({url});return;}catch(_e){/* fall back */}
  }
  window.open(url,"_blank");
};
// True for a visit that came from the app's "on the website" buttons (?go=...): the client is there to pay or add
// something, so the sign-in pop-ups (assistant greeting, naming the assistant, the plan video) stay out of the way.
let CAME_FROM_APP=false;
// Website side of the handoff: run before the first session check. Takes the pass out of the address bar at once
// (so it isn't left in history or shared by copying the link), then signs in with it. A used or expired pass just
// leaves the person on the sign-in screen.
async function consumeWebHandoff(){
  if(IS_NATIVE_APP)return;
  let tokenHash="";
  try{
    const m=/(?:^#|&)handoff=([^&]+)/.exec(window.location.hash||"");
    if(!m)return;
    tokenHash=decodeURIComponent(m[1]);
    const q=new URLSearchParams(window.location.search);q.delete("n");
    window.history.replaceState(null,"",window.location.pathname+(q.toString()?`?${q}`:""));
  }catch(_e){return;}
  try{await sb.auth.verifyOtp({token_hash:tokenHash,type:"magiclink"});}catch(_e){/* sign in normally */}
}
// A pass can also arrive without a reload (same page, new "#"): catch it too.
if(typeof window!=="undefined"&&!IS_NATIVE_APP)window.addEventListener("hashchange",()=>{consumeWebHandoff();});
function WebPurchaseNotice({title,children,go,button="Continue on the website",style}){
  return <div style={{background:"rgba(206,182,132,0.12)",border:`1px solid ${"#C9A961"}`,borderRadius:12,padding:"14px 16px",...style}}>
    {title&&<div style={{fontWeight:700,color:"#0A2540",fontSize:14,marginBottom:4}}>{title}</div>}
    <div style={{fontSize:13,color:"#3d4f63",lineHeight:1.55}}>{children}</div>
    <button onClick={()=>openOnWeb(go)} style={{marginTop:12,background:"#0A2540",color:"#fff",border:"none",borderRadius:8,padding:"10px 16px",fontSize:13,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>{button} ↗</button>
  </div>;
}
// New sign-ups are paused. While this is set, the login screen's "Create an Account" link goes to the
// maintenance page on the marketing site instead of /signup. Set it to "" to send people to /signup again.
const SIGNUP_PAUSED_URL = "https://ordanisos.com/signup-maintenance.html";
// One minimum for every way of setting a password, matching self-serve signup (SignupFlow.jsx and
// the public-signup function). The real enforcement is the Supabase Auth setting and the
// admin-set-password function; these client checks only give a faster message.
const MIN_PASSWORD_LENGTH = 12;
// BRAND and B are plain objects referenced by identity throughout the app, so
// applying a profile is an in-place merge — no re-plumbing of the hundreds of
// existing B.navy / BRAND.name references, and one re-render picks it all up.
// The first skin applied is preceded by a copy of the build-time values. Every later skin starts from
// that copy, so a field the new skin leaves empty shows the default, not the previous firm's value.
let BRAND_BASE=null,B_BASE=null;
function applyBrandProfile(row){
  if(!row)return;
  if(!BRAND_BASE){BRAND_BASE={...BRAND};B_BASE={...B};}
  else{Object.assign(BRAND,BRAND_BASE);Object.assign(B,B_BASE);}
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
// Which skin applies: a signed-in person gets their own firm's skin. Before sign-in, the address the
// app is opened on decides (an enterprise's own domain), and an address no firm owns gets the default
// skin. The database functions return public fields only. If they are not there yet (an older
// database), the old read of the active skin is used instead.
// Returns true when the skin on screen changed, so the caller can redraw.
let SKIN_KEY="";
async function loadActiveBrandProfile(){
  if(!RUNTIME_BRAND)return false;
  try{
    let row=null,ok=false;
    try{
      const{data:{session}}=await sb.auth.getSession();
      const signedIn=!!session?.user;
      const r=signedIn?await sb.rpc("brand_for_user"):await sb.rpc("brand_for_host",{p_host:window.location.hostname});
      if(!r.error){
        ok=true;row=r.data||null;
        if(!row){const d=await sb.rpc("brand_default");if(!d.error)row=d.data||null;}
      }
    }catch(_e){ok=false;}
    if(!ok){
      const{data,error}=await sb.from("brand_profiles").select("*").eq("is_active",true).maybeSingle();
      if(error||!data)return false;
      row=data;
    }
    if(!row)return false;
    const key=String(row.id||"")+"|"+String(row.updated_at||"");
    if(key===SKIN_KEY)return false;
    const hadSkin=SKIN_KEY!=="";
    applyBrandProfile(row);
    SKIN_KEY=key;
    if(hadSkin){
      // Templates and fee defaults belong to a skin: forget the previous firm's.
      BRAND_DOCS.byKey={};BRAND_DOCS.loaded=false;BRAND_DOCS.error=null;
      FIRM_DEFAULTS.loaded=false;FIRM_DEFAULTS.monthlyFee=null;FIRM_DEFAULTS.onboardingFee=null;FIRM_DEFAULTS.derivePropertyCosts=false;
    }
    return true;
  }catch(_e){/* keep build-time branding */return false;}
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
    // The caller's own firm's defaults, through a function. The old direct read is kept only as the
    // fallback for a database that does not have the function yet.
    let{data,error}=await sb.rpc("my_firm_defaults");
    if(error){
      const old=await sb.from("brand_profiles")
        .select("default_monthly_fee, default_onboarding_fee, derive_property_costs").eq("is_active",true).maybeSingle();
      data=old.data;error=old.error;
    }
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
// The last moment of a due date in the person's own time zone. A task is overdue once its due day has ended,
// not at UTC midnight (which, in the US, is the evening before it is due).
function dueEnd(s){const d=parseLocalDate(s);d.setHours(23,59,59,999);return d;}
// Today (or a given moment) as a YYYY-MM-DD calendar date in the person's own time zone. toISOString()
// gives the UTC date, which after about 8pm Eastern is already tomorrow.
const localDayISO=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
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
  // Recurring. Each occurrence is computed from the start date, never by adding to the previous one:
  //  * month-based frequencies keep the original day of month and clamp to short months (the same rule
  //    as nextBillDue). Adding a month to 31 January overflowed into March, so February was skipped and
  //    every later date drifted.
  //  * the walk starts just before the projection window. It used to start at the event's own start
  //    date with a 600-step cap, so a weekly expense begun years ago ran out of steps and vanished.
  const add=o=>{if(o>=projectionStart&&o<=projEnd&&(!end||o<=end))occurrences.push({date:o,amount});};
  const months={monthly:1,quarterly:3,annually:12}[event.frequency];
  if(months){
    const anchorDay=start.getDate();
    const nth=k=>{const m=new Date(start.getFullYear(),start.getMonth()+months*k,1);
      const dim=new Date(m.getFullYear(),m.getMonth()+1,0).getDate();
      return new Date(m.getFullYear(),m.getMonth(),Math.min(anchorDay,dim));};
    const behind=(projectionStart.getFullYear()-start.getFullYear())*12+(projectionStart.getMonth()-start.getMonth());
    for(let k=Math.max(0,Math.floor(behind/months)-1),guard=0;guard<2000;k++,guard++){
      const o=nth(k); if(o>projEnd)break; add(o);
    }
    return occurrences;
  }
  const days={weekly:7,biweekly:14}[event.frequency];
  if(!days)return occurrences;
  const step=days*86400000;
  const skip=Math.max(0,Math.floor((projectionStart-start)/step)-1);
  for(let k=skip,guard=0;guard<2000;k++,guard++){
    const o=new Date(start.getFullYear(),start.getMonth(),start.getDate()+days*k);
    if(o>projEnd)break; add(o);
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
// Escapes text for the printable reports, which are written into a new window with document.write.
// That window shares this app's origin, so any household text written into it unescaped (a note, a task
// title, an address) could run as script with the signed-in user's session. Every value a household can
// type goes through this before it reaches a report.
const escHtml=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=iso=>{
  if(!iso)return"—";
  const d=parseLocalDate(iso);
  return isNaN(d.getTime())?"—":d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
};
const fmtMoney=n=>n!=null&&n!==""?`$${Number(n).toLocaleString("en-US",{minimumFractionDigits:Number.isInteger(Math.round(Number(n)*100)/100)?0:2,maximumFractionDigits:2})}`:"—";
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
  const m={family_id:"familyId",contact_id:"contactId",account_id:"accountId",account_period:"accountPeriod",as_of:"asOf",balance_as_of:"balanceAsOf",source_document_id:"sourceDocumentId",balance_source_document_id:"balanceSourceDocumentId",entered_by:"enteredBy",close_date:"closeDate",due_date:"dueDate",created_at:"createdAt",uploaded_at:"uploadedAt",advisor_name:"advisorName",advisor_email:"advisorEmail",owner_name:"ownerName",property_type:"propertyType",property_id:"propertyId",purchase_price:"purchasePrice",purchase_date:"purchaseDate",current_value:"currentValue",loan_balance:"loanBalance",interest_rate:"interestRate",loan_payment:"loanPayment",loan_maturity_date:"loanMaturityDate",loan_type:"loanType",rental_income:"rentalIncome",property_taxes:"propertyTaxes",flood_insurance:"floodInsurance",insurance_company:"insuranceCompany",insurance_premium:"insurancePremium",flood_insurance_company:"floodInsuranceCompany",flood_insurance_premium:"floodInsurancePremium",insurance_expiration:"insuranceExpiration",policy_number:"policyNumber",coverage_amount:"coverageAmount",valuable_id:"valuableId",portfolio_account_id:"portfolioAccountId",private_owner_id:"privateOwnerId",loan_id:"loanId",credit_limit:"creditLimit",original_amount:"originalAmount",rate_type:"rateType",payment_amount:"paymentAmount",payment_frequency:"paymentFrequency",origination_date:"originationDate",maturity_date:"maturityDate",flood_insurance_expiration:"floodInsuranceExpiration",account_type:"accountType",starting_balance:"startingBalance",current_balance:"currentBalance",banker_name:"bankerName",account_advisor_name:"accountAdvisorName",account_advisor_phone:"accountAdvisorPhone",account_advisor_email:"accountAdvisorEmail",make_model:"makeModel",estimated_value:"estimatedValue",file_type:"fileType",extracted_text:"extractedText",reminder_days:"reminderDays",reminder_sent:"reminderSent",full_name:"fullName",file_path:"filePath",file_size:"fileSize",uploaded_by:"uploadedBy",event_type:"eventType",start_date:"startDate",end_date:"endDate",tax_treatment:"taxTreatment",filing_status:"filingStatus",state_tax_rate:"stateTaxRate",base_income:"baseIncome",cash_flow_settings:"cashFlowSettings",hoa_fee:"hoaFee",property_management_fee_pct:"propertyManagementFeePct",include_mortgage_in_cashflow:"includeMortgageInCashflow",sort_order:"sortOrder",note_id:"noteId",recurrence_interval:"recurrenceInterval",recurrence_unit:"recurrenceUnit",completed_at:"completedAt",completed_by:"completedBy",item_key:"itemKey",item_label:"itemLabel",item_type:"itemType",occurrence_date:"occurrenceDate",second_mortgage_balance:"secondMortgageBalance",second_mortgage_payment:"secondMortgagePayment",assistant_name:"assistantName",is_advisor:"isAdvisor",is_primary:"isPrimary",updated_at:"updatedAt",is_secondary:"isSecondary",pcm_responsible:"pcmResponsible",invited_at:"invitedAt",partner_kind:"partnerKind",business_partner_seats_stripe_item_id:"businessPartnerSeatsStripeItemId",user_id:"userId",paid_at:"paidAt",paid_by:"paidBy",vendor_family_contact_id:"vendorFamilyContactId",vendor_property_contact_id:"vendorPropertyContactId",event_id:"eventId",document_id:"documentId",downloaded_by:"downloadedBy",downloaded_at:"downloadedAt",owner_user_id:"ownerUserId",owner_email:"ownerEmail",owner_role:"ownerRole",prompt_type:"promptType",template_key:"templateKey",custom_prompt:"customPrompt",schedule_preset:"schedulePreset",schedule_dow:"scheduleDow",schedule_hour_utc:"scheduleHourUtc",last_run_at:"lastRunAt",last_run_status:"lastRunStatus",last_run_error:"lastRunError",data_source:"dataSource",can_run_scheduled_prompts:"canRunScheduledPrompts",property_section:"propertySection",expiry_date:"expiryDate",doc_type:"docType",mime_type:"mimeType"};
  return Object.fromEntries(Object.entries(obj).map(([k,v])=>[m[k]||k,v]));
};

const TABLES=["families","contacts","properties","deals","notes","tasks","portfolio_accounts","account_balances","valuables","loans","documents","cash_flow_events","cash_flow_payment_log","note_attachments","deadline_acks","family_contacts","property_contacts","family_partners"];
const FAMILY_SCOPED=["contacts","properties","deals","notes","tasks","portfolio_accounts","account_balances","valuables","loans","documents","cash_flow_events","cash_flow_payment_log","deadline_acks","family_contacts","property_contacts","family_partners"];

// ── STAFF DATA ON DEMAND (scaling step 2, docs/PLAN-SCALING-STEP2.md) ──────────
// Supabase returns at most 1,000 rows per request and says nothing when it stops, so anything that can be longer is
// read page by page until a short page comes back. build() must return a fresh, ordered query each time.
async function fetchAllRows(build){
  const out=[];const size=1000;
  for(let from=0;;from+=size){
    const{data,error}=await build().range(from,from+size-1);
    if(error)throw error;
    out.push(...(data||[]));
    if(!data||data.length<size)return out;
  }
}
// The caller's own calendar date, so "overdue" on the server matches what the screen always showed.
const localISODate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
// Everything one household's dashboard needs, in the same shape the old full download had (so FamilyDashboard works
// on it unchanged, exactly as it does for a client). famRow is the household's own record (client-side names).
async function loadHouseholdBundle(famRow,tables=FAMILY_SCOPED){
  const lists=await Promise.all(tables.map(t=>fetchAllRows(()=>sb.from(t).select("*").eq("family_id",famRow.id).order("created_at",{ascending:false}).order("id"))));
  const bundle={families:[famRow],note_attachments:[]};
  FAMILY_SCOPED.forEach(t=>{bundle[t]=[];});
  tables.forEach((t,i)=>{bundle[t]=lists[i].map(toClient);});
  if(tables.includes("notes"))bundle.note_attachments=await loadNoteAttachments(bundle.notes.map(n=>n.id));
  return bundle;
}
async function loadNoteAttachments(noteIds){
  const out=[];
  for(let i=0;i<noteIds.length;i+=200){
    const ids=noteIds.slice(i,i+200);
    out.push(...await fetchAllRows(()=>sb.from("note_attachments").select("*").in("note_id",ids).order("created_at",{ascending:false}).order("id")));
  }
  return out.map(toClient);
}
// Display label of the signed-in user, set at login; used to stamp task completions.
let CURRENT_USER_LABEL="";
let CURRENT_USER_ROLE="";
// A firm administrator opening a CHRIS document or attachment is recorded first, and if the record cannot be
// written the file is not opened. Everyone else passes straight through.
async function firmDocGate(path,name,action="open_document"){
  if(CURRENT_USER_ROLE!=="enterprise_admin")return true;
  const fid=String(path||"").split("/")[0];
  const{error}=await sb.rpc("firm_log_access",{p_family_id:fid,p_action:action,p_detail:String(name||path||"").slice(0,300)});
  return !error;
}
const FIRM_GATE_MSG="This access could not be recorded, so the file was not opened.";
// Display-only rename: the underlying role value stored in the DB/permissions stays "advisor";
// only the label shown to users reads "ORDANIS Expert".
const ROLE_LABELS={admin:"Admin",advisor:"ORDANIS Expert",analyst:"ORDANIS Analyst",client:"Family",partner:"Partner",enterprise_admin:"Firm Administrator"};
const roleLabel=r=>ROLE_LABELS[(r||"").toLowerCase()]||r;


// ── UI PRIMITIVES ─────────────────────────────────────────────────────────────
// onClick is optional: badges that are just status labels (e.g. the "N due in 30
// days" summary inside the Tasks tab itself, where there's nowhere further to go)
// render as a plain, inert span exactly as before. Badges that point at something
// elsewhere -- like the header's "N due soon" summary -- pass onClick and render
// as a reset-styled button instead, so they're keyboard/screen-reader operable
// rather than a span with a click handler bolted on.
function Badge({children,scheme,onClick}){
  const s=scheme||{bg:B.borderLight,text:B.navyMid,dot:B.navyMid};
  const Tag=onClick?"button":"span";
  // Being a <button> makes these keyboard/screen-reader operable, but a pill
  // that only changes its cursor on hover doesn't read as "tappable" at a
  // glance -- especially on touch, where hover never happens. An underline
  // on the label plus a trailing chevron gives it a visible link-like
  // affordance so it doesn't look identical to the plain, inert badges.
  return <Tag onClick={onClick} style={{display:"inline-flex",alignItems:"center",gap:5,background:s.bg,color:s.text,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700,letterSpacing:"0.04em",whiteSpace:"nowrap",fontFamily:"inherit",border:"none",...(onClick?{cursor:"pointer"}:{})}}><span style={{width:6,height:6,borderRadius:"50%",background:s.dot,flexShrink:0}}/><span style={onClick?{textDecoration:"underline",textUnderlineOffset:"2px"}:undefined}>{children}</span>{onClick&&<span aria-hidden="true" style={{fontSize:9,marginLeft:-2}}>{"\u203A"}</span>}</Tag>;
}
function GoldLine(){return <div style={{height:1,background:`linear-gradient(90deg,transparent,${B.gold},transparent)`,margin:"0 0 16px"}}/>;}
function Spinner({size=34}){return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",flexDirection:"column",gap:14}}><div style={{width:size,height:size,border:`3px solid ${B.borderLight}`,borderTop:`3px solid ${B.gold}`,borderRadius:"50%",animation:"pcmspin 0.8s linear infinite"}}/><style>{`@keyframes pcmspin{to{transform:rotate(360deg)}}`}</style></div>;}
function Toast({msg,type}){return <div style={{position:"fixed",bottom:"calc(24px + env(safe-area-inset-bottom))",right:24,zIndex:9000,background:type==="error"?"#fde8e8":B.navy,color:type==="error"?"#8b1a1a":B.white,padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:600,boxShadow:B.shadowMd,border:`1px solid ${type==="error"?"#f5c6c6":"rgba(206,182,132,0.3)"}`}}>{type==="error"?"⚠ ":"✓ "}{msg}</div>;}

// Rendered into <body> (a portal), so it is always placed against the screen and opens centred at eye level, even when
// the button that opened it sits inside a scrolled or animated panel (an animated ancestor would otherwise pin a fixed
// overlay to that panel instead of the screen).
function Modal({title,onClose,wide,children}){
  const mobile=useIsMobile(640);
  return createPortal(<div style={{position:"fixed",inset:0,background:"rgba(9,43,73,0.45)",zIndex:1000,fontFamily:"'DM Sans','Helvetica Neue',sans-serif",display:"flex",alignItems:mobile?"flex-end":"center",justifyContent:"center",backdropFilter:"blur(3px)",padding:mobile?0:20,overflowY:"auto"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:B.white,borderRadius:mobile?"16px 16px 0 0":16,padding:mobile?"24px 20px calc(32px + env(safe-area-inset-bottom))":36,width:"100%",maxWidth:mobile?"100%":wide?780:540,boxShadow:B.shadowMd,border:`1px solid ${B.borderLight}`,margin:mobile?0:"auto",maxHeight:mobile?"90vh":"none",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>{title}</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:B.textMute,fontSize:20,cursor:"pointer"}}>✕</button>
      </div>
      <GoldLine/>{children}
    </div>
  </div>,document.body);
}

const inp={width:"100%",background:B.bg,border:`1px solid ${B.border}`,borderRadius:8,padding:"9px 13px",color:B.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
// Merge (not replace) any caller-supplied style, so passing e.g. style={{flex:1}}
// for layout doesn't strip the standard background/border/padding everywhere else.
const Inp=p=><input {...p} style={{...inp,...(p.style||{})}}/>;
// Password box with a Show/Hide toggle, so a person can check what they typed before submitting
// (no more setting a password blind). Uncontrolled by default; pass show/onToggle to drive several
// boxes from one toggle (the set-password screen does).
function PasswordField({show,onToggle,style,...props}){
  const[own,setOwn]=useState(false);
  const visible=show!==undefined?show:own;
  const toggle=onToggle||(()=>setOwn(v=>!v));
  return <div style={{position:"relative"}}>
    <input {...props} type={visible?"text":"password"} style={{...inp,...(style||{}),paddingRight:68}}/>
    <button type="button" onClick={toggle} aria-label={visible?"Hide password":"Show password"} aria-pressed={visible}
      style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:B.textSoft,fontSize:12,fontWeight:700,letterSpacing:"0.04em",cursor:"pointer",fontFamily:"inherit",padding:"6px 8px"}}>{visible?"Hide":"Show"}</button>
  </div>;
}
// Formats numbers as US dollars with commas while user types. Stores the raw numeric value (no commas) on change.
// Negative amounts are refused unless allowNegative is passed (account balances can be below zero; prices, fees and
// values cannot). Cents are capped at two places, and a lone "-" or "." is cleared when the box loses focus.
function MoneyInput({value,onChange,placeholder,style,disabled,allowNegative=false}){
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
    if(!allowNegative)raw=raw.replace(/-/g,"");
    // Only one decimal
    const firstDot=raw.indexOf(".");
    if(firstDot!==-1){
      raw=raw.slice(0,firstDot+1)+raw.slice(firstDot+1).replace(/\./g,"");
    }
    // At most two decimal places, and at most 12 digits before the point
    const dot=raw.indexOf(".");
    if(dot!==-1)raw=raw.slice(0,dot+1)+raw.slice(dot+1,dot+3);
    {const neg=raw.startsWith("-");const body=neg?raw.slice(1):raw;const di=body.indexOf(".");
     const whole=di===-1?body:body.slice(0,di);
     if(whole.length>12)raw=(neg?"-":"")+whole.slice(0,12)+(di===-1?"":body.slice(di));}
    // Pass back the cleaned numeric string (or empty)
    onChange&&onChange({target:{value:raw}});
  };
  const handleBlur=()=>{
    const v=String(value==null?"":value);
    if(v==="-"||v==="."||v==="-.")onChange&&onChange({target:{value:""}});
  };
  // Docked "$" prefix so every money field in the app shows it automatically, rather than each
  // caller having to spell "($)" into its own label (a few still do, harmlessly, from before this).
  return <div style={{position:"relative"}}>
    <span aria-hidden="true" style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",color:B.textMute,fontSize:14,pointerEvents:"none"}}>$</span>
    <input type="text" inputMode="decimal" style={{...(style||inp),paddingLeft:24}} disabled={disabled} value={fmt(value)} onChange={handleChange} onBlur={handleBlur} placeholder={placeholder||"0"}/>
  </div>;
}
const Sel=({children,...p})=><select {...p} style={{...inp,cursor:"pointer",...(p.style||{})}}>{children}</select>;
const Tex=p=><textarea style={{...inp,minHeight:80,resize:"vertical"}} {...p}/>;
function Field({label,children,required,optional}){return <div style={{marginBottom:14}}><label style={{display:"block",fontSize:11,color:B.textSoft,marginBottom:5,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>{label}{required&&<span aria-hidden="true" title="Required" style={{color:"#b42318",marginLeft:4,fontWeight:700}}>*</span>}{optional&&<span style={{fontWeight:500,textTransform:"none",letterSpacing:0,color:B.textMute,marginLeft:6,fontSize:10.5}}>(optional)</span>}</label>{children}</div>;}
// Shown under a form whose required fields (marked *) are not filled in yet.
const ReqHint=({text})=><div role="alert" style={{fontSize:12,color:"#b42318",margin:"10px 0 0",textAlign:"right"}}>{text||"Please fill in the fields marked * to continue."}</div>;
function Grid2({children}){
  return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(220px,100%),1fr))",gap:12}}>{children}</div>;
}
function Btn({children,onClick,variant="primary",small,disabled,style:ex}){
  const v={primary:{background:B.navy,color:B.white,border:"none"},ghost:{background:"transparent",color:B.navyMid,border:`1px solid ${B.border}`},danger:{background:"#fde8e8",color:"#8b1a1a",border:"1px solid #f5c6c6"},gold:{background:B.gold,color:B.navy,border:"none"}};
  return <button onClick={onClick} disabled={disabled} style={{...v[variant],borderRadius:8,padding:small?"5px 13px":"9px 20px",fontSize:small?12:13,fontWeight:700,cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",letterSpacing:"0.03em",opacity:disabled?.65:1,...ex}} onMouseEnter={e=>{if(!disabled)e.currentTarget.style.opacity=".82";}} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>{children}</button>;
}
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

// Used to block Save until a hand-typed phone number is either empty or one this app can
// actually recognise: a US 10-digit number, an extension format ("555-0142 x203"), or a number
// that already declared itself international with a leading "+". Mirrors formatPhoneInput's own
// idea of "a shape it recognises" so nothing that formatter left untouched gets rejected here.
function isValidPhone(raw){
  const s=String(raw||"").trim();
  if(!s)return true; // optional everywhere this is used; whether blank is acceptable is the caller's call
  if(/[a-zA-Z]/.test(s)){
    const digits=s.replace(/\D/g,"");
    return digits.length>=10;
  }
  if(s.startsWith("+")){
    const digits=s.replace(/\D/g,"");
    return digits.length>=8&&digits.length<=15; // loose E.164 sanity check
  }
  const d=s.replace(/\D/g,"");
  const us=d.length===11&&d.startsWith("1")?d.slice(1):d;
  return us.length===10;
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
// without hunting through CHRIS.
async function openStoredDoc(doc,toast){
  if(!doc?.filePath){toast&&toast("No file on record for this document","error");return;}
  if(!await firmDocGate(doc.filePath,doc.name||doc.title)){toast&&toast(FIRM_GATE_MSG,"error");return;}
  const{data,error}=await sb.storage.from("documents").createSignedUrl(doc.filePath,300);
  if(error||!data?.signedUrl){toast&&toast(error?.message||"Could not open that document","error");return;}
  window.open(data.signedUrl,"_blank","noopener");
}
// Shown in place of DocLink when a section has no document yet: jumps to the
// CHRIS with the property and section pre-selected, so attaching a bill is one
// click from the figure it belongs to rather than a hunt through CHRIS.
function AttachLink({onClick,section}){
  return <button onClick={e=>{e.stopPropagation();onClick();}} title={`Attach ${sectionLabel(section)}`}
    style={{background:"none",border:"none",padding:0,marginLeft:5,cursor:"pointer",color:B.textMute,fontSize:10.5,lineHeight:1,verticalAlign:"middle"}}
    onMouseEnter={e=>e.currentTarget.style.color=B.navy}
    onMouseLeave={e=>e.currentTarget.style.color=B.textMute}>📎</button>;
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
// Crisp, text-drawn lockup for the default ORDANIS brand (wordmark + gold rule +
// tagline), per the ORDANIS Logo Kit doc's Ordanis_Lockup_Stacked spec. Mirrors
// StackedLogo in SignupFlow.jsx font-for-font so the same wordmark reads
// identically on the signup page, the login screen, and the in-app sidebar.
// Only used when no tenant-specific VITE_BRAND_LOGO_URL is set -- a white-label
// tenant's own uploaded artwork still renders as-is via BrandImg, since it may
// be arbitrary graphic artwork, not just text.
//
// Font-size 15.5 is the kit's shipped 14 plus the +1.5 bump the team applied on
// top of it; letter-spacing 3.35 (not the kit's own 5) is tuned so the tagline's
// rendered width lands at ~87% of the wordmark's, matching the team's actual
// reference lockup image rather than the kit's fixed letter-spacing value, which
// renders noticeably wider relative to the wordmark. Embedded in the same scaled
// SVG shape as the wordmark, not sized off an independent formula. The kit also
// documents a hard minimum lockup width (210px) below which the tagline is
// dropped entirely rather than shrunk further, so it's hidden below that width
// here instead of dissolving into an unreadable smudge.
const STACKED_LOCKUP_MIN_WIDTH=210;
function BrandLockupSVG({width=220,compact=false}){
  // The 210px floor is about on-screen scale. A cropped (compact) lockup at 200px renders at roughly
  // twice the scale of an uncropped one, so it clears the legibility bar and always keeps its tagline.
  const showTagline=compact||width>=STACKED_LOCKUP_MIN_WIDTH;
  // `compact` is the SAME lockup artwork as the login/signup one -- same wordmark, same rule, same
  // single-line tagline, same proportions -- just cropped to its own content. The full 760-wide
  // viewBox carries ~190 units of empty margin on each side, which is harmless at the 480px login
  // size but, in a ~200px sidebar, wastes half the width and shrinks the tagline to ~4px. Cropping
  // the viewBox to the artwork (measured with Georgia-metric glyphs: the wordmark spans x 168-592, so the
  // crop keeps ~6 units of margin either side -- a tighter crop clipped the O on a real Mac) lifts the on-screen scale of every element (tagline ~7px)
  // without redrawing or re-proportioning anything, so it stays an exact match for the portal logo.
  const viewBox=compact?"162 45 436 123":"0 0 760 172";
  return (
    <svg viewBox={viewBox} width={width} style={{maxWidth:"100%",height:"auto",display:"block",margin:compact?0:"0 auto"}} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={BRAND.name}>
      <text x="380" y="105" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight="bold" fontSize="70" letterSpacing="9" fill={B.navy}>{BRAND.name.toUpperCase()}</text>
      {showTagline && (
        <>
          {/* Rule spans the tagline's own rendered width (measured via getComputedTextLength
              at this exact font-family/size/letter-spacing) so it runs from the P to the n,
              not an arbitrary fixed span. */}
          <line x1="195.8" y1="133" x2="564.2" y2="133" stroke={B.gold} strokeWidth="2" />
          <text x="380" y="160" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="18" letterSpacing="2.2" textLength="368.4" lengthAdjust="spacing" fill="#3F5470" fontWeight="bold">{BRAND.tagline.toUpperCase()}</text>
        </>
      )}
    </svg>
  );
}
// The standalone mark (a serif O, counter open, split navy/gold) -- a
// companion asset to the wordmark lockups above, never combined with them
// (see the Logo Kit's "Never build your own mark-plus-wordmark lockup").
// Used where the full name won't fit or is already established: the
// assistant button, small in-context brand touches. `reversed` swaps the
// navy half for white, for use on navy/dark grounds -- putting navy on
// navy just makes that half vanish, which is exactly the bug this fixes.
function BrandMark({reversed=false,size=40}){
  // The live skin (applied at runtime from brand_profiles) can supply its own mark, so check BRAND.mark
  // and not only the build-time env var; otherwise a skinned instance keeps showing the drawn ORDANIS O.
  const _skinHasMark=!!BRAND.mark&&BRAND.mark!=="/ordanis-mark.png";
  // The default ORDANIS skin is always drawn here, never loaded from a stored image: the stored file can be
  // the reversed (white-left) mark made for dark grounds, which loses half the O on a white surface.
  const _isOrdanis=String(BRAND.short||BRAND.name||"").trim().toLowerCase()==="ordanis";
  const usingDefaultMark=!import.meta.env.VITE_BRAND_MARK_URL&&(!_skinHasMark||_isOrdanis);
  const id=useId();
  if(!usingDefaultMark)return <img src={BRAND.mark} alt={BRAND.short||BRAND.name} style={{width:size,height:size,objectFit:"contain",display:"block"}}/>;
  const ringPath="M50,14 a33,36 0 1,0 0,72 a33,36 0 1,0 0,-72 Z M50,23 a21,27 0 1,1 0,54 a21,27 0 1,1 0,-54 Z";
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={BRAND.short||BRAND.name}>
      <defs>
        <clipPath id={`${id}-l`}><rect x="0" y="0" width="50" height="100"/></clipPath>
        <clipPath id={`${id}-r`}><rect x="50" y="0" width="50" height="100"/></clipPath>
      </defs>
      <g clipPath={`url(#${id}-l)`}><path fillRule="evenodd" fill={reversed?"#ffffff":B.navy} d={ringPath}/></g>
      <g clipPath={`url(#${id}-r)`}><path fillRule="evenodd" fill={B.gold} d={ringPath}/></g>
    </svg>
  );
}

// Private household (2026-10-21): only the household itself and the staff named here can see it; the
// database enforces that on every household table and on its files (migration private_households).
// Admins only. Once private, only someone on the list can change it -- another admin cannot see it at all.
// Changes need a session that passed two-step sign-in, and each one is written to the audit log.
// Invite the client of a household the team set up (invite-client): an email invite to set their own password,
// instead of an admin choosing one. Optionally the household pays by card; the client is then asked for a card in
// their portal. Admins and the household's own Expert. Firm-paid households can be invited without card payment.
// ── HOUSEHOLD LOGINS (family users and what each may do) ──────────────────────────
// Migration 20261028100000. The household's primary (or anyone they allow to manage users) invites family members by
// email; each gets their own login and sets their own password. Seeing the household is always on; the four
// permissions below are chosen per person, each explained beside its checkbox, and the database enforces them.
// Giving "Manage users and billing" (or all four) asks for a second confirmation listing exactly what is given.
const HOUSEHOLD_PERMS=[
  {key:"edit",label:"Edit records",desc:"Add, change and remove the household's records: properties, accounts, loans, bills, valuables, tasks and notes."},
  {key:"upload",label:"Upload documents",desc:"Add files to CHRIS, the household's Centralized Household Records Integration Server."},
  {key:"download",label:"Download documents",desc:"Open and download files in CHRIS. Without this they see file names only. Their own Private folder is always theirs."},
  {key:"manage",label:"Manage users and billing",desc:"Invite or remove people, change what each person can do, change the plan, and add or change the payment card. This is the same control you have."},
];
const HOUSEHOLD_PRESETS=[
  {key:"full",label:"Full access",perms:{edit:true,upload:true,download:true,manage:true}},
  {key:"docs",label:"Documents only",perms:{edit:false,upload:true,download:true,manage:false}},
  {key:"view",label:"View only",perms:{edit:false,upload:false,download:false,manage:false}},
];
const permSummary=u=>{
  if(u.household_role==="primary")return "Primary · full access";
  const on=HOUSEHOLD_PERMS.filter(x=>u["perm_"+x.key]!==false).map(x=>x.label.toLowerCase());
  return on.length?`Can view, ${on.join(", ")}`:"View only";
};
function HouseholdPermsPicker({value,onChange}){
  return <div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
      {HOUSEHOLD_PRESETS.map(pr=>{const on=HOUSEHOLD_PERMS.every(x=>!!value[x.key]===!!pr.perms[x.key]);
        return <button key={pr.key} type="button" onClick={()=>onChange({...pr.perms})} style={{border:`1px solid ${on?B.navy:B.border}`,background:on?B.navy:B.white,color:on?B.white:B.navy,borderRadius:16,padding:"5px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{pr.label}</button>;})}
    </div>
    <div style={{fontSize:12,color:B.textSoft,marginBottom:8}}>Seeing the household is always included.</div>
    {HOUSEHOLD_PERMS.map(x=><label key={x.key} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"9px 0",borderTop:`1px solid ${B.borderLight}`,cursor:"pointer"}}>
      <input type="checkbox" checked={!!value[x.key]} onChange={e=>onChange({...value,[x.key]:e.target.checked})} style={{marginTop:3,width:16,height:16,accentColor:B.navy,flexShrink:0}}/>
      <span><span style={{fontSize:13,fontWeight:700,color:B.navy}}>{x.label}</span>
        <span style={{display:"block",fontSize:12,color:B.textSoft,lineHeight:1.5,marginTop:2}}>{x.desc}</span></span>
    </label>)}
  </div>;
}
// The second look before giving full authority.
function FullAuthorityConfirm({name,perms,onConfirm,onCancel,busy}){
  const given=HOUSEHOLD_PERMS.filter(x=>perms[x.key]);
  return <Modal title="Confirm full authority" onClose={()=>!busy&&onCancel()}>
    <div style={{fontSize:13.5,color:B.text,lineHeight:1.6,marginBottom:12}}>You're giving <strong>{name||"this person"}</strong> authority over your household. They will be able to:</div>
    <ul style={{margin:"0 0 14px",paddingLeft:20,fontSize:13,color:B.text,lineHeight:1.6}}>
      <li>See everything in the household</li>
      {given.map(x=><li key={x.key}><strong>{x.label}:</strong> {x.desc}</li>)}
    </ul>
    {perms.manage&&<div style={{fontSize:12.5,color:"#8a5c00",background:"#fef3e2",border:"1px solid #f3d29a",borderRadius:8,padding:"9px 12px",marginBottom:14,lineHeight:1.5}}>With Manage users and billing they can also change other people's access, including giving it to someone else. Only give this to someone you trust with the household.</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
      <Btn variant="ghost" onClick={onCancel} disabled={busy}>Go back</Btn>
      <Btn onClick={onConfirm} disabled={busy}>{busy?"Saving…":"Yes, give this authority"}</Btn>
    </div>
  </Modal>;
}
// mode "card": the full list (Household tab); mode "wizard": just the invite form, for the onboarding wizard.
function HouseholdLogins({familyId,userProfile,toast,mode="card",onInvited=null}){
  const isPrimary=userProfile?.household_role!=="member";
  const canManage=isPrimary||userProfile?.perm_manage===true;
  const[logins,setLogins]=useState(null);
  const[open,setOpen]=useState(mode==="wizard");
  const[f,setF]=useState({name:"",email:"",phone:"",perms:{edit:true,upload:true,download:true,manage:false}});
  const[editing,setEditing]=useState(null); // {user, perms}
  const[confirm,setConfirm]=useState(null); // {name, perms, run}
  const[busy,setBusy]=useState("");
  const call=async body=>{
    const{data:resp,error}=await sb.functions.invoke("invite-client",{body:{family_id:familyId,...body}});
    if(error||!resp?.success){let msg=resp?.error||error?.message||"That didn't work";try{const b=await error?.context?.json?.();if(b?.error)msg=b.error;}catch(_e){}throw new Error(msg);}
    return resp;
  };
  const load=useCallback(async()=>{
    if(mode==="wizard")return;
    if(canManage){try{const r=await call({action:"list"});setLogins(r.logins||[]);return;}catch(_e){}}
    const{data}=await sb.from("user_profiles").select("id,full_name,email,active,household_role,perm_edit,perm_upload,perm_download,perm_manage").eq("family_id",familyId).eq("role","client");
    setLogins(data||[]);
  },[familyId,canManage,mode]);
  useEffect(()=>{load();},[load]);
  const needsConfirm=perms=>perms.manage||HOUSEHOLD_PERMS.every(x=>perms[x.key]);
  const sendInvite=async()=>{
    setBusy("invite");
    try{const r=await call({full_name:f.name.trim(),email:f.email.trim(),phone:f.phone,perms:f.perms,redirect_to:window.location.origin});
      toast(`Invite sent to ${r.invited}. They'll set their own password from the email.`);
      setF({name:"",email:"",phone:"",perms:{edit:true,upload:true,download:true,manage:false}});if(mode!=="wizard")setOpen(false);load();if(onInvited)onInvited();
    }catch(e){toast(e.message,"error");}
    setBusy("");setConfirm(null);
  };
  const saveAccess=async()=>{
    const{user,perms}=editing;setBusy("save");
    const{error}=await sb.rpc("household_member_set",{p_user_id:user.id,p_edit:!!perms.edit,p_upload:!!perms.upload,p_download:!!perms.download,p_manage:!!perms.manage});
    setBusy("");setConfirm(null);
    if(error){toast(error.message,"error");return;}
    toast("Access updated");setEditing(null);load();
  };
  const resend=async u=>{setBusy("r"+u.id);try{const r=await call({action:"resend",user_id:u.id,redirect_to:window.location.origin});toast(r.sent==="invite"?`Invite resent to ${r.email}`:`Email sent to ${r.email} to set a new password`);}catch(e){toast(e.message,"error");}setBusy("");};
  const turnOff=async u=>{if(!window.confirm(`Turn off ${u.full_name||u.email}'s access to the household? They won't be able to sign in.`))return;
    setBusy("x"+u.id);try{await call({action:"remove",user_id:u.id});toast("Access turned off");load();}catch(e){toast(e.message,"error");}setBusy("");};
  const validInvite=f.name.trim().length>1&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())&&String(f.phone).trim()&&isValidPhone(f.phone);
  const inviteForm=<div>
    <div style={{fontSize:12.5,color:B.textSoft,lineHeight:1.55,marginBottom:12}}>They get an email to set up their own login and password. Choose what they can do; you can change it any time.</div>
    <Grid2>
      <Field label="Name"><Inp value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Alex Smith"/></Field>
      <Field label="Email"><Inp type="email" autoComplete="off" value={f.email} onChange={e=>setF({...f,email:e.target.value})} placeholder="alex@example.com"/></Field>
    </Grid2>
    <Field label="Phone" required><Inp value={f.phone} onChange={e=>setF({...f,phone:formatPhoneInput(e.target.value)})} placeholder="(555) 123-4567"/></Field>
    <HouseholdPermsPicker value={f.perms} onChange={v=>setF({...f,perms:v})}/>
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:12}}>
      {mode!=="wizard"&&<Btn variant="ghost" onClick={()=>setOpen(false)} disabled={!!busy}>Cancel</Btn>}
      <Btn disabled={!!busy||!validInvite} onClick={()=>needsConfirm(f.perms)?setConfirm({name:f.name.trim(),perms:f.perms,run:"invite"}):sendInvite()}>{busy==="invite"?"Sending…":"Send invite"}</Btn>
    </div>
  </div>;
  const confirmModal=confirm&&<FullAuthorityConfirm name={confirm.name} perms={confirm.perms} busy={!!busy}
    onCancel={()=>setConfirm(null)} onConfirm={confirm.run==="invite"?sendInvite:saveAccess}/>;
  if(mode==="wizard")return canManage?<div>{inviteForm}{confirmModal}</div>:<div style={{fontSize:13,color:B.textSoft}}>Your household's primary user can give family members their own login from the Household tab.</div>;
  const day=v=>v?new Date(v).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"";
  return <div style={{marginBottom:28}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>Household Logins</div>
        <div style={{fontSize:13,color:B.textSoft,marginTop:2}}>Family members with their own sign-in, and what each can do. Free on every plan.</div>
      </div>
      {canManage&&!open&&<Btn small onClick={()=>setOpen(true)}>+ Invite a family member</Btn>}
    </div>
    {open&&canManage&&<div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:"16px 18px",marginBottom:12}}>{inviteForm}</div>}
    {logins===null?<div style={{fontSize:12.5,color:B.textMute}}>Loading…</div>:logins.filter(u=>u.active!==false).map(u=>{
      const status=u.last_sign_in_at?`Last signed in ${day(u.last_sign_in_at)}`:u.opened_at?"Opened the invite":u.invited_at?`Invited ${day(u.invited_at)}, not opened yet`:"";
      const ed=editing&&editing.user.id===u.id;
      const isMe=u.id===userProfile?.id;
      return <div key={u.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"14px 18px",marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{u.full_name||u.email}{isMe&&<span style={{fontWeight:400,color:B.textSoft}}> (you)</span>}</div>
            <div style={{fontSize:12,color:B.textSoft}}>{u.email}</div>
            <div style={{fontSize:12,color:B.navyMid,marginTop:3}}>{permSummary(u)}</div>
            {status&&<div style={{fontSize:11.5,color:u.last_sign_in_at||u.opened_at?B.textMute:"#8a5c00",marginTop:2}}>{status}</div>}
          </div>
          {canManage&&u.household_role!=="primary"&&!isMe&&!ed&&<div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button onClick={()=>setEditing({user:u,perms:{edit:u.perm_edit!==false,upload:u.perm_upload!==false,download:u.perm_download!==false,manage:u.perm_manage===true}})} style={{background:"none",border:"none",color:B.navyMid,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",padding:0}}>Change access</button>
            <button onClick={()=>resend(u)} disabled={busy==="r"+u.id} style={{background:"none",border:"none",color:B.navyMid,fontSize:12,cursor:"pointer",fontFamily:"inherit",padding:0}}>{busy==="r"+u.id?"Sending…":(u.opened_at||u.last_sign_in_at)?"Send password reset":"Resend invite"}</button>
            <button onClick={()=>turnOff(u)} disabled={busy==="x"+u.id} style={{background:"none",border:"none",color:"#8b1a1a",fontSize:12,cursor:"pointer",fontFamily:"inherit",padding:0}}>Turn off access</button>
          </div>}
        </div>
        {ed&&<div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${B.borderLight}`}}>
          <HouseholdPermsPicker value={editing.perms} onChange={v=>setEditing({...editing,perms:v})}/>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
            <Btn variant="ghost" onClick={()=>setEditing(null)} disabled={!!busy}>Cancel</Btn>
            <Btn disabled={!!busy} onClick={()=>needsConfirm(editing.perms)?setConfirm({name:u.full_name||u.email,perms:editing.perms,run:"save"}):saveAccess()}>{busy==="save"?"Saving…":"Save access"}</Btn>
          </div>
        </div>}
      </div>;
    })}
    {confirmModal}
  </div>;
}

// "Powered by ORDANIS" under a firm's own logo. Drawn as live text, never baked into the firm's artwork:
// text inside a logo image shrinks with the image and becomes unreadable in the 64px sidebar slot, while
// this stays a fixed, legible size everywhere the logo appears. The ORDANIS colour is fixed (not B.navy),
// because B.navy is the firm's own primary colour once a skin is applied.
function PoweredByOrdanis({size=11,align="center"}){
  return <div style={{display:"flex",alignItems:"baseline",gap:5,justifyContent:align==="left"?"flex-start":"center",marginTop:6,whiteSpace:"nowrap",lineHeight:1.1}}>
    <span style={{fontFamily:"Arial, Helvetica, sans-serif",fontSize:size,color:"#5B6B80"}}>Powered by</span>
    <span style={{fontFamily:"Georgia, 'Times New Roman', serif",fontWeight:700,fontSize:size+1.5,letterSpacing:"0.12em",color:"#0A2540"}}>ORDANIS</span>
  </div>;
}
function PCMLogo({dark=false,compact=false}){
  // Explicit target widths (not a fixed height) so wide white-label raster
  // wordmarks scale down to fit their container instead of overflowing it.
  // The drawn text lockup is built for the short ORDANIS wordmark: its canvas is a fixed 760 units wide,
  // so a long firm name ("Accurate Advisory Group") runs off both ends and is clipped. Use the drawn
  // lockup only for the default ORDANIS brand, or when the live skin has no logo image of its own; any
  // other skin that supplies a logo shows that image, scaled to fit.
  const _skinHasLogo=!!BRAND.logo&&BRAND.logo!=="/ordanis-logo.png";
  const _isDefaultBrand=String(BRAND.name||"").toUpperCase()==="ORDANIS";
  const usingDefaultLogo=!import.meta.env.VITE_BRAND_LOGO_URL&&(_isDefaultBrand||!_skinHasLogo);
  const rasterStyle={maxHeight:compact||dark?64:110,maxWidth:"100%",width:"auto",height:"auto",display:"block",margin:dark||compact?0:"0 auto"};
  const content=(w,c=false)=>usingDefaultLogo?<BrandLockupSVG width={w} compact={c}/>:<BrandImg src={BRAND.logo} alt={BRAND.name} style={rasterStyle}/>;
  // A firm's skin always carries "Powered by ORDANIS"; the default ORDANIS lockup does not need it.
  const powered=!usingDefaultLogo;
  if(dark)return <div style={{background:"rgba(255,255,255,0.97)",borderRadius:8,padding:"8px 14px",display:"inline-block"}}>{content(190)}{powered&&<PoweredByOrdanis size={11} align="left"/>}</div>;
  if(compact)return powered?<div>{content(200,true)}<PoweredByOrdanis size={11} align="left"/></div>:content(200,true);
  // 480 matches the signup page's desktop header lockup exactly (same viewBox,
  // same proportions) -- the login screen's card is widened below to fit it
  // without CSS capping it back down.
  return powered?<div>{content(480)}<PoweredByOrdanis size={13}/></div>:content(480);
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
// Shown the moment a recovery/invite link lands the person in a real session but they've never
// actually chosen a password yet (see the PASSWORD_RECOVERY handler above) -- without this, an
// invited Business Partner (or anyone using "forgot password") would be signed straight into
// their dashboard with no password ever set, and have no way to log back in next time.
// ── Two-step sign-in (TOTP authenticator app) ─────────────────────────────────
// Staff (MFA_REQUIRED_ROLES) must use it: at sign-in they set it up if they haven't, and enter a code if they have.
// Clients may turn it on from the Security panel (SecurityModal); once on, they are asked for a code too.
// A verified code raises the session from aal1 to aal2, which admin-only data (e.g. family_utilization) requires.
const MFA_REQUIRED_ROLES=["admin","advisor","analyst","partner","enterprise_admin"];
async function mfaStatus(){
  const[{data:aal,error:e1},{data:f,error:e2}]=await Promise.all([sb.auth.mfa.getAuthenticatorAssuranceLevel(),sb.auth.mfa.listFactors()]);
  if(e1||e2)throw e1||e2;
  const verified=(f?.all||[]).filter(x=>x.factor_type==="totp"&&x.status==="verified");
  const unverified=(f?.all||[]).filter(x=>x.factor_type==="totp"&&x.status!=="verified");
  return{current:aal?.currentLevel,next:aal?.nextLevel,verified,unverified};
}
const MFA_CARD={background:B.white,borderRadius:16,padding:"32px 34px",maxWidth:420,width:"100%",boxShadow:B.shadowMd,border:`1px solid ${B.borderLight}`};
const MFA_ERR={background:"#fde8e8",border:"1px solid #f5c6c6",color:"#8b1a1a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12.5};
const mfaCodeMessage=e=>/invalid|expired|code/i.test(e?.message||"")?"That code didn't work. Check the time on your phone and try the newest code.":(e?.message||"Something went wrong. Please try again.");

// The 6-digit code box used by both set-up and sign-in.
function MfaCodeInput({value,onChange,autoFocus}){
  return <input value={value} onChange={e=>onChange(e.target.value.replace(/\D/g,"").slice(0,6))} autoFocus={autoFocus}
    inputMode="numeric" autoComplete="one-time-code" placeholder="123456" aria-label="6-digit code"
    style={{width:"100%",boxSizing:"border-box",fontSize:22,letterSpacing:"0.4em",textAlign:"center",padding:"12px 14px",border:`1px solid ${B.border}`,borderRadius:10,fontFamily:"inherit",color:B.navy,marginBottom:14}}/>;
}

// Set up an authenticator: shows a QR code (and the key for typing in), then confirms with a first code.
// issuer names the entry in the person's authenticator app ("ORDANIS"); without it Supabase uses the Site URL.
function MfaEnroll({onVerified,onCancel,cancelLabel}){
  const[factor,setFactor]=useState(null);
  const[code,setCode]=useState("");
  const[error,setError]=useState("");
  const[busy,setBusy]=useState(false);
  const started=useRef(false);
  useEffect(()=>{
    if(started.current)return; started.current=true;
    (async()=>{
      try{
        // Clear any half-finished set-up from an earlier visit, so a fresh QR code can be made.
        const st=await mfaStatus();
        for(const f of st.unverified)await sb.auth.mfa.unenroll({factorId:f.id});
        const{data,error:e}=await sb.auth.mfa.enroll({factorType:"totp",issuer:"ORDANIS",friendlyName:`ORDANIS ${new Date().toISOString().slice(0,10)}`});
        if(e)throw e;
        setFactor(data);
      }catch(e){setError(e?.message||"Could not start the set-up. Please try again.");}
    })();
  },[]);
  const verify=async e=>{
    e?.preventDefault?.();
    if(code.length!==6||!factor)return;
    setBusy(true);setError("");
    const{error:err}=await sb.auth.mfa.challengeAndVerify({factorId:factor.id,code});
    setBusy(false);
    if(err){setError(mfaCodeMessage(err));setCode("");return;}
    onVerified();
  };
  return <form onSubmit={verify}>
    {error&&<div style={MFA_ERR}>{error}</div>}
    <ol style={{fontSize:13,color:B.textSoft,lineHeight:1.6,paddingLeft:18,margin:"0 0 14px"}}>
      <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</li>
      <li>Add an account and scan this code.</li>
      <li>Type the 6-digit code the app shows.</li>
    </ol>
    <div style={{display:"flex",justifyContent:"center",margin:"4px 0 10px",minHeight:180}}>
      {factor?.totp?.qr_code?<img src={factor.totp.qr_code} alt="QR code for your authenticator app" style={{width:180,height:180,background:"#fff",padding:6,borderRadius:8,border:`1px solid ${B.borderLight}`}}/>:!error&&<Spinner/>}
    </div>
    {factor?.totp?.secret&&<div style={{fontSize:11.5,color:B.textMute,textAlign:"center",marginBottom:14,wordBreak:"break-all"}}>Can't scan? Enter this key instead:<br/><span style={{fontFamily:"monospace",color:B.navy,fontSize:12.5,letterSpacing:"0.08em"}}>{factor.totp.secret}</span></div>}
    <MfaCodeInput value={code} onChange={setCode}/>
    <Btn onClick={verify} disabled={busy||code.length!==6||!factor}>{busy?"Checking…":"Confirm and turn on"}</Btn>
    {onCancel&&<button type="button" onClick={onCancel} style={{display:"block",margin:"14px auto 0",background:"none",border:"none",color:B.textSoft,fontSize:12,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>{cancelLabel||"Cancel"}</button>}
  </form>;
}

// Shown after the password: set up (staff without an authenticator) or enter today's code (anyone who has one).
function MfaGate({mode,factorId,role,onDone,onSignOut}){
  const[code,setCode]=useState("");
  const[error,setError]=useState("");
  const[busy,setBusy]=useState(false);
  const verify=async e=>{
    e?.preventDefault?.();
    if(code.length!==6)return;
    setBusy(true);setError("");
    const{error:err}=await sb.auth.mfa.challengeAndVerify({factorId,code});
    setBusy(false);
    if(err){setError(mfaCodeMessage(err));setCode("");return;}
    onDone();
  };
  const signOut=<button type="button" onClick={onSignOut} style={{display:"block",margin:"16px auto 0",background:"none",border:"none",color:B.textSoft,fontSize:12,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>Sign out</button>;
  return <div style={{minHeight:"100vh",background:preBg(),display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif",padding:20}}>
    <div style={MFA_CARD}>
      {/* Same stacked lockup as the login screen (and the firm's own logo on a white-label host), so the
          step right after the password still reads as ORDANIS rather than a bare utility page. */}
      <div style={{margin:"0 auto 18px",maxWidth:300}}><PCMLogo/></div>
      <div style={{height:1,background:B.borderLight,margin:"0 0 20px"}}/>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:6}}>{mode==="enroll"?"Set up two-step sign-in":mode==="error"?"Two-step sign-in":"Enter your code"}</div>
      {mode==="enroll"&&<>
        <div style={{fontSize:13,color:B.textSoft,marginBottom:16,lineHeight:1.5}}>{ROLE_LABELS[role]||"Team"} accounts can see many households, so ORDANIS asks for a code from your phone each time you sign in. This takes about a minute, once.</div>
        <MfaEnroll onVerified={onDone}/>
        {signOut}
      </>}
      {mode==="challenge"&&<form onSubmit={verify}>
        <div style={{fontSize:13,color:B.textSoft,marginBottom:16,lineHeight:1.5}}>Open your authenticator app and type the 6-digit code for ORDANIS.</div>
        {error&&<div style={MFA_ERR}>{error}</div>}
        <MfaCodeInput value={code} onChange={setCode} autoFocus/>
        <Btn onClick={verify} disabled={busy||code.length!==6}>{busy?"Checking…":"Continue"}</Btn>
        <div style={{fontSize:11.5,color:B.textMute,marginTop:14,lineHeight:1.5}}>Lost your phone? Ask an ORDANIS administrator to reset your two-step sign-in.</div>
        {signOut}
      </form>}
      {mode==="error"&&<>
        <div style={MFA_ERR}>We couldn't check your two-step sign-in. Please sign out and sign in again.</div>
        {signOut}
      </>}
    </div>
  </div>;
}

// Sign-in security for anyone signed in: two-step sign-in (clients may turn it on or off; staff must keep it)
// and "Sign out everywhere", which ends every session of this login: other tabs, other devices and ELIOT.
const SIGNED_OUT_KEY="ordanis_signed_out_reason";
const noteSignedOut=reason=>{try{sessionStorage.setItem(SIGNED_OUT_KEY,reason);}catch(_e){}};
async function signOutEverywhere(){
  resetAssistantPromptSession();
  noteSignedOut("everywhere");
  const{error}=await sb.auth.signOut({scope:"global"});
  if(error)await sb.auth.signOut({scope:"local"}); // still leave this browser signed out
}
// optedOut / onOptOut (clients only): whether this person chose not to use two-step sign-in, and how to record or
// clear that choice (user_profiles.mfa_opted_out_at via mfa_opt_out_set). Turning two-step off counts as opting out.
function SecurityModal({onClose,toast,role,optedOut=false,onOptOut=null}){
  const required=MFA_REQUIRED_ROLES.includes(role);
  const[st,setSt]=useState(null);
  const[mode,setMode]=useState("view"); // view | enroll | confirmOff | confirmEverywhere
  const[code,setCode]=useState("");
  const[error,setError]=useState("");
  const[busy,setBusy]=useState(false);
  const load=useCallback(()=>mfaStatus().then(setSt).catch(e=>setError(e?.message||"Could not load your settings.")),[]);
  useEffect(()=>{load();},[load]);
  const on=!!st?.verified?.length;
  const turnOff=async e=>{
    e?.preventDefault?.();
    if(code.length!==6)return;
    setBusy(true);setError("");
    try{
      const f=st.verified[0];
      // Prove it is really them (raises the session to aal2), then remove the authenticator.
      if(st.current!=="aal2"){const{error:v}=await sb.auth.mfa.challengeAndVerify({factorId:f.id,code});if(v)throw v;}
      for(const x of st.verified){const{error:u}=await sb.auth.mfa.unenroll({factorId:x.id});if(u)throw u;}
      toast("Two-step sign-in is off");setMode("view");setCode("");await load();
      if(onOptOut)await onOptOut(true);
    }catch(err){setError(mfaCodeMessage(err));setCode("");}
    setBusy(false);
  };
  const everywhere=async()=>{setBusy(true);await signOutEverywhere();}; // the app returns to the sign-in screen
  const section={borderTop:`1px solid ${B.borderLight}`,paddingTop:16,marginTop:18};
  return <Modal title="Sign-in security" onClose={onClose}>
    {error&&<div style={MFA_ERR}>{error}</div>}
    {!st?!error&&<Spinner/>:mode==="enroll"?<MfaEnroll onVerified={async()=>{toast("Two-step sign-in is on");setMode("view");await load();}} onCancel={()=>setMode("view")}/>
    :mode==="confirmOff"?<form onSubmit={turnOff}>
      <div style={{fontSize:13,color:B.textSoft,marginBottom:14,lineHeight:1.5}}>To turn it off, type the current code from your authenticator app.</div>
      <MfaCodeInput value={code} onChange={setCode} autoFocus/>
      <div style={{display:"flex",gap:10}}><Btn variant="danger" onClick={turnOff} disabled={busy||code.length!==6}>{busy?"Turning off…":"Turn off"}</Btn><Btn variant="ghost" onClick={()=>{setMode("view");setCode("");setError("");}}>Keep it on</Btn></div>
    </form>
    :mode==="confirmEverywhere"?<div>
      <div style={{fontSize:13,color:B.textSoft,marginBottom:16,lineHeight:1.55}}>This signs your login out on every device and browser, including this one{required?" and ELIOT":""}. Use it if you signed in on a computer that isn't yours, lost a device, or think someone else may have your password (change your password too).</div>
      <div style={{display:"flex",gap:10}}><Btn variant="danger" onClick={everywhere} disabled={busy}>{busy?"Signing out…":"Sign out everywhere"}</Btn><Btn variant="ghost" onClick={()=>setMode("view")}>Cancel</Btn></div>
    </div>
    :<div>
      {IS_NATIVE_APP&&<BiometricSettingRow toast={toast}/>}
      {IS_NATIVE_APP&&<StartupSoundRow/>}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
        <span style={{fontSize:13,fontWeight:700,color:B.navy}}>Two-step sign-in</span>
        <span style={{fontSize:11,fontWeight:700,padding:"2px 9px",borderRadius:999,background:on?"#EAF5EE":"#F1F1EE",color:on?"#1E6B3A":B.textSoft}}>{on?"On":"Off"}</span>
      </div>
      <div style={{fontSize:13,color:B.textSoft,lineHeight:1.55,marginBottom:18}}>{required
        ?`Required for ${ROLE_LABELS[role]||"team"} accounts: each time you sign in, ORDANIS asks for a 6-digit code from the authenticator app on your phone. Lost your phone? Ask an ORDANIS administrator to reset it.`
        :on
        ?"Each time you sign in, ORDANIS asks for a 6-digit code from the authenticator app on your phone, as well as your password."
        :"Add a second step to signing in: after your password, you type a 6-digit code from an authenticator app on your phone. Even if someone learned your password, they couldn't get in without your phone. Recommended."}</div>
      {!required&&(on?<Btn variant="ghost" onClick={()=>{setMode("confirmOff");setError("");}}>Turn off</Btn>:<Btn onClick={()=>{setMode("enroll");setError("");}}>Turn on two-step sign-in</Btn>)}
      {!required&&!on&&onOptOut&&(optedOut
        ?<div style={{fontSize:12,color:B.textMute,marginTop:10,lineHeight:1.5}}>You chose not to use two-step sign-in. You can turn it on any time.{" "}
          <button onClick={async()=>{await onOptOut(false);toast("We'll remind you about two-step sign-in");}} style={{background:"none",border:"none",padding:0,color:B.navyMid,fontSize:12,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>Remind me again</button></div>
        :<div style={{marginTop:10}}><button onClick={async()=>{await onOptOut(true);toast("Got it. You can turn it on any time from Security.");onClose();}} style={{background:"none",border:"none",padding:0,color:B.textSoft,fontSize:12.5,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>No thanks, I don't want two-step sign-in</button></div>)}
      <div style={section}>
        <div style={{fontSize:13,fontWeight:700,color:B.navy,marginBottom:6}}>Sign out everywhere</div>
        <div style={{fontSize:13,color:B.textSoft,lineHeight:1.55,marginBottom:12}}>"Sign Out" only signs out this browser. This ends every session for your login, on all your devices.</div>
        <Btn variant="ghost" onClick={()=>setMode("confirmEverywhere")}>Sign out everywhere…</Btn>
      </div>
    </div>}
  </Modal>;
}
// A "Security" button that opens SecurityModal; sits next to each Sign Out.
// For clients (two-step is optional for them) it is flagged, "Set up security" with a dot, until they turn two-step
// on or choose not to use it; then it goes back to normal. Staff never see the flag (two-step is required for them).
// Native app only: turn Face ID / fingerprint unlock on or off (BiometricLock.jsx).
function BiometricSettingRow({toast}){
  const bio=useBiometricSetting();
  const[busy,setBusy]=useState(false);
  if(!bio.available)return null;
  const flip=async()=>{setBusy(true);try{await bio.setEnabled(!bio.enabled);toast&&toast(bio.enabled?`${bio.label} unlock is off`:`${bio.label} unlock is on`);}catch(_e){}setBusy(false);};
  return <div style={{paddingBottom:16,marginBottom:16,borderBottom:`1px solid ${B.borderLight}`}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
      <span style={{fontSize:13,fontWeight:700,color:B.navy}}>Unlock with {bio.label}</span>
      <span style={{fontSize:11,fontWeight:700,padding:"2px 9px",borderRadius:999,background:bio.enabled?"#EAF5EE":"#F1F1EE",color:bio.enabled?"#1E6B3A":B.textSoft}}>{bio.enabled?"On":"Off"}</span>
    </div>
    <div style={{fontSize:13,color:B.textSoft,lineHeight:1.55,marginBottom:12}}>{bio.enabled
      ?`ORDANIS opens with ${bio.label} on this phone, so you don't type your password each time. On a new phone, or after you sign out, you sign in with your password once.`
      :`Open ORDANIS with ${bio.label} on this phone instead of typing your password each time.`}</div>
    <Btn variant={bio.enabled?"ghost":undefined} disabled={busy} onClick={flip}>{bio.enabled?"Turn off":`Turn on ${bio.label}`}</Btn>
  </div>;
}

// Native app only: the ORDANIS startup sound when the app opens (same sound and setting as the Email Portal).
function StartupSoundRow(){
  const[on,setOn]=useState(startupSoundOn());
  const flip=()=>{const v=!on;try{localStorage.setItem(STARTUP_SOUND_KEY,v?"on":"off");}catch(_e){}setOn(v);};
  return <div style={{paddingBottom:16,marginBottom:16,borderBottom:`1px solid ${B.borderLight}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
    <div>
      <div style={{fontSize:13,fontWeight:700,color:B.navy}}>Sound when the app opens</div>
      <div style={{fontSize:12.5,color:B.textSoft,marginTop:2}}>The ORDANIS chime. Your phone's silent switch also mutes it.</div>
    </div>
    <Btn small variant={on?"ghost":undefined} onClick={flip}>{on?"Turn off":"Turn on"}</Btn>
  </div>;
}

function SecurityButton({role,toast,style,label="🔒 Security"}){
  const[open,setOpen]=useState(false);
  const optional=!MFA_REQUIRED_ROLES.includes(role);
  const[st,setSt]=useState(null); // {on, optedOut}
  const check=useCallback(async()=>{
    if(!optional)return;
    try{
      const m=await mfaStatus();
      const{data:{user}}=await sb.auth.getUser();
      let opted=false;
      if(user){const{data}=await sb.from("user_profiles").select("mfa_opted_out_at").eq("id",user.id).maybeSingle();opted=!!data?.mfa_opted_out_at;}
      setSt({on:!!m.verified.length,optedOut:opted});
    }catch(_e){setSt(null);}
  },[optional]);
  useEffect(()=>{check();},[check]);
  const setOptOut=async v=>{
    const{error}=await sb.rpc("mfa_opt_out_set",{p_opt_out:v});
    if(error){toast(error.message,"error");return;}
    setSt(x=>x?{...x,optedOut:v}:x);
  };
  // Clients in the native app sign in with Face ID / fingerprint (BiometricLock.jsx), so the app doesn't nag them to
  // set up an authenticator; it stays available in Security for anyone who wants it. Employees always need it.
  const flagged=optional&&st&&!st.on&&!st.optedOut&&!IS_NATIVE_APP;
  const iconOnly=String(label).trim()==="🔒";
  const flagStyle=flagged?{...style,background:"#fef3e2",border:"1px solid #e8b04a",color:"#8a5c00",fontWeight:700,position:"relative"}:style;
  return <><button onClick={()=>setOpen(true)} title={flagged?"Two-step sign-in isn't set up yet. Recommended.":"Two-step sign-in and sign out everywhere"}
      aria-label={flagged?"Security: two-step sign-in isn't set up yet":undefined} style={flagStyle}>
      {flagged?(iconOnly?"🔒":"🔒 Set up security"):label}
      {flagged&&<span aria-hidden="true" style={{position:"absolute",top:-3,right:-3,width:9,height:9,borderRadius:"50%",background:"#d9822b",border:"2px solid #fff"}}/>}
    </button>
    {open&&<SecurityModal role={role} toast={toast} optedOut={!!st?.optedOut} onOptOut={optional?setOptOut:null}
      onClose={()=>{setOpen(false);check();}}/>}</>;
}

function SetPasswordGate({onDone}){
  const[pw,setPw]=useState("");
  const[pw2,setPw2]=useState("");
  const[error,setError]=useState("");
  const[saving,setSaving]=useState(false);
  const[showPw,setShowPw]=useState(false);
  const submit=async e=>{
    e.preventDefault();
    setError("");
    if(pw.length<MIN_PASSWORD_LENGTH){setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);return;}
    if(pw!==pw2){setError("Passwords don\'t match");return;}
    setSaving(true);
    const{error:err}=await sb.auth.updateUser({password:pw});
    setSaving(false);
    if(err){setError(err.message||"Could not set your password.");return;}
    onDone();
  };
  return <div style={{minHeight:"100vh",background:preBg(),display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"\'DM Sans\',sans-serif",padding:20}}>
    <form onSubmit={submit} style={{background:B.white,borderRadius:16,padding:"32px 34px",maxWidth:400,width:"100%",boxShadow:B.shadowMd,border:`1px solid ${B.borderLight}`}}>
      <div style={{fontFamily:"\'Cormorant Garamond\',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:6}}>Set your password</div>
      <div style={{fontSize:13,color:B.textSoft,marginBottom:20,lineHeight:1.5}}>Choose a password for your new account. You&apos;ll use it to sign in from now on.</div>
      {error&&<div style={{background:"#fde8e8",border:"1px solid #f5c6c6",color:"#8b1a1a",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12.5}}>{error}</div>}
      <Field label="New password" required><PasswordField show={showPw} onToggle={()=>setShowPw(v=>!v)} autoFocus autoComplete="new-password" value={pw} onChange={e=>setPw(e.target.value)} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}/></Field>
      <Field label="Confirm password" required><PasswordField show={showPw} onToggle={()=>setShowPw(v=>!v)} autoComplete="new-password" value={pw2} onChange={e=>setPw2(e.target.value)}/></Field>
      <Btn onClick={submit} disabled={saving}>{saving?"Saving…":"Set password & continue"}</Btn>
    </form>
  </div>;
}

function LoginScreen(){
  const[mode,setMode]=useState("login");
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[error,setError]=useState("");
  // Why the last session ended, when it wasn't this tab's own Sign Out (set by signOutEverywhere / the session watcher).
  const[signedOutNote]=useState(()=>{try{const r=sessionStorage.getItem(SIGNED_OUT_KEY);sessionStorage.removeItem(SIGNED_OUT_KEY);
    return r==="everywhere"?"You've been signed out on all your devices.":r==="revoked"?"You were signed out, from another tab or device. Please sign in again.":"";}catch(_e){return "";}});
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
    if(loading)return;
    const em=email.trim().toLowerCase();
    if(!em||!password)return setError("Please enter your email and password.");
    setLoading(true);setError("");
    const{error:e}=await sb.auth.signInWithPassword({email:em,password});
    setLoading(false);
    // A new sign-up's login is blocked until its payment is confirmed (usually a few seconds), and an
    // archived household's login is blocked for good. Either way Supabase's own message is "User is
    // banned", which should never reach a client.
    if(e)setError(/banned/i.test(e.message||"")
      ?"This account can't sign in yet. If you've just paid, your account is still being set up: wait a minute, then try again. If this keeps happening, please contact us."
      :e.message);
  };
  const handleReset=async()=>{
    if(loading)return;
    const em=email.trim().toLowerCase();
    if(!em)return setError("Please enter your email address.");
    if(!EMAIL_RE.test(em))return setError("Enter a valid email address, like name@example.com.");
    setLoading(true);setError("");
    const{error:e}=await sb.auth.resetPasswordForEmail(em,{redirectTo:window.location.origin});
    setLoading(false);
    if(e)setError(e.message);else setResetSent(true);
  };

  const introDone=introPhase==="done";
  return(
    <div style={{minHeight:"100vh",background:preBg(),display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans','Helvetica Neue',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <div style={{position:"fixed",inset:0,backgroundImage:`radial-gradient(circle at 20% 80%,rgba(206,182,132,0.16) 0%,transparent 50%)`,pointerEvents:"none"}}/>
      {introPhase==="playing"&&<canvas ref={canvasRef} style={{position:"fixed",inset:0,zIndex:5,pointerEvents:"none"}}/>}
      <div style={{background:B.white,borderRadius:20,padding:"32px 24px",width:"100%",maxWidth:528,boxShadow:B.shadowMd,border:`1px solid ${B.borderLight}`,borderTop:`3px solid ${B.gold}`,position:"relative",zIndex:1,margin:"0 16px"}}>
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
            {/* A real <form> with labelled fields, so the browser's password manager saves and offers this
                login for this site only. The email portal (emailportal.ordanisos.com) uses the same email
                address as its username; without these hints Chrome guessed and mixed the two up. */}
            <form name="signin" onSubmit={e=>{e.preventDefault();if(mode==="login")handleLogin();else handleReset();}}>
            <Field label="Email" required><input type="email" id="signin-email" name="email" autoComplete="username" value={email} onChange={e=>{setEmail(e.target.value);setError("");}} placeholder={"you@"+BRAND.emailDomain} autoFocus style={{...inp,fontSize:15,padding:"13px 16px"}}/></Field>
            {mode==="login"&&<Field label="Password" required><PasswordField id="signin-password" name="password" autoComplete="current-password" value={password} onChange={e=>{setPassword(e.target.value);setError("");}} placeholder="••••••••" style={{fontSize:15,padding:"13px 16px"}}/></Field>}
            {signedOutNote&&!error&&mode==="login"&&<div role="status" style={{fontSize:12,color:B.navy,marginBottom:12,fontWeight:600,padding:"8px 12px",background:"#EEF3F8",borderRadius:8}}>{signedOutNote}</div>}
            {error&&<div style={{fontSize:12,color:"#d43030",marginBottom:12,fontWeight:600,padding:"8px 12px",background:"#fde8e8",borderRadius:8}}>{error}</div>}
            <button type="submit" disabled={loading} style={{width:"100%",background:`linear-gradient(135deg,${B.navy},${B.navyMid})`,color:B.white,border:"none",borderRadius:10,padding:"13px",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",fontFamily:"inherit",letterSpacing:"0.06em",marginBottom:16,opacity:loading?.7:1}}>
              {loading?"Please wait…":mode==="login"?"SIGN IN":"SEND RESET LINK"}
            </button>
            </form>
            <div style={{textAlign:"center"}}>
              {mode==="login"?<button onClick={()=>{setMode("reset");setError("");}} style={{background:"none",border:"none",color:B.textSoft,fontSize:12,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>Forgot your password?</button>:<button onClick={()=>{setMode("login");setError("");}} style={{background:"none",border:"none",color:B.textSoft,fontSize:12,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>Back to sign in</button>}
            </div>
            {mode==="login"&&!HIDE_SIGNUP&&<div style={{textAlign:"center",marginTop:16,paddingTop:16,borderTop:`1px solid ${B.borderLight}`}}>
              <span style={{fontSize:12,color:B.textMute}}>New to {BRAND.name}? </span>
              <a href={SIGNUP_PAUSED_URL||"/signup"} style={{fontSize:12,color:B.navy,fontWeight:700,textDecoration:"underline"}}>Create an Account</a>
            </div>}
          </>
        ))}
        {/* ORDANIS's own sign-in closes on its line (Will, 2026-10-30); a firm's skinned sign-in keeps its own name and tagline. */}
        {introDone&&(BRAND.name==="ORDANIS"
          ?<div style={{textAlign:"center",marginTop:24,fontFamily:"Georgia,'Times New Roman',serif",fontStyle:"italic",fontSize:14,color:B.textSoft,letterSpacing:"0.01em"}}>Wealth, well administered.</div>
          :<div style={{textAlign:"center",marginTop:24,fontSize:11,color:B.textMute}}>{BRAND.name} · {BRAND.tagline}</div>)}
      </div>
    </div>
  );
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
// annual/12 IS the payment. An insurer's premium is annual: $14,200/12 = $1,183 is a smoothed
// average and nobody pays the carrier $1,183 in any month.
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

// ── FAMILY DASHBOARD ──────────────────────────────────────────────────────────
// ── AI HELP CENTER ────────────────────────────────────────────────────────────
// Builds a compact, family-scoped snapshot of everything on the dashboard, then
// lets the user ask natural-language questions answered by the family-ai-assistant
// Supabase Edge Function. Read-only; no data ever leaves the family's own scope.
function buildFamilySnapshot(family,data){
  const fid=family.id;
  const today=new Date(); today.setHours(0,0,0,0);
  const daysFromNow=d=>{ if(!d)return null; const t=parseLocalDate(d); if(isNaN(t.getTime()))return null; const t0=new Date(t.getFullYear(),t.getMonth(),t.getDate()); return Math.round((t0-today)/86400000); };
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

  // Loans & Lines: debt that isn't a mortgage on a listed property.
  const loans=(data.loans||[]).filter(l=>l.familyId===fid).map(l=>({
    type:l.loanType||null, name:(l.name||"").trim()||null, lender:l.lender||null,
    balance:num(l.currentBalance), balanceAsOf:l.balanceAsOf||null,
    creditLimit:(l.creditLimit===""||l.creditLimit==null)?null:num(l.creditLimit),
    originalAmount:(l.originalAmount===""||l.originalAmount==null)?null:num(l.originalAmount),
    interestRatePct:(l.interestRate===""||l.interestRate==null)?null:num(l.interestRate), rateType:l.rateType||null,
    payment:(l.paymentAmount===""||l.paymentAmount==null)?null:num(l.paymentAmount), paymentFrequency:l.paymentFrequency||null,
    maturityDate:l.maturityDate||null, daysUntilMaturity:daysFromNow(l.maturityDate),
    securedByProperty:l.propertyId?((data.properties||[]).find(p=>p.id===l.propertyId)||{}).address||null:null,
    securedByValuable:l.valuableId?((data.valuables||[]).find(v=>v.id===l.valuableId)||{}).description||null:null,
    securedByAccount:l.portfolioAccountId?((data.portfolio_accounts||[]).find(a=>a.id===l.portfolioAccountId)||{}).institution||null:null,
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
        label:EXPENSE_CATEGORY_LABEL[key]||"Uncategorized",
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
  // A client's Private folder never reaches the AI assistant (migration client_private_documents).
  const documents=(data.documents||[]).filter(d=>d.familyId===fid&&!d.privateOwnerId).map(d=>{
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
    +portfolioAccounts.filter(a=>a.type==="Line of Credit").reduce((s,a)=>s+a.currentBalance,0)
    +loans.reduce((s,l)=>s+l.balance,0);
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
    `say that some spend is uncategorized rather than presenting the total as complete.`);

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
      `categorized as ${EXPENSE_CATEGORY_LABEL[m.category]||m.category}. Say the vendor exists and the cost is not `+
      `recorded. Do not estimate it, and do not attribute part of another line to it.`));
  }

  return {
    today:localDayISO(today),
    // servicePlan is stated so the assistant can answer "do you pay my bills?" and "do you run my
    // renewals?" correctly instead of inferring it from the absence of data. Absence of a payment
    // register could mean Core, or it could mean nothing has been recorded yet, and those two
    // deserve different answers.
    family:{ name:family.name||null, servicePlan:planLabel(plan),
             firmPaysBills:billPay, runsWorkflows:planAllows(plan,"workflows") },
    totals:{ netWorth, realEstate:totalRE, totalDebt, portfolio:totalPortfolio, valuables:totalValuables },
    counts:{ properties:properties.length, portfolioAccounts:portfolioAccounts.length, loans:loans.length, valuables:valuables.length, openTasks:tasks.length, documents:documents.length,
             familyMembers:familyMembers.length, serviceProviders:serviceProviders.length,
             notes:(data.notes||[]).filter(n=>n.familyId===fid).length },
    properties, portfolioAccounts, loans, valuables, tasks, cashFlowEvents, documents,
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
  "Which loans mature within the next 12 months?",
];

function FamilyAssistant({family,data,reload,compact,toast}){
  const isMobile=useIsMobile();
  // Read the family from the live data set so a rename reflects immediately
  // (the `family` prop passed by parents can be a stale snapshot).
  const fam=(data.families||[]).find(x=>x.id===family.id)||family;
  const assistantName=(fam.assistantName||"").trim()||"ORDANIS";
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
      await saveAssistantName(family.id,nm);
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
      if(fnErr)throw new Error(ASSISTANT_UNAVAILABLE);
      if(resp&&resp.error)throw new Error(ASSISTANT_UNAVAILABLE);
      setMessages(m=>[...m,{role:"assistant",content:(resp&&resp.answer)||"I couldn't put an answer together that time. Could you try asking it a different way?"}]);
    }catch(e){
      setError(ASSISTANT_UNAVAILABLE);
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
            <input autoFocus value={nameInput} onChange={e=>setNameInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveName();if(e.key==="Escape"){setEditingName(false);setNameInput(assistantName);}}} maxLength={40} placeholder="ORDANIS"
              style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?20:24,color:B.navy,fontWeight:600,border:`1px solid ${B.border}`,borderRadius:8,padding:"2px 8px",width:160,outline:"none"}}/>
            <Btn small onClick={saveName} disabled={savingName}>{savingName?"…":"Save"}</Btn>
            <button onClick={()=>{setEditingName(false);setNameInput(assistantName);}} style={{background:"none",border:"none",color:B.textSoft,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
          </div>
        : <>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?22:26,color:B.navy,fontWeight:600}}>Ask {assistantName}</div>
            <button onClick={()=>{setNameInput(assistantName==="ORDANIS"?"":assistantName);setEditingName(true);}} title="Rename your assistant" style={{background:"none",border:"none",color:B.gold,fontSize:14,cursor:"pointer",padding:"2px 4px"}}>✎</button>
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

// Shown when the assistant service itself fails (provider outage, billing, network). It used to say
// "please contact your Expert", which reads as "I don't have that information" and sends the family
// off to chase a problem only the firm can fix. Real "not in your data" answers still come from the
// assistant in its own words.
const ASSISTANT_UNAVAILABLE="I couldn't get an answer through just now. Please try again in a moment.";

// Saves the assistant's name. A family login has no UPDATE access to its own `families` row, so the
// write goes through set_my_assistant_name() -- a database function that can change only this one
// field, only on the caller's own family. Admins/advisors are refused by that function and write the
// row directly, which their row-level policy allows. Either way we confirm a row really changed: a
// blocked update returns success with zero rows, which is why the name used to look saved and then
// revert on the next load.
async function saveAssistantName(familyId,name){
  const nm=(name||"").trim().slice(0,40);
  if(!nm)throw new Error("Please enter a name.");
  // Quick checks here for instant feedback; the database enforces the real rules (including the blocked-word list).
  if(nm.length<2)throw new Error("Names must be 2 to 40 characters.");
  if(!/^[\p{L}\p{N}][\p{L}\p{N} '\u2019.\-]*$/u.test(nm))throw new Error("Names can use letters, numbers, spaces, hyphens, apostrophes and periods.");
  const{error:rpcErr}=await sb.rpc("set_my_assistant_name",{p_name:nm});
  if(!rpcErr)return nm;
  // A rejected name is a rule message, not a permissions problem -- show it instead of trying the admin path.
  if(/different name|Names (must|can|need|cannot)/i.test(rpcErr.message||""))throw new Error(rpcErr.message);
  const{data:rows,error}=await sb.from("families").update({assistant_name:nm}).eq("id",familyId).select("id");
  if(error)throw error;
  if(!rows||!rows.length)throw new Error("Couldn't save the name \u2014 your account isn't allowed to change it. Please contact the ORDANIS team.");
  return nm;
}

// "Name your assistant" prompt: shown on a client's 1st and 2nd login (if they still haven't picked
// a name), never from the 3rd on. The login count lives on the user's profile
// (record_assistant_prompt_login); the per-tab session cache below keeps a page reload within the
// same login from counting as another login.
const _assistantPromptCalls={};
const assistantPromptKey=uid=>"ordanis_assistant_prompt:"+uid;
function readAssistantPromptSession(uid){
  try{const v=JSON.parse(sessionStorage.getItem(assistantPromptKey(uid))||"null");return v&&typeof v.count==="number"?v:null;}catch(e){return null;}
}
function writeAssistantPromptSession(uid,v){try{sessionStorage.setItem(assistantPromptKey(uid),JSON.stringify(v));}catch(e){}}
function resetAssistantPromptSession(){
  try{Object.keys(sessionStorage).filter(k=>k.indexOf("ordanis_assistant_prompt:")===0).forEach(k=>sessionStorage.removeItem(k));}catch(e){}
  Object.keys(_assistantPromptCalls).forEach(k=>delete _assistantPromptCalls[k]);
}
function countAssistantPromptLogin(uid){
  const cached=readAssistantPromptSession(uid);
  if(cached)return Promise.resolve(cached);
  if(!_assistantPromptCalls[uid]){
    _assistantPromptCalls[uid]=(async()=>{
      let n=3; // if the counter can't be read or written, err on the side of not nagging
      try{const{data,error}=await sb.rpc("record_assistant_prompt_login");if(!error&&typeof data==="number")n=data;}catch(e){}
      const v={count:n,dismissed:false};
      writeAssistantPromptSession(uid,v);
      return v;
    })();
  }
  return _assistantPromptCalls[uid];
}

// ── PLAN PREVIEW VIDEO ───────────────────────────────────────────────────────
// One short video per plan, kept in the private "Videos" storage bucket. A client is offered the video
// for their plan when they sign in, until they have played it once (or it has been offered 3 times).
// After that, the "Watch the video" link in the assistant's sign-in greeting is how they watch it.
// The counter lives on user_profiles (record_plan_video_offer / mark_plan_video_seen), so it follows the
// person across devices; the per-tab cache stops a page reload from counting as another sign-in.
const PLAN_VIDEO_BUCKET="Videos";
const PLAN_VIDEO_FILE={basic:"ORDANIS_Basic.mp4",core:"ORDANIS_Core.mp4",premier:"ORDANIS_Premier.mp4"};
const planVideoKey=uid=>"ordanis_assistant_prompt:video:"+uid; // shares the prefix so sign-out clears it
function recordPlanVideoOffer(uid){
  const k="video:"+uid;
  try{const v=JSON.parse(sessionStorage.getItem(planVideoKey(uid))||"null");if(v&&typeof v.offers==="number")return Promise.resolve(v);}catch(e){}
  if(!_assistantPromptCalls[k]){
    _assistantPromptCalls[k]=(async()=>{
      let v={offers:99,seen:true}; // if the counter can't be read or written, err on the side of not nagging
      try{const{data,error}=await sb.rpc("record_plan_video_offer");if(!error&&data&&typeof data.offers==="number")v={offers:data.offers,seen:!!data.seen};}catch(e){}
      try{sessionStorage.setItem(planVideoKey(uid),JSON.stringify(v));}catch(e){}
      return v;
    })();
  }
  return _assistantPromptCalls[k];
}
function markPlanVideoSeenSession(uid){
  try{sessionStorage.setItem(planVideoKey(uid),JSON.stringify({offers:99,seen:true}));}catch(e){}
}
function PlanVideoModal({plan,mode,onPlayed,onClose}){
  const file=PLAN_VIDEO_FILE[plan];
  const label=planLabel(plan);
  const[started,setStarted]=useState(mode==="watch");
  const[url,setUrl]=useState(null);
  const[err,setErr]=useState("");
  useEffect(()=>{
    if(!started||!file)return;
    let cancelled=false;
    (async()=>{
      try{
        const{data,error}=await sb.storage.from(PLAN_VIDEO_BUCKET).createSignedUrl(file,3600);
        if(cancelled)return;
        if(error||!data||!data.signedUrl)throw error||new Error("no link");
        setUrl(data.signedUrl);
      }catch(e){ if(!cancelled)setErr("We couldn't load the video right now. Please try again in a moment."); }
    })();
    return()=>{cancelled=true;};
  },[started,file]);
  if(!file)return null;
  return <Modal title={`${label} Plan Preview`} onClose={onClose} wide>
    <div style={{fontSize:14,color:B.text,lineHeight:1.55,marginBottom:16}}>
      Here is a quick video to explore your {label} Plan.
    </div>
    {!started&&<div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:10,flexWrap:"wrap"}}>
      <Btn variant="ghost" onClick={onClose}>Not now</Btn>
      <Btn onClick={()=>setStarted(true)}>▶ Watch the video</Btn>
    </div>}
    {started&&!err&&!url&&<div style={{fontSize:13,color:B.textSoft,padding:"28px 0",textAlign:"center"}}>Loading the video…</div>}
    {started&&err&&<div style={{fontSize:13,color:B.red||"#B3261E",padding:"12px 0"}}>{err}</div>}
    {started&&url&&<video src={url} controls autoPlay playsInline preload="metadata" controlsList="nodownload"
      onPlay={onPlayed} style={{width:"100%",maxHeight:"62vh",borderRadius:10,background:"#000",display:"block"}}/>}
    {started&&<div style={{display:"flex",justifyContent:"flex-end",marginTop:16}}><Btn variant="ghost" onClick={onClose}>Close</Btn></div>}
  </Modal>;
}

function AssistantWelcome({family,data,reload,onClose,userProfile,toast,onWatchVideo}){
  const famRow=(data.families||[]).find(x=>x.id===family.id)||family;
  const assistantName=(famRow.assistantName||"").trim()||"ORDANIS";
  const[emailOpen,setEmailOpen]=useState(false);
  // Only a plan with an assigned Expert (Premier) gets the "Email my ORDANIS Expert" button --
  // Basic and Core have no Expert, so offering one would point them at someone who isn't theirs.
  const isClient=userProfile&&userProfile.role==="client"&&planAllows(famRow.plan,"assignedExpert");
  return <Modal title={`Hi — I'm ${assistantName}`} onClose={onClose} wide>
    <div style={{fontSize:14,color:B.text,lineHeight:1.55,marginBottom:16}}>
      Anything I can help you find before you dive in? Ask me about your net worth, properties, loans, insurance, tasks, or documents — or head straight to the dashboard.
    </div>
    {onWatchVideo&&<div style={{marginBottom:14}}>
      <button type="button" onClick={onWatchVideo} style={{background:"none",border:"none",padding:0,cursor:"pointer",color:B.navy,fontSize:13.5,fontWeight:600,fontFamily:"inherit",textDecoration:"underline",textUnderlineOffset:3}}>
        ▶ Watch the {planLabel(famRow.plan)||""} plan video
      </button>
    </div>}
    <FamilyAssistant family={family} data={data} reload={reload} compact toast={toast}/>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginTop:16,flexWrap:"wrap"}}>
      {isClient?<Btn variant="ghost" onClick={()=>setEmailOpen(true)}>✉ Email my ORDANIS Expert</Btn>:<span/>}
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
// onDemand (staff data on demand, scaling step 2): the client list is searched on the server and the chosen client's
// records are loaded when picked, instead of coming from the full download.
function FloatingAssistant({family,families,data,reload,toast,userProfile,onDemand}){
  const[open,setOpen]=useState(false);
  const[picked,setPicked]=useState(null);
  const[q,setQ]=useState("");
  const isMobile=useIsMobile();
  const active=family||picked;
  const[remote,setRemote]=useState([]);
  useEffect(()=>{
    if(!onDemand||!open||active)return;
    const t=setTimeout(()=>{
      sb.rpc("staff_household_page",{p_search:q.trim()||null,p_limit:30,p_offset:0,p_today:localISODate()}).then(({data:rows})=>setRemote((rows||[]).map(r=>toClient(r.family))));
    },250);
    return()=>clearTimeout(t);
  },[onDemand,open,q,active]);
  const[bundle,setBundle]=useState(null);
  const loadPicked=useCallback(()=>{if(onDemand&&picked&&!family)loadHouseholdBundle(picked).then(setBundle).catch(()=>toast("Could not load that client","error"));},[onDemand,picked,family]);
  useEffect(()=>{setBundle(null);loadPicked();},[loadPicked]);
  const useRemote=onDemand&&!family;
  const list=useRemote?remote:(families||[]).filter(f=>!q.trim()||(f.name||"").toLowerCase().includes(q.trim().toLowerCase()));
  const assistantName=((active&&active.assistantName)||"").trim()||"ORDANIS";
  const close=()=>{setOpen(false);setPicked(null);setQ("");};

  return <>
    <button onClick={()=>setOpen(true)} title={`Ask ${assistantName}`} aria-label={`Ask ${assistantName}`}
      style={{position:"fixed",bottom:isMobile?"calc(18px + env(safe-area-inset-bottom))":26,right:isMobile?18:26,zIndex:900,width:isMobile?54:60,height:isMobile?54:60,
        borderRadius:"22%",border:"none",background:B.navy,cursor:"pointer",padding:0,overflow:"hidden",
        boxShadow:"0 6px 22px rgba(0,0,0,0.28)",display:"flex",alignItems:"center",justifyContent:"center",transition:"transform .15s ease"}}
      onMouseEnter={e=>e.currentTarget.style.transform="scale(1.07)"}
      onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
      <BrandMark reversed size={isMobile?30:34}/>
    </button>

    {open&&<Modal wide title={active?`Ask ${assistantName} — ${(active.name||"").replace(" [DEMO]","")}`:`Ask ${assistantName}`} onClose={close}>
      {active
        ? <>
            {useRemote&&!bundle?<Spinner/>:<FamilyAssistant family={active} data={useRemote?bundle:data} reload={useRemote?loadPicked:reload} toast={toast} compact/>}
            {!family&&<div style={{marginTop:14,textAlign:"center"}}>
              <Btn small variant="ghost" onClick={()=>{setPicked(null);setQ("");}}>← Choose a different client</Btn>
            </div>}
          </>
        : <>
            <div style={{fontSize:12.5,color:B.textSoft,marginBottom:12,lineHeight:1.5}}>
              {assistantName} answers from one client's records at a time. Which client?
            </div>
            {(useRemote||(families||[]).length>6)&&<Inp autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search clients…" style={{marginBottom:10}}/>}
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
// A blank box saves as null, but a real zero (a paid-off loan, a $0 utility bill) stays zero. "value||null" turned both into null.
const numOrNull=v=>(v===""||v==null)?null:v;
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Shared check for the contact forms: an email, if given, must look like one, and a phone, if given, must have
// enough digits to be dialled (10 for a US number; 8 to 15 when it starts with +, which means international).
const contactProblem=f=>{
  const em=String(f.email||"").trim();
  if(em&&!EMAIL_RE.test(em))return "That email address doesn't look right. It should look like name@example.com.";
  const ph=String(f.phone||"").trim();
  if(ph){
    const digits=ph.replace(/\D/g,"");
    const intl=ph.startsWith("+")&&!/^\+1\b/.test(ph);
    const nums=ph.split(/x|ext/i)[0].replace(/\D/g,"");
    if(intl?(digits.length<8||digits.length>15):!(nums.length===10||(nums.length===11&&nums.startsWith("1"))))return "That phone number needs 10 digits, like (813) 555-0142. For an international number, start it with +.";
  }
  return null;
};
// A task reminder of 0 means "no reminder". The old `x||7` turned 0 into 7, so it could never be saved.
// Archived households are cancelled and login-disabled; counts and pickers show active families only.
const isActiveFamily=f=>!(f&&(f.archived_at||f.archivedAt));
const reminderDaysOr7=v=>{if(v===null||v===undefined||v==="")return 7;const n=Number(v);return Number.isFinite(n)&&n>=0?n:7;};
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
    if(customEmail.trim()||customName.trim()){setErr("You started adding someone else but did not press + Add. Press + Add to include them, or clear those two boxes.");return;}
    setSending(true);setErr(null);
    try{
      const{data:resp,error}=await sb.functions.invoke("send-advisor-email",{body:{toEmails:recipients.map(r=>r.email),subject,message:msg}});
      if(error)throw new Error(error.message||"Could not send.");
      if(resp&&resp.error)throw new Error(resp.detail||resp.error);
      setSent(true);
    }catch(e){ setErr(e&&e.message?e.message:"Could not send the email."); }
    finally{ setSending(false); }
  };

  return <Modal title="Email your ORDANIS Expert" onClose={onClose}>
    {sent?<div style={{textAlign:"center",padding:"12px 0"}}>
      <div style={{fontSize:40,marginBottom:8}}>✓</div>
      <div style={{fontSize:16,color:B.navy,fontWeight:600,fontFamily:"'Cormorant Garamond',serif"}}>Message sent</div>
      <div style={{fontSize:13,color:B.textSoft,marginTop:6,lineHeight:1.5}}>Your message went to <strong>{recipients.map(r=>r.name).join(", ")}</strong>{ccPrimary?<>, with <strong>{ccPrimary.name}</strong> copied</>:null}. They can reply directly to your email.</div>
      <div style={{marginTop:18}}><Btn onClick={onClose}>Done</Btn></div>
    </div>:<>
      <Field label="To" required>
        {options.length>0
          ? <Sel value={toEmail} onChange={e=>setToEmail(e.target.value)}>{options.map(o=><option key={o.email} value={o.email}>{o.name}{o.primary?" (primary ORDANIS Expert)":""} · {o.email}</option>)}</Sel>
          : <div style={{fontSize:13,color:B.textMute,padding:"9px 0"}}>No designated ORDANIS Expert is on file yet — add one under Team Member & Contacts, or add someone below.</div>}
      </Field>
      {ccPrimary&&<div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:B.navy,background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:8,padding:"9px 12px",marginBottom:12}}>
        <span style={{fontSize:13}}>🔒</span>
        <div style={{minWidth:0}}>
          <div><span style={{fontWeight:700}}>Cc:</span> {ccPrimary.name} · {ccPrimary.email}</div>
          <div style={{fontSize:11,color:B.textMute,marginTop:1}}>Your primary ORDANIS Expert is always copied and can't be removed.</div>
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
      {!ccPrimary&&!primaryEmailRaw&&<div style={{fontSize:11,color:B.textMute,marginBottom:12}}>No primary ORDANIS Expert is on file for your account yet — this will go out without an automatic copy.</div>}
      <Field label="Subject" required><Inp maxLength={200} value={subject} onChange={e=>setSubject(e.target.value)}/></Field>
      <Field label="Message" required><textarea maxLength={10000} value={msg} onChange={e=>setMsg(e.target.value)} rows={7} placeholder="Write your message…" style={{width:"100%",resize:"vertical",border:`1px solid ${B.border}`,borderRadius:8,padding:"11px 13px",fontSize:14,fontFamily:"inherit",color:B.text,background:B.white,outline:"none",lineHeight:1.5}}/></Field>
      <div style={{fontSize:11,color:B.textMute,margin:"6px 0 14px"}}>{clientEmail?<>Sent from your address (<strong>{clientEmail}</strong>) — recipients can reply straight to you.</>:"Recipients can reply straight to you."}</div>
      {err&&<div style={{background:"#fde8e8",border:"1px solid #f5c6c6",color:"#8b1a1a",borderRadius:8,padding:"9px 12px",fontSize:12,marginBottom:12}}>⚠ {err}</div>}
      <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
        <button onClick={onClose} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
        <Btn onClick={send} disabled={sending||!recipients.length||!subject.trim()||!msg.trim()}>{sending?"Sending…":"✉ Send email"}</Btn>
      </div>
      <div style={{display:"flex",justifyContent:"flex-end"}}>
        {!sending&&(!recipients.length||!subject.trim()||!msg.trim())&&<span style={{fontSize:11,color:B.textMute,marginTop:8}}>Fill in the fields marked * to send.</span>}
      </div>
    </>}
  </Modal>;
}

// Tab changes on the household pages: the new tab's content fades and rises in (about a fifth of a second) and the
// view starts at its top, instead of swapping instantly with the old scroll position. The element is not remounted
// (that would reset forms and open panels); the animation is restarted on it. Off for "reduce motion" devices.
// Inactive tabs get a soft gold wash on hover (!important: the buttons' own inline colours would otherwise win).
const TAB_MOTION_CSS=`@keyframes pcmTabIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.pcm-tab-in{animation:pcmTabIn 220ms cubic-bezier(.2,.7,.2,1) backwards}
.pcm-tab{transition:background 160ms ease,color 160ms ease,border-color 160ms ease}
.pcm-tab:not([aria-current]):hover{color:${B.navy}!important;background:rgba(206,182,132,0.12)!important}
@media (prefers-reduced-motion:reduce){.pcm-tab-in{animation:none}.pcm-tab{transition:none}}`;
function useTabEntrance(activeTab,{scrollWindow=false}={}){
  const ref=useRef(null);
  const first=useRef(true);
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    if(first.current){first.current=false;return;}
    if(scrollWindow){if(window.scrollY>0)window.scrollTo({top:0});}else el.scrollTop=0;
    el.classList.remove("pcm-tab-in");void el.offsetWidth;el.classList.add("pcm-tab-in");
    // Drop the class once it has played: a lingering transform would make the panel, not the screen, the frame for
    // anything fixed inside it.
    const done=()=>{el.classList.remove("pcm-tab-in");el.removeEventListener("animationend",done);};
    el.addEventListener("animationend",done);
  },[activeTab,scrollWindow]);
  return ref;
}

// Collapsible cards (Will, 2026-10-30): properties, portfolio accounts, cash-flow settings and events, workflows and
// valuables open closed, showing just their name and key figure. Tapping the top row opens or closes the details.
// Which cards are open is kept per screen visit, not saved.
function useOpenSet(){
  const[open,setOpen]=useState(()=>new Set());
  return[id=>open.has(id),id=>setOpen(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;})];
}
// Props for a card's clickable top row: works with a tap, Enter or Space, and tells screen readers it expands.
const collapseRow=(open,toggle)=>({role:"button",tabIndex:0,"aria-expanded":open,onClick:toggle,
  onKeyDown:e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle();}},style:{cursor:"pointer"}});
function Chevron({open}){
  return <span aria-hidden="true" style={{display:"inline-block",color:B.textSoft,fontSize:12,marginLeft:8,transition:"transform .2s ease",transform:open?"rotate(180deg)":"none"}}>▾</span>;
}

// Phones: the household's sections as a menu rather than a tab row you swipe through. The button shows the current
// section; tapping it drops a short spinning wheel (Will, 2026-10-30: the full-page list was too long). About five
// sections show at once, the one in the middle sits in a gold band, the rest fade and tilt away like a picker wheel.
// When the wheel comes to rest on a different section, that section opens by itself (Will: "don't make the client
// click it"); tapping a section spins it to the middle and opens it too. Tab ids follow the same rule as the desktop row.
// items: [{id,label,assistant}] (the family portal's tabs), or the staff household's tab names via `tabs`.
const WHEEL_ROW=46, WHEEL_ROWS=5, WHEEL_SETTLE_MS=450;
function HouseholdSectionMenu({tabs,items,activeTab,onPick,assistantName}){
  const[open,setOpen]=useState(false);
  const[scrollTop,setScrollTop]=useState(0);
  const wheelRef=useRef(null);
  const frame=useRef(0);
  const settle=useRef(0);      // timer: fires once the wheel has stopped moving
  const touching=useRef(false); // a finger resting on the wheel is not a pause
  const picking=useRef(false);
  const list=items||(tabs||[]).map(t=>({id:t==="CHRIS"?"vault":t.toLowerCase().replace(/\s+/g,""),
    label:t==="Ask ORDANIS"?("Ask "+assistantName):t,assistant:t==="Ask ORDANIS"}));
  const currentIdx=Math.max(0,list.findIndex(t=>t.id===activeTab));
  const current=list[currentIdx]||{label:""};
  const pad=WHEEL_ROW*Math.floor(WHEEL_ROWS/2);
  const reduceMotion=typeof window!=="undefined"&&window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Open on the current section, already in the middle.
  useEffect(()=>{
    if(!open||!wheelRef.current)return;
    // After layout, or Safari snaps from a half-measured list and lands on the wrong row.
    const el=wheelRef.current;
    const raf=requestAnimationFrame(()=>{el.scrollTop=currentIdx*WHEEL_ROW;setScrollTop(el.scrollTop);});
    const onKey=e=>{if(e.key==="Escape")setOpen(false);};
    window.addEventListener("keydown",onKey);
    picking.current=false;
    return()=>{window.removeEventListener("keydown",onKey);cancelAnimationFrame(raf);cancelAnimationFrame(frame.current);clearTimeout(settle.current);};
  },[open]);
  // The wheel stopped on a section: open it, unless it's the one already showing (that's where it opens).
  const settled=()=>{
    const el=wheelRef.current;
    if(!el||touching.current||picking.current)return;
    const t=list[Math.max(0,Math.min(list.length-1,Math.round(el.scrollTop/WHEEL_ROW)))];
    if(t&&t.id!==activeTab){picking.current=true;onPick(t.id);setOpen(false);}
  };
  const armSettle=()=>{clearTimeout(settle.current);settle.current=setTimeout(settled,WHEEL_SETTLE_MS);};
  const onScroll=e=>{const t=e.currentTarget.scrollTop;cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>setScrollTop(t));armSettle();};
  const pick=(i,id)=>{
    if(picking.current)return;
    picking.current=true;clearTimeout(settle.current);
    const el=wheelRef.current;
    if(el&&Math.abs(el.scrollTop-i*WHEEL_ROW)>2&&!reduceMotion){
      el.scrollTo({top:i*WHEEL_ROW,behavior:"smooth"});
      setTimeout(()=>{onPick(id);setOpen(false);},260);
    }else{onPick(id);setOpen(false);}
  };
  return <div style={{background:B.bg,padding:"8px 12px",borderBottom:`1px solid ${B.border}`,position:"relative",zIndex:open?901:"auto"}}>
    <button onClick={()=>setOpen(o=>!o)} aria-haspopup="listbox" aria-expanded={open} style={{width:"100%",boxSizing:"border-box",display:"flex",alignItems:"center",gap:10,background:B.white,border:`1px solid ${B.border}`,borderTop:`2px solid ${B.gold}`,borderRadius:10,padding:"11px 14px",fontFamily:"inherit",fontSize:15,fontWeight:600,color:B.navy,cursor:"pointer",textAlign:"left"}}>
      <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{current.label}</span>
      <span aria-hidden="true" style={{color:B.textSoft,fontSize:13,transition:"transform .2s ease",transform:open?"rotate(180deg)":"none"}}>▾</span>
    </button>
    {open&&<>
      <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,background:"rgba(9,43,73,0.28)",zIndex:-1}}/>
      <style>{`.pcm-wheel::-webkit-scrollbar{display:none}@keyframes pcmWheelIn{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:none}}`}</style>
      <div style={{position:"absolute",left:12,right:12,top:"calc(100% - 2px)",background:B.white,border:`1px solid ${B.border}`,borderRadius:14,
        boxShadow:"0 14px 34px rgba(9,43,73,0.22)",overflow:"hidden",animation:reduceMotion?"none":"pcmWheelIn .18s ease-out"}}>
        {/* The gold band marks the middle row. */}
        <div aria-hidden="true" style={{position:"absolute",left:10,right:10,top:pad,height:WHEEL_ROW,borderRadius:10,background:"rgba(206,182,132,0.16)",
          borderTop:`1px solid ${B.gold}`,borderBottom:`1px solid ${B.gold}`,pointerEvents:"none"}}/>
        {/* Soft fade at the top and bottom edges, so the wheel reads as round. */}
        <div aria-hidden="true" style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:2,
          background:"linear-gradient(#fff 0%,rgba(255,255,255,0) 30%,rgba(255,255,255,0) 70%,#fff 100%)"}}/>
        <div ref={wheelRef} className="pcm-wheel" role="listbox" aria-label="Go to section" onScroll={onScroll}
          onTouchStart={()=>{touching.current=true;clearTimeout(settle.current);}}
          onTouchEnd={()=>{touching.current=false;armSettle();}} onTouchCancel={()=>{touching.current=false;armSettle();}}
          style={{height:WHEEL_ROW*WHEEL_ROWS,overflowY:"auto",scrollSnapType:"y mandatory",WebkitOverflowScrolling:"touch",scrollbarWidth:"none",
            boxSizing:"border-box",perspective:600}}>
          {/* Spacers (not padding, which Safari's snapping ignores) let the first and last sections reach the middle. */}
          <div aria-hidden="true" style={{height:pad}}/>
          {list.map((t,i)=>{
            const d=(i*WHEEL_ROW-scrollTop)/WHEEL_ROW; // rows away from the middle
            const ad=Math.min(Math.abs(d),3), on=t.id===activeTab, mid=Math.abs(d)<0.5;
            return <button key={t.id} role="option" aria-selected={on} onClick={()=>pick(i,t.id)}
              style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",height:WHEEL_ROW,boxSizing:"border-box",
                scrollSnapAlign:"center",border:"none",background:"transparent",fontFamily:"inherit",cursor:"pointer",
                fontSize:mid?16.5:15,fontWeight:mid||on?700:500,color:mid?B.navy:B.text,
                opacity:Math.max(0.25,1-ad*0.3),
                transform:reduceMotion?"none":`rotateX(${Math.max(-60,Math.min(60,-d*20))}deg) scale(${1-ad*0.06})`,
                transition:"font-size .12s ease"}}>
              {t.assistant&&<span aria-hidden="true" style={{color:B.gold}}>✦</span>}{t.label}
              {on&&!mid&&<span aria-hidden="true" style={{width:5,height:5,borderRadius:3,background:B.gold,marginLeft:2}}/>}
            </button>;})}
          <div aria-hidden="true" style={{height:pad}}/>
        </div>
      </div>
    </>}
  </div>;
}

// ── MEMBER FORM ───────────────────────────────────────────────────────────────
function PropertyContactForm({initial,onSave,onClose}){
  const[f,setF]=useState(initial||{name:"",role:"",company:"",email:"",phone:"",notes:""});
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const[showReq,setShowReq]=useState(false);
  const[err,setErr]=useState("");
  const save=async()=>{if(!f.name.trim()){setShowReq(true);return;}const pr=contactProblem(f);if(pr){setErr(pr);return;}setErr("");setSaving(true);const ok=await onSave({...f,email:String(f.email||"").trim().toLowerCase()});if(ok===false){setSaving(false);return;}onClose();};
  return <div>
    <Field label="Name" required><Inp placeholder="ABC Landscaping" value={f.name} maxLength={120} onChange={set("name")}/></Field>
    <Grid2>
      <Field label="Service / Role" optional><Inp placeholder="Landscaper · Pool · Manager" value={f.role||""} onChange={set("role")}/></Field>
      <Field label="Company" optional><Inp placeholder="Company name" value={f.company||""} onChange={set("company")}/></Field>
    </Grid2>
    <Grid2>
      <Field label="Phone" optional><Inp placeholder="(555) 000-0000" value={f.phone||""} onChange={e=>set("phone")({target:{value:formatPhoneInput(e.target.value)}})}/></Field>
      <Field label="Email" optional><Inp type="email" autoComplete="off" placeholder="contact@company.com" value={f.email||""} onChange={set("email")}/></Field>
    </Grid2>
    <Field label="Notes" optional><Inp placeholder="Optional — schedule, gate code, account #…" value={f.notes||""} onChange={set("notes")}/></Field>
    {showReq&&<ReqHint/>}
    {err&&<div style={{fontSize:12,color:"#8b1a1a",background:"#fff5f5",border:"1px solid #f3c2c2",borderRadius:8,padding:"8px 10px",marginTop:8}}>{err}</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn onClick={save} disabled={saving}>{saving?"Saving…":initial?"Save Changes":"Add Provider"}</Btn>
    </div>
  </div>;
}

// ── TASK FORM (with reminder) ─────────────────────────────────────────────────
// Compute the next due date for a recurring task. Returns YYYY-MM-DD or null.
// Creates the next occurrence of a recurring task, once. Unticking and re-ticking a task used to insert
// another copy each time, and a failed insert was never checked while the toast still announced the
// next date, so a recurring obligation could quietly stop. Now: if that next occurrence already exists
// (same household, contact, title and date, not done) nothing is added, and a failure is reported.
async function scheduleNextOccurrence(t,familyId,nd,toast){
  let q=sb.from("tasks").select("id").eq("title",t.title).eq("due_date",nd).eq("done",false).limit(1);
  q=familyId?q.eq("family_id",familyId):q.is("family_id",null);
  q=t.contactId?q.eq("contact_id",t.contactId):q.is("contact_id",null);
  const{data:existing}=await q;
  if(existing&&existing.length){toast&&toast("Next occurrence already scheduled: "+fmt(nd));return;}
  const{error}=await sb.from("tasks").insert({family_id:familyId,contact_id:t.contactId||null,title:t.title,due_date:nd,priority:t.priority,
    reminder_days:reminderDaysOr7(t.reminderDays),done:false,recurrence:t.recurrence,
    recurrence_interval:t.recurrence==="Custom"?(t.recurrenceInterval||1):null,
    recurrence_unit:t.recurrence==="Custom"?(t.recurrenceUnit||"week"):null});
  if(error){toast&&toast("Done, but the next occurrence could not be created: "+error.message+". Add it by hand so it isn't missed.","error");return;}
  toast&&toast("Next occurrence: "+fmt(nd));
}
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
  // Month and year steps keep the day of the month, clamped to the last day of the target month. Plain
  // setMonth()/setFullYear() overflow instead (Jan 31 + 1 month became Mar 3, Feb 29 + 1 year became Mar 1),
  // and every later repeat then kept the shifted day.
  else if(u==="month"||u==="year"){
    const day=base.getDate();
    const months=u==="month"?n:12*n;
    const target=new Date(base.getFullYear(),base.getMonth()+months,1);
    const last=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();
    d.setTime(new Date(target.getFullYear(),target.getMonth(),Math.min(day,last)).getTime());
  }
  const p=x=>String(x).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
const RECUR_OPTS=["Daily","Weekly","Monthly","Annual","Custom"];

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
  const[showReq,setShowReq]=useState(false);
  const save=async()=>{if(!f.title.trim()){setShowReq(true);return;}setSaving(true);const ok=await onSave(f);if(ok===false){setSaving(false);return;}onClose();};
  return <div>
    <Field label="Task" required><Inp placeholder="Follow up on loan maturity" value={f.title} onChange={set("title")}/></Field>
    {contacts.length>0&&<Field label="Contact" optional><Sel value={f.contactId||""} onChange={set("contactId")}><option value="">— None —</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Sel></Field>}
    <Grid2>
      <Field label="Due Date" optional><Inp type="date" value={f.dueDate||""} onChange={set("dueDate")}/></Field>
      <Field label="Priority"><Sel value={f.priority} onChange={set("priority")}><option>Low</option><option>Medium</option><option>High</option></Sel></Field>
    </Grid2>
    <Field label="Email Reminder">
      <Sel value={reminderDaysOr7(f.reminderDays)} onChange={e=>setF(p=>({...p,reminderDays:Number(e.target.value)}))}>
        <option value={0}>No reminder</option>
        {REMINDER_OPTIONS.map(r=><option key={r.days} value={r.days}>{r.label}</option>)}
      </Sel>
    </Field>
    {f.reminderDays>0&&f.dueDate&&<div style={{background:"#e8f0f8",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:B.navyMid}}>
      🔔 ORDANIS Expert will be emailed on {(()=>{const b=parseLocalDate(f.dueDate);if(isNaN(b.getTime()))return new Date(NaN);const r=new Date(b);r.setDate(r.getDate()-f.reminderDays);return r;})().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
    </div>}
    <RecurrenceField f={f} setF={setF}/>
    {showReq&&<ReqHint/>}
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
  const[showReq,setShowReq]=useState(false);
  const[err,setErr]=useState("");
  const pctBad=v=>v!==""&&v!=null&&!(Number(v)>=0&&Number(v)<=100);
  const save=async()=>{if(!f.address.trim()){setShowReq(true);return;}
    if(pctBad(f.interestRate)){setErr("Interest rate must be between 0 and 100.");return;}
    if(pctBad(f.propertyManagementFeePct)){setErr("Property management fee must be between 0 and 100 percent.");return;}
    setErr("");setSaving(true);const ok=await onSave(f);if(ok===false){setSaving(false);return;}onClose();};
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
    <Grid2><Field label="Owner / LLC" optional><Inp placeholder="Smith Holdings LLC" value={f.ownerName||""} onChange={set("ownerName")}/></Field><Field label="Property Type"><Sel value={f.propertyType} onChange={set("propertyType")}>{[...PROP_TYPES,"Other"].map(t=><option key={t}>{t}</option>)}</Sel></Field></Grid2>
    <Field label="Address" required><Inp placeholder="123 Main St, Tampa FL" value={f.address} onChange={set("address")}/></Field>
    <Grid2><Field label="Purchase Price" optional><MoneyInput value={f.purchasePrice||""} onChange={set("purchasePrice")}/></Field><Field label="Current Value" optional><MoneyInput value={f.currentValue||""} onChange={set("currentValue")}/></Field></Grid2>
    <Grid2><Field label="Purchase Date" optional><Inp type="date" value={f.purchaseDate||""} onChange={set("purchaseDate")}/></Field><Field label="Loan Type"><Sel value={f.loanType} onChange={set("loanType")}>{LOAN_TYPES.map(t=><option key={t}>{t}</option>)}</Sel></Field></Grid2>
    <Grid2><Field label="Lender" optional><Inp value={f.lender||""} onChange={set("lender")}/></Field><Field label="Loan Balance" optional><MoneyInput value={f.loanBalance||""} onChange={set("loanBalance")}/></Field></Grid2>
    <Grid2><Field label="Interest Rate (%)" optional><Inp type="number" min="0" max="100" step="0.01" value={f.interestRate||""} onChange={set("interestRate")}/></Field><Field label="Monthly Payment" optional><MoneyInput value={f.loanPayment||""} onChange={set("loanPayment")}/></Field></Grid2>
    <Grid2><Field label="Second Mortgage Balance" optional><MoneyInput value={f.secondMortgageBalance||""} onChange={set("secondMortgageBalance")}/></Field><Field label="Second Mortgage Payment/mo" optional><MoneyInput value={f.secondMortgagePayment||""} onChange={set("secondMortgagePayment")}/></Field></Grid2>
    <Grid2><Field label="Loan Maturity Date" optional><Inp type="date" value={f.loanMaturityDate||""} onChange={set("loanMaturityDate")}/></Field><Field label="Rental Income/mo" optional><MoneyInput value={f.rentalIncome||""} onChange={set("rentalIncome")}/></Field></Grid2>
    <Grid2><Field label="Property Taxes/yr" optional><MoneyInput value={f.propertyTaxes||""} onChange={set("propertyTaxes")}/></Field><Field label="Utilities/mo" optional><MoneyInput value={f.utilities||""} onChange={set("utilities")}/></Field></Grid2>
    <Grid2><Field label="Insurance Company" optional><Inp value={f.insuranceCompany||""} onChange={set("insuranceCompany")}/></Field><Field label="Insurance Premium/yr" optional><MoneyInput value={f.insurancePremium||""} onChange={set("insurancePremium")}/></Field></Grid2>
    <Grid2><Field label="Insurance Expiration" optional><Inp type="date" value={f.insuranceExpiration||""} onChange={set("insuranceExpiration")}/></Field><div/></Grid2>
    <div style={{marginBottom:14}}><label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"10px 14px",background:f.floodInsurance?"#e8f0f8":B.bg,borderRadius:8,border:`1px solid ${f.floodInsurance?B.navyMid:B.border}`}}><input type="checkbox" checked={!!f.floodInsurance} onChange={setChk("floodInsurance")} style={{width:16,height:16,accentColor:B.navy}}/><span style={{fontSize:13,color:B.navy,fontWeight:600}}>Flood Insurance</span></label></div>
    {f.floodInsurance&&<Grid2><Field label="Flood Insurance Co." optional><Inp value={f.floodInsuranceCompany||""} onChange={set("floodInsuranceCompany")}/></Field><Field label="Flood Premium/yr" optional><MoneyInput value={f.floodInsurancePremium||""} onChange={set("floodInsurancePremium")}/></Field></Grid2>}
    {f.floodInsurance&&<Grid2><Field label="Flood Insurance Expiration" optional><Inp type="date" value={f.floodInsuranceExpiration||""} onChange={set("floodInsuranceExpiration")}/></Field><div/></Grid2>}

    {/* Rental Expenses section */}
    <div style={{marginTop:18,marginBottom:8,paddingTop:14,borderTop:`1px solid ${B.borderLight}`}}>
      <div style={{fontSize:11,fontWeight:800,color:B.textMute,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Rental Expenses (used in Cash Flow projections)</div>
    </div>
    <Grid2>
      <Field label="HOA / Monthly Fee ($)" optional><MoneyInput placeholder="350" value={f.hoaFee||""} onChange={set("hoaFee")}/></Field>
      <Field label="Property Management Fee (%)" optional><Inp type="number" min="0" max="100" step="0.1" placeholder="e.g., 8" value={f.propertyManagementFeePct||""} onChange={set("propertyManagementFeePct")}/></Field>
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

    <Field label="Notes" optional><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    {showReq&&<ReqHint/>}
    {err&&<div style={{fontSize:12,color:"#8b1a1a",background:"#fff5f5",border:"1px solid #f3c2c2",borderRadius:8,padding:"8px 10px",marginTop:8}}>{err}</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Property"}</Btn></div>
  </div>;
}

// ── VALUABLE FORM ─────────────────────────────────────────────────────────────
// A valuable's own policy, under its "Insured" line: number, premium, coverage, when it renews (flagged
// when it is within 60 days or past), and the policy document in CHRIS, or a link to attach one.
function ValuablePolicyDetails({v,doc,toast,onAttach}){
  if(!v.insured)return null;
  const parts=[v.policyNumber&&`Policy ${v.policyNumber}`,
    v.coverageAmount!=null&&v.coverageAmount!==""&&`Covers ${fmtMoney(v.coverageAmount)}`,
    v.insurancePremium!=null&&v.insurancePremium!==""&&`${fmtMoney(v.insurancePremium)}/yr`].filter(Boolean);
  let due=null;
  if(v.insuranceExpiration){
    const d=parseLocalDate(v.insuranceExpiration);const today=new Date();today.setHours(0,0,0,0);
    const days=Math.round((d-today)/86400000);
    const when=d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    due=days<0?{t:`Expired ${when}`,c:"#8b1a1a"}:days<=60?{t:`Renews in ${days} day${days===1?"":"s"} (${when})`,c:"#8a5c00"}:{t:`Renews ${when}`,c:B.textSoft};
  }
  if(!parts.length&&!due&&!doc&&!onAttach)return null;
  return <div style={{fontSize:11.5,color:B.textSoft,marginTop:4,lineHeight:1.5}}>
    {parts.length>0&&<span>{parts.join(" · ")}</span>}
    {due&&<span style={{color:due.c,fontWeight:due.c===B.textSoft?400:700}}>{parts.length?" · ":""}{due.t}</span>}
    {doc?<DocLink doc={doc} toast={toast} label="📄 this item's policy"/>
      :onAttach?<button onClick={onAttach} style={{background:"none",border:"none",color:B.navyMid,fontSize:11.5,cursor:"pointer",fontFamily:"inherit",fontWeight:600,padding:0,marginLeft:(parts.length||due)?8:0}}>📎 Attach policy</button>:null}
  </div>;
}

// The columns a valuable form writes. Shared by the staff and client sides so the two can never drift.
// Policy fields are only kept while "Insured" is ticked: unticking clears them rather than leaving a
// stale policy number behind on an item that is no longer covered.
function valuableRowFromForm(f){
  const ins=!!f.insured;
  return{category:f.category,description:f.description,make_model:f.makeModel||null,year:f.year||null,
    estimated_value:numOrNull(f.estimatedValue),insured:ins,insurance_company:ins?(f.insuranceCompany||null):null,
    policy_number:ins?(String(f.policyNumber||"").trim().slice(0,80)||null):null,
    insurance_premium:ins?numOrNull(f.insurancePremium):null,coverage_amount:ins?numOrNull(f.coverageAmount):null,
    insurance_expiration:ins?(f.insuranceExpiration||null):null,notes:f.notes||null};
}
// policy (optional, editing an existing valuable only): {familyId, valuableId, doc, toast, onUploaded}. Lets the
// person photograph or pick the policy right here: CHRIS reads it, files it in Insurance linked to this valuable,
// and pre-fills any blank policy fields it can read, for the person to check before saving.
function ValuableForm({initial,onSave,onClose,policy=null}){
  const[f,setF]=useState(initial||{category:"Car / Vehicle",description:"",makeModel:"",year:"",estimatedValue:"",insured:false,insuranceCompany:"",notes:""});
  const[policyDoc,setPolicyDoc]=useState(policy?policy.doc||null:null);
  const[policyBusy,setPolicyBusy]=useState("");
  const[prefilled,setPrefilled]=useState([]);
  const camRef=useRef(null),fileRef=useRef(null);
  const attachPolicy=async file=>{
    if(!file||!policy)return;
    const problem=docFileProblem(file);
    if(problem){policy.toast(problem,"error");return;}
    try{
      const text=await readDocumentForFiling(file,ph=>setPolicyBusy(ph));
      let sug=null;
      if(text&&text.length>80){setPolicyBusy("Reading the policy…");try{sug=await suggestFolder(text,file.name,DOC_CATEGORIES);}catch(_e){}}
      // Fill only what is blank: anything the person typed stays theirs.
      const pol=sug&&sug.policy;const got=[];
      if(pol){
        setF(p=>{const n={...p,insured:true};
          const fill=(k,v,label)=>{if(v!=null&&v!==""&&(p[k]==null||String(p[k]).trim()==="")){n[k]=String(v);got.push(label);}};
          fill("insuranceCompany",pol.insurer,"insurer");fill("policyNumber",pol.policyNumber,"policy number");
          fill("insurancePremium",pol.annualPremium,"premium");fill("coverageAmount",pol.coverageAmount,"coverage");
          fill("insuranceExpiration",pol.expirationDate,"renewal date");
          return n;});
      }
      setPolicyBusy("Filing in CHRIS…");
      const base=file.name.replace(/\.[^./\\]+$/,"").trim();
      const name=(sug&&sug.suggestedName)||`${f.description||"Valuable"} insurance policy`||base;
      const err=await fileChrisDocument({familyId:policy.familyId,file,name,category:"Insurance",description:sug&&sug.summary,extractedText:text,
        link:{kind:"valuable",id:policy.valuableId,section:"valuable_policy"}});
      if(err){policy.toast(err,"error");return;}
      setPolicyDoc({name});setPrefilled(got);
      policy.toast("Policy filed in CHRIS and linked to this item");
      if(policy.onUploaded)policy.onUploaded();
    }finally{setPolicyBusy("");}
  };
  const[saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const[showReq,setShowReq]=useState(false);
  const[err,setErr]=useState("");
  const save=async()=>{if(!f.description.trim()){setShowReq(true);return;}
    if(f.year!==""&&f.year!=null){const y=Number(f.year);if(!Number.isInteger(y)||y<1800||y>new Date().getFullYear()+1){setErr(`Year must be a four-digit year between 1800 and ${new Date().getFullYear()+1}.`);return;}}
    setErr("");setSaving(true);const ok=await onSave(f);if(ok===false){setSaving(false);return;}onClose();};
  return <div>
    <Grid2><Field label="Category"><Sel value={f.category} onChange={set("category")}>{VALUABLE_CATS.map(c=><option key={c}>{c}</option>)}</Sel></Field><Field label="Year" optional><Inp type="number" min="1800" max={new Date().getFullYear()+1} placeholder="2023" value={f.year||""} onChange={set("year")}/></Field></Grid2>
    <Field label="Description" required><Inp placeholder="2023 Ferrari Roma" value={f.description} onChange={set("description")}/></Field>
    <Grid2><Field label="Make / Model" optional><Inp value={f.makeModel||""} onChange={set("makeModel")}/></Field><Field label="Estimated Value" optional><MoneyInput value={f.estimatedValue||""} onChange={set("estimatedValue")}/></Field></Grid2>
    <div style={{marginBottom:14}}><label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"10px 14px",background:f.insured?"#e8f0f8":B.bg,borderRadius:8,border:`1px solid ${f.insured?B.navyMid:B.border}`}}><input type="checkbox" checked={!!f.insured} onChange={e=>setF(p=>({...p,insured:e.target.checked}))} style={{width:16,height:16,accentColor:B.navy}}/><span style={{fontSize:13,color:B.navy,fontWeight:600}}>Insured</span></label></div>
    {f.insured&&<>
      <Grid2>
        <Field label="Insurance Company" optional><Inp value={f.insuranceCompany||""} onChange={set("insuranceCompany")}/></Field>
        <Field label="Policy Number" optional><Inp maxLength={80} value={f.policyNumber||""} onChange={set("policyNumber")}/></Field>
      </Grid2>
      <Grid2>
        <Field label="Annual Premium" optional><MoneyInput value={f.insurancePremium||""} onChange={set("insurancePremium")}/></Field>
        <Field label="Coverage Amount" optional><MoneyInput value={f.coverageAmount||""} onChange={set("coverageAmount")}/></Field>
      </Grid2>
      <Field label="Renewal / Expiration Date" optional><Inp type="date" value={f.insuranceExpiration||""} onChange={set("insuranceExpiration")}/></Field>
    </>}
    {policy&&<div style={{marginBottom:14,padding:"12px 14px",border:`1px solid ${B.borderLight}`,borderRadius:10,background:B.bg}}>
      <div style={{fontSize:12,fontWeight:700,color:B.navy,marginBottom:4}}>Policy document</div>
      <div style={{fontSize:12,color:B.textSoft,marginBottom:10,lineHeight:1.5}}>
        {policyDoc?<>📄 <strong style={{color:B.navy}}>{policyDoc.name}</strong> is in CHRIS, linked to this item. Add a newer one to replace it; the old one stays in CHRIS.</>
          :"Snap or upload the policy. CHRIS files it in Insurance, links it to this item, and fills in any details it can read."}
      </div>
      {policyBusy?<div style={{fontSize:12.5,color:B.gold,fontWeight:600}}>{policyBusy}</div>
        :<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button type="button" onClick={()=>camRef.current&&camRef.current.click()} style={{flex:"1 1 140px",minHeight:44,borderRadius:10,border:"none",background:B.navy,color:B.white,fontSize:13.5,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>📷 Take a photo</button>
          <button type="button" onClick={()=>fileRef.current&&fileRef.current.click()} style={{flex:"1 1 140px",minHeight:44,borderRadius:10,border:`1.5px solid ${B.navy}`,background:B.white,color:B.navy,fontSize:13.5,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>📄 Choose file</button>
        </div>}
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>{const x=e.target.files&&e.target.files[0];e.target.value="";attachPolicy(x);}}/>
      <input ref={fileRef} type="file" accept={[...DOC_UPLOAD_EXTS.map(x=>"."+x),"image/*"].join(",")} style={{display:"none"}} onChange={e=>{const x=e.target.files&&e.target.files[0];e.target.value="";attachPolicy(x);}}/>
      {prefilled.length>0&&<div style={{fontSize:11.5,color:"#8a5c00",marginTop:8}}>Filled in from the policy: {prefilled.join(", ")}. Check them, then Save.</div>}
    </div>}
    <Field label="Notes" optional><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    {showReq&&<ReqHint/>}
    {err&&<div style={{fontSize:12,color:"#8b1a1a",background:"#fff5f5",border:"1px solid #f3c2c2",borderRadius:8,padding:"8px 10px",marginTop:8}}>{err}</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</Btn></div>
  </div>;
}

// ── LOANS & LINES ─────────────────────────────────────────────────────────────
// Every loan or line a household carries that isn't a mortgage on one of its properties (those stay on the
// property): auto, personal, student, business, HELOC, securities-backed lines, credit cards, private loans.
// Shared by the staff and client sides. Balances count toward Total Debt; maturity dates feed Upcoming
// Deadlines; a statement can be pinned to each loan in CHRIS (documents.loan_id, section "loan_statement").
const DEBT_KINDS=["Auto Loan","Personal Loan","Student Loan","Business Loan","Line of Credit","HELOC","Securities-Backed Line",
  "Credit Card","Mortgage","Boat / RV / Aircraft Loan","Private / Family Loan","Other"];
// Revolving kinds: they have a credit limit (and so an amount still available) instead of an original amount.
const DEBT_LINE_KINDS=new Set(["Line of Credit","HELOC","Securities-Backed Line","Credit Card"]);
const LOAN_FREQUENCIES=["Monthly","Quarterly","Semi-annually","Annually","Other"];
const LOAN_FREQ_PER_MONTH={Monthly:1,Quarterly:1/3,"Semi-annually":1/6,Annually:1/12};
const loansDebt=loans=>(loans||[]).reduce((s,l)=>s+(Number(l.currentBalance)||0),0);
// Monthly equivalent of a payment; "Other" schedules can't be spread, so they are left out of the total.
const loanMonthly=l=>(Number(l.paymentAmount)||0)*(LOAN_FREQ_PER_MONTH[l.paymentFrequency||"Monthly"]||0);
const loanTitle=l=>(l.name||"").trim()||[l.lender,l.loanType].filter(Boolean).join(" · ")||l.loanType||"Loan";

// The columns a loan form writes. Fields that don't apply to the kind (a credit limit on an auto loan, an
// original amount on a credit card) are cleared rather than left behind.
function loanRowFromForm(f){
  const line=DEBT_LINE_KINDS.has(f.loanType);
  const sec=String(f.securedBy||"");
  const txt=(v,n)=>String(v||"").trim().slice(0,n)||null;
  return{loan_type:f.loanType,name:txt(f.name,120),lender:txt(f.lender,120),
    current_balance:numOrNull(f.currentBalance),balance_as_of:f.balanceAsOf||null,
    credit_limit:line?numOrNull(f.creditLimit):null,original_amount:line?null:numOrNull(f.originalAmount),
    interest_rate:numOrNull(f.interestRate),rate_type:f.rateType||null,
    payment_amount:numOrNull(f.paymentAmount),payment_frequency:f.paymentFrequency||null,
    origination_date:f.originationDate||null,maturity_date:f.maturityDate||null,
    property_id:sec.startsWith("p:")?sec.slice(2):null,valuable_id:sec.startsWith("v:")?sec.slice(2):null,
    portfolio_account_id:sec.startsWith("a:")?sec.slice(2):null,
    notes:txt(f.notes,4000)};
}

// A new mortgage or home-equity line picked onto a listed property is saved ON the property (its mortgage, or its
// second mortgage / HELOC), so Total Debt counts it once. Refuses rather than overwrites one already on file.
// Returns an error message, or null when saved.
async function mortgageOntoProperty(familyId,p,f){
  if(!p)return "That property couldn't be found. Refresh and try again.";
  const label=p.name||p.address||"That property";
  const amt=f.paymentAmount===""||f.paymentAmount==null?null:Number(f.paymentAmount);
  const per=LOAN_FREQ_PER_MONTH[f.paymentFrequency||"Monthly"];
  const monthly=amt==null||isNaN(amt)?null:per?Math.round(amt*per*100)/100:amt;
  let row;
  if(f.loanType==="HELOC"){
    if((Number(p.secondMortgageBalance)||0)>0)return `${label} already has a second mortgage or home-equity line on file. Use Edit on it under Mortgages & home equity.`;
    row={second_mortgage_balance:numOrNull(f.currentBalance),second_mortgage_payment:monthly};
  }else{
    if((Number(p.loanBalance)||0)>0||String(p.lender||"").trim())return `${label} already has a mortgage on file. Use Edit on it under Mortgages & home equity.`;
    row={lender:String(f.lender||f.name||"").trim().slice(0,120)||null,loan_balance:numOrNull(f.currentBalance),
      interest_rate:numOrNull(f.interestRate),loan_payment:monthly,loan_maturity_date:f.maturityDate||null};
  }
  const{error}=await sb.from("properties").update(row).eq("id",p.id).eq("family_id",familyId);
  return error?error.message:null;
}
const loanOnListedProperty=(m,f)=>!m.loan&&(f.loanType==="Mortgage"||f.loanType==="HELOC")&&String(f.securedBy||"").startsWith("p:");

// statement (optional, editing an existing loan only): {familyId, loanId, doc, toast, onUploaded}. Snap or pick the
// latest statement: CHRIS reads it for a name and summary, files it, and links it to this loan.
// defaultType: the kind a new loan starts as (from the section's own Add button, e.g. "Credit Card").
function LoanForm({initial,onSave,onClose,properties=[],valuables=[],accounts=[],statement=null,defaultType="Auto Loan"}){
  const[f,setF]=useState(()=>initial
    ?{...initial,securedBy:initial.propertyId?`p:${initial.propertyId}`:initial.valuableId?`v:${initial.valuableId}`:initial.portfolioAccountId?`a:${initial.portfolioAccountId}`:""}
    :{loanType:defaultType,name:"",lender:"",currentBalance:"",balanceAsOf:"",creditLimit:"",originalAmount:"",interestRate:"",
      rateType:"",paymentAmount:"",paymentFrequency:"Monthly",originationDate:"",maturityDate:"",
      securedBy:(defaultType==="Mortgage"||defaultType==="HELOC")&&properties.length?`p:${properties[0].id}`:"",notes:""});
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const line=DEBT_LINE_KINDS.has(f.loanType);
  const[saving,setSaving]=useState(false);
  const[err,setErr]=useState("");
  const[stmtDoc,setStmtDoc]=useState(statement?statement.doc||null:null);
  const[stmtBusy,setStmtBusy]=useState("");
  const camRef=useRef(null),fileRef=useRef(null);
  const attachStatement=async file=>{
    if(!file||!statement)return;
    const problem=docFileProblem(file);
    if(problem){statement.toast(problem,"error");return;}
    try{
      const text=await readDocumentForFiling(file,ph=>setStmtBusy(ph));
      let sug=null;
      if(text&&text.length>80){setStmtBusy("Reading the statement…");try{sug=await suggestFolder(text,file.name,DOC_CATEGORIES);}catch(_e){}}
      setStmtBusy("Filing in CHRIS…");
      const name=(sug&&sug.suggestedName)||`${loanTitle(f)} statement`;
      const e=await fileChrisDocument({familyId:statement.familyId,file,name,category:"General",description:sug&&sug.summary,extractedText:text,
        link:{kind:"loan",id:statement.loanId,section:"loan_statement"}});
      if(e){statement.toast(e,"error");return;}
      setStmtDoc({name});
      statement.toast("Statement filed in CHRIS and linked to this loan");
      if(statement.onUploaded)statement.onUploaded();
    }finally{setStmtBusy("");}
  };
  const save=async()=>{
    if(!String(f.lender||"").trim()&&!String(f.name||"").trim()){setErr("Add a lender or a name so you can tell this one apart.");return;}
    const r=f.interestRate;
    if(r!==""&&r!=null&&(isNaN(Number(r))||Number(r)<0||Number(r)>100)){setErr("Interest rate must be a percentage between 0 and 100.");return;}
    if(f.originationDate&&f.maturityDate&&f.maturityDate<f.originationDate){setErr("The end date can't be before the start date.");return;}
    // One home for each number: a listed property's mortgage and HELOC live on the property, so they're counted once.
    // A NEW one is saved onto the property by the caller; an existing loan row can't be moved there from here.
    if(initial&&(f.loanType==="Mortgage"||f.loanType==="HELOC")&&String(f.securedBy||"").startsWith("p:")){
      setErr("A mortgage or home-equity line on a listed property is kept on the property itself, so it's counted once. Close this and use Edit under Mortgages & home equity instead.");return;}
    setErr("");setSaving(true);const ok=await onSave(f);if(ok===false){setSaving(false);return;}onClose();
  };
  const propLabel=p=>p.name||p.address||"Property";
  const acctLabel=a=>[a.institution||"Account",a.accountType].filter(Boolean).join(" · ");
  const mortgage=f.loanType==="Mortgage"||f.loanType==="HELOC";
  // Changing the type to a mortgage points it at a property straight away; away from one, a property pick is kept.
  const setType=e=>{const t=e.target.value;setF(p=>({...p,loanType:t,
    securedBy:(t==="Mortgage"||t==="HELOC")&&!String(p.securedBy||"").startsWith("p:")&&properties.length?`p:${properties[0].id}`:p.securedBy}));};
  const pledgeable=accounts.filter(a=>a.accountType!=="Line of Credit");
  return <div>
    <Grid2>
      <Field label="Type"><Sel value={f.loanType} onChange={setType}>{DEBT_KINDS.map(k=><option key={k}>{k}</option>)}</Sel></Field>
      <Field label="Lender"><Inp maxLength={120} placeholder="Chase, Schwab, Toyota Financial…" value={f.lender||""} onChange={set("lender")}/></Field>
    </Grid2>
    {mortgage
      ?<Field label="Which property is it on?">
        <Sel value={f.securedBy||""} onChange={set("securedBy")}>
          {properties.map(p=><option key={p.id} value={`p:${p.id}`}>{propLabel(p)}</option>)}
          <option value="">A property that isn't listed</option>
        </Sel>
      </Field>
      :<Field label="Secured by">
        <Sel value={f.securedBy||""} onChange={set("securedBy")}>
          <option value="">Unsecured</option>
          {properties.length>0&&<optgroup label="A property">{properties.map(p=><option key={p.id} value={`p:${p.id}`}>{propLabel(p)}</option>)}</optgroup>}
          {pledgeable.length>0&&<optgroup label="A portfolio account">{pledgeable.map(a=><option key={a.id} value={`a:${a.id}`}>{acctLabel(a)}</option>)}</optgroup>}
          {valuables.length>0&&<optgroup label="A valuable">{valuables.map(v=><option key={v.id} value={`v:${v.id}`}>{v.description||v.category||"Valuable"}</option>)}</optgroup>}
        </Sel>
      </Field>}
    <Field label="Name" optional><Inp maxLength={120} placeholder={line?"Schwab pledged asset line":"2024 Range Rover loan"} value={f.name||""} onChange={set("name")}/></Field>
    <Grid2>
      <Field label={line?"Balance owed today":"Balance owed"} optional><MoneyInput value={f.currentBalance??""} onChange={set("currentBalance")}/></Field>
      <Field label="Balance as of" optional><Inp type="date" value={f.balanceAsOf||""} onChange={set("balanceAsOf")}/></Field>
    </Grid2>
    <Grid2>
      {line
        ?<Field label="Credit limit" optional><MoneyInput value={f.creditLimit??""} onChange={set("creditLimit")}/></Field>
        :<Field label="Original amount" optional><MoneyInput value={f.originalAmount??""} onChange={set("originalAmount")}/></Field>}
      <Field label="Interest rate (%)" optional><Inp type="number" min="0" max="100" step="0.01" value={f.interestRate??""} onChange={set("interestRate")}/></Field>
    </Grid2>
    <Grid2>
      <Field label="Rate" optional><Sel value={f.rateType||""} onChange={set("rateType")}><option value="">—</option><option>Fixed</option><option>Variable</option></Sel></Field>
      <Field label="Payment" optional><MoneyInput value={f.paymentAmount??""} onChange={set("paymentAmount")}/></Field>
    </Grid2>
    <Grid2>
      <Field label="How often" optional><Sel value={f.paymentFrequency||""} onChange={set("paymentFrequency")}><option value="">—</option>{LOAN_FREQUENCIES.map(x=><option key={x}>{x}</option>)}</Sel></Field>
      <Field label="Start date" optional><Inp type="date" value={f.originationDate||""} onChange={set("originationDate")}/></Field>
    </Grid2>
    <Field label={line?"Draw period ends / renews":"Paid off by (maturity)"} optional><Inp type="date" value={f.maturityDate||""} onChange={set("maturityDate")}/></Field>
    {mortgage&&String(f.securedBy||"").startsWith("p:")&&<div style={{fontSize:11.5,color:"#8a5c00",marginBottom:12,lineHeight:1.5}}>
      {initial?"A mortgage or home-equity line on a listed property is kept on the property itself: use Edit under Mortgages & home equity."
        :f.loanType==="HELOC"?"Saved on the property as its second mortgage / home-equity line, so it's counted once. The property keeps the balance and monthly payment."
        :"Saved on the property as its mortgage, so it's counted once. You'll find it under Mortgages & home equity, and on the property."}
    </div>}
    {statement&&<div style={{marginBottom:14,padding:"12px 14px",border:`1px solid ${B.borderLight}`,borderRadius:10,background:B.bg}}>
      <div style={{fontSize:12,fontWeight:700,color:B.navy,marginBottom:4}}>Latest statement</div>
      <div style={{fontSize:12,color:B.textSoft,marginBottom:10,lineHeight:1.5}}>
        {stmtDoc?<>📄 <strong style={{color:B.navy}}>{stmtDoc.name}</strong> is in CHRIS, linked to this loan. Add a newer one to replace it; the old one stays in CHRIS.</>
          :"Snap or upload a statement. CHRIS files it and links it to this loan."}
      </div>
      {stmtBusy?<div style={{fontSize:12.5,color:B.gold,fontWeight:600}}>{stmtBusy}</div>
        :<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button type="button" onClick={()=>camRef.current&&camRef.current.click()} style={{flex:"1 1 140px",minHeight:44,borderRadius:10,border:"none",background:B.navy,color:B.white,fontSize:13.5,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>📷 Take a photo</button>
          <button type="button" onClick={()=>fileRef.current&&fileRef.current.click()} style={{flex:"1 1 140px",minHeight:44,borderRadius:10,border:`1.5px solid ${B.navy}`,background:B.white,color:B.navy,fontSize:13.5,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>📄 Choose file</button>
        </div>}
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>{const x=e.target.files&&e.target.files[0];e.target.value="";attachStatement(x);}}/>
      <input ref={fileRef} type="file" accept={[...DOC_UPLOAD_EXTS.map(x=>"."+x),"image/*"].join(",")} style={{display:"none"}} onChange={e=>{const x=e.target.files&&e.target.files[0];e.target.value="";attachStatement(x);}}/>
    </div>}
    <Field label="Notes" optional><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    {err&&<div style={{fontSize:12,color:"#8b1a1a",background:"#fff5f5",border:"1px solid #f3c2c2",borderRadius:8,padding:"8px 10px",marginTop:8}}>{err}</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</Btn></div>
  </div>;
}

// On a property card: the loans and lines from Loans & Lines secured by this property (its own mortgage and second
// mortgage are already in the card's figures). Hidden when there are none.
function PropertySecuredLoans({loans=[],propertyId,onOpen=null}){
  const list=loans.filter(l=>l.propertyId===propertyId);
  if(!list.length)return null;
  return <div style={{marginTop:12,paddingTop:10,borderTop:`1px solid ${B.borderLight}`}}>
    <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>Also secured by this property</div>
    {list.map(l=><div key={l.id} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:13,padding:"3px 0"}}>
      <span style={{color:B.text}}>{loanTitle(l)} <span style={{color:B.textMute,fontSize:12}}>· {l.loanType}</span></span>
      <span style={{color:B.navy,fontWeight:600,whiteSpace:"nowrap"}}>{fmtMoney(Number(l.currentBalance)||0)}{onOpen&&<button onClick={()=>onOpen(l)} style={{background:"none",border:"none",color:B.navyMid,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:600,padding:"0 0 0 8px"}}>Edit</button>}</span>
    </div>)}
  </div>;
}

// The Loans & Lines list with its totals. onAdd/onEdit/onDelete/onAttach are null for read-only viewers.
// onEditProperty: opens a property's own edit form, where its mortgage and second mortgage / HELOC are kept. Those
// show here too (one record, two places to reach it) and are never stored as loans, so nothing is counted twice.
function LoansPanel({loans,properties=[],valuables=[],accounts=[],documents=[],locAccounts=[],toast,onAdd=null,onEdit=null,onDelete=null,onAttach=null,onEditProperty=null}){
  const[mortPick,setMortPick]=useState(false);
  const lines=loans.filter(l=>DEBT_LINE_KINDS.has(l.loanType));
  const propMorts=properties.filter(p=>(Number(p.loanBalance)||0)>0||(Number(p.secondMortgageBalance)||0)>0||String(p.lender||"").trim());
  const propOwed=properties.reduce((t,p)=>t+(Number(p.loanBalance)||0)+(Number(p.secondMortgageBalance)||0),0);
  const owed=loansDebt(loans)+propOwed;
  const available=lines.reduce((s,l)=>s+(l.creditLimit!=null&&l.creditLimit!==""?Math.max(0,Number(l.creditLimit)-(Number(l.currentBalance)||0)):0),0);
  const monthly=loans.reduce((s,l)=>s+loanMonthly(l),0)
    +properties.reduce((t,p)=>t+(Number(p.loanPayment)||0)+(Number(p.secondMortgagePayment)||0),0);
  const locTotal=locAccounts.reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const today=new Date();today.setHours(0,0,0,0);
  const securedLabel=l=>{
    if(l.propertyId){const p=properties.find(x=>x.id===l.propertyId);return p?`Secured by ${p.name||p.address||"a property"}`:null;}
    if(l.valuableId){const v=valuables.find(x=>x.id===l.valuableId);return v?`Secured by ${v.description||v.category||"a valuable"}`:null;}
    if(l.portfolioAccountId){const a=accounts.find(x=>x.id===l.portfolioAccountId);return a?`Secured by ${a.institution||"a portfolio account"}${a.accountType?" "+a.accountType:""}`:null;}
    return DEBT_LINE_KINDS.has(l.loanType)||MORT_KINDS.includes(l.loanType)?null:"Unsecured";
  };
  const card=l=>{
    const line=DEBT_LINE_KINDS.has(l.loanType);
    const limit=line&&l.creditLimit!=null&&l.creditLimit!==""?Number(l.creditLimit):null;
    const bal=Number(l.currentBalance)||0;
    const used=limit>0?Math.min(100,Math.round(bal/limit*100)):null;
    let due=null;
    if(l.maturityDate){
      const d=parseLocalDate(l.maturityDate);const days=Math.round((d-today)/86400000);
      const when=d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
      const verb=line?"Renews / ends":"Matures";
      due=days<0?{t:`${verb} ${when} (past)`,c:"#8b1a1a"}:days<=90?{t:`${verb} in ${days} day${days===1?"":"s"} (${when})`,c:"#8a5c00"}:{t:`${verb} ${when}`,c:B.textSoft};
    }
    const facts=[l.interestRate!=null&&l.interestRate!==""&&`${fmtPct(l.interestRate)}${l.rateType?` ${l.rateType.toLowerCase()}`:""}`,
      l.paymentAmount!=null&&l.paymentAmount!==""&&`${fmtMoney(l.paymentAmount)} ${(l.paymentFrequency||"monthly").toLowerCase()}`,
      !line&&l.originalAmount!=null&&l.originalAmount!==""&&`Originally ${fmtMoney(l.originalAmount)}`].filter(Boolean);
    const doc=documents.find(d=>d.loanId===l.id&&d.propertySection==="loan_statement");
    const sec=securedLabel(l);
    return <div key={l.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${line?"#0e7490":"#b4551f"}`,borderRadius:10,padding:"16px 20px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,boxShadow:B.shadow,flexWrap:"wrap"}}>
      <div style={{minWidth:0,flex:"1 1 220px"}}>
        <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{loanTitle(l)}</div>
        <div style={{fontSize:12,color:B.textSoft}}>{[l.loanType,(l.name||"").trim()?l.lender:null].filter(Boolean).join(" · ")}</div>
        {facts.length>0&&<div style={{fontSize:11.5,color:B.textSoft,marginTop:4}}>{facts.join(" · ")}</div>}
        {sec&&<div style={{fontSize:11.5,color:B.textSoft,marginTop:2}}>{sec}</div>}
        {due&&<div style={{fontSize:11.5,color:due.c,fontWeight:due.c===B.textSoft?400:700,marginTop:2}}>{due.t}</div>}
        <div style={{fontSize:11.5,marginTop:4}}>
          {doc?<DocLink doc={doc} toast={toast} label="📄 latest statement"/>
            :onAttach?<button onClick={()=>onAttach(l)} style={{background:"none",border:"none",color:B.navyMid,fontSize:11.5,cursor:"pointer",fontFamily:"inherit",fontWeight:600,padding:0}}>📎 Attach a statement</button>:null}
        </div>
      </div>
      <div style={{textAlign:"right",flexShrink:0}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600}}>{fmtMoney(bal)}</div>
        {l.balanceAsOf&&<div style={{fontSize:10.5,color:B.textMute}}>as of {fmt(l.balanceAsOf)}</div>}
        {limit!=null&&<div style={{marginTop:4,minWidth:150}}>
          <div style={{fontSize:11,color:B.textSoft}}>{fmtMoney(Math.max(0,limit-bal))} available of {fmtMoney(limit)}</div>
          {used!=null&&<div style={{height:5,background:B.borderLight,borderRadius:3,marginTop:4,overflow:"hidden"}}><div style={{width:`${used}%`,height:"100%",background:used>=80?"#b4551f":"#0e7490"}}/></div>}
        </div>}
        {(onEdit||onDelete)&&<div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:6}}>
          {onEdit&&<button onClick={()=>onEdit(l)} style={{background:"none",border:"none",color:B.navyMid,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:600,padding:0}}>Edit</button>}
          {onDelete&&<button onClick={()=>onDelete(l)} style={{background:"none",border:"none",color:B.textMute,fontSize:12,cursor:"pointer",fontFamily:"inherit",padding:0}}>Remove</button>}
        </div>}
      </div>
    </div>;
  };
  // Fixed sections so credit cards and car loans each have an obvious home (and their own Add button) even when
  // empty; a section with nothing in it and no Add button is left out.
  const SECTIONS=[
    {title:"Credit cards",kinds:["Credit Card"],add:"Credit Card",addLabel:"+ Add a credit card",empty:"No credit cards on file."},
    {title:"Car loans",kinds:["Auto Loan","Boat / RV / Aircraft Loan"],add:"Auto Loan",addLabel:"+ Add a car loan",empty:"No car loans on file."},
    {title:"Lines of credit",kinds:["Line of Credit","Securities-Backed Line"],add:"Line of Credit",addLabel:"+ Add a line of credit",empty:"No lines of credit on file."},
  ];
  const MORT_KINDS=["Mortgage","HELOC"];
  const propLabel=p=>p.name||p.address||"Property";
  // A property's mortgage lines, read from the property record; Edit opens the property.
  const propCard=(p,second)=>{
    const bal=second?Number(p.secondMortgageBalance)||0:Number(p.loanBalance)||0;
    const pay=second?p.secondMortgagePayment:p.loanPayment;
    const facts=second?[pay?`${fmtMoney(pay)} monthly`:null].filter(Boolean)
      :[p.interestRate!=null&&p.interestRate!==""?fmtPct(p.interestRate):null,pay?`${fmtMoney(pay)} monthly`:null,p.loanMaturityDate?`Matures ${fmt(p.loanMaturityDate)}`:null].filter(Boolean);
    return <div key={p.id+(second?"-2":"-1")} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${B.gold}`,borderRadius:10,padding:"16px 20px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,boxShadow:B.shadow,flexWrap:"wrap"}}>
      <div style={{minWidth:0,flex:"1 1 220px"}}>
        <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{second?"Second mortgage / HELOC":"Mortgage"} · {propLabel(p)}</div>
        <div style={{fontSize:12,color:B.textSoft}}>{[second?null:p.lender,second?null:p.loanType].filter(Boolean).join(" · ")||"Kept on the property"}</div>
        {facts.length>0&&<div style={{fontSize:11.5,color:B.textSoft,marginTop:4}}>{facts.join(" · ")}</div>}
      </div>
      <div style={{textAlign:"right",flexShrink:0}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600}}>{fmtMoney(bal)}</div>
        {onEditProperty&&<button onClick={()=>onEditProperty(p)} style={{background:"none",border:"none",color:B.navyMid,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:600,padding:0,marginTop:6}}>Edit</button>}
      </div>
    </div>;
  };
  const sectioned=new Set([...SECTIONS.flatMap(x=>x.kinds),...MORT_KINDS]);
  const otherLoans=loans.filter(l=>!sectioned.has(l.loanType));
  const group=(sec,list)=>(list.length>0||onAdd)&&<div key={sec.title} style={{marginBottom:20}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:10}}>
      <div style={{fontSize:12,fontWeight:800,color:B.textMute,letterSpacing:"0.1em",textTransform:"uppercase"}}>{sec.title}{list.length?` (${list.length})`:""}</div>
      {onAdd&&<button onClick={()=>onAdd(sec.add)} style={{background:"none",border:`1px solid ${B.border}`,color:B.navy,borderRadius:6,padding:"3px 10px",fontSize:11.5,cursor:"pointer",fontFamily:"inherit"}}>{sec.addLabel}</button>}
    </div>
    {list.length?list.map(card):<div style={{fontSize:12.5,color:B.textMute,padding:"4px 0 2px"}}>{sec.empty}</div>}
  </div>;
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>Loans & Lines of Credit</div>
        <div style={{fontSize:14,color:B.textSoft,marginTop:4}}>
          Owed: <strong style={{color:B.navy}}>{fmtMoney(owed)}</strong>
          {lines.length>0&&<> · Available on lines: <strong style={{color:B.navy}}>{fmtMoney(available)}</strong></>}
          {monthly>0&&<> · Payments: about <strong style={{color:B.navy}}>{fmtMoney(Math.round(monthly))}</strong>/mo</>}
        </div>
      </div>
      {onAdd&&<Btn small onClick={()=>onAdd("Personal Loan")}>+ Add another loan</Btn>}
    </div>
    {!onAdd&&loans.length===0&&propMorts.length===0?<Empty text="No loans or lines of credit on file yet."/>:<>
      {(propMorts.length>0||loans.some(l=>MORT_KINDS.includes(l.loanType))||onAdd||onEditProperty)&&<div style={{marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:10}}>
          <div style={{fontSize:12,fontWeight:800,color:B.textMute,letterSpacing:"0.1em",textTransform:"uppercase"}}>Mortgages & home equity</div>
          {(onEditProperty||onAdd)&&<button onClick={()=>onAdd?onAdd("Mortgage"):setMortPick(v=>!v)} style={{background:"none",border:`1px solid ${B.border}`,color:B.navy,borderRadius:6,padding:"3px 10px",fontSize:11.5,cursor:"pointer",fontFamily:"inherit"}}>+ Add a mortgage</button>}
        </div>
        {mortPick&&<div style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"12px 14px",marginBottom:10}}>
          <div style={{fontSize:12.5,color:B.textSoft,marginBottom:8}}>Which property is it on? Its mortgage is kept on the property, so it's counted once.</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {onEditProperty&&properties.map(p=><button key={p.id} onClick={()=>{setMortPick(false);onEditProperty(p);}} style={{background:B.white,border:`1px solid ${B.border}`,borderRadius:8,padding:"6px 12px",fontSize:12.5,color:B.navy,cursor:"pointer",fontFamily:"inherit"}}>{propLabel(p)}</button>)}
            {onAdd&&<button onClick={()=>{setMortPick(false);onAdd("Mortgage");}} style={{background:B.white,border:`1px dashed ${B.border}`,borderRadius:8,padding:"6px 12px",fontSize:12.5,color:B.textSoft,cursor:"pointer",fontFamily:"inherit"}}>A property that isn't listed</button>}
          </div>
        </div>}
        {propMorts.map(p=><Fragment key={p.id}>{((Number(p.loanBalance)||0)>0||String(p.lender||"").trim())&&propCard(p,false)}{(Number(p.secondMortgageBalance)||0)>0&&propCard(p,true)}</Fragment>)}
        {loans.filter(l=>MORT_KINDS.includes(l.loanType)).map(card)}
        {propMorts.length===0&&!loans.some(l=>MORT_KINDS.includes(l.loanType))&&<div style={{fontSize:12.5,color:B.textMute,padding:"4px 0 2px"}}>No mortgages on file. A property's mortgage is entered on the property and shows here too.</div>}
      </div>}
      {SECTIONS.map(sec=>group(sec,loans.filter(l=>sec.kinds.includes(l.loanType))))}
      {group({title:"Other loans",add:"Personal Loan",addLabel:"+ Add a loan",empty:"Student, personal, business, private and other loans go here."},otherLoans)}
    </>}
    <div style={{fontSize:11.5,color:B.textMute,lineHeight:1.6,marginTop:8}}>
      Mortgages and home-equity lines are kept on their property and shown here, counted once.
      {locAccounts.length>0&&<> {locAccounts.length===1?"One “Line of Credit” account":`${locAccounts.length} “Line of Credit” accounts`} in Portfolio ({fmtMoney(locTotal)}) also count toward Total Debt.</>}
      {" "}Everything here counts toward Total Debt.
    </div>
  </div>;
}

// ── CASH FLOW EVENT FORM ──────────────────────────────────────────────────────
// billPay defaults TRUE so an existing call site that has not been updated keeps the checkbox
// rather than silently losing it. The database is what actually refuses the flag on a Core
// household, so a stale caller here is a cosmetic slip, whereas defaulting to false would hide
// bill pay from a paying household and look like the feature had broken.
function CashFlowEventForm({initial,onSave,onClose,properties=[],vendors=[],billPay=true}){
  const blank={direction:"income",eventType:"Salary",description:"",amount:"",frequency:"once",startDate:todayISO(),endDate:"",taxTreatment:"ordinary",notes:"",pcmResponsible:false,category:"",propertyId:"",vendorKey:""};
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
  const[showReq,setShowReq]=useState(false);
  const[err,setErr]=useState("");
  const save=async()=>{if(!f.amount||!f.startDate){setShowReq(true);return;}
    if(!(Number(String(f.amount).replace(/[$,\s]/g,""))>0)){setErr("Enter an amount greater than zero. Use Income or Expense above to say which way the money moves.");return;}
    if(f.frequency!=="once"&&f.endDate&&f.endDate<f.startDate){setErr("The end date can't be before the start date.");return;}
    setErr("");setSaving(true);
    // A one-time event has no end date; the box is hidden for it, so don't save a value left over from an earlier choice.
    const ok=await onSave(f.frequency==="once"?{...f,endDate:""}:f);if(ok===false){setSaving(false);return;}onClose();};
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
        <option value="">Not categorized</option>
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
    <Field label="Description" optional><Inp placeholder={isExpense?"e.g., Monthly grocery budget":"e.g., Acme Corp Q4 Bonus"} value={f.description||""} onChange={set("description")}/></Field>
    {isExpense?
      <>
      <Field label="Amount ($)" required><MoneyInput value={f.amount||""} onChange={set("amount")}/></Field>
      {billPay&&<label style={{display:"flex",alignItems:"center",gap:8,margin:"2px 0 10px",cursor:"pointer",fontSize:13,color:B.text}}>
        <input type="checkbox" checked={!!f.pcmResponsible} onChange={e=>setF(p=>({...p,pcmResponsible:e.target.checked}))} style={{width:16,height:16,accentColor:B.navy}}/>
        <span>{BRAND.short} is responsible for making this payment</span>
      </label>}
      </>
    :<Grid2>
      <Field label="Gross Amount ($)" required><MoneyInput value={f.amount||""} onChange={set("amount")}/></Field>
      <Field label="Tax Treatment"><Sel value={f.taxTreatment} onChange={set("taxTreatment")}>{CF_TAX_TREATMENTS.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</Sel></Field>
    </Grid2>}
    <Grid2>
      <Field label={f.frequency==="once"?"Date":"Start Date"} required><Inp type="date" value={f.startDate||""} onChange={set("startDate")}/></Field>
      {f.frequency!=="once"&&<Field label="End Date" optional><Inp type="date" value={f.endDate||""} onChange={set("endDate")}/></Field>}
    </Grid2>
    <Field label="Notes" optional><Tex value={f.notes||""} onChange={set("notes")}/></Field>
    {showReq&&<ReqHint/>}
    {err&&<div style={{fontSize:12,color:"#8b1a1a",background:"#fff5f5",border:"1px solid #f3c2c2",borderRadius:8,padding:"8px 10px",marginTop:8}}>{err}</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:10}}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</Btn>
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
      <div style="text-align:right"><h1>Cash Flow Projection</h1><div class="sub">${escHtml(family.name)}</div><div class="date">${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div></div>
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
      return`<tr><td>${escHtml(e.eventType)}</td><td>${escHtml(e.description||"—")}</td><td>${escHtml(freqLabel)}</td><td>${fmt(e.startDate)}</td><td class="num">${fmtUSD(e.amount)}</td><td>${escHtml(treatLabel)}</td><td class="num">${fmtUSD(e.projectedNet||0)}</td></tr>`;
    }).join("")}
    </tbody></table>`:""}
    ${expenseEvents.length>0?`<h2>Expense Items</h2>
    <table><thead><tr><th>Category</th><th>Description</th><th>Frequency</th><th>Start</th><th class="num">Amount</th><th class="num">Total (proj.)</th></tr></thead><tbody>
    ${expenseEvents.map(e=>{
      const freqLabel=CF_FREQUENCIES.find(fr=>fr.value===e.frequency)?.label||e.frequency;
      return`<tr><td>${escHtml(e.eventType)}</td><td>${escHtml(e.description||"—")}</td><td>${escHtml(freqLabel)}</td><td>${fmt(e.startDate)}</td><td class="num neg">−${fmtUSD(e.amount)}</td><td class="num neg">−${fmtUSD(Math.abs(e.projectedNet||0))}</td></tr>`;
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
  const[isCfOpen,toggleCf]=useOpenSet();
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
  // Which expenses get "Mark Paid". Premier (bill pay): the bills ORDANIS pays (pcm_responsible).
  // Basic and Core (self-service, 2026-10-20): the household ticks off every bill it pays itself; the
  // database allows that register for any plan unless the bill is marked as ORDANIS's to pay.
  const tracksPaid=ev=>!ev._synthetic&&(billPay?!!ev.pcmResponsible:true);
  // Unchecking is two steps: a paid record says who paid what and when, and one stray tap should not
  // erase it. Marking paid stays one tap.
  const confirmUnpaid=(what,paidAt,paidBy)=>window.confirm(
    `Mark ${what} as unpaid?${paidAt?` It was marked paid on ${fmt(paidAt)}${paidBy?` by ${paidBy}`:""}.`:""} This clears that record.`);
  const togglePeriodPaid=async(event,period,currentlyPaid,info={})=>{
    if(currentlyPaid&&!confirmUnpaid(`${event.description||"this bill"} for ${info.label||"this period"}`,info.paidAt,info.paidBy))return;
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
    if(error){toast&&toast("We couldn't save your settings. Please try again. ("+error.message+")","error");return;}
    if(reload)reload("families");
  };
  const updateSettings=async(patch)=>{
    if(readOnly)return;
    const next={...settings,...patch};
    setSettings(next);
    try{localStorage.setItem(settingsKey,JSON.stringify(next));}catch{}
    const{error}=await sb.from("families").update({cash_flow_settings:next}).eq("id",family.id);
    if(error){toast&&toast("We couldn't save your settings. Please try again. ("+error.message+")","error");return;}
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
      <div style="text-align:right"><h1>Relocation Tax Comparison</h1><div class="sub">${escHtml(family.name)}</div><div class="date">${new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div></div>
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
        <div class="col-name">${escHtml(curName)}</div>
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
    <table><thead><tr><th>Month</th><th class="num">${escHtml(curName)} Net</th><th class="num">${compareState.name} Net</th><th class="num">Difference</th></tr></thead><tbody>
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
    if(error){toast(error.message,"error");return false;}else{toast("Event added. Your cash flow just got clearer.");reload("cash_flow_events");}
  };
  const editEvent=async(id,f)=>{
    const{error}=await sb.from("cash_flow_events").update({direction:f.direction||"income",event_type:f.eventType,description:f.description||null,amount:Number(f.amount)||0,frequency:f.frequency,start_date:f.startDate,end_date:f.endDate||null,tax_treatment:f.taxTreatment||"ordinary",notes:f.notes||null,pcm_responsible:f.direction==="expense"?!!f.pcmResponsible:false,category:f.direction==="expense"?(f.category||null):null,property_id:f.propertyId||null,...(f.direction==="expense"?splitVendorKey(f.vendorKey):{vendor_family_contact_id:null,vendor_property_contact_id:null})}).eq("id",id);
    if(error){toast(error.message,"error");return false;}else{toast("Event updated. All saved.");reload("cash_flow_events");}
  };
  const delEvent=async(id)=>{
    const{error}=await sb.from("cash_flow_events").delete().eq("id",id);
    if(error)toast(error.message,"error");else{toast("Event deleted");reload("cash_flow_events");}
  };
  // Mark/unmark a PCM-responsible expense as paid — mirrors the tasks done/completed_by pattern.
  const togglePaid=async(ev)=>{
    if(ev.paid&&!confirmUnpaid(ev.description||"this bill",ev.paidAt,ev.paidBy))return;
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
      {(()=>{const open=isCfOpen("settings"),cr=collapseRow(open,()=>toggleCf("settings"));return <div {...cr} style={{...cr.style,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:open?12:0}}>
        <div style={{fontSize:11,fontWeight:800,color:B.textMute,letterSpacing:"0.1em",textTransform:"uppercase"}}>Projection Settings{readOnly?" (read-only)":""}</div>
        <div style={{fontSize:12,color:B.textSoft,whiteSpace:"nowrap"}}>{!open&&(settings.projectionMode==="year"?`Current year`:(CF_PROJECTION_OPTIONS.find(o=>o.value===settings.projectionMonths)?.label||""))}<Chevron open={open}/></div>
      </div>;})()}
      {isCfOpen("settings")&&<><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(160px,100%),1fr))",gap:12}}>
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
          <Inp type="number" min="0" max="20" step="0.01" disabled={readOnly} value={settings.localTaxRate||""} onChange={e=>updateSetting("localTaxRate",Number(e.target.value)||0)} placeholder="e.g., NYC 3.876"/>
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
          <Inp type="number" min="0" max="20" step="0.01" disabled={readOnly} value={settings.compareLocalTaxRate||""} onChange={e=>updateSetting("compareLocalTaxRate",Number(e.target.value)||0)} placeholder="0 (no city tax)"/>
        </Field>}
        {compareActive&&<div style={{fontSize:11,color:B.textSoft}}>Models the identical inputs as if the client were taxed in {compareState.name}{compareLocalRate>0?` + ${compareLocalRate}% local`:" with no city tax"}.</div>}
      </div></>}
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
      <svg viewBox={`0 0 ${isMobile?400:Math.max(720,monthlyData.length*18)} 260`} style={{width:"100%",height:isMobile?200:270,display:"block"}}>
        {(() => {
          const W=isMobile?400:Math.max(720,monthlyData.length*18);const H=260;const padL=isMobile?50:60,padR=isMobile?(compareActive?50:44):(compareActive?64:54),padT=18,padB=34;
          const axisFont=isMobile?13:9; // the phone drawing is shrunk less, but still needs larger type to read
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
              <text x={padL-8} y={y+3} fontSize={axisFont} fill={B.textMute} textAnchor="end">{fmtMoneyShort(v)}</text>
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
            {cTicks.map((v,i)=><text key={i} x={W-padR+6} y={cumY(v)+3} fontSize={axisFont} fill={B.textMute} textAnchor="start">{fmtMoneyShort(v)}</text>)}
            {/* X axis labels */}
            {monthlyData.map((m,i)=>i%stepLabel!==0?null:<text key={i} x={padL+barW*i+barW/2} y={padT+innerH+(isMobile?18:15)} fontSize={axisFont} fill={B.textMute} textAnchor="middle">{m.label}</text>)}
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
      const open=isCfOpen("ev-"+e.id),cr=collapseRow(open,()=>toggleCf("ev-"+e.id));
      return <div key={e.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${accentColor}`,borderRadius:10,padding:isMobile?14:16,marginBottom:8,boxShadow:B.shadow,opacity:e._excluded?0.55:1}}>
        <div {...cr} style={{...cr.style,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
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
              {isExpense&&!billPay&&tracksPaid(e)&&!isRegisterFreq(e)&&e.paid&&<Badge scheme={{bg:"#e0f5e9",text:"#0d5c2b",dot:"#18a850"}}>✓ Paid</Badge>}
            </div>
            {open&&e.description&&<div style={{fontSize:13,color:B.textMid,marginBottom:4}}>{e.description}</div>}
            {open&&<div style={{fontSize:11,color:B.textSoft}}>{fmt(e.startDate)}{e.endDate?` → ${fmt(e.endDate)}`:""}{!isExpense?` · ${treatLabel}`:""}</div>}
            {open&&isExpense&&tracksPaid(e)&&!isRegisterFreq(e)&&e.paid&&e.paidAt&&<div style={{fontSize:11,color:"#0d5c2b",marginTop:3,fontWeight:600}}>✓ Paid {fmt(e.paidAt)}{e.paidBy?` · by ${e.paidBy}`:""}</div>}
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:12,color:B.textSoft}}>{e.frequency==="once"?"Amount":"Per occurrence"}</div>
            <div style={{fontSize:16,fontWeight:700,color:isExpense||isNegative?"#8b1a1a":B.navy}}>{isExpense?"−":(isNegative?"−":"")}{fmtMoney(Math.abs(e.amount))}<Chevron open={open}/></div>
            {open&&<><div style={{fontSize:11,color:B.textSoft,marginTop:6}}>Projected ({CF_PROJECTION_OPTIONS.find(o=>o.value===settings.projectionMonths)?.label||""})</div>
            <div style={{fontSize:13,fontWeight:700,color:e.projectedNet>=0?"#0d5c2b":"#8b1a1a"}}>{e.projectedNet<0?"−":""}{fmtMoney(Math.abs(e.projectedNet||0))} <span style={{fontSize:10,color:B.textSoft,fontWeight:400}}>{isExpense?"total":"net"}</span></div></>}
          </div>
        </div>
        {/* Breakdown for synthetic rental events */}
        {open&&e._synthetic&&bd&&<div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${B.borderLight}`}}>
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
        {open&&isExpense&&tracksPaid(e)&&isRegisterFreq(e)&&(()=>{
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
                {!readOnly&&<Btn small variant={p.paid?"ghost":"primary"} onClick={()=>togglePeriodPaid(e,p.periodKey,p.paid,{label:p.label,paidAt:p.paidAt,paidBy:p.paidBy})}>{p.paid?"Mark Unpaid":"Mark Paid"}</Btn>}
              </div>)}
            </div>}
          </div>;
        })()}
        {/* Action row: reorder + edit + delete (only for non-synthetic, non-readOnly) */}
        {open&&reorderable&&<div style={{display:"flex",gap:6,marginTop:10,paddingTop:10,borderTop:`1px solid ${B.borderLight}`,justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>moveEvent(e.id,"up")} disabled={!canMoveUp} title="Move up" style={{background:"none",border:`1px solid ${B.border}`,borderRadius:6,padding:"4px 10px",cursor:canMoveUp?"pointer":"not-allowed",color:canMoveUp?B.navy:B.textMute,fontSize:13,fontFamily:"inherit",opacity:canMoveUp?1:0.4}}>↑</button>
            <button onClick={()=>moveEvent(e.id,"down")} disabled={!canMoveDown} title="Move down" style={{background:"none",border:`1px solid ${B.border}`,borderRadius:6,padding:"4px 10px",cursor:canMoveDown?"pointer":"not-allowed",color:canMoveDown?B.navy:B.textMute,fontSize:13,fontFamily:"inherit",opacity:canMoveDown?1:0.4}}>↓</button>
          </div>
          <div style={{display:"flex",gap:6}}>
            {isExpense&&tracksPaid(e)&&!isRegisterFreq(e)&&<Btn small variant={e.paid?"ghost":"primary"} onClick={()=>togglePaid(e)}>{e.paid?"Mark Unpaid":"Mark Paid"}</Btn>}
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
    {modal&&modal.type==="add"&&<Modal title="New Cash Flow Event" onClose={()=>setModal(null)} wide><CashFlowEventForm properties={properties} vendors={vendors} billPay={billPay} onSave={async f=>{const r=await addEvent(f);if(r!==false)setModal(null);return r;}} onClose={()=>setModal(null)}/></Modal>}
    {modal&&modal.type==="edit"&&<Modal title={modal.event.direction==="expense"?"Edit Expense":"Edit Income Event"} onClose={()=>setModal(null)} wide><CashFlowEventForm initial={modal.event} properties={properties} vendors={vendors} billPay={billPay} onSave={async f=>{const r=await editEvent(modal.event.id,f);if(r!==false)setModal(null);return r;}} onClose={()=>setModal(null)}/></Modal>}
    {reportOpen&&<CashFlowReport family={family} projectionMonths={settings.projectionMonths} projectionMode={settings.projectionMode} filingStatus={settings.filingStatus} baseIncome={settings.baseIncome} stateRate={settings.stateTaxRate} stateName={STATE_TAX_RATES.find(s=>s.code===settings.stateCode)?.name||settings.stateCode} localRate={settings.localTaxRate} monthlyData={monthlyData} events={enrichedEvents} onClose={()=>setReportOpen(false)}/>}
  </div>;
}

// ── SIGNUPS & REVENUE (admin) ────────────────────────────────────────────────
// Tracks households created by the public self-serve sign-up flow (SignupFlow.jsx ->
// public-signup -> stripe-webhook's createFamilyFromSignup), separately from households an
// advisor/admin created for an existing relationship. Distinguished by families.acquisition_channel
// (not remapped by toClient, so it reads here as the raw column name), which the webhook sets to
// "self_serve" -- everything else defaults to "advisor". plan_features and user_profiles are not
// in the app's global TABLES fetch (data.*), so this view does its own small reads on mount, the
// same pattern UserManagementView already uses.
const SIGNUP_PLAN_ORDER=["basic","core","premier"];

// ── DOCUMENTS VIEW ────────────────────────────────────────────────────────────
const DOC_CATEGORIES = ["General","Tax","Legal","Insurance","Investment","Real Estate","Estate Planning","Other"];
// A document may be pinned to one specific section of a property (or to the
// family's valuables schedule), which is what makes the supporting-document
// links appear next to the figures on the property and valuables cards.
// `suggestCategory` pre-selects a sensible CHRIS folder when a section is chosen
// so the user isn't asked the same thing twice.
const DOC_SECTIONS=[
  {key:"mortgage",          label:"Mortgage / Loan Document", scope:"property", suggestCategory:"Real Estate"},
  {key:"tax",               label:"Property Tax Bill",        scope:"property", suggestCategory:"Tax"},
  {key:"insurance_dec",     label:"Insurance Declarations",   scope:"property", suggestCategory:"Insurance"},
  {key:"insurance_invoice", label:"Insurance Invoice",        scope:"property", suggestCategory:"Insurance"},
  {key:"flood_dec",         label:"Flood Declarations",       scope:"property", suggestCategory:"Insurance"},
  {key:"rental",            label:"Rental Agreement",         scope:"property", suggestCategory:"Real Estate"},
  {key:"valuables_schedule",label:"Valuables Schedule",       scope:"family",   suggestCategory:"Insurance"},
  // One specific valuable's policy (documents.valuable_id), e.g. the rider for a watch or a boat policy.
  {key:"valuable_policy",   label:"Valuable Insurance Policy",scope:"valuable", suggestCategory:"Insurance"},
  // One loan or line's latest statement (documents.loan_id), shown on its Loans & Lines card.
  {key:"loan_statement",    label:"Loan / Line Statement",    scope:"loan",     suggestCategory:"General"},
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

// ── CHRIS SEARCH RESULTS ─────────────────────────────────────────────────────
// Each row has to answer three questions the folder tree cannot: what is this,
// where does it live, and is it the current one.
//
// That last question is the dangerous one. A superseded policy keeps a nearly
// identical name to the one that replaced it, and downloading last year's cover
// and acting on it is a worse outcome than not finding anything at all. So a
// replaced document is marked plainly rather than left to look current.
function VaultSearchResults({hits,searching,query,onDownload,onClear}){
  const fmtSize=b=>!b?"":b>1048576?`${(b/1048576).toFixed(1)} MB`:`${Math.max(1,Math.round(b/1024))} KB`;
  // The snippet arrives with « » around the match so it can be emphasised without
  // putting raw HTML from a document into the DOM.
  const renderSnippet=(t)=>{
    if(!t)return null;
    return t.split(/(«[^»]*»)/g).map((part,i)=>
      part.startsWith("«")&&part.endsWith("»")
        ? <mark key={i} style={{background:"rgba(206,182,132,0.45)",color:B.navy,padding:"0 2px",borderRadius:2}}>{part.slice(1,-1)}</mark>
        : <span key={i}>{part}</span>);
  };
  if(searching&&!hits.length)return <div style={{padding:"28px 0"}}><Spinner/></div>;
  if(!hits.length)return <div style={{background:B.bgCard,border:`1px solid ${B.borderLight}`,borderRadius:10,
      padding:"28px 20px",textAlign:"center",boxShadow:B.shadow}}>
      <div style={{fontSize:15,fontWeight:700,color:B.navy}}>Nothing matched “{query}”</div>
      <div style={{fontSize:12.5,color:B.textMute,marginTop:6,maxWidth:460,marginLeft:"auto",marginRight:"auto",lineHeight:1.6}}>
        Searching looks at file names, your notes, and the text inside documents that have been
        scanned. A document that has never been scanned can only be found by its name.
      </div>
      <div style={{marginTop:14}}><Btn variant="ghost" small onClick={onClear}>Back to folders</Btn></div>
    </div>;
  return <div>
    <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,marginBottom:12,flexWrap:"wrap"}}>
      <div style={{fontSize:13,color:B.textSoft}}>
        {hits.length} match{hits.length===1?"":"es"} for “{query}”{searching?" · updating…":""}
      </div>
      <button onClick={onClear} style={{background:"none",border:"none",color:B.navyMid,cursor:"pointer",
        fontSize:12.5,fontFamily:"inherit",fontWeight:600,padding:0}}>Back to folders</button>
    </div>
    {hits.map(h=>
      <div key={h.id} style={{background:B.bgCard,border:`1px solid ${B.borderLight}`,borderRadius:10,
        padding:"14px 16px",marginBottom:10,boxShadow:B.shadow,opacity:h.superseded?0.72:1}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:14.5,fontWeight:700,color:B.navy,wordBreak:"break-word"}}>
              {h.name}
              {h.superseded&&<span style={{marginLeft:8,fontSize:10.5,fontWeight:700,letterSpacing:"0.08em",
                textTransform:"uppercase",color:"#8a5c00",background:"#fef3e2",padding:"2px 7px",borderRadius:4}}>
                Replaced — kept for reference</span>}
            </div>
            <div style={{fontSize:12,color:B.textMute,marginTop:3}}>
              {h.located_in}{h.file_size?` · ${fmtSize(h.file_size)}`:""}
              {h.expiry_date?` · expires ${parseLocalDate(h.expiry_date).toLocaleDateString("en-US",{day:"numeric",month:"short",year:"numeric"})}`:""}
            </div>
          </div>
          <Btn small onClick={()=>onDownload({filePath:h.file_path,name:h.name})}>Download</Btn>
        </div>
        <div style={{fontSize:11.5,color:B.gold,fontWeight:600,marginTop:8}}>Found in {h.matched_on}</div>
        {h.snippet&&<div style={{fontSize:12.5,color:B.textMid,marginTop:5,lineHeight:1.55,
          borderLeft:`2px solid ${B.borderLight}`,paddingLeft:10}}>…{renderSnippet(h.snippet)}…</div>}
      </div>)}
  </div>;
}

// Reads the first part of a document and suggests which folder it belongs in.
//
// SUGGESTS. The caller pre-selects it and the person can change it before saving.
// Filing automatically would be worse than filing nothing: a document in the wrong
// folder is invisible in the same way a lost one is, except nobody knows to look.
//
// Only the opening is sent — a filing decision is made on the first page of a
// document, and sending forty pages of a trust costs more and decides no better.
// targets: from linkTargetsFor(), the household's own properties and valuables a document could be pinned to.
async function suggestFolder(text,fileName,folders,targets=null){
  const{data,error}=await sb.functions.invoke("suggest-document-folder",{
    body:{text:String(text).slice(0,4000),fileName:fileName||"",folders,targets:targets?targets.list:[]},
  });
  if(error||!data||!Array.isArray(data.options))return null;
  // Each option, re-checked against the household's real folder list rather than
  // trusted outright -- same rule a single suggestion always had to pass. Usually
  // there's exactly one; occasionally the document genuinely fits more than one
  // folder and there are up to three, for the person to choose between.
  const seen=new Set();
  const options=[];
  for(const opt of data.options){
    if(!opt)continue;
    let entry=null;
    if(opt.folder&&folders.includes(opt.folder)){
      entry={folder:opt.folder,newFolder:null,why:opt.why||""};
    }else if(opt.newFolder){
      const v=validateFolderName(opt.newFolder,folders);
      if(v.ok)entry={folder:null,newFolder:v.name,why:opt.why||""};
    }
    if(!entry)continue;
    const key=entry.folder||`new:${entry.newFolder.toLowerCase()}`;
    if(seen.has(key))continue;
    seen.add(key);options.push(entry);
  }
  // A proposed title and a one-line summary come back too -- a phone photo arrives
  // as "IMG_4821", which nobody will ever search for. Both only pre-fill fields the
  // person can see and change.
  const suggestedName=typeof data.suggestedName==="string"&&data.suggestedName.trim()?data.suggestedName.trim().slice(0,150):null;
  const summary=typeof data.summary==="string"&&data.summary.trim()?data.summary.trim().slice(0,500):null;
  // Where CHRIS thinks it belongs on the household's records (a property section, or one valuable's
  // policy). Mapped back from the short key to a real id, and dropped if the key is not one we sent.
  let link=null;
  if(targets&&data.link&&targets.byKey[data.link.target]){
    const t=targets.byKey[data.link.target];
    link={kind:t.kind,id:t.id,label:t.label,section:data.link.section,why:data.link.why||""};
  }
  const policy=data.policy&&typeof data.policy==="object"?data.policy:null;
  if(!options.length&&!suggestedName&&!summary&&!link)return null;
  return{options,confidence:data.confidence||"low",suggestedName,summary,link,policy};
}

// The household's properties and valuables, as the short keys suggest-document-folder works with
// (P1, V1 ...). Only names the household entered are sent; ids never leave the browser.
function linkTargetsFor(properties,valuables){
  const list=[],byKey={};
  (properties||[]).slice(0,40).forEach((p,i)=>{const key=`P${i+1}`;const label=p.name||[p.address,p.city].filter(Boolean).join(", ")||"Property";list.push({key,kind:"property",label});byKey[key]={kind:"property",id:p.id,label};});
  (valuables||[]).slice(0,40).forEach((v,i)=>{const key=`V${i+1}`;const label=[v.description,v.category,v.makeModel].filter(Boolean).join(" · ")||"Valuable";list.push({key,kind:"valuable",label});byKey[key]={kind:"valuable",id:v.id,label};});
  return list.length?{list,byKey}:null;
}
const linkLabel=l=>l?`${l.label} · ${sectionLabel(l.section)}`:"";

// A phone photo is 4-6 MB, which is over what the reader accepts in one image, and
// HEIC from an iPhone library is not read at all. So the READ gets a resized JPEG
// (long side 2000px is plenty to read a page); the file that gets STORED is always
// the original, untouched. Returns base64, or null when this browser can't decode it.
async function prepareImageForRead(file,maxSide=2000){
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("decode"));i.src=url;});
    const w0=img.naturalWidth,h0=img.naturalHeight;
    if(!w0||!h0)return null;
    const scale=Math.min(1,maxSide/Math.max(w0,h0));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(w0*scale));canvas.height=Math.max(1,Math.round(h0*scale));
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height); // transparent PNGs read better on white
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const dataUrl=canvas.toDataURL("image/jpeg",0.85);
    canvas.width=0;canvas.height=0;
    return dataUrl.split(",")[1]||null;
  }catch(_e){return null;}
  finally{URL.revokeObjectURL(url);}
}
const READABLE_IMAGE_TYPES=["image/png","image/jpeg","image/webp","image/heic","image/heif","image/gif"];
const isReadableImage=f=>{
  const t=String(f&&f.type||"").toLowerCase();
  const ext=(String(f&&f.name||"").split(".").pop()||"").toLowerCase();
  return READABLE_IMAGE_TYPES.includes(t==="image/jpg"?"image/jpeg":t)||["png","jpg","jpeg","webp","heic","heif","gif"].includes(ext);
};
const isPdfFile=f=>String(f&&f.type||"").toLowerCase()==="application/pdf"||/\.pdf$/i.test(String(f&&f.name||""));

// Pulls the text out of one picked file so CHRIS can suggest where it goes and
// search can find it later. Digital PDFs are read in the browser; scanned PDFs and
// photos go to the server-side reader. Never throws: a document that can't be read
// still uploads, it just arrives without a suggestion. Returns text or null.
async function readDocumentForFiling(f,onPhase){
  const phase=t=>{if(onPhase)onPhase(t);};
  try{
    if(isPdfFile(f)){
      try{
        phase("Reading document…");
        const t=await extractPdfText(await f.arrayBuffer());
        if(t&&t.length>=20)return t;
      }catch(_e){/* fall through to the vision read */}
      try{
        const r=await extractScannedPdfText(await f.arrayBuffer(),(p,tot)=>phase(`Scanning page ${p} of ${tot}…`));
        if(r&&r.text)return r.text;
      }catch(_e){}
      return null;
    }
    if(isReadableImage(f)){
      phase("Reading the photo…");
      let b64=await prepareImageForRead(f),mediaType="image/jpeg";
      if(!b64){
        // This browser couldn't decode it (HEIC outside Safari, say). Send the original
        // only if it's a type the reader takes and small enough to go in one piece.
        const mt=f.type==="image/jpg"?"image/jpeg":f.type;
        if(!["image/png","image/jpeg","image/webp"].includes(mt)||f.size>3_500_000)return null;
        b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(",")[1]);r.onerror=()=>rej(new Error("read failed"));r.readAsDataURL(f);});
        mediaType=mt;
      }
      const{data,error}=await sb.functions.invoke("extract-document-text",{body:{fileBase64:b64,mediaType}});
      if(!error&&data&&data.text)return data.text;
    }
  }catch(_e){}
  return null;
}

// Saves one document into a household's CHRIS: the original file to the private
// bucket under the household's own folder (which is what the storage policies
// check), then the row. If the row can't be written, the stored file is removed so
// nothing is left behind that no one can see. Returns an error message or null.
async function fileChrisDocument({familyId,file,name,category,description,extractedText,link=null}){
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  const path=`${familyId}/${Date.now()}_${Math.random().toString(36).slice(2,7)}_${file.name.replace(/[^A-Za-z0-9._-]+/g,"_")}`;
  const{error:upErr}=await sb.storage.from("documents").upload(path,file,{upsert:false});
  if(upErr)return upErr.message;
  // A link pins the document to one record's section. Whatever held that spot before is unlinked, never
  // deleted (same rule as the upload form): last year's policy still belongs in CHRIS.
  const propertyId=link&&link.kind==="property"?link.id:null,valuableId=link&&link.kind==="valuable"?link.id:null;
  const loanId=link&&link.kind==="loan"?link.id:null;
  const section=link?link.section:null;
  if(section){
    let q=sb.from("documents").update({property_section:null}).eq("family_id",familyId).eq("property_section",section);
    q=propertyId?q.eq("property_id",propertyId):valuableId?q.eq("valuable_id",valuableId):loanId?q.eq("loan_id",loanId):q;
    await q;
  }
  const{error:dbErr}=await sb.from("documents").insert({family_id:familyId,name:name.trim(),description:description||null,
    category,file_path:path,file_size:file.size,file_type:file.type||ext,extracted_text:extractedText||null,uploaded_by:CURRENT_USER_LABEL||null,
    property_id:propertyId,valuable_id:valuableId,loan_id:loanId,property_section:section});
  if(dbErr){await sb.storage.from("documents").remove([path]).catch(()=>{});return dbErr.message;}
  return null;
}

const CONFIDENCE_WORDS={high:"CHRIS is fairly sure",medium:"CHRIS's best match",low:"CHRIS isn't sure"};

// ── SNAP OR ADD SEVERAL ─────────────────────────────────────────────────────
// Onboarding usually means a pile of paper. Take photos one after another, or
// pick a stack of PDFs, and each one becomes a card: CHRIS reads it, proposes a
// name, a one-line summary and a folder (or a new folder when nothing fits), and
// the person files each card with one tap or changes anything first.
//
// Nothing is filed until the person taps File. A proposed NEW folder is only
// created when a card that uses it is actually filed, so removing a card never
// leaves an empty folder behind. Used in CHRIS and in the onboarding wizard.
const BATCH_READ_CONCURRENCY=2;
function ChrisBatchFiler({familyId,toast,onFiled}){
  const[items,setItems]=useState([]);
  const itemsRef=useRef(items);itemsRef.current=items;
  const[customFolders,setCustomFolders]=useState([]);
  const customFoldersRef=useRef(customFolders);customFoldersRef.current=customFolders;
  const[filingAll,setFilingAll]=useState(false);
  const cameraRef=useRef(null),filesRef=useRef(null);
  const queueRef=useRef([]),runningRef=useRef(0),aliveRef=useRef(true);
  const loadFolders=useCallback(async()=>{
    if(!familyId)return[];
    const{data,error}=await sb.from("document_folders").select("name").eq("family_id",familyId).order("name");
    const names=error?[]:(data||[]).map(r=>r.name);
    if(aliveRef.current)setCustomFolders(names);
    return names;
  },[familyId]);
  useEffect(()=>{aliveRef.current=true;loadFolders();return()=>{aliveRef.current=false;};},[loadFolders]);
  // The household's own properties and valuables, so CHRIS can suggest which one a document belongs to.
  const targetsRef=useRef(null);
  useEffect(()=>{
    if(!familyId)return;
    Promise.all([
      sb.from("properties").select("id,name,address,city").eq("family_id",familyId),
      sb.from("valuables").select("id,description,category,make_model").eq("family_id",familyId),
    ]).then(([p,v])=>{targetsRef.current=linkTargetsFor((p.data||[]).map(toClient),(v.data||[]).map(toClient));}).catch(()=>{});
  },[familyId]);
  // Thumbnails are object URLs; let them go when the filer closes.
  useEffect(()=>()=>{itemsRef.current.forEach(it=>{if(it.thumb)URL.revokeObjectURL(it.thumb);});},[]);
  const allFolders=[...DOC_CATEGORIES,...customFolders];
  // New folders chosen on other cards in this batch count as real for the next
  // suggestion, so ten photos of boat paperwork don't each propose "Boat" afresh.
  const foldersForSuggest=()=>{
    const pending=itemsRef.current.filter(it=>it.newFolder&&it.category).map(it=>it.category);
    return[...new Set([...DOC_CATEGORIES,...customFoldersRef.current,...pending])];
  };
  const patch=(id,ch)=>setItems(list=>list.map(it=>it.id===id?{...it,...(typeof ch==="function"?ch(it):ch)}:it));

  const readOne=async item=>{
    patch(item.id,{status:"reading",phase:"Reading…"});
    const text=await readDocumentForFiling(item.file,ph=>aliveRef.current&&patch(item.id,{phase:ph}));
    if(!aliveRef.current)return;
    let sug=null;
    if(text&&text.length>80){
      patch(item.id,{phase:"Working out where this belongs…"});
      try{sug=await suggestFolder(text,item.file.name,foldersForSuggest(),targetsRef.current);}catch(_e){}
    }
    if(!aliveRef.current)return;
    patch(item.id,it=>{
      const top=sug&&sug.options&&sug.options[0];
      // An existing folder is pre-selected when CHRIS is reasonably sure. A NEW folder
      // is never pre-selected: creating one is the person's call, one tap away.
      const preselect=top&&top.folder&&sug.confidence!=="low"?top.folder:null;
      return{status:"ready",phase:"",text,suggestion:sug,
        name:(!it.nameTouched&&sug&&sug.suggestedName)?sug.suggestedName:it.name,
        description:(!it.descTouched&&sug&&sug.summary)?sug.summary:it.description,
        category:it.categoryTouched?it.category:(preselect||it.category),newFolder:it.categoryTouched?it.newFolder:false,
        // A suggested link is on by default only when CHRIS is reasonably sure; it is shown on the card
        // either way and the person can switch it off before filing.
        useLink:!!(sug&&sug.link&&sug.confidence!=="low")};
    });
  };
  const pump=()=>{
    while(runningRef.current<BATCH_READ_CONCURRENCY&&queueRef.current.length){
      const item=queueRef.current.shift();
      if(!itemsRef.current.some(it=>it.id===item.id))continue; // removed while waiting
      runningRef.current++;
      readOne(item).finally(()=>{runningRef.current--;pump();});
    }
  };
  const addFiles=fileList=>{
    const files=Array.from(fileList||[]);
    const fresh=[];
    for(const f of files){
      const problem=docFileProblem(f);
      if(problem){toast(`${f.name}: ${problem}`,"error");continue;}
      const base=f.name.replace(/\.[^./\\]+$/,"").trim()||"Document";
      fresh.push({id:`${Date.now()}_${Math.random().toString(36).slice(2,8)}`,file:f,
        thumb:isReadableImage(f)?URL.createObjectURL(f):null,status:"queued",phase:"Waiting to read…",
        name:base,nameTouched:false,description:"",descTouched:false,category:"General",categoryTouched:false,newFolder:false,
        typedFolder:null,suggestion:null,text:null,error:null});
    }
    if(!fresh.length)return;
    setItems(list=>[...list,...fresh]);
    itemsRef.current=[...itemsRef.current,...fresh];
    queueRef.current.push(...fresh);
    pump();
  };
  const removeItem=id=>{
    const it=itemsRef.current.find(x=>x.id===id);
    if(it&&it.thumb)URL.revokeObjectURL(it.thumb);
    setItems(list=>list.filter(x=>x.id!==id));
  };
  const chooseFolder=(id,folder,isNew)=>patch(id,{category:folder,newFolder:!!isNew,categoryTouched:true});
  // Nothing fits and CHRIS didn't propose anything: the person names a folder
  // themselves. Same rules as everywhere else, and like CHRIS's own proposals it
  // is only created when the card is filed. A name already chosen on another
  // card in this batch is reused rather than refused.
  const useTypedFolder=id=>{
    const it=itemsRef.current.find(x=>x.id===id);
    if(!it)return;
    const typed=String(it.typedFolder||"").trim().replace(/\s+/g," ");
    const pending=itemsRef.current.filter(x=>x.newFolder&&x.category).map(x=>x.category);
    const same=pending.find(n=>n.toLowerCase()===typed.toLowerCase());
    if(same){patch(id,{category:same,newFolder:true,categoryTouched:true,typedFolder:null,error:null});return;}
    const v=validateFolderName(typed,customFoldersRef.current);
    if(!v.ok){patch(id,{error:v.reason});return;}
    patch(id,{category:v.name,newFolder:true,categoryTouched:true,typedFolder:null,error:null});
  };

  const fileOne=async(id,knownFolders)=>{
    const it=itemsRef.current.find(x=>x.id===id);
    if(!it||it.status==="filing"||it.status==="filed")return false;
    if(!it.name.trim()){patch(id,{error:"Give it a name first."});return false;}
    patch(id,{status:"filing",error:null});
    let folders=knownFolders||customFoldersRef.current;
    if(it.newFolder&&!DOC_CATEGORIES.includes(it.category)&&!folders.includes(it.category)){
      const v=validateFolderName(it.category,folders);
      if(!v.ok){patch(id,{status:"ready",error:v.reason});return false;}
      const{error}=await sb.from("document_folders").insert({family_id:familyId,name:v.name});
      if(error&&!/duplicate key/i.test(error.message)){patch(id,{status:"ready",error:error.message});return false;}
      folders=await loadFolders();
    }
    const link=it.useLink&&it.suggestion&&it.suggestion.link?it.suggestion.link:null;
    const err=await fileChrisDocument({familyId,file:it.file,name:it.name,category:it.category,description:it.description,extractedText:it.text,link});
    if(err){patch(id,{status:"ready",error:err});return false;}
    patch(id,{status:"filed"});
    return folders;
  };
  const fileSingle=async id=>{const ok=await fileOne(id);if(ok){toast("Filed in CHRIS");if(onFiled)onFiled();}};
  const readyItems=items.filter(it=>it.status==="ready");
  const fileAllReady=async()=>{
    setFilingAll(true);
    let n=0,folders=customFoldersRef.current;
    for(const it of readyItems){
      const r=await fileOne(it.id,folders);
      if(r){n++;folders=r;}
    }
    setFilingAll(false);
    if(n){toast(`Filed ${n} document${n===1?"":"s"} in CHRIS`);if(onFiled)onFiled();}
  };

  const pill=(label,active,onClick,opts={})=><button key={label+(opts.k||"")} type="button" onClick={onClick}
    style={{minHeight:36,padding:"6px 12px",borderRadius:18,fontSize:12.5,fontFamily:"inherit",fontWeight:active?700:600,cursor:"pointer",
      border:`1px solid ${active?B.navy:opts.dashed?B.gold:B.border}`,borderStyle:opts.dashed&&!active?"dashed":"solid",
      background:active?B.navy:B.white,color:active?B.white:B.navy,textAlign:"left"}}>{label}</button>;
  const bigBtn={flex:"1 1 160px",minHeight:56,display:"flex",alignItems:"center",justifyContent:"center",gap:8,borderRadius:12,
    fontSize:14.5,fontWeight:700,fontFamily:"inherit",cursor:"pointer"};

  return <div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
      <button type="button" onClick={()=>cameraRef.current&&cameraRef.current.click()}
        style={{...bigBtn,background:B.navy,color:B.white,border:"none"}}><span style={{fontSize:20}}>📷</span>Take a photo</button>
      <button type="button" onClick={()=>filesRef.current&&filesRef.current.click()}
        style={{...bigBtn,background:B.white,color:B.navy,border:`1.5px solid ${B.navy}`}}><span style={{fontSize:18}}>📄</span>Choose files</button>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{display:"none"}}
        onChange={e=>{addFiles(e.target.files);e.target.value="";}}/>
      <input ref={filesRef} type="file" multiple accept={[...DOC_UPLOAD_EXTS.map(x=>"."+x),"image/*"].join(",")} style={{display:"none"}}
        onChange={e=>{addFiles(e.target.files);e.target.value="";}}/>
    </div>
    {!items.length&&<div style={{fontSize:12.5,color:B.textSoft,lineHeight:1.6,background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"12px 14px"}}>
      Snap a page, or pick as many PDFs and photos as you like. CHRIS reads each one and suggests a name and a folder.
      You check each suggestion and tap <strong style={{color:B.navy}}>File it</strong>. Nothing is saved until you do.
    </div>}
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {items.map(it=>{
        const sug=it.suggestion,busy=it.status==="queued"||it.status==="reading";
        if(it.status==="filed")return <div key={it.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:10,
          background:"#eef7f0",border:"1px solid #cfe6d5",fontSize:13,color:B.text}}>
          <span style={{color:"#2e7d4f",fontWeight:700}}>✓</span>
          <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><strong>{it.name}</strong> · filed in {it.category}{it.useLink&&sug&&sug.link?` · linked to ${sug.link.label}`:""}</span>
        </div>;
        const opts=(sug&&sug.options)||[];
        const offered=new Set(opts.map(o=>o.folder||o.newFolder));
        return <div key={it.id} style={{border:`1px solid ${B.borderLight}`,borderRadius:12,padding:14,background:B.white,boxShadow:B.shadow}}>
          <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
            <div style={{width:56,height:72,flexShrink:0,borderRadius:6,overflow:"hidden",background:B.bg,border:`1px solid ${B.borderLight}`,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:10.5,fontWeight:700,color:B.textMute}}>
              {it.thumb?<img src={it.thumb} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:(isPdfFile(it.file)?"PDF":"FILE")}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,color:B.textMute,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.file.name}</div>
              <Inp maxLength={150} value={it.name} disabled={it.status==="filing"} aria-label="Document name"
                onChange={e=>patch(it.id,{name:e.target.value,nameTouched:true})} style={{marginTop:4,fontWeight:600}}/>
              {busy&&<div style={{fontSize:12,color:B.gold,fontWeight:600,marginTop:6}}>{it.phase||"Reading…"}</div>}
              {!busy&&sug&&sug.summary&&<div style={{fontSize:12.5,color:B.textMid,marginTop:6,lineHeight:1.5}}>{sug.summary}</div>}
              {!busy&&!sug&&<div style={{fontSize:12,color:B.textMute,marginTop:6}}>CHRIS couldn't read this one. Choose a folder below.</div>}
            </div>
          </div>
          {!busy&&<div style={{marginTop:12}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:B.textMute,marginBottom:6}}>
              {sug&&opts.length?CONFIDENCE_WORDS[sug.confidence]||CONFIDENCE_WORDS.low:"Folder"}
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {opts.map((o,i)=>o.newFolder
                ?pill(`+ New folder: ${o.newFolder}`,it.newFolder&&it.category===o.newFolder,()=>chooseFolder(it.id,o.newFolder,true),{dashed:true,k:i})
                :pill(o.folder,!it.newFolder&&it.category===o.folder,()=>chooseFolder(it.id,o.folder,false),{k:i}))}
              {!offered.has(it.category)&&pill(it.category,true,()=>{},{k:"cur"})}
            </div>
            {opts.length>1&&opts.some(o=>o.why)&&<div style={{fontSize:11.5,color:B.textMute,marginTop:6}}>
              {opts.filter(o=>o.why).map(o=>`${o.folder||o.newFolder}: ${o.why}`).join(" · ")}</div>}
            {opts.some(o=>o.newFolder)&&<div style={{fontSize:11.5,color:B.textMute,marginTop:4}}>
              None of your folders fit this. Tap the new folder to create it when you file.</div>}
            {it.newFolder&&!opts.some(o=>o.newFolder===it.category)&&<div style={{fontSize:11.5,color:B.textMute,marginTop:4}}>
              "{it.category}" is a new folder. It's created when you file this.</div>}
            <div style={{display:"flex",gap:8,alignItems:"center",marginTop:10,flexWrap:"wrap"}}>
              <Sel aria-label="Choose another folder" value={allFolders.includes(it.category)?it.category:""} disabled={it.status==="filing"}
                onChange={e=>{const v=e.target.value;if(v==="__new__")patch(it.id,{typedFolder:"",error:null});else if(v)chooseFolder(it.id,v,false);}} style={{flex:"1 1 180px",minHeight:40}}>
                <option value="">Choose another folder…</option>
                {allFolders.map(f=><option key={f} value={f}>{f}</option>)}
                <option value="__new__">+ New folder…</option>
              </Sel>
            </div>
            {it.typedFolder!==null&&it.typedFolder!==undefined&&<div style={{display:"flex",gap:8,alignItems:"center",marginTop:8,flexWrap:"wrap"}}>
              <Inp autoFocus maxLength={40} placeholder="Name the new folder, e.g. Aircraft" aria-label="New folder name" value={it.typedFolder}
                onChange={e=>patch(it.id,{typedFolder:e.target.value})} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();useTypedFolder(it.id);}}}
                style={{flex:"1 1 180px",minHeight:40}}/>
              <Btn small onClick={()=>useTypedFolder(it.id)} disabled={!String(it.typedFolder).trim()}>Use it</Btn>
              <Btn small variant="ghost" onClick={()=>patch(it.id,{typedFolder:null,error:null})}>Cancel</Btn>
            </div>}
            {sug&&sug.link&&<label style={{display:"flex",alignItems:"flex-start",gap:9,marginTop:10,padding:"9px 11px",borderRadius:8,cursor:"pointer",
              background:it.useLink?"rgba(206,182,132,0.14)":B.bg,border:`1px solid ${it.useLink?B.gold:B.borderLight}`}}>
              <input type="checkbox" checked={!!it.useLink} disabled={it.status==="filing"} onChange={e=>patch(it.id,{useLink:e.target.checked})} style={{marginTop:2,width:16,height:16,accentColor:B.navy}}/>
              <span style={{fontSize:12.5,color:B.text,lineHeight:1.45}}>
                <strong style={{color:B.navy}}>Link to {linkLabel(sug.link)}</strong>
                {sug.link.why&&<span style={{display:"block",fontSize:11.5,color:B.textMute}}>{sug.link.why}</span>}
              </span>
            </label>}
            {it.error&&<div style={{fontSize:12,color:"#b3261e",marginTop:8}}>{it.error}</div>}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:12}}>
              <Btn variant="ghost" onClick={()=>removeItem(it.id)} disabled={it.status==="filing"}>Remove</Btn>
              <Btn onClick={()=>fileSingle(it.id)} disabled={it.status==="filing"||filingAll||!it.name.trim()}>
                {it.status==="filing"?"Filing…":`File it in ${it.category}`}</Btn>
            </div>
          </div>}
          {busy&&<div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}>
            <Btn variant="ghost" small onClick={()=>removeItem(it.id)}>Remove</Btn></div>}
        </div>;
      })}
    </div>
    {readyItems.length>1&&<div style={{position:"sticky",bottom:0,background:B.white,paddingTop:12,marginTop:12,borderTop:`1px solid ${B.borderLight}`,
      display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
      <span style={{fontSize:12,color:B.textSoft}}>Each card files where it shows. Check them before you tap.</span>
      <Btn onClick={fileAllReady} disabled={filingAll}>{filingAll?"Filing…":`File all ${readyItems.length}`}</Btn>
    </div>}
  </div>;
}

function DocumentsView({familyId,readOnly=false,canUpload,canDelete,canScan,canEditMetadata,toast,reload,attachIntent,onAttachHandled,privateFolder=false}){
  // Backward compat: if readOnly passed, default canUpload=false canDelete=false
  // If canUpload/canDelete passed explicitly, use those
  const allowUpload=canUpload!==undefined?canUpload:!readOnly;
  const isMobile=useIsMobile();
  const allowDelete=canDelete!==undefined?canDelete:!readOnly;
  const allowScan=canScan!==undefined?canScan:allowUpload; // the manual scan buttons stay advisor-side
  // Extraction at upload is NOT the same permission. A client uploading into their
  // own CHRIS must get their document read, or CHRIS search cannot find it later —
  // and search is most valuable to exactly the self-serve households that have no
  // advisor to press a scan button for them.
  const scanOnUpload=true;
  const allowEditMeta=canEditMetadata!==undefined?canEditMetadata:allowUpload; // renaming/re-categorizing docs; partner gets upload but not this
  const[docs,setDocs]=useState([]);
  const[downloads,setDownloads]=useState([]); // document_downloads log rows, newest first
  const[loading,setLoading]=useState(true);
  const[uploading,setUploading]=useState(false);
  const[modal,setModal]=useState(null);
  const[openFolder,setOpenFolder]=useState(null); // null = folder list; else a folder name
  // Search. A household that cannot remember which folder something went in cannot
  // navigate to it, so this looks inside the documents too — and every hit explains
  // where it lives and why it matched, because a list that does not say leaves the
  // person exactly as lost as before.
  const[vaultQuery,setVaultQuery]=useState("");
  const[vaultHits,setVaultHits]=useState(null); // null = not searching
  const[searching,setSearching]=useState(false);
  useEffect(()=>{
    const q=vaultQuery.trim();
    if(q.length<2){setVaultHits(null);setSearching(false);return;}
    let cancelled=false;
    setSearching(true);
    const t=setTimeout(async()=>{
      const{data,error}=await sb.rpc("vault_search",{p_family_id:familyId,p_query:q,p_limit:60});
      if(cancelled)return;
      setSearching(false);
      if(error){toast(error.message,"error");setVaultHits([]);return;}
      setVaultHits(data||[]);
    },280);
    return()=>{cancelled=true;clearTimeout(t);};
  },[vaultQuery,familyId,toast]);
  // Folders this household has added, beyond the built-in eight. Per household by design,
  // so one client's taxonomy never shows up on another's CHRIS.
  const[customFolders,setCustomFolders]=useState([]);
  const[newFolderName,setNewFolderName]=useState("");
  const[folderErr,setFolderErr]=useState("");
  const[savingFolder,setSavingFolder]=useState(false);
  const loadFolders=useCallback(async()=>{
    if(!familyId){setCustomFolders([]);return;}
    const{data,error}=await sb.from("document_folders")
      .select("id,name,sort_order").eq("family_id",familyId).order("name");
    // A failure here must not blank CHRIS — the built-in folders still work, so fall
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

  const removeFolder=async row=>{if(!confirm("Delete this folder? This can't be undone."))return;
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
  // The Document Name field starts as the file's own name (minus the extension) so
  // nobody has to retype it. It only ever fills a blank field, or one still holding
  // the previous auto-filled name -- whatever the person typed themselves is theirs.
  const autoNameRef=useRef("");
  const autoDescRef=useRef(""); // same rule for the description CHRIS fills in from its summary
  const[uploadPhase,setUploadPhase]=useState("");
  // What the read suggested, and why. Held separately from `category` so the
  // person's own choice always wins and is never silently overwritten.
  const[suggestion,setSuggestion]=useState(null); // {folder, newFolder, why, confidence}
  const[creatingSuggested,setCreatingSuggested]=useState(false);
  const[suggestedLink,setSuggestedLink]=useState(null); // {kind,id,label,section,why} from the read
  // "+ New folder…" picked in the upload form's Category list: the name being typed.
  const[typedCategory,setTypedCategory]=useState(null);
  const[typedCategoryErr,setTypedCategoryErr]=useState("");
  // Text pulled from the file as soon as it's picked, and whether that read is
  // still in flight. This used to run only inside upload() -- after the file
  // was already in storage -- so the suggestion was computed and the document
  // saved under whatever category was already selected in the same breath,
  // with the modal closing before anyone could see or act on it. Reading the
  // file at selection time instead gives the suggestion a chance to actually
  // show up and be reviewed before Upload is ever clickable.
  const[extractedText,setExtractedText]=useState(null);
  const[extracting,setExtracting]=useState(false);
  // Optional link to a property section / valuables schedule.
  const[linkPropertyId,setLinkPropertyId]=useState("");
  const[linkValuableId,setLinkValuableId]=useState("");
  const[linkLoanId,setLinkLoanId]=useState("");
  const[loansList,setLoansList]=useState([]);
  const[linkSection,setLinkSection]=useState("");
  const[properties,setProperties]=useState([]);
  const[valuablesList,setValuablesList]=useState([]);
  // Set when the chosen section already has a document, so we ask before
  // displacing it rather than silently swapping what the client sees.
  const[conflictDoc,setConflictDoc]=useState(null);

  // The client's own Private folder: files only they can see (the database hides them from everyone else).
  // Kept apart from the ordinary folders, and never read by AI.
  const PRIVATE_KEY="__private__";
  const[privateDocs,setPrivateDocs]=useState([]);
  const[myId,setMyId]=useState(null);
  useEffect(()=>{if(privateFolder)sb.auth.getUser().then(({data})=>setMyId(data?.user?.id||null));},[privateFolder]);
  const[privName,setPrivName]=useState("");
  const[privFile,setPrivFile]=useState(null);
  const[privBusy,setPrivBusy]=useState(false);
  const uploadPrivate=async()=>{
    if(!privFile||!privName.trim()||!myId||!familyId)return;
    const problem=docFileProblem(privFile);if(problem){toast(problem,"error");return;}
    setPrivBusy(true);
    try{
      const ext=(privFile.name.split(".").pop()||"").toLowerCase();
      const path=`${familyId}/private/${myId}/${Date.now()}_${privFile.name.replace(/[^A-Za-z0-9._-]+/g,"_")}`;
      const{error:upErr}=await sb.storage.from("documents").upload(path,privFile,{upsert:false});
      if(upErr)throw new Error(upErr.message);
      const{error:dbErr}=await sb.from("documents").insert({family_id:familyId,name:privName.trim(),category:"Private",file_path:path,
        file_size:privFile.size,file_type:privFile.type||ext,extracted_text:null,uploaded_by:CURRENT_USER_LABEL||null,private_owner_id:myId});
      if(dbErr){await sb.storage.from("documents").remove([path]).catch(()=>{});throw new Error(dbErr.message);}
      toast("Saved to your Private folder");setModal(null);setPrivName("");setPrivFile(null);loadDocs();
    }catch(e){toast(e.message||"Upload failed","error");}
    finally{setPrivBusy(false);}
  };
  const loadDocs=async()=>{
    const q=sb.from("documents").select("*").order("created_at",{ascending:false});
    if(familyId) q.eq("family_id",familyId);
    const dq=sb.from("document_downloads").select("*").order("downloaded_at",{ascending:false});
    if(familyId) dq.eq("family_id",familyId);
    const[{data},{data:dlData}]=await Promise.all([q,dq]);
    if(data){const all=data.map(toClient);setDocs(all.filter(d=>!d.privateOwnerId));setPrivateDocs(all.filter(d=>d.privateOwnerId));}
    if(dlData)setDownloads(dlData.map(toClient));
    setLoading(false);
  };
  useEffect(()=>{loadDocs();},[familyId]);
  // Property list for the link picker. Only meaningful within one family.
  useEffect(()=>{
    if(!familyId){setProperties([]);return;}
    sb.from("properties").select("id,name,address,city").eq("family_id",familyId)
      .then(({data})=>setProperties((data||[]).map(toClient)));
    sb.from("valuables").select("id,description,category").eq("family_id",familyId).order("description")
      .then(({data})=>setValuablesList((data||[]).map(toClient)));
    sb.from("loans").select("id,name,lender,loan_type").eq("family_id",familyId).order("created_at")
      .then(({data})=>setLoansList((data||[]).map(toClient)));
  },[familyId]);

  // Arriving from the paperclip on a property section: open the upload form with
  // the property and section already chosen.
  useEffect(()=>{
    if(!attachIntent)return;
    const sec=DOC_SECTIONS.find(x=>x.key===attachIntent.section);
    setLinkSection(attachIntent.section||"");
    setLinkPropertyId(sec&&sec.scope==="property"?(attachIntent.propertyId||""):"");
    setLinkValuableId(sec&&sec.scope==="valuable"?(attachIntent.valuableId||""):"");
    setLinkLoanId(sec&&sec.scope==="loan"?(attachIntent.loanId||""):"");
    if(sec&&sec.suggestCategory)setCategory(sec.suggestCategory);
    setOpenFolder(null);
    setModal("upload");
    if(onAttachHandled)onAttachHandled();
  },[attachIntent]);

  const propLabel=p=>p.name||[p.address,p.city].filter(Boolean).join(", ")||"Property";
  // The document currently occupying a given section, ignoring the one being edited.
  const occupantOf=(section,propertyId,exceptId,valuableId,loanId)=>docs.find(d=>
    d.propertySection===section&&
    (section==="valuables_schedule"?true:section==="valuable_policy"?d.valuableId===valuableId:section==="loan_statement"?d.loanId===loanId:d.propertyId===propertyId)&&
    d.id!==exceptId);
  const valuableLabel=v=>v.description||v.category||"Valuable";
  // The record a section links to: a property, a valuable, or (family scope) neither.
  const linkTargets=section=>{
    const sc=DOC_SECTIONS.find(x=>x.key===section)?.scope;
    return{propId:sc==="property"?(linkPropertyId||null):null,valId:sc==="valuable"?(linkValuableId||null):null,loanId:sc==="loan"?(linkLoanId||null):null};
  };
  const linkProblem=()=>{
    const sc=DOC_SECTIONS.find(x=>x.key===linkSection)?.scope;
    if(sc==="property"&&!linkPropertyId)return "Choose a property to complete the link, or set Section back to \"Not linked\".";
    if(sc==="valuable"&&!linkValuableId)return "Choose a valuable to complete the link, or set Section back to \"Not linked\".";
    if(sc==="loan"&&!linkLoanId)return "Choose a loan to complete the link, or set Section back to \"Not linked\".";
    return null;
  };
  // Selecting a section implies a CHRIS folder; only pre-fill it if the user
  // hasn't deliberately chosen one already.
  const chooseSection=(key,touchedCategory)=>{
    setLinkSection(key);
    const s=DOC_SECTIONS.find(x=>x.key===key);
    if(s&&s.suggestCategory&&!touchedCategory)setCategory(s.suggestCategory);
    if(s&&s.scope!=="property")setLinkPropertyId("");
    if(s&&s.scope!=="valuable")setLinkValuableId("");
    if(s&&s.scope!=="loan")setLinkLoanId("");
  };
  const resetForm=()=>{
    setName("");setDescription("");setCategory("General");setFile(null);autoNameRef.current="";autoDescRef.current="";
    setLinkPropertyId("");setLinkValuableId("");setLinkLoanId("");setLinkSection("");setConflictDoc(null);
    setSuggestion(null);setExtractedText(null);setExtracting(false);setCreatingSuggested(false);setSuggestedLink(null);
    setTypedCategory(null);setTypedCategoryErr("");
  };
  // Most recent download of a given document, if any (downloads is pre-sorted newest first).
  const lastDownloadFor=docId=>downloads.find(d=>d.documentId===docId)||null;

  // Usually there's one clear answer and this is a single-line nudge. Occasionally
  // a document genuinely fits more than one of the household's folders about
  // equally well (an NDA tied to a specific property deal, say) -- forcing a
  // single auto-pick there would just be a guess dressed up as an answer, so
  // instead this hands the actual choice to the person, each option with its own
  // reason, and nothing is filed until they pick one.
  const SuggestionPanel=()=>{
    if(!suggestion||!suggestion.options||!suggestion.options.length)return null;
    const applyExisting=folder=>{setCategory(folder);setSuggestion(null);};
    const applyNew=async newFolder=>{
      setCreatingSuggested(true);
      const{error}=await sb.from("document_folders").insert({family_id:familyId,name:newFolder});
      setCreatingSuggested(false);
      if(error&&!/duplicate key/i.test(error.message)){toast(error.message,"error");return;}
      await loadFolders();
      setCategory(newFolder);
      setSuggestion(null);
      toast(`Created "${newFolder}"`);
    };
    if(suggestion.options.length===1){
      const o=suggestion.options[0];
      if(!(o.newFolder||o.folder!==category))return null;
      return <div style={{margin:"-6px 0 12px",padding:"10px 12px",background:"rgba(206,182,132,0.12)",
        borderLeft:`2px solid ${B.gold}`,borderRadius:6,fontSize:12.5,color:B.textMid,lineHeight:1.5}}>
        {o.newFolder?<>
          <strong style={{color:B.navy}}>Nothing here fits this. A "{o.newFolder}" folder would.</strong>
          {o.why?` ${o.why}`:""}
          <button disabled={creatingSuggested} onClick={()=>applyNew(o.newFolder)}
            style={{marginLeft:8,background:"none",border:"none",color:B.navyMid,
              cursor:creatingSuggested?"default":"pointer",fontSize:12.5,fontFamily:"inherit",
              fontWeight:700,padding:0,textDecoration:"underline"}}>
            {creatingSuggested?"Creating…":"Create it and file this here"}</button>
        </>:<>
          <strong style={{color:B.navy}}>Reading it, this looks like {o.folder}.</strong>
          {o.why?` ${o.why}`:""}
          <button onClick={()=>applyExisting(o.folder)}
            style={{marginLeft:8,background:"none",border:"none",color:B.navyMid,cursor:"pointer",
              fontSize:12.5,fontFamily:"inherit",fontWeight:700,padding:0,textDecoration:"underline"}}>
            File it there</button>
        </>}
      </div>;
    }
    return <div style={{margin:"-6px 0 14px",padding:"14px 14px 10px",background:"rgba(206,182,132,0.10)",
      border:`1px solid ${B.gold}`,borderRadius:10}}>
      <div style={{fontSize:12.5,fontWeight:700,color:B.navy,marginBottom:2}}>This could file in more than one place</div>
      <div style={{fontSize:11.5,color:B.textMute,marginBottom:10}}>Reading it, here's what fits — pick one, or choose a different folder below.</div>
      <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:4}}>
        {suggestion.options.map((o,i)=>(
          <button key={o.folder||o.newFolder||i} disabled={creatingSuggested}
            onClick={()=>o.newFolder?applyNew(o.newFolder):applyExisting(o.folder)}
            style={{textAlign:"left",background:B.white,border:`1px solid ${B.border}`,borderRadius:8,
              padding:"9px 11px",cursor:creatingSuggested?"default":"pointer",fontFamily:"inherit"}}>
            <div style={{fontSize:12.5,fontWeight:700,color:B.navy}}>
              {o.newFolder?`Create "${o.newFolder}"`:o.folder}
            </div>
            {o.why&&<div style={{fontSize:11.5,color:B.textMute,marginTop:1}}>{o.why}</div>}
          </button>
        ))}
      </div>
      <button onClick={()=>setSuggestion(null)} style={{background:"none",border:"none",color:B.textMute,
        cursor:"pointer",fontSize:11,fontFamily:"inherit",padding:"2px 0",textDecoration:"underline"}}>
        I'll choose a folder myself</button>
    </div>;
  };

  // Reads a newly-picked file and asks where it belongs, before a single byte
  // has been uploaded. Non-fatal at every step: a failed read or a failed
  // suggestion must never block picking the file or uploading it plain.
  const pickFile=async f=>{
    setFile(f||null);
    setSuggestion(null);setExtractedText(null);setSuggestedLink(null);
    // A summary CHRIS wrote for the previous file doesn't describe this one.
    if(autoDescRef.current){const prevDesc=autoDescRef.current;setDescription(prev=>prev===prevDesc?"":prev);autoDescRef.current="";}
    if(f&&f.name){
      const base=f.name.replace(/\.[^./\\]+$/,"").trim();
      const prevAuto=autoNameRef.current;
      if(base){
        setName(prev=>(!prev.trim()||prev===prevAuto)?base:prev);
        autoNameRef.current=base;
      }
    }
    if(!f||!scanOnUpload)return;
    if(!isPdfFile(f)&&!isReadableImage(f))return; // Word/Excel/etc. still upload fine, just without a suggestion
    setExtracting(true);
    let text=null;
    try{
      // Digital PDFs are read in the browser; scanned PDFs and photos (resized
      // first, so a full-size phone photo isn't refused) go to the reader.
      text=await readDocumentForFiling(f,setUploadPhase);
      setExtractedText(text);
      // What did we just read? Ask once, cheaply, and only to SUGGEST.
      if(text&&text.length>80){
        try{
          setUploadPhase("Working out where this belongs…");
          // The file's own name, never the Name field: that can still hold the
          // previous document's title, and the reader would blend the two.
          const sug=await suggestFolder(text,f.name,
            [...DOC_CATEGORIES,...customFolders.map(x=>x.name)],linkTargetsFor(properties,valuablesList));
          if(sug&&sug.options&&sug.options.length)setSuggestion(sug);
          // Only offered when the person hasn't already chosen a link (e.g. arriving from a 📎).
          if(sug&&sug.link&&!linkSection)setSuggestedLink(sug.link);
          // The proposed title replaces only the auto-filled file name ("IMG_4821"),
          // never something the person typed; the summary likewise.
          if(sug&&sug.suggestedName){
            const prevAuto=autoNameRef.current;
            setName(prev=>(!prev.trim()||prev===prevAuto)?sug.suggestedName:prev);
            autoNameRef.current=sug.suggestedName;
          }
          if(sug&&sug.summary){
            const prevDesc=autoDescRef.current;
            setDescription(prev=>(!prev.trim()||prev===prevDesc)?sug.summary:prev);
            autoDescRef.current=sug.summary;
          }
        }catch(_e){/* a failed suggestion must never block an upload */}
      }
    } finally {
      setUploadPhase("");
      setExtracting(false);
    }
  };

  const upload=async()=>{
    if(!file||!name.trim()||extracting)return;
    const fileProblem=docFileProblem(file);
    if(fileProblem){toast(fileProblem,"error");return;}
    {const lp=linkProblem();if(lp){toast(lp,"error");return;}}
    setUploading(true);
    try{
      // Upload file to Supabase storage
      const ext=file.name.split(".").pop();
      const path=`${familyId||"general"}/${Date.now()}_${file.name.replace(/[^A-Za-z0-9._-]+/g,"_")}`;
      setUploadPhase("Uploading…");
      const{error:uploadError}=await sb.storage.from("documents").upload(path,file,{upsert:false});
      if(uploadError)throw new Error(uploadError.message);
      // Text was already pulled when the file was picked, above in pickFile --
      // that's also what gave the suggestion banner a chance to show before
      // this ever ran.

      // Save record
      setUploadPhase("Saving…");
      // Displacing an existing section document: unlink it rather than delete it.
      // Prior-year tax bills and expired policies still have real value, so they
      // stay in CHRIS — they just stop being the one shown on the card.
      const section=linkSection||null;
      const{propId,valId,loanId}=section?linkTargets(section):{propId:null,valId:null,loanId:null};
      let displaced=null;
      if(section){
        const occ=occupantOf(section,propId,undefined,valId,loanId);
        if(occ){
          await sb.from("documents").update({property_section:null}).eq("id",occ.id);
          displaced=occ.name;
        }
      }
      const{error:dbError}=await sb.from("documents").insert({family_id:familyId||null,name,description:description||null,category,file_path:path,file_size:file.size,file_type:file.type||ext,extracted_text:extractedText,uploaded_by:CURRENT_USER_LABEL||null,property_id:propId,valuable_id:valId,loan_id:loanId,property_section:section});
      if(dbError)throw new Error(dbError.message);
      toast(displaced
        ?`Uploaded and linked. "${displaced}" is still in CHRIS, no longer linked.`
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
      if(!await firmDocGate(doc.filePath,doc.name,"download_document")){toast(FIRM_GATE_MSG,"error");return;}
      const{data,error}=await sb.storage.from("documents").createSignedUrl(doc.filePath,300,{download:docDownloadName(doc)});
      if(error||!data?.signedUrl){toast("Could not get download link","error");return;}
      // Use anchor element to bypass popup blockers
      const a=document.createElement("a");
      a.href=data.signedUrl;
      a.download=docDownloadName(doc);
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

  const del=async(doc)=>{if(!confirm("Delete this document? The file is removed permanently."))return;
    // Record first, file second, and both checked. The file used to go first with neither result looked at,
    // so a refused delete still said "Document deleted" and left a record pointing at a file that was gone.
    const{error:rowErr}=await sb.from("documents").delete().eq("id",doc.id);
    if(rowErr){toast(rowErr.message||"Could not delete the document.","error");return;}
    if(doc.filePath){
      const{error:fileErr}=await sb.storage.from("documents").remove([doc.filePath]);
      if(fileErr)console.error("document file not removed",doc.filePath,fileErr.message);
    }
    toast("Document deleted");loadDocs();
    if(reload)reload("documents");
  };

  const openEdit=doc=>{setName(doc.name||"");setDescription(doc.description||"");setCategory(doc.category||"General");setLinkSection(doc.propertySection||"");setLinkPropertyId(doc.propertyId||"");setLinkValuableId(doc.valuableId||"");setLinkLoanId(doc.loanId||"");setConflictDoc(null);setSuggestion(null);setExtractedText(null);setModal({edit:doc});};
  const saveEdit=async()=>{
    const doc=modal?.edit;if(!doc||!name.trim())return;
    {const lp=linkProblem();if(lp){toast(lp,"error");return;}}
    setUploading(true);
    const section=linkSection||null;
    const{propId,valId,loanId}=section?linkTargets(section):{propId:null,valId:null,loanId:null};
    // Same rule as upload: the document being displaced is unlinked, never
    // deleted, so history stays in CHRIS.
    let displaced=null;
    if(section){
      const occ=occupantOf(section,propId,doc.id,valId,loanId);
      if(occ){
        await sb.from("documents").update({property_section:null}).eq("id",occ.id);
        displaced=occ.name;
      }
    }
    const{error}=await sb.from("documents").update({name:name.trim(),description:description||null,category,property_id:propId,valuable_id:valId,loan_id:loanId,property_section:section}).eq("id",doc.id);
    if(error){toast(error.message,"error");setUploading(false);return;}
    toast(displaced?`Saved. "${displaced}" is still in CHRIS, no longer linked.`:"Document updated");
    setModal(null);resetForm();
    loadDocs();setUploading(false);
    if(reload)reload("documents"); // property cards read links from global data
  };

  // Shared by the upload and edit forms: optionally pin this document to one
  // section of a property (or the family's valuables schedule) so it surfaces
  // next to the figure it supports, instead of only living in CHRIS.
  const linkFields=(exceptId)=>{
    if(!familyId)return null;
    const sec=DOC_SECTIONS.find(s=>s.key===linkSection);
    const needsProperty=sec&&sec.scope==="property";
    const needsValuable=sec&&sec.scope==="valuable";
    const needsLoan=sec&&sec.scope==="loan";
    const occ=linkSection&&(!needsProperty||linkPropertyId)&&(!needsValuable||linkValuableId)&&(!needsLoan||linkLoanId)
      ?occupantOf(linkSection,needsProperty?linkPropertyId:null,exceptId,needsValuable?linkValuableId:null,needsLoan?linkLoanId:null):null;
    return <>
      <SectionLabel>Link to a record (optional)</SectionLabel>
      <Grid2>
        <Field label="Section">
          <Sel value={linkSection} onChange={e=>chooseSection(e.target.value,category!=="General")}>
            <option value="">Not linked — CHRIS only</option>
            {DOC_SECTIONS.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
          </Sel>
        </Field>
        {needsProperty&&<Field label="Property">
          <Sel value={linkPropertyId} onChange={e=>setLinkPropertyId(e.target.value)}>
            <option value="">Select a property…</option>
            {properties.map(p=><option key={p.id} value={p.id}>{propLabel(p)}</option>)}
          </Sel>
        </Field>}
        {needsValuable&&<Field label="Valuable">
          <Sel value={linkValuableId} onChange={e=>setLinkValuableId(e.target.value)}>
            <option value="">Select a valuable…</option>
            {valuablesList.map(v=><option key={v.id} value={v.id}>{valuableLabel(v)}</option>)}
          </Sel>
        </Field>}
        {needsLoan&&<Field label="Loan or line">
          <Sel value={linkLoanId} onChange={e=>setLinkLoanId(e.target.value)}>
            <option value="">Select a loan…</option>
            {loansList.map(l=><option key={l.id} value={l.id}>{loanTitle(l)}</option>)}
          </Sel>
        </Field>}
      </Grid2>
      {needsLoan&&linkSection&&!linkLoanId&&
        <div style={{fontSize:11.5,color:"#8b1a1a",marginTop:-6,marginBottom:12}}>{loansList.length?"Choose a loan to complete the link.":"Add the loan in Loans & Lines first, then link its statement."}</div>}
      {needsValuable&&linkSection&&!linkValuableId&&
        <div style={{fontSize:11.5,color:"#8b1a1a",marginTop:-6,marginBottom:12}}>Choose a valuable to complete the link.</div>}
      {needsProperty&&linkSection&&!linkPropertyId&&
        <div style={{fontSize:11.5,color:"#8b1a1a",marginTop:-6,marginBottom:12}}>Choose a property to complete the link.</div>}
      {occ&&<div style={{fontSize:11.5,color:B.navy,background:"rgba(206,182,132,0.16)",border:`1px solid ${B.gold}`,borderRadius:8,padding:"9px 12px",marginBottom:12,lineHeight:1.5}}>
        <strong>{sectionLabel(linkSection)}</strong> is already linked to “{occ.name}”. Saving will make this document the linked one — “{occ.name}” stays in CHRIS, just unlinked.
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
  const folderCount=cat=>cat===PRIVATE_KEY?privateDocs.length:docs.filter(d=>inFolder(d,cat)).length;

  return <div style={{height:"100%",display:"flex",flexDirection:"column",minHeight:0}}>
    <style>{`.pcm-folder-card{transition:transform .15s ease, box-shadow .15s ease;}.pcm-folder-card:hover{transform:translateY(-3px);box-shadow:0 8px 22px rgba(9,43,73,0.13);}`}</style>
    <div className={isMobile?"pcm-chris-bar m":"pcm-chris-bar"} style={{padding:isMobile?"0 0 12px":"14px 24px",borderBottom:isMobile?"none":`1px solid ${B.borderLight}`,background:isMobile?"transparent":B.white,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
      {/* On a phone the buttons share the row evenly; the folder name, when one is open, takes its own row. */}
      {isMobile&&<style>{`.pcm-chris-bar.m>button{flex:1 1 140px;justify-content:center;}`}</style>}
      {(!isMobile||openFolder)&&<div style={{flex:1,display:"flex",alignItems:"center",gap:10,minWidth:0,flexBasis:isMobile?"100%":undefined}}>
        {openFolder&&<button onClick={()=>setOpenFolder(null)} style={{background:"none",border:`1px solid ${B.border}`,color:B.textSoft,cursor:"pointer",fontSize:13,fontFamily:"inherit",padding:"6px 10px",borderRadius:6,flexShrink:0}}>← CHRIS</button>}
        {openFolder&&<div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{openFolder===PRIVATE_KEY?"🔒 Private":openFolder}</div>}
        {openFolder&&<span style={{fontSize:12,color:B.textMute,flexShrink:0}}>{folderCount(openFolder)} file{folderCount(openFolder)!==1?"s":""}</span>}
        {openFolder&&customFolders.some(f=>f.name===openFolder)&&folderCount(openFolder)===0&&
          <button onClick={()=>removeFolder({name:openFolder,custom:true,count:0})}
            style={{background:"none",border:`1px solid ${B.borderLight}`,color:B.textSoft,cursor:"pointer",
              fontSize:11.5,fontFamily:"inherit",padding:"4px 9px",borderRadius:6,flexShrink:0}}>
            Remove folder</button>}
      </div>}
      {allowUpload&&familyId&&openFolder!==PRIVATE_KEY&&<Btn variant="ghost" onClick={()=>setModal("batch")}>{isMobile?"📷 Snap or add":"📷 Snap or add several"}</Btn>}
      {allowUpload&&openFolder!==PRIVATE_KEY&&<Btn onClick={()=>{setCategory(openFolder||"General");setModal("upload");}}>{isMobile?"⬆ Upload":"⬆ Upload Document"}</Btn>}
      {privateFolder&&openFolder===PRIVATE_KEY&&<Btn onClick={()=>{setPrivName("");setPrivFile(null);setModal("privateUpload");}}>🔒 Upload to Private</Btn>}
      {allowScan&&unscannedCount>0&&<Btn variant="ghost" onClick={scanAllUnscanned} disabled={!!bulkScan} title="Extract text from existing documents so the AI assistant can read them">{bulkScan?`Scanning ${bulkScan.done}/${bulkScan.total}${scanMsg?" · "+scanMsg:""}…`:`✦ Scan ${unscannedCount} for AI`}</Btn>}
    </div>
    <div style={{flex:1,overflowY:"auto",padding:isMobile?"4px 0 96px":"20px 24px"}}>
      <div style={{position:"relative",marginBottom:16}}>
        <input type="text" value={vaultQuery} onChange={e=>setVaultQuery(e.target.value)}
          placeholder={isMobile?"Search CHRIS: a word, a name…":"Search CHRIS — a word from the document, a name, anything you remember"}
          style={{width:"100%",boxSizing:"border-box",padding:"11px 36px 11px 14px",fontSize:13.5,
            fontFamily:"inherit",color:B.text,border:`1px solid ${B.border}`,borderRadius:8,background:B.white}}/>
        {vaultQuery&&<button onClick={()=>setVaultQuery("")} aria-label="Clear search"
          style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",
            border:"none",color:B.textMute,cursor:"pointer",fontSize:16,lineHeight:1}}>×</button>}
      </div>
      {vaultHits!==null?<VaultSearchResults hits={vaultHits} searching={searching} query={vaultQuery}
        onDownload={download} onClear={()=>setVaultQuery("")}/>:
      loading?<Spinner/>:openFolder===null?
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
          {privateFolder&&<button onClick={()=>setOpenFolder(PRIVATE_KEY)} style={{width:"100%",textAlign:"left",display:"flex",alignItems:"center",gap:12,
            background:"#fbf8f1",border:`1px solid ${B.gold}`,borderRadius:12,padding:"14px 16px",marginBottom:16,cursor:"pointer",fontFamily:"inherit"}}>
            <span style={{fontSize:22}}>🔒</span>
            <span style={{flex:1,minWidth:0}}>
              <span style={{display:"block",fontSize:15,fontWeight:700,color:B.navy}}>Private</span>
              <span style={{display:"block",fontSize:12,color:B.textSoft,marginTop:2}}>Only you can see these files. Not your household's other logins, not ORDANIS, not your firm. No AI reads them.</span>
            </span>
            <span style={{fontSize:12,color:B.textMute,whiteSpace:"nowrap"}}>{privateDocs.length} file{privateDocs.length===1?"":"s"}</span>
          </button>}
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:14}}>
            <div style={{fontSize:13,color:B.textSoft}}>
              {sum.total} document{sum.total===1?"":"s"}
              {/* Called out separately because "Other" holding nearly half of CHRIS is the
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
          {filled.map(r=>{
            const label=<>
              <span style={{fontSize:14,color:B.navy}}>{r.name}</span>
              {r.name==="Other"&&<span style={{fontSize:11.5,color:"#8a5c00",marginLeft:8}}>needs filing</span>}
              {r.expired>0&&<span style={{fontSize:11.5,color:"#8b1a1a",marginLeft:8}}>{r.expired} expired</span>}
              {r.expiring>0&&<span style={{fontSize:11.5,color:"#8a5c00",marginLeft:8}}>{r.expiring} expiring</span>}
              {r.custom&&<span style={{fontSize:10.5,color:B.textMute,marginLeft:8,border:`1px solid ${B.borderLight}`,borderRadius:4,padding:"1px 5px",whiteSpace:"nowrap"}}>added</span>}
            </>;
            const bar=<div style={{flex:isMobile?1:"none",width:isMobile?"auto":110,height:4,background:B.bg,borderRadius:2,overflow:"hidden",flexShrink:0}}>
              <div style={{width:`${Math.round(r.share*100)}%`,height:"100%",
                background:(r.name==="Other"||r.expiring>0||r.expired>0)?"#d4900a":B.gold}}/>
            </div>;
            const count=<div style={{fontSize:13,color:B.textSoft,textAlign:"right",flexShrink:0,whiteSpace:"nowrap",width:isMobile?"auto":56}}>{r.count} file{r.count===1?"":"s"}</div>;
            const date=<div style={{fontSize:11.5,color:B.textMute,textAlign:"right",flexShrink:0,whiteSpace:"nowrap",width:isMobile?"auto":64}}>{fmtDate(r.lastAt)}</div>;
            const rowProps={role:"button",tabIndex:0,onClick:()=>setOpenFolder(r.name),
              onKeyDown:e=>{if(e.key==="Enter"||e.key===" ")setOpenFolder(r.name);}};
            // On a phone the four columns don't fit side by side, so each folder is two lines:
            // name and count, then the bar and the last-updated date.
            return isMobile
              ?<div key={r.name} {...rowProps} style={{padding:"12px 4px",cursor:"pointer",borderBottom:`1px solid ${B.borderLight}`}}>
                <div style={{display:"flex",alignItems:"baseline",gap:12}}><div style={{flex:1,minWidth:0,lineHeight:1.5}}>{label}</div>{count}</div>
                <div style={{display:"flex",alignItems:"center",gap:12,marginTop:6}}>{bar}{date}</div>
              </div>
              :<div key={r.name} {...rowProps} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 4px",cursor:"pointer",borderBottom:`1px solid ${B.borderLight}`}}>
                <div style={{flex:1,minWidth:0}}>{label}</div>{bar}{count}{date}
              </div>;
          })}
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
        const list=openFolder===PRIVATE_KEY?privateDocs:docs.filter(d=>inFolder(d,openFolder));
        return list.length===0
          ? <div style={{padding:"60px 0",textAlign:"center",color:B.textMute}}><div style={{fontSize:40,marginBottom:12}}>📁</div>No documents in this folder yet.</div>
          : <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {list.map(doc=>{
                const dl=lastDownloadFor(doc.id);
                return <div key={doc.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:18,boxShadow:B.shadow}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
                    <div style={{display:"flex",gap:12,alignItems:"flex-start",minWidth:0}}>
                      <div style={{flexShrink:0,width:46,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                        <BrandMark size={40}/>
                        <span style={{fontSize:8.5,fontWeight:800,letterSpacing:"0.06em",color:B.navyMid,background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:4,padding:"1px 5px",lineHeight:1.45,whiteSpace:"nowrap"}}>{fileLabel(doc.fileType,doc.name)}</span>
                      </div>
                      <div style={{minWidth:0}}>
                        <div style={{fontWeight:700,color:B.navy,fontSize:15}}>{doc.name}</div>
                        {doc.description&&<div style={{fontSize:12,color:B.textSoft,marginTop:2}}>{doc.description}</div>}
                        {/* Makes it obvious which CHRIS files are the ones being
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
                    {allowEditMeta&&!doc.privateOwnerId&&<Btn small variant="ghost" onClick={()=>openEdit(doc)}>✏ Edit</Btn>}
                    {(allowDelete||(doc.privateOwnerId&&doc.privateOwnerId===myId))&&<Btn small variant="danger" onClick={()=>del(doc)}>✕</Btn>}
                  </div>
                </div>;
              })}
            </div>;
      })()}
    </div>

    {modal==="folder"&&<Modal title="New folder" onClose={()=>setModal(null)}>
      <Field label="Folder name" required>
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

    {modal==="privateUpload"&&<Modal title="Upload to Private" onClose={()=>!privBusy&&setModal(null)}>
      <div style={{fontSize:12.5,color:B.textSoft,lineHeight:1.55,marginBottom:14,background:"#fbf8f1",border:`1px solid ${B.gold}`,borderRadius:8,padding:"10px 12px"}}>
        🔒 Only you will be able to see this file: not your household's other logins, not ORDANIS staff, not your firm. CHRIS won't read it, so there are no suggestions and it isn't searchable by its contents.
      </div>
      <Field label="Name" required><Inp maxLength={150} placeholder="Passport" value={privName} onChange={e=>setPrivName(e.target.value)}/></Field>
      <Field label="File" required>
        <input id="private-camera" type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>{const f=e.target.files&&e.target.files[0];e.target.value="";if(f){setPrivFile(f);if(!privName.trim())setPrivName(f.name.replace(/\.[^./\\]+$/,""));}}}/>
        <input id="private-file" type="file" accept={[...DOC_UPLOAD_EXTS.map(x=>"."+x),"image/*"].join(",")} style={{display:"none"}} onChange={e=>{const f=e.target.files&&e.target.files[0];e.target.value="";if(f){setPrivFile(f);if(!privName.trim())setPrivName(f.name.replace(/\.[^./\\]+$/,""));}}}/>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button type="button" onClick={()=>document.getElementById("private-camera").click()} style={{flex:"1 1 140px",minHeight:46,borderRadius:10,border:"none",background:B.navy,color:B.white,fontSize:13.5,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>📷 Take a photo</button>
          <button type="button" onClick={()=>document.getElementById("private-file").click()} style={{flex:"1 1 140px",minHeight:46,borderRadius:10,border:`1.5px solid ${B.navy}`,background:B.white,color:B.navy,fontSize:13.5,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>📄 Choose file</button>
        </div>
        {privFile&&<div style={{fontSize:12.5,color:B.navy,marginTop:8}}>✓ {privFile.name} · {(privFile.size/1024/1024).toFixed(2)} MB</div>}
      </Field>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn variant="ghost" onClick={()=>setModal(null)} disabled={privBusy}>Cancel</Btn>
        <Btn onClick={uploadPrivate} disabled={privBusy||!privFile||!privName.trim()||!myId}>{privBusy?"Saving…":"Save privately"}</Btn>
      </div>
    </Modal>}

    {modal==="batch"&&<Modal wide title="Add documents to CHRIS" onClose={()=>setModal(null)}>
      <ChrisBatchFiler familyId={familyId} toast={toast} onFiled={()=>{loadDocs();loadFolders();if(reload)reload("documents");}}/>
    </Modal>}

    {modal==="upload"&&<Modal title="Upload Document" onClose={()=>{setModal(null);resetForm();}}>
      <Field label="Document Name" required><Inp maxLength={150} placeholder="Q4 2024 Statement" value={name} onChange={e=>setName(e.target.value)}/></Field>
      <Field label="Category"><Sel value={category} onChange={e=>{if(e.target.value==="__new__"){setTypedCategory("");setTypedCategoryErr("");return;}setCategory(e.target.value);setSuggestion(null);}}>{[...DOC_CATEGORIES,...customFolders.map(f=>f.name)].map(c=><option key={c}>{c}</option>)}<option value="__new__">+ New folder…</option></Sel>
        {typedCategory!==null&&<div style={{marginTop:8}}>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <Inp autoFocus maxLength={40} placeholder="Name the new folder, e.g. Aircraft" aria-label="New folder name" value={typedCategory}
              onChange={e=>{setTypedCategory(e.target.value);setTypedCategoryErr("");}} style={{flex:"1 1 180px"}}
              onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();document.getElementById("create-typed-folder")?.click();}}}/>
            <button id="create-typed-folder" type="button" disabled={creatingSuggested||!typedCategory.trim()} onClick={async()=>{
                const v=validateFolderName(typedCategory,customFolders.map(f=>f.name));
                if(!v.ok){setTypedCategoryErr(v.reason);return;}
                setCreatingSuggested(true);
                const{error}=await sb.from("document_folders").insert({family_id:familyId,name:v.name});
                setCreatingSuggested(false);
                if(error&&!/duplicate key/i.test(error.message)){setTypedCategoryErr(error.message);return;}
                await loadFolders();
                setCategory(v.name);setSuggestion(null);setTypedCategory(null);
                toast(`Created "${v.name}"`);
              }}
              style={{background:B.navy,color:B.white,border:"none",borderRadius:8,padding:"9px 14px",fontSize:13,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>
              {creatingSuggested?"Creating…":"Create"}</button>
            <button type="button" onClick={()=>{setTypedCategory(null);setTypedCategoryErr("");}}
              style={{background:"none",border:"none",color:B.textSoft,fontSize:12.5,fontFamily:"inherit",cursor:"pointer",textDecoration:"underline"}}>Cancel</button>
          </div>
          {typedCategoryErr&&<div style={{fontSize:12,color:"#b3261e",marginTop:6}}>{typedCategoryErr}</div>}
        </div>}
      </Field>
      <SuggestionPanel/>
      {suggestedLink&&<div style={{margin:"-4px 0 14px",padding:"10px 12px",background:"rgba(206,182,132,0.12)",borderLeft:`2px solid ${B.gold}`,borderRadius:6,fontSize:12.5,color:B.textMid,lineHeight:1.5}}>
        <strong style={{color:B.navy}}>This looks like it belongs on {linkLabel(suggestedLink)}.</strong>{suggestedLink.why?` ${suggestedLink.why}`:""}
        <div style={{display:"flex",gap:14,marginTop:6}}>
          <button type="button" onClick={()=>{setLinkSection(suggestedLink.section);
              if(suggestedLink.kind==="property"){setLinkPropertyId(suggestedLink.id);setLinkValuableId("");}
              else{setLinkValuableId(suggestedLink.id);setLinkPropertyId("");}
              setLinkLoanId("");
              setSuggestedLink(null);}}
            style={{background:"none",border:"none",color:B.navyMid,cursor:"pointer",fontSize:12.5,fontFamily:"inherit",fontWeight:700,padding:0,textDecoration:"underline"}}>Link it</button>
          <button type="button" onClick={()=>setSuggestedLink(null)}
            style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:12,fontFamily:"inherit",padding:0,textDecoration:"underline"}}>No thanks</button>
        </div>
      </div>}
      <Field label="Description" optional><Inp maxLength={500} placeholder="Anything that will help you find it later" value={description} onChange={e=>setDescription(e.target.value)}/></Field>
      {linkFields()}
      <Field label="File" required>
        <input id="file-camera" type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>{const f=e.target.files&&e.target.files[0];const pr=f?docFileProblem(f):null;if(pr){toast(pr,"error");e.target.value="";return;}pickFile(f);}}/>
        {!file&&<button type="button" onClick={()=>document.getElementById("file-camera").click()}
          style={{width:"100%",minHeight:50,marginBottom:10,borderRadius:10,border:"none",background:B.navy,color:B.white,
            fontSize:14.5,fontWeight:700,fontFamily:"inherit",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <span style={{fontSize:19}}>📷</span>Take a photo</button>}
        <div style={{border:`2px dashed ${file?B.gold:B.border}`,borderRadius:10,padding:"20px",textAlign:"center",cursor:"pointer",background:file?"#fef9f0":B.bg,transition:"all .2s"}} onClick={()=>document.getElementById("file-upload").click()}>
          <input id="file-upload" type="file" accept={DOC_UPLOAD_EXTS.map(e=>"."+e).join(",")} style={{display:"none"}} onChange={e=>{const f=e.target.files&&e.target.files[0];const pr=f?docFileProblem(f):null;if(pr){toast(pr,"error");e.target.value="";return;}pickFile(f);}}/>
          {file?<><div style={{fontSize:24,marginBottom:6}}>✅</div><div style={{fontSize:13,color:B.navy,fontWeight:600}}>{file.name}</div><div style={{fontSize:11,color:B.textSoft}}>{(file.size/1024/1024).toFixed(2)} MB</div>{extracting&&<div style={{fontSize:11,color:B.gold,fontWeight:600,marginTop:6}}>{uploadPhase||"Reading document…"}</div>}</>:<><div style={{fontSize:32,marginBottom:6}}>📁</div><div style={{fontSize:13,color:B.textSoft}}>Or choose a file</div><div style={{fontSize:11,color:B.textMute,marginTop:4}}>PDF, Word, Excel, images supported</div></>}
        </div>
      </Field>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
        <Btn onClick={upload} disabled={uploading||extracting||!file||!name.trim()}>{uploading?(uploadPhase||"Uploading…"):extracting?"Reading…":"Upload"}</Btn>
      </div>
    </Modal>}

    {modal&&modal.edit&&<Modal title="Edit Document" onClose={()=>{setModal(null);resetForm();}}>
      <Field label="Document Name" required><Inp maxLength={150} placeholder="Q4 2024 Statement" value={name} onChange={e=>setName(e.target.value)}/></Field>
      <Field label="Category"><Sel value={category} onChange={e=>{setCategory(e.target.value);setSuggestion(null);}}>{[...DOC_CATEGORIES,...customFolders.map(f=>f.name)].map(c=><option key={c}>{c}</option>)}</Sel></Field>
      <SuggestionPanel/>
      <Field label="Description" optional><Inp maxLength={500} placeholder="Anything that will help you find it later" value={description} onChange={e=>setDescription(e.target.value)}/></Field>
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
// ── SELF-SERVE QUICK-ADD FORMS ───────────────────────────────────────────────
// Basic/Core has no assigned Expert to enter a household's properties, portfolio accounts or
// valuables for them -- until this, ClientDashboard's Properties/Portfolio/Valuables tabs were
// read-only for the client with no add path at all (RLS already allowed the write; nothing in the
// UI offered it). These are the minimal, self-entry versions of the admin side's much longer
// forms (see addProperty/addAccount/addValuable in FamilyDashboard) -- just enough for a household
// to get its own record started; every field these skip is still editable later by an advisor/admin,
// or by the household itself once it's comfortable, in a fuller edit view.
// Each is a plain form (no <Modal> wrapper of its own) so it can render either inside a standalone
// popup modal (the tab's own "+ Add" button) or directly as a step in OnboardingWizard below --
// same fields, same save handler, two different frames around it.
// ── ADDRESS AUTOCOMPLETE (Google Places) ─────────────────────────────────────
// Feature-detects on VITE_GOOGLE_MAPS_API_KEY being configured -- with no key set (or if Google's
// script fails to load), this renders as a perfectly ordinary text input, same "quietly do nothing
// unsupported" convention as canUseContactPicker above, rather than a half-wired autocomplete that
// looks broken. Requires a Google Cloud API key with the Places API enabled and billing on, HTTP-
// referrer restricted to this app's own domains -- set as VITE_GOOGLE_MAPS_API_KEY at deploy time,
// never hardcoded here.
const GOOGLE_MAPS_API_KEY=import.meta.env.VITE_GOOGLE_MAPS_API_KEY||"";
let googleMapsLoadPromise=null;
function loadGoogleMapsPlaces(){
  if(!GOOGLE_MAPS_API_KEY)return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY not configured"));
  if(typeof window!=="undefined"&&window.google?.maps?.places)return Promise.resolve();
  if(googleMapsLoadPromise)return googleMapsLoadPromise;
  googleMapsLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places`;
    script.async=true;
    script.onload=()=>resolve();
    script.onerror=()=>reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });
  return googleMapsLoadPromise;
}
// Same value/onChange contract as <Inp>, so it drops into a Field unchanged. Renders its own
// <input> (not <Inp>, which isn't ref-forwarding) so the DOM node is available to hand to
// google.maps.places.Autocomplete once the script loads.
// Suggestions come from Places API (New) -- AutocompleteSuggestion -- drawn as our own list under our own
// input. The older Autocomplete widget used here before needs the legacy Places API, which Google stopped
// offering to new projects on 2025-03-01; on this project it failed with ApiNotActivatedMapError, and Google
// then DISABLED the input and filled it with error icons, so nobody could type an address at all
// (2026-10-20). Now any failure (no key, script blocked, API not enabled, quota) just leaves a plain text
// box: typing an address must always work, suggestions are a convenience.
function AddressInput({value,onChange,placeholder}){
  const[suggestions,setSuggestions]=useState([]);
  const[open,setOpen]=useState(false);
  const[active,setActive]=useState(-1);
  const deadRef=useRef(!GOOGLE_MAPS_API_KEY); // true once Google has failed: stop asking
  const tokenRef=useRef(null);
  const timerRef=useRef(null);
  const seqRef=useRef(0);
  useEffect(()=>()=>clearTimeout(timerRef.current),[]);
  const lookup=text=>{
    clearTimeout(timerRef.current);
    if(deadRef.current||String(text).trim().length<3){setSuggestions([]);setOpen(false);return;}
    timerRef.current=setTimeout(async()=>{
      const seq=++seqRef.current;
      try{
        await loadGoogleMapsPlaces();
        const places=window.google?.maps?.places;
        if(!places?.AutocompleteSuggestion){deadRef.current=true;return;}
        if(!tokenRef.current)tokenRef.current=new places.AutocompleteSessionToken();
        const{suggestions:found}=await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({input:text,sessionToken:tokenRef.current});
        if(seq!==seqRef.current)return; // a newer keystroke already asked
        const list=(found||[]).map(x=>x.placePrediction&&x.placePrediction.text&&x.placePrediction.text.toString()).filter(Boolean).slice(0,5);
        setSuggestions(list);setActive(-1);setOpen(list.length>0);
      }catch(_e){
        // Not enabled, blocked or over quota: stay a plain text box from here on.
        deadRef.current=true;setSuggestions([]);setOpen(false);
      }
    },250);
  };
  const choose=text=>{
    onChange({target:{value:text}});
    setOpen(false);setSuggestions([]);
    tokenRef.current=null; // one session per address picked
  };
  return <div style={{position:"relative"}}>
    <input type="text" style={inp} value={value} placeholder={placeholder} autoComplete="off"
      role="combobox" aria-expanded={open} aria-autocomplete="list"
      onChange={e=>{onChange(e);lookup(e.target.value);}}
      onBlur={()=>setTimeout(()=>setOpen(false),150)}
      onKeyDown={e=>{
        if(!open||!suggestions.length)return;
        if(e.key==="ArrowDown"){e.preventDefault();setActive(i=>Math.min(i+1,suggestions.length-1));}
        else if(e.key==="ArrowUp"){e.preventDefault();setActive(i=>Math.max(i-1,0));}
        else if(e.key==="Enter"&&active>=0){e.preventDefault();choose(suggestions[active]);}
        else if(e.key==="Escape"){setOpen(false);}
      }}/>
    {open&&<div role="listbox" style={{position:"absolute",left:0,right:0,top:"100%",marginTop:4,background:B.white,border:`1px solid ${B.border}`,
      borderRadius:8,boxShadow:B.shadowMd,zIndex:50,overflow:"hidden"}}>
      {suggestions.map((t,i)=><div key={t} role="option" aria-selected={i===active}
        onMouseDown={e=>{e.preventDefault();choose(t);}} onMouseEnter={()=>setActive(i)}
        style={{padding:"11px 13px",fontSize:13.5,color:B.text,cursor:"pointer",background:i===active?B.bg:B.white,
          borderTop:i?`1px solid ${B.borderLight}`:"none"}}>{t}</div>)}
      <div style={{padding:"4px 10px",fontSize:10,color:B.textMute,textAlign:"right"}}>powered by Google</div>
    </div>}
  </div>;
}
function PropertyQuickForm({onSave,onCancel,saving}){
  const mkInit=()=>({address:"",propertyType:PROP_TYPES[0],purchasePrice:"",purchaseDate:"",currentValue:"",notes:""});
  const[f,setF]=useState(mkInit);
  const set=(k,v)=>setF(m=>({...m,[k]:v}));
  const valid=f.address.trim().length>0;
  return <div>
    <Field label="Address" required><AddressInput value={f.address} onChange={e=>set("address",e.target.value)} placeholder="Start typing an address…"/></Field>
    <Grid2>
      <Field label="Property type"><Sel value={f.propertyType} onChange={e=>set("propertyType",e.target.value)}>{PROP_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</Sel></Field>
      <Field label="Current value (if known)" optional><MoneyInput value={f.currentValue} onChange={e=>set("currentValue",e.target.value)} placeholder="850,000"/></Field>
      <Field label="Purchase price" optional><MoneyInput value={f.purchasePrice} onChange={e=>set("purchasePrice",e.target.value)} placeholder="720,000"/></Field>
      <Field label="Purchase date" optional><Inp type="date" value={f.purchaseDate} onChange={e=>set("purchaseDate",e.target.value)}/></Field>
    </Grid2>
    <Field label="Notes" optional><textarea value={f.notes} onChange={e=>set("notes",e.target.value)} rows={2} style={{...inp,resize:"vertical",fontFamily:"inherit"}}/></Field>
    <div style={{fontSize:11.5,color:B.textSoft,marginBottom:14}}>Mortgage, insurance and rental details can be added later -- an advisor can also fill these in for you.</div>
    {!valid&&<div style={{fontSize:11.5,color:B.textMute,textAlign:"right",marginBottom:8}}>Fill in the fields marked * to continue.</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
      {onCancel&&<Btn variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>}
      <Btn onClick={async()=>{const r=await onSave(f);if(r!==false)setF(mkInit());}} disabled={saving||!valid}>{saving?"Saving…":"Add property"}</Btn>
    </div>
  </div>;
}
function AccountQuickForm({onSave,onCancel,saving}){
  const mkInit=()=>({institution:"",accountType:ACCT_TYPES[0],startingBalance:"",currentBalance:"",accountAdvisorName:"",accountAdvisorPhone:"",accountAdvisorEmail:"",notes:""});
  const[f,setF]=useState(mkInit);
  const set=(k,v)=>setF(m=>({...m,[k]:v}));
  const advisorPhoneOk=isValidPhone(f.accountAdvisorPhone);
  const advisorEmailOk=!f.accountAdvisorEmail.trim()||EMAIL_RE.test(f.accountAdvisorEmail.trim());
  const valid=f.institution.trim().length>0&&advisorPhoneOk&&advisorEmailOk;
  return <div>
    <Grid2>
      <Field label="Institution" required><Inp value={f.institution} onChange={e=>set("institution",e.target.value)} placeholder="Institution name"/></Field>
      <Field label="Account type"><Sel value={f.accountType} onChange={e=>set("accountType",e.target.value)}>{ACCT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</Sel></Field>
      <Field label="Current balance" optional><MoneyInput allowNegative value={f.currentBalance} onChange={e=>set("currentBalance",e.target.value)} placeholder="240,000"/></Field>
      <Field label="Starting balance" optional><MoneyInput allowNegative value={f.startingBalance} onChange={e=>set("startingBalance",e.target.value)} placeholder="200,000"/></Field>
    </Grid2>
    <div style={{fontSize:11,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",margin:"4px 0 8px"}}>Your advisor on this account (optional)</div>
    <Grid2>
      <Field label="Advisor name" optional><Inp value={f.accountAdvisorName} onChange={e=>set("accountAdvisorName",e.target.value)} placeholder="Jordan Lee"/></Field>
      <Field label="Advisor phone" optional>
        <Inp value={f.accountAdvisorPhone} onChange={e=>set("accountAdvisorPhone",formatPhoneInput(e.target.value))} placeholder="(555) 123-4567"/>
        {!advisorPhoneOk&&<div style={{fontSize:11,color:"#b4551f",marginTop:4}}>Enter a valid phone number, or leave it blank.</div>}
      </Field>
      <Field label="Advisor email" optional>
        <Inp type="email" autoComplete="off" value={f.accountAdvisorEmail} onChange={e=>set("accountAdvisorEmail",e.target.value)} placeholder="jordan@example.com"/>
        {!advisorEmailOk&&<div style={{fontSize:11,color:"#b4551f",marginTop:4}}>Enter a valid email address, or leave it blank.</div>}
      </Field>
    </Grid2>
    <Field label="Notes" optional><textarea value={f.notes} onChange={e=>set("notes",e.target.value)} rows={2} style={{...inp,resize:"vertical",fontFamily:"inherit"}}/></Field>
    {!valid&&<div style={{fontSize:11.5,color:B.textMute,textAlign:"right",marginBottom:8}}>Fill in the fields marked * to continue.</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
      {onCancel&&<Btn variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>}
      <Btn onClick={async()=>{const r=await onSave(f);if(r!==false)setF(mkInit());}} disabled={saving||!valid}>{saving?"Saving…":"Add account"}</Btn>
    </div>
  </div>;
}
function ValuableQuickForm({onSave,onCancel,saving}){
  const mkInit=()=>({category:VALUABLE_CATS[0],description:"",makeModel:"",year:"",estimatedValue:"",notes:""});
  const[f,setF]=useState(mkInit);
  const set=(k,v)=>setF(m=>({...m,[k]:v}));
  const valid=f.description.trim().length>0;
  return <div>
    <Grid2>
      <Field label="Category"><Sel value={f.category} onChange={e=>set("category",e.target.value)}>{VALUABLE_CATS.map(t=><option key={t} value={t}>{t}</option>)}</Sel></Field>
      <Field label="Estimated value" optional><MoneyInput value={f.estimatedValue} onChange={e=>set("estimatedValue",e.target.value)} placeholder="45,000"/></Field>
    </Grid2>
    <Field label="Description" required><Inp value={f.description} onChange={e=>set("description",e.target.value)} placeholder="2021 Rolex Submariner"/></Field>
    <Grid2>
      <Field label="Make / model" optional><Inp value={f.makeModel} onChange={e=>set("makeModel",e.target.value)}/></Field>
      <Field label="Year" optional><Inp value={f.year} onChange={e=>set("year",e.target.value)}/></Field>
    </Grid2>
    {!valid&&<div style={{fontSize:11.5,color:B.textMute,textAlign:"right",marginBottom:8}}>Fill in the fields marked * to continue.</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
      {onCancel&&<Btn variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>}
      <Btn onClick={async()=>{const r=await onSave(f);if(r!==false)setF(mkInit());}} disabled={saving||!valid}>{saving?"Saving…":"Add valuable"}</Btn>
    </div>
  </div>;
}

const MEMBER_RELATIONSHIPS=["Spouse","Child","Parent","Sibling","Other family","Other"];

// ── CONTACTS IMPORT (phone Contact Picker) ───────────────────────────────────
// Free: tap a name from your phone's own contacts instead of typing it into the Member/
// Professional QuickForm. `navigator.contacts.select` is a real Web API, but Android Chrome only
// -- there is no iPhone Safari equivalent, so this feature-detects and simply doesn't render where
// unsupported, same convention as shareAnswer's navigator.share/clipboard fallback above. The only
// paid seat anywhere in this feature area is Business Partner Portal Access, which is unrelated.
const canUseContactPicker=()=>typeof navigator!=="undefined"&&!!navigator.contacts&&!!navigator.contacts.select;
// Free -- see the correction in this migration's companion commit: this was never meant to be a
// paid add-on. The only paid seat in this feature area is Business Partner Portal Access
// (families.business_partner_seats_stripe_item_id), which is unrelated to this button.
function ImportFromContactsButton({onPick}){
  if(!canUseContactPicker())return null;
  const pick=async()=>{
    try{
      const props=["name","email","tel"];
      const[picked]=await navigator.contacts.select(props,{multiple:false});
      if(!picked)return;
      onPick({
        name:(picked.name&&picked.name[0])||"",
        email:(picked.email&&picked.email[0])||"",
        phone:(picked.tel&&picked.tel[0])||"",
      });
    }catch(e){ /* user cancelled, or the browser denied the request */ }
  };
  return <button type="button" onClick={pick} style={{background:"rgba(206,182,132,0.15)",border:`1px solid ${B.gold}`,color:B.navy,borderRadius:8,padding:"6px 12px",fontSize:11.5,fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginBottom:14,display:"inline-flex",alignItems:"center",gap:6}}>
    📇 Import from Contacts
  </button>;
}

// Self-serve quick-add for a Household Member (contacts) / Professional Network contact
// (family_contacts) -- same spirit as PropertyQuickForm/AccountQuickForm/ValuableQuickForm above:
// a trimmed version of the fuller admin-side forms, reused as both a standalone "+ Add" modal and
// a wizard step.
function MemberQuickForm({onSave,onCancel,saving}){
  const mkInit=()=>({name:"",relationship:MEMBER_RELATIONSHIPS[0],email:"",phone:""});
  const[f,setF]=useState(mkInit);
  const set=(k,v)=>setF(m=>({...m,[k]:v}));
  const phoneOk=isValidPhone(f.phone);
  const valid=f.name.trim().length>0&&phoneOk;
  return <div>
    <ImportFromContactsButton onPick={c=>setF(m=>({...m,name:c.name||m.name,email:c.email||m.email,phone:c.phone?formatPhoneInput(c.phone):m.phone}))}/>
    <Field label="Name" required><Inp value={f.name} onChange={e=>set("name",e.target.value)} placeholder="Jane Smith"/></Field>
    <Grid2>
      <Field label="Relationship"><Sel value={f.relationship} onChange={e=>set("relationship",e.target.value)}>{MEMBER_RELATIONSHIPS.map(t=><option key={t} value={t}>{t}</option>)}</Sel></Field>
      <Field label="Email" optional><Inp type="email" autoComplete="off" value={f.email} onChange={e=>set("email",e.target.value)} placeholder="jane@email.com"/></Field>
      <Field label="Phone" optional>
        <Inp value={f.phone} onChange={e=>set("phone",formatPhoneInput(e.target.value))} placeholder="(555) 123-4567"/>
        {!phoneOk&&<div style={{fontSize:11,color:"#b4551f",marginTop:4}}>Enter a valid phone number, or leave it blank.</div>}
      </Field>
    </Grid2>
    {!valid&&<div style={{fontSize:11.5,color:B.textMute,textAlign:"right",marginBottom:8}}>Fill in the fields marked * to continue.</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
      {onCancel&&<Btn variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>}
      <Btn onClick={async()=>{const r=await onSave(f);if(r!==false)setF(mkInit());}} disabled={saving||!valid}>{saving?"Saving…":"Add member"}</Btn>
    </div>
  </div>;
}
// allowPortalGrant: only self-serve households (Basic/Core) may offer this -- Premier already has
// an assigned Expert, and the server-side check in manage-business-partner enforces the same rule
// independently of whatever this prop is set to.
function ProfessionalQuickForm({onSave,onCancel,saving,allowPortalGrant,partnerSeatFree}){
  const mkInit=()=>({name:"",role:"",company:"",email:"",phone:"",grantPortalAccess:false,emailConfirmed:false});
  const[f,setF]=useState(mkInit);
  const set=(k,v)=>setF(m=>({...m,[k]:v}));
  const emailOk=EMAIL_RE.test(f.email.trim());
  const phoneOk=isValidPhone(f.phone);
  const companyOk=f.company.trim().length>0;
  // A portal login also needs a phone number (so the ORDANIS team can reach them) and a confirmed email.
  const valid=f.name.trim().length>0&&companyOk&&phoneOk&&(!f.grantPortalAccess||(emailOk&&String(f.phone||"").trim()&&f.emailConfirmed));
  return <div>
    <ImportFromContactsButton onPick={c=>setF(m=>({...m,name:c.name||m.name,email:c.email||m.email,phone:c.phone?formatPhoneInput(c.phone):m.phone}))}/>
    <Grid2>
      <Field label="Name" required><Inp value={f.name} onChange={e=>set("name",e.target.value)} placeholder="Dr. John Reyes"/></Field>
      <Field label="Role" optional><Inp value={f.role} onChange={e=>set("role",e.target.value)} placeholder="CPA, Attorney, Physician…"/></Field>
      <Field label="Company" required><Inp value={f.company} onChange={e=>set("company",e.target.value)} placeholder="Reyes Family Medicine"/></Field>
      <Field label="Email" required={!!f.grantPortalAccess} optional={!f.grantPortalAccess}><Inp type="email" autoComplete="off" value={f.email} onChange={e=>set("email",e.target.value)} placeholder={f.grantPortalAccess?"Needed for portal access":""}/></Field>
      <Field label="Phone" optional>
        <Inp value={f.phone} onChange={e=>set("phone",formatPhoneInput(e.target.value))} placeholder="(555) 123-4567"/>
        {!phoneOk&&<div style={{fontSize:11,color:"#b4551f",marginTop:4}}>Enter a valid phone number, or leave it blank.</div>}
      </Field>
    </Grid2>
    {allowPortalGrant&&<label style={{display:"flex",gap:10,alignItems:"flex-start",background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"12px 14px",marginBottom:16,cursor:"pointer"}}>
      <input type="checkbox" checked={f.grantPortalAccess} onChange={e=>set("grantPortalAccess",e.target.checked)} style={{marginTop:2}}/>
      <span style={{fontSize:12.5,color:B.text,lineHeight:1.5}}>
        <strong style={{color:B.navy}}>Also give this Business Partner their own portal login</strong> — a read-only account so they can see this household's dashboard on their own (properties, cash flow, documents, and more). We'll email them a secure link to set it up. {partnerSeatFree?<><strong style={{color:B.navy}}>Free</strong>, included with Premier.</>:<><strong style={{color:B.navy}}>$5.00/month</strong>, billed to this household until removed.</>}
      </span>
    </label>}
    {allowPortalGrant&&f.grantPortalAccess&&<>
      {!String(f.phone||"").trim()&&<div style={{fontSize:11.5,color:"#b4551f",margin:"-8px 0 10px"}}>A phone number is required for a portal login, so the ORDANIS team can reach them.</div>}
      <label style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:12,cursor:"pointer"}}>
      <input type="checkbox" checked={!!f.emailConfirmed} onChange={e=>set("emailConfirmed",e.target.checked)} style={{marginTop:2}}/>
      <span style={{fontSize:12.5,color:B.text,lineHeight:1.5}}>I've checked that <strong style={{color:B.navy}}>{f.email.trim()||"the email"}</strong> is correct. Access goes to whoever owns this address.</span>
    </label>
    </>}
    {!valid&&<div style={{fontSize:11.5,color:B.textMute,textAlign:"right",marginBottom:8}}>Fill in the fields marked * to continue.</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
      {onCancel&&<Btn variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>}
      <Btn onClick={async()=>{const r=await onSave(f);if(r!==false)setF(mkInit());}} disabled={saving||!valid}>{saving?"Saving…":"Add contact"}</Btn>
    </div>
  </div>;
}

// Standalone "Add Business Partner" form: just a name and email. It makes the same portal seat as
// the "Also give this Business Partner their own portal login" option on the contact form (one
// manage-business-partner call), with the same cost wording, but creates no Professional Network
// row -- the two records are independent. On paid plans the cost must be acknowledged first.
function BusinessPartnerQuickForm({onSave,onCancel,saving,seatFree}){
  const mkInit=()=>({name:"",email:"",phone:"",agree:false,emailConfirmed:false});
  const[f,setF]=useState(mkInit);
  const set=(k,v)=>setF(m=>({...m,[k]:v}));
  const emailOk=EMAIL_RE.test(f.email.trim());
  const phoneOk=String(f.phone||"").trim()&&isValidPhone(f.phone);
  const valid=f.name.trim().length>0&&emailOk&&phoneOk&&f.emailConfirmed&&(seatFree||f.agree);
  return <div>
    <Grid2>
      <Field label="Name" required><Inp value={f.name} onChange={e=>set("name",e.target.value)} placeholder="Jane Reyes"/></Field>
      <Field label="Email" required>
        <Inp type="email" autoComplete="off" value={f.email} onChange={e=>set("email",e.target.value)} placeholder="jane@example.com"/>
        {f.email&&!emailOk&&<div style={{fontSize:11,color:"#b4551f",marginTop:4}}>Enter a valid email address.</div>}
      </Field>
    </Grid2>
    <Field label="Phone" required>
      <Inp value={f.phone} onChange={e=>set("phone",formatPhoneInput(e.target.value))} placeholder="(555) 123-4567"/>
      <div style={{fontSize:11,color:B.textMute,marginTop:4}}>So the ORDANIS team can reach them if needed.</div>
    </Field>
    <div style={{fontSize:11.5,color:B.textMute,margin:"-6px 0 12px"}}>The login link is emailed to this address. If they already have an ORDANIS professional login (for example a CPA with several clients), they'll be asked to accept, then they switch between their clients.</div>
    <label style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:12,cursor:"pointer"}}>
      <input type="checkbox" checked={!!f.emailConfirmed} onChange={e=>set("emailConfirmed",e.target.checked)} style={{marginTop:2}}/>
      <span style={{fontSize:12.5,color:B.text,lineHeight:1.5}}>I've checked that <strong style={{color:B.navy}}>{f.email.trim()||"the email"}</strong> is correct. Access goes to whoever owns this address.</span>
    </label>
    <div style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"12px 14px",marginBottom:12,fontSize:12.5,color:B.text,lineHeight:1.5}}>
      <strong style={{color:B.navy}}>Business Partner portal login</strong> — a read-only account so they can see this household's dashboard on their own (properties, cash flow, documents, and more). We'll email them a secure link to set it up. {seatFree?<><strong style={{color:B.navy}}>Free</strong>, included with Premier.</>:<><strong style={{color:B.navy}}>$5.00/month</strong>, billed to this household until removed.</>}
    </div>
    {!seatFree&&<label style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:16,cursor:"pointer"}}>
      <input type="checkbox" checked={f.agree} onChange={e=>set("agree",e.target.checked)} style={{marginTop:2}}/>
      <span style={{fontSize:12.5,color:B.text,lineHeight:1.5}}>I understand <strong style={{color:B.navy}}>$5.00/month</strong> will be added to this household's bill for this seat until I revoke their access.</span>
    </label>}
    {!valid&&<div style={{fontSize:11.5,color:B.textMute,textAlign:"right",marginBottom:8}}>Fill in the fields marked * to continue.</div>}
    <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
      {onCancel&&<Btn variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>}
      <Btn onClick={async()=>{const r=await onSave(f);if(r!==false)setF(mkInit());}} disabled={saving||!valid}>{saving?"Sending…":"Send invite"}</Btn>
    </div>
  </div>;
}

// ── ONBOARDING WIZARD ─────────────────────────────────────────────────────────
// Self-serve (Basic/Core, no assigned Expert) "getting started" flow. Opens automatically the
// first time a household with nothing on file yet lands on its dashboard, and stays reachable
// afterward (the header "Getting Started" button was removed) -- see ClientDashboard, which is the
// only caller. Each step reuses the exact same QuickForm + save handler as that entity's
// standalone "+ Add" button, so nothing about how the data is saved differs by how someone got to
// the form; only the chrome around it (a wizard step vs. a popup modal) differs.
// The "documents" step is the CHRIS snap-or-add-several filer, so a new household can
// photograph its paperwork straight into the right folders while it is setting up.
const WIZARD_STEPS=["welcome","member","logins","professional","property","account","valuable","documents","done"];
function OnboardingWizard({userProfile=null,onClose,addMember,addProfessional,addBusinessPartner,addProperty,addAccount,addValuable,members,professionals,properties,accounts,valuables,familyId,toast,reload}){
  const[stepIdx,setStepIdx]=useState(0);
  const mobile=useIsMobile(640);
  const[docsFiled,setDocsFiled]=useState(0);
  const[saving,setSaving]=useState(false);
  const step=WIZARD_STEPS[stepIdx];
  const next=()=>setStepIdx(i=>Math.min(i+1,WIZARD_STEPS.length-1));
  const back=()=>setStepIdx(i=>Math.max(i-1,0));

  const save=async(kind,f)=>{
    setSaving(true);
    try{
      let r;
      if(kind==="member")r=await addMember(f);
      if(kind==="professional"){r=await addProfessional(f);if(r!==false&&f.grantPortalAccess)await addBusinessPartner(f.email,f.name,f.phone);}
      if(kind==="property")r=await addProperty(f);
      if(kind==="account")r=await addAccount(f);
      if(kind==="valuable")r=await addValuable(f);
      return r;
    } finally { setSaving(false); }
  };

  const list=kind=>{
    const rows=kind==="member"?members:kind==="professional"?professionals:kind==="property"?properties:kind==="account"?accounts:valuables;
    if(!rows.length)return null;
    const label=r=>kind==="member"?`${r.name}${r.relationship?` · ${r.relationship}`:""}`:kind==="professional"?`${r.name}${r.role?` · ${r.role}`:""}`:kind==="property"?r.address:kind==="account"?`${r.institution} · ${r.accountType}`:r.description;
    return <div style={{marginTop:2,marginBottom:18}}>
      <div style={{fontSize:11,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Added so far</div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {rows.map(r=><div key={r.id} style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:8,padding:"8px 12px",fontSize:12.5,color:B.text}}>✓ {label(r)}</div>)}
      </div>
    </div>;
  };

  const shell=(title,blurb,body,footer)=><div style={{
    position:"fixed",inset:0,background:"rgba(9,20,35,0.55)",zIndex:2000,
    display:"flex",alignItems:mobile?"flex-end":"center",justifyContent:"center",padding:mobile?0:20,
  }}>
    <div style={{background:B.white,borderRadius:mobile?"16px 16px 0 0":16,maxWidth:640,width:"100%",maxHeight:mobile?"92vh":"88vh",overflowY:"auto",padding:mobile?"22px 18px 28px":"32px 34px",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
      <div style={{display:"flex",gap:6,marginBottom:20}}>
        {WIZARD_STEPS.slice(0,-1).map((s,i)=><div key={s} style={{flex:1,height:4,borderRadius:2,background:i<=stepIdx?B.gold:B.borderLight}}/>)}
      </div>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,color:B.navy,fontWeight:600,marginBottom:6}}>{title}</div>
      {blurb&&<div style={{fontSize:13.5,color:B.textSoft,marginBottom:22,lineHeight:1.55}}>{blurb}</div>}
      {body}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:22,paddingTop:18,borderTop:`1px solid ${B.borderLight}`}}>
        {footer}
      </div>
    </div>
  </div>;

  if(step==="welcome")return shell(
    "Let's set up your household",
    "A few quick, optional steps to get your properties, accounts and valuables on record. Add as much or as little as you'd like now — you can always add more later.",
    null,
    <>
      <button onClick={onClose} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Skip for now</button>
      <Btn onClick={next}>Get started →</Btn>
    </>
  );

  if(step==="member")return shell(
    "Add your household members",
    "Spouse, children, anyone else in the household. Add one, several, or skip this entirely — you can always add more later from the Household tab.",
    <>{list("member")}<MemberQuickForm saving={saving} onSave={f=>save("member",f)}/></>,
    <>
      <button onClick={back} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
      <Btn variant="ghost" onClick={next}>{members.length?"Next":"Skip"}</Btn>
    </>
  );

  // Give a spouse or another family member their own sign-in, with the permissions chosen here
  // (HouseholdLogins; migration 20261028100000).
  if(step==="logins")return shell(
    "Give a family member their own login",
    "A spouse or partner can have their own sign-in to the household. They get an email to set up their own password, and you choose what they can do. Free on every plan, and you can change it later on the Household tab.",
    <HouseholdLogins familyId={familyId} userProfile={userProfile} toast={toast} mode="wizard"/>,
    <>
      <button onClick={back} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
      <Btn variant="ghost" onClick={next}>Next</Btn>
    </>
  );

  if(step==="professional")return shell(
    "Add your professional network",
    "CPA, attorney, physician — anyone outside the household you work with. Entirely optional.",
    <>{list("professional")}<ProfessionalQuickForm saving={saving} allowPortalGrant={!IS_NATIVE_APP} partnerSeatFree={false} onSave={f=>save("professional",f)}/></>,
    <>
      <button onClick={back} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
      <Btn variant="ghost" onClick={next}>{professionals.length?"Next":"Skip"}</Btn>
    </>
  );

  if(step==="property")return shell(
    "Add a property",
    "Real estate, land, or anywhere else you hold property. Add one, several, or skip this entirely.",
    <>{list("property")}<PropertyQuickForm saving={saving} onSave={f=>save("property",f)}/></>,
    <>
      <button onClick={back} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
      <Btn variant="ghost" onClick={next}>{properties.length?"Next":"Skip"}</Btn>
    </>
  );

  if(step==="account")return shell(
    "Add a portfolio account",
    "Brokerage, bank, retirement — anywhere you hold investable assets.",
    <>{list("account")}<AccountQuickForm saving={saving} onSave={f=>save("account",f)}/></>,
    <>
      <button onClick={back} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
      <Btn variant="ghost" onClick={next}>{accounts.length?"Next":"Skip"}</Btn>
    </>
  );

  if(step==="valuable")return shell(
    "Add a valuable",
    "Vehicles, jewelry, art, watches — anything worth keeping a record and value on. Entirely optional.",
    <>{list("valuable")}<ValuableQuickForm saving={saving} onSave={f=>save("valuable",f)}/></>,
    <>
      <button onClick={back} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
      <Btn variant="ghost" onClick={next}>{valuables.length?"Next":"Skip"}</Btn>
    </>
  );

  if(step==="documents")return shell(
    "Add your documents to CHRIS",
    "Take photos of your paperwork or pick PDFs. CHRIS reads each one and suggests a name and a folder. You check each one before it's filed. Entirely optional.",
    familyId?<ChrisBatchFiler familyId={familyId} toast={toast||(()=>{})} onFiled={()=>{setDocsFiled(n=>n+1);if(reload)reload("documents");}}/>
      :<div style={{fontSize:13,color:B.textSoft}}>You can add documents anytime from CHRIS.</div>,
    <>
      <button onClick={back} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
      <Btn onClick={next}>{docsFiled?"Finish":"Skip & finish"}</Btn>
    </>
  );

  return shell(
    "You're all set",
    "You can add more properties, accounts or valuables anytime from their own tabs, and more documents in CHRIS.",
    <div style={{fontSize:13,color:B.textSoft,lineHeight:1.6}}>
      Added this session: {properties.length} propert{properties.length===1?"y":"ies"}, {accounts.length} account{accounts.length===1?"":"s"}, {valuables.length} valuable{valuables.length===1?"":"s"}.
    </div>,
    <div style={{marginLeft:"auto"}}><Btn onClick={onClose}>Go to my dashboard</Btn></div>
  );
}

// The household's ORDANIS team as the client sees it: their Expert (the point person) and, under them,
// the Expert's Analyst. From household_team(), which only answers for households the viewer can see.
function HouseholdTeamCard({familyId}){
  const[team,setTeam]=useState([]);
  useEffect(()=>{
    let stopped=false;
    if(!familyId)return;
    sb.rpc("household_team",{p_family_id:familyId}).then(({data:rows,error})=>{if(!stopped&&!error)setTeam(rows||[]);});
    return()=>{stopped=true;};
  },[familyId]);
  const expert=team.find(t=>t.member_role==="expert");
  if(!expert)return null;
  const analysts=team.filter(t=>t.member_role==="analyst");
  return <div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",gap:24,flexWrap:"wrap",alignItems:"baseline"}}>
    <div style={{fontSize:11,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Your {BRAND.name} team</div>
    <div style={{fontSize:13.5,color:B.text}}><strong style={{color:B.navy}}>{expert.full_name}</strong> <span style={{color:B.textSoft}}>· {roleLabel("advisor")}, your point person</span></div>
    {analysts.map(a=><div key={a.email} style={{fontSize:13.5,color:B.text}}>{a.full_name} <span style={{color:B.textSoft}}>· {roleLabel("analyst")}</span></div>)}
  </div>;
}

function ClientDashboard({family,data,userProfile,logout,toast,reload}){
  const isMobile=useIsMobile();
  const[isCardOpen,toggleCard]=useOpenSet();
  // Needed because this view renders CashFlowView too. The client view is read-only, so
  // the picker never opens here — but the prop still has to resolve, and an undefined
  // identifier would take the whole dashboard down rather than degrade.
  const vendorOptions=buildVendorOptions(data,family.id);
  // ?go=<tab> (sent by the native app's "Continue on the website" buttons) opens that tab once, then is cleared.
  const[activeTab,setActiveTab]=useState(()=>{
    try{const g=new URLSearchParams(window.location.search).get("go");
      if(g&&["billing","workflows","household"].includes(g)){CAME_FROM_APP=true;window.history.replaceState(null,"",window.location.pathname);return g;}}catch(_e){}
    // In the app, a live update reloads the screens while the client is away; come back to the same section.
    if(IS_NATIVE_APP){try{const t=sessionStorage.getItem("ordanis-client-tab");if(t&&["summary","household","properties","portfolio","loans","cashflow","workflows","valuables","tasks","documents","assistant","billing"].includes(t))return t;}catch(_e){}}
    return "summary";
  });
  useEffect(()=>{if(IS_NATIVE_APP){try{sessionStorage.setItem("ordanis-client-tab",activeTab);}catch(_e){}}},[activeTab]);
  const tabPanelRef=useTabEntrance(activeTab,{scrollWindow:true});
  const[emailAdvisorOpen,setEmailAdvisorOpen]=useState(false);
  const fam=(data.families||[]).find(x=>x.id===family.id)||family;
  const rawAssistantName=(fam.assistantName||"").trim();
  const assistantName=rawAssistantName||"ORDANIS";
  // Read from `fam`, not the `family` prop, so a plan change lands without a re-login.
  //
  // Basic and Core are self-directed -- there is no assigned Expert on those tiers. The
  // expert-of-record on the row exists only so staff can open the file, so anything on this
  // screen that offers the client "your ORDANIS Expert" would point them at someone who isn't
  // actually managing this household -- the one place where the wrong copy sends a real email
  // to the wrong person.
  const clientPlan=fam.plan;
  const[cardCheckoutBusy,setCardCheckoutBusy]=useState(false);
  const startCardCheckout=async()=>{
    setCardCheckoutBusy(true);
    const origin=window.location.origin;
    const{data:resp,error}=await sb.functions.invoke("create-checkout-session",{body:{family_id:fam.id,success_url:`${origin}/?billing=done`,cancel_url:`${origin}/`}});
    if(error||!resp?.url){
      let msg=resp?.error||error?.message||"Checkout could not be opened";
      try{const b=await error?.context?.json?.();if(b?.error)msg=b.error;}catch(_e){}
      toast(msg,"error");setCardCheckoutBusy(false);return;
    }
    window.location.href=resp.url;
  };
  const clientHasExpert=planAllows(clientPlan,"assignedExpert");
  const clientHasWorkflows=planAllows(clientPlan,"workflows");
  // No assigned Expert (Basic/Core) means nobody else is entering this household's properties,
  // accounts or valuables -- that's the whole reason the QuickForm "+ Add" buttons and the
  // onboarding wizard exist. Premier already has someone doing this for the household, so neither
  // is shown there.
  const clientSelfServe=!clientHasExpert;
  // What this family login may do (migration 20261028100000): the primary has everything; a secondary family user has
  // what the primary ticked. The database enforces it; these just hide the buttons they can't use.
  const myPerm=(()=>{const prim=userProfile?.household_role!=="member";
    return{edit:prim||userProfile?.perm_edit!==false,upload:prim||userProfile?.perm_upload!==false,
           download:prim||userProfile?.perm_download!==false,manage:prim||userProfile?.perm_manage===true};})();
  // Every plan edits the same records (Will, 2026-10-29). On Premier, the family's changes are written to the
  // household's Client Activity log (migration 20261029100000) so the ORDANIS Expert sees what moved.
  const selfEdit=myPerm.edit;
  const selfUpload=myPerm.upload;

  // ── Billing (upgrade / downgrade) ──────────────────────────────────────
  // Only Basic <-> Core is ever self-serve here (plan_features.self_serve / plans.js
  // PLAN_SELF_SERVE) -- Premier is advisor-provisioned, so a move to or from Premier is always
  // "contact your ORDANIS Expert" copy, never a button that calls Stripe directly. Enforcement
  // still lives server-side in change-subscription-plan; this just decides what to draw.
  const[billingPlans,setBillingPlans]=useState([]); // plan_features: plan,label,monthly_price,sort_order
  useEffect(()=>{
    let stopped=false;
    sb.from("plan_features").select("plan,label,monthly_price,sort_order").order("sort_order").then(({data:rows,error})=>{
      if(!stopped&&!error&&rows)setBillingPlans(rows);
    });
    return()=>{stopped=true;};
  },[]);
  const billingLabelOf=p=>billingPlans.find(x=>x.plan===p)?.label||planLabel(p);
  const billingPriceOf=p=>Number(billingPlans.find(x=>x.plan===p)?.monthly_price)||0;
  const[billingBusy,setBillingBusy]=useState(false);
  const[billingMsg,setBillingMsg]=useState(null); // {type:"success"|"error", text}
  // End-of-period cancellation (2026-10-21): the household keeps everything until the end of the month it
  // has paid for, then it is closed automatically. Undo is possible until that date.
  const[cancelOpen,setCancelOpen]=useState(false);
  const[cancelBusy,setCancelBusy]=useState(false);
  const runCancel=async action=>{
    setCancelBusy(true);setBillingMsg(null);
    try{
      const{data:resp,error}=await sb.functions.invoke("cancel-subscription",{body:{family_id:family.id,action}});
      let msg=resp&&resp.error;
      if(error&&!msg){try{msg=(await error.context.json()).error;}catch(_e){msg=error.message;}}
      if(msg){setBillingMsg({type:"error",text:msg});return;}
      setCancelOpen(false);
      setBillingMsg({type:"success",text:action==="schedule"
        ?`Your subscription will end on ${resp.cancel_at?new Date(resp.cancel_at).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}):"the last day of your paid month"}. You have full access until then.`
        :"Your subscription will continue as normal."});
      await reload("families");
    }finally{setCancelBusy(false);}
  };
  const[confirmDowngrade,setConfirmDowngrade]=useState(null); // {plan, count} of open workflows
  // Households are warned before a downgrade (the confirm dialog below), but the move can land
  // long after that click (a scheduled downgrade applies at the end of the billing period) --
  // this is what makes sure they're still told, in the app itself, once it actually happens. The
  // hard block that used to prevent this move outright is gone; pausing (never deleting) plus
  // this banner is what replaced it. See the sync_plan_capabilities_on_change DB trigger.
  const[pausedWorkflowCount,setPausedWorkflowCount]=useState(0);
  useEffect(()=>{
    let stopped=false;
    sb.from("workflow_instances").select("id",{count:"exact",head:true}).eq("family_id",family.id).eq("status","paused").then(({count,error})=>{
      if(!stopped&&!error)setPausedWorkflowCount(count||0);
    });
    return()=>{stopped=true;};
  },[family.id,fam.plan]);
  // The sync_plan_capabilities_on_change DB trigger actually clears pcm_responsible (not just a
  // notice) the moment a downgrade removes bill pay, and stamps pcm_responsible_cleared_by_downgrade
  // on exactly the rows it cleared so it -- and only it -- can restore them if bill pay comes back.
  // So this counts THAT column, not pcmResponsible (which is already false by the time this
  // renders). Reads straight from data already loaded for this dashboard rather than a fresh
  // query, same as everywhere else in ClientDashboard that filters data.* by family.id.
  const billPayLostCount=(data.cash_flow_events||[]).filter(e=>e.familyId===family.id&&e.pcm_responsible_cleared_by_downgrade).length;
  // ── Workflows & extra-workflow purchases, for the Billing tab ──────────────
  // Same family_workflow_slots RPC the Workflows tab's banner reads (so the two numbers can never
  // disagree), plus the household's workflow_purchases rows (what was bought, when, at what price,
  // who approved it). The purchases table's read policy lets a client read only its own family's rows.
  const[billingWorkflowUsage,setBillingWorkflowUsage]=useState(null);
  const[expertPriceBilling,setExpertPriceBilling]=useState(0);
  useEffect(()=>{
    let stopped=false;
    sb.from("plan_features").select("expert_assist_price").eq("plan",clientPlan).maybeSingle().then(({data:r,error})=>{
      if(!stopped&&!error)setExpertPriceBilling(Number(r&&r.expert_assist_price)||0);
    });
    return()=>{stopped=true;};
  },[clientPlan]);
  const[workflowPurchases,setWorkflowPurchases]=useState([]);
  const[slotBusy,setSlotBusy]=useState(false);
  const loadBillingWorkflows=async()=>{
    const[u,p]=await Promise.all([
      sb.rpc("family_workflow_slots",{p_family_id:family.id}),
      sb.from("workflow_purchases").select("id,status,unit_price,approved_by_label,approved_at,workflow_label,released_at,release_reason")
        .eq("family_id",family.id).in("status",["available","in_use","released"]).order("approved_at",{ascending:false}),
    ]);
    if(!u.error&&u.data&&u.data[0])setBillingWorkflowUsage(u.data[0]);
    if(!p.error&&p.data)setWorkflowPurchases(p.data);
  };
  useEffect(()=>{if(!clientHasWorkflows)return;loadBillingWorkflows();},[family.id,clientHasWorkflows]);
  // Who pays: a household whose firm pays has no card here, so the plan-change buttons and the
  // "charged to your card" wording must not appear for it.
  const[payerInfo,setPayerInfo]=useState(null);
  useEffect(()=>{
    let stopped=false;
    sb.rpc("family_payer_info",{p_family_id:family.id}).then(({data:r,error})=>{if(!stopped&&!error&&r&&r[0])setPayerInfo(r[0]);});
    return()=>{stopped=true;};
  },[family.id,fam.paidBy]);
  const firmPaid=(payerInfo?payerInfo.paid_by:fam.paidBy)==="enterprise";
  const firmLabel=(payerInfo&&payerInfo.firm_name)||"your firm";
  const cancelUnusedSlot=async id=>{
    setSlotBusy(true);
    try{await callPurchaseWorkflow({action:"cancel_unused",family_id:family.id,purchase_id:id});await loadBillingWorkflows();}
    catch(e){setBillingMsg({type:"error",text:e.message});}
    setSlotBusy(false);
  };
  const requestPlanChange=async newPlan=>{
    setBillingBusy(true); setBillingMsg(null);
    try{
      const{data:resp,error}=await sb.functions.invoke("change-subscription-plan",{body:{family_id:family.id,new_plan:newPlan}});
      if(error)throw new Error(error.message||"Could not change your plan.");
      if(resp&&resp.error)throw new Error(resp.error);
      setBillingMsg({type:"success",text:resp.message
        ? resp.message
        : resp.pending_plan
          ? `Scheduled — you'll move to ${billingLabelOf(resp.pending_plan)} on ${fmt(resp.effective_at)}. Your current plan stays active, with no proration, until then.`
          : `Done — you're now on ${billingLabelOf(resp.plan)}${resp.prorated_charge?" (a prorated charge for the difference was applied today)":""}.`});
      if(reload)await reload("families");
    }catch(e){ setBillingMsg({type:"error",text:e&&e.message?e.message:"Could not change your plan."}); }
    finally{ setBillingBusy(false); }
  };
  const requestDowngrade=async newPlan=>{
    setBillingBusy(true); setBillingMsg(null);
    try{
      // Warn, but let them proceed: this is a courtesy check on the client side so the person
      // sees it before confirming -- change-subscription-plan itself never blocks on open work,
      // and neither does the database any more (families_refuse_downgrade was removed). "paused"
      // is excluded too, since those were already paused by an earlier plan change and aren't
      // newly-at-risk work this particular click would affect.
      const{count,error}=await sb.from("workflow_instances").select("id",{count:"exact",head:true}).eq("family_id",family.id).not("status","in","(completed,paused)");
      if(error)throw new Error(error.message||"Could not check in-progress workflows.");
      if(count>0){ setConfirmDowngrade({plan:newPlan,count}); setBillingBusy(false); return; }
      await requestPlanChange(newPlan);
    }catch(e){ setBillingMsg({type:"error",text:e&&e.message?e.message:"Could not change your plan."}); setBillingBusy(false); }
  };
  const cancelPendingChange=()=>requestPlanChange(clientPlan);
  const planSelfServe=planIsSelfServe(clientPlan);
  // Premier is set up by people, not by a button that calls Stripe. A move to or from it is an in-app
  // request (request_plan_change) that lands in the admins' Plan requests queue; the household sees it
  // here as waiting, and sees the decision (with the team's note) once it is made.
  const[planRequest,setPlanRequest]=useState(null);       // the open request, if any
  const[planDecision,setPlanDecision]=useState(null);     // the latest decided request, shown for 30 days
  const[askPlan,setAskPlan]=useState(null);               // plan being requested in the dialog
  const[askNote,setAskNote]=useState("");
  const[askBusy,setAskBusy]=useState(false);
  const loadPlanRequests=async()=>{
    const{data:r,error}=await sb.from("plan_change_requests").select("id,to_plan,status,created_at,decided_at,decision_note")
      .eq("family_id",family.id).order("created_at",{ascending:false}).limit(5);
    if(error||!r)return;
    setPlanRequest(r.find(x=>x.status==="pending")||null);
    const recent=r.find(x=>(x.status==="declined"||x.status==="approved")&&x.decided_at&&(Date.now()-new Date(x.decided_at).getTime())<30*86400000);
    setPlanDecision(recent||null);
  };
  useEffect(()=>{loadPlanRequests();},[family.id,fam.plan]);
  const sendPlanRequest=async()=>{
    setAskBusy(true);
    const{data:filed,error}=await sb.rpc("request_plan_change",{p_to_plan:askPlan,p_note:askNote.trim()||null});
    setAskBusy(false);
    if(error){toast(error.message||"Could not send your request.","error");return;}
    // Tell the ORDANIS team by email. The request is already saved, so a failure here never blocks the household.
    if(filed?.id)sb.functions.invoke("plan-request-notify",{body:{request_id:filed.id}}).catch(()=>{});
    toast(`Request sent. The ${BRAND.name} team will be in touch about ${billingLabelOf(askPlan)}.`);
    setAskPlan(null);setAskNote("");await loadPlanRequests();
  };
  const cancelPlanRequest=async()=>{
    if(!planRequest)return;
    setAskBusy(true);
    const{error}=await sb.rpc("cancel_plan_change_request",{p_id:planRequest.id});
    setAskBusy(false);
    if(error){toast(error.message||"Could not cancel your request.","error");return;}
    toast("Request canceled.");await loadPlanRequests();
  };
  // The button on a plan card the household must ask for, rather than buy directly.
  const askButton=p=>planRequest
    ? (planRequest.to_plan===p
        ? <span style={{fontSize:12,color:"#7a5a19",fontWeight:600}}>Requested · waiting</span>
        : <span style={{fontSize:12,color:B.textMute}}>Another request is waiting</span>)
    : <Btn small variant={p==="premier"?"primary":"ghost"} onClick={()=>{setAskPlan(p);setAskNote("");}}>{`Request ${billingLabelOf(p)}`}</Btn>;
  const premierPriceText=billingPriceOf("premier")>0?`${fmtMoney(billingPriceOf("premier"))}/mo`:"Custom pricing";
  const planCardStyle={background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:"16px 18px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"};
  const upgradeTargets=planSelfServe?SIGNUP_PLAN_ORDER.filter(p=>p!==clientPlan&&planIsSelfServe(p)&&SIGNUP_PLAN_ORDER.indexOf(p)>SIGNUP_PLAN_ORDER.indexOf(clientPlan)):[];
  const downgradeTargets=planSelfServe?SIGNUP_PLAN_ORDER.filter(p=>p!==clientPlan&&planIsSelfServe(p)&&SIGNUP_PLAN_ORDER.indexOf(p)<SIGNUP_PLAN_ORDER.indexOf(clientPlan)):[];

  // Supporting document behind a figure on a property card, and the family's
  // scheduled-personal-property endorsement linked from Valuables.
  const docForSection=(pid,section)=>(data.documents||[]).find(d=>d.propertyId===pid&&d.propertySection===section);
  const valuablesPolicyDoc=()=>(data.documents||[]).find(d=>d.familyId===family.id&&d.propertySection==="valuables_schedule");
  const[namePromptDismissed,setNamePromptDismissed]=useState(false);
  const[welcomeName,setWelcomeName]=useState("");
  const[savingWelcome,setSavingWelcome]=useState(false);
  const[welcomeErr,setWelcomeErr]=useState("");
  // 1 = first login, 2 = second, 3 = third or later; null = still being counted.
  const[promptLogin,setPromptLogin]=useState(null);
  const promptUid=userProfile&&userProfile.id;
  useEffect(()=>{
    if(!promptUid||rawAssistantName)return;   // already named: nothing to count or ask
    let cancelled=false;
    countAssistantPromptLogin(promptUid).then(v=>{
      if(cancelled)return;
      setPromptLogin(v.count);
      if(v.dismissed)setNamePromptDismissed(true);
    });
    return()=>{cancelled=true;};
  },[promptUid,rawAssistantName]);
  const promptPending=!!promptUid&&!rawAssistantName&&promptLogin===null;
  const showNamePrompt=!CAME_FROM_APP&&!rawAssistantName&&!namePromptDismissed&&(promptLogin===1||promptLogin===2);
  const dismissNamePrompt=()=>{
    setNamePromptDismissed(true);
    if(promptUid&&promptLogin!=null)writeAssistantPromptSession(promptUid,{count:promptLogin,dismissed:true});
  };
  const saveWelcomeName=async(useDefault)=>{
    const nm=useDefault?"ORDANIS":((welcomeName||"").trim().slice(0,40)||"ORDANIS");
    setSavingWelcome(true);setWelcomeErr("");
    try{
      await saveAssistantName(family.id,nm);
      if(reload)await reload("families");
      dismissNamePrompt();
    }catch(e){
      // Stay open and say so -- silently closing is what hid the failed save before.
      setWelcomeErr(e&&e.message?e.message:"Couldn't save the name. Please try again.");
    }finally{ setSavingWelcome(false); }
  };
  // Plan preview video: offered on sign-in until played once (or offered 3 times); then only the link.
  const planVideoPlan=String(clientPlan||"").toLowerCase();
  // Households that belong to a firm are left out: the videos are ORDANIS-branded and a firm's clients
  // should hear about their plan from the firm.
  const hasPlanVideo=!!(userProfile&&userProfile.role==="client"&&PLAN_VIDEO_FILE[planVideoPlan]&&!fam.enterprise_id&&!family.enterprise_id);
  const offerPlanVideo=hasPlanVideo&&!CAME_FROM_APP;  // the "watch the video" link in the greeting stays
  const[planVideo,setPlanVideo]=useState(null);          // {offers,seen}; null while being counted
  const[planVideoOfferDone,setPlanVideoOfferDone]=useState(false);
  const[planVideoWatching,setPlanVideoWatching]=useState(false);
  useEffect(()=>{
    if(!promptUid||!offerPlanVideo)return;
    let cancelled=false;
    recordPlanVideoOffer(promptUid).then(v=>{if(!cancelled)setPlanVideo(v);});
    return()=>{cancelled=true;};
  },[promptUid,offerPlanVideo]);
  const planVideoPending=offerPlanVideo&&planVideo===null;
  const showPlanVideoOffer=offerPlanVideo&&!!planVideo&&!planVideo.seen&&planVideo.offers<=3&&!planVideoOfferDone&&!showNamePrompt&&!promptPending;
  // Deliberately does not touch `planVideo`: the offer pop-up is the one playing the video, and flipping
  // "seen" here would unmount it mid-play. The saved flag and the tab cache are what stop the next offer.
  const planVideoMarked=useRef(false);
  const onPlanVideoPlayed=()=>{
    if(planVideoMarked.current)return;
    planVideoMarked.current=true;
    if(promptUid)markPlanVideoSeenSession(promptUid);
    sb.rpc("mark_plan_video_seen").then(()=>{},()=>{});
  };
  const[showAssistantGreeting,setShowAssistantGreeting]=useState(false);
  useEffect(()=>{
    if(!family?.id)return;
    if(CAME_FROM_APP)return;                    // arrived from the app to pay or add something: no greeting
    if(promptPending)return;                    // wait until we know whether to ask first
    if(showNamePrompt){ _greetedFamilies.add(family.id); return; }
    if(planVideoPending||showPlanVideoOffer)return;   // the video offer goes first; the greeting follows it
    if(_greetedFamilies.has(family.id))return;
    _greetedFamilies.add(family.id);
    setShowAssistantGreeting(true);
  },[family?.id,showNamePrompt,promptPending,planVideoPending,showPlanVideoOffer]);
  const properties=(data.properties||[]).filter(p=>p.familyId===family.id);
  const accounts=(data.portfolio_accounts||[]).filter(a=>a.familyId===family.id);
  const valuables=(data.valuables||[]).filter(v=>v.familyId===family.id);
  const loans=(data.loans||[]).filter(l=>l.familyId===family.id);
  const members=(data.contacts||[]).filter(c=>c.familyId===family.id);
  const professionals=(data.family_contacts||[]).filter(p=>p.familyId===family.id);
  const businessPartners=(data.family_partners||[]).filter(p=>p.familyId===family.id&&p.source==="household");
  const tasks=(data.tasks||[]).filter(t=>t.familyId===family.id&&!t.done);

  // ── Self-serve quick-add (Basic/Core, no assigned Expert) ─────────────────
  // Trimmed versions of FamilyDashboard's addProperty/addAccount/addValuable -- same tables, same
  // RLS (already allowed a client to write to their own family's rows; nothing enforced it, this
  // is purely the missing UI), fewer fields. See PropertyQuickForm/AccountQuickForm/
  // ValuableQuickForm above for why the fields differ from the admin forms.
  const addProperty=async f=>{
    const{error}=await sb.from("properties").insert({family_id:family.id,address:f.address,property_type:f.propertyType,purchase_price:f.purchasePrice||null,purchase_date:f.purchaseDate||null,current_value:f.currentValue||null,notes:f.notes||null});
    if(error){toast(error.message,"error");return false;}else{toast("Property added. Your record is looking more complete.");await reload("properties");}
  };
  // Basic and Core are self-service: no Expert keeps their properties up to date, so the household edits,
  // removes and attaches documents to its own properties, with the same form staff use. Same columns as the
  // staff side's editProperty; RLS already scopes every write to the household's own rows.
  const[editingProperty,setEditingProperty]=useState(null);
  const[propAttachIntent,setPropAttachIntent]=useState(null);
  const editClientProperty=async(id,f)=>{
    const row={owner_name:f.ownerName||null,address:f.address,property_type:f.propertyType,purchase_price:numOrNull(f.purchasePrice),purchase_date:f.purchaseDate||null,current_value:numOrNull(f.currentValue),lender:f.lender||null,loan_balance:numOrNull(f.loanBalance),interest_rate:numOrNull(f.interestRate),loan_payment:numOrNull(f.loanPayment),loan_maturity_date:f.loanMaturityDate||null,loan_type:f.loanType,rental_income:numOrNull(f.rentalIncome),property_taxes:numOrNull(f.propertyTaxes),utilities:numOrNull(f.utilities),insurance_company:f.insuranceCompany||null,insurance_premium:numOrNull(f.insurancePremium),insurance_expiration:f.insuranceExpiration||null,flood_insurance:!!f.floodInsurance,flood_insurance_company:f.floodInsurance?(f.floodInsuranceCompany||null):null,flood_insurance_premium:f.floodInsurance?numOrNull(f.floodInsurancePremium):null,flood_insurance_expiration:f.floodInsurance?(f.floodInsuranceExpiration||null):null,hoa_fee:Number(f.hoaFee)||0,property_management_fee_pct:Number(f.propertyManagementFeePct)||0,include_mortgage_in_cashflow:f.includeMortgageInCashflow!==false,second_mortgage_balance:numOrNull(f.secondMortgageBalance),second_mortgage_payment:numOrNull(f.secondMortgagePayment),notes:f.notes||null};
    const{error}=await sb.from("properties").update(row).eq("id",id).eq("family_id",family.id);
    if(error){toast(error.message,"error");return false;}
    toast("Property updated. All saved.");await reload("properties");
  };
  const delClientProperty=async p=>{
    if(!confirm(`Remove ${p.address||"this property"} and its details? Documents attached to it stay in CHRIS. This can't be undone.`))return;
    const{error}=await sb.from("properties").delete().eq("id",p.id).eq("family_id",family.id);
    if(error)toast(error.message,"error");else{toast("Property removed");await reload("properties");}
  };
  const startPropertyAttach=(propertyId,section)=>{setPropAttachIntent({propertyId,section});setActiveTab("documents");};
  // Valuables, self-serve: edit (with the policy details) and remove, same columns as the staff side.
  const[editingValuable,setEditingValuable]=useState(null);
  const editClientValuable=async(id,f)=>{
    const{error}=await sb.from("valuables").update(valuableRowFromForm(f)).eq("id",id).eq("family_id",family.id);
    if(error){toast(error.message,"error");return false;}
    toast("Valuable updated. All saved.");await reload("valuables");
  };
  // Loans & Lines, self-serve: add, edit, remove, attach a statement. Same columns as the staff side.
  const[loanModal,setLoanModal]=useState(null); // {loan?}
  const saveClientLoan=async(m,f)=>{
    if(loanOnListedProperty(m,f)){
      const e=await mortgageOntoProperty(family.id,properties.find(p=>`p:${p.id}`===f.securedBy),f);
      if(e){toast(e,"error");return false;}
      toast("Saved on the property.");await reload("properties");return;
    }
    const row=loanRowFromForm(f);
    const{error}=m.loan?await sb.from("loans").update(row).eq("id",m.loan.id).eq("family_id",family.id)
      :await sb.from("loans").insert({family_id:family.id,...row});
    if(error){toast(error.message,"error");return false;}
    toast(m.loan?"Loan updated. All saved.":"Loan added. Your record is looking more complete.");await reload("loans");
  };
  // Tasks the family keeps itself (every plan; needs "Edit records"). Same rows and rules as the Expert side's tasks:
  // a recurring task schedules its next occurrence when ticked off.
  const[taskModalOpen,setTaskModalOpen]=useState(false);
  const addClientTask=async f=>{
    const{error}=await sb.from("tasks").insert({family_id:family.id,contact_id:f.contactId||null,title:f.title,due_date:f.dueDate||null,priority:f.priority,reminder_days:reminderDaysOr7(f.reminderDays),done:false,recurrence:f.recurrence||null,recurrence_interval:f.recurrence==="Custom"?(Number(f.recurrenceInterval)||1):null,recurrence_unit:f.recurrence==="Custom"?(f.recurrenceUnit||"week"):null});
    if(error){toast(error.message,"error");return false;}
    toast("Task added.");await reload("tasks");
  };
  const completeClientTask=async t=>{
    const{error}=await sb.from("tasks").update({done:true,completed_at:new Date().toISOString(),completed_by:CURRENT_USER_LABEL||null}).eq("id",t.id).eq("family_id",family.id);
    if(error){toast(error.message,"error");return;}
    if(t.recurrence){
      const nd=nextRecurrence(t.dueDate,t.recurrence,t.recurrenceInterval,t.recurrenceUnit);
      if(nd)await scheduleNextOccurrence(t,family.id,nd,toast);
    }
    toast("Task done.");await reload("tasks");
  };
  const delClientTask=async t=>{
    if(!confirm(`Remove "${t.title}"? This can't be undone.`))return;
    const{error}=await sb.from("tasks").delete().eq("id",t.id).eq("family_id",family.id);
    if(error)toast(error.message,"error");else{toast("Task removed");await reload("tasks");}
  };
  const delClientLoan=async l=>{
    if(!confirm(`Remove ${loanTitle(l)}? Its statements stay in CHRIS. This can't be undone.`))return;
    const{error}=await sb.from("loans").delete().eq("id",l.id).eq("family_id",family.id);
    if(error)toast(error.message,"error");else{toast("Loan removed");await reload("loans");}
  };
  const delClientValuable=async v=>{
    if(!confirm(`Remove ${v.description||"this valuable"}? Its documents stay in CHRIS. This can't be undone.`))return;
    const{error}=await sb.from("valuables").delete().eq("id",v.id).eq("family_id",family.id);
    if(error)toast(error.message,"error");else{toast("Valuable removed");await reload("valuables");}
  };
  // Vendors and service providers on a property (property_contacts), self-serve households only, same
  // form and columns as the staff side.
  const[vendorModal,setVendorModal]=useState(null); // {propertyId, contact?}
  const saveVendor=async(m,f)=>{
    const fields={name:f.name,role:f.role||null,company:f.company||null,email:f.email||null,phone:f.phone||null,notes:f.notes||null};
    const{error}=m.contact
      ?await sb.from("property_contacts").update(fields).eq("id",m.contact.id).eq("family_id",family.id)
      :await sb.from("property_contacts").insert({...fields,property_id:m.propertyId,family_id:family.id});
    if(error){toast(error.message,"error");return false;}
    toast(m.contact?"Vendor updated. All saved.":"Vendor added. Your team is easy to find now.");await reload("property_contacts");
  };
  const delVendor=async c=>{
    if(!confirm(`Remove ${c.name||"this vendor"} from the property?`))return;
    const{error}=await sb.from("property_contacts").delete().eq("id",c.id).eq("family_id",family.id);
    if(error)toast(error.message,"error");else{toast("Vendor removed");await reload("property_contacts");}
  };
  const addAccount=async f=>{
    const{error}=await sb.from("portfolio_accounts").insert({family_id:family.id,institution:f.institution,account_type:f.accountType,starting_balance:numOrNull(f.startingBalance),current_balance:numOrNull(f.currentBalance),account_advisor_name:f.accountAdvisorName||null,account_advisor_phone:f.accountAdvisorPhone||null,account_advisor_email:f.accountAdvisorEmail||null,notes:f.notes||null});
    if(error){toast(error.message,"error");return false;}else{toast("Account added. Your record is looking more complete.");await reload("portfolio_accounts");}
  };
  const addValuable=async f=>{
    const{error}=await sb.from("valuables").insert({family_id:family.id,category:f.category,description:f.description,make_model:f.makeModel||null,year:f.year||null,estimated_value:numOrNull(f.estimatedValue),notes:f.notes||null});
    if(error){toast(error.message,"error");return false;}else{toast("Valuable added. One more thing safely on file.");await reload("valuables");}
  };
  const addMember=async f=>{
    const{error}=await sb.from("contacts").insert({family_id:family.id,name:f.name,relationship:f.relationship||null,email:f.email||null,phone:f.phone||null,type:"Individual"});
    if(error){toast(error.message,"error");return false;}else{toast("Member added. Welcome to the household record.");await reload("contacts");}
  };
  const delMember=async id=>{if(!confirm("Remove this family member? This can't be undone."))return;
    const{error}=await sb.from("contacts").delete().eq("id",id);
    if(error)toast(error.message,"error");else{toast("Member removed");await reload("contacts");}
  };
  const addProfessional=async f=>{
    const{error}=await sb.from("family_contacts").insert({family_id:family.id,name:f.name,role:f.role||null,company:f.company||null,email:f.email||null,phone:f.phone||null,is_advisor:false});
    if(error){toast(error.message,"error");return false;}else{toast("Contact added. Your team is easy to find now.");await reload("family_contacts");}
  };
  const delProfessional=async id=>{if(!confirm("Remove this professional? This can't be undone."))return;
    const{error}=await sb.from("family_contacts").delete().eq("id",id);
    if(error)toast(error.message,"error");else{toast("Contact removed");await reload("family_contacts");}
  };
  // ── Business Partner portal seats ($5/mo each, self-serve only) ──────────
  // All of the actual work -- creating the login, emailing the invite, and the Stripe seat count
  // -- happens in manage-business-partner; this just calls it and reloads. See that function for
  // why an existing family_contacts row and a portal login are two separate things (one free, one
  // billed) rather than the same record.
  // supabase-js hides the function's own error text behind a generic "non-2xx" message; the real reason is
  // in the response body, so read it from there.
  const fnErrorText=async(error,fallback)=>{
    try{const j=await error.context?.json?.();if(j&&j.error)return j.error;}catch(_e){}
    return error.message||fallback;
  };
  const addBusinessPartner=async(email,fullName,phone)=>{
    const{data:resp,error}=await sb.functions.invoke("manage-business-partner",{body:{family_id:family.id,action:"invite",email,full_name:fullName,phone,email_confirmed:true,redirect_to:window.location.origin}});
    if(error){toast(await fnErrorText(error,"Could not send the invite."),"error");return false;}
    if(resp&&resp.error){toast(resp.error,"error");return false;}
    if(resp&&resp.pending){
      toast("This person already has an ORDANIS professional login. We've asked them to accept; nothing is visible to them until they do.");
    }else if(resp&&resp.email_sent===false){
      toast(`Access was granted, but the email could not be sent (${resp.email_error||"unknown reason"}). Add the same person again to resend it.`,"error");
    }else{
      toast(resp&&resp.resent?"This person already had access. The invitation was sent again.":"Invite sent");
    }
    await reload("family_partners");await reload("families");
    return true;
  };
  const removeBusinessPartner=async partnerUserId=>{
    const{data:resp,error}=await sb.functions.invoke("manage-business-partner",{body:{family_id:family.id,action:"remove",partner_user_id:partnerUserId}});
    if(error){toast(await fnErrorText(error,"Could not remove portal access."),"error");return;}
    if(resp&&resp.error){toast(resp.error,"error");return;}
    toast("Portal access removed");
    await reload("family_partners");await reload("families");
  };
  const[addPropertyOpen,setAddPropertyOpen]=useState(false);
  const[addAccountOpen,setAddAccountOpen]=useState(false);
  const[addValuableOpen,setAddValuableOpen]=useState(false);
  const[addMemberOpen,setAddMemberOpen]=useState(false);
  const[addProfessionalOpen,setAddProfessionalOpen]=useState(false);
  const[addPartnerOpen,setAddPartnerOpen]=useState(false);
  const[savingQuickAdd,setSavingQuickAdd]=useState(false);
  const runQuickAdd=(fn,close)=>async f=>{setSavingQuickAdd(true);try{const r=await fn(f);if(r!==false)close();return r;}finally{setSavingQuickAdd(false);}};

  // Onboarding wizard: opens once on its own for a brand-new, empty, self-serve household. "Seen" is remembered on
  // the household (families.onboarding_wizard_seen_at, migration 20261023100000), so it doesn't come back on another
  // device or browser; localStorage is kept as a fallback for a database without that column. The client can
  // reopen it any time from the "Setup guide" link on the Summary tab.
  const[wizardOpen,setWizardOpen]=useState(false);
  const wizardSeenKey=`ordanis_onboarding_wizard_seen_${family.id}`;
  useEffect(()=>{
    if(!selfEdit||!clientSelfServe)return; // Premier's Expert sets the household up, so the wizard doesn't open on its own there
    // The "name your assistant" prompt goes first on a first/second login; the wizard opens once
    // that has been answered or dismissed, so the two never stack on top of each other.
    if(promptPending||showNamePrompt)return;
    if(properties.length||accounts.length||valuables.length||members.length||professionals.length)return;
    let seen=!!fam.onboarding_wizard_seen_at;
    try{seen=seen||localStorage.getItem(wizardSeenKey)==="1";}catch{}
    if(!seen)setWizardOpen(true);
  },[family.id,selfEdit,promptPending,showNamePrompt]);
  const closeWizard=()=>{
    try{localStorage.setItem(wizardSeenKey,"1");}catch{}
    setWizardOpen(false);
    if(!fam.onboarding_wizard_seen_at)sb.rpc("onboarding_wizard_mark_seen",{p_family_id:family.id}).then(()=>{},()=>{});
  };
  const totalRE=properties.reduce((s,p)=>s+(Number(p.currentValue)||Number(p.purchasePrice)||0),0);
  const totalDebt=properties.reduce((s,p)=>s+(Number(p.loanBalance)||0)+(Number(p.secondMortgageBalance)||0),0)+accounts.filter(a=>a.accountType==="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0)+loansDebt(loans);
  const totalAccounts=accounts.filter(a=>a.accountType!=="Line of Credit").reduce((s,a)=>s+(Number(a.currentBalance)||0),0);
  const totalValuables=valuables.reduce((s,v)=>s+(Number(v.estimatedValue)||0),0);
  const netWorth=totalRE-totalDebt+totalAccounts+totalValuables;
  const overdue=tasks.filter(t=>t.dueDate&&dueEnd(t.dueDate)<new Date());
  const soon=tasks.filter(t=>!overdue.includes(t)&&t.dueDate&&(dueEnd(t.dueDate)-new Date())/(86400000)<=30);

  const TABS=[
    {id:"summary",   label:"Summary",    icon:"◈"},
    ...(clientSelfServe||clientPlan==="premier"?[{id:"household",label:"Household",icon:"◎"}]:[]),
    {id:"properties",label:"Properties", icon:"⌂"},
    {id:"portfolio", label:"Portfolio",  icon:"◇"},
    {id:"loans",     label:"Loans & Lines",icon:"≡"},
    {id:"cashflow",  label:"Cash Flow",  icon:"$"},
    ...(clientHasWorkflows?[{id:"workflows",label:"Workflows",icon:"▦"}]:[]),
    {id:"valuables", label:"Valuables",  icon:"◆"},
    {id:"tasks",     label:"Tasks",      icon:"◻"},
    {id:"documents", label:"CHRIS",  icon:"📁"},
    {id:"billing",   label:"Billing",   icon:"💳"},
    // Last in the row on purpose, and flagged so the renderer can mark it with a star: the
    // other tabs are ledgers, this one is the assistant.
    {id:"assistant", label:"Ask "+assistantName,   icon:"✦", assistant:true},
  ];
  // Mobile nav: a top-left hamburger opening a slide-in drawer, same off-canvas pattern as the
  // admin shell's own sidebar (see PortalShell's sidebarOpen) -- replaces the old fixed bottom
  // tab bar, which squeezed 9+ tabs into one thin strip along the bottom of the screen.
  const[navOpen,setNavOpen]=useState(false);

  return <div style={{minHeight:"100vh",background:B.bg,fontFamily:"'DM Sans','Helvetica Neue',sans-serif"}}>

    {showNamePrompt&&<Modal title={promptLogin===2?"Your assistant's name":"Meet your assistant"} onClose={dismissNamePrompt}>
      <div style={{fontSize:14,color:B.text,lineHeight:1.55,marginBottom:18}}>
        {promptLogin===2
          ? <>We noticed that you didn't choose to change the name of your assistant. Would you like to do that now?
              <br/><br/>
              If not, you can always change it from the "Ask {assistantName}" tab — use the pencil next to the name.</>
          : <>You have a personal AI assistant that can answer questions about your dashboard — your net worth, properties, loans, insurance, tasks, and documents. It only ever sees your own information.
              <br/><br/>
              What would you like to call it? You can always change this later.</>}
      </div>
      <Field label="Assistant name">
        <Inp autoFocus placeholder="e.g. ORDANIS, Ace, Atlas…" value={welcomeName} maxLength={40}
          onChange={e=>setWelcomeName(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!savingWelcome)saveWelcomeName(false);}}/>
      </Field>
      {welcomeErr&&<div style={{marginTop:10,fontSize:13,color:B.red||"#b3261e"}}>{welcomeErr}</div>}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",alignItems:"center",marginTop:18}}>
        {promptLogin===2
          ? <button onClick={dismissNamePrompt} disabled={savingWelcome} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Not now</button>
          : <button onClick={()=>saveWelcomeName(true)} disabled={savingWelcome} style={{background:"none",border:"none",color:B.textSoft,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Skip — use "ORDANIS"</button>}
        <Btn onClick={()=>saveWelcomeName(false)} disabled={savingWelcome}>{savingWelcome?"Saving…":"Save name"}</Btn>
      </div>
    </Modal>}

    {showPlanVideoOffer&&<PlanVideoModal plan={planVideoPlan} mode="offer" onPlayed={onPlanVideoPlayed} onClose={()=>setPlanVideoOfferDone(true)}/>}
    {showAssistantGreeting&&!showNamePrompt&&<AssistantWelcome family={family} data={data} reload={reload} userProfile={userProfile} onClose={()=>setShowAssistantGreeting(false)} toast={toast} onWatchVideo={hasPlanVideo?()=>setPlanVideoWatching(true):undefined}/>}
    {planVideoWatching&&<PlanVideoModal plan={planVideoPlan} mode="watch" onPlayed={onPlanVideoPlayed} onClose={()=>setPlanVideoWatching(false)}/>}
    {emailAdvisorOpen&&<EmailAdvisorModal family={family} userProfile={userProfile} data={data} onClose={()=>setEmailAdvisorOpen(false)}/>}
    {wizardOpen&&<OnboardingWizard userProfile={userProfile} onClose={closeWizard} addMember={addMember} addProfessional={addProfessional} addBusinessPartner={addBusinessPartner} addProperty={addProperty} addAccount={addAccount} addValuable={addValuable} members={members} professionals={professionals} properties={properties} accounts={accounts} valuables={valuables} familyId={family.id} toast={toast} reload={reload}/>}
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>

    {/* Header (white banner with logo, family name, sign out) */}
    <div style={{background:B.white,padding:isMobile?"0 16px":"0 32px",borderBottom:`1px solid ${B.borderLight}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:isMobile?"12px 0":"16px 0",gap:10,flexWrap:isMobile?"wrap":"nowrap"}}>
        {/* Phones: the logo centered on its own row, then the family name on the left with the buttons on the right. */}
        <div style={{display:"flex",alignItems:"center",gap:6,flexBasis:isMobile?"100%":"auto",justifyContent:isMobile?"center":"flex-start"}}>
          <PCMLogo compact/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:isMobile?8:16,flex:isMobile?"1 1 100%":"none",justifyContent:"flex-start"}}>
          <div style={{textAlign:isMobile?"left":"right",minWidth:0,flex:isMobile?1:"none"}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:isMobile?16:22,color:B.navy,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{family.name}</div>
            {/* The relationship, on the client's own banner. Small, but on every screen they see.
                Gold fill for Premier, gold outline for Core — both read as a membership mark rather
                than as a limit, which matters because the client sees this one and the tier below
                should not look like a demotion. */}
            <div style={{fontSize:isMobile?10:11,color:B.textSoft,marginTop:3,display:"flex",alignItems:"center",gap:6,justifyContent:isMobile?"flex-start":"flex-end",flexWrap:"wrap"}}>
              <span style={{fontSize:isMobile?9:9.5,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
                padding:"2px 7px",borderRadius:3,whiteSpace:"nowrap",
                background:clientHasExpert?B.gold:"transparent",
                border:`1px solid ${B.gold}`,
                color:B.navy}}>{planLabel(clientPlan)}</span>
              <span>·</span>
              <span>{isMobile?"Client Portal":`Client Portal · ${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}`}</span>
            </div>
          </div>
          {clientHasExpert&&<button onClick={()=>setEmailAdvisorOpen(true)} style={{background:"rgba(206,182,132,0.15)",border:`1px solid ${B.gold}`,color:B.navy,borderRadius:8,padding:isMobile?"6px 10px":"6px 14px",fontSize:11,cursor:"pointer",fontFamily:"inherit",flexShrink:0,fontWeight:600}}>{isMobile?"✉ ORDANIS Expert":"✉ Email my ORDANIS Expert"}</button>}
          <SecurityButton role={userProfile?.role} toast={toast} label={isMobile?"🔒":"🔒 Security"} style={{background:"transparent",border:`1px solid ${B.border}`,color:B.textSoft,borderRadius:8,padding:isMobile?"6px 10px":"6px 14px",fontSize:11,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}/>
          <button onClick={logout} style={{background:"transparent",border:`1px solid ${B.border}`,color:B.textSoft,borderRadius:8,padding:isMobile?"6px 10px":"6px 14px",fontSize:11,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>Sign Out</button>
        </div>
      </div>
    </div>

    {/* Gold accent line */}
    <div style={{height:2,background:`linear-gradient(90deg,${B.gold},${B.goldLight}55,transparent)`}}/>
    {/* Phones: the sections as one menu button (same as the team's household view). */}
    {isMobile&&<HouseholdSectionMenu items={TABS} activeTab={activeTab} onPick={setActiveTab}/>}

    {/* Top Tabs (desktop only) — folder tabs, matching the advisor view.
        The active tab's bottom border is the page colour, so it merges into the content
        below rather than sitting on a line above it. */}
    {/* Inset-shadow baseline for the same reason as the staff tab row: the active tab covers it. */}
    {!isMobile&&<div style={{boxShadow:`inset 0 -1px 0 ${B.border}`,background:B.bg,padding:"8px 32px 0",display:"flex",gap:2,alignItems:"flex-end",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
      {TABS.map(t=>{
        const on=activeTab===t.id;
        return <button key={t.id} className="pcm-tab" onClick={()=>setActiveTab(t.id)} aria-current={on?"page":undefined}
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
            // The active tab's white bottom edge sits over the row's inset baseline.
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

    {/* Mobile nav drawer (replaces the old fixed bottom tab bar) -- backdrop + slide-in panel
        from the left, opened by the hamburger in the header above. */}
    {isMobile&&navOpen&&<div onClick={()=>setNavOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:199,backdropFilter:"blur(2px)"}}/>}
    {isMobile&&<div style={{position:"fixed",top:0,bottom:0,left:navOpen?0:-280,width:260,paddingTop:"env(safe-area-inset-top)",paddingBottom:"env(safe-area-inset-bottom)",boxSizing:"border-box",background:B.white,borderRight:`1px solid ${B.borderLight}`,zIndex:200,transition:"left 0.25s ease",boxShadow:navOpen?"4px 0 24px rgba(0,0,0,0.15)":"none",display:"flex",flexDirection:"column",overflowY:"auto"}}>
      <div style={{padding:"18px 18px 14px",borderBottom:`1px solid ${B.borderLight}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:B.navy,fontWeight:600}}>Menu</span>
        <button onClick={()=>setNavOpen(false)} style={{background:"none",border:"none",fontSize:20,color:B.textSoft,cursor:"pointer",padding:4,lineHeight:1}} aria-label="Close menu">✕</button>
      </div>
      <div style={{padding:"8px 0",flex:1}}>
        {TABS.map(t=>{
          const on=activeTab===t.id;
          return <button key={t.id} onClick={()=>{setActiveTab(t.id);setNavOpen(false);}} aria-current={on?"page":undefined}
            style={{display:"flex",alignItems:"center",gap:12,width:"100%",boxSizing:"border-box",background:on?"rgba(206,182,132,0.12)":"transparent",border:"none",borderLeft:on?`3px solid ${B.gold}`:"3px solid transparent",color:on?B.navy:B.textSoft,fontFamily:"inherit",fontSize:14,fontWeight:on?700:500,padding:"12px 18px",cursor:"pointer",textAlign:"left"}}>
            {t.assistant&&<span aria-hidden="true" style={{color:on?B.gold:B.navyMid,fontSize:13,flexShrink:0}}>✦</span>}
            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.label}</span>
          </button>;
        })}
      </div>
    </div>}

    {/* Content */}
    <style>{TAB_MOTION_CSS}</style>
    <div ref={tabPanelRef} style={{maxWidth:1100,margin:"0 auto",padding:isMobile?"16px 14px":"28px 24px"}}>

      {/* Invited by the team to pay by card (invite-client): ask for a card until Stripe has a subscription. */}
      {fam.billing_setup_required&&!fam.stripe_subscription_id&&myPerm.manage&&<div style={{background:"rgba(206,182,132,0.14)",border:`1px solid ${B.gold}`,borderRadius:12,padding:"14px 18px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <div style={{fontSize:13.5,color:B.text,lineHeight:1.55,flex:"1 1 280px"}}>
          <strong style={{color:B.navy}}>Add a card to start your {planLabel(clientPlan)} plan</strong>
          {(()=>{const p=billingPlans.find(x=>x.plan===clientPlan);return p?<> ({fmtMoney(p.monthly_price)}/month)</>:null;})()}.
          {" "}It takes a minute on Stripe's secure page. Have a promotion code? You can enter it there.
        </div>
        {IS_NATIVE_APP?<Btn onClick={()=>openOnWeb("billing")}>Add a card on the website ↗</Btn>:<Btn disabled={cardCheckoutBusy} onClick={startCardCheckout}>{cardCheckoutBusy?"Opening…":"Add a card"}</Btn>}
      </div>}

      {/* SUMMARY */}
      {activeTab==="summary"&&<div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,color:B.navy,fontWeight:600,marginBottom:6}}>
          Good {new Date().getHours()<12?"Morning":new Date().getHours()<17?"Afternoon":"Evening"}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:12,flexWrap:"wrap",marginBottom:24}}>
          <div style={{color:B.textSoft,fontSize:14}}>Here is your financial overview as of {new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
          {/* Reopens the onboarding wizard on demand (self-directed households, who set up their own records). */}
          {selfEdit&&<button onClick={()=>setWizardOpen(true)} style={{background:"none",border:"none",padding:0,color:B.navyMid,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline",textUnderlineOffset:3}}>Setup guide</button>}
        </div>
        <HouseholdTeamCard familyId={family.id}/>

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
          <div><div style={{fontWeight:700,color:"#8b1a1a",fontSize:14}}>Overdue Tasks</div><div style={{fontSize:13,color:"#8b1a1a"}}>{overdue.length} task{overdue.length>1?"s":""} past due — {clientHasExpert?"please contact your ORDANIS Expert.":"open Tasks to take care of them."}</div></div>
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
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>Investment Portfolio</div>
          {selfEdit&&<Btn small onClick={()=>setAddAccountOpen(true)}>+ Add Account</Btn>}
        </div>
        {addAccountOpen&&<Modal title="Add a portfolio account" onClose={()=>setAddAccountOpen(false)}>
          <AccountQuickForm saving={savingQuickAdd} onCancel={()=>setAddAccountOpen(false)} onSave={runQuickAdd(addAccount,()=>setAddAccountOpen(false))}/>
        </Modal>}
        {accounts.length===0?<Empty text="No portfolio accounts on file yet."/>:accounts.map(a=>{
          const pct=pctChange(a.startingBalance,a.currentBalance);
          const gain=(Number(a.currentBalance)||0)-(Number(a.startingBalance)||0);
          const open=isCardOpen("acct-"+a.id),cr=collapseRow(open,()=>toggleCard("acct-"+a.id));
          return <div key={a.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${B.gold}`,borderRadius:12,padding:isMobile?18:24,marginBottom:isMobile?12:16,boxShadow:B.shadow}}>
            <div {...cr} style={{...cr.style,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:open&&pct!==null?16:0}}>
              <div style={{minWidth:0}}><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600}}>{a.institution}</div><div style={{fontSize:13,color:B.textSoft}}>{a.accountType}{a.bankerName?` · ${a.bankerName}`:""}</div></div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,color:B.navy,fontWeight:600}}>{fmtMoney(a.currentBalance)}<Chevron open={open}/></div>
                {pct!==null&&<div style={{fontSize:13,fontWeight:700,color:Number(pct)>=0?"#18a850":"#d43030"}}>{Number(pct)>=0?"+":""}{pct}% ({Number(gain)>=0?"+":"-"}{fmtMoney(Math.abs(gain))})</div>}
              </div>
            </div>
            {open&&pct!==null&&<div style={{background:Number(pct)>=0?"#e0f5e9":"#fde8e8",borderRadius:10,padding:"14px 18px",display:"flex",alignItems:"center",gap:16}}>
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

      {/* LOANS & LINES -- self-serve households keep their own; Premier households see what their Expert keeps. */}
      {activeTab==="loans"&&<div>
        <LoansPanel loans={loans} properties={properties} valuables={valuables} accounts={accounts} documents={(data.documents||[]).filter(d=>d.familyId===family.id)}
          locAccounts={accounts.filter(a=>a.accountType==="Line of Credit")} toast={toast}
          onAdd={selfEdit?kind=>setLoanModal({kind}):null} onEdit={selfEdit?l=>setLoanModal({loan:l}):null} onDelete={selfEdit?delClientLoan:null}
          onEditProperty={selfEdit?p=>setEditingProperty(p):null}
          onAttach={selfUpload?l=>{setPropAttachIntent({loanId:l.id,section:"loan_statement"});setActiveTab("documents");}:null}/>
        {loanModal&&selfEdit&&<Modal title={loanModal.loan?"Edit loan or line":({"Credit Card":"Add a credit card","Auto Loan":"Add a car loan","Line of Credit":"Add a line of credit",Mortgage:"Add a mortgage"}[loanModal.kind]||"Add a loan")} onClose={()=>setLoanModal(null)}>
          <LoanForm initial={loanModal.loan} defaultType={loanModal.kind||"Auto Loan"} properties={properties} valuables={valuables} accounts={accounts}
            statement={loanModal.loan?{familyId:family.id,loanId:loanModal.loan.id,toast,onUploaded:()=>reload("documents"),
              doc:(data.documents||[]).find(d=>d.loanId===loanModal.loan.id&&d.propertySection==="loan_statement")||null}:null}
            onSave={f=>saveClientLoan(loanModal,f)} onClose={()=>setLoanModal(null)}/>
        </Modal>}
        {/* A property's mortgage is edited on the property itself; the same form opens from here. */}
        {editingProperty&&selfEdit&&<Modal title="Edit Property" wide onClose={()=>setEditingProperty(null)}>
          <PropertyForm initial={editingProperty} canExtract={false} onSave={async f=>{const r=await editClientProperty(editingProperty.id,f);if(r!==false)setEditingProperty(null);return r;}} onClose={()=>setEditingProperty(null)}/>
        </Modal>}
      </div>}

      {/* PROPERTIES */}
      {activeTab==="properties"&&<div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>Property Holdings</div>
          {selfEdit&&<Btn small onClick={()=>setAddPropertyOpen(true)}>+ Add Property</Btn>}
        </div>
        {addPropertyOpen&&<Modal title="Add a property" onClose={()=>setAddPropertyOpen(false)}>
          <PropertyQuickForm saving={savingQuickAdd} onCancel={()=>setAddPropertyOpen(false)} onSave={runQuickAdd(addProperty,()=>setAddPropertyOpen(false))}/>
        </Modal>}
        {vendorModal&&selfEdit&&<Modal title={vendorModal.contact?"Edit vendor":"Add a vendor"} onClose={()=>setVendorModal(null)}>
          <PropertyContactForm initial={vendorModal.contact?{name:vendorModal.contact.name||"",role:vendorModal.contact.role||"",company:vendorModal.contact.company||"",email:vendorModal.contact.email||"",phone:vendorModal.contact.phone||"",notes:vendorModal.contact.notes||""}:null}
            onSave={async f=>{const r=await saveVendor(vendorModal,f);if(r!==false)setVendorModal(null);return r;}} onClose={()=>setVendorModal(null)}/>
        </Modal>}
        {editingProperty&&selfEdit&&<Modal title="Edit Property" wide onClose={()=>setEditingProperty(null)}>
          <PropertyForm initial={editingProperty} canExtract={false} onSave={async f=>{const r=await editClientProperty(editingProperty.id,f);if(r!==false)setEditingProperty(null);return r;}} onClose={()=>setEditingProperty(null)}/>
        </Modal>}
        {properties.length===0?<Empty text="No properties on file yet."/>:(()=>{
          const bySort=(a,b)=>((Number.isFinite(Number(a.sortOrder))?Number(a.sortOrder):1e9)-(Number.isFinite(Number(b.sortOrder))?Number(b.sortOrder):1e9))||(new Date(a.createdAt||0)-new Date(b.createdAt||0));
          const groups=[...PROP_TYPES,"Other"].map(type=>({type,list:properties.filter(p=>type==="Other"?!PROP_TYPES.includes(p.propertyType):p.propertyType===type).sort(bySort)})).filter(g=>g.list.length>0);
          const card=p=>{const open=isCardOpen("prop-"+p.id),cr=collapseRow(open,()=>toggleCard("prop-"+p.id));return <div key={p.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${B.gold}`,borderRadius:12,padding:isMobile?18:24,marginBottom:isMobile?12:16,boxShadow:B.shadow}}>
          <div {...cr} style={{...cr.style,display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:open?12:0,gap:12}}>
            <div style={{minWidth:0}}><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600}}>{p.address}</div>{p.ownerName&&<div style={{fontSize:13,color:B.textSoft,marginTop:2}}>{p.ownerName}</div>}</div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>{fmtMoney(p.currentValue||p.purchasePrice)}<Chevron open={open}/></div>
              <div style={{fontSize:12,color:B.textSoft}}>Current Value</div>
            </div>
          </div>
          {open&&<>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
            <Btn small variant="ghost" onClick={()=>window.open(`https://www.zillow.com/homes/${encodeURIComponent(p.address||"")}_rb/`,"_blank","noopener,noreferrer")}>🔗 Zillow</Btn>
            <Btn small variant="ghost" onClick={()=>window.open(`https://www.google.com/search?q=${encodeURIComponent(`"${p.address||""}" property tax records`)}`,"_blank","noopener,noreferrer")}>🏛 Tax Records</Btn>
            {selfEdit&&<Btn small variant="ghost" onClick={()=>setEditingProperty(p)}>Edit</Btn>}
            {selfEdit&&<Btn small variant="danger" onClick={()=>delClientProperty(p)}>Remove</Btn>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(140px,100%),1fr))",gap:10}}>
            {[["Property Type",p.propertyType],["Purchase Price",fmtMoney(p.purchasePrice)],["Purchase Date",fmt(p.purchaseDate)],["Lender",p.lender||"—","mortgage"],["Loan Balance",fmtMoney(p.loanBalance),"mortgage"],["Interest Rate",fmtPct(p.interestRate)],["Monthly Payment",fmtMoney(p.loanPayment)],...(Number(p.secondMortgageBalance)>0?[["2nd Mtg Balance",fmtMoney(p.secondMortgageBalance)],["2nd Mtg Payment",p.secondMortgagePayment?`${fmtMoney(p.secondMortgagePayment)}/mo`:"—"]]:[]),["Loan Maturity",fmt(p.loanMaturityDate)],["Rental Income",p.rentalIncome?`${fmtMoney(p.rentalIncome)}/mo`:"—","rental"],["Property Taxes",p.propertyTaxes?`${fmtMoney(p.propertyTaxes)}/yr`:"—","tax"],["Insurance",p.insuranceCompany||"—","insurance_dec"],["Insurance Expires",p.insuranceExpiration?fmt(p.insuranceExpiration):"—"],["Flood Insurance",p.floodInsurance?"Yes":"No","flood_dec"]].map(([l,v,sec])=><div key={l} style={{background:B.bg,borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:3}}>{l}{sec&&(docForSection(p.id,sec)?<DocLink doc={docForSection(p.id,sec)} toast={toast}/>:(selfUpload?<AttachLink section={sec} onClick={()=>startPropertyAttach(p.id,sec)}/>:null))}</div>
              <div style={{fontSize:13,color:B.text,fontWeight:600}}>{v}</div>
            </div>)}
          </div>
          <PropertySecuredLoans loans={loans} propertyId={p.id} onOpen={selfEdit?l=>{setActiveTab("loans");setLoanModal({loan:l});}:null}/>
          {(()=>{const vendors=(data.property_contacts||[]).filter(pc=>pc.propertyId===p.id);return <div style={{marginTop:16,paddingTop:12,borderTop:`1px solid ${B.borderLight}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{fontSize:11,color:B.textMute,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase"}}>Vendors & Service Providers</div>
              {selfEdit&&<Btn small variant="ghost" onClick={()=>setVendorModal({propertyId:p.id})}>+ Add vendor</Btn>}
            </div>
            {vendors.length===0
              ? <div style={{fontSize:12,color:B.textMute}}>None on file yet.{selfEdit?" Add the plumber, landscaper, property manager or anyone else who looks after it.":""}</div>
              : <div style={{display:"flex",flexDirection:"column",gap:6}}>{vendors.map(c=><div key={c.id} style={{background:B.bg,borderRadius:6,padding:"6px 10px",position:"relative",paddingRight:selfEdit?110:10}}>
                  {selfEdit&&<div style={{position:"absolute",top:6,right:8,display:"flex",gap:10}}>
                    <button onClick={()=>setVendorModal({propertyId:p.id,contact:c})} style={{background:"none",border:"none",color:B.navyMid,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:600,padding:0}}>Edit</button>
                    <button onClick={()=>delVendor(c)} style={{background:"none",border:"none",color:B.textMute,fontSize:12,cursor:"pointer",fontFamily:"inherit",padding:0}}>Remove</button>
                  </div>}
                  <div style={{fontSize:12,fontWeight:600,color:B.navy}}>{c.name}{c.role&&<span style={{fontWeight:400,color:B.textSoft,marginLeft:6}}>· {c.role}</span>}</div>
                  <div style={{fontSize:11,color:B.textSoft,display:"flex",gap:10,flexWrap:"wrap",marginTop:1}}>{c.company&&<span>{c.company}</span>}{c.phone&&<span>📞 <PhoneLink value={c.phone}/></span>}{c.email&&<span>✉ <EmailLink value={c.email}/></span>}</div>
                </div>)}</div>}
          </div>;})()}
          </>}
        </div>;};
          return groups.map(g=><div key={g.type} style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:6,borderBottom:`2px solid ${B.gold}`}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:700}}>{g.type}</div>
              <div style={{background:B.navy,color:B.white,borderRadius:20,minWidth:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,padding:"0 7px"}}>{g.list.length}</div>
            </div>
            {g.list.map(card)}
          </div>);
        })()}
      </div>}

      {/* HOUSEHOLD -- Household Members (contacts) + Professional Network (family_contacts),
          self-serve only. Same tables/RLS the onboarding wizard's member/professional steps write
          to -- this tab is where a household reviews or adds to what it entered there, or adds
          from scratch if it skipped the wizard. Premier doesn't get this tab: an assigned Expert
          already maintains this for that household on the staff side. */}
      {activeTab==="household"&&(clientSelfServe||clientPlan==="premier")&&<div>
        <HouseholdLogins familyId={family.id} userProfile={userProfile} toast={toast}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>Household Members</div>
          {myPerm.edit&&<Btn small onClick={()=>setAddMemberOpen(true)}>+ Add Member</Btn>}
        </div>
        {addMemberOpen&&<Modal title="Add a household member" onClose={()=>setAddMemberOpen(false)}>
          <MemberQuickForm saving={savingQuickAdd} onCancel={()=>setAddMemberOpen(false)} onSave={runQuickAdd(addMember,()=>setAddMemberOpen(false))}/>
        </Modal>}
        {members.length===0?<Empty text="No household members on file yet."/>:<div style={{marginBottom:28}}>
          {members.map(m=><div key={m.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"14px 18px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:B.shadow,gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{m.name}{m.relationship&&<span style={{fontWeight:400,color:B.textSoft,marginLeft:8}}>· {m.relationship}</span>}</div>
              <div style={{fontSize:12,color:B.textSoft,display:"flex",gap:10,flexWrap:"wrap",marginTop:2}}>{m.phone&&<span>📞 <PhoneLink value={m.phone}/></span>}{m.email&&<span>✉ <EmailLink value={m.email}/></span>}</div>
            </div>
            {myPerm.edit&&<button onClick={()=>delMember(m.id)} style={{background:"none",border:"none",color:B.textMute,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Remove</button>}
          </div>)}
        </div>}

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>Professional Network</div>
          {myPerm.edit&&<Btn small onClick={()=>setAddProfessionalOpen(true)}>+ Add Contact</Btn>}
        </div>
        {addProfessionalOpen&&<Modal title="Add a professional contact" onClose={()=>setAddProfessionalOpen(false)}>
          <ProfessionalQuickForm saving={savingQuickAdd} allowPortalGrant={!IS_NATIVE_APP||clientPlan==="premier"||fam.paid_by==="enterprise"} partnerSeatFree={clientPlan==="premier"} onCancel={()=>setAddProfessionalOpen(false)} onSave={async f=>{setSavingQuickAdd(true);try{const r=await addProfessional(f);if(r===false)return r;if(f.grantPortalAccess)await addBusinessPartner(f.email,f.name,f.phone);setAddProfessionalOpen(false);}finally{setSavingQuickAdd(false);}}}/>
        </Modal>}
        {professionals.length===0?<Empty text="No professional contacts on file yet."/>:<div style={{marginBottom:28}}>
          {professionals.map(p=><div key={p.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"14px 18px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:B.shadow,gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{p.name}{p.role&&<span style={{fontWeight:400,color:B.textSoft,marginLeft:8}}>· {p.role}</span>}</div>
              <div style={{fontSize:12,color:B.textSoft,display:"flex",gap:10,flexWrap:"wrap",marginTop:2}}>{p.company&&<span>{p.company}</span>}{p.phone&&<span>📞 <PhoneLink value={p.phone}/></span>}{p.email&&<span>✉ <EmailLink value={p.email}/></span>}</div>
            </div>
            {myPerm.edit&&<button onClick={()=>delProfessional(p.id)} style={{background:"none",border:"none",color:B.textMute,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Remove</button>}
          </div>)}
        </div>}

        {/* Business Partner portal seats -- $5/mo each, separate from the free contact list
            above. A person can be in the Professional Network with no portal login (free), have a
            login without being listed there (e.g. invited straight from here), or both -- the two
            are deliberately independent records (see manage-business-partner). */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600}}>Business Partner Portal Access</div>
            <div style={{fontSize:12,color:B.textSoft,marginTop:2}}>Read-only logins to this household's portal{clientPlan==="premier"?" — included free with Premier.":" — $5.00/month each."} Add one with the button at right, or from the Professional Network form above.</div>
          </div>
          {myPerm.manage&&(IS_NATIVE_APP&&clientPlan!=="premier"&&fam.paid_by!=="enterprise"
            ?<Btn small onClick={()=>openOnWeb("household")}>Add on the website ↗</Btn>
            :<Btn small onClick={()=>setAddPartnerOpen(true)}>+ Add Business Partner</Btn>)}
        </div>
        {addPartnerOpen&&<Modal title="Add a Business Partner" onClose={()=>setAddPartnerOpen(false)}>
          <BusinessPartnerQuickForm saving={savingQuickAdd} seatFree={clientPlan==="premier"} onCancel={()=>setAddPartnerOpen(false)} onSave={async f=>{setSavingQuickAdd(true);try{const ok=await addBusinessPartner(f.email.trim(),f.name.trim(),f.phone);if(ok)setAddPartnerOpen(false);return ok?undefined:false;}finally{setSavingQuickAdd(false);}}}/>
        </Modal>}
        {businessPartners.length===0?<Empty text="No portal seats granted yet."/>:<div>
          {businessPartners.map(p=><div key={p.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${B.gold}`,borderRadius:10,padding:"14px 18px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:B.shadow,gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{p.fullName||p.email}</div>
              <div style={{fontSize:12,color:B.textSoft,marginTop:2}}>{p.email} · invited {fmt(p.invitedAt)} · {clientPlan==="premier"?"Free":"$5.00/mo"}</div>
              {p.status==="pending"&&<div style={{fontSize:11.5,color:"#8a5c00",fontWeight:600,marginTop:3}}>Waiting for them to accept. Nothing is visible to them until they do, and no seat is billed.</div>}
            </div>
            {myPerm.manage&&<button onClick={()=>removeBusinessPartner(p.userId)} style={{background:"none",border:"none",color:B.textMute,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Revoke access</button>}
          </div>)}
        </div>}
      </div>}

      {/* CASH FLOW -- every plan can add and edit its own events; on Premier the Expert sees changes in Client Activity. */}
      {activeTab==="cashflow"&&<div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:8}}>Cash Flow Projection</div>
        <div style={{fontSize:14,color:B.textSoft,marginBottom:20}}>{clientSelfServe?"Add and manage your own income and expense events below.":"Your expected income and expenses. Your ORDANIS Expert keeps this up to date, and you can add or change events too."}</div>
        {/* fam, not the `family` prop, so the bill-pay gate reads the current plan. */}
        <CashFlowView family={fam} events={(data.cash_flow_events||[]).filter(e=>e.familyId===family.id)} paymentLog={(data.cash_flow_payment_log||[]).filter(p=>p.familyId===family.id)} properties={properties} vendors={vendorOptions} reload={reload} toast={toast||(()=>{})} readOnly={!selfEdit}/>
      </div>}

      {/* WORKFLOWS -- self-directed on Core: the household runs its own obligations/playbooks
          here, same component the admin/advisor side uses (ObligationsSection), with canEdit
          always true since there is no assigned Expert on this plan to gate it behind. */}
      {activeTab==="workflows"&&clientHasWorkflows&&<div>
        <ObligationsSection family={fam} data={data} toast={toast} canEdit={true} userProfile={userProfile}/>
      </div>}

      {/* VALUABLES */}
      {activeTab==="valuables"&&<div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>Personal Property & Valuables</div>
            <div style={{fontSize:14,color:B.textSoft,marginTop:4}}>Total estimated value: <strong style={{color:B.navy}}>{fmtMoney(totalValuables)}</strong></div>
          </div>
          {selfEdit&&<Btn small onClick={()=>setAddValuableOpen(true)}>+ Add Valuable</Btn>}
        </div>
        {addValuableOpen&&<Modal title="Add a valuable" onClose={()=>setAddValuableOpen(false)}>
          <ValuableQuickForm saving={savingQuickAdd} onCancel={()=>setAddValuableOpen(false)} onSave={runQuickAdd(addValuable,()=>setAddValuableOpen(false))}/>
        </Modal>}
        {editingValuable&&selfEdit&&<Modal title="Edit valuable" onClose={()=>setEditingValuable(null)}>
          <ValuableForm initial={editingValuable} policy={{familyId:family.id,valuableId:editingValuable.id,toast,onUploaded:()=>reload("documents"),
              doc:(data.documents||[]).find(d=>d.valuableId===editingValuable.id&&d.propertySection==="valuable_policy")||null}}
            onSave={f=>editClientValuable(editingValuable.id,f)} onClose={()=>setEditingValuable(null)}/>
        </Modal>}
        <div style={{marginBottom:20}}/>
        {valuables.length===0?<Empty text="No valuables on file yet."/>:VALUABLE_CATS.map(cat=>{
          // "Other" absorbs unrecognised categories so nothing is hidden.
          const items=valuables.filter(v=>cat==="Other"?!VALUABLE_CATS.includes(v.category)||v.category==="Other":v.category===cat);
          if(!items.length)return null;
          return <div key={cat} style={{marginBottom:20}}>
            <div style={{fontSize:12,fontWeight:800,color:B.textMute,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>{cat}</div>
            {items.map(v=>{const open=isCardOpen("val-"+v.id),cr=collapseRow(open,()=>toggleCard("val-"+v.id));return <div key={v.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid #8b5cf6`,borderRadius:10,padding:"16px 20px",marginBottom:8,boxShadow:B.shadow}}>
              <div {...cr} style={{...cr.style,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{v.description}</div>
                  {v.makeModel&&<div style={{fontSize:12,color:B.textSoft}}>{v.makeModel}{v.year?` · ${v.year}`:""}</div>}
                </div>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600,flexShrink:0}}>{fmtMoney(v.estimatedValue)}<Chevron open={open}/></div>
              </div>
              {open&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:12,marginTop:8,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:0}}>
                {v.insured?<div style={{fontSize:11,color:"#18a850",fontWeight:600,marginTop:3}}>✓ Insured{v.insuranceCompany?` — ${v.insuranceCompany}`:""}<DocLink doc={valuablesPolicyDoc()} toast={toast} label="📄 policy"/></div>:<div style={{fontSize:11,color:"#b4551f",fontWeight:600,marginTop:3}}>⚠ Not scheduled<DocLink doc={valuablesPolicyDoc()} toast={toast} label="📄 policy"/></div>}
                <ValuablePolicyDetails v={v} doc={(data.documents||[]).find(d=>d.valuableId===v.id&&d.propertySection==="valuable_policy")} toast={toast}
                  onAttach={selfUpload?()=>{setPropAttachIntent({valuableId:v.id,section:"valuable_policy"});setActiveTab("documents");}:null}/>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                {selfEdit&&<div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:4}}>
                  <button onClick={()=>setEditingValuable(v)} style={{background:"none",border:"none",color:B.navyMid,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:600,padding:0}}>Edit</button>
                  <button onClick={()=>delClientValuable(v)} style={{background:"none",border:"none",color:B.textMute,fontSize:12,cursor:"pointer",fontFamily:"inherit",padding:0}}>Remove</button>
                </div>}
              </div>
              </div>}
            </div>;})}
          </div>;
        })}
      </div>}

      {/* TASKS */}
      {activeTab==="tasks"&&<div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:20}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600}}>Tasks & Deadlines</div>
          {selfEdit&&<Btn onClick={()=>setTaskModalOpen(true)}>+ New Task</Btn>}
        </div>
        {taskModalOpen&&selfEdit&&<Modal title="New Task" onClose={()=>setTaskModalOpen(false)}>
          <TaskForm contacts={members} onSave={async f=>{const r=await addClientTask(f);if(r!==false)setTaskModalOpen(false);return r;}} onClose={()=>setTaskModalOpen(false)}/>
        </Modal>}
        {tasks.length===0?<div style={{textAlign:"center",padding:"60px 0",color:B.textMute}}><div style={{fontSize:40,marginBottom:12}}>✅</div>All caught up — no pending tasks.</div>:[...tasks].sort((a,b)=>a.dueDate>b.dueDate?1:-1).map(t=>{
          const isOD=t.dueDate&&dueEnd(t.dueDate)<new Date();
          const isSoon=!isOD&&t.dueDate&&(dueEnd(t.dueDate)-new Date())/(86400000)<=30;
          return <div key={t.id} style={{background:B.white,border:`1px solid ${isOD?"#f5c6c6":B.borderLight}`,borderLeft:`4px solid ${isOD?"#d43030":isSoon?"#d4900a":PRIORITY_COLORS[t.priority]?.dot||B.gold}`,borderRadius:10,padding:"16px 20px",marginBottom:10,boxShadow:B.shadow}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
              {selfEdit&&<input type="checkbox" checked={false} onChange={()=>completeClientTask(t)} title="Mark done" style={{width:16,height:16,accentColor:B.navy,cursor:"pointer",flexShrink:0,marginTop:2}}/>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{t.title}</div>
                {t.dueDate&&<div style={{fontSize:12,color:isOD?"#d43030":isSoon?"#d4900a":B.textSoft,marginTop:4,fontWeight:isOD||isSoon?700:400}}>{isOD?"⚠ Overdue · ":isSoon?"⏰ Due soon · ":""}{fmt(t.dueDate)}</div>}
              </div>
              <Badge scheme={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
              {selfEdit&&<button onClick={()=>delClientTask(t)} title="Remove task" style={{background:"none",border:"none",color:B.textMute,cursor:"pointer",fontSize:13,padding:0,flexShrink:0}}>✕</button>}
            </div>
          </div>;
        })}
      </div>}

      {/* CHRIS */}
      {activeTab==="documents"&&<div style={{height:"calc(100vh - 200px)"}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:20}}>CHRIS</div>
        <DocumentsView familyId={family.id} canUpload={true} canDelete={false} canScan={false} toast={toast||(()=>{})} reload={reload}
          attachIntent={propAttachIntent} onAttachHandled={()=>setPropAttachIntent(null)} privateFolder={true}/>
      </div>}

      {/* BILLING */}
      {activeTab==="billing"&&IS_NATIVE_APP&&<div style={{maxWidth:640}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:8}}>Billing & Plan</div>
        <div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:"16px 18px",marginBottom:14}}>
          <div style={{fontSize:12,color:B.textMute,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700}}>Your plan</div>
          <div style={{fontSize:20,color:B.navy,fontWeight:700,marginTop:4}}>{planLabel(clientPlan)}</div>
        </div>
        <WebPurchaseNotice title="Plans, cards and add-ons are managed on the website" go="billing" button="Open Billing on the website">
          Changing your plan, adding or updating a card, extra workflows and other add-ons are handled securely on the
          ORDANIS website. Everything you change there shows up here right away.
        </WebPurchaseNotice>
      </div>}
      {activeTab==="billing"&&!IS_NATIVE_APP&&<div style={{maxWidth:640}}>
        {/* Billing changes need "Manage users and billing" (migration 20261028100000); the server refuses them too. */}
        {!myPerm.manage&&<div style={{fontSize:13,color:B.textSoft,background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"10px 14px",marginBottom:14,lineHeight:1.5}}>You can see your household's plan. Only your household's primary user, or someone they allow, can change the plan or payment details.</div>}
        <fieldset disabled={!myPerm.manage} style={{border:0,padding:0,margin:0,minWidth:0}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:B.navy,fontWeight:600,marginBottom:8}}>Billing & Plan</div>
        <div style={{fontSize:14,color:B.textSoft,marginBottom:20}}>Manage your ORDANIS subscription.</div>

        {billingMsg&&<div style={{background:billingMsg.type==="error"?"#fde8e8":"#e0f5e9",border:`1px solid ${billingMsg.type==="error"?"#f5c6c6":"#bfe8cf"}`,color:billingMsg.type==="error"?"#8b1a1a":"#0d5c2b",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:13,lineHeight:1.5}}>{billingMsg.text}</div>}

        {firmPaid&&<div style={{background:"rgba(206,182,129,0.14)",border:`1px solid ${B.gold}`,borderRadius:12,padding:"14px 18px",marginBottom:16,fontSize:13,color:B.text,lineHeight:1.6}}>
          <strong>Your plan is paid by {firmLabel}.</strong> The plan fee and any extra workflows are billed to {firmLabel}, not to you, and there is no card to manage here. To change your plan, contact {firmLabel}.
        </div>}

        {fam.cancel_at&&<div style={{background:"#fef3e2",border:"1px solid #f3d29a",borderRadius:12,padding:"14px 18px",marginBottom:16,fontSize:13.5,color:B.text,lineHeight:1.6}}>
          <strong style={{color:"#8a5c00"}}>Your subscription ends on {new Date(fam.cancel_at).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}.</strong> You have full access until then, and you won't be charged again.
          On that date your login closes and your household is archived. Download anything you'd like to keep from CHRIS before then.
          <div style={{marginTop:10}}><Btn small onClick={()=>runCancel("undo")} disabled={cancelBusy}>{cancelBusy?"Working…":"Keep my subscription"}</Btn></div>
        </div>}

        {/* Current plan */}
        <div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderTop:`4px solid ${B.gold}`,borderRadius:14,padding:"22px 24px",marginBottom:16,boxShadow:B.shadow}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Current Plan</div>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,color:B.navy,fontWeight:600}}>{billingLabelOf(clientPlan)}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600}}>{fmtMoney(billingPriceOf(clientPlan))}<span style={{fontSize:12,color:B.textSoft,fontWeight:400}}>/mo</span></div>
              {firmPaid&&<div style={{fontSize:11,color:B.textSoft,marginTop:2}}>billed to {firmLabel}</div>}
            </div>
          </div>
        </div>

        <ClientFirmCard familyId={family.id} toast={toast||(()=>{})} reload={reload}/>

        {/* Business Partner portal seats -- a running total, not a toggle (there can be several).
            Managed from the Household tab; this is just the cost roll-up so it shows up where
            billing questions actually get asked. Available on every plan; Premier's seats are
            free, so its card shows $0.00/mo rather than being hidden. */}
        {businessPartners.length>0&&<div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:14,padding:"20px 24px",marginBottom:16,boxShadow:B.shadow,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div>
            <div style={{fontWeight:700,color:B.navy,fontSize:14}}>Business Partner Portal Access — {businessPartners.length} seat{businessPartners.length===1?"":"s"}{clientPlan==="premier"?" (included free with Premier)":" × $5.00/mo"}</div>
            <div style={{fontSize:12,color:B.textSoft,marginTop:2}}>Manage who has a seat from the Household tab.</div>
          </div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600}}>{fmtMoney(clientPlan==="premier"?0:businessPartners.length*5)}<span style={{fontSize:11,color:B.textSoft,fontWeight:400}}>/mo</span></div>
        </div>}

        {/* Workflows -- what is included, and every extra workflow the household has bought (what,
            when, price, who approved it). Unlimited plans (Premier) show nothing here. */}
        {clientHasWorkflows&&billingWorkflowUsage&&!billingWorkflowUsage.unlimited&&<div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:14,padding:"20px 24px",marginBottom:16,boxShadow:B.shadow}}>
          <div style={{fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Workflows</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
            <div style={{fontSize:13.5,color:B.text}}>{billingWorkflowUsage.active_count} of {billingWorkflowUsage.included} included workflows active</div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600}}>${Number(billingWorkflowUsage.slots_monthly_cost||0).toFixed(2)}<span style={{fontSize:11,color:B.textSoft,fontWeight:400}}>/mo extra</span></div>
          </div>
          <div style={{fontSize:12,color:B.textSoft,marginBottom:workflowPurchases.length?14:0}}>
            {firmPaid
              ? `Extra workflows are $${Number(billingWorkflowUsage.unit_price||0).toFixed(2)}/month each for as long as they stay active, billed to ${firmLabel}. You approve each one when you start it.`
              : `Extra workflows are $${Number(billingWorkflowUsage.unit_price||0).toFixed(2)}/month each for as long as they stay active. You approve each one when you start it. Completing or canceling a workflow stops its charge from your next renewal.`}
            {!firmPaid&&expertPriceBilling>0&&` You can also have an ORDANIS Expert work any single workflow for $${expertPriceBilling.toFixed(2)}, one time. It's an option when you start a workflow, and it's charged once to your card with no monthly repeat.`}
          </div>
          {workflowPurchases.length>0&&<div style={{borderTop:`1px solid ${B.borderLight}`,paddingTop:12}}>
            <div style={{fontSize:11,color:B.textMute,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:8}}>Extra workflows you've added</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {workflowPurchases.map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:12.5,color:B.text,padding:"6px 0"}}>
                <span>
                  <strong>{p.workflow_label||"Not used yet"}</strong>
                  <span style={{color:B.textSoft}}> — added {fmt(String(p.approved_at).slice(0,10))} by {p.approved_by_label}{p.status==="released"&&p.released_at?`, ended ${fmt(String(p.released_at).slice(0,10))}`:""}</span>
                </span>
                <span style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontWeight:600,color:B.navy}}>${Number(p.unit_price).toFixed(2)}/mo</span>
                  <span style={{fontSize:9.5,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",borderRadius:20,padding:"2px 8px",background:p.status==="in_use"?"#e0f5e9":p.status==="available"?"rgba(206,182,129,0.22)":"#eceff3",color:p.status==="in_use"?"#0d5c2b":p.status==="available"?"#7a5a19":"#5b6573"}}>{p.status==="in_use"?"Active":p.status==="available"?"Paid, not used":"Ended"}</span>
                  {p.status==="available"&&<Btn small variant="ghost" disabled={slotBusy} onClick={()=>cancelUnusedSlot(p.id)}>Cancel</Btn>}
                </span>
              </div>)}
            </div>
          </div>}
        </div>}

        {/* Plan request waiting for the team, or the team's recent decision */}
        {planRequest&&<div style={{background:"rgba(206,182,129,0.14)",border:`1px solid ${B.gold}`,borderRadius:10,padding:"14px 18px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div style={{fontSize:13,color:B.text}}>You asked for <strong>{billingLabelOf(planRequest.to_plan)}</strong> on {fmt(String(planRequest.created_at).slice(0,10))}. The {BRAND.name} team will be in touch; nothing changes or is charged until then.</div>
          <Btn variant="ghost" small onClick={cancelPlanRequest} disabled={askBusy}>{askBusy?"Working…":"Cancel request"}</Btn>
        </div>}
        {!planRequest&&planDecision&&planDecision.status==="declined"&&<div style={{background:"#f6f4ee",border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"14px 18px",marginBottom:16,fontSize:13,color:B.text,lineHeight:1.55}}>
          Your request for <strong>{billingLabelOf(planDecision.to_plan)}</strong> wasn't approved{planDecision.decision_note?<>: “{planDecision.decision_note}”</>:"."} You can send a new request at any time.
        </div>}

        {/* Pending scheduled change */}
        {fam.pending_plan&&<div style={{background:"#fef3e2",border:"1px solid #fcd97d",borderRadius:10,padding:"14px 18px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div style={{fontSize:13,color:"#8a5c00"}}>Scheduled: moving to <strong>{billingLabelOf(fam.pending_plan)}</strong> on <strong>{fmt(fam.pending_plan_effective_at)}</strong>. No charge until then.</div>
          <Btn variant="ghost" small onClick={cancelPendingChange} disabled={billingBusy}>{billingBusy?"Working…":"Cancel scheduled change"}</Btn>
        </div>}

        {/* Paused workflows -- see the effort comment on pausedWorkflowCount above. */}
        {pausedWorkflowCount>0&&<div style={{background:"#e8f0f8",border:"1px solid #c7dcef",borderRadius:10,padding:"14px 18px",marginBottom:16,fontSize:13,color:"#1d3a5c",lineHeight:1.55}}>
          <strong>{pausedWorkflowCount} workflow{pausedWorkflowCount===1?"":"s"} paused</strong> — {planLabel(clientPlan)} doesn't include workflows, so {pausedWorkflowCount===1?"it was":"they were"} paused, not deleted, when your plan changed. {pausedWorkflowCount===1?"It":"They"} will resume automatically if you move back to a plan that includes them.
        </div>}

        {/* Bill pay loss -- the sync_plan_capabilities_on_change DB trigger actually unmarks these
            expenses as ours to pay the moment a downgrade removes bill pay (not just a notice left
            over an unchanged flag), and re-marks them if the household moves back to a plan that
            includes it. See notifyOfBillPayTransition in the stripe-webhook function for the email
            side of this. */}
        {billPayLostCount>0&&<div style={{background:"#fde8e8",border:"1px solid #f5c6c6",borderRadius:10,padding:"14px 18px",marginBottom:16,fontSize:13,color:"#8b1a1a",lineHeight:1.55}}>
          <strong>Action needed — {billPayLostCount} bill{billPayLostCount===1?"":"s"} no longer paid for you.</strong> {planLabel(clientPlan)} doesn't include bill pay, so {billPayLostCount===1?"this recurring expense has":"these recurring expenses have"} been unmarked as ours to pay — {billPayLostCount===1?"it will":"they will"} not be paid on your behalf going forward. Please arrange payment yourself so nothing is missed. This reverses automatically if you move back to a plan that includes bill pay.
        </div>}

        {/* Self-serve upgrade / downgrade -- Basic <-> Core only; Premier is always Expert-led. */}
        {planSelfServe&&!fam.pending_plan&&!firmPaid&&<>
          {(upgradeTargets.length>0||clientPlan!=="premier")&&<div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Upgrade</div>
            {upgradeTargets.map(p=><div key={p} style={planCardStyle}>
              <div>
                <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{billingLabelOf(p)} — {fmtMoney(billingPriceOf(p))}/mo</div>
                <div style={{fontSize:12,color:B.textSoft,marginTop:2}}>{PLAN_BLURB[p]}</div>
                <div style={{fontSize:11,color:B.textMute,marginTop:4}}>Takes effect immediately. You're charged the prorated difference for the rest of this billing period, then the full rate at renewal.</div>
              </div>
              <Btn small onClick={()=>requestPlanChange(p)} disabled={billingBusy}>{billingBusy?"Working…":`Upgrade to ${billingLabelOf(p)}`}</Btn>
            </div>)}
            <div style={planCardStyle}>
              <div>
                <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{billingLabelOf("premier")} — {premierPriceText}</div>
                <div style={{fontSize:12,color:B.textSoft,marginTop:2}}>{PLAN_BLURB.premier}</div>
                <div style={{fontSize:11,color:B.textMute,marginTop:4}}>Set up with your ORDANIS team. Once it's active you're charged the prorated difference for the rest of this billing period, then the full rate at renewal.</div>
              </div>
              {askButton("premier")}
            </div>
          </div>}
          {downgradeTargets.length>0&&<div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Downgrade</div>
            {downgradeTargets.map(p=><div key={p} style={planCardStyle}>
              <div>
                <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{billingLabelOf(p)} — {fmtMoney(billingPriceOf(p))}/mo</div>
                <div style={{fontSize:12,color:B.textSoft,marginTop:2}}>{PLAN_BLURB[p]}</div>
                <div style={{fontSize:11,color:B.textMute,marginTop:4}}>Takes effect at the end of your current billing period. You keep your current plan until then and are not charged the new rate early. No proration or refund for the difference this period.</div>
              </div>
              <Btn small variant="ghost" onClick={()=>requestDowngrade(p)} disabled={billingBusy}>{billingBusy?"Working…":`Move to ${billingLabelOf(p)}`}</Btn>
            </div>)}
          </div>}
        </>}

        {/* Premier — advisor-led, no self-serve plan change */}
        {!planSelfServe&&!firmPaid&&<>
          <div style={{background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:12,padding:"18px 20px",fontSize:13,color:B.textSoft,lineHeight:1.6,marginBottom:16}}>
            Premier is managed by your ORDANIS Expert. {clientHasExpert&&<>To change your plan, <button onClick={()=>setEmailAdvisorOpen(true)} style={{background:"none",border:"none",color:B.navy,fontWeight:600,cursor:"pointer",fontFamily:"inherit",padding:0,fontSize:13,textDecoration:"underline"}}>email your ORDANIS Expert</button>.</>}
          </div>
          {<div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:B.textMute,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Downgrade</div>
            {SIGNUP_PLAN_ORDER.filter(p=>p!==clientPlan&&planIsSelfServe(p)).map(p=><div key={p} style={planCardStyle}>
              <div>
                <div style={{fontWeight:700,color:B.navy,fontSize:14}}>{billingLabelOf(p)} — {fmtMoney(billingPriceOf(p))}/mo</div>
                <div style={{fontSize:12,color:B.textSoft,marginTop:2}}>{PLAN_BLURB[p]}</div>
                <div style={{fontSize:11,color:B.textMute,marginTop:4}}>Arranged with your ORDANIS Expert, who confirms the timing and any proration for the difference before anything changes.</div>
              </div>
              {askButton(p)}
            </div>)}
          </div>}
        </>}

        {askPlan&&<Modal title={`Request ${billingLabelOf(askPlan)}`} onClose={()=>askBusy?null:setAskPlan(null)}>
          <div style={{fontSize:14,color:B.text,lineHeight:1.6,marginBottom:14}}>
            {askPlan==="premier"
              ? <>Premier is set up with you by the {BRAND.name} team: a named {BRAND.name} Expert, bill pay and unlimited workflows. Send the request and we'll be in touch to arrange it. Nothing changes and nothing is charged until it's confirmed with you.</>
              : <>The {BRAND.name} team will confirm the timing and any difference in price with you before anything changes.</>}
          </div>
          <Field label="Anything we should know?" optional>
            <Tex maxLength={1000} value={askNote} onChange={e=>setAskNote(e.target.value)} placeholder="For example, the best time to reach you"/>
          </Field>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn variant="ghost" onClick={()=>setAskPlan(null)} disabled={askBusy}>Cancel</Btn>
            <Btn onClick={sendPlanRequest} disabled={askBusy}>{askBusy?"Sending…":"Send request"}</Btn>
          </div>
        </Modal>}
        {confirmDowngrade&&<Modal title="Confirm downgrade" onClose={()=>setConfirmDowngrade(null)}>
          <div style={{fontSize:14,color:B.text,lineHeight:1.6,marginBottom:18}}>
            This household has <strong>{confirmDowngrade.count} workflow{confirmDowngrade.count===1?"":"s"}</strong> still in progress. You can still move to {billingLabelOf(confirmDowngrade.plan)} — the change takes effect at the end of your current billing period, so there's time to finish or hand those off first.
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn variant="ghost" onClick={()=>setConfirmDowngrade(null)}>Cancel</Btn>
            <Btn onClick={()=>{const p=confirmDowngrade.plan;setConfirmDowngrade(null);requestPlanChange(p);}} disabled={billingBusy}>{billingBusy?"Working…":"Continue with downgrade"}</Btn>
          </div>
        </Modal>}

        {!firmPaid&&fam.stripe_subscription_id&&!fam.cancel_at&&<div style={{marginTop:22,paddingTop:16,borderTop:`1px solid ${B.borderLight}`}}>
          <div style={{fontSize:13,fontWeight:700,color:B.navy,marginBottom:4}}>Cancel your subscription</div>
          <div style={{fontSize:12.5,color:B.textSoft,lineHeight:1.55,marginBottom:10}}>You keep full access until the end of the month you've paid for, and you won't be charged again. You can change your mind until then.</div>
          <Btn small variant="ghost" onClick={()=>setCancelOpen(true)}>Cancel my subscription…</Btn>
        </div>}
        {cancelOpen&&<Modal title="Cancel your subscription?" onClose={()=>!cancelBusy&&setCancelOpen(false)}>
          <div style={{fontSize:14,color:B.text,lineHeight:1.65,marginBottom:14}}>
            Your plan stays fully active until the <strong>end of the month you've already paid for</strong>. There's no partial refund and no further charge.
          </div>
          <ul style={{fontSize:13.5,color:B.textMid,lineHeight:1.7,margin:"0 0 16px",paddingLeft:20}}>
            <li>On that date your login closes and your household is archived.</li>
            <li>Before then, download anything you'd like to keep from CHRIS.</li>
            <li>Changed your mind? Choose <strong>Keep my subscription</strong> on this page any time before that date.</li>
          </ul>
          {billingMsg&&billingMsg.type==="error"&&<div style={{fontSize:12.5,color:"#8b1a1a",marginBottom:12}}>{billingMsg.text}</div>}
          <div style={{display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
            <Btn variant="ghost" onClick={()=>setCancelOpen(false)} disabled={cancelBusy}>Keep my subscription</Btn>
            <Btn variant="danger" onClick={()=>runCancel("schedule")} disabled={cancelBusy}>{cancelBusy?"Working…":"Cancel at the end of my paid month"}</Btn>
          </div>
        </Modal>}
        </fieldset>
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

// ── WORKFLOW ENGINE (shared) ─────────────────────────────────────────────────
const addDays=(iso,n)=>{const d=new Date(iso+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+(Number(n)||0));return d.toISOString().slice(0,10);};
// Files a household may upload. An allowlist rather than a blocklist, so programs and scripts never get in,
// and a size cap so one huge file cannot fail halfway with an unhelpful storage error.
const DOC_UPLOAD_EXTS=["pdf","png","jpg","jpeg","webp","gif","heic","doc","docx","xls","xlsx","csv","txt","rtf","ppt","pptx","odt","ods"];
const DOC_UPLOAD_MAX_MB=25;
const docFileProblem=f=>{
  if(!f)return "Choose a file to upload.";
  const ext=(String(f.name||"").split(".").pop()||"").toLowerCase();
  if(!DOC_UPLOAD_EXTS.includes(ext))return `That file type (.${ext||"?"}) can't be uploaded. Allowed: ${DOC_UPLOAD_EXTS.map(e=>e.toUpperCase()).join(", ")}.`;
  if(f.size>DOC_UPLOAD_MAX_MB*1024*1024)return `That file is ${(f.size/1024/1024).toFixed(1)} MB. The limit is ${DOC_UPLOAD_MAX_MB} MB.`;
  if(f.size===0)return "That file is empty.";
  return null;
};
// The name a downloaded copy is saved under: the display title, plus the stored file's extension when the
// title does not already end with it (titles are usually typed without one, so downloads lost their type).
const docDownloadName=doc=>{
  const base=String(doc.name||"document").trim()||"document";
  const m=/\.([A-Za-z0-9]{1,5})$/.exec(String(doc.filePath||""));
  if(!m)return base;
  const ext=m[1].toLowerCase();
  return base.toLowerCase().endsWith("."+ext)?base:`${base}.${ext}`;
};
// Today's date in the person's own time zone (toISOString() is UTC, so after about 8pm US Eastern it
// would already say tomorrow, and a form defaulting to it would be a day ahead).
const todayISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};

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
  // Set by the sync_plan_capabilities_on_change DB trigger when a household's plan
  // stops including workflows -- deliberately the same neutral gray as a paused instance
  // (not blocked's red), since nothing is wrong, the plan just changed.
  paused:{bg:"#eef0f4",text:"#6b7280"},
};
const statusWord=s=>({awaiting_approval:"Needs approval",ready:"Ready",pending:"Upcoming",
  // Approved is not finished. It is approved and still sitting there unsent, and the
  // label has to say so or a clear-looking queue will be hiding outstanding work.
  approved:"Approved — not sent",sent:"Sent",done:"Done",skipped:"Not required",blocked:"Blocked",
  paused:"Paused — plan change"}[s]||s);

// Calls the purchase-workflow edge function and surfaces its plain-language error (the
// function answers 402/409 with a JSON body, which supabase-js hides behind a generic message).
async function callPurchaseWorkflow(body){
  const{data,error}=await sb.functions.invoke("purchase-workflow",{body});
  if(error){
    let msg=error.message;
    try{const b=await error.context.json();if(b&&b.error)msg=b.error;}catch(_e){}
    throw new Error(msg);
  }
  if(data&&data.error)throw new Error(data.error);
  return data;
}

// Calls request-expert-assist: one-time fee for an ORDANIS Expert on a single workflow. Same
// plain-language error handling as callPurchaseWorkflow.
async function callExpertAssist(body){
  const{data,error}=await sb.functions.invoke("request-expert-assist",{body});
  if(error){
    let msg=error.message;
    try{const b=await error.context.json();if(b&&b.error)msg=b.error;}catch(_e){}
    throw new Error(msg);
  }
  if(data&&data.error)throw new Error(data.error);
  return data;
}

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
  if(sErr){
    // Undo the cycle row so a failed start does not leave an empty, active cycle behind: it would hold
    // a workflow slot (or the monthly extra-workflow charge) and could never be completed.
    await sb.from("workflow_instances").delete().eq("id",inst.id);
    throw new Error(sErr.message);
  }
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
      // meant a tenant provisioned without that secret signed letters "ORDANIS".
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
        Nothing drafted yet. ORDANIS will assemble this from the obligation, the funding
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
        Approving records your name and time against this step; sending goes out from this client's ORDANIS Expert.
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
        approved an unrecognized recipient.
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
  const[isObOpen,toggleOb]=useOpenSet();
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

  // Live usage against plan_features.workflows_included -- Core gets 10 ACTIVE workflows
  // included and $8/month for each one beyond that, for as long as it stays active; completing a
  // workflow (see advance() below) drops it out of this count from the next monthly billing cycle
  // on. Read via the family_workflow_slots RPC so this card can never show a figure the
  // database itself doesn't agree with. Null `usage` just means "still loading" or "unlimited
  // plan" -- both render nothing here rather than a misleading zero.
  const[usage,setUsage]=useState(null);
  const loadUsage=async()=>{
    const{data:rows,error}=await sb.rpc("family_workflow_slots",{p_family_id:family.id});
    if(!error&&rows&&rows[0])setUsage(rows[0]);
  };
  const[buyPrompt,setBuyPrompt]=useState(null);
  const[buying,setBuying]=useState(false);
  useEffect(()=>{loadUsage();},[family.id]);
  // One-time fee to have an ORDANIS Expert work a single workflow (plan_features.expert_assist_price;
  // null = not offered on this plan). Charged by the request-expert-assist function, never by the browser.
  const[expertPrice,setExpertPrice]=useState(0);
  // The `family` prop is a snapshot from when the household was selected; the live row has the current plan.
  const livePlan=((data.families||[]).find(f=>f.id===family.id)||family).plan;
  const[wantExpert,setWantExpert]=useState(false);
  const[startPrompt,setStartPrompt]=useState(null); // {ob}
  const[expertBusyId,setExpertBusyId]=useState(null);
  useEffect(()=>{
    let stopped=false;
    sb.from("plan_features").select("expert_assist_price").eq("plan",livePlan).maybeSingle().then(({data:r,error})=>{
      if(!stopped&&!error)setExpertPrice(Number(r&&r.expert_assist_price)||0);
    });
    return()=>{stopped=true;};
  },[livePlan]);
  // When the household's firm pays, buying an extra workflow charges no card: it is billed to the firm.
  const[payer,setPayer]=useState(null);
  useEffect(()=>{
    let stopped=false;
    sb.rpc("family_payer_info",{p_family_id:family.id}).then(({data:r,error})=>{if(!stopped&&!error&&r&&r[0])setPayer(r[0]);});
    return()=>{stopped=true;};
  },[family.id]);
  const firmPays=payer?.paid_by==="enterprise";
  const firmName=payer?.firm_name||"your firm";
  const expertOffered=expertPrice>0&&!firmPays&&!IS_NATIVE_APP; // in the app, offered on the website instead
  const expertOnWeb=expertPrice>0&&!firmPays&&IS_NATIVE_APP;
  const expertFeeText=`$${expertPrice.toFixed(2)}`;

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
  // Picking the workflow first fills in the rest of a NEW obligation. Only fields the person has not
  // touched are filled: a value is replaced only if it is blank, still the form's default, or the
  // value this same function put there for the previously chosen workflow. Anything typed by hand stays.
  const TEMPLATE_KIND={grat_annuity:"grat_annuity",note_interest:"note_interest",policy_review:"policy_review",capital_call:"capital_call",rmd:"rmd",estimated_tax:"tax",k1_collection:"tax_document",ilit_premium:"premium"};
  const TEMPLATE_RECURRENCE={capital_call:"once",estimated_tax:"quarterly",quarterly_statement_collection_and:"quarterly",rmd:"annually"};
  const templateDefaults=t=>{
    if(!t)return{};
    const cat=t.category||"";
    const kind=TEMPLATE_KIND[t.key]||(cat==="Insurance"?"premium":cat==="Tax"?"tax":"other");
    const recurrence=TEMPLATE_RECURRENCE[t.key]||(t.trigger_kind==="manual"?"once":"annually");
    const d={name:t.name,kind,recurrence,notes:t.description||""};
    if(t.trigger_kind==="manual")d.due_date=todayISO(); // event-driven playbooks start now
    if(accounts.length===1)d.source_account_id=accounts[0].id;
    return d;
  };
  const chooseTemplate=key=>setModal(m=>{
    const row=m.row,auto=row._auto||{};
    const next={...row,template_key:key};
    if(!m.isNew){return{...m,row:next};}
    const nd=templateDefaults(tplFor(key));
    const blank=v=>v===""||v==null;
    const fresh={kind:"premium",recurrence:"annually"}; // BLANK_OBLIGATION's defaults
    const newAuto={};
    for(const f of ["name","kind","recurrence","notes","due_date","source_account_id"]){
      const cur=row[f];
      const untouched=blank(cur)||cur===auto[f]||(f in fresh&&cur===fresh[f]&&!(f in auto));
      if(untouched){
        if(key&&f in nd){next[f]=nd[f];newAuto[f]=nd[f];}
        else if(!key&&f in auto){next[f]=(f in fresh)?fresh[f]:"";}
      }else if(f in auto)newAuto[f]=auto[f];
    }
    next._auto=newAuto;
    return{...m,row:next};
  });
  // Flags a playbook can ask about, so the form only offers relevant questions.
  const flagsFor=key=>{
    const t=tplFor(key);
    if(!t)return [];
    return [...new Set((Array.isArray(t.steps)?t.steps:[]).map(s=>s.requires).filter(Boolean))];
  };

  const save=async()=>{
    const f=modal.row;
    if(!f.name.trim()||!f.due_date){toast("Name and due date are required","error");return;}
    if(f.amount!==""&&f.amount!=null){
      const amt=Number(String(f.amount).replace(/[$,\s]/g,""));
      if(!Number.isFinite(amt)||amt<0){toast("Enter the amount as a number, like 48000 (no negatives).","error");return;}
    }
    if(f.grace_date&&f.grace_date<f.due_date){toast("The grace date can't be before the due date.","error");return;}
    setSaving(true);
    const payload={
      family_id:family.id,name:f.name.trim(),kind:f.kind,
      amount:(f.amount===""||f.amount==null)?null:Number(String(f.amount).replace(/[$,\s]/g,"")),
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
    else{toast(modal.isNew?"Workflow added":"Workflow saved");setModal(null);load();}
    setSaving(false);
  };

  // The database refuses a workflow beyond the included number unless the household holds a paid,
  // unused slot (see the workflow_purchases migration). So the flow is: read a FRESH count; if the
  // household is at its limit, ask the person to approve the monthly cost; the purchase-workflow
  // function charges the card and creates the slot; only then is the cycle created, which uses it.
  // Asks for an Expert on an existing cycle. The card is charged once, server-side. Returns the
  // plain-language outcome so the caller can fold it into one message.
  const addExpert=async instId=>{
    try{
      const r=await callExpertAssist({family_id:family.id,instance_id:instId});
      if(r&&r.already)return{ok:true,text:"An ORDANIS Expert was already added to this workflow."};
      return{ok:true,text:r&&r.email_sent===false
        ?`An ORDANIS Expert was added (${expertFeeText} charged), but we could not notify the team automatically. Please email us so someone is assigned.`
        :`An ORDANIS Expert was added (${expertFeeText} charged once). Our team will assign someone and be in touch.`};
    }catch(e){return{ok:false,text:e.message||"Could not add an ORDANIS Expert."};}
  };
  const addExpertToCycle=async instId=>{
    setExpertBusyId(instId);
    const r=await addExpert(instId);
    toast(r.text,r.ok?"success":"error");
    setExpertBusyId(null);
    load();
  };
  const createCycle=async(ob,paid,withExpert)=>{
    const t=tplFor(ob.template_key);
    try{
      const inst=await generateWorkflowCycle({template:t,obligation:ob,dueDate:ob.due_date,familyId:family.id});
      const base=inst.status==="at_risk"?"Cycle started — flagged at risk.":"Cycle started.";
      let msg=base+(paid?(firmPays?` This is a paid workflow: it is billed to ${firmName} for as long as it stays active.`:" This is a paid workflow: it is billed monthly for as long as it stays active."):"");
      let expertFailed=false;
      if(withExpert){
        const r=await addExpert(inst.id);
        msg+=" "+(r.ok?r.text:`The cycle started, but the Expert could not be added: ${r.text} You can add one from the cycle below.`);
        expertFailed=!r.ok;
      }
      toast(msg,expertFailed?"error":undefined);
      setOpenInst(inst.id);load();loadUsage();
      return true;
    }catch(e){
      if(/workflow_limit_reached/.test(e.message||"")){
        loadUsage();
        toast("All included workflows are in use. Press Start cycle again to add one.","error");
      }else toast(e.message||"Could not start the cycle.","error");
      return false;
    }
  };
  const startCycle=async ob=>{
    const t=tplFor(ob.template_key);
    if(!t){toast("Choose which workflow this follows first","error");return;}
    if(instances.some(i=>i.obligation_id===ob.id&&i.due_date===ob.due_date)){
      toast("This cycle already exists","error");return;}
    let u=usage;
    const{data:rows}=await sb.rpc("family_workflow_slots",{p_family_id:family.id});
    if(rows&&rows[0]){u=rows[0];setUsage(u);}
    if(u&&!u.unlimited&&u.free_remaining<=0&&u.slots_available<=0){
      if(!u.can_buy){
        toast(`This household has used all ${u.included} included workflows. Only the household owner can add more ($${Number(u.unit_price||0).toFixed(2)}/month each, up to their monthly limit) — ask them to approve it.`,"error");
        return;
      }
      setWantExpert(false);
      setBuyPrompt({ob,u,web:IS_NATIVE_APP&&!firmPays});
      return;
    }
    if(expertOffered){setWantExpert(false);setStartPrompt({ob});return;}
    await createCycle(ob,false,false);
  };
  const confirmStart=async()=>{
    const{ob}=startPrompt;
    setBuying(true);
    await createCycle(ob,false,wantExpert);
    setStartPrompt(null);
    setBuying(false);
  };
  // The checkbox shared by both start prompts.
  const expertOption=expertOffered&&<label style={{display:"flex",gap:10,alignItems:"flex-start",marginTop:14,padding:"12px 14px",border:`1px solid ${wantExpert?B.gold:B.borderLight}`,background:wantExpert?"rgba(206,182,132,0.14)":B.white,borderRadius:10,cursor:"pointer"}}>
    <input type="checkbox" checked={wantExpert} disabled={buying} onChange={e=>setWantExpert(e.target.checked)} style={{marginTop:3}}/>
    <span style={{fontSize:13,color:B.text,lineHeight:1.55}}>
      <strong>Have an ORDANIS Expert work this workflow — {expertFeeText}, one time.</strong><br/>
      <span style={{color:B.textSoft,fontSize:12.5}}>An Expert is assigned to this one workflow only and does the work with you. It is charged once to your card on file, separate from your plan and from any extra-workflow charge, with no monthly repeat.</span>
    </span>
  </label>;
  const confirmBuy=async()=>{
    const{ob}=buyPrompt;
    setBuying(true);
    let bought=null;
    try{bought=await callPurchaseWorkflow({action:"buy",family_id:family.id});}
    catch(e){toast(e.message,"error");setBuying(false);return;}
    setBuyPrompt(null);
    const ok=await createCycle(ob,true,wantExpert);
    if(!ok)toast("Your extra workflow was added and is ready to use, but the cycle did not start. Press Start cycle again — you won't be charged twice.","error");
    loadUsage();
    setBuying(false);
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
      loadUsage(); // this instance just dropped out of the active count
      if(usage&&(usage.slots_in_use>0||usage.slots_available>0)){
        callPurchaseWorkflow({action:"sync",family_id:family.id}).then(()=>loadUsage()).catch(()=>{});
      }
    }
    load();
  };

  if(loading)return <div style={{padding:30}}><Spinner/></div>;

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:12,flexWrap:"wrap",marginBottom:6}}>
      <div>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600}}>Workflows</div>
        <div style={{fontSize:12,color:B.textSoft,marginTop:2,maxWidth:640,lineHeight:1.5}}>
          Recurring commitments and the playbook that carries each one. Starting a cycle lays out every
          step with its date; outbound steps wait for your approval.
        </div>
      </div>
      {canEdit&&<Btn onClick={()=>setModal({row:{...BLANK_OBLIGATION},isNew:true})}>+ New Workflow</Btn>}
    </div>
    <GoldLine/>
    {canEdit&&expertOnWeb&&<WebPurchaseNotice title={`Want an ORDANIS Expert on a workflow? ${expertFeeText} one time`} go="workflows" button="Add an Expert on the website" style={{marginBottom:14}}>
      An Expert can work any one workflow for you. It's added on the ORDANIS website, where your card is on file.
    </WebPurchaseNotice>}

    {/* Workflow allowance -- only meaningful for a plan that meters (workflows_included not
        null; Premier's is null so this renders nothing for them). Active, not monthly-started:
        10 workflows may be in progress at once for free, $8/month for each additional one that
        stays active, and completing a workflow removes it from this count going forward. */}
    {usage&&!usage.unlimited&&(()=>{const atLimit=usage.free_remaining<=0&&usage.slots_available<=0;return <div style={{background:atLimit?"#fdecec":"rgba(206,182,132,0.12)",border:`1px solid ${atLimit?"#f3c6c6":B.gold}`,borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12.5,color:B.text,lineHeight:1.5}}>
      <strong>{usage.active_count} of {usage.included} included workflows active.</strong>{" "}
      {usage.free_remaining>0
        ? `${usage.free_remaining} more can be started at no extra cost.`
        : usage.slots_available>0
          ? `${usage.slots_available} paid workflow${usage.slots_available===1?"":"s"} ready to start.`
          : `You are at your included limit. Another workflow is $${Number(usage.unit_price||0).toFixed(2)}/month for as long as it stays active${firmPays?`, billed to ${firmName}`:""} — you'll be asked to approve it when you start one.`}
      {usage.slots_in_use>0&&` ${usage.slots_in_use} paid workflow${usage.slots_in_use===1?"":"s"} running ($${Number(usage.slots_monthly_cost||0).toFixed(2)}/month).`}
      {expertOffered&&` Want help? An ORDANIS Expert can work any single workflow for ${expertFeeText}, one time.`}
    </div>;})()}

    {buyPrompt&&buyPrompt.web&&<Modal title="Add another workflow?" onClose={()=>setBuyPrompt(null)}>
      <div style={{fontSize:14,color:B.text,lineHeight:1.6,marginTop:6,marginBottom:14}}>
        You have used {buyPrompt.u.active_count} of {buyPrompt.u.included} included workflows. Another one is
        <strong> ${Number(buyPrompt.u.unit_price).toFixed(2)} a month</strong> while it stays active, and is added on the ORDANIS website.
      </div>
      <WebPurchaseNotice go="workflows" button="Add it on the website">Add the extra workflow there, then come back and press Start cycle.</WebPurchaseNotice>
    </Modal>}
    {buyPrompt&&!buyPrompt.web&&<Modal title="Add another workflow?" onClose={()=>!buying&&setBuyPrompt(null)}>
      <div style={{fontSize:14,color:B.text,lineHeight:1.6,marginTop:6}}>
        You have used {buyPrompt.u.active_count} of {buyPrompt.u.included} included workflows.
        Add another for <strong>${Number(buyPrompt.u.unit_price).toFixed(2)} a month</strong> while it stays active?
      </div>
      {firmPays
        ? <div style={{fontSize:12.5,color:B.textSoft,lineHeight:1.6,marginTop:10}}>
            <strong>No card is charged.</strong> This is billed to {firmName} on its next monthly invoice (a prorated amount for this month, then ${Number(buyPrompt.u.unit_price).toFixed(2)} each month while it stays active).
            Completing or canceling the workflow stops the charge from the next invoice. This approval is recorded with your name and the date.
          </div>
        : <div style={{fontSize:12.5,color:B.textSoft,lineHeight:1.6,marginTop:10}}>
            You'll be charged a prorated amount now on your card on file, then ${Number(buyPrompt.u.unit_price).toFixed(2)} with each monthly renewal.
            Completing or canceling the workflow stops the charge from your next renewal. This approval is recorded with your name and the date.
          </div>}
      {expertOption}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20,flexWrap:"wrap"}}>
        <Btn variant="ghost" disabled={buying} onClick={()=>setBuyPrompt(null)}>Cancel</Btn>
        <Btn variant="gold" disabled={buying} onClick={confirmBuy}>{buying?"Adding…":`Add for $${Number(buyPrompt.u.unit_price).toFixed(2)}/month${wantExpert?` + ${expertFeeText} Expert`:""}`}</Btn>
      </div>
    </Modal>}

    {startPrompt&&<Modal title="Start this workflow?" onClose={()=>!buying&&setStartPrompt(null)}>
      <div style={{fontSize:14,color:B.text,lineHeight:1.6,marginTop:6}}>
        This lays out every step for <strong>{startPrompt.ob.name}</strong>. It counts toward your included workflows, so there is no extra charge to start it.
      </div>
      {expertOption}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20,flexWrap:"wrap"}}>
        <Btn variant="ghost" disabled={buying} onClick={()=>setStartPrompt(null)}>Cancel</Btn>
        <Btn variant="gold" disabled={buying} onClick={confirmStart}>{buying?"Starting…":wantExpert?`Start + add Expert (${expertFeeText})`:"Start cycle"}</Btn>
      </div>
    </Modal>}

    {!obs.length&&<Empty text="No workflows on file for this household yet."/>}

    <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:14}}>
      {obs.map(ob=>{
        const t=tplFor(ob.template_key);
        const cycles=instances.filter(i=>i.obligation_id===ob.id);
        const open=isObOpen(ob.id),cr=collapseRow(open,()=>toggleOb(ob.id));
        const atRisk=cycles.filter(i=>i.status==="at_risk").length;
        return <div key={ob.id} style={{background:B.white,border:`1px solid ${B.borderLight}`,borderLeft:`4px solid ${B.navy}`,borderRadius:12,padding:"16px 18px",boxShadow:B.shadow}}>
          <div {...cr} style={{...cr.style,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:19,color:B.navy,fontWeight:600}}>{ob.name}
                {/* Closed, a cycle that needs attention still shows. */}
                {!open&&atRisk>0&&<span style={{marginLeft:8,fontFamily:"inherit",fontSize:10.5,fontWeight:600,borderRadius:20,padding:"2px 9px",background:"#fde8e8",color:"#8b1a1a",verticalAlign:"middle"}}>At risk</span>}</div>
              <div style={{fontSize:11.5,color:B.textSoft,marginTop:3}}>
                {OBLIGATION_KINDS.find(k=>k.v===ob.kind)?.label||ob.kind}
                {ob.counterparty?` · ${ob.counterparty}`:""}
                {ob.reference_number?` · ${ob.reference_number}`:""}
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600,whiteSpace:"nowrap"}}>{ob.amount?fmtMoney(ob.amount):"—"}<Chevron open={open}/></div>
              <div style={{fontSize:11,color:B.textSoft}}>due {fmt(ob.due_date)} · {RECURRENCES.find(r=>r.v===ob.recurrence)?.label}</div>
            </div>
          </div>

          {open&&<>
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
                    background:inst.status==="at_risk"?"#fde8e8":inst.status==="completed"?"#e0f5e9":inst.status==="paused"?B.borderLight:"#e8f0f8",
                    color:inst.status==="at_risk"?"#8b1a1a":inst.status==="completed"?"#0d5c2b":inst.status==="paused"?B.textMute:"#293d5c"}}>
                    {inst.status==="at_risk"?"At risk":inst.status==="completed"?"Complete":inst.status==="paused"?"Paused — plan change":"In progress"}
                  </span>
                  <span style={{marginLeft:8,fontSize:11,color:B.textMute}}>{doneCount}/{mine.length} steps</span>
                  {inst.expert_assisted&&<span style={{marginLeft:8,fontSize:10.5,fontWeight:600,borderRadius:20,padding:"2px 9px",background:"rgba(206,182,132,0.22)",color:"#7a5a19"}}>ORDANIS Expert</span>}
                </div>
                <span style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {canEdit&&expertOffered&&!inst.expert_assisted&&inst.status!=="completed"&&<Btn small variant="ghost" disabled={expertBusyId===inst.id} onClick={()=>addExpertToCycle(inst.id)}>{expertBusyId===inst.id?"Adding…":`Add ORDANIS Expert — ${expertFeeText}`}</Btn>}
                  <Btn small variant="ghost" onClick={()=>setOpenInst(open?null:inst.id)}>{open?"Hide":"View timeline"}</Btn>
                </span>
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
          </>}
        </div>;
      })}
    </div>

    {review&&<DraftReviewModal step={review} toast={toast} userProfile={userProfile}
      onClose={()=>setReview(null)} onApproved={load}/>}

    {modal&&<Modal wide title={modal.isNew?"New Workflow":`Edit — ${modal.row.name}`} onClose={()=>setModal(null)}>
      <Field label="Workflow" optional>
        <Sel value={modal.row.template_key||""} onChange={e=>chooseTemplate(e.target.value)}>
          <option value="">— none, track the date only —</option>
          {templates.map(t=><option key={t.key} value={t.key}>{t.name}</option>)}
        </Sel>
      </Field>
      {modal.isNew&&modal.row.template_key&&<div style={{fontSize:11.5,color:B.textSoft,margin:"-6px 0 12px"}}>Name, type, repeat and notes were filled in from this workflow. Change anything that doesn't fit; just add the due date and any amount.</div>}
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

      <Grid2>
        <Field label="Name" required><Inp maxLength={120} value={modal.row.name} onChange={e=>setModal(m=>({...m,row:{...m.row,name:e.target.value}}))} placeholder="ILIT premium — Pacific Life"/></Field>
        <Field label="Type"><Sel value={modal.row.kind} onChange={e=>setModal(m=>({...m,row:{...m.row,kind:e.target.value}}))}>{OBLIGATION_KINDS.map(k=><option key={k.v} value={k.v}>{k.label}</option>)}</Sel></Field>
        <Field label="Amount" optional><MoneyInput value={modal.row.amount} onChange={e=>setModal(m=>({...m,row:{...m.row,amount:e.target.value}}))} placeholder="48,000"/></Field>
        <Field label="Due date" required><Inp type="date" value={modal.row.due_date||""} onChange={e=>setModal(m=>({...m,row:{...m.row,due_date:e.target.value}}))}/></Field>
        <Field label="Recurrence"><Sel value={modal.row.recurrence} onChange={e=>setModal(m=>({...m,row:{...m.row,recurrence:e.target.value}}))}>{RECURRENCES.map(r=><option key={r.v} value={r.v}>{r.label}</option>)}</Sel></Field>
        <Field label="Grace date (if later)" optional><Inp type="date" value={modal.row.grace_date||""} onChange={e=>setModal(m=>({...m,row:{...m.row,grace_date:e.target.value}}))}/></Field>
        <Field label="Counterparty" optional><Inp maxLength={120} value={modal.row.counterparty||""} onChange={e=>setModal(m=>({...m,row:{...m.row,counterparty:e.target.value}}))} placeholder="Pacific Life"/></Field>
        <Field label="Reference (policy no., EIN, fund)" optional><Inp maxLength={80} value={modal.row.reference_number||""} onChange={e=>setModal(m=>({...m,row:{...m.row,reference_number:e.target.value}}))}/></Field>
      </Grid2>

      <SectionLabel>Funding</SectionLabel>
      <Grid2>
        <Field label="Money comes from" optional>
          <Sel value={modal.row.source_account_id||""} onChange={e=>setModal(m=>({...m,row:{...m.row,source_account_id:e.target.value}}))}>
            <option value="">— not tracked —</option>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.institution} · {a.accountType}</option>)}
          </Sel>
        </Field>
        <Field label="Money goes to" optional>
          <Sel value={modal.row.destination_account_id||""} onChange={e=>setModal(m=>({...m,row:{...m.row,destination_account_id:e.target.value}}))}>
            <option value="">— not tracked —</option>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.institution} · {a.accountType}</option>)}
          </Sel>
        </Field>
      </Grid2>

      <Field label="Notes" optional><textarea maxLength={2000} value={modal.row.notes||""} onChange={e=>setModal(m=>({...m,row:{...m.row,notes:e.target.value}}))} rows={2} style={{...inp,resize:"vertical",fontFamily:"inherit"}}/></Field>

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn variant="ghost" onClick={()=>setModal(null)} disabled={saving}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving?"Saving…":modal.isNew?"Add workflow":"Save"}</Btn>
      </div>
    </Modal>}
  </div>;
}

// ── WORKFLOW TEMPLATE LIBRARY ────────────────────────────────────────────────
// The playbooks behind recurring obligations. Read-only for ORDANIS Experts and
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
const actorLabel=v=>STEP_ACTORS.find(a=>a.v===v)?.label||v;
const kindLabel=v=>STEP_KINDS.find(a=>a.v===v)?.label||v;

// ── FIRM MEMBERSHIP (Phase 6) ──────────────────────────────────────────────
// A household enters a firm only through the firm-join function, which checks the code, requires the
// data-sharing notice (or an admin's recorded agreement) and writes the membership log. Nothing in the
// browser writes families.enterprise_id.
async function callFirmJoin(body){
  const{data,error}=await sb.functions.invoke("firm-join",{body});
  if(error){
    let msg=error.message;
    try{const b=await error.context.json();if(b&&b.error)msg=b.error;}catch(_e){}
    throw new Error(msg);
  }
  if(data&&data.error)throw new Error(data.error);
  return data;
}
const JOINED_VIA_TEXT={signup_code:"signed up with the firm's code",client_join:"entered the firm's code",admin_move:"moved in by ORDANIS, with the client's agreement",admin_created:"set up by the firm"};
const dateOnly=v=>v?new Date(v).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}):"";

// What a signed-in client sees: which firm they belong to, or a way to join one with a code.
// A card that folds down to its header. Closed by default, and each viewer's choice is remembered in their own
// browser (never required: it works the same without storage).
function CollapseBox({id,head,badge,summary,box,children,defaultOpen=false}){
  const key="ordanis.collapse."+id;
  const[open,setOpen]=useState(()=>{try{const v=window.localStorage.getItem(key);return v===null?defaultOpen:v==="1";}catch(_e){return defaultOpen;}});
  const toggle=()=>setOpen(o=>{const n=!o;try{window.localStorage.setItem(key,n?"1":"0");}catch(_e){}return n;});
  return <div style={box}>
    <button type="button" onClick={toggle} aria-expanded={open}
      style={{display:"flex",width:"100%",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",background:"none",border:"none",padding:0,margin:0,cursor:"pointer",fontFamily:"inherit",textAlign:"left",color:"inherit"}}>
      <div style={{minWidth:0}}>
        {head}
        {!open&&summary&&<div style={{marginTop:3}}>{summary}</div>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        {badge}
        <span aria-hidden="true" style={{fontSize:12,color:B.textMute,display:"inline-block",transform:open?"rotate(90deg)":"none",transition:"transform .15s"}}>▶</span>
      </div>
    </button>
    {open&&<div style={{marginTop:12}}>{children}</div>}
  </div>;
}

function ClientFirmCard({familyId,toast,reload}){
  const[info,setInfo]=useState(null);
  const[loaded,setLoaded]=useState(false);
  const[joinOpen,setJoinOpen]=useState(false);
  const[noticeOpen,setNoticeOpen]=useState(true);
  const[code,setCode]=useState("");
  const[look,setLook]=useState(null);
  const[agree,setAgree]=useState(false);
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState("");
  const load=async()=>{
    const[f,n]=await Promise.all([
      sb.rpc("family_firm_info",{p_family_id:familyId}),
      sb.from("signup_disclosures").select("id").eq("kind","firm_data_sharing").eq("is_draft",false).limit(1),
    ]);
    setInfo({firm:f.data&&f.data[0]||null,open:!!(n.data&&n.data.length)});
    setLoaded(true);
  };
  useEffect(()=>{load();},[familyId]);
  const reset=()=>{setJoinOpen(false);setCode("");setLook(null);setAgree(false);setErr("");};
  const check=async()=>{
    setErr("");setLook(null);setAgree(false);setBusy(true);
    try{const r=await callFirmJoin({action:"lookup",code:code.trim()});setLook({firm:r.firm_name,notice:r.notice});}
    catch(e){setErr(e.message);}
    setBusy(false);
  };
  const join=async()=>{
    if(!look||!agree)return;
    setErr("");setBusy(true);
    try{
      const r=await callFirmJoin({action:"join",code:code.trim(),notice_id:look.notice.id});
      toast("You joined "+(r.firm_name||look.firm));
      reset();await load();if(reload)await reload("families");
    }catch(e){setErr(e.message);}
    setBusy(false);
  };
  if(!loaded||!info)return null;
  const firm=info.firm&&info.firm.firm_name?info.firm:null;
  if(!firm&&!info.open)return null;
  const box={background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:14,padding:"20px 24px",marginBottom:16,boxShadow:B.shadow};
  const label={fontSize:10,color:B.textMute,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8};
  if(firm)return <CollapseBox id="clientFirm" box={box}
    head={<div style={{...label,marginBottom:0}}>Your firm</div>}
    summary={<div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:B.navy,fontWeight:600}}>{firm.firm_name}</div>}>
    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:B.navy,fontWeight:600}}>{firm.firm_name}</div>
    <div style={{fontSize:12.5,color:B.textSoft,marginTop:4,lineHeight:1.6}}>
      {firm.joined_at?`Joined ${dateOnly(firm.joined_at)}`:"Member"}{firm.joined_via&&JOINED_VIA_TEXT[firm.joined_via]?` (${JOINED_VIA_TEXT[firm.joined_via]})`:""}.
      {" "}The firm's administrators can view everything you can see in your household's portal, including your documents. They see nothing beyond that, have view access only, and cannot change anything.
      {" "}To leave the firm, ask your ORDANIS contact.
    </div>
  </CollapseBox>;
  return <CollapseBox id="clientJoinFirm" box={box}
    head={<div style={{...label,marginBottom:0}}>Join a firm</div>}
    summary={<div style={{fontSize:12.5,color:B.textSoft}}>Have a firm code? Open this to join.</div>}>
    {!joinOpen&&<>
      <div style={{fontSize:13,color:B.textSoft,lineHeight:1.6,marginBottom:12}}>If an advisory firm gave you a firm code, you can join it here. You will see exactly what the firm can see before you agree.</div>
      <Btn small variant="ghost" onClick={()=>setJoinOpen(true)}>I have a firm code</Btn>
    </>}
    {joinOpen&&<>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <input value={code} maxLength={40} autoComplete="off" spellCheck={false} placeholder="Firm code"
          onChange={e=>{setCode(e.target.value);if(look||err){setLook(null);setAgree(false);setErr("");}}}
          onKeyDown={e=>{if(e.key==="Enter"&&code.trim()&&!busy)check();}}
          style={{flex:"1 1 200px",padding:"9px 12px",border:`1px solid ${B.border}`,borderRadius:8,fontSize:14,fontFamily:"inherit",color:B.text,minWidth:0}}/>
        <Btn small onClick={check} disabled={busy||!code.trim()}>{busy&&!look?"Checking…":"Check"}</Btn>
        <Btn small variant="ghost" onClick={reset} disabled={busy}>Cancel</Btn>
      </div>
      {err&&<div style={{marginTop:10,fontSize:12.5,color:"#8b1a1a"}}>{err}</div>}
      {look&&<div style={{marginTop:14}}>
        <div style={{fontSize:13.5,fontWeight:700,color:B.navy,marginBottom:6}}>Join {look.firm}</div>
        {look.notice&&look.notice.title&&<div style={{fontSize:12.5,fontWeight:700,color:B.navy,marginBottom:6}}>{look.notice.title}</div>}
        <div style={{maxHeight:200,overflowY:"auto",border:`1px solid ${B.borderLight}`,borderRadius:8,padding:"10px 12px",fontSize:12.5,color:B.textSoft,lineHeight:1.55,background:B.bg}}
          dangerouslySetInnerHTML={{__html:(look.notice&&look.notice.body_html)||""}}/>
        <label style={{display:"flex",gap:8,alignItems:"flex-start",marginTop:10,fontSize:13,color:B.text,cursor:"pointer"}}>
          <input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)} style={{marginTop:2}}/>
          I have read the notice above and agree to share this with {look.firm}.
        </label>
        <div style={{marginTop:12}}><Btn onClick={join} disabled={!agree||busy}>{busy?"Joining…":"Join "+look.firm}</Btn></div>
      </div>}
    </>}
  </CollapseBox>;
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
  // signed in. ORDANIS is a family office administrative platform; lead
  // management belongs in whatever CRM the firm already runs.
  {section:"RESOURCES",items:[
    {id:"resources",label:"Resources",icon:"▥"},
  ]},
  {section:"ADMIN",items:[
    {id:"users",label:"Users",icon:"⊕"},
    {id:"signups",label:"Signups",icon:"◈"},
    {id:"planrequests",label:"Plan requests",icon:"⇅"},
    {id:"enterprises",label:"Enterprises",icon:"▣"},
    {id:"firmbilling",label:"Firm billing",icon:"▤"},
    {id:"utilization",label:"Utilization",icon:"◔"},
    {id:"staterules",label:"State Rules",icon:"⚖"},
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
  // Bumped when the skin changes after the first paint (sign-in or sign-out), to redraw with it.
  const[,setSkinTick]=useState(0);
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
  // Sign Out = this browser only. Signing out every device is SecurityModal's "Sign out everywhere".
  const logout=async()=>{resetAssistantPromptSession();await sb.auth.signOut({scope:"local"});setAuthed(false);setUserProfile(null);setTab("dashboard");};
  const showToast=useCallback((msg,type="success")=>{setToastState({msg,type});setTimeout(()=>setToastState(null),3500);},[]);

  const profileRef=useRef(null);
  const allowedFamilyIdsRef=useRef(null); // null = unrestricted (admin)

  // Detect the redirect Stripe sends the browser back to right after a self-serve signup pays
  // (see SignupFlow.jsx's success_url: `${origin}/?welcome=1`). The families row for a brand-new
  // household is NOT created by this app -- it's created by stripe-webhook's
  // createFamilyFromSignup, fired by Stripe's own checkout.session.completed webhook, which is a
  // separate async server-to-server call that can (and often does) land a beat after Stripe's
  // client-side redirect already brought the browser back here. Without accounting for that, a
  // brand-new client who just paid seconds ago hit a dead-end "contact your Expert" screen for
  // what is normally a few seconds of ordinary webhook lag, not a real problem.
  const isWelcomeRedirect=typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("welcome")==="1";
  const[welcomeWaitElapsed,setWelcomeWaitElapsed]=useState(false);

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
      CURRENT_USER_ROLE=d.role||"";
    }
  },[]);

  // Runs at load and again whenever the person signs in or out, because the skin follows the person's firm.
  // After sign-in it also loads the firm's settings (such as whether property costs are derived into cash
  // flow). The data load below waits for this, so screens never compute with the previous firm's settings.
  const skinPromiseRef=useRef(Promise.resolve());
  useEffect(()=>{
    skinPromiseRef.current=(async()=>{
      let changed=false;
      if(RUNTIME_BRAND){
        changed=await loadActiveBrandProfile();
        if(changed)setSkinTick(t=>t+1);
        setBrandReady(true);
      }
      if(authed){await loadFirmDefaults();}
    })().catch(()=>{});
  },[authed]);

  // Send the user back to the dashboard whenever the current tab isn't one their
  // role is allowed to open — which is what happens after a sign-out/sign-in,
  // since this component (and therefore `tab`) is never torn down.
  useEffect(()=>{
    if(!userProfile)return;
    if(!allowedTabIds.includes(tab))setTab("dashboard");
  },[userProfile,tab,allowedTabIds]);

  const[needsPasswordSetup,setNeedsPasswordSetup]=useState(false);
  // Two-step sign-in: null while checking, false when done or not needed, else what MfaGate should show.
  const[mfaNeed,setMfaNeed]=useState(null);
  // Sign-in is complete (password, plus the authenticator when the account uses one): the native app may now offer
  // Face ID for next time (BiometricLock.jsx). Nothing listens on the website.
  useEffect(()=>{if(authed&&userProfile&&mfaNeed===false)window.dispatchEvent(new window.Event("ordanis:signed-in"));},[authed,userProfile,mfaNeed]);
  // Native app: navy around the app until the person is inside the portal, white (dark status bar text) once in.
  useEffect(()=>{if(!IS_NATIVE_APP)return;
    const inPortal=!!(authed&&userProfile&&mfaNeed===false&&!needsPasswordSetup);
    setInPortal(inPortal);
    // The sign-in keyboard can leave the page scrolled; start the portal at the top, below the status bar.
    if(inPortal)window.scrollTo(0,0);
  },[authed,userProfile,mfaNeed,needsPasswordSetup]);
  useEffect(()=>{
    if(!authed||!userProfile){setMfaNeed(null);return;}
    let stop=false;
    const staff=MFA_REQUIRED_ROLES.includes(userProfile.role);
    mfaStatus().then(st=>{
      if(stop)return;
      if(st.current==="aal2")setMfaNeed(false);
      else if(st.verified.length)setMfaNeed({mode:"challenge",factorId:st.verified[0].id});
      else setMfaNeed(staff?{mode:"enroll"}:false);
    }).catch(()=>{if(!stop)setMfaNeed(staff?{mode:"error"}:false);});
    return()=>{stop=true;};
  },[authed,userProfile?.id,userProfile?.role]);
  useEffect(()=>{
    const inviteCheck=session=>{if(ARRIVED_FROM_INVITE&&session?.user){ARRIVED_FROM_INVITE=false;setNeedsPasswordSetup(true);}};
    // A one-time pass from the phone app is exchanged first, so the session check below already sees it.
    consumeWebHandoff().finally(()=>sb.auth.getSession().then(({data:{session}})=>{if(session?.user){setAuthed(true);loadProfile(session.user.id);}inviteCheck(session);setAuthLoading(false);}));
    const{data:{subscription}}=sb.auth.onAuthStateChange((event,session)=>{
      if(session?.user){setAuthed(true);loadProfile(session.user.id);}else{setAuthed(false);setUserProfile(null);}
      // Fired for BOTH a "forgot password" reset link and an invite link (e.g. the Business
      // Partner portal invite) -- Supabase routes an invite through the same recovery-token
      // mechanism. Until this, nothing here ever prompted for a new password: the link just
      // signed the person straight into their dashboard with no password ever set, so they could
      // never log back in on their own afterward.
      if(event==="PASSWORD_RECOVERY")setNeedsPasswordSetup(true);
      inviteCheck(session);
      setAuthLoading(false);
    });
    return()=>subscription.unsubscribe();
  },[loadProfile]);

  // A sign-out elsewhere ("Sign out everywhere", an admin's 2-step reset, a password change) ends this login's
  // sessions on the server, but this tab's access pass keeps reading data until it expires, while anything that
  // checks the session (e.g. firm invoices) answers "Not authenticated". So check with the server whenever the
  // tab comes back into view and every two minutes; if the session is gone, sign this tab out and say why.
  // Network trouble is not a sign-out: only an explicit "session not found / bad token" ends it.
  useEffect(()=>{
    if(!authed)return;
    let busy=false;
    const check=async()=>{
      if(busy||document.visibilityState==="hidden")return;
      busy=true;
      try{
        const{error}=await sb.auth.getUser();
        const code=String(error?.code||"");
        if(error&&(code==="session_not_found"||code==="session_expired"||code==="bad_jwt"||code==="user_not_found"||error.status===403||error.name==="AuthSessionMissingError")){
          noteSignedOut("revoked");
          resetAssistantPromptSession();
          await sb.auth.signOut({scope:"local"});
          setAuthed(false);setUserProfile(null);setTab("dashboard");
        }
      }catch(_e){/* offline: try again later */}
      busy=false;
    };
    const onVis=()=>{if(document.visibilityState==="visible")check();};
    document.addEventListener("visibilitychange",onVis);
    window.addEventListener("focus",check);
    const t=setInterval(check,120000);
    return()=>{document.removeEventListener("visibilitychange",onVis);window.removeEventListener("focus",check);clearInterval(t);};
  },[authed]);

  const fetchTable=useCallback(async table=>{
    const prof=profileRef.current;
    let q=sb.from(table).select("*").order("created_at",{ascending:false});
    if(prof?.role==="advisor"||prof?.role==="analyst"){
      if(table==="families"){
        // An Expert sees the households they lead. An Analyst sees every household of the Experts they
        // support; the database rules (current_user_allowed_family_ids) return exactly those, so no
        // extra filter here.
        // (No advisor_email filter any more: the database returns the Expert's own households plus any they are
        // the Onboarding Specialist for, migration 20261022140000.)
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
    if(table==="families"&&(prof?.role==="advisor"||prof?.role==="analyst"))allowedFamilyIdsRef.current=rows.map(r=>r.id);
    setData(p=>({...p,[table]:rows.map(toClient)}));
  },[showToast]);

  const reload=useCallback(async table=>{
    if(table){await fetchTable(table);return;}
    await fetchTable("families"); // load families first so allowed-id cache is set
    await Promise.all(TABLES.filter(t=>t!=="families").map(fetchTable));
  },[fetchTable]);

  // Scaling step 2: staff screens load on demand, behind platform_config.staff_on_demand (an admin switches it on or
  // off with no deploy; it is read at each sign-in). When on, a staff sign-in skips the full download below and each
  // screen asks for what it shows. Partners keep the full download: their view only ever covers their own linked
  // household(s).
  const[staffOnDemand,setStaffOnDemand]=useState(false);

  useEffect(()=>{
    if(!authed||!userProfile||mfaNeed!==false)return; // load nothing until two-step sign-in is done
    (async()=>{
      setLoading(true);
      await skinPromiseRef.current;
      if(userProfile.role==="enterprise_admin"){
        // Firm administrator: FirmDashboard loads one household at a time, after recording that it was opened.
      } else if(userProfile.role==="client"){
        // Client: only load their family's data
        await Promise.all(TABLES.map(fetchTable));
      } else {
        let onDemand=false;
        if(userProfile.role!=="partner"){
          const{data:cfg}=await sb.from("platform_config").select("staff_on_demand").maybeSingle();
          onDemand=!!cfg?.staff_on_demand;
        }
        setStaffOnDemand(onDemand);
        if(!onDemand)await reload();
      }
      setLoading(false);
    })();
  },[authed,userProfile,mfaNeed]);

  // While isWelcomeRedirect and this client's family hasn't shown up yet, re-check every couple
  // of seconds instead of leaving them stuck on a dead-end screen the instant they land here.
  // Gives up after ~40s (comfortably past normal webhook delivery) and lets the existing "contact
  // your Expert" message take over -- at that point something has genuinely gone wrong and is
  // worth a human looking at, rather than ordinary async lag.
  useEffect(()=>{
    if(!isWelcomeRedirect||welcomeWaitElapsed)return;
    if(userProfile?.role!=="client"||userProfile.familyId)return;
    let cancelled=false;
    let tries=0;
    let timer=null;
    const MAX_TRIES=20;
    const poll=async()=>{
      if(cancelled)return;
      tries++;
      await loadProfile(userProfile.id);
      await fetchTable("families");
      if(cancelled)return;
      if(tries>=MAX_TRIES){setWelcomeWaitElapsed(true);return;}
      timer=setTimeout(poll,2000);
    };
    timer=setTimeout(poll,2000);
    return()=>{cancelled=true;if(timer)clearTimeout(timer);};
  },[isWelcomeRedirect,welcomeWaitElapsed,userProfile?.role,userProfile?.familyId,userProfile?.id,loadProfile,fetchTable]);

  // Once this client's family has actually shown up, the ?welcome=1 marker has done its job --
  // drop it so a later refresh or a bookmarked/shared link doesn't carry it around forever.
  useEffect(()=>{
    if(!isWelcomeRedirect||userProfile?.role!=="client"||!userProfile.familyId)return;
    try{
      const url=new URL(window.location.href);
      url.searchParams.delete("welcome");
      window.history.replaceState({},"",url.pathname+url.search+url.hash);
    }catch(_e){}
  },[isWelcomeRedirect,userProfile?.role,userProfile?.familyId]);

  const _isAdmin=userProfile?.role==="admin";
  const _myEmail=(userProfile?.email||"").toLowerCase();
  const _contactAdv=id=>{const c=data.contacts.find(x=>x.id===id);return (c?.advisorEmail||"").toLowerCase();};
  const _dealAdv=d=>(d.advisorEmail||"").toLowerCase();
  const _mine=e=>_isAdmin||(!!e&&e===_myEmail);
  const cmStats={families:data.families.filter(isActiveFamily).length,portfolio:(data.portfolio_accounts||[]).length,"cm-notes":data.notes.filter(n=>n.familyId).length,"cm-tasks":data.tasks.filter(t=>t.familyId&&!t.done).length};
  const pStats={"p-contacts":data.contacts.filter(c=>!c.familyId&&_mine((c.advisorEmail||"").toLowerCase())).length,"p-pipeline":data.deals.filter(d=>!d.familyId&&d.stage!=="Closed Lost"&&_mine(_dealAdv(d))).length,"p-notes":data.notes.filter(n=>!n.familyId&&_mine(_contactAdv(n.contactId))).length,"p-tasks":data.tasks.filter(t=>!t.familyId&&!t.done&&_mine(_contactAdv(t.contactId))).length};
  // With staff data on demand the sidebar counts come from the server (active households), refreshed on each tab change.
  const[navCounts,setNavCounts]=useState(null);
  useEffect(()=>{
    if(!staffOnDemand)return;
    (async()=>{
      const[{data:sm},{count:nc}]=await Promise.all([
        sb.rpc("staff_dashboard_summary",{p_scope:null,p_today:localISODate()}),
        sb.from("notes").select("id",{count:"exact",head:true}).not("family_id","is",null),
      ]);
      if(sm)setNavCounts({families:Number(sm.families)||0,portfolio:Number(sm.accounts)||0,"cm-notes":nc||0,"cm-tasks":Number(sm.open_tasks)||0,overdue:Number(sm.overdue)||0});
    })();
  },[staffOnDemand,tab]);
  const allStats=staffOnDemand?{...(navCounts||{}),users:0}:{...cmStats,...pStats,users:0};
  const overdue=staffOnDemand?(navCounts?.overdue||0):data.tasks.filter(t=>t.familyId&&!t.done&&t.dueDate&&dueEnd(t.dueDate)<new Date()).length;
  // Plan requests waiting for an admin, shown as a badge on the sidebar item. Refreshed on every tab
  // change and after each decision, so it never needs its own polling.
  const[pendingPlanRequests,setPendingPlanRequests]=useState(0);
  const loadPendingPlanRequests=async()=>{
    if(userProfile?.role!=="admin")return;
    const{count,error}=await sb.from("plan_change_requests").select("id",{count:"exact",head:true}).eq("status","pending");
    if(!error)setPendingPlanRequests(count||0);
  };
  useEffect(()=>{loadPendingPlanRequests();},[userProfile?.role,tab]);
  const currentLabel=ALL_NAV.find(n=>n.id===tab)?.label||"";
  const currentSection=NAV_SECTIONS.find(s=>s.items.some(i=>i.id===tab))?.section||"";

  // Hold the first paint until runtime branding has resolved, so the login
  // screen never flashes the previously active tenant's colours or logo.
  if(!brandReady||authLoading)return <div style={{minHeight:"100vh",background:preBg(),display:"flex",alignItems:"center",justifyContent:"center"}}><Spinner/></div>;
  if(!authed||!userProfile)return <LoginScreen/>;
  if(needsPasswordSetup)return <SetPasswordGate onDone={()=>setNeedsPasswordSetup(false)}/>;
  if(mfaNeed===null)return <div style={{minHeight:"100vh",background:preBg(),display:"flex",alignItems:"center",justifyContent:"center"}}><Spinner/></div>;
  if(mfaNeed)return <MfaGate {...mfaNeed} role={userProfile.role} onDone={()=>setMfaNeed(false)} onSignOut={logout}/>;
  if(userProfile.active===false)return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:B.bg,fontFamily:"'DM Sans',sans-serif",color:B.navy,fontSize:16,flexDirection:"column",gap:12}}><div style={{fontSize:40}}>🔒</div>Your account has been deactivated. Contact your administrator.</div>;

  // Client role — show read-only family dashboard
  if(userProfile.role==="client"){
    const clientFamily=data.families.find(f=>f.id===userProfile.familyId);
    if(loading)return <div style={{minHeight:"100vh",background:preBg(),display:"flex",alignItems:"center",justifyContent:"center"}}><Spinner/></div>;
    if(!clientFamily){
      // Fresh from Stripe Checkout and the webhook hasn't created the family yet -- see the
      // polling effect above. Show a normal "getting things ready" screen instead of the
      // dead-end message while that's still plausible.
      if(isWelcomeRedirect&&!welcomeWaitElapsed)return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:B.bg,flexDirection:"column",gap:16,color:B.navy,fontFamily:"'DM Sans',sans-serif"}}><PCMLogo/><Spinner/><div style={{marginTop:4,fontSize:15,textAlign:"center",maxWidth:360,color:B.textSoft,lineHeight:1.5}}>Finishing setting up your account — this usually takes just a few seconds…</div></div>;
      return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:B.bg,flexDirection:"column",gap:12,color:B.navy,fontFamily:"'DM Sans',sans-serif"}}><PCMLogo/><div style={{marginTop:20,fontSize:16}}>No family assigned to your account. Contact your ORDANIS Expert.</div><button onClick={logout} style={{marginTop:12,background:"none",border:`1px solid ${B.border}`,borderRadius:8,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit",color:B.textSoft}}>Sign Out</button></div>;
    }
    return <><ClientDashboard family={clientFamily} data={data} userProfile={userProfile} logout={logout} toast={showToast} reload={reload}/><FloatingAssistant family={clientFamily} data={data} reload={reload} toast={showToast} userProfile={userProfile}/>{toastState&&<Toast msg={toastState.msg} type={toastState.type}/>}<UpdateBanner/></>;
  }

  // Partner role — view-only across their linked family/families; can upload/download documents only
  if(userProfile.role==="partner"){
    if(loading)return <div style={{minHeight:"100vh",background:preBg(),display:"flex",alignItems:"center",justifyContent:"center"}}><Spinner/></div>;
    return <><Suspense fallback={<div style={{minHeight:"100vh",background:preBg(),display:"flex",alignItems:"center",justifyContent:"center"}}><Spinner/></div>}><PartnerDashboard data={data} userProfile={userProfile} logout={logout} toast={showToast} reload={reload}/></Suspense><FloatingAssistant families={data.families||[]} data={data} reload={reload} toast={showToast} userProfile={userProfile}/>{toastState&&<Toast msg={toastState.msg} type={toastState.type}/>}<UpdateBanner/></>;
  }


  // Firm administrator: their own firm's households, view only
  if(userProfile.role==="enterprise_admin"){
    return <><Suspense fallback={<div style={{minHeight:"100vh",background:preBg(),display:"flex",alignItems:"center",justifyContent:"center"}}><Spinner/></div>}><FirmDashboard userProfile={userProfile} logout={logout} toast={showToast}/></Suspense>{toastState&&<Toast msg={toastState.msg} type={toastState.type}/>}<UpdateBanner/></>;
  }

  // For families tab, header shows differently when inside a family dashboard
  const isFamiliesTab=tab==="families";

  return <div style={{display:"flex",height:FULL_H,background:B.bg,fontFamily:"'DM Sans','Helvetica Neue',sans-serif",color:B.text,overflow:"hidden",flexDirection:"row"}}>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>

    {/* Mobile backdrop */}
    {isMobile&&sidebarOpen&&<div onClick={()=>setSidebarOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:99,backdropFilter:"blur(2px)"}}/>}

    {/* Sidebar */}
    <div style={{width:isMobile?260:232,background:B.white,borderRight:`1px solid ${B.borderLight}`,display:"flex",flexDirection:"column",flexShrink:0,position:isMobile?"fixed":"relative",top:0,bottom:0,left:isMobile?(sidebarOpen?0:-280):0,zIndex:100,paddingTop:isMobile?"env(safe-area-inset-top)":0,boxSizing:"border-box",transition:isMobile?"left 0.25s ease":"none",boxShadow:isMobile&&sidebarOpen?"4px 0 24px rgba(0,0,0,0.15)":"none"}}>
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
            {item.id==="planrequests"&&pendingPlanRequests>0?<span title="Waiting for a decision" style={{background:B.gold,borderRadius:10,padding:"1px 6px",fontSize:9,color:B.navy,fontWeight:700}}>{pendingPlanRequests}</span>:item.id==="cm-tasks"&&overdue>0?<span style={{background:"#d43030",borderRadius:10,padding:"1px 6px",fontSize:9,color:"#fff",fontWeight:700}}>{overdue}</span>:allStats[item.id]>0?<span style={{background:B.bg,border:`1px solid ${B.borderLight}`,borderRadius:10,padding:"1px 6px",fontSize:9,color:B.textMid}}>{allStats[item.id]}</span>:null}
          </button>)}
        </div>)}
      </nav>
      <div style={{padding:"10px 16px",borderTop:`1px solid ${B.borderLight}`}}>
        {userProfile&&<div style={{marginBottom:8}}><div style={{fontSize:11,color:B.navy,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userProfile.fullName||userProfile.email}</div><div style={{fontSize:9,color:B.navyMid,letterSpacing:"0.1em",textTransform:"uppercase",marginTop:1}}>{roleLabel(userProfile.role)}</div></div>}
        <div style={{fontSize:9,color:B.textMute,marginBottom:4}}>{staffOnDemand?(navCounts?.families||0):data.families.filter(isActiveFamily).length} families · {staffOnDemand?(navCounts?.portfolio||0):(data.portfolio_accounts||[]).length} accounts</div>
        <div style={{display:"flex",justifyContent:"space-between"}}>
          <button onClick={()=>staffOnDemand?setNavNonce(n=>n+1):reload()} style={{background:"none",border:"none",color:B.navyMid,fontSize:9,cursor:"pointer",padding:0,fontFamily:"inherit"}}>↺ Refresh</button>
          <SecurityButton role={userProfile?.role} toast={showToast} label="🔒 Security" style={{background:"none",border:"none",color:B.navyMid,fontSize:9,cursor:"pointer",padding:0,fontFamily:"inherit"}}/>
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
      {isMobile&&tab==="families"&&<button onClick={()=>setSidebarOpen(true)} style={{position:"fixed",top:"calc(14px + env(safe-area-inset-top))",left:14,zIndex:50,background:B.white,border:`1px solid ${B.borderLight}`,borderRadius:8,padding:"8px 10px",fontSize:18,color:B.navy,cursor:"pointer",boxShadow:B.shadow,display:"flex",alignItems:"center"}} aria-label="Open menu">☰</button>}

      <div style={{flex:1,minHeight:0,overflow:"hidden",background:B.bg,paddingBottom:"0"}}>
        {loading&&tab!=="families"&&tab!=="users"?<Spinner/>:<Suspense fallback={<Spinner/>}>
          {tab==="dashboard"   &&(staffOnDemand
            ?<DashboardOnDemand key={navNonce} userProfile={userProfile} toast={showToast} onOpenFamily={(familyId,subTab)=>{setNavIntent({familyId,subTab});setTab("families");}}/>
            :<Dashboard key={navNonce} data={data} userProfile={userProfile} reload={reload} toast={showToast} onOpenFamily={(familyId,subTab)=>{setNavIntent({familyId,subTab});setTab("families");}}/>)}
          {tab==="families"    &&(staffOnDemand
            ?<FamiliesPagedView key={navNonce} toast={showToast} userProfile={userProfile} navIntent={navIntent} onNavConsumed={()=>setNavIntent(null)}/>
            :<FamiliesView key={navNonce} data={data} reload={reload} toast={showToast} userProfile={userProfile} navIntent={navIntent} onNavConsumed={()=>setNavIntent(null)}/>)}
          {tab==="portfolio"   &&(staffOnDemand
            ?<ScopedStaffView key={navNonce} userProfile={userProfile} toast={showToast} tables={["portfolio_accounts"]} what="portfolio accounts" render={(d,r)=><PortfolioView data={d} reload={r} toast={showToast} userProfile={userProfile} hideScope/>}/>
            :<PortfolioView key={navNonce} data={data} reload={reload} toast={showToast} userProfile={userProfile}/>)}
          {tab==="cm-notes"    &&(staffOnDemand
            ?<ScopedStaffView key={navNonce} userProfile={userProfile} toast={showToast} tables={["contacts","notes"]} what="notes" render={(d,r)=><NotesView data={d} reload={r} toast={showToast} userProfile={userProfile} hideScope/>}/>
            :<NotesView key={navNonce} data={{...data,notes:data.notes.filter(n=>n.familyId)}} reload={reload} toast={showToast} userProfile={userProfile}/>)}
          {tab==="cm-tasks"    &&(staffOnDemand
            ?<ScopedStaffView key={navNonce} userProfile={userProfile} toast={showToast} tables={["contacts","tasks"]} what="tasks" render={(d,r)=><TasksView data={d} reload={r} toast={showToast} userProfile={userProfile} hideScope/>}/>
            :<TasksView key={navNonce} data={{...data,tasks:data.tasks.filter(t=>t.familyId)}} reload={reload} toast={showToast} userProfile={userProfile}/>)}
          {/* Admin-only screens are gated on the role here as well as in the
              sidebar. The sidebar alone isn't sufficient: `tab` is state on a
              component that never unmounts, so it survives a sign-out and the
              next user would otherwise land on whatever the previous one had
              open. */}
          {tab==="users"       &&isAdminRole&&(staffOnDemand
            ?<WithAllFamilies key={navNonce}>{fams=><UserManagementView userProfile={userProfile} data={{families:fams}} toast={showToast}/>}</WithAllFamilies>
            :<UserManagementView key={navNonce} userProfile={userProfile} data={data} toast={showToast}/>)}
          {tab==="signups"     &&isAdminRole&&(staffOnDemand
            ?<SignupsOnDemand key={navNonce} userProfile={userProfile} toast={showToast}/>
            :<SignupsRevenueView key={navNonce} data={data} toast={showToast} userProfile={userProfile} reload={reload}/>)}
          {tab==="planrequests"&&isAdminRole&&(staffOnDemand
            ?<WithAllFamilies key={navNonce}>{(fams,refresh)=><PlanRequestsView data={{families:fams}} toast={showToast} reload={refresh} onChanged={loadPendingPlanRequests}/>}</WithAllFamilies>
            :<PlanRequestsView key={navNonce} data={data} toast={showToast} reload={reload} onChanged={loadPendingPlanRequests}/>)}
          {tab==="enterprises" &&isAdminRole&&<EnterprisesView key={navNonce} toast={showToast} userProfile={userProfile} onOpenBranding={BRAND_ADMIN?()=>setTab("branding"):null}/>}
          {tab==="firmbilling" &&isAdminRole&&<FirmBillingView key={navNonce} toast={showToast}/>}
          {tab==="staterules"  &&isAdminRole&&<StateRulesView key={navNonce} userProfile={userProfile} toast={showToast}/>}
          {tab==="utilization" &&isAdminRole&&<UtilizationView key={navNonce} toast={showToast}/>}
          {tab==="branding"    &&isAdminRole&&BRAND_ADMIN&&<BrandingView key={navNonce} toast={showToast}/>}
          {tab==="resources"   &&(staffOnDemand
            ?<WithAllFamilies key={navNonce}>{fams=><ResourcesView data={{families:fams}} userProfile={userProfile} toast={showToast} onDemand/>}</WithAllFamilies>
            :<ResourcesView key={navNonce} data={data} userProfile={userProfile} toast={showToast}/>)}
          {tab==="p-contacts"  &&<ProspectContactsView key={navNonce} data={data} reload={reload} toast={showToast} userProfile={userProfile}/>}
          {tab==="p-pipeline"  &&<ProspectPipelineView key={navNonce} data={data} reload={reload} toast={showToast} userProfile={userProfile}/>}
          {tab==="p-notes"     &&<NotesView key={navNonce} data={{...data,notes:data.notes.filter(n=>!n.familyId),families:[]}} reload={reload} toast={showToast} userProfile={userProfile} prospectMode={true}/>}
          {tab==="p-tasks"     &&<TasksView key={navNonce} data={{...data,tasks:data.tasks.filter(t=>!t.familyId),families:[]}} reload={reload} toast={showToast} userProfile={userProfile} prospectMode={true}/>}
        </Suspense>}
      </div>
    </div>
    <FloatingAssistant families={data.families||[]} data={data} reload={reload} toast={showToast} userProfile={userProfile} onDemand={staffOnDemand}/>
    {toastState&&<Toast msg={toastState.msg} type={toastState.type}/>}<UpdateBanner/>
  </div>;
}

// Shared with staff.jsx (the staff screens import these back from here).
export { ACCT_TYPES, AssistantWelcome, AttachLink, B, BRAND, BRAND_DOCS, Badge, Btn, CURRENT_USER_LABEL, CashFlowView, CollapseBox, DEBT_LINE_KINDS, DOC_CATEGORIES, DOC_UPLOAD_EXTS, DocLink, DocumentsView, DraftReviewModal, EMAIL_RE, EmailLink, Empty, FAMILY_SCOPED, FIRM_DEFAULTS, FIRM_GATE_MSG, FULL_H, FamilyAssistant, Field, GoldLine, Grid2, HouseholdSectionMenu, Inp, JOINED_VIA_TEXT, LoanForm, LoansPanel, MFA_CARD, MFA_ERR, MFA_REQUIRED_ROLES, MIN_PASSWORD_LENGTH, MfaCodeInput, Modal, MoneyInput, ObligationsSection, PCMLogo, PRIORITY_COLORS, PROP_TYPES, PhoneLink, PropertyContactForm, PropertyForm, PropertySecuredLoans, REMINDER_OPTIONS, RecurrenceField, ReqHint, SIGNUP_PLAN_ORDER, STEP_ACTORS, STEP_KINDS, STEP_STATUS_TINT, SUPABASE_KEY, SUPABASE_URL, SectionLabel, SecurityButton, Sel, Spinner, StatBox, TAB_MOTION_CSS, TaskForm, Tex, VALUABLE_CATS, ValuableForm, ValuablePolicyDetails, _greetedFamilies, actorLabel, buildVendorOptions, callFirmJoin, contactProblem, dateOnly, docFileProblem, dueEnd, escHtml, fetchAllRows, firmDocGate, fmt, fmtMoney, fmtPct, formatPhoneInput, inp, isActiveFamily, isValidPhone, kindLabel, loadFirmDefaults, loadHouseholdBundle, loadNoteAttachments, loanOnListedProperty, loanRowFromForm, loanTitle, loansDebt, localDayISO, localISODate, mfaCodeMessage, mfaStatus, mortgageOntoProperty, nextRecurrence, numOrNull, parseLocalDate, pctChange, reminderDaysOr7, roleLabel, sb, scheduleNextOccurrence, statusWord, stepTransitionPatch, toClient, todayISO, useIsMobile, useTabEntrance, valuableRowFromForm };
