-- Promotion codes on a household's subscription (2026-10-22, Will's decision).
--
-- Stripe applies the promotion code at checkout ("3 Months Free", "Complimentary"). The admin Signups &
-- Revenue page used to count every paying household at list price, so a comped household looked like full
-- revenue. stripe-webhook now copies the subscription's current discount onto the household; the page shows
-- list price, the promotion discount, and net revenue.
--
-- Columns are written by stripe-webhook only (service role). A household (or anyone but an ORDANIS admin)
-- cannot change them: the trigger below puts back the old values. They describe a discount; they never
-- change what Stripe bills.
-- No new table, so no grant changes.
--
-- Rollback:
--   drop trigger if exists families_protect_promo on public.families;
--   drop function if exists public.protect_family_promo_columns();
--   alter table public.families drop column if exists promo_code, drop column if exists promo_coupon,
--     drop column if exists promo_percent_off, drop column if exists promo_amount_off,
--     drop column if exists promo_duration, drop column if exists promo_ends_at, drop column if exists promo_synced_at;

alter table public.families
  add column if not exists promo_code        text,
  add column if not exists promo_coupon      text,
  add column if not exists promo_percent_off numeric(5,2),
  add column if not exists promo_amount_off  numeric(10,2),
  add column if not exists promo_duration    text,
  add column if not exists promo_ends_at     timestamptz,
  add column if not exists promo_synced_at   timestamptz;

create or replace function public.protect_family_promo_columns()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.promo_code := null; new.promo_coupon := null; new.promo_percent_off := null; new.promo_amount_off := null;
    new.promo_duration := null; new.promo_ends_at := null; new.promo_synced_at := null;
  else
    new.promo_code := old.promo_code; new.promo_coupon := old.promo_coupon; new.promo_percent_off := old.promo_percent_off;
    new.promo_amount_off := old.promo_amount_off; new.promo_duration := old.promo_duration;
    new.promo_ends_at := old.promo_ends_at; new.promo_synced_at := old.promo_synced_at;
  end if;
  return new;
end; $$;
revoke execute on function public.protect_family_promo_columns() from public, anon, authenticated;

drop trigger if exists families_protect_promo on public.families;
create trigger families_protect_promo before insert or update on public.families
  for each row execute function public.protect_family_promo_columns();
