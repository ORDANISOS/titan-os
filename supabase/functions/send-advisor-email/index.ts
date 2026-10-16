// supabase/functions/send-advisor-email/index.ts
// A client emails their designated ORDANIS Expert (or anyone else they add)
// through the platform.
//
// Why server-side: it lets us (1) force the primary Expert onto CC in a way the
// client CANNOT remove, and (2) set reply-to to the client's real email so the
// recipient replies straight to them. The client only supplies the recipient +
// message; everything trust-sensitive (which family, who the primary Expert is,
// whether the recipient is even allowed) is decided here from the database.
//
// ── SENDER IDENTITY ─────────────────────────────────────────────────────────
// This used to read:
//
//   const FROM = Deno.env.get("ADVISOR_EMAIL_FROM") || "alerts@pcmfamilyoffice.com";
//   const BRAND_NAME = Deno.env.get("BRAND_NAME") || "TitanOS";
//
// Both defaults were wrong for every tenant but one. This function sends to
// EXTERNAL third parties the client chooses — their banker, their attorney,
// their insurance agent — so a licensed firm's client portal was introducing
// itself to outsiders as PCM Family Office, or as the product, unless someone
// remembered to set two secrets at provisioning time. Nothing failed; it just
// quietly sent under the wrong name, which is the worst way for this to be wrong.
//
// Identity now resolves from data, in order of how explicitly it was configured:
//
//   1. outbound_email_settings.fixed_from_email  — the firm's verified sender
//   2. alerts@<outbound_email_settings.sending_domain>
//   3. ADVISOR_EMAIL_FROM secret                 — per-project override
//   4. alerts@<brand_profiles.email_domain>      — the active brand's own domain
//   5. refuse to send
//
// Step 4 is what makes a new skin work with no per-tenant configuration at all:
// set the brand row and outbound mail is already attributed correctly. Step 5 is
// deliberate — there is no shared default, because a shared default is exactly
// how one firm's address ended up on every firm's mail.
//
// Deploy:  supabase functions deploy send-advisor-email
// Secrets: RESEND_API_KEY (required)
//          ADVISOR_EMAIL_FROM (optional; prefer outbound_email_settings)
//          DEMO_EMAIL_OVERRIDE (demo/staging only)
//
// ── DEMO DEPLOYMENTS ──────────────────────────────────────────
// This function is the one most able to reach a real outsider, because the
// recipient is chosen by the client rather than drawn from firm records. On a
// demo instance DEMO_EMAIL_OVERRIDE redirects every envelope to a single mailbox.
// The variable is unset in production, which makes the block inert there — the
// same file is safe to deploy to every tenant.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_ENV = Deno.env.get("ADVISOR_EMAIL_FROM") || "";
const BRAND_NAME_ENV = Deno.env.get("BRAND_NAME") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DEMO_EMAIL_OVERRIDE = (Deno.env.get("DEMO_EMAIL_OVERRIDE") ?? "").trim();

const MAX_RECIPIENTS = 8;
const DAILY_LIMIT = 20; // messages per sender per rolling 24 hours
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
const clean = (s: string) => String(s || "").replace(/[\r\n<>]/g, " ").trim();
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Pull a bare address out of either "Name <a@b.c>" or "a@b.c".
function bareAddress(v: string): string {
  const s = String(v || "").trim();
  const m = s.match(/<([^>]+)>/);
  const addr = (m ? m[1] : s).trim().toLowerCase();
  return EMAIL_RE.test(addr) ? addr : "";
}

