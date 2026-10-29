-- App access codes for the iPhone / Android test builds (2026-10-29, Will's decision).
--
-- While the native app is in private testing, it asks for an access code ("license number") before the sign-in
-- screen. Each tester gets their own code; an admin can revoke one at any time. The website is not affected.
--
-- Only a SHA-256 hash of each code is stored, never the code itself. app_access_code_create(label) returns the plain
-- code exactly once, to the admin who made it. The app-access-check edge function (verify_jwt off: it runs before
-- sign-in) hashes what the tester typed and checks it here with the service role.
--
-- Codes look like ORD-XXXX-XXXX-XXXX (12 random characters from a 32-letter alphabet, 60 bits), so guessing one
-- is not practical; the function also slows down failed attempts.
--
-- Rollback:
--   drop function if exists public.app_access_code_create(text);
--   drop table if exists public.app_access_codes;

create table if not exists public.app_access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text not null,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  use_count integer not null default 0
);

alter table public.app_access_codes enable row level security;
revoke all on public.app_access_codes from public, anon, authenticated;
grant select, update on public.app_access_codes to authenticated;
grant select, insert, update, delete on public.app_access_codes to service_role;

drop policy if exists app_access_codes_admin_read on public.app_access_codes;
create policy app_access_codes_admin_read on public.app_access_codes for select to authenticated using (public.is_admin());
drop policy if exists app_access_codes_admin_update on public.app_access_codes;
create policy app_access_codes_admin_update on public.app_access_codes for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Admin only: make a code for one tester and return it (the only time it is ever visible).
create or replace function public.app_access_code_create(p_label text)
returns text language plpgsql volatile security definer set search_path to '' as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_raw text := '';
  i int;
begin
  if not public.is_admin() then raise exception 'Only an admin can create app access codes.' using errcode = '42501'; end if;
  if coalesce(btrim(p_label), '') = '' then raise exception 'Give the code a label (who it is for).' using errcode = '22023'; end if;
  v_bytes := extensions.gen_random_bytes(12);
  for i in 0..11 loop
    v_raw := v_raw || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  insert into public.app_access_codes (code_hash, label)
  values (encode(extensions.digest(v_raw, 'sha256'), 'hex'), left(btrim(p_label), 120));
  return 'ORD-' || substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4);
end; $$;
revoke execute on function public.app_access_code_create(text) from public, anon;
grant execute on function public.app_access_code_create(text) to authenticated, service_role;
