// supabase/functions/change-subscription-plan/index.ts
// Lets a household move to a different plan -- either the client themselves (self-serve, from
// their own billing screen) or an advisor/admin acting on their behalf. Same auth pattern as
// create-checkout-session: runs as the caller via their own Authorization header, so RLS decides
// who may touch which family. There is no separate permission check to keep in sync with the
// database -- there is only one.
//
// Upgrade vs downgrade is decided by comparing plan_features.sort_order (basic=10, core=20,
// premier=30 at the time of writing -- read live, never hardcoded here):
//   - UPGRADE: takes effect immediately. Stripe's subscription item is updated right now with
//     proration_behavior: "always_invoice", which both prorates AND invoices/charges the
//     difference immediately -- "seamless", per the product ask, not a charge that silently waits
//     for the next renewal. families.plan is updated in the same request; there is no need to wait
//     for a webhook round-trip since this is a direct, synchronous Stripe call.
//   - DOWNGRADE: takes effect at the END of the current billing period, with NO proration --
//     the household keeps what it already paid for. This is done with a Stripe Subscription
//     Schedule (two phases: current price until current_period_end, then the new price), not an
//     immediate item update. families.pending_plan / pending_plan_effective_at are set right away
//     so the UI can show "Downgrading to Core on <date>" before Stripe actually applies it;
//     stripe-webhook's syncFamilyFromSubscription clears them and sets the real families.plan once
//     Stripe fires customer.subscription.updated for the phase change.
//
// Workflows-in-progress warning: per product decision, this does NOT block a downgrade -- the
// frontend is expected to query workflow_instances for this family (RLS already scopes that to
// what the caller can see) and show a confirmation dialog BEFORE calling this function at all, so
// there is nothing to "pass through" here. This function still returns open_work in its response
// as a courtesy/fallback so a caller that skipped its own check still sees it.
//
// IMPORTANT pre-existing rule this interacts with: public.families has a BEFORE UPDATE OF plan
// trigger (families_refuse_downgrade -> refuse_downgrade_with_open_work()) that HARD-BLOCKS ever
// setting families.plan = 'core' while the household still has obligations, workflow_instances or
// PCM-responsible cash_flow_events on file -- Core's screens can't show that data. Because a
// downgrade only ever writes pending_plan now (not plan itself), scheduling a downgrade to Core is
// never blocked by this trigger. But if the household still has that data on file when the
// schedule actually tries to apply at renewal, stripe-webhook's plan sync WILL hit this exception
// -- see that function's own comment for how it's handled (logged, not thrown, left pending rather
// than crash-looping Stripe's retries). This trigger does NOT cover downgrades straight to Basic
// at all -- that looks like a pre-existing gap, not something introduced here; flagged separately,
// not silently changed.
//
// Secrets required: STRIPE_SECRET_KEY.
// Deploy: supabase functions deploy change-subscription-plan

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

