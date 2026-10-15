# Runbook: switching production Stripe from test to live

Written 2026-10-15. Production (`xreeruxuwtmjhvvxvjts`) currently runs on Stripe **test** keys: its households exist only in
Stripe's test mode and no real card can be charged. Demo stays on test mode permanently.

Who does what: **Will** handles everything inside Stripe and every secret (keys are never pasted into chat, the repo or
this file). **Claude** updates the non-secret product IDs in the database and verifies each step.

## What depends on Stripe

| Thing | Where it lives | Live-mode action |
|---|---|---|
| Secret API key | Supabase function secret `STRIPE_SECRET_KEY` (read by 12 functions) | Replace with the live key |
| Webhook signing secret | Supabase function secret `STRIPE_WEBHOOK_SECRET` (stripe-webhook) | Replace with the live endpoint's secret |
| Basic / Core / Premier products | `plan_features.stripe_product_id` | Create 3 live products; Claude stores their IDs |
| Prices | none stored: checkout builds them from `plan_features.monthly_price` | nothing |
| Extra-workflow, Expert-assist, partner-seat products | found by `metadata.kind` or created on first use | nothing (created automatically in live mode) |
| Existing households' Stripe IDs | `families.stripe_customer_id / stripe_subscription_id` | test IDs; see step 1 |

## Steps

### 1. Before the switch: remove test households (Will)
The 7 current production households are test households with **test** Stripe IDs. After the switch, live Stripe will not
recognise those IDs, and `purge-family` refuses to delete a household whose billing it cannot confirm with Stripe. So archive
and purge the test households, and delete the test logins, **while still on test keys**.

### 2. Stripe account ready for live (Will)
In Stripe with **Test mode off**: business details complete, bank account added, account able to accept payments.

### 3. Create the three plan products in live mode (Will)
Stripe → Product catalog → Add product, Test mode off. One product each: **ORDANIS Basic**, **ORDANIS Core**,
**ORDANIS Premier**. No price is needed (the platform sets the price at checkout).
**Set each product's tax code to "Software as a service (SaaS)".** The platform uses Stripe **Managed Payments** (Stripe
handles sales tax), and Managed Payments refuses to start Checkout for a product without a tax code.
Copy each product's ID (`prod_…`). Product IDs are not secret; give them to Claude in chat.

### 4. Create the live webhook endpoint (Will)
Stripe → Developers → Webhooks → Add endpoint, Test mode off.
- URL: `https://xreeruxuwtmjhvvxvjts.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.upcoming`
- Reveal the **signing secret** (`whsec_…`). Do not share it.

### 5. Cut over, all at once (Will, then Claude)
Do these back to back so checkout never mixes a live key with test products:
1. Will: Supabase → Edge Functions → Secrets: set `STRIPE_SECRET_KEY` to the **live** secret key (`sk_live_…`).
2. Will: same page: set `STRIPE_WEBHOOK_SECRET` to the live endpoint's signing secret.
3. Claude: set `plan_features.stripe_product_id` to the three live product IDs from step 3, and verify.
4. Will: deploy the two checkout functions that switch Managed Payments ON (committed 2026-10-15):
   `supabase functions deploy public-signup --project-ref xreeruxuwtmjhvvxvjts --use-api --no-verify-jwt`
   `supabase functions deploy create-checkout-session --project-ref xreeruxuwtmjhvvxvjts --use-api`

### 6. Prove it (Will, Claude watching)
One real sign-up at `portal.ordanisos.com/signup` on Will's card. Expected:
- the login cannot sign in before paying;
- after paying, the household is created, the login works, the subscription carries `family_id` metadata;
- the webhook delivery shows **succeeded** in Stripe, and a row appears in `billing_ledger`.
Then refund it in Stripe.

## Rollback
Put the test values back in `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` and restore the test product IDs in
`plan_features`. Test product IDs on production as of 2026-10-15:

| plan | price | test `stripe_product_id` |
|---|---|---|
| basic | $15 | `prod_VHaNPN85y1ufJb` |
| core | $100 | `prod_VHaOK1Rf7qARW0` |
| premier | $500 | `prod_VHaOwFMMUmdtzl` |

## Sales tax: Managed Payments
The platform uses Stripe **Managed Payments** (decided 2026-10-15): Checkout runs with `managed_payments: { enabled: true }`
in public-signup and create-checkout-session, and Stripe handles sales tax for those subscriptions. Every product used at
Checkout needs a tax code (step 3).

**Open question for Stripe support, before launch:** besides Checkout, the platform charges through the API in 8 places:
plan upgrades/downgrades (`change-subscription-plan`), extra workflows (`purchase-workflow`, `bill-workflow-overages`),
Expert assist (`request-expert-assist`), partner seats (`manage-business-partner`), the contacts add-on
(`toggle-contacts-import`) and firm invoices (`enterprise-invoice`). Ask Stripe: are subscription updates and invoice items
added by API to a subscription that began in a Managed Payments Checkout also covered by Managed Payments? If not, those
charges need a different setup so every charge is taxed the same way.
