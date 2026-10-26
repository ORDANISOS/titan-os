// Zoom meetings for the executive assistant (ORDANIS's Zoom account, Server-to-Server OAuth app "ELIOT").
//
// Used only when a confirmed calendar draft books, moves or cancels a meeting with a Zoom link. Meetings are
// created for one Zoom user (ZOOM_USER_EMAIL, default info@ordanisos.com, the ORDANIS Zoom login) with the waiting room on, so nobody
// joins before the host lets them in. The app's scopes should be limited to meeting read/create/update/delete.

const ZOOM_ACCOUNT_ID = Deno.env.get("ZOOM_ACCOUNT_ID") ?? "";
const ZOOM_CLIENT_ID = Deno.env.get("ZOOM_CLIENT_ID") ?? "";
const ZOOM_CLIENT_SECRET = Deno.env.get("ZOOM_CLIENT_SECRET") ?? "";
const ZOOM_USER = Deno.env.get("ZOOM_USER_EMAIL") || "info@ordanisos.com";
const API = "https://api.zoom.us/v2";

export const zoomConfigured = () => !!(ZOOM_ACCOUNT_ID && ZOOM_CLIENT_ID && ZOOM_CLIENT_SECRET);

// Zoom's own meeting ID from a join link (https://us06web.zoom.us/j/81234567890?pwd=…), for moves and cancels.
export const zoomIdFrom = (url: string | null | undefined) => /^https:\/\/([a-z0-9-]+\.)*zoom\.us\/j\/(\d{9,12})/i.exec(String(url ?? ""))?.[2] ?? null;

let cached: { token: string; until: number } | null = null;
async function token(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`, {
    method: "POST", headers: { Authorization: `Basic ${btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`)}` },
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== "string") throw new Error(`zoom token ${res.status}`);
  cached = { token: body.access_token, until: Date.now() + (Number(body.expires_in) || 3600) * 1000 - 120_000 };
  return cached.token;
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: out as Record<string, unknown> };
}

// startWall is Eastern wall clock "YYYY-MM-DDTHH:MM:SS".
export async function zoomCreate(topic: string, startWall: string, minutes: number) {
  const r = await call("POST", `/users/${encodeURIComponent(ZOOM_USER)}/meetings`, {
    topic: topic.slice(0, 200), type: 2, start_time: startWall, timezone: "America/New_York", duration: minutes,
    settings: { waiting_room: true, join_before_host: false, mute_upon_entry: true },
  });
  if (r.status === 404) throw new Error(`zoom user missing: ${ZOOM_USER}`);
  if (!r.ok || typeof r.body.join_url !== "string") throw new Error(`zoom create ${r.status}`);
  return { id: String(r.body.id), join_url: r.body.join_url as string, passcode: typeof r.body.password === "string" ? r.body.password : "" };
}

export async function zoomMove(id: string, startWall: string, minutes: number) {
  const r = await call("PATCH", `/meetings/${encodeURIComponent(id)}`, { start_time: startWall, timezone: "America/New_York", duration: minutes });
  return r.ok;
}

export async function zoomDelete(id: string) {
  const r = await call("DELETE", `/meetings/${encodeURIComponent(id)}?schedule_for_reminder=false`);
  return r.ok || r.status === 404;
}

// For the Calendar panel: can ELIOT sign in to Zoom with the saved app details? Yes or no only.
export async function zoomCheck(): Promise<boolean | null> {
  if (!zoomConfigured()) return null;
  try { await token(); return true; } catch { return false; }
}
