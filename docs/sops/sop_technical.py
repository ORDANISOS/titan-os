"""ORDANIS technical SOP: how the platform is built, how to change it, how to fix it."""

S = []

S.append(("Platform at a glance", "What ORDANIS is made of and where each piece lives", """
<p class="lede">ORDANIS is a multi-enterprise client portal. A household gets a private place for its records,
workflows, documents (CHRIS, the Centralized Household Records Integration Server) and an AI assistant. A firm can sit on top with view-only admin access and its own skin.</p>
<h2>The stack</h2>
<table>
<tr><th style="width:24%">Layer</th><th>What it is</th><th style="width:30%">Where</th></tr>
<tr><td>Web app</td><td>React 18 single-page app built with Vite. One main file, <code>src/App.jsx</code> (about 16,000 lines); plan gating in <code>src/plans.js</code>; sign-up in <code>src/SignupFlow.jsx</code>.</td><td>Repo <code>pcm-realestate</code></td></tr>
<tr><td>Database</td><td>Supabase Postgres with row-level security (RLS) on every household table.</td><td>Supabase projects (below)</td></tr>
<tr><td>Server functions</td><td>Supabase Edge Functions (Deno/TypeScript), one folder each in <code>supabase/functions/</code>.</td><td>Deployed per project</td></tr>
<tr><td>File storage</td><td>Supabase Storage. Private buckets: <code>documents</code> (CHRIS), <code>Videos</code> (plan preview videos), <code>brand</code>, <code>brand-documents</code>.</td><td>Supabase Storage</td></tr>
<tr><td>Scheduled jobs</td><td><code>pg_cron</code> + <code>pg_net</code> inside Postgres call functions on a schedule, with a shared secret from Supabase Vault.</td><td><code>cron.job</code></td></tr>
<tr><td>Hosting</td><td>Vercel builds and serves the app on every push to <code>main</code>.</td><td>Project <code>ordanis-platform</code></td></tr>
<tr><td>Payments</td><td>Stripe (checkout, subscriptions, webhook). Live-mode cutover is parked until launch.</td><td><code>docs/RUNBOOK-stripe-live-cutover.md</code></td></tr>
<tr><td>Email</td><td>Resend, sending from <code>no-reply@ordanisos.com</code> (set in <code>outbound_email_settings.fixed_from_email</code>).</td><td>Function secret <code>RESEND_API_KEY</code></td></tr>
<tr><td>AI</td><td>Anthropic Claude via edge functions (assistant, document reading, filing suggestions, field extraction).</td><td>Function secret <code>ANTHROPIC_API_KEY</code></td></tr>
</table>
<h2>Two environments</h2>
<table>
<tr><th style="width:22%"></th><th>Demo</th><th>Production</th></tr>
<tr><td>Git remote</td><td><code>ordanis-demo</code> (ORDANISOS/titan-os, main)</td><td><code>ordanis-production</code> (PCMFamilyOffice/pcm-realestate, main)</td></tr>
<tr><td>Supabase ref</td><td><code>tkryueqzvgcigvxgjzsp</code></td><td><code>xreeruxuwtmjhvvxvjts</code></td></tr>
<tr><td>App</td><td>Deploys on push</td><td>portal.ordanisos.com, deploys on push to main</td></tr>
<tr><td>Vercel</td><td>—</td><td>Project <code>ordanis-platform</code>, team ORDANIS OS</td></tr>
</table>
<div class="box warn"><span class="t">The CLI is linked to production</span>The Supabase CLI in the repo folder points at production.
Always pass <code>--project-ref</code> explicitly, and never run <code>supabase db push</code>.</div>
<h2>Sibling apps (separate repos)</h2>
<ul>
<li><b>ELIOT</b>: the admins' voice console. Repo <code>ordanis-eliot</code> → eliot.ordanisos.com. Its back end lives here: <code>hub-command</code> and <code>public.audit_log</code>. Never add it to the portal.</li>
<li><b>MILO</b>: the marketing console (white theme). Repo <code>ordanis-milo</code> → milo.ordanisos.com. Back end here: <code>milo-command</code>, <code>milo-social</code>, <code>milo-speak</code>. MILO never sees households.</li>
<li><b>Marketing site</b>: <code>~/Documents/ordanis-site</code>, not in git; see its own CLAUDE.md.</li>
</ul>
"""))

