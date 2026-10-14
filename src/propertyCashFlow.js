// Property costs, derived into cash-flow lines.
//
// THE PROBLEM THIS SOLVES
//
// A property's recurring costs — tax, insurance, flood, utilities, HOA, mortgage —
// are entered on the property record. They were then either (a) invisible to the
// Cash Flow tab entirely, for a property with no rental income, or (b) netted
// silently inside a single "Rental Income (Net)" line, for one with rental income.
// Either way a question like "what do we spend on insurance?" could not be answered
// from the cash-flow ledger, and firms worked around it by ALSO typing the cost into
// the Cash Flow tab by hand. That gave two records of one obligation.
//
// On the demo's Harrington family that produced a live double-count: Gulf Shore's
// $11,400 property tax was subtracted inside the netted rental line AND included in a
// manual "Property Tax Reserve" line covering both properties. Same money, counted
// twice, and only when the includeRental toggle happened to be on.
//
// DERIVED, NOT COPIED — and this is the important decision
//
// The obvious fix is to write real cash_flow_events rows when a property is saved.
// That trades one bug for a worse one: two records that can now disagree. Someone
// edits the property tax — does the row follow? Someone edits the row — does the
// property? Delete the property — does the row survive? Every answer is a rule
// somebody has to remember, and the failure is silent.
//
// These lines are computed at read time and never stored. There is exactly one place
// the number lives, so it cannot drift. This also matches what the codebase already
// did for rental income (`rental_${p.id}`, `_synthetic:true`) — the mechanism existed,
// it just netted everything into one line instead of itemising.
//
// ONE DERIVATION, TWO CONSUMERS
//
// The Cash Flow tab and the AI snapshot both call this. They used to compute property
// costs separately, which is precisely how the screen and the assistant came to
// describe the same money differently. If a figure is wrong now, it is wrong in both
// places at once, which is far easier to notice.

// Monthly amount -> annual, matching FREQ_PER_YEAR in App.jsx.
// Today as a YYYY-MM-DD date in local time (toISOString() is UTC, which is tomorrow after ~8pm Eastern).
const localToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const M = 12;

// Each derived line: what it is, where it comes from, and which category it totals
// into. `field` is named so a reader can go to the property record and check it.
// `vendorField` names the property column holding who is paid, where one exists. The
// property record already carries the carrier and the lender, so a derived line can say
// who the money goes to without any extra data entry.
const COST_FIELDS = [
  { field: "propertyTaxesAnnual",            label: "Property tax",        category: "taxes",               annual: true  },
  { field: "insurancePremiumAnnual",         label: "Insurance premium",   category: "insurance",           annual: true,  vendorField: "insuranceCompany" },
  { field: "floodInsurancePremiumAnnual",    label: "Flood insurance",     category: "insurance",           annual: true,  vendorField: "floodInsuranceCompany" },
  { field: "utilitiesMonthly",               label: "Utilities",           category: "utilities",           annual: false },
  // HOA is a charge for shared grounds and amenities. It goes under property
  // management rather than inventing a category the database constraint would reject.
  { field: "hoaFeeMonthly",                  label: "HOA fee",             category: "property_management", annual: false },
];

// Costs a property record can only hold as ONE blended number.
//
// A property has a single `utilities` figure. A family with separate electric, water and
// gas vendors cannot express that here — they itemise it as expense lines instead. When
// they do, the blended figure must stop being derived or the money is counted twice.
// `itemisedKeys` below carries the property+category pairs a firm has itemised, and any
// derived line matching one steps aside.
const suppressionKey = (propertyId, category) => `${propertyId || ""}::${category}`;

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * Derive cash-flow events from property records.
 *
 * @param properties        Array in the snapshot/client shape (camelCase).
 * @param includeRental     Whether rental properties are in scope at all. This governs
 *                          the property WHOLESALE — its rent and its costs together.
 *                          Including a property's costs while excluding its income
 *                          would make net cash flow look worse than reality, which is
 *                          the opposite of the toggle's purpose.
 * @param forProjection     True when feeding the Cash Flow projection, which honours
 *                          the user's toggles. False for the AI snapshot, which must
 *                          describe what is actually spent regardless of how someone
 *                          has configured a modelling view. A client asking what they
 *                          spend on insurance should not get a different answer because
 *                          a projection checkbox was unticked.
 */
