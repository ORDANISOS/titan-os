// Records what one Claude answer cost, in tokens (public.ai_usage, migration 20261030120000_ai_usage).
// Only the feature, model, household, person and token counts are stored: never the question, answer or document.
//
// Logging must never break or slow the feature: it runs after the answer is in hand, in the background where the
// runtime allows it, and every failure is swallowed (a console warning only).
//
// familyId: pass it when the function already knows the household. Otherwise a client's own household is looked up
// from their profile; staff use without a household is recorded with family_id null.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
} | null | undefined;

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function rest(path: string, init: RequestInit) {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function write(opts: {
  fn: string;
  model: string;
  usage: Usage;
  userId?: string | null;
  familyId?: string | null;
}) {
  if (!SUPABASE_URL || !SERVICE_ROLE || !opts.usage) return;
  let familyId = isUuid(opts.familyId) ? opts.familyId : null;
  const userId = isUuid(opts.userId) ? opts.userId : null;
  if (!familyId && userId) {
    const r = await rest(`user_profiles?select=role,family_id&id=eq.${userId}`, { method: "GET" });
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      const p = Array.isArray(rows) ? rows[0] : null;
      if (p && p.role === "client" && isUuid(p.family_id)) familyId = p.family_id;
    }
  }
  const r = await rest("ai_usage", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      function_name: opts.fn,
      model: String(opts.model || "unknown").slice(0, 100),
      family_id: familyId,
      user_id: userId,
      input_tokens: n(opts.usage.input_tokens),
      output_tokens: n(opts.usage.output_tokens),
      cache_read_tokens: n(opts.usage.cache_read_input_tokens),
      cache_write_tokens: n(opts.usage.cache_creation_input_tokens),
    }),
  });
  if (!r.ok) console.warn("ai usage: not recorded", r.status);
}

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

export function logAiUsage(opts: Parameters<typeof write>[0]): void {
  const p = write(opts).catch((e) => console.warn("ai usage: not recorded", e && e.message ? e.message : e));
  try {
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
  } catch (_e) { /* runtime without waitUntil: the promise still runs */ }
}
