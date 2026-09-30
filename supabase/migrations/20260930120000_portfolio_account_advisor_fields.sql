-- The household's own outside advisor for a specific portfolio account (e.g. their broker at
-- Fidelity/Schwab) -- distinct from families.advisor_name/advisor_email, which is the internal
-- ORDANIS Expert assigned to the household. Deliberately named account_advisor_* (not advisor_*)
-- so nothing in code or in a report ever confuses the two.
alter table public.portfolio_accounts
  add column if not exists account_advisor_name text,
  add column if not exists account_advisor_phone text,
  add column if not exists account_advisor_email text;

comment on column public.portfolio_accounts.account_advisor_name is 'The household''s own outside advisor for this account (e.g. their broker). Not the internal ORDANIS Expert -- see families.advisor_name for that.';
comment on column public.portfolio_accounts.account_advisor_phone is 'Phone number for the household''s outside advisor on this account.';
comment on column public.portfolio_accounts.account_advisor_email is 'Email for the household''s outside advisor on this account.';
