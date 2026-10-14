-- Command hub (/hub), Phase 1: audit log.
--
-- Every command spoken or typed into the hub is written here by the hub-command edge
-- function (service role), whether it succeeded, was refused, or failed. The log is
-- append-only: no role can update or delete a row, including the service role, because
-- an RIA's books and records must not be editable after the fact. Keep rows at least
-- five years.
--
-- Admins can read the log. Nobody can write to it from the browser.
--
-- NOTE for production: the trigger at the bottom is DDL that hangs through the MCP.
-- Run that part in the Supabase SQL editor (or wrapped in lock/statement timeouts).

create table if not exists public.audit_log (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  request_id      uuid not null default gen_random_uuid(),
  -- No foreign key to auth.users on purpose: the record must outlive the account.
  user_id         uuid,
  user_email      text,
  user_role       text,
  aal             text,                       -- 'aal1' or 'aal2' from the caller's token
  source          text not null default 'hub',
  module          text not null,              -- platform | demo | email | backup
  input_mode      text check (input_mode in ('voice','typed')),
  command         text not null,              -- the transcript exactly as sent
  tool_calls      jsonb not null default '[]'::jsonb,  -- [{name, input, ok, rows}]
  result_summary  text,
  status          text not null check (status in ('ok','denied','error','rate_limited')),
  error           text,
  model           text,
  user_agent      text,
  ip              text,
  environment     text                         -- 'demo' or 'production'
);

create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_user_created_idx on public.audit_log (user_id, created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated
  using (public.is_admin());

-- No insert/update/delete policies: only the service role (which bypasses RLS) inserts.
revoke all on public.audit_log from anon;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;

-- Append-only, for every role.
create or replace function public.audit_log_block_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

revoke execute on function public.audit_log_block_changes() from public, anon, authenticated;

drop trigger if exists audit_log_no_update_delete on public.audit_log;
create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_block_changes();

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_block_changes();
