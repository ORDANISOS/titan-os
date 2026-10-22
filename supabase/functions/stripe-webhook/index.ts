// supabase/functions/stripe-webhook/index.ts
// Public endpoint. Stripe calls this directly -- there is no user session, so this is one of the
// few functions in this project that authenticates the caller by signature instead of by JWT
// (verify_jwt is disabled for this function at deploy time, same pattern as send-task-reminders).
//
// Writes to `families`, `user_profiles` and `dunning_notices` using the service role key,
// bypassing RLS on purpose: no signed-in user is behind this request, so RLS (written in terms of
// current_user_role()/current_user_allowed_family_ids()) has nothing to key off. The Stripe
// signature check is what stands in for authorization here -- do not relax it.
//
// What this keeps in sync, and what it deliberately does NOT do:
//   - It updates families.stripe_subscription_id / subscription_state / past_due_since from
//     Stripe's own view of the subscription. That is ground truth for whether Stripe thinks the
//     household is paid up.
//   - For the public self-serve sign-up flow (public-signup), it CREATES the household: that
//     function only creates the Auth user and starts Checkout, deliberately leaving the `families`
//     row to be born here, once payment actually succeeds. See createFamilyFromSignup below. The
//     advisor/admin-initiated flow (create-checkout-session) always targets an existing family, so
//     it never takes this path. createFamilyFromSignup also stamps acquisition_channel:"self_serve"
//     on that insert -- every other insert path leaves the column at its default ('advisor') -- so
//     the admin "Signups & Revenue" dashboard can tell the two apart.
//   - It also sends that household's welcome email (sendWelcomeEmail), branched on
//     plan_features.has_expert: Premier promises a named Expert will reach out within 24-48 hours,
//     the self-serve tiers get a plain welcome. Sender identity is resolved the same way
//     send-advisor-email does (outbound_email_settings / brand_profiles first) -- see that
//     function's own comment for why a hardcoded sender address was a real bug, not a shortcut.
//   - For Premier specifically, it also emails PREMIER_NOTIFY_EMAIL (notifyInternalTeamOfPremierSignup)
//     so a human actually finds out a household needs an Expert assigned. IMPORTANT: this is a
//     notification, not an assignment -- nothing here sets families.advisor_name/advisor_email.
//     Someone still has to read that email and do it within the promised 24-48 hours.
//   - On invoice.payment_succeeded for a firm invoice (metadata.kind = enterprise_invoice) it marks that
//     invoice paid (enterprise_invoice_set_status).
//   - On every invoice.payment_succeeded, firm or household, it records each paid line in the billing
//     ledger (recordInvoiceInLedger -> billing_ledger_record). Repeats are harmless.
//   - On invoice.upcoming it lowers a household's extra-workflow Stripe quantity to the slots it still
//     holds (see lowerWorkflowSlotsBeforeRenewal). It never charges and never raises the quantity.
//   - It does NOT run the day-by-day dunning cadence (which notice to send on which day of being
//     overdue, moving a household to final_notice, archiving it). It only logs that a payment
//     failed or recovered into dunning_notices, so that whatever already reads that table (or a
//     future scheduled function, on the model of run-scheduled-prompts) has real events to act on.
//
// Secrets required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// After deploying, register the endpoint URL in the Stripe dashboard (or via the Stripe CLI for
// test mode) and set STRIPE_WEBHOOK_SECRET to the signing secret Stripe gives you for it.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
// npm: specifier, not esm.sh -- esm.sh's Stripe bundle pulls in a Node.js "process.nextTick"
// polyfill that calls Deno.core.runMicrotasks(), which the current Supabase Edge Runtime does
// not support. That crashes the isolate (visible in function logs as "event loop error:
// Deno.core.runMicrotasks() is not supported in this environment"), which is what was silently
// breaking every Stripe call from this function. Deno's native npm compat layer avoids the
// esm.sh bundling path entirely, and is Supabase's own documented way to import the Stripe SDK.
import Stripe from "npm:stripe@17.4.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADVISOR_EMAIL_FROM = Deno.env.get("ADVISOR_EMAIL_FROM") || "";
const BRAND_NAME_ENV = Deno.env.get("BRAND_NAME") || "";
// Who gets told a Premier household needs an Expert assigned. Overridable per deployment; this
// project's own inbox is the sane default rather than leaving it unset and silently notifying no
// one.
const PREMIER_NOTIFY_EMAIL = Deno.env.get("PREMIER_SIGNUP_NOTIFY_EMAIL") || "Info@ordanisos.com";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Stripe's subscription.status values, mapped onto the smaller enum families.subscription_state
// actually has (active / past_due / final_notice / archived / cancelled). `final_notice` and
// `archived` are states this project's own dunning cadence moves a household into after repeated
// failures, or a decision to offboard -- Stripe has no equivalent status, so a raw Stripe event
// never writes those two values itself.
function mapStripeStatus(status: string): "active" | "past_due" | "cancelled" | null {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      return null; // incomplete, paused, etc. -- not enough signal to move the state either way
  }
}

