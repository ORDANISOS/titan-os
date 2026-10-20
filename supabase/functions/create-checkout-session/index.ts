// supabase/functions/create-checkout-session/index.ts
// Creates (or reuses) a Stripe Checkout Session so a household can subscribe to -- or change --
// its plan.
//
// Runs as the calling user, not as service role: the Supabase client below is built from the
// caller's own Authorization header, so the same RLS policies that gate `families` reads/writes
// everywhere else in the app gate this too. An advisor can only start checkout for a family in
// their own book; an admin can start it for any family. There is no separate authorization check
// to keep in sync with the database -- there is only one.
//
// Pricing is NOT looked up from a stored Stripe Price id. It is built at request time from
// plan_features.monthly_price via Checkout's inline `price_data`, referencing the tier's Stripe
// Product id (plan_features.stripe_product_id). That keeps plan_features as the one place pricing
// lives -- change a price there and the next checkout charges the new amount, with nothing to
// update on the Stripe side.
//
// Secrets required: STRIPE_SECRET_KEY.
// Deploy: supabase functions deploy create-checkout-session

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not configured" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  let body: { family_id?: string; success_url?: string; cancel_url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { family_id, success_url, cancel_url } = body;
  if (!family_id || !success_url || !cancel_url) {
    return json({ error: "family_id, success_url and cancel_url are required" }, 400);
  }

  // Runs as the caller -- RLS decides whether this user may see or write this family.
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: family, error: familyErr } = await sb
    .from("families")
    .select("id, name, plan, stripe_customer_id, stripe_subscription_id")
    .eq("id", family_id)
    .maybeSingle();

  if (familyErr) return json({ error: familyErr.message }, 500);
  if (!family) return json({ error: "Family not found, or you do not have access to it" }, 404);

  const { data: tier, error: tierErr } = await sb
    .from("plan_features")
    .select("plan, label, monthly_price, stripe_product_id")
    .eq("plan", family.plan)
    .maybeSingle();

  if (tierErr) return json({ error: tierErr.message }, 500);
  if (!tier) return json({ error: `No plan_features row for plan '${family.plan}'` }, 500);
  if (!tier.stripe_product_id) {
    return json({
      error: `plan_features.stripe_product_id is not set for '${tier.plan}' yet. Create the Product in Stripe and backfill that column before checkout can run for this tier.`,
    }, 409);
  }
  if (tier.monthly_price == null || Number(tier.monthly_price) <= 0) {
    return json({ error: `plan_features.monthly_price is not set for '${tier.plan}'` }, 500);
  }

  try {
    let customerId = family.stripe_customer_id as string | null;

    // One live subscription per household. Opening a second Checkout for a household that already pays
    // created a second subscription: the webhook then pointed the household at the new one and the old
    // one kept charging with nothing tracking it. Checked against Stripe itself (the subscription on
    // record AND anything else live on this customer), not just our own column. Plan changes go through
    // change-subscription-plan instead.
    const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);
    const live: string[] = [];
    if (family.stripe_subscription_id) {
      try {
        const sub = await stripe.subscriptions.retrieve(String(family.stripe_subscription_id));
        if (LIVE.has(sub.status)) live.push(sub.id);
      } catch (_e) { /* gone in Stripe: not live */ }
    }
    if (customerId) {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
      for (const sub of subs.data) if (LIVE.has(sub.status) && !live.includes(sub.id)) live.push(sub.id);
    }
    if (live.length) {
      return json({
        error: "This household already has a subscription. To change its plan, use Change plan instead of starting a new checkout.",
        subscription_ids: live,
      }, 409);
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: family.name,
        metadata: { family_id: family.id },
      });
      customerId = customer.id;

      // Write the new customer id back through the same RLS-scoped client that read the row --
      // if this caller could not write to this family, this update fails the same as any other.
      const { error: writeErr } = await sb
        .from("families")
        .update({ stripe_customer_id: customerId })
        .eq("id", family.id);
      if (writeErr) {
        return json({ error: `Stripe customer created but failed to save: ${writeErr.message}` }, 500);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
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
      // Promotion codes (owner's decision, 2026-10-20): a "3 months free" code and a full complimentary
      // code, both created in the Stripe dashboard. Checkout shows an "Add promotion code" box. The card is
      // still collected (Stripe's default), so a 3-months-free household is billed normally from month 4
      // without having to come back; a fully comped one has a card on file but is never charged.
      allow_promotion_codes: true,
      success_url,
      cancel_url,
      metadata: { family_id: family.id, plan: tier.plan },
      subscription_data: { metadata: { family_id: family.id, plan: tier.plan } },
    }, {
      // Managed Payments only exists on Stripe API 2025-03-31.basil and later. Only THIS request uses
      // the newer version; the rest of the function stays on 2024-06-20, because basil changes the
      // shape of other objects (invoices, subscription periods) that this codebase reads.
      apiVersion: MANAGED_PAYMENTS_API_VERSION,
    });

    return json({ url: session.url });
  } catch (e) {
    return json({ error: `Stripe error: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});
