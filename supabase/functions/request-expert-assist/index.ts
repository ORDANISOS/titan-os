// supabase/functions/request-expert-assist/index.ts
// A household on a plan without an assigned Expert (Core) can ask an ORDANIS Expert to work ONE workflow
// for a one-time fee (plan_features.expert_assist_price, $25 on Core). This function:
//   1. checks the caller may act for the household (row-level security) and the plan offers it,
//   2. charges the household's card on file once, as its own Stripe invoice (not a recurring item,
//      not prorated, and separate from the $8/month extra-workflow slots),
//   3. marks the workflow expert-assisted (only this function can; a database trigger refuses the
//      browser), and
//   4. emails the ORDANIS team so someone is assigned.
//
// POST { family_id, instance_id }   caller must be signed in as the household owner (client) or an admin.
//
// Safety: a "claim" (expert_requested_at) is taken before Stripe is touched, so a double click or a
// retry cannot charge twice. If the card is declined the invoice is voided and the claim released.
// Firm-paid households are refused here: their charges go on the firm's own invoice.
//
// Secrets: STRIPE_SECRET_KEY, RESEND_API_KEY (SUPABASE_* are provided). Deploy:
//   supabase functions deploy request-expert-assist

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import Stripe from "npm:stripe@17.4.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADVISOR_EMAIL_FROM_ENV = Deno.env.get("ADVISOR_EMAIL_FROM") || "";
const BRAND_NAME_ENV = Deno.env.get("BRAND_NAME") || "";

const PRODUCT_NAME = "ORDANIS Expert-assisted workflow";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const clean = (s: unknown) => String(s ?? "").replace(/[\r\n<>]/g, " ").trim();
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const stripe = new Stripe(STRIPE_SECRET_KEY || "sk_not_configured", { apiVersion: "2024-06-20", httpClient: Stripe.createFetchHttpClient() });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Same sender resolution as send-advisor-email / manage-business-partner.
async function resolveSender(): Promise<{ from: string; label: string; teamEmail: string }> {
  let brandName = "", brandDomain = "", teamEmail = "";
  try {
    const { data } = await admin.from("brand_profiles").select("brand_name, email_domain, contact_email").eq("is_active", true).maybeSingle();
    brandName = clean(data?.brand_name);
    brandDomain = String(data?.email_domain || "").trim().toLowerCase();
    teamEmail = String(data?.contact_email || "").trim().toLowerCase();
  } catch (_e) { /* older project */ }
  let fixed = "", sendingDomain = "", orgLabel = "";
  try {
    const { data } = await admin.from("outbound_email_settings").select("fixed_from_email, sending_domain, from_org_label").eq("id", true).maybeSingle();
    const m = String(data?.fixed_from_email || "").match(/<([^>]+)>/);
    fixed = (m ? m[1] : String(data?.fixed_from_email || "")).trim().toLowerCase();
    if (fixed && !EMAIL_RE.test(fixed)) fixed = "";
    sendingDomain = String(data?.sending_domain || "").trim().toLowerCase();
    orgLabel = clean(data?.from_org_label);
  } catch (_e) { /* ditto */ }
  const label = orgLabel || brandName || clean(BRAND_NAME_ENV) || "";
  if (fixed) return { from: fixed, label, teamEmail };
  if (sendingDomain) return { from: `alerts@${sendingDomain}`, label, teamEmail };
  const envAddr = clean(ADVISOR_EMAIL_FROM_ENV).toLowerCase();
  if (envAddr && EMAIL_RE.test(envAddr)) return { from: envAddr, label, teamEmail };
  if (brandDomain) return { from: `alerts@${brandDomain}`, label, teamEmail };
  return { from: "", label, teamEmail };
}