export function derivePropertyEvents(properties, { includeRental = true, forProjection = false, manualEvents = [] } = {}) {
  const out = [];

  // Property+category pairs a firm has already itemised by hand. A derived blended
  // figure for one of these would double-count against the lines they typed, so it
  // steps aside. This is what makes vendor-level itemisation safe: enter electric,
  // water and gas as three vendor lines against a property and the property's single
  // `utilities` figure stops being derived for it.
  const itemisedKeys = new Set(
    (manualEvents || [])
      .filter(e => e.direction === "expense" && e.category && e.propertyId)
      .map(e => suppressionKey(e.propertyId, e.category)));

  (properties || []).forEach(p => {
    const rent = num(p.rentalIncomeMonthly ?? p.rentalIncome);
    const isRental = rent > 0;
    // Only the projection honours the toggle. The snapshot always sees everything.
    if (isRental && forProjection && !includeRental) return;

    const addr = p.address || "Property";
    // `billedFrequency` is how the cost is ACTUALLY billed; `frequency` stays monthly
    // because the projection smooths a property cost across the year.
    //
    // Without this distinction the platform would believe an annual insurance premium is
    // billed monthly — it is stored on the property as an annual figure and divided by 12
    // here — and a spend answer would tell a client "you pay the carrier $1,183 a month" when
    // the carrier takes $14,200 once a year. The rollups read billedFrequency, so a
    // smoothed figure is always described as an average.
    const push = (label, category, monthly, field, vendor, billedFrequency = "monthly") => {
      if (!monthly) return;
      // Itemised by hand for this property and category — do not also derive it.
      if (itemisedKeys.has(suppressionKey(p.id, category))) return;
      out.push({
        vendor: vendor || null,
        billedFrequency,
        id: `prop_${p.id}_${field}`,
        _synthetic: true,
        _source: "property",
        _propertyId: p.id,
        _propertyAddress: addr,
        _field: field,
        direction: "expense",
        eventType: label,
        description: `${addr} — ${label.toLowerCase()}`,
        category,
        amount: Math.round(monthly * 100) / 100,
        frequency: "monthly",
        startDate: localToday(),
        endDate: null,
        taxTreatment: "none",
        notes: `From property record: ${addr}`,
        sortOrder: 999000,
      });
    };

    COST_FIELDS.forEach(c => {
      const raw = num(p[c.field] ?? p[c.field.replace(/Annual$|Monthly$/, "")]);
      // The carrier is already on the property record, so a derived line can name who
      // is paid without anyone entering it twice.
      push(c.label, c.category, c.annual ? raw / M : raw, c.field,
        c.vendorField ? (p[c.vendorField] || null) : null,
        // A figure held as an annual total IS billed annually. Tax and premiums are the
        // cases that matter; utilities and HOA are genuinely monthly.
        c.annual ? "annually" : "monthly");
    });

    // The mortgage is opt-out per property (includeMortgageInCashflow). A household
    // that services a loan from a different pot legitimately excludes it, so the flag
    // is honoured rather than overridden.
    if (p.includeMortgageInCashflow !== false) {
      push("Mortgage payment", "debt_service",
        num(p.monthlyPayment ?? p.loanPayment), "monthlyPayment", p.lender || null);
      push("Second mortgage", "debt_service",
        num(p.secondMortgagePaymentMonthly ?? p.secondMortgagePayment), "secondMortgagePayment", p.lender || null);
    }

    if (isRental) {
      // Management fee is a percentage OF the rent, so it only exists where rent does.
      const pct = num(p.propertyManagementFeePct);
      if (pct) push("Management fee", "property_management", rent * (pct / 100), "propertyManagementFeePct");

      // Gross rent as income. Previously this was net of every cost above, which is
      // why those costs could not be totalled by category — they had been subtracted
      // inside an income figure and no longer existed as expenses anywhere.
      out.push({
        id: `rental_${p.id}`,
        _synthetic: true,
        _source: "property",
        _propertyId: p.id,
        _propertyAddress: addr,
        _field: "rentalIncome",
        direction: "income",
        eventType: "Rental Income (Gross)",
        description: addr,
        amount: rent,
        frequency: "monthly",
        startDate: localToday(),
        endDate: null,
        taxTreatment: "ordinary",
        notes: `From property record: ${addr}. Costs are itemised as separate expense lines.`,
        sortOrder: 999000,
      });
    }
  });
  return out;
}

