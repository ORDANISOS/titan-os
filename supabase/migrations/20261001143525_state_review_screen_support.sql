-- ─────────────────────────────────────────────────────────────────────────────
-- What the admin review screen reads.
--
-- The screen's job is to make the 10% that needs judgement fast, and to make the
-- 90% that does not need judgement safe to clear in bulk. So the queue comes back
-- already triaged by how much attention each row deserves, rather than as a flat
-- list the reviewer has to sort in their head.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.state_review_summary()
returns table(pending integer, needs_judgement integer, routine integer,
              oldest_pending timestamptz, rules_total integer, rules_unverified integer)
language sql stable security definer set search_path to 'public'
as $function$
  select
    (select count(*)::int from state_rule_proposals where status='pending'),
    (select count(*)::int from state_rule_proposals where status='pending'
       and (finding in ('ambiguous','source_moved','source_unreachable')
            or agent_confidence = 'low' or finding = 'changed')),
    (select count(*)::int from state_rule_proposals where status='pending'
       and finding = 'unchanged' and agent_confidence = 'high'),
    (select min(created_at) from state_rule_proposals where status='pending'),
    (select count(*)::int from state_rules),
    (select count(*)::int from state_rules where verified_on is null)
  where caller_is_privileged();
$function$;
revoke execute on function public.state_review_summary() from public, anon;
grant execute on function public.state_review_summary() to authenticated, service_role;

-- The queue, triaged. priority 1 needs a person; 3 can be cleared in bulk.
create or replace function public.state_review_queue()
returns table(id uuid, state_code text, topic text, applies_to text,
              finding text, agent_confidence text,
              current_value text, proposed_value text,
              evidence text, source_url text,
              priority integer, attention text, created_at timestamptz)
language sql stable security definer set search_path to 'public'
as $function$
  select p.id, p.state_code, p.topic, p.applies_to, p.finding, p.agent_confidence,
         p.current_value, p.proposed_value, p.evidence, p.source_url,
         case
           when p.finding in ('ambiguous','source_moved','source_unreachable') then 1
           when p.agent_confidence = 'low' then 1
           when p.finding = 'changed' then 2
           else 3
         end,
         case
           when p.finding = 'source_unreachable' then 'The agent could not reach the source. Check it yourself, or fix the URL.'
           when p.finding = 'source_moved' then 'The source has moved. Confirm the new location before trusting the figure.'
           when p.finding = 'ambiguous' then 'The source was unclear, tiered or conditional. This one needs a person.'
           when p.agent_confidence = 'low' then 'The agent was not confident. Treat as unverified until you have looked.'
           when p.finding = 'changed' then 'A figure moved. Open the source and confirm before approving.'
           else 'Nothing changed, high confidence. Spot-check a sample, then clear the rest.'
         end,
         p.created_at
    from state_rule_proposals p
   where p.status = 'pending' and caller_is_privileged()
   order by 11, p.state_code, p.topic;
$function$;
revoke execute on function public.state_review_queue() from public, anon;
grant execute on function public.state_review_queue() to authenticated, service_role;

-- Clearing the routine tail in one action. Deliberately REFUSES anything that
-- needs judgement, so a bulk button can never approve an ambiguous finding.
create or replace function public.approve_routine_state_proposals(p_reviewer text, p_note text default null)
returns table(approved integer, skipped integer)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_approved int := 0; v_skipped int := 0; r record;
begin
  if not public.is_admin() then raise exception 'only an admin may approve state rules'; end if;
  for r in
    select id from state_rule_proposals
     where status='pending' and finding='unchanged' and agent_confidence='high'
  loop
    perform public.approve_state_rule_proposal(r.id, p_reviewer,
      coalesce(p_note, 'Cleared in bulk: unchanged, high confidence'));
    v_approved := v_approved + 1;
  end loop;
  select count(*)::int into v_skipped from state_rule_proposals
   where status='pending';
  return query select v_approved, v_skipped;
end;
$function$;
revoke execute on function public.approve_routine_state_proposals(text,text) from public, anon;
grant execute on function public.approve_routine_state_proposals(text,text) to authenticated, service_role;

select * from public.state_review_summary();