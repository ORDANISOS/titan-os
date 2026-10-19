// supabase/functions/suggest-document-folder/index.ts
//
// Reads the opening of a document and says which folder(s) it looks like.
//
// It SUGGESTS. The upload form offers the answer(s) and the person picks before
// saving. Filing automatically would be worse than filing nothing: a document in
// the wrong folder is invisible in exactly the way a lost one is, except nobody
// knows to go looking for it.
//
// Usually this returns exactly one option, pre-filled with one click to accept.
// When a document genuinely fits more than one of the household's folders about
// equally well, it returns up to three, ranked, and the person chooses -- a
// single auto-pick in that case would just be a guess dressed up as an answer.
//
// Three rules it must not break:
//   · never silently invent a folder -- it may PROPOSE a new one, clearly labelled,
//     but an existing folder always wins where one fits
//   · never guess when the text does not support a guess -- "General" is a correct
//     answer and a confident wrong one is not
//   · never block an upload, which is why every failure returns 200 with no options
//
// It also proposes a document name and a one-sentence summary, because a photo
// taken on a phone arrives called "IMG_4821" and nobody will ever search for that.
// Both are suggestions too: the form pre-fills them and the person can change them.
//
// Signed-in users only. It reads no tables and no storage -- the caller hands it
// the opening of one document -- but it spends AI budget, so the public app key
// alone is not enough. Document text is never written to the logs.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MODEL = Deno.env.get("SUGGEST_FOLDER_MODEL") || "claude-sonnet-4-6";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const EMPTY = { options: [] as unknown[], confidence: "low", suggestedName: null, summary: null };

// A proposed name has to be something a person would type: short, plain, no path
// characters. Anything else is dropped and the form keeps the file's own name.
function cleanName(v: unknown): string | null {
  const s = String(v ?? "").replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (s.length < 3 || s.length > 80) return null;
  return s;
}
function cleanSummary(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (s.length < 8) return null;
  return s.slice(0, 220);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // A missing key must not stop someone uploading a document. No options, no fuss.
  if (!ANTHROPIC_KEY) return json(EMPTY);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not authenticated." }, 401);
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return json({ error: "Not authenticated." }, 401);
  } catch {
    return json({ error: "Not authenticated." }, 401);
  }

  let text = "", fileName = "", folders: string[] = [];
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, 4000);
    fileName = String(body?.fileName ?? "").slice(0, 200);
    folders = Array.isArray(body?.folders) ? body.folders.filter((f: unknown) => typeof f === "string") : [];
  } catch {
    return json(EMPTY);
  }
  if (!text || folders.length === 0) return json(EMPTY);

  const system =
`You file documents for a family's private records. You are given the opening of a
document and the folders this household actually has. Say which folder it belongs in.

Return ONLY a JSON object, no prose and no markdown fence:
{"options":[{"folder":"<exactly one of the folders given, or null>","newFolder":"<a proposed folder name, or null>","why":"<one short clause, under 12 words>"}],"confidence":"high"|"medium"|"low","suggestedName":"<a document name, or null>","summary":"<one plain sentence, or null>"}

Rules:
- List exactly ONE option when the document clearly belongs in one place. This is
  the common case -- most documents have one obvious home.
- List TWO, or at most THREE, options, ranked most-likely first, ONLY when the
  document genuinely could be filed in more than one of this household's folders
  with similarly strong justification -- for example a legal agreement tied to a
  specific property, or a document that is both a tax record and an investment
  statement. Do not pad the list with weak alternatives; every option listed must
  be independently defensible on its own, not just plausible as a runner-up.
- Prefer an EXISTING folder for every option. Set "folder" to one copied exactly
  from the list, and leave "newFolder" null. An existing folder always wins where
  one genuinely fits.
- Only propose a new folder (as one of the options) when the document plainly
  belongs to a recurring category this household has no home for -- an aircraft, a
  vineyard, a yacht, a specific business. Then set "folder" to null and "newFolder"
  to a short title-case name of one to three words. Do NOT propose a new folder for
  a one-off document, and do NOT propose a near-synonym of a folder that already
  exists.
- If the text does not clearly indicate anything, return exactly one option --
  "General" -- with overall confidence "low". A correct "I am not sure" is more
  useful than a confident wrong answer, and more useful than a padded list of
  guesses standing in for one.
- "why" explains what in the text decided it, in the household's own terms, written
  per option: "a mutual non-disclosure agreement", "a K-1 for the 2025 tax year".
  Not "the document appears to relate to legal matters".
- Never mention being an AI, and never hedge in "why".
- "suggestedName" is what a person would title this document in their records:
  issuer or subject, document type, and the year or period when the text shows one.
  Three to eight words, title case, no file extension. For example "State Farm Auto
  Policy 2026", "2025 Form 1099-DIV Fidelity", "Lease 14 Harbor Lane". Never include
  account numbers, Social Security numbers or other identifiers. Null if the text
  does not say what the document is.
- "summary" is one plain sentence, under 25 words, saying what the document is and
  who or what it concerns. No account numbers, no amounts beyond what identifies it.
  Null if the text does not support one.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system,
        messages: [{
          role: "user",
          content:
            `Folders available: ${folders.join(", ")}\n` +
            (fileName ? `File name: ${fileName}\n` : "") +
            `\nOpening of the document:\n${text}`,
        }],
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      // Status and error type only: an error body can quote the request.
      console.error("suggest-document-folder: upstream", res.status, data?.error?.type ?? "");
      return json(EMPTY);
    }

    const raw = (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();

    const parsed = JSON.parse(raw);
    const confidence = ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low";
    const rawOptions = Array.isArray(parsed.options) ? parsed.options : [];

    // Each option is validated independently against the same rules a single
    // suggestion always had to pass -- an existing folder must actually be in the
    // household's list, and a proposed new one is held to a tighter standard,
    // because the cost of a wrong suggestion there is a CHRIS that slowly fills
    // with near-duplicate folders nobody can navigate.
    const seen = new Set<string>();
    const options: { folder: string | null; newFolder: string | null; why: string }[] = [];
    for (const opt of rawOptions) {
      if (options.length >= 3) break;
      const why = String(opt?.why ?? "").slice(0, 120);

      if (opt?.folder && folders.includes(opt.folder)) {
        const key = `f:${opt.folder}`;
        if (!seen.has(key)) { seen.add(key); options.push({ folder: opt.folder, newFolder: null, why }); }
        continue;
      }

      const proposed = String(opt?.newFolder ?? "").trim();
      const clean = proposed.replace(/[^A-Za-z0-9 &'-]/g, "").trim();
      const words = clean.split(/\s+/).filter(Boolean);
      const collides = folders.some(
        (f) => f.toLowerCase().replace(/\s+/g, "") === clean.toLowerCase().replace(/\s+/g, ""),
      );
      if (
        clean && !collides &&
        words.length >= 1 && words.length <= 3 &&
        clean.length <= 28 &&
        confidence !== "low"          // never create a folder on a hunch
      ) {
        const key = `n:${clean.toLowerCase()}`;
        if (!seen.has(key)) { seen.add(key); options.push({ folder: null, newFolder: clean, why }); }
      }
    }

    // Nothing held up. Say nothing rather than guessing -- the person files it
    // themselves, which they can already do.
    const suggestedName = cleanName(parsed.suggestedName);
    const summary = cleanSummary(parsed.summary);
    return json(options.length
      ? { options, confidence, suggestedName, summary }
      : { ...EMPTY, suggestedName, summary });
  } catch (e) {
    console.error("suggest-document-folder: failed", e instanceof Error ? e.name : "error");
    return json(EMPTY);
  }
});
