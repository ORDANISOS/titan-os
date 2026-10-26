// ELIOT executive assistant, Phase 2: the planner. "Plan my week" gathers the person's open work, sizes it,
// finds free time inside their work hours, and proposes calendar blocks as ONE draft (eliot_ea_drafts kind
// 'plan'). Nothing reaches Outlook until they confirm; the confirm books exactly the stored blocks.
//
// Work it plans (Will chose all four, 2026-10-26):
//   1. their ELIOT team tasks (eliot_team_tasks, owner = them)
//   2. tasks in their households (families.advisor_email = them, plus households with no Expert yet)
//   3. bills the firm pays and deadlines (insurance, loans, deal closes, birthdays) in those households
//   4. workflow steps waiting on review in those households
// Free time = work hours minus meetings, minus open-for-calls blocks, minus the next 15 minutes, with a
// 5-minute gap after meetings, and at most max_task_minutes of task time a day.
//
// Household names and task titles come from the platform (data, not instructions). Block titles go on the
// person's own calendar only; nothing here invites anyone.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { buildDesk, type DeskItem } from "./coverage.ts";
import { readEvents, isMeeting, etNow, etWallToUtc, addDaysTo, timeLabel, accessToken, type EaProfile, type CalEvent } from "./calendar.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const BUFFER = 5, MIN_SLOT = 15;

export type WorkItem = { key: string; source: "team" | "task" | "bill" | "deadline" | "workflow"; title: string; household: string | null;
  due: string | null; minutes: number; priority: number };
export type Block = { key: string; title: string; household: string | null; source: WorkItem["source"]; start: string; end: string; due: string | null; late: boolean };

const minutesFor = (priority: string | null | undefined) => (priority === "high" ? 60 : priority === "low" ? 15 : 30);
const prioRank = (p: string | null | undefined) => (p === "high" ? 2 : p === "low" ? 0 : 1);
const SOURCE_LABEL: Record<WorkItem["source"], string> = { team: "Task", task: "Client task", bill: "Bill", deadline: "Deadline", workflow: "Workflow" };

// Everything the person should make time for: overdue plus the next `days` days.
export async function gatherWork(admin: SupabaseClient, db: SupabaseClient, user: { id: string; email: string; name: string | null }, days: number) {
  const today = etNow().date;
  const until = addDaysTo(today, days);
  const items: WorkItem[] = [];
  const errors: string[] = [];

  // 1. ELIOT team tasks (service role: the table has no browser write path; reads are this person's only).
  const { data: team, error: teamErr } = await admin.from("eliot_team_tasks").select("id,title,family_id,due_date,priority")
    .eq("owner_id", user.id).eq("done", false).limit(200);
  if (teamErr) errors.push("team tasks");
  const famIds = [...new Set((team ?? []).map((t) => t.family_id).filter(Boolean))];
  const { data: fams } = famIds.length ? await admin.from("families").select("id,name").in("id", famIds) : { data: [] };
  const famName = (id: unknown) => clean((fams ?? []).find((f) => f.id === id)?.name, 80).replace(/ \[DEMO\]$/, "") || null;
  for (const t of team ?? []) {
    const due = t.due_date ? String(t.due_date).slice(0, 10) : null;
    if (due && due > until) continue;
    if (!due && t.priority !== "high") continue; // undated tasks only when marked high priority
    items.push({ key: `team:${t.id}`, source: "team", title: clean(t.title, 140), household: famName(t.family_id), due, minutes: minutesFor(t.priority), priority: prioRank(t.priority) });
  }

  // 2-4. Their households' desk (as the person, so access rules apply).
  try {
    const r = await buildDesk(db, { full_name: user.name, email: user.email }, days, async () => ({ emails: [] }), { unassigned: true });
    const d = r.desk;
    if (d) {
      const keyOf = (src: string, i: DeskItem) => `${src}:${(i.household ?? "").toLowerCase()}:${i.title.toLowerCase()}:${i.date ?? ""}`.slice(0, 400);
      for (const i of d.tasks) items.push({ key: keyOf("task", i), source: "task", title: i.title, household: i.household, due: i.date, minutes: /high/.test(i.detail ?? "") ? 60 : /low/.test(i.detail ?? "") ? 15 : 30, priority: /high/.test(i.detail ?? "") ? 2 : 1 });
      for (const i of d.review) items.push({ key: keyOf("workflow", i), source: "workflow", title: i.title, household: i.household, due: i.date ?? today, minutes: 30, priority: 2 });
      for (const i of d.bills) items.push({ key: keyOf("bill", i), source: "bill", title: i.title, household: i.household, due: i.date, minutes: 15, priority: 1 });
      for (const i of d.deadlines) items.push({ key: keyOf("deadline", i), source: "deadline", title: i.title, household: i.household, due: i.date, minutes: /birthday|anniversary/i.test(i.title) ? 15 : 30, priority: 1 });
    }
  } catch (e) {
    console.error("planner desk failed", e);
    errors.push("household work");
  }

  // Leave out work that already has calendar time from an earlier plan. Once planned, it stays planned.
  const { data: planned } = await admin.from("eliot_ea_planned").select("item_key").eq("user_id", user.id).limit(2000);
  const done = new Set((planned ?? []).map((p) => p.item_key));
  return { items: items.filter((i) => !done.has(i.key)), alreadyPlanned: items.filter((i) => done.has(i.key)).length, errors };
}