S.append(("The ground rules", "The non-negotiables for anyone changing the platform", """
<p class="lede">These rules exist because each one was learned the hard way. They apply to people and to AI assistants alike.</p>
<ol>
<li><b>Nothing reaches production without Will's explicit approval, per step.</b> Approval for one step is not approval for the next.</li>
<li><b>Demo first, always.</b> Every change is built and tested on demo, then queued as a production step.</li>
<li><b>Never <code>supabase db push</code>. Never a bare <code>git push</code>.</b> Always name the remote: <code>git push ordanis-demo main</code> or <code>git push ordanis-production main</code>.</li>
<li><b>Never move households or data from demo to production.</b></li>
<li><b>Never permanently delete a household.</b> Archiving is fine; <code>purge-family</code> is Will's call alone.</li>
<li><b>Never enter, request or store passwords or keys</b>, and never put secrets in the repo, in chat, or in CLAUDE.md.</li>
<li><b>Stage specific files only.</b> The working tree carries unrelated modified files (<code>supabase/.temp/*</code>, drift copies, <code>*.bak</code>).</li>
<li><b>Keep security top of mind.</b> RLS on every table, least-privilege grants, no investment advice from the assistant.</li>
</ol>
<div class="box"><span class="t">Brand and wording</span>The product is ORDANIS (never Titan). Documents live in CHRIS, the Centralized Household Records Integration Server (always spelled out on first mention; never called a "vault"). Staff are "ORDANIS Expert",
never "adviser" (a regulated word). Navy #0A2540, gold #C9A961, paper #F8F6F1. Warm, plain-language voice.</div>
"""))

S.append(("How a change ships", "The exact path from an idea to production", """
<h2>1. Build on demo</h2>
<ol class="steps">
<li>Make the change in the repo. For <code>src/App.jsx</code>, use targeted, asserted string replacements; never retype the file.</li>
<li>Syntax-check, then run the tests:
<pre>npx --yes esbuild --loader=jsx --log-level=error &lt; src/App.jsx &gt; /dev/null
npm test</pre></li>
<li>If the change needs the database, apply the migration to <b>demo</b> (section 04) and record it.</li>
<li>If it needs a function, deploy it to <b>demo</b>:
<pre>supabase functions deploy &lt;name&gt; --project-ref tkryueqzvgcigvxgjzsp --use-api</pre></li>
<li>Commit only the files you changed, then push to demo:
<pre>git add &lt;files&gt; &amp;&amp; git commit -m "..." &amp;&amp; git push ordanis-demo main</pre></li>
<li>Test on demo, including a rolled-back SQL test for anything that touches access rules (section 06).</li>
</ol>
<h2>2. Promote to production (one approved step at a time)</h2>
<ol class="steps">
<li><b>Database first</b> when the new app code depends on a new column or table; otherwise the live app breaks in the gap.</li>
<li>Deploy any function with <code>--project-ref xreeruxuwtmjhvvxvjts --use-api</code>, after saving the deployed source for rollback.</li>
<li>Will pushes the app from his terminal:
<pre>cd ~/Documents/GitHub/pcm-realestate &amp;&amp; git push ordanis-production main</pre></li>
<li>Confirm the build is live: <code>https://portal.ordanisos.com/version.json</code> shows the git short sha and build time.</li>
</ol>
<div class="box"><span class="t">If a push produces no Vercel build</span>Open the Vercel project → Settings → Git. The repository link was once found disconnected.</div>
"""))

