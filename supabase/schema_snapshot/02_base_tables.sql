-- ORDANIS production schema snapshot, part 2 of 3: base tables.
-- Source: the live catalog of production (xreeruxuwtmjhvvxvjts), captured 2026-10-06.
-- Covers the 26 tables that no migration file creates. Their columns reflect every
-- later migration too, so this is the table as it stands today, not as first created.
-- REFERENCE ONLY. Do not run this against production. See README.md in this folder.
--
-- Constraints, indexes, policies and triggers are in 03_base_constraints_policies.sql
-- because several foreign keys point at tables defined here or in migration files.
-- Column comments are not captured.

create extension if not exists pg_trgm with schema extensions;

create type public.subscription_state as enum
  ('active','past_due','final_notice','archived','cancelled');

create table if not exists public.activity_log (
  id uuid default gen_random_uuid() not null,
  family_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  created_at timestamp with time zone default now()
);

create table if not exists public.advisor_alert_log (
  id uuid default gen_random_uuid() not null,
  task_id uuid,
  family_id uuid,
  advisor_email text,
  sent_at timestamp with time zone default now()
);

create table if not exists public.cash_flow_events (
  id uuid default gen_random_uuid() not null,
  family_id uuid not null,
  event_type text not null,
  description text,
  amount numeric default 0 not null,
  frequency text default 'once'::text not null,
  start_date date not null,
  end_date date,
  tax_treatment text default 'ordinary'::text not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  direction text default 'income'::text,
  sort_order integer default 0,
  pcm_responsible boolean default false,
  paid boolean default false,
  paid_at timestamp with time zone,
  paid_by text,
  category text,
  property_id uuid,
  vendor_family_contact_id uuid,
  vendor_property_contact_id uuid,
  reminder_days integer default 7 not null,
  reminder_sent_for date,
  pcm_responsible_cleared_by_downgrade boolean default false not null
);

create table if not exists public.cash_flow_payment_log (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  family_id uuid,
  period date not null,
  paid boolean default false,
  paid_at timestamp with time zone,
  paid_by text,
  notes text,
  created_at timestamp with time zone default now()
);

create table if not exists public.contacts (
  id uuid default gen_random_uuid() not null,
  name text not null,
  company text,
  email text,
  phone text,
  type text default 'Individual'::text,
  tags text,
  created_at timestamp with time zone default now(),
  family_id uuid,
  dob date,
  address text,
  advisor_email text,
  advisor_name text,
  anniversary date,
  is_advisor boolean default false,
  is_primary boolean default false not null,
  is_secondary boolean default false not null,
  relationship text
);