// Which household a subscription belongs to. Advisor-created checkouts carry family_id in the
// subscription metadata; self-serve sign-ups did not (the household did not exist yet when the
// subscription was created), so fall back to the household that recorded this subscription id.
// Before 2026-10-14 there was no fallback, and cancellations, plan changes and failed payments for
// self-serve households were silently ignored.
// The subscription an invoice belongs to. Stripe moved it in API 2025-03-31 ("basil") and later: the
// event payload follows the webhook endpoint's API version, not this client's pinned one, and a live
// endpoint can only be created on a current version (2026-09-30 at the 2026-10-20 cutover). Older
// payloads carry invoice.subscription; newer ones carry invoice.parent.subscription_details.subscription.
// Read either, so the endpoint's version can change without silently breaking billing updates.
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const i = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null;
  };
  const s = i.subscription ?? i.parent?.subscription_details?.subscription ?? null;
  if (!s) return null;
  return typeof s === "string" ? s : (s.id ?? null);
}

async function familyIdForSubscription(sub: Stripe.Subscription | null): Promise<string | null> {
  if (!sub) return null;
  if (sub.metadata?.family_id) return sub.metadata.family_id;
  const { data } = await admin.from("families").select("id").eq("stripe_subscription_id", sub.id).maybeSingle();
  return (data?.id as string) ?? null;
}

// Self-serve sign-up logins are created blocked by public-signup and may only sign in once payment
// has created their household. Thrown on failure so Stripe retries: a paid customer must not be
// left locked out.
async function unblockSignupLogin(authUserId: string) {
  const { error } = await admin.auth.admin.updateUserById(authUserId, { ban_duration: "none" });
  if (error) throw new Error(`Could not unblock login ${authUserId}: ${error.message}`);
}

// Stripe sends invoice.payment_succeeded for the first payment at the same moment as
// checkout.session.completed, and it usually arrives FIRST, before the household exists. The ledger
// then skipped it ("has no household, not recorded"), which is why no first payment was ever in
// billing_ledger. So the household's creation records that first invoice itself. billing_ledger_record
// skips lines already recorded, so this is safe if the invoice event is also processed. Logged, not
// thrown: a ledger problem must not undo or retry a household that now exists.
async function recordFirstInvoice(session: Stripe.Checkout.Session, familyId: string) {
  try {
    if (!session.invoice) return;
    const invoice = await stripe.invoices.retrieve(String(session.invoice));
    if (invoice.status !== "paid") return;
    await recordInvoiceInLedger(invoice, familyId);
  } catch (e) {
    console.error(`first-invoice ledger record failed for family ${familyId}:`, e instanceof Error ? e.message : e);
  }
}

// The end of a household's paid period after it cancelled (or after billing finally gave up): take it
// off the system -- logins blocked, marked archived, a deletion-log row -- exactly as archive-family does
// for a deletion request, minus the Stripe cancel, which has already happened. Data is kept; purging stays
// a separate, deliberate admin step. Will's decision, 2026-10-21.
const PERMANENT_BAN = "876000h"; // ~100 years; same value as archive-family (never the literal 'infinity')
async function archiveAtPeriodEnd(familyId: string, reason: string) {
  const { data: fam } = await admin.from("families")
    .select("id, name, customer_number, plan, archived_at").eq("id", familyId).maybeSingle();
  if (!fam || fam.archived_at) return;
  const { data: clientUsers } = await admin.from("user_profiles")
    .select("id").eq("family_id", familyId).eq("role", "client");
  for (const u of clientUsers || []) {
    const { error } = await admin.auth.admin.updateUserById(u.id, { ban_duration: PERMANENT_BAN });
    if (error) console.error(`archiveAtPeriodEnd: could not block login ${u.id}`);
  }
  if ((clientUsers || []).length) {
    await admin.from("user_profiles").update({ active: false }).eq("family_id", familyId).eq("role", "client");
  }
  const { error: upErr } = await admin.from("families").update({
    archived_at: new Date().toISOString(), archived_by: "Subscription ended (end of paid period)", subscription_state: "archived",
  }).eq("id", familyId);
  if (upErr) throw new Error(`archive at period end failed for ${familyId}: ${upErr.message}`); // Stripe retries
  await admin.from("family_deletion_log").insert({
    family_id: fam.id, family_name: fam.name, customer_number: fam.customer_number, plan: fam.plan,
    action: "archived", reason, performed_by: "system (subscription ended)",
  });
}

// Stamp the household onto the subscription so every later event finds it directly. Logged, not
// thrown: familyIdForSubscription's fallback covers it if this fails.
async function tagSubscriptionWithFamily(subId: string, familyId: string) {
  try {
    await stripe.subscriptions.update(subId, { metadata: { family_id: familyId } });
  } catch (e) {
    console.error(`Could not tag subscription ${subId} with family ${familyId}:`, e instanceof Error ? e.message : e);
  }
}

// The subscription's current promotion (Stripe coupon + the code typed at checkout), as household columns for
// the admin Signups & Revenue page: list price minus this is what the household actually pays. Reads the legacy
// single `discount` field, which this client's pinned API version still returns. No discount clears them.
// deno-lint-ignore no-explicit-any
function promoColumns(sub: any): Record<string, unknown> {
  const d = sub?.discount ?? null;
  const c = d?.coupon ?? null;
  const pc = d?.promotion_code;
  return {
    promo_code: c ? (pc && typeof pc === "object" ? String(pc.code ?? "") || null : null) : null,
    promo_coupon: c ? (String(c.name ?? "") || String(c.id ?? "") || null) : null,
    promo_percent_off: c && c.percent_off != null ? Number(c.percent_off) : null,
    promo_amount_off: c && c.amount_off != null ? Number(c.amount_off) / 100 : null,
    promo_duration: c ? (c.duration ?? null) : null,
    promo_ends_at: c && d.end ? new Date(Number(d.end) * 1000).toISOString() : null,
    promo_synced_at: new Date().toISOString(),
  };
}

