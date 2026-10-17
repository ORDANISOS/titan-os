-- Two-step sign-in (TOTP) support for the portal (2026-10-17).
-- The portal now asks staff (admin, Expert, Analyst, partner, firm administrator) to set up an authenticator
-- at sign-in, and lets clients turn it on. These two admin functions back the Users screen:
--   admin_mfa_users()          which logins have a verified authenticator (shows "2-step on").
--   admin_reset_mfa(user_id)   for a lost phone: removes that person's authenticators and signs them out
--                              everywhere, so they set it up again at their next sign-in. Admins only, from a
--                              session that itself passed two-step sign-in, never on their own login. Logged
--                              to audit_log.

create or replace function public.admin_mfa_users()
 returns table(user_id uuid)
 language sql stable security definer set search_path to ''
as $function$
  select f.user_id
    from auth.mfa_factors f
   where f.status = 'verified' and public.is_admin()
   group by f.user_id;
$function$;
revoke execute on function public.admin_mfa_users() from public, anon;
grant execute on function public.admin_mfa_users() to authenticated;

create or replace function public.admin_reset_mfa(p_user_id uuid)
 returns integer
 language plpgsql security definer set search_path to ''
as $function$
declare
  v_n int;
  v_email text;
begin
  if not public.is_admin() then
    raise exception 'Only ORDANIS admins can reset two-step sign-in.' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Sign in with your own two-step code first.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t reset your own two-step sign-in. Ask another admin.' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then raise exception 'No such user.' using errcode = 'P0002'; end if;

  delete from auth.mfa_factors where user_id = p_user_id;
  get diagnostics v_n = row_count;
  delete from auth.sessions where user_id = p_user_id; -- signed out everywhere

  insert into public.audit_log (request_id, user_id, user_email, user_role, aal, source, module, command, tool_calls, result_summary, status)
  values (pg_catalog.gen_random_uuid(), auth.uid(), auth.jwt() ->> 'email', 'admin', 'aal2', 'portal', 'security',
          'reset two-step sign-in', '[]'::jsonb,
          format('Removed %s authenticator(s) for %s and signed them out everywhere', v_n, v_email), 'ok');
  return v_n;
end;
$function$;
revoke execute on function public.admin_reset_mfa(uuid) from public, anon;
grant execute on function public.admin_reset_mfa(uuid) to authenticated;

-- ROLLBACK: drop function if exists public.admin_reset_mfa(uuid); drop function if exists public.admin_mfa_users();