// deno-lint-ignore no-explicit-any
async function resolveSender(admin: any): Promise<{ from: string; label: string; source: string }> {
  let brandName = "";
  let brandDomain = "";
  try {
    const { data } = await admin.from("brand_profiles")
      .select("brand_name, email_domain").eq("is_active", true).maybeSingle();
    brandName = clean(data?.brand_name);
    brandDomain = String(data?.email_domain || "").trim().toLowerCase();
  } catch (_e) { /* table may not exist on an older project — fall through */ }

  let fixed = "";
  let sendingDomain = "";
  let orgLabel = "";
  try {
    const { data } = await admin.from("outbound_email_settings")
      .select("fixed_from_email, sending_domain, from_org_label").eq("id", true).maybeSingle();
    fixed = bareAddress(String(data?.fixed_from_email || ""));
    sendingDomain = String(data?.sending_domain || "").trim().toLowerCase();
    orgLabel = clean(data?.from_org_label);
  } catch (_e) { /* ditto */ }

  // The display name shown to the recipient. Never the product name.
  const label = orgLabel || brandName || clean(BRAND_NAME_ENV) || "";

  if (fixed) return { from: fixed, label, source: "outbound_email_settings.fixed_from_email" };
  if (sendingDomain) return { from: `alerts@${sendingDomain}`, label, source: "outbound_email_settings.sending_domain" };
  const envAddr = bareAddress(FROM_ENV);
  if (envAddr) return { from: envAddr, label, source: "ADVISOR_EMAIL_FROM" };
  if (brandDomain) return { from: `alerts@${brandDomain}`, label, source: "brand_profiles.email_domain" };
  return { from: "", label, source: "unresolved" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!RESEND_API_KEY) return json({ error: "Email is not configured (missing API key)." }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated." }, 401);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await anon.auth.getUser(token);
    if (uErr || !user) return json({ error: "Not authenticated." }, 401);
    const clientEmail = user.email || "";

    const body = await req.json().catch(() => null);
    const rawTo: unknown[] = Array.isArray(body?.toEmails) ? body.toEmails : (body?.toEmail ? [body.toEmail] : []);
    const toEmails = Array.from(new Set(
      rawTo.map((e) => clean(String(e)).toLowerCase()).filter((e) => EMAIL_RE.test(e))
    ));
    const subject = clean(body?.subject).slice(0, 200) || "Message from your client";
    const message = String(body?.message || "").slice(0, 20000);
    if (!toEmails.length) return json({ error: "Missing or invalid recipient email." }, 400);
    if (toEmails.length > MAX_RECIPIENTS) return json({ error: `Too many recipients (max ${MAX_RECIPIENTS}).` }, 400);
    if (!message.trim()) return json({ error: "Message is empty." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Resolved after auth so an unauthenticated caller learns nothing about how
    // this deployment is configured.
    const sender = await resolveSender(admin);
    if (!sender.from) {
      console.error("send-advisor-email: sender identity unresolved");
      return json({
        error: "This firm's outbound email sender hasn't been configured yet, so nothing was sent. " +
               "An administrator needs to set the sending domain under outbound email settings.",
      }, 500);
    }

    const { data: profile } = await admin.from("user_profiles").select("family_id, full_name").eq("id", user.id).single();
    const familyId = profile?.family_id;
    if (!familyId) return json({ error: "No family is associated with your account." }, 403);
    const clientName = clean(profile?.full_name) || clientEmail;

    const { data: fam } = await admin.from("families").select("advisor_name, advisor_email, subscription_state").eq("id", familyId).single();

    // This sends to outside addresses from the firm's verified domain, so it is limited to households
    // in good standing and to a daily allowance per sender. Before 2026-10-14 there was no limit.
    if (fam?.subscription_state !== "active") {
      return json({ error: "Email is available once your subscription is active." }, 403);
    }
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: sentToday, error: cntErr } = await admin.from("client_email_sends")
      .select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
    if (cntErr) {
      console.error("send-advisor-email: could not read send log:", cntErr.message);
      return json({ error: "Email is temporarily unavailable. Please try again later." }, 503);
    }
    if ((sentToday ?? 0) >= DAILY_LIMIT) {
      return json({ error: `You have reached today's limit of ${DAILY_LIMIT} messages. Please try again tomorrow, or contact your ORDANIS Expert.` }, 429);
    }
    const primaryEmail = (fam?.advisor_email || "").trim().toLowerCase();
    const primaryName = clean(fam?.advisor_name);

    const { data: staffRows } = await admin.from("user_profiles").select("email").in("role", ["advisor", "analyst", "admin"]).eq("active", true);
    const staffEmails = new Set((staffRows || []).map((r: { email: string }) => (r.email || "").trim().toLowerCase()).filter(Boolean));
    // The household's own team may be emailed: its Expert and that Expert's Analyst. Other staff may not.
    const { data: team } = await admin.rpc("household_team", { p_family_id: familyId });
    const teamEmails = new Set(((team || []) as { email: string }[]).map((t) => (t.email || "").trim().toLowerCase()).filter(Boolean));
    const blocked = toEmails.filter((e) => e !== primaryEmail && !teamEmails.has(e) && staffEmails.has(e));
    if (blocked.length) return json({ error: "You can only email your designated ORDANIS Expert from the firm — not other ORDANIS Experts directly." }, 403);

    const cc = (primaryEmail && !toEmails.includes(primaryEmail)) ? [primaryEmail] : undefined;

    // "via <firm>" only when we actually know the firm. Saying "via" and then
    // naming nobody reads as a bug; omitting it reads as deliberate.
    const viaSuffix = sender.label ? ` via the ${esc(sender.label)} client portal` : " via the client portal";
    const fromHeader = sender.label
      ? `${clientName} via ${sender.label} <${sender.from}>`
      : `${clientName} <${sender.from}>`;

    const safeMsg = esc(message).replace(/\n/g, "<br>");
    const html =
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5">` +
      `${safeMsg}` +
      `<hr style="border:none;border-top:1px solid #e5e5e5;margin:20px 0">` +
      `<div style="font-size:12px;color:#888">Sent by ${esc(clientName)}${viaSuffix}. Reply to reach ${esc(clientName)} directly${cc ? ` (${esc(primaryName || primaryEmail)} is copied)` : ""}.</div>` +
      `</div>`;

    const payload: Record<string, unknown> = {
      from: fromHeader,
      to: toEmails,
      subject,
      html,
      text: message,
      reply_to: clientEmail || undefined,
    };
    if (cc) payload.cc = cc;

    // ── Demo safety override ─────────────────────────────────────────
    // Deliberately last: every check above has already run against the REAL
    // addresses, so a demo exercises the same code path a client would. Only the
    // envelope is rewritten, and the intended recipients are carried in the subject.
    if (DEMO_EMAIL_OVERRIDE) {
      const routed = [`to: ${toEmails.join(", ")}`, cc ? `cc: ${cc.join(", ")}` : null]
        .filter(Boolean).join(" | ");
      payload.to = [DEMO_EMAIL_OVERRIDE];
      delete payload.cc;
      payload.subject = `[DEMO → ${routed}] ${subject}`.slice(0, 300);
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.error("Resend error", resp.status, detail, "sender source:", sender.source);
      return json({ error: "The email service returned an error.", detail: detail.slice(0, 300) }, 502);
    }
    const { error: logErr } = await admin.from("client_email_sends")
      .insert({ user_id: user.id, family_id: familyId, recipients: toEmails.length + (cc ? cc.length : 0) });
    if (logErr) console.error("send-advisor-email: could not log send:", logErr.message);
    return json({
      ok: true,
      to: toEmails,
      cc: cc ? primaryEmail : null,
      demoRoutedTo: DEMO_EMAIL_OVERRIDE || undefined,
    });
  } catch (e) {
    console.error("send-advisor-email error", e);
    return json({ error: "Server error.", detail: String((e as Error)?.message || e) }, 500);
  }
});
