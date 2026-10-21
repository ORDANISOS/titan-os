// MILO reports: the read-only marketing analytics behind MILO's assistant, shared with ELIOT.
//
// Used by milo-command (MILO's own assistant and weekly briefing) and by hub-command (ELIOT's
// marketing_report tool, admins only), so both always give the same numbers.
//
// SECURITY
// - Read-only: nothing here inserts, updates or deletes. The caller passes a service-role client,
//   because the milo_* tables have no browser access; each caller checks admin + MFA first.
// - Totals only for households: signups come from milo_signup_totals / milo_signup_by_campaign
//   (no names, no ids). No household, user, email or firm data is reachable from here.
// - Results (page text, captions, entry notes) are data; callers wrap them for the model.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { PLATFORMS } from "../milo-social/providers.ts";

export const ROW_CAP = 50;

export const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").trim().slice(0, max);
export const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,%\s]/g, "")); return Number.isFinite(n) ? n : null; };
export const validDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
export const money = (v: number) => Math.round(v * 100) / 100;

export const CHANNELS = ["conference", "sponsorship", "paid_social", "paid_search", "email", "print", "content", "pr", "agency", "software", "events", "swag", "other"] as const;
export const CHANNEL_LABEL: Record<string, string> = {
  conference: "Conferences", sponsorship: "Sponsorships", paid_social: "Paid social", paid_search: "Paid search", email: "Email",
  print: "Print", content: "Content", pr: "PR", agency: "Agency", software: "Software", events: "Events", swag: "Swag", other: "Other",
};
export const BREAKDOWN_KEYS = ["booth", "sponsorship", "travel", "lodging", "meals", "swag", "staff", "shipping", "other"];

// ── Dates (Eastern) ─────────────────────────────────────────────────────────────────
export function etParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const iso = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday as string] ?? 0;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: iso };
}
export const etToday = () => etParts().date;
export const shiftDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Named periods the model and the app can ask for, resolved to [from, to] inclusive.
export function period(input: Record<string, unknown>): { from: string; to: string; label: string } {
  const today = etToday();
  const [y, m] = today.split("-").map(Number);
  const q0 = Math.floor((m - 1) / 3) * 3 + 1;
  const pad = (x: number) => String(x).padStart(2, "0");
  const endOfMonth = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const named: Record<string, () => { from: string; to: string; label: string }> = {
    this_month: () => ({ from: `${y}-${pad(m)}-01`, to: endOfMonth(y, m), label: "this month" }),
    last_month: () => { const lm = m === 1 ? 12 : m - 1, ly = m === 1 ? y - 1 : y; return { from: `${ly}-${pad(lm)}-01`, to: endOfMonth(ly, lm), label: "last month" }; },
    this_quarter: () => ({ from: `${y}-${pad(q0)}-01`, to: endOfMonth(y, q0 + 2), label: `Q${(q0 + 2) / 3} ${y}` }),
    last_quarter: () => { const lq = q0 === 1 ? 10 : q0 - 3, ly = q0 === 1 ? y - 1 : y; return { from: `${ly}-${pad(lq)}-01`, to: endOfMonth(ly, lq + 2), label: `Q${(lq + 2) / 3} ${ly}` }; },
    this_year: () => ({ from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) }),
    last_year: () => ({ from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: String(y - 1) }),
    last_30_days: () => ({ from: shiftDays(today, -29), to: today, label: "the last 30 days" }),
    last_90_days: () => ({ from: shiftDays(today, -89), to: today, label: "the last 90 days" }),
    last_7_days: () => ({ from: shiftDays(today, -6), to: today, label: "the last 7 days" }),
  };
  if (validDate(input.from) && validDate(input.to) && String(input.from) <= String(input.to)) {
    return { from: String(input.from), to: String(input.to), label: `${input.from} to ${input.to}` };
  }
  return (named[String(input.period ?? "")] ?? named.this_year)();
}

// Period inputs shared by every report tool definition.
export const PERIOD_PROPS = {
  period: { type: "string", enum: ["this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year", "last_7_days", "last_30_days", "last_90_days"], description: "Named period. Default this_year." },
  from: { type: "string", description: "YYYY-MM-DD; use with to for a custom range." },
  to: { type: "string", description: "YYYY-MM-DD." },
};

export type ToolOut = { data: unknown; rows: number };

