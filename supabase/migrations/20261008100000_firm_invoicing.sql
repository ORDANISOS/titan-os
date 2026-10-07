-- Phase 8b: who pays for a household, and the monthly firm invoice.
--
-- A household can be paid for by its firm (paid_by = 'enterprise'). Its plan fee and any extra
-- workflow slots are then billed to the firm on ONE monthly invoice built by ORDANIS, instead of
-- to the household's own card. Only an ORDANIS admin can set the payer, a discount or the spend cap
-- of a firm-paid household. Invoices are built as drafts and sent only when an admin finalizes them.
-- Nothing here writes to billing_ledger: the Stripe webhook records paid invoice lines (Phase 7).

-- 1. Payer and discount on the household -----------------------------------------------------
alter table public.families
  add column if not exists paid_by text not null default 'family',
  add column if not exists paid_by_since date,
  add column if not exists paid_by_set_by uuid,
  add column if not exists paid_by_note text,
  add column if not exists discount_code text,
  add column if not exists discount_percent numeric(5,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'families_paid_by_check') then
    alter table public.families add constraint families_paid_by_check check (paid_by in ('family','enterprise'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'families_discount_percent_range') then
    alter table public.families add constraint families_discount_percent_range check (discount_percent >= 0 and discount_percent <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'families_firm_payer_needs_firm') then
    alter table public.families add constraint families_firm_payer_needs_firm check (paid_by <> 'enterprise' or enterprise_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'families_discount_needs_firm_payer') then
    alter table public.families add constraint families_discount_needs_firm_payer check (discount_percent = 0 or paid_by = 'enterprise');
  end if;
end $$;

-- 2. Admin-only protection of the payer, discount and cap -------------------------------------
create or replace function public.protect_family_enterprise_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- A household that leaves its firm stops being paid for by it.
  if tg_op = 'UPDATE' and new.enterprise_id is null and old.paid_by = 'enterprise' then
    new.paid_by := 'family';
    new.paid_by_since := null;
    new.discount_code := null;
    new.discount_percent := 0;
  end if;

  -- Never let one household be billed twice: the firm cannot start paying while the household's own
  -- Stripe subscription is still live.
  if new.paid_by = 'enterprise'
     and (tg_op = 'INSERT' or old.paid_by is distinct from 'enterprise')
     and new.stripe_subscription_id is not null
     and coalesce(new.subscription_state::text, '') not in ('cancelled', 'archived') then
    raise exception 'cancel_subscription_first: this household still has a live Stripe subscription; cancel it before its firm pays';
  end if;

  if auth.role() = 'service_role' or public.is_admin() then
    if tg_op = 'UPDATE' and new.paid_by is distinct from old.paid_by then
      new.paid_by_set_by := auth.uid();
      new.paid_by_since := case when new.paid_by = 'enterprise' then coalesce(new.paid_by_since, current_date) else null end;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.enterprise_id is not null or new.joined_enterprise_at is not null or new.joined_via is not null then
      raise exception 'Only admins can place a household in an enterprise';
    end if;
    if new.paid_by <> 'family' or new.discount_percent <> 0 or new.discount_code is not null then
      raise exception 'Only admins can set who pays for a household';
    end if;
  else
    if new.enterprise_id is distinct from old.enterprise_id
       or new.joined_enterprise_at is distinct from old.joined_enterprise_at
       or new.joined_via is distinct from old.joined_via then
      raise exception 'Only admins can change a household''s enterprise';
    end if;
    if new.paid_by is distinct from old.paid_by
       or new.paid_by_since is distinct from old.paid_by_since
       or new.paid_by_set_by is distinct from old.paid_by_set_by
       or new.paid_by_note is distinct from old.paid_by_note
       or new.discount_code is distinct from old.discount_code
       or new.discount_percent is distinct from old.discount_percent then
      raise exception 'Only admins can change who pays for a household or its discount';
    end if;
    if old.paid_by = 'enterprise' and new.monthly_spend_cap is distinct from old.monthly_spend_cap then
      raise exception 'Only admins can change the spend cap of a household its firm pays for';
    end if;
  end if;
  return new;
end;
$function$;

-- 3. The firm's billing details (admin only: kept off the enterprises row, which a firm admin can read)
create table if not exists public.enterprise_billing (
  enterprise_id uuid primary key references public.enterprises(id) on delete cascade,
  stripe_customer_id text unique,
  billing_email text,
  payment_terms_days integer not null default 30 check (payment_terms_days between 1 and 90),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.enterprise_billing enable row level security;
create policy enterprise_billing_admin_all on public.enterprise_billing
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on table public.enterprise_billing from anon;

-- 4. Invoices and their lines ----------------------------------------------------------------
create table if not exists public.enterprise_invoices (
  id uuid primary key default gen_random_uuid(),
  enterprise_id uuid not null references public.enterprises(id),
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  status text not null default 'draft' check (status in ('draft','open','paid','void')),
  stripe_invoice_id text unique,
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  line_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  finalized_by uuid,
  finalized_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz
);
create unique index if not exists enterprise_invoices_one_live_per_month
  on public.enterprise_invoices (enterprise_id, period_month) where status <> 'void';
alter table public.enterprise_invoices enable row level security;
create policy enterprise_invoices_admin_select on public.enterprise_invoices
  for select to authenticated using (public.is_admin());
create policy enterprise_invoices_own_select on public.enterprise_invoices
  for select to authenticated
  using (public.is_enterprise_admin() and enterprise_id = public.current_user_enterprise_id());
revoke all on table public.enterprise_invoices from anon;
revoke insert, update, delete, truncate on table public.enterprise_invoices from authenticated;

create table if not exists public.enterprise_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.enterprise_invoices(id) on delete cascade,
  family_id uuid,
  family_name text,
  line_type text not null check (line_type in ('plan','plan_discount','workflow_slots','workflow_catchup')),
  description text not null,
  quantity numeric not null default 1,
  unit_amount numeric(12,2) not null,
  amount numeric(12,2) not null,
  purchase_id uuid,
  stripe_invoice_item_id text,
  created_at timestamptz not null default now()
);
create index if not exists enterprise_invoice_lines_invoice_idx on public.enterprise_invoice_lines (invoice_id);
alter table public.enterprise_invoice_lines enable row level security;
create policy enterprise_invoice_lines_admin_select on public.enterprise_invoice_lines
  for select to authenticated using (public.is_admin());
create policy enterprise_invoice_lines_own_select on public.enterprise_invoice_lines
  for select to authenticated
  using (public.is_enterprise_admin() and exists (
    select 1 from public.enterprise_invoices i
     where i.id = invoice_id and i.enterprise_id = public.current_user_enterprise_id()));
revoke all on table public.enterprise_invoice_lines from anon;
revoke insert, update, delete, truncate on table public.enterprise_invoice_lines from authenticated;

-- 5. Billing activity log (append only) --------------------------------------------------------
create table if not exists public.enterprise_billing_events (
  id uuid primary key default gen_random_uuid(),
  enterprise_id uuid not null references public.enterprises(id),
  family_id uuid,
  event_type text not null,
  actor_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists enterprise_billing_events_ent_idx on public.enterprise_billing_events (enterprise_id, created_at desc);
alter table public.enterprise_billing_events enable row level security;
create policy enterprise_billing_events_admin_select on public.enterprise_billing_events
  for select to authenticated using (public.is_admin());
create policy enterprise_billing_events_own_select on public.enterprise_billing_events
  for select to authenticated
  using (public.is_enterprise_admin() and enterprise_id = public.current_user_enterprise_id());
revoke all on table public.enterprise_billing_events from anon;
revoke insert, update, delete, truncate on table public.enterprise_billing_events from authenticated;

create or replace function public.enterprise_billing_events_block_change()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  raise exception 'The billing activity log cannot be changed';
end;
$function$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'enterprise_billing_events_append_only') then
    create trigger enterprise_billing_events_append_only
      before update or delete on public.enterprise_billing_events
      for each row execute function public.enterprise_billing_events_block_change();
  end if;
end $$;

-- A change of payer, discount or spend cap on a firm household is logged for the firm.
create or replace function public.log_family_payer_change()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_ent uuid := coalesce(new.enterprise_id, old.enterprise_id);
begin
  if v_ent is not null and (
       old.paid_by is distinct from new.paid_by
    or old.discount_code is distinct from new.discount_code
    or old.discount_percent is distinct from new.discount_percent
    or (new.paid_by = 'enterprise' and old.monthly_spend_cap is distinct from new.monthly_spend_cap)
  ) then
    insert into public.enterprise_billing_events (enterprise_id, family_id, event_type, actor_id, detail)
    values (v_ent, new.id, 'payer_changed', auth.uid(), jsonb_build_object(
      'from_paid_by', old.paid_by, 'to_paid_by', new.paid_by,
      'discount_code', new.discount_code, 'discount_percent', new.discount_percent,
      'monthly_spend_cap', new.monthly_spend_cap, 'note', new.paid_by_note));
  end if;
  return new;
end;
$function$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'families_log_payer_change') then
    create trigger families_log_payer_change
      after update on public.families
      for each row execute function public.log_family_payer_change();
  end if;
