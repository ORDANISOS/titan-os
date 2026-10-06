-- ORDANIS production schema snapshot, part 3 of 3: constraints, indexes, RLS, triggers.
-- Source: the live catalog of production (xreeruxuwtmjhvvxvjts), captured 2026-10-06.
-- REFERENCE ONLY. Do not run this against production. See README.md in this folder.
--
-- Foreign keys here point at public.entities (defined in migration 20260930195752) and at
-- auth.users, so those must exist first.
--
-- Section order: constraints, indexes, row level security, policies, triggers, auth and
-- storage objects, scheduled jobs.

-- ═════════════════════════ constraints ═════════════════════════

alter table public.activity_log add constraint activity_log_pkey PRIMARY KEY (id);
alter table public.activity_log add constraint activity_log_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.advisor_alert_log add constraint advisor_alert_log_pkey PRIMARY KEY (id);
alter table public.advisor_alert_log add constraint advisor_alert_log_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.advisor_alert_log add constraint advisor_alert_log_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.cash_flow_events add constraint cash_flow_events_pkey PRIMARY KEY (id);
alter table public.cash_flow_events add constraint cash_flow_events_category_chk CHECK (((category IS NULL) OR (category = ANY (ARRAY['landscaping'::text, 'housekeeping'::text, 'pool_spa'::text, 'security'::text, 'maintenance'::text, 'utilities'::text, 'property_management'::text, 'insurance'::text, 'taxes'::text, 'household_payroll'::text, 'professional_fees'::text, 'healthcare'::text, 'childcare'::text, 'education'::text, 'travel'::text, 'charitable'::text, 'subscriptions'::text, 'vehicle'::text, 'debt_service'::text, 'other'::text]))));
alter table public.cash_flow_events add constraint cash_flow_events_category_expense_chk CHECK (((category IS NULL) OR (direction = 'expense'::text)));
alter table public.cash_flow_events add constraint cash_flow_events_one_vendor_chk CHECK (((vendor_family_contact_id IS NULL) OR (vendor_property_contact_id IS NULL)));
alter table public.cash_flow_events add constraint cash_flow_events_reminder_days_chk CHECK (((reminder_days >= 0) AND (reminder_days <= 365)));
alter table public.cash_flow_events add constraint cash_flow_events_vendor_expense_chk CHECK ((((vendor_family_contact_id IS NULL) AND (vendor_property_contact_id IS NULL)) OR (direction = 'expense'::text)));
alter table public.cash_flow_events add constraint cash_flow_events_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.cash_flow_events add constraint cash_flow_events_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.cash_flow_events add constraint cash_flow_events_vendor_family_contact_id_fkey FOREIGN KEY (vendor_family_contact_id) REFERENCES family_contacts(id) ON DELETE SET NULL;
alter table public.cash_flow_events add constraint cash_flow_events_vendor_property_contact_id_fkey FOREIGN KEY (vendor_property_contact_id) REFERENCES property_contacts(id) ON DELETE SET NULL;
alter table public.cash_flow_payment_log add constraint cash_flow_payment_log_pkey PRIMARY KEY (id);
alter table public.cash_flow_payment_log add constraint cash_flow_payment_log_event_id_period_key UNIQUE (event_id, period);
alter table public.cash_flow_payment_log add constraint cash_flow_payment_log_event_id_fkey FOREIGN KEY (event_id) REFERENCES cash_flow_events(id) ON DELETE CASCADE;
alter table public.cash_flow_payment_log add constraint cash_flow_payment_log_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.contacts add constraint contacts_pkey PRIMARY KEY (id);
alter table public.contacts add constraint contacts_not_primary_and_secondary CHECK ((NOT (is_primary AND is_secondary)));
alter table public.contacts add constraint contacts_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL;
alter table public.deadline_acks add constraint deadline_acks_pkey PRIMARY KEY (id);
alter table public.deadlines add constraint deadlines_pkey PRIMARY KEY (id);
alter table public.deadlines add constraint deadlines_deadline_type_check CHECK ((deadline_type = ANY (ARRAY['Tax'::text, 'Insurance'::text, 'Legal'::text, 'Mortgage'::text, 'HOA'::text, 'Other'::text])));
alter table public.deadlines add constraint deadlines_priority_check CHECK ((priority = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])));
alter table public.deadlines add constraint deadlines_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.deadlines add constraint deadlines_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.deals add constraint deals_pkey PRIMARY KEY (id);
alter table public.deals add constraint deals_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table public.deals add constraint deals_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL;
alter table public.document_downloads add constraint document_downloads_pkey PRIMARY KEY (id);
alter table public.document_downloads add constraint document_downloads_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
alter table public.document_downloads add constraint document_downloads_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.document_folders add constraint document_folders_pkey PRIMARY KEY (id);
alter table public.document_folders add constraint document_folders_name_len CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 40)));
alter table public.document_folders add constraint document_folders_name_trimmed CHECK ((name = btrim(name)));
alter table public.document_folders add constraint document_folders_not_builtin CHECK ((lower(name) <> ALL (ARRAY['general'::text, 'tax'::text, 'legal'::text, 'insurance'::text, 'investment'::text, 'real estate'::text, 'estate planning'::text, 'other'::text])));
alter table public.document_folders add constraint document_folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.document_folders add constraint document_folders_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.documents add constraint documents_pkey PRIMARY KEY (id);
alter table public.documents add constraint documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['insurance'::text, 'taxes'::text, 'bills'::text, 'legal'::text, 'mortgage'::text, 'hoa'::text, 'inspection'::text, 'title'::text, 'other'::text])));
alter table public.documents add constraint documents_no_self_supersede CHECK (((superseded_by_id IS NULL) OR (superseded_by_id <> id)));
alter table public.documents add constraint documents_account_id_fkey FOREIGN KEY (account_id) REFERENCES portfolio_accounts(id) ON DELETE SET NULL;
alter table public.documents add constraint documents_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.documents add constraint documents_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.documents add constraint documents_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES documents(id) ON DELETE SET NULL;
alter table public.dunning_notices add constraint dunning_notices_pkey PRIMARY KEY (id);
alter table public.dunning_notices add constraint dunning_notice_kind_check CHECK ((notice_kind = ANY (ARRAY['weekly'::text, 'final_notice'::text, 'escalation'::text, 'archived'::text, 'recovered'::text])));
alter table public.dunning_notices add constraint dunning_notices_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.families add constraint families_pkey PRIMARY KEY (id);
alter table public.families add constraint families_customer_number_key UNIQUE (customer_number);
alter table public.families add constraint families_acquisition_channel_check CHECK ((acquisition_channel = ANY (ARRAY['advisor'::text, 'self_serve'::text])));
alter table public.families add constraint families_domicile_state_check CHECK (((domicile_state IS NULL) OR (domicile_state ~ '^[A-Z]{2}$'::text)));
alter table public.families add constraint families_pending_plan_check CHECK (((pending_plan IS NULL) OR (pending_plan = ANY (ARRAY['basic'::text, 'core'::text, 'premier'::text]))));
alter table public.families add constraint families_plan_fkey FOREIGN KEY (plan) REFERENCES plan_features(plan) ON UPDATE CASCADE;
alter table public.family_contacts add constraint family_contacts_pkey PRIMARY KEY (id);
alter table public.family_contacts add constraint family_contacts_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.family_partners add constraint family_partners_pkey PRIMARY KEY (id);
alter table public.family_partners add constraint family_partners_family_id_user_id_key UNIQUE (family_id, user_id);
alter table public.family_partners add constraint family_partners_source_check CHECK ((source = ANY (ARRAY['admin'::text, 'household'::text])));
alter table public.family_partners add constraint family_partners_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.family_partners add constraint family_partners_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.note_attachments add constraint note_attachments_pkey PRIMARY KEY (id);
alter table public.note_attachments add constraint note_attachments_note_id_fkey FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE;
alter table public.notes add constraint notes_pkey PRIMARY KEY (id);
alter table public.notes add constraint notes_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table public.notes add constraint notes_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL;
alter table public.plan_features add constraint plan_features_pkey PRIMARY KEY (plan);
alter table public.portfolio_accounts add constraint portfolio_accounts_pkey PRIMARY KEY (id);
alter table public.portfolio_accounts add constraint portfolio_accounts_balance_source_document_id_fkey FOREIGN KEY (balance_source_document_id) REFERENCES documents(id) ON DELETE SET NULL;
alter table public.portfolio_accounts add constraint portfolio_accounts_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL;
alter table public.portfolio_accounts add constraint portfolio_accounts_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.portfolio_documents add constraint portfolio_documents_pkey PRIMARY KEY (id);
alter table public.portfolio_documents add constraint portfolio_documents_account_id_fkey FOREIGN KEY (account_id) REFERENCES portfolio_accounts(id) ON DELETE CASCADE;
alter table public.portfolio_documents add constraint portfolio_documents_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.properties add constraint properties_pkey PRIMARY KEY (id);
alter table public.properties add constraint properties_status_check CHECK ((status = ANY (ARRAY['Active'::text, 'Pending'::text, 'Sold'::text, 'Under Contract'::text])));
alter table public.properties add constraint properties_type_check CHECK ((type = ANY (ARRAY['Residential'::text, 'Commercial'::text, 'Land'::text, 'Industrial'::text, 'Mixed Use'::text])));
alter table public.properties add constraint properties_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL;
alter table public.properties add constraint properties_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.property_contacts add constraint property_contacts_pkey PRIMARY KEY (id);
alter table public.property_contacts add constraint property_contacts_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.property_contacts add constraint property_contacts_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
alter table public.scheduled_prompts add constraint scheduled_prompts_pkey PRIMARY KEY (id);
alter table public.scheduled_prompts add constraint scheduled_prompts_data_source_check CHECK ((data_source = ANY (ARRAY['internal'::text, 'web_search'::text])));
alter table public.scheduled_prompts add constraint scheduled_prompts_prompt_type_check CHECK ((prompt_type = ANY (ARRAY['template'::text, 'custom'::text])));
alter table public.scheduled_prompts add constraint scheduled_prompts_schedule_dow_check CHECK (((schedule_dow >= 0) AND (schedule_dow <= 6)));
alter table public.scheduled_prompts add constraint scheduled_prompts_schedule_hour_utc_check CHECK (((schedule_hour_utc >= 0) AND (schedule_hour_utc <= 23)));
alter table public.scheduled_prompts add constraint scheduled_prompts_schedule_preset_check CHECK ((schedule_preset = ANY (ARRAY['daily'::text, 'weekdays'::text, 'weekly'::text])));
alter table public.scheduled_prompts add constraint scheduled_prompts_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.scheduled_prompts add constraint scheduled_prompts_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
alter table public.tasks add constraint tasks_pkey PRIMARY KEY (id);
alter table public.tasks add constraint tasks_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL;
alter table public.user_profiles add constraint user_profiles_pkey PRIMARY KEY (id);
alter table public.user_profiles add constraint user_profiles_family_cap_chk CHECK (((family_cap IS NULL) OR (family_cap >= 0)));
alter table public.user_profiles add constraint user_profiles_partner_kind_chk CHECK (((partner_kind IS NULL) OR (partner_kind = ANY (ARRAY['adviser'::text, 'professional'::text]))));
alter table public.user_profiles add constraint user_profiles_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL;
alter table public.user_profiles add constraint user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.valuables add constraint valuables_pkey PRIMARY KEY (id);
alter table public.valuables add constraint valuables_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;

