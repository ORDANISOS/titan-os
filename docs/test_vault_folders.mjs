// Tests for CHRIS folder naming, counting and deletion.
//
// These call the real functions from src/vaultFolders.js. Written before the UI, because the
// rules worth protecting are the ones a person will hit by accident: typing a name that
// already exists in a different case, deleting a folder that still holds documents, or a
// document whose category no longer matches anything.
//
// Run: node docs/test_vault_folders.mjs

import {
  BUILTIN_FOLDERS, validateFolderName, buildFolderRows, folderSummary, canDeleteFolder,
  EXPIRY_HORIZON_DAYS,
} from "../src/vaultFolders.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };

console.log("\nNaming a folder");
ok("a plain name is accepted", validateFolderName("Aircraft").ok);
ok("surrounding space is trimmed", validateFolderName("  Aircraft  ").name === "Aircraft");
ok("internal runs of space collapse", validateFolderName("Art  and   wine").name === "Art and wine");
ok("an empty name is refused", !validateFolderName("   ").ok);
ok("the empty-name message is actionable", validateFolderName("").reason === "Give the folder a name.");
ok("41 characters is refused", !validateFolderName("x".repeat(41)).ok);
ok("40 characters is accepted", validateFolderName("x".repeat(40)).ok);

// A folder name becomes documents.category, which is shown in tables and written into report
// prose. Control characters and path separators cause trouble a long way from here.
ok("a slash is refused", !validateFolderName("Tax/2026").ok);
ok("a backslash is refused", !validateFolderName("Tax\\2026").ok);
// A newline is whitespace, so it normalises to a space rather than being refused — someone
// pasting a name that wrapped should not be told off for it. Non-whitespace control
// characters have no such excuse and are refused.
ok("a pasted newline becomes a space", validateFolderName("Tax\nreturns").name === "Tax returns");
ok("a tab becomes a space", validateFolderName("Tax\treturns").name === "Tax returns");
ok("a null byte is refused", !validateFolderName("Tax\u0000returns").ok);
ok("an escape character is refused", !validateFolderName("Tax\u001breturns").ok);
ok("an ampersand is fine", validateFolderName("Art & wine").ok);
ok("an apostrophe is fine", validateFolderName("Children's trusts").ok);
ok("an accent is fine", validateFolderName("Château").ok);

console.log("\nNames that already exist");
ok("an exact built-in is refused", !validateFolderName("Insurance").ok);
// The one a person actually trips over.
ok("a built-in in another case is refused", !validateFolderName("insurance").ok);
ok("and it says it is a standard folder",
  /standard folder/.test(validateFolderName("insurance").reason));
ok("a built-in with padding is refused", !validateFolderName("  Real   Estate ").ok);
ok("an existing custom folder is refused", !validateFolderName("Aircraft", ["Aircraft"]).ok);
ok("in another case too", !validateFolderName("AIRCRAFT", ["Aircraft"]).ok);
ok("and it names the folder that exists",
  validateFolderName("aircraft", ["Aircraft"]).reason === "Aircraft already exists.");
ok("an unrelated existing folder does not block", validateFolderName("Yacht", ["Aircraft"]).ok);

console.log("\nCounting documents into folders");
const docs = [
  { category: "Insurance", uploadedAt: "2026-07-14" },
  { category: "Insurance", uploadedAt: "2026-06-02" },
  { category: "Tax", uploadedAt: "2026-06-02" },
  { category: "Aircraft", uploadedAt: "2026-07-28" },
  { category: "Other", uploadedAt: "2026-07-29" },
];
const rows = buildFolderRows(docs, [{ name: "Aircraft" }]);
const byName = Object.fromEntries(rows.map(r => [r.name, r]));
ok("every built-in folder appears", BUILTIN_FOLDERS.every(b => byName[b]));
ok("the custom folder appears", !!byName.Aircraft);
ok("the custom folder is marked custom", byName.Aircraft.custom === true);
ok("built-ins are not marked custom", byName.Insurance.custom === false);
ok("counts are right", byName.Insurance.count === 2 && byName.Tax.count === 1);
ok("last-updated takes the most recent", byName.Insurance.lastAt === "2026-07-14");
ok("an empty folder reports zero and no date",
  byName.Legal.count === 0 && byName.Legal.lastAt === null);

// Ordering is the whole point of the redesign — the old grid gave an empty folder the same
// weight as one holding twelve documents.
ok("folders with documents sort first", rows[0].count >= rows[1].count);
ok("empty folders sort last", rows[rows.length - 1].count === 0);
ok("share is relative to the fullest folder", byName.Insurance.share === 1);
ok("a half-full folder reports half", byName.Tax.share === 0.5);

// A document whose category matches nothing must not vanish from every count.
const orphan = buildFolderRows([{ category: "Deleted folder", uploadedAt: "2026-07-01" }], []);
const orphanOther = orphan.find(r => r.name === "Other");
ok("a document with an unknown category is counted under Other", orphanOther.count === 1);
ok("nothing is lost — the total still matches",
  orphan.reduce((s, r) => s + r.count, 0) === 1);
