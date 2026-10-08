-- Nakamura Family [DEMO] — the Core-tier demo household.
--
-- WHY THIS EXISTS
--
-- Every other demo household is Premier, and none of them can be moved down: the downgrade trigger
-- refuses a household holding obligations, workflows or bill-pay expenses, and all four hold at
-- least one. So there was no way to show Core in a demo at all. This seeds one from scratch instead
-- of stripping an existing household, which leaves the Premier ones intact for the pitch they were
-- built for.
--
-- WHAT IT DEMONSTRATES, SIDE BY SIDE WITH WHITMORE
--
--   eleven tabs, not twelve — no Obligations
--   no bill-pay checkbox on an expense, no payment register, no "firm pays" badge
--   "Partner-led" where a Titan Expert would be named, and no "Email my Titan Expert" button
--   an outlined CORE pill on the client banner where Premier shows a filled one
--
-- Applied to the DEMO project (tkryueqzvgcigvxgjzsp) only. Never point this at production.
--
-- Fixed UUIDs, so re-running is a matter of deleting by id first:
--   delete from families where id = 'a1000000-0000-4000-8000-000000000005';
-- (child rows cascade)
--
-- NOT SEEDED: documents. Every document row in this project points at a real file in Storage, and
-- a row with an invented path is a broken download in front of a prospect. CHRIS therefore
-- shows an empty-folder state, which is defensible for a newly onboarded household — and is itself
-- the CHRIS redesign's summary line doing its job. Upload two or three files through the CHRIS UI
-- if the demo needs a populated CHRIS; that also demonstrates the upload flow.

do $$
declare
  F   uuid := 'a1000000-0000-4000-8000-000000000005';
  P1  uuid := 'b1000000-0000-4000-8000-000000000051';  -- Scottsdale primary residence
  P2  uuid := 'b1000000-0000-4000-8000-000000000052';  -- Tucson rental condo
  A1  uuid := 'c1000000-0000-4000-8000-000000000051';
  A2  uuid := 'c1000000-0000-4000-8000-000000000052';
  A3  uuid := 'c1000000-0000-4000-8000-000000000053';
  V1  uuid := 'e1000000-0000-4000-8000-000000000051';
  V2  uuid := 'e1000000-0000-4000-8000-000000000052';
  V3  uuid := 'e1000000-0000-4000-8000-000000000053';
  V4  uuid := 'e1000000-0000-4000-8000-000000000054';
begin

-- advisor_email is set even though this is Core. It is the expert OF RECORD, for access only:
-- fetchTable scopes an advisor's families by this column, so a null here would make the household
-- invisible to everyone but an admin. The client is never shown a Titan Expert.
insert into families (id, name, plan, advisor_name, advisor_email, assistant_name, color,
                      cash_flow_settings, notes)
values (F, 'Nakamura Family [DEMO]', 'core', 'Alex Morgan', 'expert@titanosdemo.com', 'Nova',
        '#6B7F3E',
        '{"stateCode":"AZ","baseIncome":285000,"filingStatus":"Married Filing Jointly","localTaxRate":0,"stateTaxRate":2.5,"includeRental":true,"projectionMonths":24}'::jsonb,
        'FICTITIOUS demo family. CORE plan — Partner-led (their CPA is the lead), no assigned Titan Expert, no workflows, no bill pay. Entry-tier household: two properties, one entity. Pays an outside manager 10% on the Tucson rental. Safe to delete at any time.');

insert into properties (id, family_id, address, city, state, zip, owner_name, property_type,
  status, current_value, purchase_price, purchase_date, lender, loan_balance, loan_payment,
  interest_rate, loan_type, loan_maturity_date, rental_income, property_taxes, utilities,
  insurance_company, insurance_premium, insurance_expiration, hoa_fee,
  property_management_fee_pct, include_mortgage_in_cashflow, sort_order, notes)
values
 (P1, F, '7412 E Camelback Rd', 'Scottsdale', 'AZ', '85251',
  'Kenji & Mei Nakamura', 'Residential', 'Active',
  1850000, 1420000, '2021-06-15', 'Wells Fargo', 892000, 4980, 3.25, 'Conventional 30yr',
  '2051-07-01', null, 9240, null,
  'State Farm', 3180, '2027-04-30', 0, 0, true, 1,
  'Primary residence. Utilities and grounds are itemised by vendor rather than blended.'),
 -- insurance_expiration is deliberately ~6 weeks out, so the renewal shows in the deadline queue
 -- and the matching open task reads as something a real household is mid-way through.
 (P2, F, '1105 W Grant St Unit 3B', 'Tucson', 'AZ', '85745',
  'Kenji Nakamura', 'Condo', 'Active',
  342000, 268000, '2023-03-10', 'Alliant Credit Union', 198000, 1240, 6.10, 'Conventional 30yr',
  '2053-04-01', 2150, 2880, null,
  'Farmers', 1460, '2026-09-15', 3120, 10, true, 2,
  'Long-term rental. Managed by Tucson Realty Management at 10% of gross rent.');

insert into portfolio_accounts (id, family_id, institution, banker_name, account_type,
  starting_balance, current_balance, balance_as_of, notes)
values
 (A1, F, 'Fidelity', 'Priya Raman', 'Joint Brokerage', 1085000, 1240000, '2026-06-30',
  'Core taxable holdings.'),
 (A2, F, 'Vanguard', null, 'Rollover IRA — Kenji', 612000, 685000, '2026-06-30', null),
 (A3, F, 'First Foundation Bank', 'Alan Deitch', 'Cash Reserve', 180000, 210000, '2026-06-30',
  'Six months of fixed outgoings.');

