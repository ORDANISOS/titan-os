-- Cash Flow events, self-serve (Basic/Core): 10 included, $8/month for each additional event
-- that stays active. Unlike the workflow overage mechanism (a one-off charge per instance
-- created), cash flow events are persistent line items a household sets up once and leaves
-- running (salary, rent, etc.) -- so the charge here is recurring for as long as the event stays
-- "active", and stops the moment the household turns an event off (see cash_flow_events.active
-- below). No cap is enforced -- same "keep adding, be notified of the cost" philosophy already
-- applied to workflow overages on Core.

-- Which 10 are "included" is decided deterministically by sort_order (the same field the client
-- already uses to manually order their own event list), then created_at, then id as a final
-- tiebreaker -- the first 10 active events in that order are free; anything beyond that, every
-- month it is still active, is billed.

alter table plan_features
  add column if not exists cash_flow_events_included integer,
  add column if not exists cash_flow_event_overage_price numeric;

comment on column plan_features.cash_flow_events_included is
  'Cash flow events a household may have ACTIVE at no extra charge. Null = unlimited (Premier -- staff-managed, the client-side Cash Flow tab is read-only there anyway).';
comment on column plan_features.cash_flow_event_overage_price is
  'Monthly charge for each active cash flow event beyond cash_flow_events_included, billed every month the event remains active.';

update plan_features set cash_flow_events_included = 10, cash_flow_event_overage_price = 8.00 where plan in ('basic','core');
update plan_features set cash_flow_events_included = null, cash_flow_event_overage_price = null where plan = 'premier';

-- The on/off switch a self-serve household uses to stop being billed for an event once it's no
-- longer needed (a one-time event that already happened, a recurring one that ended) -- without
-- losing the record entirely the way deleting it would. Also excludes the event from the Cash
-- Flow projection going forward (see CashFlowView), since an inactive event is, by definition, no
-- longer expected to happen.
alter table cash_flow_events add column if not exists active boolean not null default true;
comment on column cash_flow_events.active is
  'False = the household turned this event off (done/no longer applicable). Excluded from the projection and from the monthly included/overage count going forward. Turning an event back on resumes both.';

create table if not exists cash_flow_event_overage_charges (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  -- set null (not cascade) on delete: if the household deletes the underlying event, the charge
  -- already recorded for a past period is real and stays on the ledger/invoice history.
  cash_flow_event_id uuid references cash_flow_events(id) on delete set null,
  period date not null,
  unit_price numeric not null,
  status text not null default 'pending' check (status in ('pending','invoiced','waived')),
  invoiced_at timestamptz,
  stripe_invoice_item_id text,
  created_at timestamptz not null default now(),
  -- One charge per event per month -- re-running the monthly job is always safe.
  unique (cash_flow_event_id, period)
);

alter table cash_flow_event_overage_charges enable row level security;

create policy read_access on cash_flow_event_overage_charges for select
  using (public.is_admin() or family_id in (select public.current_user_allowed_family_ids()));

create policy admin_write on cash_flow_event_overage_charges for all
  using (public.is_admin()) with check (public.is_admin());

-- Client-facing usage summary, same shape/spirit as family_workflow_month_usage -- powers the
-- Cash Flow tab's usage banner, the "this will cost you" toast on adding an event, and the
-- Billing tab breakdown.
create or replace function public.family_cash_flow_event_month_usage(
  p_family_id uuid,
  p_month date default (date_trunc('month', now()))::date
)
returns table(
  plan text,
  included integer,
  unlimited boolean,
  active_count integer,
  overage_count integer,
  unit_price numeric,
  charged_this_month numeric
)
language sql
security definer
set search_path to 'public'
as $$
  with authorized as (
    select (public.is_admin() or p_family_id in (select public.current_user_allowed_family_ids())) as ok
  ),
  f as (
    select id, plan from public.families where id = p_family_id
  ),
  pf as (
    select f.plan as p, plan_features.cash_flow_events_included as included, plan_features.cash_flow_event_overage_price as unit_price
    from f join public.plan_features on plan_features.plan = f.plan
  ),
  active_events as (
    select count(*)::int as n
    from public.cash_flow_events e
    where e.family_id = p_family_id and e.active = true
  ),
  charged as (
    select coalesce(sum(unit_price),0)::numeric as amt
    from public.cash_flow_event_overage_charges c
    where c.family_id = p_family_id and c.period = p_month and c.status <> 'waived'
  )
  select
    pf.p,
    pf.included,
    pf.included is null,
    active_events.n,
    case when pf.included is null then 0 else greatest(active_events.n - pf.included, 0) end,
    pf.unit_price,
    charged.amt
  from authorized, f, pf, active_events, charged
  where authorized.ok;
$$;

-- The monthly job: for every family whose plan caps included cash flow events, rank their
-- currently-active events (sort_order, created_at, id) and record one $/month pending charge per
-- event beyond the included count, for the given period. Idempotent (unique constraint above), so
-- re-running for the same period is always safe -- this is what a monthly pg_cron tick calls.
-- SECURITY DEFINER and deliberately NOT exposed to authenticated/anon: this writes ledger rows
-- across every household at once, so only a scheduled job or the service role should ever call it.
create or replace function public.record_cash_flow_event_overages(
  p_period date default (date_trunc('month', now()))::date
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inserted int;
begin
  with ranked as (
    select
      e.id as event_id,
      e.family_id,
      row_number() over (partition by e.family_id order by e.sort_order asc nulls last, e.created_at asc, e.id asc) as rn
    from public.cash_flow_events e
    where e.active = true
  ),
  plan_limits as (
    select f.id as family_id, pf.cash_flow_events_included as included, pf.cash_flow_event_overage_price as unit_price
    from public.families f
    join public.plan_features pf on pf.plan = f.plan
  ),
  overage as (
    select r.event_id, r.family_id, pl.unit_price
    from ranked r
    join plan_limits pl on pl.family_id = r.family_id
    where pl.included is not null and r.rn > pl.included and pl.unit_price is not null
  ),
  ins as (
    insert into public.cash_flow_event_overage_charges (family_id, cash_flow_event_id, period, unit_price, status)
    select family_id, event_id, p_period, unit_price, 'pending'
    from overage
    on conflict (cash_flow_event_id, period) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return coalesce(v_inserted, 0);
end;
$$;

revoke execute on function public.record_cash_flow_event_overages(date) from public;
revoke execute on function public.record_cash_flow_event_overages(date) from anon;
revoke execute on function public.record_cash_flow_event_overages(date) from authenticated;

-- Runs itself on the 1st of every month so a household that stays over its included count keeps
-- getting billed without anyone having to remember to run this by hand. This only ever writes to
-- our own ledger table -- it never touches Stripe. Turning that ledger into an actual invoice
-- item still requires an admin to explicitly run bill-cash-flow-event-overages (mirroring
-- bill-workflow-overages), so no real charge reaches a household without a human step in between.
select cron.schedule(
  'cash-flow-event-overage-monthly',
  '0 3 1 * *',
  $$select public.record_cash_flow_event_overages();$$
);
