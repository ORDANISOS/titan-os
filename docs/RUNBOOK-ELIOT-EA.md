# ELIOT executive assistant: runbook

Will's personal executive assistant, built into ELIOT (eliot.ordanisos.com). Only people with a row in
`eliot_ea_profiles` where `enabled = true` see it (Will, for now). Experts can be added later by inserting a row.

## Phases
| Phase | What | Status |
|---|---|---|
| 1 | Outlook calendar in ELIOT (Today / Week), alerts before meetings, Sunday week preview, "open for calls" blocks, voice: "what's on my calendar" | Live: demo and production 2026-10-24 (ELIOT build 838038d) |
| 1b | Confirm-first changes: book, move, cancel (own meetings), accept / tentative / decline, by voice or tap | Live: demo and production 2026-10-24 (ELIOT build 838038d) |
| 2 | "Plan my week": time blocks for team tasks, household tasks, bills/deadlines, workflow steps; ignore list (Work Schedule); iPhone listening (eliot-listen, ElevenLabs) | Live on demo and production 2026-10-26 (hub-command 026a3fc, ELIOT build 5cd13e5) |
| 3 | Email triage and Outlook drafts (no send permission); meeting agendas | Planned |
| 4 | Zoom links on meetings | Planned |
| 5 | Phone: 1-844-ORDANIS IVR (book in open-for-calls blocks, route to the right channel), plus Will's missed calls | Planned |

## Phase 1 pieces
- Migration `supabase/migrations/20261023120000_eliot_ea_calendar.sql`: four server-only tables (RLS on, no policies,
  service_role grants only) and turns the assistant on for wperez@ordanisos.com.
- `supabase/functions/hub-command/calendar.ts` + changes in `hub-command/index.ts`: `{ calendar: status|connect|finish|disconnect|events|settings }`,
  the `my_calendar` voice tool (only offered to enabled + connected people), and meeting alerts and the week preview in the 5-minute scheduled run.
- ELIOT `src/Eliot.jsx`: `CalendarPanel` + `CalendarSettings` (right column, above Team tasks). Dev preview: `/?preview=console&cal=1`.

## Confirm-first changes (Phase 1b)
- Voice tool `propose_calendar_change` only drafts. The draft is stored in `eliot_ea_drafts` and shown as a card; confirm (tap, or a
  spoken yes) calls `{ calendar: "confirm", id }`, which runs exactly the stored draft, once, within 15 minutes. No, Discard or
  expiry drops it. Every confirm is in `audit_log` (module `calendar`).
- Book: attendees must be real email addresses; anyone outside ordanisos.com is flagged on the card.
  Uses the draft id as Graph `transactionId`, so a retry can't double-book.
