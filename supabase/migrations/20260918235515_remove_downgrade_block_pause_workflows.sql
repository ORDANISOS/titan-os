-- Removes the hard block on downgrading a household while it has open work, per the owner's
-- decision: the household should be WARNED (already implemented client-side in the Billing tab's
-- confirm-downgrade dialog, and now also server-side via an email + in-app banner -- see
-- stripe-webhook's handlePlanWorkflowTransition), not refused outright. In its place: a plan
-- change that lands on a tier without workflow support now PAUSES that household's open
-- workflow_instances instead of leaving them blocking the move (or, previously, blocking it
-- entirely). Nothing is deleted. Obligations and PCM-responsible cash_flow_events (bill-pay) were
-- also covered by the old block and are NOT given an equivalent pause here -- neither table has a
-- pause-like state to move them into, so a downgrade away from a plan that shows them now simply
-- leaves those rows in place, still on file, just not orbited by a screen that shows them. That is
-- a real, deliberate gap the owner should know about, not an oversight.

-- 1) Drop the old hard block.
drop trigger if exists families_refuse_downgrade on public.families;
drop function if exists public.refuse_downgrade_with_open_work();

-- 2) Add 'paused' as a legal workflow_instances.status value.
alter table public.workflow_instances drop constraint if exists workflow_instances_status_check;
alter table public.workflow_instances add constraint workflow_instances_status_check
  check (status = any (array['active','at_risk','blocked','completed','cancelled','paused']));

-- 3) Pause (or resume) a household's open workflow_instances whenever families.plan actually
-- changes, based on plan_features.can_workflows for the new plan -- not a hardcoded plan name, for
-- the same reason plans.js reads the capability table directly rather than special-casing a tier.
-- This is an AFTER trigger (the move already happened; this reacts to it) so it fires no matter
-- what changed the plan -- the Stripe webhook's scheduled-downgrade sync, a manual admin edit, or
-- anything written later -- rather than living only in one code path.
create or replace function public.pause_or_resume_workflows_on_plan_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_allows boolean;
  old_allows boolean;
begin
  select can_workflows into new_allows from plan_features where plan = new.plan;
  select can_workflows into old_allows from plan_features where plan = old.plan;

  if coalesce(old_allows, true) and not coalesce(new_allows, true) then
    -- Moved to a plan without workflows: pause everything still open. The prior status
    -- (active/at_risk/blocked) is not preserved -- resuming always lands on 'active', which an
    -- advisor can re-flag if it's genuinely at risk. Not "cancelled": the household did not
    -- abandon the work, the plan just stopped showing it for now.
    update public.workflow_instances
      set status = 'paused',
          risk_note = format('Paused -- household moved to %s on %s, which does not include workflows. Resumes automatically on a plan that does.', new.plan, to_char(now(), 'YYYY-MM-DD'))
      where family_id = new.id and status not in ('completed', 'paused', 'cancelled');
  elsif not coalesce(old_allows, true) and coalesce(new_allows, true) then
    -- Moved back to a plan with workflows: resume anything this trigger paused.
    update public.workflow_instances
      set status = 'active', risk_note = null
      where family_id = new.id and status = 'paused';
  end if;

  return new;
end;
$function$;

drop trigger if exists families_pause_workflows_on_plan_change on public.families;
create trigger families_pause_workflows_on_plan_change
  after update of plan on public.families
  for each row
  when (old.plan is distinct from new.plan)
  execute function public.pause_or_resume_workflows_on_plan_change();

comment on function public.pause_or_resume_workflows_on_plan_change() is
  'Replaces the old families_refuse_downgrade hard block. Pauses (never deletes) a household''s open workflow_instances when its plan stops including workflows, and resumes them if it moves back. Reads plan_features.can_workflows rather than hardcoding a tier.';