// Used where a household has just been created from a checkout: the subscription events may have arrived
// before the household existed. Logged, not thrown: a missing promo note must never retry a paid household.
async function recordPromo(subscriptionId: string, familyId: string) {
  try {
    const full = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["discount.promotion_code"] });
    const { error } = await admin.from("families").update(promoColumns(full)).eq("id", familyId);
    if (error) console.error(`promo not recorded for family ${familyId}:`, error.message);
  } catch (e) {
    console.error(`promo lookup failed for family ${familyId}:`, e instanceof Error ? e.message : e);
  }
}

async function syncFamilyFromSubscription(sub: Stripe.Subscription) {
  const familyId = await familyIdForSubscription(sub);
  if (!familyId) return; // not one of ours, or created outside this flow

  const mapped = mapStripeStatus(sub.status);
  const patch: Record<string, unknown> = { stripe_subscription_id: sub.id };
  // End-of-period cancellation, as Stripe has it (scheduled or undone in the app or the Stripe dashboard).
  // Re-read on this client's pinned API version: on the endpoint's newer version the period end lives on
  // the subscription items, not the subscription. A read failure leaves the column alone.
  try {
    const full = await stripe.subscriptions.retrieve(sub.id, { expand: ["discount.promotion_code"] });
    Object.assign(patch, promoColumns(full));
    patch.cancel_at = full.cancel_at_period_end && full.current_period_end
      ? new Date(full.current_period_end * 1000).toISOString() : null;
    if (!full.cancel_at_period_end) { patch.cancel_requested_at = null; patch.cancel_requested_by = null; }
  } catch (_e) { /* keep what we had */ }
  if (mapped) {
    // Decisions made here, not by Stripe, must survive routine Stripe events (2026-10-14):
    //  * archived stays archived;
    //  * final_notice is not knocked back to past_due by another failed-payment status;
    //  * past_due_since is set once, when the household first falls behind, and kept while it stays
    //    behind. It used to be reset to today on every event, so the dunning cadence never advanced.
    const { data: cur } = await admin.from("families")
      .select("subscription_state, past_due_since").eq("id", familyId).maybeSingle();
    const state = cur?.subscription_state ?? null;
    const behind = state === "past_due" || state === "final_notice";
    if (state === "archived") {
      // leave the state alone; only the subscription id is refreshed
    } else if (mapped === "past_due") {
      if (state !== "final_notice") patch.subscription_state = "past_due";
      patch.past_due_since = behind && cur?.past_due_since ? cur.past_due_since : new Date().toISOString().slice(0, 10);
    } else {
      patch.subscription_state = mapped;
      patch.past_due_since = null;
    }
  }

  const { error } = await admin.from("families").update(patch).eq("id", familyId);
  if (error) console.error(`families update failed for ${familyId}:`, error.message);
}

// Marketing attribution captured on /signup (public-signup has already cleaned it into the Checkout Session
// metadata). One row per household in signup_attribution, which MILO reads only as totals. Upsert, so a
// replayed event is harmless. Logged, not thrown: a missing tag must never undo or retry a paid household.
async function recordSignupAttribution(session: Stripe.Checkout.Session, familyId: string) {
  const m = session.metadata ?? {};
  const row: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "heard_about", "landing_path"]) {
    if (m[k]) row[k] = String(m[k]);
  }
  if (!Object.keys(row).length) return;
  const { error } = await admin.from("signup_attribution").upsert({ family_id: familyId, ...row }, { onConflict: "family_id" });
  if (error) console.error(`signup attribution not recorded for family ${familyId}:`, error.message);
}

