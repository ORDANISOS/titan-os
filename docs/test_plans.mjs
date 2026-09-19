// Tests for the Basic / Core / Premier service plan gate.
//
// These call the real functions from src/plans.js. The gate decides what a household has paid for,
// so the assertions worth having are the ones about the edges: a missing plan, an unrecognised
// plan, a misspelt feature name. Each of those resolves in a direction that was chosen on purpose,
// and a future change that flips one should fail here rather than in front of a client.
//
// The database half of the gate -- the triggers that refuse workflow, obligation, bill-pay and
// payment-log writes on a plan that does not include them, and refuse a downgrade that would
// strand a household -- cannot be tested from node. It reads plan_features directly (see the
// `plan_gating_reads_capability_table` migration), which is the same table this file mirrors.
//
// Run: node docs/test_plans.mjs

import {
  PLANS, PLAN_LABEL, PLAN_BLURB, PLAN_FEATURES, PLAN_FEATURE_LABEL, PLAN_SELF_SERVE,
  normalisePlan, planAllows, planLabel, planIsSelfServe, planExclusions,
} from "../src/plans.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };

console.log("\nThe three plans");
ok("there are exactly three", PLANS.length === 3);
ok("basic, core and premier, in that order", PLANS[0] === "basic" && PLANS[1] === "core" && PLANS[2] === "premier");
ok("every plan has a label", PLANS.every(p => !!PLAN_LABEL[p]));
ok("every plan has a blurb", PLANS.every(p => !!PLAN_BLURB[p]));
ok("every plan has a feature set", PLANS.every(p => !!PLAN_FEATURES[p]));
// A tier whose blurb names a brand would leak the moment a second firm runs this codebase — the
// same bug shipped three times in the edge functions.
ok("no blurb names a brand", PLANS.every(p => !/titan|pcm|accurate|ordanis/i.test(PLAN_BLURB[p])));
ok("no label names a brand", PLANS.every(p => !/titan|pcm|ordanis/i.test(PLAN_LABEL[p])));

console.log("\nWhat Basic includes");
ok("Basic has no assigned expert", planAllows("basic", "assignedExpert") === false);
ok("Basic has no workflows", planAllows("basic", "workflows") === false);
ok("Basic has no bill pay", planAllows("basic", "billPay") === false);
ok("Basic has no obligations", planAllows("basic", "obligations") === false);
ok("Basic has no prompts", planAllows("basic", "prompts") === false);
ok("Basic has no resources", planAllows("basic", "resources") === false);
ok("Basic withholds every gated feature", planExclusions("basic").length === Object.keys(PLAN_FEATURE_LABEL).length);
ok("Basic is self-serve", planIsSelfServe("basic") === true);

console.log("\nWhat Core includes");
ok("Core has no assigned expert", planAllows("core", "assignedExpert") === false);
ok("Core has workflows", planAllows("core", "workflows") === true);
ok("Core has no bill pay", planAllows("core", "billPay") === false);
ok("Core has obligations", planAllows("core", "obligations") === true);
ok("Core has prompts", planAllows("core", "prompts") === true);
ok("Core has resources", planAllows("core", "resources") === true);
// The whole point of the tier: self-directed, no expert, no bill pay -- everything else included.
ok("Core withholds exactly two features", planExclusions("core").length === 2);
ok("and they are the two named", planExclusions("core").sort().join(",")
  === ["assignedExpert", "billPay"].sort().join(","));
ok("Core is self-serve", planIsSelfServe("core") === true);

console.log("\nWhat Premier includes");
ok("Premier has an assigned expert", planAllows("premier", "assignedExpert") === true);
ok("Premier has workflows", planAllows("premier", "workflows") === true);
ok("Premier has bill pay", planAllows("premier", "billPay") === true);
ok("Premier withholds nothing", planExclusions("premier").length === 0);
ok("every feature key has a human label",
  Object.keys(PLAN_FEATURES.premier).every(k => !!PLAN_FEATURE_LABEL[k]));
// Premier is advisor-sold today, not self-signup -- matches plan_features.self_serve = false.
ok("Premier is not self-serve", planIsSelfServe("premier") === false);

