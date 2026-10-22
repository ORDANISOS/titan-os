-- Invite client (2026-10-22, Will's decision).
--
-- A household the team set up can now invite its client by email (invite-client function) instead of an admin
-- setting a password. When the household is to pay by card, invite-client sets billing_setup_required: the
-- client's portal asks for a card (create-checkout-session) until stripe-webhook records a subscription and
-- clears it. Written only by server functions (service role) and admins; clients cannot update families.
-- No new table, so no grant changes.
--
-- Rollback:
--   alter table public.families drop column if exists billing_setup_required;

alter table public.families add column if not exists billing_setup_required boolean not null default false;