create table if not exists public.deadline_acks (
  id uuid default gen_random_uuid() not null,
  family_id uuid,
  item_key text not null,
  item_label text,
  item_type text,
  occurrence_date date,
  completed_by text,
  completed_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

create table if not exists public.deadlines (
  id uuid default gen_random_uuid() not null,
  family_id uuid,
  property_id uuid,
  title text not null,
  due_date date not null,
  deadline_type text,
  priority text default 'medium'::text,
  completed boolean default false,
  notes text,
  created_at timestamp with time zone default now()
);

create table if not exists public.deals (
  id uuid default gen_random_uuid() not null,
  title text not null,
  contact_id uuid,
  value numeric,
  stage text default 'Lead'::text,
  close_date date,
  created_at timestamp with time zone default now(),
  family_id uuid,
  advisor_email text,
  advisor_name text
);

create table if not exists public.document_downloads (
  id uuid default gen_random_uuid() not null,
  document_id uuid not null,
  family_id uuid,
  downloaded_by text,
  downloaded_at timestamp with time zone default now() not null
);

create table if not exists public.document_folders (
  id uuid default gen_random_uuid() not null,
  family_id uuid not null,
  name text not null,
  sort_order integer,
  created_at timestamp with time zone default now() not null,
  created_by uuid
);

create table if not exists public.documents (
  id uuid default gen_random_uuid() not null,
  family_id uuid,
  property_id uuid,
  name text not null,
  doc_type text,
  file_path text,
  file_size bigint,
  mime_type text,
  expiry_date date,
  notes text,
  uploaded_by text,
  created_at timestamp with time zone default now(),
  category text default 'General'::text,
  description text,
  file_type text,
  extracted_text text,
  property_section text,
  account_id uuid,
  account_period text,
  superseded_by_id uuid
);

create table if not exists public.dunning_notices (
  id uuid default gen_random_uuid() not null,
  family_id uuid not null,
  notice_kind text not null,
  day_number integer not null,
  sent_to text,
  sent_at timestamp with time zone default now() not null,
  message_id text,
  send_error text
);

create table if not exists public.families (
  id uuid default gen_random_uuid() not null,
  name text not null,
  advisor text,
  color text default '#092b49'::text,
  notes text,
  created_at timestamp with time zone default now(),
  advisor_name text,
  advisor_email text,
  cash_flow_settings jsonb,
  assistant_name text,
  plan text default 'premier'::text not null,
  monthly_spend_cap numeric(10,2),
  subscription_state subscription_state default 'active'::subscription_state not null,
  past_due_since date,
  archived_at timestamp with time zone,
  export_ready_at timestamp with time zone,
  export_downloaded_at timestamp with time zone,
  stripe_customer_id text,
  stripe_subscription_id text,
  acquisition_channel text default 'advisor'::text not null,
  pending_plan text,
  pending_plan_effective_at date,
  stripe_subscription_schedule_id text,
  customer_number integer not null,
  onboarding_contacted_at timestamp with time zone,
  onboarding_contacted_by text,
  archived_by text,
  business_partner_seats_stripe_item_id text,
  domicile_state text,
  domicile_since date,
  prior_domicile_state text,
  storage_used_bytes bigint default 0 not null
);

create table if not exists public.family_contacts (
  id uuid default gen_random_uuid() not null,
  family_id uuid not null,
  name text not null,
  role text,
  company text,
  email text,
  phone text,
  is_advisor boolean default false,
  notes text,
  created_at timestamp with time zone default now()
);

create table if not exists public.family_partners (
  id uuid default gen_random_uuid() not null,
  family_id uuid not null,
  user_id uuid not null,
  created_at timestamp with time zone default now(),
  is_lead_advisor boolean default false not null,
  source text default 'admin'::text not null,
  invited_at timestamp with time zone default now() not null,
  email text,
  full_name text
);

create table if not exists public.note_attachments (
  id uuid default gen_random_uuid() not null,
  note_id uuid not null,
  name text not null,
  category text default 'General'::text not null,
  file_path text not null,
  file_size bigint,
  file_type text,
  uploaded_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.notes (
  id uuid default gen_random_uuid() not null,
  body text not null,
  contact_id uuid,
  created_at timestamp with time zone default now(),
  family_id uuid,
  updated_at timestamp with time zone
);

create table if not exists public.plan_features (
  plan text not null,
  label text not null,
  sort_order integer default 0 not null,
  can_obligations boolean default false not null,
  can_workflows boolean default false not null,
  can_bill_pay boolean default false not null,
  can_prompts boolean default false not null,
  can_resources boolean default false not null,
  has_expert boolean default false not null,
  storage_bytes bigint,
  retention_months integer,
  monthly_price numeric(10,2),
  self_serve boolean default false not null,
  notes text,
  updated_at timestamp with time zone default now() not null,
  expert_hours_included numeric(5,2) default 0 not null,
  expert_hourly_rate numeric(8,2),
  advisor_seats boolean default false not null,
  white_label boolean default false not null,
  tier_kind text,
  workflows_included integer,
  workflow_overage_price numeric(8,2),
  storage_overage_per_gb numeric(8,2),
  default_monthly_cap numeric(10,2),
  stripe_product_id text
);

create table if not exists public.portfolio_accounts (
  id uuid default gen_random_uuid() not null,
  family_id uuid,
  institution text not null,
  banker_name text,
  account_type text default 'Investment'::text,
  starting_balance numeric,
  current_balance numeric,
  notes text,
  created_at timestamp with time zone default now(),
  balance_as_of date,
  balance_source_document_id uuid,
  account_advisor_name text,
  account_advisor_phone text,
  account_advisor_email text,
  entity_id uuid
);

create table if not exists public.portfolio_documents (
  id uuid default gen_random_uuid() not null,
  account_id uuid,
  family_id uuid,
  name text not null,
  url text,
  file_type text,
  uploaded_at timestamp with time zone default now()
);

-- NOTE: production has a stray column literally named "Current Value" (capital letters and a
-- space) alongside the normal current_value. It is recorded here as it exists. Nothing in the
-- migrations creates it. Worth checking whether anything reads it before deciding to drop it.
create table if not exists public.properties (
  id uuid default gen_random_uuid() not null,
  family_id uuid,
  name text,
  address text,
  city text,
  state text,
  zip text,
  type text,
  estimated_value numeric(15,2),
  purchase_date date,
  status text default 'Active'::text,
  notes text,
  created_at timestamp with time zone default now(),
  "Current Value" numeric default '0'::numeric,
  owner_name text,
  property_type text,
  purchase_price numeric,
  current_value numeric,
  lender text,
  loan_balance numeric,
  interest_rate numeric,
  loan_payment numeric,
  loan_maturity_date date,
  loan_type text,
  rental_income numeric,
  property_taxes numeric,
  utilities numeric,
  insurance_company text,
  insurance_premium numeric,
  flood_insurance boolean default false,
  flood_insurance_company text,
  flood_insurance_premium numeric,
  hoa_fee numeric default 0,
  property_management_fee_pct numeric default 0,
  include_mortgage_in_cashflow boolean default true,
  sort_order integer,
  second_mortgage_balance numeric,
  second_mortgage_payment numeric,
  insurance_expiration date,
  flood_insurance_expiration date,
  entity_id uuid
);

create table if not exists public.property_contacts (
  id uuid default gen_random_uuid() not null,
  property_id uuid not null,
  family_id uuid,
  name text not null,
  role text,
  company text,
  email text,
  phone text,
  notes text,
  created_at timestamp with time zone default now()
);

create table if not exists public.scheduled_prompts (
  id uuid default gen_random_uuid() not null,
  owner_user_id uuid not null,
  owner_email text not null,
  owner_role text not null,
  name text not null,
  prompt_type text not null,
  template_key text,
  custom_prompt text,
  schedule_preset text not null,
  schedule_dow smallint,
  schedule_hour_utc smallint not null,
  active boolean default true not null,
  last_run_at timestamp with time zone,
  last_run_status text,
  last_run_error text,
  created_at timestamp with time zone default now() not null,
  family_id uuid,
  data_source text default 'internal'::text not null,
  category text
);

create table if not exists public.tasks (
  id uuid default gen_random_uuid() not null,
  title text not null,
  contact_id uuid,
  due_date date,
  priority text default 'Medium'::text,
  done boolean default false,
  created_at timestamp with time zone default now(),
  family_id uuid,
  reminder_days integer default 7,
  reminder_sent boolean default false,
  recurrence text,
  recurrence_interval integer,
  recurrence_unit text,
  completed_at timestamp with time zone,
  completed_by text
);

create table if not exists public.user_profiles (
  id uuid not null,
  email text not null,
  full_name text,
  role text default 'advisor'::text not null,
  active boolean default true,
  created_at timestamp with time zone default now(),
  family_id uuid,
  can_run_scheduled_prompts boolean default false not null,
  family_cap integer,
  partner_kind text,
  assistant_prompt_count integer default 0 not null
);

create table if not exists public.valuables (
  id uuid default gen_random_uuid() not null,
  family_id uuid,
  category text default 'Other'::text not null,
  description text not null,
  make_model text,
  year integer,
  estimated_value numeric,
  insured boolean default false,
  insurance_company text,
  notes text,
  created_at timestamp with time zone default now()
);
