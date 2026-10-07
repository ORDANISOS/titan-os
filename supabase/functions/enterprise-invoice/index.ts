// supabase/functions/enterprise-invoice/index.ts
// Monthly invoicing of a firm that pays for its households. ORDANIS builds one invoice per firm per
// month, with a line per household, and it is created as a DRAFT in Stripe for an ORDANIS admin to
// review. Nothing is sent to the firm until an admin finalizes it.
//
// The rows themselves are computed in the database (enterprise_invoice_preview); this function only
// turns them into a Stripe invoice and records what it did. A browser can neither see these amounts
// without being an admin nor change them.
//
// Actions (POST, ORDANIS admin only):
//   { action: "preview",         enterprise_id, period? }            what the invoice would contain
//   { action: "ensure_customer", enterprise_id, billing_email?, payment_terms_days? }
//                                                                    creates the firm's Stripe customer once
//   { action: "create_draft",    enterprise_id, period? }            builds the draft in Stripe + records it
//   { action: "finalize",        invoice_id }                        finalizes in Stripe, emails it, status open
//   { action: "void",            invoice_id }                        deletes a draft / voids an open invoice
// period is the first of a month (YYYY-MM-01); it defaults to next month (billed in advance).
//
// Paid status arrives from Stripe through stripe-webhook (invoice.payment_succeeded).
// Secrets required: STRIPE_SECRET_KEY (SUPABASE_* are provided by the platform).
// Deploy: supabase functions deploy enterprise-invoice   (verify_jwt stays ON)

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import Stripe from "npm:stripe@17.4.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const stripe = new Stripe(STRIPE_SECRET_KEY || "sk_not_configured", { apiVersion: "2024-06-20", httpClient: Stripe.createFetchHttpClient() });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const cents = (n: number) => Math.round(Number(n) * 100);
const isFirstOfMonth = (s: string) => /^\d{4}-\d{2}-01$/.test(s);