S.append(("Database changes", "Migrations, grants and access rules", """
<h2>Writing a migration</h2>
<ul>
<li>One file per change in <code>supabase/migrations/</code>, named <code>YYYYMMDDHHMMSS_short_name.sql</code>, with a header comment that says why, and a <b>Rollback</b> section.</li>
<li>Re-read the file for any <code>update</code>, <code>delete</code> or <code>alter column</code> on existing tables before applying.</li>
<li><b>Every new table grants explicitly</b> (Supabase change of 2026-10-30): <code>service_role</code> select/insert/update/delete; <code>authenticated</code> only what the app needs (RLS still filters); <code>anon</code> nothing unless truly public. Never copy a template that grants select to anon.</li>
<li><b>RLS on every new table</b>, with the restrictive policies the household tables share where relevant (<code>mfa_required</code>, <code>private_household</code>, <code>household_perm_*</code>).</li>
<li><b>Security-definer functions</b>: pin <code>search_path</code>, then <code>revoke execute ... from public, anon; grant execute ... to authenticated</code> (or <code>service_role</code> only for jobs).</li>
</ul>
<h2>Applying it</h2>
<ol class="steps">
<li>Apply to demo, verify, record. Then, with approval, the same on production.</li>
<li>Production's migration history does <b>not</b> line up with repo file names, so apply <b>one file at a time</b> and record each:
<pre>insert into supabase_migrations.schema_migrations (version, name)
select '20261029120000','loan_secured_by_account'
where not exists (select 1 from supabase_migrations.schema_migrations where version='20261029120000');</pre></li>
<li>Trigger and storage-policy DDL can hang through the MCP tool. Wrap it in timeouts; if it still hangs, run it in the Supabase SQL editor:
<pre>set lock_timeout = '8s'; set statement_timeout = '60s';</pre></li>
</ol>
<h2>Key tables</h2>
<table>
<tr><th style="width:30%">Table</th><th>Holds</th></tr>
<tr><td><code>families</code></td><td>One row per household: plan, Expert (<code>advisor_email</code>), firm (<code>enterprise_id</code>), Stripe ids, archive state.</td></tr>
<tr><td><code>user_profiles</code></td><td>Every login: <code>role</code> (admin, advisor = ORDANIS Expert, analyst, client, partner, enterprise_admin), <code>family_id</code>, <code>household_role</code> (primary/member) and the four family permissions.</td></tr>
<tr><td><code>properties</code>, <code>portfolio_accounts</code>, <code>account_balances</code>, <code>loans</code>, <code>valuables</code></td><td>The balance sheet. A property's mortgage and second mortgage live on the property; other debt lives in <code>loans</code>, optionally secured by a property, portfolio account or valuable.</td></tr>
<tr><td><code>cash_flow_events</code>, <code>cash_flow_payment_log</code></td><td>Income and bills, recurrence, who pays (<code>pcm_responsible</code>), payments per period.</td></tr>
<tr><td><code>documents</code>, <code>document_folders</code>, <code>document_downloads</code></td><td>CHRIS (section 07).</td></tr>
<tr><td><code>tasks</code>, <code>notes</code>, <code>obligations</code>, <code>workflow_*</code></td><td>Work: tasks, notes, and workflows (stored in <code>obligations</code>, shown everywhere as "workflows") with the playbooks that carry them.</td></tr>
<tr><td><code>plan_features</code>, <code>plan_change_requests</code></td><td>Plan prices and gates (the single source for app and database); requests to change plan.</td></tr>
<tr><td><code>household_activity</code></td><td>Client Activity: every add/change/remove a family login makes (field names only).</td></tr>
<tr><td><code>expert_analysts</code>, <code>household_onboarding_specialists</code>, <code>family_partners</code></td><td>Staffing: Analyst per Expert, 30-day Onboarding Specialists, Business Partner seats.</td></tr>
<tr><td><code>audit_log</code></td><td>Administrative actions (also ELIOT's log).</td></tr>
<tr><td><code>brand_profiles</code>, <code>outbound_email_settings</code></td><td>Skin per host/firm; the sending address.</td></tr>
</table>
"""))

