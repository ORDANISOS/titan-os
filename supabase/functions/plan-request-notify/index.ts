// supabase/functions/plan-request-notify/index.ts
// Emails the ORDANIS team when a household asks to change plan (migration 20261028180000). The app calls this right
// after request_plan_change succeeds, with the new request's id. Only the person who filed the request can trigger
// it, only while the request is still pending and was filed in the last 15 minutes, and only once (notified_at).
//
// AUTH: verify_jwt on (the caller's own session). Secrets: RESEND_API_KEY; optional PLAN_REQUEST_NOTIFY_TO
// (default info@ordanisos.com). Deploy: supabase functions deploy plan-request-notify --project-ref <ref> --use-api

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_TO = (Deno.env.get("PLAN_REQUEST_NOTIFY_TO") ?? "").trim() || "info@ordanisos.com";
const IS_DEMO = SUPABASE_URL.includes("tkryueqzvgcigvxgjzsp");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

async function sender(): Promise<{ from: string; label: string; appUrl: string }> {
  let label = "ORDANIS", appUrl = Deno.env.get("BRAND_APP_URL") || "https://portal.ordanisos.com", from = "";
  try {
    const { data } = await admin.from("brand_profiles").select("brand_name, app_url").eq("is_active", true).maybeSingle();
    if (data?.brand_name) label = String(data.brand_name);
    if (data?.app_url) appUrl = String(data.app_url);
  } catch (_e) { /* defaults */ }
  try {
    const { data } = await admin.from("outbound_email_settings").select("fixed_from_email, sending_domain, from_org_label").limit(1).maybeSingle();
    from = String(data?.fixed_from_email ?? "").trim() || (data?.sending_domain ? `alerts@${data.sending_domain}` : "");
    if (data?.from_org_label) label = String(data.from_org_label);
  } catch (_e) { /* none */ }
  return { from, label, appUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  const uid = who?.user?.id;
  if (!uid) return json({ error: "Sign in first." }, 401);

  let requestId = "";
  try { requestId = String((await req.json())?.request_id ?? ""); } catch (_e) { /* empty body */ }
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: "request_id is required." }, 400);

  const { data: r } = await admin.from("plan_change_requests")
    .select("id, family_id, requested_by, requested_by_label, from_plan, to_plan, note, status, created_at, notified_at")
    .eq("id", requestId).maybeSingle();
  if (!r || r.requested_by !== uid) return json({ error: "Request not found." }, 404);
  if (r.notified_at) return json({ success: true, already: true });
  if (r.status !== "pending" || Date.now() - new Date(r.created_at).getTime() > 15 * 60 * 1000) return json({ success: true, skipped: true });

  // Claim the request before sending, so two quick calls can't both email.
  const { data: claimed } = await admin.from("plan_change_requests").update({ notified_at: new Date().toISOString() })
    .eq("id", r.id).is("notified_at", null).select("id");
  if (!claimed?.length) return json({ success: true, already: true });

  if (!RESEND_API_KEY) return json({ success: false, error: "RESEND_API_KEY is not set." }, 409);
  const s = await sender();
  if (!s.from) return json({ success: false, error: "No sending address is configured." }, 409);

  const [{ data: fam }, { data: plans }, { data: person }] = await Promise.all([
    admin.from("families").select("name, enterprise_id").eq("id", r.family_id).maybeSingle(),
    admin.from("plan_features").select("plan, label").in("plan", [r.from_plan, r.to_plan]),
    admin.from("user_profiles").select("email, phone").eq("id", uid).maybeSingle(),
  ]);
  const label = (p: string) => (plans ?? []).find((x) => x.plan === p)?.label || (p.charAt(0).toUpperCase() + p.slice(1));
  const rank: Record<string, number> = { basic: 1, core: 2, premier: 3 };
  const kind = (rank[r.to_plan] ?? 0) > (rank[r.from_plan] ?? 0) ? "upgrade" : "plan change";
  const hh = fam?.name ?? "A household";
  const when = new Date(r.created_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET";
  const row = (k: string, v: string) => `<tr><td style="padding:6px 14px 6px 0;color:#5a6e84;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;color:#0A2540;font-size:14px;">${v}</td></tr>`;
  const html =
    `<div style="font-family:Arial,sans-serif;background:#F8F6F1;padding:24px 12px;"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6e0d2;border-radius:12px;overflow:hidden;">` +
    `<div style="background:#0A2540;padding:20px 28px;color:#C9A961;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;">ORDANIS · Plan request${IS_DEMO ? " · DEMO" : ""}</div>` +
    `<div style="padding:24px 28px;color:#0A2540;font-size:15px;line-height:1.6;">` +
    `<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:22px;margin:0 0 12px;">${esc(hh)} asked for ${esc(label(r.to_plan))}</h1>` +
    `<table style="border-collapse:collapse;margin:0 0 14px;">` +
    row("Household", esc(hh) + (fam?.enterprise_id ? " <span style=\"color:#8fa0b2;\">(firm household)</span>" : "")) +
    row("Change", `${esc(label(r.from_plan))} → <strong>${esc(label(r.to_plan))}</strong>`) +
    row("Asked by", esc(r.requested_by_label || person?.email || "") + (person?.email && r.requested_by_label !== person.email ? ` &lt;${esc(person.email)}&gt;` : "")) +
    (person?.phone ? row("Phone", esc(person.phone)) : "") +
    row("When", esc(when)) +
    (r.note ? row("Their note", esc(r.note).replace(/\n/g, "<br>")) : "") +
    `</table>` +
    `<p style="margin:0;">Approve or decline it in the portal under <strong>Plan requests</strong>. The household sees it as waiting until then.</p>` +
    `<p style="margin:20px 0 0;"><a href="${esc(s.appUrl)}" style="display:inline-block;background:#0A2540;color:#fff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;">Open Plan requests</a></p>` +
    `<p style="margin:18px 0 0;font-size:11px;color:#8fa0b2;">This is an automated message from ORDANIS. Replies to this address aren't read.</p></div></div></div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${s.label} <${s.from}>`, to: [NOTIFY_TO],
      subject: `${IS_DEMO ? "[Demo] " : ""}Plan ${kind} request: ${hh} → ${label(r.to_plan)}`, html,
    }),
  });
  if (!res.ok) {
    console.error(`plan-request-notify: Resend ${res.status}:`, (await res.text().catch(() => "")).slice(0, 200));
    // Release the claim so a retry can send it.
    await admin.from("plan_change_requests").update({ notified_at: null }).eq("id", r.id);
    return json({ success: false, error: "The email could not be sent." }, 502);
  }
  return json({ success: true });
});
