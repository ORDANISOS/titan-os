// src/SignupFlow.jsx
// Public, unauthenticated sign-up flow: Plans -> Account -> Stripe Checkout.
// Rendered by main.jsx instead of <App/> whenever the URL path starts with /signup, so it never
// touches App.jsx's authenticated shell or its hooks. See main.jsx for that branch.
//
// Talks to two things directly:
//   - plan_features (read-only, anon) for live pricing -- see the plan_features_public_read RLS
//     policy. Falls back to the hardcoded PLAN_COPY prices below if that fetch fails, so the page
//     still works, but the DB is the source of truth and is what public-signup actually charges.
//   - the public-signup Edge Function, which creates the Auth user and starts a Stripe Checkout
//     Session. It deliberately does NOT create the household -- see that function's own comment.
//
// After public-signup returns a Checkout URL, this signs the new user in locally (so a session
// already exists in localStorage) before navigating to Stripe. When Stripe redirects back to
// success_url, the main app's own sb.auth.getSession() picks up that persisted session and the
// existing role==="client" branch in App.jsx (ClientDashboard) takes over from there -- nothing
// else needed to be built for that landing experience.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// Standalone mobile check -- this file is rendered by main.jsx in place of <App/> (see the
// header comment) and deliberately doesn't import anything from App.jsx, so it gets its own
// small copy of the same breakpoint hook rather than reaching across entry points.
function useIsMobile(bp = 720) {
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < bp);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bp]);
  return isMobile;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://unkirihxtruhdjeldfpm.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVua2lyaWh4dHJ1aGRqZWxkZnBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTA3MjUsImV4cCI6MjA5MTcyNjcyNX0._Ve9Pr3ooja-YdHYFIupebaZRhDjmJDnz2b-vzrhY04";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const SIGNUP_FN_URL = `${SUPABASE_URL}/functions/v1/public-signup`;

const BRAND_NAME = import.meta.env.VITE_BRAND_NAME || "ORDANIS";
const BRAND_TAGLINE = import.meta.env.VITE_BRAND_TAGLINE || "Private Wealth Administration";

// ── Palette, taken directly from the approved "Sign-up Flow" design (Plans.dc.html /
// Account.dc.html). Deliberately not the app's own BRAND/PRIMARY constants -- this is the new,
// public-facing front door and follows the design system it was approved in.
const C = {
  navy: "#0A2540",
  gold: "#C9A961",
  slate: "#3F5470",
  rule: "#E2E0D8",
  muted: "#8A94A3",
};

// Static marketing copy -- feature bullet lists aren't data columns, so this stays hand-authored
// to match the approved design. Prices are placeholders only: plan_features.monthly_price
// (fetched below) overrides them whenever that fetch succeeds, and that same column is what
// public-signup actually bills, so the two can't quietly drift apart for long even if this fetch
// fails once.
// Feature lists mirror the marketing site's tier cards exactly (see ordanis-site
// preview/index.html): each tier lists everything the tier below it has, plus its own
// additions flagged `isNew` -- no crossed-out/excluded items anywhere, so the growth
// reads as purely additive going up in price.
const BASE_FEATURES = [
  { text: "Client portal access" },
  { text: "Properties, portfolio and balance history" },
  { text: "Cash flow and projections" },
  { text: "Vault: documents, folders, expiry tracking" },
  { text: "Valuables, tasks, notes and deals" },
  { text: "AI assistant over the household's own record" },
];

