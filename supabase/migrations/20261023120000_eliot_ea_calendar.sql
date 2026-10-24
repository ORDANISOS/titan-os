-- ELIOT executive assistant, Phase 1: Outlook calendar, meeting alerts, week preview, bookable blocks.
--
-- Personal to the people switched on in eliot_ea_profiles (Will only, for now). Experts can be added later
-- by inserting a row; nothing else changes.
--
-- All five tables are server-only: RLS on, no policies, no grants to anon or authenticated. hub-command
-- reads and writes them with the service role after its admin + MFA check, and only ever for the caller's
-- own user_id. The Microsoft tokens are AES-GCM encrypted by hub-command with a function secret
-- (EA_TOKEN_KEY) before they are stored, so a database read alone does not reveal them.
--
-- Turn off for a person: update public.eliot_ea_profiles set enabled = false where user_id = '...';
-- Remove a calendar link: delete from public.eliot_ea_connections where user_id = '...';
--   (also remove ELIOT from the account at https://myaccount.microsoft.com > Apps & services)

-- 1. Who has the assistant, and their settings.
create table if not exists public.eliot_ea_profiles (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  enabled             boolean not null default false,   -- switched only by SQL, never from the app
  alerts_on           boolean not null default true,
  alert_minutes       integer not null default 15 check (alert_minutes between 1 and 120),
  week_preview_on     boolean not null default true,
  week_preview_dow    integer not null default 7 check (week_preview_dow between 1 and 7),  -- ISO weekday, 7 = Sunday
  week_preview_time   text not null default '18:00' check (week_preview_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- Times callers may be offered later (phone phase): [{"day":2,"start":"10:00","end":"12:00"}], Eastern.
  bookable_blocks     jsonb not null default '[]'::jsonb check (jsonb_typeof(bookable_blocks) = 'array'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 2. The Outlook (Microsoft 365) link. One per person.
create table if not exists public.eliot_ea_connections (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  provider            text not null default 'microsoft' check (provider = 'microsoft'),
  account_email       text,
  account_name        text,
  scopes              text,
  refresh_token_enc   text not null,
  access_token_enc    text,
  access_expires_at   timestamptz,
  connected_at        timestamptz not null default now(),
  last_sync_at        timestamptz,
  last_error          text
);

-- 3. Sign-in round trips in flight (state + PKCE verifier). Rows older than 10 minutes are ignored and swept.
create table if not exists public.eliot_ea_oauth_states (
  state               text primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  code_verifier       text not null,
  redirect_uri        text not null,
  created_at          timestamptz not null default now()
);

-- 4. Meeting alerts already sent, so each meeting alerts once (a moved meeting alerts again).
create table if not exists public.eliot_ea_alerts (
  user_id             uuid not null references auth.users(id) on delete cascade,
  event_key           text not null,
  kind                text not null default 'meeting',
  sent_at             timestamptz not null default now(),
  primary key (user_id, event_key, kind)
);
create index if not exists eliot_ea_alerts_sent_idx on public.eliot_ea_alerts (sent_at);

-- 5. Calendar changes Eliot has drafted (book, move, cancel, answer an invite). Nothing reaches Outlook until the
--    person confirms; the confirm runs exactly the stored draft, once, within 15 minutes, and is audit-logged.
create table if not exists public.eliot_ea_drafts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  kind                text not null check (kind in ('book', 'move', 'cancel', 'respond')),
  event_id            text,
  payload             jsonb not null default '{}'::jsonb,
  summary             jsonb not null default '{}'::jsonb,
  status              text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'discarded')),
  result              text,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '15 minutes',
  done_at             timestamptz
);
create index if not exists eliot_ea_drafts_user_idx on public.eliot_ea_drafts (user_id, created_at desc);

alter table public.eliot_ea_profiles      enable row level security;
alter table public.eliot_ea_connections   enable row level security;
alter table public.eliot_ea_oauth_states  enable row level security;
alter table public.eliot_ea_alerts        enable row level security;
alter table public.eliot_ea_drafts        enable row level security;

revoke all on public.eliot_ea_profiles, public.eliot_ea_connections, public.eliot_ea_oauth_states, public.eliot_ea_alerts, public.eliot_ea_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.eliot_ea_profiles, public.eliot_ea_connections, public.eliot_ea_oauth_states, public.eliot_ea_alerts, public.eliot_ea_drafts to service_role;

-- Switch it on for Will (no-op where his account doesn't exist).
insert into public.eliot_ea_profiles (user_id, enabled)
select id, true from auth.users where lower(email) = 'wperez@ordanisos.com'
on conflict (user_id) do update set enabled = true, updated_at = now();
