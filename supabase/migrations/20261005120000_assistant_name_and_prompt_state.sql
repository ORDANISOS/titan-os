-- Assistant naming: (1) let a family login actually save its assistant's name, and
-- (2) remember how many times a client has been shown the "name your assistant" prompt.
--
-- Why a function and not an RLS policy: a client has NO UPDATE policy on `families` (and must not
-- get one -- that row also holds plan and billing columns). A direct client-side
-- update({assistant_name}) therefore matched 0 rows and returned no error, so the rename looked
-- like it worked but never persisted. These two SECURITY DEFINER functions let a client touch
-- exactly one field each, and only their own.

alter table public.user_profiles
  add column if not exists assistant_prompt_count integer not null default 0;

create or replace function public.set_my_assistant_name(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fid  uuid;
  v_name text := left(btrim(coalesce(p_name, '')), 40);
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_name = '' then raise exception 'Assistant name cannot be empty'; end if;

  select family_id into v_fid
  from public.user_profiles
  where id = auth.uid() and role = 'client' and coalesce(active, true);
  if v_fid is null then raise exception 'Not allowed'; end if;

  update public.families set assistant_name = v_name where id = v_fid;
  return v_name;
end;
$$;

-- One call per client login. Increments the caller's own counter (capped at 3) and returns it:
-- 1 = first login, 2 = second login, 3 = third or later (never prompt again).
create or replace function public.record_assistant_prompt_login()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.user_profiles
     set assistant_prompt_count = least(assistant_prompt_count + 1, 3)
   where id = auth.uid() and role = 'client'
  returning assistant_prompt_count into v;
  return coalesce(v, 3);
end;
$$;

revoke all on function public.set_my_assistant_name(text)        from public, anon;
revoke all on function public.record_assistant_prompt_login()    from public, anon;
grant execute on function public.set_my_assistant_name(text)     to authenticated;
grant execute on function public.record_assistant_prompt_login() to authenticated;
