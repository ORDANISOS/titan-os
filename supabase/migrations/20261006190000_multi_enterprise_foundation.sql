-- Multi-enterprise foundation (phase 2 of the ORDANIS Multi-Enterprise Plan).
--
-- Adds the tables, columns and helper functions that let one ORDANIS database serve many
-- firms ("enterprises"), each with its own skin, domain, signup code and contract terms.
--
-- This migration changes NO existing behaviour. Every new column starts NULL, no existing
-- policy is touched, and current_user_allowed_family_ids() is left exactly as it is (that
-- is phase 3). The only existing objects replaced are the two profile triggers, and only to
-- add enterprise_id to what a non-admin may not change.
--
-- The new "enterprise_admin" role needs no schema change: user_profiles.role has no CHECK
-- constraint. Nothing grants that role any access until phase 3.

-- ── helpers ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enterprises_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Enterprise signup codes: firm name (letters and digits, up to 12) + 6 random characters
-- from an alphabet without look-alikes (no 0/O, 1/I/L). 31^6 is about 887 million per
-- firm. Randomness comes from gen_random_uuid(), which is backed by a strong source.
create or replace function public.generate_enterprise_code(p_slug text)
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  suffix text := '';
  i int;
begin
  for i in 0..5 loop
    suffix := suffix || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return left(upper(regexp_replace(coalesce(p_slug, ''), '[^a-zA-Z0-9]+', '', 'g')), 12) || '-' || suffix;
end;
$$;
revoke all on function public.generate_enterprise_code(text) from public, anon, authenticated;

-- ── enterprises ─────────────────────────────────────────────────────────────────────────

create table public.enterprises (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(btrim(name)) > 0),
  slug                    text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  active                  boolean not null default true,
  -- The firm's skin. Skins are the existing brand_profiles rows, reused as they are.
  brand_profile_id        uuid references public.brand_profiles(id) on delete set null,
  -- Host name only, lower case, for example portal.accurateadvisory.com.
  domain                  text unique check (domain is null or domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
  -- Stored upper case. Looked up server-side; the browser's value is never trusted alone.
  signup_code             text not null unique check (signup_code = upper(signup_code)),
  signup_code_active      boolean not null default true,
  signup_code_rotated_at  timestamptz,
  default_expert_email    text,
  default_expert_set_by   uuid references public.user_profiles(id) on delete set null,
  default_expert_set_at   timestamptz,
  -- Contract terms.
  contract_signed_at      date,
  build_fee               numeric(12,2) check (build_fee is null or build_fee >= 0),
  build_fee_paid_at       date,
  maintenance_fee         numeric(12,2) check (maintenance_fee is null or maintenance_fee >= 0),
  maintenance_start_date  date,
  rebate_threshold        numeric(12,2) check (rebate_threshold is null or rebate_threshold >= 0),
  contract_notes          text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references public.user_profiles(id) on delete set null
);

create trigger enterprises_touch_updated_at
  before update on public.enterprises
  for each row execute function public.enterprises_touch_updated_at();

-- ── which enterprise a household and a user belong to ───────────────────────────────────

alter table public.families
  add column enterprise_id        uuid references public.enterprises(id) on delete restrict,
  add column joined_enterprise_at timestamptz,
  add column joined_via           text
    check (joined_via is null or joined_via in ('signup_code', 'client_join', 'admin_move', 'admin_created'));

alter table public.user_profiles
  add column enterprise_id uuid references public.enterprises(id) on delete restrict;

create index families_enterprise_id_idx      on public.families (enterprise_id);
create index user_profiles_enterprise_id_idx on public.user_profiles (enterprise_id);

-- ── role helpers (used by the policies below and by phase 3) ────────────────────────────

create or replace function public.current_user_enterprise_id()
returns uuid language sql stable security definer set search_path = public as $$
  select enterprise_id from public.user_profiles where id = auth.uid();
$$;

create or replace function public.is_enterprise_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid()
      and role = 'enterprise_admin'
      and enterprise_id is not null
      and active is not false
  );
$$;

revoke all on function public.current_user_enterprise_id() from public, anon;
revoke all on function public.is_enterprise_admin()        from public, anon;
grant execute on function public.current_user_enterprise_id() to authenticated;
grant execute on function public.is_enterprise_admin()        to authenticated;

