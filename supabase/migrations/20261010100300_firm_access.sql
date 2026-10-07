-- Phase 9: what a firm's administrator can see inside its households.
--
-- Rule (Will, 2026-10): a firm administrator sees everything the household owner sees, and nothing else.
-- View only. Nothing here gives a firm administrator any way to change, add or delete household data.
--
-- How it is kept safe:
--   * The existing rules (current_user_allowed_family_ids and the write_access policies built on it) are NOT
--     touched. A firm administrator is not in that list, so every existing write rule already refuses them.
--   * Each household data table gets one extra rule, FOR SELECT ONLY, limited to households in the caller's own
--     firm that are not archived. Rules for different firms never overlap.
--   * The families table itself is not opened (it holds Stripe ids and internal notes). Firm administrators read
--     households through firm_family_rows(), which leaves those columns out.
--   * Vault documents in storage are readable for the firm's own households only.
--   * What a firm administrator opens is recorded in firm_access_log by firm_log_access(). The household owner
--     can read the rows about their own household. The log is written by the app when a household or document is
--     opened, so it records use of the app, not a direct call to the database API.

-- 1. Access log -------------------------------------------------------------------------------------------
create table if not exists public.firm_access_log (
  id uuid primary key default gen_random_uuid(),
  enterprise_id uuid not null references public.enterprises(id) on delete cascade,
  user_id uuid not null,
  family_id uuid references public.families(id) on delete set null,
  action text not null check (action in ('open_household', 'open_document', 'download_document')),
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists firm_access_log_ent_idx on public.firm_access_log (enterprise_id, created_at desc);
create index if not exists firm_access_log_fam_idx on public.firm_access_log (family_id, created_at desc);
alter table public.firm_access_log enable row level security;
revoke all on public.firm_access_log from anon, authenticated;
grant select on public.firm_access_log to authenticated;

-- 2. The households a firm administrator may see ----------------------------------------------------------
create or replace function public.current_user_firm_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select f.id from public.families f
   where public.is_enterprise_admin()
     and f.enterprise_id = public.current_user_enterprise_id()
     and f.archived_at is null;
$function$;
revoke execute on function public.current_user_firm_family_ids() from public, anon;
grant execute on function public.current_user_firm_family_ids() to authenticated, service_role;

create policy firm_access_log_admin_read on public.firm_access_log for select to authenticated
  using (public.is_admin());
create policy firm_access_log_firm_read on public.firm_access_log for select to authenticated
  using (public.is_enterprise_admin() and enterprise_id = public.current_user_enterprise_id());
create policy firm_access_log_household_read on public.firm_access_log for select to authenticated
  using (family_id in (select public.current_user_allowed_family_ids()));

-- 3. Read-only rules, one per household data table --------------------------------------------------------
create policy firm_admin_read on public.properties for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.portfolio_accounts for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.account_balances for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.valuables for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.tasks for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.notes for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.documents for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.document_folders for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.portfolio_documents for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.workflow_instances for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.workflow_instance_steps for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.obligations for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.cash_flow_events for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.cash_flow_payment_log for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.contacts for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.family_contacts for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.property_contacts for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.family_partners for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.entities for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.entity_members for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.deadlines for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.deadline_acks for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.activity_log for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.user_profiles for select to authenticated using (family_id in (select public.current_user_firm_family_ids()));
create policy firm_admin_read on public.note_attachments for select to authenticated
  using (exists (select 1 from public.notes n where n.id = note_attachments.note_id and n.family_id in (select public.current_user_firm_family_ids())));

-- 4. Vault documents (storage) -----------------------------------------------------------------------------
create policy documents_read_firm on storage.objects for select to authenticated
  using (bucket_id = 'documents' and split_part(name, '/', 1) in (select f::text from public.current_user_firm_family_ids() f));

-- 5. Household rows without the internal columns ----------------------------------------------------------
create or replace function public.firm_family_rows()
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select to_jsonb(f)
         - 'stripe_customer_id' - 'stripe_subscription_id' - 'stripe_subscription_schedule_id'
         - 'business_partner_seats_stripe_item_id' - 'notes' - 'paid_by_set_by' - 'paid_by_note'
         - 'onboarding_contacted_at' - 'onboarding_contacted_by' - 'acquisition_channel' - 'archived_by'
    from public.families f
   where f.id in (select public.current_user_firm_family_ids())
   order by f.name;
$function$;
revoke execute on function public.firm_family_rows() from public, anon;
grant execute on function public.firm_family_rows() to authenticated, service_role;

-- 6. Recording what was opened. Repeats of the same thing within ten minutes are written once. -------------
create or replace function public.firm_log_access(p_family_id uuid, p_action text, p_detail text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ent uuid;
begin
  if not public.is_enterprise_admin() then raise exception 'not_allowed'; end if;
  if p_family_id not in (select public.current_user_firm_family_ids()) then raise exception 'not_allowed'; end if;
  v_ent := public.current_user_enterprise_id();
  if exists (
    select 1 from public.firm_access_log l
     where l.user_id = auth.uid() and l.family_id = p_family_id and l.action = p_action
       and l.detail is not distinct from left(p_detail, 300)
       and l.created_at > now() - interval '10 minutes'
  ) then return; end if;
  insert into public.firm_access_log (enterprise_id, user_id, family_id, action, detail)
  values (v_ent, auth.uid(), p_family_id, p_action, left(p_detail, 300));
end;
$function$;
revoke execute on function public.firm_log_access(uuid, text, text) from public, anon;
grant execute on function public.firm_log_access(uuid, text, text) to authenticated, service_role;