-- ═════════════════════════ indexes ═════════════════════════
-- Indexes that back a primary key or unique constraint are created by the constraints above.

CREATE INDEX cash_flow_events_category_idx ON public.cash_flow_events USING btree (family_id, category) WHERE (category IS NOT NULL);
CREATE INDEX cash_flow_events_property_idx ON public.cash_flow_events USING btree (property_id) WHERE (property_id IS NOT NULL);
CREATE INDEX cash_flow_events_vendor_fc_idx ON public.cash_flow_events USING btree (vendor_family_contact_id) WHERE (vendor_family_contact_id IS NOT NULL);
CREATE INDEX cash_flow_events_vendor_pc_idx ON public.cash_flow_events USING btree (vendor_property_contact_id) WHERE (vendor_property_contact_id IS NOT NULL);
CREATE INDEX idx_cash_flow_events_family_id ON public.cash_flow_events USING btree (family_id);
CREATE INDEX idx_cash_flow_events_sort ON public.cash_flow_events USING btree (family_id, sort_order);
CREATE INDEX idx_cash_flow_events_start_date ON public.cash_flow_events USING btree (start_date);
CREATE INDEX idx_cash_flow_payment_log_event ON public.cash_flow_payment_log USING btree (event_id);
CREATE INDEX idx_cash_flow_payment_log_family ON public.cash_flow_payment_log USING btree (family_id);
CREATE UNIQUE INDEX contacts_one_primary_per_family ON public.contacts USING btree (family_id) WHERE is_primary;
CREATE UNIQUE INDEX contacts_one_secondary_per_family ON public.contacts USING btree (family_id) WHERE is_secondary;
CREATE INDEX deadline_acks_family_idx ON public.deadline_acks USING btree (family_id);
CREATE UNIQUE INDEX deadline_acks_key_idx ON public.deadline_acks USING btree (item_key);
CREATE INDEX document_downloads_document_id_idx ON public.document_downloads USING btree (document_id);
CREATE INDEX document_folders_family_idx ON public.document_folders USING btree (family_id, sort_order, name);
CREATE UNIQUE INDEX document_folders_family_name_key ON public.document_folders USING btree (family_id, lower(name));
CREATE INDEX documents_account_idx ON public.documents USING btree (account_id, account_period) WHERE (account_id IS NOT NULL);
CREATE INDEX documents_current_idx ON public.documents USING btree (property_id, property_section) WHERE (superseded_by_id IS NULL);
CREATE INDEX documents_family_created_idx ON public.documents USING btree (family_id, created_at DESC);
CREATE INDEX documents_fts_idx ON public.documents USING gin (documents_search_vector(documents.*));
CREATE INDEX documents_name_trgm ON public.documents USING gin (name gin_trgm_ops);
CREATE INDEX documents_property_section_idx ON public.documents USING btree (property_id, property_section);
CREATE INDEX dunning_notices_family_idx ON public.dunning_notices USING btree (family_id, sent_at DESC);
CREATE UNIQUE INDEX dunning_notices_one_per_day_uq ON public.dunning_notices USING btree (family_id, notice_kind, day_number);
CREATE INDEX families_name_trgm ON public.families USING gin (name gin_trgm_ops);
CREATE INDEX families_state_idx ON public.families USING btree (subscription_state, plan);
CREATE INDEX family_contacts_family_idx ON public.family_contacts USING btree (family_id);
CREATE UNIQUE INDEX family_partners_one_lead_per_family ON public.family_partners USING btree (family_id) WHERE is_lead_advisor;
CREATE INDEX idx_note_attachments_note_id ON public.note_attachments USING btree (note_id);
CREATE INDEX portfolio_accounts_entity_idx ON public.portfolio_accounts USING btree (entity_id) WHERE (entity_id IS NOT NULL);
CREATE INDEX properties_entity_idx ON public.properties USING btree (entity_id) WHERE (entity_id IS NOT NULL);
CREATE INDEX property_contacts_family_idx ON public.property_contacts USING btree (family_id);
CREATE INDEX property_contacts_property_idx ON public.property_contacts USING btree (property_id);
CREATE INDEX scheduled_prompts_family_idx ON public.scheduled_prompts USING btree (family_id);
CREATE INDEX scheduled_prompts_owner_idx ON public.scheduled_prompts USING btree (owner_user_id);
CREATE INDEX user_profiles_created_idx ON public.user_profiles USING btree (created_at DESC, id);
CREATE INDEX user_profiles_email_idx ON public.user_profiles USING btree (lower(email));
CREATE INDEX user_profiles_email_trgm ON public.user_profiles USING gin (email gin_trgm_ops);
CREATE INDEX user_profiles_family_idx ON public.user_profiles USING btree (family_id) WHERE (family_id IS NOT NULL);
CREATE INDEX user_profiles_name_idx ON public.user_profiles USING btree (lower(full_name));
CREATE INDEX user_profiles_name_trgm ON public.user_profiles USING gin (full_name gin_trgm_ops);
CREATE INDEX user_profiles_role_idx ON public.user_profiles USING btree (role, active, lower(email));