-- `source` is constrained to manual/extracted/opening. Writing 'statement' fails the check — the
-- first attempt at this seed did exactly that and Postgres rolled the whole block back.
insert into account_balances (account_id, family_id, as_of, balance, source, entered_by)
values
 (A1, F, '2025-09-30',  985000, 'opening', 'demo seed'),
 (A1, F, '2025-12-31', 1042000, 'manual',  'demo seed'),
 (A1, F, '2026-03-31', 1158000, 'manual',  'demo seed'),
 (A1, F, '2026-06-30', 1240000, 'manual',  'demo seed'),
 (A2, F, '2025-12-31',  631000, 'opening', 'demo seed'),
 (A2, F, '2026-03-31',  649000, 'manual',  'demo seed'),
 (A2, F, '2026-06-30',  685000, 'manual',  'demo seed');

insert into valuables (family_id, category, description, make_model, year, estimated_value,
  insured, insurance_company, notes)
values
 (F, 'Vehicle', 'Daily driver', '2023 Lexus RX 350', 2023, 52000, true, 'State Farm', null),
 (F, 'Jewelry', 'Estate ring, appraised 2024', null, null, 38000, true, 'State Farm',
  'Scheduled on the homeowners policy.');

insert into family_contacts (family_id, name, role, company, email, phone, is_advisor, notes)
values
 (F, 'Kenji Nakamura', 'Client', null, 'kenji@example.com', '(480) 555-0142', false, null),
 (F, 'Mei Nakamura', 'Spouse', null, 'mei@example.com', '(480) 555-0143', false, null),
 -- The lead. On Core this is who the household actually deals with.
 (F, 'Grace Liu, CPA', 'CPA — lead partner on this relationship', 'Liu & Associates CPAs',
  'grace@example.com', '(480) 555-0188', true,
  'Referred the household and remains the lead. On Core there is no assigned Titan Expert.'),
 (F, 'Marcus Reed', 'Estate Attorney', 'Reed Law Group', 'marcus@example.com',
  '(602) 555-0119', true, null);

insert into property_contacts (id, property_id, family_id, name, role, company, email, phone)
values
 (V1, P1, F, 'Hector Ruiz', 'Landscaper', 'Desert Bloom Landscaping',
  'hector@example.com', '(480) 555-0201'),
 (V2, P1, F, 'Customer Care', 'Utility — electric', 'Arizona Public Service',
  null, '(602) 555-0000'),
 (V3, P1, F, 'Dane Whitcomb', 'Pool service', 'Sonoran Pool Care',
  'dane@example.com', '(480) 555-0244'),
 (V4, P2, F, 'Renata Vaughn', 'Property Manager', 'Tucson Realty Management',
  'renata@example.com', '(520) 555-0177');

-- NOTHING here is flagged pcm_responsible, and nothing could be: the trigger refuses it on Core.
-- Expenses are vendor-linked and categorised so "how much do I spend on landscaping?" and
-- spend-by-vendor both answer properly on this household too.
insert into cash_flow_events (family_id, direction, event_type, description, amount, frequency,
  start_date, tax_treatment, category, property_id, vendor_property_contact_id, sort_order)
values
 (F, 'income', 'Salary', 'Kenji Nakamura — base salary', 17500, 'monthly', '2026-01-01',
  'ordinary', null, null, null, 1),
 (F, 'income', 'Salary', 'Mei Nakamura — base salary', 6200, 'monthly', '2026-01-01',
  'ordinary', null, null, null, 2),
 (F, 'income', 'Dividends', 'Fidelity joint brokerage — quarterly dividends', 4100, 'quarterly',
  '2026-01-15', 'qualified_div', null, null, null, 3),
 (F, 'expense', 'Landscaping', 'Desert Bloom Landscaping — grounds & irrigation', 340, 'monthly',
  '2026-01-01', 'ordinary', 'landscaping', P1, V1, 4),
 (F, 'expense', 'Utilities', 'Arizona Public Service — electric', 285, 'monthly', '2026-01-01',
  'ordinary', 'utilities', P1, V2, 5),
 (F, 'expense', 'Pool service', 'Sonoran Pool Care — weekly service', 165, 'monthly',
  '2026-01-01', 'ordinary', 'pool_spa', P1, V3, 6),
 -- 215/mo x 12 = 2,580 = exactly 10% of 2,150/mo gross rent. The figures tie on purpose; a demo
 -- where the stated percentage does not reproduce is a demo someone will check.
 (F, 'expense', 'Property management', 'Tucson Realty Management — 10% of gross rent', 215,
  'monthly', '2026-01-01', 'ordinary', 'property_management', P2, V4, 7),
 (F, 'expense', 'Insurance', 'State Farm — homeowners & umbrella', 3180, 'annually',
  '2026-05-01', 'ordinary', 'insurance', P1, null, 8),
 (F, 'expense', 'Professional fees', 'Liu & Associates CPAs — annual tax preparation', 4800,
  'annually', '2026-03-15', 'ordinary', 'professional_fees', null, null, 9),
 -- One deliberately uncategorised line, so the assistant's "there is spend I cannot attribute to a
 -- category" honesty behaviour has something to report here as well.
 (F, 'expense', 'Household', 'Groceries, fuel and day-to-day', 2650, 'monthly', '2026-01-01',
  'ordinary', null, null, null, 10);

-- Three open, none overdue as at early August 2026 — the same shape the activity report describes.
insert into tasks (family_id, title, due_date, priority, done, reminder_days)
values
 (F, 'Confirm Tucson condo insurance renewal quote before 15 Sep expiry', '2026-09-01', 'High', false, 14),
 (F, 'Collect 2025 K-1 from Liu & Associates', '2026-08-28', 'Medium', false, 7),
 (F, 'Review umbrella liability limits against new property value', '2026-10-15', 'Low', false, 30);

end $$;
