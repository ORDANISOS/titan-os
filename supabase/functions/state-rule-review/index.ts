// supabase/functions/state-rule-review/index.ts
//
// The annual state-rule review agent.
//
// It PROPOSES. A person APPROVES. It has no path to state_rules and it cannot
// stamp verified_on — only approve_state_rule_proposal() can, and that requires
// an admin session.
//
// Run on a yearly cron, or by hand from the admin screen.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// One fact per API call. Fifty states of fee schedules in one context is how an
// agent starts attributing Delaware's fee to Nevada.
//
// And one BATCH per invocation, kept small on purpose: each check costs a web
// search plus a courtesy pause, so a full queue cannot finish inside an edge
// function timeout. Call this repeatedly, or let the cron work through it.
const DEFAULT_BATCH = 5;
const MAX_BATCH = 12;

const SYSTEM = `You verify published US state administrative facts for a family-office platform.

You are checking ONE fact. Use web search to find the state's own published source.

Report only what the official source says. You are not advising anyone, you are not
interpreting whether a rule applies to a particular person, and you are not
estimating. If the source does not plainly state the fact, say so.

Return ONLY a JSON object, no prose and no markdown fence:

{
  "finding": "unchanged" | "changed" | "source_moved" | "source_unreachable" | "ambiguous",
  "proposed_value": string | null,
  "proposed_numeric": number | null,
  "proposed_date_rule": string | null,
  "proposed_detail": string | null,
  "evidence": "the sentence or figure from the source that supports this",
  "source_url": "the official state URL you actually read",
  "confidence": "high" | "medium" | "low"
}

Rules you must follow:
- "ambiguous" whenever the source is unclear, tiered, or conditional. Ambiguous is
  a perfectly good answer and is far more useful than a confident guess.
- confidence "high" ONLY when an official state page states the fact outright.
- Never infer one state's rule from another's.
- Never fill a number you did not read. null is correct.`;

Deno.serve(async (req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const runId = crypto.randomUUID();

  // A missing key is a configuration fault, not a finding. Reporting it as
  // "source_unreachable" would file a proposal blaming a state website for our
  // own misconfiguration - and a human would waste time checking that website.
  if (!ANTHROPIC_KEY) {
    return new Response(
      JSON.stringify({
        error: "ANTHROPIC_API_KEY is not set on this project",
        fix: "supabase secrets set ANTHROPIC_API_KEY=... --project-ref <ref>",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let batch = DEFAULT_BATCH;
  try {
    const body = await req.json();
    if (typeof body?.limit === "number") {
      batch = Math.max(1, Math.min(body.limit, MAX_BATCH));
    }
  } catch (_e) { /* no body is fine */ }

  const { data: queue, error } = await sb.rpc("state_rules_review_queue", { p_limit: batch });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!queue?.length) {
    return new Response(JSON.stringify({ run_id: runId, checked: 0, note: "nothing due for review" }),
      { headers: { "Content-Type": "application/json" } });
  }

  const results: Record<string, number> = {};
  let checked = 0;

  for (const rule of queue) {
    const prompt =
      `State: ${rule.state_code}\n` +
      `Topic: ${rule.topic}${rule.applies_to ? ` (applies to: ${rule.applies_to})` : ""}\n` +
      `Currently recorded: ${rule.current_value ?? "(nothing)"}\n` +
      `Previously sourced from: ${rule.source_url ?? "(no source recorded)"}\n\n` +
      `Check this against the state's own published source and report what it says now.`;

    let parsed: any = null;
    let failureDetail: string | null = null;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          system: SYSTEM,
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(
          `Anthropic API ${res.status}: ${data?.error?.message ?? "no message"}`,
        );
      }
      const text = (data.content ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .replace(/```json|```/g, "")
        .trim();
      parsed = JSON.parse(text);
    } catch (e) {
      failureDetail = e instanceof Error ? e.message : String(e);
      console.error(`[${rule.state_code} ${rule.topic}] ${failureDetail}`);
      parsed = {
        finding: "source_unreachable",
        evidence: `The agent could not complete this check: ${failureDetail}`,
        confidence: "low",
      };
    }

    // A low-confidence result is recorded as ambiguous rather than as a finding.
    // It still reaches a human; it just does not arrive wearing a verdict.
    const finding =
      parsed.confidence === "low" && parsed.finding === "changed" ? "ambiguous" : parsed.finding;

    await sb.from("state_rule_proposals").insert({
      rule_id: rule.rule_id,
      state_code: rule.state_code,
      topic: rule.topic,
      applies_to: rule.applies_to,
      current_value: rule.current_value,
      proposed_value: parsed.proposed_value ?? null,
      proposed_numeric: parsed.proposed_numeric ?? null,
      proposed_date_rule: parsed.proposed_date_rule ?? null,
      proposed_detail: parsed.proposed_detail ?? null,
      finding,
      evidence: parsed.evidence ?? null,
      source_url: parsed.source_url ?? rule.source_url,
      agent_confidence: parsed.confidence ?? "low",
      run_id: runId,
    });

    results[finding] = (results[finding] ?? 0) + 1;
    checked++;

    // Be a polite citizen of state websites.
    await new Promise((r) => setTimeout(r, 1200));
  }

  return new Response(
    JSON.stringify({
      run_id: runId,
      checked,
      findings: results,
      batch_size: batch,
      note: "All findings are PROPOSALS. Nothing is verified until an admin approves it. Call again to work further through the queue.",
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
