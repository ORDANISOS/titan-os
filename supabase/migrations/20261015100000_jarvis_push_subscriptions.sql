-- Jarvis lock-screen notifications (Web Push), per admin device.
--
-- One row per device an admin turned notifications on for in Jarvis Settings. hub-command writes the
-- rows (service role) after checking admin + MFA, so every "turn on" / "turn off" is in audit_log.
-- Admins can see and remove only their own rows; the app cannot insert or change them directly.
--
-- The endpoint must be one of the browser push services (Apple, Google, Mozilla, Microsoft). hub-command
-- POSTs to it, so the allow-list stops a row from pointing the function at any other server.
-- Nothing secret is stored here: p256dh/auth are the device's public encryption key and a per-device
-- secret that only lets the holder encrypt messages TO that device (they are deleted with the row).
--
-- Turn off for everyone: delete from public.jarvis_push_subscriptions;   (devices simply stop getting alerts)

create table if not exists public.jarvis_push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  user_id          uuid not null,
  endpoint         text not null unique
                   check (length(endpoint) <= 1000
                          and endpoint ~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'),
  p256dh           text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth             text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  device_label     text check (length(device_label) <= 60),
  last_success_at  timestamptz,
  last_error       text check (length(last_error) <= 200)
);
create index if not exists jarvis_push_subscriptions_user_idx on public.jarvis_push_subscriptions (user_id, created_at desc);

alter table public.jarvis_push_subscriptions enable row level security;
drop policy if exists jarvis_push_own_read on public.jarvis_push_subscriptions;
create policy jarvis_push_own_read on public.jarvis_push_subscriptions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists jarvis_push_own_delete on public.jarvis_push_subscriptions;
create policy jarvis_push_own_delete on public.jarvis_push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
revoke all on public.jarvis_push_subscriptions from anon;
revoke insert, update, truncate, references, trigger on public.jarvis_push_subscriptions from authenticated;
grant select, delete on public.jarvis_push_subscriptions to authenticated;