const PLAN_COPY = {
  basic: {
    label: "Basic",
    eyebrow: "If you want the record kept",
    tagline: "Everything in one place, properly.",
    price: 15,
    features: [
      ...BASE_FEATURES,
      { text: "Complimentary 30-day Onboarding Assistant", isNew: true },
    ],
    cta: "Choose Basic",
  },
  core: {
    label: "Core",
    eyebrow: "If you want the work run",
    tagline: "Self-directed, with the work running.",
    price: 100,
    features: [
      ...BASE_FEATURES,
      { text: "Complimentary 30-day Onboarding Assistant" },
      { text: "Scheduled prompts", isNew: true },
      { text: "10 workflows and obligations included", isNew: true },
      { text: "Add up to 40 additional workflows anytime", isNew: true },
    ],
    cta: "Choose Core",
  },
  premier: {
    label: "Premier",
    eyebrow: "If you want it done for you",
    tagline: "Someone who knows the household.",
    price: 500,
    features: [
      ...BASE_FEATURES,
      { text: "Complimentary 30-day Onboarding Assistant" },
      { text: "Named ORDANIS Expert leads the household", isNew: true },
      { text: "Scheduled prompts and concierge research", isNew: true },
      { text: "Workflows and obligations, run end to end", isNew: true },
      { text: "Property management oversight", isNew: true },
      { text: "Bill pay with a per-period payment register", isNew: true },
      { text: "Client activity reporting", isNew: true },
    ],
    cta: "Choose Premier",
  },
};
const PLAN_ORDER = ["basic", "core", "premier"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;

function EyebrowLine({ children }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontFamily: "Georgia,serif", fontStyle: "italic", fontWeight: 500, fontSize: ".92rem", color: C.navy, marginBottom: "1.1em" }}>
      <span style={{ width: 26, height: 1, background: C.gold }} />{children}
    </div>
  );
}

// Ordanis_Lockup_Stacked, on-white variant (see the brand Logo Kit): centred wordmark,
// gold dividing rule, tagline below. Built as inline SVG (not an image asset) so it
// stays crisp at any size and follows BRAND_NAME/BRAND_TAGLINE for white-label tenants.
function StackedLogo({ width = 220 }) {
  return (
    <svg viewBox="0 0 760 200" width={width} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={BRAND_NAME}>
      <text x="380" y="105" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight="bold" fontSize="70" letterSpacing="9" fill={C.navy}>{BRAND_NAME.toUpperCase()}</text>
      <line x1="280" y1="133" x2="480" y2="133" stroke={C.gold} strokeWidth="2" />
      <text x="380" y="160" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="14" letterSpacing="5" fill={C.slate} fontWeight="bold">{BRAND_TAGLINE.toUpperCase()}</text>
    </svg>
  );
}

function Header({ onBack, backLabel }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ padding: isMobile ? "12px 18px" : "14px 32px", borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
      <div style={{ textAlign: "center" }}>
        <StackedLogo width={isMobile ? 150 : 220} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 16 : 26 }}>
        {onBack && (
          <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }} style={{ fontSize: ".76rem", fontWeight: 500, letterSpacing: ".06em", textTransform: "uppercase", color: C.slate, cursor: "pointer" }}>
            {backLabel || "Back"}
          </a>
        )}
        <a href="/" style={{ fontSize: ".76rem", fontWeight: 500, letterSpacing: ".06em", textTransform: "uppercase", color: C.slate }}>Sign In</a>
      </div>
    </div>
  );
}

