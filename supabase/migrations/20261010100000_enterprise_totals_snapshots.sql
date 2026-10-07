-- Phase 7: net worth totals per firm, a platform total to check them against, and the monthly snapshot.
--
-- Net worth uses the same formula the client dashboard uses, so a firm's total equals the sum of what its
-- households see on their own screens:
--   real estate  = property current value, or its purchase price when no current value is entered
--   debt         = property loan balances + second mortgages + any "Line of Credit" account balance
--   portfolio    = every portfolio account except "Line of Credit"
--   valuables    = estimated value of valuables
--   net worth    = real estate - debt + portfolio + valuables
-- Archived households are left out. These figures are entered by clients or the team, not synced from banks.

-- 1. The calculation, with no access check. Not callable by anyone but the functions below. ---------------
create or replace function public.enterprise_net_worth_core()
returns table(enterprise_id uuid, enterprise_name text, households integer, households_with_data integer,
              real_estate numeric, debt numeric, portfolio numeric, valuables numeric, net_worth numeric,
              oldest_balance_date date, accounts_with_date integer, accounts_total integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with fam as (
    select f.id, f.enterprise_id from public.families f where f.archived_at is null
  ),
  re as (
    select p.family_id, count(*) as n,
           sum(coalesce(nullif(p.current_value, 0), nullif(p.purchase_price, 0), 0)) as value,
           sum(coalesce(p.loan_balance, 0) + coalesce(p.second_mortgage_balance, 0)) as debt
      from public.properties p group by p.family_id
  ),
  pa as (
    select a.family_id, count(*) as n,
           sum(coalesce(a.current_balance, 0)) filter (where a.account_type is distinct from 'Line of Credit') as portfolio,
           sum(coalesce(a.current_balance, 0)) filter (where a.account_type = 'Line of Credit') as loc,
           min(a.balance_as_of) as oldest,
           count(a.balance_as_of) as dated
      from public.portfolio_accounts a group by a.family_id
  ),
  va as (
    select v.family_id, count(*) as n, sum(coalesce(v.estimated_value, 0)) as value
      from public.valuables v group by v.family_id
  ),
  per as (
    select fam.enterprise_id,
           coalesce(re.value, 0) as real_estate,
           coalesce(re.debt, 0) + coalesce(pa.loc, 0) as debt,
           coalesce(pa.portfolio, 0) as portfolio,
           coalesce(va.value, 0) as valuables,
           (coalesce(re.n, 0) + coalesce(pa.n, 0) + coalesce(va.n, 0)) > 0 as has_data,
           pa.oldest, coalesce(pa.dated, 0) as dated, coalesce(pa.n, 0) as acct_n
      from fam
      left join re on re.family_id = fam.id
      left join pa on pa.family_id = fam.id
      left join va on va.family_id = fam.id
  ),
  agg as (
    select per.enterprise_id,
           count(*)::int as households,
           (count(*) filter (where per.has_data))::int as with_data,
           sum(per.real_estate) as real_estate, sum(per.debt) as debt,
           sum(per.portfolio) as portfolio, sum(per.valuables) as valuables,
           min(per.oldest) as oldest, sum(per.dated)::int as dated, sum(per.acct_n)::int as acct_n
      from per group by per.enterprise_id
  ),
  scopes as (
    select e.id as enterprise_id, e.name from public.enterprises e
    union all
    select null::uuid, 'ORDANIS direct'
  )
  select s.enterprise_id, s.name,
         coalesce(a.households, 0), coalesce(a.with_data, 0),
         coalesce(a.real_estate, 0), coalesce(a.debt, 0), coalesce(a.portfolio, 0), coalesce(a.valuables, 0),
         coalesce(a.real_estate, 0) - coalesce(a.debt, 0) + coalesce(a.portfolio, 0) + coalesce(a.valuables, 0),
         a.oldest, coalesce(a.dated, 0), coalesce(a.acct_n, 0)
    from scopes s
    left join agg a on a.enterprise_id is not distinct from s.enterprise_id
   order by (s.enterprise_id is null), s.name;
$function$;

-- 2. What a caller may see: an ORDANIS admin sees every firm and ORDANIS direct; a firm's own administrator
--    sees only that firm; anyone else sees nothing. ---------------------------------------------------------
create or replace function public.enterprise_net_worth()
returns table(enterprise_id uuid, enterprise_name text, households integer, households_with_data integer,
              real_estate numeric, debt numeric, portfolio numeric, valuables numeric, net_worth numeric,
              oldest_balance_date date, accounts_with_date integer, accounts_total integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_ent uuid;
begin
  if public.is_admin() then
    return query select * from public.enterprise_net_worth_core();
  elsif public.is_enterprise_admin() then
    v_ent := public.current_user_enterprise_id();
    return query select * from public.enterprise_net_worth_core() c where c.enterprise_id = v_ent;
  end if;
  return;
end;
$function$;

-- 3. Platform totals worked out in one pass, not by adding up the firms, so the Enterprises tab can show that
--    firms plus ORDANIS direct really do equal the platform. ORDANIS admins only. --------------------------
create or replace function public.enterprise_platform_totals(p_month date default (date_trunc('month', now()))::date)
returns table(households integer, plan_mrr numeric, total_revenue numeric,
              real_estate numeric, debt numeric, portfolio numeric, valuables numeric, net_worth numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not public.is_admin() then return; end if;
  return query
  with fam as (select f.id, f.plan, f.subscription_state from public.families f where f.archived_at is null),
  rev as (
    select coalesce(sum(l.amount), 0) as total
      from public.billing_ledger l where l.period_month = date_trunc('month', p_month)::date
  ),
  mrr as (
    select coalesce(sum(pf.monthly_price), 0) as plan_mrr
      from fam left join public.plan_features pf on pf.plan = fam.plan
     where fam.subscription_state in ('active', 'past_due')
  ),
  re as (
    select coalesce(sum(coalesce(nullif(p.current_value, 0), nullif(p.purchase_price, 0), 0)), 0) as value,
           coalesce(sum(coalesce(p.loan_balance, 0) + coalesce(p.second_mortgage_balance, 0)), 0) as debt
      from public.properties p where p.family_id in (select id from fam)
  ),
  pa as (
    select coalesce(sum(coalesce(a.current_balance, 0)) filter (where a.account_type is distinct from 'Line of Credit'), 0) as portfolio,
           coalesce(sum(coalesce(a.current_balance, 0)) filter (where a.account_type = 'Line of Credit'), 0) as loc
      from public.portfolio_accounts a where a.family_id in (select id from fam)
  ),
  va as (
    select coalesce(sum(coalesce(v.estimated_value, 0)), 0) as value
      from public.valuables v where v.family_id in (select id from fam)
  )
  select (select count(*) from fam)::int, mrr.plan_mrr, rev.total,
         re.value, re.debt + pa.loc, pa.portfolio, va.value,
         re.value - (re.debt + pa.loc) + pa.portfolio + va.value
    from mrr, rev, re, pa, va;
end;
$function$;

-- 4. Monthly snapshot. One row per firm, plus one for ORDANIS direct (enterprise_id null), per month. ---------
-- Revenue is the month's billing ledger; plan MRR is list price for active and past-due households at the time
-- it runs; net worth is as of the time it runs. Past months keep the firm a household belonged to then.
alter table public.enterprise_snapshots alter column enterprise_id drop not null;
create unique index if not exists enterprise_snapshots_scope_month_uniq
  on public.enterprise_snapshots (coalesce(enterprise_id, '00000000-0000-0000-0000-000000000000'::uuid), snapshot_month);

create or replace function public.enterprise_snapshot_run(p_month date default ((date_trunc('month', now()) - interval '1 month'))::date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_month date := date_trunc('month', p_month)::date; v_rows integer;
begin
  -- Allowed: the service role, a signed-in ORDANIS admin, or the scheduled job (no sign-in at all, running as
  -- the database owner). A signed-in caller is judged only by whether they are an admin.
  if not (
       coalesce(auth.role(), '') = 'service_role'
    or public.is_admin()
    or (coalesce(auth.role(), '') = '' and session_user = 'postgres')
  ) then
    raise exception 'not_allowed';
  end if;

  insert into public.enterprise_snapshots
    (enterprise_id, snapshot_month, households, households_with_data, plan_mrr, usage_revenue, total_revenue,
     real_estate, debt, portfolio, valuables, net_worth)
  select n.enterprise_id, v_month, n.households, n.households_with_data,
         coalesce(h.plan_mrr, 0), coalesce(l.usage, 0), coalesce(l.total, 0),
         n.real_estate, n.debt, n.portfolio, n.valuables, n.net_worth
    from public.enterprise_net_worth_core() n
    left join (
      select f.enterprise_id,
             coalesce(sum(pf.monthly_price) filter (where f.subscription_state in ('active', 'past_due')), 0) as plan_mrr
        from public.families f
        left join public.plan_features pf on pf.plan = f.plan
       where f.archived_at is null
       group by f.enterprise_id
    ) h on h.enterprise_id is not distinct from n.enterprise_id
    left join (
      select g.enterprise_id,
             coalesce(sum(g.amount) filter (where g.line_type <> 'plan'), 0) as usage,
             coalesce(sum(g.amount), 0) as total
        from public.billing_ledger g
       where g.period_month = v_month
       group by g.enterprise_id
    ) l on l.enterprise_id is not distinct from n.enterprise_id
  on conflict (coalesce(enterprise_id, '00000000-0000-0000-0000-000000000000'::uuid), snapshot_month)
  do update set households = excluded.households, households_with_data = excluded.households_with_data,
                plan_mrr = excluded.plan_mrr, usage_revenue = excluded.usage_revenue,
                total_revenue = excluded.total_revenue, real_estate = excluded.real_estate, debt = excluded.debt,
                portfolio = excluded.portfolio, valuables = excluded.valuables, net_worth = excluded.net_worth,
                created_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

-- 5. Grants. The wrappers check the caller themselves, so signed-in users may call them; the raw calculation
--    may not be called by anyone directly. -------------------------------------------------------------------
revoke execute on function public.enterprise_net_worth_core() from public, anon, authenticated;
revoke execute on function public.enterprise_net_worth() from public, anon;
revoke execute on function public.enterprise_platform_totals(date) from public, anon;
revoke execute on function public.enterprise_snapshot_run(date) from public, anon;
grant execute on function public.enterprise_net_worth() to authenticated, service_role;
grant execute on function public.enterprise_platform_totals(date) to authenticated, service_role;
grant execute on function public.enterprise_snapshot_run(date) to authenticated, service_role;

-- 6. Run the snapshot at 06:15 UTC on the 1st of each month, for the month that just ended. It calls the
--    function directly inside the database, so no key or web request is involved. ---------------------------
select cron.schedule('enterprise-monthly-snapshot', '15 6 1 * *', 'select public.enterprise_snapshot_run()');