-- ═════════════════════════ row level security ═════════════════════════

alter table public.activity_log enable row level security;
alter table public.advisor_alert_log enable row level security;
alter table public.cash_flow_events enable row level security;
alter table public.cash_flow_payment_log enable row level security;
alter table public.contacts enable row level security;
alter table public.deadline_acks enable row level security;
alter table public.deadlines enable row level security;
alter table public.deals enable row level security;
alter table public.document_downloads enable row level security;
alter table public.document_folders enable row level security;
alter table public.documents enable row level security;
alter table public.dunning_notices enable row level security;
alter table public.families enable row level security;
alter table public.family_contacts enable row level security;
alter table public.family_partners enable row level security;
alter table public.note_attachments enable row level security;
alter table public.notes enable row level security;
alter table public.plan_features enable row level security;
alter table public.portfolio_accounts enable row level security;
alter table public.portfolio_documents enable row level security;
alter table public.properties enable row level security;
alter table public.property_contacts enable row level security;
alter table public.scheduled_prompts enable row level security;
alter table public.tasks enable row level security;
alter table public.user_profiles enable row level security;
alter table public.valuables enable row level security;

-- ═════════════════════════ policies ═════════════════════════
-- Policies with no "to" clause apply to the public role, as they do on production.

create policy read_access on public.activity_log as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.activity_log as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy read_access on public.advisor_alert_log as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.advisor_alert_log as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy read_access on public.cash_flow_events as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.cash_flow_events as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy read_access on public.cash_flow_payment_log as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.cash_flow_payment_log as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy read_access on public.contacts as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.contacts as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy read_access on public.deadline_acks as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.deadline_acks as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy read_access on public.deadlines as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.deadlines as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy read_access on public.deals as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.deals as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy insert_access on public.document_downloads as permissive for INSERT with check ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy read_access on public.document_downloads as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy read_access on public.document_folders as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.document_folders as permissive for ALL using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)))) with check ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy partner_upload on public.documents as permissive for INSERT with check (((current_user_role() = 'partner'::text) AND (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy read_access on public.documents as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.documents as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy dunning_admin_all on public.dunning_notices as permissive for ALL to authenticated using (is_admin()) with check (is_admin());
create policy dunning_family_read on public.dunning_notices as permissive for SELECT to authenticated using ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)));
create policy family_advisor_insert on public.families as permissive for INSERT to authenticated with check ((is_admin() OR ((current_user_role() = 'advisor'::text) AND (lower(COALESCE(advisor_email, ''::text)) = lower(COALESCE(current_user_email(), '\x00'::text))))));
create policy family_scoped_select on public.families as permissive for SELECT using ((is_admin() OR (id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy family_scoped_write on public.families as permissive for ALL using ((is_admin() OR ((current_user_role() = 'advisor'::text) AND (id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))))) with check ((is_admin() OR ((current_user_role() = 'advisor'::text) AND (id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)))));
create policy read_access on public.family_contacts as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.family_contacts as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy admin_manage on public.family_partners as permissive for ALL using (is_admin()) with check (is_admin());
create policy admin_write on public.family_partners as permissive for ALL using (is_admin()) with check (is_admin());
create policy read_access on public.family_partners as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy self_select on public.family_partners as permissive for SELECT using ((is_admin() OR (user_id = auth.uid())));
create policy read_access on public.note_attachments as permissive for SELECT using ((is_admin() OR (EXISTS ( SELECT 1
   FROM notes n
  WHERE ((n.id = note_attachments.note_id) AND (n.family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)))))));
