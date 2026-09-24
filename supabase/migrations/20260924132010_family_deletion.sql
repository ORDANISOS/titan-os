-- Lets an admin honor a household's request to be removed from the platform. Two deliberate,
-- separate steps rather than one button:
--
--   1. ARCHIVE (archive-family edge function): immediate, reversible-in-spirit. Cancels the
--      Stripe subscription, disables the household's client login(s), and flags the family as
--      archived. Nothing is deleted -- every record stays in place. This is the action to take
--      the moment someone asks to leave.
--   2. PURGE (purge-family edge function, via the purge_family() RPC below): permanent, and only
--      possible on a family that is already archived. Actually erases the household's data.
--
-- Splitting it this way means a slip of the finger can only ever archive a family, never destroy
-- one -- and it gives whoever owns compliance/retention a deliberate checkpoint between "they
-- asked to leave" and "the data is gone for good" rather than having that decision made
-- implicitly by a single click.

alter table families
  add column if not exists archived_by text;

comment on column families.archived_by is
  'Email of the admin who archived this household (see families.archived_at). Null until archived.';

-- Survives the family row itself being purged later, so there is always a permanent record that
-- a deletion request was honored, when, and by whom -- even after nothing else about the
-- household remains in the database.
create table if not exists family_deletion_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  family_name text not null,
  customer_number integer,
  plan text,
  action text not null check (action in ('archived','purged')),
  reason text,
  performed_by text not null,
  performed_at timestamptz not null default now()
);

comment on table family_deletion_log is
  'Audit trail for family archive/purge actions (see archive-family and purge-family edge '
  'functions). Deliberately has no foreign key to families.id -- a purge removes the family row '
  'itself, and this log is the record that is supposed to survive that.';

alter table family_deletion_log enable row level security;

drop policy if exists "admins can read family deletion log" on family_deletion_log;
create policy "admins can read family deletion log" on family_deletion_log
  for select
  using (is_admin());

-- No insert/update/delete policy for any client role -- only the service-role key (used by the
-- archive-family / purge-family edge functions) can write to this table, which bypasses RLS
-- entirely. That is intentional: nothing short of those two server-side actions should ever be
-- able to write an entry here.

-- Runs the actual permanent deletion in one transaction so a family is never left half-purged.
-- SECURITY DEFINER + explicit revoke/grant below means this can only be invoked with the
-- service-role key from the purge-family edge function, never directly by an authenticated
-- client even if a future RLS change on one of these tables were misconfigured.
--
-- Deletion order matters: tasks/notes/deals/contacts/user_profiles all have family_id set to
-- SET NULL (not CASCADE) on families, specifically so that deleting a family never silently
-- deletes them -- that default protects against losing an internal contact's own record by
-- accident elsewhere in the app. A genuine purge has to override that default and remove them
-- outright, or they would be left behind as orphaned PII with no household to belong to. Every
-- other family_id relationship in the schema is already ON DELETE CASCADE, so deleting the
-- families row itself at the end takes care of everything else (properties, documents,
-- valuables, portfolio accounts, obligations, workflows, activity log, and so on).
--
-- user_profiles is the one exception that must NOT be blanket-deleted by family_id: that column
-- is reused by the internal "assign family" admin feature to scope an advisor/admin to a single
-- household, so a staff member's own account can carry this family's id too. Only role='client'
-- rows are the household's own self-serve login and get deleted outright; any advisor/admin row
-- just falls through to the family_id SET NULL default when the families row is deleted below --
-- unassigning them from a household that no longer exists, never deleting their account.
--
-- Storage objects (uploaded documents, note attachments) are NOT touched here -- Postgres
-- doesn't manage the storage bucket, so the purge-family edge function removes those first,
-- before calling this function.
create or replace function purge_family(target_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from tasks where family_id = target_family_id;
  delete from notes where family_id = target_family_id; -- cascades note_attachments
  delete from deals where family_id = target_family_id;
  delete from contacts where family_id = target_family_id;
  delete from user_profiles where family_id = target_family_id and role = 'client';
  delete from families where id = target_family_id; -- cascades every remaining family_id table
end;
$$;

revoke all on function purge_family(uuid) from public, anon, authenticated;
grant execute on function purge_family(uuid) to service_role;