/**
 * Net monthly position for one property, for display next to the property.
 * Kept here so the figure shown on a property card is the same arithmetic the
 * projection uses.
 */
export function propertyNetMonthly(p) {
  const ev = derivePropertyEvents([p], { includeRental: true });
  return ev.reduce((s, e) => s + (e.direction === "income" ? e.amount : -e.amount), 0);
}

/**
 * Where a manual cash-flow line and a derived property line cover the same category,
 * flag it. Not auto-resolved: a manual "Property Tax Reserve" line might be a
 * duplicate of the property's tax figure, or a genuinely separate reserve the family
 * funds on top. Only a person can say which, so this reports and does not delete.
 */
export function findProbableDuplicates(manualEvents, derivedEvents) {
  const annual = e => e.amount * (e.frequency === "monthly" ? 12
    : e.frequency === "quarterly" ? 4 : e.frequency === "annually" ? 1
    : e.frequency === "weekly" ? 52 : e.frequency === "biweekly" ? 26 : 0);

  const manual = (manualEvents || []).filter(e => e.direction === "expense" && e.category);
  const derived = (derivedEvents || []).filter(e => e.direction === "expense" && e.category);

  // Comparing category totals alone raises false alarms, and a false duplicate warning is
  // expensive: it tells an adviser a correct total is double-counted and invites them to
  // delete a line that is real.
  //
  // The case that exposed it: Ocean Vista's utilities itemised by vendor, Gulf Shore's
  // utilities still derived from its property record. Both are "utilities", neither is a
  // duplicate — they are different properties. So a manual line that names its property
  // can only conflict with a derived line for THAT property.
  //
  // A manual line with no property named is different: it could cover any or all of them,
  // so it is still compared against the category as a whole. That is the "Combined
  // property tax reserve, both properties" shape, which genuinely was a duplicate.
  const groups = {};
  const group = key => groups[key] || (groups[key] = {
    category: key.split("::")[0], property: key.split("::")[1] || null,
    manual: 0, derived: 0, manualLines: [], derivedLines: [],
  });

  manual.forEach(e => {
    const g = group(e.propertyId ? `${e.category}::${e.propertyId}` : e.category);
    g.manual += annual(e);
    g.manualLines.push(e.description || e.eventType || "(unnamed)");
  });
  derived.forEach(e => {
    // A derived line lands in the property-specific bucket AND the category-wide one, so
    // it can be matched by either kind of manual line without being counted twice within
    // a single comparison.
    [`${e.category}::${e._propertyId}`, e.category].forEach(key => {
      const g = group(key);
      g.derived += annual(e);
      g.derivedLines.push(`${e._propertyAddress} ${e.eventType}`);
    });
  });

  return Object.values(groups)
    .filter(c => c.manual > 0 && c.derived > 0)
    .map(c => ({
      category: c.category,
      manual: c.manual, derived: c.derived,
      manualLines: c.manualLines, derivedLines: c.derivedLines,
      // Within 2% (or $100) means one obligation entered twice, near enough.
      likelySameMoney: Math.abs(c.manual - c.derived) <= Math.max(100, c.manual * 0.02),
    }))
    .sort((a, b) => b.derived - a.derived);
}
