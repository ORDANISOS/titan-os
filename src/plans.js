// Service plans: which tier a household is on, and what that tier includes.
//
// WHY THIS IS A MODULE AND NOT INLINE IN App.jsx
//
// The plan decides whether a family sees workflows, obligations, bill pay, prompts and resources
// -- features the firm charges for. A gate that is written out longhand at each place it applies
// will drift, and the direction it drifts in is the expensive one: a household that stops paying
// keeps the feature, or one that is paying loses it. One function, called everywhere, tested by
// calling the real thing.
//
// THE UI IS NOT THE ENFORCEMENT
//
// Everything here is presentation. A determined caller with a valid session can reach the tables
// directly, so the actual refusal lives in the database: the plan-gating triggers now read
// plan_features directly (see the `plan_gating_reads_capability_table` migration), so this file and
// the database read the exact same row -- there is no second copy of the gate to keep in sync by
// hand. These functions decide what to *draw*. The triggers decide what is *allowed*.
//
// 2026-09-18: extended from two tiers (Core/Premier) to three (Basic/Core/Premier) to match the
// `plan_features` table, which had grown a Basic tier and richer per-feature columns
// (can_obligations, can_workflows, can_bill_pay, can_prompts, can_resources) on the database side
// with nothing here reflecting it. The five feature keys below are a direct 1:1 mapping of those
// columns -- keep the names aligned if either side changes.

export const PLANS = ["basic", "core", "premier"];

export const PLAN_LABEL = { basic: "Basic", core: "Core", premier: "Premier" };

// Deliberately brand-neutral. "Titan Core" would be a white-label leak the moment a second firm
// runs this codebase -- the same bug already shipped three times in the edge functions.
export const PLAN_BLURB = {
  basic: "Vault, household record and AI assistant. Self-directed, no workflows or Expert.",
  core: "Self-directed. Workflows, obligations, prompts and resources. No assigned Expert at any price.",
  premier: "Full platform with an assigned expert, workflows and bill pay.",
};

export const PLAN_FEATURES = {
  basic: {
    obligations: false, workflows: false, billPay: false, prompts: false, resources: false,
    assignedExpert: false, advisorSeats: false, whiteLabel: false,
  },
  core: {
    obligations: true, workflows: true, billPay: false, prompts: true, resources: true,
    assignedExpert: false, advisorSeats: true, whiteLabel: true,
  },
  premier: {
    obligations: true, workflows: true, billPay: true, prompts: true, resources: true,
    assignedExpert: true, advisorSeats: true, whiteLabel: true,
  },
};

export const PLAN_FEATURE_LABEL = {
  obligations: "Obligations",
  workflows: "Workflows",
  billPay: "Bill pay and payment register",
  prompts: "Scheduled prompts",
  resources: "Resources",
  assignedExpert: "Assigned expert",
  advisorSeats: "Advisor seats",
  whiteLabel: "White-label branding",
};

// Whether a tier is sold self-serve (a household can sign up and pay directly, e.g. through
// Stripe Checkout) or only ever provisioned by an advisor. Mirrors plan_features.self_serve.
// Premier is advisor-sold today -- self_serve is false in the database -- but is included here so
// a self-serve Premier checkout can still be offered deliberately rather than by omission.
export const PLAN_SELF_SERVE = { basic: true, core: true, premier: false };

// The upper tier was called 'private' before it was renamed to 'premier'. The database still
// accepts the old value, because a browser tab opened before the rename shipped will write it, and
// turning that into a hard failure on an admin action would be worse than carrying an alias. Mapped
// explicitly rather than left to fall through the unknown-value branch below: it lands on the same
// answer either way, but only one of those says so on purpose.
const ALIASES = { private: "premier" };

/**
 * Resolve whatever is on the row to a plan we have features for.
 *
 * An unrecognised or missing value resolves to `premier`, NOT to the lesser tier, and that is a
 * deliberate reversal of the fail-closed rule used for the firm-level feature gates.
 *
 * The reasoning: the column is NOT NULL DEFAULT 'premier' with every existing row backfilled, so
 * a blank here means a row read by a stale client or a tier added later -- not an unpaid family.
 * Resolving those to `basic` or `core` would hide features (like the payment register) from a
 * household that is paying for them, and a family who cannot see that a bill was paid concludes it
 * was not. That is a worse failure than briefly showing a control to someone who did not buy it,
 * because the database refuses that write anyway. A future tier above Premier also inherits
 * Premier's features, which is the right default for a tier that is a superset.
 */
export function normalisePlan(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (PLANS.includes(v)) return v;
  if (ALIASES[v]) return ALIASES[v];
  return "premier";
}

/**
 * Does this plan include this feature?
 *
 * @param plan     Raw value from families.plan.
 * @param feature  Key of PLAN_FEATURES entries.
 *
 * An unknown feature name returns false. A typo in a gate should hide the feature and be noticed,
 * rather than read as "allowed" and silently open it to every tier.
 */
export function planAllows(plan, feature) {
  const f = PLAN_FEATURES[normalisePlan(plan)];
  return f ? f[feature] === true : false;
}

/** Label for a plan, for badges and form options. */
export function planLabel(plan) {
  return PLAN_LABEL[normalisePlan(plan)];
}

/** Whether this plan can be self-signed-up-for (e.g. offered a Stripe Checkout button) vs. only
 *  ever provisioned by an advisor. */
export function planIsSelfServe(plan) {
  return PLAN_SELF_SERVE[normalisePlan(plan)] === true;
}

/** Feature keys a plan does NOT include, for "what changes if we upgrade" copy. */
export function planExclusions(plan) {
  const f = PLAN_FEATURES[normalisePlan(plan)];
  return Object.keys(PLAN_FEATURE_LABEL).filter(k => f[k] !== true);
}

// NO familyIdsAllowing HELPER HERE, DELIBERATELY
//
// The obvious next function is one that filters a cross-book list -- the review queue -- down to
// families whose plan allows a feature. It is not needed, and writing it would imply the invariant
// is weaker than it is: workflow_instance_steps has no family_id, so filtering it would cost an
// extra query to resolve instance -> family, and that query can never remove a row. A household
// whose plan does not allow workflows still cannot hold an ACTIVE workflow instance -- but as of
// 2026-09-18 that is no longer because a downgrade is refused outright. families_refuse_downgrade
// (the old hard block) was removed on purpose: a downgrade with open work is now warned about, not
// refused. What holds the invariant now is the sync_plan_capabilities_on_change DB trigger, which
// PAUSES (status='paused', never deletes) every open workflow_instance the moment a
// household's plan stops allowing them, and resumes them if it moves back. The same trigger also
// clears/restores cash_flow_events.pcm_responsible when bill pay itself is lost/regained. So: a family on a
// no-workflow plan can still have workflow_instance rows on file, just none of them 'active' (or
// 'at_risk'/'blocked') -- callers filtering the review queue by status already exclude 'paused'
// rows for the same reason they exclude 'completed' ones, so this still needs no separate helper.
