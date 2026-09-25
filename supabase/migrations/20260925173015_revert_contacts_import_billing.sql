-- Correction: Contacts Import (the phone Contact Picker "tap to import" shortcut for the
-- Household Members / Professional Network forms) was never meant to be a paid add-on. The
-- explicit product correction: the $5/month charge is, and only ever was, for a professional
-- getting their own portal login to view a client's account -- i.e. Business Partner Portal
-- Access (families.business_partner_seats_stripe_item_id / manage-business-partner), which is
-- unaffected by this migration and remains correctly priced.
--
-- Verified before dropping: no family currently has contacts_import_enabled=true or a
-- contacts_import_stripe_item_id set, so there is nothing live on Stripe to cancel first.
alter table families drop column if exists contacts_import_enabled;
alter table families drop column if exists contacts_import_stripe_item_id;
