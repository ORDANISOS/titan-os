// Deployed on demo (tkryueqzvgcigvxgjzsp) v2 ONLY — the prod project (unkirihxtruhdjeldfpm) does not have this function, so there is nothing to compare against and no drift.
// One-off demo seeder: builds the supporting document set for every demo
// property, and an insurance schedule per family for the valuables tab.
//
// Documents are generated FROM each property row, so every figure printed in the
// PDF (premium, balance, rate, maturity, rent) matches what the UI shows. Each
// row is tagged with property_section so the property card can link the right
// document next to the right number.
//
// Per property: mortgage note (only if leveraged), tax bill, insurance
// declarations page, insurance invoice, flood declarations (only if flood
// coverage), rental agreement (only if rented).
//
// Safe to re-run: deletes previously seeded section documents first.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const sb = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const dt = (s: string | null | undefined) =>
  !s ? "n/a" : new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const yr = (s: string | null | undefined) => (s ? new Date(s).getUTCFullYear() : 2026);

const W = 612, H = 792, M = 56;
const NAVY = rgb(0.08, 0.16, 0.29);
const GOLD = rgb(0.79, 0.71, 0.52);
const BODY = rgb(0.13, 0.16, 0.22);

function clean(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) out += ch;
    else if (cp === 0x2019 || cp === 0x2018) out += "'";
    else if (cp === 0x201c || cp === 0x201d) out += '"';
    else if (cp === 0x2013 || cp === 0x2014) out += "-";
  }
  return out;
}
function wrap(text: string, font: any, size: number, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && font.widthOfTextAtSize(t, size) > maxW) { lines.push(cur); cur = w; } else { cur = t; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

async function buildPdf(title: string, body: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([W, H]);
  let y = H - M;
  for (const line of wrap(clean(title), bold, 15, W - M * 2)) {
    page.drawText(line, { x: M, y, size: 15, font: bold, color: NAVY });
    y -= 19;
  }
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: GOLD });
  y -= 22;
  for (const raw of body) {
    const isHead = raw === raw.toUpperCase() && raw.replace(/[^A-Z]/g, "").length > 8;
    const font = isHead ? bold : reg;
    const size = isHead ? 9.5 : 10;
    for (const line of wrap(clean(raw), font, size, W - M * 2)) {
      if (y < M + 40) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(line, { x: M, y, size, font, color: isHead ? NAVY : BODY });
      y -= size + 4.5;
    }
    y -= 4;
  }
  if (y < M + 30) { page = doc.addPage([W, H]); y = H - M; }
  page.drawLine({ start: { x: M, y: M + 14 }, end: { x: W - M, y: M + 14 }, thickness: 1, color: GOLD });
  const foot = "FICTITIOUS DEMONSTRATION DOCUMENT - NOT A REAL FINANCIAL RECORD";
  page.drawText(foot, { x: (W - reg.widthOfTextAtSize(foot, 8)) / 2, y: M, size: 8, font: reg, color: rgb(0.45, 0.5, 0.58) });
  return await doc.save();
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

type Spec = {
  family: string; property: string | null; section: string;
  name: string; category: string; docType: string | null;
  description: string; expiry?: string | null; body: string[];
};

