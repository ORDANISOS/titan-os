-- ELIOT executive assistant, Phase 3: meeting agendas (and email triage/drafts, which need no table: mail is read
-- live from Outlook and drafts are saved in the person's own Outlook Drafts, never sent by ELIOT).
--
-- Agendas are the person's private prep notes. They are shown in ELIOT and can be saved to Outlook Drafts on request;
-- ELIOT never writes them into the meeting itself (editing a meeting can notify every attendee).
-- Only touches the assistant's own tables: two new columns with defaults and one new server-only table.

alter table public.eliot_ea_profiles
  add column if not exists agendas_on boolean not null default true,
  add column if not exists agenda_time text not null default '17:00' check (agenda_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

create table if not exists public.eliot_ea_agendas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_key   text not null,
  subject     text not null,
  starts_at   timestamptz not null,
  households  text[] not null default '{}',
  body        text not null,
  auto        boolean not null default false,   -- made by the day-before run, not on request
  created_at  timestamptz not null default now(),
  seen_at     timestamptz,
  unique (user_id, event_key)
);
create index if not exists eliot_ea_agendas_user_idx on public.eliot_ea_agendas (user_id, starts_at desc);
alter table public.eliot_ea_agendas enable row level security;
revoke all on public.eliot_ea_agendas from public, anon, authenticated;
grant select, insert, update, delete on public.eliot_ea_agendas to service_role;
