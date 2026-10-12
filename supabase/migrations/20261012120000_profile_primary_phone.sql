-- Primary phone number on the profile. Collected at sign-up (required, because sign-up also records SMS
-- consent) and stored in E.164 so it can be used for security codes and text messages.
-- PRODUCTION ONLY by decision: do not apply to the demo project.

alter table public.user_profiles
  add column if not exists phone text;

-- US numbers, E.164: +1 then a 10-digit number whose area code and exchange start with 2-9.
alter table public.user_profiles
  drop constraint if exists user_profiles_phone_e164;
alter table public.user_profiles
  add constraint user_profiles_phone_e164
  check (phone is null or phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$') not valid;
-- NOT VALID: existing rows have no phone (null), and this keeps the migration instant. New and updated
-- rows are checked.

-- Lets a signed-in person change their own primary number later (profile screen). Same format rule.
create or replace function public.set_my_phone(p_phone text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  e164 text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if length(d) = 11 and left(d, 1) = '1' then d := substr(d, 2); end if;
  if d !~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then
    raise exception 'Enter a valid 10-digit US mobile number.';
  end if;
  e164 := '+1' || d;
  update public.user_profiles set phone = e164 where id = auth.uid();
  return e164;
end;
$$;
revoke all on function public.set_my_phone(text) from public, anon;
grant execute on function public.set_my_phone(text) to authenticated;
