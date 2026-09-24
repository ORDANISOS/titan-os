-- Tracks whether someone internally has actually reached out to a newly self-serve-signed-up
-- household to start onboarding. This is a safety net, not a duplicate of what already exists:
-- neither the automated welcome email nor, for Premier, the internal Expert-assignment
-- notification (see stripe-webhook/index.ts) confirms a human being actually followed up -- both
-- fire on their own regardless. The admin "Signups & Revenue" dashboard uses these two columns to
-- badge households as New/Overdue/Contacted and to count them per plan; App.jsx's "Mark as
-- Contacted" button is the only writer, so plain columns are enough -- no trigger needed, since
-- nothing else in the system should ever set these.
alter table families
  add column if not exists onboarding_contacted_at timestamptz,
  add column if not exists onboarding_contacted_by text;

comment on column families.onboarding_contacted_at is
  'When an admin/ops team member confirmed they personally reached out to this self-serve '
  'household to start onboarding. Null means still pending -- the "Signups & Revenue" dashboard '
  'treats it as overdue once more than 48 hours have passed since createdAt with this still null. '
  'Set only by the "Mark as Contacted" action in App.jsx (SignupsRevenueView).';

comment on column families.onboarding_contacted_by is
  'Email of whoever clicked "Mark as Contacted" for this household. Null until '
  'onboarding_contacted_at is set.';
