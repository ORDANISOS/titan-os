// supabase/functions/purchase-workflow/index.ts
// Buying extra active workflows. A household on a metered plan (Core: 10 included) can run more
// than its included number only by buying a slot, billed as one Stripe subscription item on the
// household's own subscription: quantity = slots held, $/month each, prorated and charged
// immediately when added, then included in every renewal while held.
//
// The database is what enforces the limit (workflow_instances trigger + workflow_purchases).
// This function only ever (1) asks the database for permission to start a purchase, (2) charges
// Stripe, (3) marks the slot available. A browser cannot create a slot itself.
//
// Actions (POST, caller must be signed in):
//   { action: "buy",           family_id }                  client or admin only
//   { action: "sync",          family_id }                  client, advisor or admin; lowers the
//                                                           Stripe quantity after slots are
//                                                           released (workflow completed etc.).
//                                                           Never raises it.
//   { action: "cancel_unused", family_id, purchase_id }     client or admin; releases a paid slot
//                                                           that has not been used yet.
//
// Stripe behaviour, deliberately:
//   - increases use proration_behavior "always_invoice" and payment_behavior "error_if_incomplete",
//     so if the card is declined nothing is added and no slot is created;
//   - decreases use proration_behavior "none" (no credit, takes effect on the next renewal);
//   - an idempotency key per purchase prevents a retried request from charging twice.
//
// Secrets required: STRIPE_SECRET_KEY (SUPABASE_* are provided by the platform).
// Deploy: supabase functions deploy purchase-workflow

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const PRODUCT_NAME = "Additional active workflow";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// A placeholder key keeps the function bootable where Stripe is not configured (the demo); the handler
// below refuses to act without the real secret.
const stripe = new Stripe(STRIPE_SECRET_KEY || "sk_not_configured", { apiVersion: "2024-06-20", httpClient: Stripe.createFetchHttpClient() });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Database error codes raised by begin_workflow_purchase -> what the person is told.
const DB_ERRORS: Record<string, { status: number; message: string }> = {
  household_not_found: { status: 404, message: "Household not found." },
  plan_has_no_workflows: { status: 409, message: "This household's plan does not include workflows." },
  plan_is_unlimited: { status: 409, message: "This plan already includes unlimited workflows." },
  plan_has_no_workflow_price: { status: 409, message: "Extra workflows are not offered on this plan." },
  not_allowed_to_purchase: { status: 403, message: "Only the household owner can add paid workflows. Ask them to approve it." },
  purchase_in_progress: { status: 409, message: "A purchase is already in progress. Give it a moment and try again." },
  purchase_not_needed: { status: 409, message: "This household still has included workflows available, so nothing needs to be bought." },
  workflow_spend_cap_reached: { status: 409, message: "This household has reached its monthly limit for extra workflows. Contact your advisor to raise it." },
};

