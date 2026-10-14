-- Daily allowance for client-sent email (send-advisor-email). That function sends to outside addresses
-- from the firm's verified domain; before 2026-10-14 it had no limit. Each successful send is logged here
-- and the function refuses past 20 per sender per rolling 24 hours.
-- Service-role only: RLS on, no policies, so no client can read or write it.

create table if not exists public.client_email_sends (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  family_id   uuid,
  recipients  integer not null default 1,
  created_at  timestamptz not null default now()
);
create index if not exists client_email_sends_user_time on public.client_email_sends (user_id, created_at desc);
alter table public.client_email_sends enable row level security;
revoke all on public.client_email_sends from anon, authenticated;

-- ROLLBACK: drop table if exists public.client_email_sends;  (only after rolling back send-advisor-email)
