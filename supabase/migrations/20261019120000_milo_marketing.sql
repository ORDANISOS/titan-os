-- MILO (Marketing Intelligence, Leads & Outreach): the marketing team's console. A separate app
-- (repo ordanis-milo) with the same foundations as ELIOT; its back end lives here: the milo-command and
-- milo-social edge functions, these tables, and public.audit_log (rows with source = 'milo').
--
-- SECURITY
-- - Phase 1 is admins only (role 'admin' + MFA aal2), checked by the edge functions on every call.
-- - The browser never reads or writes the marketing tables directly. RLS is on with NO policies for
--   them, and authenticated/anon have no grants: every read and write goes through milo-command
--   (service role, after the admin + MFA check) and is written to audit_log. That keeps the door
--   shut for the later 'marketing' role: it will get only what milo-command chooses to return.
-- - Exceptions, same as ELIOT: each user reads their own briefings (and marks them heard) and their
--   own push subscriptions (and can delete them).
-- - Instagram/LinkedIn access tokens are stored ONLY in Vault. milo_social_accounts keeps the Vault
--   secret ids; the get/put helpers are callable by the service role only.
-- - Spend is a financial record: rows are never deleted, only voided (voided_at + reason).
--
-- NOTE for production: plain tables and functions work through execute_sql. The pg_cron job is
-- per environment and is NOT in this file; see docs/RUNBOOK-MILO.md.

-- ── Spend ledger ────────────────────────────────────────────────────────────────
create table if not exists public.milo_spend (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  kind            text not null check (kind in ('conference','other')),
  channel         text not null check (channel in ('conference','sponsorship','paid_social','paid_search','email','print',
                                                   'content','pr','agency','software','events','swag','other')),
  title           text not null check (length(title) between 1 and 200),   -- conference name or what was bought
  vendor          text check (length(vendor) <= 120),
  campaign        text check (length(campaign) <= 120),
  spend_date      date not null,                                           -- start date (conference) or invoice date
  end_date        date check (end_date is null or end_date >= spend_date),
  amount          numeric(12,2) not null check (amount >= 0 and amount < 10000000),
  -- Conference cost lines: {booth, sponsorship, travel, lodging, meals, swag, staff, shipping, other}
  breakdown       jsonb not null default '{}'::jsonb,
  city            text check (length(city) <= 120),
  leads           integer check (leads is null or leads between 0 and 1000000),
  meetings        integer check (meetings is null or meetings between 0 and 1000000),
  deals_won       integer check (deals_won is null or deals_won between 0 and 1000000),
  notes           text check (length(notes) <= 4000),
  via             text not null default 'form' check (via in ('form','voice','typed')),
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text check (length(void_reason) <= 300)
);
create index if not exists milo_spend_date_idx on public.milo_spend (spend_date desc) where voided_at is null;
create index if not exists milo_spend_channel_idx on public.milo_spend (channel, spend_date desc) where voided_at is null;

-- ── Budgets (per period; channel null = total marketing budget) ─────────────────────
create table if not exists public.milo_budgets (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  period_start    date not null,
  period_end      date not null check (period_end >= period_start),
  channel         text check (channel is null or channel in ('conference','sponsorship','paid_social','paid_search','email','print',
                                                             'content','pr','agency','software','events','swag','other')),
  amount          numeric(12,2) not null check (amount >= 0 and amount < 100000000),
  notes           text check (length(notes) <= 1000)
);
create unique index if not exists milo_budgets_period_channel_uq
  on public.milo_budgets (period_start, period_end, coalesce(channel, '*'));

-- ── Marketing pages (the ordanis-site pages, as plain text, for the assistant) ─────────
create table if not exists public.milo_pages (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  title           text not null check (length(title) <= 200),
  url             text check (length(url) <= 300),
  body            text not null check (length(body) <= 60000),
  content_hash    text,
  loaded_at       timestamptz not null default now(),
  loaded_by       text
);

