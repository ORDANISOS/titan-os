// Expert coverage ("what's on Maria's desk?"): when an ORDANIS Expert is out, an administrator asks
// ELIOT for that Expert's desk and gets the same picture the Expert's own portal dashboard shows,
// limited to what needs doing: overdue items plus the next N days (default 14).
//
// Built here, not by the model: the app draws the sheet from this data directly, so nothing is
// retyped, dropped or invented. The model only gets the counts and the top few items to speak.
//
// Read-only. Every query runs as the signed-in administrator (their JWT), so access rules apply.
// The portal logic mirrored here (src/App.jsx): Dashboard scope by families.advisor_email,
// ReviewQueue, collectBills + nextBillDue, collectDeadlines.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

const CAP = 50;
const BILL_LOOKBACK_DAYS = 90;
const BILL_REGISTER_FREQS = ["monthly", "quarterly", "annually"];
const REVIEW_STATUSES = ["ready", "awaiting_approval", "approved", "blocked"];
const KIND: Record<string, string> = {
  extract: "Read a document", check: "Verify / sanity-check", draft_document: "Draft a document",
  draft_email: "Draft an email", draft_letter: "Draft a letter", confirm: "Confirm something happened", file: "File / record",
};
const STATUS: Record<string, string> = { awaiting_approval: "Needs approval", ready: "Ready", approved: "Approved, not sent", blocked: "Blocked" };

const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

