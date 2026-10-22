-- Loans & Lines (2026-10-21, Will's decision).
--
-- Until now a household could record debt only as a mortgage on a property or as a portfolio account of
-- type "Line of Credit" (institution and balance, nothing else). This adds a proper place for every other
-- loan and line: auto, personal, student, business, HELOC, securities-backed lines, credit cards, boat / RV /
-- aircraft loans, private or family loans.
--
-- public.loans: one row per loan or line, owned by a household. Optional link to the property or valuable it
-- is secured by. Balances count toward Total Debt in the app; maturity dates show in Upcoming Deadlines.
-- documents.loan_id + property_section 'loan_statement' lets CHRIS pin a statement to one loan (same pattern
-- as documents.valuable_id).
--
-- Access is the same as valuables: the household's own logins and staff read; the household (not Business
-- Partners) and staff write; firm administrators read their firm's households; private households stay
-- hidden (restrictive policy from 20261021120000). Grants are explicit (Supabase table-grant change).
-- No account numbers are stored on purpose.
--
-- Rollback:
--   alter table public.documents drop column if exists loan_id;
--   drop table if exists public.loans;

create table if not exists public.loans (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null references public.families(id) on delete cascade,
  loan_type         text not null default 'Personal Loan',
  name              text,
  lender            text,
  current_balance   numeric(14,2),
  credit_limit      numeric(14,2),
  original_amount   numeric(14,2),
  interest_rate     numeric(6,3),
  rate_type         text,
  payment_amount    numeric(14,2),
  payment_frequency text,
  origination_date  date,
  maturity_date     date,
  balance_as_of     date,
  property_id       uuid references public.properties(id) on delete set null,
  valuable_id       uuid references public.valuables(id) on delete set null,
  notes             text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint loans_type_check check (loan_type in ('Auto Loan','Personal Loan','Student Loan','Business Loan','Line of Credit',
    'HELOC','Securities-Backed Line','Credit Card','Mortgage','Boat / RV / Aircraft Loan','Private / Family Loan','Other')),
  constraint loans_rate_type_check check (rate_type is null or rate_type in ('Fixed','Variable')),
  constraint loans_frequency_check check (payment_frequency is null or payment_frequency in ('Monthly','Quarterly','Semi-annually','Annually','Other')),
  constraint loans_rate_range check (interest_rate is null or (interest_rate >= 0 and interest_rate <= 100)),
  constraint loans_amounts_nonneg check ((credit_limit is null or credit_limit >= 0) and (original_amount is null or original_amount >= 0)
    and (payment_amount is null or payment_amount >= 0)),
  constraint loans_text_lengths check (coalesce(length(name),0) <= 120 and coalesce(length(lender),0) <= 120 and coalesce(length(notes),0) <= 4000)
);
create index if not exists loans_family_idx on public.loans(family_id);

-- A loan may only point at a property or valuable of its own household.
create or replace function public.loans_check_links()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.property_id is not null and not exists (select 1 from public.properties p where p.id = new.property_id and p.family_id = new.family_id) then
    raise exception 'That property is not part of this household.' using errcode = '23514';
  end if;
  if new.valuable_id is not null and not exists (select 1 from public.valuables v where v.id = new.valuable_id and v.family_id = new.family_id) then
    raise exception 'That valuable is not part of this household.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists loans_check_links on public.loans;
create trigger loans_check_links before insert or update on public.loans for each row execute function public.loans_check_links();

alter table public.loans enable row level security;
revoke all on public.loans from public, anon, authenticated;
grant select, insert, update, delete on public.loans to authenticated;
grant select, insert, update, delete on public.loans to service_role;

drop policy if exists read_access on public.loans;
create policy read_access on public.loans for select to authenticated
  using (public.is_admin() or family_id in (select public.current_user_allowed_family_ids()));
drop policy if exists write_access on public.loans;
create policy write_access on public.loans for all to authenticated
  using (public.is_admin() or (family_id in (select public.current_user_allowed_family_ids()) and public.current_user_role() <> 'partner'))
  with check (public.is_admin() or (family_id in (select public.current_user_allowed_family_ids()) and public.current_user_role() <> 'partner'));
drop policy if exists firm_admin_read on public.loans;
create policy firm_admin_read on public.loans for select to authenticated
  using (family_id in (select public.current_user_firm_family_ids()));
drop policy if exists private_household on public.loans;
create policy private_household on public.loans as restrictive for all to authenticated
  using (family_id is null or not (family_id = any (array(select public.hidden_family_ids()))))
  with check (family_id is null or not (family_id = any (array(select public.hidden_family_ids()))));

-- CHRIS: a statement pinned to one loan.
alter table public.documents add column if not exists loan_id uuid references public.loans(id) on delete set null;
create index if not exists documents_loan_idx on public.documents(loan_id) where loan_id is not null;
