-- Phase 4, second step. Apply ONLY after the new app (skin by host and by firm) is live and confirmed.
--
-- Until now any visitor could read every skin row directly, including fee defaults and internal notes.
-- After this, the skin table is readable by administrators only (the existing brand_admin_* policies);
-- everyone else gets the public fields through brand_for_host / brand_default / brand_for_user.
-- The old app and the old AI assistant read the table directly, so applying this first would blank them.
drop policy if exists brand_profiles_read on public.brand_profiles;
drop policy if exists brand_active_public_read on public.brand_profiles;
