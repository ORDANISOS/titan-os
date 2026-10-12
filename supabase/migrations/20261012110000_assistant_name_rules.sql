-- Rules for what a household can name its AI assistant: no vulgar, hateful or sexual names.
-- The check lives in the database so it cannot be bypassed from the app. Applies to the client RPC
-- set_my_assistant_name() and, through a trigger, to any other write to families.assistant_name
-- (admins and advisors included). The word list is a table, so ORDANIS can extend it without a deploy.
--
-- Matching: names are lower-cased, common character swaps (0 1 3 4 5 7 8 @ $ !) are undone, and
--   * mode 'anywhere' terms are looked for in the letters-only text with repeated letters collapsed
--     (catches "f u c k", "fuuuck", "f.u.c.k") -- used only for terms that are not part of normal words;
--   * mode 'word' terms must match a whole word, so "Assistant", "Classic" or "Scunthorpe" are fine.
-- Not exhaustive. Add rows to assistant_name_blocklist as new cases turn up.

create table if not exists public.assistant_name_blocklist (
  term text primary key,
  mode text not null check (mode in ('anywhere','word'))
);
alter table public.assistant_name_blocklist enable row level security;
-- No policies on purpose: only the SECURITY DEFINER functions below read this table.

insert into public.assistant_name_blocklist(term, mode) values
  ('fuck','anywhere'),('motherfuck','anywhere'),('shit','anywhere'),('bitch','anywhere'),('whore','anywhere'),
  ('cocksuck','anywhere'),('jizz','anywhere'),('nigg','anywhere'),('faggot','anywhere'),('retard','anywhere'),
  ('kkk','anywhere'),('hitler','anywhere'),('rapist','anywhere'),('pedo','anywhere'),('molest','anywhere'),
  ('wetback','anywhere'),('towelhead','anywhere'),('sandnigg','anywhere'),('porn','anywhere'),('blowjob','anywhere'),
  ('ass','word'),('asshole','word'),('arse','word'),('cunt','word'),('dick','word'),('cock','word'),('pussy','word'),
  ('tits','word'),('twat','word'),('slut','word'),('bastard','word'),('wanker','word'),('cum','word'),('sex','word'),
  ('rape','word'),('nazi','word'),('fag','word'),('dyke','word'),('tranny','word'),('spic','word'),('chink','word'),
  ('gook','word'),('kike','word'),('coon','word'),('paki','word'),('negro','word'),('penis','word'),('vagina','word'),
  ('anal','word'),('milf','word'),('boner','word'),('douche','word'),('piss','word'),('crap','word')
on conflict (term) do nothing;

-- Returns NULL when the name is acceptable, otherwise a short message that is safe to show the user.
create or replace function public.assistant_name_problem(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text := btrim(coalesce(p_name, ''));
  norm text;
  raw_letters text;
  squashed text;
  tok text;
  generic constant text := 'Please choose a different name for your assistant.';
begin
  if char_length(v) < 2 or char_length(v) > 40 then
    return 'Names must be 2 to 40 characters.';
  end if;
  if v !~ '^[[:alpha:][:digit:]][[:alpha:][:digit:] ''’.-]*$' then
    return 'Names can use letters, numbers, spaces, hyphens, apostrophes and periods.';
  end if;
  if (select count(*) from regexp_matches(v, '[[:alpha:]]', 'g')) < 2 then
    return 'Names need at least two letters.';
  end if;
  if v ~* '(https?|www|\.com|\.net|\.org|\.io)' then
    return 'Names cannot contain web addresses.';
  end if;
  if v ~ '(.)\1{3,}' then
    return generic;
  end if;

  norm := lower(translate(v, '0134578@$!', 'oieastbasi'));
  raw_letters := regexp_replace(norm, '[^[:alpha:]]', '', 'g');
  squashed := regexp_replace(raw_letters, '(.)\1+', '\1', 'g');

  if exists (
    select 1 from public.assistant_name_blocklist b
     where b.mode = 'anywhere'
       and ( position(b.term in raw_letters) > 0
          or ( char_length(regexp_replace(b.term, '(.)\1+', '\1', 'g')) >= 4
               and position(regexp_replace(b.term, '(.)\1+', '\1', 'g') in squashed) > 0 ) )
  ) then
    return generic;
  end if;

  for tok in select t from regexp_split_to_table(norm, '[^[:alpha:]]+') as t where t <> '' loop
    tok := regexp_replace(tok, '(.)\1{2,}', '\1\1', 'g');
    if exists (select 1 from public.assistant_name_blocklist b where b.mode = 'word' and b.term = tok) then
      return generic;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.assistant_name_problem(text) from public, anon;
grant execute on function public.assistant_name_problem(text) to authenticated;

-- Client write path: same behaviour as before, plus the name check.
create or replace function public.set_my_assistant_name(p_name text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fid  uuid;
  v_name text := left(btrim(coalesce(p_name, '')), 40);
  v_problem text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_name = '' then raise exception 'Assistant name cannot be empty'; end if;
  v_problem := public.assistant_name_problem(v_name);
  if v_problem is not null then raise exception '%', v_problem; end if;
  select family_id into v_fid from public.user_profiles
   where id = auth.uid() and role = 'client' and coalesce(active, true);
  if v_fid is null then raise exception 'Not allowed'; end if;
  update public.families set assistant_name = v_name where id = v_fid;
  return v_name;
end;
$function$;

-- Every other write path (admin / advisor direct updates, imports) goes through the same check.
create or replace function public.trg_check_assistant_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_problem text;
begin
  if new.assistant_name is not null and btrim(new.assistant_name) <> ''
     and (tg_op = 'INSERT' or new.assistant_name is distinct from old.assistant_name) then
    v_problem := public.assistant_name_problem(new.assistant_name);
    if v_problem is not null then raise exception '%', v_problem; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists families_check_assistant_name on public.families;
create trigger families_check_assistant_name
  before insert or update of assistant_name on public.families
  for each row execute function public.trg_check_assistant_name();