- Video: ORDANIS uses **Zoom, never Teams**. A booking with attendees and no location gets a Zoom meeting by default (say "in
  person" or give a location to skip it). On confirm, ELIOT creates the Zoom meeting first (waiting room on, host required),
  then the Outlook event with the join link, ID and passcode in the invite; if Outlook refuses, the Zoom meeting is deleted.
  Moving or cancelling a meeting whose link is on ORDANIS's Zoom moves or deletes the Zoom meeting too (`hub-command/zoom.ts`).
- Move and cancel: only meetings Will organizes (Outlook won't let attendees do either). Cancel with attendees sends a
  cancellation; without attendees the event goes to Outlook's Deleted Items (recoverable).
- Respond: accept, tentative or decline invitations from others, with an optional note, telling the organizer by default.
- Overlaps with other meetings are shown on the card before you confirm.

## Demo notes
- Demo has NO `eliot-briefings` cron job, so meeting alerts and the week preview don't run there on their own. Everything you
  do in the app works (connect, Today/Week, settings, voice, book/move/cancel/answer). Production has the job.
- Test against demo from `http://localhost:5176` (preview config `eliot-dev`), signed in as wperez@ordanisos.com.
- Rollback copy of demo's previous hub-command: the pre-change source equals git HEAD `804452a`.

## Security
- Microsoft sign-in uses the authorization code flow with PKCE and a single-use state tied to the signed-in admin (admin role + MFA checked by hub-command).
- Permissions requested: `offline_access User.Read Calendars.ReadWrite` (read-write, chosen by Will so booking needs no second sign-in).
  Phase 1 only reads. Any tool that writes must draft the change, read it back and wait for a yes; creating or moving a meeting
  with attendees sends invites from wperez@ordanisos.com.
- Tokens are encrypted (AES-GCM, key `EA_TOKEN_KEY`) before they are stored. The browser never sees a Microsoft token.
- Lock-screen alerts show the time only ("Meeting at 2:30 PM · in 15 min"), never a subject or a name.
- Meeting subjects are treated as untrusted data in every model prompt.

## One-time Microsoft setup (Will does this; no secret ever goes in chat or the repo)
This is ORDANIS's Microsoft 365 (ordanisos.com), not any other company's tenant. The calendar connected is wperez@ordanisos.com.

1. Go to https://entra.microsoft.com and sign in as an ordanisos.com Microsoft 365 admin.
2. Go to **Applications > App registrations > New registration**.
   - Name: `ELIOT`
   - Supported account types: **Accounts in this organizational directory only** (single tenant).
   - Redirect URI: platform **Web**, `https://eliot.ordanisos.com/`
   - Register.
3. On the app's **Authentication** page, add a second Web redirect URI, `http://localhost:5176/` (for testing against demo). Save.
4. On **API permissions**, choose **Add a permission > Microsoft Graph > Delegated** and add `Calendars.ReadWrite`, `User.Read` and `offline_access`.
   Click **Grant admin consent for** your ORDANIS organization (the button shows ORDANIS's Microsoft 365 org name).
5. On **Certificates & secrets**, choose **New client secret**. Set it to expire in 24 months and copy the **Value** right away (it's shown once).
6. From **Overview**, copy the **Application (client) ID** and the **Directory (tenant) ID**.
7. Set the function secrets, demo first. Run these in Terminal yourself so the values never pass through chat:
   ```bash
   cd ~/Documents/GitHub/pcm-realestate
   supabase secrets set --project-ref tkryueqzvgcigvxgjzsp EA_TOKEN_KEY=$(openssl rand -base64 32)
   supabase secrets set --project-ref tkryueqzvgcigvxgjzsp MS_TENANT_ID="PASTE_TENANT_ID" MS_CLIENT_ID="PASTE_CLIENT_ID" MS_CLIENT_SECRET="PASTE_SECRET_VALUE"
   ```
   Replace each PASTE_… word with the real value and keep the quotes. Don't type angle brackets: zsh reads `<` as "read from a file"
   and fails with "no such file or directory". You can also add the three Microsoft values in the Supabase dashboard
   (Project Settings > Edge Functions > Secrets).
   Production later uses the same command with `--project-ref xreeruxuwtmjhvvxvjts` and its own fresh `EA_TOKEN_KEY`.
   Production can't decrypt tokens saved on demo, which is intended.
8. Put a reminder on the calendar a month before the client secret expires.

## One-time Zoom setup (Will does this, as the ORDANIS Zoom account owner or admin)
1. Go to https://marketplace.zoom.us, sign in with the ORDANIS Zoom account, then **Develop > Build App > Server-to-Server OAuth App**. Name it `ELIOT`.
2. Copy the **Account ID**, **Client ID** and **Client Secret** from App Credentials.
3. Fill in the required Information page (company ORDANIS OS LLC, contact wperez@ordanisos.com).
4. **Scopes**: add only the meeting ones: view, create, update and delete meetings (search "meeting"). Nothing for users, recordings, chat or billing.
5. **Activate** the app.
6. Set the secrets (demo first; replace each PASTE_… word and keep the quotes):
   ```bash
   cd ~/Documents/GitHub/pcm-realestate && supabase secrets set --project-ref tkryueqzvgcigvxgjzsp ZOOM_ACCOUNT_ID="PASTE_ACCOUNT_ID" ZOOM_CLIENT_ID="PASTE_CLIENT_ID" ZOOM_CLIENT_SECRET="PASTE_CLIENT_SECRET"
   ```
   Meetings are hosted by the Zoom login **info@ordanisos.com** (`ZOOM_USER_EMAIL`, set on demo and production 2026-10-24). If the Zoom login changes, update that secret.
- A free Zoom license caps meetings with 3+ people at 40 minutes; the host user should have a paid license.
- A Server-to-Server app acts for the whole Zoom account, so keep its scopes to meetings only and the secret in Supabase only.

## Deploy order (each step needs Will's approval)
1. Demo: apply the migration, deploy hub-command (`supabase functions deploy hub-command --project-ref tkryueqzvgcigvxgjzsp --use-api`), set the secrets, then connect from `http://localhost:5176` and test.
2. Production: apply the migration one file at a time and record it in `supabase_migrations.schema_migrations`. Read production's deployed
   hub-command and diff it against the repo first, then deploy, set the secrets, and push ELIOT (`git push origin main` in ordanis-eliot).

## Turn off or remove
- For one person: `update public.eliot_ea_profiles set enabled = false where user_id = '...';`
- Remove the calendar link: use Disconnect in ELIOT. To remove it fully, also remove ELIOT under Apps at https://myaccount.microsoft.com.