create policy write_access on public.note_attachments as permissive for ALL using ((is_admin() OR ((current_user_role() <> 'partner'::text) AND (EXISTS ( SELECT 1
   FROM notes n
  WHERE ((n.id = note_attachments.note_id) AND (n.family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)))))))) with check ((is_admin() OR ((current_user_role() <> 'partner'::text) AND (EXISTS ( SELECT 1
   FROM notes n
  WHERE ((n.id = note_attachments.note_id) AND (n.family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))))))));
create policy read_access on public.notes as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.notes as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy plan_features_admin_write on public.plan_features as permissive for ALL to authenticated using (is_admin()) with check (is_admin());
create policy plan_features_public_read on public.plan_features as permissive for SELECT to anon using (true);
create policy plan_features_read on public.plan_features as permissive for SELECT to authenticated using (true);
create policy read_access on public.portfolio_accounts as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.portfolio_accounts as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy read_access on public.portfolio_documents as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.portfolio_documents as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy read_access on public.properties as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.properties as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy read_access on public.property_contacts as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.property_contacts as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy read_access on public.scheduled_prompts as permissive for SELECT using ((is_admin() OR (owner_user_id = auth.uid()) OR ((current_user_role() = 'advisor'::text) AND (family_id IS NOT NULL) AND (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (user_role_of(owner_user_id) = 'partner'::text))));
create policy write_access on public.scheduled_prompts as permissive for ALL using ((is_admin() OR ((owner_user_id = auth.uid()) AND ((current_user_role() <> 'partner'::text) OR current_user_can_run_prompts())))) with check ((is_admin() OR ((owner_user_id = auth.uid()) AND ((current_user_role() <> 'partner'::text) OR current_user_can_run_prompts()))));
create policy read_access on public.tasks as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.tasks as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));
create policy admin_delete on public.user_profiles as permissive for DELETE using (is_admin());
create policy family_scoped_select on public.user_profiles as permissive for SELECT using ((is_admin() OR (id = auth.uid()) OR (family_id = current_user_family_id())));
create policy self_or_admin_insert on public.user_profiles as permissive for INSERT with check ((is_admin() OR (id = auth.uid())));
create policy self_or_admin_update on public.user_profiles as permissive for UPDATE using ((is_admin() OR (id = auth.uid()))) with check ((is_admin() OR (id = auth.uid())));
create policy read_access on public.valuables as permissive for SELECT using ((is_admin() OR (family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids))));
create policy write_access on public.valuables as permissive for ALL using ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text)))) with check ((is_admin() OR ((family_id IN ( SELECT current_user_allowed_family_ids() AS current_user_allowed_family_ids)) AND (current_user_role() <> 'partner'::text))));

