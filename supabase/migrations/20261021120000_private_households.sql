-- Private households, phase 1 (2026-10-21, Will's decision).
--
-- Some top clients want no other eyes on their household. A private household is visible only to:
--   * the household itself: its own client logins and the Business Partners it invited, and
--   * staff Will names for it (always including whoever makes it private), e.g. its ORDANIS Expert.
-- Everyone else on staff (other admins, Experts, Analysts, firm administrators) gets nothing back from
-- the database for that household, as if it did not exist.
--
-- How: one RESTRICTIVE row policy, "private_household", on every public table that carries family_id
-- (found at run time, so it covers whatever tables the database has), plus families itself and the
-- private documents bucket. Restrictive policies are ANDed with the existing ones, so this can only ever
-- take access away, never grant it.
--
-- Deliberate exceptions:
--   * user_profiles: staff rows reuse family_id for assignment, so only role='client' rows are hidden.
--   * enterprise_invoice_lines, enterprise_billing_events, enterprise_membership_events: a firm's billing
--     must stay complete and correct (Will was told counts/amounts still include a private household).
-- Server code running with the service role (no auth.uid()) is not affected; phase 2 filters the
-- behind-the-scenes paths (reports, ELIOT) explicitly. Phase 3 adds the two-step prompt and open log.
--
-- The privacy list itself is reached only through the two functions below (no direct table access).
--
-- Rollback (in this order):
--   do $$ declare r record; begin
--     for r in select schemaname, tablename from pg_policies where policyname = 'private_household' loop
--       execute format('drop policy %I on %I.%I', 'private_household', r.schemaname, r.tablename); end loop; end $$;
--   drop function if exists public.household_privacy_set(uuid, boolean, uuid[]);
--   drop function if exists public.household_privacy_status(uuid);
--   drop function if exists public.hidden_family_ids();
--   drop table if exists public.household_privacy;

create table if not exists public.household_privacy (
  family_id  uuid primary key references public.families(id) on delete cascade,
  viewers    uuid[] not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint household_privacy_viewers_max check (cardinality(viewers) <= 25)
);
alter table public.household_privacy enable row level security;
-- No policies for app roles: only the security-definer functions below read or change it.
revoke all on public.household_privacy from public, anon, authenticated;
grant select, insert, update, delete on public.household_privacy to service_role;

-- The private households the signed-in person may NOT see. Empty for server code (no auth.uid()).
create or replace function public.hidden_family_ids()
returns setof uuid
language sql stable security definer set search_path to ''
as $$
  with me as (select p.id, p.role, p.family_id from public.user_profiles p where p.id = auth.uid())
  select hp.family_id
    from public.household_privacy hp
   where auth.uid() is not null
     and not (auth.uid() = any (hp.viewers))
     and not exists (select 1 from me where me.role = 'client' and me.family_id = hp.family_id)
     and not exists (select 1 from me join public.family_partners fp on fp.user_id = me.id
                      where me.role = 'partner' and fp.family_id = hp.family_id);
$$;
revoke execute on function public.hidden_family_ids() from public, anon;
grant execute on function public.hidden_family_ids() to authenticated, service_role;

-- What an admin sees about a household's privacy. A private household an admin is not named on is not
-- visible to them at all, so for them this answers "not found".
create or replace function public.household_privacy_status(p_family_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_row public.household_privacy; v_viewers jsonb;
begin
  if not exists (select 1 from public.user_profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  select * into v_row from public.household_privacy where family_id = p_family_id;
  if not found then return jsonb_build_object('is_private', false, 'viewers', '[]'::jsonb); end if;
  if not (auth.uid() = any (v_row.viewers)) then raise exception 'Household not found.' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email), 'role', p.role)
                            order by p.full_name), '[]'::jsonb)
    into v_viewers from public.user_profiles p where p.id = any (v_row.viewers);
  return jsonb_build_object('is_private', true, 'viewers', v_viewers, 'updated_at', v_row.updated_at);
end; $$;
revoke execute on function public.household_privacy_status(uuid) from public, anon;
grant execute on function public.household_privacy_status(uuid) to authenticated;

