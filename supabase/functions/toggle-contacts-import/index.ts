// supabase/functions/toggle-contacts-import/index.ts
// Self-serve toggle for the $5/month "Contacts Import" add-on -- lets a Basic/Core household turn
// on (or off) the onboarding wizard's phone Contact Picker "tap a name to autopopulate" shortcut
// for Household Members / Professional Network. Manual entry via the QuickForm stays free and
// always available; this only gates the import shortcut.
//
// Same auth pattern as change-subscription-plan: runs as the caller via their own Authorization
// header, so RLS decides whether they may even see this family (families_scoped_select already
// allows a client role to read their own family, an advisor their book, or an admin anyone).
// families.contacts_import_enabled / contacts_import_stripe_item_id are then written with the
// service-role admin client, because family_scoped_write does not grant client-role UPDATE on
// families at all today -- this function is deliberately the ONLY path that can set them. This is
// also, per product decision, the first self-serve-callable BILLING function in this codebase --
// every other billing edge function here (bill-workflow-overages, etc.) is admin-only.
//
// Unlike change-subscription-plan (which replaces the household's one existing subscription
// item), this ADDS a second line item to the same Stripe subscription -- every household's
// subscription today has exactly one item (the plan itself), so this is a new pattern, not a
// variation of an existing one.
//
// Secrets required: STRIPE_SECRET_KEY.
// Deploy: supabase functions deploy toggle-contacts-import

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ADDON_MONTHLY_PRICE = 5.00;
const ADDON_NAME = "Contacts Import Add-on";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

// Service role, used ONLY for the write to families' two add-on columns -- see header comment.
// The read that decides whether this caller may act on this family at all still goes through the
// RLS-scoped client below, same as change-subscription-plan.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not configured" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  let body: { family_id?: string; enable?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { family_id, enable } = body;
  if (!family_id || typeof enable !== "boolean") {
    return json({ error: "family_id and enable (boolean) are required" }, 400);
  }

  // Runs as the caller -- RLS decides whether this user may see this family.
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: family, error: familyErr } = await sb
    .from("families")
    .select("id, stripe_subscription_id, contacts_import_enabled, contacts_import_stripe_item_id")
    .eq("id", family_id)
    .maybeSingle();

  if (familyErr) return json({ error: familyErr.message }, 500);
  if (!family) return json({ error: "Family not found, or you do not have access to it" }, 404);

  if (enable === family.contacts_import_enabled) {
    return json({ success: true, enabled: family.contacts_import_enabled, message: enable ? "Already enabled." : "Already off." });
  }

  if (!family.stripe_subscription_id) {
    return json({ error: "This household has no active Stripe subscription to add this to." }, 409);
  }

  try {
    if (enable) {
      const item = await stripe.subscriptionItems.create({
        subscription: family.stripe_subscription_id,
        price_data: {
          currency: "usd",
          product_data: { name: ADDON_NAME },
          unit_amount: Math.round(ADDON_MONTHLY_PRICE * 100),
          recurring: { interval: "month" },
        },
        // Charge the partial month right away rather than letting it ride free until renewal --
        // consistent with how an upgrade is billed in change-subscription-plan.
        proration_behavior: "always_invoice",
      });

      const { error: updErr } = await admin.from("families")
        .update({ contacts_import_enabled: true, contacts_import_stripe_item_id: item.id })
        .eq("id", family_id);
      if (updErr) return json({ error: updErr.message }, 500);

      return json({ success: true, enabled: true });
    }

    // Disabling: remove the Stripe item if we still have its id. If it's already gone on
    // Stripe's side (e.g. the subscription itself was replaced), don't let that block clearing
    // our own bookkeeping -- a stale id pointing at nothing helps no one.
    if (family.contacts_import_stripe_item_id) {
      try {
        await stripe.subscriptionItems.del(family.contacts_import_stripe_item_id, {
          proration_behavior: "none",
        });
      } catch (e) {
        console.error(`subscriptionItems.del failed for ${family.contacts_import_stripe_item_id}:`, e instanceof Error ? e.message : e);
      }
    }

    const { error: updErr } = await admin.from("families")
      .update({ contacts_import_enabled: false, contacts_import_stripe_item_id: null })
      .eq("id", family_id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ success: true, enabled: false });
  } catch (e) {
    return json({ error: `Stripe error: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});
