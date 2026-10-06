-- Distinguishes households created by the public self-serve sign-up flow (public-signup ->
-- stripe-webhook's createFamilyFromSignup, after a Stripe Checkout payment succeeded) from
-- households created by an advisor/admin for an existing relationship. Needed so the admin
-- "Signups & Revenue" dashboard can report self-serve signups and MRR separately from the
-- platform total. Existing rows predate self-serve signup entirely, so they default (and
-- backfill) to 'advisor'.
alter table public.families
  add column if not exists acquisition_channel text not null default 'advisor';

alter table public.families
  add constraint families_acquisition_channel_check
  check (acquisition_channel in ('advisor','self_serve'));

comment on column public.families.acquisition_channel is
  'How this household entered the platform. self_serve = created by the public sign-up flow after a Stripe Checkout payment succeeded. advisor = created by an advisor/admin (create-checkout-session or manual). Set by stripe-webhook''s createFamilyFromSignup; every other insert path leaves the default.';
