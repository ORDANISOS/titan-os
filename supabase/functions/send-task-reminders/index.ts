// supabase/functions/send-task-reminders/index.ts
// Daily reminder sweep. Covers BOTH work queues:
//   1. tasks           — one-off items with reminder_days / reminder_sent
//   2. cash_flow_events — bills the firm is responsible for paying
//
// Bills were previously invisible to this job: they had a due date and a "we pay
// this" flag and raised no alert at all, so a Premier household depended on someone
// opening the Cash Flow tab and noticing. That is the failure mode that loses a
// bill-pay client.
//
// WHY BILLS ARE DIGESTED AND TASKS ARE NOT
// Tasks are sporadic; a bill run is not. Six households turning over on the 1st
// would mean six separate emails to the same Expert on the same morning, which is
// how a mailbox gets filtered. Bills are therefore grouped into one message per
// ORDANIS Expert, ordered by due date. Tasks keep their existing one-email-each
// behaviour so nothing about the current flow changes.
//
// FAMILY REMINDERS ON SELF-DIRECTED PLANS (migration 20261028140000)
// On Basic and Core (plan_features.self_serve) the household runs its own records, so task reminders also go to the
// family logins allowed to act on them (the primary and every active family user with "Edit records"), and bills the
// household tracks itself get a daily digest to the same people. The Expert, when there is one, is still emailed.
//
// RECURRENCE
// cash_flow_events.reminder_sent_for stores the OCCURRENCE a reminder covered, not
// a boolean. Deciding whether to send is a comparison against the next due date, so
// a monthly bill needs nothing reset between cycles. See the migration for why.
//
// AUTH: verify_jwt is false because pg_cron cannot mint a user JWT, so the function
// verifies a shared secret itself. Without it this endpoint was open to anyone who
// knew the URL — the cron job presented only the anon key, which ships publicly in
// the frontend bundle.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const DEMO_EMAIL_OVERRIDE = (Deno.env.get("DEMO_EMAIL_OVERRIDE") ?? "").trim();

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const money = (n: unknown) => {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const prettyDate = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US",
    { weekday: "long", year: "numeric", month: "long", day: "numeric" });

// Brand and sender resolved from the database, so a white-label deployment does not
// introduce itself as another firm. No shared default: a wrong from-address is worse
// than a refused send.
async function loadBrand() {
  let brand = "";
  let domain = "";
  let appUrl = "";
  try {
    const { data } = await sb.from("brand_profiles")
      .select("brand_name, email_domain, app_url").eq("is_active", true).maybeSingle();
    brand = String(data?.brand_name ?? "").trim();
    domain = String(data?.email_domain ?? "").trim().toLowerCase();
    appUrl = String(data?.app_url ?? "").trim();
  } catch { /* older project without the table */ }

  let from = "";
  try {
    const { data } = await sb.from("outbound_email_settings")
      .select("fixed_from_email, sending_domain").limit(1).maybeSingle();
    const fixed = String(data?.fixed_from_email ?? "").trim().toLowerCase();
    const sending = String(data?.sending_domain ?? "").trim().toLowerCase();
    if (fixed) from = fixed;
    else if (sending) from = `alerts@${sending}`;
  } catch { /* ditto */ }
  if (!from && domain) from = `alerts@${domain}`;

  return { brand, from, appUrl };
}

async function sendEmail(to: string, subject: string, html: string, brand: string, from: string) {
  const realTo = to;
  const finalTo = DEMO_EMAIL_OVERRIDE || to;
  const finalSubject = DEMO_EMAIL_OVERRIDE ? `[DEMO → ${realTo}] ${subject}` : subject;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: brand ? `${brand} <${from}>` : from,
      to: [finalTo],
      subject: finalSubject,
      html,
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return { ok: false, detail: detail.slice(0, 300) };
  }
  return { ok: true, detail: "" };
}

