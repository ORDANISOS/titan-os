-- ORDANIS production schema snapshot, part 1 of 3: base functions.
-- Source: pg_get_functiondef() on production (xreeruxuwtmjhvvxvjts), captured 2026-10-06.
-- These 17 functions are live on production but are defined in no migration file.
-- REFERENCE ONLY. Do not run this against production. See README.md in this folder.
--
-- Each definition below is followed by a line holding a single ";" so the file is runnable
-- on a blank database. The text between "CREATE OR REPLACE FUNCTION" and that ";" line is
-- byte-identical to what pg_get_functiondef() returns, which is how it is verified.

CREATE OR REPLACE FUNCTION public.admin_contact_title(p_plan text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when lower(coalesce(p_plan,'')) = 'premier'
              then 'Ordanis Expert' else 'Financial Advisor' end;
$function$

;
-- ACL: default (executable by public, anon, authenticated, service_role)

CREATE OR REPLACE FUNCTION public.capacity_report()
 RETURNS TABLE(person text, email text, role text, families integer, premier integer, core integer, cap integer, headroom text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u.full_name, u.email, u.role, count(f.id)::int,
         count(f.id) filter (where lower(coalesce(f.plan,''))='premier')::int,
         count(f.id) filter (where lower(coalesce(f.plan,''))='core')::int,
         u.family_cap,
         case when u.family_cap is null then 'no cap set'
              when count(f.id) >= u.family_cap then 'AT CAPACITY'
              else (u.family_cap-count(f.id))::text || ' more' end
  from public.user_profiles u
  left join public.families f on lower(coalesce(f.advisor_email,''))=lower(u.email)
  where u.role in ('advisor','admin') and coalesce(u.active,true)
  group by u.full_name,u.email,u.role,u.family_cap
  order by count(f.id) desc, u.full_name;
$function$

;
revoke execute on function public.capacity_report() from public, anon;
grant execute on function public.capacity_report() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_allowed_family_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT id, email, role, family_id FROM public.user_profiles WHERE id = auth.uid())
  SELECT f.id FROM public.families f, me
  WHERE me.role = 'advisor' AND me.email IS NOT NULL AND f.advisor_email IS NOT NULL
    AND lower(f.advisor_email) = lower(me.email)
  UNION
  SELECT fp.family_id FROM public.family_partners fp, me
  WHERE me.role = 'partner' AND fp.user_id = me.id
  UNION
  SELECT me.family_id FROM me
  WHERE me.role = 'client' AND me.family_id IS NOT NULL;
$function$

;
revoke execute on function public.current_user_allowed_family_ids() from public, anon;
grant execute on function public.current_user_allowed_family_ids() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_can_run_prompts()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
      when role = 'admin' then true
      when role = 'advisor' then true
      when role = 'partner' then can_run_scheduled_prompts
      else false
    end
    from public.user_profiles where id = auth.uid()
  ), false);
$function$

;
revoke execute on function public.current_user_can_run_prompts() from public, anon;
grant execute on function public.current_user_can_run_prompts() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_email()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT email FROM public.user_profiles WHERE id = auth.uid();
$function$

;
revoke execute on function public.current_user_email() from public, anon;
grant execute on function public.current_user_email() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_family_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select family_id from public.user_profiles where id = auth.uid();
$function$

;
revoke execute on function public.current_user_family_id() from public, anon;
grant execute on function public.current_user_family_id() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$function$

;
revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dunning_due(p_today date DEFAULT CURRENT_DATE)
 RETURNS TABLE(family_id uuid, family_name text, contact_email text, days_past_due integer, notice_kind text, day_number integer, note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with f as (
    select fm.id, btrim(fm.name) as name, fm.past_due_since,
           (p_today - fm.past_due_since) as days,
           fm.subscription_state, fm.export_downloaded_at,
           (select c.email from public.contacts c
             where c.family_id = fm.id and c.is_primary and coalesce(c.email,'') <> ''
             limit 1) as primary_email
    from public.families fm
    where fm.subscription_state in ('past_due','final_notice')
      and fm.past_due_since is not null
  )
  -- Weekly reminders on days 7, 14, 21 and 28.
  select f.id, f.name, f.primary_email, f.days::int, 'weekly', f.days::int,
         'Payment missed ' || f.days || ' days ago. Nothing has changed for the household yet.'
    from f
   where f.days in (7,14,21,28)
     and not exists (select 1 from dunning_notices d
                     where d.family_id=f.id and d.notice_kind='weekly' and d.day_number=f.days)
  union all
  -- Day 30: the final notice, with the export link and the 30-day deadline.
  select f.id, f.name, f.primary_email, f.days::int, 'final_notice', 30,
         'Thirty days to bring the account current. A secure export link is included; the household moves to archive after day 60.'
    from f
   where f.days >= 30
     and not exists (select 1 from dunning_notices d
                     where d.family_id=f.id and d.notice_kind='final_notice')
  union all
  -- Day 60 with no download: escalate to people the platform already holds,
  -- rather than archiving in silence.
  select f.id, f.name, f.primary_email, f.days::int, 'escalation', 60,
         'Day 60 and the export has never been opened. Contact the secondary member and the family attorney and CPA before archiving - nobody may be reading the email.'
    from f
   where f.days >= 60 and f.export_downloaded_at is null
     and not exists (select 1 from dunning_notices d
                     where d.family_id=f.id and d.notice_kind='escalation')
  order by 4 desc, 2;
$function$

;
revoke execute on function public.dunning_due(date) from public, anon;
grant execute on function public.dunning_due(date) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_family_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cap integer; v_name text; v_load integer;
begin
  if new.advisor_email is null
     or (tg_op='UPDATE' and lower(coalesce(old.advisor_email,''))=lower(new.advisor_email)) then
    return new;
  end if;

  select family_cap, full_name into v_cap, v_name
  from public.user_profiles where lower(email)=lower(new.advisor_email);
  if v_cap is null then return new; end if;

  select count(*) into v_load from public.families f
  where lower(coalesce(f.advisor_email,''))=lower(new.advisor_email)
    and f.id is distinct from new.id;

  if v_load >= v_cap then
    raise exception '% is at capacity (% of % families). Raise their cap or assign this family to someone else.',
      coalesce(v_name,new.advisor_email), v_load, v_cap;
  end if;
  return new;
end;
$function$

;
revoke execute on function public.enforce_family_cap() from public, anon;
grant execute on function public.enforce_family_cap() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_lead_advisor_is_adviser()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_kind text; v_role text; v_name text;
begin
  if not coalesce(new.is_lead_advisor,false) then return new; end if;
  select partner_kind, role, full_name into v_kind, v_role, v_name
  from public.user_profiles where id=new.user_id;
  if v_role is distinct from 'partner' then return new; end if;
  if v_kind is distinct from 'adviser' then
    raise exception 'Only a partner marked as the firm''s adviser can lead a relationship. % is recorded as %.',
      coalesce(v_name,'this partner'), coalesce(v_kind,'unspecified');
  end if;
  return new;
end;
$function$

;
revoke execute on function public.enforce_lead_advisor_is_adviser() from public, anon;
grant execute on function public.enforce_lead_advisor_is_adviser() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.user_profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'client',
    true
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;
end;
$function$

;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'admin'
  );
