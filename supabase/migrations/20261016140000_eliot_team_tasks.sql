-- ELIOT team tasks: the ORDANIS team's own task list, with optional phone reminders.
--
-- Internal only. This is NOT the household's portal `tasks` list (clients see that one and it feeds the
-- client reminder emails). A team task may point at a household (family_id) for context; the household
-- never sees it.
--
-- Admins with MFA (aal2) can read the list. Nobody writes from the browser: hub-command adds, edits and
-- completes tasks with the service role after checking admin + MFA, and writes every change to audit_log.
-- Reminders: hub-command's scheduled run sends a lock-screen alert to the task owner's devices when
-- remind_at passes (counts only, never the task text or household name), then stamps reminder_sent_at.

create table if not exists public.eliot_team_tasks (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid not null,
  owner_id          uuid not null,
  title             text not null check (length(btrim(title)) between 1 and 300),
  notes             text check (length(notes) <= 2000),
  family_id         uuid references public.families(id) on delete set null,
  due_date          date,
  priority          text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  remind_at         timestamptz,
  reminder_sent_at  timestamptz,
  done              boolean not null default false,
  done_at           timestamptz,
  done_by           uuid
);
create index if not exists eliot_team_tasks_owner_idx on public.eliot_team_tasks (owner_id, done, due_date);
create index if not exists eliot_team_tasks_reminder_idx on public.eliot_team_tasks (remind_at)
  where remind_at is not null and reminder_sent_at is null and not done;

alter table public.eliot_team_tasks enable row level security;
drop policy if exists eliot_team_tasks_admin_read on public.eliot_team_tasks;
create policy eliot_team_tasks_admin_read on public.eliot_team_tasks
  for select to authenticated using (public.is_admin() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2');
revoke all on public.eliot_team_tasks from anon;
revoke insert, update, delete, truncate, references, trigger on public.eliot_team_tasks from authenticated;
grant select on public.eliot_team_tasks to authenticated;