-- ═════════════════════════ triggers ═════════════════════════
-- All 11 triggers in the public schema. Three sit on tables that migration files create
-- (account_balances, obligations, workflow_instances); migrations already attach those, so
-- they appear twice across the repo and are listed here only for a complete picture.

CREATE TRIGGER account_balances_sync AFTER INSERT OR DELETE OR UPDATE ON public.account_balances FOR EACH ROW EXECUTE FUNCTION sync_account_current_balance();
CREATE TRIGGER cash_flow_events_refuse_core_billpay BEFORE INSERT OR UPDATE ON public.cash_flow_events FOR EACH ROW EXECUTE FUNCTION refuse_billpay_when_core();
CREATE TRIGGER cash_flow_payment_log_refuse_core BEFORE INSERT OR UPDATE ON public.cash_flow_payment_log FOR EACH ROW EXECUTE FUNCTION refuse_payment_log_when_core();
CREATE TRIGGER families_assign_customer_number BEFORE INSERT ON public.families FOR EACH ROW EXECUTE FUNCTION assign_customer_number();
CREATE TRIGGER families_sync_plan_capabilities AFTER UPDATE OF plan ON public.families FOR EACH ROW WHEN ((old.plan IS DISTINCT FROM new.plan)) EXECUTE FUNCTION sync_plan_capabilities_on_change();
CREATE TRIGGER trg_enforce_family_cap BEFORE INSERT OR UPDATE OF advisor_email ON public.families FOR EACH ROW EXECUTE FUNCTION enforce_family_cap();
CREATE TRIGGER trg_lead_advisor_is_adviser BEFORE INSERT OR UPDATE OF is_lead_advisor ON public.family_partners FOR EACH ROW EXECUTE FUNCTION enforce_lead_advisor_is_adviser();
CREATE TRIGGER obligations_refuse_core BEFORE INSERT OR UPDATE ON public.obligations FOR EACH ROW EXECUTE FUNCTION refuse_when_core('obligations');
CREATE TRIGGER trg_prevent_privilege_escalation BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION prevent_privilege_escalation();
CREATE TRIGGER trg_protect_sensitive_profile_columns BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION protect_sensitive_profile_columns();
CREATE TRIGGER workflow_instances_refuse_core BEFORE INSERT OR UPDATE ON public.workflow_instances FOR EACH ROW EXECUTE FUNCTION refuse_when_core('workflows');

