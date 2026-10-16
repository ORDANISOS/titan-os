-- Rollback for supabase/migrations/20261014100000_security_lockdown_step1.sql, sections 0, A and B.
-- These are the production definitions and grants captured on 2026-10-14 immediately before the change.
-- Only run this if the lockdown breaks something; it re-opens the holes described in the migration.
-- Demo (tkryueqzvgcigvxgjzsp) had identical definitions, grants and storage policy before the same change
-- on 2026-10-14, so this file rolls back either project.

create or replace function public.caller_is_privileged()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.is_admin()
      or current_user in ('service_role', 'postgres', 'supabase_admin');
$function$;

create or replace function public.bills_due_for_reminder(p_today date default current_date)
 returns table(event_id uuid, family_id uuid, family_name text, expert_name text, expert_email text,
               description text, event_type text, category text, amount numeric, frequency text,
               due_date date, days_until integer, reminder_days integer)
 language sql stable security definer set search_path to 'public'
as $function$
  with candidates as (
    select e.id, e.family_id, e.description, e.event_type, e.category, e.amount,
           e.frequency, e.reminder_days, e.reminder_sent_for, e.paid,
           public.next_bill_due_date(e.start_date, e.frequency, e.end_date, p_today) as due
    from public.cash_flow_events e
    where e.direction = 'expense'
      and coalesce(e.pcm_responsible, false)
      and coalesce(e.reminder_days, 0) > 0
  )
  select c.id, c.family_id, f.name, f.advisor_name, f.advisor_email,
         c.description, c.event_type, c.category, c.amount, c.frequency,
         c.due, (c.due - p_today)::int, c.reminder_days
  from candidates c
  join public.families f on f.id = c.family_id
  where c.due is not null
    and c.due - p_today <= c.reminder_days
    and c.due >= p_today
    and (c.reminder_sent_for is distinct from c.due)
    and not (
      case
        when coalesce(lower(c.frequency),'once') in ('once','one-time','onetime','')
          then coalesce(c.paid, false)
        else exists (
          select 1 from public.cash_flow_payment_log l
          where l.event_id = c.id and l.period = c.due and coalesce(l.paid, false)
        )
      end
    )
  order by c.due, f.name;
$function$;

-- Grants before the change: authenticated + service_role on all four report functions.
grant execute on function public.bills_due_for_reminder(date), public.dunning_due(date),
  public.capacity_report(), public.licensing_report() to authenticated, service_role;

create or replace function public.protect_sensitive_profile_columns()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    new.role := old.role;
    new.active := old.active;
    new.can_run_scheduled_prompts := old.can_run_scheduled_prompts;
    new.family_id := old.family_id;
    new.enterprise_id := old.enterprise_id;
  end if;
  return new;
end;
$function$;
