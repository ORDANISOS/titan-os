-- Admins can fill the Expert and Analyst seats (2026-10-28, Will's request: Will is an admin and an ORDANIS Expert;
-- Alex Hill is an admin, an Analyst and an Onboarding Specialist). One login keeps one role; admins already see every
-- household, so this only changes who may be LINKED:
--   * expert_analysts accepts an admin as the Expert (an admin named as a household's Expert can have an Analyst)
--     and an admin as the Analyst.
--   * household_team shows an admin who is a household's Expert, and that Expert's Analyst, on "Your ORDANIS team".
--   * current_user_expert_emails counts an admin Expert, so a real Analyst supporting an admin Expert gets that
--     admin's households (and only those) the same way as for any Expert.
-- Access for analysts still comes only through the Expert link; nothing here widens what a non-admin can see beyond
-- the households of the Expert they support.
--
-- Rollback: re-run these three functions from 20261016200000_analyst_role.sql.

create or replace function public.expert_analysts_check_roles()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if coalesce((select role from public.user_profiles where id = new.expert_id), '') not in ('advisor', 'admin') then
    raise exception 'Only an ORDANIS Expert or an admin can be given an Analyst.';
  end if;
  if coalesce((select role from public.user_profiles where id = new.analyst_id), '') not in ('analyst', 'admin') then
    raise exception 'Only an Analyst or an admin can be assigned as an Analyst.';
  end if;
  return new;
end;
$function$;

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
      from f join public.user_profiles u on lower(u.email) = f.expert_email and u.role in ('advisor', 'admin')
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

create or replace function public.current_user_expert_emails()
 returns setof text language sql stable security definer set search_path to 'public'
as $function$
  select lower(ex.email)
    from public.expert_analysts ea
    join public.user_profiles me on me.id = ea.analyst_id and me.role = 'analyst' and me.active is not false
    -- The Expert must still BE an active Expert: a link left behind after someone stops being an Expert
    -- gives nothing.
    join public.user_profiles ex on ex.id = ea.expert_id and ex.role in ('advisor', 'admin') and ex.active is not false
   where ea.analyst_id = auth.uid() and ex.email is not null;
$function$;
