-- Plan preview videos (Basic / Core / Premier).
-- A client sees a pop-up offering a quick video of their plan on sign-in until they have played it once
-- (or until it has been offered three times). After that, a "Watch the video" link in the assistant's
-- sign-in greeting is the way to watch it again.
-- PRODUCTION: the videos live in the private "Videos" storage bucket (ORDANIS_Basic.mp4, ORDANIS_Core.mp4,
-- ORDANIS_Premier.mp4). Run this in the Supabase SQL editor (not `supabase db push`).

alter table public.user_profiles
  add column if not exists plan_video_offers int not null default 0,
  add column if not exists plan_video_seen_at timestamptz;

-- Called once per sign-in. Counts the offer and says whether the person has already played the video.
create or replace function public.record_plan_video_offer()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  s timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.user_profiles
     set plan_video_offers = least(plan_video_offers + 1, 99)
   where id = auth.uid()
  returning plan_video_offers, plan_video_seen_at into n, s;
  return jsonb_build_object('offers', coalesce(n, 99), 'seen', (s is not null) or n is null);
end;
$$;
revoke all on function public.record_plan_video_offer() from public, anon;
grant execute on function public.record_plan_video_offer() to authenticated;

-- Called when the video starts playing.
create or replace function public.mark_plan_video_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.user_profiles
     set plan_video_seen_at = coalesce(plan_video_seen_at, now())
   where id = auth.uid();
end;
$$;
revoke all on function public.mark_plan_video_seen() from public, anon;
grant execute on function public.mark_plan_video_seen() to authenticated;

-- Signed-in users may read (and so create short-lived signed links for) the files in the Videos bucket.
-- Nobody signed out can. Nobody can write, change or delete through the app.
drop policy if exists "videos_read_signed_in" on storage.objects;
create policy "videos_read_signed_in" on storage.objects
  for select to authenticated
  using (bucket_id = 'Videos');
