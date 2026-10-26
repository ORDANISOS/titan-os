// eliot-listen: turns one short spoken command, recorded in the ELIOT app, into text (ElevenLabs
// speech-to-text). Used on iPhone and iPad, where the browser's own speech recognition starts but
// never returns words in Home Screen apps. The app then sends the text to hub-command as usual.
//
// SECURITY
// - Same gate as hub-command and eliot-speak: signed in, MFA (aal2), and role 'admin'. Checked on every call.
// - The ElevenLabs key is a server secret (ELEVENLABS_API_KEY); the browser never sees it.
// - Audio only, at most 3 MB (about a minute), at most 20 per minute per person. Nothing is stored:
//   the recording is passed to ElevenLabs and dropped. The text is logged by hub-command as the
//   command it becomes; here only the fact of a transcription is audit-logged, never the words.
// - Data: the audio goes to ElevenLabs to be transcribed. Set ELEVENLABS_ZERO_RETENTION=1 once the
//   ElevenLabs plan supports zero-retention mode, so they keep nothing.
//
// Settings (Supabase secrets): ELEVENLABS_API_KEY (required; the key needs speech-to-text access),
// ELEVENLABS_STT_MODEL (default scribe_v1), ELEVENLABS_ZERO_RETENTION.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const STT_MODEL = Deno.env.get("ELEVENLABS_STT_MODEL") || "scribe_v1";
const ZERO_RETENTION = Deno.env.get("ELEVENLABS_ZERO_RETENTION") === "1";
const MAX_BYTES = 3 * 1024 * 1024;
const PER_MINUTE = 20;
const AUDIO_TYPES = /^audio\/(mp4|m4a|x-m4a|aac|webm|ogg|mpeg|wav|x-wav)(;|$)/i;

const ENVIRONMENT = SUPABASE_URL.includes("tkryueqzvgcigvxgjzsp") ? "demo" : SUPABASE_URL.includes("xreeruxuwtmjhvvxvjts") ? "production" : "other";

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
  // 503 tells the app listening isn't available here, so it suggests typing. Only signed-in admins learn this.
  if (!ELEVENLABS_API_KEY) return json({ error: "Voice listening isn't set up on this site yet. Type your question instead." }, 503);

  const { count } = await admin.from("audit_log").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("module", "listen").gte("created_at", new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) >= PER_MINUTE) return json({ error: "That's a lot of voice commands in a minute. Give it a moment." }, 429);

  const type = (req.headers.get("content-type") ?? "").trim();
  if (!AUDIO_TYPES.test(type)) return json({ error: "That recording format isn't supported." }, 415);
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return json({ error: "That recording is too long. Keep commands under a minute." }, 413);
  const audio = new Uint8Array(await req.arrayBuffer());
  if (audio.length > MAX_BYTES) return json({ error: "That recording is too long. Keep commands under a minute." }, 413);
  if (audio.length < 1000) return json({ text: "" });

  const ext = /mp4|m4a|aac/i.test(type) ? "m4a" : /webm/i.test(type) ? "webm" : /ogg/i.test(type) ? "ogg" : /wav/i.test(type) ? "wav" : "mp3";
  const form = new FormData();
  form.append("model_id", STT_MODEL);
  form.append("language_code", "en");
  form.append("tag_audio_events", "false");
  form.append("file", new Blob([audio], { type: type.split(";")[0] }), `command.${ext}`);
  const url = new URL("https://api.elevenlabs.io/v1/speech-to-text");
  if (ZERO_RETENTION) url.searchParams.set("enable_logging", "false");
  const started = Date.now();
  const upstream = await fetch(url, { method: "POST", headers: { "xi-api-key": ELEVENLABS_API_KEY }, body: form });
  const body = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  const ok = upstream.ok && typeof body.text === "string";
  if (!ok) console.error("elevenlabs stt error", upstream.status, JSON.stringify(body).slice(0, 300));
  await admin.from("audit_log").insert({
    request_id: crypto.randomUUID(), source: "hub", module: "listen", command: "[voice transcription]", user_id: user.id, user_email: user.email ?? null,
    user_role: "admin", aal: "aal2", status: ok ? "ok" : "error", error: ok ? null : `ElevenLabs HTTP ${upstream.status}`,
    tool_calls: [{ name: "speech_to_text", ok, bytes: audio.length, ms: Date.now() - started, chars: ok ? String(body.text).trim().length : 0 }], result_summary: null, model: STT_MODEL, environment: ENVIRONMENT,
    input_mode: "voice",
  });
  const keyProblem = upstream.status === 401 || upstream.status === 403 || /invalid_api_key|authentication_error|missing_permissions/.test(JSON.stringify(body));
  if (!ok) return json({ error: keyProblem ? "The voice service key isn't valid for listening. Check the ElevenLabs key on the server." : "I couldn't make that out. Try again or type it." }, 502);
  return json({ text: String(body.text).replace(/\s+/g, " ").trim().slice(0, 1000) });
});
