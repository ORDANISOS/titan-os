-- Client-private documents: a "Private" folder in CHRIS (2026-10-21, Will's decision).
--
-- A client can upload files only they can see: not other logins of the same household, not ORDANIS staff
-- (admins, Experts, Analysts), not firm administrators, not Business Partners. No AI reads them (the app
-- skips reading, suggestions, search text and the assistant for these files).
--
-- documents.private_owner_id = the client login that owns it. Enforced by RESTRICTIVE policies (ANDed with
-- the existing ones, so they only ever take access away):
--   * documents: a private row is visible only to its owner, and only a client of that household can make
--     one, for themselves;
--   * rows that point at a document (downloads log, file versions, client exceptions) follow the document;
--   * storage: private files live under <family_id>/private/<owner_id>/..., readable only by that owner.
-- vault_search (security definer, bypasses row policies) is re-wrapped to drop private documents too.
--
-- Not covered (honest limits): whoever holds the service-role key or the Supabase dashboard can still reach
-- everything; storage-use totals still count the files' size.
--
-- Rollback:
--   drop policy if exists client_private on public.documents;
--   drop policy if exists client_private on public.document_downloads;
--   drop policy if exists client_private on public.document_file_versions;
--   drop policy if exists client_private on public.client_exceptions;
--   drop policy if exists client_private_documents on storage.objects;
--   (re-run migration 20261021130000 to restore the vault_search wrapper without the document filter)
--   drop function if exists public.hidden_document_ids();
--   drop function if exists public.is_household_client(uuid);
--   alter table public.documents drop column if exists private_owner_id;

alter table public.documents add column if not exists private_owner_id uuid;
create index if not exists documents_private_owner_idx on public.documents(private_owner_id) where private_owner_id is not null;

-- Private documents the signed-in person may NOT see (all of them, for server code with no auth.uid()).
create or replace function public.hidden_document_ids()
returns setof uuid
language sql stable security definer set search_path to ''
as $$
  select d.id from public.documents d
   where d.private_owner_id is not null and d.private_owner_id is distinct from auth.uid();
$$;
revoke execute on function public.hidden_document_ids() from public, anon;
grant execute on function public.hidden_document_ids() to authenticated, service_role;

-- Is the signed-in person a client login of this household?
create or replace function public.is_household_client(p_family_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from public.user_profiles p
                  where p.id = auth.uid() and p.role = 'client' and p.family_id = p_family_id);
$$;
revoke execute on function public.is_household_client(uuid) from public, anon;
grant execute on function public.is_household_client(uuid) to authenticated;

drop policy if exists client_private on public.documents;
create policy client_private on public.documents as restrictive for all to authenticated
  using (private_owner_id is null or private_owner_id = auth.uid())
  -- A private row must be the caller's own, in their own household, with its file in their private path, so a
  -- document can't be "made private" while its file stays readable at the household path.
  with check (private_owner_id is null or (private_owner_id = auth.uid() and public.is_household_client(family_id)
              and split_part(file_path, '/', 1) = family_id::text and split_part(file_path, '/', 2) = 'private'
              and split_part(file_path, '/', 3) = auth.uid()::text));

do $$
declare t text;
begin
  foreach t in array array['document_downloads', 'document_file_versions', 'client_exceptions'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists client_private on public.%I', t);
      execute format('create policy client_private on public.%I as restrictive for all to authenticated
                        using (document_id is null or not (document_id = any (array(select public.hidden_document_ids()))))
                        with check (document_id is null or not (document_id = any (array(select public.hidden_document_ids()))))', t);
    end if;
  end loop;
end $$;

-- vault_search: keep the private-household filter (migration 20261021130000) and add the private-document one.
do $$
declare u oid; v_ident text; v_args text; v_result text; v_call text;
begin
  select p.oid into u from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'vault_search__unfiltered';
  if u is null then raise notice 'vault_search__unfiltered not found; apply 20261021130000 first'; return; end if;
  v_ident := pg_get_function_identity_arguments(u);
  v_args := pg_get_function_arguments(u);
  v_result := pg_get_function_result(u);
  select coalesce(string_agg(format('%I', a.n), ', ' order by a.i), '') into v_call
    from pg_proc p, unnest(coalesce(p.proargnames, '{}'::text[])) with ordinality as a(n, i)
   where p.oid = u and a.n is not null and a.n <> ''
     and (p.proargmodes is null or p.proargmodes[a.i::int] in ('i', 'b', 'v'));
  execute format('drop function if exists public.vault_search(%s)', v_ident);
  execute format('create function public.vault_search(%s) returns %s language sql stable security definer set search_path to '''' as $w$
      select * from public.vault_search__unfiltered(%s) x
       where not (p_family_id = any (array(select public.hidden_family_ids())))
         and not (x.id = any (array(select public.hidden_document_ids())))
    $w$', v_args, v_result, v_call);
  execute format('comment on function public.vault_search(%s) is %L', v_ident,
                 'Private-household and private-document filter around vault_search__unfiltered (migrations 20261021130000, 20261021150000).');
  execute format('revoke all on function public.vault_search(%s) from public, anon', v_ident);
  execute format('grant execute on function public.vault_search(%s) to authenticated, service_role', v_ident);
end $$;

-- Private files: <family_id>/private/<owner_id>/<file>, only the owner may read or write them.
drop policy if exists client_private_documents on storage.objects;
create policy client_private_documents on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'documents' or split_part(name, '/', 2) <> 'private' or split_part(name, '/', 3) = auth.uid()::text)
  with check (bucket_id <> 'documents' or split_part(name, '/', 2) <> 'private' or split_part(name, '/', 3) = auth.uid()::text);
