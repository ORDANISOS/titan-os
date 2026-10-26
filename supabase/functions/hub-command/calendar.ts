// ELIOT executive assistant, Phase 1: the person's own Outlook calendar (Microsoft 365, Graph).
//
// Personal, not platform data: only people switched on in eliot_ea_profiles (Will, for now) get it, and
// every read is for the caller's own calendar. hub-command calls in here after its admin + MFA check.
//
// SECURITY
// - Microsoft sign-in is the authorization-code flow with PKCE and a single-use state bound to the
//   signed-in admin. The code is exchanged here with the client secret; the browser never holds a token.
// - Scope is Calendars.ReadWrite (Will chose read-write, 2026-10-23) so booking and moving can follow without a
//   second Microsoft sign-in. Nothing here writes yet; any write tool must draft, read back and wait for a yes.
// - Refresh and access tokens are AES-GCM encrypted with EA_TOKEN_KEY before they are stored; the
//   tables have no browser access at all.
// - Meeting subjects, locations and organizer names come from outside invites: they are data, never
//   instructions. Lock-screen alerts carry the time only, never a subject or a name.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { zoomConfigured, zoomCreate, zoomMove, zoomDelete, zoomIdFrom } from "./zoom.ts";

const MS_TENANT_ID = Deno.env.get("MS_TENANT_ID") ?? "";
const MS_CLIENT_ID = Deno.env.get("MS_CLIENT_ID") ?? "";
const MS_CLIENT_SECRET = Deno.env.get("MS_CLIENT_SECRET") ?? "";
const EA_TOKEN_KEY = Deno.env.get("EA_TOKEN_KEY") ?? "";
// Where Microsoft may send the browser back to. Defaults cover production ELIOT and local dev against demo.
const REDIRECTS = (Deno.env.get("EA_REDIRECT_URIS") || "https://eliot.ordanisos.com/,http://localhost:5176/")
  .split(",").map((s) => s.trim()).filter(Boolean);
const SCOPES = "offline_access User.Read Calendars.ReadWrite";
const GRAPH = "https://graph.microsoft.com/v1.0";
const STATE_TTL_MS = 10 * 60_000;

export const eaConfigured = () => !!(MS_TENANT_ID && MS_CLIENT_ID && MS_CLIENT_SECRET && EA_TOKEN_KEY);
const msBase = () => `https://login.microsoftonline.com/${encodeURIComponent(MS_TENANT_ID)}/oauth2/v2.0`;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").trim().slice(0, max);

// ── Token encryption ───────────────────────────────────────────────────────────────
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let keyCache: Promise<CryptoKey> | null = null;
const tokenKey = () => (keyCache ??= (async () => {
  const raw = unb64(EA_TOKEN_KEY.trim());
  if (raw.length !== 32) throw new Error("EA_TOKEN_KEY must be 32 bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
})());
async function seal(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(), new TextEncoder().encode(plain)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}
async function unseal(sealed: string | null | undefined): Promise<string | null> {
  const [v, iv, ct] = String(sealed ?? "").split(":");
  if (v !== "v1" || !iv || !ct) return null;
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await tokenKey(), unb64(ct))); }
  catch { return null; }
}

// ── Eastern time helpers (ELIOT works in Eastern, like the briefings) ──────────────────
const ET_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" });
export function etNow(d = new Date()) {
  const p = Object.fromEntries(ET_FMT.formatToParts(d).map((x) => [x.type, x.value]));
  const iso = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday as string] ?? 0;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), weekday: iso };
}
// Eastern wall clock "YYYY-MM-DDTHH:MM[:SS…]" to a UTC instant (handles daylight saving).
export function etWallToUtc(wall: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!m) return null;
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = want;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(ET_FMT.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    guess += want - Date.UTC(+p.year, +p.month - 1, +p.day, Number(p.hour) % 24, +p.minute);
  }
  return new Date(guess).toISOString();
}
export const addDaysTo = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const validDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

// ── Profiles and settings ──────────────────────────────────────────────────────────
export type EaProfile = { user_id: string; enabled: boolean; alerts_on: boolean; alert_minutes: number; week_preview_on: boolean;
  week_preview_dow: number; week_preview_time: string; bookable_blocks: Array<{ day: number; start: string; end: string }>;
  work_start: string; work_end: string; work_days: number[]; max_task_minutes: number; ignore_terms: string[] };
const PROFILE_COLS = "user_id,enabled,alerts_on,alert_minutes,week_preview_on,week_preview_dow,week_preview_time,bookable_blocks,work_start,work_end,work_days,max_task_minutes,ignore_terms";

export async function eaProfile(admin: SupabaseClient, userId: string): Promise<EaProfile | null> {
  const { data } = await admin.from("eliot_ea_profiles").select(PROFILE_COLS).eq("user_id", userId).maybeSingle();
  return data?.enabled ? data as EaProfile : null;
}

