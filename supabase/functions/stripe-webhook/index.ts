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
//   - It does NOT run the day-by-day dunning cadence (which notice to send on which day of being
//     overdue, moving a household to final_notice, archiving it). It only logs that a payment
//     failed or recovered into dunning_notices, so that whatever already reads that table (or a
//     future scheduled function, on the model of run-scheduled-prompts) has real events to act on.
//
// Secrets required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// After deploying, register the endpoint URL in the Stripe dashboard (or via the Stripe CLI for
// test mode) and set STRIPE_WEBHOOK_SECRET to the signing secret Stripe gives you for it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

async function syncFamilyFromSubscription(sub: Stripe.Subscription) {
  const familyId = sub.metadata?.family_id;
  if (!familyId) return; // not one of ours, or created outside this flow

  const mapped = mapStripeStatus(sub.status);
  const patch: Record<string, unknown> = { stripe_subscription_id: sub.id };
  if (mapped) {
    patch.subscription_state = mapped;
    patch.past_due_since = mapped === "past_due" ? new Date().toISOString().slice(0, 10) : null;
  }

  const { error } = await admin.from("families").update(patch).eq("id", familyId);
  if (error) console.error(`families update failed for ${familyId}:`, error.message);
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
    return;
  }

  const householdName = session.metadata?.household_name || "New Household";
  const plan = session.metadata?.plan;
  const fullName = session.metadata?.full_name ?? null;
  const email = session.metadata?.email ?? "";
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
    role: "client",
    family_id: family.id,
  }, { onConflict: "id" });

  if (profileErr) console.error(`user_profiles upsert failed for ${authUserId}:`, profileErr.message);

  // Looked up once and passed to both emails below, rather than each one querying plan_features
  // itself, since they need the exact same answer (which plan, does it carry an Expert).
  const { data: tier } = await admin.from("plan_features")
    .select("label, has_expert").eq("plan", plan).maybeSingle();
  const planLabel = tier?.label || plan || "Ordanis";
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

async function logDunning(familyId: string, kind: string, dayNumber: number, extra: Record<string, unknown> = {}) {
  const { error } = await admin.from("dunning_notices").insert({
    family_id: familyId,
    notice_kind: kind,
    day_number: dayNumber,
    ...extra,
  });
  if (error) console.error(`dunning_notices insert failed for ${familyId}:`, error.message);
}

const clean = (s: unknown) => String(s ?? "").replace(/[\r\n<>]/g, " ").trim();
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Same resolution order as send-advisor-email, and for the same reason: a hardcoded sender
// address is wrong for every white-label tenant but one. See that function's own header comment
// for the history of that bug. Kept independent (not imported) because Edge Functions deploy as
// separate isolates with no shared source between them in this project.
async function resolveSender(): Promise<{ from: string; label: string }> {
  let brandName = "";
  let brandDomain = "";
  try {
    const { data } = await admin.from("brand_profiles")
      .select("brand_name, email_domain").eq("is_active", true).maybeSingle();
    brandName = clean(data?.brand_name);
    brandDomain = String(data?.email_domain || "").trim().toLowerCase();
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

  const label = orgLabel || brandName || clean(BRAND_NAME_ENV) || "Ordanis";

  if (fixed) return { from: fixed, label };
  if (sendingDomain) return { from: `alerts@${sendingDomain}`, label };
  if (ADVISOR_EMAIL_FROM) return { from: ADVISOR_EMAIL_FROM, label };
  if (brandDomain) return { from: `alerts@${brandDomain}`, label };
  return { from: "", label };
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
    ? `<p>As a Premier household, you now have a named ${esc(sender.label)} Expert dedicated to <strong>${esc(householdName)}</strong> -- they will reach out directly within <strong>24-48 hours</strong> to get everything set up around you. In the meantime, feel free to sign in and start exploring the platform for yourself.</p>`
    : `<p>Your plan includes a complimentary <strong>30-day Onboarding Assistant</strong> -- someone from our team will be in touch shortly to help you get the <strong>${esc(householdName)}</strong> household fully set up. In the meantime, you're welcome to sign in and start exploring the platform on your own.</p>`;

  // Opens on the decision itself -- congratulating them and naming what the brand stands for --
  // before the operational plan/onboarding details. sender.label is forced to "ORDANIS" (see the
  // brand_profiles/outbound_email_settings rows) so it renders identically everywhere this
  // resolves, including here.
  const introParagraph =
    `<p>Congratulations, and welcome to ${esc(sender.label)}.</p>` +
    `<p>The name comes from the Latin <em>ordo</em> -- order: the clarity and structure we believe every family's wealth deserves, no matter how complex it becomes. That is what ${esc(sender.label)} is built to bring you, and it is why joining us was the right call.</p>`;

  const closingParagraph =
    `<p>We're glad you're here, and we're looking forward to bringing that same sense of order to what matters most to you.</p>`;

  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0A2540;line-height:1.6">` +
    `<p>Hi ${esc(name)},</p>` +
    `${introParagraph}` +
    `<p>Your <strong>${esc(planLabel)}</strong> plan for ${esc(householdName)} is now active.</p>` +
    `${onboardingParagraph}` +
    `${closingParagraph}` +
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

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const familyId = sub.metadata?.family_id;
        // A Stripe cancellation lands here whether it came from the household's own churn, a
        // dunning process finally giving up, OR from archive-family cancelling billing on a
        // household that just asked to be removed from the platform. That last case must not be
        // clobbered back to "cancelled" -- "archived" is a deliberate, human-initiated deletion
        // request and is meant to stick, on the same principle already applied to
        // invoice.payment_succeeded below (a routine Stripe event should never silently undo a
        // firm decision like archiving).
        if (familyId) {
          const { data: fam } = await admin.from("families")
            .select("subscription_state").eq("id", familyId).maybeSingle();
          if (fam?.subscription_state !== "archived") {
            await admin.from("families").update({ subscription_state: "cancelled" }).eq("id", familyId);
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const sub = invoice.subscription
          ? await stripe.subscriptions.retrieve(String(invoice.subscription))
          : null;
        const familyId = sub?.metadata?.family_id;
        if (familyId) {
          await admin.from("families")
            .update({ subscription_state: "past_due", past_due_since: new Date().toISOString().slice(0, 10) })
            .eq("id", familyId);
          await logDunning(familyId, "payment_failed", 0, { sent_to: invoice.customer_email ?? null });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const sub = invoice.subscription
          ? await stripe.subscriptions.retrieve(String(invoice.subscription))
          : null;
        const familyId = sub?.metadata?.family_id;
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