async function notifyTeam(p: { familyName: string; cycleLabel: string; dueDate: string | null; requester: string; fee: number; invoiceId: string }) {
  const s = await resolveSender();
  if (!s.teamEmail || !EMAIL_RE.test(s.teamEmail)) throw new Error("No team contact email is set on the active brand profile (brand_profiles.contact_email).");
  if (!s.from) throw new Error("The outbound email sender has not been configured.");
  const subject = `Expert requested: ${p.familyName} - ${p.cycleLabel}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6">` +
    `<p><strong>${esc(p.familyName)}</strong> has paid $${p.fee.toFixed(2)} to have an ORDANIS Expert work one workflow.</p>` +
    `<p>Workflow: <strong>${esc(p.cycleLabel)}</strong>${p.dueDate ? ` (due ${esc(p.dueDate)})` : ""}<br>Requested by: ${esc(p.requester)}<br>Stripe invoice: ${esc(p.invoiceId)}</p>` +
    `<p>Please assign an Expert to this workflow. The household is expecting to hear from someone.</p></div>`;
  const text = `${p.familyName} paid $${p.fee.toFixed(2)} for an Expert on: ${p.cycleLabel}${p.dueDate ? ` (due ${p.dueDate})` : ""}. Requested by ${p.requester}. Invoice ${p.invoiceId}. Please assign an Expert.`;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: s.label ? `${s.label} <${s.from}>` : s.from, to: [s.teamEmail], subject, html, text }),
  });
  if (!resp.ok) throw new Error(`Email service error: ${(await resp.text().catch(() => "")).slice(0, 300)}`);
}

