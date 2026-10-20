// MILO social connectors: Instagram (Instagram API with Instagram Login) and LinkedIn (Community
// Management API, company pages). Shared by milo-social (the OAuth callback) and milo-command
// (starting a connection, the daily sync, disconnect).
//
// SECURITY
// - App ids/secrets come from function secrets only (set by Will, never in the repo or chat).
// - Access and refresh tokens go straight into Vault (milo_vault_put); the tables keep only the
//   Vault ids. Tokens are never returned to the browser, logged, or written to audit_log.
// - Only fixed platform hosts are ever called (graph.instagram.com, api.instagram.com,
//   www.linkedin.com, api.linkedin.com). Nothing from a stored row or a response picks a host.
// - Read-only scopes: MILO reads analytics; it never posts, comments or changes a profile.
//
// The platforms change metric names from time to time. Each metric is fetched separately where it
// matters, so one retired metric doesn't sink the whole sync; failures land in last_error.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

export type Platform = "instagram" | "linkedin";
export const PLATFORMS: Platform[] = ["instagram", "linkedin"];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const IG_APP_ID = Deno.env.get("META_IG_APP_ID") ?? "";
const IG_APP_SECRET = Deno.env.get("META_IG_APP_SECRET") ?? "";
const IG_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v23.0";
const LI_CLIENT_ID = Deno.env.get("LINKEDIN_CLIENT_ID") ?? "";
const LI_CLIENT_SECRET = Deno.env.get("LINKEDIN_CLIENT_SECRET") ?? "";
const LI_VERSION = Deno.env.get("LINKEDIN_API_VERSION") || "202509";

const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_insights"];
const LI_SCOPES = ["r_organization_social", "rw_organization_admin", "r_organization_followers"];

// Where each platform sends the browser back. Register these exact URLs in each developer app.
export const redirectUri = (p: Platform) => `${SUPABASE_URL}/functions/v1/milo-social/callback/${p}`;

export function configured(p: Platform): boolean {
  return p === "instagram" ? !!(IG_APP_ID && IG_APP_SECRET) : !!(LI_CLIENT_ID && LI_CLIENT_SECRET);
}

