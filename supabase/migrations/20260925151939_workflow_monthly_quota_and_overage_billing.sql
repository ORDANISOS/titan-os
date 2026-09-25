-- Ledger of workflow_instance rows that exceeded plan_features.workflows_included for their
-- month. Written only by the log_workflow_overage_charge trigger below -- never inserted
-- directly by the app -- so the row that exists is always exactly what the enforcement trigger
-- actually allowed through, not a value the client computed and asked us to trust.
create table public.workflow_overage_charges (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id),
  workflow_instance_id uuid not null references public.workflow_instances(id),
  period date not null,
  unit_price numeric not null,
  status text not null default 'pending' check (status in ('pending','invoiced','waived')),
  invoiced_at timestamptz,
  stripe_invoice_item_id text,
  created_at timestamptz not null default now()
);
comment on table public.workflow_overage_charges is
  'One row per workflow_instance started beyond plan_features.workflows_included in a given calendar month (period = first of that month). Written only by the log_workflow_overage_charge trigger on workflow_instances. Settled by a bill-workflow-overages Edge Function (creates a Stripe invoice item per unbilled row against families.stripe_customer_id, then marks status=invoiced) -- that function is deployed but never runs itself; an admin/ops action triggers it.';

create index workflow_overage_charges_family_period_idx on public.workflow_overage_charges(family_id, period);

alter table public.workflow_overage_charges enable row level security;

create policy read_access on public.workflow_overage_charges for select
  using (is_admin() or family_id in (select current_user_allowed_family_ids()));

create policy admin_write on public.workflow_overage_charges for all
  using (is_admin()) with check (is_admin());

-- Read-only usage summary for a household's current month, shared by the client-facing
-- Workflows tab and the admin Obligations view so both show the same number. SECURITY DEFINER
-- so it can read plan_features/workflow_overage_charges regardless of the caller's own RLS grant
-- on those tables, but it re-checks the caller's own family access itself (the same rule
-- current_user_allowed_family_ids() encodes) before returning anything, so it cannot be used to
-- read another household's usage.
create or replace function public.family_workflow_month_usage(
  p_family_id uuid,
  p_month date default date_trunc('month', now())::date
)
returns table(
  plan text,
  included integer,
  unlimited boolean,
  used_this_month integer,
  overage_count integer,
  overage_price numeric,
  cap numeric,
  charged_this_month numeric,
  remaining_before_cap integer
)
language sql
security definer
set search_path = public
as $$
  with authorized as (
    select (public.is_admin() or p_family_id in (select public.current_user_allowed_family_ids())) as ok
  ),
  f as (
    select id, plan, monthly_spend_cap from public.families where id = p_family_id
  ),
  pf as (
    select f.plan as p, plan_features.workflows_included, plan_features.workflow_overage_price, plan_features.default_monthly_cap
    from f join public.plan_features on plan_features.plan = f.plan
  ),
  used as (
    select count(*)::int as n
    from public.workflow_instances wi
    where wi.family_id = p_family_id
      and wi.created_at >= p_month and wi.created_at < (p_month + interval '1 month')
  ),
  charged as (
    select coalesce(sum(unit_price),0)::numeric as amt, count(*)::int as n
    from public.workflow_overage_charges woc
    where woc.family_id = p_family_id and woc.period = p_month
  )
  select
    pf.p,
    pf.workflows_included,
    pf.workflows_included is null,
    used.n,
    charged.n,
    pf.workflow_overage_price,
    coalesce(f.monthly_spend_cap, pf.default_monthly_cap),
    charged.amt,
    case when pf.workflows_included is null then null else greatest(pf.workflows_included - used.n, 0) end
  from authorized, f, pf, used, charged
  where authorized.ok;
$$;

grant execute on function public.family_workflow_month_usage(uuid, date) to authenticated;

-- Enforcement: refuse an INSERT that would push this household's metered overage past its cap.
-- Fires alongside (not instead of) workflow_instances_refuse_core, which already blocks the
-- all-or-nothing case (a plan with can_workflows=false). This is the quantity gate on top of
-- that boolean gate, for plans that allow workflows but only up to a monthly allowance.
create or replace function public.enforce_workflow_monthly_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_included integer;
  v_price numeric;
  v_cap numeric;
  v_used integer;
  v_charged numeric;
  v_month date := date_trunc('month', now())::date;
begin
  select pf.workflows_included, pf.workflow_overage_price, coalesce(f.monthly_spend_cap, pf.default_monthly_cap)
    into v_included, v_price, v_cap
  from public.families f join public.plan_features pf on pf.plan = f.plan
  where f.id = new.family_id;

  -- Null included = unlimited (Premier today). Nothing to meter.
  if v_included is null then
    return new;
  end if;

  select count(*)::int into v_used
  from public.workflow_instances
  where family_id = new.family_id
    and created_at >= v_month and created_at < (v_month + interval '1 month');

  if v_used < v_included then
    return new;
  end if;

  select coalesce(sum(unit_price),0) into v_charged
  from public.workflow_overage_charges
  where family_id = new.family_id and period = v_month;

  if v_cap is not null and v_price is not null and (v_charged + v_price) > v_cap then
    raise exception
      'This household has used its % included workflow instances this month and reached its $% monthly overage cap. Raise the household''s cap (families.monthly_spend_cap), wait for next month, or move to a plan with more included.',
      v_included, v_cap
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger workflow_instances_enforce_quota
  before insert on public.workflow_instances
  for each row execute function public.enforce_workflow_monthly_quota();

-- Logging: once the insert above is allowed through, record whether it was billable and, if so,
-- write the ledger row. AFTER INSERT so workflow_instances.id already exists for the FK.
create or replace function public.log_workflow_overage_charge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_included integer;
  v_price numeric;
  v_used_before integer;
  v_month date := date_trunc('month', new.created_at)::date;
begin
  select pf.workflows_included, pf.workflow_overage_price into v_included, v_price
  from public.families f join public.plan_features pf on pf.plan = f.plan
  where f.id = new.family_id;

  if v_included is null or v_price is null then
    return new;
  end if;

  select count(*)::int into v_used_before
  from public.workflow_instances
  where family_id = new.family_id
    and created_at >= v_month and created_at < (v_month + interval '1 month')
    and id <> new.id;

  if v_used_before >= v_included then
    insert into public.workflow_overage_charges (family_id, workflow_instance_id, period, unit_price)
    values (new.family_id, new.id, v_month, v_price);
  end if;

  return new;
end;
$$;

create trigger workflow_instances_log_overage
  after insert on public.workflow_instances
  for each row execute function public.log_workflow_overage_charge();

-- Template library visibility: plan_features.workflows_included's own comment says access to the
-- library is never restricted by tier -- it wasn't restricted by tier, but it WAS accidentally
-- restricted by role (staff_read only covers admin/advisor/partner), so a client could never see
-- the templates their own household's workflows run on. This adds the missing read for clients.
create policy client_read on public.workflow_templates for select
  using (public.current_user_role() = 'client');
