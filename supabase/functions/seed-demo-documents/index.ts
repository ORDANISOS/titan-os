// Deployed on demo (tkryueqzvgcigvxgjzsp) ONLY. The production project does not have this function.
//
// One-off demo seeder. For the three demo households it:
//   1. clears the rows this function (or the old property seeder) stamped "Demo Seed" for those households,
//   2. writes the hand-authored documents (DOCS below),
//   3. writes property documents generated FROM each property row, plus a scheduled-property
//      schedule from the valuables rows (Core and Premier households only),
//   4. gives every quarterly-statement row (documents.file_path like 'DEMO-SEED/%') a real PDF,
//      generated from the household's own account_balances rows.
//
// Every figure printed in a document comes from, or is checked against, the household's rows, so a
// document never disagrees with the screen beside it.
//
// Safe to re-run. It needs an explicit list of demo household ids, deletes only rows carrying the
// "Demo Seed" stamp inside those households, and rewrites statement rows in place (it never deletes them).
// This replaces seed-property-documents, which deleted property documents across the whole table.
//
// Invoke:  GET  <function url>?families=<id>,<id>,<id>     or     POST {"families":["<id>", ...]}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const sb = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const FAM = {
  basic: "a1000000-0000-4000-8000-000000000005",    // Bennett Family [DEMO]
  core: "a1000000-0000-4000-8000-000000000001",     // Alvarez Family [DEMO]
  premier: "a1000000-0000-4000-8000-000000000002",  // Lindqvist Family Office [DEMO]
};
const PROP = {
  bPrimary: "b1000000-0000-4000-8000-000000000051",
  bCondo: "b1000000-0000-4000-8000-000000000052",
  cLake: "b1000000-0000-4000-8000-000000000002",
  pOffice: "b1000000-0000-4000-8000-000000000011",
};
// Households whose property documents are written by hand in DOCS rather than generated.
const HAND_WRITTEN_PROPERTY_DOCS = new Set([FAM.basic]);

type Spec = {
  family: string;
  property?: string | null;
  name: string;
  category: string;
  description: string;
  expiry?: string | null;
  // documents.property_section: mortgage, tax, insurance_dec, insurance_invoice, flood_dec, rental, valuables_schedule
  section?: string | null;
  docType?: string | null;
  body: string[];
};