export function authorizeUrl(p: Platform, state: string): string {
  if (p === "instagram") {
    const u = new URL("https://www.instagram.com/oauth/authorize");
    u.searchParams.set("client_id", IG_APP_ID);
    u.searchParams.set("redirect_uri", redirectUri(p));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", IG_SCOPES.join(","));
    u.searchParams.set("state", state);
    return u.toString();
  }
  const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", LI_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUri(p));
  u.searchParams.set("scope", LI_SCOPES.join(" "));
  u.searchParams.set("state", state);
  return u.toString();
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────────
class PlatformError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
// Platform error bodies can echo request details; keep only a short, token-free message.
const scrub = (s: string) => s.replace(/(access_token|client_secret|refresh_token|code)=[^&\s"]+/gi, "$1=***").slice(0, 200);

async function getJson(url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = (body.error as Record<string, unknown>)?.message ?? body.message ?? text;
    throw new PlatformError(res.status, scrub(String(err)));
  }
  return body;
}
async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(form) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new PlatformError(res.status, scrub(String(body.error_description ?? body.error_message ?? (body.error as Record<string, unknown>)?.message ?? body.error ?? text)));
  return body;
}
const n = (v: unknown): number | null => { const x = Number(v); return Number.isFinite(x) ? Math.round(x) : null; };
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// ── Connecting (code -> tokens -> accounts) ─────────────────────────────────────────
export type Connected = { platform: Platform; external_id: string; display_name: string | null; handle: string | null };

export async function completeConnection(admin: SupabaseClient, p: Platform, code: string, userId: string): Promise<Connected[]> {
  if (p === "instagram") {
    const short = await postForm("https://api.instagram.com/oauth/access_token", {
      client_id: IG_APP_ID, client_secret: IG_APP_SECRET, grant_type: "authorization_code", redirect_uri: redirectUri(p), code,
    });
    const shortToken = String(short.access_token ?? "");
    if (!shortToken) throw new Error("Instagram didn't return a token.");
    // Swap the one-hour token for a 60-day one.
    const long = await getJson(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(IG_APP_SECRET)}&access_token=${encodeURIComponent(shortToken)}`);
    const token = String(long.access_token ?? "");
    if (!token) throw new Error("Instagram didn't return a long-lived token.");
    const me = await getJson(`https://graph.instagram.com/${IG_VERSION}/me?fields=user_id,username,name,account_type&access_token=${encodeURIComponent(token)}`);
    const igId = String(me.user_id ?? me.id ?? "");
    if (!igId) throw new Error("Couldn't read the Instagram account.");
    if (me.account_type && !["BUSINESS", "MEDIA_CREATOR"].includes(String(me.account_type))) {
      throw new Error("That Instagram account is personal. Switch it to a Business or Creator account in Instagram, then connect again.");
    }
    const acct: Connected = { platform: p, external_id: igId, display_name: me.name ? String(me.name) : null, handle: me.username ? `@${me.username}` : null };
    await saveAccount(admin, acct, token, null, n(long.expires_in), IG_SCOPES, userId);
    return [acct];
  }
  const tok = await postForm("https://www.linkedin.com/oauth/v2/accessToken", {
    grant_type: "authorization_code", code, redirect_uri: redirectUri(p), client_id: LI_CLIENT_ID, client_secret: LI_CLIENT_SECRET,
  });
  const token = String(tok.access_token ?? "");
  if (!token) throw new Error("LinkedIn didn't return a token.");
  const refresh = tok.refresh_token ? String(tok.refresh_token) : null;
  const acls = await liGet(token, "/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED");
  const orgUrns = ((acls.elements as Array<Record<string, unknown>>) ?? [])
    .map((e) => String(e.organization ?? e.organizationTarget ?? "")).filter((u) => /^urn:li:organization:\d+$/.test(u));
  if (!orgUrns.length) throw new Error("This LinkedIn login isn't an admin of any company page.");
  const out: Connected[] = [];
  for (const urn of [...new Set(orgUrns)].slice(0, 5)) {
    const id = urn.split(":").pop()!;
    const org = await liGet(token, `/rest/organizations/${id}`).catch(() => ({} as Record<string, unknown>));
    const acct: Connected = { platform: p, external_id: urn, display_name: org.localizedName ? String(org.localizedName) : null, handle: org.vanityName ? String(org.vanityName) : null };
    await saveAccount(admin, acct, token, refresh, n(tok.expires_in), LI_SCOPES, userId);
    out.push(acct);
  }
  return out;
}

async function saveAccount(admin: SupabaseClient, a: Connected, token: string, refresh: string | null, expiresIn: number | null, scopes: string[], userId: string) {
  const key = `${a.platform}:${a.external_id.replace(/[^a-z0-9:-]/gi, "")}`.toLowerCase().slice(0, 100);
  const { data: tokenId, error: e1 } = await admin.rpc("milo_vault_put", { p_name: `milo_social_${key}`, p_secret: token });
  if (e1 || !tokenId) throw new Error("Couldn't store the connection securely.");
  let refreshId: string | null = null;
  if (refresh) {
    const { data, error } = await admin.rpc("milo_vault_put", { p_name: `milo_social_${key}:refresh`, p_secret: refresh });
    if (error) throw new Error("Couldn't store the connection securely.");
    refreshId = data as string;
  }
  const { error } = await admin.from("milo_social_accounts").upsert({
    platform: a.platform, external_id: a.external_id, display_name: a.display_name, handle: a.handle, status: "connected",
    token_secret_id: tokenId, refresh_secret_id: refreshId,
    token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes, connected_by: userId, connected_at: new Date().toISOString(), last_error: null,
  }, { onConflict: "platform,external_id" });
  if (error) throw new Error("Couldn't save the connected account.");
}

export async function disconnect(admin: SupabaseClient, accountId: string) {
  const { data: a } = await admin.from("milo_social_accounts").select("id,token_secret_id,refresh_secret_id").eq("id", accountId).maybeSingle();
  if (!a) return false;
  // Another LinkedIn page may share the same token; only drop secrets nobody else points at.
  for (const sid of [a.token_secret_id, a.refresh_secret_id].filter(Boolean)) {
    const { count } = await admin.from("milo_social_accounts").select("id", { count: "exact", head: true })
      .neq("id", accountId).or(`token_secret_id.eq.${sid},refresh_secret_id.eq.${sid}`);
    if (!count) await admin.rpc("milo_vault_drop", { p_id: sid });
  }
  await admin.from("milo_social_accounts").update({ status: "disconnected", token_secret_id: null, refresh_secret_id: null, token_expires_at: null }).eq("id", accountId);
  return true;
}

// ── LinkedIn REST ─────────────────────────────────────────────────────────────────
function liGet(token: string, path: string) {
  return getJson(`https://api.linkedin.com${path}`, {
    Authorization: `Bearer ${token}`, "LinkedIn-Version": LI_VERSION, "X-Restli-Protocol-Version": "2.0.0",
  });
}
const liRange = (from: Date, to: Date) => `(timeRange:(start:${from.getTime()},end:${to.getTime()}),timeGranularityType:DAY)`;

// ── Daily sync ────────────────────────────────────────────────────────────────────
type Account = { id: string; platform: Platform; external_id: string; token_secret_id: string | null; refresh_secret_id: string | null; token_expires_at: string | null };
type SyncResult = { account: string; platform: Platform; ok: boolean; days: number; posts: number; notes: string[] };

export async function syncAccount(admin: SupabaseClient, a: Account, days = 30): Promise<SyncResult> {
  const r: SyncResult = { account: a.id, platform: a.platform, ok: true, days: 0, posts: 0, notes: [] };
  const fail = async (msg: string, status: "error" | "expired" = "error") => {
    r.ok = false; r.notes.push(msg);
    await admin.from("milo_social_accounts").update({ status, last_error: msg.slice(0, 300) }).eq("id", a.id);
    return r;
  };
  if (!a.token_secret_id) return fail("Not connected.");
  let token = (await admin.rpc("milo_vault_get", { p_id: a.token_secret_id })).data as string | null;
  if (!token) return fail("The stored connection is missing. Connect again.");
  token = await refreshIfDue(admin, a, token).catch(() => token);
  if (a.token_expires_at && Date.parse(a.token_expires_at) < Date.now()) return fail("The connection expired. Connect again.", "expired");

  const to = new Date(); to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to.getTime() - days * 86_400_000);
  const rows = new Map<string, Record<string, unknown>>();
  const row = (day: string) => { if (!rows.has(day)) rows.set(day, { account_id: a.id, day, updated_at: new Date().toISOString() }); return rows.get(day)!; };

  try {
    if (a.platform === "instagram") {
      const base = `https://graph.instagram.com/${IG_VERSION}`;
      const tk = `access_token=${encodeURIComponent(token)}`;
      const me = await getJson(`${base}/me?fields=followers_count,media_count&${tk}`);
      row(isoDay(new Date())).followers = n(me.followers_count);
      // Daily account metrics (Instagram allows up to 30 days per request). Fetched one by one.
      const since = Math.floor(from.getTime() / 1000), until = Math.floor(to.getTime() / 1000);
      const metrics: Array<[string, string, boolean]> = [ // [platform metric, our column, total_value style]
        ["reach", "reach", false], ["views", "impressions", true], ["accounts_engaged", "engagements", true],
        ["profile_links_taps", "clicks", true], ["follower_count", "follower_gain", false],
      ];
      for (const [metric, col, total] of metrics) {
        try {
          if (total) {
            // total_value metrics come back as one number per request, so ask day by day for the last 7 days.
            for (let d = 1; d <= Math.min(days, 7); d++) {
              const s = Math.floor((to.getTime() - d * 86_400_000) / 1000);
              const j = await getJson(`${base}/${a.external_id}/insights?metric=${metric}&period=day&metric_type=total_value&since=${s}&until=${s + 86_400}&${tk}`);
              const v = ((j.data as Array<Record<string, unknown>>)?.[0]?.total_value as Record<string, unknown>)?.value;
              if (v !== undefined) row(isoDay(new Date(s * 1000)))[col] = n(v);
            }
          } else {
            const j = await getJson(`${base}/${a.external_id}/insights?metric=${metric}&period=day&since=${since}&until=${until}&${tk}`);
            for (const pt of ((j.data as Array<Record<string, unknown>>)?.[0]?.values as Array<Record<string, unknown>>) ?? []) {
              const day = String(pt.end_time ?? "").slice(0, 10);
              if (/^\d{4}-\d{2}-\d{2}$/.test(day)) row(day)[col] = n(pt.value);
            }
          }
        } catch (e) { r.notes.push(`${metric}: ${(e as Error).message}`); }
      }
      // Recent posts with their own numbers.
      const media = await getJson(`${base}/me/media?fields=id,caption,media_type,permalink,timestamp,like_count,comments_count&limit=25&${tk}`);
      for (const m of (media.data as Array<Record<string, unknown>>) ?? []) {
        const post: Record<string, unknown> = {
          account_id: a.id, external_id: String(m.id), posted_at: m.timestamp ?? null, caption: m.caption ? String(m.caption).slice(0, 400) : null,
          permalink: m.permalink ? String(m.permalink).slice(0, 500) : null, media_type: m.media_type ? String(m.media_type) : null,
          likes: n(m.like_count), comments: n(m.comments_count), updated_at: new Date().toISOString(),
        };
        try {
          const ins = await getJson(`${base}/${m.id}/insights?metric=reach,views,saved,shares&${tk}`);
          for (const d of (ins.data as Array<Record<string, unknown>>) ?? []) {
            const v = n((d.values as Array<Record<string, unknown>>)?.[0]?.value ?? (d.total_value as Record<string, unknown>)?.value);
            if (d.name === "reach") post.reach = v; else if (d.name === "views") post.impressions = v;
            else if (d.name === "saved") post.saves = v; else if (d.name === "shares") post.shares = v;
          }
        } catch { /* some media types (stories, older posts) have no insights */ }
        const { error } = await admin.from("milo_social_posts").upsert(post, { onConflict: "account_id,external_id" });
        if (!error) r.posts++;
      }
    } else {
      const urn = a.external_id;
      const enc = encodeURIComponent(urn);
      const net = await liGet(token, `/rest/networkSizes/${enc}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`).catch((e) => { r.notes.push(`followers: ${e.message}`); return {} as Record<string, unknown>; });
      if (net.firstDegreeSize !== undefined) row(isoDay(new Date())).followers = n(net.firstDegreeSize);
      const range = liRange(from, to);
      try {
        const s = await liGet(token, `/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc}&timeIntervals=${range}`);
        for (const el of (s.elements as Array<Record<string, unknown>>) ?? []) {
          const day = isoDay(new Date(Number((el.timeRange as Record<string, unknown>)?.start)));
          const t = (el.totalShareStatistics ?? {}) as Record<string, unknown>;
          const rw = row(day);
          rw.impressions = n(t.impressionCount); rw.reach = n(t.uniqueImpressionsCount); rw.clicks = n(t.clickCount);
          rw.engagements = (n(t.likeCount) ?? 0) + (n(t.commentCount) ?? 0) + (n(t.shareCount) ?? 0) + (n(t.clickCount) ?? 0);
        }
      } catch (e) { r.notes.push(`share statistics: ${(e as Error).message}`); }
      try {
        const f = await liGet(token, `/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${enc}&timeIntervals=${range}`);
        for (const el of (f.elements as Array<Record<string, unknown>>) ?? []) {
          const day = isoDay(new Date(Number((el.timeRange as Record<string, unknown>)?.start)));
          const g = (el.followerGains ?? {}) as Record<string, unknown>;
          row(day).follower_gain = (n(g.organicFollowerGain) ?? 0) + (n(g.paidFollowerGain) ?? 0);
        }
      } catch (e) { r.notes.push(`follower statistics: ${(e as Error).message}`); }
      try {
        const pg = await liGet(token, `/rest/organizationPageStatistics?q=organization&organization=${enc}&timeIntervals=${range}`);
        for (const el of (pg.elements as Array<Record<string, unknown>>) ?? []) {
          const day = isoDay(new Date(Number((el.timeRange as Record<string, unknown>)?.start)));
          const views = (((el.totalPageStatistics as Record<string, unknown>)?.views as Record<string, unknown>)?.allPageViews as Record<string, unknown>)?.pageViews;
          row(day).page_views = n(views);
        }
      } catch (e) { r.notes.push(`page statistics: ${(e as Error).message}`); }
      // Recent posts (text only; post-level numbers for LinkedIn come in a later phase).
      try {
        const posts = await liGet(token, `/rest/posts?author=${enc}&q=author&count=20`);
        for (const p of (posts.elements as Array<Record<string, unknown>>) ?? []) {
          const { error } = await admin.from("milo_social_posts").upsert({
            account_id: a.id, external_id: String(p.id).slice(0, 200), posted_at: p.publishedAt ? new Date(Number(p.publishedAt)).toISOString() : null,
            caption: p.commentary ? String(p.commentary).slice(0, 400) : null, media_type: p.content ? Object.keys(p.content as object)[0] ?? null : "text",
            updated_at: new Date().toISOString(),
          }, { onConflict: "account_id,external_id" });
          if (!error) r.posts++;
        }
      } catch (e) { r.notes.push(`posts: ${(e as Error).message}`); }
    }
  } catch (e) {
    const err = e as PlatformError;
    return fail(err.status === 401 || err.status === 190 ? "The connection was revoked or expired. Connect again." : `Sync failed: ${err.message}`, err.status === 401 ? "expired" : "error");
  }

  if (rows.size) {
    // Merge with what's stored, so a metric that failed today doesn't blank an earlier value.
    const list = [...rows.values()];
    const { data: old } = await admin.from("milo_social_daily").select("*").eq("account_id", a.id).in("day", list.map((x) => x.day as string));
    const prev = new Map((old ?? []).map((o) => [o.day, o]));
    const merged = list.map((x) => {
      const o = prev.get(x.day as string) ?? {};
      const out: Record<string, unknown> = { ...o, ...Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null && v !== undefined)) };
      return out;
    });
    const { error } = await admin.from("milo_social_daily").upsert(merged, { onConflict: "account_id,day" });
    if (error) r.notes.push(`save: ${error.message}`); else r.days = merged.length;
  }
  r.ok = r.ok && r.days + r.posts > 0;
  await admin.from("milo_social_accounts").update({
    status: "connected", last_sync_at: new Date().toISOString(), last_error: r.notes.length ? r.notes.join(" · ").slice(0, 300) : null,
  }).eq("id", a.id);
  return r;
}

