-- Phase 6: enterprise code and joining a firm.
-- A household enters a firm in exactly three ways: a new client signs up with the firm's code, a signed-in
-- client enters the code themselves, or an ORDANIS admin records that the client agreed. The functions below
-- are the only way in, and they are callable by the service role only (the edge functions), never from a
-- browser. Every join, move and removal writes one row to enterprise_membership_events.

-- 1. The data-sharing notice is stored the same way the signup disclosures are --------------------------
alter table public.signup_disclosures drop constraint if exists signup_disclosures_kind_check;
alter table public.signup_disclosures add constraint signup_disclosures_kind_check
  check (kind in ('subscription_terms', 'sms_consent', 'firm_data_sharing'));

-- Left as a DRAFT on purpose: joining stays closed until an ORDANIS admin has read the wording and
-- published it (set is_draft = false). The functions refuse to run without a published notice.
insert into public.signup_disclosures (kind, version, title, body_html, is_draft)
select 'firm_data_sharing', 1, 'What your firm can see',
  '<p>By entering a firm code you are joining that firm on ORDANIS. Joining lets the firm''s designated administrators <strong>view everything you can see in your household''s portal</strong> as the household owner: your household name and plan, the people on your account, your properties, portfolio and accounts, cash flow, valuables, tasks and workflows, notes, and the documents in your Vault.</p>'
  || '<p>They see nothing beyond what you can see yourself, and they have <strong>view access only</strong>. They cannot change, add or delete anything in your household.</p>'
  || '<p>Your plan, price and payment method do not change when you join. Your assigned ORDANIS Expert does not change unless an ORDANIS admin changes it. You can ask ORDANIS at any time to take your household out of the firm, and the firm''s access stops straight away.</p>',
  true
where not exists (select 1 from public.signup_disclosures where kind = 'firm_data_sharing' and version = 1);

-- 2. Every code attempt, for rate limiting and for spotting a leaked code -----------------------------------
create table if not exists public.enterprise_code_attempts (
  id uuid primary key default gen_random_uuid(),
  attempted_at timestamptz not null default now(),
  context text not null check (context in ('signup', 'signup_lookup', 'client_join', 'client_lookup')),
  ip text,
  user_id uuid,
  succeeded boolean not null,
  enterprise_id uuid
);
create index if not exists enterprise_code_attempts_ip_idx on public.enterprise_code_attempts (ip, attempted_at desc) where not succeeded;
create index if not exists enterprise_code_attempts_user_idx on public.enterprise_code_attempts (user_id, attempted_at desc) where not succeeded;
alter table public.enterprise_code_attempts enable row level security;
create policy enterprise_code_attempts_admin_select on public.enterprise_code_attempts
  for select to authenticated using (public.is_admin());
revoke all on table public.enterprise_code_attempts from anon;
revoke insert, update, delete, truncate on table public.enterprise_code_attempts from authenticated;

