// supabase/functions/firm-join/index.ts
// Joining a firm after signup, and moving a household in or out. A household enters a firm only through
// (a) a signed-in client entering the firm's code and accepting the data-sharing notice, or (b) an ORDANIS
// admin recording that the client agreed. The database functions it calls (enterprise_join_family,
// enterprise_remove_family) enforce the same rules and write the membership log; this function adds who
// may call them, the rate-limited code check, and the email to the firm's enterprise admins.
//
// Actions (POST):
//   { action: "lookup", code }                                        signed-in client: is the code valid, and what will the firm see
//   { action: "join", code, notice_id }                               signed-in client: join with the code
//   { action: "admin_move", family_id, enterprise_id, client_agreed: true, note }   ORDANIS admin only
//   { action: "admin_remove", family_id, note? }                      ORDANIS admin only
//   { action: "notify", event_id }                                    service role only (called by stripe-webhook after a code signup)
//
// A wrong, expired or inactive code all produce the same answer. The email to the firm carries the
// household name, its plan and how it joined. No financial details.
//
// Secrets: RESEND_API_KEY (optional; without it the join still happens and the email is skipped, logged),
// ADVISOR_EMAIL_FROM / BRAND_NAME (optional sender fallbacks). Deploy: supabase functions deploy firm-join

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADVISOR_EMAIL_FROM = Deno.env.get("ADVISOR_EMAIL_FROM") || "";
const BRAND_NAME_ENV = Deno.env.get("BRAND_NAME") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const BAD_CODE = "That firm code is not valid. Check it and try again.";
const DB_ERRORS: Record<string, { status: number; message: string }> = {
  consent_required: { status: 400, message: "The client's agreement has to be recorded first." },
  notice_required: { status: 400, message: "The notice must be shown and accepted first." },
  notice_not_published: { status: 409, message: "Joining a firm is not open yet." },
  household_not_found: { status: 404, message: "Household not found." },
  household_archived: { status: 409, message: "This household is archived." },
  firm_not_available: { status: 404, message: "That firm is not available." },
  already_in_a_firm: { status: 409, message: "This household already belongs to a firm. Ask ORDANIS to move it." },
  household_is_paid_by_firm: { status: 409, message: "This household's plan is paid by its firm, so it cannot be moved or removed until it pays for itself again." },
  not_in_a_firm: { status: 409, message: "This household is not in a firm." },
};
function dbError(message: string): Response {
  const code = Object.keys(DB_ERRORS).find((k) => (message || "").includes(k));
  if (code) return json({ error: DB_ERRORS[code].message, code }, DB_ERRORS[code].status);
  return json({ error: message }, 500);
}

const clean = (s: unknown) => String(s ?? "").replace(/[\r\n<>]/g, " ").trim();
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("cf-connecting-ip") ?? null;

