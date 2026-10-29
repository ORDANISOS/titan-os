// supabase/functions/client-activity-digest/index.ts
// Daily Client Activity email for ORDANIS Experts (migration 20261029110000). Runs once a day from pg_cron. Takes the
// family changes in household_activity not yet emailed (last 3 days only), groups them by the household's Expert
// (families.advisor_email), sends each Expert one email covering all their households, then stamps digested_at so
// nothing goes twice. A household with no Expert, or an archived one, is skipped. Field names only, never values.
//
// AUTH: verify_jwt is false because pg_cron cannot mint a user JWT; the shared x-cron-secret (CRON_SECRET, same as
// send-task-reminders and onboarding-notices) is checked here. Fails closed if the secret is unset.
// Secrets: RESEND_API_KEY, CRON_SECRET; DEMO_EMAIL_OVERRIDE (demo only) redirects every email.
// Deploy: supabase functions deploy client-activity-digest --project-ref <ref> --use-api --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const DEMO_EMAIL_OVERRIDE = (Deno.env.get("DEMO_EMAIL_OVERRIDE") ?? "").trim();
const IS_DEMO = SUPABASE_URL.includes("tkryueqzvgcigvxgjzsp");
const PER_HOUSEHOLD = 25;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const KIND: Record<string, string> = {
  properties: "property", portfolio_accounts: "account", account_balances: "account balance", valuables: "valuable",
  loans: "loan or line", cash_flow_events: "cash flow event", cash_flow_payment_log: "bill payment",
  contacts: "family member", family_contacts: "contact", property_contacts: "property vendor", entities: "entity",
  entity_members: "entity member", deals: "deal", tasks: "task", notes: "note", obligations: "obligation",
  documents: "document", document_folders: "document folder",
};
const field = (k: string) => k.replace(/_id$/, "").replace(/_/g, " ");

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
  const subj = (IS_DEMO ? "[Demo] " : "") + (DEMO_EMAIL_OVERRIDE ? `[→ ${to}] ` : "") + subject;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${s.label} <${s.from}>`, to: [finalTo], subject: subj, html }),
  });
  if (!r.ok) console.error(`client-activity-digest: Resend ${r.status}:`, (await r.text().catch(() => "")).slice(0, 200));
  return r.ok;
}

type Row = { id: string; family_id: string; actor_name: string | null; actor_email: string | null; table_name: string;
  action: string; record_label: string | null; fields: string[] | null; created_at: string };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short",
  day: "numeric", hour: "numeric", minute: "2-digit" });

function line(r: Row) {
  const who = esc(r.actor_name || r.actor_email || "A family user");
  const colour = r.action === "added" ? "#2e7d4f" : r.action === "removed" ? "#b03a2e" : "#0A2540";
  const what = esc(KIND[r.table_name] ?? field(r.table_name)) + (r.record_label ? ` <strong>“${esc(r.record_label)}”</strong>` : "");
  const changed = r.action === "changed" && r.fields?.length
    ? `<div style="font-size:12px;color:#5a6e84;margin-top:2px;">Changed: ${esc(r.fields.map(field).join(", "))}</div>` : "";
  return `<tr><td style="padding:7px 0;border-bottom:1px solid #ede8de;font-size:12px;color:#8fa0b2;white-space:nowrap;vertical-align:top;width:110px;">${esc(when(r.created_at))}</td>` +
    `<td style="padding:7px 0 7px 10px;border-bottom:1px solid #ede8de;font-size:14px;color:#0A2540;">${who} <span style="color:${colour};font-weight:bold;">${esc(r.action)}</span> ${what}${changed}</td></tr>`;
}

Deno.serve(async (req) => {
  const presented = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!CRON_SECRET || presented !== CRON_SECRET) return json({ error: "Unauthorized" }, 401);
  if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY is not set, so nothing was sent." }, 409);
  const s = await sender();
  if (!s.from) return json({ error: "No sending address is configured, so nothing was sent." }, 409);

  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data: rows, error } = await sb.from("household_activity")
    .select("id, family_id, actor_name, actor_email, table_name, action, record_label, fields, created_at")
    .is("digested_at", null).gte("created_at", since).order("created_at", { ascending: true }).limit(5000);
  if (error) return json({ error: error.message }, 500);
  if (!rows?.length) return json({ success: true, experts: 0, households: 0 });

  const famIds = [...new Set(rows.map((r) => r.family_id))];
  const { data: fams, error: fErr } = await sb.from("families").select("id, name, advisor_email, advisor_name, archived_at").in("id", famIds);
  if (fErr) return json({ error: fErr.message }, 500);

  // Expert email -> households (in name order) -> that household's rows.
  const byExpert = new Map<string, { name: string; households: { name: string; rows: Row[] }[] }>();
  for (const f of (fams ?? []).sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
    const to = String(f.advisor_email ?? "").trim().toLowerCase();
    if (!to || f.archived_at) continue;
    const hhRows = rows.filter((r) => r.family_id === f.id) as Row[];
    if (!hhRows.length) continue;
    const e = byExpert.get(to) ?? { name: String(f.advisor_name ?? ""), households: [] };
    e.households.push({ name: String(f.name ?? "A household"), rows: hhRows });
    byExpert.set(to, e);
  }

  // Use the Expert's own name from their login where there is one.
  const { data: people } = await sb.from("user_profiles").select("email, full_name, active").in("email", [...byExpert.keys()]);
  let sent = 0, failed = 0, households = 0;
  for (const [to, e] of byExpert) {
    const person = (people ?? []).find((p) => String(p.email).toLowerCase() === to);
    if (person && person.active === false) continue;
    const first = String(person?.full_name || e.name || "").trim().split(/\s+/)[0];
    const total = e.households.reduce((n, h) => n + h.rows.length, 0);
    const sections = e.households.map((h) => {
      const shown = h.rows.slice(-PER_HOUSEHOLD).reverse();
      const more = h.rows.length - shown.length;
      return `<h2 style="font-family:Georgia,serif;font-weight:normal;font-size:18px;margin:22px 0 4px;color:#0A2540;">${esc(h.name)}</h2>` +
        `<div style="font-size:12px;color:#8fa0b2;margin-bottom:4px;">${h.rows.length} change${h.rows.length === 1 ? "" : "s"}, newest first</div>` +
        `<table style="width:100%;border-collapse:collapse;">${shown.map(line).join("")}</table>` +
        (more > 0 ? `<div style="font-size:12px;color:#5a6e84;margin-top:6px;">and ${more} earlier change${more === 1 ? "" : "s"}; see the household's Client Activity tab.</div>` : "");
    }).join("");
    const hhCount = e.households.length;
    const subject = hhCount === 1
      ? `Client activity: ${e.households[0].name} made ${total} change${total === 1 ? "" : "s"}`
      : `Client activity: ${total} changes across ${hhCount} households`;
    const html =
      `<div style="font-family:Arial,sans-serif;background:#F8F6F1;padding:24px 12px;"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e6e0d2;border-radius:12px;overflow:hidden;">` +
      `<div style="background:#0A2540;padding:20px 28px;color:#C9A961;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;">ORDANIS · Client Activity${IS_DEMO ? " · DEMO" : ""}</div>` +
      `<div style="padding:24px 28px;color:#0A2540;font-size:15px;line-height:1.6;">` +
      `<p style="margin:0 0 6px;">${first ? `Hi ${esc(first)},` : "Hello,"}</p>` +
      `<p style="margin:0;">Here's what your families changed in their records since the last summary. It shows which fields changed, not the values; open the household to see the record as it is now.</p>` +
      sections +
      `<p style="margin:22px 0 0;"><a href="${esc(s.appUrl)}" style="display:inline-block;background:#0A2540;color:#fff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;">Open ORDANIS</a></p>` +
      `<p style="margin:18px 0 0;font-size:11px;color:#8fa0b2;">This is an automated message from ORDANIS. Replies to this address aren't read; sign in to the portal for anything you need.</p></div></div></div>`;
    if (await send(to, subject, html, s)) {
      const ids = e.households.flatMap((h) => h.rows.map((r) => r.id));
      for (let i = 0; i < ids.length; i += 500) {
        await sb.from("household_activity").update({ digested_at: new Date().toISOString() }).in("id", ids.slice(i, i + 500));
      }
      sent++; households += hhCount;
    } else failed++;
  }
  return json({ success: true, experts: sent, households, failed });
});
