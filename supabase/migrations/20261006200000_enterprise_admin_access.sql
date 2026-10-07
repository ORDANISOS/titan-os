-- Enterprise admin access (phase 3 of the ORDANIS Multi-Enterprise Plan).
--
-- Design: the enterprise_admin role gets NO direct table access. It reads through four
-- SECURITY DEFINER functions that return a fixed set of columns for its own enterprise only.
-- current_user_allowed_family_ids() is deliberately left unchanged: about twenty write
-- policies are written as "allowed household and not a partner", so adding the new role to
-- that function would have handed it write access on all of them, and direct reads of the
-- families table would expose Stripe ids and private Expert notes.
--
-- Also closes a gap the role would otherwise inherit: the two profile-protection triggers only
-- cover UPDATE, while the self_or_admin_insert policy lets a signed-in user insert their own
-- profile row. handle_new_user() creates every new user as a client, so the gap only opens
-- for a user whose profile row is missing, but a missing row would let that user insert
-- themselves with any role. A BEFORE INSERT guard now allows only plain client rows unless the
-- caller is an admin or the service role.

create or replace function public.guard_user_profile_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if new.role is distinct from 'client'
     or new.family_id is not null
     or new.enterprise_id is not null
     or coalesce(new.can_run_scheduled_prompts, false)
     or new.partner_kind is not null then
    raise exception 'Only admins can create a profile with that role or scope';
  end if;
  return new;
end;
$$;

create trigger trg_guard_user_profile_insert
  before insert on public.user_profiles
  for each row execute function public.guard_user_profile_insert();

revoke all on function public.guard_user_profile_insert() from public, anon, authenticated;

-- Scheduled prompts can be written by any non-partner user for themselves. The enterprise
-- admin is read-only, so it is excluded.
alter policy write_access on public.scheduled_prompts
  using (
    public.is_admin()
    or (owner_user_id = auth.uid()
        and (current_user_role() <> 'partner' or current_user_can_run_prompts())
        and not public.is_enterprise_admin())
  )
  with check (
    public.is_admin()
    or (owner_user_id = auth.uid()
        and (current_user_role() <> 'partner' or current_user_can_run_prompts())
        and not public.is_enterprise_admin())
  );

-- The households of the caller's enterprise. Empty for anyone who is not an active
-- enterprise admin, so a wrong role or a missing enterprise returns nothing.
create or replace function public.enterprise_household_list()
returns table (
  family_id            uuid,
  name                 text,
  customer_number      integer,
  plan                 text,
  subscription_state   text,
  expert_name          text,
  joined_enterprise_at timestamptz,
  joined_via           text,
  created_at           timestamptz,
  archived_at          timestamptz,
  user_count           integer
)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.customer_number, f.plan, f.subscription_state::text, f.advisor_name,
         f.joined_enterprise_at, f.joined_via, f.created_at, f.archived_at,
         (select count(*)::int from public.user_profiles u where u.family_id = f.id)
  from public.families f
  where public.is_enterprise_admin()
    and f.enterprise_id = public.current_user_enterprise_id()
  order by f.name;
$$;

-- The users of the caller's enterprise: its own enterprise admins and the people in its
-- households. No role changes, caps or prompt counters.
create or replace function public.enterprise_user_list()
returns table (
  user_id     uuid,
  email       text,
  full_name   text,
  role        text,
  active      boolean,
  created_at  timestamptz,
  family_id   uuid
)
language sql stable security definer set search_path = public as $$
  select u.id, u.email, u.full_name, u.role, u.active, u.created_at, u.family_id
  from public.user_profiles u
  where public.is_enterprise_admin()
    and (
      u.enterprise_id = public.current_user_enterprise_id()
      or u.family_id in (select f.id from public.families f where f.enterprise_id = public.current_user_enterprise_id())
    )
  order by u.full_name nulls last, u.email;
$$;

-- Task counts per household. Counts only: task titles can hold private client detail.
create or replace function public.enterprise_task_summary()
returns table (
  family_id       uuid,
  open_tasks      integer,
  overdue_tasks   integer,
  completed_30d   integer
)
language sql stable security definer set search_path = public as $$
  select f.id,
         (count(t.id) filter (where not coalesce(t.done, false)))::int,
         (count(t.id) filter (where not coalesce(t.done, false) and t.due_date < current_date))::int,
         (count(t.id) filter (where coalesce(t.done, false) and t.completed_at >= now() - interval '30 days'))::int
  from public.families f
  left join public.tasks t on t.family_id = f.id
  where public.is_enterprise_admin()
    and f.enterprise_id = public.current_user_enterprise_id()
  group by f.id;
$$;

-- Workflow counts per household and status, with the next due date. No risk notes.
create or replace function public.enterprise_workflow_summary()
returns table (
  family_id  uuid,
  status     text,
  instances  integer,
  next_due   date
)
language sql stable security definer set search_path = public as $$
  select w.family_id, w.status::text, count(*)::int, min(w.due_date)
  from public.workflow_instances w
  join public.families f on f.id = w.family_id
  where public.is_enterprise_admin()
    and f.enterprise_id = public.current_user_enterprise_id()
  group by w.family_id, w.status;
$$;

revoke all on function public.enterprise_household_list()   from public, anon;
revoke all on function public.enterprise_user_list()        from public, anon;
revoke all on function public.enterprise_task_summary()     from public, anon;
revoke all on function public.enterprise_workflow_summary() from public, anon;
grant execute on function public.enterprise_household_list()   to authenticated;
grant execute on function public.enterprise_user_list()        to authenticated;
grant execute on function public.enterprise_task_summary()     to authenticated;
grant execute on function public.enterprise_workflow_summary() to authenticated;
