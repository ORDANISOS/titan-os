-- ─────────────────────────────────────────────────────────────────────────────
-- Storage quota enforcement.
--
-- storage_bytes has been defined per tier since the tier work and nothing has
-- ever read it, so an upload over quota succeeds today.
--
-- Design note: the running total is MAINTAINED on families rather than summed on
-- every upload. Summing storage.objects per insert is fine at 18 documents and
-- becomes a table scan on every upload at scale - and the failure mode of that is
-- uploads getting slower until someone notices.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.families
  add column if not exists storage_used_bytes bigint not null default 0;
comment on column public.families.storage_used_bytes is
  'Running total, maintained by a trigger on storage.objects. Recomputable with recalc_family_storage().';

-- The authority on what a household may hold.
create or replace function public.family_storage_quota(p_family_id uuid)
returns bigint language sql stable security definer set search_path to 'public'
as $function$
  select pf.storage_bytes from families f
    join plan_features pf on pf.plan = f.plan
   where f.id = p_family_id;
$function$;

-- What the UI shows. Null quota means unlimited, and is reported honestly.
create or replace function public.family_storage_status(p_family_id uuid)
returns table(used_bytes bigint, quota_bytes bigint, used_gb numeric, quota_gb numeric,
              pct_used numeric, remaining_bytes bigint, state text, message text)
language sql stable security definer set search_path to 'public'
as $function$
  select f.storage_used_bytes, pf.storage_bytes,
         round(f.storage_used_bytes/1073741824.0, 2),
         round(pf.storage_bytes/1073741824.0, 2),
         case when pf.storage_bytes is null or pf.storage_bytes = 0 then null
              else round(100.0*f.storage_used_bytes/pf.storage_bytes, 1) end,
         case when pf.storage_bytes is null then null
              else greatest(0, pf.storage_bytes - f.storage_used_bytes) end,
         case when pf.storage_bytes is null then 'unlimited'
              when f.storage_used_bytes >= pf.storage_bytes then 'full'
              when f.storage_used_bytes >= pf.storage_bytes*0.9 then 'nearly full'
              when f.storage_used_bytes >= pf.storage_bytes*0.75 then 'filling up'
              else 'fine' end,
         case when pf.storage_bytes is null then 'No storage limit on this plan.'
              when f.storage_used_bytes >= pf.storage_bytes then
                'Storage is full. Nothing more can be uploaded until something is removed, or the plan changes.'
              when f.storage_used_bytes >= pf.storage_bytes*0.9 then
                'Under ten percent left. Worth sorting before it stops accepting uploads.'
              else null end
    from families f join plan_features pf on pf.plan = f.plan
   where f.id = p_family_id
     and (caller_is_privileged() or f.id in (select current_user_allowed_family_ids()));
$function$;
revoke execute on function public.family_storage_status(uuid) from public, anon;
grant execute on function public.family_storage_status(uuid) to authenticated, service_role;

-- Rebuild the total from the objects themselves. The trigger keeps it right; this
-- exists because a maintained counter that cannot be recomputed is a liability.
create or replace function public.recalc_family_storage(p_family_id uuid default null)
returns table(family_id uuid, bytes bigint)
language plpgsql security definer set search_path to 'public','storage'
as $function$
begin
  if not caller_is_privileged() then raise exception 'not permitted'; end if;
  update families f set storage_used_bytes = coalesce((
      select sum((o.metadata->>'size')::bigint) from storage.objects o
       where o.bucket_id = 'documents'
         and split_part(o.name, '/', 1) = f.id::text), 0)
   where p_family_id is null or f.id = p_family_id;
  return query select f.id, f.storage_used_bytes from families f
    where p_family_id is null or f.id = p_family_id;
end;
$function$;
revoke execute on function public.recalc_family_storage(uuid) from public, anon;
grant execute on function public.recalc_family_storage(uuid) to service_role;

-- Refuse the upload BEFORE the bytes land, and keep the counter true after.
create or replace function public.enforce_storage_quota()
returns trigger language plpgsql security definer set search_path to 'public','storage'
as $function$
declare v_family uuid; v_size bigint; v_quota bigint; v_used bigint;
begin
  if new.bucket_id <> 'documents' then return new; end if;
  begin v_family := split_part(new.name,'/',1)::uuid;
  exception when others then return new;   -- not a family-scoped path
  end;
  select pf.storage_bytes, f.storage_used_bytes into v_quota, v_used
    from families f join plan_features pf on pf.plan = f.plan where f.id = v_family;
  if v_quota is null then return new; end if;   -- unlimited plan
  v_size := coalesce((new.metadata->>'size')::bigint, 0);
  if v_used + v_size > v_quota then
    raise exception using
      errcode = 'P0001',
      message = format('Storage full: this household has %s of %s used. Remove something, or move to a plan with more room.',
                       pg_size_pretty(v_used), pg_size_pretty(v_quota));
  end if;
  return new;
end;
$function$;

create or replace function public.track_storage_usage()
returns trigger language plpgsql security definer set search_path to 'public','storage'
as $function$
declare v_family uuid; v_delta bigint;
begin
  if tg_op = 'INSERT' then
    if new.bucket_id <> 'documents' then return new; end if;
    begin v_family := split_part(new.name,'/',1)::uuid; exception when others then return new; end;
    v_delta := coalesce((new.metadata->>'size')::bigint, 0);
  elsif tg_op = 'DELETE' then
    if old.bucket_id <> 'documents' then return old; end if;
    begin v_family := split_part(old.name,'/',1)::uuid; exception when others then return old; end;
    v_delta := -coalesce((old.metadata->>'size')::bigint, 0);
  else
    return coalesce(new, old);
  end if;
  update families set storage_used_bytes = greatest(0, storage_used_bytes + v_delta)
   where id = v_family;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists trg_enforce_storage_quota on storage.objects;
create trigger trg_enforce_storage_quota
  before insert on storage.objects
  for each row execute function public.enforce_storage_quota();

drop trigger if exists trg_track_storage_usage on storage.objects;
create trigger trg_track_storage_usage
  after insert or delete on storage.objects
  for each row execute function public.track_storage_usage();

select * from public.recalc_family_storage();