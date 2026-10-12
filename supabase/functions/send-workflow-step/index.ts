// supabase/functions/send-workflow-step/index.ts
// Sends an already-approved workflow draft, with its attachments, and records what
// actually happened.
//
// Approval and sending are separate acts. This function refuses anything that is
// not already in 'approved' state, so the human gate cannot be skipped by calling
// the API directly. It is also the only place that may set 'sent', and it only does
// so once the provider has accepted the message and returned an id — "sent" always
// means a message left the building.
//
// THE RECIPIENT PROBLEM
// A draft's To line is written by a model from facts that include text extracted
// from an uploaded document, which is untrusted input. A tampered invoice could
// therefore try to steer a bank instruction elsewhere. Every recipient is checked
// against the addresses the firm already holds for that family; anything unknown
// stops the send and comes back to the reviewer to confirm explicitly, and the
// override is recorded on the step.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Total attachment payload. Providers cap this, and a rejected 40MB send is a
// confusing failure; refuse early with a clear reason instead.
const MAX_ATTACH_BYTES = 15 * 1024 * 1024;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Pull real addresses out of a free-text line. Drafts often carry a description
// ("Example Bank, Wire Operations") rather than an address, so the absence
// of a match is a normal case that must be reported clearly, not a crash.
const EMAIL_RE = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g;
function extractEmails(s: unknown): string[] {
  const found = String(s ?? "").match(EMAIL_RE) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const e = raw.toLowerCase();
    if (!seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
}
const domainOf = (e: string) => String(e).split("@")[1]?.toLowerCase() || "";

function b64(bytes: Uint8Array): string {
  // Chunked to avoid blowing the argument limit on large files.
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  let stepId = "";

  try {
    if (!RESEND_API_KEY) return json({ error: "Sending is not configured on this deployment (no email provider key)." }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated." }, 401);
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await asUser.auth.getUser(token);
    if (uErr || !user) return json({ error: "Not authenticated." }, 401);
    const actor = user.email || user.id;

    const body = await req.json().catch(() => null);
    stepId = String(body?.stepId || "").trim();
    const confirmUnverified = body?.confirmUnverifiedRecipients === true;
    if (!stepId) return json({ error: "Missing stepId." }, 400);

    // Read as the caller: RLS decides whether this step is theirs to send at all.
    const { data: step } = await asUser
      .from("workflow_instance_steps").select("*").eq("id", stepId).maybeSingle();
    if (!step) return json({ error: "Step not found, or not yours to send." }, 404);

    // Idempotency. A double click, a retry, or a lost response must not produce a
    // second bank instruction.
    if (step.sent_message_id) {
      return json({ ok: true, alreadySent: true, messageId: step.sent_message_id,
        sentAt: step.sent_at, recipients: step.sent_recipients });
    }

    // The approval gate, enforced server-side rather than only in the UI.
    if (step.status !== "approved") {
      return json({ error: step.status === "sent"
        ? "This step is already marked sent."
        : `This draft has not been approved yet (status: ${step.status}). Approve it first.` }, 409);
    }
    if (!String(step.draft_body || "").trim()) {
      return json({ error: "There is no draft body to send." }, 400);
    }

    // ── Sender identity: the responsible Expert, on this tenant's verified domain
    const { data: cfg } = await asUser
      .from("outbound_email_settings").select("*").limit(1).maybeSingle();
    if (!cfg) return json({ error: "Outbound email has not been configured for this firm." }, 409);
    if (!cfg.sender_verified || !cfg.sending_domain) {
      return json({ error: "This firm's sending domain is not verified yet, so nothing can be sent. An administrator can complete this under Branding." }, 409);
    }

    const { data: fam } = await asUser
      .from("families").select("name,advisor_name,advisor_email").eq("id", step.family_id).maybeSingle();

    const wantDomain = String(cfg.sending_domain).toLowerCase();
    let fromEmail = "";
    let fromLabel = "";
    if (cfg.from_mode === "fixed") {
      fromEmail = String(cfg.fixed_from_email || "").toLowerCase();
      fromLabel = String(cfg.from_org_label || "").trim();
    } else {
      const adv = String(fam?.advisor_email || "").toLowerCase();
      if (adv && domainOf(adv) === wantDomain) {
        fromEmail = adv;
        fromLabel = [String(fam?.advisor_name || "").trim(), String(cfg.from_org_label || "").trim()]
          .filter(Boolean).join(" · ");
      } else if (cfg.fixed_from_email && domainOf(String(cfg.fixed_from_email)) === wantDomain) {
        // The Expert's address is not on the verified domain. Fall back to the
        // firm address rather than attempting an unverified send that would bounce.
        fromEmail = String(cfg.fixed_from_email).toLowerCase();
        fromLabel = String(cfg.from_org_label || "").trim();
      }
    }
    if (!fromEmail) {
      return json({ error: `No usable sending address. This client's ORDANIS Expert (${fam?.advisor_email || "none on file"}) is not on the verified domain ${wantDomain}, and no fallback firm address is set.` }, 409);
    }
    if (domainOf(fromEmail) !== wantDomain) {
      return json({ error: `Refusing to send: ${fromEmail} is not on the verified domain ${wantDomain}.` }, 409);
    }

    // ── Recipients
    const toList = extractEmails(step.draft_to);
    const ccList = extractEmails(step.draft_cc).filter((e) => !toList.includes(e));
    if (!toList.length) {
      return json({ error: `No email address in the To line. It currently reads "${String(step.draft_to || "").slice(0, 120)}" — replace it with a real address before sending.` }, 400);
    }
    const cap = Number(cfg.max_recipients_per_send) || 10;
    if (toList.length + ccList.length > cap) {
      return json({ error: `This would send to ${toList.length + ccList.length} recipients, above this firm's limit of ${cap}.` }, 400);
    }

    // Is every recipient someone the firm already knows for this client? A draft
    // recipient partly derives from uploaded document text, so an address that
    // appeared from nowhere is stopped here and put back to the reviewer.
    const { data: known } = await asUser.rpc("family_known_emails", { p_family_id: step.family_id });
    const knownSet = new Set((known || []).map((r: any) => String(r.email || "").toLowerCase()));
    const unknown = [...toList, ...ccList].filter((e) => !knownSet.has(e));
    if (unknown.length && !confirmUnverified) {
      return json({
        needsConfirmation: true,
        unknownRecipients: unknown,
        error: "Some recipients are not on file for this client.",
      }, 409);
    }

    // ── Attachments, fetched from CHRIS
    const attachIds: string[] = Array.isArray(step.attachment_ids) ? step.attachment_ids : [];
    const attachments: { filename: string; content: string }[] = [];
    let attachBytes = 0;
    if (attachIds.length) {
      // Read the rows as the caller, so a document they cannot see cannot be
      // attached; download with the service role, which is what storage needs.
      const { data: docs } = await asUser.from("documents")
        .select("id,name,file_path").in("id", attachIds);
      for (const d of docs || []) {
        if (!d.file_path) continue;
        const { data: file, error: dlErr } = await admin.storage.from("documents").download(d.file_path);
        if (dlErr || !file) {
          return json({ error: `Could not read the attachment "${d.name}" from CHRIS, so nothing was sent.` }, 502);
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        attachBytes += bytes.length;
        if (attachBytes > MAX_ATTACH_BYTES) {
          return json({ error: `Attachments exceed ${Math.round(MAX_ATTACH_BYTES / 1024 / 1024)}MB, so nothing was sent.` }, 400);
        }
        attachments.push({ filename: d.name || "attachment", content: b64(bytes) });
      }
    }

    // ── Send
    const fromHeader = fromLabel ? `${fromLabel} <${fromEmail}>` : fromEmail;
    const subject = String(step.draft_subject || step.title || "").slice(0, 300);
    const payload: Record<string, unknown> = {
      from: fromHeader,
      to: toList,
      subject,
      text: String(step.draft_body || ""),
      reply_to: fromEmail,
    };
    if (ccList.length) payload.cc = ccList;
    if (attachments.length) payload.attachments = attachments;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(payload),
    });
    const result = await resp.json().catch(() => ({}));

    if (!resp.ok || !result?.id) {
      const detail = String(result?.message || result?.error?.message || `provider returned ${resp.status}`).slice(0, 400);
      // Record the failure and leave the step approved-but-unsent. It stays in the
      // review queue, which is the correct outcome: someone must deal with it.
      await admin.from("workflow_instance_steps").update({
        send_error: detail,
        send_attempts: (Number(step.send_attempts) || 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", stepId);
      return json({ error: `The email provider rejected this: ${detail}` }, 502);
    }

    const recipientsSnapshot = [
      `to: ${toList.join(", ")}`,
      ccList.length ? `cc: ${ccList.join(", ")}` : null,
    ].filter(Boolean).join(" | ");

    await admin.from("workflow_instance_steps").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_by: actor,
      sent_from: fromHeader,
      sent_message_id: String(result.id),
      sent_recipients: recipientsSnapshot.slice(0, 1000),
      recipients_unverified: unknown.length > 0,
      send_error: null,
      send_attempts: (Number(step.send_attempts) || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", stepId);

    return json({
      ok: true,
      messageId: String(result.id),
      from: fromHeader,
      to: toList,
      cc: ccList,
      attached: attachments.map((a) => a.filename),
      unverifiedRecipients: unknown,
    });
  } catch (e) {
    console.error("send-workflow-step error", e);
    // Best effort: leave a trace on the step so a silent failure is not possible.
    if (stepId) {
      await admin.from("workflow_instance_steps").update({
        send_error: `Unexpected error: ${String(e).slice(0, 300)}`,
        updated_at: new Date().toISOString(),
      }).eq("id", stepId).then(() => {}, () => {});
    }
    return json({ error: "Server error while sending. Nothing was marked as sent." }, 500);
  }
});
