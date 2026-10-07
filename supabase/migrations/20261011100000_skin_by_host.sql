-- Phase 4: which skin (brand) a person sees.
--
-- Before sign-in, the address the app is opened on decides: an enterprise that has its own domain gets
-- its own skin, and any other address gets the default (active) skin. After sign-in, the person's own
-- firm decides, whatever address they came from. The sign-up page also takes the skin of a firm code.
--
-- Everything here is additive. The skin table itself is not touched; the app and the AI assistant read
-- the skin through these functions, which return only the public fields (name, tagline, logo, colours,
-- app address). Fee defaults and internal notes are never returned to the public. A separate migration
-- (20261011100100_skin_tighten.sql) then closes the direct read of the skin table, and is applied only
-- after the new app is live.

create or replace function public.brand_public_json(p public.brand_profiles)
returns jsonb language sql immutable set search_path to 'public' as $function$
  select jsonb_build_object(
    'id', p.id, 'label', p.label, 'is_active', p.is_active, 'updated_at', p.updated_at,
    'brand_name', p.brand_name, 'brand_short', p.brand_short, 'tagline', p.tagline,
    'contact_email', p.contact_email, 'email_domain', p.email_domain,
    'logo_url', p.logo_url, 'mark_url', p.mark_url, 'favicon_url', p.favicon_url, 'app_url', p.app_url,
    'color_primary', p.color_primary, 'color_primary_mid', p.color_primary_mid,
    'color_accent', p.color_accent, 'color_accent_light', p.color_accent_light,
    'color_bg', p.color_bg, 'color_border', p.color_border, 'color_border_light', p.color_border_light,
    'color_text_soft', p.color_text_soft, 'color_text_mute', p.color_text_mute);
$function$;
revoke execute on function public.brand_public_json(public.brand_profiles) from public, anon, authenticated;

-- The skin that applies to the signed-in caller: their firm's, else the default.
create or replace function public.current_skin_id()
returns uuid language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    (select e.brand_profile_id from public.enterprises e
      where e.id = coalesce(
        (select up.enterprise_id from public.user_profiles up where up.id = auth.uid()),
        (select f.enterprise_id from public.user_profiles up join public.families f on f.id = up.family_id where up.id = auth.uid()))
        and e.active is not false),
    (select p.id from public.brand_profiles p where p.is_active limit 1));
$function$;
revoke execute on function public.current_skin_id() from public, anon;
grant execute on function public.current_skin_id() to authenticated, service_role;

-- Before sign-in: the skin of the enterprise that owns this address, or null when none does.
create or replace function public.brand_for_host(p_host text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select public.brand_public_json(p)
    from public.enterprises e join public.brand_profiles p on p.id = e.brand_profile_id
   where e.active is not false and e.domain is not null
     and lower(e.domain) = lower(btrim(coalesce(p_host, '')))
   limit 1;
$function$;
revoke execute on function public.brand_for_host(text) from public;
grant execute on function public.brand_for_host(text) to anon, authenticated, service_role;

create or replace function public.brand_default()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select public.brand_public_json(p) from public.brand_profiles p where p.is_active limit 1;
$function$;
revoke execute on function public.brand_default() from public;
grant execute on function public.brand_default() to anon, authenticated, service_role;

create or replace function public.brand_for_user()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select public.brand_public_json(p) from public.brand_profiles p where p.id = public.current_skin_id();
$function$;
revoke execute on function public.brand_for_user() from public, anon;
grant execute on function public.brand_for_user() to authenticated, service_role;

-- Used by the sign-up function so a firm code shows the firm's own skin. Service role only.
create or replace function public.brand_for_enterprise(p_enterprise_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not_allowed'; end if;
  select public.brand_public_json(p) into v
    from public.enterprises e join public.brand_profiles p on p.id = e.brand_profile_id
   where e.id = p_enterprise_id;
  return coalesce(v, public.brand_default());
end;
$function$;
revoke execute on function public.brand_for_enterprise(uuid) from public, anon, authenticated;
grant execute on function public.brand_for_enterprise(uuid) to service_role;

-- The caller's own skin's settings. Fee defaults only for staff; the property-cost switch and the AI
-- investment policy apply to everyone using that skin.
create or replace function public.my_firm_defaults()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'derive_property_costs', p.derive_property_costs,
    'ai_investment_policy', p.ai_investment_policy,
    'default_monthly_fee', case when (select role from public.user_profiles where id = auth.uid()) in ('admin','advisor') then p.default_monthly_fee end,
    'default_onboarding_fee', case when (select role from public.user_profiles where id = auth.uid()) in ('admin','advisor') then p.default_onboarding_fee end)
  from public.brand_profiles p where p.id = public.current_skin_id();
$function$;
revoke execute on function public.my_firm_defaults() from public, anon;
grant execute on function public.my_firm_defaults() to authenticated, service_role;

-- Document templates now follow the caller's skin, not whichever skin is marked active.
create or replace function public.active_brand_documents()
returns table(doc_key text, storage_path text, original_filename text, field_names text[], missing_fields text[], uploaded_at timestamptz, is_project_default boolean)
language sql stable security definer set search_path to 'public' as $function$
  select distinct on (d.doc_key)
         d.doc_key, d.storage_path, d.original_filename, d.field_names, d.missing_fields, d.uploaded_at, d.brand_profile_id is null
    from public.brand_documents d
   where d.brand_profile_id is null
      or d.brand_profile_id = public.current_skin_id()
   order by d.doc_key, (d.brand_profile_id is null);
$function$;
