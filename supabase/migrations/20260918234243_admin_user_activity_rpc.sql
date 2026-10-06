-- Exposes auth.users.last_sign_in_at to admin-gated client reads, for the "utilization" score
-- on the Signups & Revenue drill-down (SignupsRevenueView / user detail page in App.jsx).
-- The browser client cannot read auth.users directly (no RLS-friendly path to it), and this is
-- deliberately narrow: it returns only user_id + last_sign_in_at, nothing else from auth.users
-- (no email, no raw metadata), and only to a caller who is_admin() -- same admin check used
-- throughout this schema.
create or replace function public.admin_user_activity()
returns table(user_id uuid, last_sign_in_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  return query select u.id, u.last_sign_in_at from auth.users u;
end;
$function$;

grant execute on function public.admin_user_activity() to authenticated;

comment on function public.admin_user_activity() is
  'Admin-only. Returns auth.users(id, last_sign_in_at) for every user, for computing client utilization/activity scores in the admin Signups & Revenue drill-down. Nothing else from auth.users is exposed.';