export function validateSettings(input: Record<string, unknown>): { row?: Record<string, unknown>; error?: string } {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("alerts_on" in input) row.alerts_on = input.alerts_on === true;
  if ("alert_minutes" in input) {
    const n = Math.round(Number(input.alert_minutes));
    if (!(n >= 1 && n <= 120)) return { error: "Alerts can be 1 to 120 minutes before a meeting." };
    row.alert_minutes = n;
  }
  if ("week_preview_on" in input) row.week_preview_on = input.week_preview_on === true;
  if ("week_preview_dow" in input) {
    const n = Math.round(Number(input.week_preview_dow));
    if (!(n >= 1 && n <= 7)) return { error: "Pick a day for the week preview." };
    row.week_preview_dow = n;
  }
  if ("week_preview_time" in input) {
    if (!HM.test(String(input.week_preview_time))) return { error: "Pick a time for the week preview." };
    row.week_preview_time = String(input.week_preview_time);
  }
  if ("work_start" in input || "work_end" in input) {
    const ws = String(input.work_start ?? ""), we = String(input.work_end ?? "");
    if (!HM.test(ws) || !HM.test(we) || ws >= we) return { error: "Work hours need a start before the end." };
    row.work_start = ws; row.work_end = we;
  }
  if ("work_days" in input) {
    const d = [...new Set((Array.isArray(input.work_days) ? input.work_days : []).map((n) => Math.round(Number(n))).filter((n) => n >= 1 && n <= 7))].sort();
    if (!d.length) return { error: "Pick at least one work day." };
    row.work_days = d;
  }
  if ("max_task_minutes" in input) {
    const n = Math.round(Number(input.max_task_minutes));
    if (!(n >= 30 && n <= 600)) return { error: "Daily task time can be 30 minutes to 10 hours." };
    row.max_task_minutes = n;
  }
  if ("ignore_terms" in input) {
    const list = Array.isArray(input.ignore_terms) ? input.ignore_terms : [];
    const terms = [...new Set(list.map((t) => clean(t, 60)).filter((t) => t.length >= 2))];
    if (terms.length > 15) return { error: "Keep the ignore list to 15 entries." };
    row.ignore_terms = terms;
  }
  if ("bookable_blocks" in input) {
    const list = Array.isArray(input.bookable_blocks) ? input.bookable_blocks : [];
    if (list.length > 21) return { error: "That's more bookable blocks than I can keep (21 at most)." };
    const blocks = [];
    for (const b of list) {
      const o = (b ?? {}) as Record<string, unknown>;
      const day = Math.round(Number(o.day)); const start = String(o.start ?? ""); const end = String(o.end ?? "");
      if (!(day >= 1 && day <= 7) || !HM.test(start) || !HM.test(end) || start >= end) return { error: "Each bookable block needs a day and a start before its end." };
      blocks.push({ day, start, end });
    }
    blocks.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].day === blocks[i - 1].day && blocks[i].start < blocks[i - 1].end) return { error: "Two bookable blocks overlap on the same day." };
    }
    row.bookable_blocks = blocks;
  }
  return { row };
}

// ── Connecting Outlook ─────────────────────────────────────────────────────────────
export async function startConnect(admin: SupabaseClient, userId: string, redirectUri: string, loginHint: string) {
  if (!eaConfigured()) return { error: "Outlook isn't set up on this site yet." };
  if (!REDIRECTS.includes(redirectUri)) return { error: "This address can't connect Outlook." };
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = `ea_${b64url(crypto.getRandomValues(new Uint8Array(24)))}`;
  await admin.from("eliot_ea_oauth_states").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());
  const { error } = await admin.from("eliot_ea_oauth_states").insert({ state, user_id: userId, code_verifier: verifier, redirect_uri: redirectUri });
  if (error) return { error: "Couldn't start the Outlook sign-in." };
  const q = new URLSearchParams({
    client_id: MS_CLIENT_ID, response_type: "code", redirect_uri: redirectUri, response_mode: "query", scope: SCOPES,
    state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  });
  if (loginHint) q.set("login_hint", loginHint);
  return { url: `${msBase()}/authorize?${q}` };
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${msBase()}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET, scope: SCOPES, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body: body as Record<string, unknown> };
}

