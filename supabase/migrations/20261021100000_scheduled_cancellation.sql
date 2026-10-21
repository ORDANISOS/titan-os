-- End-of-period cancellation (2026-10-21, Will's decision).
--
-- A household that cancels keeps full access until the end of the month it has paid for (no partial
-- refund, no new charge). Stripe holds the subscription with cancel_at_period_end; when the period ends,
-- Stripe ends the subscription and stripe-webhook archives the household (logins blocked, billing
-- stopped, data kept until Will chooses to purge). The family or an admin starts it through the
-- cancel-subscription function and can undo it until the date.
--
-- These columns are what the app shows ("your plan ends on ..."). Stripe stays the source of truth:
-- stripe-webhook rewrites cancel_at from the subscription on every subscription event, so a cancellation
-- scheduled or undone in the Stripe dashboard shows up too.
--
-- Columns only on an existing table: no new tables (no grants needed), RLS unchanged.
--
-- Rollback:
--   alter table public.families drop column if exists cancel_at, drop column if exists cancel_requested_at,
--     drop column if exists cancel_requested_by;

alter table public.families
  add column if not exists cancel_at            timestamptz,
  add column if not exists cancel_requested_at  timestamptz,
  add column if not exists cancel_requested_by  text;

alter table public.families drop constraint if exists families_cancel_requested_by_len;
alter table public.families add constraint families_cancel_requested_by_len
  check (cancel_requested_by is null or length(cancel_requested_by) <= 200);
