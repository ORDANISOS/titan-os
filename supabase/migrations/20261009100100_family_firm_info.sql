-- Phase 6: lets a household (or an ORDANIS admin) see which firm the household belongs to, when and how it
-- joined. family_payer_info only names the firm when the firm pays, so it cannot answer this.
-- Read-only. Returns one row for a household the caller may see, none otherwise. Shows no firm financials.
create or replace function public.family_firm_info(p_family_id uuid)
returns table(firm_name text, joined_at timestamptz, joined_via text, paid_by text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select e.name, f.joined_enterprise_at, f.joined_via::text, f.paid_by::text
    from public.families f
    left join public.enterprises e on e.id = f.enterprise_id
   where f.id = p_family_id
     and (public.is_admin() or p_family_id in (select public.current_user_allowed_family_ids()));
$function$;

revoke execute on function public.family_firm_info(uuid) from public, anon;
grant execute on function public.family_firm_info(uuid) to authenticated, service_role;