console.log("\nA missing or unrecognised plan");
// This is the decision most likely to be reversed by someone applying the fail-closed rule used
// for the firm-level gates. It is reversed on purpose: the column is NOT NULL DEFAULT 'premier'
// with every household backfilled, so a blank means a stale client or a tier added later -- not an
// unpaid household. Resolving to basic or core would hide the payment register from a household
// paying for bill pay, and a family who cannot see that a bill was paid concludes it was not. The
// database refuses the write regardless, so the generous reading here cannot become a real
// entitlement.
ok("null resolves to premier", normalisePlan(null) === "premier");
ok("undefined resolves to premier", normalisePlan(undefined) === "premier");
ok("an empty string resolves to premier", normalisePlan("") === "premier");
ok("whitespace resolves to premier", normalisePlan("   ") === "premier");
ok("gibberish resolves to premier", normalisePlan("banana") === "premier");
// A tier added above Premier is a superset, so inheriting Premier's features is right.
ok("a future tier resolves to premier", normalisePlan("estate") === "premier");
ok("and so gets bill pay rather than losing it", planAllows("estate", "billPay") === true);

console.log("\nThe legacy 'private' value");
// The upper tier was called 'private' until it was renamed to Premier. The database still accepts
// the old value, because a browser tab opened before the rename shipped will write it and a hard
// failure on an admin action would be worse than an alias. Asserted explicitly: it happens to land
// on premier via the unknown-value branch too, so a future change to that branch could break the
// alias silently and nothing else would notice.
ok("'private' resolves to premier", normalisePlan("private") === "premier");
ok("and it labels as Premier, not as itself", planLabel("private") === "Premier");
ok("and it keeps bill pay", planAllows("private", "billPay") === true);
ok("and it keeps workflows", planAllows("private", "workflows") === true);
ok("and it keeps its assigned expert", planAllows("private", "assignedExpert") === true);
ok("mixed case works too", normalisePlan("Private") === "premier");
// It must NOT appear in the picker -- the form renders one button per PLANS entry.
ok("the old name is not offered as a choice", !PLANS.includes("private"));

console.log("\nSloppy input that should still land on the right plan");
ok("case is ignored", normalisePlan("CORE") === "core");
ok("mixed case is ignored", normalisePlan("Premier") === "premier");
ok("padding is trimmed", normalisePlan("  core  ") === "core");
ok("a padded label still gates correctly", planAllows(" Core ", "billPay") === false);
ok("a number does not throw", normalisePlan(7) === "premier");
ok("an object does not throw", normalisePlan({}) === "premier");

console.log("\nAn unknown feature name");
// A typo in a gate must hide the feature and be noticed, not read as "allowed" and open it to
// every tier. `planAllows(plan,"billpay")` -- wrong case -- is the realistic version of this.
ok("an unknown feature is refused on Premier", planAllows("premier", "nonsense") === false);
ok("an unknown feature is refused on Core", planAllows("core", "nonsense") === false);
ok("a miscased feature name is refused", planAllows("premier", "billpay") === false);
ok("no feature name is refused", planAllows("premier", undefined) === false);
ok("a feature set is never mutated by a lookup",
  planAllows("core", "billPay") === false && PLAN_FEATURES.core.billPay === false);

console.log("\nLabels");
ok("basic labels as Basic", planLabel("basic") === "Basic");
ok("core labels as Core", planLabel("core") === "Core");
ok("premier labels as Premier", planLabel("premier") === "Premier");
ok("an unknown plan labels as Premier rather than blank", planLabel("banana") === "Premier");
ok("a null plan labels rather than throwing", planLabel(null) === "Premier");

console.log("\nThe shape the UI depends on");
// The family form renders one button per PLANS entry and refuses to save until f.plan is one of
// them. If PLANS and PLAN_FEATURES ever disagree, the form offers a plan with no features.
ok("PLANS and PLAN_FEATURES have the same keys",
  PLANS.slice().sort().join(",") === Object.keys(PLAN_FEATURES).sort().join(","));
ok("PLANS and PLAN_LABEL have the same keys",
  PLANS.slice().sort().join(",") === Object.keys(PLAN_LABEL).sort().join(","));
ok("PLANS and PLAN_SELF_SERVE have the same keys",
  PLANS.slice().sort().join(",") === Object.keys(PLAN_SELF_SERVE).sort().join(","));
ok("every plan describes every feature",
  PLANS.every(p => Object.keys(PLAN_FEATURE_LABEL)
    .every(k => typeof PLAN_FEATURES[p][k] === "boolean")));
// Each tier must be a strict superset of the one below it, or "upgrade" would take something away.
ok("Core is a superset of Basic",
  Object.keys(PLAN_FEATURES.basic).every(k => !PLAN_FEATURES.basic[k] || PLAN_FEATURES.core[k]));
ok("Premier is a superset of Core",
  Object.keys(PLAN_FEATURES.core).every(k => !PLAN_FEATURES.core[k] || PLAN_FEATURES.premier[k]));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