// The public sign-up flow's Checkout Session carries auth_user_id/household_name/plan/full_name/
// email in metadata instead of an existing family_id, because the family does not exist yet -- see
// public-signup. This is where it is actually born, once Stripe confirms the subscription exists.
async function createFamilyFromSignup(session: Stripe.Checkout.Session, authUserId: string) {
  const sub = await stripe.subscriptions.retrieve(String(session.subscription));

  // Idempotency: Stripe redelivers events, and retries on our own non-2xx responses. If a family
  // already exists for this subscription, this is a replay -- resync it instead of minting a
  // second household for the same payment.
  const { data: existing } = await admin.from("families")
    .select("id").eq("stripe_subscription_id", sub.id).maybeSingle();
  if (existing) {
    await syncFamilyFromSubscription(sub);
    // A replay after an earlier attempt failed part-way must still finish the job: link the login to
    // the household if that did not happen, then unblock it.
    const { error: linkErr } = await admin.from("user_profiles")
      .update({ family_id: existing.id }).eq("id", authUserId).is("family_id", null);
    if (linkErr) throw new Error(`Could not link login ${authUserId} to family ${existing.id}: ${linkErr.message}`);
    await tagSubscriptionWithFamily(sub.id, existing.id);
    await unblockSignupLogin(authUserId);
    await recordFirstInvoice(session, existing.id);
    await recordSignupAttribution(session, existing.id);
    return;
  }

  const householdName = session.metadata?.household_name || "New Household";
  const plan = session.metadata?.plan;
  const fullName = session.metadata?.full_name ?? null;
  const email = session.metadata?.email ?? "";
  // Primary phone captured at sign-up (E.164). Only written when present, so older sessions still work.
  const phone = session.metadata?.phone ?? null;
  // Default to past_due (not active) unless Stripe's own status clearly says otherwise -- a
  // household should never start "active" on an assumption. A later customer.subscription.updated
  // event corrects this if it turns out to matter.
  const mapped = mapStripeStatus(sub.status) ?? "past_due";

  const { data: family, error: familyErr } = await admin.from("families").insert({
    name: householdName,
    plan,
    subscription_state: mapped,
    past_due_since: mapped === "past_due" ? new Date().toISOString().slice(0, 10) : null,
    stripe_customer_id: String(session.customer),
    stripe_subscription_id: sub.id,
    // Distinguishes this household from advisor-created ones for the admin "Signups & Revenue"
    // dashboard. Every other insert path into `families` (advisor/admin creation) leaves the
    // column at its default, 'advisor'.
    acquisition_channel: "self_serve",
  }).select("id").single();

  if (familyErr || !family) {
    // Thrown, not just logged: a family that fails to create here should surface as a Stripe
    // retry, not silently leave the new auth user permanently family-less.
    throw new Error(`Failed to create family from signup: ${familyErr?.message ?? "insert returned no row"}`);
  }

  // Link the auth user created at signup time to the household payment just created. Upsert, not
  // insert: a retried event should not fail on a duplicate key.
  const { error: profileErr } = await admin.from("user_profiles").upsert({
    id: authUserId,
    email,
    full_name: fullName,
    ...(phone ? { phone } : {}),
    role: "client",
    family_id: family.id,
  }, { onConflict: "id" });

  // Thrown, not just logged: the login is about to be unblocked, and must not be unblocked without a
  // household. Stripe retries; the replay branch above links it and unblocks.
  if (profileErr) throw new Error(`user_profiles upsert failed for ${authUserId}: ${profileErr.message}`);

  await tagSubscriptionWithFamily(sub.id, family.id);
  await recordPromo(sub.id, family.id);
  // Payment has created the household: the login made at sign-up may now sign in.
  await unblockSignupLogin(authUserId);
  await recordFirstInvoice(session, family.id);
  await recordSignupAttribution(session, family.id);

  // Signed up with a firm code (validated by public-signup before payment): place the household in the
  // firm now that it exists, keep the client's acceptance of the notice on the membership log, give it the
  // firm's default Expert, and tell the firm. The household is already paid for, so a failure here is
  // logged for follow-up and never turns into a Stripe retry.
  const firmId = session.metadata?.enterprise_id;
  if (firmId) {
    try {
      const { data: joined, error: joinErr } = await admin.rpc("enterprise_join_family", {
        p_family_id: family.id, p_enterprise_id: firmId, p_how: "signup_code", p_actor: authUserId,
        p_consent: true, p_consent_note: "Entered the firm code at signup and accepted the notice.",
        p_disclosure_id: session.metadata?.firm_notice_id ?? null, p_apply_default_expert: true,
      });
      if (joinErr) throw new Error(joinErr.message);
      if (joined?.event_id) {
        await fetch(`${SUPABASE_URL}/functions/v1/firm-join`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "notify", event_id: joined.event_id }),
        }).then(async (r) => { if (!r.ok) console.error(`firm-join notify returned ${r.status}:`, (await r.text()).slice(0, 200)); });
      }
    } catch (e) {
      console.error(`FIRM JOIN AFTER SIGNUP FAILED for family ${family.id} firm ${firmId}:`, e instanceof Error ? e.message : e);
    }
  }

  // Looked up once and passed to both emails below, rather than each one querying plan_features
  // itself, since they need the exact same answer (which plan, does it carry an Expert).
  const { data: tier } = await admin.from("plan_features")
    .select("label, has_expert").eq("plan", plan).maybeSingle();
  const planLabel = tier?.label || plan || "ORDANIS";
  const hasExpert = !!tier?.has_expert;

  try {
    await sendWelcomeEmail(family.id, email, fullName, planLabel, hasExpert, householdName);
  } catch (e) {
    console.error(`sendWelcomeEmail threw for family ${family.id}:`, e instanceof Error ? e.message : e);
  }

  if (hasExpert) {
    try {
      await notifyInternalTeamOfPremierSignup(family.id, email, fullName, householdName, planLabel);
    } catch (e) {
      console.error(`notifyInternalTeamOfPremierSignup threw for family ${family.id}:`, e instanceof Error ? e.message : e);
    }
  }
}

