// ⚠️ TENANT DRIFT AT BACKUP TIME (30 July 2026)
// demo (tkryueqzvgcigvxgjzsp) v10 and prod (unkirihxtruhdjeldfpm) v17 differ.
// This file is the v17 copy from prod.
// Differences observed: the control flow is identical, but one difference is NOT
// cosmetic. FIELD_SPEC is interpolated into the model's instruction, so the inline
// "// annual %, e.g. 6.25", "// monthly", "// ANNUAL amount", "// ANNUAL premium",
// "// hazard / homeowners carrier" and similar annotations that prod carries inside
// that template literal are part of the prompt the model actually reads; demo's
// FIELD_SPEC is the same schema with every annotation stripped, so demo gives the
// model no in-schema unit hints. The rest is comments: prod's header reads
// "PCM Family Office — Property document field extraction", names the document kinds
// it accepts, and carries a "Deploy:/Secret:/Optional:" block, where demo reads
// "TitanOS — Property document field extraction (white-label deployment)."; prod also
// keeps the "── Auth ──", "── Authorize ──" and "── Input ──" section dividers, the
// note above FIELD_SPEC, the base64-expansion note above the size cap, and the
// "Strip any accidental code fences" note, all of which demo has removed.
// Reconcile before deploying this file to either project.
// supabase/functions/extract-property-fields/index.ts
// PCM Family Office — Property document field extraction
// Receives a base64 PDF or image (insurance declaration, mortgage statement,
// closing document, etc.) and returns a JSON object of property fields to
// PRE-FILL the Add/Edit Property form. The advisor reviews before saving —
// this never writes to the database.
//
// Deploy:  supabase functions deploy extract-property-fields
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (shared with family-ai-assistant)
// Optional: supabase secrets set EXTRACT_MODEL=claude-sonnet-4-6

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MODEL = Deno.env.get("EXTRACT_MODEL") || "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// The exact shape the form expects. Dates are ISO (YYYY-MM-DD); money/numbers
// are plain numbers with no symbols or commas.
const FIELD_SPEC = `{
  "ownerName": string,            // owner or LLC on the document, if shown
  "address": string,             // full property street address
  "propertyType": one of "Residential" | "Commercial" | "Land" | "Multi-Family" | "Vacation",
  "purchasePrice": number,
  "purchaseDate": "YYYY-MM-DD",
  "currentValue": number,        // appraised / market value if present
  "lender": string,
  "loanBalance": number,
  "interestRate": number,        // annual %, e.g. 6.25
  "loanPayment": number,         // monthly principal+interest
  "loanMaturityDate": "YYYY-MM-DD",
  "secondMortgageBalance": number,
  "secondMortgagePayment": number,   // monthly
  "rentalIncome": number,        // monthly
  "propertyTaxes": number,       // ANNUAL amount
  "insuranceCompany": string,    // hazard / homeowners carrier
  "insurancePremium": number,    // ANNUAL premium
  "insuranceExpiration": "YYYY-MM-DD",      // policy expiration / renewal date
  "floodInsuranceCompany": string,
  "floodInsurancePremium": number,          // ANNUAL
  "floodInsuranceExpiration": "YYYY-MM-DD"
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!ANTHROPIC_API_KEY) {
      return json({ error: "Extraction is not configured (missing API key)." }, 500);
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated." }, 401);
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return json({ error: "Not authenticated." }, 401);

    // ── Authorize: extraction is advisor/admin only ───────────────────────────
    const { data: profile, error: profErr } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profErr || !profile) {
      return json({ error: "Could not verify your account permissions." }, 403);
    }
    if (profile.role !== "advisor" && profile.role !== "admin") {
      return json({ error: "Document extraction is available to advisors only." }, 403);
    }

    // ── Input ─────────────────────────────────────────────────────────────────
    const payload = await req.json().catch(() => null);
    const fileBase64 = payload?.fileBase64;
    const mediaType = payload?.mediaType;
    if (!fileBase64 || typeof fileBase64 !== "string") {
      return json({ error: "Missing file." }, 400);
    }
    const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(mediaType)) {
      return json({ error: "Unsupported file type. Use PDF, PNG, JPG, or WebP." }, 415);
    }
    // base64 expands ~33%; ~15MB file => ~20MB string. Cap defensively.
    if (fileBase64.length > 22_000_000) {
      return json({ error: "File is too large to process (max 15 MB)." }, 413);
    }

    const docBlock = mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } };

    const instruction =
      "You extract structured real-estate data from a single uploaded document for a family office property record.\n\n" +
      "Return ONLY a JSON object (no prose, no markdown fences) matching this schema:\n" +
      FIELD_SPEC + "\n\n" +
      "Rules:\n" +
      "- Include a key ONLY if the document clearly contains that value. Omit anything not present — do not guess or infer.\n" +
      "- Money and rates must be plain numbers: no $, no commas, no % sign.\n" +
      "- Dates must be YYYY-MM-DD.\n" +
      "- Property taxes and insurance premiums must be ANNUAL amounts. If the document shows a monthly figure, multiply by 12.\n" +
      "- If the document is unrelated to a property (not an insurance, mortgage, tax, appraisal, or closing document), return an empty object {}.\n" +
      "- Output must be valid JSON and nothing else.";

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: [docBlock, { type: "text", text: instruction }] }],
      }),
    });

    if (!aiResp.ok) {
      const detail = await aiResp.text().catch(() => "");
      console.error("Anthropic error", aiResp.status, detail);
      return json({ error: "The extraction service returned an error." }, 502);
    }

    const aiData = await aiResp.json();
    const raw = (aiData.content || [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("")
      .trim();

    // Strip any accidental code fences, then parse the first JSON object.
    let fields: Record<string, unknown> = {};
    try {
      const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end !== -1) fields = JSON.parse(cleaned.slice(start, end + 1));
    } catch (_e) {
      return json({ error: "Could not read structured fields from that document." }, 422);
    }

    return json({ fields });
  } catch (e) {
    console.error("extract-property-fields error", e);
    return json({ error: "Server error." }, 500);
  }
});
