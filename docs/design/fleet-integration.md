# Techno Optics fleet integration: the sandbox boundary

Status: **foundation built and mutation-tested, and re-assessed against
revision C. None of the five endpoints exist, deliberately.** Four open
questions block them. The boundary migration **is applied**, confirmed against
production on 2026-08-22. A product with no `/hq/` routes answers `404`, which
the contract names as the correct state while the work is incomplete.

Contract: `INTEGRATION.md` **revision C**, 17 August 2026, derived from Fleet
Adapter Contract v1 revision 2, which revision C does not edit. Handoff at
`~/Desktop/Techno Optics Integration Handoff/Taxottic/`. That file is byte
identical across all nine products and is not edited by anything here.

The revision C delta is the next section. Everything after it was written
against revision B and still stands, because revision C changes no endpoint,
path, field name, header, status code or required behavior, and states that a
product that has already added a tenant column named `sandbox` is correct as
built. Where a paragraph below has been overtaken, the delta section says so.

---

## The revision C delta

Revision C was published after the work below was built. Its own opening
section says nothing built against revision B becomes wrong, and that is what
was found: no endpoint, path, field, header, status code or required behavior
changed, and the tenant column named exactly `sandbox` is correct as built.

Seven changes were assessed against the section text rather than against the
change table alone. Five were genuinely new obligations and were implemented.
Two were already satisfied and are recorded as such.

| # | Revision C change | Verdict here | What was done |
|---|---|---|---|
| 1 | New syndication row in 6.5, its failure mode in 6.7, its checklist line in section 11 | **New obligation** | `lib/hq/syndication.test.ts`. Paths inventoried, control placed at the payload builder, absence of the rest pinned. |
| 2 | 6.3 now requires accounting for elevated call sites that bypass the predicate | **New obligation.** Was a paragraph in this document; is now a stated requirement with a required test | `lib/hq/elevated-call-sites.test.ts`. 91 invocations across 79 files, 10 under `app/admin/`, 2 inline constructions, all held in place. |
| 3 | 6.6 forbidden-word scope defined, with a one-question test | **New obligation.** The existing sweep was **too narrow** | `lib/hq/invisibility.test.ts` gained the row 2 sweep, which found `components/TrialBanner.tsx`. |
| 4 | 8.1 purge catalog recipe expanded to four more classes | **New obligation** | `lib/hq/catalog.ts` gained four classes; `lib/hq/purge-catalog.test.ts` asserts all six steps. |
| 5 | 6.3's tenant flag name is illustrative, not literal | **Already satisfied.** No rename. A collision guard was added | `lib/hq/boundary.test.ts` gained the environment-collision block. |
| 6 | Open questions 20 to 25; 3 and 10 narrowed | **Assessment only** | Recorded under "Blockers" below. |
| 7 | New 4.1a, publishing the role vocabulary | **New obligation.** A written exchange, not code | `docs/design/fleet-role-vocabulary.md`, plus step 5 in `lib/hq/role-vocabulary.test.ts`. |

Two more revision C changes need no work here and are recorded so nobody looks
for them later. The residue limit is settled at 35 days with the apparent
second number explained, which turns question 3 into a policy question (below).
The `tenant_count` / `user_count` definition for a physically separated product
does not apply: this is one deployment holding many company rows, and section
7's unit, the customer organization, is already what a count of `companies`
returns.

### 1. Syndication, the row whose damage is not reversible

6.5's new row covers any path that copies tenant content somewhere a later
delete does not retract it. 6.7 states why it is different in kind: "Unlike
every other failure in this table, fixing the bug does not undo it." So the
ordering rule is stronger, and the control comes before the first sandbox
tenant exists rather than before go-live.

Enumerated from the codebase and from the deploy pipeline, not from memory:

| Version 6.5 names | Present here | Evidence |
|---|---|---|
| Product, listing, merchant or affiliate feed | **No** | No feed client, no aggregation endpoint. Pinned. |
| Public unauthenticated endpoint serving catalog, listings, profiles or documents | **No tenant content.** The public surface is marketing, guides, calculators, comparisons, legal and `/example`, all static. `/example` is a hard-coded fictional workspace and reads the database only for `auth.getUser()`. | Read route by route against `PUBLIC_PATHS` in `lib/supabase/middleware.ts`. |
| Sitemap | **Yes**, `app/sitemap.ts` | Every URL is a literal or comes from `@/lib/calculators/{states,incomes}`. No database read. This is the chokepoint. |
| Indexing or URL-submission call, on deploy, on a schedule, or on publish | **No submitter.** `public/3469b3d10dc2eca4e1d9cbc4936e46b2.txt` is an IndexNow *ownership key*; a key proves who owns the host and submits nothing. No submission step in `package.json`, `vercel.json` or any of the 15 CI workflows. | Pinned in both directions. |
| RSS, JSON or CSV feed at a fixed URL | **No** | Pinned. |
| Public directory, profile or status page reachable with no session | **No.** Firm portals live on `{slug}.taxottic.com` and rewrite `/` to `/firm`, which is not in `PUBLIC_PATHS`, so an anonymous visitor is redirected to `/login`. | Read from the middleware. |
| Content served to third-party AI clients with no session | **Yes**, `public/llms.txt`, and `app/robots.ts` explicitly welcomes GPTBot, ClaudeBot, PerplexityBot and six others onto the public surface | `llms.txt` is a checked-in product summary. Nothing generates it, which is asserted. |

The finding, recorded as 6.5's last paragraph requires: **this product has no
syndication path that carries tenant content, and the two payload builders it
does have are static.** `lib/hq/syndication.test.ts` pins that per version, so
the row cannot be acquired quietly.

The control, since 6.5 says the check belongs "where the payload is built, not
where it is sent":

- `app/sitemap.ts` is asserted to reach no database, by four separate probes,
  and its import set is fixed at four modules so a helper refactor cannot smuggle
  a read in through a dependency.
- `app/robots.ts` is asserted to disallow all eleven tenant route trees, so a
  crawler that finds a tenant URL by a link does not fetch it.
- No submitter, in code or in the pipeline. If one appears, the test fails, and
  whoever adds it has to build the fail-closed tenancy check 6.5 requires
  before the suite goes green.

Open question 24 is what to report if content ever does reach an index. It
cannot today, and the answer is not ours to invent.

### 2. The elevated call sites, which 6.3 now requires accounting for

Revision C promotes what this document already called "the gap this does not
close" into a stated requirement, and names the platform: "On at least one
widely used platform the application's own service role carries a bypass
attribute by default." Confirmed on production rather than assumed:
`service_role` has `rolbypassrls = true`, `authenticated` and `anon` do not.

Measured on this tree, from the codebase and counting inline constructions as
6.3 demands:

| Class | Count before | Count now |
|---|---|---|
| `createServiceClient()` invocations | **91** | **75** |
| Files holding them | **79** | **70** |
| Of those, under `app/admin/` | **10** | **0** |
| Privileged clients constructed **inline**, outside the helper | **2** | **2** (`lib/supabase/server.ts`, the helper itself; `scripts/backfill-sign-convention.ts`, a hand-run maintenance script) |
| `security definer` functions in `public` | **42**, of which **33** are anon-executable | unchanged |

