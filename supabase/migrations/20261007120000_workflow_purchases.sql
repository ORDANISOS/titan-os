-- Workflow purchases (Phase 8a of the multi-enterprise plan).
-- A household on a metered plan (Core: 10 active workflows included) can run more than its
-- included number only by buying a slot. The database enforces this: an insert beyond the limit
-- is refused unless the household holds a paid, unused slot, which the insert then consumes.
-- Slots are created only by the purchase-workflow edge function (service role) after it has
-- charged Stripe. Browsers can read their own household's purchases and nothing else.
-- This replaces the old after-the-fact monthly overage ledger.

create table if not exists public.workflow_purchases (
  id                          uuid primary key default gen_random_uuid(),
  family_id                   uuid not null references public.families(id) on delete cascade,
  status                      text not null default 'pending'
                              check (status in ('pending','available','in_use','released','failed')),
  unit_price                  numeric(10,2) not null check (unit_price >= 0),
  approved_by                 uuid,
  approved_by_label           text not null,
  approved_at                 timestamptz not null default now(),
  workflow_instance_id        uuid references public.workflow_instances(id) on delete set null
                              deferrable initially deferred,
  workflow_label              text,
  consumed_at                 timestamptz,
  released_at                 timestamptz,
  release_reason              text check (release_reason in
                              ('completed','cancelled','deleted','excess','plan_change','user_cancelled','timed_out','payment_failed')),
  stripe_subscription_item_id text,
  stripe_invoice_id           text,
  failure_note                text,
  created_at                  timestamptz not null default now()
);
create index if not exists workflow_purchases_family_status_idx on public.workflow_purchases (family_id, status);
create unique index if not exists workflow_purchases_instance_uniq
  on public.workflow_purchases (workflow_instance_id) where status = 'in_use' and workflow_instance_id is not null;

create table if not exists public.workflow_slot_billing (
  family_id      uuid primary key references public.families(id) on delete cascade,
  stripe_item_id text,
  billed_qty     integer not null default 0 check (billed_qty >= 0),
  synced_at      timestamptz
);

alter table public.workflow_purchases     enable row level security;
alter table public.workflow_slot_billing  enable row level security;

revoke all on public.workflow_purchases    from anon, authenticated;
revoke all on public.workflow_slot_billing from anon, authenticated;
grant select on public.workflow_purchases    to authenticated;
grant select on public.workflow_slot_billing to authenticated;

create policy workflow_purchases_select on public.workflow_purchases for select to authenticated
  using (public.is_admin()
         or (family_id in (select public.current_user_allowed_family_ids())
             and public.current_user_role() <> 'partner'));

create policy workflow_slot_billing_admin_select on public.workflow_slot_billing for select to authenticated
  using (public.is_admin());

