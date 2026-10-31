# Scaling step 2: staff screens load data on demand

Written 2026-10-31 for Will's approval. No code is written yet.

## The problem today

When a staff member signs in (admin, ORDANIS Expert, Analyst), the portal downloads **every row of 18 tables for
every household they can see**: households, properties, tasks, notes, documents, cash flow, loans, accounts,
contacts and the rest. All screens then work from that one big copy in the browser.

- **It gets slower with every household.** An admin with 50,000 households would be downloading millions of
  rows at sign-in. The browser would freeze long before it finished.
- **It is already silently wrong past 1,000 rows.** Supabase returns at most 1,000 rows per request, without
  an error. Once an Expert's book has more than 1,000 documents (about 35 households with 30 documents each), or
  admins see more than 1,000 tasks, everything past the cutoff is simply missing from the screens. This
  starts happening long before 50,000 households.

Clients and firm administrators are **not** affected: clients load only their own household, and firm
administrators already load one household at a time when they open it. Step 2 copies that firm-administrator
pattern to staff.

## What changes, screen by screen

| Staff screen | Today | After step 2 |
|---|---|---|
| **Sign-in** | Downloads all 18 tables for all households | Downloads only the signed-in person's profile and a few summary numbers. Fast and the same size whether there are 10 households or 50,000. |
| **Families list** | Filters the full download in the browser | One server query returns one page of households (50 at a time) with name, plan, ORDANIS Expert, property/account/open-task counts and total value. Search and the Expert filter run on the server. "Show archived" stays. |
| **"By ORDANIS Expert" view (admin)** | Adds up every household in the browser | One server summary returns one row per Expert: number of households, total value, open and overdue tasks. |
| **Opening a household** | Already has everything loaded | Loads that household's records the moment it is opened (a second or less), then shows the same household dashboard as today. The last few opened households stay in memory, so going back and forth is instant. |
| **Household dashboard (all its tabs)** | Unchanged | **Unchanged.** It already works on one household's data, the same way the client portal does. This is most of the app's code, and it doesn't need to change. |
| **Saving something in a household** | Re-downloads that whole table for everyone | Re-downloads that table for the open household only. |
| **Dashboard cards** (Families, Real Estate, Portfolio, Debt, overdue, due soon) | Added up in the browser | Added up on the server by one summary query and returned as plain totals. The Expert filter still works. |
| **Dashboard "Deadlines" and "Bills Due" lists** | Worked out in the browser from everything | See decision 1 below. |
| **Portfolio, Notes, Tasks (across households)** | Filter the full download | Server-side pages of 50 with the same filters (open, overdue, due soon, by household, by Expert), plus sorting and search. |
| **Header overdue badge, sidebar counts** | Counted from the full download | Taken from the dashboard summary. |
| **Users, Signups, Plan requests, Resources** | Use the full household list for names | A light household picker (search by name) instead of the full list. |

Security stays the same. The new server queries run **as the signed-in person**, so the database's own access
rules (the ones made faster in step 1) still decide who sees which household. Nothing new can be seen, and the
browser no longer holds other households' records it doesn't need.

## Decisions for you

1. **Deadlines and Bills Due for admins at scale.** For an Expert these lists stay as they are: their book is a
   manageable size. For an admin looking at "All ORDANIS Experts", 50,000 households would put thousands of
   items on that card every day, which nobody can work through. My recommendation: admins see the counts for
   everyone, and the full lists once they pick an Expert in the filter that is already on the dashboard (or
   the 100 soonest items with "show more"). The alternative is to keep one long list for everyone, which also
   means moving the date logic for recurring bills to the server. That is more work and has a higher risk of
   the two copies disagreeing.
2. **Families list order.** Alphabetical, as today, or most-urgent first (overdue tasks at the top)? I recommend
   keeping alphabetical by default and adding a "Most urgent" sort option.
3. **An off switch.** I would build this behind a setting, so the old loading can be switched back on instantly,
   without a deploy, if anything looks wrong after release. Once it has run cleanly for a while, the old code
   gets removed.

## How it gets built and tested (demo first)

1. **Server queries** (one migration): household list page, Expert summary, dashboard totals, and paged
   Portfolio/Notes/Tasks queries. Each runs as the signed-in person, signed-out users have no access, and new
   tables get explicit grants. Tested on demo as each role (client, Expert, Analyst, partner, admin, firm
   administrator) to confirm each sees exactly what it sees today.
2. **Families list and opening a household.** The biggest user-facing piece.
3. **Dashboard.**
4. **Portfolio, Notes, Tasks, and the remaining screens.**
5. **Side-by-side check on demo:** with the switch off and then on, every staff screen should show the same households,
   numbers and lists. You then click through it yourself.
6. Step 4's load test (50,000 fake households on demo) proves sign-in and the list stay fast.
7. **Production**, with your yes: the migration first, then the app. The app deploy also reaches the phone app
   as a live update, though staff rarely use the phone app.

**Effort:** several days of careful work. Clients and firm administrators see no change. Staff get a faster
sign-in and the same screens, with page controls on the long lists.

**Risks, honestly:** this touches every staff screen except the household dashboard. The main risk is a screen
that quietly relied on the full download somewhere I haven't found yet; the side-by-side check and the off
switch are there to catch that. Edits made by two staff at once behave as they do today: each sees the other's
change the next time they open the household.