type Span = { s: number; e: number }; // epoch ms

// Free time per work day: work hours minus meetings (+ buffer), open-for-calls blocks and anything before now + 15 min.
export function freeTime(events: CalEvent[], profile: EaProfile & Record<string, unknown>, from: string, days: number) {
  const workDays: number[] = Array.isArray(profile.work_days) ? profile.work_days as number[] : [1, 2, 3, 4, 5];
  const ws = String(profile.work_start ?? "09:00"), we = String(profile.work_end ?? "17:00");
  const earliest = Date.now() + 15 * 60_000;
  const busy: Span[] = events.filter((e) => isMeeting(e) || (e.all_day && !e.ignored && e.show_as === "oof"))
    .map((e) => e.all_day ? { s: Date.parse(etWallToUtc(`${e.date}T00:00`)!), e: Date.parse(etWallToUtc(`${addDaysTo(e.end_date, 1)}T00:00`)!) }
      : { s: Date.parse(e.start!), e: Date.parse(e.end ?? e.start!) + BUFFER * 60_000 });
  const out: Array<{ date: string; spans: Span[] }> = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysTo(from, i);
    const iso = etNow(new Date(`${date}T17:00:00Z`)).weekday;
    if (!workDays.includes(iso)) continue;
    const dayBusy = [...busy];
    for (const b of (profile.bookable_blocks ?? []).filter((b) => b.day === iso)) {
      dayBusy.push({ s: Date.parse(etWallToUtc(`${date}T${b.start}`)!), e: Date.parse(etWallToUtc(`${date}T${b.end}`)!) });
    }
    let spans: Span[] = [{ s: Math.max(Date.parse(etWallToUtc(`${date}T${ws}`)!), earliest), e: Date.parse(etWallToUtc(`${date}T${we}`)!) }];
    for (const b of dayBusy.sort((a, b) => a.s - b.s)) {
      spans = spans.flatMap((sp) => (b.e <= sp.s || b.s >= sp.e ? [sp] : [{ s: sp.s, e: b.s }, { s: b.e, e: sp.e }]).filter((x) => x.e - x.s >= MIN_SLOT * 60_000));
    }
    // Start blocks on a quarter hour.
    spans = spans.map((sp) => ({ s: Math.ceil(sp.s / 900_000) * 900_000, e: sp.e })).filter((x) => x.e - x.s >= MIN_SLOT * 60_000);
    if (spans.length) out.push({ date, spans });
  }
  return out;
}

// Earliest deadline first, then priority; each item goes in the earliest slot that fits on or before its due day
// (bills the working day before), else the earliest slot after (marked late), within the daily task-time cap.
export function schedule(items: WorkItem[], days: ReturnType<typeof freeTime>, capMinutes: number) {
  const used: Record<string, number> = {};
  const blocks: Block[] = [];
  const unplaced: WorkItem[] = [];
  const order = [...items].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.priority - a.priority);
  for (const it of order) {
    const need = it.minutes * 60_000;
    const target = it.due ? (it.source === "bill" ? addDaysTo(it.due, -1) : it.due) : null;
    const tryDays = (pred: (d: string) => boolean) => {
      for (const day of days) {
        if (!pred(day.date) || (used[day.date] ?? 0) + it.minutes > capMinutes) continue;
        const span = day.spans.find((sp) => sp.e - sp.s >= need);
        if (!span) continue;
        const start = span.s;
        span.s += need;
        used[day.date] = (used[day.date] ?? 0) + it.minutes;
        return { start, end: start + need, date: day.date };
      }
      return null;
    };
    const hit = (target ? tryDays((d) => d <= target) : null) ?? tryDays(() => true);
    if (!hit) { unplaced.push(it); continue; }
    blocks.push({ key: it.key, title: it.title, household: it.household, source: it.source, start: new Date(hit.start).toISOString(), end: new Date(hit.end).toISOString(),
      due: it.due, late: !!(it.due && hit.date > it.due) });
  }
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  return { blocks, unplaced };
}

const subjectFor = (b: Pick<Block, "title" | "household" | "source">) => clean(`${SOURCE_LABEL[b.source]}: ${b.title}${b.household ? ` (${b.household})` : ""}`, 200);
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });

