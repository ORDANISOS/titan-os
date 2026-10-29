-- Client Activity goes in each Expert's one daily email (2026-10-29, Will's decision).
--
-- send-task-reminders (daily, cron job send-task-reminders) sends each ORDANIS Expert ONE summary: task reminders,
-- bills they pay coming due, and the family changes logged in household_activity (migration 20261029100000) that
-- haven't been emailed yet. digested_at marks an activity row as sent, so nothing goes twice. A short-lived separate
-- client-activity-digest job is removed here if present.
--
-- Also: record names now cover portfolio accounts (institution), entity members (person_name) and lenders, which
-- have no name column. Same function as migration 20261029100000 otherwise.
--
-- Rollback: alter table public.household_activity drop column if exists digested_at;

alter table public.household_activity add column if not exists digested_at timestamptz;
create index if not exists household_activity_undigested on public.household_activity (created_at) where digested_at is null;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'client-activity-digest') then
    perform cron.unschedule('client-activity-digest');
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
            left(coalesce(nullif(v_row->>'name', ''), nullif(v_row->>'title', ''), nullif(v_row->>'institution', ''),
                          nullif(v_row->>'person_name', ''), nullif(v_row->>'lender', ''),
                          nullif(v_row->>'description', ''), nullif(v_row->>'address', ''),
                          nullif(v_row->>'file_name', ''), nullif(v_row->>'body', '')), 120),
            v_fields);
  exception when others then
    raise warning 'household activity not logged: %', sqlerrm;
  end;
  return null;
end; $$;
revoke execute on function public.log_household_activity() from public, anon, authenticated;