// Workflow purchases (see purchase-workflow): a household pays monthly for each extra workflow slot
// it holds. When a workflow finishes, the database releases its slot at once, but the Stripe
// quantity is only lowered by the app (purchase-workflow "sync") -- so a workflow completed any other
// way would keep being billed. Stripe sends invoice.upcoming a few days before every renewal; this
// brings the quantity down to the slots the household still holds BEFORE that invoice is created.
// It only ever lowers (never charges, never raises) and never throws: a failure here is logged and
// the renewal event is still acknowledged, so it cannot disturb any other billing event.
async function lowerWorkflowSlotsBeforeRenewal(familyId: string) {
  try {
    await admin.rpc("workflow_slots_rebalance", { p_family_id: familyId });
    const { count, error: cErr } = await admin.from("workflow_purchases")
      .select("id", { count: "exact", head: true })
      .eq("family_id", familyId).in("status", ["available", "in_use", "pending"]);
    if (cErr) throw new Error(cErr.message);
    const target = count ?? 0;

    const { data: b } = await admin.from("workflow_slot_billing")
      .select("stripe_item_id, billed_qty").eq("family_id", familyId).maybeSingle();
    if (!b?.stripe_item_id || target >= b.billed_qty) return; // nothing to lower

    const save = (itemId: string | null, qty: number) =>
      admin.from("workflow_slot_billing").upsert({
        family_id: familyId, stripe_item_id: itemId, billed_qty: qty, synced_at: new Date().toISOString(),
      });
    try {
      if (target <= 0) {
        await stripe.subscriptionItems.del(b.stripe_item_id, { proration_behavior: "none" });
        await save(null, 0);
      } else {
        await stripe.subscriptionItems.update(b.stripe_item_id, { quantity: target, proration_behavior: "none" });
        await save(b.stripe_item_id, target);
      }
    } catch (e) {
      const err = e as { code?: string; statusCode?: number };
      if (err?.code === "resource_missing" || err?.statusCode === 404) await save(null, 0); // item already gone in Stripe
      else throw e;
    }
  } catch (e) {
    console.error(`lowerWorkflowSlotsBeforeRenewal failed for ${familyId}:`, e instanceof Error ? e.message : e);
  }
}

async function logDunning(familyId: string, kind: string, dayNumber: number, extra: Record<string, unknown> = {}) {
  const { error } = await admin.from("dunning_notices").insert({
    family_id: familyId,
    notice_kind: kind,
    day_number: dayNumber,
    ...extra,
  });
  if (error) console.error(`dunning_notices insert failed for ${familyId}:`, error.message);
}

// Writes every paid line of an invoice into the billing ledger (billing_ledger_record), which the firm
// revenue figures, the rebate and the monthly snapshots all read. Each amount is what was actually
// charged: the line total less any discount on it, before tax. Safe to repeat for the same invoice, since
// a line already recorded is skipped, so Stripe retrying this webhook cannot double-count.
// Firm invoices carry the household and line type on each line (set by enterprise-invoice as invoice item
// metadata, which Stripe repeats on the invoice line). Household invoices are classified by Stripe product:
// the standing extra-workflow product (found by its metadata kind), the plan products in plan_features,
// partner seats by name, anything else as 'other'. A subscription line's own metadata is the subscription's,
// not the item's, so it is not used to classify.
async function recordInvoiceInLedger(invoice: Stripe.Invoice, subscriptionFamilyId: string | null) {
  const isFirm = invoice.metadata?.kind === "enterprise_invoice";
  const { data: plans, error: pErr } = await admin.from("plan_features").select("stripe_product_id");
  if (pErr) throw new Error(`plan_features read failed: ${pErr.message}`);
  const planProducts = new Set((plans ?? []).map((r: { stripe_product_id: string | null }) => r.stripe_product_id).filter(Boolean));
  const paidAt = invoice.status_transitions?.paid_at
    ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() : new Date().toISOString();
  const productKind = new Map<string, string>();
  const kindOf = async (productId: string): Promise<string> => {
    if (!productId) return "";
    if (!productKind.has(productId)) {
      try {
        const prod = await stripe.products.retrieve(productId);
        productKind.set(productId, String(prod.metadata?.kind ?? ""));
      } catch (_e) {
        productKind.set(productId, "");
      }
    }
    return productKind.get(productId) ?? "";
  };
  const FIRM_LINE_TYPE: Record<string, string> = {
    plan: "plan", plan_discount: "plan", workflow_slots: "workflow_overage", workflow_catchup: "workflow_overage",
  };

  const lines: Array<Record<string, unknown>> = [];
  for await (const l of stripe.invoices.listLineItems(invoice.id, { limit: 100 })) {
    const discount = (l.discount_amounts ?? []).reduce((n, d) => n + d.amount, 0);
    const net = (l.amount - discount) / 100;
    if (!net) continue;
    const familyId = isFirm ? (l.metadata?.family_id || null) : subscriptionFamilyId;
    if (!familyId) {
      console.error(`ledger: line ${l.id} on invoice ${invoice.id} has no household, not recorded`);
      continue;
    }
    const productId = typeof l.price?.product === "string" ? l.price.product : ((l.price?.product as { id?: string } | null)?.id ?? "");
    let lineType = "other";
    if (isFirm) {
      lineType = FIRM_LINE_TYPE[l.metadata?.line_type ?? ""] ?? "other";
    } else if ((await kindOf(productId)) === "workflow_slots") {
      lineType = "workflow_overage";
    } else if (productId && planProducts.has(productId)) {
      lineType = "plan";
    } else if ((l.description ?? "").includes("Business Partner Portal Seat")) {
      lineType = "partner_seats";
    }
    const period = isFirm && invoice.metadata?.period_month
      ? `${invoice.metadata.period_month}T00:00:00Z`
      : new Date((l.period?.start ?? invoice.created) * 1000).toISOString();
    lines.push({
      stripe_invoice_id: invoice.id, stripe_line_id: l.id, family_id: familyId, period, amount: net,
      currency: l.currency, line_type: lineType, paid_by: isFirm ? "enterprise" : "family",
      description: l.description ?? "", paid_at: paidAt,
    });
  }
  if (!lines.length) return;
  const { error } = await admin.rpc("billing_ledger_record", { p_lines: lines });
  if (error) throw new Error(`billing_ledger_record failed for ${invoice.id}: ${error.message}`);
}

