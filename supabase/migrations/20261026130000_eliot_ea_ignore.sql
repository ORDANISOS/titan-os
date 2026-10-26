-- ELIOT executive assistant: events to leave out of planning, meeting alerts and the week preview.
-- An event is ignored when its subject or one of its Outlook categories contains one of these words
-- (case-insensitive). Will's employees' timesheet ("Work Schedule") is the first entry, 2026-10-26.
-- Only touches the assistant's own table: one new column with a default.

alter table public.eliot_ea_profiles
  add column if not exists ignore_terms text[] not null default '{"Work Schedule"}';
