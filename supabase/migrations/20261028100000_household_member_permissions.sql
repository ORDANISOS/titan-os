-- Household users and what each may do (2026-10-28, Will's decisions).
--
-- A household has one PRIMARY family login and may add SECONDARY family logins (a spouse, an adult child). The
-- primary, or anyone they give "Manage users and billing", chooses for each secondary user:
--   perm_edit      add, change and remove the household's records
--   perm_upload    add files to CHRIS
--   perm_download  open and download CHRIS files (the list stays visible)
--   perm_manage    invite/remove users, change these permissions, change the plan, add a card
-- Seeing the household is always on. The primary always has everything. Family logins are free; Business Partner
-- seats (outside advisors) are unchanged and separate.
--
-- Existing households: the active family login that signed in most recently (else the earliest) becomes primary; every other existing family login keeps all four
-- permissions, so nothing changes for anyone today.
--
-- Enforced in the database, not only the screens:
--   * household_can(perm): true for anyone who is not a family login (staff are governed by their own rules) and
--     for the primary; otherwise the login's own flag.
--   * RESTRICTIVE insert/update/delete policies on the household record tables require 'edit'; reads unaffected.
--   * documents: adding a row needs 'upload'; changing or removing one needs 'upload' or 'edit'. Folders likewise.
--   * storage (documents bucket): reading a file needs 'download', adding one 'upload', changing/removing 'upload' or
--     'edit' -- except a person's own Private folder, which is always theirs.
--   * a family login cannot change household_role or the perm_* columns on any profile (its own included) except
--     through household_member_set(), which checks the caller.
-- Honest limit: with Download off, file names stay visible and the assistant can still use text it read from a file.
--
-- Rollback:
--   drop the policies named household_perm_* on public tables and household_perm_files on storage.objects;
--   drop trigger if exists user_profiles_protect_household on public.user_profiles; drop function public.protect_household_columns();
--   drop trigger if exists user_profiles_zz_household_role on public.user_profiles; drop function public.assign_household_role();
--   drop function if exists public.household_member_set(uuid, boolean, boolean, boolean, boolean);
--   drop function if exists public.household_can(text);
--   alter table public.user_profiles drop column if exists household_role, drop column if exists perm_edit,
--     drop column if exists perm_upload, drop column if exists perm_download, drop column if exists perm_manage;

alter table public.user_profiles
  add column if not exists household_role text,
  add column if not exists perm_edit boolean not null default true,
  add column if not exists perm_upload boolean not null default true,
  add column if not exists perm_download boolean not null default true,
  add column if not exists perm_manage boolean not null default true;
alter table public.user_profiles drop constraint if exists user_profiles_household_role_check;
alter table public.user_profiles add constraint user_profiles_household_role_check
  check (household_role is null or household_role in ('primary', 'member'));

-- Backfill: earliest family login per household = primary, the rest = member (all permissions on).
with ranked as (
  select p.id, row_number() over (partition by p.family_id order by (p.active is false), u.last_sign_in_at desc nulls last, u.created_at, p.id) rn
    from public.user_profiles p join auth.users u on u.id = p.id
   where p.role = 'client' and p.family_id is not null
)
update public.user_profiles p set household_role = case when r.rn = 1 then 'primary' else 'member' end
  from ranked r where r.id = p.id and p.household_role is null;

create or replace function public.household_can(p_perm text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((
    select case
      when p.role is distinct from 'client' then true
      when p.household_role = 'primary' then true
      when p_perm = 'edit' then p.perm_edit
      when p_perm = 'upload' then p.perm_upload
      when p_perm = 'download' then p.perm_download
      when p_perm = 'manage' then p.perm_manage
      else false end
    from public.user_profiles p where p.id = auth.uid()), true);
$$;
revoke execute on function public.household_can(text) from public, anon;
grant execute on function public.household_can(text) to authenticated, service_role;

-- Record tables: writes need 'edit'.
do $$
declare t text;
begin
  foreach t in array array['account_balances','cash_flow_events','cash_flow_payment_log','client_exceptions','contacts',
    'deadline_acks','deadlines','deals','entities','entity_members','family_contacts','loans','notes','obligations',
    'portfolio_accounts','properties','property_contacts','tasks','valuables','workflow_instance_steps','workflow_instances']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists household_perm_ins on public.%I', t);
    execute format('drop policy if exists household_perm_upd on public.%I', t);
    execute format('drop policy if exists household_perm_del on public.%I', t);
    execute format('create policy household_perm_ins on public.%I as restrictive for insert to authenticated with check (public.household_can(''edit''))', t);
    execute format('create policy household_perm_upd on public.%I as restrictive for update to authenticated using (public.household_can(''edit'')) with check (public.household_can(''edit''))', t);
    execute format('create policy household_perm_del on public.%I as restrictive for delete to authenticated using (public.household_can(''edit''))', t);
  end loop;
end $$;

-- Documents and folders: adding needs 'upload'; changing or removing needs 'upload' or 'edit'.
do $$
declare t text;
begin
  foreach t in array array['documents','document_folders','portfolio_documents'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists household_perm_ins on public.%I', t);
    execute format('drop policy if exists household_perm_upd on public.%I', t);
    execute format('drop policy if exists household_perm_del on public.%I', t);
    execute format('create policy household_perm_ins on public.%I as restrictive for insert to authenticated with check (public.household_can(''upload''))', t);
    execute format('create policy household_perm_upd on public.%I as restrictive for update to authenticated using (public.household_can(''upload'') or public.household_can(''edit'')) with check (public.household_can(''upload'') or public.household_can(''edit''))', t);
    execute format('create policy household_perm_del on public.%I as restrictive for delete to authenticated using (public.household_can(''upload'') or public.household_can(''edit''))', t);
  end loop;
end $$;

-- Files in the documents bucket. A person's own Private folder (<family>/private/<their id>/...) is always theirs.
drop policy if exists household_perm_files_read on storage.objects;
create policy household_perm_files_read on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'documents' or split_part(name, '/', 3) = auth.uid()::text or public.household_can('download'));
drop policy if exists household_perm_files_add on storage.objects;
create policy household_perm_files_add on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'documents' or split_part(name, '/', 3) = auth.uid()::text or public.household_can('upload'));
drop policy if exists household_perm_files_change on storage.objects;
create policy household_perm_files_change on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'documents' or split_part(name, '/', 3) = auth.uid()::text or public.household_can('upload') or public.household_can('edit'));
drop policy if exists household_perm_files_remove on storage.objects;
create policy household_perm_files_remove on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'documents' or split_part(name, '/', 3) = auth.uid()::text or public.household_can('upload') or public.household_can('edit'));

