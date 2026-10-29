-- Client activity log for the household's ORDANIS team (2026-10-29, Will's decision).
--
-- Premier families can now edit the same records Basic and Core families can. So their Expert isn't surprised, every
-- add, change or removal made by a FAMILY login is written here and shown on the household's "Client Activity" tab.
-- Staff, firm and service-role writes are not logged (the trigger only acts for role = 'client').
--
-- What is kept: who, when, which kind of record, its name, and the NAMES of the fields that changed. Values are
-- deliberately not copied, so account numbers and the like never land in a second table.
--
-- Read: admins, and the household's Expert / Analyst / Onboarding Specialist (current_user_allowed_family_ids).
-- Families, partners and firm administrators can't read it. Nobody writes it directly: only the trigger does.
-- Logging can never block a family's save: any error inside the trigger is swallowed.
--
-- Rollback:
--   do $$ declare t text; begin foreach t in array array['properties','portfolio_accounts','account_balances','valuables',
--     'loans','cash_flow_events','cash_flow_payment_log','contacts','family_contacts','property_contacts','entities',
--     'entity_members','deals','tasks','notes','obligations','documents','document_folders'] loop
--     if to_regclass('public.' || t) is not null then
--       execute format('drop trigger if exists zz_household_activity on public.%I', t); end if; end loop; end $$;
--   drop function if exists public.log_household_activity();
--   drop table if exists public.household_activity;

create table if not exists public.household_activity (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  actor_id uuid,
  actor_name text,
  actor_email text,
  table_name text not null,
  action text not null check (action in ('added', 'changed', 'removed')),
  record_id text,
  record_label text,
  fields text[],
  created_at timestamptz not null default now()
);
create index if not exists household_activity_family_created on public.household_activity (family_id, created_at desc);

alter table public.household_activity enable row level security;
revoke all on public.household_activity from public, anon, authenticated;
grant select on public.household_activity to authenticated;
grant select, insert, update, delete on public.household_activity to service_role;

drop policy if exists household_activity_staff_read on public.household_activity;
create policy household_activity_staff_read on public.household_activity for select to authenticated
  using (public.is_admin()
         or (public.current_user_role() in ('advisor', 'analyst')
             and family_id in (select public.current_user_allowed_family_ids())));
-- Same two-factor rule as the household tables, where this database has it (production does; demo doesn't).
drop policy if exists mfa_required on public.household_activity;
do $$ begin
  if to_regprocedure('public.mfa_ok()') is not null then
    create policy mfa_required on public.household_activity as restrictive for all to authenticated
      using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
  end if;
end $$;

create or replace function public.log_household_activity()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_me public.user_profiles;
  v_old jsonb; v_new jsonb; v_row jsonb;
  v_fields text[]; v_fam uuid;
begin
  if auth.uid() is null then return null; end if;
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null or v_me.role is distinct from 'client' then return null; end if;
  begin
    if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
    if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
    v_row := coalesce(v_new, v_old);
    v_fam := nullif(v_row->>'family_id', '')::uuid;
    if v_fam is null then return null; end if;
    if tg_op = 'UPDATE' then
      -- Bookkeeping columns move on their own; a save that only touched those isn't a change worth showing.
      select array_agg(k order by k) into v_fields
        from jsonb_object_keys(v_new) k
       where k not in ('updated_at', 'created_at', 'sort_order', 'position', 'reminder_sent_for', 'notified_at',
                       'last_viewed_at', 'embedding', 'search_vector')
         and (v_new->k) is distinct from (v_old->k);
      if v_fields is null then return null; end if;
    end if;
    insert into public.household_activity (family_id, actor_id, actor_name, actor_email, table_name, action, record_id,
                                           record_label, fields)
    values (v_fam, v_me.id, nullif(btrim(v_me.full_name), ''), v_me.email, tg_table_name,
            case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'removed' end,
            v_row->>'id',
            left(coalesce(nullif(v_row->>'name', ''), nullif(v_row->>'title', ''), nullif(v_row->>'account_name', ''),
                          nullif(v_row->>'description', ''), nullif(v_row->>'address', ''),
                          nullif(v_row->>'file_name', ''), nullif(v_row->>'body', '')), 120),
            v_fields);
  exception when others then
    raise warning 'household activity not logged: %', sqlerrm;
  end;
  return null;
end; $$;
revoke execute on function public.log_household_activity() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['properties','portfolio_accounts','account_balances','valuables','loans','cash_flow_events',
    'cash_flow_payment_log','contacts','family_contacts','property_contacts','entities','entity_members','deals','tasks',
    'notes','obligations','documents','document_folders']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists zz_household_activity on public.%I', t);
    execute format('create trigger zz_household_activity after insert or update or delete on public.%I '
                   'for each row execute function public.log_household_activity()', t);
  end loop;
end $$;
