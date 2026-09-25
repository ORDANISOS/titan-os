-- Household Members + Professional Network onboarding-wizard steps, and the phone-contacts
-- "tap to import" convenience that goes with them.
--
-- `contacts` already IS the Household Members table (family members) and `family_contacts`
-- already IS the Professional Network table (outside professionals: CPA, attorney, etc.) -- both
-- pre-date this migration and already have client-writable RLS (write_access ALL, any non-partner
-- family member). Nothing new is needed on either table except a label field for the wizard's
-- Household Members step to show "Spouse" / "Child" / etc. next to a name.
alter table contacts add column if not exists relationship text;
comment on column contacts.relationship is
  'Free-text relationship to the household principal (Spouse, Child, Parent, ...) -- set by the household itself from the onboarding wizard or the Household tab. Distinct from contacts.type (Individual/Business), which is unrelated.';

-- The $5/month "Contacts Import" add-on: lets a self-serve household use the wizard's phone
-- Contact Picker button (tap a name -> autopopulate the Household Members / Professional Network
-- form) instead of typing everything by hand. Manual entry via the QuickForm stays free always --
-- this only gates the import shortcut.
--
-- Both columns are written ONLY by the toggle-contacts-import edge function (via its service-role
-- client): families' own RLS (family_scoped_write) already does not grant client-role UPDATE on
-- this table at all today (only admin/advisor), so there is nothing extra to lock down here -- a
-- client cannot flip these by calling supabase.from('families').update(...) directly, only
-- through that function, which is what actually creates/removes the matching Stripe subscription
-- item. If that RLS policy is ever loosened to allow client self-updates on other family columns,
-- these two should get an explicit column-level protection at that time.
alter table families add column if not exists contacts_import_enabled boolean not null default false;
alter table families add column if not exists contacts_import_stripe_item_id text;
comment on column families.contacts_import_enabled is
  'True while this household is paying the $5/month Contacts Import add-on (phone Contact Picker autopopulate in the onboarding wizard / Household tab). Set only by toggle-contacts-import.';
comment on column families.contacts_import_stripe_item_id is
  'The Stripe subscription item id backing the $5/month Contacts Import add-on charge on this household''s subscription, so it can be removed later. Null when the add-on is off. Set only by toggle-contacts-import.';
