// supabase/functions/invite-client/index.ts
// Invite a client to a household the team set up (Families -> + New Family). Replaces handing over a password:
// the client gets an email invite and sets their own password. Optionally the household pays by card: the
// client's portal then asks them to add a card (create-checkout-session), and stripe-webhook links the
// subscription to the household and clears the request.
//
// POST { family_id, full_name, email, pays_by_card: boolean, redirect_to? }      send a new invite
// POST { action: "list", family_id }                                               the household's client logins + status
// POST { action: "resend", family_id, user_id, redirect_to? }                      never opened: a fresh invite;
//                                                                                   opened: a set-a-new-password email
// Allowed: an ORDANIS admin, or the household's own Expert. Firm-paid households are refused here (firm enroll
// covers them). An address that already has a login is refused before anything is created. Logged to audit_log.
//
// Secrets: none beyond the platform's SUPABASE_*. Deploy: supabase functions deploy invite-client (verify_jwt ON)

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
const clean = (s: unknown) => String(s ?? "").replace(/[\r\n<>]/g, " ").trim();

// The invite link lands on the app's own address: an ordanisos.com host, or the active skin's app_url host.
async function safeRedirect(raw: unknown): Promise<string> {
  let fallback = Deno.env.get("BRAND_APP_URL") || "https://portal.ordanisos.com";
  let skinHost = "";
  try {
    const { data } = await admin.from("brand_profiles").select("app_url").eq("is_active", true).maybeSingle();
    if (data?.app_url) { fallback = String(data.app_url); skinHost = new URL(fallback).hostname.toLowerCase(); }
  } catch (_e) { /* keep the default */ }
  try {
    const u = new URL(String(raw ?? ""));
    const h = u.hostname.toLowerCase();
    if (u.protocol === "https:" && (h === "ordanisos.com" || h.endsWith(".ordanisos.com") || (skinHost && h === skinHost))) return u.origin;
  } catch (_e) { /* fall through */ }
  return new URL(fallback).origin;
}