export async function spendRows(admin: SupabaseClient, from: string, to: string, extra?: (q: any) => any) { // deno-lint-ignore no-explicit-any
  let q = admin.from("milo_spend").select("id,kind,channel,title,vendor,campaign,city,spend_date,end_date,amount,breakdown,leads,meetings,deals_won,notes")
    .is("voided_at", null).gte("spend_date", from).lte("spend_date", to).order("spend_date", { ascending: false }).limit(2000);
  if (extra) q = extra(q);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function runReport(admin: SupabaseClient, name: string, input: Record<string, unknown>): Promise<ToolOut> {
  const p = period(input);
  switch (name) {
    case "spend_summary": {
      const rows = await spendRows(admin, p.from, p.to);
      const by = ["channel", "month", "campaign", "vendor", "kind"].includes(String(input.group_by)) ? String(input.group_by) : "channel";
      const groups = new Map<string, { total: number; entries: number; leads: number; meetings: number; deals: number }>();
      for (const r of rows) {
        const key = by === "month" ? String(r.spend_date).slice(0, 7) : by === "channel" ? CHANNEL_LABEL[r.channel] ?? r.channel : String(r[by as keyof typeof r] ?? "(none)");
        const g = groups.get(key) ?? { total: 0, entries: 0, leads: 0, meetings: 0, deals: 0 };
        g.total += Number(r.amount); g.entries++; g.leads += r.leads ?? 0; g.meetings += r.meetings ?? 0; g.deals += r.deals_won ?? 0;
        groups.set(key, g);
      }
      const list = [...groups.entries()].map(([k, g]) => ({ [by]: k, total: money(g.total), entries: g.entries, leads: g.leads, meetings: g.meetings, deals_won: g.deals }))
        .sort((a, b) => (by === "month" ? String(a.month).localeCompare(String(b.month)) : b.total - a.total));
      const total = money(rows.reduce((a, r) => a + Number(r.amount), 0));
      return { data: { period: p, grand_total: total, entries: rows.length, groups: list.slice(0, ROW_CAP) }, rows: list.length };
    }
    case "spend_list": {
      const search = clean(input.search, 60).replace(/[%_,()]/g, " ").trim();
      const rows = await spendRows(admin, p.from, p.to, (q) => {
        if (input.channel && (CHANNELS as readonly string[]).includes(String(input.channel))) q = q.eq("channel", String(input.channel));
        if (input.kind === "conference" || input.kind === "other") q = q.eq("kind", input.kind);
        if (search) q = q.or(`title.ilike.%${search}%,vendor.ilike.%${search}%,campaign.ilike.%${search}%,city.ilike.%${search}%`);
        return q.limit(ROW_CAP);
      });
      return { data: { period: p, entries: rows.map(({ id: _id, breakdown: _b, ...r }) => ({ ...r, channel: CHANNEL_LABEL[r.channel] ?? r.channel })) }, rows: rows.length };
    }
    case "conference_scorecard": {
      const rows = await spendRows(admin, p.from, p.to, (q) => q.eq("kind", "conference"));
      const per = (a: number, b: number | null) => (b ? money(a / b) : null);
      const list = rows.map((r) => ({
        conference: r.title, city: r.city, dates: r.end_date && r.end_date !== r.spend_date ? `${r.spend_date} to ${r.end_date}` : r.spend_date,
        total: Number(r.amount), cost_lines: r.breakdown, leads: r.leads, meetings: r.meetings, deals_won: r.deals_won,
        cost_per_lead: per(Number(r.amount), r.leads), cost_per_meeting: per(Number(r.amount), r.meetings), cost_per_deal: per(Number(r.amount), r.deals_won),
      }));
      const tot = list.reduce((a, r) => ({ total: a.total + r.total, leads: a.leads + (r.leads ?? 0), meetings: a.meetings + (r.meetings ?? 0), deals: a.deals + (r.deals_won ?? 0) }), { total: 0, leads: 0, meetings: 0, deals: 0 });
      return { data: { period: p, conferences: list.slice(0, ROW_CAP), totals: { ...tot, total: money(tot.total), cost_per_lead: per(tot.total, tot.leads), cost_per_meeting: per(tot.total, tot.meetings) },
        note: "Leads, meetings and deals are what the team entered; blank means not recorded, not zero." }, rows: list.length };
    }
    case "budget_status": {
      const { data: budgets, error } = await admin.from("milo_budgets").select("period_start,period_end,channel,amount,notes")
        .lte("period_start", p.to).gte("period_end", p.from).order("period_start");
      if (error) throw error;
      const out = [];
      for (const b of budgets ?? []) {
        const rows = await spendRows(admin, b.period_start, b.period_end, (q) => (b.channel ? q.eq("channel", b.channel) : q));
        const spent = money(rows.reduce((a, r) => a + Number(r.amount), 0));
        out.push({ budget_period: `${b.period_start} to ${b.period_end}`, channel: b.channel ? CHANNEL_LABEL[b.channel] ?? b.channel : "All marketing",
          budget: Number(b.amount), spent, remaining: money(Number(b.amount) - spent), percent_used: Number(b.amount) ? Math.round((spent / Number(b.amount)) * 100) : null });
      }
      return { data: { period: p, budgets: out, note: out.length ? undefined : "No budgets are set for this period. Budgets are added in MILO under Budgets." }, rows: out.length };
    }
    case "signup_overview": {
      const { data, error } = await admin.rpc("milo_signup_totals", { p_from: p.from, p_to: p.to });
      if (error) throw error;
      const rows = (data ?? []) as Array<{ month: string; plan: string; channel: string; households: number; monthly_value: number }>;
      const sum = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).reduce((a, r) => a + Number(r.households), 0);
      const spend = money((await spendRows(admin, p.from, p.to)).reduce((a, r) => a + Number(r.amount), 0));
      const selfServe = sum((r) => r.channel === "self_serve"), all = sum(() => true), nonFirm = sum((r) => r.channel !== "firm");
      return {
        data: {
          period: p, households_new: all, by_channel: { self_serve: selfServe, advisor: sum((r) => r.channel === "advisor"), firm: sum((r) => r.channel === "firm") },
          by_plan: Object.fromEntries([...new Set(rows.map((r) => r.plan))].map((pl) => [pl, sum((r) => r.plan === pl)])),
          new_monthly_value: money(rows.reduce((a, r) => a + Number(r.monthly_value), 0)),
          months: rows.map((r) => ({ month: String(r.month).slice(0, 7), plan: r.plan, channel: r.channel, households: Number(r.households) })),
          marketing_spend: spend,
          blended_cost_per_self_serve_signup: selfServe ? money(spend / selfServe) : null,
          blended_cost_per_new_household_excluding_firms: nonFirm ? money(spend / nonFirm) : null,
          caveat: "Blended: total marketing spend divided by signups in the same period. Signups aren't yet tagged with the campaign or conference that brought them.",
        },
        rows: rows.length,
      };
    }
    case "signup_by_campaign": {
      const { data, error } = await admin.rpc("milo_signup_by_campaign", { p_from: p.from, p_to: p.to });
      if (error) throw error;
      const rows = (data ?? []) as Array<{ campaign: string | null; source: string | null; medium: string | null; heard_about: string | null; channel: string; households: number; monthly_value: number }>;
      // Campaign names are matched loosely: "Fall Webinar", "fall-webinar" and "fall_webinar" are one campaign.
      const key = (s: unknown) => String(s ?? "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
      const want = key(clean(input.campaign, 150));
      const spend = await spendRows(admin, p.from, p.to);
      const spendBy = new Map<string, { total: number; entries: number }>();
      for (const r of spend) {
        const k = key(r.campaign);
        if (!k) continue;
        const g = spendBy.get(k) ?? { total: 0, entries: 0 };
        g.total += Number(r.amount); g.entries++;
        spendBy.set(k, g);
      }
      const camp = new Map<string, { campaign: string; households: number; monthly_value: number; sources: Map<string, number> }>();
      const heard = new Map<string, number>();
      let untagged = 0, tagged = 0;
      for (const r of rows) {
        const n = Number(r.households);
        if (r.heard_about) heard.set(r.heard_about, (heard.get(r.heard_about) ?? 0) + n);
        if (!r.campaign && !r.source) { if (!r.heard_about) untagged += n; continue; }
        tagged += n;
        const k = key(r.campaign) || "(no campaign)";
        const g = camp.get(k) ?? { campaign: r.campaign || "(no campaign)", households: 0, monthly_value: 0, sources: new Map() };
        g.households += n; g.monthly_value += Number(r.monthly_value);
        const src = [r.source, r.medium].filter(Boolean).join(" / ") || "(no source)";
        g.sources.set(src, (g.sources.get(src) ?? 0) + n);
        camp.set(k, g);
      }
      let list = [...camp.entries()].map(([k, g]) => {
        const s = spendBy.get(k);
        return {
          campaign: g.campaign, households: g.households, new_monthly_value: money(g.monthly_value),
          sources: Object.fromEntries(g.sources),
          matched_spend: s ? money(s.total) : null, matched_spend_entries: s?.entries ?? 0,
          cost_per_signup: s && g.households ? money(s.total / g.households) : null,
        };
      }).sort((a, b) => b.households - a.households);
      if (want) list = list.filter((c) => key(c.campaign) === want);
      const focusSpend = want ? spendBy.get(want) : undefined;
      return {
        data: {
          period: p, campaigns: list.slice(0, ROW_CAP),
          ...(want && !list.length ? { focus: { campaign: clean(input.campaign, 150), households: 0, matched_spend: focusSpend ? money(focusSpend.total) : null, matched_spend_entries: focusSpend?.entries ?? 0 } } : {}),
          heard_about: Object.fromEntries(heard), households_with_campaign_tags: tagged, households_not_tagged: untagged,
          caveat: "Attributed: a signup counts for a campaign only when it arrived through a link tagged with that campaign. matched_spend is the spend entries whose campaign name matches; null means no spend entry carries that campaign name, so no cost per signup. Untagged signups (advisor, firm, or no link tags) are not in any campaign.",
        },
        rows: list.length,
      };
    }
    case "social_overview": {
      let q = admin.from("milo_social_accounts").select("id,platform,display_name,handle,status,last_sync_at,last_error,token_expires_at").neq("status", "disconnected");
      if (input.platform) q = q.eq("platform", String(input.platform));
      const { data: accts } = await q;
      const out = [];
      for (const a of accts ?? []) {
        const { data: days } = await admin.from("milo_social_daily").select("day,followers,follower_gain,impressions,reach,engagements,clicks,page_views")
          .eq("account_id", a.id).gte("day", p.from).lte("day", p.to).order("day");
        const d = days ?? [];
        const total = (k: string) => d.reduce((s, r) => s + (Number((r as Record<string, unknown>)[k]) || 0), 0);
        const followersNow = [...d].reverse().find((r) => r.followers !== null)?.followers ?? null;
        const followersStart = d.find((r) => r.followers !== null)?.followers ?? null;
        out.push({
          platform: a.platform, account: a.display_name || a.handle, status: a.status, last_sync: a.last_sync_at, sync_note: a.last_error,
          days_with_data: d.length, followers_now: followersNow,
          follower_change: total("follower_gain") || (followersNow !== null && followersStart !== null ? followersNow - followersStart : null),
          impressions_or_views: total("impressions"), reach: total("reach"), engagements: total("engagements"), clicks: total("clicks"), page_views: total("page_views"),
          connection_expires: a.token_expires_at,
        });
      }
      const missing = PLATFORMS.filter((pl) => !(accts ?? []).some((a) => a.platform === pl) && (!input.platform || input.platform === pl));
      return { data: { period: p, accounts: out, not_connected: missing, note: "Reach summed over days counts the same person more than once." }, rows: out.length };
    }
    case "social_top_posts": {
      const metric = ["reach", "impressions", "likes", "comments", "saves", "shares"].includes(String(input.metric)) ? String(input.metric) : "reach";
      let aq = admin.from("milo_social_accounts").select("id,platform,display_name").neq("status", "disconnected");
      if (input.platform) aq = aq.eq("platform", String(input.platform));
      const { data: accts } = await aq;
      if (!accts?.length) return { data: { posts: [], note: "No social accounts are connected yet." }, rows: 0 };
      const { data } = await admin.from("milo_social_posts").select("account_id,posted_at,caption,permalink,media_type,impressions,reach,likes,comments,shares,saves")
        .in("account_id", accts.map((a) => a.id)).gte("posted_at", `${p.from}T00:00:00Z`).lte("posted_at", `${p.to}T23:59:59Z`)
        .order(metric, { ascending: false, nullsFirst: false }).limit(10);
      const name = new Map(accts.map((a) => [a.id, `${a.platform}: ${a.display_name ?? ""}`]));
      return { data: { period: p, metric, posts: (data ?? []).map(({ account_id, ...r }) => ({ account: name.get(account_id), ...r })) }, rows: data?.length ?? 0 };
    }
    case "marketing_pages": {
      const slug = clean(input.slug, 60).toLowerCase();
      if (slug) {
        const { data } = await admin.from("milo_pages").select("slug,title,url,body,loaded_at").eq("slug", slug).maybeSingle();
        return { data: data ? { ...data, body: data.body.slice(0, 12000) } : { error: "No page with that name." }, rows: data ? 1 : 0 };
      }
      const { data: pages } = await admin.from("milo_pages").select("slug,title,url,body,loaded_at").order("slug");
      const query = clean(input.query, 100).toLowerCase();
      if (!query) return { data: { pages: (pages ?? []).map(({ body, ...r }) => ({ ...r, words: body.split(/\s+/).length })) }, rows: pages?.length ?? 0 };
      const words = query.split(/\s+/).filter((w) => w.length > 2);
      const hits = [];
      for (const pg of pages ?? []) {
        const paras = pg.body.split(/\n{2,}/);
        for (const para of paras) {
          const l = para.toLowerCase();
          const score = words.filter((w) => l.includes(w)).length;
          if (score) hits.push({ page: pg.title, slug: pg.slug, score, passage: para.slice(0, 700) });
        }
      }
      hits.sort((a, b) => b.score - a.score);
      return { data: { query, passages: hits.slice(0, 8), pages: (pages ?? []).map((x) => x.slug) }, rows: Math.min(hits.length, 8) };
    }
  }
  throw new Error(`unknown tool ${name}`);
}
