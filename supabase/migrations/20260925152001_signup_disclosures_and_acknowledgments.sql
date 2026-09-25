-- Versioned legal disclosure text shown at self-serve signup. is_draft=true marks placeholder
-- copy written by an engineering session (not counsel) so the checkbox + tracking mechanism
-- could be built and tested -- see SignupFlow.jsx's on-page DRAFT banner, which is driven by
-- this column, not hardcoded. Swap in reviewed text as a NEW version row (never edit body_html on
-- an existing version in place) so every past acknowledgment still points at the exact text that
-- person actually saw.
create table public.signup_disclosures (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('subscription_terms','sms_consent')),
  version integer not null,
  title text not null,
  body_html text not null,
  is_draft boolean not null default true,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (kind, version)
);
comment on table public.signup_disclosures is
  'Versioned legal disclosure text shown at self-serve signup (subscription auto-renewal terms, SMS/TCPA consent). public-signup requires the caller to have acknowledged the current (highest version) row of each kind before it creates the account.';

alter table public.signup_disclosures enable row level security;
create policy public_read on public.signup_disclosures for select using (true);
create policy admin_write on public.signup_disclosures for all using (public.is_admin()) with check (public.is_admin());

-- Audit trail: which disclosure text a specific person checked the box for, when, from where.
-- Inserted only by public-signup using the service role (no client insert/update policy at all --
-- there is nothing here for a client to write to). One row per signup that reached the
-- disclosures step and completed account creation.
create table public.signup_disclosure_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  email text not null,
  subscription_terms_disclosure_id uuid not null references public.signup_disclosures(id),
  sms_consent_disclosure_id uuid not null references public.signup_disclosures(id),
  ip_address text,
  user_agent text,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
comment on table public.signup_disclosure_acknowledgments is
  'Compliance record for TCPA/subscription-disclosure purposes: proves what a specific person agreed to and when. Written once, at account creation, by public-signup -- never updated afterward.';

alter table public.signup_disclosure_acknowledgments enable row level security;
create policy admin_read on public.signup_disclosure_acknowledgments for select using (public.is_admin());

-- Seed version 1 (draft) of each disclosure so the signup flow has something real to show and
-- record against immediately. Marked is_draft=true throughout -- see table comment.
insert into public.signup_disclosures (kind, version, title, body_html, is_draft) values
('subscription_terms', 1, 'Subscription Terms',
 '<p>By subscribing, you authorize us to charge the payment method on file on a recurring monthly basis, starting today, for the plan you selected, until you cancel. There is no fixed term and no early-termination fee.</p>' ||
 '<p>You may cancel at any time from your account''s Billing tab. Your subscription stays active through the end of the current billing period; we do not refund the unused portion of a period already paid for. Your documents and records remain available for you to download for a period after cancellation before removal, consistent with our data retention policy.</p>' ||
 '<p>If your plan includes a monthly allowance of workflow instances, additional workflow instances beyond that allowance are billed at the per-instance rate shown on your plan''s pricing page, up to the monthly overage cap shown in your account. We will never bill you past that cap without your separate approval.</p>' ||
 '<p>We may change these prices or terms on a going-forward basis with at least 30 days'' notice to the email on file.</p>',
 true),
('sms_consent', 1, 'SMS / Text Message Consent',
 '<p>By checking this box, you consent to receive text messages (SMS) from us at the mobile number you provide, including messages about your account, billing, and deadlines or obligations that need your attention. Message frequency varies; message and data rates may apply.</p>' ||
 '<p>Consent to receive text messages is not a condition of purchasing any service. You may opt out at any time by replying STOP to any message, or by contacting us directly; reply HELP for help. See our Privacy Policy and Terms of Service for more information.</p>',
 true);
