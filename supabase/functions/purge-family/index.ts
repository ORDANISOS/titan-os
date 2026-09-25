// supabase/functions/purge-family/index.ts
// ORDANIS — step 2 (permanent, deliberate) of honoring a household's request to be removed from
// the platform. See archive-family for step 1. This function refuses to run on any family that
// has not already been archived -- a slip of the finger can archive a family, but it cannot reach
// this function, on purpose. There is no undo past this point.
//
// What it does, in order:
//   1. Requires the family to already have archived_at set (400 if not).
//   2. Requires the caller to type the family's exact name as confirmation (400 on mismatch) --
//      the same "type the name to confirm" pattern used for other irreversible actions elsewhere,
//      so this can't be triggered by an accidental double-click.
//   3. Writes the family_deletion_log row (action:'purged') BEFORE deleting anything, so the
//      audit trail exists even if a later step fails partway through.
//   4. Removes the household's files from the private `documents` storage bucket -- uploaded
//      documents and note attachments. Best-effort: a storage failure is reported back in the
//      response but does not block the database purge, since leaving one orphaned file in
//      storage is a smaller problem than refusing to honor the deletion request at all.
//   5. Calls the purge_family() Postgres function (service-role only -- see the family_deletion
//      migration) to delete everything in a single transaction: tasks/notes/deals/contacts and
//      the household's own role='client' user_profiles rows outright (these have family_id
//      ON DELETE SET NULL, specifically so a family delete never silently deletes them, so a real
//      purge has to override that), then the families row itself, which cascades every other
//      family_id table (properties, portfolio accounts, valuables, obligations, workflows,
//      activity log, and so on -- all already ON DELETE CASCADE).
//   6. Deletes the household's own Supabase Auth user(s) entirely (not just the user_profiles
//      row, which step 5 already removed) so no login credential for this household remains
//      anywhere in the system.
//
// Auth: caller must be a signed-in admin (checked server-side, never trusted from the client --
// same pattern as admin-set-password / archive-family).
// Secrets required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Deploy: supabase functions deploy purge-family

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
    const { data: callerProfile } = await admin.from("user_profiles").select("role,email").eq("id", user.id).single();
    if (!callerProfile || callerProfile.role !== "admin") return json({ error: "Admins only." }, 403);

    const body = await req.json().catch(() => null);
    const familyId = String(body?.familyId || "").trim();
    const confirmName = String(body?.confirmName || "").trim();
    const reason = body?.reason ? String(body.reason).slice(0, 2000) : null;
    if (!familyId) return json({ error: "Missing familyId." }, 400);

    const { data: family, error: fErr } = await admin.from("families")
      .select("id,name,customer_number,plan,archived_at")
      .eq("id", familyId).maybeSingle();
    if (fErr) return json({ error: fErr.message }, 500);
    if (!family) return json({ error: "Family not found." }, 404);

    if (!family.archived_at) {
      return json({ error: "This family must be archived before it can be permanently deleted." }, 400);
    }
    if (!confirmName || confirmName !== family.name) {
      return json({ error: "Confirmation text does not match the family name." }, 400);
    }

    const performedBy = callerProfile.email || user.email || user.id;

    // Log first: this row is meant to be the one thing that survives, so it has to exist even if
    // something below fails.
    await admin.from("family_deletion_log").insert({
      family_id: family.id,
      family_name: family.name,
      customer_number: family.customer_number,
      plan: family.plan,
      action: "purged",
      reason,
      performed_by: performedBy,
    });

    // Collect self-serve login user ids before the DB rows referencing them are gone.
    const { data: clientUsers } = await admin.from("user_profiles")
      .select("id").eq("family_id", familyId).eq("role", "client");

    // Collect storage paths before the DB rows describing them are gone.
    const paths: string[] = [];
    const { data: docs } = await admin.from("documents").select("file_path").eq("family_id", familyId);
    for (const d of docs || []) if (d.file_path) paths.push(d.file_path);
    const { data: notes } = await admin.from("notes").select("id").eq("family_id", familyId);
    const noteIds = (notes || []).map(n => n.id);
    if (noteIds.length) {
      const { data: atts } = await admin.from("note_attachments").select("file_path").in("note_id", noteIds);
      for (const a of atts || []) if (a.file_path) paths.push(a.file_path);
    }

    let storageRemoved = 0;
    let storageError: string | null = null;
    if (paths.length) {
      try {
        // Chunked well under Supabase Storage's own per-call limit so a large household's
        // document library can't silently truncate a single remove() call.
        for (let i = 0; i < paths.length; i += 100) {
          const chunk = paths.slice(i, i + 100);
          const { error: rmErr } = await admin.storage.from("documents").remove(chunk);
          if (rmErr) throw rmErr;
          storageRemoved += chunk.length;
        }
      } catch (e) {
        storageError = e instanceof Error ? e.message : String(e);
        console.error("purge-family: storage removal failed", familyId, storageError);
      }
    }

    const { error: purgeErr } = await admin.rpc("purge_family", { target_family_id: familyId });
    if (purgeErr) return json({ error: purgeErr.message || "Database purge failed." }, 500);

    // Auth accounts are removed last, after the database rows referencing them are already gone.
    const authFailures: string[] = [];
    for (const u of clientUsers || []) {
      const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
      if (delErr) authFailures.push(u.id);
    }

    return json({
      ok: true,
      loginsDeleted: (clientUsers || []).length - authFailures.length,
      authFailures: authFailures.length ? authFailures : undefined,
      storageRemoved,
      storageTotal: paths.length,
      storageError: storageError || undefined,
    });
  } catch (e) {
    console.error("purge-family error", e);
    return json({ error: "Server error." }, 500);
  }
});
