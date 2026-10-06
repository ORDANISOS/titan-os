-- ─────────────────────────────────────────────────────────────────────────────
-- The annual state-rule review agent.
--
-- The agent PROPOSES. A person APPROVES. It never writes to state_rules and it
-- never stamps verified_on.
--
-- This is not caution for its own sake. An AI reading a state website can misread
-- a tiered fee schedule, land on a page for a different entity type, read a cached
-- page, or produce a plausible number from nothing - and every one of those
-- failures is silent. An agent with write access would industrialise the exact
-- problem state_rules exists to prevent: a wrong figure wearing a citation.
--
-- So it does the tedious part - visiting fifty states, four topics each, once a
-- year - and leaves the judgement to a person. The same bargain the workflows make.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.state_rule_proposals (
  id             uuid primary key default gen_random_uuid(),
  rule_id        uuid references public.state_rules(id) on delete cascade,
  state_code     text not null,
  topic          text not null,
  applies_to     text,

  current_value  text,
  proposed_value text,
  proposed_numeric numeric(14,2),
  proposed_date_rule text,
  proposed_detail text,

  finding        text not null,
  evidence       text,
  source_url     text,
  agent_confidence text,

  status         text not null default 'pending',
  reviewed_by    text,
  reviewed_at    timestamptz,
  reviewer_note  text,

  run_id         uuid,
  created_at     timestamptz not null default now(),

  constraint srp_finding_check check (finding in
    ('unchanged','changed','source_moved','source_unreachable','ambiguous','new_fact')),
  constraint srp_status_check check (status in
    ('pending','approved','rejected','needs_research')),
  constraint srp_conf_check check (agent_confidence is null or agent_confidence in
    ('high','medium','low'))
);
comment on table public.state_rule_proposals is
  'What the review agent found. Nothing here is fact until a person approves it. finding=unchanged still requires approval, because "I checked and nothing moved" is itself a claim that stamps a verification date.';

create index if not exists srp_pending_idx on public.state_rule_proposals (status, state_code)
  where status = 'pending';
create index if not exists srp_run_idx on public.state_rule_proposals (run_id);

alter table public.state_rule_proposals enable row level security;
drop policy if exists admin_all on public.state_rule_proposals;
create policy admin_all on public.state_rule_proposals for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- What the agent should go and look at on this run.
create or replace function public.state_rules_review_queue(p_limit integer default 200)
returns table(rule_id uuid, state_code text, topic text, applies_to text,
              current_value text, source_url text, source_name text,
              verified_on date, why text)
language sql stable security definer set search_path to 'public'
as $function$
  select r.id, r.state_code, r.topic, r.applies_to, r.value_text, r.source_url,
         r.source_name, r.verified_on,
         case when r.verified_on is null then 'never verified'
              else 'last verified ' || r.verified_on end
    from state_rules r
   where caller_is_privileged()
     and (r.verified_on is null or r.verified_on < current_date - (r.review_months * 30))
     and not exists (select 1 from state_rule_proposals p
                     where p.rule_id = r.id and p.status = 'pending')
   order by r.verified_on nulls first, r.state_code
   limit greatest(1, least(coalesce(p_limit,200), 500));
$function$;
revoke execute on function public.state_rules_review_queue(integer) from public, anon;
grant execute on function public.state_rules_review_queue(integer) to authenticated, service_role;

-- A person approves. Only here does verified_on move.
create or replace function public.approve_state_rule_proposal(
  p_proposal_id uuid, p_reviewer text, p_note text default null)
returns text language plpgsql security definer set search_path to 'public'
as $function$
declare p record;
begin
  if not public.is_admin() then raise exception 'only an admin may approve a state rule'; end if;
  select * into p from state_rule_proposals where id = p_proposal_id and status = 'pending';
  if p is null then raise exception 'no pending proposal with that id'; end if;

  if p.finding = 'unchanged' then
    update state_rules set verified_on = current_date, verified_by = p_reviewer, updated_at = now()
     where id = p.rule_id;
  else
    update state_rules set
      value_text      = coalesce(p.proposed_value, value_text),
      value_numeric   = coalesce(p.proposed_numeric, value_numeric),
      value_date_rule = coalesce(p.proposed_date_rule, value_date_rule),
      detail          = coalesce(p.proposed_detail, detail),
      source_url      = coalesce(p.source_url, source_url),
      verified_on     = current_date,
      verified_by     = p_reviewer,
      updated_at      = now()
     where id = p.rule_id;
  end if;

  update state_rule_proposals
     set status='approved', reviewed_by=p_reviewer, reviewed_at=now(), reviewer_note=p_note
   where id = p_proposal_id;
  return 'approved — ' || p.state_code || ' ' || p.topic || ', verified ' || current_date;
end;
$function$;
revoke execute on function public.approve_state_rule_proposal(uuid,text,text) from public, anon;
grant execute on function public.approve_state_rule_proposal(uuid,text,text) to authenticated, service_role;

create or replace function public.reject_state_rule_proposal(
  p_proposal_id uuid, p_reviewer text, p_note text)
returns text language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'only an admin may reject a state rule'; end if;
  update state_rule_proposals
     set status='rejected', reviewed_by=p_reviewer, reviewed_at=now(), reviewer_note=p_note
   where id = p_proposal_id and status='pending';
  if not found then raise exception 'no pending proposal with that id'; end if;
  -- verified_on deliberately untouched: a rejected check is not a verification.
  return 'rejected — the rule remains unverified';
end;
$function$;
revoke execute on function public.reject_state_rule_proposal(uuid,text,text) from public, anon;
grant execute on function public.reject_state_rule_proposal(uuid,text,text) to authenticated, service_role;

select (select count(*) from public.state_rules_review_queue()) as queued_for_review;