// supabase/functions/app-web-handoff/index.ts
// One-time sign-in pass from the iPhone / Android app to the website (Will, 2026-10-30). Purchases happen on the website
// (no store fees), and the app's "Open Billing on the website" buttons used to land the client on a signed-out page.
// The app calls this with its own session; it returns a single-use magic-link token for THAT same person (no email is
// sent). The app opens the website with the token after "#", which never reaches a server log; the website exchanges it
// for a session (verifyOtp) and removes it from the address bar. Two-step sign-in still applies there: a person with the
// authenticator is asked for their code, because the token only gives a first-step session.
//
// AUTH: verify_jwt on (the caller's own session). Nothing in the request chooses whose pass it is.
// Deploy: supabase functions deploy app-web-handoff --project-ref <ref> --use-api

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Not signed in" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data: { user }, error: uErr } = await userClient.auth.getUser(jwt);
  if (uErr || !user?.email) return json({ error: "Not signed in" }, 401);

  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("app-web-handoff:", error?.message ?? "no token");
    return json({ error: "Could not prepare the sign-in. Sign in on the website instead." }, 500);
  }
  return json({ token_hash: tokenHash });
});
