// supabase/functions/email-portal-teams/index.ts
// Read-only feed for the ORDANIS Email Portal (a separate app and Supabase project). For every active
// household it returns ONLY the household's id and name and its team: the Expert (the point person) and
// that Expert's Analyst (expert_analysts), as names and email addresses. Nothing else about the household
// leaves the platform. The Email Portal matches people to its own team members by email and keeps each
// linked family's default owner (Expert) and Analyst in step with the platform (2026-10-16).
//
// Auth: JWT verification is OFF (the Email Portal calls this server-to-server); the caller must send the
// shared secret EMAIL_PORTAL_SYNC_SECRET in the x-portal-sync-secret header. The same value is set as
// PLATFORM_SYNC_SECRET on the Email Portal's sync-platform-teams function. Will sets both; it is never
// written anywhere else.
//
// Deploy: supabase functions deploy email-portal-teams --project-ref xreeruxuwtmjhvvxvjts --use-api --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Trimmed: a secret pasted from `openssl rand -hex 32 | pbcopy` carries a trailing newline, and HTTP headers
// arrive trimmed, so an untrimmed copy here could never match.
const SYNC_SECRET = (Deno.env.get("EMAIL_PORTAL_SYNC_SECRET") ?? "").trim();

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  // Fail closed: no secret configured means nobody gets in.
  if (!SYNC_SECRET || !safeEqual((req.headers.get("x-portal-sync-secret") ?? "").trim(), SYNC_SECRET)) {
    return json(401, { error: "unauthorized" });
  }

  const [fam, staff, links] = await Promise.all([
    db.from("families").select("id, name, advisor_email, advisor_name").is("archived_at", null).order("name"),
    db.from("user_profiles").select("id, email, full_name, role, active").in("role", ["advisor", "analyst"]),
    db.from("expert_analysts").select("expert_id, analyst_id"),
  ]);
  for (const r of [fam, staff, links]) if (r.error) return json(500, { error: r.error.message });

  const people = (staff.data ?? []) as Array<{ id: string; email: string | null; full_name: string | null; role: string; active: boolean | null }>;
  const byEmail = new Map(people.filter((p) => p.role === "advisor" && p.email).map((p) => [p.email!.toLowerCase(), p]));
  const byId = new Map(people.map((p) => [p.id, p]));
  const analystOf = new Map((links.data ?? []).map((l: { expert_id: string; analyst_id: string }) => [l.expert_id, l.analyst_id]));

  const households = (fam.data ?? []).map((f: { id: string; name: string; advisor_email: string | null; advisor_name: string | null }) => {
    const expertEmail = (f.advisor_email ?? "").trim().toLowerCase() || null;
    const expert = expertEmail ? byEmail.get(expertEmail) : undefined;
    const analyst = expert ? byId.get(analystOf.get(expert.id) ?? "") : undefined;
    const analystActive = analyst && analyst.active !== false && analyst.role === "analyst";
    return {
      family_id: f.id,
      family_name: f.name,
      expert_email: expertEmail,
      expert_name: expert?.full_name || f.advisor_name || null,
      analyst_email: analystActive ? (analyst!.email ?? "").toLowerCase() || null : null,
      analyst_name: analystActive ? analyst!.full_name || null : null,
    };
  });

  return json(200, { generated_at: new Date().toISOString(), households });
});
