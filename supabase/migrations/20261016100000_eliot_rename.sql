-- ELIOT rename, Phase C step C2: database names jarvis_* -> eliot_*.
--
-- The assistant formerly called "Jarvis" is ELIOT (Executive Liaison for Inbox, Operations & Tasks).
-- Renames keep every row, right and row-level-security rule; Postgres renames in place.
--
-- So nothing breaks while code still uses the old names, this step also leaves TEMPORARY aliases:
--   views public.jarvis_briefings / public.jarvis_push_subscriptions (security_invoker, so the caller's
--   row-level security still applies), function public.jarvis_cron_ok (calls eliot_cron_ok), and the
--   scheduled job still sends the old x-jarvis-cron header. Step C4 (after hub-command and the app move to
--   the new names) drops the aliases and switches the header.
--
-- Each part only runs if the old object exists, so the same file works on demo (push table only) and production.
-- Run in three groups (1, 2, 3), each wrapped in lock/statement timeouts.

-- 1. Tables, their constraints, indexes and policies.
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'jarvis_briefings' and c.relkind = 'r') then
    alter table public.jarvis_briefings rename to eliot_briefings;
    alter table public.eliot_briefings rename constraint jarvis_briefings_pkey to eliot_briefings_pkey;
    alter table public.eliot_briefings rename constraint jarvis_briefings_user_id_slot_key to eliot_briefings_user_id_slot_key;
    alter index public.jarvis_briefings_user_created_idx rename to eliot_briefings_user_created_idx;
    alter policy jarvis_briefings_own_read on public.eliot_briefings rename to eliot_briefings_own_read;
    alter policy jarvis_briefings_own_seen on public.eliot_briefings rename to eliot_briefings_own_seen;
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'jarvis_push_subscriptions' and c.relkind = 'r') then
    alter table public.jarvis_push_subscriptions rename to eliot_push_subscriptions;
    alter table public.eliot_push_subscriptions rename constraint jarvis_push_subscriptions_pkey to eliot_push_subscriptions_pkey;
    alter table public.eliot_push_subscriptions rename constraint jarvis_push_subscriptions_endpoint_key to eliot_push_subscriptions_endpoint_key;
    alter table public.eliot_push_subscriptions rename constraint jarvis_push_subscriptions_endpoint_check to eliot_push_subscriptions_endpoint_check;
    alter table public.eliot_push_subscriptions rename constraint jarvis_push_subscriptions_p256dh_check to eliot_push_subscriptions_p256dh_check;
    alter table public.eliot_push_subscriptions rename constraint jarvis_push_subscriptions_auth_check to eliot_push_subscriptions_auth_check;
    alter table public.eliot_push_subscriptions rename constraint jarvis_push_subscriptions_device_label_check to eliot_push_subscriptions_device_label_check;
    alter table public.eliot_push_subscriptions rename constraint jarvis_push_subscriptions_last_error_check to eliot_push_subscriptions_last_error_check;
    alter index public.jarvis_push_subscriptions_user_idx rename to eliot_push_subscriptions_user_idx;
    alter policy jarvis_push_own_read on public.eliot_push_subscriptions rename to eliot_push_own_read;
    alter policy jarvis_push_own_delete on public.eliot_push_subscriptions rename to eliot_push_own_delete;
  end if;
end $$;

-- 2. Temporary aliases under the old names (dropped in C4). Same rights as the tables they stand for.
do $$
begin
  if to_regclass('public.eliot_briefings') is not null then
    execute 'create or replace view public.jarvis_briefings with (security_invoker = true) as select * from public.eliot_briefings';
    execute 'revoke all on public.jarvis_briefings from public, anon, authenticated';
    execute 'grant select on public.jarvis_briefings to authenticated';
    execute 'grant update (seen_at) on public.jarvis_briefings to authenticated';
    execute 'grant select, insert, update, delete on public.jarvis_briefings to service_role';
  end if;
  if to_regclass('public.eliot_push_subscriptions') is not null then
    execute 'create or replace view public.jarvis_push_subscriptions with (security_invoker = true) as select * from public.eliot_push_subscriptions';
    execute 'revoke all on public.jarvis_push_subscriptions from public, anon, authenticated';
    execute 'grant select, delete on public.jarvis_push_subscriptions to authenticated';
    execute 'grant select, insert, update, delete on public.jarvis_push_subscriptions to service_role';
  end if;
end $$;
notify pgrst, 'reload schema';

-- 3. Scheduler: check function, vault entry and job, switched together (production only).
--    The vault value is unchanged: its encryption is tied to the entry's id, not its name.
do $$
begin
  if to_regprocedure('public.jarvis_cron_ok(text)') is null then
    return;
  end if;
  perform vault.update_secret(s.id, new_name => 'eliot_cron_secret',
                              new_description => 'ELIOT scheduled-briefing trigger (pg_cron -> hub-command)')
    from vault.secrets s where s.name = 'jarvis_cron_secret';

  execute $f$
    create or replace function public.eliot_cron_ok(p_secret text)
    returns boolean language sql security definer set search_path = '' as $b$
      select coalesce(length(p_secret) >= 32, false)
         and exists (select 1 from vault.decrypted_secrets where name = 'eliot_cron_secret' and decrypted_secret = p_secret);
    $b$ $f$;
  execute 'revoke execute on function public.eliot_cron_ok(text) from public, anon, authenticated';
  execute 'grant execute on function public.eliot_cron_ok(text) to service_role';
  -- temporary alias (C4 drops it)
  execute $f$
    create or replace function public.jarvis_cron_ok(p_secret text)
    returns boolean language sql security definer set search_path = '' as $b$ select public.eliot_cron_ok(p_secret); $b$ $f$;

  perform cron.unschedule('jarvis-briefings') where exists (select 1 from cron.job where jobname = 'jarvis-briefings');
  perform cron.unschedule('eliot-briefings') where exists (select 1 from cron.job where jobname = 'eliot-briefings');
  perform cron.schedule(
    'eliot-briefings',
    '*/30 * * * *',
    $job$
  select net.http_post(
    url := 'https://xreeruxuwtmjhvvxvjts.supabase.co/functions/v1/hub-command',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'x-jarvis-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'eliot_cron_secret')
    ),
    body := '{"scheduled": true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
  );
end $$;
