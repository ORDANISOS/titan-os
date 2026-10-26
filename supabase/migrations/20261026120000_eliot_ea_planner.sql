-- ELIOT executive assistant, Phase 2: the planner ("plan my week") puts time for the person's work on their
-- Outlook calendar: their ELIOT team tasks, their households' tasks, bills and deadlines, and workflow steps
-- waiting on them. Proposed as one draft; one confirm books all the blocks (eliot_ea_drafts kind 'plan').
--
-- Only touches the assistant's own tables (created 2026-10-23, 20261023120000_eliot_ea_calendar): new
-- columns with defaults, a wider kind check on drafts, and one new server-only table.

-- 1. Work hours for task time (Eastern). Meetings and open-for-calls blocks are always left alone.
alter table public.eliot_ea_profiles
  add column if not exists work_start text not null default '09:00' check (work_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column if not exists work_end text not null default '17:00' check (work_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column if not exists work_days integer[] not null default '{1,2,3,4,5}',
  add column if not exists max_task_minutes integer not null default 240 check (max_task_minutes between 30 and 600);

-- 2. Drafts can now hold a whole plan.
alter table public.eliot_ea_drafts drop constraint if exists eliot_ea_drafts_kind_check;
alter table public.eliot_ea_drafts add constraint eliot_ea_drafts_kind_check check (kind in ('book', 'move', 'cancel', 'respond', 'plan'));

-- 3. Work already given calendar time, so the next plan doesn't book it twice.
create table if not exists public.eliot_ea_planned (
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_key    text not null,
  event_id    text,
  starts_at   timestamptz not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, item_key)
);
alter table public.eliot_ea_planned enable row level security;
revoke all on public.eliot_ea_planned from public, anon, authenticated;
grant select, insert, update, delete on public.eliot_ea_planned to service_role;
