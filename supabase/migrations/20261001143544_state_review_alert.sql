-- The alert that tells someone there is work waiting.
--
-- Deliberately NOT sent per proposal. A run that files 300 rows must produce one
-- message, not three hundred - the fastest way to make an alert ignored is to
-- make it frequent.
create table if not exists public.state_review_alerts (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid,
  pending     integer not null,
  needs_judgement integer not null,
  sent_to     text,
  sent_at     timestamptz,
  send_error  text,
  created_at  timestamptz not null default now()
);
alter table public.state_review_alerts enable row level security;
drop policy if exists admin_all on public.state_review_alerts;
create policy admin_all on public.state_review_alerts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Who to tell, and whether it is worth telling them. Returns no row when there is
-- nothing waiting, so the caller sends nothing rather than an empty digest.
create or replace function public.state_review_alert_due(p_run_id uuid default null)
returns table(recipient text, pending integer, needs_judgement integer,
              oldest_days integer, subject text, summary text)
language sql stable security definer set search_path to 'public'
as $function$
  with s as (select * from state_review_summary())
  select
    (select u.email from user_profiles u
      where u.role = 'admin' and coalesce(u.active,true)
      order by u.created_at limit 1),
    s.pending, s.needs_judgement,
    (current_date - s.oldest_pending::date)::int,
    case when s.needs_judgement > 0
      then s.needs_judgement || ' state rule' || case when s.needs_judgement=1 then '' else 's' end || ' need a decision'
      else s.pending || ' state rule' || case when s.pending=1 then '' else 's' end || ' ready to clear'
    end,
    'The state rule review agent has finished. ' ||
    s.needs_judgement || ' of ' || s.pending ||
    ' need a person to look: the agent was unsure, could not reach the source, or found a figure that moved. ' ||
    (s.pending - s.needs_judgement) ||
    ' were unchanged at high confidence and can be cleared in bulk once you have spot-checked a few. ' ||
    'Nothing is treated as verified until you approve it.'
  from s
  where s.pending > 0 and caller_is_privileged();
$function$;
revoke execute on function public.state_review_alert_due(uuid) from public, anon;
grant execute on function public.state_review_alert_due(uuid) to authenticated, service_role;

select * from public.state_review_alert_due();