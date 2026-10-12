#!/usr/bin/env node
// Creates one client login per demo family (Core, Basic, Premier) on the DEMO Supabase project only.
// Run it yourself; it reads secrets from the environment so nothing is stored in this file.
//
//   export DEMO_SERVICE_ROLE_KEY='...'   # demo project -> Settings -> API -> service_role key
//   export DEMO_PASSWORD='DemoOrdanis'
//   node scripts/create_demo_logins.mjs            # dry run: shows what it would do
//   node scripts/create_demo_logins.mjs --apply    # does it
//
// Safe to re-run: existing logins are skipped (their password is NOT changed).

const DEMO_REF = "tkryueqzvgcigvxgjzsp";
const URL_BASE = `https://${DEMO_REF}.supabase.co`;
const KEY = process.env.DEMO_SERVICE_ROLE_KEY;
const PASSWORD = process.env.DEMO_PASSWORD;
const APPLY = process.argv.includes("--apply");

if (!KEY || !PASSWORD) { console.error("Set DEMO_SERVICE_ROLE_KEY and DEMO_PASSWORD first."); process.exit(1); }
// Guard: refuse to run if the key is not for the demo project (JWT payload carries the project ref).
try {
  const ref = JSON.parse(Buffer.from(KEY.split(".")[1], "base64url").toString()).ref;
  if (ref !== DEMO_REF) { console.error(`Key belongs to project "${ref}", not the demo project. Aborting.`); process.exit(1); }
} catch { console.error("Could not read the key. Aborting."); process.exit(1); }

const ACCOUNTS = [
  { email: "alvarez@ordanisos.com", family_id: "a1000000-0000-4000-8000-000000000001", name: "Alvarez Family (Demo)", plan: "core" },
  { email: "bennett@ordanisos.com",    family_id: "a1000000-0000-4000-8000-000000000005", name: "Bennett Family (Demo)",   plan: "basic" },
  { email: "lindqvist@ordanisos.com",  family_id: "a1000000-0000-4000-8000-000000000002", name: "Lindqvist Family Office (Demo)", plan: "premier" },
];

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const api = (path, opts = {}) => fetch(URL_BASE + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });

for (const a of ACCOUNTS) {
  // Confirm the family exists and is on the expected plan before touching anything.
  const fr = await (await api(`/rest/v1/families?id=eq.${a.family_id}&select=name,plan`)).json();
  if (!fr[0] || fr[0].plan !== a.plan) { console.log(`SKIP  ${a.email}: family missing or plan is not ${a.plan}`, fr); continue; }
  if (!APPLY) { console.log(`DRY   would create ${a.email} -> ${fr[0].name} (${a.plan})`); continue; }

  let r = await api("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({
    email: a.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: a.name } }) });
  let body = await r.json();
  let id = body.id;
  if (!r.ok) {
    if (/already|registered|exists/i.test(JSON.stringify(body))) {
      const list = await (await api(`/auth/v1/admin/users?per_page=200`)).json();
      id = (list.users || []).find(u => u.email === a.email)?.id;
      console.log(`EXISTS ${a.email} (password unchanged)`);
    } else { console.log(`FAIL  ${a.email}:`, body.msg || body.message || body); continue; }
  } else console.log(`CREATED ${a.email}`);

  // Link the login to its family (profile row was created by the signup trigger as role=client).
  const p = await api(`/rest/v1/user_profiles?id=eq.${id}`, { method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ family_id: a.family_id, full_name: a.name, role: "client", active: true }) });
  const pj = await p.json();
  console.log(p.ok && pj.length ? `LINKED  ${a.email} -> ${a.family_id}` : `LINK FAILED ${a.email}: ${JSON.stringify(pj)}`);
}
console.log(APPLY ? "Done. Tell Claude to run the read-only check." : "Dry run only. Re-run with --apply.");