const clean = (s: unknown) => String(s ?? "").replace(/[\r\n<>]/g, " ").trim();
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Same resolution order as send-advisor-email, and for the same reason: a hardcoded sender
// address is wrong for every white-label tenant but one. See that function's own header comment
// for the history of that bug. Kept independent (not imported) because Edge Functions deploy as
// separate isolates with no shared source between them in this project.
async function resolveSender(): Promise<{ from: string; label: string; appUrl: string }> {
  let brandName = "";
  let brandDomain = "";
  let brandAppUrl = "";
  try {
    const { data } = await admin.from("brand_profiles")
      .select("brand_name, email_domain, app_url").eq("is_active", true).maybeSingle();
    brandName = clean(data?.brand_name);
    brandDomain = String(data?.email_domain || "").trim().toLowerCase();
    brandAppUrl = String(data?.app_url || "").trim();
  } catch (_e) { /* table may not exist on an older project -- fall through */ }

  let fixed = "";
  let sendingDomain = "";
  let orgLabel = "";
  try {
    const { data } = await admin.from("outbound_email_settings")
      .select("fixed_from_email, sending_domain, from_org_label").eq("id", true).maybeSingle();
    fixed = clean(data?.fixed_from_email).toLowerCase();
    sendingDomain = String(data?.sending_domain || "").trim().toLowerCase();
    orgLabel = clean(data?.from_org_label);
  } catch (_e) { /* ditto */ }

  const label = orgLabel || brandName || clean(BRAND_NAME_ENV) || "ORDANIS";
  // Same "never send a dead link" reasoning as the sender-address fallbacks below: brand_profiles
  // is the source of truth (and what a white-label tenant would set), BRAND_APP_URL is an env
  // override for a project that hasn't populated that row, and the hardcoded value is this
  // project's own known-good domain as a last resort, not a guess.
  const appUrl = brandAppUrl || Deno.env.get("BRAND_APP_URL") || "https://portal.ordanisos.com";

  if (fixed) return { from: fixed, label, appUrl };
  if (sendingDomain) return { from: `alerts@${sendingDomain}`, label, appUrl };
  if (ADVISOR_EMAIL_FROM) return { from: ADVISOR_EMAIL_FROM, label, appUrl };
  if (brandDomain) return { from: `alerts@${brandDomain}`, label, appUrl };
  return { from: "", label, appUrl };
}

