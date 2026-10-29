// milo-social: where Instagram and LinkedIn send the browser back after the admin signs in there
// (OAuth callback). GET /functions/v1/milo-social/callback/{instagram|linkedin}?code=…&state=…
//
// SECURITY
// - No Supabase session arrives here (the platforms redirect the browser), so JWT verification is
//   off for this function (config.toml). Protection is the one-time `state`: milo-command created it
//   for a signed-in, MFA-verified admin, it lives 10 minutes, matches one platform, and is deleted on
//   first use. Without a valid state nothing is exchanged or stored.
// - The browser is only ever sent back to the return address stored with the state, and that address
//   was checked against MILO_APP_ORIGINS when the state was created.
// - Tokens go to Vault (providers.ts). The redirect carries only "connected" or a short error word.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { completeConnection, syncAll, type Platform, PLATFORMS } from "./providers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ENVIRONMENT = SUPABASE_URL.includes("tkryueqzvgcigvxgjzsp") ? "demo" : SUPABASE_URL.includes("xreeruxuwtmjhvvxvjts") ? "production" : "other";

const page = (msg: string, status = 400) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>MILO</title><body style="font-family:Arial,sans-serif;background:#F8F6F1;color:#0A2540;padding:40px"><h1 style="font-family:Georgia,serif;font-weight:400">MILO</h1><p>${msg}</p><p>You can close this tab.</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" } });

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const m = url.pathname.match(/\/callback\/(instagram|linkedin)\/?$/);
  if (!m) return page("This address only receives Instagram and LinkedIn sign-ins for MILO.", 404);
  const platform = m[1] as Platform;
  if (!PLATFORMS.includes(platform)) return page("Unknown platform.", 404);

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const denied = url.searchParams.get("error");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) return page("This sign-in link isn't valid. Start again from MILO.");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  // One-time use: delete and read in one step, so a replayed callback finds nothing.
  const { data: st } = await admin.from("milo_oauth_states").delete().eq("state", state).select("user_id,platform,return_to,created_at").maybeSingle();
  if (!st || st.platform !== platform || Date.parse(st.created_at) < Date.now() - 10 * 60_000) {
    return page("This sign-in link has expired or was already used. Start again from MILO.");
  }
  const back = (q: string) => Response.redirect(`${st.return_to.replace(/\/$/, "")}/?${q}`, 302);

  const audit = async (status: string, summary: string, error: string | null) => {
    await admin.from("audit_log").insert({
      request_id: crypto.randomUUID(), source: "milo", module: "social", command: `[${platform} connect]`,
      user_id: st.user_id, user_role: "admin", status, error, result_summary: summary, tool_calls: [], environment: ENVIRONMENT,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    });
  };

  if (denied || !code) {
    await audit("error", "Sign-in was canceled on the platform.", String(denied ?? "no code").slice(0, 100));
    return back(`social_error=${platform}-cancelled`);
  }
  try {
    const accounts = await completeConnection(admin, platform, code, st.user_id);
    await audit("ok", `Connected ${accounts.map((a) => a.display_name || a.handle || "account").join(", ")}.`.slice(0, 500), null);
    // First sync in the background so the numbers are there when the admin looks.
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(syncAll(admin, 0).catch((e) => console.error("first sync failed", String(e?.message ?? e))));
    return back(`connected=${platform}`);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 200);
    console.error("connect failed", platform, msg);
    await audit("error", "Connection failed.", msg);
    return back(`social_error=${platform}-failed&reason=${encodeURIComponent(msg.slice(0, 120))}`);
  }
});
