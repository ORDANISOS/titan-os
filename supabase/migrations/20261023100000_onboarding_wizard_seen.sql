-- Onboarding wizard: remembered on the household, not the browser (2026-10-23, Will's decision).
--
-- The setup wizard opens once, on its own, for a new empty Basic/Core household. "Seen" used to live in the
-- browser (localStorage), so it came back on every new device or browser while the household was still empty.
-- families.onboarding_wizard_seen_at records it for the household; the client can still reopen the wizard from
-- the "Setup guide" link. Clients cannot update families directly, so it is set through
-- onboarding_wizard_mark_seen(), which only lets a client of that household (or staff) mark their own household.
-- No new table, so no grant changes.
--
-- Rollback:
--   drop function if exists public.onboarding_wizard_mark_seen(uuid);
--   alter table public.families drop column if exists onboarding_wizard_seen_at;

alter table public.families add column if not exists onboarding_wizard_seen_at timestamptz;

create or replace function public.onboarding_wizard_mark_seen(p_family_id uuid)
returns timestamptz language plpgsql volatile security definer set search_path to '' as $$
declare v timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  if not (public.is_admin() or p_family_id in (select public.current_user_allowed_family_ids())) then
    raise exception 'Household not found.' using errcode = 'P0002';
  end if;
  update public.families set onboarding_wizard_seen_at = coalesce(onboarding_wizard_seen_at, now())
   where id = p_family_id returning onboarding_wizard_seen_at into v;
  return v;
end; $$;
revoke execute on function public.onboarding_wizard_mark_seen(uuid) from public, anon;
grant execute on function public.onboarding_wizard_mark_seen(uuid) to authenticated;
