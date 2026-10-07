-- Phase 7: lets the Stripe webhook record each paid invoice line in the billing ledger.
-- Service role only. Safe to run twice for the same invoice: a line already recorded is skipped, so a
-- retried webhook cannot double-count revenue. The firm is taken from the household's current firm, not
-- from the caller. Unknown line types are stored as 'other'. Returns the number of new rows written.
create or replace function public.billing_ledger_record(p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_rows integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_allowed';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'lines_must_be_an_array';
  end if;

  insert into public.billing_ledger
    (stripe_invoice_id, stripe_line_id, family_id, enterprise_id, period_month, amount, currency,
     line_type, paid_by, description, paid_at)
  select l->>'stripe_invoice_id',
         l->>'stripe_line_id',
         f.id,
         f.enterprise_id,
         date_trunc('month', (l->>'period')::timestamptz)::date,
         round((l->>'amount')::numeric, 2),
         lower(coalesce(nullif(l->>'currency', ''), 'usd')),
         case when l->>'line_type' in ('plan', 'workflow_overage', 'storage', 'partner_seats', 'expert_hours', 'other')
              then l->>'line_type' else 'other' end,
         case when l->>'paid_by' = 'enterprise' then 'enterprise' else 'family' end,
         left(l->>'description', 500),
         (l->>'paid_at')::timestamptz
    from jsonb_array_elements(p_lines) l
    left join public.families f on f.id = nullif(l->>'family_id', '')::uuid
   where coalesce(l->>'stripe_line_id', '') <> ''
  on conflict (stripe_line_id) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

revoke execute on function public.billing_ledger_record(jsonb) from public, anon, authenticated;
grant execute on function public.billing_ledger_record(jsonb) to service_role;
