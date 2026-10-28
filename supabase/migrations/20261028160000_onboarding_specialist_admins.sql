-- Admins can be Onboarding Specialists (2026-10-28, Will's request: Alex Hill is an admin and onboards households).
-- One login has one role; an admin already sees every household, so the only change is that
-- onboarding_specialist_assign accepts an active admin as well as an ORDANIS Expert or Analyst. The day-30 notice,
-- the assistant's hand-off by name and the household's Overview card all key off the assignment, not the role.
--
-- Rollback: re-run onboarding_specialist_assign from 20261022140000_onboarding_specialists.sql.

-- Admin functions. Admins only, from a session that passed two-step sign-in.
create or replace function public.onboarding_specialist_assign(p_family_id uuid, p_staff_id uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_me public.user_profiles; v_staff public.user_profiles; v_name text; v_id uuid;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null or v_me.role <> 'admin' then raise exception 'Admins only.' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'Sign in with your two-step code first.' using errcode = '42501'; end if;
  select name into v_name from public.families where id = p_family_id and archived_at is null;
  if v_name is null then raise exception 'Household not found.' using errcode = 'P0002'; end if;
  select * into v_staff from public.user_profiles where id = p_staff_id;
  if v_staff.id is null or v_staff.role not in ('admin', 'advisor', 'analyst') or v_staff.active is not distinct from false then
    raise exception 'Choose an active admin, ORDANIS Expert or Analyst.' using errcode = '22023';
  end if;
  if exists (select 1 from public.household_onboarding_specialists where family_id = p_family_id and staff_id = p_staff_id
               and ended_at is null and expires_at > now()) then
    raise exception 'That person is already this household''s Onboarding Specialist.' using errcode = '23505';
  end if;
  -- An expired-but-not-ended row is closed first so the "one live assignment" rule holds.
  update public.household_onboarding_specialists set ended_at = now(), ended_by = auth.uid()
   where family_id = p_family_id and staff_id = p_staff_id and ended_at is null;
  insert into public.household_onboarding_specialists (family_id, staff_id, assigned_by)
  values (p_family_id, p_staff_id, auth.uid()) returning id into v_id;
  insert into public.audit_log (request_id, user_id, user_email, user_role, aal, source, module, command, tool_calls, result_summary, status)
  values (gen_random_uuid(), auth.uid(), v_me.email, v_me.role, auth.jwt() ->> 'aal', 'portal', 'onboarding-specialist', 'assign',
          jsonb_build_array(jsonb_build_object('family_id', p_family_id, 'staff_id', p_staff_id, 'assignment_id', v_id)),
          coalesce(nullif(v_staff.full_name, ''), v_staff.email) || ' named Onboarding Specialist for ' || v_name, 'ok');
  return jsonb_build_object('id', v_id);
end; $$;
revoke execute on function public.onboarding_specialist_assign(uuid, uuid) from public, anon;
grant execute on function public.onboarding_specialist_assign(uuid, uuid) to authenticated;
