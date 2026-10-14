-- In-app plan change requests (2026-10-14).
--
-- Moves to or from Premier are arranged by the ORDANIS team, not by a self-serve button. Until now the
-- client's "Request Premier" button only opened an email, so nothing was recorded, nothing showed up for
-- an admin, and requests could be lost. This makes every such request a row with a status:
--
--   pending -> approved | declined | cancelled
--
-- * A household asks through request_plan_change(). The household is always the caller's own (from
--   their profile), never a parameter, so no one can file a request for someone else's household.
-- * At most one open request per household (partial unique index), so a double click or a second tab
--   cannot queue duplicates.
-- * Admins decide. Approval normally goes through the change-subscription-plan function, which moves
--   the Stripe subscription and then records the decision with billing = 'stripe'. A household with no
--   Stripe subscription (comped, firm-arranged, test) is approved with billing = 'no_billing', which
--   switches the plan only.
-- * Read access follows the existing household rules: admins see all, an Expert sees their own
--   households, the household sees its own, a firm admin sees its firm's households. Nobody writes the
--   table directly; only the functions below do.

create table if not exists public.plan_change_requests (
  id                 uuid primary key default gen_random_uuid(),
  family_id          uuid not null references public.families(id) on delete cascade,
  requested_by       uuid not null,
  requested_by_label text,
  from_plan          text not null,
  to_plan            text not null references public.plan_features(plan),
  note               text check (note is null or char_length(note) <= 1000),
  status             text not null default 'pending'
                       check (status in ('pending','approved','declined','cancelled')),
  billing            text check (billing is null or billing in ('stripe','no_billing')),
  decided_by         uuid,
  decided_by_label   text,
  decision_note      text check (decision_note is null or char_length(decision_note) <= 1000),
  decided_at         timestamptz,
  created_at         timestamptz not null default now()
);

create unique index if not exists plan_change_requests_one_open
  on public.plan_change_requests (family_id) where status = 'pending';
create index if not exists plan_change_requests_queue
  on public.plan_change_requests (status, created_at desc);
create index if not exists plan_change_requests_family
  on public.plan_change_requests (family_id, created_at desc);

alter table public.plan_change_requests enable row level security;
revoke all on public.plan_change_requests from anon, authenticated;
grant select on public.plan_change_requests to authenticated;

drop policy if exists plan_change_requests_read on public.plan_change_requests;
create policy plan_change_requests_read on public.plan_change_requests
  for select to authenticated
  using (
    public.is_admin()
    or family_id in (select public.current_user_allowed_family_ids())
    or family_id in (select public.current_user_firm_family_ids())
  );

-- Household asks for a plan change ----------------------------------------------------------------
create or replace function public.request_plan_change(p_to_plan text, p_note text default null)
 returns public.plan_change_requests
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_me   public.user_profiles;
  v_fam  public.families;
  v_row  public.plan_change_requests;
begin
  select * into v_me from public.user_profiles where id = auth.uid();
  if v_me.id is null or v_me.role <> 'client' or v_me.family_id is null then
    raise exception 'Only a household''s own login can request a plan change.';
  end if;
  select * into v_fam from public.families where id = v_me.family_id;
  if v_fam.id is null or v_fam.archived_at is not null then
    raise exception 'This household is not active.';
  end if;
  if not exists (select 1 from public.plan_features where plan = p_to_plan) then
    raise exception 'Unknown plan.';
  end if;
  if p_to_plan = v_fam.plan then
    raise exception 'You are already on that plan.';
  end if;
  if exists (select 1 from public.plan_change_requests where family_id = v_fam.id and status = 'pending') then
    raise exception 'You already have a plan request waiting. Cancel it first to ask for something different.';
  end if;

  insert into public.plan_change_requests (family_id, requested_by, requested_by_label, from_plan, to_plan, note)
  values (v_fam.id, v_me.id, coalesce(nullif(btrim(v_me.full_name), ''), v_me.email), v_fam.plan, p_to_plan,
          nullif(btrim(left(coalesce(p_note, ''), 1000)), ''))
  returning * into v_row;
  return v_row;
end;
$function$;

-- Household withdraws its own open request --------------------------------------------------------
create or replace function public.cancel_plan_change_request(p_id uuid)
 returns void
 language plpgsql security definer set search_path to 'public'
as $function$
begin
  update public.plan_change_requests r
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
   where r.id = p_id and r.status = 'pending'
     and r.family_id = (select family_id from public.user_profiles where id = auth.uid() and role = 'client');
  if not found then
    raise exception 'That request is no longer open.';
  end if;
end;
$function$;

-- Admin (or the change-subscription-plan function, as the service role) records the decision -------
-- p_status: 'approved' or 'declined'. p_billing: 'stripe' when change-subscription-plan already moved
-- the subscription, 'no_billing' to switch the plan without touching Stripe. Declines need no billing.
create or replace function public.decide_plan_change_request(
  p_id uuid, p_status text, p_note text default null, p_billing text default null)
 returns public.plan_change_requests
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_req public.plan_change_requests;
  v_label text;
begin
  if not public.caller_is_privileged() then
    raise exception 'Only an ORDANIS admin can decide plan requests.';
  end if;
  if p_status not in ('approved','declined') then
    raise exception 'Decision must be approved or declined.';
  end if;
  if p_status = 'approved' and coalesce(p_billing, '') not in ('stripe','no_billing') then
    raise exception 'An approval must say how it was billed (stripe or no_billing).';
  end if;

  select * into v_req from public.plan_change_requests where id = p_id for update;
  if v_req.id is null or v_req.status <> 'pending' then
    raise exception 'That request is no longer open.';
  end if;

  if p_status = 'approved' and p_billing = 'no_billing' then
    update public.families set plan = v_req.to_plan where id = v_req.family_id;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into v_label from public.user_profiles where id = auth.uid();
  update public.plan_change_requests
     set status = p_status,
         billing = case when p_status = 'approved' then p_billing end,
         decided_by = auth.uid(),
         decided_by_label = coalesce(v_label, 'ORDANIS team'),
         decision_note = nullif(btrim(left(coalesce(p_note, ''), 1000)), ''),
         decided_at = now()
   where id = p_id
  returning * into v_req;
  return v_req;
end;
$function$;

revoke execute on function public.request_plan_change(text, text)                     from public, anon;
revoke execute on function public.cancel_plan_change_request(uuid)                    from public, anon;
revoke execute on function public.decide_plan_change_request(uuid, text, text, text)  from public, anon;
grant  execute on function public.request_plan_change(text, text)                     to authenticated;
grant  execute on function public.cancel_plan_change_request(uuid)                    to authenticated;
grant  execute on function public.decide_plan_change_request(uuid, text, text, text)  to authenticated, service_role;

-- ROLLBACK: drop function public.decide_plan_change_request(uuid, text, text, text);
--           drop function public.cancel_plan_change_request(uuid);
--           drop function public.request_plan_change(text, text);
--           drop table public.plan_change_requests;