-- ── Social accounts (Instagram, LinkedIn) ────────────────────────────────────────────
create table if not exists public.milo_social_accounts (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  platform           text not null check (platform in ('instagram','linkedin')),
  external_id        text not null check (length(external_id) <= 120),   -- IG user id / LinkedIn organization URN
  display_name       text check (length(display_name) <= 200),
  handle             text check (length(handle) <= 120),
  status             text not null default 'connected' check (status in ('connected','expired','error','disconnected')),
  token_secret_id    uuid,          -- Vault secret id of the access token (never the token itself)
  refresh_secret_id  uuid,          -- Vault secret id of the refresh token, when the platform issues one
  token_expires_at   timestamptz,
  scopes             text[] not null default '{}',
  connected_by       uuid,
  connected_at       timestamptz,
  last_sync_at       timestamptz,
  last_error         text check (length(last_error) <= 300),
  unique (platform, external_id)
);

create table if not exists public.milo_social_daily (
  account_id      uuid not null references public.milo_social_accounts(id) on delete cascade,
  day             date not null,
  followers       integer,
  follower_gain   integer,
  impressions     integer,
  reach           integer,
  engagements     integer,
  clicks          integer,
  profile_views   integer,
  page_views      integer,
  updated_at      timestamptz not null default now(),
  primary key (account_id, day)
);

create table if not exists public.milo_social_posts (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.milo_social_accounts(id) on delete cascade,
  external_id     text not null check (length(external_id) <= 200),
  posted_at       timestamptz,
  caption         text check (length(caption) <= 400),
  permalink       text check (length(permalink) <= 500),
  media_type      text check (length(media_type) <= 40),
  impressions     integer,
  reach           integer,
  likes           integer,
  comments        integer,
  shares          integer,
  saves           integer,
  clicks          integer,
  updated_at      timestamptz not null default now(),
  unique (account_id, external_id)
);
create index if not exists milo_social_posts_account_posted_idx on public.milo_social_posts (account_id, posted_at desc);

-- One-time OAuth "state" values (CSRF protection for the connect flow). Ten-minute life.
create table if not exists public.milo_oauth_states (
  state           text primary key check (length(state) between 32 and 128),
  created_at      timestamptz not null default now(),
  user_id         uuid not null,
  platform        text not null check (platform in ('instagram','linkedin')),
  return_to       text not null check (return_to ~ '^https?://[^/]+/?$' and length(return_to) <= 200)
);