export async function finishConnect(admin: SupabaseClient, userId: string, code: string, state: string) {
  if (!eaConfigured()) return { error: "Outlook isn't set up on this site yet." };
  if (!/^ea_[A-Za-z0-9_-]{20,64}$/.test(state) || !code || code.length > 4000) return { error: "That Outlook sign-in link isn't valid. Try connecting again." };
  // Single use: take the row out first, and only if it belongs to this person and is fresh.
  const { data: rows } = await admin.from("eliot_ea_oauth_states").delete().eq("state", state).eq("user_id", userId).select("code_verifier,redirect_uri,created_at");
  const st = rows?.[0];
  if (!st || Date.now() - Date.parse(st.created_at) > STATE_TTL_MS) return { error: "That Outlook sign-in expired. Try connecting again." };
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: st.redirect_uri, code_verifier: st.code_verifier });
  if (!t.ok || typeof t.body.refresh_token !== "string" || typeof t.body.access_token !== "string") {
    console.error("ms code exchange failed", clean(t.body.error, 60), clean(t.body.error_codes, 60));
    return { error: "Microsoft didn't accept the sign-in. Try connecting again." };
  }
  const me = await fetch(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`, { headers: { Authorization: `Bearer ${t.body.access_token}` } })
    .then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Record<string, unknown>;
  const row = {
    user_id: userId, provider: "microsoft",
    account_email: clean(me.mail || me.userPrincipalName, 200) || null, account_name: clean(me.displayName, 120) || null,
    scopes: clean(t.body.scope, 300) || SCOPES,
    refresh_token_enc: await seal(t.body.refresh_token as string), access_token_enc: await seal(t.body.access_token as string),
    access_expires_at: new Date(Date.now() + (Number(t.body.expires_in) || 3600) * 1000 - 120_000).toISOString(),
    connected_at: new Date().toISOString(), last_error: null,
  };
  const { error } = await admin.from("eliot_ea_connections").upsert(row);
  if (error) return { error: "Connected, but I couldn't save the link. Try again." };
  return { ok: true, account_email: row.account_email };
}

// A working access token for this person, refreshed (and the rotated refresh token saved) when needed.
export async function accessToken(admin: SupabaseClient, userId: string): Promise<{ token?: string; error?: string }> {
  if (!eaConfigured()) return { error: "not configured" };
  const { data: c } = await admin.from("eliot_ea_connections").select("refresh_token_enc,access_token_enc,access_expires_at").eq("user_id", userId).maybeSingle();
  if (!c) return { error: "not connected" };
  if (c.access_token_enc && c.access_expires_at && Date.parse(c.access_expires_at) > Date.now()) {
    const tok = await unseal(c.access_token_enc);
    if (tok) return { token: tok };
  }
  const refresh = await unseal(c.refresh_token_enc);
  if (!refresh) return { error: "reconnect" };
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
  if (!t.ok || typeof t.body.access_token !== "string") {
    const reason = clean(t.body.error, 60) || "refresh failed";
    await admin.from("eliot_ea_connections").update({ last_error: reason === "invalid_grant" ? "Outlook needs to be connected again." : `Outlook refresh failed (${reason}).` }).eq("user_id", userId);
    return { error: reason === "invalid_grant" ? "reconnect" : "refresh failed" };
  }
  await admin.from("eliot_ea_connections").update({
    access_token_enc: await seal(t.body.access_token as string),
    access_expires_at: new Date(Date.now() + (Number(t.body.expires_in) || 3600) * 1000 - 120_000).toISOString(),
    ...(typeof t.body.refresh_token === "string" ? { refresh_token_enc: await seal(t.body.refresh_token) } : {}),
    last_error: null,
  }).eq("user_id", userId);
  return { token: t.body.access_token as string };
}

// ── Reading the calendar ───────────────────────────────────────────────────────────
export type CalEvent = { id: string; key: string; subject: string; start: string | null; end: string | null; all_day: boolean;
  date: string; end_date: string; location: string; join_url: string | null; organizer: string; attendees: number;
  show_as: string; response: string; cancelled: boolean; is_organizer: boolean; categories: string[]; ignored: boolean };

const JOIN_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(zoom\.us|zoomgov\.com|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|webex\.com)\//i;
const safeJoin = (v: unknown) => { const s = String(v ?? "").trim(); return JOIN_HOSTS.test(s) && s.length < 1000 ? s : null; };

function normalize(e: Record<string, unknown>): CalEvent | null {
  const s = (e.start ?? {}) as Record<string, string>; const en = (e.end ?? {}) as Record<string, string>;
  const allDay = e.isAllDay === true;
  const start = allDay ? null : etWallToUtc(String(s.dateTime ?? ""));
  const end = allDay ? null : etWallToUtc(String(en.dateTime ?? ""));
  const date = String(s.dateTime ?? "").slice(0, 10);
  if (!validDate(date)) return null;
  // All-day events end at midnight of the day after; show the last day itself.
  const endDate = allDay ? addDaysTo(String(en.dateTime ?? "").slice(0, 10) || date, -1) : String(en.dateTime ?? "").slice(0, 10) || date;
  const loc = (e.location ?? {}) as Record<string, unknown>;
  const locText = clean(loc.displayName, 160);
  const join = safeJoin(((e.onlineMeeting ?? {}) as Record<string, unknown>).joinUrl) ?? safeJoin(locText.match(/https:\/\/\S+/)?.[0]);
  const id = clean(e.id, 400);
  return {
    id, key: `${id}|${start ?? date}`, subject: clean(e.subject, 200) || "(no subject)", start, end, all_day: allDay, date, end_date: endDate < date ? date : endDate,
    location: locText, join_url: join,
    organizer: clean(((e.organizer as Record<string, Record<string, unknown>> | undefined)?.emailAddress ?? {}).name, 80),
    attendees: Array.isArray(e.attendees) ? e.attendees.length : 0,
    show_as: clean(e.showAs, 20), response: clean(((e.responseStatus ?? {}) as Record<string, unknown>).response, 30),
    cancelled: e.isCancelled === true, is_organizer: e.isOrganizer === true,
    categories: (Array.isArray(e.categories) ? e.categories : []).map((c) => clean(c, 60)).filter(Boolean).slice(0, 10), ignored: false,
  };
}

// Events from fromDate (00:00 Eastern) for `days` days, cancelled ones dropped, in start order.
export async function readEvents(admin: SupabaseClient, userId: string, fromDate: string, days: number): Promise<{ events?: CalEvent[]; error?: string }> {
  const tok = await accessToken(admin, userId);
  if (!tok.token) return { error: tok.error };
  const startIso = etWallToUtc(`${fromDate}T00:00`); const endIso = etWallToUtc(`${addDaysTo(fromDate, days)}T00:00`);
  if (!startIso || !endIso) return { error: "bad range" };
  const q = new URLSearchParams({
    startDateTime: startIso, endDateTime: endIso, $top: "100", $orderby: "start/dateTime",
    $select: "id,subject,start,end,isAllDay,location,onlineMeeting,organizer,attendees,showAs,isCancelled,responseStatus,isOrganizer,categories",
  });
  let url: string | null = `${GRAPH}/me/calendarView?${q}`;
  const out: CalEvent[] = [];
  for (let page = 0; url && page < 5; page++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tok.token}`, Prefer: 'outlook.timezone="Eastern Standard Time"' } });
    if (!res.ok) {
      await admin.from("eliot_ea_connections").update({ last_error: `Outlook calendar read failed (HTTP ${res.status}).` }).eq("user_id", userId);
      return { error: `graph ${res.status}` };
    }
    const body = await res.json() as Record<string, unknown>;
    for (const e of (Array.isArray(body.value) ? body.value : [])) { const n = normalize(e as Record<string, unknown>); if (n && !n.cancelled) out.push(n); }
    const next = typeof body["@odata.nextLink"] === "string" ? body["@odata.nextLink"] as string : null;
    url = next && next.startsWith(`${GRAPH}/`) ? next : null;
  }
  await admin.from("eliot_ea_connections").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("user_id", userId);
  // The person's ignore list (e.g. "Work Schedule", their employees' timesheet): those events never count as busy,
  // never alert and stay out of the week preview. They are still returned, marked ignored, for the panel.
  const { data: prof } = await admin.from("eliot_ea_profiles").select("ignore_terms").eq("user_id", userId).maybeSingle();
  const terms = ((prof?.ignore_terms ?? []) as string[]).map((t) => t.toLowerCase()).filter(Boolean);
  if (terms.length) for (const e of out) e.ignored = terms.some((t) => e.subject.toLowerCase().includes(t) || e.categories.some((c) => c.toLowerCase().includes(t)));
  out.sort((a, b) => (a.start ?? `${a.date}T00`).localeCompare(b.start ?? `${b.date}T00`));
  return { events: out };
}

// A meeting that should take your time: not all-day, not declined, not marked free.
export const isMeeting = (e: CalEvent) => !e.ignored && !e.all_day && !!e.start && e.response !== "declined" && e.show_as !== "free";

// ── The week preview ───────────────────────────────────────────────────────────────
const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
const shortDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const etDateOf = (iso: string) => etNow(new Date(iso)).date;
const etMinOf = (iso: string) => etNow(new Date(iso)).minutes;
const hm = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

