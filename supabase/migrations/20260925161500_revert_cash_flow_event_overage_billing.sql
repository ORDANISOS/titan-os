-- Correction: cash flow events are part of the platform included with every self-serve plan --
-- there is no charge for them, at any count. The overage/billing mechanism added in
-- cash_flow_event_overage_billing was built on a wrong assumption and is fully reverted here.
-- Basic and Core keep unrestricted, uncharged add/edit/delete on their own cash flow events (the
-- ClientDashboard/CashFlowView UI change from the earlier "let self-directed households manage
-- their own Cash Flow events" commit stays -- only the billing layer on top of it is removed).

drop function if exists public.record_cash_flow_event_overages(date);
drop function if exists public.family_cash_flow_event_month_usage(uuid, date);
drop table if exists public.cash_flow_event_overage_charges;

alter table public.cash_flow_events drop column if exists active;

alter table public.plan_features
  drop column if exists cash_flow_events_included,
  drop column if exists cash_flow_event_overage_price;

select cron.unschedule('cash-flow-event-overage-monthly');
