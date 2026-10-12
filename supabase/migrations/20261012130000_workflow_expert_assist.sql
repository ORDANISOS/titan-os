-- 20261012130000_workflow_expert_assist.sql
-- Core households can ask for an ORDANIS Expert to work a single workflow for a one-time $25.
-- The price lives on the plan (plan_features.expert_assist_price) so it can change without a deploy;
-- null means the plan does not offer it. The per-workflow columns are written ONLY by the
-- request-expert-assist edge function (service role), after the card has been charged, so a browser
-- cannot mark a workflow as expert-assisted without paying.

alter table public.plan_features add column if not exists expert_assist_price numeric;
comment on column public.plan_features.expert_assist_price is
  'One-time price (USD) to have an ORDANIS Expert work a single workflow on this plan. Null = not offered.';
update public.plan_features set expert_assist_price = 25 where plan = 'core' and expert_assist_price is null;

alter table public.workflow_instances
  add column if not exists expert_assisted boolean not null default false,
  add column if not exists expert_fee numeric,
  add column if not exists expert_requested_at timestamptz,
  add column if not exists expert_requested_by uuid,
  add column if not exists expert_stripe_invoice_id text;

create or replace function public.workflow_instances_guard_expert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Direct SQL (no JWT) and the service role are allowed; anyone signed in through the app is not.
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    if tg_op = 'INSERT' then
      if new.expert_assisted or new.expert_fee is not null or new.expert_requested_at is not null
         or new.expert_requested_by is not null or new.expert_stripe_invoice_id is not null then
        raise exception 'expert_assist_server_only';
      end if;
    elsif new.expert_assisted is distinct from old.expert_assisted
       or new.expert_fee is distinct from old.expert_fee
       or new.expert_requested_at is distinct from old.expert_requested_at
       or new.expert_requested_by is distinct from old.expert_requested_by
       or new.expert_stripe_invoice_id is distinct from old.expert_stripe_invoice_id then
      raise exception 'expert_assist_server_only';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists workflow_instances_guard_expert on public.workflow_instances;
create trigger workflow_instances_guard_expert
  before insert or update on public.workflow_instances
  for each row execute function public.workflow_instances_guard_expert();