// Instagram long-lived tokens refresh for another 60 days; LinkedIn refreshes only when the app was
// granted refresh tokens. Refresh when under 10 days remain.
async function refreshIfDue(admin: SupabaseClient, a: Account, token: string): Promise<string> {
  if (!a.token_expires_at || Date.parse(a.token_expires_at) - Date.now() > 10 * 86_400_000) return token;
  let next = "", expiresIn: number | null = null;
  if (a.platform === "instagram") {
    const j = await getJson(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
    next = String(j.access_token ?? ""); expiresIn = n(j.expires_in);
  } else {
    if (!a.refresh_secret_id) return token;
    const refresh = (await admin.rpc("milo_vault_get", { p_id: a.refresh_secret_id })).data as string | null;
    if (!refresh) return token;
    const j = await postForm("https://www.linkedin.com/oauth/v2/accessToken", { grant_type: "refresh_token", refresh_token: refresh, client_id: LI_CLIENT_ID, client_secret: LI_CLIENT_SECRET });
    next = String(j.access_token ?? ""); expiresIn = n(j.expires_in);
  }
  if (!next) return token;
  const { data: name } = await admin.from("milo_social_accounts").select("platform,external_id").eq("id", a.id).maybeSingle();
  const key = `${name?.platform}:${String(name?.external_id ?? "").replace(/[^a-z0-9:-]/gi, "")}`.toLowerCase().slice(0, 100);
  await admin.rpc("milo_vault_put", { p_name: `milo_social_${key}`, p_secret: next });
  const expires = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  await admin.from("milo_social_accounts").update({ token_expires_at: expires }).eq("token_secret_id", a.token_secret_id);
  a.token_expires_at = expires;
  return next;
}

// Every connected account whose last sync is older than `staleHours`.
export async function syncAll(admin: SupabaseClient, staleHours = 20) {
  const cutoff = new Date(Date.now() - staleHours * 3_600_000).toISOString();
  const { data } = await admin.from("milo_social_accounts").select("id,platform,external_id,token_secret_id,refresh_secret_id,token_expires_at")
    .in("status", ["connected", "error"]).or(`last_sync_at.is.null,last_sync_at.lt.${cutoff}`).limit(20);
  const out: SyncResult[] = [];
  for (const a of (data ?? []) as Account[]) out.push(await syncAccount(admin, a).catch((e) => ({ account: a.id, platform: a.platform, ok: false, days: 0, posts: 0, notes: [String((e as Error).message).slice(0, 200)] })));
  return out;
}
