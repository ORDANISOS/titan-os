-- is_admin() resolves auth.uid(), which is null on a service-role connection, so
-- both functions were unreadable from edge functions and server-side tooling.
-- caller_is_privileged() covers an admin session AND the service role - the same
-- pattern used elsewhere in this schema.
create or replace function public.entity_tree(p_family_id uuid)
returns table(id uuid, name text, kind text, formation_state text,
              depth integer, path text, holds_properties bigint, holds_accounts bigint)
language sql stable security definer set search_path to 'public' as $function$
  with recursive tree as (
    select e.id, e.name, e.kind, e.formation_state, 0 as depth, e.name::text as path
      from entities e
     where e.family_id = p_family_id and e.parent_entity_id is null
       and (caller_is_privileged() or e.family_id in (select current_user_allowed_family_ids()))
    union all
    select c.id, c.name, c.kind, c.formation_state, t.depth + 1, t.path || ' > ' || c.name
      from entities c join tree t on c.parent_entity_id = t.id
     where t.depth < 10
  )
  select t.id, t.name, t.kind, t.formation_state, t.depth, t.path,
         (select count(*) from properties p where p.entity_id = t.id),
         (select count(*) from portfolio_accounts a where a.entity_id = t.id)
    from tree t order by t.path;
$function$;
revoke execute on function public.entity_tree(uuid) from public, anon;
grant execute on function public.entity_tree(uuid) to authenticated, service_role;

create or replace function public.entity_gaps(p_family_id uuid)
returns table(entity_id uuid, entity_name text, severity text, gap text, why text)
language sql stable security definer set search_path to 'public' as $function$
  with e as (
    select * from entities
    where family_id = p_family_id and status = 'active'
      and (caller_is_privileged() or family_id in (select current_user_allowed_family_ids()))
  )
  select e.id, e.name, 'high', 'No formation state on record',
         'Annual filing deadlines, fees and trust law are all set by the state of formation. Without it nothing about this entity can be scheduled.'
    from e where e.formation_state is null
  union all
  select e.id, e.name, 'high', 'No annual report date',
         'Entities are administratively dissolved for missing a filing that often costs under a hundred dollars. Reinstatement costs far more, and the liability shield lapses in between.'
    from e where e.annual_report_due is null
      and e.kind in ('llc','lp','llp','lllp','s_corp','c_corp','partnership')
  union all
  select e.id, e.name, 'high', 'Trust holds nothing',
         'A trust with no property, no account and no subsidiary entity assigned to it was drafted and never funded. It does nothing at all until something is titled into it.'
    from e where e.kind like '%trust%'
      and not exists (select 1 from properties p where p.entity_id = e.id)
      and not exists (select 1 from portfolio_accounts a where a.entity_id = e.id)
      and not exists (select 1 from entities c where c.parent_entity_id = e.id)
  union all
  select e.id, e.name, 'medium', 'No trustee recorded',
         'Nobody on record is empowered to act for this trust. If the grantor becomes incapacitated, the question of who signs is asked at the worst possible moment.'
    from e where e.kind like '%trust%'
      and not exists (select 1 from entity_members m where m.entity_id = e.id
                      and m.role in ('trustee','co_trustee','successor_trustee'))
  union all
  select e.id, e.name, 'medium', 'No registered agent',
         'State notices and service of process go to the registered agent. If that is a lapsed service or a former address, the first anyone hears of a problem is a default judgment.'
    from e where e.registered_agent is null
      and e.kind in ('llc','lp','llp','lllp','s_corp','c_corp')
  union all
  select e.id, e.name, 'medium', 'Formed outside the household''s domicile',
         'Registered in ' || e.formation_state || ' while the household is domiciled in ' || f.domicile_state ||
         '. Often deliberate and correct, but it usually requires foreign qualification in the home state - worth confirming with counsel.'
    from e join families f on f.id = e.family_id
   where e.formation_state is not null and f.domicile_state is not null
     and e.formation_state <> f.domicile_state
  union all
  select e.id, e.name, 'low', 'No EIN on record',
         'Needed to open accounts, file returns and prove the entity exists to a third party.'
    from e where coalesce(e.ein,'') = ''
      and e.kind in ('llc','lp','llp','lllp','s_corp','c_corp','partnership','irrevocable_trust')
  order by 3, 2;
$function$;
revoke execute on function public.entity_gaps(uuid) from public, anon;
grant execute on function public.entity_gaps(uuid) to authenticated, service_role;

select count(*) as entities_created from public.entities;