async function heldCount(familyId: string, statuses: string[]): Promise<number> {
  const { count, error } = await admin.from("workflow_purchases")
    .select("id", { count: "exact", head: true }).eq("family_id", familyId).in("status", statuses);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function getBilling(familyId: string): Promise<{ stripe_item_id: string | null; billed_qty: number }> {
  const { data } = await admin.from("workflow_slot_billing").select("stripe_item_id, billed_qty").eq("family_id", familyId).maybeSingle();
  return { stripe_item_id: data?.stripe_item_id ?? null, billed_qty: data?.billed_qty ?? 0 };
}

async function saveBilling(familyId: string, itemId: string | null, qty: number) {
  const { error } = await admin.from("workflow_slot_billing").upsert({
    family_id: familyId, stripe_item_id: itemId, billed_qty: qty, synced_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not record the billing state: ${error.message}`);
}

function isMissing(e: unknown): boolean {
  const err = e as { code?: string; statusCode?: number };
  return err?.code === "resource_missing" || err?.statusCode === 404;
}

// Stripe does not accept an inline product definition on a subscription item, so the function keeps
// one standing product for these slots: found by metadata, created the first time it is needed.
let cachedProductId: string | null = null;
async function getSlotProductId(): Promise<string> {
  if (cachedProductId) return cachedProductId;
  try {
    const found = await stripe.products.search({ query: `active:'true' AND metadata['kind']:'workflow_slots'`, limit: 1 });
    if (found.data[0]) return (cachedProductId = found.data[0].id);
  } catch (_e) {
    const list = await stripe.products.list({ active: true, limit: 100 });
    const hit = list.data.find((p) => p.metadata?.kind === "workflow_slots");
    if (hit) return (cachedProductId = hit.id);
  }
  const created = await stripe.products.create({ name: PRODUCT_NAME, metadata: { kind: "workflow_slots" } });
  return (cachedProductId = created.id);
}

// Raises the slot quantity (charging the prorated amount now) or creates the item.
async function raiseQuantity(opts: {
  familyId: string; subscriptionId: string; itemId: string | null; qty: number; unitPrice: number; purchaseId: string;
}): Promise<string> {
  const idem = { idempotencyKey: `wfslot-${opts.purchaseId}` };
  const create = async () => stripe.subscriptionItems.create({
    subscription: opts.subscriptionId,
    price_data: {
      currency: "usd", product: await getSlotProductId(),
      unit_amount: Math.round(opts.unitPrice * 100), recurring: { interval: "month" },
    },
    quantity: opts.qty,
    proration_behavior: "always_invoice",
    payment_behavior: "error_if_incomplete",
    metadata: { family_id: opts.familyId, kind: "workflow_slots" },
  }, idem);

  if (!opts.itemId) return (await create()).id;
  try {
    const item = await stripe.subscriptionItems.update(opts.itemId, {
      quantity: opts.qty, proration_behavior: "always_invoice", payment_behavior: "error_if_incomplete",
    }, idem);
    return item.id;
  } catch (e) {
    if (isMissing(e)) return (await create()).id; // item was removed in Stripe; start a fresh one
    throw e;
  }
}

// Lowers (or removes) the item. Never charges and never raises.
async function lowerQuantity(familyId: string, target: number) {
  const billing = await getBilling(familyId);
  if (!billing.stripe_item_id) return { lowered: false, qty: billing.billed_qty };
  if (target >= billing.billed_qty) return { lowered: false, qty: billing.billed_qty };
  try {
    if (target <= 0) {
      await stripe.subscriptionItems.del(billing.stripe_item_id, { proration_behavior: "none" });
      await saveBilling(familyId, null, 0);
      return { lowered: true, qty: 0 };
    }
    await stripe.subscriptionItems.update(billing.stripe_item_id, { quantity: target, proration_behavior: "none" });
    await saveBilling(familyId, billing.stripe_item_id, target);
    return { lowered: true, qty: target };
  } catch (e) {
    if (isMissing(e)) { await saveBilling(familyId, null, 0); return { lowered: true, qty: 0 }; }
    throw e;
  }
}

async function syncDown(familyId: string) {
  await admin.rpc("workflow_slots_rebalance", { p_family_id: familyId });
  const target = await heldCount(familyId, ["available", "in_use", "pending"]);
  return await lowerQuantity(familyId, target);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not configured" }, 500);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated." }, 401);
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await sb.auth.getUser(token);
    if (uErr || !user) return json({ error: "Not authenticated." }, 401);

    let body: { action?: string; family_id?: string; purchase_id?: string };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
    const action = body.action;
    const familyId = body.family_id;
    if (!familyId || !["buy", "sync", "cancel_unused"].includes(String(action))) {
      return json({ error: "family_id and a valid action are required." }, 400);
    }

    const { data: profile } = await admin.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
    const role = profile?.role ?? "";
    const allowed = action === "sync" ? ["client", "advisor", "admin"] : ["client", "admin"];
    if (!allowed.includes(role)) {
      return json({ error: "Only the household owner can add paid workflows. Ask them to approve it." }, 403);
    }

    // Runs as the caller, so row-level security decides whether they can see this household.
    const { data: family, error: fErr } = await sb.from("families")
      .select("id, name, plan, stripe_subscription_id").eq("id", familyId).maybeSingle();
    if (fErr) return json({ error: fErr.message }, 500);
    if (!family) return json({ error: "Household not found, or you do not have access to it." }, 404);

    if (action === "sync") {
      const r = await syncDown(familyId);
      return json({ success: true, ...r });
    }

    if (action === "cancel_unused") {
      if (!body.purchase_id) return json({ error: "purchase_id is required." }, 400);
      const { data: rel, error: rErr } = await admin.from("workflow_purchases")
        .update({ status: "released", released_at: new Date().toISOString(), release_reason: "user_cancelled" })
        .eq("id", body.purchase_id).eq("family_id", familyId).eq("status", "available").select("id");
      if (rErr) return json({ error: rErr.message }, 500);
      if (!rel || rel.length === 0) return json({ error: "That slot is not available to cancel (it may already be in use)." }, 409);
      const r = await syncDown(familyId);
      return json({ success: true, ...r });
    }

    // ── buy ──
    if (!family.stripe_subscription_id) {
      return json({ error: "This household has no active subscription to bill. Contact your advisor to add workflows." }, 409);
    }
    const sub = await stripe.subscriptions.retrieve(family.stripe_subscription_id);
    if (!["active", "trialing"].includes(sub.status)) {
      return json({ error: "This household's subscription is not active, so workflows cannot be added right now. Please update your payment method first." }, 409);
    }

    const { data: began, error: bErr } = await admin.rpc("begin_workflow_purchase", { p_family_id: familyId, p_user_id: user.id });
    if (bErr) {
      const code = Object.keys(DB_ERRORS).find((k) => (bErr.message || "").includes(k));
      if (code) return json({ error: DB_ERRORS[code].message, code }, DB_ERRORS[code].status);
      return json({ error: bErr.message }, 500);
    }
    const purchaseId = String(began.purchase_id);
    const unitPrice = Number(began.unit_price);
    if (began.reused) return json({ success: true, purchase_id: purchaseId, reused: true, unit_price: unitPrice });

    const target = await heldCount(familyId, ["available", "in_use", "pending"]); // includes this pending one
    const billing = await getBilling(familyId);

    let itemId: string;
    try {
      itemId = await raiseQuantity({
        familyId, subscriptionId: family.stripe_subscription_id, itemId: billing.stripe_item_id,
        qty: target, unitPrice, purchaseId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin.from("workflow_purchases").update({
        status: "failed", release_reason: "payment_failed", released_at: new Date().toISOString(), failure_note: msg.slice(0, 300),
      }).eq("id", purchaseId);
      return json({ error: "The payment did not go through, so no workflow was added. Please check your card and try again.", detail: msg }, 402);
    }

    let invoiceId: string | null = null;
    try {
      const fresh = await stripe.subscriptions.retrieve(family.stripe_subscription_id, { expand: ["latest_invoice"] });
      invoiceId = typeof fresh.latest_invoice === "string" ? fresh.latest_invoice : fresh.latest_invoice?.id ?? null;
    } catch (_e) { /* the invoice reference is informational */ }

    // The card has been charged. Recording it must not be left to chance: retry, then say so loudly.
    let lastErr = "";
    for (let i = 0; i < 3; i++) {
      const { error: uErr2 } = await admin.from("workflow_purchases")
        .update({ status: "available", stripe_subscription_item_id: itemId, stripe_invoice_id: invoiceId })
        .eq("id", purchaseId).eq("status", "pending");
      if (!uErr2) {
        try { await saveBilling(familyId, itemId, target); } catch (e) { console.error("saveBilling failed", e); }
        return json({ success: true, purchase_id: purchaseId, reused: false, unit_price: unitPrice });
      }
      lastErr = uErr2.message;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
    console.error(`CHARGED BUT NOT RECORDED: purchase ${purchaseId} family ${familyId} item ${itemId}: ${lastErr}`);
    return json({ error: "Your payment went through but we could not finish adding the workflow. Please contact support and quote this reference: " + purchaseId }, 500);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
