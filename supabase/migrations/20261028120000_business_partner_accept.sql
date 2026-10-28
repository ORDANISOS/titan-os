-- Business Partners who serve several households (2026-10-28, Will's decisions).
--
-- A CPA or attorney keeps ONE professional login and switches between the households that added them (this already
-- worked: family_partners is many-to-many and the partner dashboard lists each household). What changes:
--   * When a household invites an email that already has a professional login, the link starts as 'pending' and
--     gives no access until the professional accepts it (manage-business-partner, action "respond"). A typo that
--     happens to match another professional's email can no longer hand them a household's data.
--   * A brand-new professional's link is 'active' straight away: setting their password from the invite is the
--     acceptance, as before.
--   * family_partners.phone: a phone number is required for every new Business Partner so the ORDANIS team can
--     reach them (enforced by manage-business-partner; existing rows may be blank).
--   * Seats are billed only for active links.
-- The household never sees which other households a professional serves.
--
-- current_user_allowed_family_ids() is recreated from 20261022140000 with one change: a partner's households are
-- only those whose link is active. partner_pending_invitations() lets a professional see who is waiting for them.
-- read_access on family_partners lets a household read its own Business Partner list (production already has it;
-- this brings demo in line).
--
-- Rollback:
--   (re-run the current_user_allowed_family_ids definition from 20261022140000)
--   drop function if exists public.partner_pending_invitations();
--   alter table public.family_partners drop column if exists status, drop column if exists phone;

alter table public.family_partners
  add column if not exists status text not null default 'active',
  add column if not exists phone text;
alter table public.family_partners drop constraint if exists family_partners_status_check;
alter table public.family_partners add constraint family_partners_status_check check (status in ('active', 'pending'));

create or replace function public.current_user_allowed_family_ids()
 returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  WITH me AS (SELECT id, email, role, family_id FROM public.user_profiles WHERE id = auth.uid())
  SELECT f.id FROM public.families f, me
  WHERE me.role = 'advisor' AND me.email IS NOT NULL AND f.advisor_email IS NOT NULL
    AND lower(f.advisor_email) = lower(me.email)
  UNION
  SELECT f.id FROM public.families f, me
  WHERE me.role = 'analyst' AND f.advisor_email IS NOT NULL
    AND lower(f.advisor_email) IN (SELECT public.current_user_expert_emails())
  UNION
  SELECT s.family_id FROM public.household_onboarding_specialists s, me
  WHERE me.role IN ('advisor', 'analyst') AND s.staff_id = me.id AND s.ended_at IS NULL AND s.expires_at > now()
  UNION
  SELECT fp.family_id FROM public.family_partners fp, me
  WHERE me.role = 'partner' AND fp.user_id = me.id AND fp.status = 'active'
  UNION
  SELECT me.family_id FROM me
  WHERE me.role = 'client' AND me.family_id IS NOT NULL;
$function$;

create or replace function public.partner_pending_invitations()
returns table(family_id uuid, family_name text, invited_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select fp.family_id, f.name, coalesce(fp.invited_at, fp.created_at)
    from public.family_partners fp join public.families f on f.id = fp.family_id
   where fp.user_id = auth.uid() and fp.status = 'pending' and f.archived_at is null
   order by 3 desc;
$$;
revoke execute on function public.partner_pending_invitations() from public, anon;
grant execute on function public.partner_pending_invitations() to authenticated;

drop policy if exists read_access on public.family_partners;
create policy read_access on public.family_partners for select to authenticated
  using (public.is_admin() or family_id in (select public.current_user_allowed_family_ids()));
