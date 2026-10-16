// supabase/functions/public-signup/index.ts
// Public endpoint. This is the front door of the self-serve sign-up flow (the "Sign-up Flow"
// design: Landing -> Plans -> Account -> payment -> FirstRun). There is no user session at this
// point -- verify_jwt is disabled for this function, same pattern as stripe-webhook and
// send-task-reminders -- so it runs entirely on the service role key.
//
// What this does, and what it deliberately does NOT do:
//   - Creates the Supabase Auth user for the person signing up, and starts a Stripe Checkout
//     Session for the plan they picked.
//   - It does NOT create the household (`families` row) itself. Per the sign-up design: "the
//     household record is created by the payment webhook -- it exists only once money has moved."
//     That keeps a declined card from leaving a paying-nothing household on the books; it leaves a
//     recoverable signup (the auth user) instead. See stripe-webhook's checkout.session.completed
//     handler for the family-creation side of this.
//   - All three tiers, including Premier, are purchasable here -- Premier is not gated behind an
//     advisor. What differs for Premier is what happens AFTER payment, not whether this endpoint
//     accepts it: stripe-webhook sends a different welcome email for a plan with an assigned
//     Expert (plan_features.has_expert), promising a callback within 24-48 hours, and separately
//     emails the internal team so a human actually goes and does that assigning. See
//     stripe-webhook's sendWelcomeEmail / notifyInternalTeamOfPremierSignup.
//
// RESUME: an email that already has an auth user no longer dead-ends at a 409. If the password
// submitted matches that auth user (proven via a real sign-in attempt, not just trusted) AND no
// household has been created for them yet (checked via user_profiles.family_id), this issues a
// fresh Checkout Session for the same account instead of creating a second one. This is a verified
// retry, not a stateful resume -- it does not recall the plan or household name from the abandoned
// attempt, because nothing durable was ever recorded for those (the original Checkout Session's
// metadata expires with it). The person re-enters them, same as a first-time signup, and only the
// email+password need to match what they used before.
// If a household already exists for that auth user, or the password doesn't match, this is a
// genuine "already signed up" case and still returns 409. Note: the 409 message form is the same
// either way (it always says "an account with this email already exists"), which is a mild,
// pre-existing account-enumeration signal -- someone submitting a guessed email learns it's
// registered even without knowing the password. Accepted tradeoff, not something this change
// makes worse.
//
// Secrets required: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// (the last is auto-provisioned by Supabase for every Edge Function, same as in
// create-checkout-session -- nothing to set by hand).
// Deploy: supabase functions deploy public-signup --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
// npm: specifier, not esm.sh -- esm.sh's Stripe bundle pulls in a Node.js "process.nextTick"
// polyfill that calls Deno.core.runMicrotasks(), which the current Supabase Edge Runtime does
// not support. That crashes the isolate (visible in function logs as "event loop error:
// Deno.core.runMicrotasks() is not supported in this environment"), which is what was silently
// breaking every Stripe call from this function. Deno's native npm compat layer avoids the
// esm.sh bundling path entirely, and is Supabase's own documented way to import the Stripe SDK.
import Stripe from "npm:stripe@17.4.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Stripe API version for Checkout Sessions with Managed Payments (needs 2025-03-31.basil or later).
const MANAGED_PAYMENTS_API_VERSION = "2025-03-31.basil";
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const clean = (s: unknown) => String(s ?? "").trim();

// A sign-up login stays blocked until payment creates its household (stripe-webhook unblocks it).
// 100 years: effectively "until unblocked", which is the only way it should ever end.
const SIGNUP_BLOCK = "876000h";
const isBlocked = (u?: { banned_until?: string | null } | null) =>
  !!u?.banned_until && new Date(u.banned_until).getTime() > Date.now();

