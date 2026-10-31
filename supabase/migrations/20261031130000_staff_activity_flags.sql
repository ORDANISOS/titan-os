-- Scaling step 2, part 4: Signups & Revenue's "Platform Utilization" needs to know, per household, whether it has
-- anything in each feature area. It used to work that out from the full download of every table. This returns just
-- the yes/no answers, one row per household the caller can see.
--
-- SECURITY INVOKER: runs as the signed-in person, so the existing row-level rules decide which households appear.
-- Signed-out callers cannot execute it.

create or replace function public.staff_family_activity_flags()
returns table (
  family_id uuid,
  has_properties boolean,
  has_accounts boolean,
  has_valuables boolean,
  has_documents boolean,
  has_tasks boolean,
  has_notes boolean,
  has_billpay boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select f.id,
    exists (select 1 from properties x where x.family_id = f.id),
    exists (select 1 from portfolio_accounts x where x.family_id = f.id),
    exists (select 1 from valuables x where x.family_id = f.id),
    exists (select 1 from documents x where x.family_id = f.id),
    exists (select 1 from tasks x where x.family_id = f.id),
    exists (select 1 from notes x where x.family_id = f.id),
    exists (select 1 from cash_flow_events x where x.family_id = f.id and x.pcm_responsible)
  from families f
  order by f.id;
$$;

revoke execute on function public.staff_family_activity_flags() from public, anon;
grant execute on function public.staff_family_activity_flags() to authenticated;
