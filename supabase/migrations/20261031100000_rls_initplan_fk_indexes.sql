-- Scaling step 1 (Will, 2026-10-30: "yes, start scaling step 1 on demo").
--
-- 1. Security rules that run once per query instead of once per row.
--    Many row-level security policies call "who is signed in" checks directly: auth.uid(), is_admin(),
--    current_user_role() and similar. Written bare, Postgres re-runs the check for EVERY row it looks at; with
--    50,000 households that is millions of calls per page. Wrapped as ( SELECT f() ), Postgres runs it once per query
--    and reuses the answer (Supabase's "auth_rls_initplan" advice). The result is identical: every function wrapped
--    here takes no arguments and is STABLE, so it cannot give a different answer for a different row within one query.
--    Set-returning helpers (current_user_allowed_family_ids(), hidden_family_ids(), ...) are already used inside
--    IN ( SELECT ... ) and are left alone, as is anything that takes a row value (is_household_client(family_id)).
--
--    The rewrite is computed from each database's OWN policies (production's do not match demo's exactly), and only
--    the USING / WITH CHECK expressions change: no policy is dropped, renamed, or given different roles or commands.
--    ALTER POLICY re-checks each new expression, so a bad rewrite fails the whole migration instead of half-applying.
--    Storage policies (storage.objects) are not touched here.
--
-- 2. An index on every foreign key that has none (Supabase's "unindexed_foreign_keys" advice). Without one, deleting
--    or updating a parent row (a family, a property) scans the whole child table, and joins on that key slow down as
--    tables grow. Indexes only speed reads up; they change no data and no permissions.
--
-- 3. One duplicate index removed: enterprise_snapshots has the same unique index twice (enterprise_snapshots_month_key
--    from 20261006190000 and enterprise_snapshots_scope_month_uniq from 20261010100000). Every write maintains both.
--    The later copy is dropped only where the original still exists, so the uniqueness rule is never lost.
--    (account_balances' two similar indexes differ in sort order and both stay.)
--
-- Rollback for part 1: the original expressions are saved before this runs (docs/rollback/), one ALTER POLICY each.
-- Rollback for part 2: drop the indexes named *_fk_idx created here.
-- Rollback for part 3: create unique index enterprise_snapshots_scope_month_uniq on public.enterprise_snapshots
--   ((coalesce(enterprise_id, '00000000-0000-0000-0000-000000000000'::uuid)), snapshot_month);

do $$
declare
  pol record;
  fns constant text := '(auth\.(uid|jwt|role)|is_admin|current_user_role|is_enterprise_admin|current_user_enterprise_id|current_user_can_run_prompts|current_user_email|current_user_family_id)';
  -- Not already inside "SELECT f()", not schema-qualified or part of a longer name.
  pat text := '(?<!SELECT )(?<![.\w])' || fns || '\(\)';
  new_qual text;
  new_check text;
  stmt text;
  n int := 0;
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ pat or coalesce(with_check, '') ~ pat)
  loop
    new_qual := case when pol.qual is null then null else regexp_replace(pol.qual, pat, '( SELECT \1() )', 'g') end;
    new_check := case when pol.with_check is null then null else regexp_replace(pol.with_check, pat, '( SELECT \1() )', 'g') end;
    stmt := format('alter policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    if new_qual is not null then stmt := stmt || format(' using (%s)', new_qual); end if;
    if new_check is not null then stmt := stmt || format(' with check (%s)', new_check); end if;
    execute stmt;
    n := n + 1;
  end loop;
  raise notice 'rls initplan: % policies rewritten', n;
end
$$;

do $$
declare
  fk record;
  idx text;
  n int := 0;
begin
  for fk in
    select c.conrelid::regclass as tbl, cl.relname as tname, c.conname,
           array_agg(a.attname order by k.ord) as cols
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f' and ns.nspname = 'public'
      -- no existing index whose leading columns are exactly this key
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey
      )
    group by c.conrelid, cl.relname, c.conname
  loop
    idx := left(fk.tname || '_' || array_to_string(fk.cols, '_'), 56) || '_fk_idx';
    execute format('create index if not exists %I on %s (%s)', idx, fk.tbl,
                   (select string_agg(format('%I', col), ', ') from unnest(fk.cols) as col));
    n := n + 1;
  end loop;
  raise notice 'fk indexes: % created', n;
end
$$;

do $$
begin
  if to_regclass('public.enterprise_snapshots_month_key') is not null
     and to_regclass('public.enterprise_snapshots_scope_month_uniq') is not null then
    drop index public.enterprise_snapshots_scope_month_uniq;
    raise notice 'duplicate index enterprise_snapshots_scope_month_uniq dropped';
  end if;
end
$$;
