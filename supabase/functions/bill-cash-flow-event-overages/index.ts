// supabase/functions/bill-cash-flow-event-overages/index.ts
// Settles the cash_flow_event_overage_charges ledger (see the cash_flow_event_overage_billing
// migration) by adding each household's unbilled overage to their NEXT regular Stripe invoice --
// same non-immediate-charge pattern as bill-workflow-overages. stripe.invoiceItems.create()
// attaches a pending line item that Stripe folds into whatever invoice it generates next.
//
// The ledger rows this settles are written by record_cash_flow_event_overages(), a Postgres
// function that runs automatically on the 1st of every month via pg_cron (job
// 'cash-flow-event-overage-monthly') -- that part requires no human action. This function is the
// deliberate manual step after it: turning recorded-but-unbilled ledger rows into a real Stripe
// invoice item still takes an admin explicitly invoking this (directly via
// `supabase functions invoke bill-cash-flow-event-overages --body '{}'`, a signed-in admin fetch,
// or a future admin button) -- same reasoning as bill-workflow-overages: no real household charge
// should go out until the mechanism has been watched for at least one cycle.
//
// One Stripe invoice item is created per household per period (not one per event), aggregating
// every 'pending' charge in that period into a single, clearly-labeled line. Every underlying
// ledger row that contributed is stamped with that same stripe_invoice_item_id and
// status='invoiced', so re-running this for the same period is a no-op (it only ever selects
// status='pending' rows).
//
// Auth: caller must be a signed-in admin (checked server-side, never trusted from the client --
// same pattern as archive-family / purge-family / bill-workflow-overages).
// Secrets required: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Deploy: supabase functions deploy bill-cash-flow-event-overages

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

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

function monthLabel(period: string): string {
  const d = new Date(period + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated." }, 401);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await anon.auth.getUser(token);
    if (uErr || !user) return json({ error: "Not authenticated." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: callerProfile } = await admin.from("user_profiles").select("role,email").eq("id", user.id).single();
    if (!callerProfile || callerProfile.role !== "admin") return json({ error: "Admins only." }, 403);

    const body = await req.json().catch(() => ({}));
    // Defaults to the current calendar month. Pass an explicit period (first-of-month date) to
    // settle a prior month instead.
    const period: string = body?.period || new Date().toISOString().slice(0, 8) + "01";
    const onlyFamilyId: string | null = body?.family_id || null;

    let q = admin.from("cash_flow_event_overage_charges")
      .select("id, family_id, unit_price")
      .eq("status", "pending")
      .eq("period", period);
    if (onlyFamilyId) q = q.eq("family_id", onlyFamilyId);
    const { data: charges, error: chErr } = await q;
    if (chErr) return json({ error: chErr.message }, 500);
    if (!charges || charges.length === 0) {
      return json({ ok: true, period, billed: [], message: "No pending cash flow event overage charges for this period." });
    }

    const byFamily = new Map<string, { ids: string[]; total: number }>();
    for (const c of charges) {
      const entry = byFamily.get(c.family_id) ?? { ids: [], total: 0 };
      entry.ids.push(c.id);
      entry.total += Number(c.unit_price);
      byFamily.set(c.family_id, entry);
    }

    const results: Array<Record<string, unknown>> = [];
    for (const [familyId, entry] of byFamily) {
      const { data: family } = await admin.from("families")
        .select("id, name, stripe_customer_id").eq("id", familyId).maybeSingle();
      if (!family?.stripe_customer_id) {
        results.push({ family_id: familyId, family_name: family?.name ?? null, skipped: true, reason: "No stripe_customer_id on file for this household." });
        continue;
      }
      try {
        const item = await stripe.invoiceItems.create({
          customer: family.stripe_customer_id,
          amount: Math.round(entry.total * 100),
          currency: "usd",
          description: `${entry.ids.length} cash flow event${entry.ids.length === 1 ? "" : "s"} beyond your plan's included amount -- ${monthLabel(period)}`,
        });
        await admin.from("cash_flow_event_overage_charges")
          .update({ status: "invoiced", invoiced_at: new Date().toISOString(), stripe_invoice_item_id: item.id })
          .in("id", entry.ids);
        results.push({ family_id: familyId, family_name: family.name, invoiced: true, amount: entry.total, count: entry.ids.length, stripe_invoice_item_id: item.id });
      } catch (e) {
        results.push({ family_id: familyId, family_name: family.name, skipped: true, reason: `Stripe error: ${e instanceof Error ? e.message : String(e)}` });
      }
    }

    return json({ ok: true, period, billed: results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
