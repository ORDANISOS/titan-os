-- Correction: cash flow events are a free, included platform feature -- they were never supposed
-- to carry a charge. That mechanism (cash_flow_event_overage_billing) is being reverted in a
-- companion migration. THIS mechanism -- 10 included workflows, $8/month for each additional one,
-- for Core only (Premier is unlimited, Basic has no workflow access at all) -- was correct in
-- concept but wrong in shape: it billed based on how many workflow cycles were STARTED in a given
-- calendar month, when what was actually wanted is a RECURRING monthly charge for each workflow
-- that is still ACTIVE (in progress), which stops the moment the workflow is marked complete.
-- Completing a workflow already happens today (advance() sets workflow_instances.status =
-- 'completed' once every step is done) -- nothing new was needed there. This migration just
-- changes what "usage" means: active count, not monthly starts.

-- Drop the old at-creation, monthly-count-based overage logger. It fired once, at the moment a
-- cycle was started, and never again -- so a long-running workflow was billed once regardless of
-- how many months it stayed open, and a workflow completed the same day it started was billed
-- exactly as much as one still open a year later. Neither matches "billed while active, stops at
-- completion."
drop trigger if exists workflow_instances_log_overage on workflow_instances;
drop function if exists log_workflow_overage_charge();

-- Drop the pre-insert cap-enforcement trigger too. It was built around the same monthly-count
-- model (and around a monthly spend cap that Core no longer has -- plan_features
-- .default_monthly_cap is null for core already). The new design has no insert-time gate at all:
-- workflows are never blocked, only billed, and the household is told the cost in the app itself
-- (see ObligationsSection's startCycle in App.jsx) -- consistent with how Core's cap removal was
-- described ("give them the choice to add at $8 per").
drop trigger if exists workflow_instances_enforce_quota on workflow_instances;
drop function if exists enforce_workflow_monthly_quota();

-- The ledger now needs one row per (instance, month) it stays active-and-over-quota, not one row
-- ever per instance -- so it needs a period-scoped uniqueness guarantee for the new monthly job to
-- be safely re-run.
alter table workflow_overage_charges
  add constraint workflow_overage_charges_instance_period_key unique (workflow_instance_id, period);

-- Return shape is changing (used_this_month -> active_count), so the old function must be dropped
-- first -- Postgres won't let create-or-replace change a function's OUT-parameter row type.
drop function if exists family_workflow_month_usage(uuid, date);

-- Client-facing usage summary -- same name/call sites as before (App.jsx's ObligationsSection and
-- ClientDashboard's Billing tab both already call this), new shape: active_count replaces
-- used_this_month. remaining_before_cap is kept (renamed meaning: "before overage pricing kicks
-- in", same as it always meant despite the name) so existing UI needs only that one field rename,
-- not a rebuild.
create function public.family_workflow_month_usage(
  p_family_id uuid,
  p_month date default (date_trunc('month', now()))::date
)
returns table(
  plan text,
  included integer,
  unlimited boolean,
  active_count integer,
  overage_count integer,
  overage_price numeric,
  cap numeric,
  charged_this_month numeric,
  remaining_before_cap integer
)
language sql
security definer
set search_path to 'public'
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
  active as (
    select count(*)::int as n
    from public.workflow_instances wi
    where wi.family_id = p_family_id
      and wi.status not in ('completed','cancelled')
  ),
  charged as (
    select coalesce(sum(unit_price),0)::numeric as amt
    from public.workflow_overage_charges woc
    where woc.family_id = p_family_id and woc.period = p_month
  )
  select
    pf.p,
    pf.workflows_included,
    pf.workflows_included is null,
    active.n,
    case when pf.workflows_included is null then 0 else greatest(active.n - pf.workflows_included, 0) end,
    pf.workflow_overage_price,
    coalesce(f.monthly_spend_cap, pf.default_monthly_cap),
    charged.amt,
    case when pf.workflows_included is null then null else greatest(pf.workflows_included - active.n, 0) end
  from authorized, f, pf, active, charged
  where authorized.ok;
$$;

-- The monthly job: for every family whose plan meters workflows (workflows_included not null --
-- Core today), rank their currently-ACTIVE instances (created_at, id -- workflow_instances has no
-- sort_order) and record one $/month pending charge per instance beyond the included count, for
-- the given period. Idempotent via the unique constraint just added, so re-running for the same
-- period is always safe -- this is what a monthly pg_cron tick calls. A workflow that reaches
-- 'completed' (or 'cancelled') before the next tick simply stops being ranked here at all -- no
-- separate "remove" action needed, since completing it is already how a household finishes one.
-- SECURITY DEFINER and deliberately NOT exposed to authenticated/anon, same reasoning as
-- record_cash_flow_event_overages: only a scheduled job or the service role should call this.
create or replace function public.record_workflow_overages(
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
      wi.id as instance_id,
      wi.family_id,
      row_number() over (partition by wi.family_id order by wi.created_at asc, wi.id asc) as rn
    from public.workflow_instances wi
    where wi.status not in ('completed','cancelled')
  ),
  plan_limits as (
    select f.id as family_id, pf.workflows_included as included, pf.workflow_overage_price as unit_price
    from public.families f
    join public.plan_features pf on pf.plan = f.plan
  ),
  overage as (
    select r.instance_id, r.family_id, pl.unit_price
    from ranked r
    join plan_limits pl on pl.family_id = r.family_id
    where pl.included is not null and r.rn > pl.included and pl.unit_price is not null
  ),
  ins as (
    insert into public.workflow_overage_charges (family_id, workflow_instance_id, period, unit_price, status)
    select family_id, instance_id, p_period, unit_price, 'pending'
    from overage
    on conflict (workflow_instance_id, period) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return coalesce(v_inserted, 0);
end;
$$;

revoke execute on function public.record_workflow_overages(date) from public;
revoke execute on function public.record_workflow_overages(date) from anon;
revoke execute on function public.record_workflow_overages(date) from authenticated;

-- Runs itself on the 1st of every month, same as cash flow's job (offset a few minutes so they
-- don't contend). Only ever writes to our own ledger; turning that into a real Stripe charge still
-- requires an admin to explicitly run bill-workflow-overages (unchanged -- that function only
-- cares about 'pending' rows in workflow_overage_charges, not how they got there, so it needed no
-- changes for this redesign).
select cron.schedule(
  'workflow-overage-monthly',
  '15 3 1 * *',
  $$select public.record_workflow_overages();$$
);