-- ── Internal: bring a household's slots back in line with reality ───────────
-- Releases slots whose workflow finished or was deleted, releases slots no longer needed (a
-- non-purchased workflow finished, so the household is back under its free allowance), releases
-- everything if the plan became unlimited, and fails purchases that never completed.
create or replace function public.workflow_slots_rebalance(p_family_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_found    boolean;
  v_included int;
  v_active   int;
  v_needed   int;
  v_in_use   int;
begin
  perform pg_advisory_xact_lock(hashtext('wfslots:' || p_family_id::text));

  update public.workflow_purchases
     set status = 'failed', release_reason = 'timed_out', released_at = now(),
         failure_note = 'Purchase did not finish within 10 minutes'
   where family_id = p_family_id and status = 'pending' and created_at < now() - interval '10 minutes';

  update public.workflow_purchases wp
     set status = 'released', released_at = now(),
         release_reason = coalesce(
           (select case wi.status when 'completed' then 'completed' when 'cancelled' then 'cancelled' end
              from public.workflow_instances wi where wi.id = wp.workflow_instance_id),
           'deleted')
   where wp.family_id = p_family_id and wp.status = 'in_use'
     and not exists (select 1 from public.workflow_instances wi
                      where wi.id = wp.workflow_instance_id and wi.status not in ('completed','cancelled'));

  select true, pf.workflows_included into v_found, v_included
    from public.families f join public.plan_features pf on pf.plan = f.plan
   where f.id = p_family_id;
  if not coalesce(v_found, false) then return; end if;

  if v_included is null then
    update public.workflow_purchases
       set status = 'released', released_at = now(), release_reason = 'plan_change'
     where family_id = p_family_id and status in ('available','in_use');
    return;
  end if;

  select count(*) into v_active from public.workflow_instances
   where family_id = p_family_id and status not in ('completed','cancelled');
  v_needed := greatest(v_active - v_included, 0);
  select count(*) into v_in_use from public.workflow_purchases
   where family_id = p_family_id and status = 'in_use';

  if v_in_use > v_needed then
    update public.workflow_purchases
       set status = 'released', released_at = now(), release_reason = 'excess'
     where id in (select id from public.workflow_purchases
                   where family_id = p_family_id and status = 'in_use'
                   order by consumed_at desc nulls last, id
                   limit v_in_use - v_needed);
  end if;
end;
$fn$;

-- ── Enforcement: refuse a workflow beyond the limit unless a paid slot is available ──
create or replace function public.enforce_workflow_slot_limit()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_included  int;
  v_active    int;
  v_slot      uuid;
  v_activates boolean;
begin
  if tg_op = 'INSERT' then
    v_activates := new.status not in ('completed','cancelled');
  else
    v_activates := new.status not in ('completed','cancelled')
                   and (old.status in ('completed','cancelled') or old.family_id is distinct from new.family_id);
  end if;
  if not v_activates then return new; end if;

  perform pg_advisory_xact_lock(hashtext('wfslots:' || new.family_id::text));

  select pf.workflows_included into v_included
    from public.families f join public.plan_features pf on pf.plan = f.plan
   where f.id = new.family_id;
  if not found or v_included is null then return new; end if;

  select count(*) into v_active from public.workflow_instances
   where family_id = new.family_id and status not in ('completed','cancelled') and id <> new.id;
  if v_active < v_included then return new; end if;

  select id into v_slot from public.workflow_purchases
   where family_id = new.family_id and status = 'available'
   order by approved_at, id limit 1 for update;

  if v_slot is null then
    raise exception 'workflow_limit_reached: this household has % of % included workflows active. Add another for a monthly fee, or complete one first.', v_active, v_included
      using errcode = 'check_violation', hint = 'purchase_required';
  end if;

  update public.workflow_purchases
     set status = 'in_use', workflow_instance_id = new.id, consumed_at = now(),
         workflow_label = coalesce(new.cycle_label, 'Workflow')
   where id = v_slot;
  return new;
end;
$fn$;

create trigger workflow_instances_slot_limit
  before insert or update of status, family_id on public.workflow_instances
  for each row execute function public.enforce_workflow_slot_limit();

create or replace function public.workflow_slots_after_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'DELETE' then
    perform public.workflow_slots_rebalance(old.family_id);
  else
    perform public.workflow_slots_rebalance(old.family_id);
    if new.family_id is distinct from old.family_id then
      perform public.workflow_slots_rebalance(new.family_id);
    end if;
  end if;
  return null;
end;
$fn$;

create trigger workflow_instances_slot_release_upd
  after update of status, family_id on public.workflow_instances
  for each row when (old.status is distinct from new.status or old.family_id is distinct from new.family_id)
  execute function public.workflow_slots_after_change();

create trigger workflow_instances_slot_release_del
  after delete on public.workflow_instances
  for each row execute function public.workflow_slots_after_change();

-- ── Start a purchase (edge function only). Returns the pending row; the function then charges
-- Stripe and marks it available. All the rules live here so they cannot be skipped. ──
create or replace function public.begin_workflow_purchase(p_family_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_plan     text;
  v_included int;
  v_price    numeric;
  v_cap      numeric;
  v_active   int;
  v_held     int;
  v_role     text;
  v_label    text;
  v_id       uuid;
  v_existing uuid;
begin
  perform pg_advisory_xact_lock(hashtext('wfslots:' || p_family_id::text));
  perform public.workflow_slots_rebalance(p_family_id);

  select f.plan, pf.workflows_included, pf.workflow_overage_price,
         coalesce(f.monthly_spend_cap, pf.default_monthly_cap)
    into v_plan, v_included, v_price, v_cap
    from public.families f join public.plan_features pf on pf.plan = f.plan
   where f.id = p_family_id;
  if v_plan is null then raise exception 'household_not_found'; end if;
  if not public.plan_allows(p_family_id, 'workflows') then raise exception 'plan_has_no_workflows'; end if;
  if v_included is null then raise exception 'plan_is_unlimited'; end if;
  if v_price is null then raise exception 'plan_has_no_workflow_price'; end if;

  select role, coalesce(nullif(full_name,''), email, 'Unknown')
    into v_role, v_label from public.user_profiles where id = p_user_id;
  if v_role is null or v_role not in ('client','admin') then raise exception 'not_allowed_to_purchase'; end if;

  select id into v_existing from public.workflow_purchases
   where family_id = p_family_id and status = 'available' order by approved_at limit 1;
  if v_existing is not null then
    return jsonb_build_object('purchase_id', v_existing, 'reused', true, 'unit_price', v_price);
  end if;

  if exists (select 1 from public.workflow_purchases where family_id = p_family_id and status = 'pending') then
    raise exception 'purchase_in_progress';
  end if;

  select count(*) into v_active from public.workflow_instances
   where family_id = p_family_id and status not in ('completed','cancelled');
  if v_active < v_included then raise exception 'purchase_not_needed'; end if;

  select count(*) into v_held from public.workflow_purchases
   where family_id = p_family_id and status in ('available','in_use','pending');
  if v_cap is not null and (v_held + 1) * v_price > v_cap then
    raise exception 'workflow_spend_cap_reached';
  end if;

  insert into public.workflow_purchases (family_id, status, unit_price, approved_by, approved_by_label)
  values (p_family_id, 'pending', v_price, p_user_id, v_label)
  returning id into v_id;

  return jsonb_build_object('purchase_id', v_id, 'reused', false, 'unit_price', v_price);
end;
$fn$;

-- ── What the screens read ──
create or replace function public.family_workflow_slots(p_family_id uuid)
returns table (
  plan text, included integer, unlimited boolean, active_count integer, free_remaining integer,
  slots_in_use integer, slots_available integer, unit_price numeric, monthly_cap numeric,
  slots_monthly_cost numeric, can_buy boolean
)
language sql stable security definer set search_path = public as $fn$
  with authorized as (
    select (public.is_admin() or p_family_id in (select public.current_user_allowed_family_ids())) as ok
  ),
  f as (select id, plan, monthly_spend_cap from public.families where id = p_family_id),
  pf as (
    select f.plan p, plan_features.workflows_included inc, plan_features.workflow_overage_price price,
           coalesce(f.monthly_spend_cap, plan_features.default_monthly_cap) cap
      from f join public.plan_features on plan_features.plan = f.plan
  ),
  act as (select count(*)::int n from public.workflow_instances
           where family_id = p_family_id and status not in ('completed','cancelled')),
  s as (select count(*) filter (where status = 'in_use')::int in_use,
               count(*) filter (where status = 'available')::int avail,
               count(*) filter (where status in ('in_use','available','pending'))::int held
          from public.workflow_purchases where family_id = p_family_id)
  select pf.p, pf.inc, pf.inc is null, act.n,
         case when pf.inc is null then null else greatest(pf.inc - act.n, 0) end,
         s.in_use, s.avail, pf.price, pf.cap,
         (s.held * coalesce(pf.price, 0))::numeric,
         (public.current_user_role() in ('client','admin') and pf.inc is not null and pf.price is not null
          and (pf.cap is null or (s.held + 1) * pf.price <= pf.cap))
    from authorized, pf, act, s where authorized.ok;
$fn$;

-- The old monthly overage ledger is replaced by purchases; stop it from recording charges that
-- would double-bill purchased slots. The table and edge function are left in place, unused.
create or replace function public.record_workflow_overages(p_period date default (date_trunc('month', now()))::date)
returns integer language sql security definer set search_path = public as $fn$
  select 0;
$fn$;

-- ── Permissions ──
revoke all on function public.workflow_slots_rebalance(uuid)        from public, anon, authenticated;
revoke all on function public.enforce_workflow_slot_limit()         from public, anon, authenticated;
revoke all on function public.workflow_slots_after_change()         from public, anon, authenticated;
revoke all on function public.begin_workflow_purchase(uuid, uuid)   from public, anon, authenticated;
grant execute on function public.workflow_slots_rebalance(uuid)       to service_role;
grant execute on function public.begin_workflow_purchase(uuid, uuid)  to service_role;
revoke all on function public.family_workflow_slots(uuid) from public, anon;
grant execute on function public.family_workflow_slots(uuid) to authenticated;