-- Make a household private (with its viewer list), change the list, or make it ordinary again.
-- Admins only, from a session that passed two-step sign-in. Once private, only someone on the list can
-- change it -- another admin cannot quietly lift it. Whoever makes it private is always on the list.
-- Viewers must be staff (admin, Expert, Analyst). Every change is written to audit_log.
create or replace function public.household_privacy_set(p_family_id uuid, p_private boolean, p_viewers uuid[])
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $$
declare v_me public.user_profiles; v_cur public.household_privacy; v_list uuid[]; v_bad int; v_name text;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null or v_me.role <> 'admin' then raise exception 'Admins only.' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Sign in with your two-step code first.' using errcode = '42501';
  end if;
  select name into v_name from public.families where id = p_family_id;
  if v_name is null then raise exception 'Household not found.' using errcode = 'P0002'; end if;
  select * into v_cur from public.household_privacy where family_id = p_family_id;
  if found and not (auth.uid() = any (v_cur.viewers)) then
    raise exception 'Household not found.' using errcode = 'P0002';
  end if;

  if not p_private then
    delete from public.household_privacy where family_id = p_family_id;
  else
    v_list := array(select distinct x from unnest(coalesce(p_viewers, '{}'::uuid[]) || auth.uid()) as x where x is not null);
    select count(*) into v_bad from unnest(v_list) as x
     where not exists (select 1 from public.user_profiles p where p.id = x and p.role in ('admin', 'advisor', 'analyst')
                         and p.active is distinct from false);
    if v_bad > 0 then raise exception 'Only active ORDANIS staff (admins, Experts, Analysts) can be named.' using errcode = '22023'; end if;
    insert into public.household_privacy (family_id, viewers, updated_by, updated_at)
    values (p_family_id, v_list, auth.uid(), now())
    on conflict (family_id) do update set viewers = excluded.viewers, updated_by = excluded.updated_by, updated_at = now();
  end if;

  insert into public.audit_log (request_id, user_id, user_email, user_role, aal, source, module, command, tool_calls, result_summary, status)
  values (gen_random_uuid(), auth.uid(), v_me.email, v_me.role, auth.jwt() ->> 'aal', 'portal', 'privacy',
          case when p_private then 'set private household' else 'remove private household' end,
          jsonb_build_array(jsonb_build_object('family_id', p_family_id, 'viewers', to_jsonb(coalesce(v_list, '{}'::uuid[])))),
          case when p_private then 'Private: ' || v_name else 'No longer private: ' || v_name end, 'ok');

  return public.household_privacy_status(p_family_id);
end; $$;
revoke execute on function public.household_privacy_set(uuid, boolean, uuid[]) from public, anon;
grant execute on function public.household_privacy_set(uuid, boolean, uuid[]) to authenticated;

-- The policy on every table that carries family_id.
do $$
declare r record; v_using text;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      join pg_class k on k.relname = c.table_name and k.relnamespace = 'public'::regnamespace
     where c.table_schema = 'public' and c.column_name = 'family_id' and k.relrowsecurity
       and c.table_name not in ('enterprise_invoice_lines', 'enterprise_billing_events', 'enterprise_membership_events', 'household_privacy')
  loop
    v_using := case when r.table_name = 'user_profiles'
      then '(role is distinct from ''client'' or family_id is null or not (family_id = any (array(select public.hidden_family_ids()))))'
      else '(family_id is null or not (family_id = any (array(select public.hidden_family_ids()))))' end;
    execute format('drop policy if exists private_household on public.%I', r.table_name);
    execute format('create policy private_household on public.%I as restrictive for all to authenticated using %s with check %s',
                   r.table_name, v_using, v_using);
  end loop;
end $$;

drop policy if exists private_household on public.families;
create policy private_household on public.families as restrictive for all to authenticated
  using (not (id = any (array(select public.hidden_family_ids()))))
  with check (not (id = any (array(select public.hidden_family_ids()))));

-- Files in the private documents bucket live under <family_id>/...
drop policy if exists private_household_documents on storage.objects;
create policy private_household_documents on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'documents' or not (split_part(name, '/', 1) = any (array(select public.hidden_family_ids()::text))))
  with check (bucket_id <> 'documents' or not (split_part(name, '/', 1) = any (array(select public.hidden_family_ids()::text))));
