create or replace function public.family_payer_info(p_family_id uuid)
returns table(paid_by text, firm_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select f.paid_by::text, case when f.paid_by = 'enterprise' then e.name else null end
    from public.families f
    left join public.enterprises e on e.id = f.enterprise_id
   where f.id = p_family_id
     and (public.is_admin() or p_family_id in (select public.current_user_allowed_family_ids()));
$function$;

revoke execute on function public.family_payer_info(uuid) from public, anon;
grant execute on function public.family_payer_info(uuid) to authenticated, service_role;