S.append(("Server functions and scheduled jobs", "What runs on the server, and when", """
<h2>Deploying a function</h2>
<pre>supabase functions deploy &lt;name&gt; --project-ref xreeruxuwtmjhvvxvjts --use-api</pre>
<ul>
<li>Deploy only the functions named in the approved step.</li>
<li>Before replacing a function, read production's deployed source, diff it with the repo file, and save the old source for rollback.</li>
<li>JWT verification is <b>off</b> (deploy with <code>--no-verify-jwt</code>) only for functions called by Stripe or by cron: <code>stripe-webhook</code>, <code>public-signup</code>, <code>send-task-reminders</code>, <code>onboarding-notices</code>, <code>milo-social</code>. Cron functions check the <code>x-cron-secret</code> header against <code>CRON_SECRET</code> and fail closed.</li>
<li>Pin <code>npm:@supabase/supabase-js@2.49.4</code> in new functions.</li>
</ul>
<h2>The main functions</h2>
<table>
<tr><th style="width:32%">Function</th><th>Job</th></tr>
<tr><td><code>family-ai-assistant</code></td><td>The household assistant ("Ask &lt;name&gt;"). Answers from one family's snapshot and document text; refuses investment advice (regex pre-filter + model rules).</td></tr>
<tr><td><code>extract-document-text</code></td><td>Reads scanned PDFs and photos (OCR) so CHRIS can search them.</td></tr>
<tr><td><code>suggest-document-folder</code></td><td>CHRIS's filing brain: proposes a name, summary, folder and record link.</td></tr>
<tr><td><code>extract-statement-fields</code>, <code>extract-property-fields</code></td><td>Propose balances or property details from a statement for a person to confirm.</td></tr>
<tr><td><code>send-task-reminders</code></td><td>Daily: one summary email per ORDANIS Expert (task reminders, bills they pay, Client Activity) plus family reminders on Basic/Core.</td></tr>
<tr><td><code>onboarding-notices</code></td><td>Daily: day-30 notice when an Onboarding Specialist's access is ending.</td></tr>
<tr><td><code>plan-request-notify</code></td><td>Emails info@ordanisos.com when a household asks to change plan.</td></tr>
<tr><td><code>change-subscription-plan</code>, <code>create-checkout-session</code>, <code>cancel-subscription</code>, <code>stripe-webhook</code></td><td>Billing.</td></tr>
<tr><td><code>invite-client</code>, <code>public-signup</code>, <code>firm-join</code>, <code>manage-business-partner</code></td><td>Getting people in.</td></tr>
<tr><td><code>draft-workflow-step</code>, <code>send-workflow-step</code>, <code>purchase-workflow</code>, <code>request-expert-assist</code></td><td>Workflows; nothing sends without a named human approval.</td></tr>
<tr><td><code>archive-family</code>, <code>purge-family</code></td><td>Archive (reversible) and purge (permanent: Will only).</td></tr>
</table>
<h2>Scheduled jobs (production, all active since go-live)</h2>
<table>
<tr><th>Job</th><th>Schedule (UTC)</th><th>Calls</th></tr>
<tr><td>send-task-reminders</td><td>13:00 daily</td><td>Expert daily summary + family reminders</td></tr>
<tr><td>onboarding-notices</td><td>13:10 daily</td><td>Day-30 specialist notices</td></tr>
<tr><td>run-scheduled-prompts</td><td>hourly</td><td>Scheduled assistant reports</td></tr>
<tr><td>eliot-briefings</td><td>every 5 min</td><td>ELIOT (<code>hub-command</code>)</td></tr>
<tr><td>milo-hourly</td><td>:07 hourly</td><td>MILO</td></tr>
<tr><td>workflow-overage-monthly</td><td>03:15 on the 1st</td><td>Workflow overage billing</td></tr>
<tr><td>enterprise-monthly-snapshot</td><td>06:15 on the 1st</td><td>Firm snapshot</td></tr>
</table>
<pre>-- what ran, and how it went
select jobid, status, start_time, return_message from cron.job_run_details order by start_time desc limit 20;
-- the function's own reply to a pg_net call
select status_code, content from net._http_response order by id desc limit 5;
-- pause / resume a job
select cron.alter_job(&lt;jobid&gt;, active := false);</pre>
"""))

S.append(("People, roles and access", "Who can see and do what, and where that is enforced", """
<p class="lede">The screen hides what a person can't use, but the <b>database</b> is the enforcement. Every rule below holds
even if someone calls the API directly.</p>
<table>
<tr><th style="width:24%">Role</th><th>Sees</th><th>Can change</th></tr>
<tr><td>Admin</td><td>Everything</td><td>Everything (some actions need two-factor, aal2)</td></tr>
<tr><td>ORDANIS Expert (<code>advisor</code>)</td><td>Households where <code>families.advisor_email</code> is theirs</td><td>Those households</td></tr>
<tr><td>Analyst</td><td>Their Expert's households (via <code>expert_analysts</code>)</td><td>Those households</td></tr>
<tr><td>Onboarding Specialist</td><td>Households they're assigned to, for 30 days (extendable)</td><td>Those households</td></tr>
<tr><td>Family (<code>client</code>)</td><td>Their own household</td><td>Primary: everything. Members: what the primary ticked (edit, upload, download, manage users)</td></tr>
<tr><td>Business Partner</td><td>Households that granted them a seat</td><td>Nothing except uploading documents</td></tr>
<tr><td>Firm administrator</td><td>Their firm's households</td><td>Nothing (view only)</td></tr>
</table>
<ul>
<li>One role per login. Admins can also fill the Expert, Analyst and Onboarding Specialist seats.</li>
<li>Every plan (Basic, Core, Premier) edits the same household records. Changes by family logins land in <code>household_activity</code> and on the Expert's daily summary.</li>
<li>Edit Family's plan picker is locked for Stripe-paid households: plan changes go through Plan requests or Billing so Stripe moves too.</li>
</ul>
<h2>Testing an access rule safely</h2>
<p>Pretend to be a user inside a transaction that always rolls back:</p>
<pre>do $$ declare n int; begin
  perform set_config('request.jwt.claims','{"sub":"&lt;user-uuid&gt;","role":"authenticated","aal":"aal2"}', true);
  set local role authenticated;
  select count(*) into n from public.household_activity;
  reset role;
  raise exception 'ROLLBACK sees %', n;   -- nothing is kept
end $$;</pre>
"""))