-- ── protect the new columns ─────────────────────────────────────────────────────────────
-- Same pattern as the existing profile triggers: service_role and admins may change them,
-- nobody else. Without this an Expert (advisor role), who can write families rows, could
-- move a household into any enterprise.

create or replace function public.protect_sensitive_profile_columns()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    new.role := old.role;
    new.active := old.active;
    new.can_run_scheduled_prompts := old.can_run_scheduled_prompts;
    new.family_id := old.family_id;
    new.enterprise_id := old.enterprise_id;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_privilege_escalation()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not is_admin() then
    if new.role is distinct from old.role
       or new.family_id is distinct from old.family_id
       or new.enterprise_id is distinct from old.enterprise_id then
      raise exception 'Only admins can change role, family_id or enterprise_id';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_family_enterprise_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.enterprise_id is not null or new.joined_enterprise_at is not null or new.joined_via is not null then
      raise exception 'Only admins can place a household in an enterprise';
    end if;
  elsif new.enterprise_id is distinct from old.enterprise_id
     or new.joined_enterprise_at is distinct from old.joined_enterprise_at
     or new.joined_via is distinct from old.joined_via then
    raise exception 'Only admins can change a household''s enterprise';
  end if;
  return new;
end;
$$;

create trigger trg_protect_family_enterprise_columns
  before insert or update on public.families
  for each row execute function public.protect_family_enterprise_columns();

-- ── membership log (append-only) ────────────────────────────────────────────────────────
-- family_id and user_id are deliberately not foreign keys: the log must outlive a purged
-- household, and ON DELETE SET NULL would try to update an append-only table.

create table public.enterprise_membership_events (
  id                 uuid primary key default gen_random_uuid(),
  event_type         text not null check (event_type in
                       ('joined', 'moved', 'removed', 'code_rotated', 'default_expert_set', 'skin_linked', 'status_changed')),
  how                text check (how is null or how in ('signup_code', 'client_join', 'admin_move', 'admin_created')),
  family_id          uuid,
  family_name        text,
  user_id            uuid,
  from_enterprise_id uuid references public.enterprises(id),
  to_enterprise_id   uuid references public.enterprises(id),
  actor_id           uuid,
  actor_role         text,
  consent_recorded   boolean not null default false,
  consent_note       text,
  detail             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  -- A move the client did not make themselves needs the client's agreement on record.
  constraint enterprise_events_consent_chk
    check (how is null or how not in ('client_join', 'admin_move') or consent_recorded)
);
create index enterprise_events_to_idx     on public.enterprise_membership_events (to_enterprise_id, created_at desc);
create index enterprise_events_from_idx   on public.enterprise_membership_events (from_enterprise_id, created_at desc);
create index enterprise_events_family_idx on public.enterprise_membership_events (family_id);

create or replace function public.enterprise_events_block_change()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'enterprise_membership_events is append-only';
end;
$$;
create trigger enterprise_events_no_update_delete
  before update or delete on public.enterprise_membership_events
  for each row execute function public.enterprise_events_block_change();
create trigger enterprise_events_no_truncate
  before truncate on public.enterprise_membership_events
  for each statement execute function public.enterprise_events_block_change();

-- ── billing ledger (fed by the Stripe webhook in a later phase) ─────────────────────────

create table public.billing_ledger (
  id               uuid primary key default gen_random_uuid(),
  stripe_invoice_id text not null,
  stripe_line_id   text not null unique,
  family_id        uuid,
  enterprise_id    uuid references public.enterprises(id),
  period_month     date not null check (period_month = date_trunc('month', period_month)::date),
  amount           numeric(12,2) not null,
  currency         text not null default 'usd',
  line_type        text not null check (line_type in
                     ('plan', 'workflow_overage', 'storage', 'partner_seats', 'expert_hours', 'other')),
  paid_by          text not null default 'family' check (paid_by in ('family', 'enterprise')),
  description      text,
  paid_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index billing_ledger_enterprise_month_idx on public.billing_ledger (enterprise_id, period_month);
create index billing_ledger_family_month_idx     on public.billing_ledger (family_id, period_month);
create index billing_ledger_invoice_idx          on public.billing_ledger (stripe_invoice_id);

-- ── monthly snapshots (written by a scheduled job in a later phase) ─────────────────────

create table public.enterprise_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  enterprise_id        uuid references public.enterprises(id),   -- NULL = ORDANIS direct
  snapshot_month       date not null check (snapshot_month = date_trunc('month', snapshot_month)::date),
  households           integer not null default 0,
  households_with_data integer not null default 0,
  plan_mrr             numeric(14,2) not null default 0,
  usage_revenue        numeric(14,2) not null default 0,
  total_revenue        numeric(14,2) not null default 0,
  real_estate          numeric(16,2) not null default 0,
  debt                 numeric(16,2) not null default 0,
  portfolio            numeric(16,2) not null default 0,
  valuables            numeric(16,2) not null default 0,
  net_worth            numeric(16,2) not null default 0,
  created_at           timestamptz not null default now()
);
create unique index enterprise_snapshots_month_key
  on public.enterprise_snapshots (coalesce(enterprise_id, '00000000-0000-0000-0000-000000000000'::uuid), snapshot_month);

