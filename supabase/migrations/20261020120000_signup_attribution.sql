-- Signup attribution: which campaign / source brought a self-serve household.
--
-- Before this, families.acquisition_channel only said 'advisor' or 'self_serve', so MILO could only give a
-- BLENDED cost per signup. The /signup page now captures utm_source / utm_medium / utm_campaign /
-- utm_content from the landing address plus an optional "how did you hear about us" choice, carries them
-- through public-signup into the Stripe Checkout Session metadata, and stripe-webhook's
-- createFamilyFromSignup writes ONE row here when payment creates the household.
--
-- SECURITY
-- - RLS on. Admins may read (is_admin()); nobody else. No insert/update/delete policies and no grants for
--   anon/authenticated writes: only the service role (stripe-webhook) writes.
-- - Values are short marketing tags, never personal data. Every text column is length-checked here, and
--   public-signup drops any value that looks like an email address before it gets this far.
-- - MILO reads this only through milo_signup_by_campaign(), which returns TOTALS (no names, no ids).

create table if not exists public.signup_attribution (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null unique references public.families(id) on delete cascade,
  utm_source   text check (utm_source   is null or char_length(utm_source)   between 1 and 100),
  utm_medium   text check (utm_medium   is null or char_length(utm_medium)   between 1 and 100),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) between 1 and 150),
  utm_content  text check (utm_content  is null or char_length(utm_content)  between 1 and 150),
  heard_about  text check (heard_about  is null or heard_about in
                 ('search', 'social', 'podcast', 'conference', 'advisor', 'friend', 'email', 'press', 'other')),
  landing_path text check (landing_path is null or char_length(landing_path) between 1 and 200),
  created_at   timestamptz not null default now()
);

comment on table public.signup_attribution is
  'Marketing attribution for a self-serve signup (UTM tags + heard-about). Written only by stripe-webhook (service role). Admin read only. No personal data.';

alter table public.signup_attribution enable row level security;

revoke all on public.signup_attribution from public, anon, authenticated;
grant select on public.signup_attribution to authenticated;

drop policy if exists signup_attribution_admin_read on public.signup_attribution;
create policy signup_attribution_admin_read on public.signup_attribution
  for select to authenticated
  using (public.is_admin());

-- MILO: new households per campaign / source, TOTALS ONLY. Households with no attribution row (advisor- or
-- firm-created, or self-serve signups that arrived without tags) come back as campaign/source NULL so the
-- caller can show them as "not tagged". Same date window and month logic as milo_signup_totals().
create or replace function public.milo_signup_by_campaign(p_from date, p_to date)
returns table (campaign text, source text, medium text, heard_about text, channel text, households bigint, monthly_value numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select a.utm_campaign as campaign,
         a.utm_source   as source,
         a.utm_medium   as medium,
         a.heard_about  as heard_about,
         case when f.enterprise_id is not null then 'firm' else f.acquisition_channel end as channel,
         count(*) as households,
         coalesce(sum(pf.monthly_price), 0) as monthly_value
  from public.families f
  left join public.signup_attribution a on a.family_id = f.id
  left join public.plan_features pf on pf.plan = f.plan
  where f.created_at >= p_from and f.created_at < (p_to + 1)
  group by 1, 2, 3, 4, 5
  order by 6 desc, 1 nulls last, 2 nulls last;
$$;
revoke execute on function public.milo_signup_by_campaign(date, date) from public, anon, authenticated;
grant execute on function public.milo_signup_by_campaign(date, date) to service_role;
