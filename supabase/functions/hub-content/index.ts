// hub-content: the private part of the ORDANIS Hub launcher (hub.ordanisos.com).
//
// The hub page itself is a public shell: sign-in screen, the orbit and the ORDANIS mark. The app
// links, the SOPs (Guides) and the team list (Team & Access) live here and are returned only to a
// signed-in, active ORDANIS administrator. Nothing private ships in the page's own source.
//
// SECURITY
// - The caller must be signed in and hold role 'admin' (active). Both are checked here on the
//   server; hiding the page in the browser is not protection.
// - No MFA step here, by Will's decision (2026-10-21): the hub only launches apps, and each app
//   (Platform, ELIOT, Email Portal, MILO) asks for its own sign-in and MFA.
// - The service role is used only to read the caller's own role.
// - Read-only. No writes, no email, no household data.
// - To update the SOPs or the team list: edit the content below, then redeploy this function
//   (no hub redeploy needed).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Browsers allowed to read the response. The token is the real gate; this only stops other sites
// from using a signed-in admin's browser to fetch the content.
const ALLOWED_ORIGINS = (Deno.env.get("HUB_APP_ORIGINS") ??
  "https://hub.ordanisos.com,https://ordanis-hub.vercel.app,http://localhost:5179")
  .split(",").map((s) => s.trim()).filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}


// ── Content ────────────────────────────────────────────────────────────────────

// Leave url empty to show the tile as "coming soon".
const APPS = [
  { name: "ORDANIS Platform", role: "PRODUCTION", url: "https://portal.ordanisos.com", icon: "home" },
  { name: "ELIOT", role: "ADMIN", url: "https://eliot.ordanisos.com", icon: "mic" },
  { name: "Email Portal", role: "TEAM", url: "https://emailportal.ordanisos.com", icon: "mail" },
  { name: "MILO", role: "MARKETING", url: "", icon: "chart" },
  { name: "Server", role: "OWNER", url: "https://supabase.com/dashboard/project/xreeruxuwtmjhvvxvjts", icon: "server" },
  { name: "Demo", role: "SANDBOX", url: "https://ordanis-demo.vercel.app", icon: "flask" },
];