function nextMonthStart(): string {
  const d = new Date();
  const y = d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function isMissing(e: unknown): boolean {
  const err = e as { code?: string; statusCode?: number };
  return err?.code === "resource_missing" || err?.statusCode === 404;
}

type PreviewRow = {
  family_id: string | null; family_name: string; line_type: string; description: string;
  quantity: number; unit_amount: number; amount: number; purchase_id: string | null;
};

async function loadPreview(enterpriseId: string, period: string) {
  const { data, error } = await admin.rpc("enterprise_invoice_preview", { p_enterprise_id: enterpriseId, p_period: period });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PreviewRow[];
  const lines = rows.filter((r) => !r.line_type.startsWith("warning"));
  const blocking = rows.filter((r) => r.line_type === "warning_blocking");
  const warnings = rows.filter((r) => r.line_type === "warning");
  const subtotal = lines.filter((l) => Number(l.amount) > 0).reduce((a, l) => a + Number(l.amount), 0);
  const discount = lines.filter((l) => Number(l.amount) < 0).reduce((a, l) => a + Number(l.amount), 0);
  return {
    lines, blocking, warnings,
    subtotal: Math.round(subtotal * 100) / 100,
    discount_total: Math.round(discount * 100) / 100,
    total: Math.round((subtotal + discount) * 100) / 100,
  };
}

async function getEnterprise(id: string) {
  const { data } = await admin.from("enterprises").select("id, name").eq("id", id).maybeSingle();
  return data;
}
async function getBillingRow(id: string) {
  const { data } = await admin.from("enterprise_billing")
    .select("enterprise_id, stripe_customer_id, billing_email, payment_terms_days").eq("enterprise_id", id).maybeSingle();
  return data;
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

    const { data: profile } = await admin.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "Only an ORDANIS admin can do this." }, 403);

    let body: { action?: string; enterprise_id?: string; invoice_id?: string; period?: string; billing_email?: string; payment_terms_days?: number };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
    const action = String(body.action ?? "");
    const period = body.period ?? nextMonthStart();
    if (!isFirstOfMonth(period)) return json({ error: "period must be the first day of a month, like 2026-11-01." }, 400);

    // ── finalize / void work from an invoice id ──
    if (action === "finalize" || action === "void") {
      if (!body.invoice_id) return json({ error: "invoice_id is required." }, 400);
      const { data: inv } = await admin.from("enterprise_invoices")
        .select("id, enterprise_id, status, stripe_invoice_id, total").eq("id", body.invoice_id).maybeSingle();
      if (!inv) return json({ error: "Invoice not found." }, 404);

      if (action === "finalize") {
        if (inv.status !== "draft") return json({ error: `Only a draft can be finalized (this one is ${inv.status}).` }, 409);
        if (!inv.stripe_invoice_id) return json({ error: "This invoice has no Stripe invoice behind it." }, 409);
        await stripe.invoices.finalizeInvoice(inv.stripe_invoice_id, { auto_advance: false });
        let emailed = true; let emailError = "";
        try { await stripe.invoices.sendInvoice(inv.stripe_invoice_id); }
        catch (e) { emailed = false; emailError = e instanceof Error ? e.message : String(e); }
        const { error: sErr } = await admin.rpc("enterprise_invoice_set_status", {
          p_invoice_id: inv.id, p_stripe_invoice_id: null, p_status: "open", p_actor: user.id,
        });
        if (sErr) return json({ error: `Finalized in Stripe but could not record it: ${sErr.message}`, invoice_id: inv.id }, 500);
        return json({ success: true, status: "open", emailed, email_error: emailError || undefined });
      }

      // void
      if (inv.status === "paid") return json({ error: "A paid invoice cannot be voided. Refund it in Stripe instead." }, 409);
      if (inv.status === "void") return json({ success: true, status: "void" });
      if (inv.stripe_invoice_id) {
        try {
          if (inv.status === "draft") await stripe.invoices.del(inv.stripe_invoice_id);
          else await stripe.invoices.voidInvoice(inv.stripe_invoice_id);
        } catch (e) {
          if (!isMissing(e)) return json({ error: `Stripe would not void it: ${e instanceof Error ? e.message : String(e)}` }, 502);
        }
      }
      const { error: sErr } = await admin.rpc("enterprise_invoice_set_status", {
        p_invoice_id: inv.id, p_stripe_invoice_id: null, p_status: "void", p_actor: user.id,
      });
      if (sErr) return json({ error: sErr.message }, 409);
      return json({ success: true, status: "void" });
    }

    // ── everything else is about one firm ──
    const enterpriseId = body.enterprise_id;
    if (!enterpriseId) return json({ error: "enterprise_id is required." }, 400);
    const ent = await getEnterprise(enterpriseId);
    if (!ent) return json({ error: "Firm not found." }, 404);

    if (action === "preview") {
      const p = await loadPreview(enterpriseId, period);
      const billing = await getBillingRow(enterpriseId);
      const { data: live } = await admin.from("enterprise_invoices")
        .select("id, status, total").eq("enterprise_id", enterpriseId).eq("period_month", period).neq("status", "void").maybeSingle();
      return json({
        success: true, enterprise: ent, period, ...p,
        billing_ready: !!billing?.stripe_customer_id, existing_invoice: live ?? null,
      });
    }

    if (action === "ensure_customer") {
      let billing = await getBillingRow(enterpriseId);
      const terms = body.payment_terms_days ?? billing?.payment_terms_days ?? 30;
      if (!Number.isInteger(terms) || terms < 1 || terms > 90) return json({ error: "payment_terms_days must be between 1 and 90." }, 400);
      const email = (body.billing_email ?? billing?.billing_email ?? "").trim();
      if (!billing?.stripe_customer_id) {
        if (!email) return json({ error: "A billing email is required to set the firm up for invoicing." }, 400);
        const cust = await stripe.customers.create({
          name: ent.name, email, metadata: { kind: "enterprise", enterprise_id: enterpriseId },
        }, { idempotencyKey: `entcust-${enterpriseId}` });
        const { error } = await admin.from("enterprise_billing").upsert({
          enterprise_id: enterpriseId, stripe_customer_id: cust.id, billing_email: email,
          payment_terms_days: terms, updated_by: user.id, updated_at: new Date().toISOString(),
        });
        if (error) return json({ error: error.message }, 500);
        await admin.from("enterprise_billing_events").insert({
          enterprise_id: enterpriseId, event_type: "billing_customer_created", actor_id: user.id, detail: { stripe_customer_id: cust.id },
        });
        return json({ success: true, stripe_customer_id: cust.id, created: true });
      }
      // already set up: allow changing the email and terms
      if (email && email !== billing.billing_email) {
        await stripe.customers.update(billing.stripe_customer_id, { email });
      }
      const { error } = await admin.from("enterprise_billing").update({
        billing_email: email || billing.billing_email, payment_terms_days: terms, updated_by: user.id, updated_at: new Date().toISOString(),
      }).eq("enterprise_id", enterpriseId);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true, stripe_customer_id: billing.stripe_customer_id, created: false });
    }

    if (action === "create_draft") {
      const billing = await getBillingRow(enterpriseId);
      if (!billing?.stripe_customer_id) return json({ error: "Set up the firm's billing details first (ensure_customer)." }, 409);

      const { data: live } = await admin.from("enterprise_invoices")
        .select("id, status").eq("enterprise_id", enterpriseId).eq("period_month", period).neq("status", "void").maybeSingle();
      if (live) return json({ error: `There is already a ${live.status} invoice for this month. Void it first to rebuild it.` }, 409);

      const p = await loadPreview(enterpriseId, period);
      if (p.blocking.length) {
        return json({ error: "Fix these before invoicing: " + p.blocking.map((b) => b.description).join(" | "), blocking: p.blocking }, 409);
      }
      if (!p.lines.length) return json({ error: "Nothing to invoice for this month." }, 409);
      if (p.total <= 0) return json({ error: "The invoice total is zero or negative, so no invoice was created." }, 409);

      const monthLabel = new Date(period + "T00:00:00Z").toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      const meta = { kind: "enterprise_invoice", enterprise_id: enterpriseId, period_month: period };
      let stripeInvoiceId = "";
      try {
        const inv = await stripe.invoices.create({
          customer: billing.stripe_customer_id,
          collection_method: "send_invoice",
          days_until_due: billing.payment_terms_days ?? 30,
          auto_advance: false,
          pending_invoice_items_behavior: "exclude",
          description: `${ent.name} - ORDANIS ${monthLabel}`,
          metadata: meta,
        });
        stripeInvoiceId = inv.id;

        const recorded: Array<PreviewRow & { stripe_invoice_item_id: string }> = [];
        for (const l of p.lines) {
          const item = await stripe.invoiceItems.create({
            customer: billing.stripe_customer_id,
            invoice: stripeInvoiceId,
            amount: cents(l.amount),
            currency: "usd",
            description: l.description,
            metadata: {
              ...meta, line_type: l.line_type, family_id: l.family_id ?? "", purchase_id: l.purchase_id ?? "",
            },
          });
          recorded.push({ ...l, stripe_invoice_item_id: item.id });
        }

        const { data: recId, error: rErr } = await admin.rpc("enterprise_invoice_record", {
          p_enterprise_id: enterpriseId, p_period: period, p_stripe_invoice_id: stripeInvoiceId,
          p_actor: user.id, p_lines: recorded,
        });
        if (rErr) throw new Error(rErr.message);
        return json({
          success: true, invoice_id: recId, stripe_invoice_id: stripeInvoiceId, status: "draft",
          subtotal: p.subtotal, discount_total: p.discount_total, total: p.total, line_count: recorded.length,
        });
      } catch (e) {
        // leave nothing half-built in Stripe
        if (stripeInvoiceId) { try { await stripe.invoices.del(stripeInvoiceId); } catch (_e) { /* best effort */ } }
        return json({ error: `The draft invoice could not be created: ${e instanceof Error ? e.message : String(e)}` }, 502);
      }
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
