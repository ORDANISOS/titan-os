-- Assigns every household a permanent, human-readable customer number at the moment it is
-- created, so a household can be identified by that number instead of its name/last name.
--
-- WHY A DB TRIGGER, NOT APPLICATION CODE
--
-- `families` rows are created from more than one place: the public self-serve sign-up flow
-- (stripe-webhook's createFamilyFromSignup, once payment succeeds) and the admin "Add Family"
-- form in App.jsx (a direct insert, no Stripe involved at all). A trigger on the table itself is
-- the only place that guarantees every insert gets a number, regardless of which code path -- or
-- a future one -- creates the row. This mirrors the existing pattern in this project (see
-- refuse_when_core / refuse_billpay_when_core in 20260802_family_plan.sql): commercial-boundary
-- logic like this belongs to the table, not to whichever screen happens to be doing the writing.
--
-- WHY THE NUMBER NEVER CHANGES AFTER INSERT
--
-- This is an identifier, not a plan indicator -- a household that upgrades or downgrades keeps
-- the number it was born with. The trigger only fires BEFORE INSERT, never BEFORE UPDATE, so a
-- later `families.plan` change (upgrade/downgrade) never touches customer_number.
--
-- RANGES
--   Basic:   20000, 20001, 20002, ...
--   Core:    40000, 40001, 40002, ...
--   Premier: 60000, 60001, 60002, ...
-- Ranges are 20000 apart, leaving room to grow each tier well past what any realistic signup
-- volume would hit before someone deliberately revisits this.

create sequence if not exists basic_customer_number_seq   start with 20000 increment by 1;
create sequence if not exists core_customer_number_seq    start with 40000 increment by 1;
create sequence if not exists premier_customer_number_seq start with 60000 increment by 1;

alter table families
  add column if not exists customer_number integer unique;

comment on column families.customer_number is
  'Permanent household identifier, assigned once at creation by assign_customer_number() and '
  'never reassigned. Basic starts at 20000, Core at 40000, Premier at 60000. Use this to identify '
  'a household in support/ops conversations instead of its name.';

create or replace function assign_customer_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Respect an explicitly-provided value (e.g. a data migration backfilling historical
  -- households) instead of silently overwriting it.
  if new.customer_number is not null then
    return new;
  end if;

  case new.plan
    when 'basic' then
      new.customer_number := nextval('basic_customer_number_seq');
    when 'core' then
      new.customer_number := nextval('core_customer_number_seq');
    -- 'private' is the legacy alias for premier (see 20260802_plan_rename_premier.sql) -- a stale
    -- client bundle can still write it, and normalisePlan() in src/plans.js already treats it as
    -- premier everywhere else, so it draws from the same sequence here too.
    when 'premier', 'private' then
      new.customer_number := nextval('premier_customer_number_seq');
    else
      raise exception
        'Cannot assign a customer number: unrecognized plan ''%''. Expected basic, core or premier.',
        new.plan
        using errcode = 'check_violation';
  end case;

  return new;
end;
$$;

drop trigger if exists families_assign_customer_number on families;
create trigger families_assign_customer_number
  before insert on families
  for each row execute function assign_customer_number();

-- Backfill: the only rows that exist today are pre-dating this migration, so they never ran
-- through the trigger above. Draw their numbers from the same sequences so future signups
-- continue the count correctly rather than colliding with these.
update families
set customer_number = case plan
  when 'basic' then nextval('basic_customer_number_seq')
  when 'core' then nextval('core_customer_number_seq')
  when 'premier' then nextval('premier_customer_number_seq')
  when 'private' then nextval('premier_customer_number_seq')
  end
where customer_number is null;

-- Guaranteed by the trigger + backfill above for every existing and future row.
alter table families alter column customer_number set not null;