export function weekFacts(events: CalEvent[], fromDate: string, profile: EaProfile) {
  const WORK_START = 9 * 60, WORK_END = 17 * 60;
  const days = Array.from({ length: 7 }, (_, i) => addDaysTo(fromDate, i)).map((date) => {
    const iso = etNow(new Date(`${date}T17:00:00Z`)).weekday;
    const meetings = events.filter((e) => isMeeting(e) && etDateOf(e.start!) === date);
    const allDay = events.filter((e) => e.all_day && !e.ignored && e.date <= date && e.end_date >= date).map((e) => e.subject);
    const spans = meetings.map((e) => ({ s: etMinOf(e.start!), e: Math.max(etMinOf(e.end ?? e.start!), etMinOf(e.start!) + 15), subject: e.subject }));
    const minutes = spans.reduce((t, x) => t + (x.e - x.s), 0);
    const overlaps: string[] = [];
    let backToBack = 0;
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].s < spans[i - 1].e) overlaps.push(`${hm(spans[i].s)} overlaps ${hm(spans[i - 1].s)}`);
      else if (spans[i].s - spans[i - 1].e <= 5) backToBack++;
    }
    // Largest open stretch inside 9-5.
    let best = { s: WORK_START, len: 0 }, cursor = WORK_START;
    for (const x of [...spans].sort((a, b) => a.s - b.s)) {
      if (x.s > cursor && x.s - cursor > best.len) best = { s: cursor, len: Math.min(x.s, WORK_END) - cursor };
      cursor = Math.max(cursor, x.e);
    }
    if (WORK_END - cursor > best.len) best = { s: cursor, len: WORK_END - cursor };
    const blocks = profile.bookable_blocks.filter((b) => b.day === iso).map((b) => `${b.start}-${b.end}`);
    return {
      date, day: dayName(date), weekday: iso, meetings: meetings.length, hours: Math.round((minutes / 60) * 10) / 10,
      first: spans[0] ? hm(spans[0].s) : null, last: spans.length ? hm(Math.max(...spans.map((x) => x.e))) : null,
      early: spans.some((x) => x.s < 8 * 60), late: spans.some((x) => x.e > 18 * 60), back_to_back: backToBack, overlaps,
      longest_open: best.len >= 30 ? `${hm(best.s)} for ${Math.round(best.len / 30) / 2} hours` : null,
      subjects: meetings.slice(0, 6).map((e) => `${timeLabel(e.start!)} ${e.subject}`), all_day: allDay.slice(0, 3), bookable: blocks,
    };
  });
  const total = days.reduce((t, d) => t + d.meetings, 0);
  const hours = Math.round(days.reduce((t, d) => t + d.hours, 0) * 10) / 10;
  const busiest = days.reduce((a, b) => (b.hours > a.hours ? b : a), days[0]);
  return { from: fromDate, to: addDaysTo(fromDate, 6), total, hours, busiest: busiest.meetings ? busiest.day : null, days };
}

export function weekDisplay(f: ReturnType<typeof weekFacts>) {
  return {
    title: `Your week · ${shortDay(f.from)} to ${shortDay(f.to)}`,
    blocks: [
      { type: "stats", items: [
        { label: "Meetings", value: String(f.total) }, { label: "Hours", value: String(f.hours) },
        ...(f.busiest ? [{ label: "Busiest", value: f.busiest }] : []),
      ] },
      { type: "table", columns: ["Day", "Meetings", "Hours", "First", "Open time", "Watch"], units: ["", "", "", "", "", ""],
        rows: f.days.map((d) => [shortDay(d.date), d.meetings, d.hours, d.first ?? "-", d.longest_open ?? "-",
          [d.overlaps.length ? `${d.overlaps.length} overlap${d.overlaps.length > 1 ? "s" : ""}` : "", d.back_to_back >= 2 ? "back-to-back" : "", d.early ? "early start" : "", d.late ? "late finish" : ""].filter(Boolean).join(", ") || "-"]) },
    ],
  };
}

export function weekPushText(f: ReturnType<typeof weekFacts>) {
  const tail = f.total === 0 ? "no meetings booked" : `${f.total} meeting${f.total === 1 ? "" : "s"}${f.busiest ? `, busiest ${f.busiest}` : ""}`;
  return { title: "ELIOT", body: `Week preview ready · ${tail}`, tag: "eliot-week" };
}

// ── The voice tool ─────────────────────────────────────────────────────────────────
export const CALENDAR_TOOL = {
  name: "my_calendar",
  description: "The administrator's own Outlook calendar (this tool only reads): meetings and all-day events from a start date for a number of days, in Eastern time, with location, whether there's a video link, organizer and attendee count. Use for 'what's on my calendar', 'when is my next meeting', 'am I free Thursday afternoon', 'how busy is next week'. Events marked not_counted (e.g. the employees' Work Schedule timesheet) are not the administrator's commitments: never count them as busy or as meetings; mention them only if asked.",
  input_schema: {
    type: "object",
    properties: {
      start_date: { type: "string", description: "YYYY-MM-DD, Eastern. Default today." },
      days: { type: "integer", minimum: 1, maximum: 14, description: "How many days from start_date. Default 1." },
    },
    additionalProperties: false,
  },
};

export async function calendarToolData(admin: SupabaseClient, userId: string, input: Record<string, unknown>) {
  const from = validDate(input.start_date) ? input.start_date : etNow().date;
  const days = Math.min(14, Math.max(1, Math.round(Number(input.days) || 1)));
  const r = await readEvents(admin, userId, from, days);
  if (!r.events) return { rows: 0, data: { error: r.error === "reconnect" ? "Outlook needs to be connected again in ELIOT's Calendar panel." : "The calendar couldn't be read just now." } };
  const items = r.events.slice(0, 60).map((e) => ({
    day: shortDay(e.all_day ? e.date : etDateOf(e.start!)), time: e.all_day ? "all day" : `${timeLabel(e.start!)} to ${timeLabel(e.end ?? e.start!)}`,
    subject: e.subject, location: e.location || null, video_link: !!e.join_url, organizer: e.organizer || null, attendees: e.attendees,
    declined: e.response === "declined" || undefined, tentative: e.response === "tentativelyAccepted" || undefined, free: e.show_as === "free" || undefined,
    not_counted: e.ignored || undefined,
  }));
  return { rows: items.length, data: { from, days, events: items, more: r.events.length > 60 || undefined } };
}

