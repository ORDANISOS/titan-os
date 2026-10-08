// Deployed on demo (tkryueqzvgcigvxgjzsp) v2 ONLY — the prod project (unkirihxtruhdjeldfpm) does not have this function, so there is nothing to compare against and no drift.
// One-off demo seeder: generates real PDF files for the demo families, uploads
// them to the `documents` storage bucket, and inserts the matching documents
// rows with extracted_text populated.
//
// Why a real file and not just a metadata row: CHRIS opens documents through
// storage.createSignedUrl(file_path), so a row without a stored object gives a
// broken download. Writing to storage needs the service-role key, which only
// exists server-side — hence an edge function rather than plain SQL.
//
// extracted_text is set to the same body text drawn into the PDF, so the AI
// assistant can answer from document CONTENTS and its answers stay consistent
// with what the user sees when they open the file.
//
// Safe to re-run: it deletes previously seeded demo docs first.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const sb = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const FAM = {
  harrington: "21133f57-f245-4643-ad20-4b6ce4f2a0d0",
  castellano: "a1000000-0000-4000-8000-000000000001",
  whitmore: "a1000000-0000-4000-8000-000000000002",
  okonkwo: "a1000000-0000-4000-8000-000000000003",
  nakamura: "a1000000-0000-4000-8000-000000000005",   // the Core-plan household
};
const PROP = {
  hPrimary: "6624b878-fad5-4f87-8b96-a9b0e07714e8",
  hCondo: "daa56f78-e07d-4c08-95fe-5a71d925106e",
  cPrimary: "b1000000-0000-4000-8000-000000000001",
  cLake: "b1000000-0000-4000-8000-000000000002",
  wStar: "b1000000-0000-4000-8000-000000000010",
  wBrickell: "b1000000-0000-4000-8000-000000000011",
  wAspen: "b1000000-0000-4000-8000-000000000012",
  oPrimary: "b1000000-0000-4000-8000-000000000020",
  nScottsdale: "b1000000-0000-4000-8000-000000000051",
  nTucson: "b1000000-0000-4000-8000-000000000052",
};

type Spec = {
  family: string;
  property?: string;
  name: string;
  category: string;
  description: string;
  expiry?: string;
  // documents.property_section. Set it and the file appears ON the property card against the
  // figure it evidences, rather than only in the CHRIS list. One of:
  //   mortgage · tax · insurance_dec · insurance_invoice · flood_dec · rental · valuables_schedule
  // valuables_schedule is looked up by family, not by property, and links from the Valuables tab.
  section?: string;
  body: string[];
};

