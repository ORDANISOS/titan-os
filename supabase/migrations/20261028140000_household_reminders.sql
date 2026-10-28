-- Reminders reach the family on self-directed plans (2026-10-28, Will's decisions).
--
-- Task and bill reminders used to go only to the household's ORDANIS Expert; a Basic or Core household usually has
-- none, so its reminders went nowhere. send-task-reminders now also emails the family logins allowed to act on them:
-- the primary and every active family user with "Edit records" (migration 20261028100000).
--
--   household_reminder_recipients(family): those logins' emails and names.
--   household_bills_due_for_reminder(day): bills a Basic/Core household tracks itself (not paid by ORDANIS), coming
--     due within their reminder window (3 days when none was set), not yet paid for that occurrence and not yet
--     reminded. Same recurrence and payment-log rules as bills_due_for_reminder.
-- Both are for the reminder job only (service role).
--
-- Rollback:
--   drop function if exists public.household_reminder_recipients(uuid);
--   drop function if exists public.household_bills_due_for_reminder(date);

create or replace function public.household_reminder_recipients(p_family_id uuid)
returns table(email text, full_name text)
language sql stable security definer set search_path to '' as $$
  select p.email, p.full_name
    from public.user_profiles p
   where p.family_id = p_family_id and p.role = 'client' and p.active is distinct from false
     and p.email is not null and (p.household_role = 'primary' or p.household_role is null or p.perm_edit);
$$;
revoke execute on function public.household_reminder_recipients(uuid) from public, anon, authenticated;
grant execute on function public.household_reminder_recipients(uuid) to service_role;

create or replace function public.household_bills_due_for_reminder(p_today date default current_date)
returns table(event_id uuid, family_id uuid, family_name text, description text, event_type text, category text,
              amount numeric, frequency text, due_date date, days_until integer)
language sql stable security definer set search_path to 'public' as $$
  with candidates as (
    select e.id, e.family_id, e.description, e.event_type, e.category, e.amount, e.frequency,
           coalesce(nullif(e.reminder_days, 0), 3) as remind, e.reminder_sent_for, e.paid,
           public.next_bill_due_date(e.start_date, e.frequency, e.end_date, p_today) as due
      from public.cash_flow_events e
      join public.families f on f.id = e.family_id
      join public.plan_features pf on pf.plan = f.plan
     where e.direction = 'expense'
       and not coalesce(e.pcm_responsible, false)
       and coalesce(pf.self_serve, false)
       and f.archived_at is null
  )
  select c.id, c.family_id, f.name, c.description, c.event_type, c.category, c.amount, c.frequency,
         c.due, (c.due - p_today)::int
    from candidates c join public.families f on f.id = c.family_id
   where c.due is not null and c.due >= p_today and c.due - p_today <= c.remind
     and (c.reminder_sent_for is distinct from c.due)
     and not (
       case when lower(coalesce(c.frequency, '')) in ('monthly','quarterly','annually')
         then exists (select 1 from public.cash_flow_payment_log l
                       where l.event_id = c.id and l.period = date_trunc('month', c.due)::date and coalesce(l.paid, false))
         else coalesce(c.paid, false) end)
   order by c.family_id, c.due;
$$;
revoke execute on function public.household_bills_due_for_reminder(date) from public, anon, authenticated;
grant execute on function public.household_bills_due_for_reminder(date) to service_role;