const GUIDES_HTML = `  <section id="tab-guides" class="panel" hidden>
    <h2>Guides</h2>
    <p class="lead">Standard operating procedures for each app. Tap one to open it.</p>

    <details class="sop" open>
      <summary><span>ORDANIS Platform</span><span class="tag">PRODUCTION</span></summary>
      <p class="what">The live client portal at portal.ordanisos.com. Households keep their records, obligations, workflows, documents (CHRIS) and assistant here. Firms sit on top with view-only admin access and their own branding.</p>
      <h3>Signing in</h3>
      <ol>
        <li>Open the Platform tile. Sign in with your own email and password, then your authenticator code.</li>
        <li>Never share a sign-in. Each person on the team has their own account and role.</li>
      </ol>
      <h3>Daily work</h3>
      <ol>
        <li>Check open tasks and bills due on the dashboard first.</li>
        <li>Set each household's responsible Expert on the household record. It decides who sees and works that household.</li>
        <li>Work obligations through their workflow steps. Mark a step done only when the work is actually done.</li>
        <li>File every document in CHRIS against the right property, account or valuable.</li>
        <li>Correspondence is prepared, then approved, then sent. Never send a draft that has not been approved.</li>
      </ol>
      <h3>Rules</h3>
      <ul>
        <li>Demo households and demo data never go into production.</li>
        <li>Never permanently delete a household. Archive it; purging is Will's decision only.</li>
        <li>Never type passwords, card numbers or keys into notes, tasks or the assistant.</li>
        <li>Firm pricing and anything about OpenArc or litigation never goes into client-facing material.</li>
      </ul>
      <h3>If something is wrong</h3>
      <ul>
        <li>Note the household, the screen and the time, take a screenshot, and send it to Will.</li>
        <li>To check which version is live, open portal.ordanisos.com/version.json.</li>
      </ul>
    </details>

    <details class="sop">
      <summary><span>ELIOT</span><span class="tag">ADMIN</span></summary>
      <p class="what">Executive Liaison for Inbox, Operations &amp; Tasks. The admins' voice console at eliot.ordanisos.com. Ask one spoken or typed question, get one short answer about the platform.</p>
      <h3>Who can use it</h3>
      <ul>
        <li>Platform admins only, signed in with their authenticator code (two-step sign-in). Anyone else is refused by the server.</li>
      </ul>
      <h3>How to use it</h3>
      <ol>
        <li>Open the ELIOT tile and sign in with your platform account.</li>
        <li>Tap the microphone or type. Ask one thing at a time: "Which bills are due this week?", "What's open for the Smith household?"</li>
        <li>Read the answer on screen before acting on it. ELIOT reports; you do the work in the Platform.</li>
      </ol>
      <h3>What it will not do</h3>
      <ul>
        <li>ELIOT is read-only today. It cannot change records, send email or reach the demo site.</li>
        <li>It only sees what your own account is allowed to see.</li>
      </ul>
      <h3>Rules</h3>
      <ul>
        <li>Every question is logged, including refused ones. Use it for work only.</li>
        <li>Never say or type passwords, card numbers or keys to it.</li>
        <li>It is called ELIOT everywhere. Don't use its old name.</li>
      </ul>
    </details>

    <details class="sop">
      <summary><span>Email Portal</span><span class="tag">TEAM</span></summary>
      <p class="what">Where the ORDANIS team receives, routes, assigns and closes email for Premier plan families, at emailportal.ordanisos.com. Mail sent to the families' Premier inbox lands here and is routed to the right person automatically.</p>
      <h3>Who can use it</h3>
      <ul>
        <li>Active members of the Email Portal team. It has its own team list and its own sign-in, separate from the Platform.</li>
        <li>Admins invite, change and remove team members from inside the portal.</li>
      </ul>
      <h3>Daily work</h3>
      <ol>
        <li>Open the Email Portal tile and sign in. Check what's assigned to you first, then anything unassigned.</li>
        <li>Read the email, link it to the right family, and assign it to whoever should handle it.</li>
        <li>Add a note for anything you did or decided. Notes and activity are kept permanently.</li>
        <li>Close the email when it's fully handled. Don't close it just to clear the list.</li>
        <li>Turn on notices on your phone to hear when something is assigned to you.</li>
      </ol>
      <h3>Rules</h3>
      <ul>
        <li>Nothing is ever deleted; emails are archived. This is part of the books and records.</li>
        <li>Treat flagged email (failed sender checks or spam) as suspicious. Don't open its links or attachments; tell Will.</li>
        <li>Pictures in emails are blocked until you choose to show them, and attachment links expire after 5 minutes. That's on purpose.</li>
        <li>Never forward family email to a personal address.</li>
      </ul>
    </details>

    <details class="sop">
      <summary><span>MILO</span><span class="tag">MARKETING</span></summary>
      <p class="what">Marketing Intelligence, Leads &amp; Outreach. The marketing team's console: spend, budgets, sign-up results by campaign, and Instagram and LinkedIn performance. Not hosted yet; its tile opens once milo.ordanisos.com is live.</p>
      <h3>Who can use it</h3>
      <ul>
        <li>Platform admins today, with two-step sign-in. A separate marketing role is planned.</li>
      </ul>
      <h3>How to use it</h3>
      <ol>
        <li>Ask about spend or results: "What did we spend on LinkedIn last month?", "Which campaign brought the most sign-ups?"</li>
        <li>To log spend, MILO drafts the entry; check it and press Save. Nothing is saved without your Save.</li>
        <li>Read the weekly briefing on Monday morning.</li>
        <li>Connect Instagram and LinkedIn under Social accounts. They sync daily after 6 AM Eastern.</li>
      </ol>
      <h3>Rules</h3>
      <ul>
        <li>MILO never sees households or client names. Sign-ups show only as totals.</li>
        <li>Social connections are read-only. Disconnecting removes the stored access.</li>
        <li>Every change is logged.</li>
      </ul>
    </details>

    <details class="sop">
      <summary><span>Server</span><span class="tag">OWNER</span></summary>
      <p class="what">The production database, file storage and server functions behind the Platform, ELIOT and MILO (Supabase). Changes here affect real clients immediately.</p>
      <h3>Who can use it</h3>
      <ul>
        <li>Owner only. Nothing changes here without Will's approval, one step at a time.</li>
      </ul>
      <h3>Changing the database</h3>
      <ol>
        <li>Test the change on Demo first.</li>
        <li>Apply database changes one file at a time, check the result, then record it in the change history.</li>
        <li>Every new table gets row-level security and only the access it needs. Nothing is open to the public unless it is truly public.</li>
        <li>Trigger and storage-policy changes are run by Will in the SQL editor.</li>
      </ol>
      <h3>Updating a server function</h3>
      <ol>
        <li>Save the live version first so it can be rolled back.</li>
        <li>Compare it with the new version, then update only the function that was approved.</li>
        <li>Test it on production right after, and keep the rollback copy.</li>
      </ol>
      <h3>Rules</h3>
      <ul>
        <li>Never copy demo data into production.</li>
        <li>Secrets are set by Will in his own terminal and kept in the vault. Never in chat, email or files.</li>
      </ul>
    </details>

    <details class="sop">
      <summary><span>Demo</span><span class="tag">SANDBOX</span></summary>
      <p class="what">A full copy of the Platform with sample households, at ordanis-demo.vercel.app. Use it to test changes, train new people and show prospects.</p>
      <h3>How to use it</h3>
      <ol>
        <li>Open the Demo tile and sign in with your demo account (separate from your production account).</li>
        <li>Try every change here first. When it works on Demo, queue the same step for production for Will's approval.</li>
        <li>For a prospect walkthrough, use the sample households, never a real one.</li>
      </ol>
      <h3>Rules</h3>
      <ul>
        <li>Never enter real client information on Demo.</li>
        <li>Nothing on Demo is ever copied to production, and no household moves from Demo to production.</li>
        <li>A fix that lands on Demo also has to go to production, so the two stay in step.</li>
      </ul>
    </details>
  </section>`;