function PlanCard({ planKey, plan, price, onChoose }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.gold}`, borderRadius: 3, padding: isMobile ? "26px 22px" : "34px 30px", display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: ".72rem", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: C.muted, marginBottom: 8 }}>{plan.eyebrow}</div>
      <h4 style={{ fontFamily: "Georgia,serif", fontWeight: 500, fontSize: "1.4rem", color: C.navy, margin: "0 0 6px" }}>{plan.label}</h4>
      <div style={{ fontFamily: "Georgia,serif", fontStyle: "italic", color: C.slate, fontSize: ".92rem", marginBottom: 14 }}>{plan.tagline}</div>
      <div style={{ fontFamily: "Georgia,serif", fontSize: "2.4rem", fontWeight: 460, color: C.navy, letterSpacing: "-.01em", marginBottom: 16 }}>
        ${price}<span style={{ fontSize: ".88rem", fontWeight: 300, color: C.muted, fontFamily: "inherit" }}> / month</span>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {plan.features.map((f, i) => (
          <li key={i} style={{
            display: "flex", gap: 10, alignItems: "flex-start", fontSize: ".88rem", color: C.slate,
            padding: f.isNew ? "9px 12px" : "9px 0",
            margin: f.isNew ? "0 -12px" : 0,
            borderRadius: f.isNew ? 4 : 0,
            background: f.isNew ? "rgba(201,169,97,0.10)" : "transparent",
            borderTop: i === 0 ? "none" : (f.isNew ? "1px solid transparent" : `1px solid ${C.rule}`),
          }}>
            <span style={{ flex: "none", width: 14, fontWeight: 700, lineHeight: 1.6, color: C.gold }}>✓</span>{f.text}
          </li>
        ))}
      </ul>
      <button
        onClick={() => onChoose(planKey)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", marginTop: "auto",
          padding: "16px 30px", borderRadius: 2, border: "none",
          background: C.gold, color: "#051423",
          fontWeight: 500, fontSize: ".78rem", letterSpacing: ".11em", textTransform: "uppercase",
          fontFamily: "inherit", cursor: "pointer",
        }}
      >
        {plan.cta}
      </button>
    </div>
  );
}

function PlansStep({ prices, onChoose }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: isMobile ? "24px 18px 40px" : "40px 32px 60px" }}>
      <div style={{ textAlign: "center", maxWidth: 720, margin: isMobile ? "0 auto 22px" : "0 auto 30px" }}>
        <EyebrowLine>Choose how much you want done for you</EyebrowLine>
        <h1 style={{ fontFamily: "Georgia,serif", color: C.navy, fontSize: isMobile ? "1.9rem" : "2.4rem", fontWeight: 460, margin: "0 0 .5em" }}>Three ways in</h1>
        <p style={{ color: C.slate, fontSize: "1rem", maxWidth: 640, margin: "10px auto 0" }}>Every plan sees all 49 workflows. What differs is how many run, and who does the work.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,minmax(0,1fr))", gap: isMobile ? 18 : 24, alignItems: "stretch" }}>
        {PLAN_ORDER.map((key) => (
          <PlanCard key={key} planKey={key} plan={PLAN_COPY[key]} price={prices[key] ?? PLAN_COPY[key].price} onChoose={onChoose} />
        ))}
      </div>

    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: "block", fontSize: ".78rem", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: C.navy, marginBottom: 7 }}>{label}</label>
      <input
        {...props}
        style={{ width: "100%", boxSizing: "border-box", padding: "14px 16px", fontSize: ".98rem", fontWeight: 300, fontFamily: "inherit", color: C.navy, border: `1px solid ${C.rule}`, borderRadius: 2, background: "#fff" }}
      />
    </div>
  );
}

function AccountStep({ planKey, prices, onBack, onDone }) {
  const isMobile = useIsMobile();
  const plan = PLAN_COPY[planKey];
  const price = prices[planKey] ?? plan.price;
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Disclosures: fetched live from signup_disclosures (public_read RLS -- see that table's
  // migration) rather than hardcoded here, same reasoning as plan_features pricing above -- the
  // text a person actually saw has to be the same text public-signup validates and records
  // against, and a hardcoded copy here could drift from it. is_draft on either row means it is
  // placeholder language pending legal review, not final compliant copy -- see the banner below.
  const [disclosures, setDisclosures] = useState({ subscription_terms: null, sms_consent: null });
  const [disclosuresLoading, setDisclosuresLoading] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeSms, setAgreeSms] = useState(false);
  useEffect(() => {
    let cancelled = false;
    sb.from("signup_disclosures")
      .select("id, kind, version, title, body_html, is_draft")
      .in("kind", ["subscription_terms", "sms_consent"])
      .order("version", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const next = {};
        for (const row of data) if (!next[row.kind]) next[row.kind] = row; // highest version per kind, first one seen
        setDisclosures(next);
        setDisclosuresLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const validate = () => {
    if (!fullName.trim()) return "Enter your name.";
    if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
    if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (!householdName.trim()) return "Tell us what to call the household.";
    if (!disclosures.subscription_terms || !disclosures.sms_consent) return "Disclosures are still loading -- one moment and try again.";
    if (!agreeTerms) return "Please read and agree to the Subscription Terms to continue.";
    if (!agreeSms) return "Please read and respond to the SMS consent notice to continue.";
    return "";
  };

  const submit = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError("");
    setSubmitting(true);
    try {
      const origin = window.location.origin;
      const resp = await fetch(SIGNUP_FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
        body: JSON.stringify({
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          household_name: householdName.trim(),
          plan: planKey,
          success_url: `${origin}/?welcome=1`,
          cancel_url: `${origin}/signup`,
          // public-signup re-validates these are the CURRENT version of each disclosure and
          // records the acknowledgment server-side -- this isn't just UI state, the account
          // isn't created without it. See that function's disclosure-check block.
          disclosures_acknowledged: {
            subscription_terms_disclosure_id: disclosures.subscription_terms?.id,
            sms_consent_disclosure_id: disclosures.sms_consent?.id,
          },
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(json?.error || "Something went wrong creating your account.");
        setSubmitting(false);
        return;
      }
      // Establish a local session before leaving for Stripe, so the persisted session is already
      // in localStorage by the time success_url reloads the main app. If this fails for some
      // reason the account and Checkout session still exist -- just log it, don't block payment.
      try {
        await sb.auth.signInWithPassword({ email: email.trim(), password });
      } catch (e) {
        console.error("Post-signup sign-in failed:", e);
      }
      onDone?.();
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: isMobile ? "28px 18px 40px" : "52px 32px 60px", display: "flex", gap: 40, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "1.2 1 420px" }}>
        <EyebrowLine>One step before payment</EyebrowLine>
        <h1 style={{ fontFamily: "Georgia,serif", color: C.navy, fontSize: isMobile ? "1.9rem" : "2.4rem", fontWeight: 460, margin: "0 0 .5em" }}>Create your account</h1>
        <p style={{ fontSize: "1.05rem", color: C.slate, marginTop: 12, maxWidth: 520 }}>So a declined card never costs you the work you have already done.</p>

        <div style={{ marginTop: 26, maxWidth: 520 }}>
          <Field label="Your name" type="text" placeholder="James Harrington" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          <Field label="Email" type="email" placeholder="james@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <Field label="Password" type="password" placeholder="At least 12 characters" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <Field label="What should we call the household?" type="text" placeholder="The Harrington Family" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} autoComplete="off" />
        </div>

        <div style={{ marginTop: 8, marginBottom: 8, maxWidth: 520 }}>
          {disclosuresLoading ? (
            <div style={{ fontSize: ".82rem", color: C.muted }}>Loading disclosures…</div>
          ) : (
            <>
              {[disclosures.subscription_terms, disclosures.sms_consent].some((d) => d?.is_draft) && (
                <div style={{ background: "#fff8e6", border: "1px solid #e8d38a", borderRadius: 4, padding: "9px 12px", fontSize: ".76rem", color: "#7a5a19", marginBottom: 12, fontWeight: 600, letterSpacing: ".02em" }}>
                  DRAFT LANGUAGE — placeholder text pending legal review.
                </div>
              )}
              {disclosures.subscription_terms && (
                <div style={{ marginBottom: 14 }}>
                  <div
                    style={{ maxHeight: 130, overflowY: "auto", border: `1px solid ${C.rule}`, borderRadius: 4, padding: "10px 12px", fontSize: ".8rem", color: C.slate, lineHeight: 1.5, background: "#fafaf8" }}
                    dangerouslySetInnerHTML={{ __html: disclosures.subscription_terms.body_html }}
                  />
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, fontSize: ".82rem", color: C.navy, cursor: "pointer" }}>
                    <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} style={{ marginTop: 2 }} />
                    I have read and agree to the Subscription Terms above.
                  </label>
                </div>
              )}
              {disclosures.sms_consent && (
                <div style={{ marginBottom: 4 }}>
                  <div
                    style={{ maxHeight: 130, overflowY: "auto", border: `1px solid ${C.rule}`, borderRadius: 4, padding: "10px 12px", fontSize: ".8rem", color: C.slate, lineHeight: 1.5, background: "#fafaf8" }}
                    dangerouslySetInnerHTML={{ __html: disclosures.sms_consent.body_html }}
                  />
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, fontSize: ".82rem", color: C.navy, cursor: "pointer" }}>
                    <input type="checkbox" checked={agreeSms} onChange={(e) => setAgreeSms(e.target.checked)} style={{ marginTop: 2 }} />
                    I have read the SMS consent notice above and agree as described.
                  </label>
                </div>
              )}
            </>
          )}
        </div>

        {error && (
          <div style={{ background: "#fdecec", border: "1px solid #f3c6c6", borderRadius: 4, padding: "12px 16px", color: "#8b1a1a", fontSize: ".88rem", marginBottom: 16, maxWidth: 520 }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <button
            onClick={submit}
            disabled={submitting}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "16px 30px",
              borderRadius: 2, background: submitting ? C.rule : C.gold, color: "#051423", border: "none",
              fontWeight: 500, fontSize: ".78rem", letterSpacing: ".11em", textTransform: "uppercase",
              fontFamily: "inherit", cursor: submitting ? "default" : "pointer",
            }}
          >
            {submitting ? "Creating account…" : "Continue to payment"}
          </button>
        </div>
        <p style={{ fontSize: ".82rem", color: C.muted, marginTop: 16, maxWidth: 520 }}>Payment is handled by Stripe. We never see or store your card.</p>
        <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }} style={{ fontSize: ".82rem", color: C.slate, textDecoration: "underline", cursor: "pointer" }}>Back to plans</a>
      </div>

      <div style={{ flex: "1 1 300px" }}>
        <div style={{ border: `1px solid ${C.rule}`, borderRadius: 3, padding: "32px 28px" }}>
          <div style={{ fontSize: ".72rem", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: C.muted, marginBottom: 12 }}>Your plan</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontFamily: "Georgia,serif", fontSize: "1.4rem", fontWeight: 500, color: C.navy }}>{plan.label}</span>
            <span style={{ fontFamily: "Georgia,serif", fontSize: "1.8rem", fontWeight: 460, color: C.navy }}>${price}<span style={{ fontSize: ".82rem", fontWeight: 300, color: C.muted }}> / mo</span></span>
          </div>
          <div style={{ marginTop: 16, fontSize: ".88rem" }}>
            {plan.features.slice(0, 4).map((f, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderTop: `1px solid ${C.rule}` }}>
                <span>{f.text}</span><span style={{ color: C.muted }}>included</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 20, fontSize: ".86rem", color: C.muted }}>Change plan, raise your ceiling or cancel at any time. Cancelling leaves your documents in place and available to download.</div>
      </div>
    </div>
  );
}

export default function SignupFlow() {
  const [step, setStep] = useState("plans");
  const [selectedPlan, setSelectedPlan] = useState("core");
  const [prices, setPrices] = useState({});

  useEffect(() => {
    let cancelled = false;
    sb.from("plan_features").select("plan, monthly_price").then(({ data, error }) => {
      if (cancelled || error || !data) return;
      const next = {};
      for (const row of data) next[row.plan] = Number(row.monthly_price);
      setPrices(next);
    });
    return () => { cancelled = true; };
  }, []);

  const chooseAndAdvance = (planKey) => { setSelectedPlan(planKey); setStep("account"); };

  return (
    <div style={{ minHeight: "100vh", background: "#fff", color: C.slate, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif", fontWeight: 300, fontSize: 16.5, lineHeight: 1.75 }}>
      <Header onBack={step === "account" ? () => setStep("plans") : undefined} backLabel="Back to plans" />
      {step === "plans"
        ? <PlansStep prices={prices} onChoose={chooseAndAdvance} />
        : <AccountStep planKey={selectedPlan} prices={prices} onBack={() => setStep("plans")} onDone={() => {}} />}
    </div>
  );
}
