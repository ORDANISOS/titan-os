-- Self-tracked bill payments for Basic and Core (2026-10-20, Will's decision).
--
-- cash_flow_payment_log is the per-period "paid" register for recurring expenses (Jan paid, Feb paid ...).
-- Until now it refused EVERY row for a household whose plan lacks bill_pay, because the register only
-- existed for bills ORDANIS pays on the household's behalf (cash_flow_events.pcm_responsible, Premier).
-- Basic and Core are self-service and need to tick off the bills they pay themselves.
--
-- New rule, the same line the cash_flow_events trigger (refuse_billpay_when_core) already draws:
-- refuse only when the expense is marked as ours to pay (pcm_responsible) and the plan has no bill pay.
-- A household's own bills can be marked paid on any plan. Bill pay itself stays Premier: no
-- Basic/Core expense can carry pcm_responsible, because refuse_billpay_when_core still refuses it.
--
-- No new tables, no grant changes, RLS unchanged (write_access already scopes rows to the household).
--
-- Rollback: re-create the previous body (kept below, commented out).

create or replace function public.refuse_payment_log_when_core()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare fid uuid; v_pcm boolean; v_label text;
begin
  select family_id, pcm_responsible into fid, v_pcm from public.cash_flow_events where id = new.event_id;
  fid := coalesce(fid, new.family_id);
  -- The household's own bill: always allowed to be marked paid.
  if v_pcm is not true then return new; end if;
  -- A bill ORDANIS pays (bill pay): only on a plan that includes bill pay.
  if public.plan_allows(fid, 'bill_pay') then return new; end if;
  select pf.label into v_label
    from public.families f join public.plan_features pf on pf.plan = f.plan
   where f.id = fid;
  raise exception
    'This household is on the % plan, which does not include bill pay.',
    coalesce(v_label,'current') using errcode = 'check_violation';
end; $function$;

-- Previous body (for rollback):
-- create or replace function public.refuse_payment_log_when_core()
--  returns trigger language plpgsql security definer set search_path to 'public'
-- as $function$
-- declare fid uuid; v_label text;
-- begin
--   select family_id into fid from public.cash_flow_events where id = new.event_id;
--   fid := coalesce(fid, new.family_id);
--   if public.plan_allows(fid, 'bill_pay') then return new; end if;
--   select pf.label into v_label
--     from public.families f join public.plan_features pf on pf.plan = f.plan
--    where f.id = fid;
--   raise exception
--     'This household is on the % plan, which does not include bill pay.',
--     coalesce(v_label,'current') using errcode = 'check_violation';
-- end; $function$;