// For the app: events shaped for the Calendar panel.
export const forApp = (e: CalEvent) => ({
  id: e.key, subject: e.subject, start: e.start, end: e.end, all_day: e.all_day, date: e.all_day ? e.date : etDateOf(e.start!), end_date: e.end_date,
  location: e.location, join_url: e.join_url, organizer: e.organizer, attendees: e.attendees, response: e.response, show_as: e.show_as, is_organizer: e.is_organizer, ignored: e.ignored,
});

// ── Scheduled: meeting alerts and the week preview (called every 5 minutes) ───────────────
type Push = (userId: string, msg: { title: string; body: string; tag: string }, urgency?: "normal" | "high") => Promise<{ sent: number; skipped?: string } | null>;
type Audit = (row: Record<string, unknown>) => PromiseLike<unknown>;
type ComposeWeek = (facts: ReturnType<typeof weekFacts> & { work?: unknown }, firstName: string) => Promise<string>;
type WorkSummary = (userId: string) => Promise<{ items: number; minutes: number; overdue: number } | null>;

export async function runEaSchedule(admin: SupabaseClient, deps: { push: Push; audit: Audit; composeWeek: ComposeWeek; work?: WorkSummary }) {
  if (!eaConfigured()) return { skipped: "not configured" };
  const { data: profiles } = await admin.from("eliot_ea_profiles").select(PROFILE_COLS).eq("enabled", true);
  const { data: conns } = await admin.from("eliot_ea_connections").select("user_id");
  const linked = new Set((conns ?? []).map((c) => String(c.user_id)));
  const now = Date.now();
  const et = etNow();
  const out: Array<Record<string, unknown>> = [];
  for (const p of (profiles ?? []) as EaProfile[]) {
    if (!linked.has(p.user_id)) continue;
    const r: Record<string, unknown> = { user: p.user_id };
    try {
      // Meeting alerts: anything starting within the alert window that hasn't alerted yet.
      if (p.alerts_on) {
        const ev = await readEvents(admin, p.user_id, et.date, 2);
        const due = (ev.events ?? []).filter((e) => isMeeting(e) && Date.parse(e.start!) > now && Date.parse(e.start!) - now <= p.alert_minutes * 60_000);
        if (due.length) {
          const { data: fresh } = await admin.from("eliot_ea_alerts")
            .upsert(due.map((e) => ({ user_id: p.user_id, event_key: e.key.slice(0, 500), kind: "meeting" })), { onConflict: "user_id,event_key,kind", ignoreDuplicates: true })
            .select("event_key");
          const keys = new Set((fresh ?? []).map((x) => x.event_key));
          const newOnes = due.filter((e) => keys.has(e.key.slice(0, 500)));
          if (newOnes.length) {
            const first = newOnes[0];
            const mins = Math.max(1, Math.round((Date.parse(first.start!) - now) / 60_000));
            const body = newOnes.length === 1 ? `Meeting at ${timeLabel(first.start!)} · in ${mins} min` : `${newOnes.length} meetings starting soon · first at ${timeLabel(first.start!)}`;
            const push = await deps.push(p.user_id, { title: "ELIOT", body, tag: "eliot-meeting" }, "high");
            await deps.audit({ module: "ea-alert", command: "[meeting alert]", user_id: p.user_id, status: push && !push.skipped ? "ok" : "error",
              error: push?.skipped ?? null, tool_calls: push ? [push] : [], result_summary: body });
            r.alerts = newOnes.length;
          }
        }
        if (ev.error) r.error = ev.error;
      }
      // Week preview: once, on the chosen day, in the half hour after the chosen time.
      const [h, m] = p.week_preview_time.split(":").map(Number);
      const at = h * 60 + m;
      if (p.week_preview_on && et.weekday === p.week_preview_dow && et.minutes >= at && et.minutes < at + 30) {
        const slot = `week ${et.date}`;
        const { data: done } = await admin.from("eliot_briefings").select("id").eq("user_id", p.user_id).eq("slot", slot).maybeSingle();
        if (!done) {
          const from = addDaysTo(et.date, 1);
          const ev = await readEvents(admin, p.user_id, from, 7);
          if (ev.events) {
            const facts = weekFacts(ev.events, from, p);
            const { data: prof } = await admin.from("user_profiles").select("full_name").eq("id", p.user_id).maybeSingle();
            const firstName = String(prof?.full_name ?? "").trim().split(/\s+/)[0].replace(/[^\p{L}'-]/gu, "").slice(0, 30);
            // Open work that still needs calendar time, so the preview can suggest "plan my week".
            const work = deps.work ? await deps.work(p.user_id).catch(() => null) : null;
            const answer = await deps.composeWeek(work ? { ...facts, work } : facts, firstName);
            const { error: insErr } = await admin.from("eliot_briefings").insert({
              user_id: p.user_id, slot, slot_label: "Week preview", answer, display: weekDisplay(facts), findings: [], counts: { meetings: facts.total },
            });
            const push = insErr ? null : await deps.push(p.user_id, weekPushText(facts));
            await deps.audit({ module: "ea-week", command: "[week preview]", user_id: p.user_id, status: insErr ? "error" : "ok",
              error: insErr ? String(insErr.message).slice(0, 300) : null, tool_calls: push ? [push] : [], result_summary: `${facts.total} meetings, ${facts.hours} hours.` });
            r.week = !insErr;
          } else r.error = ev.error;
        }
      }
    } catch (e) {
      console.error("ea schedule failed", p.user_id, e);
      r.error = "failed";
    }
    out.push(r);
  }
  await admin.from("eliot_ea_alerts").delete().lt("sent_at", new Date(now - 30 * 86_400_000).toISOString());
  return { users: out };
}

// ── Changing the calendar (confirm first) ─────────────────────────────────────────────
// Eliot only ever DRAFTS a change. The draft is stored here (eliot_ea_drafts) and shown on screen; the
// person confirms by tap or a spoken yes, and confirm runs exactly that stored draft, once, within
// 15 minutes. Creating or moving a meeting with attendees sends invites from the person's own mailbox,
// so the card lists every attendee and flags anyone outside ORDANIS.

export const CALENDAR_ACTION_TOOL = {
  name: "propose_calendar_change",
  description: "Draft a change to the administrator's own Outlook calendar: book a new meeting or block, move one, cancel one they organize, or answer an invitation (accept, tentative, decline). This CHANGES NOTHING: it puts a draft on their screen and they confirm by saying yes or tapping Confirm. Resolve relative dates and times yourself using today's date (Eastern). To find an existing meeting, pass its date and, if known, its start time and words from its subject (use my_calendar first if unsure). After it succeeds, read the draft back in one short sentence (what, when, who gets an invite) and end with a yes-or-no question like \"Book it?\", \"Move it?\", \"Cancel it?\" or \"Send that?\". If the result lists several matches or a problem, ask the administrator instead of guessing.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["book", "move", "cancel", "respond"] },
      subject: { type: "string", description: "book: the meeting title." },
      date: { type: "string", description: "book: YYYY-MM-DD (Eastern)." },
      start: { type: "string", description: "book: HH:MM, 24-hour, Eastern." },
      duration_minutes: { type: "integer", minimum: 5, maximum: 480, description: "book: length. Default 30." },
      attendees: { type: "array", items: { type: "string" }, maxItems: 20, description: "book: attendee email addresses (only addresses the administrator gave or that appear in their calendar; never guess one)." },
      location: { type: "string", description: "book: room or address." },
      zoom_link: { type: "boolean", description: "book: add a Zoom meeting link (ORDANIS Zoom, waiting room on). Default true when there are attendees and no location; false for in-person meetings and personal blocks. ORDANIS uses Zoom, never Teams." },
      notes: { type: "string", description: "book: short note for the invite body." },
      find: {
        type: "object", description: "move, cancel, respond: which existing meeting.",
        properties: { date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM start, Eastern" }, subject: { type: "string", description: "words from the subject" } },
        required: ["date"], additionalProperties: false,
      },
      new_date: { type: "string", description: "move: new YYYY-MM-DD. Default the same day." },
      new_start: { type: "string", description: "move: new HH:MM start (the length stays the same)." },
      response: { type: "string", enum: ["accept", "tentative", "decline"], description: "respond: the answer." },
      comment: { type: "string", description: "cancel or respond: short message to the organizer or attendees." },
      send_response: { type: "boolean", description: "respond: tell the organizer. Default true." },
    },
    required: ["action"],
    additionalProperties: false,
  },
};

const EMAIL_RE = /^[^\s@<>"]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const OWN_DOMAIN = (Deno.env.get("EA_OWN_DOMAIN") || "ordanisos.com").toLowerCase();
const niceWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const wall = (date: string, hmv: string) => `${date}T${hmv}:00`;
const plusMinutes = (date: string, hmv: string, mins: number) => {
  const [h, m] = hmv.split(":").map(Number);
  const total = h * 60 + m + mins;
  return { date: addDaysTo(date, Math.floor(total / 1440)), hm: `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}` };
};

async function overlaps(admin: SupabaseClient, userId: string, startIso: string, endIso: string, skipId?: string) {
  const r = await readEvents(admin, userId, etNow(new Date(startIso)).date, 2);
  return (r.events ?? []).filter((e) => isMeeting(e) && e.id !== skipId && Date.parse(e.start!) < Date.parse(endIso) && Date.parse(e.end ?? e.start!) > Date.parse(startIso))
    .map((e) => `${timeLabel(e.start!)} ${e.subject}`);
}

async function findEvent(admin: SupabaseClient, userId: string, find: Record<string, unknown>): Promise<{ event?: CalEvent; message?: string }> {
  if (!validDate(find.date)) return { message: "Which day is the meeting on? Call again with find.date." };
  const r = await readEvents(admin, userId, find.date, 1);
  if (!r.events) return { message: "The calendar couldn't be read just now." };
  let hits = r.events.filter((e) => !e.all_day);
  const words = clean(find.subject, 80).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (words.length) hits = hits.filter((e) => words.some((w) => e.subject.toLowerCase().includes(w)));
  if (HM.test(String(find.time ?? ""))) {
    const at = etWallToUtc(wall(find.date, String(find.time)));
    const exact = hits.filter((e) => e.start === at);
    hits = exact.length ? exact : hits.filter((e) => at && Math.abs(Date.parse(e.start!) - Date.parse(at)) <= 30 * 60_000);
  }
  if (!hits.length) return { message: `No meeting matches on ${find.date}. These are that day's meetings: ${r.events.filter((e) => !e.all_day).map((e) => `${timeLabel(e.start!)} ${e.subject}`).join("; ") || "none"}. Ask which one.` };
  if (hits.length > 1) return { message: `Several meetings match: ${hits.map((e) => `${timeLabel(e.start!)} ${e.subject}`).join("; ")}. Ask which one.` };
  return { event: hits[0] };
}

export async function draftCalendarChange(admin: SupabaseClient, userId: string, input: Record<string, unknown>): Promise<{ draft?: Record<string, unknown>; message: string }> {
  const action = String(input.action ?? "");
  let kind = action, eventId: string | null = null, payload: Record<string, unknown> = {}, summary: Record<string, unknown> = {}, readBack = "";
  if (action === "book") {
    const subject = clean(input.subject, 200);
    if (!subject) return { message: "What should the meeting be called? Ask, then call again." };
    if (!validDate(input.date) || !HM.test(String(input.start ?? ""))) return { message: "A booking needs a date (YYYY-MM-DD) and a start time (HH:MM). Ask for whichever is missing." };
    const mins = Math.min(480, Math.max(5, Math.round(Number(input.duration_minutes) || 30)));
    const end = plusMinutes(input.date, String(input.start), mins);
    const startIso = etWallToUtc(wall(input.date, String(input.start)))!;
    const endIso = etWallToUtc(wall(end.date, end.hm))!;
    if (Date.parse(startIso) < Date.now()) return { message: "That time has already passed. Ask for another time." };
    const raw = Array.isArray(input.attendees) ? input.attendees.map((a) => clean(a, 200).toLowerCase()) : [];
    const bad = raw.filter((a) => !EMAIL_RE.test(a));
    if (bad.length) return { message: `These aren't email addresses: ${bad.join(", ")}. Invites need real addresses; ask for them, or book without attendees.` };
    const attendees = [...new Set(raw)].slice(0, 20);
    const outside = attendees.filter((a) => !a.endsWith(`@${OWN_DOMAIN}`));
    const clash = await overlaps(admin, userId, startIso, endIso);
    payload = {
      subject, start: { dateTime: wall(input.date, String(input.start)), timeZone: "Eastern Standard Time" }, end: { dateTime: wall(end.date, end.hm), timeZone: "Eastern Standard Time" },
      ...(clean(input.location, 160) ? { location: { displayName: clean(input.location, 160) } } : {}),
      ...(clean(input.notes, 1000) ? { body: { contentType: "text", content: clean(input.notes, 1000) } } : {}),
      attendees: attendees.map((a) => ({ emailAddress: { address: a }, type: "required" })),
    };
    const zoom = typeof input.zoom_link === "boolean" ? input.zoom_link : attendees.length > 0 && !clean(input.location, 160);
    if (zoom && !zoomConfigured()) return { message: "Zoom isn't set up for ELIOT yet. Offer to book it without a Zoom link (they can add one in Zoom), or with a location instead." };
    if (zoom) payload.zoom = { topic: subject, start: wall(input.date, String(input.start)), minutes: mins };
    summary = { title: "Book", subject, when: niceWhen(startIso), until: timeLabel(endIso), minutes: mins, start: startIso, end: endIso, attendees, outside, zoom,
      location: clean(input.location, 160) || null, overlaps: clash };
    readBack = `Book "${subject}" ${niceWhen(startIso)} for ${mins} minutes${attendees.length ? `, invites to ${attendees.length} (${outside.length} outside ORDANIS)` : ", no invites"}${zoom ? ", with a Zoom link" : ""}${clash.length ? `. It overlaps: ${clash.join("; ")}` : ""}`;
  } else if (action === "move" || action === "cancel" || action === "respond") {
    const f = await findEvent(admin, userId, (input.find ?? {}) as Record<string, unknown>);
    if (!f.event) return { message: f.message ?? "Couldn't find that meeting." };
    const e = f.event;
    eventId = e.id;
    const base = { subject: e.subject, when: niceWhen(e.start!), start: e.start, end: e.end, attendees_count: e.attendees, organizer: e.is_organizer ? "you" : e.organizer || "someone else" };
    if (action === "move") {
      if (!e.is_organizer) return { message: `"${e.subject}" was set up by ${e.organizer || "someone else"}, so only they can move it. Offer to decline it, or to answer tentatively with a note.` };
      const newDate = validDate(input.new_date) ? input.new_date : e.date;
      if (!HM.test(String(input.new_start ?? ""))) return { message: "What time should it move to? Ask, then call again with new_start." };
      const mins = Math.max(5, Math.round((Date.parse(e.end ?? e.start!) - Date.parse(e.start!)) / 60_000));
      const end = plusMinutes(newDate, String(input.new_start), mins);
      const startIso = etWallToUtc(wall(newDate, String(input.new_start)))!;
      const endIso = etWallToUtc(wall(end.date, end.hm))!;
      if (Date.parse(startIso) < Date.now()) return { message: "That new time has already passed. Ask for another time." };
      const clash = await overlaps(admin, userId, startIso, endIso, e.id);
      const zid = zoomIdFrom(e.join_url);
      payload = { start: { dateTime: wall(newDate, String(input.new_start)), timeZone: "Eastern Standard Time" }, end: { dateTime: wall(end.date, end.hm), timeZone: "Eastern Standard Time" },
        ...(zid ? { zoom_id: zid, zoom_start: wall(newDate, String(input.new_start)), zoom_minutes: mins } : {}) };
      summary = { ...base, title: "Move", new_when: niceWhen(startIso), new_start: startIso, new_end: endIso, overlaps: clash, zoom: !!zid };
      readBack = `Move "${e.subject}" from ${niceWhen(e.start!)} to ${niceWhen(startIso)}${e.attendees ? `; ${e.attendees} attendee${e.attendees === 1 ? "" : "s"} get an update` : ""}${clash.length ? `. The new time overlaps: ${clash.join("; ")}` : ""}`;
    } else if (action === "cancel") {
      if (!e.is_organizer) return { message: `"${e.subject}" was set up by ${e.organizer || "someone else"}, so it can't be cancelled from here. Offer to decline it instead.` };
      const zid = zoomIdFrom(e.join_url);
      payload = { comment: clean(input.comment, 500), with_attendees: e.attendees > 0, ...(zid ? { zoom_id: zid } : {}) };
      summary = { ...base, title: "Cancel", comment: clean(input.comment, 500) || null, zoom: !!zid };
      readBack = `Cancel "${e.subject}" on ${niceWhen(e.start!)}${e.attendees ? `; ${e.attendees} attendee${e.attendees === 1 ? "" : "s"} get a cancellation` : ""}`;
    } else {
      if (e.is_organizer) return { message: `"${e.subject}" is your own meeting, so there's no invitation to answer. Offer to move or cancel it instead.` };
      const resp = String(input.response ?? "");
      if (!["accept", "tentative", "decline"].includes(resp)) return { message: "Accept, tentative or decline? Ask, then call again." };
      payload = { response: resp, comment: clean(input.comment, 500), sendResponse: input.send_response !== false };
      summary = { ...base, title: resp === "accept" ? "Accept" : resp === "tentative" ? "Tentative" : "Decline", comment: clean(input.comment, 500) || null, notify: input.send_response !== false };
      readBack = `${summary.title} "${e.subject}" on ${niceWhen(e.start!)}${input.send_response !== false ? `, and let ${e.organizer || "the organizer"} know` : ", without telling the organizer"}`;
    }
  } else return { message: "Unknown calendar action." };
  await admin.from("eliot_ea_drafts").update({ status: "discarded" }).eq("user_id", userId).eq("status", "pending");
  const { data, error } = await admin.from("eliot_ea_drafts").insert({ user_id: userId, kind, event_id: eventId, payload, summary }).select("id,expires_at").maybeSingle();
  if (error || !data) return { message: "Couldn't put the draft on screen. Say it again." };
  return { draft: { id: data.id, kind, ...summary, expires_at: data.expires_at }, message: `Draft on screen, NOT done: ${readBack}. Read it back in one sentence and ask a yes-or-no question.` };
}

// Runs a confirmed draft. Only the caller's own pending, unexpired draft; claimed atomically so it runs once.
export async function runDraft(admin: SupabaseClient, userId: string, draftId: string): Promise<{ ok?: boolean; message: string; kind?: string }> {
  const { data: claimed } = await admin.from("eliot_ea_drafts").update({ status: "running" })
    .eq("id", draftId).eq("user_id", userId).eq("status", "pending").gt("expires_at", new Date().toISOString())
    .select("id,kind,event_id,payload,summary");
  const d = claimed?.[0];
  if (!d) return { message: "That draft has expired or was already handled. Ask me again." };
  const finish = async (ok: boolean, message: string) => {
    await admin.from("eliot_ea_drafts").update({ status: ok ? "done" : "failed", result: message.slice(0, 300), done_at: new Date().toISOString() }).eq("id", d.id);
    return { ok, message, kind: d.kind };
  };
  const tok = await accessToken(admin, userId);
  if (!tok.token) return finish(false, tok.error === "reconnect" ? "Outlook needs to be connected again." : "Couldn't reach Outlook just now.");
  const p = d.payload as Record<string, unknown>;
  const id = encodeURIComponent(String(d.event_id ?? ""));
  let url = "", method = "POST", body: Record<string, unknown> | null = null;
  let zoomMade: { id: string; join_url: string; passcode: string } | null = null;
  if (d.kind === "book") {
    const { zoom, ...event } = p as Record<string, unknown> & { zoom?: { topic: string; start: string; minutes: number } };
    body = { ...event, transactionId: d.id };
    if (zoom) {
      try { zoomMade = await zoomCreate(zoom.topic, zoom.start, zoom.minutes); }
      catch (e) {
        const why = String((e as Error)?.message ?? e);
        console.error("zoom create failed", why);
        return finish(false, why.startsWith("zoom user missing") ? `Zoom has no user called ${why.slice(19)}, so nothing was booked. The Zoom host email (ZOOM_USER_EMAIL) needs to be the address you sign in to Zoom with.`
          : "Zoom didn't create the meeting, so nothing was booked. Try again, or book it without a Zoom link.");
      }
      const note = (event.body as Record<string, string> | undefined)?.content;
      body.location = { displayName: "Zoom" };
      body.body = { contentType: "text", content: `${note ? `${note}\n\n` : ""}Join Zoom meeting: ${zoomMade.join_url}\nMeeting ID: ${zoomMade.id.replace(/(\d{3})(\d{3,4})(\d+)/, "$1 $2 $3")}${zoomMade.passcode ? `\nPasscode: ${zoomMade.passcode}` : ""}` };
    }
    url = `${GRAPH}/me/events`;
  }
  else if (d.kind === "move") { url = `${GRAPH}/me/events/${id}`; method = "PATCH"; body = { start: p.start, end: p.end }; }
  else if (d.kind === "cancel") {
    // With attendees: a real cancellation they receive. Without: delete (it goes to Deleted Items in Outlook, recoverable).
    if (p.with_attendees) { url = `${GRAPH}/me/events/${id}/cancel`; body = { comment: p.comment || "" }; }
    else { url = `${GRAPH}/me/events/${id}`; method = "DELETE"; }
  } else if (d.kind === "respond") {
    const verb = p.response === "accept" ? "accept" : p.response === "tentative" ? "tentativelyAccept" : "decline";
    url = `${GRAPH}/me/events/${id}/${verb}`; body = { comment: p.comment || "", sendResponse: p.sendResponse !== false };
  } else return finish(false, "Unknown draft.");
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${tok.token}`, "Content-Type": "application/json", Prefer: 'outlook.timezone="Eastern Standard Time"' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, Record<string, unknown>>;
    console.error("calendar write failed", d.kind, res.status, clean(err?.error?.code, 60));
    const why = res.status === 403 ? "Outlook didn't allow it. Reconnect Outlook so ELIOT has write permission." : res.status === 404 ? "That meeting no longer exists in Outlook." : `Outlook said no (HTTP ${res.status}).`;
    // Don't leave an orphan Zoom meeting behind a booking Outlook refused.
    if (zoomMade) await zoomDelete(zoomMade.id).catch(() => false);
    return finish(false, why);
  }
  // Keep the Zoom meeting in step with Outlook. Only meetings on ORDANIS's Zoom can change; others are left alone.
  let zoomNote = "";
  if (zoomConfigured() && typeof p.zoom_id === "string") {
    const ok = d.kind === "move" ? await zoomMove(p.zoom_id, String(p.zoom_start), Number(p.zoom_minutes) || 30).catch(() => false)
      : d.kind === "cancel" ? await zoomDelete(p.zoom_id).catch(() => false) : true;
    if (!ok) zoomNote = d.kind === "move" ? " The Zoom link still works, but Zoom's own schedule didn't update." : " The Zoom meeting itself wasn't deleted; it may not be on ORDANIS's Zoom.";
  }
  const s = d.summary as Record<string, unknown>;
  const done = { book: `Booked "${s.subject}".`, move: `Moved "${s.subject}" to ${s.new_when}.`, cancel: `Cancelled "${s.subject}".`, respond: `${s.title === "Accept" ? "Accepted" : s.title === "Tentative" ? "Answered tentative to" : "Declined"} "${s.subject}".` }[d.kind as "book"] ?? "Done.";
  return finish(true, done + (zoomMade ? " The Zoom link is in the invite." : "") + zoomNote);
}
