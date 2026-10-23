-- Two-step sign-in reminder for clients (2026-10-22, Will's decision).
--
-- A client who hasn't set up two-step sign-in sees the Security button flagged ("Set up security") until they
-- either turn it on or choose not to. user_profiles.mfa_opted_out_at records that choice (also set when a client
-- turns two-step off); clearing it brings the reminder back. Staff are unaffected (two-step is required for them).
--
-- Written only through mfa_opt_out_set(), which touches the caller's own row and this one column, same pattern as
-- the plan-video functions (20261013120000). No new table, so no grant changes.
--
-- Rollback:
--   drop function if exists public.mfa_opt_out_set(boolean);
--   alter table public.user_profiles drop column if exists mfa_opted_out_at;

alter table public.user_profiles add column if not exists mfa_opted_out_at timestamptz;

create or replace function public.mfa_opt_out_set(p_opt_out boolean)
returns timestamptz language plpgsql volatile security definer set search_path to '' as $$
declare v timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  update public.user_profiles
     set mfa_opted_out_at = case when p_opt_out then coalesce(mfa_opted_out_at, now()) else null end
   where id = auth.uid()
  returning mfa_opted_out_at into v;
  return v;
end; $$;
revoke execute on function public.mfa_opt_out_set(boolean) from public, anon;
grant execute on function public.mfa_opt_out_set(boolean) to authenticated;
