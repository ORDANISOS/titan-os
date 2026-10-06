-- Both prevent_privilege_escalation() and protect_sensitive_profile_columns() are BEFORE UPDATE
-- triggers on public.user_profiles that block/undo changes to role/family_id (and a few other
-- sensitive columns) unless the caller is an admin, per is_admin() (which keys off auth.uid()
-- matching a user_profiles row with role='admin'). That's correct for real end-user requests --
-- it's what stops a client from self-escalating. But it does not exempt the service_role key,
-- which is what this project's own trusted backend Edge Functions (e.g. stripe-webhook) use to
-- authenticate. auth.uid() is null for those calls, so is_admin() is always false for them too,
-- even though linking a newly-paid self-serve signup's auth user to the household stripe-webhook
-- just created is exactly the kind of trusted, system-initiated write this trigger should allow.
-- Confirmed via function_logs: "user_profiles upsert failed for <uid>: Only admins can change
-- role or family_id" -- this was silently blocking every self-serve signup from ever getting
-- linked to its household, even after the separate Stripe webhook-subscription bug was fixed.
--
-- Fix: let auth.role() = 'service_role' bypass the admin check in both trigger functions. Any
-- request carrying an actual end-user JWT (anon or authenticated) is unaffected and still fully
-- subject to the existing admin-only rule.

create or replace function public.prevent_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not is_admin() then
    if new.role is distinct from old.role or new.family_id is distinct from old.family_id then
      raise exception 'Only admins can change role or family_id';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.protect_sensitive_profile_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    new.role := old.role;
    new.active := old.active;
    new.can_run_scheduled_prompts := old.can_run_scheduled_prompts;
    new.family_id := old.family_id;
  end if;
  return new;
end;
$function$;
