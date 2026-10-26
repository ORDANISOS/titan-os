-- One home for each mortgage (2026-10-23, Will's decision).
--
-- A listed property's mortgage and second mortgage / HELOC are kept on the property (properties.loan_balance,
-- second_mortgage_balance and their payments). Loans & Lines shows them and edits them through the property, so they
-- are counted once in Total Debt. A loans row of type Mortgage or HELOC tied to a listed property would count the
-- same debt twice, so it is refused here as well as in the app. Mortgage/HELOC rows with no property (a property
-- that isn't listed) are still allowed. Checked before applying: no existing row breaks this on demo or production.
--
-- Rollback:
--   alter table public.loans drop constraint if exists loans_no_property_mortgage;

alter table public.loans drop constraint if exists loans_no_property_mortgage;
alter table public.loans add constraint loans_no_property_mortgage
  check (not (loan_type in ('Mortgage', 'HELOC') and property_id is not null));
