-- Phase 7: the actions on a firm's page. Each is for an ORDANIS admin only (checked inside), changes the firm,
-- and writes one row to enterprise_membership_events, which nobody can edit from the app.

-- Rotate the firm's code. The old code stops working at once; existing members stay. Returns the new code.
create or replace function public.enterprise_rotate_code(p_enterprise_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_slug text; v_code text; v_try int := 0;
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  select e.slug into v_slug from public.enterprises e where e.id = p_enterprise_id for update;
  if not found then raise exception 'firm_not_found'; end if;
  loop
    v_code := public.generate_enterprise_code(v_slug);
    exit when not exists (select 1 from public.enterprises x where x.signup_code = v_code);
    v_try := v_try + 1;
    if v_try > 5 then raise exception 'code_generation_failed'; end if;
  end loop;
  update public.enterprises set signup_code = v_code, signup_code_rotated_at = now() where id = p_enterprise_id;
  insert into public.enterprise_membership_events (event_type, to_enterprise_id, actor_id, actor_role, consent_recorded, detail)
  values ('code_rotated', p_enterprise_id, auth.uid(), 'admin', false, '{}'::jsonb);
  return v_code;
end;
$function$;

-- Switch the firm on or off ('active'), or its code on or off ('code_active').
create or replace function public.enterprise_set_status(p_enterprise_id uuid, p_what text, p_value boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  if p_what not in ('active', 'code_active') then raise exception 'invalid_field'; end if;
  perform 1 from public.enterprises e where e.id = p_enterprise_id for update;
  if not found then raise exception 'firm_not_found'; end if;
  if p_what = 'active' then
    update public.enterprises set active = coalesce(p_value, false) where id = p_enterprise_id;
  else
    update public.enterprises set signup_code_active = coalesce(p_value, false) where id = p_enterprise_id;
  end if;
  insert into public.enterprise_membership_events (event_type, to_enterprise_id, actor_id, actor_role, consent_recorded, detail)
  values ('status_changed', p_enterprise_id, auth.uid(), 'admin', false,
          jsonb_build_object('field', p_what, 'value', coalesce(p_value, false)));
end;
$function$;

-- Set the firm's default Expert (a user with the advisor role), and optionally give that Expert to every
-- existing household in the firm. Households the Expert's cap refuses are listed, not silently skipped.
create or replace function public.enterprise_set_default_expert(p_enterprise_id uuid, p_email text, p_apply_existing boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_name text; v_applied int := 0; v_failed text[] := '{}'::text[]; f record;
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  perform 1 from public.enterprises e where e.id = p_enterprise_id for update;
  if not found then raise exception 'firm_not_found'; end if;
  if v_email is not null then
    select u.full_name into v_name from public.user_profiles u
     where lower(u.email) = v_email and u.role = 'advisor' and u.active is not false limit 1;
    if not found then raise exception 'expert_not_found'; end if;
  end if;

  update public.enterprises
     set default_expert_email = v_email, default_expert_set_by = auth.uid(), default_expert_set_at = now()
   where id = p_enterprise_id;

  if coalesce(p_apply_existing, false) and v_email is not null then
    for f in select x.id, x.name from public.families x
              where x.enterprise_id = p_enterprise_id and x.archived_at is null
                and lower(coalesce(x.advisor_email, '')) <> v_email loop
      begin
        update public.families set advisor_email = v_email, advisor_name = coalesce(v_name, advisor_name) where id = f.id;
        v_applied := v_applied + 1;
      exception when others then
        v_failed := array_append(v_failed, f.name::text);
      end;
    end loop;
  end if;

  insert into public.enterprise_membership_events (event_type, to_enterprise_id, actor_id, actor_role, consent_recorded, detail)
  values ('default_expert_set', p_enterprise_id, auth.uid(), 'admin', false,
          jsonb_build_object('expert_email', v_email, 'applied_to_existing', v_applied, 'could_not_apply', to_jsonb(v_failed)));
  return jsonb_build_object('expert_email', v_email, 'applied', v_applied, 'could_not_apply', to_jsonb(v_failed));
end;
$function$;

-- Link the firm to a skin and a domain (either may be cleared).
create or replace function public.enterprise_link_skin(p_enterprise_id uuid, p_brand_profile_id uuid, p_domain text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_domain text := nullif(lower(btrim(coalesce(p_domain, ''))), '');
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  perform 1 from public.enterprises e where e.id = p_enterprise_id for update;
  if not found then raise exception 'firm_not_found'; end if;
  if p_brand_profile_id is not null and not exists (select 1 from public.brand_profiles b where b.id = p_brand_profile_id) then
    raise exception 'skin_not_found';
  end if;
  update public.enterprises set brand_profile_id = p_brand_profile_id, domain = v_domain where id = p_enterprise_id;
  insert into public.enterprise_membership_events (event_type, to_enterprise_id, actor_id, actor_role, consent_recorded, detail)
  values ('skin_linked', p_enterprise_id, auth.uid(), 'admin', false,
          jsonb_strip_nulls(jsonb_build_object('brand_profile_id', p_brand_profile_id, 'domain', v_domain)));
end;
$function$;

revoke execute on function public.enterprise_rotate_code(uuid) from public, anon;
revoke execute on function public.enterprise_set_status(uuid, text, boolean) from public, anon;
revoke execute on function public.enterprise_set_default_expert(uuid, text, boolean) from public, anon;
revoke execute on function public.enterprise_link_skin(uuid, uuid, text) from public, anon;
grant execute on function public.enterprise_rotate_code(uuid) to authenticated, service_role;
grant execute on function public.enterprise_set_status(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.enterprise_set_default_expert(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.enterprise_link_skin(uuid, uuid, text) to authenticated, service_role;