6.3 asks us to bind each one or state plainly that it is not bound. **The
operator console is now bound. The other 75 are not**, and the classification
below says which of them could ever read a sandbox tenant's row and which
could not. This document still does not report the one-predicate rule as met.

6.3 also says "where your database can force the policy on the table owner,
turn it on". Assessed and **deliberately not done**, with a reason: `force row
level security` binds the table *owner*, while `rolbypassrls` is a *role
attribute* that outranks it. Forcing RLS on all 91 tables would change nothing
about the 91 call sites and would risk breaking every path that legitimately
runs as the owner. It is reported rather than performed, which is also this
repository's rule about schema changes.

What 6.3 offers a codebase in this shape is three ways out. This product now
takes the **second** for the operator console, "route those paths through a
single accessor that cannot be called without a tenant", and the **third** for
everything else, "report the gap to the Hub operator as an open boundary and
sequence it before the first sandbox tenant exists".

The sequencing is enforced rather than intended.
`lib/hq/elevated-call-sites.test.ts` asserts that **nothing in this repository
writes a true value into the tenant flag**. While that holds, the 75 remaining
unbound sites read real tenants only, which is what they were written for. The
day provisioning is built, that test fails and the call-site work has to be
finished first.

#### The chokepoint, and why it is a `fetch` and not a filter

`lib/hq/sandbox-exclusion.ts` plus `lib/hq/elevated-client.ts`.

6.5 states the shape the check has to take: "The check belongs at the
chokepoint, not at each call site. A check at each call site is the rejected
mechanism in 6.2 wearing different clothes." A Supabase client is constructed
with a `fetch`, and **every** PostgREST request that client will ever issue
passes through that one function. So the boundary lives there: the wrapper
parses the table out of the request path and appends a filter that excludes
sandbox tenants before the request leaves the process. The ten console files
name the factory; not one of them contains a sandbox check, and a console page
written next quarter will be bound without its author knowing this section
exists.

Three assessed alternatives, and why not:

| Alternative | Why not |
|---|---|
| Wrap the query builder, intercepting `.from()` | The sandbox tenant ids are not known synchronously and `.from()` is synchronous, so the filter would have to be applied by monkey-patching `PostgrestFilterBuilder`'s private `url`. The `fetch` option is the library's own documented extension point and reaches the same requests. |
| Switch the console to the ordinary session client, so the existing RLS barrier applies | This would be the real one-predicate answer, and it is not available: `lib/auth.ts` records that session cookies do not reliably reach PostgREST from this application's server actions, so `auth.uid()` is NULL there. It also depends on a super-admin read policy existing on all thirteen console tables, and a missing one shows an operator a silently empty page rather than an error. |
| Apply the wrapper to **every** `createServiceClient()` | Wrong, not merely large. The provisioning, seeding and `purge_tenant` paths must see sandbox rows, and a sandbox prospect's own pages must see their own rows. A universal exclusion would break the sandbox product it exists to contain. |

Four properties of the wrapper worth stating, because each is a decision:

- **It fails closed on an unclassified table, today, with no sandbox tenant in
  existence.** The classification check runs before the "no sandbox tenants,
  nothing to do" shortcut, so a console read of a table the boundary has no
  entry for throws now rather than first being exercised on the day it
  matters. `lib/hq/elevated-call-sites.test.ts` turns that runtime refusal
  into a build failure.
- **It fails closed when it cannot tell which tenants are sandboxes.**
  Returning an empty realm on a failed lookup would read as "no sandbox tenant
  exists" and let every console read run unbound.
- **It refuses an rpc, ahead of the method check rather than behind it.** A
  function body runs as the service role and there is no filter to add to it.
  The first version of this put the refusal inside the read branch, which was
  a control that reads as present and does nothing: `postgrest-js` sends
  `rpc(fn, args)` as a **POST** unless the caller asks for GET or HEAD, so the
  ordinary call would have sailed past. Caught in review, fixed, and pinned by
  a test that sends the rpc as a POST. The console issues no rpc today.
- **It binds reads, not writes.** A write is not 6.7 failure mode 2, and a
  filter appended to a `PATCH` means something different from a filter
  appended to a `GET`. Console writes are keyed by an id the operator got from
  a read that is now bound, so the UI cannot reach a sandbox row through them.

Two things it deliberately does not assume. PostgREST is believed to AND
repeated query parameters; that is not measured on this deployment, so the
wrapper **refuses** rather than emitting a second `or=` parameter on the two
tables whose tenant key is nullable. And an id list has to fit in a URL, so
the wrapper refuses above a 2000-character list rather than failing at an
unpredictable point: past roughly fifty sandbox tenants the exclusion has to
move into the database.

The realm lookup itself runs on a plain, unbound client. It is the one read
that must see sandbox rows in order to exclude them everywhere else, it is one
extra query per console render, and it is memoised for the life of the client.
It reads `companies` filtered on the flag; it does not write, so it does not
create a sandbox tenant. It takes the column name from the boundary's own
constant rather than writing the literal, so the flag has one spelling in the
codebase and not two.

#### The other 75, classified

6.3: "Bind each one to a tenant, or state plainly that it is not yet bound. An
unbound call site is an open boundary, not a closed one with a caveat." All 75
below are **unbound**. The classification is what a sandbox tenant would
actually do to each, which is the question that decides the order of the
remaining work.

| Group | Files | Invocations | Could a sandbox row leak here, and to whom |
|---|---|---|---|
| Per-tenant user pages and actions, `app/c/[publicId]/**` | 10 | 11 | **No, and binding them would be wrong.** The company is resolved from the URL through the caller's own membership, and a sandbox prospect reading their own sandbox rows is the product working. A real user cannot reach a sandbox `publicId` without a membership in it, and provisioning must never create a user holding both. |
| Cron jobs, `app/api/cron/**` | 11 | 11 | **They read every tenant, by design, and must keep doing so.** A sandbox tenant's trips still have to finalise or the prospect sees a broken product. The exposure is not the read, it is what the job then *sends*: 6.7 failure mode 1. The required control is the email and push allowlist at the 6.5 chokepoint, which is separate work and is not built. |
| Payment, bank and third-party webhooks and OAuth returns | 11 | 11 | **No cross-tenant read.** Each is keyed by an identifier the third party supplies. The sandbox concern here is 6.5's payments and webhooks rows, "no sandbox tenant may hold live credentials", which is an egress control at the dispatch chokepoint and is likewise not built. |
| Device, passkey, push and watch token auth | 13 | 14 | **No cross-tenant read.** Session-less by construction: each resolves exactly one device, passkey or pairing code from a token it was handed. |
| Mileage device ingest, `app/api/mileage/**` | 5 | 5 | **No cross-tenant read.** Each is scoped to the authenticated user's own membership before writing. |
| Token-link and public intake routes: `/w9/[token]`, `/book`, `/firms/request-account`, firm banks | 5 | 5 | **No cross-tenant read.** Each resolves a single row from a magic token or writes a new intake row. |
| Other authenticated API routes, including the user's own data export | 6 | 6 | **No.** `app/api/export/data` is the prospect's own GDPR export, scoped to their user id and their own companies. 6.5 is explicit that "the risk here is the **internal admin export**, not the prospect's own", and the internal one is the console, now bound. |
| Other authenticated actions, `app/onboarding/new-company` | 1 | 1 | **No cross-tenant read.** Creates one company for the caller. |
| `lib/` session and context helpers: `auth`, `tax/company-context`, `firm/context`, `plans/usage`, `push`, `email/transport`, `watch/device-auth` | 7 | 10 | **No cross-tenant read.** Each is scoped to the caller's own user id. `lib/auth.ts` `getMyCompanies` carries an explicit `.eq("user_id", user.id)` because of the 2026-05-13 production leak, and that filter is untouched. |
| The boundary's own realm lookup, `lib/hq/elevated-client.ts` | 1 | 1 | **Deliberately unbound**, and it is the read that does the binding. It is the only elevated read in the console's request path that sees sandbox rows. |

**One consequence of binding the console, recorded rather than fixed.**
`blockUser` in `app/admin/actions.ts` reads the target's `profiles` row to
check the forever-admin shield, and skips the check when that read returns
nothing. Narrowing the console's reads gives that null a second cause: a user
who is on `super_admins` **and** holds a membership in a sandbox tenant would
read as absent and lose the shield. That user is exactly the straddling
membership the boundary already forbids, provisioning must never create one,
and `supabase/tests/rls-hq-sandbox-isolation.sql` asserts the case. The
adjacent `deleteUserHard` already fails closed on the same null. It is left as
found rather than changed under a boundary PR, and it is the first thing to
settle if provisioning is ever allowed to touch an operator's account.

**What that classification does not do is close them.** A path that cannot leak
today because nothing writes the tenant flag is not the same as a path bound to
a tenant, and 6.3 does not accept the first as the second. The honest statement
to the Hub operator is unchanged in kind and smaller in size: seventy-five call
sites still carry `BYPASSRLS`, the one that produces a report a real person
reads no longer does, and the two classes that would break a sandbox prospect
in the outside world, the scheduled sends and the third-party dispatches, are
egress controls that this repository has inventoried and has not built.

### 3. The 6.6 word ban, re-derived

Revision C defines the scope revision B left open, with one question: "would a
real paying customer see this same string, in this same place, on this same
screen?", and four verdicts.

**The existing sweep was too narrow, not too broad.** It scanned email
templates, six generated documents, two export filenames and the seed fixture.
Every one of those is per-tenant generated output, which is revision C's row 1,
so the scope it had was right as far as it went. What it had no way to see was
row 2, which is the row revision C newly defines: "The string names the
visitor's own account, tenant, session, environment, plan or data as a demo,
sandbox, trial, test, sample or evaluation. **Banned**, however ordinary the
word is elsewhere in your product."

Row 2 exists in this product, and the contract's own example is nearly the
literal string:

> `components/TrialBanner.tsx` renders "3 days left on your free trial.",
> "1 day left on your free trial.", "Your free trial has ended.", "Trial
> active" and "Trial ended", on the dashboard, on the personal forecast, and
> in the native fallback.

Revision C's example of a banned string is "Your trial expires in 3 days", and
it says so is a tell "even on a product that sells trials". This product sells
trials. A provisioned prospect lands on a fresh account, and this product
auto-trials a fresh account, so the banner would greet them on their first
dashboard load and name their tenant as a trial.

**It is not fixed here and cannot be.** The gate reads `companies.sandbox` and
nothing reads that column yet. It is sequenced instead: the same assertion that
holds the elevated call sites also stops a sandbox tenant existing, so
provisioning cannot ship while this banner is ungated.

The other five hits in the row 2 sweep are classified and left alone, which is
the point revision C spends a page on. Two are ordinary tax vocabulary
("physical-presence test"), two are a real diagnostic every customer can run
("Tracker self-test"), one is a super-admin plan preview a prospect never
reaches. And the storefront is untouched: the pricing page, the guides, the
comparisons and the FAQ all say "trial" to every visitor identically, which is
row 3, and revision C is explicit that changing them "conceals nothing from
anybody and changes a public product for no safety benefit".

### 4. The purge catalog, to the expanded recipe

Revision B's recipe was one step. Revision C adds four, on the evidence of a
team that found all four in one schema. All four were looked for here, against
the live catalog of `enisnjjbxqaliydepacc` on 2026-08-22:

| Step | Found |
|---|---|
| 2. Tenant-bearing columns with **no** foreign key | **Zero.** Every `company_id` and every `firm_id` carries a constraint. The named trap is absent here. |
| 3. Referential actions on the keys that do exist | **Eleven non-cascading keys.** The finding of the four. |
| 4. Tables referencing a **user** rather than a tenant | **Sixteen**, including `passkeys`, which 8.1 names by hand. |
| 5. An exclusion list that is itself asserted | **Twenty**, each with a stated reason. |
| 6. Covered + excluded = catalog | 36 + 18 + 16 + 20 + `companies` = **91**, which is what the catalog reports. |

**Step 3 is where this schema actually breaks a purge.** Seven tables carry
`company_id ... on delete set null`:

    bella_conversations   firm_activity_log   firm_documents   firm_efilings
    firm_invoice_templates   firm_invoices   firm_meetings

Deleting the sandbox tenant row **orphans** those rows rather than removing
them, and a `remaining` recounted by `company_id` reports zero over rows that
are still sitting there. `bella_conversations` is the sharpest case twice over:
it holds the prospect's own assistant transcripts, and the barrier policy
passes any row whose `company_id` is null, so an orphaned row leaves the
sandbox side of the boundary as well as the purge. 8.1 predicts this exactly,
which is why 8.6 insists `remaining` is a fresh query rather than a
subtraction.

Three more keys **block** the delete outright rather than under-reporting it:
`bank_imports.user_id` (`restrict`) and `bank_imports.completed_by`
(`no action`) mean a sandbox user who imported a bank file cannot be deleted
until those rows go first; `admin_actions.admin_user_id` (`restrict`) cannot
bite a prospect, and is recorded because 8.1 asks for the action on each key
rather than on the ones that look relevant.

None of this is fixed here. Changing a referential action is a schema change
and this repository's migrations are purely additive. It is a finding for
whoever builds `purge_tenant`, and it is now in `NON_CASCADING_TENANT_FKS`
with its consequence stated per key.

**Step 4 is the largest omission the old catalog had.** Sixteen tables hang off
`auth.users` or `profiles` and sit outside the tenant's foreign key closure
entirely: `badges`, `capture_attempts`, `charitable_donations`,
`credits_ledger`, `device_fingerprints`, `device_tokens`, `feedback`,
`notification_log`, `passkeys`, `personal_expenses`, `profiles`,
`push_registration_state`, `subscriptions`, `tax_profiles`, `watch_devices`,
`watch_pair_codes`. A purge that walks `company_id` and follows keys from
`companies` reaches none of them, and every one holds something the prospect
created or something that identifies them.

**Step 5's exclusion list is twenty tables in three groups**: reference data
that every tenant shares (`deduction_categories`, `sales_tax_state_rates`, the
two `tax_kb_*` tables), the vendor control plane (`super_admins`,
`security_pulse_runs`, `admin_actions`, and three lead-capture tables), and the
firm axis (`firms` and nine `firm_*` tables keyed only by `firm_id`). The firm
group is the one to watch: it is excluded because a sandbox prospect is
provisioned into a *company* and no sandbox path creates a *firm*. If that ever
stops being true, the whole group becomes wrong, and the partition assertion is
what says so.

### 5. The word `sandbox` means three things here

Revision C: "The column name in that line is illustrative, not literal ... A
product that has already added a column named exactly `sandbox` is correct as
built and has nothing to change." That is this product, and **the column is not
being renamed.**

The collision is real, though:

| Meaning | Where |
|---|---|
| A per-tenant fleet flag | `companies.sandbox` |
| Plaid's own environment | `PLAID_ENV=sandbox`, `lib/plaid/client.ts` |
| APNs' own environment | `api.sandbox.push.apple.com`, `lib/push/providers.ts` |

The tired-afternoon bug revision C warns about is specific here, and it looks
like a good idea: routing a sandbox **tenant** to a third party's sandbox
**environment**. That is not what 6.5 asks for. 6.5 says the delivery layer
"refuses to dispatch for a sandbox tenant" - refuses, not redirects. A
redirected tenant still creates real objects in a real Plaid or APNs account,
and it behaves differently from a paying tenant, which is a 6.6 tell as well as
an egress failure.

So the assessment is: no rename, no column comment needed, **one guard**.
`lib/hq/boundary.test.ts` asserts that both environment selectors stay derived
from `process.env` and never from a tenant row. Mutation-tested by adding
exactly the tempting function and watching the named test fail.

### 7. The role vocabulary, published

4.1a is new and is a written exchange, not code. Its first three steps need
nothing from the Hub operator, so they are done:
`docs/design/fleet-role-vocabulary.md` carries the four literal
`public.company_role` values read from the schema, the recommendation with one
line on what it can do, and the confirmation that an unrecognized value is a
`422` with no mapping onto a default.

Step 5 is `lib/hq/role-vocabulary.test.ts`. The half that needs no answer is
live: all four strings are asserted against the migration that declares the
enum and against the union in `lib/auth.ts`, so a rename fails CI today rather
than failing the Hub's next call. The half that waits is a single named
constant, `HUB_CONFIGURED_ROLE`, which is `null` and stays `null` until the
operator confirms a value in writing. It is deliberately not filled in from our
own recommendation.

### One more thing revision C changed that needed no code

2.4 makes write-in-place **the** fleet method rather than the first of two
preferences, and adds: "This method works when your application repository is
public ... If your repository is public, say so when you send the identifiers,
and confirm before go-live that no placeholder resembling a secret exists in
it." **This repository is public.** The confirmation was performed on
2026-08-22: nothing in the tree names `HQ_BEARER_SECRET`, a Hub secret, or any
placeholder for one, and nothing here generates, holds, prints or placeholders
a bearer value. Where the entry identifiers get sent is open question 20, and
it is new.

---

## Why there are no endpoints in this PR

Three independent reasons, any one of which is sufficient.

**1. Four open questions block them.** Section 13 lists **twenty-five**
`[VERIFY]` items under revision C, six of them new. The Hub operator holds the answers and sends the same answers to all
nine products, so filling one in locally is how two products end up behaving
differently. The four that block rather than slow are listed below with the
seam left for each.

**2. The elevated call sites are unbound, and revision C makes that a stated
requirement rather than a caveat.** 91 `createServiceClient()` invocations
across 79 files bypass the predicate, 10 of them under `app/admin/`. Section
6.3 says an unbound call site is an open boundary, and offers three ways out;
this product takes the third, "sequence it before the first sandbox tenant
exists". An endpoint that provisions into a tenant those 91 sites can read
through is precisely the half-built endpoint section 0 says is worse than none.

*The reason recorded here under revision B, that the migration was not applied,
is closed.* It was applied and confirmed on production on 2026-08-22: 39
`hq_sandbox_barrier` policies, `companies.sandbox` present. The rule it stood
on is unchanged and still governs anything that reads a new column: PostgREST
answers a select naming an unknown column with
`{data: null, error: {code: "42703"}}` rather than throwing, and the paths here
destructure `data` and ignore `error`, so the reading code returns nothing and
reports success. `lib/db/schema-contract.test.ts` exists because that silently
mis-projected a year of deductions.

**3. There is no bearer secret, and there must not be one in this
repository.** The repo is public. The secret arrives by the write-in-place
exchange in section 2.4, never through a commit, a PR description or a chat
message. Nothing here generates, holds, prints or placeholders one.

Section 0 of the contract is explicit about the ordering and about which
failure is worse:

> An endpoint that mints credentials into a tenant that is not yet isolated
> is worse than no endpoint at all, because no endpoint fails safe by
> returning `404` for the whole contract, while a half-built one invites the
> Hub to hand out credentials that look safe and are not.

---

## What was built

### The tenant flag

`supabase/migrations/20260819010000_hq_sandbox_boundary.sql` adds
`companies.sandbox boolean not null default false`, plus a partial index on
sandbox rows.

`not null default false` is asserted verbatim by a test, not just the column
name. A nullable flag would make every egress decision in section 6.5 read as
"unknown", and there is no safe answer to that inside a cron job.

### The one predicate

Section 6.3 requires exactly one place that decides which tenant's rows a
request may touch, and that it be impossible to issue a data access that
skips it. Of the three mechanisms the contract offers, this uses the
strongest available here: Postgres row-level security driven by a
`security definer` predicate.

Two functions:

| Function | Returns | Why this shape |
|---|---|---|
| `hq_session_is_sandbox()` | boolean | Is the caller in the sandbox realm. One lookup, no arguments, derived only from `auth.uid()`. |
| `hq_sandbox_company_ids()` | `setof uuid` | The sandbox tenants. Returns a **set** so that `company_id in (select public.hq_sandbox_company_ids())` is an uncorrelated subquery the planner evaluates once per statement and hashes, rather than a function call per row. `mileage_points_raw` is large and is read on every `/mileage` render. |

The barrier is then `company_id is null or (company_id in (select
public.hq_sandbox_company_ids())) = public.hq_session_is_sandbox()`: the row's
side of the line must equal the session's side.

**The direction of that set is a security decision, and the first version of
this migration got it wrong.** The obvious formulation is "the companies in
the caller's realm", which reads better and is one character shorter to use.
It is also a customer enumeration oracle. An RLS predicate must be executable
by every role the policy applies to, `anon` included, or the policy cannot be
evaluated and an anonymous read errors instead of returning empty. Supabase
publishes `public` functions at `/rest/v1/rpc/`. So a realm-returning function
hands **every real company id in the database** to an unauthenticated caller,
and the tenant count is precisely the number `report_counts` exists to keep
internal to Techno Optics. Returning the sandbox side inverts that: an
anonymous caller learns the ids of the demo tenants, of which there are zero
today, and it is the smaller set to hash. `lib/hq/boundary.test.ts` asserts
the body selects `where c.sandbox` and not its complement.

This is the same bug class `scripts/check-definer-grants.mjs` was written for,
and the guard did not catch it, because the function is correctly allowlisted:
it genuinely does need to be anon-executable. The guard checks whether anon
can call a definer function, not what the function returns.

Both are `security definer` because they read `companies` and
`company_members`, both of which carry the barrier. Invoker rights would
recurse. Both carry `definer-grant-ok:` markers with reasons, because
`scripts/check-definer-grants.mjs` correctly objects to a definer function
that is anon-executable, and an RLS predicate must be executable by every
role the policy applies to or the policy cannot be evaluated at all.

The barrier itself is a **restrictive** policy on 39 tables. Restrictive
matters: it ANDs with the permissive policies already there, so it can only
ever narrow access and cannot open a hole in the existing tenancy rules.
That is the entire safety argument for adding a policy to 37 live tables in
one migration.

**It is a no-op on the database as it stands.** `companies.sandbox` defaults
to false and no row sets it, so `hq_session_is_sandbox()` is false for every
session, the realm set is every company, and every existing row passes. The
boundary only starts refusing anything once a sandbox tenant exists, and
nothing in this repository creates one.

### Which tables carry the barrier, and which do not

Read from the database catalog on project `enisnjjbxqaliydepacc`, not from
memory:

- **36 tables carry a `company_id` column.** All 36 get the barrier, plus
  `companies` itself. The list lives once, in the migration's
  `tenant_tables` array, and `lib/hq/catalog.ts` re-derives it from the
  migration files. `lib/hq/boundary.test.ts` asserts the two are equal, so a
  migration that adds a table with a `company_id` fails CI until the barrier
  covers it. That is section 8.7 step 5's property, applied to the boundary
  rather than to the purge.
- **`expense_booking_orphans` is a VIEW**, not a table, despite having a
  `company_id`. It holds no rows, a policy on it fails at apply time, and
  treating it as a purge target would report rows remaining that no delete
  could remove. Asserted explicitly.
- **18 further tables are reachable only by following a foreign key.** These
  are section 8.1's orphan-prone class. They are enumerated in
  `TENANT_REACHABLE_TABLES` and are **not** policy targets, for a reason
  that was read out of `pg_policy` rather than assumed: each one's own read
  policy contains an `EXISTS` over a parent that does carry the barrier, and
  Postgres applies the parent's RLS inside that subquery.

  Two are the exception. `chat_conversation_members` and
  `chat_conversation_reads` resolve through `can_access_conversation()`,
  which is `SECURITY DEFINER` and therefore does not see the parent's RLS at
  all. That helper does still require company membership, so the case it
  leaves open is narrow and specific: **a user holding a membership in a real
  company and in a sandbox one.** Provisioning must never create that user.
  Those two tables get the barrier directly, which is what makes the database
  enforce the invariant rather than the endpoint remembering to.

  Those two policies nest an `EXISTS` over `chat_conversations`, which is
  itself RLS-filtered, so they could in principle deny access that the
  permissive policies grant. Checked rather than assumed: `chat_conversations`
  reads under `can_access_conversation(id)` and `chat_conversation_members`
  reads under `can_access_conversation(conversation_id)`. The two predicates
  are identical, so a user who can see the membership row can always see the
  parent, and the nesting cannot narrow anything that was previously allowed.

  This claim is proved, not inferred: `supabase/tests/rls-hq-sandbox-isolation.sql`
  asserts it against real rows, including a deliberately straddling
  membership.

### The isolation test from section 6.8

`supabase/tests/rls-hq-sandbox-isolation.sql`, in the same psql idiom as the
existing `rls-tier2-isolation.sql`: scratch rows, impersonation via
`set_config('role')` and `request.jwt.claims`, `raise exception 'FAIL ...'`,
then `rollback`. Real mechanism, no mocks, nothing survives the transaction.

It proves both directions of section 6.1 across four shapes:

- a table with `company_id` (`monthly_expenses`)
- a table reachable only by foreign key (`mileage_points` through
  `mileage_trips`)
- a table gated by a `SECURITY DEFINER` helper (`chat_conversation_members`)
- a **super-admin** session, because `is_super_admin()` is ORed into nearly
  every read policy in this database and is therefore the session most likely
  to pull a sandbox row into an internal report a real person opens, which is
  failure mode 2 in section 6.7

plus that the real tenant count does not move while a sandbox exists, that
each side keeps access to its own tenant, and the straddling-membership case.

Run it with `psql $DATABASE_URL -f supabase/tests/rls-hq-sandbox-isolation.sql`.

### Watching it fail first

The contract asks for the isolation test to be watched failing before the
boundary exists. Stated precisely, because there are two different reds here
and only one of them was observed directly:

- **Observed.** `lib/hq/boundary.test.ts` was run with the boundary migration
  moved out of the tree: **9 failed, 5 passed**. The five that passed are the
  guard-the-guard assertions, which must pass without the boundary or they
  are proving nothing. Restoring the migration returned it to 14 passed.
- **Not observed, and stated as such.** The psql script was not watched
  failing, because DB access for this work is SELECT-only and the migration
  has not been applied. Its precondition is documented in its own header: the
  script fails at the first statement with `column "sandbox" does not exist`
  when the boundary is absent, which is the correct failure. Somebody with
  write access should run it once before applying the migration and once
  after, and record both.

### Synthetic seed data

`lib/hq/sandbox-seed.ts`. A literal in a source file: an invented single-owner
cabinetry business with six months of income, twelve expense lines and five
drives. Nothing is derived from any Taxottic account, masked or otherwise.
Anonymisation is not a defence here; the requirement is that no real client's
data enters a sandbox at all, not that it enters disguised.

`lib/hq/sandbox-seed.test.ts` asserts three properties, each of which a
well-meaning change would quietly break:

- **synthetic** - the module imports nothing at all, so it cannot read a
  database, a file, or a faker
- **fixed** - no `Math.random`, no `new Date`, no `Date.now`; drives are
  stored as negative minute offsets so the prospect sees recent drives without
  the fixture varying between prospects
- **applicable** - every column it names still exists in the migrations, which
  is the 42703 class again

It has **no caller**, and that is worth saying plainly because this codebase's
characteristic failure is a feature that is present and never invoked.
`provision_user` is what applies it, and `provision_user` is blocked.

### Egress inventory

`lib/hq/egress-chokepoints.test.ts` does not implement the section 6.5 checks
(they read `companies.sandbox`; see reason 2 above). It fixes the inventory in
place so it cannot rot between this PR and the next one. Each assertion says:
this egress path leaves the process in these files and no others.

| 6.5 path | Chokepoint | State |
|---|---|---|
| Transactional email | `sendEmail()`, `lib/email/transport.ts` | Single Resend exit, 13 call sites. **Five Supabase-auth mail sites bypass it** (`signInWithOtp`, `generateLink`); those are magic-link and invite mail and need their own gate. |
| SMS, push, voice | `resolveProvider()`, `lib/push/providers.ts`, behind `notify()` | Single exit for APNs, FCM and web push. No SMS or voice exists. The cleanest path here. |
| Outbound webhooks | none exist | All four `/api/webhooks/*` routes are inbound receivers. Nothing to gate. |
| Payments and billing | `getStripe()`, `lib/stripe/server.ts` | **Already violated twice**: a second module-private client in `lib/firm/payments/stripe-connect.ts` and one constructed inline in `app/api/firm/billing/portal/route.ts`. All three are in the inventory so the count is honest; a sandbox gate has to go in all three until they are folded back together. |
| Banking | `getPlaidClient()`, `lib/plaid/client.ts` | One construction, five consumers. |
| Search indexing | no search index | Retrieval is a Postgres trigram query. Nothing to partition. |
| Vector stores and AI | six files construct `new Anthropic(...)` directly | **No chokepoint.** This is the path carrying W-2s, paystubs and receipt images off-platform. See below. |
| Analytics, telemetry, BI | none installed | Verified absent. `next.config.ts` still allow-lists `*.vercel-insights.com` in its CSP with no corresponding code; harmless here, worth removing separately. |
| Data exports | `app/api/export/data/route.ts` (JSON), `renderHtmlToPdf()` (PDF), `mileageLogToCsv()` (CSV, browser-only) | No internal admin bulk export exists, which is the one 6.5 calls the real risk. |
| Support and CRM auto-creation | not built | Blocked on question 11 regardless: "the operator's trial queue" is undefined. |
| Internal alerting | `console.log` to Vercel logs | No customer-visible status page. |

### The vector store, which the product note singles out

The README's Taxottic note requires that sandbox content never be embedded
into a collection a real tenant's retrieval can reach.

Today that holds, for a reason worth writing down: `tax_kb_chunks` has an
`embedding vector(1024)` column and an HNSW index, and **nothing in this
repository writes to either**. `bella_kb_search` is trigram-only and never
references the embedding column. The corpus is published tax guidance, not
tenant content.

That is a safe state held by absence, and the kind that ends quietly. Two
tests make it end loudly instead: one fails when an embedding producer
appears anywhere in `app/` or `lib/`, the other when any code writes to
`tax_kb_chunks`. Whoever wires embeddings has to decide where a sandbox
tenant's vectors live before the suite goes green, which is the decision 6.5
wants made once rather than discovered later.

### Invisibility

`lib/hq/invisibility.test.ts` greps the surfaces section 6.6 actually
enumerates - email templates, generated documents, export filenames, and the
seed itself - for "demo", "sandbox", "trial", "test", "sample", "evaluation",
"not a real", "for demonstration purposes".

It is deliberately not a repo-wide grep. A repo-wide grep here returns
hundreds of hits and every one is noise: `--no-sandbox` is a Chrome launch
flag, `.test.ts` is a filename, `PLAID_ENV` has a `sandbox` value that is
Plaid's environment, and "Book a 20-minute demo" is marketing copy on a public
page every real visitor also sees. A guard that cries wolf on all of those
gets deleted within a month.

One real hit, excluded with a reason and a stale-exclusion check:
`lib/email/templates/beta-invite.ts` carries the subject *"invited you to test
Taxottic"*. That is the TestFlight and Play beta invitation, sent only from
the admin beta-invite console to a named tester, and it is not on any path a
sandbox prospect can reach. **If provisioning ever reuses that template it
becomes a section 6.6 violation on the first send.**

Hostname: `https://taxottic.com` only, no `sandbox.`, no `demo.`, no port.
That is not yet enforceable in code because nothing produces a `login_url`,
and the base URL is question 12.

---

## Blockers

### The four that stop work

**Q1. What creates the sandbox tenant?** There is no create-tenant endpoint.
The contract's own reading is that `provision_user` creates the tenant on the
first call for a `hub_org_id` and later calls reuse it, since `purge_tenant`
addresses the tenant by `hub_org_id` alone. That reading is not adopted here.

*Seam:* `companies.sandbox` exists and defaults to false, and nothing sets it.
There is no `hub_org_id` column and no mapping table, because the shape of
that mapping depends on the answer: if `provision_user` creates the tenant,
`hub_org_id` belongs on `companies` as a unique nullable column; if some other
call does, it belongs in a join table. Guessing wrong means a second migration
against a table that already holds sandbox rows.

**Q10. Which `role` value will the Hub send?** **Narrowed in revision C, and
half of it is now closed.** An unrecognised `role` is a `422`. This product's
vocabulary is the `company_role` enum: `manager`, `member`, `lead`,
`expenser`. The contract's example sends `admin`, which this product does not
have, and nothing maps it, by design: 4.1a step 3 forbids mapping an unknown
value onto a default.

The half that was open under revision B, how our vocabulary reaches the
operator, is answered by the new section 4.1a and is done:
`docs/design/fleet-role-vocabulary.md` is the exchange, and steps 1 to 3
needed nothing from anybody else. What remains is the value itself, confirmed
back in writing as the literal string the Hub will send. Only the operator can
give it, and it is not being guessed here.

*Seam:* `HUB_CONFIGURED_ROLE` in `lib/hq/role-vocabulary.test.ts`, currently
`null`. It becomes the confirmed literal string, and the test tightens from
"the vocabulary is intact" to "the exact value the Hub sends is still in it".
The vocabulary half of that assertion is already live, so a migration that
renames a role fails CI today.

**Q12. What is the confirmed base URL?** The README names
`https://taxottic.com` and the contract says to treat that as a proposal until
the operator confirms, because at least one product in the fleet has two
different hostnames recorded at the Hub. It matters twice: it is the host the
Hub calls, and section 4.3 requires `login_url` to be the ordinary hostname.

*Seam:* nothing hardcodes a base URL. One landmine is worth flagging now.
This product already uses **`hq.taxottic.com` as an admin hostname**, and the
contract's endpoint prefix is the **path** `/hq/` on the root domain. They do
not collide on `taxottic.com`, but on `hq.taxottic.com` the middleware
rewrites `/hq/...` to `/admin/hq/...`. Separately, `/hq/` is not under
`/api/`, so `lib/supabase/middleware.ts` will `307` it to `/login` unless
`/hq` is added to `PUBLIC_PATHS`. Both are one-line fixes and both belong in
the PR that adds the routes, not before.

**Q13. What evidence of completion does the operator want, and who receives
it?** Unanswerable locally. This document plus a CI run is the guess, and it
is not being treated as the answer.

### The remaining twenty-one, and what each would change

| # | Question | What it blocks here |
|---|---|---|
| 2 | Mapping the thirteen 8.1 data classes onto the ten 8.3 counter keys | The purge response body. Building to the ten shown as the required set is the contract's own instruction, so this slows rather than blocks. |
| 3 | **Narrowed in revision C.** The 35-vs-30 conflict is resolved in 8.4 against the wire contract: 35 days is the limit, thirty describes the backup window it is sized against. What is still open is the policy, and **this product is on the wrong side of it.** `docs/DATA_RETENTION_AND_DISPOSAL_POLICY.md` states deletion propagates to backups within **90 days**, which exceeds 35, and 8.4 requires the operator's explicit agreement in that case. No product has one. Report it; do not set a local retention figure. Separately, `docs/INFORMATION_SECURITY_POLICY.md` states a 7 day point-in-time recovery window, so those two documents disagree with each other and the discrepancy needs settling before either number is quoted to the operator. |
| 4 | Hub polling interval and the maximum `in_progress` window | Whether an asynchronous multi-hour purge is acceptable, which decides whether the purge can be a cron drain or must be inline. |
| 5 | Hub request timeouts and call rate | The `429` threshold. Cannot be set without it. |
| 6 | Source-address allowlisting, mutual TLS | Whether anything beyond bearer-over-TLS is wanted. |
| 7 | Valid `X-Hub-Key-Id` values and who assigns them | Log labelling only. |
| 8 | How users the prospect invites inside their own sandbox are created | The email allowlist in 6.5 assumes they exist. The implied answer is the ordinary invite flow running inside the sandbox tenant. |
| 9 | Whether the Hub calls `purge_tenant` automatically at `expires_at` | How long a revoked-but-not-purged tenant may sit here. |
| 11 | The destination for sandbox-originated support and CRM submissions | The CRM row of the 6.5 table. |
| 14 | Whether there is a Hub caller to test against before go-live | Whether conformance can be proved at all before the first real trial. No sandbox Hub, no test secret and no conformance harness is named anywhere. |
| 15 | Expected delivery date | Sequencing. No date appears in any document. |
| 16 | Trial length, and therefore the `expires_at` window | Capacity planning only. |
| 17 | SLA, uptime, latency | Interacts with 5. |
| 18 | Whether this product implements section 14's second path | Nothing today. Section 14 is designed, not built, and must not be anticipated. |
| 19 | Whether this product federates | Nothing today. Section 15 is explicit that the Hub cannot federate this product and that no product has been asked. |
| 20 | **New in revision C.** Where to send the secret-store entry identifiers under the write-in-place method in 2.4 | **Blocks the secret exchange, and is a new blocker.** Revision B offered two delivery methods; revision C makes write-in-place the fleet's method, and that method depends on us sending the operator two identifiers and a grant. No document names an address, a channel or a person. There is no value in an identifier, so this is a missing address rather than a secret-handling question, and it is cheap to answer and free to ask. |
| 21 | **New in revision C.** `tenant_count` and `user_count` for a product that separates customers physically | **Does not apply.** This is one deployment, one database, many `companies` rows. Section 7's unit is the customer organization, which is what a count of `companies` returns. Nothing here is per-deployment. |
| 22 | **New in revision C.** Whether schema-per-tenant or database-per-tenant satisfies 6.2 | **Does not apply, and worth saying why.** This product is already in the shape 6.2 requires: a sandbox tenant inside the ordinary database, distinguished by a flag, with one enforced predicate. The tension 6.2 and 6.3 create for a physically separated product is not a tension here. |
| 23 | **New in revision C.** Whether a 6.5 egress row may be recorded as not applicable, and what evidence the operator wants | **Applies directly. Blocks the report, not the work.** Five rows are vacuously satisfied here: outbound webhooks, search indexing, vector stores, analytics, syndication. Each is recorded as a finding and pinned with a test that fails when the path appears, which is the strongest of the three kinds of evidence the question lists. If a bare statement is what the operator wants instead, the tests stay anyway. |
| 24 | **New in revision C.** What to report when tenant content has already reached an external index | **Applies conditionally, and cannot today.** No syndication path here carries tenant content, and `lib/hq/syndication.test.ts` fails when one appears. The question matters only if that changes, and its answer is an attestation format, which is the operator's to define. Note it interacts with question 2: nothing in 8.4's `reason` list describes the state, and `remaining` counts what is in our system rather than what is in someone else's. |
| 25 | **New in revision C.** How the syndication row interacts with 6.6 for a product whose users expect content published outside it | **Does not apply.** No Taxottic user expects their content published outside the product. A taxpayer's Schedule C, mileage log or bank feed is not meant to be crawlable, so withholding it from a public index is not a tell and there is nothing to trade off. Recorded because the question could be misread as applying to any product with a public surface: this one has a public *marketing* surface, not a public *tenant-content* surface. |

**Which of the six change the blocker list.** One does: **question 20 is a new
blocker**, because the fleet's secret exchange now has a required step with no
address. Question 23 blocks the shape of the report rather than the work.
Questions 21, 22 and 25 do not apply to this product, and 24 cannot apply while
the syndication tests hold. The four originally listed as blocking are now
three and a half: 1, 12 and 13 are untouched, and 10 has lost the half that
4.1a answers.

---

## What was deliberately not built

- **The five endpoints.** Reasons above.
- **Any branch on `demo`.** Section 14 and section 0 both reduce to one
  negative instruction: no branch on `demo` being anything other than `true`,
  and no code path that treats a v1 request as a real-account request. The
  simplest way to obey it is to write no branch at all, which is the state
  here. Real client accounts get a separate `/hq/v2/` prefix in a design that
  is not approved and not built; an un-implemented product answering `404`
  there is the correct behaviour.
- **The runtime egress checks.** They read `companies.sandbox`. Now unblocked
  (the migration is applied) and still not written. Next piece of work.
- **A bearer-auth module.** It would have no caller until the endpoints exist,
  and this codebase's characteristic failure is code that is present, correct
  and never invoked.
- **`hub_org_id` anywhere.** Its home depends on Q1.

---

## The gap this does not close

**Supabase's `service_role` carries `BYPASSRLS`.** Measured on the tree at
`7f6834e0`: **92 `createServiceClient()` invocations across 80 files.** Every
one of them skips the predicate this migration installs. On the current tree
the figure is **75 across 70 files**, and the ten under `app/admin/` are gone:
see "The chokepoint" above. What follows is the state of the rest.

That is the hardest part of section 6.3's one-predicate rule in this codebase
and it is not solved here. What is true:

- The reason those call sites exist is documented in `lib/auth.ts`: session
  cookies do not reliably reach PostgREST from Next.js server actions in
  production, so `auth.uid()` is NULL and RLS `WITH CHECK` fails. The stated
  mitigation is a convention - trust `user.id` from the validated JWT, then
  write with the admin client - not a mechanism.
- Roughly 34 of them are inside `app/c/[publicId]/*`, per-tenant user-facing
  pages where isolation currently depends on a hand-written
  `.eq("company_id", ...)` rather than on the database.
- 10 files under `app/admin/` used it, which is precisely failure mode 2 in
  section 6.7: the internal report that counts all rows. **Those ten are now
  bound**, through the chokepoint described above. The count of admin files
  holding an unbound client is asserted at zero, not as a ceiling.

Closing this properly is a repo-wide refactor and is out of scope for a
foundation PR. What the contract permits in the meantime is its third
mechanism in 6.3: an explicit, greppable opt-out with a test that fails when a
new one appears. That guard is **not in this PR** either, because an allowlist
of 80 files would fail on every unrelated PR that touches a new file and would
be deleted within a month.

The honest recommendation, in order:

1. ~~Before the first sandbox tenant is created, add a `sandbox` exclusion to
   the `app/admin/**` read paths specifically.~~ **Done.** Not as an exclusion
   in ten read paths, which 6.5 rejects, but as one `fetch` wrapper the ten
   files construct their client from.
2. ~~Then scope a guard to `app/admin/**` only.~~ **Done**, and it is three
   assertions rather than one: no console file holds an unbound client, the
   fetch-taking factory has exactly one caller, and every table the console
   reads is classified for the boundary.
3. **Still open.** The wider refactor is its own piece of work with its own
   decision, and the classification above is the input to it. The two groups
   that matter next are the scheduled jobs and the third-party dispatchers,
   and for both of those the required control is the 6.5 egress chokepoint,
   not a read exclusion.

**Step 1 was the stated blocker on provisioning and it is now done.** What
that unblocks is narrow, and the remaining blockers are unchanged: the
endpoints do not exist, the bearer secret has not been exchanged, and the
egress chokepoints in 6.5 are inventoried but not wired. The barrier holds for
every user session, including super-admins; it does not hold for server-side
code running as `service_role`, and seventy-five such call sites remain.

---

## Checklist state, section by section

### Foundation (section 11 phase 1)

| Item | State |
|---|---|
| One tenant predicate no data access can skip (6.3) | **Built for every user session**, restrictive RLS on 39 tables. **Bound at a chokepoint for the operator console**, which was 6.7 failure mode 2 and the stated blocker on provisioning. **Still not held on 75 service-role call sites across 70 files**, each classified above. `lib/hq/elevated-call-sites.test.ts` holds the count, holds the console at zero, and blocks a sandbox tenant from existing while the rest are unbound. |
| `sandbox boolean not null default false` (6.5) | Built and **applied**. Revision C confirms the name is correct as built; the collision with Plaid's and APNs' `sandbox` is guarded rather than renamed. |
| Isolation test watched failing before the boundary (6.8) | Static half observed red then green. psql half not run; SELECT-only access. |
| Synthetic checked-in seed (6.4) | Built, guarded, no caller yet. |
| Secret received per 2.4, two values accepted | **Not started.** No secret exists. Nothing here handles one. |
| Logging redacts `Authorization` and the body (4.4) | **Not started.** Belongs with the routes. |

### Egress (phase 2)

| Item | State |
|---|---|
| Sandbox check at every 6.5 chokepoint | **Inventory fixed and guarded. Checks still not wired**, but no longer blocked: the migration is applied, so code may read `companies.sandbox`. Wiring them is the next piece of work. |
| No sandbox tenant holds live third-party credentials | Not enforced yet. Plaid and Stripe chokepoints identified. |
| Sandbox search documents in a separate index or namespace | **Not applicable and guarded.** No search index; no embedding producer; two tests fail if either appears. |

### Endpoints (phase 3)

Every line: **not started.** Q1, Q10, Q12 and the unapplied migration.

### Invisibility (phase 4)

| Item | State |
|---|---|
| Grep templates, locales, subjects, PDF footers, export filenames | Built as a test, with one reasoned exclusion. |
| Ordinary hostname, no subdomain or port tell | Not enforceable yet; nothing produces a `login_url`. Q12. |
| No slower tier for a sandbox | No tiering exists. Nothing to do. |
| Prospect-triggered emails still arrive | Not wired. The allowlist is the mechanism and it needs the flag. |
| A blocked integration fails the ordinary way | Not wired. |

### Tests (phase 5, the actual deliverable)

| Item | State |
|---|---|
| Provisioned user cannot read a real tenant's row, real mechanism | **Written** (`supabase/tests/rls-hq-sandbox-isolation.sql`). **Not executed**, needs the migration applied and write access. |
| Every scheduled job sends nothing to a non-allowlisted recipient | Not started. Needs the email allowlist. 11 crons enumerated from `vercel.json`. |
| `report_counts` byte-identical before and after a sandbox | The count invariant is asserted inside the psql script. The endpoint does not exist. The internal counts that already exist, `totalUsers` and `totalCompanies` on the console dashboard, are the section 7 definitions' nearest live equivalent and **did** count every row; they now run through the chokepoint, including the `head: true` count requests, which issue `HEAD` and would have escaped a wrapper that only handled `GET`. |
| No third-party client constructed for a sandbox tenant, failing on the network call | Construction sites enumerated and guarded. The per-tenant assertion needs the flag. |
| A real user's search returns no sandbox document | Not applicable today, and guarded so it stays that way. |
| Every export path routes through the tenant predicate | Export entry points enumerated from the codebase, not from memory. Assertion not written. |
| **No feed, public unauthenticated content endpoint, sitemap or deploy-time submission carries anything belonging to a sandbox tenant** | **Built** (`lib/hq/syndication.test.ts`). Paths enumerated from the codebase and from the deploy pipeline. The product has no tenant-content syndication path, and the absence is pinned per version so it fails when one appears. New in revision C. |
| The purge test in 8.7 including step 5 | Endpoint not started. **The catalog is now complete to the revision C recipe**: `lib/hq/catalog.ts` plus `lib/hq/purge-catalog.test.ts` cover all six steps, and the partition assertion fails the build on a table in no class. |

---

## Files

| Path | What it is |
|---|---|
| `supabase/migrations/20260819010000_hq_sandbox_boundary.sql` | The flag, the two predicate functions, the restrictive barrier on 39 tables. **Applied**, confirmed on production 2026-08-22: 39 `hq_sandbox_barrier` policies, `companies.sandbox` present. |
| `supabase/tests/rls-hq-sandbox-isolation.sql` | Section 6.8, real mechanism, psql. |
| `lib/hq/catalog.ts` | The schema catalog. Carries all six classes of section 8.1's expanded recipe. |
| `lib/hq/boundary.test.ts` | The boundary is declared and covers every tenant table, **and the tenant flag is never conflated with Plaid's or APNs' environment**. |
| `lib/hq/sandbox-seed.ts` | The synthetic fixture. |
| `lib/hq/sandbox-seed.test.ts` | It is synthetic, fixed, and matches the schema. |
| `lib/hq/egress-chokepoints.test.ts` | The 6.5 inventory, and the two vector-store invariants. |
| `lib/hq/invisibility.test.ts` | Section 6.6, both the row 1 sweep and the **new revision C row 2 sweep**. |
| `lib/hq/syndication.test.ts` | **New for revision C.** The 6.5 syndication row, its 6.7 failure mode, and its section 11 checklist line. |
| `lib/hq/elevated-call-sites.test.ts` | **New for revision C.** Section 6.3's account of the call sites that bypass the predicate, and the sequencing that stops a sandbox tenant existing while they do. Now also holds the console at zero unbound clients, holds the fetch-taking factory to one caller, and fails when the console reads a table the boundary has not classified. |
| `lib/hq/sandbox-exclusion.ts` | The chokepoint. The table partition, the URL rewrite, the realm lookup, and the four ways it fails closed. |
| `lib/hq/sandbox-exclusion.test.ts` | The rewrite, tested as pure behaviour. |
| `lib/hq/elevated-client.ts` | Twelve lines wiring the chokepoint to a service-role client. The console's only door. |
| `lib/hq/purge-catalog.test.ts` | **New for revision C.** Section 8.1's expanded recipe, all six steps. |
| `lib/hq/role-vocabulary.test.ts` | **New for revision C.** Section 4.1a step 5. |
| `docs/design/fleet-role-vocabulary.md` | **New for revision C.** The 4.1a written exchange, ready to hand to the Hub operator. |
| `docs/SUPABASE_MIGRATIONS_RUNBOOK.md` | Gained the section 8.5 restore requirement. |

## The migration, applied

**Done.** Applied and verified against production `enisnjjbxqaliydepacc` on
2026-08-22: `companies.sandbox` exists, 39 `hq_sandbox_barrier` policies are in
`pg_policy`, and `supabase/tests/rls-hq-sandbox-isolation.sql` was run with all
assertions passing in both directions.

Two items from the pre-apply list remain open and are worth doing:
1. `EXPLAIN ANALYZE` one ordinary `/mileage` read against `mileage_points_raw`,
   now that the barrier is live. It is written as an uncorrelated subquery
   specifically to avoid a per-row cost, but that is a claim about the planner
   and it has still not been measured on this data.
2. `alter table ... force row level security` was assessed under revision C's
   "where your database can force the policy on the table owner, turn it on"
   and **deliberately not done**: `rolbypassrls` is a role attribute that
   outranks table ownership, so forcing would change nothing about the 91
   unbound call sites. Reported rather than performed.