// The look of the sign-in emails Supabase sends this person (invite, reset password). The templates read these
// from the login's user_metadata: a firm household gets its firm's skin (logo, name, colours), everyone else the
// platform's active skin, so a firm client's invite carries the firm's logo.
async function brandFor(familyId: string): Promise<Record<string, string>> {
  // deno-lint-ignore no-explicit-any
  let bp: any = null;
  const { data: f } = await admin.from("families").select("enterprise_id").eq("id", familyId).maybeSingle();
  if (f?.enterprise_id) {
    const { data: e } = await admin.from("enterprises").select("brand_profile_id").eq("id", f.enterprise_id).maybeSingle();
    if (e?.brand_profile_id) {
      const { data } = await admin.from("brand_profiles").select("brand_name, logo_url, color_primary, color_accent").eq("id", e.brand_profile_id).maybeSingle();
      bp = data;
    }
  }
  if (!bp?.logo_url) {
    const { data } = await admin.from("brand_profiles").select("brand_name, logo_url, color_primary, color_accent").eq("is_active", true).maybeSingle();
    bp = data;
  }
  return {
    brand_name: String(bp?.brand_name || "ORDANIS"),
    brand_logo_url: String(bp?.logo_url || "https://portal.ordanisos.com/ordanis-logo.png"),
    brand_color: String(bp?.color_primary || "#0A2540"),
    brand_accent: String(bp?.color_accent || "#C9A961"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated." }, 401);
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await sb.auth.getUser(token);
    if (uErr || !user) return json({ error: "Not authenticated." }, 401);
    const { data: me } = await admin.from("user_profiles").select("role, email, active").eq("id", user.id).maybeSingle();
    if (!me || me.active === false || !["admin", "advisor"].includes(String(me.role))) {
      return json({ error: "Only an ORDANIS admin or the household's Expert can invite a client." }, 403);
    }

    let body: { action?: string; family_id?: string; user_id?: string; full_name?: string; email?: string; pays_by_card?: boolean; redirect_to?: string };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
    const action = clean(body.action) || "invite";
    const familyId = clean(body.family_id);
    const fullName = clean(body.full_name).slice(0, 120);
    const email = clean(body.email).toLowerCase();
    const paysByCard = body.pays_by_card === true;
    if (!familyId) return json({ error: "Choose a household." }, 400);
    if (!["invite", "list", "resend"].includes(action)) return json({ error: "Unknown action." }, 400);
    if (action === "invite" && fullName.length < 2) return json({ error: "Enter the client's name." }, 400);
    if (action === "invite" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);

    // Read through the caller's own access first: a private household they aren't named on, or a household
    // outside an Expert's book, is simply not found.
    const { data: visible } = await sb.from("families").select("id").eq("id", familyId).maybeSingle();
    if (!visible) return json({ error: "Household not found." }, 404);
    const { data: fam } = await admin.from("families")
      .select("id, name, plan, advisor_email, archived_at, paid_by, stripe_subscription_id").eq("id", familyId).maybeSingle();
    if (!fam || fam.archived_at) return json({ error: "Household not found, or it is archived." }, 404);
    if (me.role === "advisor" && String(fam.advisor_email ?? "").toLowerCase() !== String(me.email ?? "").toLowerCase()) {
      return json({ error: "Only the household's own Expert or an admin can invite its client." }, 403);
    }
    if (action === "list" || action === "resend") {
      const { data: profs } = await admin.from("user_profiles").select("id, full_name, email, active").eq("family_id", fam.id).eq("role", "client");
      const statusOf = async (id: string) => {
        const { data } = await admin.auth.admin.getUserById(id);
        const u = data?.user;
        return { invited_at: u?.invited_at ?? null, opened_at: u?.email_confirmed_at ?? null, last_sign_in_at: u?.last_sign_in_at ?? null };
      };
      if (action === "list") {
        const logins = await Promise.all((profs ?? []).map(async (p) => ({ ...p, ...(await statusOf(p.id)) })));
        return json({ success: true, logins });
      }
      const target = (profs ?? []).find((p) => p.id === clean(body.user_id));
      if (!target || target.active === false) return json({ error: "That login isn't an active client of this household." }, 404);
      const st = await statusOf(target.id);
      const redirectTo = await safeRedirect(body.redirect_to);
      const brand = await brandFor(fam.id);
      const { data: cur } = await admin.auth.admin.getUserById(target.id);
      await admin.auth.admin.updateUserById(target.id, { user_metadata: { ...(cur?.user?.user_metadata ?? {}), ...brand } });
      let sentKind = "invite";
      if (!st.opened_at) {
        const { error: e1 } = await admin.auth.admin.inviteUserByEmail(String(target.email), { redirectTo, data: { full_name: target.full_name, ...brand } });
        if (e1) sentKind = "reset"; // already registered: fall back to a set-password email
      } else sentKind = "reset";
      if (sentKind === "reset") {
        const { error: e2 } = await admin.auth.resetPasswordForEmail(String(target.email), { redirectTo });
        if (e2) return json({ error: `The email could not be sent: ${e2.message}` }, 500);
      }
      await admin.from("audit_log").insert({
        request_id: crypto.randomUUID(), user_id: user.id, user_email: me.email, user_role: me.role, source: "portal", module: "invite-client",
        command: sentKind === "invite" ? "resend invite" : "send set-password email", tool_calls: [{ family_id: fam.id, user_id: target.id }],
        result_summary: `${sentKind === "invite" ? "Invite resent" : "Set-password email sent"} for ${fam.name}`, status: "ok",
      }).then(({ error }) => { if (error) console.error("invite-client audit_log insert failed:", error.message); });
      return json({ success: true, sent: sentKind, email: target.email });
    }

    if (paysByCard && fam.paid_by === "enterprise") {
      return json({ error: "This household is paid for by its firm, so it can't also pay by card. Send the invite without card payment." }, 409);
    }

    // 1. The login. An address that already has one is refused before anything else changes.
    const redirectTo = await safeRedirect(body.redirect_to);
    const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: fullName, ...(await brandFor(fam.id)) } });
    if (invErr || !inv?.user) {
      const m = invErr?.message ?? "";
      if (/already|registered|exists/i.test(m)) return json({ error: "That email address already has a login. Use a different address." }, 409);
      return json({ error: `The invite could not be sent: ${m || "unknown error"}` }, 500);
    }
    const newUserId = inv.user.id;

    // 2. Their profile, as a client of this household. If it can't be written, the login is removed again.
    const { error: profErr } = await admin.from("user_profiles").upsert(
      { id: newUserId, email, full_name: fullName, role: "client", family_id: fam.id, active: true }, { onConflict: "id" });
    if (profErr) {
      try { await admin.auth.admin.deleteUser(newUserId); } catch (_e) { /* logged below */ }
      return json({ error: `The client's profile could not be created: ${profErr.message}` }, 500);
    }

    // 3. Card payment requested: the client's portal asks for a card until a subscription exists.
    let cardNote: string | null = null;
    if (paysByCard) {
      if (fam.stripe_subscription_id) {
        cardNote = "This household already has a subscription, so the client won't be asked for a card.";
      } else {
        const { error: billErr } = await admin.from("families").update({ billing_setup_required: true }).eq("id", fam.id);
        if (billErr) cardNote = `The invite went out, but the card request could not be saved: ${billErr.message}`;
      }
    }

    await admin.from("audit_log").insert({
      request_id: crypto.randomUUID(), user_id: user.id, user_email: me.email, user_role: me.role, source: "portal", module: "invite-client",
      command: "invite client", tool_calls: [{ family_id: fam.id, invited_user_id: newUserId, pays_by_card: paysByCard }],
      result_summary: `Invited a client to ${fam.name}${paysByCard ? " (pays by card)" : ""}`, status: "ok",
    }).then(({ error }) => { if (error) console.error("invite-client audit_log insert failed:", error.message); });

    return json({ success: true, invited: email, household: fam.name, pays_by_card: paysByCard, note: cardNote });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
