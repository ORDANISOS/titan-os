-- Household utilization: what each household uses, and what it doesn't, so the ORDANIS Expert can raise it.
--
-- public.family_utilization(p_family_id uuid default null) returns one row per active household per feature:
--   included  : the household's plan includes the feature (from plan_features)
--   ever_used : there is any record of it
--   used_30d  : something was added, changed or completed in the last 30 days (null = not tracked by date)
--   item_count, last_activity
-- "Use" means records added, changed or completed (or a sign-in). Simply viewing a page is not recorded.
--
-- Who can call it: ORDANIS admins with MFA (aal2), and the service role (ELIOT's hub-command).
-- It is security definer (it reads sign-in times from auth.users), so it checks the caller itself.

create or replace function public.family_utilization(p_family_id uuid default null)
returns table (family_id uuid, family_name text, plan text, expert_name text, feature text, label text,
               included boolean, ever_used boolean, used_30d boolean, item_count bigint, last_activity timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (coalesce(auth.jwt() ->> 'role', '') = 'service_role'
          or (public.is_admin() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2')) then
    raise exception 'family_utilization is for ORDANIS admins (with MFA) only' using errcode = '42501';
  end if;

  return query
  with fam as (
    select f.id, f.name, coalesce(f.plan, 'basic') as plan, f.advisor_name
    from public.families f
    where f.archived_at is null and (p_family_id is null or f.id = p_family_id)
  ),
  act as (
    -- Sign-ins by the household's own (client) accounts.
    select f.id as fid, 'signin'::text as k, count(u.id) as n, max(au.last_sign_in_at) as last
      from fam f left join public.user_profiles u on u.family_id = f.id and u.role = 'client' and u.active is not false
      left join auth.users au on au.id = u.id group by f.id
    union all
    select f.id, 'tasks', count(t.id), max(greatest(t.created_at, t.completed_at))
      from fam f left join public.tasks t on t.family_id = f.id group by f.id
    union all
    select f.id, 'documents', count(d.id), max(d.created_at)
      from fam f left join public.documents d on d.family_id = f.id group by f.id
    union all
    select f.id, 'contacts', count(c.id), max(c.created_at)
      from fam f left join public.family_contacts c on c.family_id = f.id group by f.id
    union all
    select f.id, 'assets', count(a.fid), max(a.ts)
      from fam f left join (
        select p.family_id as fid, p.created_at as ts from public.properties p
        union all select v.family_id, v.created_at from public.valuables v
        union all select pa.family_id, pa.created_at from public.portfolio_accounts pa
      ) a on a.fid = f.id group by f.id
    union all
    select f.id, 'entities', count(e.id), max(greatest(e.created_at, e.updated_at))
      from fam f left join public.entities e on e.family_id = f.id group by f.id
    union all
    select f.id, 'cash_flow', count(cf.id), max(greatest(cf.created_at, cf.paid_at))
      from fam f left join public.cash_flow_events cf on cf.family_id = f.id group by f.id
    union all
    select f.id, 'bill_pay', count(cf.id), max(greatest(cf.created_at, cf.paid_at))
      from fam f left join public.cash_flow_events cf on cf.family_id = f.id and cf.pcm_responsible is true group by f.id
    union all
    select f.id, 'obligations', count(o.id), max(greatest(o.created_at, o.updated_at))
      from fam f left join public.obligations o on o.family_id = f.id group by f.id
    union all
    select f.id, 'deadlines', count(dl.id), max(dl.created_at)
      from fam f left join public.deadlines dl on dl.family_id = f.id group by f.id
    union all
    select f.id, 'workflows', count(w.id), max(greatest(w.created_at, w.completed_at))
      from fam f left join public.workflow_instances w on w.family_id = f.id group by f.id
    union all
    -- Read through to_jsonb so the function also works where this column doesn't exist yet (demo).
    select f.id, 'expert', count(x.ts), max(x.ts)
      from fam f left join lateral (
        select (to_jsonb(w) ->> 'expert_requested_at')::timestamptz as ts from public.workflow_instances w where w.family_id = f.id
      ) x on x.ts is not null group by f.id
    union all
    select f.id, 'prompts', count(sp.id), max(greatest(sp.created_at, sp.last_run_at))
      from fam f left join public.scheduled_prompts sp on sp.family_id = f.id group by f.id
    union all
    select f.id, 'partners', count(fp.id), max(fp.created_at)
      from fam f left join public.family_partners fp on fp.family_id = f.id group by f.id
    union all
    -- The AI assistant keeps a running count, not dates.
    select f.id, 'assistant', coalesce(sum(u.assistant_prompt_count), 0)::bigint, null::timestamptz
      from fam f left join public.user_profiles u on u.family_id = f.id group by f.id
  ),
  labels(k, lbl, ord) as (values
    ('signin', 'Signing in', 1), ('tasks', 'Tasks', 2), ('documents', 'Documents (CHRIS)', 3), ('contacts', 'Contacts', 4),
    ('assets', 'Properties, accounts & valuables', 5), ('entities', 'Entities', 6), ('cash_flow', 'Cash flow', 7),
    ('obligations', 'Obligations', 8), ('deadlines', 'Deadlines', 9), ('workflows', 'Workflows', 10),
    ('expert', 'ORDANIS Expert assist', 11), ('bill_pay', 'Bill pay', 12), ('prompts', 'Scheduled prompts', 13),
    ('partners', 'Advisor seats', 14), ('assistant', 'AI assistant', 15))
  select f.id, f.name, f.plan, f.advisor_name, act.k, labels.lbl,
         case act.k
           when 'obligations' then coalesce(pf.can_obligations, false)
           when 'workflows'   then coalesce(pf.can_workflows, false)
           when 'bill_pay'    then coalesce(pf.can_bill_pay, false)
           when 'prompts'     then coalesce(pf.can_prompts, false)
           when 'expert'      then coalesce(pf.has_expert, false) or (to_jsonb(pf) ->> 'expert_assist_price') is not null
           when 'partners'    then coalesce(pf.advisor_seats, false)
           else true end,
         act.n > 0,
         case when act.k = 'assistant' then null else coalesce(act.last >= now() - interval '30 days', false) end,
         act.n, act.last
  from fam f
  join act on act.fid = f.id
  join labels on labels.k = act.k
  left join public.plan_features pf on pf.plan = f.plan
  order by f.name, labels.ord;
end;
$$;

revoke execute on function public.family_utilization(uuid) from public, anon;
grant execute on function public.family_utilization(uuid) to authenticated, service_role;
