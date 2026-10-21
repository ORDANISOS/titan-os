-- Private households, phase 2 (2026-10-21): the behind-the-scenes database functions.
--
-- Phase 1 put a restrictive row policy on every household table. Security-definer functions run as their
-- owner and bypass row policies, so the ones that hand household information to staff are wrapped here:
-- each keeps its name and arguments (nothing in the app or ELIOT changes), but now calls the original,
-- renamed <name>__unfiltered, and drops private households the signed-in caller is not named on.
-- hidden_family_ids() is empty for server code with no auth.uid() (cron jobs, the payment webhook), so
-- those keep working; ELIOT filters for its requesting admin in hub-command (phase 2b).
--
-- Wrapped:
--   rows    -- list functions, filtered on their family_id column
--   jsonb   -- firm_family_rows, filtered on the row's id
--   param   -- one-household lookups: return nothing when p_family_id is hidden
-- Left alone on purpose: counts-only reports (capacity_report, licensing_report, user_directory_facets,
-- milo_*), aggregate firm totals (enterprise_net_worth_core, enterprise_platform_totals), scalar gates used
-- by triggers (family_plan, family_on_hold*, family_storage_quota, jurisdiction_caution), and cron-only
-- functions (bills_due_for_reminder, dunning_due), which run as server code anyway.
--
-- Idempotent: re-running rewraps without renaming twice. Works from whatever definition the database has.
--
-- Rollback for one function f(args):
--   drop function public.f(args); alter function public.f__unfiltered(args) rename to f;
--   then re-grant execute on public.f(args) to the roles it had (authenticated; anon only if it had it).

do $$
declare
  t record; o oid; u oid; v_ident text; v_args text; v_result text; v_call text;
  v_body text; v_vol text; v_anon boolean; v_auth boolean;
begin
  for t in select * from (values
      ('user_directory','rows'), ('family_utilization','rows'), ('enterprise_household_list','rows'),
      ('enterprise_user_list','rows'), ('enterprise_task_summary','rows'), ('enterprise_workflow_summary','rows'),
      ('firm_family_rows','jsonb'),
      ('vault_search','param'), ('entity_tree','param'), ('entity_gaps','param'), ('entity_filings_due','param'),
      ('household_team','param'), ('family_firm_info','param'), ('family_lead_advisor','param'), ('family_payer_info','param'),
      ('family_storage_status','param'), ('family_workflow_slots','param'), ('family_workflow_month_usage','param')
    ) as x(fname, mode)
  loop
    u := null; o := null;
    -- the original: either still under its own name (first run) or already renamed (re-run)
    select p.oid into u from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = t.fname || '__unfiltered';
    if u is null then
      select p.oid into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = t.fname and p.prokind = 'f';
      if o is null then raise notice 'skip %: not on this database', t.fname; continue; end if;
      v_anon := has_function_privilege('anon', o, 'execute');
      v_auth := has_function_privilege('authenticated', o, 'execute');
      v_ident := pg_get_function_identity_arguments(o);
      execute format('alter function public.%I(%s) rename to %I', t.fname, v_ident, t.fname || '__unfiltered');
      u := o;
    else
      v_anon := false; v_auth := true; -- re-run: the wrapper's own grants are re-applied below
      v_ident := pg_get_function_identity_arguments(u);
      execute format('drop function if exists public.%I(%s)', t.fname, v_ident);
    end if;

    v_args := pg_get_function_arguments(u);        -- with names and defaults
    v_result := pg_get_function_result(u);
    -- input arguments only: proargnames also lists OUT / TABLE columns (proargmodes 'o' / 't')
    select case provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end into v_vol from pg_proc where oid = u;
    select coalesce(string_agg(format('%I', a.n), ', ' order by a.i), '') into v_call
      from pg_proc p, unnest(coalesce(p.proargnames, '{}'::text[])) with ordinality as a(n, i)
     where p.oid = u and a.n is not null and a.n <> ''
       and (p.proargmodes is null or p.proargmodes[a.i::int] in ('i', 'b', 'v'));

    v_body := case t.mode
      when 'rows'  then format('select * from public.%I(%s) x where x.family_id is null or not (x.family_id = any (array(select public.hidden_family_ids())))', t.fname || '__unfiltered', v_call)
      when 'jsonb' then format('select x from public.%I(%s) x where not (coalesce((x->>''id'')::uuid, ''00000000-0000-0000-0000-000000000000''::uuid) = any (array(select public.hidden_family_ids())))', t.fname || '__unfiltered', v_call)
      else              format('select * from public.%I(%s) where not (p_family_id = any (array(select public.hidden_family_ids())))', t.fname || '__unfiltered', v_call)
    end;

    execute format('create function public.%I(%s) returns %s language sql %s security definer set search_path to '''' as $w$ %s $w$',
                   t.fname, v_args, v_result, v_vol, v_body);
    execute format('comment on function public.%I(%s) is %L', t.fname, v_ident,
                   'Private-household filter around ' || t.fname || '__unfiltered (migration 20261021130000).');
    -- the original is now internal only
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', t.fname || '__unfiltered', v_ident);
    execute format('revoke all on function public.%I(%s) from public', t.fname, v_ident);
    if v_auth then execute format('grant execute on function public.%I(%s) to authenticated', t.fname, v_ident); end if;
    if v_anon then execute format('grant execute on function public.%I(%s) to anon', t.fname, v_ident); end if;
    execute format('grant execute on function public.%I(%s) to service_role', t.fname, v_ident);
  end loop;
end $$;

-- ELIOT (hub-command) runs as server code, so it asks for the requesting admin explicitly.
create or replace function public.hidden_family_ids_for(p_user uuid)
returns setof uuid
language sql stable security definer set search_path to ''
as $$
  with me as (select p.id, p.role, p.family_id from public.user_profiles p where p.id = p_user)
  select hp.family_id
    from public.household_privacy hp
   where p_user is not null
     and not (p_user = any (hp.viewers))
     and not exists (select 1 from me where me.role = 'client' and me.family_id = hp.family_id)
     and not exists (select 1 from me join public.family_partners fp on fp.user_id = me.id
                      where me.role = 'partner' and fp.family_id = hp.family_id);
$$;
revoke execute on function public.hidden_family_ids_for(uuid) from public, anon, authenticated;
grant execute on function public.hidden_family_ids_for(uuid) to service_role;
