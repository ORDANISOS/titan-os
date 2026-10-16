-- Security lockdown, step 1 (2026-10-14 bug check).
--
-- 0. caller_is_privileged() returned true for every caller (see section 0).
--
-- A. Four SECURITY DEFINER report functions had no caller check and were executable by any signed-in
--    user, so a client could read every household's bills (bills_due_for_reminder), every past-due
--    household and its contact email (dunning_due), all staff and caseloads (capacity_report) and
--    platform household counts (licensing_report). bills_due_for_reminder is now scoped to what the
--    caller may see (Expert: own clients; admin: all). The other three are back-office only; the
--    service role and the SQL editor keep access.
--
-- B. Expert access is decided by user_profiles.email matching families.advisor_email, and a user may
--    update their own profile row. email was not protected, so an Expert could set their email to a
--    colleague's and take over that colleague's households. family_cap (bypasses enforce_family_cap)
--    and partner_kind (lets a partner pass the lead-adviser check) were also self-editable.
--    Only admin screens and service-role functions change these three, so they are now frozen for
--    everyone else, the same way role/active/family_id/enterprise_id already were.
--
-- C. The storage delete rule for the documents bucket allowed anyone linked to the household,
--    including view-only partner seats, to permanently delete files. Partners are now excluded,
--    matching the table write policies. (Storage-policy DDL hangs over the MCP: run C in the SQL editor.)

-- 0 ------------------------------------------------------------------------------------------------
-- caller_is_privileged() is SECURITY DEFINER, and inside a definer function current_user is the
-- owner (postgres), so `current_user in ('service_role','postgres',...)` was true for EVERY caller.
-- Twenty functions gated on it (user_directory, vault_search, entity_*, supersede_document, the
-- brand-skin functions, ...) were open to any signed-in user. Judge the caller by the request's JWT
-- instead: an admin, the service-role key, or no JWT at all from a database-owner session
-- (SQL editor, pg_cron). Tested in a rolled-back transaction before applying.
create or replace function public.caller_is_privileged()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.is_admin()
      or coalesce(auth.role(), '') = 'service_role'
      or (coalesce(auth.role(), '') = '' and session_user in ('postgres', 'supabase_admin'));
$function$;

-- A ------------------------------------------------------------------------------------------------
-- bills_due_for_reminder stays callable by signed-in users but now only returns households the
-- caller may see: admins and the service role see every household, an Expert sees their own
-- clients, a household sees its own. (Same body as before plus the access line.)
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
    -- A one-off uses the row's own paid flag; a recurring bill records each
    -- period separately in the payment log, so check there instead.
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
revoke execute on function public.bills_due_for_reminder(date) from public, anon;
grant  execute on function public.bills_due_for_reminder(date) to authenticated, service_role;

revoke execute on function public.dunning_due(date)            from public, anon, authenticated;
revoke execute on function public.capacity_report()            from public, anon, authenticated;
revoke execute on function public.licensing_report()           from public, anon, authenticated;
grant  execute on function public.dunning_due(date)            to service_role;
grant  execute on function public.capacity_report()            to service_role;
grant  execute on function public.licensing_report()           to service_role;

-- B ------------------------------------------------------------------------------------------------
create or replace function public.protect_sensitive_profile_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
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
    -- Expert access follows email, so changing it would hand over another Expert's households.
    new.email := old.email;
    new.family_cap := old.family_cap;
    new.partner_kind := old.partner_kind;
  end if;
  return new;
end;
$function$;

-- C (run in the Supabase SQL editor) -----------------------------------------------------------------
drop policy if exists documents_delete_own_families on storage.objects;
create policy documents_delete_own_families on storage.objects
  for delete
  using (
    bucket_id = 'documents'
    and (
      public.is_admin()
      or (
        split_part(name, '/', 1) in (select f::text from public.current_user_allowed_family_ids() f(f))
        and coalesce(public.current_user_role(), '') <> 'partner'
      )
    )
  );

-- ROLLBACK (only if needed) ------------------------------------------------------------------------
-- 0: create or replace function public.caller_is_privileged() returns boolean language sql stable
--      security definer set search_path to 'public' as $$ select public.is_admin()
--      or current_user in ('service_role', 'postgres', 'supabase_admin'); $$;   (the broken original)
-- A: re-run the old bills_due_for_reminder body (without the access line);
--    grant execute on function public.dunning_due(date), public.capacity_report(),
--      public.licensing_report() to authenticated;
-- B: re-run the function above without the three new lines (email, family_cap, partner_kind).
-- C: drop policy documents_delete_own_families on storage.objects;
--    create policy documents_delete_own_families on storage.objects for delete using (
--      bucket_id = 'documents' and (public.is_admin() or split_part(name, '/', 1) in
--      (select f::text from public.current_user_allowed_family_ids() f(f))));
