-- ─────────────────────────────────────────────────────────────────────────────
-- Jurisdiction awareness.
--
-- The platform serves households in any state. Today a family in Florida and one
-- in California run byte-identical workflows, and `families` does not even record
-- where the household is domiciled.
--
-- The fix is NOT to encode fifty states of tax and trust law. That would be wrong
-- within months, it is practising law and giving tax advice without a licence, and
-- being confidently wrong is far worse than being silent.
--
-- Instead: RECORD the jurisdiction, FLAG the steps whose answer depends on it, and
-- never let the platform assert a state-specific date or rule. A flagged step says
-- "this varies by jurisdiction, confirm it" - it does not say what the answer is.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.families
  add column if not exists domicile_state  text,
  add column if not exists domicile_since  date,
  add column if not exists prior_domicile_state text;

comment on column public.families.domicile_state is
  'Two-letter state of the household''s tax domicile. Drives which steps are flagged as jurisdiction-dependent. The platform never derives a rule from it - only a warning.';
comment on column public.families.prior_domicile_state is
  'Set when a household relocates. Part-year residency and trailing filing obligations in the prior state are a common and expensive miss.';

alter table public.families
  drop constraint if exists families_domicile_state_check;
alter table public.families
  add constraint families_domicile_state_check
  check (domicile_state is null or domicile_state ~ '^[A-Z]{2}$');

alter table public.workflow_templates
  add column if not exists jurisdiction_sensitive boolean not null default false,
  add column if not exists jurisdiction_note text;

comment on column public.workflow_templates.jurisdiction_sensitive is
  'True where the workflow''s deadlines, thresholds or requirements differ by state or county. Surfaces a standing caution and routes the judgement to the family''s own professional. It does NOT make the platform resolve the rule.';

-- Of the nine templates on this instance, these turn on state law.
update public.workflow_templates set jurisdiction_sensitive = true,
  jurisdiction_note = 'State estimated tax differs from federal and several states levy none at all. Safe-harbour percentages and due dates vary. The state figure must come from the family''s accountant, never from this platform.'
where key = 'estimated_tax';

update public.workflow_templates set jurisdiction_sensitive = true,
  jurisdiction_note = 'Trust law is state law. Perpetuities, directed trusts and creditor protection differ sharply between jurisdictions, and twelve states plus DC levy their own estate tax at thresholds far below the federal one. Counsel in the governing state decides; this workflow only tracks the date.'
where key in ('grat_annuity','ilit_premium');

update public.workflow_templates set jurisdiction_sensitive = true,
  jurisdiction_note = 'A partnership operating in several states generates state K-1s with their own deadlines, and nexus rules differ. The set of filings owed is a question for the accountant.'
where key = 'k1_collection';

update public.workflow_templates set jurisdiction_sensitive = true,
  jurisdiction_note = 'The federal distribution is uniform, but state taxation of it is not - some states exempt retirement income entirely, others tax it in full. Withholding elections should be confirmed against the state of domicile.'
where key = 'rmd';

update public.workflow_templates set jurisdiction_sensitive = true,
  jurisdiction_note = 'Insurance is regulated state by state. Notice periods, cancellation rules and what a carrier may change at renewal all differ, and coastal states impose separate wind and flood requirements.'
where key in ('insurance_renewal','policy_review');

-- Renders the caution. Returns null where nothing is jurisdiction-dependent, so a
-- calling screen shows nothing rather than a needless disclaimer on every workflow.
create or replace function public.jurisdiction_caution(p_family_id uuid, p_template_key text)
returns text language sql stable security definer set search_path to 'public'
as $function$
  select case
    when not t.jurisdiction_sensitive then null
    when f.domicile_state is null then
      'This workflow depends on state law and we do not have this household''s domicile on record. Add it, and confirm the specifics with the family''s own attorney or accountant.'
    else
      'Domiciled in ' || f.domicile_state || '. ' || coalesce(t.jurisdiction_note,'') ||
      ' ORDANIS tracks the dates it is given; it does not determine what the rule is in ' || f.domicile_state || '.'
  end
  from workflow_templates t
  cross join families f
  where t.key = p_template_key and f.id = p_family_id;
$function$;
revoke execute on function public.jurisdiction_caution(uuid,text) from public, anon;
grant execute on function public.jurisdiction_caution(uuid,text) to authenticated, service_role;

select key, name, jurisdiction_sensitive,
       left(coalesce(jurisdiction_note,'—'), 58) as note
from public.workflow_templates where active order by jurisdiction_sensitive desc, key;