const TEAM_HTML = `  <section id="tab-team" class="panel" hidden>
    <h2>Team &amp; Access</h2>
    <p class="lead">Who can open each app, as of October 21, 2026.</p>
    <div class="table-wrap">
      <table class="access">
        <thead>
          <tr><th>Person</th><th>Platform</th><th>ELIOT</th><th>Email Portal</th><th>MILO</th><th>Server</th><th>Demo</th></tr>
        </thead>
        <tbody>
          <tr><td><strong>Will Perez</strong><span class="who">Owner</span></td><td class="yes">Admin</td><td class="yes">Admin</td><td class="yes">Admin</td><td class="yes">Admin</td><td class="yes">Owner</td><td class="yes">Admin</td></tr>
          <tr><td><strong>Alex Hill</strong><span class="who">Team</span></td><td class="yes">Admin</td><td class="yes">Admin</td><td class="yes">Member</td><td class="yes">Admin</td><td class="no">None</td><td class="yes">Admin</td></tr>
          <tr><td><strong>Brian Lamb</strong><span class="who">Team</span></td><td class="no">None</td><td class="no">None</td><td class="yes">Member</td><td class="no">None</td><td class="no">None</td><td class="no">None</td></tr>
        </tbody>
      </table>
    </div>
    <h3>Demo-only sign-ins</h3>
    <p class="note">These accounts exist on Demo only, with no access to production.</p>
    <ul class="people">
      <li><strong>Alex Morgan</strong> Advisor</li>
      <li><strong>Dana Whitfield</strong> Advisor</li>
      <li><strong>John Doe</strong> Firm admin</li>
      <li><strong>Jordan Blake</strong> Partner</li>
    </ul>
    <h3>How access works</h3>
    <ul>
      <li>ELIOT and MILO open only for platform admins who sign in with two-step sign-in.</li>
      <li>The Email Portal has its own team list; its admins add and remove members inside the portal.</li>
      <li>To add or remove someone, ask Will. Roles are set on the person's platform account.</li>
    </ul>
  </section>`;

// ── Handler ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json(req, { error: "Please sign in." }, 401);

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userErr } = await db.auth.getUser(token);
    if (userErr || !user) return json(req, { error: "Please sign in again." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: prof } = await admin.from("user_profiles").select("role,active,full_name").eq("id", user.id).maybeSingle();
    if (prof?.role !== "admin" || prof?.active === false) {
      return json(req, { error: "The ORDANIS Hub is for the ORDANIS team only." }, 403);
    }
    const firstName = String(prof?.full_name ?? "").trim().split(/\s+/)[0].slice(0, 30);
    return json(req, { firstName, fullName: String(prof?.full_name ?? "").trim().slice(0, 80), apps: APPS, guides: GUIDES_HTML, team: TEAM_HTML });
  } catch (e) {
    console.error("hub-content error", e instanceof Error ? e.message : String(e));
    return json(req, { error: "The hub couldn't load just now." }, 500);
  }
});