async function currentNotice() {
  const { data } = await admin.from("signup_disclosures")
    .select("id, title, body_html, version").eq("kind", "firm_data_sharing").eq("is_draft", false)
    .lte("effective_at", new Date().toISOString()).order("version", { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function checkCode(code: string, context: string, ip: string | null, userId: string | null) {
  const { data, error } = await admin.rpc("enterprise_check_code", { p_code: code, p_context: context, p_ip: ip, p_user_id: userId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return { blocked: !!row?.blocked, enterpriseId: (row?.enterprise_id as string) ?? null, name: (row?.enterprise_name as string) ?? null };
}

// Same sender resolution order as stripe-webhook / send-advisor-email.
async function resolveSender(): Promise<{ from: string; label: string; appUrl: string }> {
  let brandName = ""; let brandDomain = ""; let brandAppUrl = "";
  try {
    const { data } = await admin.from("brand_profiles").select("brand_name, email_domain, app_url").eq("is_active", true).maybeSingle();
    brandName = clean(data?.brand_name); brandDomain = String(data?.email_domain || "").trim().toLowerCase(); brandAppUrl = String(data?.app_url || "").trim();
  } catch (_e) { /* ignore */ }
  let fixed = ""; let sendingDomain = ""; let orgLabel = "";
  try {
    const { data } = await admin.from("outbound_email_settings").select("fixed_from_email, sending_domain, from_org_label").eq("id", true).maybeSingle();
    fixed = clean(data?.fixed_from_email).toLowerCase(); sendingDomain = String(data?.sending_domain || "").trim().toLowerCase(); orgLabel = clean(data?.from_org_label);
  } catch (_e) { /* ignore */ }
  const label = orgLabel || brandName || clean(BRAND_NAME_ENV) || "ORDANIS";
  const appUrl = brandAppUrl || Deno.env.get("BRAND_APP_URL") || "https://portal.ordanisos.com";
  if (fixed) return { from: fixed, label, appUrl };
  if (sendingDomain) return { from: `alerts@${sendingDomain}`, label, appUrl };
  if (ADVISOR_EMAIL_FROM) return { from: ADVISOR_EMAIL_FROM, label, appUrl };
  if (brandDomain) return { from: `alerts@${brandDomain}`, label, appUrl };
  return { from: "", label, appUrl };
}

const HOW_TEXT: Record<string, string> = {
  signup_code: "signed up with the firm's code",
  client_join: "joined by entering the firm's code",
  admin_move: "was moved into the firm by an ORDANIS admin, with the client's agreement",
  admin_created: "was created by the firm's team",
};

// Emails every enterprise admin of the firm the household joined. Never throws.
async function notifyFirm(eventId: string): Promise<{ sent: number; skipped?: string }> {
  try {
    const { data: ev } = await admin.from("enterprise_membership_events")
      .select("id, event_type, how, family_id, family_name, to_enterprise_id, created_at, detail").eq("id", eventId).maybeSingle();
    if (!ev || !ev.to_enterprise_id || !["joined", "moved"].includes(ev.event_type)) return { sent: 0, skipped: "not a join event" };
    if (!RESEND_API_KEY) { console.error("firm-join notify: RESEND_API_KEY not configured, skipping"); return { sent: 0, skipped: "no email key" }; }
    const sender = await resolveSender();
    if (!sender.from) { console.error("firm-join notify: sender identity unresolved, skipping"); return { sent: 0, skipped: "no sender" }; }

    const { data: ent } = await admin.from("enterprises").select("name").eq("id", ev.to_enterprise_id).maybeSingle();
    const { data: admins } = await admin.from("user_profiles").select("email, full_name")
      .eq("role", "enterprise_admin").eq("enterprise_id", ev.to_enterprise_id).neq("active", false).limit(20);
    if (!admins || !admins.length) return { sent: 0, skipped: "no enterprise admins" };

    const planKey = String((ev.detail as Record<string, unknown>)?.plan ?? "");
    let planLabel = planKey;
    if (planKey) {
      const { data: pf } = await admin.from("plan_features").select("label").eq("plan", planKey).maybeSingle();
      planLabel = pf?.label || planKey;
    }
    const how = HOW_TEXT[String(ev.how)] ?? "joined";
    const when = new Date(ev.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    const subject = `${clean(ev.family_name)} joined ${clean(ent?.name) || "your firm"}`;
    let sent = 0;
    for (const a of admins) {
      if (!a.email) continue;
      const html =
        `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0A2540;line-height:1.6">` +
        `<p>Hi ${esc(clean(a.full_name) || "there")},</p>` +
        `<p>A household has joined <strong>${esc(ent?.name || "your firm")}</strong> on ${esc(sender.label)}.</p>` +
        `<table style="border-collapse:collapse;margin:12px 0">` +
        `<tr><td style="padding:3px 14px 3px 0;color:#5A6E84">Household</td><td><strong>${esc(ev.family_name)}</strong></td></tr>` +
        (planLabel ? `<tr><td style="padding:3px 14px 3px 0;color:#5A6E84">Plan</td><td>${esc(planLabel)}</td></tr>` : "") +
        `<tr><td style="padding:3px 14px 3px 0;color:#5A6E84">How</td><td>${esc(how)}</td></tr>` +
        `<tr><td style="padding:3px 14px 3px 0;color:#5A6E84">Date</td><td>${esc(when)}</td></tr>` +
        `</table>` +
        `<p><a href="${esc(sender.appUrl)}" style="color:#0A2540;font-weight:600">Sign in to see it</a></p>` +
        `<p style="margin-top:24px">${esc(sender.label)}</p></div>`;
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: sender.label ? `${sender.label} <${sender.from}>` : sender.from, to: [a.email], subject, html }),
      });
      if (resp.ok) sent++;
      else console.error(`firm-join notify: Resend error ${resp.status}:`, (await resp.text().catch(() => "")).slice(0, 300));
    }
    return { sent };
  } catch (e) {
    console.error("firm-join notify failed:", e instanceof Error ? e.message : e);
    return { sent: 0, skipped: "error" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated." }, 401);

    let body: {
      action?: string; code?: string; notice_id?: string; family_id?: string; enterprise_id?: string;
      client_agreed?: boolean; note?: string; event_id?: string;
    };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
    const action = String(body.action ?? "");

    // Internal call from stripe-webhook: authenticated by the service role key itself.
    if (action === "notify") {
      if (token !== SERVICE_ROLE) return json({ error: "Not allowed." }, 403);
      if (!body.event_id) return json({ error: "event_id is required." }, 400);
      return json({ success: true, ...(await notifyFirm(body.event_id)) });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await sb.auth.getUser(token);
    if (uErr || !user) return json({ error: "Not authenticated." }, 401);
    const { data: profile } = await admin.from("user_profiles").select("role, family_id").eq("id", user.id).maybeSingle();
    const role = profile?.role ?? "";
    const ip = clientIp(req);

    if (action === "lookup" || action === "join") {
      if (role !== "client" || !profile?.family_id) return json({ error: "Only a household owner can join a firm." }, 403);
      const notice = await currentNotice();
      if (!notice) return json({ error: DB_ERRORS.notice_not_published.message, code: "notice_not_published" }, 409);

      const chk = await checkCode(String(body.code ?? ""), action === "lookup" ? "client_lookup" : "client_join", ip, user.id);
      if (chk.blocked) return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
      if (!chk.enterpriseId) return json({ error: BAD_CODE, code: "bad_code" }, 400);

      if (action === "lookup") {
        return json({ success: true, valid: true, firm_name: chk.name, notice: { id: notice.id, title: notice.title, body_html: notice.body_html } });
      }
      if (body.notice_id !== notice.id) return json({ error: "The notice changed. Please read it again and confirm.", code: "notice_changed" }, 409);

      const { data: r, error } = await admin.rpc("enterprise_join_family", {
        p_family_id: profile.family_id, p_enterprise_id: chk.enterpriseId, p_how: "client_join", p_actor: user.id,
        p_consent: true, p_consent_note: `Client entered the firm code and accepted the notice (version ${notice.version}).`,
        p_disclosure_id: notice.id, p_apply_default_expert: false,
      });
      if (error) return dbError(error.message);
      let notified: unknown = null;
      if (r?.status === "joined" || r?.status === "moved") notified = await notifyFirm(String(r.event_id));
      return json({ success: true, status: r?.status, firm_name: r?.firm_name, notified });
    }

    // Everything below is for an ORDANIS admin.
    if (role !== "admin") return json({ error: "Only an ORDANIS admin can do this." }, 403);

    if (action === "admin_move") {
      if (!body.family_id || !body.enterprise_id) return json({ error: "family_id and enterprise_id are required." }, 400);
      if (body.client_agreed !== true) return json({ error: "Confirm that the client has agreed first." }, 400);
      const note = clean(body.note);
      if (note.length < 5) return json({ error: "Say how the client agreed (for example, who confirmed it and when)." }, 400);
      const { data: r, error } = await admin.rpc("enterprise_join_family", {
        p_family_id: body.family_id, p_enterprise_id: body.enterprise_id, p_how: "admin_move", p_actor: user.id,
        p_consent: true, p_consent_note: `Recorded by an ORDANIS admin: ${note}`, p_disclosure_id: null, p_apply_default_expert: false,
      });
      if (error) return dbError(error.message);
      let notified: unknown = null;
      if (r?.status === "joined" || r?.status === "moved") notified = await notifyFirm(String(r.event_id));
      return json({ success: true, status: r?.status, firm_name: r?.firm_name, notified });
    }

    if (action === "admin_remove") {
      if (!body.family_id) return json({ error: "family_id is required." }, 400);
      const { data: r, error } = await admin.rpc("enterprise_remove_family", {
        p_family_id: body.family_id, p_actor: user.id, p_note: clean(body.note) || null,
      });
      if (error) return dbError(error.message);
      return json({ success: true, status: r?.status, firm_name: r?.firm_name });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
