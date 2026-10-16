-- Rollback for supabase/migrations/20261016200000_analyst_role.sql.
-- Production definitions captured 2026-10-16 immediately before the change. Run top to bottom.

create or replace function public.current_user_allowed_family_ids()
 returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
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
$function$;

create or replace function public.current_user_can_run_prompts()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((
    select case
      when role = 'admin' then true
      when role = 'advisor' then true
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
    'default_monthly_fee', case when (select role from public.user_profiles where id = auth.uid()) in ('admin','advisor') then p.default_monthly_fee end,
    'default_onboarding_fee', case when (select role from public.user_profiles where id = auth.uid()) in ('admin','advisor') then p.default_onboarding_fee end)
  from public.brand_profiles p where p.id = public.current_skin_id();
$function$;

drop policy if exists family_scoped_write on public.families;
create policy family_scoped_write on public.families for all
  using (is_admin() or (current_user_role() = 'advisor' and id in (select current_user_allowed_family_ids())))
  with check (is_admin() or (current_user_role() = 'advisor' and id in (select current_user_allowed_family_ids())));

drop policy if exists family_advisor_insert on public.families;
create policy family_advisor_insert on public.families for insert to authenticated
  with check (is_admin() or (current_user_role() = 'advisor' and lower(coalesce(advisor_email, '')) = lower(coalesce(current_user_email(), '\x00'))));

drop policy if exists staff_read on public.outbound_email_settings;
create policy staff_read on public.outbound_email_settings for select
  using (current_user_role() = any (array['admin','advisor','partner']));

drop policy if exists staff_read on public.workflow_templates;
create policy staff_read on public.workflow_templates for select
  using (current_user_role() = any (array['admin','advisor','partner']));

drop policy if exists read_access on public.scheduled_prompts;
create policy read_access on public.scheduled_prompts for select
  using (is_admin() or owner_user_id = auth.uid()
         or (current_user_role() = 'advisor' and family_id is not null
             and family_id in (select current_user_allowed_family_ids())
             and user_role_of(owner_user_id) = 'partner'));

drop function if exists public.household_team(uuid);
drop function if exists public.current_user_expert_emails();
drop table if exists public.expert_analysts;
drop function if exists public.expert_analysts_check_roles();