function specsForProperty(p: any): Spec[] {
  const out: Spec[] = [];
  const addr = [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ");
  const label = p.name || addr;

  // ── Mortgage note — only where there is actually debt ───────────────────────
  if (p.lender && Number(p.loan_balance) > 0) {
    const orig = Number(p.purchase_price) ? Math.round(Number(p.purchase_price) * 0.72) : Number(p.loan_balance);
    out.push({
      family: p.family_id, property: p.id, section: "mortgage",
      name: `Mortgage Note - ${label}`, category: "Real Estate", docType: "mortgage",
      description: `${p.lender} loan documents`,
      expiry: p.loan_maturity_date,
      body: [
        "PROMISSORY NOTE AND LOAN SUMMARY (FICTITIOUS DEMO DOCUMENT)",
        `Lender: ${p.lender}`,
        `Borrower: ${p.owner_name || "Owner of record"}`,
        `Secured Property: ${addr}`,
        `Loan Number: DEMO-LN-${String(p.id).slice(0, 8).toUpperCase()}`,
        `Loan Type: ${p.loan_type || "Conventional"}`,
        `Original Principal: ${money(orig)}`,
        `Current Principal Balance: ${money(p.loan_balance)}`,
        `Interest Rate: ${p.interest_rate ?? "n/a"}% per annum`,
        `Monthly Payment (principal and interest): ${money(p.loan_payment)}`,
        `Maturity Date: ${dt(p.loan_maturity_date)}`,
        p.second_mortgage_balance
          ? `Second Position Balance: ${money(p.second_mortgage_balance)}; payment ${money(p.second_mortgage_payment)} per month`
          : "Second Position: none of record",
        "PREPAYMENT: Borrower may prepay in whole or in part at any time without penalty.",
        "ESCROW: Taxes and insurance are NOT escrowed by lender; borrower remits directly.",
        "DEFAULT: Payment more than 15 days late incurs a 4% late charge.",
        "This summary is provided for the client's records and does not modify the underlying note.",
      ],
    });
  }

  // ── Property tax bill ───────────────────────────────────────────────────────
  if (Number(p.property_taxes) > 0) {
    const annual = Number(p.property_taxes);
    const assessed = Number(p.current_value) ? Math.round(Number(p.current_value) * 0.92) : annual * 80;
    out.push({
      family: p.family_id, property: p.id, section: "tax",
      name: `${yr(null)} Property Tax Bill - ${label}`, category: "Tax", docType: "taxes",
      description: "Annual real property tax statement",
      body: [
        `${p.county || (p.state === "FL" ? "COLLIER COUNTY" : p.state === "TX" ? "TRAVIS COUNTY" : p.state === "CO" ? "PITKIN COUNTY" : "WAKE COUNTY")} TAX COLLECTOR - REAL PROPERTY TAX BILL (FICTITIOUS DEMO DOCUMENT)`,
        "Tax Year: 2026",
        `Property Address: ${addr}`,
        `Parcel Number: DEMO-${String(p.id).slice(0, 6).toUpperCase()}-000`,
        `Owner of Record: ${p.owner_name || "Owner of record"}`,
        `Assessed Value: ${money(assessed)}`,
        `Total Tax Due: ${money(annual)}`,
        `First Installment (due November 30, 2026): ${money(Math.round(annual / 2))}`,
        `Second Installment (due March 31, 2027): ${money(annual - Math.round(annual / 2))}`,
        "DISCOUNT SCHEDULE: 4% if paid in November, 3% December, 2% January, 1% February.",
        "Delinquent after April 1, 2027; interest accrues at 1.5% per month.",
        "MILLAGE DETAIL: County general, school district, water management, and municipal services.",
        `Prior Year Tax: ${money(Math.round(annual * 0.96))}`,
        "Payment may be remitted online, by mail, or through an authorized escrow agent.",
      ],
    });
  }

  // ── Hazard insurance declarations page ──────────────────────────────────────
  if (p.insurance_company) {
    out.push({
      family: p.family_id, property: p.id, section: "insurance_dec",
      name: `Insurance Declarations - ${label}`, category: "Insurance", docType: "insurance",
      description: `${p.insurance_company} declarations page`,
      expiry: p.insurance_expiration,
      body: [
        `${String(p.insurance_company).toUpperCase()} - POLICY DECLARATIONS PAGE (FICTITIOUS DEMO DOCUMENT)`,
        `Named Insured: ${p.owner_name || "Owner of record"}`,
        `Insured Location: ${addr}`,
        `Policy Number: DEMO-POL-${String(p.id).slice(0, 8).toUpperCase()}`,
        `Policy Period: ${p.insurance_expiration ? dt(new Date(new Date(p.insurance_expiration).getTime() - 365 * 86400000).toISOString().slice(0, 10)) : "n/a"} to ${dt(p.insurance_expiration)}`,
        `Annual Premium: ${money(p.insurance_premium)}`,
        `Coverage A - Dwelling: ${money(p.current_value)}`,
        `Coverage B - Other Structures: ${money(Math.round(Number(p.current_value || 0) * 0.1))}`,
        `Coverage C - Personal Property: ${money(Math.round(Number(p.current_value || 0) * 0.5))}`,
        "Coverage D - Loss of Use: 24 months, actual loss sustained",
        "Personal Liability: $1,000,000 (excess liability written separately where applicable)",
        p.state === "FL"
          ? `Hurricane Deductible: 2% of Coverage A (${money(Math.round(Number(p.current_value || 0) * 0.02))})`
          : "Windstorm Deductible: $10,000",
        "All Other Perils Deductible: $10,000",
        `Mortgagee Clause: ${p.lender || "None of record"}`,
        p.flood_insurance
          ? "NOTE: Flood peril is EXCLUDED from this policy and is covered under a separate flood policy."
          : "NOTE: Flood peril is EXCLUDED from this policy and no separate flood policy is on file.",
      ],
    });

    // ── Insurance invoice ─────────────────────────────────────────────────────
    const prem = Number(p.insurance_premium || 0);
    out.push({
      family: p.family_id, property: p.id, section: "insurance_invoice",
      name: `Insurance Invoice - ${label}`, category: "Insurance", docType: "bills",
      description: `${p.insurance_company} premium invoice`,
      expiry: p.insurance_expiration,
      body: [
        `${String(p.insurance_company).toUpperCase()} - PREMIUM INVOICE (FICTITIOUS DEMO DOCUMENT)`,
        `Invoice Number: DEMO-INV-${String(p.id).slice(0, 6).toUpperCase()}`,
        `Insured: ${p.owner_name || "Owner of record"}`,
        `Insured Location: ${addr}`,
        `Policy Number: DEMO-POL-${String(p.id).slice(0, 8).toUpperCase()}`,
        `Renewal Effective Date: ${dt(p.insurance_expiration)}`,
        `Annual Premium: ${money(prem)}`,
        "Policy Fee: $35",
        "State Surcharge: $18",
        `TOTAL AMOUNT DUE: ${money(prem + 53)}`,
        `Payment Due Date: ${p.insurance_expiration ? dt(new Date(new Date(p.insurance_expiration).getTime() - 21 * 86400000).toISOString().slice(0, 10)) : "n/a"}`,
        "INSTALLMENT OPTION: Four quarterly payments of " + money(Math.round((prem + 53) / 4)) + " plus a $6 per installment service fee.",
        "Coverage will lapse if payment is not received by the due date. No grace period applies to",
        "the initial renewal payment.",
      ],
    });
  }

  // ── Flood declarations ──────────────────────────────────────────────────────
  if (p.flood_insurance && p.flood_insurance_company) {
    out.push({
      family: p.family_id, property: p.id, section: "flood_dec",
      name: `Flood Insurance Declarations - ${label}`, category: "Insurance", docType: "insurance",
      description: `${p.flood_insurance_company} flood policy`,
      expiry: p.flood_insurance_expiration,
      body: [
        `${String(p.flood_insurance_company).toUpperCase()} - FLOOD INSURANCE DECLARATIONS (FICTITIOUS DEMO DOCUMENT)`,
        `Named Insured: ${p.owner_name || "Owner of record"}`,
        `Insured Location: ${addr}`,
        `Policy Number: DEMO-FLD-${String(p.id).slice(0, 8).toUpperCase()}`,
        `Policy Period: expires ${dt(p.flood_insurance_expiration)}`,
        `Annual Premium: ${money(p.flood_insurance_premium)}`,
        "Building Coverage: $250,000 (NFIP maximum for residential)",
        "Contents Coverage: $100,000",
        "Deductible: $5,000 building / $5,000 contents",
        "Flood Zone: AE",
        "EXCESS FLOOD: Building value exceeds the NFIP maximum. Excess flood coverage is",
        "recommended and is not currently in force.",
      ],
    });
  }

  // ── Rental agreement ────────────────────────────────────────────────────────
  if (Number(p.rental_income) > 0) {
    const rent = Number(p.rental_income);
    const mgmt = Number(p.property_management_fee_pct || 0);
    out.push({
      family: p.family_id, property: p.id, section: "rental",
      name: `Rental Agreement - ${label}`, category: "Real Estate", docType: "legal",
      description: "Lease and management terms",
      body: [
        "RENTAL AGREEMENT AND MANAGEMENT SUMMARY (FICTITIOUS DEMO DOCUMENT)",
        `Premises: ${addr}`,
        `Landlord: ${p.owner_name || "Owner of record"}`,
        `Lease Term: 12 months, currently in force`,
        `Monthly Rent: ${money(rent)}, due on the first of each month`,
        `Security Deposit: ${money(rent * 2)}`,
        mgmt > 0
          ? `Management Fee: ${mgmt}% of collected rent (${money(Math.round(rent * mgmt / 100))} per month)`
          : "Management Fee: none, owner self-managed",
        mgmt > 0
          ? `Net Rent to Owner: ${money(Math.round(rent * (1 - mgmt / 100)))} per month`
          : `Net Rent to Owner: ${money(rent)} per month`,
        `HOA Dues (landlord paid): ${money(p.hoa_fee)} per month`,
        "Tenant pays electricity and internet. Landlord pays water, sewer, and HOA dues.",
        "LATE RENT: 5% late fee after the fifth day of the month.",
        "RENEWAL: Either party must give 60 days written notice prior to expiration.",
        "INSURANCE: Landlord maintains property coverage; tenant is required to carry renters",
        "insurance with $300,000 liability and to name the landlord as an interested party.",
      ],
    });
  }

  return out;
}

function valuablesSchedule(familyId: string, familyName: string, vals: any[]): Spec | null {
  const insured = vals.filter((v) => v.insured);
  if (!insured.length) return null;
  const carriers = [...new Set(insured.map((v) => v.insurance_company).filter(Boolean))];
  const uninsured = vals.filter((v) => !v.insured);
  const total = insured.reduce((s, v) => s + Number(v.estimated_value || 0), 0);
  return {
    family: familyId, property: null, section: "valuables_schedule",
    name: `Scheduled Personal Property - ${familyName.replace(" [DEMO]", "")}`,
    category: "Insurance", docType: "insurance",
    description: "Valuables schedule / rider",
    body: [
      "SCHEDULED PERSONAL PROPERTY ENDORSEMENT (FICTITIOUS DEMO DOCUMENT)",
      `Named Insured: ${familyName.replace(" [DEMO]", "")}`,
      `Carrier(s): ${carriers.join(", ") || "n/a"}`,
      `Endorsement Number: DEMO-SPP-${familyId.slice(0, 8).toUpperCase()}`,
      "Valuation Basis: agreed value, no deductible on scheduled items",
      "SCHEDULE OF COVERED ITEMS",
      ...insured.map((v) =>
        `  ${v.category}: ${v.description}${v.make_model ? ` (${v.make_model})` : ""} - ${money(v.estimated_value)} - ${v.insurance_company || "carrier on file"}`
      ),
      `TOTAL SCHEDULED VALUE: ${money(total)}`,
      ...(uninsured.length
        ? [
            "ITEMS NOT SCHEDULED - COVERAGE GAP",
            ...uninsured.map((v) =>
              `  ${v.category}: ${v.description}${v.make_model ? ` (${v.make_model})` : ""} - ${money(v.estimated_value)} - NOT COVERED`
            ),
            `Total unscheduled value at risk: ${money(uninsured.reduce((s, v) => s + Number(v.estimated_value || 0), 0))}`,
            "ACTION REQUIRED: obtain a current appraisal for each unscheduled item and add it to this",
            "endorsement. Unscheduled items fall under the base policy sublimits, which are materially",
            "lower than the values shown above.",
          ]
        : ["All identified valuables are scheduled. No coverage gap noted."]),
      "Appraisals on file are required for any item exceeding $50,000 in agreed value.",
    ],
  };
}

Deno.serve(async () => {
  const created: string[] = [];
  const failed: { name: string; error: string }[] = [];
  try {
    // Idempotent: remove anything a prior run of THIS seeder created, leaving
    // the general CHRIS documents (property_section is null) untouched.
    const { data: old } = await sb.from("documents").select("id,file_path").not("property_section", "is", null);
    if (old?.length) {
      const paths = old.map((d: any) => d.file_path).filter(Boolean);
      if (paths.length) await sb.storage.from("documents").remove(paths);
      await sb.from("documents").delete().in("id", old.map((d: any) => d.id));
    }

    const { data: props } = await sb.from("properties").select("*");
    const { data: fams } = await sb.from("families").select("id,name");
    const { data: vals } = await sb.from("valuables").select("*");

    const specs: Spec[] = [];
    for (const p of props || []) specs.push(...specsForProperty(p));
    for (const f of fams || []) {
      const s = valuablesSchedule(f.id, f.name, (vals || []).filter((v: any) => v.family_id === f.id));
      if (s) specs.push(s);
    }

    for (const spec of specs) {
      try {
        const bytes = await buildPdf(spec.name, spec.body);
        const path = `${spec.family}/${Date.now()}-${slug(spec.name)}.pdf`;
        const { error: upErr } = await sb.storage.from("documents")
          .upload(path, bytes, { contentType: "application/pdf", upsert: true });
        if (upErr) throw new Error(`upload: ${upErr.message}`);
        const { error: dbErr } = await sb.from("documents").insert({
          family_id: spec.family,
          property_id: spec.property,
          property_section: spec.section,
          name: spec.name,
          description: spec.description,
          category: spec.category,
          doc_type: spec.docType,
          file_path: path,
          file_size: bytes.length,
          file_type: "application/pdf",
          mime_type: "application/pdf",
          expiry_date: spec.expiry ?? null,
          extracted_text: spec.body.join("\n"),
          uploaded_by: "Demo Seed",
        });
        if (dbErr) throw new Error(`insert: ${dbErr.message}`);
        created.push(spec.name);
      } catch (e) {
        failed.push({ name: spec.name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({ created: created.length, failed }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e), created: created.length, failed }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
