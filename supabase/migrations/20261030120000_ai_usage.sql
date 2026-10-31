-- AI usage logging (Will, 2026-10-30: "start with the usage logging").
--
-- Every answer from Claude reports how many tokens it used. Until now that was thrown away, so the cost per household
-- could only be estimated. Each household-facing AI function now writes one row here per answer (through
-- supabase/functions/_shared/ai-usage.ts, with the service role). Nothing in a row is the question, the answer or the
-- document: only which feature, which model, whose household, who asked, and the token counts.
--
-- ai_model_prices holds the per-million-token prices used to turn tokens into dollars; update it when prices change.
-- ai_usage_summary() (admins only) gives cost per household for a date range.

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  function_name text not null,
  model text not null,
  family_id uuid references public.families(id) on delete set null,
  user_id uuid,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0
);
create index if not exists ai_usage_family_created_idx on public.ai_usage (family_id, created_at);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at);

alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_admin_read on public.ai_usage;
create policy ai_usage_admin_read on public.ai_usage for select to authenticated using ((select public.is_admin()));

revoke all on public.ai_usage from public, anon, authenticated;
grant select on public.ai_usage to authenticated;
grant select, insert, update, delete on public.ai_usage to service_role;

create table if not exists public.ai_model_prices (
  model text primary key,
  input_per_mtok numeric not null,
  output_per_mtok numeric not null,
  cache_read_per_mtok numeric not null,
  cache_write_per_mtok numeric not null,
  updated_at timestamptz not null default now()
);
alter table public.ai_model_prices enable row level security;
drop policy if exists ai_model_prices_admin_read on public.ai_model_prices;
create policy ai_model_prices_admin_read on public.ai_model_prices for select to authenticated using ((select public.is_admin()));

revoke all on public.ai_model_prices from public, anon, authenticated;
grant select on public.ai_model_prices to authenticated;
grant select, insert, update, delete on public.ai_model_prices to service_role;

-- Anthropic first-party prices, USD per million tokens (as of 2026-10). Cache writes are 1.25x input (5-minute cache).
insert into public.ai_model_prices (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok) values
  ('claude-sonnet-4-6', 3.00, 15.00, 0.30, 3.75),
  ('claude-sonnet-5-5', 2.00, 10.00, 0.20, 2.50),
  ('claude-opus-5-5',   4.00, 20.00, 0.20, 5.00),
  ('claude-haiku-5-5',  0.10,  0.50, 0.01, 0.125)
on conflict (model) do nothing;

-- Cost per household for [p_from, p_to). family_id null = staff use not tied to one household.
create or replace function public.ai_usage_summary(p_from timestamptz, p_to timestamptz)
returns table (
  family_id uuid,
  family_name text,
  plan text,
  function_name text,
  calls bigint,
  input_tokens bigint,
  output_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  cost_usd numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return query
  select u.family_id, f.name::text, f.plan::text, u.function_name,
         count(*)::bigint,
         sum(u.input_tokens)::bigint, sum(u.output_tokens)::bigint,
         sum(u.cache_read_tokens)::bigint, sum(u.cache_write_tokens)::bigint,
         round(sum(
           (u.input_tokens * coalesce(p.input_per_mtok, 0)
            + u.output_tokens * coalesce(p.output_per_mtok, 0)
            + u.cache_read_tokens * coalesce(p.cache_read_per_mtok, 0)
            + u.cache_write_tokens * coalesce(p.cache_write_per_mtok, 0)) / 1000000.0
         ), 4)
  from public.ai_usage u
  left join public.families f on f.id = u.family_id
  left join public.ai_model_prices p on p.model = u.model
  where u.created_at >= p_from and u.created_at < p_to
  group by u.family_id, f.name, f.plan, u.function_name
  order by 10 desc;
end;
$$;
revoke execute on function public.ai_usage_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.ai_usage_summary(timestamptz, timestamptz) to authenticated;
