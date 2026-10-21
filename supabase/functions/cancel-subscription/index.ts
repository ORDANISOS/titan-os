// supabase/functions/cancel-subscription/index.ts
// ORDANIS -- end-of-period cancellation (2026-10-21, Will's decision).
//
// A household that cancels keeps full access until the end of the month it has paid for: no partial
// refund, no new charge. This only tells Stripe to stop at the period end (cancel_at_period_end); it
// does not end anything now. When the period ends, Stripe ends the subscription and stripe-webhook
// archives the household (logins blocked, billing stopped, data kept until Will chooses to purge).
//
//   action "schedule" -- cancel at the end of the paid period
//   action "undo"     -- keep the subscription (only until that date)
//
// Who may call it: the household's own client login (role 'client' on that family, not a Business
// Partner), or an ORDANIS admin. Checked here with the service role, never trusted from the browser.
// A household billed to its firm has no subscription of its own to cancel: it is told to contact the firm.
//
// Secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (all already set).
// Deploy: supabase functions deploy cancel-subscription --project-ref <ref> --use-api

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
// npm: specifier for Stripe, as in the other billing functions (esm.sh's bundle crashes the Edge Runtime).
import Stripe from "npm:stripe@17.4.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

// Pinned like the rest of the codebase: on 2024-06-20, current_period_end is on the subscription itself.
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20", httpClient: Stripe.createFetchHttpClient() });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

    const body = await req.json().catch(() => null);
    const familyId = String(body?.family_id ?? "").trim();
    const action = String(body?.action ?? "");
    if (!familyId) return json({ error: "Missing family_id." }, 400);
    if (action !== "schedule" && action !== "undo") return json({ error: "Unknown action." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: caller } = await admin.from("user_profiles")
      .select("role, family_id, email, full_name").eq("id", user.id).maybeSingle();
    const isAdmin = caller?.role === "admin";
    const isOwnClient = caller?.role === "client" && caller?.family_id === familyId;
    if (!isAdmin && !isOwnClient) return json({ error: "You can't change this household's subscription." }, 403);

    const { data: family, error: fErr } = await admin.from("families")
      .select("id, name, archived_at, stripe_subscription_id, cancel_at").eq("id", familyId).maybeSingle();
    if (fErr) return json({ error: "Could not load the household." }, 500);
    if (!family) return json({ error: "Household not found." }, 404);
    if (family.archived_at) return json({ error: "This household has already been closed." }, 409);
    if (!family.stripe_subscription_id) {
      return json({ error: "This plan isn't billed to you directly, so there's nothing to cancel here. Please contact your firm or ORDANIS." }, 409);
    }

    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(String(family.stripe_subscription_id));
    } catch (_e) {
      return json({ error: "Couldn't reach billing just now. Please try again in a moment." }, 502);
    }
    if (["canceled", "incomplete_expired"].includes(sub.status)) {
      return json({ error: "This subscription has already ended." }, 409);
    }

    const schedule = action === "schedule";
    try {
      sub = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: schedule });
    } catch (_e) {
      return json({ error: "Couldn't update billing just now. Please try again in a moment." }, 502);
    }

    const endsAt = schedule && sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
    const who = isAdmin ? `${caller?.full_name || caller?.email || "ORDANIS admin"} (ORDANIS)` : (caller?.full_name || caller?.email || "the household");
    const { error: upErr } = await admin.from("families").update(schedule
      ? { cancel_at: endsAt, cancel_requested_at: new Date().toISOString(), cancel_requested_by: who.slice(0, 200) }
      : { cancel_at: null, cancel_requested_at: null, cancel_requested_by: null }).eq("id", familyId);
    // Stripe has the decision either way; the webhook rewrites cancel_at from Stripe on the next event.
    if (upErr) console.error("cancel-subscription: family update failed", familyId);

    return json({ ok: true, cancel_at: endsAt });
  } catch (e) {
    console.error("cancel-subscription error", e instanceof Error ? e.name : "error");
    return json({ error: "Server error." }, 500);
  }
});
