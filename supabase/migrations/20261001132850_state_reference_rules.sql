-- ─────────────────────────────────────────────────────────────────────────────
-- State reference facts.
--
-- Ministerial, published, citable facts only - a filing deadline, a fee, whether
-- a state is community property. The same category as a postal code. NOT advice,
-- NOT an outcome, NOT an interpretation.
--
-- Two things make this safe rather than dangerous:
--
--   1. Every row carries source_url and verified_on. A fact with no provenance
--      cannot be surfaced as fact.
--   2. Rows go STALE. Fees and deadlines change annually in fifty states, and a
--      reference table nobody maintains becomes wrong quietly. Wrong-with-a-
--      citation is worse than absent, so staleness is modelled explicitly and
--      the reader is told.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.state_rules (
  id            uuid primary key default gen_random_uuid(),
  state_code    text not null,
  topic         text not null,
  applies_to    text,
  value_text    text,
  value_numeric numeric(14,2),
  value_date_rule text,
  detail        text,
  source_name   text,
  source_url    text,
  verified_on   date,
  verified_by   text,
  review_months integer not null default 12,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint state_rules_code_check check (state_code ~ '^[A-Z]{2}$'),
  constraint state_rules_topic_check check (topic in (
    'annual_report','franchise_tax','community_property','estate_tax',
    'inheritance_tax','income_tax','homestead','property_tax_appeal',
    'trust_perpetuities','registered_agent','probate','other')),
  constraint state_rules_unique unique (state_code, topic, applies_to)
);

comment on table public.state_rules is
  'Published administrative facts by state. Never advice. Every row must carry a source and a verification date before it can be surfaced as fact - see state_rule_lookup(), which refuses to present an unverified or stale row as current.';
comment on column public.state_rules.review_months is
  'How often this fact must be re-checked. Fees and deadlines change annually; structural facts like community property change rarely.';

create index if not exists state_rules_lookup_idx on public.state_rules (state_code, topic);
create index if not exists state_rules_stale_idx  on public.state_rules (verified_on nulls first);

alter table public.state_rules enable row level security;
drop policy if exists read_access on public.state_rules;
drop policy if exists write_access on public.state_rules;
-- Reference data: every authenticated user may read it; only admins may write.
create policy read_access  on public.state_rules for select to authenticated using (true);
create policy write_access on public.state_rules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The only sanctioned way to read a rule. Returns the fact WITH its provenance and
-- its confidence, so a caller cannot accidentally present stale data as current.
create or replace function public.state_rule_lookup(p_state text, p_topic text, p_applies_to text default null)
returns table(state_code text, topic text, value_text text, value_numeric numeric,
              value_date_rule text, detail text, source_name text, source_url text,
              verified_on date, confidence text, caveat text)
language sql stable security definer set search_path to 'public'
as $function$
  select r.state_code, r.topic, r.value_text, r.value_numeric, r.value_date_rule,
         r.detail, r.source_name, r.source_url, r.verified_on,
         case
           when r.verified_on is null then 'unverified'
           when r.verified_on < current_date - (r.review_months * 30) then 'stale'
           else 'current'
         end,
         case
           when r.verified_on is null then
             'This has never been verified against the source. Treat it as a starting point for a question, not as an answer.'
           when r.verified_on < current_date - (r.review_months * 30) then
             'Last verified ' || r.verified_on || '. Fees and deadlines change annually - confirm against the source before relying on it.'
           else
             'Verified ' || r.verified_on || ' against ' || coalesce(r.source_name,'the state') ||
             '. ORDANIS reports what the state publishes; whether it applies to this household is a question for their own attorney or accountant.'
         end
    from state_rules r
   where r.state_code = upper(p_state) and r.topic = p_topic
     and (p_applies_to is null or r.applies_to = p_applies_to or r.applies_to is null)
   order by (r.applies_to is not null) desc
   limit 1;
$function$;
revoke execute on function public.state_rule_lookup(text,text,text) from public, anon;
grant execute on function public.state_rule_lookup(text,text,text) to authenticated, service_role;

-- What needs re-checking. This is the maintenance queue, and it is the thing that
-- keeps the table honest.
create or replace function public.state_rules_needing_review()
returns table(state_code text, topic text, applies_to text, verified_on date,
              days_since integer, status text)
language sql stable security definer set search_path to 'public'
as $function$
  select r.state_code, r.topic, r.applies_to, r.verified_on,
         case when r.verified_on is null then null
              else (current_date - r.verified_on)::int end,
         case when r.verified_on is null then 'never verified'
              else 'overdue for review' end
    from state_rules r
   where caller_is_privileged()
     and (r.verified_on is null or r.verified_on < current_date - (r.review_months * 30))
   order by r.verified_on nulls first, r.state_code;
$function$;
revoke execute on function public.state_rules_needing_review() from public, anon;
grant execute on function public.state_rules_needing_review() to authenticated, service_role;

select 'state_rules installed' as status;