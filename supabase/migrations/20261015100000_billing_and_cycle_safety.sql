-- Billing and workflow-cycle safety (2026-10-15, from the 2026-10-14 bug check).
--
-- 1. One household per Stripe subscription. stripe-webhook guards checkout.session.completed with a
--    read-then-insert, so two near-simultaneous deliveries of the same event (Stripe does redeliver)
--    could both create a household for one payment. With this index the second insert fails, the
--    event is retried, and the retry takes the existing "replay" path instead.
--    Checked before applying: no duplicate stripe_subscription_id on production or demo.
--
-- 2. A workflow cycle closes itself when its last step is finished. Only the Advance button in the
--    app used to mark a cycle completed; a final step sent from the review queue or by the
--    send-workflow-step function left the cycle open forever, still holding a workflow slot or the
--    monthly extra-workflow charge. This trigger closes the cycle wherever the step is finished.
--    Completing the cycle fires the existing slot-release trigger on workflow_instances, which is
--    what stops the charge.

create unique index if not exists families_stripe_subscription_id_key
  on public.families (stripe_subscription_id) where stripe_subscription_id is not null;

create or replace function public.close_cycle_when_steps_finished()
 returns trigger
 language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.status in ('sent','done','skipped') and old.status is distinct from new.status then
    update public.workflow_instances i
       set status = 'completed', completed_at = coalesce(i.completed_at, now())
     where i.id = new.instance_id
       and i.status in ('active','at_risk','blocked')
       and not exists (
         select 1 from public.workflow_instance_steps s
          where s.instance_id = new.instance_id and s.status not in ('sent','done','skipped'));
  end if;
  return new;
end;
$function$;
revoke execute on function public.close_cycle_when_steps_finished() from public, anon, authenticated;

drop trigger if exists workflow_steps_close_cycle on public.workflow_instance_steps;
create trigger workflow_steps_close_cycle
  after update of status on public.workflow_instance_steps
  for each row execute function public.close_cycle_when_steps_finished();

-- ROLLBACK: drop trigger if exists workflow_steps_close_cycle on public.workflow_instance_steps;
--           drop function if exists public.close_cycle_when_steps_finished();
--           drop index if exists public.families_stripe_subscription_id_key;
