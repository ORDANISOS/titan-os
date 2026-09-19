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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not configured" }, 500);

  let body: {
    email?: string; password?: string; full_name?: string; household_name?: string;
    plan?: string; success_url?: string; cancel_url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { email, password, full_name, household_name, plan, success_url, cancel_url } = body;
  if (!email || !password || !full_name || !household_name || !plan || !success_url || !cancel_url) {
    return json({
      error: "email, password, full_name, household_name, plan, success_url and cancel_url are required",
    }, 400);
  }
  // Matches the "At least 12 characters" copy shown on the Account page -- enforced here too since
  // a client-side check alone is just a suggestion to anyone calling this endpoint directly.
  if (password.length < 12) {
    return json({ error: "Password must be at least 12 characters." }, 400);
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
  let authUserId: string;
  let resumed = false;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (created?.user && !createErr) {
    authUserId = created.user.id;
  } else {
    const alreadyExists = /already registered|already exists/i.test(createErr?.message ?? "");
    if (!alreadyExists) {
      return json({ error: createErr?.message ?? "Could not create account" }, 500);
    }

    // Resume path -- see header comment. Prove ownership of the existing auth user with a real
    // sign-in attempt before doing anything else. A wrong password here means either someone else
    // guessed a registered email, or the account owner mistyped -- either way, do not proceed.
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !signInData?.user) {
      return json({
        error: "An account with this email already exists and that password doesn't match it. Sign in instead, or reset your password.",
      }, 409);
    }
    const existingUserId = signInData.user.id;

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

    authUserId = existingUserId;
    resumed = true;
  }

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
      // Managed Payments is on by default for this Stripe account and requires a tax code on
      // every Product used in a session -- these sessions build the line item inline via
      // price_data rather than a pre-configured Price/Product with a tax code set, so Stripe
      // refuses to start Checkout without this. Disabling it here is a deliberate, temporary
      // choice (confirmed with the account owner): it unblocks self-serve checkout now, at the
      // cost of Stripe not auto-calculating/collecting sales tax on these subscriptions. Revisit
      // by setting tax codes on the Basic/Core/Premier Stripe Products and removing this instead.
      // @ts-ignore -- managed_payments is a newer Checkout Session field not yet in this SDK
      // version's TypeScript types, but it is a real, documented API parameter.
      managed_payments: { enabled: false },
      success_url,
      cancel_url,
      // No family_id yet -- these are what stripe-webhook's checkout.session.completed handler
      // reads to create the family and link this auth user to it once payment actually succeeds.
      metadata: { auth_user_id: authUserId, household_name, plan: tier.plan, full_name, email },
      subscription_data: { metadata: { auth_user_id: authUserId, household_name, plan: tier.plan } },
    });

    return json({ url: session.url, user_id: authUserId, resumed });
  } catch (e) {
    // On a fresh signup (not resumed), the auth user now exists with no Stripe session behind it --
    // that is exactly the case the RESUME path above exists to recover from on a later attempt.
    return json({ error: `Stripe error: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});