-- ── row-level security on the new tables ────────────────────────────────────────────────
-- Admins see everything. An enterprise admin sees only its own enterprise. Everyone else,
-- and anon, sees nothing. Writes to the log, ledger and snapshots come only from server-side
-- code (service role or SECURITY DEFINER functions), never from a browser session.

alter table public.enterprises                enable row level security;
alter table public.enterprise_membership_events enable row level security;
alter table public.billing_ledger             enable row level security;
alter table public.enterprise_snapshots       enable row level security;

revoke all on public.enterprises                from anon;
revoke all on public.enterprise_membership_events from anon;
revoke all on public.billing_ledger             from anon;
revoke all on public.enterprise_snapshots       from anon;
revoke insert, update, delete, truncate on public.enterprise_membership_events from authenticated;
revoke insert, update, delete, truncate on public.billing_ledger             from authenticated;
revoke insert, update, delete, truncate on public.enterprise_snapshots       from authenticated;

create policy enterprises_admin_all on public.enterprises
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy enterprises_own_select on public.enterprises
  for select to authenticated using (public.is_enterprise_admin() and id = public.current_user_enterprise_id());

create policy enterprise_events_admin_select on public.enterprise_membership_events
  for select to authenticated using (public.is_admin());
create policy enterprise_events_own_select on public.enterprise_membership_events
  for select to authenticated using (
    public.is_enterprise_admin()
    and (to_enterprise_id = public.current_user_enterprise_id() or from_enterprise_id = public.current_user_enterprise_id())
  );

create policy billing_ledger_admin_select on public.billing_ledger
  for select to authenticated using (public.is_admin());
create policy billing_ledger_own_select on public.billing_ledger
  for select to authenticated using (
    public.is_enterprise_admin() and enterprise_id = public.current_user_enterprise_id()
  );

create policy enterprise_snapshots_admin_select on public.enterprise_snapshots
  for select to authenticated using (public.is_admin());
create policy enterprise_snapshots_own_select on public.enterprise_snapshots
  for select to authenticated using (
    public.is_enterprise_admin() and enterprise_id = public.current_user_enterprise_id()
  );

-- ── one shared net worth formula ────────────────────────────────────────────────────────
-- Same rules the app uses on a household's own screen:
--   net worth = real estate - debt + portfolio + valuables
--   real estate = each property's current value, falling back to purchase price
--   debt        = first and second mortgage balances + any Line of Credit account
--   portfolio   = every account that is not a Line of Credit
-- Archived households are left out. Runs as the caller, so row-level security limits what
-- each role can total: an admin sees every household, others only their own.

create or replace function public.household_balance_sheet(p_family_id uuid default null)
returns table (
  family_id     uuid,
  enterprise_id uuid,
  real_estate   numeric,
  debt          numeric,
  portfolio     numeric,
  valuables     numeric,
  net_worth     numeric,
  has_data      boolean
)
language sql stable security invoker set search_path = public as $$
  with re as (
    select p.family_id,
           sum(coalesce(nullif(p.current_value, 0), nullif(p.purchase_price, 0), 0)) as value,
           sum(coalesce(p.loan_balance, 0) + coalesce(p.second_mortgage_balance, 0)) as mortgages
    from public.properties p
    group by p.family_id
  ),
  acct as (
    select a.family_id,
           sum(case when a.account_type = 'Line of Credit' then coalesce(a.current_balance, 0) else 0 end) as loc,
           sum(case when a.account_type is distinct from 'Line of Credit' then coalesce(a.current_balance, 0) else 0 end) as portfolio
    from public.portfolio_accounts a
    group by a.family_id
  ),
  val as (
    select v.family_id, sum(coalesce(v.estimated_value, 0)) as value
    from public.valuables v
    group by v.family_id
  )
  select f.id,
         f.enterprise_id,
         coalesce(re.value, 0),
         coalesce(re.mortgages, 0) + coalesce(acct.loc, 0),
         coalesce(acct.portfolio, 0),
         coalesce(val.value, 0),
         coalesce(re.value, 0) - (coalesce(re.mortgages, 0) + coalesce(acct.loc, 0))
           + coalesce(acct.portfolio, 0) + coalesce(val.value, 0),
         (re.family_id is not null or acct.family_id is not null or val.family_id is not null)
  from public.families f
  left join re   on re.family_id   = f.id
  left join acct on acct.family_id = f.id
  left join val  on val.family_id  = f.id
  where f.archived_at is null
    and (p_family_id is null or f.id = p_family_id);