-- 3. Check a code. Wrong, expired, inactive and malformed codes are indistinguishable to the caller. ------
-- Eight failures from the same address or the same signed-in user in fifteen minutes blocks further tries.
create or replace function public.enterprise_check_code(p_code text, p_context text, p_ip text, p_user_id uuid default null)
returns table(enterprise_id uuid, enterprise_name text, blocked boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_norm text; v_fail int; v_ent public.enterprises%rowtype; v_found boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'not_allowed'; end if;
  if p_context not in ('signup', 'signup_lookup', 'client_join', 'client_lookup') then raise exception 'invalid_context'; end if;

  select count(*) into v_fail from public.enterprise_code_attempts a
   where not a.succeeded and a.attempted_at > now() - interval '15 minutes'
     and ((p_ip is not null and a.ip = p_ip) or (p_user_id is not null and a.user_id = p_user_id));
  if v_fail >= 8 then
    return query select null::uuid, null::text, true;
    return;
  end if;

  v_norm := upper(btrim(coalesce(p_code, '')));
  if length(v_norm) between 6 and 40 then
    select * into v_ent from public.enterprises e
     where e.signup_code = v_norm and e.signup_code_active and e.active;
    v_found := found;
  end if;

  insert into public.enterprise_code_attempts (context, ip, user_id, succeeded, enterprise_id)
  values (p_context, p_ip, p_user_id, v_found, case when v_found then v_ent.id else null end);

  if v_found then return query select v_ent.id, v_ent.name, false;
  else return query select null::uuid, null::text, false;
  end if;
end;
$function$;

-- 4. Put a household in a firm ---------------------------------------------------------------------------
-- p_how: signup_code (new client, payment just succeeded), client_join (signed-in client entered the code),
-- admin_move (an admin recorded that the client agreed), admin_created (the firm's team created it).
-- The first three require the client's agreement; the notice they saw is stored with the event.
create or replace function public.enterprise_join_family(
  p_family_id uuid, p_enterprise_id uuid, p_how text, p_actor uuid, p_consent boolean,
  p_consent_note text default null, p_disclosure_id uuid default null, p_apply_default_expert boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fam public.families%rowtype; v_ent public.enterprises%rowtype; v_from uuid;
  v_event uuid; v_actor_role text; v_expert text; v_expert_err text; v_type text;
begin
  if auth.role() <> 'service_role' then raise exception 'not_allowed'; end if;
  if p_how not in ('signup_code', 'client_join', 'admin_move', 'admin_created') then raise exception 'invalid_how'; end if;
  if p_how in ('signup_code', 'client_join', 'admin_move') then
    if not coalesce(p_consent, false) then raise exception 'consent_required'; end if;
    if p_disclosure_id is null and p_how <> 'admin_move' then raise exception 'notice_required'; end if;
  end if;
  if p_disclosure_id is not null and not exists (
       select 1 from public.signup_disclosures d where d.id = p_disclosure_id and d.kind = 'firm_data_sharing' and not d.is_draft) then
    raise exception 'notice_not_published';
  end if;

  perform pg_advisory_xact_lock(hashtext('entjoin:' || p_family_id::text));
  select * into v_fam from public.families where id = p_family_id for update;
  if not found then raise exception 'household_not_found'; end if;
  if v_fam.archived_at is not null then raise exception 'household_archived'; end if;
  select * into v_ent from public.enterprises where id = p_enterprise_id;
  if not found or not v_ent.active then raise exception 'firm_not_available'; end if;

  v_from := v_fam.enterprise_id;
  if v_from = p_enterprise_id then
    return jsonb_build_object('status', 'already_member', 'firm_name', v_ent.name, 'family_name', v_fam.name, 'plan', v_fam.plan);
  end if;
  if v_from is not null and p_how <> 'admin_move' then raise exception 'already_in_a_firm'; end if;
  -- A firm-paid household has no card of its own, so moving it would silently change who is billed.
  if v_fam.paid_by = 'enterprise' then raise exception 'household_is_paid_by_firm'; end if;

  update public.families
     set enterprise_id = p_enterprise_id, joined_enterprise_at = now(), joined_via = p_how
   where id = p_family_id;
  update public.user_profiles set enterprise_id = p_enterprise_id
   where family_id = p_family_id and role = 'client';

  if p_apply_default_expert and v_ent.default_expert_email is not null then
    begin
      update public.families
         set advisor_email = v_ent.default_expert_email,
             advisor_name = coalesce((select u.full_name from public.user_profiles u
                                       where lower(u.email) = lower(v_ent.default_expert_email) limit 1), advisor_name)
       where id = p_family_id;
      v_expert := v_ent.default_expert_email;
    exception when others then
      v_expert_err := left(sqlerrm, 200);
    end;
  end if;

  select u.role into v_actor_role from public.user_profiles u where u.id = p_actor;
  v_type := case when v_from is null then 'joined' else 'moved' end;
  insert into public.enterprise_membership_events
    (event_type, how, family_id, family_name, user_id, from_enterprise_id, to_enterprise_id, actor_id, actor_role,
     consent_recorded, consent_note, detail)
  values (v_type, p_how, p_family_id, v_fam.name, null, v_from, p_enterprise_id, p_actor, coalesce(v_actor_role, 'system'),
          coalesce(p_consent, false), p_consent_note,
          jsonb_strip_nulls(jsonb_build_object('notice_id', p_disclosure_id, 'default_expert', v_expert,
                                               'default_expert_error', v_expert_err, 'plan', v_fam.plan)))
  returning id into v_event;

  return jsonb_build_object('status', v_type, 'event_id', v_event, 'firm_name', v_ent.name, 'family_name', v_fam.name,
                            'plan', v_fam.plan, 'from_enterprise_id', v_from, 'default_expert', v_expert,
                            'default_expert_error', v_expert_err);
end;
$function$;

-- 5. Take a household out of its firm (an ORDANIS admin only; the edge function checks the role) ----------
create or replace function public.enterprise_remove_family(p_family_id uuid, p_actor uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_fam public.families%rowtype; v_event uuid; v_actor_role text; v_name text;
begin
  if auth.role() <> 'service_role' then raise exception 'not_allowed'; end if;
  perform pg_advisory_xact_lock(hashtext('entjoin:' || p_family_id::text));
  select * into v_fam from public.families where id = p_family_id for update;
  if not found then raise exception 'household_not_found'; end if;
  if v_fam.enterprise_id is null then raise exception 'not_in_a_firm'; end if;
  if v_fam.paid_by = 'enterprise' then raise exception 'household_is_paid_by_firm'; end if;
  select e.name into v_name from public.enterprises e where e.id = v_fam.enterprise_id;

  update public.families set enterprise_id = null, joined_enterprise_at = null, joined_via = null where id = p_family_id;
  update public.user_profiles set enterprise_id = null where family_id = p_family_id and role = 'client';

  select u.role into v_actor_role from public.user_profiles u where u.id = p_actor;
  insert into public.enterprise_membership_events
    (event_type, how, family_id, family_name, from_enterprise_id, to_enterprise_id, actor_id, actor_role, consent_recorded, consent_note, detail)
  values ('removed', null, p_family_id, v_fam.name, v_fam.enterprise_id, null, p_actor, coalesce(v_actor_role, 'system'), false, p_note,
          jsonb_build_object('plan', v_fam.plan))
  returning id into v_event;
  return jsonb_build_object('status', 'removed', 'event_id', v_event, 'firm_name', v_name, 'family_name', v_fam.name);
end;
$function$;

-- 6. Grants ------------------------------------------------------------------------------------------------
revoke execute on function public.enterprise_check_code(text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.enterprise_join_family(uuid, uuid, text, uuid, boolean, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.enterprise_remove_family(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.enterprise_check_code(text, text, text, uuid) to service_role;
grant execute on function public.enterprise_join_family(uuid, uuid, text, uuid, boolean, text, uuid, boolean) to service_role;
grant execute on function public.enterprise_remove_family(uuid, uuid, text) to service_role;
