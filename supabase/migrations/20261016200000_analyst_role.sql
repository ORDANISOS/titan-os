-- Analyst role (2026-10-16).
--
-- Every ORDANIS Expert has an Analyst. An Analyst:
--   * is linked to one or more Experts (each Expert has ONE Analyst; an Analyst may support several);
--   * automatically gets every household of every Expert they support, and follows a household when
--     its Expert changes, because access is derived from the Expert, never stored per household;
--   * has the same access as the Expert inside those households;
--   * is NOT the point person: families.advisor_email stays the Expert, so client emails, CCs,
--     reminders and "your ORDANIS Expert" wording are unchanged.
-- Clients see their Analyst on the household team, listed under the Expert (household_team()).
--
-- user_profiles.role is free text, so 'analyst' needs no constraint change. Admins set the role and
-- the Expert link; nobody can do either to themselves (protect_sensitive_profile_columns and the
-- admin-only policies below).

-- 1. Who supports whom -------------------------------------------------------------------------------
create table if not exists public.expert_analysts (
  expert_id   uuid primary key references public.user_profiles(id) on delete cascade,  -- one Analyst per Expert
  analyst_id  uuid not null references public.user_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists expert_analysts_analyst on public.expert_analysts (analyst_id);

alter table public.expert_analysts enable row level security;
revoke all on public.expert_analysts from anon;
grant select, insert, update, delete on public.expert_analysts to authenticated;

drop policy if exists expert_analysts_staff_read on public.expert_analysts;
create policy expert_analysts_staff_read on public.expert_analysts
  for select to authenticated
  using (public.is_admin() or public.current_user_role() in ('advisor', 'analyst'));

drop policy if exists expert_analysts_admin_write on public.expert_analysts;
create policy expert_analysts_admin_write on public.expert_analysts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The link must join an Expert to an Analyst, never anything else.
create or replace function public.expert_analysts_check_roles()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if (select role from public.user_profiles where id = new.expert_id) is distinct from 'advisor' then
    raise exception 'Only an ORDANIS Expert can be given an Analyst.';
  end if;
  if (select role from public.user_profiles where id = new.analyst_id) is distinct from 'analyst' then
    raise exception 'Only a user with the Analyst role can be assigned as an Analyst.';
  end if;
  return new;
end;
$function$;
revoke execute on function public.expert_analysts_check_roles() from public, anon, authenticated;
drop trigger if exists expert_analysts_roles on public.expert_analysts;
create trigger expert_analysts_roles before insert or update on public.expert_analysts
  for each row execute function public.expert_analysts_check_roles();

-- 2. The emails of the Experts the signed-in Analyst supports -----------------------------------------
create or replace function public.current_user_expert_emails()
 returns setof text language sql stable security definer set search_path to 'public'
as $function$
  select lower(ex.email)
    from public.expert_analysts ea
    join public.user_profiles me on me.id = ea.analyst_id and me.role = 'analyst' and me.active is not false
    -- The Expert must still BE an active Expert: a link left behind after someone stops being an Expert
    -- gives nothing.
    join public.user_profiles ex on ex.id = ea.expert_id and ex.role = 'advisor' and ex.active is not false
   where ea.analyst_id = auth.uid() and ex.email is not null;
$function$;
revoke execute on function public.current_user_expert_emails() from public, anon;
grant execute on function public.current_user_expert_emails() to authenticated;

-- 3. Household access: an Analyst gets their Experts' households (added as one more UNION branch) ------
create or replace function public.current_user_allowed_family_ids()
 returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  WITH me AS (SELECT id, email, role, family_id FROM public.user_profiles WHERE id = auth.uid())
  SELECT f.id FROM public.families f, me
  WHERE me.role = 'advisor' AND me.email IS NOT NULL AND f.advisor_email IS NOT NULL
    AND lower(f.advisor_email) = lower(me.email)
  UNION
  SELECT f.id FROM public.families f, me
  WHERE me.role = 'analyst' AND f.advisor_email IS NOT NULL
    AND lower(f.advisor_email) IN (SELECT public.current_user_expert_emails())
  UNION
  SELECT fp.family_id FROM public.family_partners fp, me
  WHERE me.role = 'partner' AND fp.user_id = me.id
  UNION
  SELECT me.family_id FROM me
  WHERE me.role = 'client' AND me.family_id IS NOT NULL;
$function$;

create or replace function public.current_user_can_run_prompts()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((
    select case
      when role = 'admin' then true
      when role in ('advisor', 'analyst') then true
      when role = 'partner' then can_run_scheduled_prompts
      else false
    end
    from public.user_profiles where id = auth.uid()
  ), false);
$function$;

create or replace function public.my_firm_defaults()
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'derive_property_costs', p.derive_property_costs,
    'ai_investment_policy', p.ai_investment_policy,
    'default_monthly_fee', case when (select role from public.user_profiles where id = auth.uid()) in ('admin','advisor','analyst') then p.default_monthly_fee end,
    'default_onboarding_fee', case when (select role from public.user_profiles where id = auth.uid()) in ('admin','advisor','analyst') then p.default_onboarding_fee end)
  from public.brand_profiles p where p.id = public.current_skin_id();
