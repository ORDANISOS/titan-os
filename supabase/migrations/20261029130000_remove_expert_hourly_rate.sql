-- No Expert hours or hourly rate on any plan (2026-10-29, Will's decision).
--
-- plan_features carried expert_hours_included (Premier 3) and expert_hourly_rate (Premier $250), and Premier's note
-- mentioned them. Nothing in the app, the edge functions or the database reads either column, and they are not
-- offered to clients, so both are dropped and the notes no longer mention hours. Core's note also said "No Expert at
-- any price", which stopped being true when Expert assist ($25 per workflow) shipped, so it is corrected too.
--
-- Rollback:
--   alter table public.plan_features add column if not exists expert_hours_included numeric(6,2) default 0,
--                                    add column if not exists expert_hourly_rate numeric(10,2);
--   update public.plan_features set expert_hours_included = 3, expert_hourly_rate = 250 where plan = 'premier';
--   (notes: restore from this file's history if wanted)

alter table public.plan_features drop column if exists expert_hours_included;
alter table public.plan_features drop column if exists expert_hourly_rate;

update public.plan_features
   set notes = 'Named ORDANIS Expert, bill pay execution, unlimited workflows. 25 GB. Crisis workflows are never metered.'
 where plan = 'premier';
update public.plan_features
   set notes = 'Self-directed. Workflows, obligations, prompts and resources. 10 active workflows included, then $8/month each while active; the household confirms each one and it appears on their Billing tab. 15 GB. Optional ORDANIS Expert on a single workflow for a one-time $25 (expert_assist_price).'
 where plan = 'core';
