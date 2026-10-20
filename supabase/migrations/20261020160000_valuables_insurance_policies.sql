-- Insurance policies on valuables, and a CHRIS document linked to each valuable (2026-10-20, Will's request).
--
-- Until now a valuable recorded only insured yes/no and the insurer's name, and CHRIS could link one
-- "Valuables Schedule" for the whole household. Now each valuable carries its own policy details, and a
-- document in CHRIS can point at the valuable it covers (documents.valuable_id), the same way
-- documents.property_id points at a property.
--
-- Columns only: no new tables (so no grants needed under the 2026-10-30 Supabase change), no triggers.
-- RLS is unchanged: valuables and documents are already scoped to the household by family_id, and new
-- columns inherit that. The app only ever links a document to a valuable of the same household; the
-- database does not cross-check that (it would need a trigger), and both rows are private to the
-- household either way.
--
-- Deleting a valuable leaves its documents in CHRIS, just unlinked (on delete set null).
--
-- Rollback:
--   alter table public.documents drop column if exists valuable_id;
--   alter table public.valuables drop column if exists policy_number, drop column if exists insurance_premium,
--     drop column if exists coverage_amount, drop column if exists insurance_expiration;

alter table public.valuables
  add column if not exists policy_number        text,
  add column if not exists insurance_premium    numeric(14,2),
  add column if not exists coverage_amount      numeric(14,2),
  add column if not exists insurance_expiration date;

alter table public.valuables drop constraint if exists valuables_policy_number_len;
alter table public.valuables add constraint valuables_policy_number_len check (policy_number is null or length(policy_number) <= 80);
alter table public.valuables drop constraint if exists valuables_insurance_premium_nonneg;
alter table public.valuables add constraint valuables_insurance_premium_nonneg check (insurance_premium is null or insurance_premium >= 0);
alter table public.valuables drop constraint if exists valuables_coverage_amount_nonneg;
alter table public.valuables add constraint valuables_coverage_amount_nonneg check (coverage_amount is null or coverage_amount >= 0);

alter table public.documents
  add column if not exists valuable_id uuid references public.valuables(id) on delete set null;

create index if not exists documents_valuable_id_idx on public.documents(valuable_id) where valuable_id is not null;
