-- Firm-administrator access fixes (2026-10-15, from the 2026-10-14 bug check).
--
-- 1. Switching a firm off now cuts off its administrators. is_enterprise_admin() only checked the
--    person's own active flag, so after ORDANIS ran enterprise_set_status(id,'active',false) at the end
--    of a contract, that firm's admins could still read every household, CHRIS file, household list and
--    net-worth figure for the firm. Every firm-admin read path (current_user_firm_family_ids, the
--    firm_admin_read policies, documents_read_firm storage, enterprise_* lists, firm_log_access) goes
--    through this one check, so requiring an active firm here closes all of them.
--
-- 2. CHRIS search works for firm administrators again (read-only). vault_search let them in only through
--    caller_is_privileged(), which was true for everyone until the 20261014100000 security fix. The
--    firm's own households are now allowed explicitly, the same set the firm_admin_read policy on
--    documents already shows them. Nothing else in the function changes.

create or replace function public.is_enterprise_admin()
 returns boolean
 language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.user_profiles u
      join public.enterprises e on e.id = u.enterprise_id
    where u.id = auth.uid()
      and u.role = 'enterprise_admin'
      and u.active is not false
      and e.active is not false
  );
$function$;

create or replace function public.vault_search(p_family_id uuid, p_query text, p_limit integer default 40)
 returns table(id uuid, name text, doc_type text, category text, file_path text, mime_type text, file_size bigint,
               expiry_date date, created_at timestamp with time zone, located_in text, matched_on text,
               snippet text, rank real, superseded boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  with q as (select websearch_to_tsquery('english', coalesce(nullif(btrim(p_query),''),'')) as ts,
                    btrim(coalesce(p_query,'')) as raw)
  select d.id, d.name, d.doc_type, d.category, d.file_path, d.mime_type, d.file_size,
         d.expiry_date, d.created_at,
         -- Where it actually lives, in the client's terms rather than a path.
         coalesce(
           nullif(trim(both ' · ' from
             concat_ws(' · ',
               nullif(p.address,''),
               nullif(d.property_section,''),
               case when a.id is not null then
                 trim(concat_ws(' ', nullif(a.institution,''), nullif(a.account_type,''))) end,
               nullif(d.account_period,''))), ''),
           nullif(d.category,''), 'Unfiled')::text,
         -- Why it matched, so the person can tell at a glance.
         case
           when d.name ilike '%'||q.raw||'%' then 'the file name'
           when coalesce(d.description,'') ilike '%'||q.raw||'%'
             or coalesce(d.notes,'') ilike '%'||q.raw||'%' then 'your note on it'
           when coalesce(d.doc_type,'') ilike '%'||q.raw||'%'
             or coalesce(d.category,'') ilike '%'||q.raw||'%' then 'the document type'
           when coalesce(d.extracted_text,'') <> '' then 'text inside the document'
           else 'a related field'
         end::text,
         case when coalesce(d.extracted_text,'') = '' then null
              else ts_headline('english', d.extracted_text, q.ts,
                     'StartSel=«,StopSel=»,MaxWords=28,MinWords=12,MaxFragments=1') end,
         ts_rank(public.documents_search_vector(d), q.ts)
           + case when d.name ilike '%'||q.raw||'%' then 0.6 else 0 end,
         d.superseded_by_id is not null
    from documents d
    cross join q
    left join properties p on p.id = d.property_id
    left join portfolio_accounts a on a.id = d.account_id
   where d.family_id = p_family_id
     and (caller_is_privileged()
          or d.family_id in (select current_user_allowed_family_ids())
          or d.family_id in (select current_user_firm_family_ids()))
     and (
       q.raw = ''
       or public.documents_search_vector(d) @@ q.ts
       -- Trigram catches a half-remembered or misspelled name that the
       -- dictionary-based search would miss entirely.
       or d.name ilike '%'||q.raw||'%'
     )
   order by 13 desc, d.created_at desc
   limit greatest(1, least(coalesce(p_limit,40), 200));
$function$;

-- ROLLBACK
-- is_enterprise_admin: select exists (select 1 from public.user_profiles where id = auth.uid()
--   and role = 'enterprise_admin' and enterprise_id is not null and active is not false);
-- vault_search: re-run the definition above without the current_user_firm_family_ids() line.
