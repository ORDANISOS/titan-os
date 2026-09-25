// supabase/functions/manage-business-partner/index.ts
// Self-serve "Business Partner" portal seats -- $5.00/month each on Basic/Core, free on Premier
// (Premier already pays for an assigned Expert, so this is treated as included rather than another
// line item -- see the `billable` gate below). A household adding someone to its Professional
// Network can also grant that person their own read-only login scoped to just this one household. This reuses the EXISTING partner mechanism end to end
// (user_profiles.role='partner', the family_partners junction, PartnerDashboard's view-only
// rendering, partner_kind='professional' -- which already exists for exactly this "CPA/attorney,
// visibility only" case) rather than building a parallel access system. What was missing was a way
// for a HOUSEHOLD (not just an admin from Admin > Users) to create one of these links, plus billing
// for it -- that's all this function adds.
//
// Same auth pattern as change-subscription-plan / toggle-contacts-import: runs as the caller via
// their own Authorization header for the access check, then does the actual privileged work
// (creating an auth user, sending an invite email, and the Stripe seat count) with the service-role
// admin client. This is deliberately the ONLY path that can write a source='household' row --
// there is no client-role write policy on family_partners at all (see the migration).
//
// SECURITY DECISION (per explicit product direction): we do NOT auto-generate a password and email
// it. We generate a Supabase invite link server-side (admin.generateLink, which does NOT itself
// send anything) and email that link ourselves via Resend, using the same sender-identity
// resolution as send-advisor-email so a white-labeled tenant's invite mail is branded correctly.
// The invitee sets their own password when they open it -- no password ever exists in an email or
// in our logs. The app's PASSWORD_RECOVERY auth-state handler (added alongside this) is what
// prompts them to set it once they land back in the app.
//
// Actions:
//   POST { family_id, action: "invite", email, full_name?, redirect_to }
//   POST { family_id, action: "remove", partner_user_id }
//
// Secrets required: STRIPE_SECRET_KEY, RESEND_API_KEY.
// Deploy: supabase functions deploy manage-business-partner

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADVISOR_EMAIL_FROM_ENV = Deno.env.get("ADVISOR_EMAIL_FROM") || "";
const BRAND_NAME_ENV = Deno.env.get("BRAND_NAME") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const SEAT_MONTHLY_PRICE = 5.00;
const SEAT_PRODUCT_NAME = "Business Partner Portal Seat";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const clean = (s: unknown) => String(s || "").replace(/[\r\n<>]/g, " ").trim();
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

// Service role -- for creating/looking up the auth user, all family_partners/user_profiles writes,
// and the Stripe seat count. The read that decides whether this caller may act on this family at
// all still goes through the RLS-scoped client below, same as every other billing function here.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Same resolution order as send-advisor-email, so an invite from a white-labeled tenant is
// attributed to that tenant, not to the underlying product.
// deno-lint-ignore no-explicit-any
async function resolveSender(): Promise<{ from: string; label: string }> {
  let brandName = "", brandDomain = "";
  try {
    const { data } = await admin.from("brand_profiles").select("brand_name, email_domain").eq("is_active", true).maybeSingle();
    brandName = clean(data?.brand_name);
    brandDomain = String(data?.email_domain || "").trim().toLowerCase();
  } catch (_e) { /* table may not exist on an older project */ }
  let fixed = "", sendingDomain = "", orgLabel = "";
  try {
    const { data } = await admin.from("outbound_email_settings").select("fixed_from_email, sending_domain, from_org_label").eq("id", true).maybeSingle();
    const m = String(data?.fixed_from_email || "").match(/<([^>]+)>/);
    fixed = (m ? m[1] : String(data?.fixed_from_email || "")).trim().toLowerCase();
    if (fixed && !EMAIL_RE.test(fixed)) fixed = "";
    sendingDomain = String(data?.sending_domain || "").trim().toLowerCase();
    orgLabel = clean(data?.from_org_label);
  } catch (_e) { /* ditto */ }
  const label = orgLabel || brandName || clean(BRAND_NAME_ENV) || "";
  if (fixed) return { from: fixed, label };
  if (sendingDomain) return { from: `alerts@${sendingDomain}`, label };
  const envAddr = clean(ADVISOR_EMAIL_FROM_ENV).toLowerCase();
  if (envAddr && EMAIL_RE.test(envAddr)) return { from: envAddr, label };
  if (brandDomain) return { from: `alerts@${brandDomain}`, label };
  return { from: "", label };
}

