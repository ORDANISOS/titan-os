
-- The public sign-up page (no session yet) needs to show live pricing instead of
-- hardcoding numbers that can drift from plan_features.monthly_price, the amount
-- public-signup actually charges. plan_features has no household/PII data --
-- it is the pricing/feature grid already shown on the public marketing site --
-- so a read-only grant to anon is safe. Writes stay admin-only (plan_features_admin_write).
create policy "plan_features_public_read" on public.plan_features
  for select
  to anon
  using (true);