// Builds the plan and stores it as a draft. Returns what the card and the model need.
export async function draftPlan(admin: SupabaseClient, db: SupabaseClient, user: { id: string; email: string; name: string | null }, profile: EaProfile & Record<string, unknown>, input: Record<string, unknown>) {
  const days = Math.min(10, Math.max(1, Math.round(Number(input.days) || 7)));
  const work = await gatherWork(admin, db, user, days);
  if (!work.items.length) {
    return { message: `There's no open work to plan in the next ${days} days${work.alreadyPlanned ? ` (${work.alreadyPlanned} item${work.alreadyPlanned === 1 ? " already has" : "s already have"} calendar time)` : ""}${work.errors.length ? `. These couldn't be checked: ${work.errors.join(", ")}` : ""}. Say so.` };
  }
  const from = etNow().date;
  const ev = await readEvents(admin, user.id, from, days);
  if (!ev.events) return { message: "The calendar couldn't be read just now, so there's no plan. Say so and suggest trying again." };
  const free = freeTime(ev.events, profile, from, days);
  const { blocks, unplaced } = schedule(work.items, free, Number(profile.max_task_minutes) || 240);
  if (!blocks.length) return { message: `There's no free time in your work hours for the next ${days} days to fit ${work.items.length} item${work.items.length === 1 ? "" : "s"}. Say so and suggest freeing an afternoon or widening work hours in Calendar settings.` };
  const minutes = blocks.reduce((t, b) => t + (Date.parse(b.end) - Date.parse(b.start)) / 60_000, 0);
  const summary = {
    title: "Plan", count: blocks.length, minutes, days, late: blocks.filter((b) => b.late).length,
    blocks: blocks.map((b) => ({ ...b, subject: subjectFor(b), day: dayLabel(b.start), from: timeLabel(b.start), to: timeLabel(b.end) })),
    unplaced: unplaced.slice(0, 20).map((u) => ({ title: u.title, household: u.household, due: u.due })), errors: work.errors,
  };
  await admin.from("eliot_ea_drafts").update({ status: "discarded" }).eq("user_id", user.id).eq("status", "pending");
  const { data, error } = await admin.from("eliot_ea_drafts").insert({ user_id: user.id, kind: "plan", payload: { blocks }, summary, expires_at: new Date(Date.now() + 30 * 60_000).toISOString() }).select("id,expires_at").maybeSingle();
  if (error || !data) return { message: "Couldn't put the plan on screen. Say it again." };
  const perDay = Object.entries(blocks.reduce((m, b) => { const d = dayLabel(b.start); m[d] = (m[d] ?? 0) + 1; return m; }, {} as Record<string, number>)).map(([d, n]) => `${d}: ${n}`).join(", ");
  return {
    draft: { id: data.id, kind: "plan", ...summary, expires_at: data.expires_at },
    message: `Plan on screen, NOT booked: ${blocks.length} block${blocks.length === 1 ? "" : "s"}, about ${Math.round(minutes / 6) / 10} hours (${perDay}).${summary.late ? ` ${summary.late} land after their due date.` : ""}${unplaced.length ? ` ${unplaced.length} item${unplaced.length === 1 ? "" : "s"} didn't fit.` : ""}${work.errors.length ? ` Not checked: ${work.errors.join(", ")}.` : ""} Summarize in one or two sentences (the most urgent item and when it's scheduled) and ask "Book them?". They can untick blocks on the card first.`,
  };
}

// Books a confirmed plan: one Outlook event per block (busy, category "ELIOT", no invitees), skipping any the
// person unticked. Records each booked item so the next plan doesn't repeat it.
export async function bookPlan(admin: SupabaseClient, userId: string, draft: { id: string; payload: Record<string, unknown> }, skip: number[]) {
  const tok = await accessToken(admin, userId);
  if (!tok.token) return { ok: false, message: tok.error === "reconnect" ? "Outlook needs to be connected again." : "Couldn't reach Outlook just now.", booked: 0 };
  const blocks = (Array.isArray(draft.payload.blocks) ? draft.payload.blocks : []) as Block[];
  const skipSet = new Set(skip.filter((n) => Number.isInteger(n)));
  let booked = 0, failed = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (skipSet.has(i)) continue;
    const b = blocks[i];
    const res = await fetch(`${GRAPH}/me/events`, {
      method: "POST", headers: { Authorization: `Bearer ${tok.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: subjectFor(b), start: { dateTime: b.start.replace(/\.\d+Z$/, "").replace(/Z$/, ""), timeZone: "UTC" }, end: { dateTime: b.end.replace(/\.\d+Z$/, "").replace(/Z$/, ""), timeZone: "UTC" },
        showAs: "busy", categories: ["ELIOT"], isReminderOn: true, reminderMinutesBeforeStart: 5,
        body: { contentType: "text", content: `Time set aside by ELIOT${b.household ? ` for ${b.household}` : ""}${b.due ? `. Due ${b.due}.` : "."}` },
        transactionId: `${draft.id}-${i}`,
      }),
    });
    if (!res.ok) { failed++; console.error("plan block failed", res.status); continue; }
    const ev = await res.json().catch(() => ({})) as Record<string, unknown>;
    booked++;
    await admin.from("eliot_ea_planned").upsert({ user_id: userId, item_key: b.key, event_id: clean(ev.id, 400) || null, starts_at: b.start });
  }
  const ok = booked > 0 && failed === 0;
  return { ok: booked > 0, booked, message: booked === 0 ? "Outlook didn't accept the blocks. Nothing was booked." : `Booked ${booked} block${booked === 1 ? "" : "s"} on your calendar${failed ? `; ${failed} didn't go through` : ""}.`, partial: !ok };
}
