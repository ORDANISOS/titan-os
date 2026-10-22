-- Onboarding Specialist (2026-10-22, Will's decision).
--
-- An admin names an ORDANIS Expert or Analyst on a household (any plan) to help set it up: vendors,
-- properties and the rest. For 30 days they can open and edit the household exactly as its Expert could, without
-- becoming its Expert. On day 30 the admin who named them and the specialist are emailed (onboarding-notices
-- function, daily cron) and an admin may extend by 30 days or end it. Access stops by itself at expires_at.
--
-- How: current_user_allowed_family_ids() (behind every household row policy) also returns households with a live
-- assignment for the signed-in Expert/Analyst. Private households still stay hidden unless the specialist is named
-- on them (restrictive private_household policy, unchanged). Assign/extend/end only through the admin functions
-- below; each is written to audit_log.
--
-- Also: only an admin (or server code) may change which Expert a household has. Without this, anyone who can edit
-- a household (an Expert, or now a specialist) could name themselves its Expert and keep access for good.
--
-- Grants explicit (Supabase table-grant change): authenticated may read (RLS: admins all rows, staff their own);
-- writes only through the security-definer functions; service_role full (onboarding-notices).
--
-- Rollback:
--   (restore current_user_allowed_family_ids from migration 20261016200000_analyst_role)
--   drop trigger if exists families_protect_expert on public.families; drop function if exists public.protect_family_expert();
--   drop function if exists public.onboarding_specialist_assign(uuid, uuid);
--   drop function if exists public.onboarding_specialist_extend(uuid);
--   drop function if exists public.onboarding_specialist_end(uuid);
--   drop function if exists public.onboarding_specialist_list(uuid);
--   drop table if exists public.household_onboarding_specialists;

create table if not exists public.household_onboarding_specialists (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families(id) on delete cascade,
  staff_id        uuid not null references public.user_profiles(id) on delete cascade,
  assigned_by     uuid references public.user_profiles(id) on delete set null,
  starts_at       timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '30 days'),
  extended_count  integer not null default 0,
  notified_at     timestamptz,
  ended_at        timestamptz,
  ended_by        uuid references public.user_profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists hos_family_idx on public.household_onboarding_specialists(family_id);
create index if not exists hos_staff_live_idx on public.household_onboarding_specialists(staff_id) where ended_at is null;
-- One live assignment per person per household.
create unique index if not exists hos_one_live on public.household_onboarding_specialists(family_id, staff_id) where ended_at is null;

alter table public.household_onboarding_specialists enable row level security;
revoke all on public.household_onboarding_specialists from public, anon, authenticated;
grant select on public.household_onboarding_specialists to authenticated;
grant select, insert, update, delete on public.household_onboarding_specialists to service_role;
drop policy if exists hos_read on public.household_onboarding_specialists;
create policy hos_read on public.household_onboarding_specialists for select to authenticated
  using (public.is_admin() or staff_id = auth.uid());

-- Every household row policy goes through this. Same as 20261016200000 plus live onboarding assignments.
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
  SELECT s.family_id FROM public.household_onboarding_specialists s, me
  WHERE me.role IN ('advisor', 'analyst') AND s.staff_id = me.id AND s.ended_at IS NULL AND s.expires_at > now()
  UNION
  SELECT fp.family_id FROM public.family_partners fp, me
  WHERE me.role = 'partner' AND fp.user_id = me.id
  UNION
  SELECT me.family_id FROM me
  WHERE me.role = 'client' AND me.family_id IS NOT NULL;
$function$;

-- Only an admin or server code may change a household's Expert.
create or replace function public.protect_family_expert()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and lower(coalesce(new.advisor_email, '')) is distinct from lower(coalesce(old.advisor_email, '')) then
    raise exception 'Only an ORDANIS admin can change which Expert a household has.' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke execute on function public.protect_family_expert() from public, anon, authenticated;
drop trigger if exists families_protect_expert on public.families;
create trigger families_protect_expert before update on public.families for each row execute function public.protect_family_expert();

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
  if v_staff.id is null or v_staff.role not in ('advisor', 'analyst') or v_staff.active is not distinct from false then
    raise exception 'Choose an active ORDANIS Expert or Analyst.' using errcode = '22023';
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

create or replace function public.onboarding_specialist_extend(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_me public.user_profiles; v_row public.household_onboarding_specialists; v_new timestamptz;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null or v_me.role <> 'admin' then raise exception 'Admins only.' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'Sign in with your two-step code first.' using errcode = '42501'; end if;
  select * into v_row from public.household_onboarding_specialists where id = p_id;
  if v_row.id is null or v_row.ended_at is not null then raise exception 'Assignment not found or already ended.' using errcode = 'P0002'; end if;
  -- 30 more days from today if it has lapsed, otherwise from its current end.
  v_new := greatest(v_row.expires_at, now()) + interval '30 days';
  update public.household_onboarding_specialists set expires_at = v_new, extended_count = extended_count + 1, notified_at = null where id = p_id;
  insert into public.audit_log (request_id, user_id, user_email, user_role, aal, source, module, command, tool_calls, result_summary, status)
  values (gen_random_uuid(), auth.uid(), v_me.email, v_me.role, auth.jwt() ->> 'aal', 'portal', 'onboarding-specialist', 'extend',
          jsonb_build_array(jsonb_build_object('family_id', v_row.family_id, 'staff_id', v_row.staff_id, 'assignment_id', p_id)),
          'Onboarding access extended to ' || to_char(v_new, 'Mon DD, YYYY'), 'ok');
  return jsonb_build_object('expires_at', v_new);
end; $$;

create or replace function public.onboarding_specialist_end(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_me public.user_profiles; v_row public.household_onboarding_specialists;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null or v_me.role <> 'admin' then raise exception 'Admins only.' using errcode = '42501'; end if;
  select * into v_row from public.household_onboarding_specialists where id = p_id;
  if v_row.id is null or v_row.ended_at is not null then raise exception 'Assignment not found or already ended.' using errcode = 'P0002'; end if;
  update public.household_onboarding_specialists set ended_at = now(), ended_by = auth.uid() where id = p_id;
  insert into public.audit_log (request_id, user_id, user_email, user_role, aal, source, module, command, tool_calls, result_summary, status)
  values (gen_random_uuid(), auth.uid(), v_me.email, v_me.role, auth.jwt() ->> 'aal', 'portal', 'onboarding-specialist', 'end',
          jsonb_build_array(jsonb_build_object('family_id', v_row.family_id, 'staff_id', v_row.staff_id, 'assignment_id', p_id)),
          'Onboarding access ended', 'ok');
  return jsonb_build_object('ended', true);
end; $$;

-- A household's assignments with names, for the admin panel (admins) or a specialist's own rows.
create or replace function public.onboarding_specialist_list(p_family_id uuid)
returns table(id uuid, staff_id uuid, staff_name text, staff_role text, assigned_by_name text, starts_at timestamptz,
              expires_at timestamptz, extended_count integer, ended_at timestamptz, live boolean)
language sql stable security definer set search_path to '' as $$
  select s.id, s.staff_id, coalesce(nullif(p.full_name, ''), p.email), p.role, coalesce(nullif(a.full_name, ''), a.email),
         s.starts_at, s.expires_at, s.extended_count, s.ended_at, (s.ended_at is null and s.expires_at > now())
    from public.household_onboarding_specialists s
    join public.user_profiles p on p.id = s.staff_id
    left join public.user_profiles a on a.id = s.assigned_by
   where s.family_id = p_family_id
     and (public.is_admin() or s.staff_id = auth.uid())
     and not (p_family_id = any (array(select public.hidden_family_ids())))
   order by (s.ended_at is null) desc, s.expires_at desc;
$$;

revoke execute on function public.onboarding_specialist_assign(uuid, uuid) from public, anon;
revoke execute on function public.onboarding_specialist_extend(uuid) from public, anon;
revoke execute on function public.onboarding_specialist_end(uuid) from public, anon;
revoke execute on function public.onboarding_specialist_list(uuid) from public, anon;
grant execute on function public.onboarding_specialist_assign(uuid, uuid) to authenticated;
grant execute on function public.onboarding_specialist_extend(uuid) to authenticated;
grant execute on function public.onboarding_specialist_end(uuid) to authenticated;
grant execute on function public.onboarding_specialist_list(uuid) to authenticated;
