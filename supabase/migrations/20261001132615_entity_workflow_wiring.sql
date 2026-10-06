-- ─────────────────────────────────────────────────────────────────────────────
-- Wire entities into the workflow machinery.
--
-- Today a workflow instance belongs to a family and optionally an obligation.
-- A household with four LLCs running four annual filings would produce four
-- identical rows with no way to tell which entity each one is about.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.workflow_instances
  add column if not exists entity_id uuid references public.entities(id) on delete set null;
create index if not exists workflow_instances_entity_idx
  on public.workflow_instances (entity_id) where entity_id is not null;

comment on column public.workflow_instances.entity_id is
  'Which entity this run is about. Without it, four LLCs filing four annual reports produce four indistinguishable instances.';

-- What is coming due, and what it costs to miss. The date is always one the
-- household or its professional supplied - this derives nothing from state law.
create or replace function public.entity_filings_due(p_family_id uuid, p_days integer default 120)
returns table(entity_id uuid, entity_name text, kind text, formation_state text,
              due_on date, days_out integer, fee numeric, agent text, urgency text)
language sql stable security definer set search_path to 'public'
as $function$
  select e.id, e.name, e.kind, e.formation_state,
         e.annual_report_due,
         (e.annual_report_due - current_date)::int,
         e.annual_report_fee, e.registered_agent,
         case
           when e.annual_report_due < current_date then 'overdue'
           when e.annual_report_due - current_date <= 30 then 'due now'
           when e.annual_report_due - current_date <= 60 then 'approaching'
           else 'scheduled'
         end
    from entities e
   where e.family_id = p_family_id
     and e.status = 'active'
     and e.annual_report_due is not null
     and e.annual_report_due <= current_date + p_days
     and (caller_is_privileged() or e.family_id in (select current_user_allowed_family_ids()))
   order by e.annual_report_due;
$function$;
revoke execute on function public.entity_filings_due(uuid,integer) from public, anon;
grant execute on function public.entity_filings_due(uuid,integer) to authenticated, service_role;

-- Roll the annual report forward a year when one is filed, so the next deadline
-- exists the moment the current one is cleared rather than being re-entered by hand.
create or replace function public.entity_filing_completed(p_entity_id uuid, p_filed_on date default current_date)
returns date language plpgsql security definer set search_path to 'public'
as $function$
declare v_next date; v_family uuid;
begin
  select family_id, annual_report_due into v_family, v_next from entities where id = p_entity_id;
  if v_family is null then raise exception 'entity not found'; end if;
  if not (caller_is_privileged() or v_family in (select current_user_allowed_family_ids())) then
    raise exception 'not permitted';
  end if;
  if v_next is null then return null; end if;
  -- Same calendar date next year. Deliberately not clever: filing dates are set by
  -- the state and an anniversary guess is the one thing this must not invent.
  v_next := v_next + interval '1 year';
  update entities set annual_report_due = v_next, updated_at = now() where id = p_entity_id;
  return v_next;
end;
$function$;
revoke execute on function public.entity_filing_completed(uuid,date) from public, anon;
grant execute on function public.entity_filing_completed(uuid,date) to authenticated, service_role;

select 'wired' as status;