-- ═════════════════════════ auth and storage ═════════════════════════

-- Creates the user_profiles row for every new sign-in.
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Buckets. "brand" is public; "documents" is private. Neither sets a size or MIME limit.
-- insert into storage.buckets (id, name, public) values ('brand','brand',true), ('documents','documents',false);

create policy brand_admin_write on storage.objects as permissive for ALL to authenticated using (((bucket_id = 'brand'::text) AND is_admin())) with check (((bucket_id = 'brand'::text) AND is_admin()));
create policy documents_delete_own_families on storage.objects as permissive for DELETE to authenticated using (((bucket_id = 'documents'::text) AND (is_admin() OR (split_part(name, '/'::text, 1) IN ( SELECT (f.f)::text AS f
   FROM current_user_allowed_family_ids() f(f))))));
create policy documents_read_own_families on storage.objects as permissive for SELECT to authenticated using (((bucket_id = 'documents'::text) AND (is_admin() OR (split_part(name, '/'::text, 1) IN ( SELECT (f.f)::text AS f
   FROM current_user_allowed_family_ids() f(f))))));
create policy documents_write_own_families on storage.objects as permissive for INSERT to authenticated with check (((bucket_id = 'documents'::text) AND (is_admin() OR (split_part(name, '/'::text, 1) IN ( SELECT (f.f)::text AS f
   FROM current_user_allowed_family_ids() f(f))))));

-- ═════════════════════════ scheduled jobs (pg_cron) ═════════════════════════
-- The two jobs that call edge functions are recorded WITHOUT their credentials. On
-- production, both embed a JWT in the command text. See README.md, "Credentials in cron".

-- run-scheduled-prompts: hourly, POSTs to the run-scheduled-prompts edge function.
--   schedule: 0 * * * *
--   headers:  Content-Type: application/json; Authorization: Bearer <anon key>
--
-- send-task-reminders: daily at 13:00 UTC, POSTs to the send-task-reminders edge function.
--   schedule: 0 13 * * *
--   headers:  Content-Type: application/json; x-cron-secret: <REDACTED, see README>
--
-- workflow-overage-monthly: 03:15 UTC on the 1st of each month.
select cron.schedule('workflow-overage-monthly', '15 3 1 * *', $$select public.record_workflow_overages();$$);
