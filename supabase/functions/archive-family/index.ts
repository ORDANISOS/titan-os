// supabase/functions/archive-family/index.ts
// Ordanis — step 1 of honoring a household's request to be removed from the platform.
//
// This is the immediate, non-destructive action: nothing about the household's data is deleted
// here. It only stops the relationship from continuing forward --
//   - cancels the household's Stripe subscription right away (not at period end -- a household
//     that asked to leave should not keep being billed while someone gets around to step 2)
//   - disables sign-in for every role='client' user_profiles row on this family (via
//     auth.admin.updateUserById ban_duration, the documented way to ban a Supabase Auth user
//     indefinitely -- there is no literal "forever", so this uses a duration long enough to be
//     one in practice) and flips their `active` flag off so the existing admin "Users" screen
//     shows them as deactivated too
//   - stamps families.archived_at / archived_by / subscription_state='archived'
//   - writes a family_deletion_log row (action:'archived') that survives even if the family is
//     later purged entirely
//
// Permanently erasing the household's data is a deliberate, separate second step -- see
// purge-family, which refuses to run unless a family is already archived. See that function's
// header, and the family_deletion migration, for why this is split in two rather than one button.
//
// Auth: caller must be a signed-in admin (checked server-side against user_profiles.role, never
// trusted from the client -- same pattern as admin-set-password).
// Secrets required: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Deploy: supabase functions deploy archive-family

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// npm: specifier, not esm.sh -- see stripe-webhook/index.ts for why (esm.sh's Stripe bundle
// crashes the Edge Runtime's isolate; Deno's native npm compat layer is Supabase's documented
// workaround).
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

// ~100 years -- Supabase's ban_duration accepts "none" to lift a ban but has no literal
// "permanent" value, so an implausibly long duration is the documented way to ban indefinitely.
const PERMANENT_BAN = "876000h";

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

    const body = await req.json().catch(() => null);
    const familyId = String(body?.familyId || "").trim();
    const reason = body?.reason ? String(body.reason).slice(0, 2000) : null;
    if (!familyId) return json({ error: "Missing familyId." }, 400);

    const { data: family, error: fErr } = await admin.from("families")
      .select("id,name,customer_number,plan,archived_at,stripe_subscription_id")
      .eq("id", familyId).maybeSingle();
    if (fErr) return json({ error: fErr.message }, 500);
    if (!family) return json({ error: "Family not found." }, 404);

    if (family.archived_at) {
      return json({ ok: true, alreadyArchived: true });
    }

    // Cancel billing immediately. Not fatal if Stripe errors (e.g. already canceled on Stripe's
    // side) -- the household still needs to end up archived either way, so this is reported back
    // rather than aborting the whole action.
    let stripeError: string | null = null;
    if (family.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(family.stripe_subscription_id);
      } catch (e) {
        stripeError = e instanceof Error ? e.message : String(e);
        console.error("archive-family: stripe cancel failed", familyId, stripeError);
      }
    }

    // Disable sign-in for this household's own self-serve login(s). Deliberately scoped to
    // role='client' -- user_profiles.family_id is also reused by the internal "assign family"
    // admin feature to scope a staff member's access, so an advisor/admin row sharing this
    // family_id must never be touched here.
    const { data: clientUsers } = await admin.from("user_profiles")
      .select("id").eq("family_id", familyId).eq("role", "client");
    const banFailures: string[] = [];
    for (const u of clientUsers || []) {
      const { error: banErr } = await admin.auth.admin.updateUserById(u.id, { ban_duration: PERMANENT_BAN });
      if (banErr) banFailures.push(u.id);
    }
    if ((clientUsers || []).length) {
      await admin.from("user_profiles").update({ active: false }).eq("family_id", familyId).eq("role", "client");
    }

    const performedBy = callerProfile.email || user.email || user.id;
    const { error: updErr } = await admin.from("families").update({
      archived_at: new Date().toISOString(),
      archived_by: performedBy,
      subscription_state: "archived",
    }).eq("id", familyId);
    if (updErr) return json({ error: updErr.message }, 500);

    await admin.from("family_deletion_log").insert({
      family_id: family.id,
      family_name: family.name,
      customer_number: family.customer_number,
      plan: family.plan,
      action: "archived",
      reason,
      performed_by: performedBy,
    });

    return json({
      ok: true,
      loginsDisabled: (clientUsers || []).length,
      banFailures: banFailures.length ? banFailures : undefined,
      stripeError: stripeError || undefined,
    });
  } catch (e) {
    console.error("archive-family error", e);
    return json({ error: "Server error." }, 500);
  }
});