const DOCS: Spec[] = [
  // ── Bennett (Basic) ─────────────────────────────────────────────────────────
  // Net worth about $960,000. Rent $1,850 a month, management 10% = $185, brokerage $120,000 and IRA $330,000
  // as at 30 Jun 2026, homeowners premium $2,100, mortgage balance $327,000.
  {
    family: FAM.basic, property: PROP.bCondo,
    name: "Foothills Property Management Agreement", category: "Real Estate",
    description: "Property management agreement, 10% of gross rent",
    body: [
      "RESIDENTIAL PROPERTY MANAGEMENT AGREEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Owner: Alex Bennett",
      "Manager: Foothills Property Management LLC",
      "Contact: Robin Vaughn, (520) 555-0177",
      "Managed Property: 1105 W Mesa Vista St Unit 3B, Tucson, AZ 85745",
      "Term: Commencing April 1, 2023, renewing annually unless canceled with 60 days notice.",
      "",
      "MANAGEMENT FEE: 10% of gross monthly rent collected.",
      "Gross monthly rent: $1,850. Management fee: $185 per month, $2,220 per year.",
      "",
      "ADDITIONAL FEES NOT INCLUDED IN THE 10%:",
      "Tenant placement: 75% of one month's rent, charged on each new tenancy.",
      "Lease renewal: $250 per renewal.",
      "Maintenance coordination: cost plus a 10% administrative markup.",
      "Owner authorization is required for any single repair above $500.",
      "",
      "NOTE FOR REVIEW: with placement and markups included, the all-in cost of outside management",
      "on this property runs materially above the headline 10%. Industry surveys put the all-in",
      "figure at 15-20% of gross rent once these items are counted.",
    ],
  },
  {
    family: FAM.basic, property: PROP.bCondo,
    name: "Homestead Mutual Condo Policy - 1105 W Mesa Vista St 3B", category: "Insurance",
    description: "Landlord policy on the Tucson rental", expiry: "2026-09-15", section: "insurance_dec",
    body: [
      "HOMESTEAD MUTUAL INSURANCE - LANDLORD PROTECTION DECLARATIONS (FICTITIOUS DEMO DOCUMENT)",
      "Named Insured: Alex Bennett",
      "Insured Location: 1105 W Mesa Vista St Unit 3B, Tucson, AZ 85745",
      "Policy Period: September 15, 2025 to September 15, 2026",
      "Annual Premium: $1,100",
      "",
      "Dwelling (Coverage A): $300,000",
      "Personal Property: $12,000",
      "Loss of Rents: 12 months, $22,200",
      "Liability: $300,000 per occurrence",
      "Deductible: $1,500",
      "",
      "RENEWAL: This policy expires September 15, 2026 and has not yet been renewed.",
      "A replacement quote has been requested and is outstanding.",
    ],
  },
  {
    family: FAM.basic, property: PROP.bCondo,
    name: "Residential Lease - 1105 W Mesa Vista St 3B", category: "Real Estate",
    description: "Current tenancy, $1,850/mo through Feb 2027", expiry: "2027-02-28", section: "rental",
    body: [
      "ARIZONA RESIDENTIAL LEASE AGREEMENT - ABSTRACT (FICTITIOUS DEMO DOCUMENT)",
      "Premises: 1105 W Mesa Vista St Unit 3B, Tucson, AZ 85745",
      "Landlord: Alex Bennett, by Foothills Property Management LLC as agent",
      "Tenant: Jesse Hart",
      "Term: March 1, 2026 through February 28, 2027",
      "Monthly Rent: $1,850, due on the first",
      "Security Deposit: $1,850 held in trust by the manager",
      "Rent is collected by the manager and remitted net of the 10% fee, i.e. $1,665 per month.",
      "Tenant is responsible for electricity and internet. Landlord pays water, sewer and the HOA.",
      "HOA assessment: $260 per month, $3,120 per year.",
      "Tenant has been in occupancy since March 2024 and has renewed twice without incident.",
    ],
  },
  {
    family: FAM.basic, property: PROP.bPrimary,
    name: "Heartland Mutual Homeowners and Umbrella - 7412 E Cedar Ridge Rd", category: "Insurance",
    description: "Homeowners plus $1M umbrella, primary residence", expiry: "2027-04-30", section: "insurance_dec",
    body: [
      "HEARTLAND MUTUAL HOMEOWNERS POLICY - DECLARATIONS (FICTITIOUS DEMO DOCUMENT)",
      "Named Insured: Alex and Jamie Bennett",
      "Insured Location: 7412 E Cedar Ridge Rd, Scottsdale, AZ 85251",
      "Policy Period: April 30, 2026 to April 30, 2027",
      "Annual Premium: $2,100",
      "",
      "Dwelling (Coverage A): $660,000 replacement cost",
      "Other Structures: $66,000",
      "Personal Property: $330,000",
      "Loss of Use: 24 months",
      "Personal Liability: $300,000",
      "Deductible: $2,500",
      "",
      "PERSONAL LIABILITY UMBRELLA: $1,000,000, premium $320 included above.",
      "",
      "REVIEW NOTE: the umbrella limit of $1,000,000 was set when the residence was valued at",
      "$510,000. Current value is $640,000 and household net worth is approximately $960,000.",
      "The limit now roughly equals net worth and has not been revisited since 2020.",
    ],
  },
  {
    family: FAM.basic,
    name: "Scheduled Personal Property Endorsement", category: "Insurance",
    description: "Ring scheduled on the homeowners policy", section: "valuables_schedule",
    body: [
      "HEARTLAND MUTUAL - SCHEDULED PERSONAL PROPERTY ENDORSEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Named Insured: Alex and Jamie Bennett",
      "Attaches to homeowners policy on 7412 E Cedar Ridge Rd, Scottsdale, AZ 85251",
      "",
      "SCHEDULED ITEMS:",
      "Heirloom ring, platinum with 0.8ct center stone. Appraised value $8,000, appraisal dated",
      "  March 2024. Scheduled at $8,000, agreed value, no deductible.",
      "2023 mid-size SUV, VIN on file. Insured under a separate auto policy at $32,000",
      "  actual cash value, not scheduled here.",
      "",
      "Total scheduled personal property: $8,000.",
      "REVIEW NOTE: the ring appraisal is dated March 2024. Carriers typically expect an appraisal",
      "no older than three years at renewal.",
    ],
  },
  {
    family: FAM.basic, property: PROP.bPrimary,
    name: "Cedar Federal Bank Mortgage Statement - July 2026", category: "Real Estate",
    description: "Primary residence mortgage, balance $327,000", section: "mortgage",
    body: [
      "CEDAR FEDERAL BANK HOME MORTGAGE - MONTHLY STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Borrower: Alex and Jamie Bennett",
      "Property: 7412 E Cedar Ridge Rd, Scottsdale, AZ 85251",
      "Statement Date: July 1, 2026",
      "",
      "Principal Balance: $327,000",
      "Interest Rate: 3.25% fixed",
      "Monthly Payment (principal and interest): $1,653",
      "Maturity Date: May 1, 2050",
      "Original Loan Amount: $380,000, originated April 2020",
      "",
      "Escrow is not collected on this loan. Property taxes and insurance are paid directly by the",
      "borrower: $3,600 in annual property tax and $2,100 in annual homeowners premium.",
      "",
      "REVIEW NOTE: at 3.25% this is well below current market rates. There is no case for",
      "refinancing and no prepayment penalty.",
    ],
  },
  {
    family: FAM.basic, property: PROP.bPrimary,
    name: "Maricopa County Property Tax Notice 2026", category: "Tax",
    description: "2026 assessment, $3,600 annual", section: "tax",
    body: [
      "MARICOPA COUNTY TREASURER - PROPERTY TAX STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Parcel: 173-42-118A",
      "Owner: Alex and Jamie Bennett",
      "Property: 7412 E Cedar Ridge Rd, Scottsdale, AZ 85251",
      "Tax Year: 2026",
      "",
      "Full Cash Value: $628,000",
      "Limited Property Value: $412,000",
      "Total Tax Due: $3,600",
      "First Half ($1,800) due October 1, 2026. Second Half ($1,800) due March 1, 2027.",
      "",
      "The 2026 assessment rose 6.2% over 2025. No appeal was filed; the deadline has passed.",
    ],
  },
  {
    family: FAM.basic,
    name: "Northgate Joint Brokerage - Q2 2026 Statement", category: "Investment",
    description: "Taxable brokerage, $120,000 as at 30 Jun 2026",
    body: [
      "NORTHGATE BROKERAGE - QUARTERLY STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Account: Joint Taxable Brokerage - Alex and Jamie Bennett",
      "Representative: Cameron Doyle",
      "Statement Period: April 1, 2026 to June 30, 2026",
      "",
      "Closing Value as of June 30, 2026: $120,000",
      "Opening Value April 1, 2026: $112,000",
      "Net Contributions this quarter: $3,000",
      "Investment Gain this quarter: $5,000",
      "",
      "Twelve month history: Sep 30 2025 $95,000. Dec 31 2025 $101,000.",
      "  Mar 31 2026 $112,000. Jun 30 2026 $120,000.",
      "",
      "Dividends and interest paid this quarter: $1,050, substantially all qualified.",
      "Allocation: 68% US equity, 14% international equity, 14% fixed income, 4% cash.",
      "",
      "REVIEW NOTE: cash of 4% sits alongside a separate $55,000 bank reserve. Total cash across",
      "both is above the stated target.",
    ],
  },
  {
    family: FAM.basic,
    name: "Evergreen Funds Rollover IRA - Q2 2026 Statement", category: "Investment",
    description: "Rollover IRA (Alex), $330,000 as at 30 Jun 2026",
    body: [
      "EVERGREEN FUNDS - QUARTERLY ACCOUNT STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Account: Rollover IRA - Alex Bennett",
      "Statement Period: April 1, 2026 to June 30, 2026",
      "",
      "Closing Value as of June 30, 2026: $330,000",
      "Opening Value April 1, 2026: $313,000",
      "Contributions: none. Rollover IRAs do not accept new contributions.",
      "Investment Gain this quarter: $17,000",
      "",
      "History: Dec 31 2025 $305,000. Mar 31 2026 $313,000. Jun 30 2026 $330,000.",
      "Allocation: Target Retirement 2045 fund, 100%.",
      "Primary beneficiary: Jamie Bennett, 100%. Contingent: none named.",
      "",
      "REVIEW NOTE: no contingent beneficiary is named on this account.",
    ],
  },
  {
    family: FAM.basic,
    name: "Bennett Family Revocable Trust - Summary", category: "Estate Planning",
    description: "Revocable living trust, executed 2022",
    body: [
      "BENNETT FAMILY REVOCABLE TRUST - SUMMARY OF TERMS (FICTITIOUS DEMO DOCUMENT)",
      "Grantors: Alex Bennett and Jamie Bennett",
      "Trustees: Alex Bennett and Jamie Bennett, jointly",
      "Successor Trustee: Drew Calloway, Calloway Law Group",
      "Executed: March 18, 2022. Prepared by Calloway Law Group, Phoenix AZ.",
      "",
      "Revocable during the joint lifetimes of the grantors. On the first death the trust divides",
      "into a Survivor's Trust and a Family Trust.",
      "Beneficiaries: the surviving spouse for life, then issue in equal shares.",
      "",
      "ASSETS TITLED IN THE TRUST:",
      "7412 E Cedar Ridge Rd, Scottsdale AZ - deeded to the trust June 2022.",
      "",
      "ASSETS NOT TITLED IN THE TRUST:",
      "1105 W Mesa Vista St Unit 3B, Tucson AZ - acquired March 2023, still held individually.",
      "Northgate joint brokerage - held jointly with right of survivorship, not in trust.",
      "",
      "REVIEW NOTE: the Tucson property was bought after the trust was executed and was never",
      "retitled. As things stand it would pass through probate rather than under the trust.",
    ],
  },
  {
    family: FAM.basic,
    name: "Durable Power of Attorney - Alex Bennett", category: "Legal",
    description: "Financial POA, executed 2022",
    body: [
      "DURABLE GENERAL POWER OF ATTORNEY (FICTITIOUS DEMO DOCUMENT)",
      "Principal: Alex Bennett",
      "Agent: Jamie Bennett",
      "Successor Agent: none named",
      "Executed: March 18, 2022. Notarised. Prepared by Calloway Law Group.",
      "",
      "Effective immediately and durable, surviving the principal's incapacity.",
      "Powers granted: banking, real property, tax matters, retirement plan elections, and",
      "operation of the trust's financial affairs.",
      "Powers withheld: the agent may not make gifts exceeding the annual exclusion amount.",
      "",
      "REVIEW NOTE: no successor agent is named. If the agent cannot act, there is no alternate",
      "and a court-appointed conservator would be required.",
    ],
  },
  {
    family: FAM.basic,
    name: "2025 Form 1040 - Summary Page", category: "Tax",
    description: "Filed return, prepared by Whitaker & Associates",
    body: [
      "U.S. INDIVIDUAL INCOME TAX RETURN 2025 - SUMMARY (FICTITIOUS DEMO DOCUMENT)",
      "Taxpayers: Alex Bennett and Jamie Bennett. Filing status: Married Filing Jointly.",
      "Preparer: Sam Whitaker, CPA - Whitaker & Associates CPAs",
      "",
      "Wages: $166,800",
      "Qualified dividends: $4,200",
      "Rental income (Schedule E, net, before depreciation): $3,160",
      "Total Income: $174,160",
      "Adjusted Gross Income: $174,160",
      "Standard Deduction (married filing jointly): $31,500. Itemising would have given $14,300.",
      "Taxable Income: $142,660",
      "Total Tax: $21,213",
      "Withholding and payments: $22,400. Refund: $1,187.",
      "",
      "Arizona return filed. State tax rate applied: 2.5%.",
      "",
      "REVIEW NOTE: Schedule E shows the $2,220 management fee and $3,120 HOA as deductible",
      "against rental income. Neither spouse made an IRA or HSA contribution for 2025.",
    ],
  },

  // ── Alvarez (Core) ──────────────────────────────────────────────────────────
  // Net worth about $3.0M. Sale of the family company: $1,200,000 total consideration.
  {
    family: FAM.core,
    name: "Alvarez Logistics - Stock Purchase Agreement", category: "Legal",
    description: "Sale of company, executed May 2026",
    body: [
      "STOCK PURCHASE AGREEMENT - EXECUTION COPY (FICTITIOUS DEMO DOCUMENT)",
      "Seller: Jordan Alvarez, sole shareholder",
      "Target: Alvarez Logistics, Inc., a Texas corporation",
      "Buyer: Ridgeline Freight Holdings, LLC",
      "Closing Date: May 22, 2026",
      "Total Consideration: $1,200,000",
      "  Cash at closing: $960,000",
      "  Escrow holdback (18 months): $120,000",
      "  Seller note, 3 years at 6.0%: $120,000",
      "Transition Services: Seller to provide consulting services for 12 months at $8,500 per month.",
      "Non-compete: 4 years within the state of Texas.",
      "Section 8.4 - Tax Matters: The parties acknowledge the shares may constitute qualified small",
      "business stock under IRC Section 1202. Seller is responsible for its own Section 1202 analysis.",
    ],
  },
  {
    family: FAM.core,
    name: "QSBS Eligibility Memorandum", category: "Tax",
    description: "CPA analysis of Section 1202 exclusion",
    body: [
      "MEMORANDUM - QUALIFIED SMALL BUSINESS STOCK ANALYSIS (FICTITIOUS DEMO DOCUMENT)",
      "Prepared by: Pat Sutherland, CPA, Sutherland and Co.",
      "Date: June 18, 2026",
      "Re: Jordan Alvarez - IRC Section 1202 exclusion, Alvarez Logistics Inc.",
      "CONCLUSION: Shares acquired at original issuance in March 2014 appear to satisfy the five-year",
      "holding period and the active business requirement. Gross assets were under $50,000,000 at issuance.",
      "Estimated eligible gain: $1,150,000. This is below the $10,000,000 statutory cap, so the full",
      "gain appears excludable.",
      "Estimated federal tax saving if sustained: approximately $273,700 (23.8% of $1,150,000).",
      "OPEN ITEMS: (1) Obtain the 2014 capitalization table and stock certificate to document original",
      "issuance. (2) Confirm no redemptions occurred within the disqualifying windows.",
      "(3) Obtain a representation letter from the company regarding gross assets at issuance.",
      "These items must be resolved before the 2026 return is filed.",
    ],
  },
  {
    family: FAM.core,
    name: "Northgate Private Wealth Q2 2026 Statement", category: "Investment",
    description: "Private Wealth quarterly statement",
    body: [
      "NORTHGATE PRIVATE WEALTH MANAGEMENT - QUARTERLY STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Account: Alvarez Family - DEMO-NPW-33108",
      "Advisor: Blake Sanders",
      "Period: April 1, 2026 to June 30, 2026",
      "Beginning Market Value: $214,000",
      "Net Contributions: $700,000 (sale proceeds received May 2026)",
      "Investment Gain/(Loss): $26,000",
      "Ending Market Value: $940,000",
      "Asset Allocation: Cash and Treasuries 41%, Equities 38%, Fixed Income 21%",
      "Note: Allocation is intentionally defensive pending completion of the investment policy statement.",
      "$310,000 additionally held at Prairie Crest Bank in a cash management account.",
    ],
  },
  {
    family: FAM.core, property: PROP.cLake,
    name: "Lake House Rental Management Agreement", category: "Real Estate",
    description: "Short-term rental management, seasonal",
    body: [
      "PROPERTY MANAGEMENT AGREEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Property: 812 Lakeway Dr, Lakeway, TX 78734",
      "Owner: Alvarez Family Trust",
      "Manager: Lakeview Rentals, (512) 555-0333",
      "Effective: January 1, 2026, renewing annually",
      "Management Fee: 8% of gross collected rents",
      "Projected gross seasonal rental income: $2,100 per month averaged annually",
      "Net to owner after management fee: approximately $1,932 per month",
      "Manager handles booking, cleaning, and routine maintenance under $1,500 per occurrence.",
      "Owner maintains property insurance through Beacon Private Insurance ($3,100 annually) and flood",
      "coverage through FEMA NFIP ($1,300 annually), both expiring February 28, 2027.",
    ],
  },

  // ── Lindqvist Family Office (Premier) ───────────────────────────────────────
  // Net worth about $18.0M.
  {
    family: FAM.premier,
    name: "Lindqvist Dynasty Trust Agreement", category: "Estate Planning",
    description: "GST-exempt irrevocable dynasty trust",
    body: [
      "LINDQVIST DYNASTY TRUST - IRREVOCABLE TRUST AGREEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Settlor: Morgan Lindqvist",
      "Date of Agreement: January 14, 2018",
      "Situs: South Dakota",
      "Trustee: Lakeshore Trust Company of Delaware, corporate trustee",
      "Trust Protector: Avery Lindgren, Esq., Lindgren Fiduciary Law",
      "Current Beneficiaries: Taylor Lindqvist and Riley Lindqvist, and their descendants",
      "GST Exemption Allocated: $1,400,000 at funding; the trust is fully GST-exempt.",
      "Current Trust Corpus: $2,000,000 held at Lakeshore Trust",
      "DISTRIBUTION STANDARD: The trustee may distribute income and principal for health, education,",
      "maintenance and support, with a preference for education and business formation.",
      "Quarterly distributions require trustee approval. Q3 2026 approvals are outstanding.",
      "Annual trustee meeting is scheduled for August 22, 2026.",
    ],
  },
  {
    family: FAM.premier,
    name: "Keystone Private Client Policy Schedule", category: "Insurance",
    description: "Consolidated schedule, all locations and collections", expiry: "2026-12-15",
    body: [
      "KEYSTONE PRIVATE CLIENT GROUP - CONSOLIDATED POLICY SCHEDULE (FICTITIOUS DEMO DOCUMENT)",
      "Named Insured: Lindqvist Holdings LLC and Morgan Lindqvist",
      "Policy Number: DEMO-KPC-770145",
      "Policy Period: December 15, 2025 to December 15, 2026",
      "LOCATION 1 - 88 Harbor Point Dr, Naples FL: Dwelling $5,600,000; premium $24,000",
      "LOCATION 2 - 455 Red Mountain Rd, Aspen CO: Dwelling $2,900,000; premium $11,500",
      "SCHEDULED FINE ART: Post-war abstract collection, 11 works, $850,000 agreed value",
      "SCHEDULED JEWELRY: Estate jewelry, $240,000 agreed value, appraised 2025",
      "EXCESS LIABILITY: $10,000,000",
      "IMPORTANT GAP: The 1967 classic grand tourer coupe, valued at approximately $600,000, does NOT appear",
      "on any schedule under this policy and is believed to be uninsured. This has been raised with the",
      "client twice and remains unresolved. An appraisal is required before it can be added.",
      "The 52ft sailing yacht is insured separately through Seaward Marine Insurance.",
    ],
  },
  {
    family: FAM.premier, property: PROP.pOffice,
    name: "Downtown Office - Anchor Tenant Lease", category: "Real Estate",
    description: "Commercial lease, anchor tenant, expires 2027", expiry: "2027-06-30",
    body: [
      "COMMERCIAL OFFICE LEASE - ABSTRACT (FICTITIOUS DEMO DOCUMENT)",
      "Premises: 400 Bayfront Plaza Suite 900, Miami, FL 33131",
      "Landlord: Lindqvist Commercial Partners LP",
      "Tenant: Lantern Capital Advisors LLC (anchor tenant, 62% of rentable area)",
      "Leasing Agent: Harbor CRE Services",
      "Term: July 1, 2022 through June 30, 2027",
      "Base Rent: $21,000 per month, 3% annual escalation",
      "Building Occupancy: 92% leased",
      "Net rental income to ownership after 4% management fee: approximately $20,160 per month",
      "Tenant has one 5-year renewal option, exercisable no later than December 31, 2026.",
      "RENEWAL RISK: If the anchor tenant does not renew, building occupancy falls to approximately 30%.",
      "Underlying debt: $1,450,000 with Redwood Commercial Bank at 5.65%, maturing March 1, 2029.",
    ],
  },
  {
    family: FAM.premier,
    name: "Clearwater Private Bank Q2 2026 Statement", category: "Investment",
    description: "Private Bank consolidated quarterly statement",
    body: [
      "CLEARWATER PRIVATE BANK - CONSOLIDATED QUARTERLY STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Relationship: Lindqvist Family Office - DEMO-CPB-11204",
      "Banker: Parker Dean",
      "Period: April 1, 2026 to June 30, 2026",
      "Beginning Market Value: $4,925,000",
      "Net Contributions/(Withdrawals): ($45,000)",
      "Investment Gain: $220,000",
      "Ending Market Value: $5,100,000",
      "Asset Allocation: Equities 54%, Fixed Income 22%, Alternatives 18%, Cash 6%",
      "SECURITIES-BACKED LINE OF CREDIT: $600,000 drawn against the portfolio, held at Harborline Bank.",
      "Current rate SOFR plus 1.35%. Interest is being serviced monthly from operating cash.",
      "Additional relationships: Lakeshore Trust $2,000,000 (trust); Highland Capital Markets $1,000,000 (alternatives).",
    ],
  },
  {
    family: FAM.premier,
    name: "Art Collection Appraisal 2025", category: "Other",
    description: "Independent appraisal, 11 works",
    body: [
      "FINE ART APPRAISAL REPORT (FICTITIOUS DEMO DOCUMENT)",
      "Prepared for: Lindqvist Holdings LLC",
      "Prepared by: Rowan Fielding, Fielding Collection Management",
      "Effective Date of Value: November 12, 2025",
      "Purpose: Insurance scheduling, retrospective and current fair market value",
      "Total Appraised Value: $850,000 across 11 works",
      "Notable holdings include four mid-century abstract canvases acquired between 2004 and 2011,",
      "three works on paper, and a bronze edition sculpture.",
      "The collection is stored and displayed at the Naples waterfront residence, with two works on loan.",
      "Recommendation: revalue every 3 years; next appraisal due November 2028.",
      "All works are scheduled under the Keystone Private Client policy at agreed value.",
    ],
  },
];