// Fires once, right after a new household is created by the public sign-up flow (never for the
// advisor/admin-initiated flow, which onboards through a human already). Failures are logged, not
// thrown -- a broken email send should not turn into a Stripe retry of an otherwise-successful
// household creation.
async function sendWelcomeEmail(familyId: string, email: string, fullName: string | null, planLabel: string, hasExpert: boolean, householdName: string) {
  if (!RESEND_API_KEY) { console.error("sendWelcomeEmail: RESEND_API_KEY not configured, skipping"); return; }
  if (!email) { console.error(`sendWelcomeEmail: no email on file for family ${familyId}, skipping`); return; }

  const sender = await resolveSender();
  if (!sender.from) { console.error("sendWelcomeEmail: sender identity unresolved, skipping"); return; }

  const name = clean(fullName) || "there";
  const subject = hasExpert
    ? `Welcome to ${sender.label} -- your Expert will be in touch`
    : `Welcome to ${sender.label}`;

  // Premier gets a named human (the Expert) and is invited to poke around on their own in the
  // meantime. Basic & Core have no Expert, so the thing to lead with is the complimentary 30-day
  // Onboarding Assistant every plan tier includes -- a real person will still reach out to help,
  // just not a permanently-assigned one -- alongside the standing invitation to sign in now.
  const onboardingParagraph = hasExpert
    ? `<p>As a Premier household, you now have a named ${esc(sender.label)} Expert dedicated to your family -- they will reach out directly within <strong>24-48 hours</strong> to get everything set up around you. In the meantime, feel free to sign in and start exploring the platform for yourself.</p>`
    : `<p>Your plan includes a complimentary <strong>30-day Onboarding Assistant</strong> -- someone from our team will be in touch shortly to help get your family's household fully set up. In the meantime, you're welcome to sign in and start exploring the platform on your own.</p>`;

  // Opens on the decision itself -- congratulating them and naming what the brand stands for --
  // before the operational plan/onboarding details. sender.label is forced to "ORDANIS" (see the
  // brand_profiles/outbound_email_settings rows) so it renders identically everywhere this
  // resolves, including here.
  const introParagraph =
    `<p>Congratulations, and welcome to ${esc(sender.label)}.</p>` +
    `<p>The name comes from the Latin <em>ordo</em> -- order: the clarity and structure we believe every family's wealth deserves, no matter how complex it becomes. That is what ${esc(sender.label)} is built to bring your family, and it is why joining us was the right call.</p>`;

  // A real button, not a plain text link -- this is the one action the email actually wants
  // taken, so it gets the same gold-fill treatment as the platform's own primary buttons rather
  // than competing with the sign-off/footer text around it. sender.appUrl always resolves to
  // something (see resolveSender's fallback chain), so this never links nowhere.
  const signInButton =
    `<p style="margin:26px 0;text-align:center">` +
    `<a href="${esc(sender.appUrl)}" style="display:inline-block;background:#C9A961;color:#051423;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:0.04em;padding:14px 28px;border-radius:4px">Sign In to Your Portal</a>` +
    `</p>`;

  const closingParagraph = `<p>We're glad you've joined!!</p>`;

  // sender.label + "Onboarding Team" rather than a hardcoded brand name, so a white-label tenant
  // gets its own team name here too, the same way it gets its own brand name everywhere else in
  // this email. The exact wording of the team name itself ("Onboarding Team") is a placeholder
  // pending a final decision -- easy to change here later, in one place.
  const signature = `<p style="margin-top:24px">Best,<br>${esc(sender.label)} Onboarding Team</p>`;

  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0A2540;line-height:1.6">` +
    `<p>Hi ${esc(name)},</p>` +
    `${introParagraph}` +
    `<p>Your <strong>${esc(planLabel)}</strong> plan for ${esc(householdName)} is now active.</p>` +
    `${onboardingParagraph}` +
    `${signInButton}` +
    `${closingParagraph}` +
    `${signature}` +
    `<hr style="border:none;border-top:1px solid #E2E0D8;margin:20px 0">` +
    `<div style="font-size:12px;color:#8A94A3">${esc(sender.label)} -- Private Wealth Administration</div>` +
    `</div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: sender.label ? `${sender.label} <${sender.from}>` : sender.from,
      to: [email],
      subject,
      html,
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    console.error(`sendWelcomeEmail: Resend error ${resp.status} for family ${familyId}:`, detail.slice(0, 300));
  }
}

// Fires once, only for a Premier household created by the public sign-up flow -- see the
// hasExpert check at the call site. This is the piece that closes the gap sendWelcomeEmail's
// comment flags: the customer is promised a callback, and this is what actually tells a human
// being that promise now exists and needs keeping. Failures are logged, not thrown, for the same
// reason as sendWelcomeEmail -- a broken notification should not turn into a Stripe retry of an
// otherwise-successful household creation.
async function notifyInternalTeamOfPremierSignup(familyId: string, customerEmail: string, fullName: string | null, householdName: string, planLabel: string) {
  if (!RESEND_API_KEY) { console.error("notifyInternalTeamOfPremierSignup: RESEND_API_KEY not configured, skipping"); return; }

  const sender = await resolveSender();
  if (!sender.from) { console.error("notifyInternalTeamOfPremierSignup: sender identity unresolved, skipping"); return; }

  const contactName = clean(fullName) || "(no name given)";
  const subject = `New Premier sign-up: ${householdName}`;
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0A2540;line-height:1.6">` +
    `<p>A new <strong>${esc(planLabel)}</strong> household just signed up and needs an Expert assigned within 24-48 hours -- that promise already went out in their welcome email.</p>` +
    `<table style="border-collapse:collapse;margin:12px 0">` +
    `<tr><td style="padding:4px 12px 4px 0;color:#8A94A3">Household</td><td><strong>${esc(householdName)}</strong></td></tr>` +
    `<tr><td style="padding:4px 12px 4px 0;color:#8A94A3">Contact</td><td>${esc(contactName)}</td></tr>` +
    `<tr><td style="padding:4px 12px 4px 0;color:#8A94A3">Email</td><td>${esc(customerEmail)}</td></tr>` +
    `<tr><td style="padding:4px 12px 4px 0;color:#8A94A3">Family ID</td><td style="font-family:monospace;font-size:12px">${esc(familyId)}</td></tr>` +
    `</table>` +
    `<p>Assign an Expert and set the household's advisor in the platform.</p>` +
    `</div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: sender.label ? `${sender.label} <${sender.from}>` : sender.from,
      to: [PREMIER_NOTIFY_EMAIL],
      subject,
      html,
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    console.error(`notifyInternalTeamOfPremierSignup: Resend error ${resp.status} for family ${familyId}:`, detail.slice(0, 300));
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!STRIPE_WEBHOOK_SECRET) return json({ error: "STRIPE_WEBHOOK_SECRET is not configured" }, 500);

  const signature = req.headers.get("Stripe-Signature");
  if (!signature) return json({ error: "Missing Stripe-Signature header" }, 400);

  const body = await req.text();

  let event: Stripe.Event;
  try {
    // constructEventAsync (not constructEvent) -- Deno's SubtleCrypto is async, unlike Node's.
    event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return json({ error: `Signature verification failed: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const familyId = session.metadata?.family_id;
        const authUserId = session.metadata?.auth_user_id;

        if (familyId && session.subscription) {
          // Advisor/admin-initiated checkout for an existing household (create-checkout-session).
          const sub = await stripe.subscriptions.retrieve(String(session.subscription));
          await syncFamilyFromSubscription(sub);
        } else if (authUserId && session.subscription) {
          // Public self-serve sign-up (public-signup) -- the household is created here.
          await createFamilyFromSignup(session, authUserId);
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        await syncFamilyFromSubscription(event.data.object as Stripe.Subscription);
        break;
      }

      // A promotion added, changed or ended on a subscription (e.g. "3 Months Free" running out). Only arrives
      // if these events are selected on the webhook endpoint; customer.subscription.updated covers it otherwise.
      case "customer.discount.created":
      case "customer.discount.updated":
      case "customer.discount.deleted": {
        const subId = (event.data.object as { subscription?: string | null }).subscription;
        if (subId) await syncFamilyFromSubscription(await stripe.subscriptions.retrieve(String(subId)));
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const familyId = await familyIdForSubscription(sub);
        // A Stripe cancellation lands here whether it came from the household's own churn, a
        // dunning process finally giving up, OR from archive-family cancelling billing on a
        // household that just asked to be removed from the platform. That last case must not be
        // clobbered back to "cancelled" -- "archived" is a deliberate, human-initiated deletion
        // request and is meant to stick, on the same principle already applied to
        // invoice.payment_succeeded below (a routine Stripe event should never silently undo a
        // firm decision like archiving).
        if (familyId) {
          const { data: fam } = await admin.from("families")
            .select("subscription_state, stripe_subscription_id, stripe_customer_id").eq("id", familyId).maybeSingle();
          if (fam && fam.subscription_state !== "archived") {
            // Only the household's CURRENT subscription ending takes it off the system, and only if the
            // customer has no other live subscription (a plan move can briefly overlap two). Anything else
            // is just marked cancelled, as before.
            let otherLive = false;
            if (fam.stripe_customer_id) {
              try {
                const subs = await stripe.subscriptions.list({ customer: String(fam.stripe_customer_id), status: "all", limit: 20 });
                otherLive = subs.data.some((x) => x.id !== sub.id && ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(x.status));
              } catch (_e) { otherLive = true; } // unsure: do not close a household on a guess
            }
            if (fam.stripe_subscription_id === sub.id && !otherLive) {
              await archiveAtPeriodEnd(familyId, "Subscription ended at the end of the paid period.");
            } else {
              await admin.from("families").update({ subscription_state: "cancelled" }).eq("id", familyId);
            }
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubscriptionId(invoice);
        const sub = subId ? await stripe.subscriptions.retrieve(subId) : null;
        const familyId = await familyIdForSubscription(sub);
        if (familyId) {
          // Stripe retries a failed payment several times, and each retry lands here. Only the FIRST
          // failure starts the past-due clock; later ones leave it (and an archived or final-notice
          // household) alone, so the dunning cadence can actually move forward.
          const { data: cur } = await admin.from("families")
            .select("subscription_state").eq("id", familyId).maybeSingle();
          if (cur && !["past_due", "final_notice", "archived"].includes(String(cur.subscription_state))) {
            await admin.from("families")
              .update({ subscription_state: "past_due", past_due_since: new Date().toISOString().slice(0, 10) })
              .eq("id", familyId);
          }
          await logDunning(familyId, "payment_failed", 0, { sent_to: invoice.customer_email ?? null });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        // A firm's monthly invoice (built by enterprise-invoice) has no subscription behind it: mark it
        // paid in our records and stop. The ledger rows for it are written separately.
        if (invoice.metadata?.kind === "enterprise_invoice") {
          const { error: paidErr } = await admin.rpc("enterprise_invoice_set_status", {
            p_invoice_id: null, p_stripe_invoice_id: invoice.id, p_status: "paid", p_actor: null,
          });
          if (paidErr) {
            const m = paidErr.message || "";
            if (m.includes("invoice_not_found") || m.includes("invoice_is_void")) {
              // Stripe says it was paid but our record is missing or voided: needs a human, a retry will not fix it.
              console.error(`ENTERPRISE INVOICE PAID BUT NOT MATCHED: ${invoice.id}: ${m}`);
            } else {
              throw new Error(m);
            }
          }
          await recordInvoiceInLedger(invoice, null);
          break;
        }
        const subId = invoiceSubscriptionId(invoice);
        const sub = subId ? await stripe.subscriptions.retrieve(subId) : null;
        // One-off invoices with no subscription (the Expert-assist fee) carry the household in their own metadata.
        const familyId = (await familyIdForSubscription(sub)) || invoice.metadata?.family_id;
        // Only clears a household that was overdue -- does not touch one already active,
        // final_notice or archived, since a routine renewal invoice should not silently undo a
        // firm decision like archiving.
        if (familyId) {
          const { data: family } = await admin.from("families")
            .select("subscription_state").eq("id", familyId).maybeSingle();
          if (family?.subscription_state === "past_due") {
            await admin.from("families")
              .update({ subscription_state: "active", past_due_since: null })
              .eq("id", familyId);
            await logDunning(familyId, "payment_recovered", 0, { sent_to: invoice.customer_email ?? null });
          }
        }
        await recordInvoiceInLedger(invoice, familyId ?? null);
        break;
      }

      case "invoice.upcoming": {
        // Sent by Stripe ahead of a renewal. Needs this event ticked on the webhook endpoint in the
        // Stripe dashboard; until it is, this case simply never runs.
        const invoice = event.data.object as Stripe.Invoice;
        const upcomingSubId = invoiceSubscriptionId(invoice);
        if (upcomingSubId) {
          const { data: fam } = await admin.from("families")
            .select("id").eq("stripe_subscription_id", upcomingSubId).maybeSingle();
          if (fam?.id) await lowerWorkflowSlotsBeforeRenewal(fam.id);
        }
        break;
      }

      default:
        // Unhandled event types are expected -- Stripe sends far more than this function acts on.
        break;
    }
  } catch (e) {
    // Stripe retries on non-2xx, so a processing error here should surface as a retry, not a
    // silently dropped event.
    console.error(`Error handling ${event.type}:`, e);
    return json({ error: `Handler error: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  return json({ received: true });
});