// One standing Stripe Product for every fee. Stripe takes an existing Product ID on invoice items,
// not an inline definition. Found by metadata, created once if missing.
async function productId(): Promise<string> {
  try {
    const found = await stripe.products.search({ query: `active:'true' AND metadata['kind']:'expert_assist'`, limit: 1 });
    if (found.data[0]) return found.data[0].id;
  } catch (e) {
    console.error("expert product search failed, creating one:", e instanceof Error ? e.message : e);
  }
  return (await stripe.products.create({ name: PRODUCT_NAME, metadata: { kind: "expert_assist" } })).id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "STRIPE_SECRET_KEY is not configured" }, 500);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated." }, 401);
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await sb.auth.getUser(token);
    if (uErr || !user) return json({ error: "Not authenticated." }, 401);

    let body: { family_id?: string; instance_id?: string };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
    const familyId = body.family_id, instanceId = body.instance_id;
    if (!familyId || !instanceId) return json({ error: "family_id and instance_id are required." }, 400);

    const { data: profile } = await admin.from("user_profiles").select("role, email").eq("id", user.id).maybeSingle();
    if (!["client", "admin"].includes(profile?.role ?? "")) {
      return json({ error: "Only the household owner can add an Expert to a workflow. Ask them to approve it." }, 403);
    }

    // Runs as the caller, so row-level security decides whether they can see this household.
    const { data: family, error: fErr } = await sb.from("families")
      .select("id, name, plan, stripe_subscription_id, paid_by").eq("id", familyId).maybeSingle();
    if (fErr) return json({ error: fErr.message }, 500);
    if (!family) return json({ error: "Household not found, or you do not have access to it." }, 404);
    if (family.paid_by === "enterprise") {
      return json({ error: "This household is billed through its firm, so an Expert cannot be added from here. Contact your advisor." }, 409);
    }

    const { data: tier } = await admin.from("plan_features").select("expert_assist_price").eq("plan", family.plan).maybeSingle();
    const fee = Number(tier?.expert_assist_price);
    if (!Number.isFinite(fee) || fee <= 0) return json({ error: "Adding an Expert to a single workflow is not offered on this plan." }, 409);
    if (!family.stripe_subscription_id) return json({ error: "This household has no active subscription to bill. Contact your advisor." }, 409);

    const { data: inst } = await admin.from("workflow_instances")
      .select("id, family_id, cycle_label, due_date, status, expert_assisted").eq("id", instanceId).eq("family_id", familyId).maybeSingle();
    if (!inst) return json({ error: "Workflow not found for this household." }, 404);
    if (inst.expert_assisted) return json({ success: true, already: true });
    if (inst.status === "completed") return json({ error: "This workflow is already complete." }, 409);

    const sub = await stripe.subscriptions.retrieve(family.stripe_subscription_id);
    if (!["active", "trialing"].includes(sub.status)) {
      return json({ error: "This household's subscription is not active, so the fee cannot be charged. Please update your payment method first." }, 409);
    }
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

    // Claim the request. Only one caller can win, so a double click cannot charge twice.
    const { data: claimed, error: cErr } = await admin.from("workflow_instances")
      .update({ expert_requested_at: new Date().toISOString(), expert_requested_by: user.id })
      .eq("id", instanceId).eq("expert_assisted", false).is("expert_requested_at", null).select("id");
    if (cErr) return json({ error: cErr.message }, 500);
    if (!claimed || claimed.length === 0) return json({ error: "An Expert request for this workflow is already in progress." }, 409);
    const release = () => admin.from("workflow_instances").update({ expert_requested_at: null, expert_requested_by: null }).eq("id", instanceId);

    // Charge once, as its own invoice. Created empty, item attached, then finalized and paid immediately.
    let invoiceId = "";
    try {
      const pm = typeof sub.default_payment_method === "string" ? sub.default_payment_method : sub.default_payment_method?.id;
      const meta = { kind: "expert_assist", family_id: familyId, instance_id: instanceId };
      const invoice = await stripe.invoices.create({
        customer: customerId, collection_method: "charge_automatically", auto_advance: false,
        description: `ORDANIS Expert: ${inst.cycle_label}`, metadata: meta,
        ...(pm ? { default_payment_method: pm } : {}),
      });
      invoiceId = invoice.id;
      await stripe.invoiceItems.create({
        customer: customerId, invoice: invoice.id,
        price_data: { currency: "usd", product: await productId(), unit_amount: Math.round(fee * 100) },
        description: `ORDANIS Expert assisted workflow: ${inst.cycle_label}`, metadata: meta,
      });
      await stripe.invoices.finalizeInvoice(invoice.id);
      await stripe.invoices.pay(invoice.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`expert assist charge failed for ${instanceId}:`, msg);
      if (invoiceId) { try { await stripe.invoices.voidInvoice(invoiceId); } catch (_v) { /* draft invoices cannot be voided; delete instead */ try { await stripe.invoices.del(invoiceId); } catch (_d) { /* leave it */ } } }
      await release();
      return json({ error: "The payment did not go through, so no Expert was added. Please check your card and try again.", detail: msg }, 402);
    }

    // The card has been charged. Recording it must not be left to chance: retry, then say so loudly.
    let lastErr = "";
    for (let i = 0; i < 3; i++) {
      const { error: wErr } = await admin.from("workflow_instances")
        .update({ expert_assisted: true, expert_fee: fee, expert_stripe_invoice_id: invoiceId }).eq("id", instanceId);
      if (!wErr) {
        let emailSent = true, emailError: string | null = null;
        try {
          await notifyTeam({ familyName: family.name || "A household", cycleLabel: inst.cycle_label, dueDate: inst.due_date, requester: profile?.email || user.email || "", fee, invoiceId });
        } catch (e) {
          emailSent = false; emailError = e instanceof Error ? e.message : String(e);
          console.error(`expert assist team email failed for ${instanceId}:`, emailError);
        }
        return json({ success: true, fee, invoice_id: invoiceId, email_sent: emailSent, email_error: emailError });
      }
      lastErr = wErr.message;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
    console.error(`CHARGED BUT NOT RECORDED: expert assist workflow ${instanceId} family ${familyId} invoice ${invoiceId}: ${lastErr}`);
    return json({ error: "Your payment went through but we could not finish adding the Expert. Please contact support and quote this reference: " + invoiceId }, 500);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
