# ORDANIS platform (repo: pcm-realestate)

Multi-enterprise client portal. A household (family) gets a private place for its records, obligations, workflows,
documents and an AI assistant; a firm (enterprise) can sit on top with view-only admin access and its own skin.
React 18 + Vite single-page app, Supabase (Postgres + RLS + edge functions + storage), Stripe, hosted on Vercel.
Owner: Will Perez (wperez@pcmfamilyoffice.com), PCM Family Office / Ordanis OS LLC. First firm: Accurate Advisory Group (not live yet).

## Standing rules (Will's own words, follow every time)
- "Always be honest. Suggest alternatives when necessary. Keep security top of mind."
- "Always apply directly if you can after receiving approval."
- "If you are asking to commit something always give me the code to run."
- Nothing goes to production without Will's explicit approval, per step. Approval for one step is not approval for the next.
- Never `supabase db push`. Never a bare `git push` (always name the remote).
- Do NOT move households from demo to production. Demo households and demo data are never copied into production.
- Never permanently delete a household (`purge-family` is Will's call). Never enter, request or store passwords/keys.
  Never put secrets in the repo, in chat, or in this file.

## Environments
| | Demo | Production |
|---|---|---|
| Git remote | `ordanis-demo` (github.com/ORDANISOS/titan-os, branch main) | `ordanis-production` (github.com/PCMFamilyOffice/pcm-realestate, branch main) |
| Supabase ref | `tkryueqzvgcigvxgjzsp` | `xreeruxuwtmjhvvxvjts` |
| App | demo deploys on push | portal.ordanisos.com, deploys on push to main |
| Vercel | - | project `ordanis-platform` (prj_So0oNGQnefn52u7IM6tkxwVvVf2K), team ORDANIS OS (team_xhHl6Kb48u3TrsDmBzF9rGlT) |

- Confirm a production deploy: `https://portal.ordanisos.com/version.json` shows the build id (git short sha) and time.
- If a push produces no Vercel build, check Settings > Git on the project: the repo link was once found disconnected.
- The Supabase CLI in this folder is LINKED TO PRODUCTION. Always pass `--project-ref` explicitly and ask before any CLI command that writes.
- Marketing site is a separate, non-git folder: `~/Documents/ordanis-site` (see its own CLAUDE.md).

## Database and edge-function rules (production)
- Production's migration history does NOT line up with repo file names. Apply migrations ONE FILE AT A TIME, verify,
  then record the repo version in `supabase_migrations.schema_migrations (version, name)`. Re-read each file for
  update/delete/alter-column on existing tables first.
- The Supabase MCP `apply_migration` and any trigger / storage-policy DDL hangs (timeout). Run those in the Supabase SQL editor
  (Will runs them). Plain tables, columns and functions work through `execute_sql`.
- Edge functions: `supabase functions deploy <name> --project-ref xreeruxuwtmjhvvxvjts --use-api`. Deploy only the functions named
  in the approved step (several function files carry uncommitted wording edits). `stripe-webhook` and `public-signup` keep JWT
  verification OFF; pin `npm:@supabase/supabase-js@2.49.4`. Before replacing a function, read production's deployed source and
  diff it with the repo file (demo's assistant drifted once). Save the old source for rollback.
- Security-definer functions: `revoke ... from public, anon; grant execute ... to authenticated`. Check RLS on every new table.
- Table grants (Supabase change, 2026-10-30): new tables in `public` no longer get Data API grants automatically (existing tables
  keep theirs; it also hits fresh rebuilds and branches). Every migration that creates a table grants explicitly, least privilege:
  `service_role` select/insert/update/delete (server functions); `authenticated` only what the app needs, RLS still filtering;
  `anon` nothing unless the table is truly public. Never copy Supabase's template that grants select to anon. A migration
  applied after 2026-10-30 without grants gives "permission denied" to the app and functions.
- Plan data lives in `plan_features` (Basic $15/5 GB no workflows; Core $100/15 GB, 10 workflows then $8, advisor seats + white label,
  optional Expert on one workflow $25 one time via `expert_assist_price`; Premier $500, named Expert, bill pay, unlimited workflows).
  There is NO firm rate card (Will removed it for good, 2026-10-22): a firm-paid household is billed to its firm at the same
  plan prices above, on the firm's monthly invoice. Never quote or reintroduce separate firm prices.

## Frontend (src/App.jsx is ~14k lines; src/plans.js holds plan gating)
- Edit with targeted, asserted string replacements; never retype the file. After editing, syntax-check:
  `npx --yes esbuild --loader=jsx --log-level=error < src/App.jsx > /dev/null` (flag is `--loader=jsx`), then `npm test`.
- Building blocks: `Field`, `Btn`, `Modal`, `toast`, theme tokens `B`, `planIsSelfServe`, `SIGNUP_PLAN_ORDER`, `planAllows`, `planLabel`.
- Data load: `TABLES` list and a snake_case to camelCase map near the top (~line 790). Keys not in the map stay snake_case
  (e.g. `family.enterprise_id`).
- Client portal component renders the dashboard, `AssistantWelcome` (sign-in greeting), `FloatingAssistant`.
- Sign-up is paused: `SIGNUP_PAUSED_URL` sends the login screen's "Create an Account" link to
  https://ordanisos.com/signup-maintenance.html. Set it to "" to restore /signup. Direct /signup URLs still work (firm onboarding links).
- `VITE_HIDE_SIGNUP` is demo-only. `VITE_BRAND_RUNTIME=1` must be set on production for skin by host/firm (verify in Vercel).
- Plan preview video: private storage bucket `Videos` (ORDANIS_Basic/Core/Premier.mp4), pop-up on client sign-in until played
  (max 3 offers), link in the assistant greeting, firm households excluded. State in `user_profiles.plan_video_offers/plan_video_seen_at`.
- Native app live updates (`src/liveUpdate.js`, `scripts/app-update-bundle.mjs`): every Vercel production deploy also
  publishes `/app-update/latest.json` + a zipped app bundle on the same site (demo site -> demo app, portal -> production
  app). Phones download it on launch and switch on next background. Capgo's servers are switched off in
  `capacitor.config.json`. A change that needs new native code (plugin, permission, icon) needs a store build: raise
  `ordanisApp.minNative` in package.json together with MARKETING_VERSION in Xcode.
- Git hygiene: the working tree has unrelated modified files (`supabase/.temp/*`, function drift copies, `*.bak`). Stage specific files only.

## Brand and wording
Navy #0A2540, gold #C9A961, paper #F8F6F1; Georgia headings, Arial body. Product is ORDANIS (not Titan); the Vault is now CHRIS;
experts are "ORDANIS Expert". Warm, plain-language voice. Third-party costs (email address, Bill.com fees) are separate from plan fees.

## Confidential
The OpenArc intelligence brief and any litigation/competitor content must never appear in client-facing material.

## Where the rest of the context lives
- claude.ai Project "Ordanis platform": pricing pages, GTM strategy, email-portal SOP/deploy, logo kit, Q4 budget, workflow library review.
- Claude Doc "ORDANIS Production Release Plan" (id 783795c4-596a-47c3-a956-4efc59cdf789): steps 0-4, 6 done; Step 5 app deployed;
  Step 7 (firm notice) waits for the first firm. Phase 5 (domains/DNS) and Phase 10 (expert dashboard filter, pilot) are parked.
- In this repo: `FEATURES.md`, `docs/HANDOFF-*.md`, `docs/RUNBOOK-*.md`, `supabase/migrations/`.
- ELIOT (Executive Liaison for Inbox, Operations & Tasks; formerly "Jarvis", renamed 2026-10-16), the admins' voice console, is a
  SEPARATE app: `~/Documents/GitHub/ordanis-eliot` (repo ORDANISOS/ordanis-eliot) -> eliot.ordanisos.com (jarvis.ordanisos.com was removed from Vercel
  on 2026-10-16). Never use the old name in anything people see. Never add it to
  the portal (no /hub route) or to the email portal. Its back end lives here: `supabase/functions/hub-command` and
  `public.audit_log` (migration `20261014130000_hub_audit_log`), both live on production since 2026-10-14.
- MILO (Marketing Intelligence, Leads & Outreach), the marketing team's console, is ELIOT's sibling in a WHITE theme:
  `~/Documents/GitHub/ordanis-milo` (repo ORDANISOS/ordanis-milo -> Vercel `ordanis-milo` -> milo.ordanisos.com; a push to its main
  deploys production). Back end here: `supabase/functions/milo-command`, `milo-social` (OAuth callback, verify_jwt off), `milo-speak`,
  migrations `20261019120000_milo_marketing` + `20261020120000_signup_attribution`. Live on demo and production (back end 2026-10-20,
  app 2026-10-21); status and Instagram/LinkedIn setup in `docs/RUNBOOK-MILO.md`. MILO never sees households.

## Open items (as of 2026-10-14)
1. DONE 2026-10-15: assistant-name rules fully live on production (trigger in place and verified, migration 20261012110000 recorded).
   One existing household still carries a blocked name (TEST PEREZ PHONE, "sucka"); the rule only checks new or changed names (see item 8).
2. DONE (confirmed 2026-10-15): the three retired stub functions (`debug-stripe-info`, `debug-stripe-info-v2`,
   `cleanup-delete-user-once`) no longer exist on production.
3. DONE 2026-10-14: production Vercel has `VITE_BRAND_RUNTIME=1` (live login calls `brand_for_host`) and no `VITE_HIDE_SIGNUP`.
   Note: `VITE_BRAND_RUNTIME` targets production only, so preview builds use the bundled skin.
4. Test Expert-assist on production with Will's own card-paid Core household, then refund the $25.
5. Stripe end-to-end test (8b) still parked; Stripe live-mode gates parked.
6. Demo has none of the plan-video feature (needs the migration + a Videos bucket on the demo project).
7. Parked security items: service-role key in a cron job, anon execute on some privileged functions, unpinned search paths, pg_net in public.
8. Household decisions pending: TEST PEREZ PHONE (assistant name "sucka"), archived Harrington/Okonkwo/TEST 8b (purge is Will's call), demo junk obligations.
9. Counsel review of the Expert paragraph refund line and the SMS consent wording. Repo rename off titan-os is parked.

## Go-live (Will, 2026-10-29: "turn everything on")
- All production cron jobs are active, including daily reminders (job 2, `send-task-reminders`, 13:00 UTC). It sends
  each ORDANIS Expert ONE daily summary (task reminders, bills they pay, Client Activity) plus the family emails.
- Client Activity: `household_activity` (migrations 20261029100000/110000) logs every change a family login makes;
  staff see it on the household's Client Activity tab. Premier families edit the same records as Basic/Core.
- Tabled until the official launch (Will, 2026-10-29), in this order: Stripe end-to-end test (8b) and live-mode gates;
  Expert-assist test on Will's card-paid Core household (refund the $25); then reopen sign-up (`SIGNUP_PAUSED_URL` = "").
