// supabase/functions/onboarding-notices/index.ts
// Day-30 notice for Onboarding Specialists (migration 20261022140000). Runs daily from pg_cron. For each live
// assignment whose 30 days end today (or already ended and nobody was told), it emails the admin who named the
// specialist and the specialist, then marks it notified. Extending is done by an admin on the household's Overview
// (onboarding_specialist_extend), which clears notified_at so the next period gets its own notice.
//
// AUTH: verify_jwt is false because pg_cron cannot mint a user JWT; the shared x-cron-secret (CRON_SECRET, same as
// send-task-reminders) is checked here. Fails closed if the secret is unset.
// Secrets: RESEND_API_KEY, CRON_SECRET. Deploy: supabase functions deploy onboarding-notices --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const DEMO_EMAIL_OVERRIDE = (Deno.env.get("DEMO_EMAIL_OVERRIDE") ?? "").trim();

const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function sender(): Promise<{ from: string; label: string; appUrl: string }> {
  let label = "ORDANIS", appUrl = Deno.env.get("BRAND_APP_URL") || "https://portal.ordanisos.com", from = "";
  try {
    const { data } = await sb.from("brand_profiles").select("brand_name, app_url").eq("is_active", true).maybeSingle();
    if (data?.brand_name) label = String(data.brand_name);
    if (data?.app_url) appUrl = String(data.app_url);
  } catch (_e) { /* defaults */ }
  try {
    const { data } = await sb.from("outbound_email_settings").select("fixed_from_email, sending_domain, from_org_label").limit(1).maybeSingle();
    from = String(data?.fixed_from_email ?? "").trim() || (data?.sending_domain ? `alerts@${data.sending_domain}` : "");
    if (data?.from_org_label) label = String(data.from_org_label);
  } catch (_e) { /* none */ }
  return { from, label, appUrl };
}

async function send(to: string, subject: string, html: string, s: { from: string; label: string }) {
  const finalTo = DEMO_EMAIL_OVERRIDE || to;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${s.label} <${s.from}>`, to: [finalTo], subject: DEMO_EMAIL_OVERRIDE ? `[DEMO → ${to}] ${subject}` : subject, html }),
  });
  if (!r.ok) console.error(`onboarding-notices: Resend ${r.status}:`, (await r.text().catch(() => "")).slice(0, 200));
  return r.ok;
}

const shell = (heading: string, body: string, appUrl: string, button: string) =>
  `<div style="font-family:Arial,sans-serif;background:#F8F6F1;padding:24px 12px;"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6e0d2;border-radius:12px;overflow:hidden;">` +
  `<div style="background:#0A2540;padding:20px 28px;color:#C9A961;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;">ORDANIS · Onboarding</div>` +
  `<div style="padding:24px 28px;color:#0A2540;font-size:15px;line-height:1.6;"><h1 style="font-family:Georgia,serif;font-weight:normal;font-size:22px;margin:0 0 12px;">${esc(heading)}</h1>${body}` +
  `<p style="margin:20px 0 0;"><a href="${esc(appUrl)}" style="display:inline-block;background:#0A2540;color:#fff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;">${esc(button)}</a></p>` +
  `<p style="margin:18px 0 0;font-size:11px;color:#8fa0b2;">This is an automated message from ORDANIS. Replies to this address aren't read; sign in to the portal for anything you need.</p></div></div></div>`;

Deno.serve(async (req) => {
  const presented = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!CRON_SECRET || presented !== CRON_SECRET) return json({ error: "Unauthorized" }, 401);
  if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY is not set, so nothing was sent." }, 409);
  const s = await sender();
  if (!s.from) return json({ error: "No sending address is configured, so nothing was sent." }, 409);

  // Ends today (UTC) or earlier, not ended by an admin, not yet notified for this period.
  const endOfToday = new Date(); endOfToday.setUTCHours(23, 59, 59, 999);
  const { data: rows, error } = await sb.from("household_onboarding_specialists")
    .select("id, family_id, staff_id, assigned_by, expires_at, extended_count")
    .is("ended_at", null).is("notified_at", null).lte("expires_at", endOfToday.toISOString()).limit(200);
  if (error) return json({ error: error.message }, 500);

  let sent = 0, failed = 0;
  for (const r of rows ?? []) {
    const ids = [r.staff_id, r.assigned_by].filter(Boolean);
    const [{ data: fam }, { data: people }] = await Promise.all([
      sb.from("families").select("name, archived_at").eq("id", r.family_id).maybeSingle(),
      sb.from("user_profiles").select("id, email, full_name, role, active").in("id", ids),
    ]);
    const staff = (people ?? []).find((p) => p.id === r.staff_id);
    const admin = (people ?? []).find((p) => p.id === r.assigned_by && p.role === "admin" && p.active !== false);
    const hh = fam?.name ?? "a household";
    const when = new Date(r.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    const staffName = staff?.full_name || staff?.email || "The Onboarding Specialist";
    let ok = true;
    if (!fam?.archived_at) {
      if (admin?.email) {
        ok = (await send(admin.email, `Onboarding access ending: ${hh}`, shell(`${staffName}'s onboarding access ends ${when}`,
          `<p style="margin:0 0 10px;">${esc(staffName)} has been helping set up <strong>${esc(hh)}</strong> as its Onboarding Specialist. Their 30 days end on ${esc(when)}.</p>` +
          `<p style="margin:0;">To give them 30 more days, open the household and choose <strong>Extend 30 days</strong> on its Overview. If setup is done, there's nothing to do: access ends on its own.</p>`,
          s.appUrl, "Open ORDANIS"), s)) && ok;
      }
      if (staff?.email && staff.active !== false) {
        ok = (await send(staff.email, `Your onboarding access to ${hh} ends ${when}`, shell(`Your onboarding access ends ${when}`,
          `<p style="margin:0 0 10px;">Your 30 days as Onboarding Specialist for <strong>${esc(hh)}</strong> end on ${esc(when)}.</p>` +
          `<p style="margin:0;">If you need more time, ask ${esc(admin?.full_name || admin?.email || "an ORDANIS admin")} to extend it by 30 days.</p>`,
          s.appUrl, "Open ORDANIS"), s)) && ok;
      }
    }
    if (ok) {
      await sb.from("household_onboarding_specialists").update({ notified_at: new Date().toISOString() }).eq("id", r.id);
      sent++;
    } else failed++;
  }
  return json({ success: true, notified: sent, failed });
});
