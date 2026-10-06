-- The instance-level pause added in remove_downgrade_block_pause_workflows didn't touch
-- workflow_instance_steps, which is what the cross-family review queue (App.jsx's step-queue
-- view) actually filters on (.in("status",["ready","awaiting_approval","approved","blocked"])).
-- Without this, a paused instance's steps would keep showing up in that queue and stay
-- actionable -- exactly the "no screen will show it, but it's still live" problem the old hard
-- block existed to prevent in the first place, just moved one table over. This closes that gap:
-- pausing an instance now also pauses its still-open steps, and resuming restores each step's
-- exact prior status (not a generic one -- "approved" and "ready" mean different things and a
-- step that was one shouldn't come back as the other).

alter table public.workflow_instance_steps add column if not exists paused_from_status text;

alter table public.workflow_instance_steps drop constraint if exists workflow_instance_steps_status_check;
alter table public.workflow_instance_steps add constraint workflow_instance_steps_status_check
  check (status = any (array['pending','ready','awaiting_approval','approved','sent','done','skipped','blocked','paused']));

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
    -- Steps first, while instance status still lets us tell which instances are newly paused vs
    -- already paused/completed -- only pause steps whose work isn't already finished (sent/done/
    -- skipped survive untouched; a completed step doesn't need to "resume" into anything).
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
  elsif not coalesce(old_allows, true) and coalesce(new_allows, true) then
    update public.workflow_instances
      set status = 'active', risk_note = null
      where family_id = new.id and status = 'paused';

    update public.workflow_instance_steps
      set status = coalesce(paused_from_status, 'pending'), paused_from_status = null
      where instance_id in (select id from public.workflow_instances where family_id = new.id)
      and status = 'paused';
  end if;

  return new;
end;
$function$;

comment on column public.workflow_instance_steps.paused_from_status is
  'Set by pause_or_resume_workflows_on_plan_change when a plan change pauses this step; holds the exact status to restore on resume. Null otherwise.';
