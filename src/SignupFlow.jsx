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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://unkirihxtruhdjeldfpm.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVua2lyaWh4dHJ1aGRqZWxkZnBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTA3MjUsImV4cCI6MjA5MTcyNjcyNX0._Ve9Pr3ooja-YdHYFIupebaZRhDjmJDnz2b-vzrhY04";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const SIGNUP_FN_URL = `${SUPABASE_URL}/functions/v1/public-signup`;

const BRAND_NAME = import.meta.env.VITE_BRAND_NAME || "Ordanis";
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
const PLAN_COPY = {
  basic: {
    label: "Basic",
    eyebrow: "If you want the record kept",
    tagline: "Everything in one place, properly.",
    price: 15,
    features: [
      { ok: true, text: "Vault and household record" },
      { ok: true, text: "AI assistant" },
      { ok: true, text: "Properties, entities, accounts" },
      { ok: true, text: "5 GB of documents" },
      { ok: false, text: "No workflows" },
      { ok: false, text: "No Ordanis Expert" },
    ],
    cta: "Choose Basic",
    highlight: false,
  },
  core: {
    label: "Core",
    eyebrow: "If you want the work run",
    tagline: "Self-directed, with the work running.",
    price: 100,
    features: [
      { ok: true, text: "Everything in Basic" },
      { ok: true, text: "10 workflows a month, then $8 each" },
      { ok: true, text: "Obligations and deadline tracking" },
      { ok: true, text: "Digests and document generation" },
      { ok: true, text: "15 GB of documents" },
      { ok: false, text: "No Expert, at any price" },
    ],
    cta: "Choose Core",
    highlight: true,
  },
  premier: {
    label: "Premier",
    eyebrow: "If you want it done for you",
    tagline: "Someone who knows the household.",
    price: 500,
    features: [
      { ok: true, text: "Everything in Core" },
      { ok: true, text: "A named Ordanis Expert" },
      { ok: true, text: "3 Expert hours a month, $250 after" },
      { ok: true, text: "Bill pay execution" },
      { ok: true, text: "Unlimited workflows · 25 GB" },
      { ok: true, text: "Crisis workflows never metered" },
    ],
    cta: "Choose Premier",
    highlight: false,
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

function Header({ onBack, backLabel }) {
  return (
    <div style={{ padding: "14px 32px", borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Georgia,serif", fontWeight: "bold", fontSize: "1.3rem", letterSpacing: 2, color: C.navy }}>{BRAND_NAME.toUpperCase()}</div>
        <div style={{ fontWeight: 600, fontSize: 10, letterSpacing: ".22em", textTransform: "uppercase", color: C.slate, marginTop: 5 }}>{BRAND_TAGLINE}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
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
  return (
    <div style={{ background: "#fff", border: `1px solid ${plan.highlight ? C.gold : C.rule}`, borderRadius: 3, padding: "34px 30px", display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: ".72rem", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: plan.highlight ? C.gold : C.muted, marginBottom: 8 }}>{plan.eyebrow}</div>
      <h4 style={{ fontFamily: "Georgia,serif", fontWeight: 500, fontSize: "1.4rem", color: C.navy, margin: "0 0 6px" }}>{plan.label}</h4>
      <div style={{ fontFamily: "Georgia,serif", fontStyle: "italic", color: C.slate, fontSize: ".92rem", marginBottom: 14 }}>{plan.tagline}</div>
      <div style={{ fontFamily: "Georgia,serif", fontSize: "2.4rem", fontWeight: 460, color: C.navy, letterSpacing: "-.01em", marginBottom: 16 }}>
        ${price}<span style={{ fontSize: ".88rem", fontWeight: 300, color: C.muted, fontFamily: "inherit" }}> / month</span>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {plan.features.map((f, i) => (
          <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: ".88rem", color: f.ok ? C.slate : C.muted, padding: "9px 0", borderTop: i === 0 ? "none" : `1px solid ${C.rule}` }}>
            <span style={{ flex: "none", width: 14, fontWeight: 700, lineHeight: 1.6, color: f.ok ? C.gold : C.muted }}>{f.ok ? "✓" : "—"}</span>{f.text}
          </li>
        ))}
      </ul>
      <button
        onClick={() => onChoose(planKey)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", marginTop: 22, padding: "16px 30px",
          borderRadius: 2, border: plan.highlight ? "none" : "1px solid rgba(10,37,64,0.3)",
          background: plan.highlight ? C.gold : "transparent", color: plan.highlight ? "#051423" : C.navy,
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
  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "40px 32px 60px" }}>
      <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 30px" }}>
        <EyebrowLine>Choose how much you want done for you</EyebrowLine>
        <h1 style={{ fontFamily: "Georgia,serif", color: C.navy, fontSize: "2.4rem", fontWeight: 460, margin: "0 0 .5em" }}>Three ways in</h1>
        <p style={{ color: C.slate, fontSize: "1rem", maxWidth: 640, margin: "10px auto 0" }}>Every plan sees all 49 workflows. What differs is how many run, and who does the work.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
        {PLAN_ORDER.map((key) => (
          <PlanCard key={key} planKey={key} plan={PLAN_COPY[key]} price={prices[key] ?? PLAN_COPY[key].price} onChoose={onChoose} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 24, marginTop: 26, alignItems: "stretch", flexWrap: "wrap" }}>
        <div style={{ flex: "1.6 1 320px", borderLeft: `1px solid ${C.gold}`, background: "rgba(201,169,97,0.08)", padding: "22px 26px" }}>
          <div style={{ fontSize: ".72rem", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: C.gold, marginBottom: 8 }}>Not sure which?</div>
          <div style={{ fontSize: ".9rem", color: C.slate }}>
            Most households with a property or two and nothing complicated start on <strong style={{ color: C.navy, fontWeight: 600 }}>Basic</strong>. If you have entities, trusts or several properties and nobody is watching the dates, <strong style={{ color: C.navy, fontWeight: 600 }}>Core</strong> is the one. Move up or down at any time — the platform will tell you when you are on the wrong one.
          </div>
        </div>
        <div style={{ flex: "1 1 260px", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "20px 24px" }}>
          <div style={{ fontSize: ".72rem", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: C.muted }}>What Core actually costs</div>
          <div style={{ display: "flex", gap: 22, marginTop: 12, flexWrap: "wrap" }}>
            {[["6 / month", "$100"], ["10 / month", "$100"], ["15 / month", "$140"], ["25 / month", "$220"]].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: ".78rem", color: C.muted }}>{label}</div>
                <div style={{ fontFamily: "Georgia,serif", fontSize: "1.3rem", fontWeight: 460, color: C.navy }}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: ".8rem", color: C.muted, marginTop: 9 }}>You set a monthly ceiling. Reach it and workflows pause for your confirmation.</div>
        </div>
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
  const plan = PLAN_COPY[planKey];
  const price = prices[planKey] ?? plan.price;
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    if (!fullName.trim()) return "Enter your name.";
    if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
    if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (!householdName.trim()) return "Tell us what to call the household.";
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
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "52px 32px 60px", display: "flex", gap: 40, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "1.2 1 420px" }}>
        <EyebrowLine>One step before payment</EyebrowLine>
        <h1 style={{ fontFamily: "Georgia,serif", color: C.navy, fontSize: "2.4rem", fontWeight: 460, margin: "0 0 .5em" }}>Create your account</h1>
        <p style={{ fontSize: "1.05rem", color: C.slate, marginTop: 12, maxWidth: 520 }}>So a declined card never costs you the work you have already done.</p>

        <div style={{ marginTop: 26, maxWidth: 520 }}>
          <Field label="Your name" type="text" placeholder="James Harrington" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          <Field label="Email" type="email" placeholder="james@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <Field label="Password" type="password" placeholder="At least 12 characters" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <Field label="What should we call the household?" type="text" placeholder="The Harrington Family" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} autoComplete="off" />
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
                <span>{f.text}</span><span style={{ color: C.muted }}>{f.ok ? "included" : "—"}</span>
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
