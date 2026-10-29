// supabase/functions/app-access-check/index.ts
// Checks an app access code ("license number") for the iPhone / Android test builds (migration 20261029140000).
// The native app calls this before its sign-in screen, and again on each launch so a revoked code locks the app.
//
// AUTH: verify_jwt is false on purpose: it runs before anyone has signed in. It reveals nothing but yes / no, only a
// SHA-256 hash of each code is stored, and a wrong code is answered slowly so guessing is impractical.
//
// POST { code }  ->  200 { ok: true, label } | 403 { ok: false }
// Deploy: supabase functions deploy app-access-check --project-ref <ref> --use-api --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// "ord-abcd efgh-jkmn" -> "ABCDEFGHJKMN": letters and digits only, upper case, without the ORD prefix.
function normalize(input: unknown): string {
  let s = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length === 15 && s.startsWith("ORD")) s = s.slice(3);
  return s;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const refuse = async () => { await new Promise((r) => setTimeout(r, 800)); return json({ ok: false }, 403); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false }, 405);
  let body: { code?: unknown } = {};
  try { body = await req.json(); } catch (_e) { return refuse(); }
  const code = normalize(body.code);
  if (code.length !== 12) return refuse();

  const { data, error } = await sb.from("app_access_codes").select("id, label, active, use_count")
    .eq("code_hash", await sha256Hex(code)).maybeSingle();
  if (error) { console.error("app-access-check:", error.message); return json({ ok: false, error: "Could not check the code right now." }, 500); }
  if (!data || !data.active) return refuse();

  await sb.from("app_access_codes").update({ last_used_at: new Date().toISOString(), use_count: (data.use_count ?? 0) + 1 })
    .eq("id", data.id);
  return json({ ok: true, label: data.label });
});