const DOCS: Spec[] = [
  // ── Harrington ──────────────────────────────────────────────────────────────
  {
    family: FAM.harrington, property: PROP.hPrimary,
    name: "Chubb Homeowners Policy - 4 Ocean Vista Dr", category: "Insurance",
    description: "Masterpiece homeowners policy, primary residence", expiry: "2027-03-15",
    body: [
      "CHUBB MASTERPIECE HOMEOWNERS POLICY - DECLARATIONS (FICTITIOUS DEMO DOCUMENT)",
      "Named Insured: James and Elizabeth Harrington",
      "Insured Location: 4 Ocean Vista Dr, Naples, FL 34102",
      "Policy Number: DEMO-CHB-4471902",
      "Policy Period: March 15, 2026 to March 15, 2027",
      "Annual Premium: $14,200",
      "Coverage A - Dwelling: $3,450,000 (extended replacement cost)",
      "Coverage C - Contents: $1,725,000",
      "Personal Liability: $5,000,000",
      "Wind/Hurricane Deductible: 2% of Coverage A ($69,000)",
      "All Other Perils Deductible: $10,000",
      "Scheduled Items: emerald and diamond necklace ($145,000); 2023 Porsche 911 Turbo S ($230,000)",
      "NOTE: The original oil painting valued at $68,000 is NOT currently scheduled on this policy.",
      "Flood coverage is written separately through FEMA NFIP, premium $3,100, expiring March 15, 2027.",
    ],
  },
  {
    family: FAM.harrington,
    name: "Goldman Sachs Q2 2026 Statement", category: "Investment",
    description: "Private Wealth Management quarterly statement",
    body: [
      "GOLDMAN SACHS PRIVATE WEALTH MANAGEMENT - QUARTERLY STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Account: Harrington Family - DEMO-GS-88210",
      "Relationship Manager: Craig Owens",
      "Period: April 1, 2026 to June 30, 2026",
      "Beginning Market Value: $2,612,480",
      "Net Contributions: $0",
      "Investment Gain/(Loss): $102,860",
      "Ending Market Value: $2,715,340",
      "Asset Allocation: Equities 62%, Fixed Income 24%, Alternatives 9%, Cash 5%",
      "Trailing 12-month return: 9.4% net of fees",
      "Advisory fee for the quarter: $6,788 (1.00% annualized)",
    ],
  },
  {
    family: FAM.harrington,
    name: "Harrington Family Trust - Restated 2024", category: "Estate Planning",
    description: "Revocable trust, restated instrument",
    body: [
      "HARRINGTON FAMILY TRUST - AMENDED AND RESTATED DECLARATION OF TRUST (FICTITIOUS DEMO DOCUMENT)",
      "Grantors: James Harrington and Elizabeth Harrington",
      "Date of Restatement: October 4, 2024",
      "Prepared by: Daniel Cho, Esq., Cho and Whitfield LLP",
      "Trustees: James Harrington and Elizabeth Harrington, co-trustees",
      "Successor Trustee: Sophie Harrington, upon reaching age 30",
      "ARTICLE III - DISPOSITIVE PROVISIONS: On the death of the first grantor, the trust divides into a",
      "Survivor's Trust and a Family Trust funded to the available federal exclusion amount.",
      "ARTICLE V - DISTRIBUTIONS TO DESCENDANTS: Distributions to Sophie Harrington are held in",
      "further trust until age 30, with discretionary distributions for health, education, maintenance and support.",
      "ARTICLE VII: The Beachside Condo at 210 Gulf Shore Blvd Unit 8B is titled in the name of this trust.",
      "Annual review recommended; last reviewed October 2024.",
    ],
  },
  {
    family: FAM.harrington, property: PROP.hCondo,
    name: "Beachside Condo Lease - Unit 8B", category: "Real Estate",
    description: "Annual residential lease, tenant-occupied", expiry: "2027-04-30",
    body: [
      "RESIDENTIAL LEASE AGREEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Premises: 210 Gulf Shore Blvd Unit 8B, Naples, FL 34102",
      "Landlord: Harrington Family Trust",
      "Managing Agent: Naples Property Management Co., (239) 555-0333",
      "Term: May 1, 2026 through April 30, 2027",
      "Monthly Rent: $6,800, due on the first of each month",
      "Security Deposit: $13,600",
      "Management Fee: 8% of collected rent",
      "Tenant is responsible for electricity and internet. Landlord pays HOA dues of $980 per month,",
      "water, and sewer. Landlord maintains the HO-6 policy through Citizens Property Insurance.",
      "Renewal notice must be delivered no later than 60 days before expiration.",
    ],
  },
  // ── Castellano ──────────────────────────────────────────────────────────────
  {
    family: FAM.castellano,
    name: "Castellano Logistics - Stock Purchase Agreement", category: "Legal",
    description: "Sale of company, executed May 2026",
    body: [
      "STOCK PURCHASE AGREEMENT - EXECUTION COPY (FICTITIOUS DEMO DOCUMENT)",
      "Seller: Marco Castellano, sole shareholder",
      "Target: Castellano Logistics, Inc., a Texas corporation",
      "Buyer: Meridian Freight Holdings, LLC",
      "Closing Date: May 22, 2026",
      "Total Consideration: $11,400,000",
      "  Cash at closing: $9,120,000",
      "  Escrow holdback (18 months): $1,140,000",
      "  Seller note, 3 years at 6.0%: $1,140,000",
      "Transition Services: Seller to provide consulting services for 12 months at $22,000 per month.",
      "Non-compete: 4 years within the state of Texas.",
      "Section 8.4 - Tax Matters: The parties acknowledge the shares may constitute qualified small",
      "business stock under IRC Section 1202. Seller is responsible for its own Section 1202 analysis.",
    ],
  },
  {
    family: FAM.castellano,
    name: "QSBS Eligibility Memorandum", category: "Tax",
    description: "CPA analysis of Section 1202 exclusion",
    body: [
      "MEMORANDUM - QUALIFIED SMALL BUSINESS STOCK ANALYSIS (FICTITIOUS DEMO DOCUMENT)",
      "Prepared by: Priya Raghunathan, CPA, Raghunathan and Co.",
      "Date: June 18, 2026",
      "Re: Marco Castellano - IRC Section 1202 exclusion, Castellano Logistics Inc.",
      "CONCLUSION: Shares acquired at original issuance in March 2014 appear to satisfy the five-year",
      "holding period and the active business requirement. Gross assets were under $50,000,000 at issuance.",
      "Estimated eligible gain: $10,400,000. Estimated excludable portion: $10,000,000 (statutory cap).",
      "Estimated federal tax saving if sustained: approximately $2,380,000.",
      "OPEN ITEMS: (1) Obtain the 2014 capitalization table and stock certificate to document original",
      "issuance. (2) Confirm no redemptions occurred within the disqualifying windows.",
      "(3) Obtain a representation letter from the company regarding gross assets at issuance.",
      "These items must be resolved before the 2026 return is filed.",
    ],
  },
  {
    family: FAM.castellano,
    name: "Fidelity Q2 2026 Statement", category: "Investment",
    description: "Private Wealth quarterly statement",
    body: [
      "FIDELITY PRIVATE WEALTH MANAGEMENT - QUARTERLY STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Account: Castellano Family - DEMO-FID-33108",
      "Advisor: Sara Kwon",
      "Period: April 1, 2026 to June 30, 2026",
      "Beginning Market Value: $0 (account funded May 2026)",
      "Net Contributions: $9,120,000",
      "Investment Gain/(Loss): $300,000",
      "Ending Market Value: $9,420,000",
      "Asset Allocation: Cash and Treasuries 41%, Equities 38%, Fixed Income 21%",
      "Note: Allocation is intentionally defensive pending completion of the investment policy statement.",
      "$1,875,000 additionally held at Frost Bank in a cash management account.",
    ],
  },
  {
    family: FAM.castellano, property: PROP.cLake,
    name: "Lake House Rental Management Agreement", category: "Real Estate",
    description: "Short-term rental management, seasonal",
    body: [
      "PROPERTY MANAGEMENT AGREEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Property: 812 Lakeway Dr, Lakeway, TX 78734",
      "Owner: Castellano Family Trust",
      "Manager: Hill Country Rentals, (512) 555-0333",
      "Effective: January 1, 2026, renewing annually",
      "Management Fee: 8% of gross collected rents",
      "Projected gross seasonal rental income: $3,800 per month averaged annually",
      "Net to owner after management fee: approximately $3,496 per month",
      "Manager handles booking, cleaning, and routine maintenance under $1,500 per occurrence.",
      "Owner maintains property insurance through Chubb ($7,200 annually) and flood coverage",
      "through FEMA NFIP ($1,900 annually), both expiring February 28, 2027.",
    ],
  },
  // ── Whitmore ────────────────────────────────────────────────────────────────
  {
    family: FAM.whitmore,
    name: "Whitmore Dynasty Trust Agreement", category: "Estate Planning",
    description: "GST-exempt irrevocable dynasty trust",
    body: [
      "WHITMORE DYNASTY TRUST - IRREVOCABLE TRUST AGREEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Settlor: Eleanor Whitmore",
      "Date of Agreement: January 14, 2018",
      "Situs: South Dakota",
      "Trustee: Northern Trust Company of Delaware, corporate trustee",
      "Trust Protector: Margaret Oyelaran, Esq., Oyelaran Fiduciary Law",
      "Current Beneficiaries: Charles Whitmore II and Vivian Whitmore-Reyes, and their descendants",
      "GST Exemption Allocated: $11,180,000 at funding; the trust is fully GST-exempt.",
      "Current Trust Corpus: $9,310,000 held at Northern Trust",
      "DISTRIBUTION STANDARD: The trustee may distribute income and principal for health, education,",
      "maintenance and support, with a preference for education and business formation.",
      "Quarterly distributions require trustee approval. Q3 2026 approvals are outstanding.",
      "Annual trustee meeting is scheduled for August 22, 2026.",
    ],
  },
  {
    family: FAM.whitmore,
    name: "AIG Private Client Policy Schedule", category: "Insurance",
    description: "Consolidated schedule, all locations and collections", expiry: "2026-12-15",
    body: [
      "AIG PRIVATE CLIENT GROUP - CONSOLIDATED POLICY SCHEDULE (FICTITIOUS DEMO DOCUMENT)",
      "Named Insured: Whitmore Holdings LLC and Eleanor Whitmore",
      "Policy Number: DEMO-AIG-PCG-770145",
      "Policy Period: December 15, 2025 to December 15, 2026",
      "LOCATION 1 - 7 Star Island Dr, Miami Beach FL: Dwelling $24,500,000; premium $96,000",
      "LOCATION 2 - 455 Red Mountain Rd, Aspen CO: Dwelling $11,200,000; premium $41,000",
      "SCHEDULED FINE ART: Post-war abstract collection, 11 works, $4,200,000 agreed value",
      "SCHEDULED JEWELRY: Estate jewelry, $890,000 agreed value, appraised 2025",
      "EXCESS LIABILITY: $25,000,000",
      "IMPORTANT GAP: The 1967 Ferrari 275 GTB, valued at approximately $3,100,000, does NOT appear",
      "on any schedule under this policy and is believed to be uninsured. This has been raised with the",
      "client twice and remains unresolved. An appraisal is required before it can be added.",
      "The 78ft Oyster 785 sailing yacht is insured separately through Pantaenius.",
    ],
  },
  {
    family: FAM.whitmore, property: PROP.wBrickell,
    name: "Brickell Office - Anchor Tenant Lease", category: "Real Estate",
    description: "Commercial lease, anchor tenant, expires 2027", expiry: "2027-06-30",
    body: [
      "COMMERCIAL OFFICE LEASE - ABSTRACT (FICTITIOUS DEMO DOCUMENT)",
      "Premises: 1200 Brickell Ave Suite 900, Miami, FL 33131",
      "Landlord: Whitmore Commercial Partners LP",
      "Tenant: Ardent Capital Advisors LLC (anchor tenant, 62% of rentable area)",
      "Leasing Agent: Brickell CRE Services",
      "Term: July 1, 2022 through June 30, 2027",
      "Base Rent: $72,000 per month, 3% annual escalation",
      "Building Occupancy: 92% leased",
      "Net rental income to ownership after 4% management fee: approximately $69,120 per month",
      "Tenant has one 5-year renewal option, exercisable no later than December 31, 2026.",
      "RENEWAL RISK: If the anchor tenant does not renew, building occupancy falls to approximately 30%.",
      "Underlying debt: $3,850,000 with Truist Commercial at 5.65%, maturing March 1, 2029.",
    ],
  },
  {
    family: FAM.whitmore,
    name: "J.P. Morgan Q2 2026 Statement", category: "Investment",
    description: "Private Bank consolidated quarterly statement",
    body: [
      "J.P. MORGAN PRIVATE BANK - CONSOLIDATED QUARTERLY STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Relationship: Whitmore Family Office - DEMO-JPM-11204",
      "Banker: Adrienne Cole",
      "Period: April 1, 2026 to June 30, 2026",
      "Beginning Market Value: $25,910,000",
      "Net Contributions/(Withdrawals): ($240,000)",
      "Investment Gain: $1,170,000",
      "Ending Market Value: $26,840,000",
      "Asset Allocation: Equities 54%, Fixed Income 22%, Alternatives 18%, Cash 6%",
      "SECURITIES-BACKED LINE OF CREDIT: $2,100,000 drawn against the portfolio, held at First Republic.",
      "Current rate SOFR plus 1.35%. Interest is being serviced monthly from operating cash.",
      "Additional relationships: Northern Trust $9,310,000 (trust); Goldman Sachs $4,620,000 (alternatives).",
    ],
  },
  {
    family: FAM.whitmore,
    name: "Art Collection Appraisal 2025", category: "Other",
    description: "Independent appraisal, 11 works",
    body: [
      "FINE ART APPRAISAL REPORT (FICTITIOUS DEMO DOCUMENT)",
      "Prepared for: Whitmore Holdings LLC",
      "Prepared by: Lucia Fontaine, Fontaine Collection Management",
      "Effective Date of Value: November 12, 2025",
      "Purpose: Insurance scheduling, retrospective and current fair market value",
      "Total Appraised Value: $4,200,000 across 11 works",
      "Notable holdings include four mid-century abstract canvases acquired between 2004 and 2011,",
      "three works on paper, and a bronze edition sculpture.",
      "The collection is stored and displayed at the Star Island residence, with two works on loan.",
      "Recommendation: revalue every 3 years; next appraisal due November 2028.",
      "All works are scheduled under the AIG Private Client policy at agreed value.",
    ],
  },
  // ── Okonkwo ─────────────────────────────────────────────────────────────────
  {
    family: FAM.okonkwo, property: PROP.oPrimary,
    name: "State Farm Homeowners Policy", category: "Insurance",
    description: "Homeowners plus umbrella", expiry: "2027-05-31",
    body: [
      "STATE FARM HOMEOWNERS POLICY - DECLARATIONS (FICTITIOUS DEMO DOCUMENT)",
      "Named Insured: Ada Okonkwo and Emeka Okonkwo",
      "Insured Location: 2208 Cameron Glen Dr, Raleigh, NC 27608",
      "Policy Number: DEMO-SF-6620418",
      "Policy Period: June 1, 2026 to May 31, 2027",
      "Annual Premium: $4,900",
      "Coverage A - Dwelling: $1,985,000",
      "Coverage C - Personal Property: $992,500",
      "Personal Liability: $500,000",
      "Deductible: $2,500",
      "Personal Umbrella Policy: $2,000,000 (separate declaration)",
      "NOTE: Wedding and inherited jewelry valued at approximately $68,000 is NOT scheduled and would",
      "be subject to the standard personal property sublimit for jewelry. A rider is recommended.",
    ],
  },
  {
    family: FAM.okonkwo,
    name: "529 Plan Enrollment - Two Beneficiaries", category: "Investment",
    description: "NC 529 accounts, both children",
    body: [
      "NORTH CAROLINA 529 PLAN - ACCOUNT SUMMARY (FICTITIOUS DEMO DOCUMENT)",
      "Account Owner: Ada Okonkwo",
      "Beneficiary 1: Chidi Okonkwo, age 11 - Balance $84,200",
      "Beneficiary 2: Ngozi Okonkwo, age 8 - Balance $61,500",
      "Investment Option: Age-based aggressive track",
      "Current Contributions: $1,500 per month per beneficiary ($3,000 total)",
      "2026 gift tax annual exclusion per donor per beneficiary: $19,000",
      "Both parents contributing jointly remain well within the annual exclusion.",
      "Projected balance at age 18 for Beneficiary 1: approximately $268,000 at 6% assumed return.",
      "ACTION: Annual contribution deadline for the state tax benefit is December 31, 2026.",
    ],
  },
  {
    family: FAM.okonkwo,
    name: "Disability Insurance Policy Summary", category: "Insurance",
    description: "Individual DI, both physicians",
    body: [
      "INDIVIDUAL DISABILITY INSURANCE - POLICY SUMMARY (FICTITIOUS DEMO DOCUMENT)",
      "INSURED 1: Dr. Ada Okonkwo, Cardiologist",
      "  Carrier: Guardian. Policy DEMO-GD-448120",
      "  Monthly Benefit: $14,000. Benefit Period: to age 65. Elimination Period: 90 days",
      "  Definition of Disability: True own-occupation, specialty specific",
      "  Annual Premium: $9,840",
      "INSURED 2: Dr. Emeka Okonkwo, Orthopedic Surgeon",
      "  Carrier: Principal. Policy DEMO-PR-771930",
      "  Monthly Benefit: $9,500. Benefit Period: to age 65. Elimination Period: 90 days",
      "  Definition of Disability: Modified own-occupation",
      "  Annual Premium: $7,120",
      "GAP ANALYSIS: Combined benefit of $23,500 per month replaces roughly 39% of current gross",
      "earned income of $60,000 per month. Coverage is materially below the 60% target, and Dr. Emeka",
      "Okonkwo's modified own-occupation definition is weaker than his specialty warrants.",
      "RECOMMENDATION: Review both policies and price supplemental coverage.",
    ],
  },
  {
    family: FAM.okonkwo,
    name: "Schwab Q2 2026 Statement", category: "Investment",
    description: "Brokerage quarterly statement",
    body: [
      "CHARLES SCHWAB - QUARTERLY BROKERAGE STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Account: Okonkwo Joint Revocable - DEMO-SCH-90218",
      "Advisor: Nina Alvarez",
      "Period: April 1, 2026 to June 30, 2026",
      "Beginning Market Value: $2,381,000",
      "Net Contributions: $18,000",
      "Investment Gain: $81,000",
      "Ending Market Value: $2,480,000",
      "Asset Allocation: Equities 78%, Fixed Income 16%, Cash 6%",
      "Retirement assets held separately at Fidelity: $1,920,000 across two consolidated 401(k) plans.",
      "Cash management at Truist: $415,000.",
      "Note: Backdoor Roth contributions for 2026 have not yet been made for either spouse.",
    ],
  },

  // ── Nakamura (CORE plan) ───────────────────────────────────────────────────
  //
  // Every figure below reproduces what is already on the household's records: rent $2,150/mo,
  // management 10% = $215/mo, Fidelity $1,240,000 as at 30 Jun 2026, homeowners premium $3,180.
  // A demo document that disagrees with the screen beside it is worse than no document, because
  // the first thing a sceptical prospect does is check one against the other.
  {
    family: FAM.nakamura, property: PROP.nTucson,
    name: "Tucson Realty Management Agreement", category: "Real Estate",
    description: "Property management agreement, 10% of gross rent",
    body: [
      "RESIDENTIAL PROPERTY MANAGEMENT AGREEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Owner: Kenji Nakamura",
      "Manager: Tucson Realty Management LLC",
      "Contact: Renata Vaughn, (520) 555-0177",
      "Managed Property: 1105 W Grant St Unit 3B, Tucson, AZ 85745",
      "Term: Commencing April 1, 2023, renewing annually unless cancelled with 60 days notice.",
      "",
      "MANAGEMENT FEE: 10% of gross monthly rent collected.",
      "Gross monthly rent: $2,150. Management fee: $215 per month, $2,580 per year.",
      "",
      "ADDITIONAL FEES NOT INCLUDED IN THE 10%:",
      "Tenant placement: 75% of one month's rent, charged on each new tenancy.",
      "Lease renewal: $250 per renewal.",
      "Maintenance coordination: cost plus a 10% administrative markup.",
      "Owner authorisation is required for any single repair above $500.",
      "",
      "NOTE FOR REVIEW: with placement and markups included, the all-in cost of outside management",
      "on this property runs materially above the headline 10%. Industry surveys put the all-in",
      "figure at 15-20% of gross rent once these items are counted.",
    ],
  },
  {
    family: FAM.nakamura, property: PROP.nTucson,
    name: "Farmers Condo Policy - 1105 W Grant St 3B", category: "Insurance",
    description: "Landlord policy on the Tucson rental", expiry: "2026-09-15",
    section: "insurance_dec",
    body: [
      "FARMERS INSURANCE - LANDLORD PROTECTION DECLARATIONS (FICTITIOUS DEMO DOCUMENT)",
      "Named Insured: Kenji Nakamura",
      "Insured Location: 1105 W Grant St Unit 3B, Tucson, AZ 85745",
      "Policy Period: September 15, 2025 to September 15, 2026",
      "Annual Premium: $1,460",
      "",
      "Dwelling (Coverage A): $355,000",
      "Personal Property: $18,000",
      "Loss of Rents: 12 months, $25,800",
      "Liability: $500,000 per occurrence",
      "Deductible: $2,500",
      "",
      "RENEWAL: This policy expires September 15, 2026 and has not yet been renewed.",
      "A replacement quote has been requested and is outstanding.",
    ],
  },
  {
    family: FAM.nakamura, property: PROP.nTucson,
    name: "Residential Lease - 1105 W Grant St 3B", category: "Real Estate",
    description: "Current tenancy, $2,150/mo through Feb 2027",
    expiry: "2027-02-28", section: "rental",
    body: [
      "ARIZONA RESIDENTIAL LEASE AGREEMENT - ABSTRACT (FICTITIOUS DEMO DOCUMENT)",
      "Premises: 1105 W Grant St Unit 3B, Tucson, AZ 85745",
      "Landlord: Kenji Nakamura, by Tucson Realty Management LLC as agent",
      "Tenant: Alicia Fuentes",
      "Term: March 1, 2026 through February 28, 2027",
      "Monthly Rent: $2,150, due on the first",
      "Security Deposit: $2,150 held in trust by the manager",
      "Rent is collected by the manager and remitted net of the 10% fee, i.e. $1,935 per month.",
      "Tenant is responsible for electricity and internet. Landlord pays water, sewer and the HOA.",
      "HOA assessment: $260 per month, $3,120 per year.",
      "Tenant has been in occupancy since March 2024 and has renewed twice without incident.",
    ],
  },
  {
    family: FAM.nakamura, property: PROP.nScottsdale,
    name: "State Farm Homeowners and Umbrella - 7412 E Camelback Rd", category: "Insurance",
    description: "Homeowners plus $2M umbrella, primary residence",
    expiry: "2027-04-30", section: "insurance_dec",
    body: [
      "STATE FARM HOMEOWNERS POLICY - DECLARATIONS (FICTITIOUS DEMO DOCUMENT)",
      "Named Insured: Kenji and Mei Nakamura",
      "Insured Location: 7412 E Camelback Rd, Scottsdale, AZ 85251",
      "Policy Period: April 30, 2026 to April 30, 2027",
      "Annual Premium: $3,180",
      "",
      "Dwelling (Coverage A): $1,940,000 replacement cost",
      "Other Structures: $194,000",
      "Personal Property: $970,000",
      "Loss of Use: 24 months",
      "Personal Liability: $500,000",
      "Deductible: $5,000",
      "",
      "PERSONAL LIABILITY UMBRELLA: $2,000,000, premium $410 included above.",
      "",
      "REVIEW NOTE: the umbrella limit of $2,000,000 was set when the residence was valued at",
      "$1,420,000. Current value is $1,850,000 and household net worth is approximately",
      "$3,327,000. The limit has not been revisited since 2021.",
    ],
  },
  {
    family: FAM.nakamura,
    name: "Scheduled Personal Property Endorsement", category: "Insurance",
    description: "Ring and vehicle scheduled on the homeowners policy",
    section: "valuables_schedule",
    body: [
      "STATE FARM - SCHEDULED PERSONAL PROPERTY ENDORSEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Named Insured: Kenji and Mei Nakamura",
      "Attaches to homeowners policy on 7412 E Camelback Rd, Scottsdale, AZ 85251",
      "",
      "SCHEDULED ITEMS:",
      "Estate ring, platinum with 2.1ct centre stone. Appraised value $38,000, appraisal dated",
      "  March 2024. Scheduled at $38,000, agreed value, no deductible.",
      "2023 Lexus RX 350, VIN on file. Insured under a separate auto policy at $52,000",
      "  actual cash value, not scheduled here.",
      "",
      "Total scheduled personal property: $38,000.",
      "REVIEW NOTE: the ring appraisal is dated March 2024. Carriers typically expect an appraisal",
      "no older than three years at renewal.",
    ],
  },
  {
    family: FAM.nakamura, property: PROP.nScottsdale,
    name: "Wells Fargo Mortgage Statement - July 2026", category: "Real Estate",
    description: "Primary residence mortgage, balance $892,000", section: "mortgage",
    body: [
      "WELLS FARGO HOME MORTGAGE - MONTHLY STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Borrower: Kenji and Mei Nakamura",
      "Property: 7412 E Camelback Rd, Scottsdale, AZ 85251",
      "Statement Date: July 1, 2026",
      "",
      "Principal Balance: $892,000",
      "Interest Rate: 3.25% fixed",
      "Monthly Payment (principal and interest): $4,980",
      "Maturity Date: July 1, 2051",
      "Original Loan Amount: $1,065,000, originated June 2021",
      "",
      "Escrow is not collected on this loan. Property taxes and insurance are paid directly by the",
      "borrower: $9,240 in annual property tax and $3,180 in annual homeowners premium.",
      "",
      "REVIEW NOTE: at 3.25% this is well below current market rates. There is no case for",
      "refinancing and no prepayment penalty.",
    ],
  },
  {
    family: FAM.nakamura, property: PROP.nScottsdale,
    name: "Maricopa County Property Tax Notice 2026", category: "Tax",
    description: "2026 assessment, $9,240 annual", section: "tax",
    body: [
      "MARICOPA COUNTY TREASURER - PROPERTY TAX STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Parcel: 173-42-118A",
      "Owner: Kenji and Mei Nakamura",
      "Property: 7412 E Camelback Rd, Scottsdale, AZ 85251",
      "Tax Year: 2026",
      "",
      "Full Cash Value: $1,812,400",
      "Limited Property Value: $1,240,880",
      "Total Tax Due: $9,240",
      "First Half ($4,620) due October 1, 2026. Second Half ($4,620) due March 1, 2027.",
      "",
      "The 2026 assessment rose 6.2% over 2025. No appeal was filed; the deadline has passed.",
    ],
  },
  {
    family: FAM.nakamura,
    name: "Fidelity Joint Brokerage - Q2 2026 Statement", category: "Investment",
    description: "Taxable brokerage, $1,240,000 as at 30 Jun 2026",
    body: [
      "FIDELITY INVESTMENTS - QUARTERLY STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Account: Joint Taxable Brokerage - Kenji and Mei Nakamura",
      "Representative: Priya Raman",
      "Statement Period: April 1, 2026 to June 30, 2026",
      "",
      "Closing Value as of June 30, 2026: $1,240,000",
      "Opening Value April 1, 2026: $1,158,000",
      "Net Contributions this quarter: $24,000",
      "Investment Gain this quarter: $58,000",
      "",
      "Twelve month history: Sep 30 2025 $985,000. Dec 31 2025 $1,042,000.",
      "  Mar 31 2026 $1,158,000. Jun 30 2026 $1,240,000.",
      "",
      "Dividends and interest paid this quarter: $4,100, substantially all qualified.",
      "Allocation: 68% US equity, 14% international equity, 14% fixed income, 4% cash.",
      "",
      "REVIEW NOTE: cash of 4% sits alongside a separate $210,000 bank reserve. Total cash across",
      "both is above the stated target.",
    ],
  },
  {
    family: FAM.nakamura,
    name: "Vanguard Rollover IRA - Q2 2026 Statement", category: "Investment",
    description: "Rollover IRA (Kenji), $685,000 as at 30 Jun 2026",
    body: [
      "VANGUARD - QUARTERLY ACCOUNT STATEMENT (FICTITIOUS DEMO DOCUMENT)",
      "Account: Rollover IRA - Kenji Nakamura",
      "Statement Period: April 1, 2026 to June 30, 2026",
      "",
      "Closing Value as of June 30, 2026: $685,000",
      "Opening Value April 1, 2026: $649,000",
      "Contributions: none. Rollover IRAs do not accept new contributions.",
      "Investment Gain this quarter: $36,000",
      "",
      "History: Dec 31 2025 $631,000. Mar 31 2026 $649,000. Jun 30 2026 $685,000.",
      "Allocation: Target Retirement 2045 fund, 100%.",
      "Primary beneficiary: Mei Nakamura, 100%. Contingent: none named.",
      "",
      "REVIEW NOTE: no contingent beneficiary is named on this account.",
    ],
  },
  {
    family: FAM.nakamura,
    name: "Nakamura Family Revocable Trust - Summary", category: "Estate Planning",
    description: "Revocable living trust, executed 2022",
    body: [
      "NAKAMURA FAMILY REVOCABLE TRUST - SUMMARY OF TERMS (FICTITIOUS DEMO DOCUMENT)",
      "Grantors: Kenji Nakamura and Mei Nakamura",
      "Trustees: Kenji Nakamura and Mei Nakamura, jointly",
      "Successor Trustee: Marcus Reed, Reed Law Group",
      "Executed: March 18, 2022. Prepared by Reed Law Group, Phoenix AZ.",
      "",
      "Revocable during the joint lifetimes of the grantors. On the first death the trust divides",
      "into a Survivor's Trust and a Family Trust.",
      "Beneficiaries: the surviving spouse for life, then issue in equal shares.",
      "",
      "ASSETS TITLED IN THE TRUST:",
      "7412 E Camelback Rd, Scottsdale AZ - deeded to the trust June 2022.",
      "",
      "ASSETS NOT TITLED IN THE TRUST:",
      "1105 W Grant St Unit 3B, Tucson AZ - acquired March 2023, still held individually.",
      "Fidelity joint brokerage - held jointly with right of survivorship, not in trust.",
      "",
      "REVIEW NOTE: the Tucson property was bought after the trust was executed and was never",
      "retitled. As things stand it would pass through probate rather than under the trust.",
    ],
  },
  {
    family: FAM.nakamura,
    name: "Durable Power of Attorney - Kenji Nakamura", category: "Legal",
    description: "Financial POA, executed 2022",
    body: [
      "DURABLE GENERAL POWER OF ATTORNEY (FICTITIOUS DEMO DOCUMENT)",
      "Principal: Kenji Nakamura",
      "Agent: Mei Nakamura",
      "Successor Agent: none named",
      "Executed: March 18, 2022. Notarised. Prepared by Reed Law Group.",
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
    family: FAM.nakamura,
    name: "2025 Form 1040 - Summary Page", category: "Tax",
    description: "Filed return, prepared by Liu & Associates",
    body: [
      "U.S. INDIVIDUAL INCOME TAX RETURN 2025 - SUMMARY (FICTITIOUS DEMO DOCUMENT)",
      "Taxpayers: Kenji Nakamura and Mei Nakamura. Filing status: Married Filing Jointly.",
      "Preparer: Grace Liu, CPA - Liu & Associates CPAs",
      "",
      "Wages: $284,400",
      "Qualified dividends: $15,800",
      "Rental income (Schedule E, net): $6,240",
      "Total Income: $306,440",
      "Adjusted Gross Income: $306,440",
      "Itemised Deductions: $38,900, of which $9,240 property tax and $28,990 mortgage interest",
      "Taxable Income: $267,540",
      "Total Tax: $52,180",
      "Withholding and payments: $54,900. Refund: $2,720.",
      "",
      "Arizona return filed. State tax rate applied: 2.5%.",
      "",
      "REVIEW NOTE: Schedule E shows the $2,580 management fee and $3,120 HOA as deductible",
      "against rental income. Neither spouse made an IRA or HSA contribution for 2025.",
    ],
  },
];

const W = 612, H = 792, M = 56;
const NAVY = rgb(0.08, 0.16, 0.29);
const GOLD = rgb(0.79, 0.71, 0.52);
const BODY = rgb(0.13, 0.16, 0.22);

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

// Strip anything the standard PDF fonts (WinAnsi) can't encode, which would
// otherwise throw inside drawText and fail the whole document.
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

async function buildPdf(spec: Spec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([W, H]);
  let y = H - M;

  for (const line of wrap(clean(spec.name), bold, 15, W - M * 2)) {
    page.drawText(line, { x: M, y, size: 15, font: bold, color: NAVY });
    y -= 19;
  }
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: GOLD });
  y -= 22;

  for (const raw of spec.body) {
    const isHeading = raw === raw.toUpperCase() && raw.length > 12;
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
  page.drawText(foot, {
    x: (W - reg.widthOfTextAtSize(foot, 8)) / 2, y: M, size: 8, font: reg,
    color: rgb(0.45, 0.5, 0.58),
  });

  return await doc.save();
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

// Rows this function has written are stamped with it. Anything else in the table was put there by
// a person or by another seeder, and is not ours to delete.
const SEED_STAMP = "Demo Seed";

Deno.serve(async (req) => {
  const created: string[] = [];
  const failed: { name: string; error: string }[] = [];
  try {
    // ── The guard ────────────────────────────────────────────────────────────
    //
    // This block used to read:
    //
    //   .select("id,file_path").ilike("description", "%")
    //
    // which matches EVERY document with a non-null description — not the ones this function
    // seeded. It then deleted the storage objects and the rows. Pointed at a database with real
    // client documents in it, that is unrecoverable: the files are gone from the bucket, not just
    // the rows. It survived only because nobody had run it twice.
    //
    // Now it needs an explicit list of family ids and will not run without one, and it deletes only
    // rows carrying this function's own stamp within those families. Fails closed: no body, no
    // families, or an id that is not a known demo family, and nothing is touched.
    // Accepts either POST {"families":[...]} or GET ?families=uuid,uuid. The query form exists
    // because the environments this gets run from cannot always issue a POST with a body, and a
    // seeder nobody can invoke is a seeder nobody maintains. The guard below is identical either
    // way — the transport does not soften it.
    const body = await req.json().catch(() => ({}));
    const fromQuery = (new URL(req.url).searchParams.get("families") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const requested: string[] = Array.isArray(body?.families) && body.families.length
      ? body.families
      : fromQuery;
    const known = new Set(Object.values(FAM));
    const families = requested.filter((f) => known.has(f));

    if (!families.length) {
      return new Response(JSON.stringify({
        error: "Pass {\"families\":[\"<uuid>\", …]} naming which demo households to seed. " +
          "This function refuses to run across the whole table.",
        knownFamilies: FAM,
      }, null, 2), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (families.length !== requested.length) {
      return new Response(JSON.stringify({
        error: "One or more ids are not known demo families. Nothing was changed.",
        rejected: requested.filter((f) => !known.has(f)),
      }, null, 2), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // Idempotent within scope: clear only what a previous run of THIS function created, only for
    // the families named in this request.
    const { data: old } = await sb.from("documents")
      .select("id,file_path")
      .eq("uploaded_by", SEED_STAMP)
      .in("family_id", families);
    if (old && old.length) {
      const paths = old.map((d: any) => d.file_path).filter(Boolean);
      if (paths.length) await sb.storage.from("documents").remove(paths);
      await sb.from("documents").delete().in("id", old.map((d: any) => d.id));
    }
    const removed = old?.length ?? 0;

    for (const spec of DOCS.filter((s) => families.includes(s.family))) {
      try {
        const bytes = await buildPdf(spec);
        const path = `${spec.family}/${Date.now()}-${slug(spec.name)}.pdf`;
        const { error: upErr } = await sb.storage.from("documents")
          .upload(path, bytes, { contentType: "application/pdf", upsert: true });
        if (upErr) throw new Error(`upload: ${upErr.message}`);

        const { error: dbErr } = await sb.from("documents").insert({
          family_id: spec.family,
          property_id: spec.property ?? null,
          name: spec.name,
          description: spec.description,
          category: spec.category,
          file_path: path,
          file_size: bytes.length,
          file_type: "application/pdf",
          mime_type: "application/pdf",
          expiry_date: spec.expiry ?? null,
          property_section: spec.section ?? null,
          extracted_text: spec.body.join("\n"),
          uploaded_by: SEED_STAMP,
        });
        if (dbErr) throw new Error(`insert: ${dbErr.message}`);
        created.push(spec.name);
      } catch (e) {
        failed.push({ name: spec.name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return new Response(JSON.stringify({
      families, removed, created: created.length, names: created, failed,
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e), created: created.length, failed }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