-- Nobody but an admin or server code changes roles/permissions directly (a profile's own row is otherwise editable).
create or replace function public.protect_household_columns()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() = 'service_role' or public.is_admin() or current_setting('ordanis.household_member_set', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.household_role := null;
    new.perm_edit := true; new.perm_upload := true; new.perm_download := true; new.perm_manage := true;
  else
    new.household_role := old.household_role;
    new.perm_edit := old.perm_edit; new.perm_upload := old.perm_upload;
    new.perm_download := old.perm_download; new.perm_manage := old.perm_manage;
  end if;
  return new;
end; $$;
revoke execute on function public.protect_household_columns() from public, anon, authenticated;
drop trigger if exists user_profiles_protect_household on public.user_profiles;
create trigger user_profiles_protect_household before insert or update on public.user_profiles
  for each row execute function public.protect_household_columns();

-- Every new family login gets a household role on its own: the household's first one is primary, later ones members
-- (sign-up, firm enroll and invites all create profiles; none has to remember to set it).
create or replace function public.assign_household_role()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.role = 'client' and new.family_id is not null and new.household_role is null then
    new.household_role := case when exists (select 1 from public.user_profiles x where x.family_id = new.family_id
                                              and x.role = 'client' and x.household_role = 'primary' and x.id <> new.id)
                               then 'member' else 'primary' end;
  end if;
  return new;
end; $$;
revoke execute on function public.assign_household_role() from public, anon, authenticated;
drop trigger if exists user_profiles_zz_household_role on public.user_profiles;
create trigger user_profiles_zz_household_role before insert or update on public.user_profiles
  for each row execute function public.assign_household_role();

-- Change a secondary user's permissions. Caller: an admin, or a family login of the same household that is primary or
-- has 'manage'. The primary can't be changed this way. (Turning someone's access off is done by the invite-client
-- function, which also blocks their sign-in.)
create or replace function public.household_member_set(p_user_id uuid, p_edit boolean, p_upload boolean,
                                                      p_download boolean, p_manage boolean)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_me public.user_profiles; v_t public.user_profiles;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  select * into v_t from public.user_profiles where id = p_user_id;
  if v_me.id is null or v_t.id is null or v_t.role <> 'client' then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if not (v_me.role = 'admin'
          or (v_me.role = 'client' and v_me.family_id = v_t.family_id and v_me.active is distinct from false
              and (v_me.household_role = 'primary' or v_me.perm_manage))) then
    raise exception 'Only the household''s primary user, or someone they allow to manage users, can do this.' using errcode = '42501';
  end if;
  if v_t.household_role = 'primary' then raise exception 'The primary user always has full access.' using errcode = '22023'; end if;
  if v_t.id = auth.uid() and v_me.role <> 'admin' then raise exception 'Ask the primary user to change your own access.' using errcode = '22023'; end if;
  perform set_config('ordanis.household_member_set', 'on', true);
  update public.user_profiles
     set perm_edit = p_edit, perm_upload = p_upload, perm_download = p_download, perm_manage = p_manage,
         household_role = coalesce(household_role, 'member')
   where id = p_user_id;
  perform set_config('ordanis.household_member_set', 'off', true);
  insert into public.audit_log (request_id, user_id, user_email, user_role, source, module, command, tool_calls, result_summary, status)
  values (gen_random_uuid(), auth.uid(), v_me.email, v_me.role, 'portal', 'household-users',
          'set permissions',
          jsonb_build_array(jsonb_build_object('family_id', v_t.family_id, 'user_id', p_user_id, 'edit', p_edit, 'upload', p_upload,
                                               'download', p_download, 'manage', p_manage)),
          coalesce(nullif(v_t.full_name, ''), v_t.email) || ': access updated', 'ok');
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function public.household_member_set(uuid, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.household_member_set(uuid, boolean, boolean, boolean, boolean) to authenticated;
