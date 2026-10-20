# RUNBOOK: MILO (marketing console)

MILO = Marketing Intelligence, Leads & Outreach. Front end: `~/Documents/GitHub/ordanis-milo` (local repo, no remote yet).
Back end (this repo): `supabase/functions/milo-command`, `milo-social`, `milo-speak`, migration `20261019120000_milo_marketing.sql`.

## Status (2026-10-19)
| Step | Demo (`tkryueqzvgcigvxgjzsp`) | Production (`xreeruxuwtmjhvvxvjts`) |
|---|---|---|
| Migration 20261019120000 | applied, verified (RLS, grants, Vault secret) | not applied |
| milo-command / milo-social / milo-speak | deployed (milo-social verify_jwt off) | not deployed |
| Marketing pages (`milo_pages`) | 4 live pages loaded | not loaded |
| Cron `milo-hourly` (minute 7) | scheduled, test run returned 200 | not scheduled |
| Instagram / LinkedIn app keys | not set (Connect shows "waiting on keys") | not set |
| ElevenLabs voice | not set on demo (device voice) | shares ELEVENLABS_API_KEY with ELIOT |
| Front end hosting | local only | Vercel project + milo.ordanisos.com not created |

## Function secrets MILO reads (names only; Will sets values, never in chat)
- Shared, already present: `ANTHROPIC_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `ELEVENLABS_API_KEY` (production).
- New, optional: `MILO_APP_ORIGINS` (comma list; default `https://milo.ordanisos.com,http://localhost:5177`), `MILO_VOICE_ID`,
  `MILO_MODEL`, `MILO_BRIEFING_WEEKDAY` (1 = Monday), `MILO_BRIEFING_HOUR` (8, Eastern), `MILO_SOCIAL_SYNC_HOUR` (6, Eastern).
- Instagram: `META_IG_APP_ID`, `META_IG_APP_SECRET` (optional `META_GRAPH_VERSION`, default v23.0).
- LinkedIn: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` (optional `LINKEDIN_API_VERSION`, default 202509).

## Setting up Instagram and LinkedIn (Will)
1. Instagram: the account must be a Business or Creator account. In Meta for Developers create an app with the product
   "Instagram API with Instagram Login". Add the redirect URI exactly:
   `https://<project-ref>.supabase.co/functions/v1/milo-social/callback/instagram`. Scopes used: `instagram_business_basic`,
   `instagram_business_manage_insights`. In development mode only people with a role on the app can connect (fine for admins).
2. LinkedIn: create an app at developer.linkedin.com tied to the ORDANIS company page, request the Community Management API
   product (LinkedIn reviews it; can need business verification). Redirect URI:
   `https://<project-ref>.supabase.co/functions/v1/milo-social/callback/linkedin`. Scopes: `r_organization_social`,
   `rw_organization_admin`, `r_organization_followers`. The person connecting must be a page admin.
3. Set the secrets on the project (Will runs, values typed into his own terminal):
   `supabase secrets set META_IG_APP_ID=... META_IG_APP_SECRET=... --project-ref <ref>` (same for LinkedIn).
4. In MILO: Social accounts > Connect. The first sync runs right away; then daily after 6 AM Eastern.
Read-only scopes only. Tokens are stored in Vault; disconnecting deletes them.

## Production steps (each needs Will's approval; do NOT run ahead)
1. Migration: run `20261019120000_milo_marketing.sql` (plain tables/functions; execute_sql works), verify, then record
   `insert into supabase_migrations.schema_migrations (version, name) values ('20261019120000','milo_marketing');`
2. Deploy: `supabase functions deploy milo-command --project-ref xreeruxuwtmjhvvxvjts --use-api` (then milo-social, milo-speak).
3. Pages: `python3 -I ~/Documents/GitHub/ordanis-milo/scripts/extract-pages.py ~/Documents/ordanis-site > milo_pages.sql`, review, run.
4. Cron (uses production's PUBLIC anon key in the header; the secret is read from Vault at run time):
   ```sql
   select cron.schedule('milo-hourly', '7 * * * *', $job$
     select net.http_post(
       url := 'https://xreeruxuwtmjhvvxvjts.supabase.co/functions/v1/milo-command',
       headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <PRODUCTION ANON KEY>',
         'x-milo-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'milo_cron_secret')),
       body := '{"scheduled": true}'::jsonb, timeout_milliseconds := 120000);
   $job$);
   ```
5. Front end: create GitHub repo + Vercel project `ordanis-milo` (Production env -> production URL/anon key; Preview -> demo),
   domain milo.ordanisos.com (GoDaddy CNAME), set `MILO_APP_ORIGINS` accordingly.

## Turn off / roll back
- Stop scheduled runs: `select cron.unschedule('milo-hourly');` (data stays).
- Disconnect a social account in MILO (deletes its Vault token), or `select public.milo_vault_drop(token_secret_id) ...` as service role.
- The tables are self-contained (`milo_*`); nothing else in the platform reads them.

## Known limits (honest)
- Signups aren't tagged with the campaign that brought them; cost per signup is BLENDED. Follow-up: capture UTM/source at signup.
- LinkedIn post-level numbers are not pulled yet (page-level only). Instagram metric names change; failures show in the account's note.
- Phase 1 is admins only; a `marketing` role is a later step (`canUse()` in milo-command + a role value in user_profiles).
