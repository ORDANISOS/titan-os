-- Self-serve "Business Partner" portal seats ($5/month each, Basic/Core only): a household adding
-- someone to its Professional Network can also grant them their own read-only login to this one
-- household's portal. This reuses the EXISTING partner mechanism (role='partner' on user_profiles,
-- the family_partners junction, PartnerDashboard's view-only rendering, partner_kind='professional'
-- which already exists for exactly this "CPA/attorney -- visibility only" case) rather than
-- building a parallel access system -- the only thing missing was a way for a HOUSEHOLD, not just
-- an admin, to create one of these links, plus billing for it.
--
-- IMPORTANT PRE-EXISTING FINDING: family_partners had row level security ENABLED but had ZERO
-- policies defined -- meaning, until this migration, only the service role could read or write it
-- at all. The Admin > Users "linked families" UI (loadFamilyPartners/togglePartnerFamily/
-- toggleLeadAdvisor in App.jsx) calls this table directly as the signed-in admin, so it has
-- actually been silently returning/writing nothing since it was built. Both the fix for that and
-- what this feature needs (a client reading their own family's rows) are the same two policies, so
-- they go in together here rather than as two separate changes.
create policy read_access on family_partners for select
  using (public.is_admin() or family_id in (select public.current_user_allowed_family_ids()));
create policy admin_write on family_partners for all
  using (public.is_admin()) with check (public.is_admin());
-- Deliberately NO client/partner write policy: every write for a household-sourced row goes
-- through manage-business-partner's service-role client, because creating the row requires first
-- creating (or finding) the underlying auth user and a real Stripe charge -- neither of which a
-- client-role INSERT could ever do on its own.

alter table family_partners add column if not exists source text not null default 'admin' check (source in ('admin','household'));
comment on column family_partners.source is
  '''admin'' = added by staff via Admin > Users (existing, free). ''household'' = the household itself invited this person as a paid Business Partner portal seat via manage-business-partner. Only ''household'' rows count toward, and are billed via, families.business_partner_seats_stripe_item_id.';
alter table family_partners add column if not exists invited_at timestamptz not null default now();
-- Denormalized so the household's own Household tab can show who each seat belongs to. A client
-- cannot read other users'' user_profiles rows (nor should they), so this is the only way that
-- screen can display an email/name without a service-role round trip on every render.
alter table family_partners add column if not exists email text;
alter table family_partners add column if not exists full_name text;

alter table families add column if not exists business_partner_seats_stripe_item_id text;
comment on column families.business_partner_seats_stripe_item_id is
  'Stripe subscription item id backing this household''s $5/month-per-seat Business Partner portal add-on. Quantity = count of family_partners rows for this family with source=''household''. Null when the household has zero such seats. Set only by manage-business-partner.';
