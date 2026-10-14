-- Bill reminders: match "paid" the way the Cash Flow payment register records it (2026-10-14).
--
-- The register writes one cash_flow_payment_log row per period for monthly / quarterly / annual
-- expenses, keyed by the FIRST of the due month (period = 'YYYY-MM-01'). This function compared the
-- log against the exact due date instead (l.period = c.due), so a bill due on any day other than the
-- 1st was never seen as paid, and its reminder email went out even after it had been paid.
-- Everything else (one-offs, weekly, biweekly, semiannual) still uses the single paid flag on the
-- expense, exactly as the Cash Flow tab does. Access scoping from 20261014100000 is unchanged.

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
      and (public.caller_is_privileged()
           or e.family_id in (select public.current_user_allowed_family_ids()))
  )
  select c.id, c.family_id, f.name, f.advisor_name, f.advisor_email,
         c.description, c.event_type, c.category, c.amount, c.frequency,
         c.due, (c.due - p_today)::int, c.reminder_days
  from candidates c
  join public.families f on f.id = c.family_id
  where c.due is not null
    and c.due - p_today <= c.reminder_days     -- inside the reminder window
    and c.due >= p_today                        -- not already overdue
    and (c.reminder_sent_for is distinct from c.due)
    and not (
      case
        when lower(coalesce(c.frequency, '')) in ('monthly','quarterly','annually')
          -- the register's period is the first of the due month
          then exists (
            select 1 from public.cash_flow_payment_log l
            where l.event_id = c.id
              and l.period = date_trunc('month', c.due)::date
              and coalesce(l.paid, false)
          )
        else coalesce(c.paid, false)
      end
    )
  order by c.due, f.name;
$function$;

revoke execute on function public.bills_due_for_reminder(date) from public, anon;
grant  execute on function public.bills_due_for_reminder(date) to authenticated, service_role;

-- ROLLBACK: re-run the bills_due_for_reminder definition from 20261014100000_security_lockdown_step1.sql.
