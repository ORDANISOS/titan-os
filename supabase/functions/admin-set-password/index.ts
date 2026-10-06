// ⚠️ TENANT DRIFT AT BACKUP TIME (30 July 2026)
// demo (tkryueqzvgcigvxgjzsp) v10 and prod (unkirihxtruhdjeldfpm) v2 differ.
// This file is the v10 copy from demo.
// Differences observed: comments only — the executable code is character-for-character
// identical in both tenants. The higher-numbered copy here is the demo one, and it is
// the LESS documented of the two: demo's header is two lines ("TitanOS — lets an admin
// set another user's password directly, without triggering Supabase's password-reset
// email."), whereas prod's reads "PCM Family Office — ..." and additionally explains
// when it is used (handing a temporary password over the phone or in person), why it
// must be server-side (the service-role key must never reach the browser and the
// caller's admin role is re-checked here rather than trusted from the client), and
// carries a "Deploy:" line. Prod also keeps two inline comments demo has stripped:
// "Who is calling (from their token — cannot be spoofed)" and "Independently verify
// the caller is an admin — never trust the client." If the intent was to keep the
// documented copy, take prod's v2 instead; nothing functional turns on it.
// Reconcile before deploying this file to either project.
// supabase/functions/admin-set-password/index.ts
// TitanOS — lets an admin set another user's password directly,
// without triggering Supabase's password-reset email.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated." }, 401);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await anon.auth.getUser(token);
    if (uErr || !user) return json({ error: "Not authenticated." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: callerProfile } = await admin.from("user_profiles").select("role").eq("id", user.id).single();
    if (!callerProfile || callerProfile.role !== "admin") return json({ error: "Admins only." }, 403);

    const body = await req.json().catch(() => null);
    const targetUserId = String(body?.targetUserId || "").trim();
    const newPassword = String(body?.newPassword || "");
    if (!targetUserId) return json({ error: "Missing target user." }, 400);
    // Same minimum as self-serve signup (public-signup) and the app.
    const MIN_PASSWORD_LENGTH = 12;
    if (newPassword.length < MIN_PASSWORD_LENGTH) return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    if (targetUserId === user.id) return json({ error: "Use your own account settings to change your own password." }, 400);

    const { error: updErr } = await admin.auth.admin.updateUserById(targetUserId, { password: newPassword });
    if (updErr) return json({ error: updErr.message || "Could not update password." }, 500);

    return json({ ok: true });
  } catch (e) {
    console.error("admin-set-password error", e);
    return json({ error: "Server error." }, 500);
  }
});
