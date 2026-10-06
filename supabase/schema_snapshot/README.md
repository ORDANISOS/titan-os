# Production schema snapshot

Captured 2026-10-06 from production (`xreeruxuwtmjhvvxvjts`, portal.ordanisos.com).

This folder records the parts of the production database that no migration file creates. Together with
`supabase/migrations/`, it describes everything that is live. It is **reference material, not a migration**:
it sits outside `migrations/` on purpose so that `supabase db push` never runs it against production.

## Why it exists

Production was built partly through the Supabase migration tracker and partly by running SQL directly.
The tracker's history was recovered into `supabase/migrations/` (20 files, commit `ecea275`). What the
tracker never saw is recorded here.

| File | Contents |
|---|---|
| `01_base_functions.sql` | 17 functions defined in no migration: the access helpers (`is_admin`, `current_user_role`, `current_user_allowed_family_ids`, ...), `handle_new_user`, `dunning_due`, the admin reports and the user directory. |
| `02_base_tables.sql` | 26 tables created before or outside the tracker, including `families`, `user_profiles`, `documents`, `contacts` and `dunning_notices`. Columns reflect later migrations too. |
| `03_base_constraints_policies.sql` | Constraints, indexes, row level security, policies, triggers, the `auth.users` trigger, the storage policies, and the scheduled jobs. |

## How it was checked

Every statement was compared with production's live catalog by fingerprint, not by eye.

| Part | Count | Result |
|---|---|---|
| Functions (`pg_get_functiondef`, byte-exact md5) | 17 | all match |
| Columns (name, type, nullability, default) | 350 | match |
| Constraints (`pg_get_constraintdef`) | 102 | match |
| Indexes | 42 | match |
| Table policies | 59 | match |
| Storage policies | 4 | match |
| Triggers in `public` | 11 | match |

The snapshot has **not** been replayed on a blank database. It is a faithful record, not a tested bootstrap.

## Not captured

- Column comments and table comments on the 26 tables.
- Table-level grants other than function execute grants.
- Row data of any kind.
- Storage bucket rows. The two buckets, `brand` (public) and `documents` (private), are noted in a comment.
- Supabase Auth settings, SMTP, email templates, Vault secrets and edge function secrets.
- Edge function source. It lives under `supabase/functions/`.

## Things worth knowing

**Credentials in cron.** Two production cron jobs embed a JWT in their command text, readable by anyone who
can query `cron.job`. The `run-scheduled-prompts` job carries the anon key, which is public by design. The
`send-task-reminders` job carries a **service-role key** in its `x-cron-secret` header. Both are left out of
`03_base_constraints_policies.sql`. The service-role key bypasses row level security, so it should live in
Supabase Vault and be read at run time, and it should be rotated because it has been written in plain text.

**A stray column.** `properties` has a column literally named `"Current Value"` (capital letters and a space)
next to the normal `current_value`. No migration creates it. Check whether anything reads it before dropping it.

**The empty migration.** `supabase/migrations/20260918999999_ordanis_platform_current_schema.sql` is zero
bytes and untracked. Nothing in it runs. It can be deleted.
