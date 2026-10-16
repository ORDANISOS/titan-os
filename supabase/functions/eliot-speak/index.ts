// eliot-speak: turns one sentence of an ELIOT reply into natural speech (ElevenLabs) and streams
// the audio back to the app. Separate from hub-command so voice can change without touching it.
//
// SECURITY
// - Same gate as hub-command: signed in, MFA (aal2), and role 'admin'. Checked on every call.
// - The ElevenLabs key is a server secret (ELEVENLABS_API_KEY); the browser never sees it.
// - Text only: up to 600 characters per call (the app sends one sentence at a time). Nothing is
//   stored here; the text being spoken is already in audit_log as the answer it came from.
// - Data: the text goes to ElevenLabs to be voiced. Set ELEVENLABS_ZERO_RETENTION=1 once the
//   ElevenLabs plan supports zero-retention mode, so they keep nothing.
//
// Settings (Supabase secrets): ELEVENLABS_API_KEY (required), ELEVENLABS_VOICE_ID (default "George",
// a composed British male voice), ELEVENLABS_MODEL (default eleven_turbo_v2_5), ELEVENLABS_ZERO_RETENTION.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") || "JBFqnCBsd6RMkjVDRZzb"; // "George"
const MODEL_ID = Deno.env.get("ELEVENLABS_MODEL") || "eleven_turbo_v2_5";
const ZERO_RETENTION = Deno.env.get("ELEVENLABS_ZERO_RETENTION") === "1";
const MAX_CHARS = 600;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function jwtClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(b64));
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // 503 tells the app to fall back to the device's own voice.
  if (!ELEVENLABS_API_KEY) return json({ error: "natural voice not configured" }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Please sign in." }, 401);
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return json({ error: "Please sign in again." }, 401);
  if (jwtClaims(token).aal !== "aal2") return json({ error: "mfa required" }, 403);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: prof } = await admin.from("user_profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin" || prof?.active === false) return json({ error: "admins only" }, 403);

  const payload = await req.json().catch(() => null);
  const text = String(payload?.text ?? "").replace(/[*#_`<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!text) return json({ error: "no text" }, 400);

  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE_ID)}/stream`);
  url.searchParams.set("output_format", "mp3_44100_128");
  if (ZERO_RETENTION) url.searchParams.set("enable_logging", "false");
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      // Composed and steady, with a little warmth.
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!upstream.ok || !upstream.body) {
    console.error("elevenlabs error", upstream.status, (await upstream.text().catch(() => "")).slice(0, 300));
    return json({ error: "voice service unavailable" }, 502);
  }
  return new Response(upstream.body, { headers: { ...corsHeaders, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
});