$function$

;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.licensing_report()
 RETURNS TABLE(licensed integer, families_total integer, premier integer, core integer, unassigned integer, over_or_under text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (select licensed_families from public.platform_config where id),
         (select count(*)::int from public.families),
         (select count(*)::int from public.families where lower(coalesce(plan,''))='premier'),
         (select count(*)::int from public.families where lower(coalesce(plan,''))='core'),
         (select count(*)::int from public.families where coalesce(advisor_email,'')=''),
         case when (select licensed_families from public.platform_config where id) is null then 'no licence count set'
              when (select count(*) from public.families) > (select licensed_families from public.platform_config where id)
                then 'OVER by ' || ((select count(*) from public.families)-(select licensed_families from public.platform_config where id))::text || ' — invoice needs updating'
              when (select count(*) from public.families) = (select licensed_families from public.platform_config where id) then 'at contracted limit'
              else ((select licensed_families from public.platform_config where id)-(select count(*) from public.families))::text || ' unused' end;
$function$

;
revoke execute on function public.licensing_report() from public, anon;
grant execute on function public.licensing_report() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.plan_allows(p_family_id uuid, p_feature text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    case p_feature
      when 'obligations' then pf.can_obligations
      when 'workflows'   then pf.can_workflows
      when 'bill_pay'    then pf.can_bill_pay
      when 'prompts'     then pf.can_prompts
      when 'resources'   then pf.can_resources
      when 'expert'      then pf.has_expert
      else false
    end, false)
  from public.families f
  left join public.plan_features pf on pf.plan = f.plan
  where f.id = p_family_id;
$function$

;
revoke execute on function public.plan_allows(uuid,text) from public, anon;
grant execute on function public.plan_allows(uuid,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_directory(p_search text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_after text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, email text, full_name text, role text, active boolean, family_id uuid, family_name text, plan text, plan_label text, subscription_state text, created_at timestamp with time zone, cursor text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u.id, u.email, u.full_name, u.role, u.active,
         u.family_id, btrim(f.name), f.plan, pf.label,
         f.subscription_state::text, u.created_at,
         lower(u.email) || '|' || u.id::text
  from public.user_profiles u
  left join public.families f       on f.id = u.family_id
  left join public.plan_features pf on pf.plan = f.plan
  where public.caller_is_privileged()
    and (p_role  is null or u.role = p_role)
    and (p_state is null or f.subscription_state::text = p_state)
    and (p_search is null or btrim(p_search) = '' or
         u.email ilike '%'||btrim(p_search)||'%' or
         u.full_name ilike '%'||btrim(p_search)||'%' or
         f.name ilike '%'||btrim(p_search)||'%')
    and (p_after is null or lower(u.email) || '|' || u.id::text > p_after)
  order by lower(u.email), u.id
  limit greatest(1, least(coalesce(p_limit,50), 200));
$function$

;
revoke execute on function public.user_directory(text,text,text,integer,text) from public, anon;
grant execute on function public.user_directory(text,text,text,integer,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_directory_facets()
 RETURNS TABLE(facet text, value text, n integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'role', u.role, count(*)::int from public.user_profiles u
   where public.caller_is_privileged() group by u.role
  union all
  select 'state', coalesce(f.subscription_state::text,'no household'), count(*)::int
    from public.user_profiles u left join public.families f on f.id=u.family_id
   where public.caller_is_privileged() group by 1,2
  union all
  select 'plan', coalesce(pf.label,'no plan'), count(*)::int
    from public.user_profiles u
    left join public.families f on f.id=u.family_id
    left join public.plan_features pf on pf.plan=f.plan
   where public.caller_is_privileged() group by 1,2
  order by 1, 3 desc;
$function$

;
revoke execute on function public.user_directory_facets() from public, anon;
grant execute on function public.user_directory_facets() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_role_of(uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from public.user_profiles where id = uid;
$function$

;
revoke execute on function public.user_role_of(uuid) from public, anon;
grant execute on function public.user_role_of(uuid) to authenticated, service_role;