$function$;

-- 4. Policies that named the Expert role now include the Analyst ---------------------------------------
drop policy if exists family_scoped_write on public.families;
create policy family_scoped_write on public.families
  for all
  using (is_admin() or (current_user_role() in ('advisor','analyst') and id in (select current_user_allowed_family_ids())))
  with check (is_admin() or (current_user_role() in ('advisor','analyst') and id in (select current_user_allowed_family_ids())));

-- An Analyst may create a household for one of their Experts (the Expert stays the point person).
drop policy if exists family_advisor_insert on public.families;
create policy family_advisor_insert on public.families
  for insert to authenticated
  with check (
    is_admin()
    or (current_user_role() = 'advisor' and lower(coalesce(advisor_email, '')) = lower(coalesce(current_user_email(), '\x00')))
    or (current_user_role() = 'analyst' and lower(coalesce(advisor_email, '')) in (select current_user_expert_emails()))
  );

drop policy if exists staff_read on public.outbound_email_settings;
create policy staff_read on public.outbound_email_settings
  for select using (current_user_role() = any (array['admin','advisor','analyst','partner']));

drop policy if exists staff_read on public.workflow_templates;
create policy staff_read on public.workflow_templates
  for select using (current_user_role() = any (array['admin','advisor','analyst','partner']));

drop policy if exists read_access on public.scheduled_prompts;
create policy read_access on public.scheduled_prompts
  for select using (
    is_admin() or owner_user_id = auth.uid()
    or (current_user_role() in ('advisor','analyst') and family_id is not null
        and family_id in (select current_user_allowed_family_ids())
        and user_role_of(owner_user_id) = 'partner')
  );

-- 5. The household team, for client and staff screens ----------------------------------------------
-- The Expert (point person) and that Expert's Analyst. Returned only to people who can see the household.
create or replace function public.household_team(p_family_id uuid)
 returns table(member_role text, full_name text, email text, is_point_person boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  with f as (
    select fam.id, lower(fam.advisor_email) as expert_email, fam.advisor_name
      from public.families fam
     where fam.id = p_family_id
       and (public.caller_is_privileged()
            or fam.id in (select public.current_user_allowed_family_ids())
            or fam.id in (select public.current_user_firm_family_ids()))
  ), ex as (
    select u.id, coalesce(nullif(btrim(u.full_name), ''), f.advisor_name, u.email) as full_name, u.email
      from f join public.user_profiles u on lower(u.email) = f.expert_email and u.role = 'advisor'
     limit 1
  )
  select 'expert', coalesce((select full_name from ex), f.advisor_name), coalesce((select email from ex), f.expert_email), true
    from f where f.expert_email is not null
  union all
  select 'analyst', coalesce(nullif(btrim(a.full_name), ''), a.email), a.email, false
    from ex
    join public.expert_analysts ea on ea.expert_id = ex.id
    join public.user_profiles a on a.id = ea.analyst_id and a.active is not false;
$function$;
revoke execute on function public.household_team(uuid) from public, anon;
grant execute on function public.household_team(uuid) to authenticated, service_role;

-- ROLLBACK (in this order):
--   restore current_user_allowed_family_ids / current_user_can_run_prompts / my_firm_defaults and the five
--   policies from docs/ROLLBACK-20261016-analyst-role.sql;
--   drop function public.household_team(uuid); drop function public.current_user_expert_emails();
--   drop table public.expert_analysts;  drop function public.expert_analysts_check_roles();