// ── PDF building ──────────────────────────────────────────────────────────────

const W = 612, H = 792, M = 56;
const NAVY = rgb(0.08, 0.16, 0.29);
const GOLD = rgb(0.79, 0.71, 0.52);
const BODY = rgb(0.13, 0.16, 0.22);

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const dt = (s: string | null | undefined) =>
  !s ? "n/a" : new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const yr = (s: string | null | undefined) => (s ? new Date(s).getUTCFullYear() : 2026);

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

// Strip anything the standard PDF fonts (WinAnsi) can't encode, which would otherwise throw inside drawText.
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
    const isHeading = raw === raw.toUpperCase() && raw.replace(/[^A-Z]/g, "").length > 8;
    const font = isHeading ? bold : reg;
    const size = isHeading ? 9.5 : 10;
    for (const line of wrap(clean(raw), font, size, W - M * 2)) {
      if (y < M + 40) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(line, { x: M, y, size, font, color: isHeading ? NAVY : BODY });
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

// Rows this function writes are stamped with this. Anything else in the table was put there by a person
// or by another seeder, and is not ours to delete.
const SEED_STAMP = "Demo Seed";

// ── Property documents, generated from the property rows ─────────────────────

function countyFor(p: any): string {
  if (p.county) return String(p.county).toUpperCase();
  if (p.city === "Miami") return "MIAMI-DADE COUNTY";
  if (p.state === "FL") return "COLLIER COUNTY";
  if (p.state === "TX") return "TRAVIS COUNTY";
  if (p.state === "CO") return "PITKIN COUNTY";
  if (p.state === "AZ") return "MARICOPA COUNTY";
  return "COUNTY";
}

function specsForProperty(p: any): Spec[] {
  const out: Spec[] = [];
  const addr = [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ");
  const label = p.name || addr;
  const fam = p.family_id;

  if (p.lender && Number(p.loan_balance) > 0) {
    const orig = Number(p.purchase_price) ? Math.round(Number(p.purchase_price) * 0.72) : Number(p.loan_balance);
    out.push({
      family: fam, property: p.id, section: "mortgage",
      name: `Mortgage Note - ${label}`, category: "Real Estate", docType: "mortgage",
      description: `${p.lender} loan documents`, expiry: p.loan_maturity_date,
      body: [
        "PROMISSORY NOTE AND LOAN SUMMARY (FICTITIOUS DEMO DOCUMENT)",
        `Lender: ${p.lender}`,
        `Borrower: ${p.owner_name || "Owner of record"}`,
        `Secured Property: ${addr}`,
        `Loan Number: DEMO-LN-${String(p.id).slice(0, 8).toUpperCase()}`,
        `Loan Type: ${p.loan_type || "Conventional"}`,
        `Original Principal: ${money(Math.max(orig, Number(p.loan_balance)))}`,
        `Current Principal Balance: ${money(p.loan_balance)}`,
        `Interest Rate: ${p.interest_rate ?? "n/a"}% per annum`,
        `Monthly Payment: ${money(p.loan_payment)}`,
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

  if (Number(p.property_taxes) > 0) {
    const annual = Number(p.property_taxes);
    const assessed = Number(p.current_value) ? Math.round(Number(p.current_value) * 0.92) : annual * 80;
    out.push({
      family: fam, property: p.id, section: "tax",
      name: `${yr(null)} Property Tax Bill - ${label}`, category: "Tax", docType: "taxes",
      description: "Annual real property tax statement",
      body: [
        `${countyFor(p)} TAX COLLECTOR - REAL PROPERTY TAX BILL (FICTITIOUS DEMO DOCUMENT)`,
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

  if (p.insurance_company) {
    const val = Number(p.current_value || 0);
    out.push({
      family: fam, property: p.id, section: "insurance_dec",
      name: `Insurance Declarations - ${label}`, category: "Insurance", docType: "insurance",
      description: `${p.insurance_company} declarations page`, expiry: p.insurance_expiration,
      body: [
        `${String(p.insurance_company).toUpperCase()} - POLICY DECLARATIONS PAGE (FICTITIOUS DEMO DOCUMENT)`,
        `Named Insured: ${p.owner_name || "Owner of record"}`,
        `Insured Location: ${addr}`,
        `Policy Number: DEMO-POL-${String(p.id).slice(0, 8).toUpperCase()}`,
        `Policy Period: ${p.insurance_expiration ? dt(new Date(new Date(p.insurance_expiration).getTime() - 365 * 86400000).toISOString().slice(0, 10)) : "n/a"} to ${dt(p.insurance_expiration)}`,
        `Annual Premium: ${money(p.insurance_premium)}`,
        `Coverage A - Dwelling: ${money(p.current_value)}`,
        `Coverage B - Other Structures: ${money(Math.round(val * 0.1))}`,
        `Coverage C - Personal Property: ${money(Math.round(val * 0.5))}`,
        "Coverage D - Loss of Use: 24 months, actual loss sustained",
        "Personal Liability: $500,000 (excess liability written separately where applicable)",
        p.state === "FL"
          ? `Hurricane Deductible: 2% of Coverage A (${money(Math.round(val * 0.02))})`
          : "Windstorm Deductible: $10,000",
        "All Other Perils Deductible: $10,000",
        `Mortgagee Clause: ${p.lender || "None of record"}`,
        p.flood_insurance
          ? "NOTE: Flood peril is EXCLUDED from this policy and is covered under a separate flood policy."
          : "NOTE: Flood peril is EXCLUDED from this policy and no separate flood policy is on file.",
      ],
    });

    const prem = Number(p.insurance_premium || 0);
    out.push({
      family: fam, property: p.id, section: "insurance_invoice",
      name: `Insurance Invoice - ${label}`, category: "Insurance", docType: "bills",
      description: `${p.insurance_company} premium invoice`, expiry: p.insurance_expiration,
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

  if (p.flood_insurance && p.flood_insurance_company) {
    out.push({
      family: fam, property: p.id, section: "flood_dec",
      name: `Flood Insurance Declarations - ${label}`, category: "Insurance", docType: "insurance",
      description: `${p.flood_insurance_company} flood policy`, expiry: p.flood_insurance_expiration,
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

  if (Number(p.rental_income) > 0) {
    const rent = Number(p.rental_income);
    const mgmt = Number(p.property_management_fee_pct || 0);
    out.push({
      family: fam, property: p.id, section: "rental",
      name: `Rental Agreement - ${label}`, category: "Real Estate", docType: "legal",
      description: "Lease and management terms",
      body: [
        "RENTAL AGREEMENT AND MANAGEMENT SUMMARY (FICTITIOUS DEMO DOCUMENT)",
        `Premises: ${addr}`,
        `Landlord: ${p.owner_name || "Owner of record"}`,
        "Lease Term: 12 months, currently in force",
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
  const clean_name = familyName.replace(" [DEMO]", "");
  const carriers = [...new Set(insured.map((v) => v.insurance_company).filter(Boolean))];
  const uninsured = vals.filter((v) => !v.insured);
  const total = insured.reduce((s, v) => s + Number(v.estimated_value || 0), 0);
  return {
    family: familyId, property: null, section: "valuables_schedule",
    name: `Scheduled Personal Property - ${clean_name}`,
    category: "Insurance", docType: "insurance", description: "Valuables schedule / rider",
    body: [
      "SCHEDULED PERSONAL PROPERTY ENDORSEMENT (FICTITIOUS DEMO DOCUMENT)",
      `Named Insured: ${clean_name}`,
      `Carrier(s): ${carriers.join(", ") || "n/a"}`,
      `Endorsement Number: DEMO-SPP-${familyId.slice(-4).toUpperCase()}`,
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

// ── Quarterly statements, generated from account_balances ────────────────────

const QTR_END: Record<string, string> = { Q1: "03-31", Q2: "06-30", Q3: "09-30", Q4: "12-31" };
const QTR_START: Record<string, string> = { Q1: "01-01", Q2: "04-01", Q3: "07-01", Q4: "10-01" };
// Net contributions that are part of the story. Everything else in a quarter is treated as market gain/loss.
const CONTRIBUTIONS: Record<string, number> = {
  "d1000000-0000-4000-8000-000000000001|2026-Q2": 700000, // sale proceeds into the Core brokerage account
  "d1000000-0000-4000-8000-000000000002|2026-Q2": 146000, // sale proceeds held in cash
  "d1000000-0000-4000-8000-000000000010|2026-Q2": -45000, // net withdrawal, matches the hand-written Q2 statement
};

function statementBody(famName: string, acct: any, period: string, end: number, begin: number | null, isOpening: boolean): { title: string; body: string[] } {
  const [y, q] = period.split("-");
  const startDate = `${y}-${QTR_START[q]}`;
  const endDate = `${y}-${QTR_END[q]}`;
  const inst = String(acct.institution);
  const isLoc = /line of credit/i.test(String(acct.account_type));
  const acctNo = `DEMO-${String(acct.id).slice(-4).toUpperCase()}`;
  const head = [
    `${inst.toUpperCase()} - QUARTERLY STATEMENT (FICTITIOUS DEMO DOCUMENT)`,
    `Account: ${acct.account_type} - ${acctNo}`,
    `Registered Owner: ${famName.replace(" [DEMO]", "")}`,
    ...(acct.banker_name ? [`Relationship contact: ${acct.banker_name}`] : []),
    `Period: ${dt(startDate)} to ${dt(endDate)}`,
  ];
  if (isOpening || begin === null) {
    return {
      title: `${inst} - ${period} Statement`,
      body: [...head, isLoc ? `Balance owed at ${dt(endDate)}: ${money(end)}` : `Closing Value at ${dt(endDate)}: ${money(end)}`,
        "Opening statement on file for this account. Prior-period detail is not held."],
    };
  }
  const contrib = CONTRIBUTIONS[`${acct.id}|${period}`] ?? 0;
  const gain = end - begin - contrib;
  if (isLoc) {
    return {
      title: `${inst} - ${period} Statement`,
      body: [...head,
        `Balance owed at start of period: ${money(begin)}`,
        `Net draws during the period: ${money(end - begin)}`,
        `Balance owed at ${dt(endDate)}: ${money(end)}`,
        "Rate: SOFR plus 1.35%. Interest is serviced monthly from operating cash.",
        "Collateral: pledged securities account. Margin call threshold not approached."],
    };
  }
  return {
    title: `${inst} - ${period} Statement`,
    body: [...head,
      `Beginning Value: ${money(begin)}`,
      `Net Contributions/(Withdrawals): ${contrib < 0 ? "(" + money(-contrib) + ")" : money(contrib)}`,
      `Investment Gain/(Loss): ${gain < 0 ? "(" + money(-gain) + ")" : money(gain)}`,
      `Ending Value: ${money(end)}`,
      "Values are as reported by the custodian at quarter end. This statement is retained for the household record."],
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function inBatches<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

Deno.serve(async (req) => {
  const created: string[] = [];
  const failed: { name: string; error: string }[] = [];
  let statements = 0;
  try {
    const body = await req.json().catch(() => ({}));
    const fromQuery = (new URL(req.url).searchParams.get("families") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const requested: string[] = Array.isArray(body?.families) && body.families.length ? body.families : fromQuery;
    const known = new Set(Object.values(FAM));
    const families = requested.filter((f) => known.has(f));

    if (!families.length) {
      return new Response(JSON.stringify({
        error: "Pass {\"families\":[\"<uuid>\", ...]} or ?families=<uuid>,<uuid> naming which demo households to seed. This function refuses to run across the whole table.",
        knownFamilies: FAM,
      }, null, 2), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (families.length !== requested.length) {
      return new Response(JSON.stringify({
        error: "One or more ids are not known demo families. Nothing was changed.",
        rejected: requested.filter((f) => !known.has(f)),
      }, null, 2), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // 1. Clear only what a previous run (or the retired property seeder) stamped, inside the named households.
    const { data: old } = await sb.from("documents").select("id,file_path").eq("uploaded_by", SEED_STAMP).in("family_id", families);
    if (old && old.length) {
      const paths = old.map((d: any) => d.file_path).filter(Boolean);
      if (paths.length) await sb.storage.from("documents").remove(paths);
      await sb.from("documents").delete().in("id", old.map((d: any) => d.id));
    }
    const removed = old?.length ?? 0;

    // 2 + 3. Hand-written documents, then property documents and valuables schedules generated from rows.
    const { data: props } = await sb.from("properties").select("*").in("family_id", families);
    const { data: fams } = await sb.from("families").select("id,name").in("id", families);
    const { data: vals } = await sb.from("valuables").select("*").in("family_id", families);

    const specs: Spec[] = DOCS.filter((s) => families.includes(s.family));
    for (const p of props || []) {
      if (!HAND_WRITTEN_PROPERTY_DOCS.has(p.family_id)) specs.push(...specsForProperty(p));
    }
    for (const f of fams || []) {
      if (HAND_WRITTEN_PROPERTY_DOCS.has(f.id)) continue;
      const s = valuablesSchedule(f.id, f.name, (vals || []).filter((v: any) => v.family_id === f.id));
      if (s) specs.push(s);
    }

    let n = 0;
    await inBatches(specs, 6, async (spec) => {
      try {
        const bytes = await buildPdf(spec.name, spec.body);
        const path = `${spec.family}/${Date.now()}-${++n}-${slug(spec.name)}.pdf`;
        const { error: upErr } = await sb.storage.from("documents").upload(path, bytes, { contentType: "application/pdf", upsert: true });
        if (upErr) throw new Error(`upload: ${upErr.message}`);
        const { error: dbErr } = await sb.from("documents").insert({
          family_id: spec.family,
          property_id: spec.property ?? null,
          property_section: spec.section ?? null,
          name: spec.name,
          description: spec.description,
          category: spec.category,
          doc_type: spec.docType ?? null,
          file_path: path,
          file_size: bytes.length,
          file_type: "application/pdf",
          mime_type: "application/pdf",
          expiry_date: spec.expiry ?? null,
          extracted_text: spec.body.join("\n"),
          uploaded_by: SEED_STAMP,
        });
        if (dbErr) throw new Error(`insert: ${dbErr.message}`);
        created.push(spec.name);
      } catch (e) {
        failed.push({ name: spec.name, error: e instanceof Error ? e.message : String(e) });
      }
    });

    // 4. Quarterly statements: give each existing statement row a real PDF, in place.
    const { data: stmts } = await sb.from("documents")
      .select("id,family_id,account_id,account_period,file_path")
      .in("family_id", families).like("file_path", "DEMO-SEED/%");
    const accIds = [...new Set((stmts || []).map((s: any) => s.account_id).filter(Boolean))];
    const { data: accts } = accIds.length ? await sb.from("portfolio_accounts").select("*").in("id", accIds) : { data: [] as any[] };
    const { data: bals } = accIds.length ? await sb.from("account_balances").select("account_id,as_of,balance,source").in("account_id", accIds) : { data: [] as any[] };
    const famName: Record<string, string> = {};
    for (const f of fams || []) famName[f.id] = f.name;

    await inBatches(stmts || [], 6, async (s: any) => {
      try {
        const acct = (accts || []).find((a: any) => a.id === s.account_id);
        if (!acct || !s.account_period) throw new Error("no account or period on statement row");
        const [y, q] = String(s.account_period).split("-");
        const endDate = `${y}-${QTR_END[q]}`;
        const mine = (bals || []).filter((b: any) => b.account_id === acct.id).sort((a: any, b: any) => String(a.as_of).localeCompare(String(b.as_of)));
        const idx = mine.findIndex((b: any) => String(b.as_of) === endDate);
        if (idx < 0) throw new Error(`no balance row for ${endDate}`);
        const endRow = mine[idx];
        const prev = idx > 0 ? mine[idx - 1] : null;
        const isOpening = endRow.source === "opening";
        const { title, body: lines } = statementBody(famName[s.family_id] || "", acct, s.account_period, Number(endRow.balance), prev ? Number(prev.balance) : null, isOpening);
        const bytes = await buildPdf(title, lines);
        const { error: upErr } = await sb.storage.from("documents").upload(s.file_path, bytes, { contentType: "application/pdf", upsert: true });
        if (upErr) throw new Error(`upload: ${upErr.message}`);
        const { error: dbErr } = await sb.from("documents").update({
          name: `${String(acct.institution).replace(/\s+/g, "_")}_${s.account_period}_statement.pdf`,
          file_size: bytes.length, file_type: "application/pdf", mime_type: "application/pdf",
          extracted_text: lines.join("\n"),
        }).eq("id", s.id);
        if (dbErr) throw new Error(`update: ${dbErr.message}`);
        statements++;
      } catch (e) {
        failed.push({ name: `statement ${s.id}`, error: e instanceof Error ? e.message : String(e) });
      }
    });

    return new Response(JSON.stringify({ families, removed, created: created.length, statements, names: created, failed }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e), created: created.length, statements, failed }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
