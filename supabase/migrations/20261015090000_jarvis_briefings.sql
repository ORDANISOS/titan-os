-- Jarvis scheduled briefings (3x a day), production.
--
-- 1. jarvis_briefings: one row per admin per briefing slot (e.g. "2026-10-15 12:00"). Written only by
--    hub-command with the service role. Each admin can read their own rows and mark them heard
--    (seen_at); nobody else can read them, and nobody can insert or delete from the app.
-- 2. A trigger secret generated INSIDE the database and kept in Vault. No person ever sees it.
--    jarvis_cron_ok() checks it and is callable only by the service role (hub-command).
-- 3. A pg_cron job every 30 minutes that calls hub-command with that secret. hub-command does
--    nothing except at the briefing times (default 8:00, 12:00, 17:00 Eastern, Mon-Fri).
--    The Authorization header carries the PUBLIC anon key (needed to pass the function gateway);
--    the secret is read from Vault at run time, so it never appears in the job definition.
--
-- Turn off: select cron.unschedule('jarvis-briefings');   (reversible; data stays)

create table if not exists public.jarvis_briefings (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  user_id        uuid not null,
  slot           text not null,              -- "YYYY-MM-DD HH:MM" Eastern
  slot_label     text,                       -- "12:00 PM"
  answer         text not null,              -- the spoken briefing
  display        jsonb,                      -- the on-screen table
  findings       jsonb not null default '[]'::jsonb,
  counts         jsonb not null default '{}'::jsonb,
  email_checked  boolean not null default false,
  seen_at        timestamptz,
  unique (user_id, slot)
);
create index if not exists jarvis_briefings_user_created_idx on public.jarvis_briefings (user_id, created_at desc);

alter table public.jarvis_briefings enable row level security;
drop policy if exists jarvis_briefings_own_read on public.jarvis_briefings;
create policy jarvis_briefings_own_read on public.jarvis_briefings
  for select to authenticated using (user_id = auth.uid());
drop policy if exists jarvis_briefings_own_seen on public.jarvis_briefings;
create policy jarvis_briefings_own_seen on public.jarvis_briefings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.jarvis_briefings from anon;
revoke insert, update, delete, truncate on public.jarvis_briefings from authenticated;
grant select on public.jarvis_briefings to authenticated;
grant update (seen_at) on public.jarvis_briefings to authenticated;

-- Trigger secret, generated in the database (never typed or shown).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'jarvis_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'jarvis_cron_secret', 'Jarvis scheduled-briefing trigger (pg_cron -> hub-command)');
  end if;
end $$;

create or replace function public.jarvis_cron_ok(p_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(length(p_secret) >= 32, false)
     and exists (select 1 from vault.decrypted_secrets where name = 'jarvis_cron_secret' and decrypted_secret = p_secret);
$$;
revoke execute on function public.jarvis_cron_ok(text) from public, anon, authenticated;
grant execute on function public.jarvis_cron_ok(text) to service_role;

-- Every 30 minutes; hub-command decides whether it's a briefing time.
select cron.unschedule('jarvis-briefings') where exists (select 1 from cron.job where jobname = 'jarvis-briefings');
select cron.schedule(
  'jarvis-briefings',
  '*/30 * * * *',
  $job$
  select net.http_post(
    url := 'https://xreeruxuwtmjhvvxvjts.supabase.co/functions/v1/hub-command',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZWVydXh1d3Rtamh2dnh2anRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3OTU0NjcsImV4cCI6MjEwNDM3MTQ2N30.dtijICgtiQVrPyliovzcLzAG5iiTNmzXcdq9KkWWMGk',
      'x-jarvis-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'jarvis_cron_secret')
    ),
    body := '{"scheduled": true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