S.append(("CHRIS: how it works under the hood", "Centralized Household Records Integration Server, end to end", """
<div class="chris"><div class="head"><img src="__MARK__"><span>CHRIS in one paragraph</span></div>
CHRIS, the Centralized Household Records Integration Server, is not a folder of files. Every document is stored privately, read by AI (including scans and phone photos), named and
summarised, filed into the right folder, searchable by what is <i>inside</i> it, and pinned to the exact figure it supports:
a property's tax bill, a valuable's policy, a loan's statement, an account's balance. The assistant answers from it. Every
download is logged.</div>
<h2>The pieces</h2>
<table>
<tr><th style="width:30%">Piece</th><th>How</th></tr>
<tr><td>Storage</td><td>Private bucket <code>documents</code>, path under the household's own folder (which the storage policies check). Files are only ever opened through short-lived signed URLs.</td></tr>
<tr><td>Rows</td><td><code>documents</code>: name, category (folder), description (AI summary), <code>extracted_text</code>, links (<code>property_id</code> + <code>property_section</code>, <code>valuable_id</code>, <code>loan_id</code>, <code>account_id</code>), <code>expiry_date</code>, <code>private_owner_id</code>.</td></tr>
<tr><td>Reading</td><td>Digital PDFs are read in the browser; scans and photos go to <code>extract-document-text</code>. A file that can't be read still uploads.</td></tr>
<tr><td>Filing</td><td><code>suggest-document-folder</code> proposes name, summary, folder (or a new one), and a record link with a confidence. Nothing is filed until a person taps File.</td></tr>
<tr><td>Folders</td><td>Eight built in (General, Tax, Legal, Insurance, Investment, Real Estate, Estate Planning, Other) plus each household's own (<code>document_folders</code>).</td></tr>
<tr><td>Replacing</td><td>Linking a new document to a spot unlinks the old one, never deletes it. Search marks replaced documents plainly.</td></tr>
<tr><td>Private folder</td><td>A family login's own files, hidden from everyone else by restrictive policies, and never read by AI.</td></tr>
<tr><td>Audit</td><td><code>document_downloads</code> records who opened what, and when. A firm administrator's open is recorded before the file is served.</td></tr>
<tr><td>Permissions</td><td>Family members need "Upload" to add files and "Download" to open them (storage policies <code>household_perm_files_*</code>).</td></tr>
</table>
<h2>When CHRIS misbehaves</h2>
<ul>
<li><b>Search can't find a document:</b> its <code>extracted_text</code> is empty. Staff press <b>✦ Scan</b> on the row (or the bulk Scan button), or check the function logs for <code>extract-document-text</code>.</li>
<li><b>No filing suggestion:</b> the text was too short or the AI call failed. The person can still choose a folder by hand.</li>
<li><b>"Permission denied" on open or upload:</b> check the member's Download/Upload permission and the storage path (it must start with the household's id).</li>
</ul>
"""))

