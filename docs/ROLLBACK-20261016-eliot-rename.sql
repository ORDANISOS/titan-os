-- ROLLBACK for migration 20261016100000_eliot_rename (Phase C step C2), production.
-- Puts every name back exactly as it was before C2. Use only if C2 misbehaves BEFORE step C3 is deployed.
-- (After C3, hub-command and the app use the eliot_* names; roll those back first.)
-- Run as one block in the SQL editor, or through execute_sql with lock/statement timeouts.

do $$
begin
  -- Scheduler: job, check function and vault entry back to the jarvis names.
  if to_regprocedure('public.eliot_cron_ok(text)') is not null then
    perform cron.unschedule('eliot-briefings') where exists (select 1 from cron.job where jobname = 'eliot-briefings');
    perform vault.update_secret(s.id, new_name => 'jarvis_cron_secret',
                                new_description => 'Jarvis scheduled-briefing trigger (pg_cron -> hub-command)')
      from vault.secrets s where s.name = 'eliot_cron_secret';
    execute $f$
      create or replace function public.jarvis_cron_ok(p_secret text)
      returns boolean language sql security definer set search_path = '' as $b$
        select coalesce(length(p_secret) >= 32, false)
           and exists (select 1 from vault.decrypted_secrets where name = 'jarvis_cron_secret' and decrypted_secret = p_secret);
      $b$ $f$;
    execute 'revoke execute on function public.jarvis_cron_ok(text) from public, anon, authenticated';
    execute 'grant execute on function public.jarvis_cron_ok(text) to service_role';
    execute 'drop function public.eliot_cron_ok(text)';
    perform cron.schedule(
      'jarvis-briefings',
      '*/30 * * * *',
      $job$
  select net.http_post(
    url := 'https://xreeruxuwtmjhvvxvjts.supabase.co/functions/v1/hub-command',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'x-jarvis-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'jarvis_cron_secret')
    ),
    body := '{"scheduled": true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
    );
  end if;

  -- Aliases off, tables back.
  execute 'drop view if exists public.jarvis_briefings';
  execute 'drop view if exists public.jarvis_push_subscriptions';
  if to_regclass('public.eliot_briefings') is not null then
    alter policy eliot_briefings_own_read on public.eliot_briefings rename to jarvis_briefings_own_read;
    alter policy eliot_briefings_own_seen on public.eliot_briefings rename to jarvis_briefings_own_seen;
    alter index public.eliot_briefings_user_created_idx rename to jarvis_briefings_user_created_idx;
    alter table public.eliot_briefings rename constraint eliot_briefings_user_id_slot_key to jarvis_briefings_user_id_slot_key;
    alter table public.eliot_briefings rename constraint eliot_briefings_pkey to jarvis_briefings_pkey;
    alter table public.eliot_briefings rename to jarvis_briefings;
  end if;
  if to_regclass('public.eliot_push_subscriptions') is not null then
    alter policy eliot_push_own_delete on public.eliot_push_subscriptions rename to jarvis_push_own_delete;
    alter policy eliot_push_own_read on public.eliot_push_subscriptions rename to jarvis_push_own_read;
    alter index public.eliot_push_subscriptions_user_idx rename to jarvis_push_subscriptions_user_idx;
    alter table public.eliot_push_subscriptions rename constraint eliot_push_subscriptions_last_error_check to jarvis_push_subscriptions_last_error_check;
    alter table public.eliot_push_subscriptions rename constraint eliot_push_subscriptions_device_label_check to jarvis_push_subscriptions_device_label_check;
    alter table public.eliot_push_subscriptions rename constraint eliot_push_subscriptions_auth_check to jarvis_push_subscriptions_auth_check;
    alter table public.eliot_push_subscriptions rename constraint eliot_push_subscriptions_p256dh_check to jarvis_push_subscriptions_p256dh_check;
    alter table public.eliot_push_subscriptions rename constraint eliot_push_subscriptions_endpoint_check to jarvis_push_subscriptions_endpoint_check;
    alter table public.eliot_push_subscriptions rename constraint eliot_push_subscriptions_endpoint_key to jarvis_push_subscriptions_endpoint_key;
    alter table public.eliot_push_subscriptions rename constraint eliot_push_subscriptions_pkey to jarvis_push_subscriptions_pkey;
    alter table public.eliot_push_subscriptions rename to jarvis_push_subscriptions;
  end if;
end $$;
notify pgrst, 'reload schema';
delete from supabase_migrations.schema_migrations where version = '20261016100000';