ok("a null category is counted under Other",
  buildFolderRows([{ category: null }], []).find(r => r.name === "Other").count === 1);
ok("case differences still match their folder",
  buildFolderRows([{ category: "insurance" }], []).find(r => r.name === "Insurance").count === 1);

console.log("\nThe summary line");
const sum = folderSummary(rows);
ok("total counts every document", sum.total === 5);
// The real problem with the current page: Other holding nearly half of CHRIS, hidden inside
// a total. It gets its own number.
ok("unfiled is reported separately", sum.unfiled === 1);
ok("empty folders are listed by name", sum.emptyFolders.includes("Legal"));
ok("a folder with documents is not listed as empty", !sum.emptyFolders.includes("Insurance"));

console.log("\nDeleting a folder");
ok("a standard folder cannot be removed", !canDeleteFolder(byName.Insurance).ok);
ok("and it says why", /Standard folders/.test(canDeleteFolder(byName.Insurance).reason));
// Deleting a folder holding documents would re-file them into Other behind the user's back.
ok("a custom folder holding documents cannot be removed", !canDeleteFolder(byName.Aircraft).ok);
ok("the message says what to do instead",
  canDeleteFolder(byName.Aircraft).reason === "Move or delete the 1 document in it first.");
ok("plural reads correctly",
  canDeleteFolder({ custom: true, count: 3 }).reason === "Move or delete the 3 documents in it first.");
ok("an empty custom folder can be removed", canDeleteFolder({ custom: true, count: 0 }).ok);

console.log("\nDegenerate input");
ok("no documents and no folders still returns the built-ins",
  buildFolderRows().length === BUILTIN_FOLDERS.length);
ok("undefined arguments do not throw", buildFolderRows(undefined, undefined).length > 0);
ok("a null name is refused rather than crashing", !validateFolderName(null).ok);
ok("canDeleteFolder tolerates nothing", !canDeleteFolder(undefined).ok);

console.log("\nExpiring and expired documents");
// A fixed "today" is passed in. A test that only passes in a particular month is worse than
// no test — it fails months later for a reason unrelated to the change that broke it.
// Built in LOCAL time, deliberately. Production passes new Date(), and local year/month/day
// is what a person means by "today" — so buildFolderRows reads local components. Passing a
// UTC-midnight instant here instead made TODAY land on the previous day in any zone behind
// UTC, which moved the 90-day boundary and failed in UTC and New York while passing in
// Auckland. The code was right; the fixture was in the wrong frame.
const TODAY = new Date(2026, 6, 31);
const day = n => {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const expDocs = [
  { category: "Insurance", expiryDate: day(20) },   // inside the horizon
  { category: "Insurance", expiryDate: day(89) },   // just inside
  { category: "Insurance", expiryDate: day(91) },   // just outside
  { category: "Insurance", expiryDate: day(-5) },   // already lapsed
  { category: "Insurance" },                        // no expiry recorded
  { category: "Tax", expiryDate: day(10) },
];
const e = Object.fromEntries(buildFolderRows(expDocs, [], TODAY).map(r => [r.name, r]));
ok("a document expiring inside the horizon is counted", e.Insurance.expiring === 2,
  `got ${e.Insurance.expiring}`);
ok("the boundary day is inside the horizon",
  buildFolderRows([{ category: "Tax", expiryDate: day(EXPIRY_HORIZON_DAYS) }], [], TODAY)
    .find(r => r.name === "Tax").expiring === 1);
ok("one day past the horizon is not counted",
  buildFolderRows([{ category: "Tax", expiryDate: day(EXPIRY_HORIZON_DAYS + 1) }], [], TODAY)
    .find(r => r.name === "Tax").expiring === 0);
// The distinction that matters: lapsed is not "coming up".
ok("an already-expired document is counted as expired, not expiring",
  e.Insurance.expired === 1 && !String(e.Insurance.expiring).includes("3"));
ok("expiring excludes the expired one", e.Insurance.expiring === 2);
ok("a document with no expiry date counts in neither",
  e.Insurance.count === 5 && e.Insurance.expiring + e.Insurance.expired === 3);
ok("expiry is tracked per folder, not globally", e.Tax.expiring === 1 && e.Tax.expired === 0);
ok("a folder with no expiring documents reports zero", e.Legal.expiring === 0);
ok("an unparseable expiry date is ignored rather than throwing",
  buildFolderRows([{ category: "Tax", expiryDate: "not a date" }], [], TODAY)
    .find(r => r.name === "Tax").expiring === 0);

const eSum = folderSummary(buildFolderRows(expDocs, [], TODAY));
ok("the summary totals expiring across folders", eSum.expiring === 3, `got ${eSum.expiring}`);
ok("the summary reports expired separately", eSum.expired === 1);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
