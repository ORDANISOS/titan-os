-- Scaling step 2, part 1: server queries for staff screens that load on demand (plan: docs/PLAN-SCALING-STEP2.md,
-- approved by Will 2026-10-31 with the three recommendations).
--
-- Today a staff sign-in downloads every row of 18 tables for every household the person can see, and Supabase stops
-- at 1,000 rows per request without saying so. These functions let the staff screens ask for exactly what they show:
-- one page of the households list, the dashboard totals, and the per-Expert roll-up.
--
-- SECURITY: every function is SECURITY INVOKER, so it runs as the signed-in person and the existing row-level rules
-- (current_user_allowed_family_ids, is_admin, hidden households ...) decide which households are counted, exactly as
-- they decide what the old full download returned. Signed-out callers cannot execute them.
--
-- p_today is the person's own calendar date, sent by the browser, so "overdue" and "due soon" match what the screen
-- showed before (which used the browser's local date), whatever the server's time zone.
--
-- The off switch: platform_config.staff_on_demand. While false (the default) the app keeps the old full download;
-- an admin turns it on (or back off) with no deploy.

alter table public.platform_config add column if not exists staff_on_demand boolean not null default false;

-- Expert filter on the households list and dashboard compares lower(advisor_email).
create index if not exists families_advisor_email_lower_idx on public.families (lower(advisor_email));

-- A property's value is counted as the screens always have: current value, else purchase price.
--
-- Dashboard totals for the households in scope. p_scope = an Expert's email, or null for everyone the caller can see.
-- Mirrors Dashboard(): active (not archived) households only.
create or replace function public.staff_dashboard_summary(p_scope text default null, p_today date default current_date)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with fam as (
    select f.id from families f
    where f.archived_at is null
      and (p_scope is null or p_scope = '' or lower(f.advisor_email) = lower(p_scope))
  ),
  props as (select p.* from properties p join fam on fam.id = p.family_id),
  accts as (select a.* from portfolio_accounts a join fam on fam.id = a.family_id),
  open_tasks as (select t.due_date from tasks t join fam on fam.id = t.family_id where not coalesce(t.done, false))
  select jsonb_build_object(
    'families',    (select count(*) from fam),
    'contacts',    (select count(*) from contacts c join fam on fam.id = c.family_id),
    'properties',  (select count(*) from props),
    'real_estate', (select coalesce(sum(coalesce(nullif(current_value, 0), nullif(purchase_price, 0), 0)), 0) from props),
    'accounts',    (select count(*) from accts),
    'portfolio',   (select coalesce(sum(coalesce(current_balance, 0)), 0) from accts where account_type is distinct from 'Line of Credit'),
    'debt',        (select coalesce(sum(coalesce(loan_balance, 0) + coalesce(second_mortgage_balance, 0)), 0) from props)
                 + (select coalesce(sum(coalesce(current_balance, 0)), 0) from accts where account_type = 'Line of Credit')
                 + (select coalesce(sum(coalesce(l.current_balance, 0)), 0) from loans l join fam on fam.id = l.family_id),
    'open_tasks',  (select count(*) from open_tasks),
    'overdue',     (select count(*) from open_tasks where due_date < p_today),
    'due_soon',    (select count(*) from open_tasks where due_date >= p_today and due_date <= p_today + 29)
  );
$$;

-- One page of the households list. Each row is the full household record (as the old download had it, so the
-- household dashboard opens from it unchanged) plus its counts, and total_count for the page controls.
-- p_sort: 'name' (default, alphabetical) or 'urgent' (most overdue tasks first, then most open tasks, then name).
create or replace function public.staff_household_page(
  p_search text default null,
  p_expert text default null,
  p_show_archived boolean default false,
  p_sort text default 'name',
  p_limit int default 50,
  p_offset int default 0,
  p_today date default current_date
)
returns table (
  family jsonb,
  properties bigint,
  accounts bigint,
  open_tasks bigint,
  overdue bigint,
  value numeric,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with matched as (
    select f.*
    from families f
    where (p_show_archived or f.archived_at is null)
      and (p_expert is null or p_expert = '' or coalesce(f.advisor_email, '') = p_expert)
      and (p_search is null or p_search = ''
           or concat_ws(' ', f.name, f.advisor_name, f.advisor_email) ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ),
  stats as (
    select m.id,
      (select count(*) from properties p where p.family_id = m.id) as properties,
      (select count(*) from portfolio_accounts a where a.family_id = m.id) as accounts,
      (select count(*) from tasks t where t.family_id = m.id and not coalesce(t.done, false)) as open_tasks,
      (select count(*) from tasks t where t.family_id = m.id and not coalesce(t.done, false) and t.due_date < p_today) as overdue,
      (select coalesce(sum(coalesce(nullif(p.current_value, 0), nullif(p.purchase_price, 0), 0)), 0) from properties p where p.family_id = m.id)
      + (select coalesce(sum(coalesce(a.current_balance, 0)), 0) from portfolio_accounts a where a.family_id = m.id) as value
    from matched m
  )
  select to_jsonb(m) as family, s.properties, s.accounts, s.open_tasks, s.overdue, s.value,
         count(*) over () as total_count
  from matched m join stats s on s.id = m.id
  order by
    case when p_sort = 'urgent' then s.overdue end desc nulls last,
    case when p_sort = 'urgent' then s.open_tasks end desc nulls last,
    lower(m.name), m.id
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- The admin "By ORDANIS Expert" view: one row per Expert email (null = unassigned) over active households.
create or replace function public.staff_expert_rollup(p_today date default current_date)
returns table (
  email text,
  name text,
  families bigint,
  value numeric,
  open_tasks bigint,
  overdue bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with fam as (select f.id, f.advisor_email, f.advisor_name from families f where f.archived_at is null),
  per as (
    select fam.advisor_email, fam.advisor_name,
      (select coalesce(sum(coalesce(nullif(p.current_value, 0), nullif(p.purchase_price, 0), 0)), 0) from properties p where p.family_id = fam.id)
      + (select coalesce(sum(coalesce(a.current_balance, 0)), 0) from portfolio_accounts a where a.family_id = fam.id) as value,
      (select count(*) from tasks t where t.family_id = fam.id and not coalesce(t.done, false)) as open_tasks,
      (select count(*) from tasks t where t.family_id = fam.id and not coalesce(t.done, false) and t.due_date < p_today) as overdue
    from fam
  )
  select nullif(advisor_email, '') as email,
         coalesce(max(advisor_name), 'Unassigned') as name,
         count(*) as families, sum(value) as value, sum(open_tasks) as open_tasks, sum(overdue) as overdue
  from per
  group by nullif(advisor_email, '')
  order by sum(value) desc, count(*) desc;
$$;

revoke execute on function public.staff_dashboard_summary(text, date) from public, anon;
revoke execute on function public.staff_household_page(text, text, boolean, text, int, int, date) from public, anon;
revoke execute on function public.staff_expert_rollup(date) from public, anon;
grant execute on function public.staff_dashboard_summary(text, date) to authenticated;
grant execute on function public.staff_household_page(text, text, boolean, text, int, int, date) to authenticated;
grant execute on function public.staff_expert_rollup(date) to authenticated;