$$;

-- ── one shared revenue calculation ──────────────────────────────────────────────────────
-- One row per enterprise plus an "ORDANIS direct" row (enterprise_id NULL), so the rows add
-- up to the platform. plan_mrr is list price for active and past-due households (what the
-- Signups tab computes today). The ledger columns show what Stripe actually billed in the
-- month; they are zero until the webhook starts writing the ledger. Runs as the caller.

create or replace function public.enterprise_revenue(p_month date default (date_trunc('month', now()))::date)
returns table (
  enterprise_id      uuid,
  enterprise_name    text,
  households         integer,
  billing_households integer,
  plan_mrr           numeric,
  plan_billed        numeric,
  usage_revenue      numeric,
  total_revenue      numeric,
  paid_by_firm       numeric,
  paid_by_families   numeric
)
language sql stable security invoker set search_path = public as $$
  with scopes as (
    select e.id as enterprise_id, e.name from public.enterprises e
    union all
    select null::uuid, 'ORDANIS direct' where public.is_admin()
  ),
  hh as (
    select f.enterprise_id,
           count(*)::int as households,
           (count(*) filter (where f.subscription_state in ('active', 'past_due')))::int as billing_households,
           coalesce(sum(pf.monthly_price) filter (where f.subscription_state in ('active', 'past_due')), 0) as plan_mrr
    from public.families f
    left join public.plan_features pf on pf.plan = f.plan
    where f.archived_at is null
    group by f.enterprise_id
  ),
  lg as (
    select l.enterprise_id,
           coalesce(sum(l.amount) filter (where l.line_type = 'plan'), 0) as plan_billed,
           coalesce(sum(l.amount) filter (where l.line_type <> 'plan'), 0) as usage_revenue,
           coalesce(sum(l.amount), 0) as total_revenue,
           coalesce(sum(l.amount) filter (where l.paid_by = 'enterprise'), 0) as paid_by_firm,
           coalesce(sum(l.amount) filter (where l.paid_by = 'family'), 0) as paid_by_families
    from public.billing_ledger l
    where l.period_month = date_trunc('month', p_month)::date
    group by l.enterprise_id
  )
  select s.enterprise_id,
         s.name,
         coalesce(hh.households, 0),
         coalesce(hh.billing_households, 0),
         coalesce(hh.plan_mrr, 0),
         coalesce(lg.plan_billed, 0),
         coalesce(lg.usage_revenue, 0),
         coalesce(lg.total_revenue, 0),
         coalesce(lg.paid_by_firm, 0),
         coalesce(lg.paid_by_families, 0)
  from scopes s
  left join hh on hh.enterprise_id is not distinct from s.enterprise_id
  left join lg on lg.enterprise_id is not distinct from s.enterprise_id
  order by (s.enterprise_id is null), s.name;
$$;

revoke all on function public.household_balance_sheet(uuid) from public, anon;
revoke all on function public.enterprise_revenue(date)      from public, anon;
grant execute on function public.household_balance_sheet(uuid) to authenticated;
grant execute on function public.enterprise_revenue(date)      to authenticated;

comment on table public.enterprises is
  'One row per firm served from this database. Skin = brand_profiles row; households and users point back here.';
comment on table public.enterprise_membership_events is
  'Append-only log of joins, moves, removals and admin actions for each enterprise.';
comment on table public.billing_ledger is
  'One row per paid Stripe invoice line, written by the Stripe webhook. Source of truth for revenue.';
comment on table public.enterprise_snapshots is
  'One row per enterprise (NULL = ORDANIS direct) per month, written by a scheduled job.';
