-- ─────────────────────────────────────────────────────────────────────────────
-- Entities.
--
-- The platform has entity filing workflows and nothing to attach them to, so the
-- one fact those workflows need - which state an LLC is registered in - is not
-- recorded anywhere.
--
-- Companies and trusts live in ONE table. They share almost every field, and the
-- ownership chain crosses between them constantly: a trust owns an LLC that holds
-- a property. Splitting them would make the chain the hard case rather than the
-- normal one. What differs is the ROLE a person holds - member and manager versus
-- trustee and beneficiary - and that belongs on the membership row.
--
-- NOTE ON EINs: stored, because administering an entity requires it, but treated
-- as sensitive. There is deliberately NO field for a social security number. If a
-- grantor's SSN is ever needed it belongs in a document in the vault, under the
-- storage policies, not in a queryable column.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.entities (
  id                    uuid primary key default gen_random_uuid(),
  family_id             uuid not null references public.families(id) on delete cascade,
  name                  text not null,
  kind                  text not null,
  formation_state       text,
  formation_date        date,
  ein                   text,
  tax_classification    text,
  fiscal_year_end       text,
  status                text not null default 'active',
  dissolved_date        date,

  -- What the annual filing workflow actually needs
  registered_agent      text,
  registered_agent_address text,
  annual_report_due     date,
  annual_report_fee     numeric(10,2),
  state_filing_number   text,

  -- The ownership chain. A trust owns an LLC owns a property.
  parent_entity_id      uuid references public.entities(id) on delete set null,
  ownership_pct         numeric(6,3),

  principal_address     text,
  purpose               text,
  notes                 text,
  sort_order            integer,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint entities_kind_check check (kind in (
    'llc','lp','llp','lllp','s_corp','c_corp','partnership','sole_prop','dba',
    'revocable_trust','irrevocable_trust','ilit','grat','slat','crt','dynasty_trust',
    'charitable_foundation','donor_advised_fund','other')),
  constraint entities_status_check check (status in
    ('active','dissolved','administratively_dissolved','merged','pending','inactive')),
  constraint entities_state_check check (formation_state is null or formation_state ~ '^[A-Z]{2}$'),
  constraint entities_pct_check check (ownership_pct is null or (ownership_pct >= 0 and ownership_pct <= 100)),
  constraint entities_no_self_parent check (parent_entity_id is null or parent_entity_id <> id)
);

comment on table public.entities is
  'Companies and trusts for a household. formation_state is what the annual filing and trust workflows key on - it is the single most important field here.';
comment on column public.entities.ein is
  'Sensitive. Employer identification number. There is no SSN column by design; a grantor SSN belongs in a vault document, not a queryable field.';
comment on column public.entities.parent_entity_id is
  'Ownership chain. A trust owning an LLC owning a property is the normal shape, not the exception.';

create index if not exists entities_family_idx  on public.entities (family_id, status, name);
create index if not exists entities_parent_idx  on public.entities (parent_entity_id) where parent_entity_id is not null;
create index if not exists entities_state_idx   on public.entities (formation_state) where formation_state is not null;
create index if not exists entities_filing_idx  on public.entities (annual_report_due) where annual_report_due is not null;

alter table public.entities enable row level security;
drop policy if exists read_access  on public.entities;
drop policy if exists write_access on public.entities;
create policy read_access on public.entities for select to authenticated
  using (public.is_admin() or family_id in (select public.current_user_allowed_family_ids()));
create policy write_access on public.entities for all to authenticated
  using (public.is_admin() or (family_id in (select public.current_user_allowed_family_ids())
         and public.current_user_role() <> 'partner'))
  with check (public.is_admin() or (family_id in (select public.current_user_allowed_family_ids())
         and public.current_user_role() <> 'partner'));

-- Who holds what role in an entity. One table covers members, managers, trustees
-- and beneficiaries, because the difference is the role, not the structure.
create table if not exists public.entity_members (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  entity_id    uuid not null references public.entities(id) on delete cascade,
  contact_id   uuid,
  person_name  text,
  role         text not null,
  ownership_pct numeric(6,3),
  effective_from date,
  effective_to   date,
  notes        text,
  created_at   timestamptz not null default now(),
  constraint entity_members_role_check check (role in (
    'member','manager','managing_member','general_partner','limited_partner',
    'officer','director','shareholder',
    'grantor','trustee','co_trustee','successor_trustee','trust_protector',
    'beneficiary','contingent_beneficiary','registered_agent','other')),
  constraint entity_members_named check (contact_id is not null or coalesce(person_name,'') <> ''),
  constraint entity_members_pct_check check (ownership_pct is null or (ownership_pct >= 0 and ownership_pct <= 100))
);
create index if not exists entity_members_entity_idx on public.entity_members (entity_id, role);
create index if not exists entity_members_family_idx on public.entity_members (family_id);

alter table public.entity_members enable row level security;
drop policy if exists read_access  on public.entity_members;
drop policy if exists write_access on public.entity_members;
create policy read_access on public.entity_members for select to authenticated
  using (public.is_admin() or family_id in (select public.current_user_allowed_family_ids()));
create policy write_access on public.entity_members for all to authenticated
  using (public.is_admin() or (family_id in (select public.current_user_allowed_family_ids())
         and public.current_user_role() <> 'partner'))
  with check (public.is_admin() or (family_id in (select public.current_user_allowed_family_ids())
         and public.current_user_role() <> 'partner'));

-- What each entity holds. Additive and nullable - nothing existing breaks.
alter table public.properties        add column if not exists entity_id uuid references public.entities(id) on delete set null;
alter table public.portfolio_accounts add column if not exists entity_id uuid references public.entities(id) on delete set null;
create index if not exists properties_entity_idx on public.properties (entity_id) where entity_id is not null;
create index if not exists portfolio_accounts_entity_idx on public.portfolio_accounts (entity_id) where entity_id is not null;

comment on column public.properties.entity_id is
  'Which entity holds title. properties.owner_name is free text and cannot be joined on; this can.';

select 'entities' as created, count(*) from public.entities
union all select 'entity_members', count(*) from public.entity_members;