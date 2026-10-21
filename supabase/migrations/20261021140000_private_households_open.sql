-- Private households, phase 3 (2026-10-21): a fresh two-step code to open one, and an access log.
--
-- Phase 1 already limits a private household to the staff named on it. Phase 3 adds Will's "two-step
-- code each time": when a named staff member opens a private household in the portal, the app asks for a
-- fresh authenticator code (challengeAndVerify), then calls private_household_open(). That function checks
-- the session's own record of when the code was entered (the 'totp' entry in the JWT's amr claim) is less
-- than 5 minutes old, and writes the opening to audit_log. The portal shows the household only after that.
-- (The database rule from phase 1 is what keeps everyone else out; this step is the extra gate and the log
-- for the people who are allowed in.)
--
-- Functions only: no new tables, no grant changes beyond these functions.
--
-- Rollback:
--   drop function if exists public.private_household_check(uuid);
--   drop function if exists public.private_household_open(uuid);
--   drop function if exists public.private_household_access_log(uuid, integer);

-- Is this household private? Any signed-in staff member may ask about a household they can see; a private
-- household they are not named on is invisible to them anyway, so this never reveals one.
create or replace function public.private_household_check(p_family_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from public.household_privacy hp
                  where hp.family_id = p_family_id
                    and not (p_family_id = any (array(select public.hidden_family_ids()))));
$$;
revoke execute on function public.private_household_check(uuid) from public, anon;
grant execute on function public.private_household_check(uuid) to authenticated;

-- Open it: named staff only, with a two-step code entered in the last 5 minutes. Logged.
create or replace function public.private_household_open(p_family_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $$
declare v_me public.user_profiles; v_hp public.household_privacy; v_totp_at bigint; v_name text;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  select * into v_hp from public.household_privacy where family_id = p_family_id;
  if v_me.id is null or v_hp.family_id is null or not (auth.uid() = any (v_hp.viewers)) then
    raise exception 'Household not found.' using errcode = 'P0002';
  end if;
  select max((e ->> 'timestamp')::bigint) into v_totp_at
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as e
   where e ->> 'method' = 'totp';
  if v_totp_at is null or v_totp_at < extract(epoch from now())::bigint - 300 then
    raise exception 'Enter a fresh two-step code to open this household.' using errcode = '42501';
  end if;
  select name into v_name from public.families where id = p_family_id;
  insert into public.audit_log (request_id, user_id, user_email, user_role, aal, source, module, command, tool_calls, result_summary, status)
  values (gen_random_uuid(), auth.uid(), v_me.email, v_me.role, auth.jwt() ->> 'aal', 'portal', 'privacy-open',
          'open private household', jsonb_build_array(jsonb_build_object('family_id', p_family_id)),
          'Opened: ' || coalesce(v_name, p_family_id::text), 'ok');
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function public.private_household_open(uuid) from public, anon;
grant execute on function public.private_household_open(uuid) to authenticated;

-- Who opened it and when, and who changed its privacy. Named staff only.
create or replace function public.private_household_access_log(p_family_id uuid, p_limit integer default 30)
returns table(at timestamptz, who text, role text, action text)
language plpgsql stable security definer set search_path to ''
as $$
begin
  if not exists (select 1 from public.household_privacy hp where hp.family_id = p_family_id and auth.uid() = any (hp.viewers)) then
    raise exception 'Household not found.' using errcode = 'P0002';
  end if;
  return query
    select a.created_at, coalesce(nullif(p.full_name, ''), a.user_email), a.user_role,
           case a.module when 'privacy-open' then 'Opened' else a.result_summary end
      from public.audit_log a left join public.user_profiles p on p.id = a.user_id
     where a.module in ('privacy-open', 'privacy')
       and a.tool_calls @> jsonb_build_array(jsonb_build_object('family_id', p_family_id))
     order by a.created_at desc
     limit least(greatest(coalesce(p_limit, 30), 1), 200);
end; $$;
revoke execute on function public.private_household_access_log(uuid, integer) from public, anon;
grant execute on function public.private_household_access_log(uuid, integer) to authenticated;
