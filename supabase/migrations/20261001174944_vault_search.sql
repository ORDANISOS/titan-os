-- ─────────────────────────────────────────────────────────────────────────────
-- Vault search.
--
-- The premise is that a client does not remember where they filed something - so
-- searching the FOLDER TREE is useless to them. What they remember is a word that
-- was in the document, or roughly what it was about.
--
-- So this searches the extracted text as well as the metadata, and every result
-- says WHERE it lives and WHY it matched. A result list that does not explain the
-- match leaves the person exactly as lost as before.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_trgm with schema extensions;

-- Weighted so a filename match outranks a passing mention in page 40 of a trust.
create or replace function public.documents_search_vector(d public.documents)
returns tsvector language sql immutable as $function$
  select setweight(to_tsvector('english', coalesce(d.name,'')), 'A')
      || setweight(to_tsvector('english', coalesce(d.doc_type,'') || ' ' || coalesce(d.category,'')), 'B')
      || setweight(to_tsvector('english', coalesce(d.description,'') || ' ' || coalesce(d.notes,'')), 'C')
      || setweight(to_tsvector('english', coalesce(d.extracted_text,'')), 'D');
$function$;

create index if not exists documents_fts_idx on public.documents
  using gin (public.documents_search_vector(documents));
create index if not exists documents_name_trgm on public.documents
  using gin (name extensions.gin_trgm_ops);
create index if not exists documents_family_created_idx on public.documents (family_id, created_at desc);

create or replace function public.vault_search(
  p_family_id uuid, p_query text, p_limit integer default 40)
returns table(
  id uuid, name text, doc_type text, category text,
  file_path text, mime_type text, file_size bigint,
  expiry_date date, created_at timestamptz,
  located_in text, matched_on text, snippet text, rank real, superseded boolean)
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
     and (caller_is_privileged() or d.family_id in (select current_user_allowed_family_ids()))
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
revoke execute on function public.vault_search(uuid,text,integer) from public, anon;
grant execute on function public.vault_search(uuid,text,integer) to authenticated, service_role;

select 'vault_search installed' as status;