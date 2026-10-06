-- Supports the self-serve plan upgrade/downgrade feature: an upgrade takes effect immediately
-- (families.plan is updated right away by change-subscription-plan), but a downgrade is scheduled
-- to take effect at the end of the current billing period (via a Stripe Subscription Schedule) so
-- a household never gives back value it already paid for. These three columns let the UI show
-- "downgrading to Core on Oct 18" before Stripe actually applies it, and let stripe-webhook clear
-- them once the scheduled phase change really happens (see syncFamilyFromSubscription).
alter table public.families
  add column if not exists pending_plan text,
  add column if not exists pending_plan_effective_at date,
  add column if not exists stripe_subscription_schedule_id text;

alter table public.families
  add constraint families_pending_plan_check
  check (pending_plan is null or pending_plan in ('basic','core','premier'));

comment on column public.families.pending_plan is
  'A downgrade already scheduled with Stripe but not yet in effect -- null the rest of the time. Set by change-subscription-plan, cleared by stripe-webhook once Stripe applies the scheduled phase change (or by an immediate upgrade that supersedes it).';
comment on column public.families.pending_plan_effective_at is
  'Calendar date the pending_plan takes effect (the current billing period''s end at the time the downgrade was scheduled). Null whenever pending_plan is null.';
comment on column public.families.stripe_subscription_schedule_id is
  'The Stripe Subscription Schedule managing a scheduled downgrade, so it can be released if the household upgrades again (or changes their mind) before it takes effect. Null when there is no pending change.';