// Firm codes (see the enterprise_check_code migration). A wrong, expired or inactive code all look the
// same to the caller, and repeated failures from one address are blocked by the database.
const BAD_FIRM_CODE = "That firm code is not valid. Check it and try again.";
const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("cf-connecting-ip") ?? null;
async function currentFirmNotice() {
  const { data } = await admin.from("signup_disclosures")
    .select("id, title, body_html, version").eq("kind", "firm_data_sharing").eq("is_draft", false)
    .lte("effective_at", new Date().toISOString()).order("version", { ascending: false }).limit(1).maybeSingle();
  return data;
}
async function checkFirmCode(code: string, context: string, ip: string | null) {
  const { data, error } = await admin.rpc("enterprise_check_code", { p_code: code, p_context: context, p_ip: ip, p_user_id: null });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return { blocked: !!row?.blocked, enterpriseId: (row?.enterprise_id as string) ?? null, name: (row?.enterprise_name as string) ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not configured" }, 500);

  let body: {
    action?: string; code?: string; firm_code?: string; firm_notice_id?: string;
    email?: string; phone?: string; password?: string; full_name?: string; household_name?: string;
    plan?: string; success_url?: string; cancel_url?: string;
    disclosures_acknowledged?: { subscription_terms_disclosure_id?: string; sms_consent_disclosure_id?: string };
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Lets the sign-up screen show which firm a code belongs to, and the notice the person must accept,
  // before any account exists.
  if (body.action === "lookup_code") {
    const notice = await currentFirmNotice();
    if (!notice) return json({ error: "Joining a firm is not open yet." }, 409);
    const chk = await checkFirmCode(String(body.code ?? ""), "signup_lookup", clientIp(req));
    if (chk.blocked) return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
    if (!chk.enterpriseId) return json({ valid: false, error: BAD_FIRM_CODE }, 400);
    let brand: unknown = null;
    try {
      const { data } = await admin.rpc("brand_for_enterprise", { p_enterprise_id: chk.enterpriseId });
      brand = data ?? null;
    } catch { brand = null; }
    return json({ valid: true, firm_name: chk.name, brand, notice: { id: notice.id, title: notice.title, body_html: notice.body_html } });
  }

  const { email, password, full_name, household_name, plan, success_url, cancel_url, disclosures_acknowledged } = body;
  if (!email || !password || !full_name || !household_name || !plan || !success_url || !cancel_url) {
    return json({
      error: "email, password, full_name, household_name, plan, success_url and cancel_url are required",
    }, 400);
  }
  // The primary phone number on the profile. Required, because sign-up also collects SMS consent. US
  // numbers only, stored as E.164 (+15551234567) -- the same shape the user_profiles.phone check accepts.
  const phoneDigits = String(body.phone ?? "").replace(/\D/g, "");
  const phone10 = phoneDigits.length === 11 && phoneDigits.startsWith("1") ? phoneDigits.slice(1) : phoneDigits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(phone10)) {
    return json({ error: "Enter a valid 10-digit US mobile number." }, 400);
  }
  const phone = `+1${phone10}`;
  // Matches the "At least 12 characters" copy shown on the Account page -- enforced here too since
  // a client-side check alone is just a suggestion to anyone calling this endpoint directly.
  if (password.length < 12) {
    return json({ error: "Password must be at least 12 characters." }, 400);
  }

  // Disclosure acknowledgment is required, not just shown -- this is what SignupFlow.jsx's two
  // checkboxes gate. Re-validated against the database's CURRENT (highest version) row of each
  // kind rather than trusting the id the client sent: a stale page held open across a text
  // update, or a direct call to this endpoint, must not be able to record an acknowledgment of
  // text nobody actually saw. See the signup_disclosures / signup_disclosure_acknowledgments
  // migration for the schema this checks against.
  const submittedTermsId = disclosures_acknowledged?.subscription_terms_disclosure_id;
  const submittedSmsId = disclosures_acknowledged?.sms_consent_disclosure_id;
  if (!submittedTermsId || !submittedSmsId) {
    return json({ error: "You must read and agree to the Subscription Terms and the SMS consent notice to continue." }, 400);
  }
  const { data: currentDisclosures, error: discErr } = await admin
    .from("signup_disclosures")
    .select("id, kind, version")
    .in("kind", ["subscription_terms", "sms_consent"])
    .order("version", { ascending: false });
  if (discErr) return json({ error: discErr.message }, 500);
  const currentTerms = (currentDisclosures ?? []).find((d) => d.kind === "subscription_terms");
  const currentSms = (currentDisclosures ?? []).find((d) => d.kind === "sms_consent");
  if (!currentTerms || !currentSms) {
    return json({ error: "Disclosures are not configured yet. Contact support before signing up." }, 500);
  }
  if (submittedTermsId !== currentTerms.id || submittedSmsId !== currentSms.id) {
    return json({
      error: "The Subscription Terms or SMS consent notice changed since this page loaded. Please refresh and try again.",
    }, 409);
  }

  // Optional firm code. Checked on the server, before any account or payment exists. The household is
  // placed in the firm by the payment webhook once it is created, carrying the notice they accepted.
  let firmEnterpriseId: string | null = null;
  let firmNoticeId: string | null = null;
  if (clean(body.firm_code)) {
    const notice = await currentFirmNotice();
    if (!notice) return json({ error: "Joining a firm is not open yet." }, 409);
    if (body.firm_notice_id !== notice.id) {
      return json({ error: "Please read and accept what the firm can see before continuing." }, 400);
    }
    const chk = await checkFirmCode(String(body.firm_code), "signup", clientIp(req));
    if (chk.blocked) return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
    if (!chk.enterpriseId) return json({ error: BAD_FIRM_CODE }, 400);
    firmEnterpriseId = chk.enterpriseId;
    firmNoticeId = notice.id;
  }

  // Service role read -- there is no session yet for RLS to key off, same reasoning as the rest of
  // this function.
  const { data: tier, error: tierErr } = await admin
    .from("plan_features")
    .select("plan, label, monthly_price, stripe_product_id, self_serve")
    .eq("plan", plan)
    .maybeSingle();

  if (tierErr) return json({ error: tierErr.message }, 500);
  if (!tier) return json({ error: `Unknown plan '${plan}'` }, 400);
  if (!tier.stripe_product_id) {
    return json({
      error: `plan_features.stripe_product_id is not set for '${tier.plan}' yet. Create the Product in Stripe and backfill that column before checkout can run for this tier.`,
    }, 409);
  }
  if (tier.monthly_price == null || Number(tier.monthly_price) <= 0) {
    return json({ error: `plan_features.monthly_price is not set for '${tier.plan}'` }, 500);
  }

  // Create the login before payment -- per the sign-up design, this is what makes a declined card
  // recoverable instead of a dead end. The household this account belongs to does not exist yet.
  //
  // PAYMENT FIRST: the login is created BLOCKED (banned) and cannot sign in until stripe-webhook
  // creates the household on checkout.session.completed and unblocks it. Before 2026-10-14 the login
  // worked immediately, so anyone could hold a signed-in account without ever paying.
  let authUserId: string;
  let resumed = false;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    ban_duration: SIGNUP_BLOCK,
    user_metadata: { full_name, phone },
  });

  if (created?.user && !createErr) {
    authUserId = created.user.id;
    // Make sure the block actually took. If it did not and cannot be applied, remove the brand-new
    // login (nothing is attached to it yet) rather than leave a working unpaid account behind.
    if (!isBlocked(created.user)) {
      const { error: banErr } = await admin.auth.admin.updateUserById(authUserId, { ban_duration: SIGNUP_BLOCK });
      if (banErr) {
        await admin.auth.admin.deleteUser(authUserId).catch(() => {});
        return json({ error: "Could not create account. Please try again." }, 500);
      }
    }
  } else {
    const alreadyExists = /already registered|already exists/i.test(createErr?.message ?? "");
    if (!alreadyExists) {
      return json({ error: createErr?.message ?? "Could not create account" }, 500);
    }

    // Resume path -- see header comment. Prove ownership of the existing auth user with a real
    // sign-in attempt before doing anything else. A wrong password here means either someone else
    // guessed a registered email, or the account owner mistyped -- either way, do not proceed.
    // An unpaid login is blocked, and a blocked login cannot sign in, so it is unblocked only for
    // the length of this one check and blocked again straight after (finally), whatever happens.
    const NO_MATCH = "An account with this email already exists and that password doesn't match it. Sign in instead, or reset your password.";
    const { data: known } = await admin.from("user_profiles")
      .select("id").ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(2);
    if (!known || known.length !== 1) return json({ error: NO_MATCH }, 409);
    const { data: existing } = await admin.auth.admin.getUserById(known[0].id);
    const wasBlocked = isBlocked(existing?.user);

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    let signInUserId: string | null = null;
    try {
      if (wasBlocked) await admin.auth.admin.updateUserById(known[0].id, { ban_duration: "none" });
      const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
      if (!signInErr && signInData?.user) signInUserId = signInData.user.id;
    } finally {
      if (wasBlocked) await admin.auth.admin.updateUserById(known[0].id, { ban_duration: SIGNUP_BLOCK });
    }
    if (!signInUserId) return json({ error: NO_MATCH }, 409);
    const existingUserId = signInUserId;

    // Only resumable if payment never actually went through for them. A family_id already set
    // means a household was already created (a prior Checkout succeeded) -- that is a genuine
    // "already signed up and paid" case, not an abandoned attempt, and should not issue a second
    // subscription.
    const { data: existingProfile } = await admin.from("user_profiles")
      .select("family_id").eq("id", existingUserId).maybeSingle();
    if (existingProfile?.family_id) {
      return json({
        error: "An account with this email already exists and is already set up. Sign in instead.",
      }, 409);
    }

    // An older unpaid login, created before sign-ups were blocked until payment, is blocked now too.
    if (!wasBlocked) {
      const { error: banErr } = await admin.auth.admin.updateUserById(existingUserId, { ban_duration: SIGNUP_BLOCK });
      if (banErr) return json({ error: "Could not resume sign-up. Please try again." }, 500);
    }

    authUserId = existingUserId;
    resumed = true;
  }

  // Record the acknowledgment now that we have a real auth_user_id, before Stripe is involved at
  // all -- consent is about the account, not the payment, and this way a Stripe failure below
  // doesn't leave a paid household with no consent record (it leaves neither, which is correct;
  // this endpoint's account-creation is already recoverable via the RESUME path above, and a
  // resumed attempt is intentionally asked to re-acknowledge and gets a fresh row here each time).
  const { error: ackErr } = await admin.from("signup_disclosure_acknowledgments").insert({
    auth_user_id: authUserId,
    email,
    subscription_terms_disclosure_id: currentTerms.id,
    sms_consent_disclosure_id: currentSms.id,
    ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? req.headers.get("cf-connecting-ip")
      ?? null,
    user_agent: req.headers.get("user-agent"),
  });
  if (ackErr) return json({ error: `Could not record disclosure acknowledgment: ${ackErr.message}` }, 500);

  try {
    // On a resume, reuse the Stripe Customer created on the earlier attempt if one exists, rather
    // than minting a new one every time someone comes back to finish paying.
    let customerId: string | null = null;
    if (resumed) {
      const existing = await stripe.customers.list({ email, limit: 1 });
      customerId = existing.data[0]?.id ?? null;
    }

    const customer = customerId
      ? await stripe.customers.update(customerId, {
        name: household_name,
        metadata: { auth_user_id: authUserId, household_name, plan: tier.plan },
      })
      : await stripe.customers.create({
        email,
        name: household_name,
        metadata: { auth_user_id: authUserId, household_name, plan: tier.plan },
      });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{
        price_data: {
          currency: "usd",
          product: tier.stripe_product_id,
          unit_amount: Math.round(Number(tier.monthly_price) * 100),
          recurring: { interval: "month" },
        },
        quantity: 1,
      }],
      // Managed Payments ON (owner's decision, 2026-10-15): Stripe handles sales tax for these
      // subscriptions. It was switched off earlier only because the test-mode products had no tax
      // code and Stripe refused to start Checkout. Managed Payments needs a tax code on EVERY product
      // used here (the Basic/Core/Premier products in plan_features.stripe_product_id); if Checkout
      // fails with a tax-code error, set the product's tax code in Stripe -- do not switch this off.
      // Set explicitly, not left to the account default, so it is never quietly turned off again.
      // @ts-ignore -- managed_payments is a newer Checkout Session field not yet in this SDK
      // version's TypeScript types, but it is a real, documented API parameter.
      managed_payments: { enabled: true },
      success_url,
      cancel_url,
      // No family_id yet -- these are what stripe-webhook's checkout.session.completed handler
      // reads to create the family and link this auth user to it once payment actually succeeds.
      metadata: {
        auth_user_id: authUserId, household_name, plan: tier.plan, full_name, email, phone,
        ...(firmEnterpriseId ? { enterprise_id: firmEnterpriseId, firm_notice_id: String(firmNoticeId) } : {}),
      },
      subscription_data: { metadata: { auth_user_id: authUserId, household_name, plan: tier.plan } },
    }, {
      // Managed Payments only exists on Stripe API 2025-03-31.basil and later. Only THIS request uses
      // the newer version; the rest of the function stays on 2024-06-20, because basil changes the
      // shape of other objects (invoices, subscription periods) that this codebase reads.
      apiVersion: MANAGED_PAYMENTS_API_VERSION,
    });

    return json({ url: session.url, user_id: authUserId, resumed });
  } catch (e) {
    // On a fresh signup (not resumed), the auth user now exists with no Stripe session behind it --
    // that is exactly the case the RESUME path above exists to recover from on a later attempt.
    return json({ error: `Stripe error: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});