end $$;

-- 6. Workflow purchases billed to the firm -----------------------------------------------------
alter table public.workflow_purchases
  add column if not exists billed_to text not null default 'family',
  add column if not exists prorated_amount numeric(10,2),
  add column if not exists catchup_invoice_line_id uuid references public.enterprise_invoice_lines(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workflow_purchases_billed_to_check') then
    alter table public.workflow_purchases add constraint workflow_purchases_billed_to_check check (billed_to in ('family','enterprise'));
  end if;
end $$;

-- 7. begin_workflow_purchase: a firm-paid household is billed on the firm invoice, not at the click --
create or replace function public.begin_workflow_purchase(p_family_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan text; v_included int; v_price numeric; v_cap numeric; v_active int; v_held int;
  v_role text; v_label text; v_id uuid; v_existing uuid;
  v_paid_by text; v_ent uuid; v_family_cap numeric;
  v_days int; v_remaining int; v_prorated numeric;
begin
  perform pg_advisory_xact_lock(hashtext('wfslots:' || p_family_id::text));
  perform public.workflow_slots_rebalance(p_family_id);

  select f.plan, pf.workflows_included, pf.workflow_overage_price,
         coalesce(f.monthly_spend_cap, pf.default_monthly_cap),
         f.paid_by, f.enterprise_id, f.monthly_spend_cap
    into v_plan, v_included, v_price, v_cap, v_paid_by, v_ent, v_family_cap
    from public.families f join public.plan_features pf on pf.plan = f.plan
   where f.id = p_family_id;
  if v_plan is null then raise exception 'household_not_found'; end if;
  if not public.plan_allows(p_family_id, 'workflows') then raise exception 'plan_has_no_workflows'; end if;
  if v_included is null then raise exception 'plan_is_unlimited'; end if;
  if v_price is null then raise exception 'plan_has_no_workflow_price'; end if;

  select role, coalesce(nullif(full_name,''), email, 'Unknown')
    into v_role, v_label from public.user_profiles where id = p_user_id;
  if v_role is null or v_role not in ('client','admin') then raise exception 'not_allowed_to_purchase'; end if;

  if v_paid_by = 'enterprise' then
    -- Spending the firm's money needs an admin-set cap and a firm billing record.
    if v_family_cap is null then raise exception 'firm_paid_cap_not_set'; end if;
    if not exists (select 1 from public.enterprise_billing eb
                    where eb.enterprise_id = v_ent and eb.stripe_customer_id is not null) then
      raise exception 'enterprise_billing_not_set_up';
    end if;
    v_cap := v_family_cap;
  end if;

  select id into v_existing from public.workflow_purchases
   where family_id = p_family_id and status = 'available' order by approved_at limit 1;
  if v_existing is not null then
    return jsonb_build_object('purchase_id', v_existing, 'reused', true, 'unit_price', v_price,
                              'payer', case when v_paid_by = 'enterprise' then 'enterprise' else 'family' end);
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

  if v_paid_by = 'enterprise' then
    -- No card is charged. The slot is usable at once and is billed on the firm's invoices: the rest of
    -- this month as a prorated line on the next invoice, then the full price each month it is held.
    v_days := extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::int;
    v_remaining := v_days - extract(day from current_date)::int + 1;
    v_prorated := round(v_price * v_remaining / v_days, 2);
    insert into public.workflow_purchases (family_id, status, unit_price, approved_by, approved_by_label, billed_to, prorated_amount)
    values (p_family_id, 'available', v_price, p_user_id, v_label, 'enterprise', v_prorated)
    returning id into v_id;
    insert into public.enterprise_billing_events (enterprise_id, family_id, event_type, actor_id, detail)
    values (v_ent, p_family_id, 'workflow_slot_added', p_user_id,
            jsonb_build_object('purchase_id', v_id, 'unit_price', v_price, 'prorated_amount', v_prorated, 'approved_by', v_label));
    return jsonb_build_object('purchase_id', v_id, 'reused', false, 'unit_price', v_price, 'payer', 'enterprise');
  end if;

  insert into public.workflow_purchases (family_id, status, unit_price, approved_by, approved_by_label)
  values (p_family_id, 'pending', v_price, p_user_id, v_label)
  returning id into v_id;

  return jsonb_build_object('purchase_id', v_id, 'reused', false, 'unit_price', v_price, 'payer', 'family');
end;
$function$;

-- 8. family_workflow_slots: the same cap rule decides can_buy for a firm-paid household -----------
create or replace function public.family_workflow_slots(p_family_id uuid)
returns table(plan text, included integer, unlimited boolean, active_count integer, free_remaining integer,
              slots_in_use integer, slots_available integer, unit_price numeric, monthly_cap numeric,
              slots_monthly_cost numeric, can_buy boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with authorized as (
    select (public.is_admin() or p_family_id in (select public.current_user_allowed_family_ids())) as ok
  ),
  f as (select id, plan, monthly_spend_cap, paid_by, enterprise_id from public.families where id = p_family_id),
  pf as (
    select f.plan p, plan_features.workflows_included inc, plan_features.workflow_overage_price price,
           case when f.paid_by = 'enterprise' then f.monthly_spend_cap
                else coalesce(f.monthly_spend_cap, plan_features.default_monthly_cap) end cap,
           (f.paid_by = 'enterprise') firm_paid,
           (f.paid_by <> 'enterprise' or (f.monthly_spend_cap is not null and exists (
              select 1 from public.enterprise_billing eb
               where eb.enterprise_id = f.enterprise_id and eb.stripe_customer_id is not null))) payer_ready
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
          and pf.payer_ready and (pf.cap is null or (s.held + 1) * pf.price <= pf.cap))
    from authorized, pf, act, s where authorized.ok;
$function$;

-- 9. Build the invoice rows for one firm and month (admin or service role only) --------------------
-- Billed in advance on the 1st: each firm household's plan fee for the month (prorated in its first
-- month), its discount, the extra workflow slots it held at the start of the month, and a prorated
-- catch-up line for each slot bought in an earlier month that has not been invoiced yet.
-- Rows with line_type 'warning_blocking' stop an invoice being created; 'warning' rows are informational.
create or replace function public.enterprise_invoice_preview(p_enterprise_id uuid, p_period date)
returns table(family_id uuid, family_name text, line_type text, description text, quantity numeric,
              unit_amount numeric, amount numeric, purchase_id uuid)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_start date; v_end date; v_days int;
begin
  if not (auth.role() = 'service_role' or public.is_admin()) then raise exception 'not_allowed'; end if;
  v_start := date_trunc('month', p_period)::date;
  if p_period <> v_start then raise exception 'period_must_be_first_of_month'; end if;
  v_end := (v_start + interval '1 month - 1 day')::date;
  v_days := (v_end - v_start) + 1;

  return query
  with fams as (
    select f.id, f.name, f.paid_by_since, f.discount_code, f.discount_percent,
           f.stripe_subscription_id, f.subscription_state, pf.label plan_label, pf.monthly_price,
           round(coalesce(pf.monthly_price, 0) * case
                   when f.paid_by_since is not null and f.paid_by_since > v_start
                   then ((v_end - f.paid_by_since) + 1)::numeric / v_days else 1 end, 2) plan_amt
      from public.families f join public.plan_features pf on pf.plan = f.plan
     where f.enterprise_id = p_enterprise_id and f.paid_by = 'enterprise' and f.archived_at is null
       and (f.paid_by_since is null or f.paid_by_since <= v_end)
  ),
  r as (
    select f.id fid, f.name fname, 'plan'::text lt, 1 ord,
           ('Plan fee - ' || f.plan_label || ' - ' || f.name || ' - ' || to_char(v_start, 'Mon YYYY')
             || case when f.paid_by_since is not null and f.paid_by_since > v_start
                     then ' (prorated from ' || to_char(f.paid_by_since, 'Mon FMDD') || ')' else '' end)::text d,
           1::numeric q, f.plan_amt ua, f.plan_amt am, null::uuid pid
      from fams f where f.plan_amt > 0
    union all
    select f.id, f.name, 'plan_discount', 2,
           ('Discount ' || coalesce(f.discount_code || ' ', '') || '(' || f.discount_percent::text || '% off plan fee) - ' || f.name)::text,
           1::numeric, -round(f.plan_amt * f.discount_percent / 100, 2), -round(f.plan_amt * f.discount_percent / 100, 2), null::uuid
      from fams f where f.discount_percent > 0 and f.plan_amt > 0
    union all
    select f.id, f.name, 'workflow_slots', 3,
           ('Extra workflow slots - ' || f.name || ' - ' || to_char(v_start, 'Mon YYYY'))::text,
           count(*)::numeric, wp.unit_price, (count(*) * wp.unit_price)::numeric, null::uuid
      from fams f join public.workflow_purchases wp on wp.family_id = f.id
     where wp.billed_to = 'enterprise' and wp.status in ('available','in_use','released')
       and wp.created_at < v_start::timestamptz
       and (wp.released_at is null or wp.released_at >= v_start::timestamptz)
     group by f.id, f.name, wp.unit_price
    union all
    select f.id, f.name, 'workflow_catchup', 4,
           ('Extra workflow added ' || to_char(wp.created_at, 'Mon FMDD') || ' (prorated) - ' || f.name)::text,
           1::numeric, wp.prorated_amount, wp.prorated_amount, wp.id
      from fams f join public.workflow_purchases wp on wp.family_id = f.id
     where wp.billed_to = 'enterprise' and wp.catchup_invoice_line_id is null
       and coalesce(wp.prorated_amount, 0) > 0 and wp.created_at < v_start::timestamptz
       and wp.status <> 'failed'
    union all
    select f.id, f.name, 'warning_blocking', 0,
           ('Still has a live Stripe subscription - cancel it first or it will be billed twice: ' || f.name)::text,
           0::numeric, 0::numeric, 0::numeric, null::uuid
      from fams f
     where f.stripe_subscription_id is not null and coalesce(f.subscription_state::text, '') not in ('cancelled','archived')
    union all
    select f.id, f.name, 'warning', 0,
           ('Plan has no monthly fee, so no plan line was built: ' || f.name)::text,
           0::numeric, 0::numeric, 0::numeric, null::uuid
      from fams f where coalesce(f.monthly_price, 0) = 0
  )
  select r.fid, r.fname, r.lt, r.d, r.q, r.ua, r.am, r.pid from r order by r.fname, r.ord;
end;
$function$;

-- 10. Record, change the status of, or void an invoice (service role only, atomic) --------------------
create or replace function public.enterprise_invoice_record(
  p_enterprise_id uuid, p_period date, p_stripe_invoice_id text, p_actor uuid, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_line uuid; l jsonb; v_amt numeric; v_pos numeric := 0; v_neg numeric := 0; v_n int := 0; v_upd int;
begin
  if auth.role() <> 'service_role' then raise exception 'not_allowed'; end if;
  perform pg_advisory_xact_lock(hashtext('entinv:' || p_enterprise_id::text || ':' || p_period::text));

  insert into public.enterprise_invoices (enterprise_id, period_month, status, stripe_invoice_id, created_by)
  values (p_enterprise_id, p_period, 'draft', p_stripe_invoice_id, p_actor)
  returning id into v_id;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_amt := (l->>'amount')::numeric;
    insert into public.enterprise_invoice_lines
      (invoice_id, family_id, family_name, line_type, description, quantity, unit_amount, amount, purchase_id, stripe_invoice_item_id)
    values (v_id, nullif(l->>'family_id','')::uuid, l->>'family_name', l->>'line_type', l->>'description',
            coalesce((l->>'quantity')::numeric, 1), (l->>'unit_amount')::numeric, v_amt,
            nullif(l->>'purchase_id','')::uuid, l->>'stripe_invoice_item_id')
    returning id into v_line;
    if v_amt > 0 then v_pos := v_pos + v_amt; else v_neg := v_neg + v_amt; end if;
    v_n := v_n + 1;
    if l->>'line_type' = 'workflow_catchup' and nullif(l->>'purchase_id','') is not null then
      update public.workflow_purchases set catchup_invoice_line_id = v_line
       where id = (l->>'purchase_id')::uuid and catchup_invoice_line_id is null;
      get diagnostics v_upd = row_count;
      if v_upd = 0 then raise exception 'catchup_already_invoiced'; end if;
    end if;
  end loop;

  update public.enterprise_invoices
     set subtotal = v_pos, discount_total = v_neg, total = v_pos + v_neg, line_count = v_n
   where id = v_id;
  insert into public.enterprise_billing_events (enterprise_id, event_type, actor_id, detail)
  values (p_enterprise_id, 'invoice_drafted', p_actor,
          jsonb_build_object('invoice_id', v_id, 'period', p_period, 'stripe_invoice_id', p_stripe_invoice_id,
                             'total', v_pos + v_neg, 'lines', v_n));
  return v_id;
end;
$function$;

create or replace function public.enterprise_invoice_set_status(
  p_invoice_id uuid, p_stripe_invoice_id text, p_status text, p_actor uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_inv public.enterprise_invoices%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'not_allowed'; end if;
  if p_status not in ('open','paid','void') then raise exception 'invalid_status'; end if;

  select * into v_inv from public.enterprise_invoices
   where (p_invoice_id is not null and id = p_invoice_id)
      or (p_invoice_id is null and stripe_invoice_id = p_stripe_invoice_id)
   for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if v_inv.status = p_status then return v_inv.status; end if;
  if v_inv.status = 'void' then raise exception 'invoice_is_void'; end if;
  if p_status = 'open' and v_inv.status <> 'draft' then raise exception 'only_a_draft_can_be_sent'; end if;
  if p_status = 'void' and v_inv.status = 'paid' then raise exception 'a_paid_invoice_cannot_be_voided'; end if;

  update public.enterprise_invoices
     set status = p_status,
         finalized_by = case when p_status = 'open' then p_actor else finalized_by end,
         finalized_at = case when p_status = 'open' then now() else finalized_at end,
         paid_at = case when p_status = 'paid' then now() else paid_at end,
         voided_at = case when p_status = 'void' then now() else voided_at end
   where id = v_inv.id;

  if p_status = 'void' then
    -- The catch-up lines on a voided invoice become billable again on the next one.
    update public.workflow_purchases wp set catchup_invoice_line_id = null
     where wp.catchup_invoice_line_id in (select l.id from public.enterprise_invoice_lines l where l.invoice_id = v_inv.id);
  end if;

  insert into public.enterprise_billing_events (enterprise_id, event_type, actor_id, detail)
  values (v_inv.enterprise_id, 'invoice_' || p_status, p_actor,
          jsonb_build_object('invoice_id', v_inv.id, 'period', v_inv.period_month, 'stripe_invoice_id', v_inv.stripe_invoice_id));
  return p_status;
end;
$function$;

-- 11. Grants ---------------------------------------------------------------------------------------
revoke execute on function public.enterprise_invoice_preview(uuid, date) from public, anon, authenticated;
revoke execute on function public.enterprise_invoice_record(uuid, date, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.enterprise_invoice_set_status(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.log_family_payer_change() from public, anon, authenticated;
revoke execute on function public.enterprise_billing_events_block_change() from public, anon, authenticated;
grant execute on function public.enterprise_invoice_preview(uuid, date) to service_role;
grant execute on function public.enterprise_invoice_record(uuid, date, text, uuid, jsonb) to service_role;
grant execute on function public.enterprise_invoice_set_status(uuid, text, text, uuid) to service_role;