async function sendMail(to: string, subject: string, html: string, text: string) {
  const sender = await resolveSender();
  if (!sender.from) throw new Error("This firm's outbound email sender hasn't been configured yet, so nothing was sent. An administrator needs to set the sending domain under outbound email settings.");
  const fromHeader = sender.label ? `${sender.label} <${sender.from}>` : sender.from;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromHeader, to: [to], subject, html, text }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Email service error: ${detail.slice(0, 300)}`);
  }
}

async function countHouseholdSeats(familyId: string) {
  const { count } = await admin.from("family_partners").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("source", "household");
  return count ?? 0;
}

// Recompute the $5/mo-per-seat Stripe line item for a family after a seat is added or removed.
// Increases are charged immediately (always_invoice, same as every other add in this codebase);
// a decrease or the last seat being removed carries no proration credit (proration_behavior:
// "none") -- a deliberate, conservative default matching how toggle-contacts-import's disable
// path behaves, not a policy this function is trying to newly decide.
async function syncSeatBilling(familyId: string, stripeSubscriptionId: string | null, existingItemId: string | null) {
  const { count } = await admin.from("family_partners").select("id", { count: "exact", head: true }).eq("family_id", familyId).eq("source", "household");
  const seatCount = count ?? 0;

  if (seatCount === 0) {
    if (existingItemId) {
      try { await stripe.subscriptionItems.del(existingItemId, { proration_behavior: "none" }); } catch (e) {
        console.error(`subscriptionItems.del failed for ${existingItemId}:`, e instanceof Error ? e.message : e);
      }
      await admin.from("families").update({ business_partner_seats_stripe_item_id: null }).eq("id", familyId);
    }
    return 0;
  }

  if (!stripeSubscriptionId) throw new Error("This household has no active Stripe subscription to bill this seat to.");

  if (!existingItemId) {
    const item = await stripe.subscriptionItems.create({
      subscription: stripeSubscriptionId,
      price_data: { currency: "usd", product_data: { name: SEAT_PRODUCT_NAME }, unit_amount: Math.round(SEAT_MONTHLY_PRICE * 100), recurring: { interval: "month" } },
      quantity: seatCount,
      proration_behavior: "always_invoice",
    });
    await admin.from("families").update({ business_partner_seats_stripe_item_id: item.id }).eq("id", familyId);
  } else {
    await stripe.subscriptionItems.update(existingItemId, { quantity: seatCount, proration_behavior: "always_invoice" });
  }
  return seatCount;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not configured" }, 500);
  if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY is not configured" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  let body: { family_id?: string; action?: string; email?: string; full_name?: string; redirect_to?: string; partner_user_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const { family_id, action } = body;
  if (!family_id || (action !== "invite" && action !== "remove")) {
    return json({ error: "family_id and action ('invite'|'remove') are required" }, 400);
  }

  // Runs as the caller -- RLS decides whether this user may see this family (client role sees
  // only its own; advisor/admin per their existing access).
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: family, error: familyErr } = await sb
    .from("families")
    .select("id, name, plan, stripe_subscription_id, business_partner_seats_stripe_item_id")
    .eq("id", family_id)
    .maybeSingle();
  if (familyErr) return json({ error: familyErr.message }, 500);
  if (!family) return json({ error: "Family not found, or you do not have access to it" }, 404);

  // Server-side plan gate -- defense in depth behind the UI's own gating. Every plan may use
  // Business Partner portal seats: self-serve plans (Basic, Core) pay $5/month per seat; Premier
  // gets it free (per product decision -- Premier already pays for an assigned Expert, so this is
  // treated as included rather than another line item). `billable` is what decides whether
  // syncSeatBilling below ever touches Stripe at all.
  const { data: tier } = await sb.from("plan_features").select("self_serve").eq("plan", family.plan).maybeSingle();
  const planAllowed = !!tier?.self_serve || family.plan === "premier";
  const billable = !!tier?.self_serve; // Premier: seats are created/removed, Stripe is never called.
  if (!planAllowed) {
    return json({ error: "The Business Partner portal feature is not available on this plan." }, 409);
  }

  try {
    if (action === "invite") {
      const email = clean(body.email).toLowerCase();
      const fullName = clean(body.full_name) || email;
      const redirectTo = clean(body.redirect_to) || undefined;
      if (!EMAIL_RE.test(email)) return json({ error: "A valid email is required." }, 400);

      const { data: existingProfile } = await admin.from("user_profiles").select("id, email").ilike("email", email).maybeSingle();

      let userId: string;
      let isNewUser = false;
      let inviteLink: string | null = null;

      if (existingProfile) {
        userId = existingProfile.id;
      } else {
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type: "invite",
          email,
          options: redirectTo ? { redirectTo } : undefined,
        });
        if (linkErr || !linkData?.user) return json({ error: linkErr?.message || "Could not create the invite." }, 500);
        userId = linkData.user.id;
        inviteLink = linkData.properties?.action_link || null;
        isNewUser = true;

        const { error: profErr } = await admin.from("user_profiles").upsert({
          id: userId, email, full_name: fullName, role: "partner", partner_kind: "professional", active: true, can_run_scheduled_prompts: false,
        });
        if (profErr) return json({ error: profErr.message }, 500);
      }

      // Already linked to this family? Nothing new to bill or send.
      const { data: existingLink } = await admin.from("family_partners").select("id").eq("family_id", family_id).eq("user_id", userId).maybeSingle();
      if (existingLink) return json({ success: true, message: "This person already has portal access to this household.", already_linked: true });

      const { error: linkInsErr } = await admin.from("family_partners").insert({
        family_id, user_id: userId, source: "household", email, full_name: fullName,
      });
      if (linkInsErr) return json({ error: linkInsErr.message }, 500);

      const seatCount = billable
        ? await syncSeatBilling(family_id, family.stripe_subscription_id, family.business_partner_seats_stripe_item_id)
        : await countHouseholdSeats(family_id);

      const householdName = esc(family.name || "your household");
      if (isNewUser && inviteLink) {
        await sendMail(
          email,
          `You've been invited to ${family.name || "a household"}'s portal`,
          `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6">` +
          `<p>Hi ${esc(fullName)},</p>` +
          `<p>${householdName} has given you read-only access to their portal -- properties, cash flow, documents, and more, all in one place.</p>` +
          `<p><a href="${inviteLink}" style="display:inline-block;background:#0f2c4c;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Set up your account</a></p>` +
          `<p style="font-size:12px;color:#888">This link is single-use and will ask you to choose your own password. If you weren't expecting this, you can ignore this email.</p>` +
          `</div>`,
          `${householdName} has given you read-only access to their portal. Set up your account: ${inviteLink}`,
        );
      } else {
        await sendMail(
          email,
          `You've been given access to ${family.name || "a household"}'s portal`,
          `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6"><p>Hi ${esc(fullName)},</p><p>${householdName} has given your existing account read-only access to their portal. Sign in as usual to see it.</p></div>`,
          `${householdName} has given your existing account read-only access to their portal. Sign in as usual to see it.`,
        );
      }

      return json({ success: true, seat_count: seatCount, partner: { user_id: userId, email, full_name: fullName }, new_user: isNewUser });
    }

    // action === "remove"
    const partnerUserId = clean(body.partner_user_id);
    if (!partnerUserId) return json({ error: "partner_user_id is required" }, 400);

    const { data: link } = await admin.from("family_partners").select("id, user_id").eq("family_id", family_id).eq("user_id", partnerUserId).eq("source", "household").maybeSingle();
    if (!link) return json({ error: "No self-serve Business Partner seat found for that person on this household." }, 404);

    const { error: delErr } = await admin.from("family_partners").delete().eq("id", link.id);
    if (delErr) return json({ error: delErr.message }, 500);

    const seatCount = billable
      ? await syncSeatBilling(family_id, family.stripe_subscription_id, family.business_partner_seats_stripe_item_id)
      : await countHouseholdSeats(family_id);

    // If this was their only remaining link anywhere (this household or any other), deactivate
    // the login outright -- removing access should actually remove access, not just this row.
    // Leave it alone if they still hold a legitimate link elsewhere (e.g. an admin-added one, or
    // another household's self-serve seat) so this doesn't clip an unrelated relationship.
    const { count: remaining } = await admin.from("family_partners").select("id", { count: "exact", head: true }).eq("user_id", partnerUserId);
    if (!remaining) {
      await admin.from("user_profiles").update({ active: false }).eq("id", partnerUserId).eq("role", "partner");
    }

    return json({ success: true, seat_count: seatCount });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
