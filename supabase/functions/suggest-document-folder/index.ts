// supabase/functions/suggest-document-folder/index.ts
//
// Reads the opening of a document and says which folder it looks like.
//
// It SUGGESTS. The upload form pre-fills the answer and the person can change it
// before saving. Filing automatically would be worse than filing nothing: a
// document in the wrong folder is invisible in exactly the way a lost one is,
// except nobody knows to go looking for it.
//
// Three rules it must not break:
//   · never silently invent a folder — it may PROPOSE a new one, clearly labelled,
//     but an existing folder always wins where one fits
//   · never guess when the text does not support a guess — "General" is a correct
//     answer and a confident wrong one is not
//   · never block an upload, which is why every failure returns 200 with no folder

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // A missing key must not stop someone uploading a document. No folder, no fuss.
  if (!ANTHROPIC_KEY) return json({ folder: null, newFolder: null, why: "", confidence: "low" });

  let text = "", fileName = "", folders: string[] = [];
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, 4000);
    fileName = String(body?.fileName ?? "").slice(0, 200);
    folders = Array.isArray(body?.folders) ? body.folders.filter((f: unknown) => typeof f === "string") : [];
  } catch {
    return json({ folder: null, newFolder: null, why: "", confidence: "low" });
  }
  if (!text || folders.length === 0) return json({ folder: null, newFolder: null, why: "", confidence: "low" });

  const system =
`You file documents for a family's private records. You are given the opening of a
document and the folders this household actually has. Say which folder it belongs in.

Return ONLY a JSON object, no prose and no markdown fence:
{"folder":"<exactly one of the folders given, or null>","newFolder":"<a proposed folder name, or null>","why":"<one short clause, under 12 words>","confidence":"high"|"medium"|"low"}

Rules:
- Prefer an EXISTING folder. Set "folder" to one copied exactly from the list, and
  leave "newFolder" null. An existing folder always wins where one genuinely fits.
- Only propose a new folder when the document plainly belongs to a recurring category
  this household has no home for — an aircraft, a vineyard, a yacht, a specific
  business. Then set "folder" to null and "newFolder" to a short title-case name of
  one to three words. Do NOT propose a new folder for a one-off document, and do NOT
  propose a near-synonym of a folder that already exists.
- If the text does not clearly indicate anything, answer "General" with low confidence.
  A correct "I am not sure" is more useful here than a confident wrong answer — a
  document filed in the wrong place is as lost as one never filed.
- "why" explains what in the text decided it, in the household's own terms:
  "a homeowners declarations page", "a K-1 for the 2025 tax year". Not "the document
  appears to relate to insurance matters".
- Never mention being an AI, and never hedge in the "why".`;

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
        max_tokens: 200,
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
      console.error("suggest-document-folder:", data?.error?.message ?? res.status);
      return json({ folder: null, newFolder: null, why: "", confidence: "low" });
    }

    const raw = (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();

    const parsed = JSON.parse(raw);

    const why = String(parsed.why ?? "").slice(0, 120);
    const confidence = ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low";

    // An existing folder always wins. Enforced here rather than trusted from the
    // model, because a suggestion naming a folder that does not exist would send
    // the document somewhere the household cannot navigate to.
    if (parsed.folder && folders.includes(parsed.folder)) {
      return json({ folder: parsed.folder, newFolder: null, why, confidence });
    }

    // A proposed NEW folder. Held to a tighter standard than an existing one,
    // because the cost of a wrong suggestion here is a vault that slowly fills
    // with near-duplicate folders nobody can navigate.
    const proposed = String(parsed.newFolder ?? "").trim();
    const clean = proposed.replace(/[^A-Za-z0-9 &'-]/g, "").trim();
    const words = clean.split(/\s+/).filter(Boolean);
    const collides = folders.some(
      (f) => f.toLowerCase().replace(/\s+/g, "") === clean.toLowerCase().replace(/\s+/g, ""),
    );
    if (
      clean &&
      !collides &&
      words.length >= 1 && words.length <= 3 &&
      clean.length <= 28 &&
      confidence !== "low"          // never create a folder on a hunch
    ) {
      return json({ folder: null, newFolder: clean, why, confidence });
    }

    // Nothing fitted and the proposal did not hold up. Say nothing rather than
    // guessing — the person files it themselves, which they can already do.
    return json({ folder: null, newFolder: null, why: "", confidence: "low" });
  } catch (e) {
    console.error("suggest-document-folder:", e instanceof Error ? e.message : String(e));
    return json({ folder: null, newFolder: null, why: "", confidence: "low" });
  }
});
