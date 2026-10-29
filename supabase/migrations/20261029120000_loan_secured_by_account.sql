-- Loans & Lines: a loan or line can be secured by a portfolio account (2026-10-29, Will's request).
--
-- The loan form's "Secured by" now offers Unsecured, a property, a portfolio account (a securities-backed line against
-- a brokerage account, say) or a valuable. loans.portfolio_account_id holds the account; like property_id and
-- valuable_id it must belong to the same household, and it clears itself if the account is removed.
-- No new table, so no new grants; the existing loans policies cover the column.
--
-- Rollback:
--   alter table public.loans drop column if exists portfolio_account_id;
--   (and restore loans_check_links from migration 20261021170000)

alter table public.loans add column if not exists portfolio_account_id uuid references public.portfolio_accounts(id) on delete set null;

create or replace function public.loans_check_links()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.property_id is not null and not exists (select 1 from public.properties p where p.id = new.property_id and p.family_id = new.family_id) then
    raise exception 'That property is not part of this household.' using errcode = '23514';
  end if;
  if new.valuable_id is not null and not exists (select 1 from public.valuables v where v.id = new.valuable_id and v.family_id = new.family_id) then
    raise exception 'That valuable is not part of this household.' using errcode = '23514';
  end if;
  if new.portfolio_account_id is not null and not exists (select 1 from public.portfolio_accounts a where a.id = new.portfolio_account_id and a.family_id = new.family_id) then
    raise exception 'That portfolio account is not part of this household.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end; $$;