S.append(("When something goes wrong", "Symptom → cause → fix", """
<table>
<tr><th style="width:30%">Symptom</th><th style="width:30%">Usual cause</th><th>Fix</th></tr>
<tr><td>"Edge Function returned a non-2xx status code"</td><td>The function refused for a reason it explained, but the app hid the body.</td><td>Read it: <code>await error.context.json()</code>. In the database, <code>net._http_response</code> or the function logs in Supabase.</td></tr>
<tr><td>"permission denied for table …"</td><td>A table created after 2026-10-30 without explicit grants.</td><td>Add the grants (section 04). Check RLS policies too.</td></tr>
<tr><td>Push made no new build</td><td>Vercel's Git link disconnected.</td><td>Vercel → Settings → Git → reconnect; push again.</td></tr>
<tr><td>Site shows old version</td><td>Build still running, or a cached tab.</td><td>Check <code>/version.json</code>. Open tabs are told when a newer build is live.</td></tr>
<tr><td>Migration hangs</td><td>Trigger or storage-policy DDL waiting on a lock.</td><td>Timeouts (section 04); else run in the SQL editor.</td></tr>
<tr><td>No emails arriving</td><td>Resend error, sending address unset, or demo override.</td><td>Function logs; <code>outbound_email_settings.fixed_from_email</code>; <code>DEMO_EMAIL_OVERRIDE</code> on demo.</td></tr>
<tr><td>Daily summary didn't go</td><td>Cron job paused or the function failed.</td><td><code>cron.job_run_details</code>, then <code>net._http_response</code>. Items not sent are retried the next day.</td></tr>
<tr><td>Plan shows one thing, Stripe bills another</td><td>Plan changed by hand on a Stripe-paid household.</td><td>Approve through Plan requests (moves Stripe), or record with "no billing" deliberately.</td></tr>
<tr><td>Assistant refuses a question</td><td>The investment-advice guardrail, by design.</td><td>Not a bug for client/partner users. <code>brand_profiles.ai_investment_policy</code> only changes how much factual detail is shown.</td></tr>
<tr><td>A family member can't edit or upload</td><td>Their household permissions.</td><td>The primary user (or an admin) ticks the permission in the Household tab.</td></tr>
</table>
<h2>Rolling back</h2>
<ul>
<li><b>App:</b> in Vercel, promote the previous production deployment (instant); then fix forward with a new commit. Or <code>git revert</code> the commit and push.</li>
<li><b>Function:</b> redeploy the saved source you kept before replacing it.</li>
<li><b>Database:</b> run the migration's Rollback section (one file at a time), then remove its row from <code>supabase_migrations.schema_migrations</code>.</li>
<li><b>Data:</b> never purge. Archive a household instead; ask Will about anything permanent.</li>
</ul>
"""))

S.append(("Where everything else is written down", "Runbooks, records and secrets", """
<table>
<tr><th style="width:38%">Document</th><th>Covers</th></tr>
<tr><td><code>CLAUDE.md</code> (repo root)</td><td>Standing rules, environments, current state, go-live notes, tabled launch items.</td></tr>
<tr><td><code>docs/RUNBOOK-stripe-live-cutover.md</code></td><td>Turning on live payments.</td></tr>
<tr><td><code>docs/RUNBOOK-MILO.md</code>, <code>docs/RUNBOOK-ELIOT-EA.md</code></td><td>The sibling consoles.</td></tr>
<tr><td><code>docs/HANDOFF-*.md</code></td><td>Plans, spend and vendors.</td></tr>
<tr><td><code>supabase/migrations/</code></td><td>Every database change, each with its reason and rollback.</td></tr>
<tr><td>Claude Doc "ORDANIS Production Release Plan"</td><td>Release steps and their status.</td></tr>
</table>
<h2>Secrets (names only, never values)</h2>
<p>Edge functions: <code>RESEND_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>, <code>STRIPE_SECRET_KEY</code>, <code>CRON_SECRET</code>,
<code>PLAN_REQUEST_NOTIFY_TO</code> (optional), <code>DEMO_EMAIL_OVERRIDE</code> (demo only). Supabase Vault: <code>cron_secret</code>
(must match <code>CRON_SECRET</code>). Vercel: <code>VITE_BRAND_RUNTIME=1</code> on production. Secrets are set in the Supabase
and Vercel dashboards by Will; they never go in the repo, in chat, or in documents.</p>
<h2>Tabled until the official launch</h2>
<ol><li>Stripe end-to-end test and live-mode gates.</li><li>Expert-assist test on a card-paid Core household (refund the $25).</li>
<li>Reopen sign-up: set <code>SIGNUP_PAUSED_URL</code> to "" in <code>src/App.jsx</code>.</li></ol>
"""))

DOC = dict(file="ORDANIS_SOP_Technical.pdf", kind="Standard Operating Procedure · Technical",
           title="Building, Changing and Fixing ORDANIS",
           subtitle="How the platform is put together, how changes reach production, and what to do when something goes wrong.",
           audience="Platform administrators and developers", classification="Internal · Confidential", sections=S)