// Service role, used ONLY for the specific writes to families that an authenticated client's own
// RLS grant may not cover (pending_plan / stripe_subscription_schedule_id are internal billing
// bookkeeping, not something a client-role UPDATE policy should need to allow directly). The read
// that decides WHETHER this caller may act on this family at all still goes through the
// RLS-scoped client below -- this does not widen who can call this function, only what the
// validated request is allowed to write.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not configured" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  let body: { family_id?: string; new_plan?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { family_id, new_plan } = body;
  if (!family_id || !new_plan) return json({ error: "family_id and new_plan are required" }, 400);

  // Runs as the caller -- RLS decides whether this user may see or write this family, same as
  // create-checkout-session.
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: family, error: familyErr } = await sb
    .from("families")
    .select("id, plan, pending_plan, stripe_customer_id, stripe_subscription_id, stripe_subscription_schedule_id")
    .eq("id", family_id)
    .maybeSingle();

  if (familyErr) return json({ error: familyErr.message }, 500);
  if (!family) return json({ error: "Family not found, or you do not have access to it" }, 404);
  if (!family.stripe_subscription_id) {
    return json({ error: "This household has no active Stripe subscription to change." }, 409);
  }

  const { data: tiers, error: tierErr } = await sb
    .from("plan_features")
    .select("plan, label, monthly_price, stripe_product_id, sort_order")
    .in("plan", [family.plan, new_plan]);

  if (tierErr) return json({ error: tierErr.message }, 500);
  const currentTier = tiers?.find((t) => t.plan === family.plan);
  const newTier = tiers?.find((t) => t.plan === new_plan);
  if (!currentTier) return json({ error: `No plan_features row for current plan '${family.plan}'` }, 500);
  if (!newTier) return json({ error: `Unknown plan '${new_plan}'` }, 400);
  if (!newTier.stripe_product_id || newTier.monthly_price == null) {
    return json({ error: `plan_features is not fully configured for '${new_plan}' yet (missing Stripe product or price).` }, 409);
  }

  // Surfaced in the response either way -- see header comment on why this function itself never
  // blocks on it.
  const [{ count: obligationsCount }, { count: workflowsCount }] = await Promise.all([
    sb.from("obligations").select("id", { count: "exact", head: true }).eq("family_id", family_id),
    sb.from("workflow_instances").select("id", { count: "exact", head: true }).eq("family_id", family_id),
  ]);
  const openWork = { obligations: obligationsCount ?? 0, workflows: workflowsCount ?? 0 };

  if (new_plan === family.plan) {
    if (family.pending_plan) {
      // Changed their mind before a scheduled downgrade took effect -- release the schedule and
      // clear it, rather than making them go through a whole new upgrade/downgrade round trip.
      try {
        if (family.stripe_subscription_schedule_id) {
          await stripe.subscriptionSchedules.release(family.stripe_subscription_schedule_id);
        }
      } catch (e) {
        // If it's already released/canceled on Stripe's side, that's fine -- proceed to clear our
        // own bookkeeping either way rather than leaving it stuck.
        console.error(`subscriptionSchedules.release failed for ${family.stripe_subscription_schedule_id}:`, e instanceof Error ? e.message : e);
      }
      const { error: clearErr } = await admin.from("families")
        .update({ pending_plan: null, pending_plan_effective_at: null, stripe_subscription_schedule_id: null })
        .eq("id", family_id);
      if (clearErr) return json({ error: clearErr.message }, 500);
      return json({ success: true, message: "Scheduled downgrade cancelled -- staying on current plan.", plan: family.plan, open_work: openWork });
    }
    return json({ error: "Already on this plan." }, 400);
  }

  const upgrading = newTier.sort_order > currentTier.sort_order;

  try {
    const sub = await stripe.subscriptions.retrieve(family.stripe_subscription_id);
    const item = sub.items.data[0];
    if (!item) return json({ error: "Stripe subscription has no items to change" }, 500);

    if (upgrading) {
      // Immediate: an upgrade is always available, seamlessly, per the product ask. Release any
      // schedule from an earlier pending downgrade first -- an upgrade supersedes it outright.
      const scheduleId = family.stripe_subscription_schedule_id || (typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id);
      if (scheduleId) {
        try { await stripe.subscriptionSchedules.release(scheduleId); } catch (e) {
          console.error(`subscriptionSchedules.release failed for ${scheduleId}:`, e instanceof Error ? e.message : e);
        }
      }

      await stripe.subscriptions.update(family.stripe_subscription_id, {
        items: [{
          id: item.id,
          price_data: {
            currency: "usd",
            product: newTier.stripe_product_id,
            unit_amount: Math.round(Number(newTier.monthly_price) * 100),
            recurring: { interval: "month" },
          },
        }],
        // always_invoice: prorate AND charge the difference right now, rather than letting it sit
        // as an unbilled line item until the next renewal -- that's what "seamless" upgrade means
        // here: pay the prorated difference and get the higher tier immediately.
        proration_behavior: "always_invoice",
        metadata: { ...sub.metadata, plan: new_plan },
      });

      const { error: updErr } = await admin.from("families")
        .update({ plan: new_plan, pending_plan: null, pending_plan_effective_at: null, stripe_subscription_schedule_id: null })
        .eq("id", family_id);
      if (updErr) return json({ error: updErr.message }, 500);

      return json({ success: true, plan: new_plan, effective: "immediately", prorated_charge: true, open_work: openWork });
    }

    // Downgrading: schedule the price change for the end of the current period, no proration --
    // the household keeps what it already paid for. Always release+recreate any existing schedule
    // on this subscription rather than diffing its phases, to keep this simple and robust.
    const existingScheduleId = family.stripe_subscription_schedule_id || (typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id);
    if (existingScheduleId) {
      try { await stripe.subscriptionSchedules.release(existingScheduleId); } catch (e) {
        console.error(`subscriptionSchedules.release failed for ${existingScheduleId}:`, e instanceof Error ? e.message : e);
      }
    }

    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: family.stripe_subscription_id,
    });

    const currentPeriodEnd = sub.current_period_end; // unix seconds
    const currentPhase = schedule.phases[0];

    const updatedSchedule = await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      phases: [
        {
          items: currentPhase.items,
          start_date: currentPhase.start_date,
          end_date: currentPeriodEnd,
        },
        {
          items: [{
            price_data: {
              currency: "usd",
              product: newTier.stripe_product_id,
              unit_amount: Math.round(Number(newTier.monthly_price) * 100),
              recurring: { interval: "month" },
            },
          }],
          start_date: currentPeriodEnd,
          proration_behavior: "none",
          metadata: { ...sub.metadata, plan: new_plan },
        },
      ],
    });

    const effectiveDate = new Date(currentPeriodEnd * 1000).toISOString().slice(0, 10);

    const { error: updErr } = await admin.from("families")
      .update({ pending_plan: new_plan, pending_plan_effective_at: effectiveDate, stripe_subscription_schedule_id: updatedSchedule.id })
      .eq("id", family_id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ success: true, plan: family.plan, pending_plan: new_plan, effective_at: effectiveDate, prorated_charge: false, open_work: openWork });
  } catch (e) {
    return json({ error: `Stripe error: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});
