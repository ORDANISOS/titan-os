-- ELIOT rename, Phase C step C4: finish the database switch.
--
-- After C3, hub-command and the app use only the eliot_* names, so the temporary aliases from C2 go:
--   views public.jarvis_briefings / public.jarvis_push_subscriptions, and function public.jarvis_cron_ok.
-- The scheduled job now sends the x-eliot-cron header and runs every 5 minutes, so team-task reminders
-- arrive within a few minutes of their time. Briefings still happen only at the briefing times
-- (hub-command decides), once per slot per admin.
-- Each part runs only if the object exists, so the file works on demo (no job) and production.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'eliot-briefings') then
    perform cron.unschedule('eliot-briefings');
    perform cron.schedule(
      'eliot-briefings',
      '*/5 * * * *',
      $job$
  select net.http_post(
    url := 'https://xreeruxuwtmjhvvxvjts.supabase.co/functions/v1/hub-command',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'x-eliot-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'eliot_cron_secret')
    ),
    body := '{"scheduled": true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
    );
  end if;
end $$;

drop view if exists public.jarvis_briefings;
drop view if exists public.jarvis_push_subscriptions;
drop function if exists public.jarvis_cron_ok(text);
notify pgrst, 'reload schema';