// Dates are plain YYYY-MM-DD in Eastern time (the team's day), compared at noon UTC.
export const easternToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const d12 = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (s: string, n: number) => { const d = d12(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const daysBetween = (from: string, to: string) => Math.round((d12(to).getTime() - d12(from).getTime()) / 86_400_000);
const validIso = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(d12(s).getTime());

// Same rule as nextBillDue in src/App.jsx: month-based bills re-anchor on the original day of month.
function nextBillDue(startDate: string | null, frequency: string | null, endDate: string | null, fromIso: string): string | null {
  if (!validIso(startDate)) return null;
  const freq = String(frequency || "once").toLowerCase();
  const start = d12(startDate!);
  const from = d12(fromIso);
  const end = validIso(endDate) ? d12(endDate!) : null;
  const done = (d: Date) => (end && d > end ? null : iso(d));
  if (["once", "one-time", "onetime", ""].includes(freq)) return start >= from ? done(start) : null;
  const months = ({ monthly: 1, quarterly: 3, semiannually: 6, "semi-annually": 6, annually: 12, yearly: 12 } as Record<string, number>)[freq];
  if (months) {
    const anchor = start.getUTCDate();
    let n = Math.max(0, Math.floor(((from.getUTCFullYear() - start.getUTCFullYear()) * 12 + (from.getUTCMonth() - start.getUTCMonth())) / months) - 1);
    for (let guard = 0; guard < 2000; guard++) {
      const y = start.getUTCFullYear(), m = start.getUTCMonth() + months * n;
      const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const cand = new Date(Date.UTC(y, m, Math.min(anchor, dim), 12));
      if (cand >= from) return done(cand);
      n++;
    }
    return null;
  }
  const weeks = ({ weekly: 7, biweekly: 14 } as Record<string, number>)[freq];
  if (!weeks) return null;
  let d = new Date(start);
  if (d < from) {
    const steps = Math.max(0, Math.floor((from.getTime() - d.getTime()) / (weeks * 86_400_000)) - 1);
    d = new Date(d.getTime() + steps * weeks * 86_400_000);
    let guard = 0;
    while (d < from && guard++ < 5000) d = new Date(d.getTime() + weeks * 86_400_000);
  }
  return done(d);
}

export type DeskItem = { date: string | null; days: number | null; title: string; household: string | null; detail?: string; amount?: number };
export type DeskEmail = { received_at: string; from: string; subject: string; status: string; household: string | null; flagged: boolean };
export type EmailLookup = (expertEmail: string) => Promise<{ emails: DeskEmail[]; note?: string }>;

export type Desk = {
  kind: "expert_desk";
  expert: string;
  as_of: string;
  window_days: number;
  stats: { households: number; overdue: number; due_today: number; awaiting_review: number; tasks: number; bills: number; bills_total: number; deadlines: number; open_emails: number | null };
  review: DeskItem[];
  tasks: DeskItem[];
  bills: DeskItem[];
  deadlines: DeskItem[];
  emails: DeskEmail[];
  email_note?: string;
  notes: DeskItem[];
  households: Array<{ name: string; plan: string | null; portfolio: number }>;
  truncated: string[];
};

type Person = { full_name: string | null; email: string; role: string };

// Find the Expert by (part of) their name or email. ORDANIS Experts first; an admin who leads
// households counts too.
async function findExpert(db: SupabaseClient, who: string): Promise<{ person?: Person; options?: string[]; error?: string }> {
  const q = txt(who, 80).replace(/^(the\s+)?(ordanis\s+)?expert\s+/i, "");
  if (q.length < 2) return { error: "Say which Expert." };
  const like = `%${likeEscape(q)}%`;
  const { data, error } = await db.from("user_profiles").select("full_name,email,role,active")
    .in("role", ["advisor", "admin"]).or(`full_name.ilike.${like},email.ilike.${like}`).limit(20);
  if (error) throw error;
  const people = (data ?? []).filter((p) => p.active !== false && p.email) as Person[];
  // Admins only count if they actually lead households.
  const leads = async (p: Person) => {
    if (p.role === "advisor") return true;
    const { count } = await db.from("families").select("id", { count: "exact", head: true }).ilike("advisor_email", likeEscape(p.email)).is("archived_at", null);
    return (count ?? 0) > 0;
  };
  const found: Person[] = [];
  for (const p of people) if (await leads(p)) found.push(p);
  // One distinct person (the same email can appear twice after a role change).
  const byEmail = new Map(found.map((p) => [p.email.toLowerCase(), p]));
  if (byEmail.size === 1) return { person: [...byEmail.values()][0] };
  if (byEmail.size > 1) {
    const exact = [...byEmail.values()].filter((p) => txt(p.full_name, 80).toLowerCase() === q.toLowerCase());
    if (exact.length === 1) return { person: exact[0] };
    return { options: [...byEmail.values()].map((p) => txt(p.full_name, 60) || "an Expert with no name on file") };
  }
  const { data: all } = await db.from("user_profiles").select("full_name,active").eq("role", "advisor").limit(50);
  return { error: "No ORDANIS Expert by that name.", options: (all ?? []).filter((p) => p.active !== false).map((p) => txt(p.full_name, 60)).filter(Boolean) };
}

export async function expertDesk(db: SupabaseClient, input: Record<string, unknown>, emailLookup: EmailLookup):
  Promise<{ desk?: Desk; error?: string; options?: string[] }> {
  const found = await findExpert(db, String(input.expert ?? ""));
  if (!found.person) return { error: found.error ?? "Several Experts match. Ask which one.", options: found.options };
  return buildDesk(db, found.person, Math.min(60, Math.max(1, Math.floor(Number(input.days) || 14))), emailLookup);
}

// One person's desk by email. unassigned: also households with no Expert yet (the planner treats those as
// the owner's). Exported for the executive assistant's planner.
export async function buildDesk(db: SupabaseClient, expert: { full_name: string | null; email: string }, windowDays: number,
  emailLookup: EmailLookup, opts: { unassigned?: boolean } = {}): Promise<{ desk?: Desk; error?: string; options?: string[] }> {
  const email = expert.email.toLowerCase();
  const today = easternToday();
  const until = plusDays(today, windowDays);
  const truncated: string[] = [];

  let famQ = db.from("families").select("id,name,plan").is("archived_at", null);
  famQ = opts.unassigned ? famQ.or(`advisor_email.ilike.${likeEscape(email)},advisor_email.is.null,advisor_email.eq.""`) : famQ.ilike("advisor_email", likeEscape(email));
  const { data: fams, error: famErr } = await famQ.order("name").limit(500);
  if (famErr) throw famErr;
  const famIds = (fams ?? []).map((f) => f.id as string);
  const famName = (id: unknown) => txt((fams ?? []).find((f) => f.id === id)?.name, 80).replace(/ \[DEMO\]$/, "") || null;
  const ids = famIds.length ? famIds : ["00000000-0000-0000-0000-000000000000"];

  const [steps, tasks, events, payLog, props, accts, deals, contacts, acks, notes, mail] = await Promise.all([
    db.from("workflow_instance_steps").select("family_id,title,kind,status,due_on,recipient").in("family_id", ids).in("status", REVIEW_STATUSES).order("due_on").limit(200),
    db.from("tasks").select("family_id,title,due_date,priority").in("family_id", ids).eq("done", false).not("due_date", "is", null).lte("due_date", until).order("due_date").limit(500),
    db.from("cash_flow_events").select("id,family_id,description,event_type,amount,frequency,start_date,end_date,paid,category,direction,pcm_responsible")
      .in("family_id", ids).eq("direction", "expense").eq("pcm_responsible", true).limit(1000),
    db.from("cash_flow_payment_log").select("event_id,period,paid").in("family_id", ids).eq("paid", true).limit(5000),
    db.from("properties").select("id,family_id,address,name,current_value,purchase_price,loan_maturity_date,insurance_expiration,flood_insurance_expiration").in("family_id", ids).limit(1000),
    db.from("portfolio_accounts").select("family_id,account_type,current_balance").in("family_id", ids).limit(2000),
    db.from("deals").select("id,family_id,title,stage,close_date,advisor_email").or(`family_id.in.(${ids.join(",")}),advisor_email.ilike.${likeEscape(email)}`).limit(500),
    db.from("contacts").select("id,family_id,name,dob,anniversary,advisor_email").or(`family_id.in.(${ids.join(",")}),advisor_email.ilike.${likeEscape(email)}`).limit(2000),
    db.from("deadline_acks").select("item_key").in("family_id", ids).limit(5000),
    db.from("notes").select("family_id,body,created_at").in("family_id", ids).order("created_at", { ascending: false }).limit(5),
    emailLookup(email).catch(() => ({ emails: [] as DeskEmail[], note: "The email portal couldn't be reached." })),
  ]);
  for (const r of [steps, tasks, events, payLog, props, accts, deals, contacts, acks, notes]) if (r.error) throw r.error;

  const item = (date: string | null, title: string, familyId: unknown, extra: Partial<DeskItem> = {}): DeskItem =>
    ({ date, days: date ? daysBetween(today, date) : null, title: txt(title, 140), household: famName(familyId), ...extra });
  const capped = (key: string, list: DeskItem[]) => { if (list.length > CAP) truncated.push(key); return list.slice(0, CAP); };

  // 1. Awaiting review: every open workflow step, whatever its date (it is waiting on a person now).
  const review = (steps.data ?? []).map((s) => item(s.due_on, s.title || "Workflow step", s.family_id,
    { detail: [KIND[s.kind] ?? txt(s.kind, 40), STATUS[s.status] ?? txt(s.status, 30), s.recipient ? `to ${txt(s.recipient, 40)}` : ""].filter(Boolean).join(" · ") }));

  // 2. Tasks: overdue + due in the window.
  const taskItems = (tasks.data ?? []).map((t) => item(String(t.due_date).slice(0, 10), t.title || "Task", t.family_id, { detail: t.priority && t.priority !== "normal" ? `${txt(t.priority, 20)} priority` : undefined }));

  // 3. Bills the firm pays: unpaid occurrences from the last 90 days (overdue) through the window.
  const paid = new Set((payLog.data ?? []).map((l) => `${l.event_id}|${String(l.period ?? "").slice(0, 10)}`));
  const bills: DeskItem[] = [];
  for (const e of events.data ?? []) {
    const freq = String(e.frequency || "once").toLowerCase();
    const oneOff = ["once", "one-time", "onetime", ""].includes(freq);
    const register = BILL_REGISTER_FREQS.includes(freq);
    let cursor = plusDays(today, -BILL_LOOKBACK_DAYS);
    for (let guard = 0; guard < 120; guard++) {
      const due = nextBillDue(e.start_date, e.frequency, e.end_date, cursor);
      if (!due) break;
      const days = daysBetween(today, due);
      if (days > windowDays) break;
      const settled = register ? paid.has(`${e.id}|${due.slice(0, 7)}-01`) : !!e.paid;
      const pastWithoutRecord = !register && !oneOff && days < 0;
      if (!settled && !pastWithoutRecord) {
        bills.push(item(due, e.description || e.event_type || "Bill", e.family_id, { amount: Number(e.amount) || 0, detail: [txt(e.category, 40), txt(e.frequency, 20)].filter(Boolean).join(" · ") || undefined }));
      }
      if (oneOff) break;
      cursor = plusDays(due, 1);
    }
  }
  bills.sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  // 4. Deadlines (not tasks; those are above): loans, insurance, deal closes, birthdays, anniversaries.
  // Anything already marked handled in the portal is left out.
  const handled = new Set((acks.data ?? []).map((a) => a.item_key));
  const deadlines: DeskItem[] = [];
  const once = (date: unknown, title: string, type: string, familyId: unknown, id: string) => {
    if (!validIso(date)) return;
    const d = String(date).slice(0, 10);
    if (d > until || handled.has(`${type}:${id}:${d}`)) return;
    deadlines.push(item(d, title, familyId));
  };
  const annual = (date: unknown, title: string, type: string, familyId: unknown, id: string) => {
    if (!validIso(date)) return;
    const md = String(date).slice(5, 10);
    let next = `${today.slice(0, 4)}-${md}`;
    if (!validIso(next) || next < today) next = `${Number(today.slice(0, 4)) + 1}-${md}`;
    if (!validIso(next) || next > until || handled.has(`${type}:${id}:${next}`)) return;
    deadlines.push(item(next, title, familyId));
  };
  for (const p of props.data ?? []) {
    const addr = txt(p.address || p.name, 80) || "property";
    once(p.loan_maturity_date, `Loan matures: ${addr}`, "loan", p.family_id, p.id);
    once(p.insurance_expiration, `Insurance renews: ${addr}`, "insurance", p.family_id, p.id);
    once(p.flood_insurance_expiration, `Flood insurance renews: ${addr}`, "flood", p.family_id, p.id);
  }
  for (const d of deals.data ?? []) if (d.stage !== "Closed Won" && d.stage !== "Closed Lost") once(d.close_date, `Deal closes: ${txt(d.title, 80) || "deal"}`, "deal", d.family_id, d.id);
  for (const c of contacts.data ?? []) {
    annual(c.dob, `${txt(c.name, 60) || "Client"}: birthday`, "birthday", c.family_id, c.id);
    annual(c.anniversary, `${txt(c.name, 60) || "Client"}: anniversary`, "anniversary", c.family_id, c.id);
  }
  deadlines.sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  // 5. Households with their combined value (real estate + accounts, lines of credit excluded), like "Portfolio by Family".
  const value: Record<string, number> = {};
  for (const p of props.data ?? []) value[p.family_id] = (value[p.family_id] ?? 0) + (Number(p.current_value) || Number(p.purchase_price) || 0);
  for (const a of accts.data ?? []) if (a.account_type !== "Line of Credit") value[a.family_id] = (value[a.family_id] ?? 0) + (Number(a.current_balance) || 0);
  const households = (fams ?? []).map((f) => ({ name: famName(f.id) ?? "", plan: f.plan ?? null, portfolio: Math.round(value[f.id as string] ?? 0) }));

  const recent = (notes.data ?? []).map((n) => item(String(n.created_at).slice(0, 10), txt(n.body, 240), n.family_id));
  const all = [...review, ...taskItems, ...bills, ...deadlines];
  const emails = mail.emails.slice(0, CAP);
  if (mail.emails.length > CAP) truncated.push("emails");

  return {
    desk: {
      kind: "expert_desk",
      expert: txt(expert.full_name, 80) || "this Expert",
      as_of: today,
      window_days: windowDays,
      stats: {
        households: households.length,
        overdue: all.filter((i) => i.days !== null && i.days < 0).length,
        due_today: all.filter((i) => i.days === 0).length,
        awaiting_review: review.length,
        tasks: taskItems.length,
        bills: bills.length,
        bills_total: Math.round(bills.reduce((s, b) => s + (b.amount ?? 0), 0)),
        deadlines: deadlines.length,
        open_emails: mail.note ? null : mail.emails.length,
      },
      review: capped("review", review),
      tasks: capped("tasks", taskItems),
      bills: capped("bills", bills),
      deadlines: capped("deadlines", deadlines),
      emails,
      email_note: mail.note,
      notes: recent,
      households,
      truncated,
    },
  };
}

// What the model sees: counts and the five most urgent items, enough to speak one or two sentences.
export function deskForModel(d: Desk) {
  const urgent = [...d.review, ...d.tasks, ...d.bills, ...d.deadlines]
    .filter((i) => i.days !== null && i.days <= 0).sort((a, b) => (a.days ?? 0) - (b.days ?? 0)).slice(0, 5)
    .map((i) => ({ item: i.title, household: i.household, date: i.date, overdue_days: i.days !== null && i.days < 0 ? -i.days : 0 }));
  return {
    shown_on_screen: true,
    expert: d.expert,
    window: `overdue plus the next ${d.window_days} days`,
    counts: d.stats,
    most_urgent: urgent,
    email_note: d.email_note ?? null,
  };
}
