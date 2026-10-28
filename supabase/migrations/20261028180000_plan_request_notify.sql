-- Plan-change requests email the ORDANIS team (2026-10-28, Will's request).
--
-- A household's request to move to or from Premier (request_plan_change) used to sit in the admins' Plan requests
-- queue with nobody told. The app now calls the plan-request-notify function right after a request is filed; it
-- emails info@ordanisos.com (secret PLAN_REQUEST_NOTIFY_TO overrides) and stamps notified_at, so each request is
-- emailed once however often the call is repeated. Only the service role writes the stamp.
--
-- Rollback: alter table public.plan_change_requests drop column if exists notified_at;

alter table public.plan_change_requests add column if not exists notified_at timestamptz;