-- ── Briefings and lock-screen notifications (same shape as ELIOT's) ───────────────────
create table if not exists public.milo_briefings (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  user_id        uuid not null,
  slot           text not null,              -- "YYYY-MM-DD weekly" Eastern
  slot_label     text,
  answer         text not null,
  display        jsonb,
  counts         jsonb not null default '{}'::jsonb,
  seen_at        timestamptz,
  unique (user_id, slot)
);
create index if not exists milo_briefings_user_created_idx on public.milo_briefings (user_id, created_at desc);

create table if not exists public.milo_push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  user_id          uuid not null,
  endpoint         text not null unique
                   check (length(endpoint) <= 1000
                          and endpoint ~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'),
  p256dh           text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth             text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  device_label     text check (length(device_label) <= 60),
  last_success_at  timestamptz,
  last_error       text check (length(last_error) <= 200)
);
create index if not exists milo_push_subscriptions_user_idx on public.milo_push_subscriptions (user_id, created_at desc);

-- ── Row-level security ───────────────────────────────────────────────────────────────
alter table public.milo_spend              enable row level security;
alter table public.milo_budgets            enable row level security;
alter table public.milo_pages              enable row level security;
alter table public.milo_social_accounts    enable row level security;
alter table public.milo_social_daily       enable row level security;
alter table public.milo_social_posts       enable row level security;
alter table public.milo_oauth_states       enable row level security;
alter table public.milo_briefings          enable row level security;
alter table public.milo_push_subscriptions enable row level security;

-- Server-only tables: no policies, no grants.
revoke all on public.milo_spend, public.milo_budgets, public.milo_pages, public.milo_social_accounts,
              public.milo_social_daily, public.milo_social_posts, public.milo_oauth_states
  from anon, authenticated;

-- The edge functions (milo-command, milo-social) read and write every MILO table as service_role.
-- Granted explicitly: from 2026-10-30 Supabase no longer auto-grants Data API access on new public tables.
grant select, insert, update, delete on public.milo_spend, public.milo_budgets, public.milo_pages,
  public.milo_social_accounts, public.milo_social_daily, public.milo_social_posts, public.milo_oauth_states,
  public.milo_briefings, public.milo_push_subscriptions
  to service_role;

drop policy if exists milo_briefings_own_read on public.milo_briefings;
create policy milo_briefings_own_read on public.milo_briefings
  for select to authenticated using (user_id = auth.uid());
drop policy if exists milo_briefings_own_seen on public.milo_briefings;
create policy milo_briefings_own_seen on public.milo_briefings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.milo_briefings from anon;
revoke insert, update, delete, truncate, references, trigger on public.milo_briefings from authenticated;
grant select on public.milo_briefings to authenticated;
grant update (seen_at) on public.milo_briefings to authenticated;

drop policy if exists milo_push_own_read on public.milo_push_subscriptions;
create policy milo_push_own_read on public.milo_push_subscriptions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists milo_push_own_delete on public.milo_push_subscriptions;
create policy milo_push_own_delete on public.milo_push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
revoke all on public.milo_push_subscriptions from anon;
revoke insert, update, truncate, references, trigger on public.milo_push_subscriptions from authenticated;
grant select, delete on public.milo_push_subscriptions to authenticated;

-- ── Vault helpers (service role only) ───────────────────────────────────────────────
-- Stores a token in Vault under a MILO-only name and returns its id. Re-using a name replaces it.
create or replace function public.milo_vault_put(p_name text, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if p_name !~ '^milo_social_[a-z0-9_:-]{1,100}$' then raise exception 'bad secret name'; end if;
  if p_secret is null or length(p_secret) < 10 or length(p_secret) > 8000 then raise exception 'bad secret'; end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    v_id := vault.create_secret(p_secret, p_name, 'MILO social connection token');
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
  return v_id;
end;
$$;

-- Reads a MILO token. Refuses any Vault secret that isn't a MILO social token.
create or replace function public.milo_vault_get(p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id and name like 'milo\_social\_%';
$$;

-- Removes a MILO token (on disconnect).
create or replace function public.milo_vault_drop(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where id = p_id and name like 'milo\_social\_%';
$$;

revoke execute on function public.milo_vault_put(text, text) from public, anon, authenticated;
revoke execute on function public.milo_vault_get(uuid) from public, anon, authenticated;
revoke execute on function public.milo_vault_drop(uuid) from public, anon, authenticated;
grant execute on function public.milo_vault_put(text, text) to service_role;
grant execute on function public.milo_vault_get(uuid) to service_role;
grant execute on function public.milo_vault_drop(uuid) to service_role;

-- ── Scheduled-run secret (generated in the database, never typed or shown) ─────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'milo_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'milo_cron_secret', 'MILO scheduled runs (pg_cron -> milo-command)');
  end if;
end $$;

create or replace function public.milo_cron_ok(p_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(length(p_secret) >= 32, false)
     and exists (select 1 from vault.decrypted_secrets where name = 'milo_cron_secret' and decrypted_secret = p_secret);
$$;
revoke execute on function public.milo_cron_ok(text) from public, anon, authenticated;
grant execute on function public.milo_cron_ok(text) to service_role;

-- ── Signups for marketing (totals only, never household names) ────────────────────────
-- New households per month, by plan and by how they arrived. Firm (enterprise) households are
-- counted separately because a firm brought them, not marketing. Service role only.
create or replace function public.milo_signup_totals(p_from date, p_to date)
returns table (month date, plan text, channel text, households bigint, monthly_value numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc('month', f.created_at at time zone 'America/New_York')::date as month,
         coalesce(f.plan, 'unknown') as plan,
         case when f.enterprise_id is not null then 'firm' else f.acquisition_channel end as channel,
         count(*) as households,
         coalesce(sum(pf.monthly_price), 0) as monthly_value
  from public.families f
  left join public.plan_features pf on pf.plan = f.plan
  where f.created_at >= p_from and f.created_at < (p_to + 1)
  group by 1, 2, 3
  order by 1, 2, 3;
$$;
revoke execute on function public.milo_signup_totals(date, date) from public, anon, authenticated;
grant execute on function public.milo_signup_totals(date, date) to service_role;
