-- Daily Client Activity email for the household's ORDANIS Expert (2026-10-29, Will's request).
--
-- The client-activity-digest function runs once a day from pg_cron (12:30 UTC, 8:30 am Eastern in summer). It takes
-- the family changes logged in household_activity (migration 20261029100000) that haven't been emailed yet, groups
-- them by the household's Expert (families.advisor_email), sends each Expert one email covering all their households,
-- then stamps digested_at so nothing is sent twice. Changes in a household with no Expert aren't emailed; only the
-- last 3 days are considered, so an Expert named later doesn't get a backlog.
--
-- Rollback:
--   select cron.unschedule('client-activity-digest');
--   alter table public.household_activity drop column if exists digested_at;

alter table public.household_activity add column if not exists digested_at timestamptz;
create index if not exists household_activity_undigested on public.household_activity (created_at) where digested_at is null;

-- The URL names the project, like the other cron jobs: production below; on demo use tkryueqzvgcigvxgjzsp.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'client-activity-digest') then
    perform cron.unschedule('client-activity-digest');
  end if;
  perform cron.schedule('client-activity-digest', '30 12 * * *', $cmd$
    select net.http_post(
      url     := 'https://xreeruxuwtmjhvvxvjts.supabase.co/functions/v1/client-activity-digest',
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body    := '{}'::jsonb);
  $cmd$);
end $$;