function shell(brand: string, headline: string, sub: string, body: string, accentDark: boolean) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f9f7f3;margin:0;padding:20px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <div style="background:#092b49;padding:26px 34px;">
      <div style="color:#ceb684;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:4px;">${esc(brand || "Family Office")} · ${esc(sub)}</div>
      <div style="color:#fff;font-size:21px;font-weight:600;">${esc(headline)}</div>
    </div>
    <div style="height:2px;background:linear-gradient(90deg,#ceb684,#dfc99a,transparent);"></div>
    <div style="padding:28px 34px;">${body}</div>
    <div style="padding:0 34px 18px;font-size:11px;color:#8fa0b2;">This is an automated message from ORDANIS. Replies to this address aren't read; sign in to the portal for anything you need.</div>
    <div style="background:#092b49;padding:14px 34px;display:flex;justify-content:space-between;">
      <span style="font-size:11px;color:rgba(255,255,255,0.4);">${esc(brand)}</span>
      <span style="font-size:10px;color:rgba(206,182,132,0.5);letter-spacing:0.1em;">CONFIDENTIAL</span>
    </div>
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  // Fail closed: if CRON_SECRET is unset on this project, refuse rather than
  // silently reverting to the old wide-open behaviour.
  const presented = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!CRON_SECRET || presented !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const { brand, from, appUrl } = await loadBrand();
  if (!from) {
    return new Response(JSON.stringify({
      success: false,
      error: "No verified sending address is configured for this deployment, so nothing was sent.",
    }), { status: 409, headers: { "Content-Type": "application/json" } });
  }

  const summary = { tasks: { sent: 0, skipped: 0, failed: 0 }, bills: { sent: 0, digests: 0, failed: 0 },
    family: { taskEmails: 0, billDigests: 0, failed: 0 } };
  // Which plans are self-directed, and each household's family recipients (looked up once per household).
  const { data: planRows } = await sb.from("plan_features").select("plan, self_serve");
  const selfServe = new Set((planRows || []).filter((p) => p.self_serve).map((p) => p.plan));
  const recipientCache = new Map<string, { email: string; full_name: string | null }[]>();
  const familyRecipients = async (familyId: string) => {
    if (!recipientCache.has(familyId)) {
      const { data } = await sb.rpc("household_reminder_recipients", { p_family_id: familyId });
      recipientCache.set(familyId, (data || []) as { email: string; full_name: string | null }[]);
    }
    return recipientCache.get(familyId)!;
  };

  try {
    // ── 1. TASK REMINDERS ────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: tasks, error: taskErr } = await sb
      .from("tasks")
      .select(`*, families ( id, name, advisor_name, advisor_email, plan )`)
      .eq("done", false)
      .eq("reminder_sent", false)
      .not("due_date", "is", null)
      .not("reminder_days", "is", null)
      .gt("reminder_days", 0);
    if (taskErr) throw taskErr;

    for (const task of tasks || []) {
      const family = task.families;
      const famPeople = family && selfServe.has(family.plan) ? await familyRecipients(family.id) : [];
      if (!family?.advisor_email && !famPeople.length) { summary.tasks.skipped++; continue; }

      const due = new Date(task.due_date);
      due.setHours(0, 0, 0, 0);
      const remindOn = new Date(due);
      remindOn.setDate(remindOn.getDate() - task.reminder_days);
      remindOn.setHours(0, 0, 0, 0);
      if (today.getTime() !== remindOn.getTime()) { summary.tasks.skipped++; continue; }

      const daysUntil = Math.round((due.getTime() - today.getTime()) / 86400000);
      const overdue = daysUntil < 0;
      const tint = overdue ? "#fde8e8" : daysUntil <= 7 ? "#fef3e2" : "#e8f0f8";
      const edge = overdue ? "#d43030" : daysUntil <= 7 ? "#d4900a" : "#293d5c";

      const body = `
        <p style="font-size:14px;color:#5a6e84;margin:0 0 18px;">
          Hello ${esc(family.advisor_name || "")},<br><br>
          This is your ${task.reminder_days}-day reminder for an upcoming task for the
          <strong>${esc(family.name)}</strong> family.
        </p>
        <div style="background:${tint};border-left:4px solid ${edge};border-radius:8px;padding:16px 20px;margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;color:${edge};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">
            ${overdue ? "Overdue" : `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`}
          </div>
          <div style="font-size:19px;color:#092b49;font-weight:600;">${esc(task.title)}</div>
          <div style="font-size:13px;color:#5a6e84;margin-top:3px;">${esc(prettyDate(task.due_date))}</div>
        </div>
        <div style="font-size:13px;color:#5a6e84;">Priority: <strong style="color:#092b49;">${esc(task.priority)}</strong></div>
        ${appUrl ? `<a href="${esc(appUrl)}" style="display:inline-block;background:#092b49;color:#fff;padding:11px 26px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;margin-top:22px;">Open the platform →</a>` : ""}`;

      const html = shell(brand, family.name, "Task Reminder", body, overdue);
      const subject = `Reminder: "${task.title}" — ${family.name} (${overdue ? "OVERDUE" : `due in ${daysUntil} days`})`;
      let r = { ok: false, detail: "" };
      if (family.advisor_email) r = await sendEmail(family.advisor_email, subject, html, brand, from);

      // The family's own reminder, worded for them.
      for (const person of famPeople) {
        const famBody = `
        <p style="font-size:14px;color:#5a6e84;margin:0 0 18px;">
          Hello ${esc(person.full_name || "")},<br><br>
          A reminder about a task for your household.
        </p>
        <div style="background:${tint};border-left:4px solid ${edge};border-radius:8px;padding:16px 20px;margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;color:${edge};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">
            ${overdue ? "Overdue" : `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`}
          </div>
          <div style="font-size:19px;color:#092b49;font-weight:600;">${esc(task.title)}</div>
          <div style="font-size:13px;color:#5a6e84;margin-top:3px;">${esc(prettyDate(task.due_date))}</div>
        </div>
        ${appUrl ? `<a href="${esc(appUrl)}" style="display:inline-block;background:#092b49;color:#fff;padding:11px 26px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;margin-top:6px;">Open your household →</a>` : ""}`;
        const fr = await sendEmail(person.email, `Reminder: "${task.title}" (${overdue ? "overdue" : `due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`})`,
          shell(brand, family.name, "Task Reminder", famBody, overdue), brand, from);
        if (fr.ok) { summary.family.taskEmails++; r = { ok: true, detail: "" }; }
        else { summary.family.failed++; console.error("family task reminder failed", task.id, fr.detail); }
      }

      if (r.ok) {
        await sb.from("tasks").update({ reminder_sent: true }).eq("id", task.id);
        summary.tasks.sent++;
      } else {
        summary.tasks.failed++;
        console.error("task reminder failed", task.id, r.detail);
      }
    }

    // ── 2. BILL REMINDERS ────────────────────────────────────────────────
    // The SQL side decides what is due: it understands recurrence, the payment
    // log, and which occurrence was last reminded. Keeping that judgement in one
    // place means the email layer cannot disagree with the dashboard.
    const { data: bills, error: billErr } = await sb.rpc("bills_due_for_reminder");
    if (billErr) throw billErr;

    // One digest per ORDANIS Expert rather than one email per bill.
    const byExpert = new Map<string, { name: string; rows: Record<string, unknown>[] }>();
    for (const b of bills || []) {
      const to = String(b.expert_email ?? "").trim();
      if (!to) continue;
      if (!byExpert.has(to)) byExpert.set(to, { name: String(b.expert_name ?? ""), rows: [] });
      byExpert.get(to)!.rows.push(b);
    }

    for (const [expertEmail, group] of byExpert) {
      const rows = group.rows;
      const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const soonest = Math.min(...rows.map((r) => Number(r.days_until) || 0));

      const lines = rows.map((r) => {
        const d = Number(r.days_until) || 0;
        const edge = d <= 2 ? "#d43030" : d <= 5 ? "#d4900a" : "#293d5c";
        return `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #ede8de;">
            <div style="font-size:14px;color:#092b49;font-weight:600;">${esc(r.description || r.event_type)}</div>
            <div style="font-size:12px;color:#8fa0b2;margin-top:2px;">${esc(r.family_name)}${r.category ? " · " + esc(r.category) : ""} · ${esc(r.frequency)}</div>
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #ede8de;text-align:right;white-space:nowrap;">
            <div style="font-size:14px;color:#092b49;font-weight:700;">${money(r.amount)}</div>
            <div style="font-size:12px;color:${edge};font-weight:600;margin-top:2px;">
              ${d === 0 ? "Due today" : `in ${d} day${d === 1 ? "" : "s"}`} · ${esc(String(r.due_date))}
            </div>
          </td>
        </tr>`;
      }).join("");

      const body = `
        <p style="font-size:14px;color:#5a6e84;margin:0 0 18px;">
          Hello ${esc(group.name || "")},<br><br>
          ${rows.length} bill${rows.length === 1 ? "" : "s"} you are responsible for
          ${rows.length === 1 ? "is" : "are"} coming due.
        </p>
        <div style="background:#e8f0f8;border-left:4px solid #293d5c;border-radius:8px;padding:14px 18px;margin-bottom:18px;">
          <div style="font-size:11px;font-weight:700;color:#293d5c;text-transform:uppercase;letter-spacing:0.08em;">Total outstanding</div>
          <div style="font-size:22px;color:#092b49;font-weight:700;margin-top:3px;">${money(total)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;">${lines}</table>
        ${appUrl ? `<a href="${esc(appUrl)}" style="display:inline-block;background:#092b49;color:#fff;padding:11px 26px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;margin-top:22px;">Review and pay →</a>` : ""}
        <p style="font-size:11px;color:#8fa0b2;margin-top:20px;">Mark each bill paid in the platform once settled, so it drops off this list.</p>`;

      const headline = rows.length === 1
        ? String(rows[0].family_name)
        : `${rows.length} bills · ${money(total)}`;
      const html = shell(brand, headline, "Bills Due", body, soonest <= 2);
      const subject = rows.length === 1
        ? `Bill due ${soonest === 0 ? "today" : `in ${soonest} days`}: ${rows[0].description || rows[0].event_type} — ${rows[0].family_name}`
        : `${rows.length} bills due — ${money(total)} (soonest ${soonest === 0 ? "today" : `in ${soonest} days`})`;

      const r = await sendEmail(expertEmail, subject, html, brand, from);

      if (r.ok) {
        summary.bills.digests++;
        // Stamp each occurrence only after the message is accepted, so a provider
        // failure leaves the bill outstanding and it is retried tomorrow rather
        // than being silently marked as handled.
        for (const b of rows) {
          const { error } = await sb.from("cash_flow_events")
            .update({ reminder_sent_for: b.due_date }).eq("id", b.event_id);
          if (!error) summary.bills.sent++;
        }
      } else {
        summary.bills.failed += rows.length;
        console.error("bill digest failed", expertEmail, r.detail);
      }
    }

    // ── 3. FAMILY BILL REMINDERS (Basic / Core) ──────────────────────────
    // Bills the household tracks itself: one digest per household to its family recipients. The SQL decides what is
    // due (recurrence, payment log, already reminded), exactly as for the Expert digest above.
    const { data: famBills, error: famBillErr } = await sb.rpc("household_bills_due_for_reminder");
    if (famBillErr) throw famBillErr;
    const byFamily = new Map<string, Record<string, unknown>[]>();
    for (const b of famBills || []) {
      const k = String(b.family_id);
      if (!byFamily.has(k)) byFamily.set(k, []);
      byFamily.get(k)!.push(b);
    }
    for (const [familyId, rows] of byFamily) {
      const people = await familyRecipients(familyId);
      if (!people.length) continue;
      const total = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
      const soonest = Math.min(...rows.map((r) => Number(r.days_until) || 0));
      const lines = rows.map((r) => {
        const d = Number(r.days_until) || 0;
        const edge = d <= 1 ? "#d43030" : d <= 3 ? "#d4900a" : "#293d5c";
        return `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #ede8de;">
            <div style="font-size:14px;color:#092b49;font-weight:600;">${esc(r.description || r.event_type)}</div>
            <div style="font-size:12px;color:#8fa0b2;margin-top:2px;">${r.category ? esc(r.category) + " · " : ""}${esc(r.frequency)}</div>
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #ede8de;text-align:right;white-space:nowrap;">
            <div style="font-size:14px;color:#092b49;font-weight:700;">${money(r.amount)}</div>
            <div style="font-size:12px;color:${edge};font-weight:600;margin-top:2px;">${d === 0 ? "Due today" : `in ${d} day${d === 1 ? "" : "s"}`} · ${esc(String(r.due_date))}</div>
          </td>
        </tr>`;
      }).join("");
      let anyOk = false;
      for (const person of people) {
        const body = `
        <p style="font-size:14px;color:#5a6e84;margin:0 0 18px;">
          Hello ${esc(person.full_name || "")},<br><br>
          ${rows.length} household bill${rows.length === 1 ? " is" : "s are"} coming due.
        </p>
        <div style="background:#e8f0f8;border-left:4px solid #293d5c;border-radius:8px;padding:14px 18px;margin-bottom:18px;">
          <div style="font-size:11px;font-weight:700;color:#293d5c;text-transform:uppercase;letter-spacing:0.08em;">Total coming due</div>
          <div style="font-size:22px;color:#092b49;font-weight:700;margin-top:3px;">${money(total)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;">${lines}</table>
        ${appUrl ? `<a href="${esc(appUrl)}" style="display:inline-block;background:#092b49;color:#fff;padding:11px 26px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;margin-top:22px;">Open Cash Flow →</a>` : ""}
        <p style="font-size:11px;color:#8fa0b2;margin-top:20px;">Tick "I paid this" in Cash Flow once a bill is paid, so it drops off this list.</p>`;
        const subject = rows.length === 1
          ? `Bill due ${soonest === 0 ? "today" : `in ${soonest} day${soonest === 1 ? "" : "s"}`}: ${rows[0].description || rows[0].event_type}`
          : `${rows.length} bills due — ${money(total)} (soonest ${soonest === 0 ? "today" : `in ${soonest} day${soonest === 1 ? "" : "s"}`})`;
        const fr = await sendEmail(person.email, subject, shell(brand, String(rows[0].family_name), "Bills Due", body, soonest <= 1), brand, from);
        if (fr.ok) { anyOk = true; summary.family.billDigests++; }
        else { summary.family.failed++; console.error("family bill digest failed", familyId, fr.detail); }
      }
      // Stamped once someone in the household has the reminder; a failed send is retried tomorrow.
      if (anyOk) {
        for (const b of rows) await sb.from("cash_flow_events").update({ reminder_sent_for: b.due_date }).eq("id", b.event_id);
      }
    }

    return new Response(JSON.stringify({ success: true, ...summary }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-task-reminders error", err);
    return new Response(JSON.stringify({ success: false, error: String((err as Error)?.message ?? err), ...summary }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
