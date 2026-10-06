-- Extends the plan-change trigger to also clear (and, on the way back up, restore) the
-- pcm_responsible flag on cash_flow_events when a plan change removes (or restores) bill pay.
-- Unlike workflow_instances, cash_flow_events has no status machine to pause into -- pcm_responsible
-- is just a boolean an advisor sets by hand for their own reasons, so blindly flipping it back to
-- true on every upgrade would also re-flag rows an advisor deliberately turned off for something
-- unrelated to plan capability. pcm_responsible_cleared_by_downgrade is the same idea as
-- workflow_instance_steps.paused_from_status: it remembers which rows THIS trigger cleared, so only
-- those come back, never someone else's manual choice.
--
-- The function that used to be named for workflows alone now does both, so it is renamed to
-- sync_plan_capabilities_on_change -- comments elsewhere (App.jsx, plans.js, the stripe-webhook
-- function) that named the old function should be read as referring to this one.

alter table public.cash_flow_events
  add column if not exists pcm_responsible_cleared_by_downgrade boolean not null default false;

comment on column public.cash_flow_events.pcm_responsible_cleared_by_downgrade is
  'True when sync_plan_capabilities_on_change cleared pcm_responsible because the household''s plan stopped including bill pay. Lets the trigger restore only what it itself cleared if the plan later regains bill pay, never a pcm_responsible=false an advisor set for an unrelated reason.';

drop trigger if exists families_pause_workflows_on_plan_change on public.families;
drop function if exists public.pause_or_resume_workflows_on_plan_change();

create or replace function public.sync_plan_capabilities_on_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_wf boolean; old_wf boolean;
  new_bp boolean; old_bp boolean;
begin
  select can_workflows, can_bill_pay into new_wf, new_bp from plan_features where plan = new.plan;
  select can_workflows, can_bill_pay into old_wf, old_bp from plan_features where plan = old.plan;

  -- Workflows: pause open instances (and their still-open steps) on the way down, resume on the
  -- way back up. Unchanged from the prior version of this function.
  if coalesce(old_wf, true) and not coalesce(new_wf, true) then
    update public.workflow_instance_steps
      set paused_from_status = status, status = 'paused'
      where instance_id in (
        select id from public.workflow_instances
        where family_id = new.id and status not in ('completed', 'paused', 'cancelled')
      )
      and status not in ('sent', 'done', 'skipped', 'paused');

    update public.workflow_instances
      set status = 'paused',
          risk_note = format('Paused -- household moved to %s on %s, which does not include workflows. Resumes automatically on a plan that does.', new.plan, to_char(now(), 'YYYY-MM-DD'))
      where family_id = new.id and status not in ('completed', 'paused', 'cancelled');
  elsif not coalesce(old_wf, true) and coalesce(new_wf, true) then
    update public.workflow_instances
      set status = 'active', risk_note = null
      where family_id = new.id and status = 'paused';

    update public.workflow_instance_steps
      set status = coalesce(paused_from_status, 'pending'), paused_from_status = null
      where instance_id in (select id from public.workflow_instances where family_id = new.id)
      and status = 'paused';
  end if;

  -- Bill pay: clear pcm_responsible on the way down (remembering that this trigger did it),
  -- restore only those rows on the way back up. Never touches a row this trigger didn't clear.
  if coalesce(old_bp, true) and not coalesce(new_bp, true) then
    update public.cash_flow_events
      set pcm_responsible = false, pcm_responsible_cleared_by_downgrade = true
      where family_id = new.id and pcm_responsible = true;
  elsif not coalesce(old_bp, true) and coalesce(new_bp, true) then
    update public.cash_flow_events
      set pcm_responsible = true, pcm_responsible_cleared_by_downgrade = false
      where family_id = new.id and pcm_responsible_cleared_by_downgrade = true;
  end if;

  return new;
end;
$function$;

create trigger families_sync_plan_capabilities
  after update of plan on public.families
  for each row
  when (old.plan is distinct from new.plan)
  execute function public.sync_plan_capabilities_on_change();

comment on function public.sync_plan_capabilities_on_change() is
  'Replaces the old families_refuse_downgrade hard block and the workflow-only pause_or_resume_workflows_on_plan_change. Reacts to any families.plan change by pausing/resuming workflow_instances (and their steps) and clearing/restoring cash_flow_events.pcm_responsible, driven entirely by plan_features.can_workflows / can_bill_pay for the old and new plan. Never deletes a row and never touches a value it did not itself set.';
