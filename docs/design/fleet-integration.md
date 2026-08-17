# Techno Optics fleet integration: the sandbox boundary

Status: **foundation built and mutation-tested. None of the five endpoints
exist, deliberately.** Four open questions block them and the boundary
migration is not applied yet. A product with no `/hq/` routes answers `404`,
which the contract names as the correct state while the work is incomplete.

Contract: `INTEGRATION.md` revision B, 17 August 2026, derived from Fleet
Adapter Contract v1 revision 2. Handoff at
`~/Desktop/Techno Optics Integration Handoff/Taxottic/`. That file is byte
identical across all nine products and is not edited by anything here.

---

## Why there are no endpoints in this PR

Three independent reasons, any one of which is sufficient.

**1. Four open questions block them.** Section 13 lists nineteen `[VERIFY]`
items. The Hub operator holds the answers and sends the same answers to all
nine products, so filling one in locally is how two products end up behaving
differently. The four that block rather than slow are listed below with the
seam left for each.

**2. The migration is not applied.** `provision_user`, `report_counts` and
`purge_tenant` all read `companies.sandbox`. This repo's rule is that an
additive column reaches production **before** the code that reads it merges.
That rule is not bureaucratic: PostgREST answers a select naming an unknown
column with `{data: null, error: {code: "42703"}}` rather than throwing, and
the paths here destructure `data` and ignore `error`, so the reading code
returns nothing and reports success. `lib/db/schema-contract.test.ts` exists
because that silently mis-projected a year of deductions, and the same class
took every device's mileage heartbeat off the air for a day. Merging an
endpoint that reads `sandbox` before the column exists would reproduce it on
the one surface where the failure mode is "a real tenant's rows were counted
into a demo".

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

**Q10. Which `role` value will the Hub send?** An unrecognised `role` is a
`422`. This product's vocabulary is the `company_role` enum: `manager`,
`lead`, `member`, `expenser`. The contract's example sends `admin`, which
this product does not have. Nothing maps it.

*Seam:* the vocabulary is a database enum and is already the single source of
truth. What is needed is the operator's configured value for this product and
the mapping, both of which are one line each once the answer arrives.

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

### The remaining fifteen, and what each would change

| # | Question | What it blocks here |
|---|---|---|
| 2 | Mapping the thirteen 8.1 data classes onto the ten 8.3 counter keys | The purge response body. Building to the ten shown as the required set is the contract's own instruction, so this slows rather than blocks. |
| 3 | Residue limit: 35 days or 30 | A retention policy. Build to 35, the stated rule. |
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
- **The runtime egress checks.** They read `companies.sandbox`. Next PR,
  after the migration is applied.
- **A bearer-auth module.** It would have no caller until the endpoints exist,
  and this codebase's characteristic failure is code that is present, correct
  and never invoked.
- **`hub_org_id` anywhere.** Its home depends on Q1.

---

## The gap this does not close

**Supabase's `service_role` carries `BYPASSRLS`.** Measured on the tree at
`7f6834e0`: **92 `createServiceClient()` invocations across 80 files.** Every
one of them skips the predicate this migration installs.

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
- 10 files under `app/admin/` use it, which is precisely failure mode 2 in
  section 6.7: the internal report that counts all rows.

Closing this properly is a repo-wide refactor and is out of scope for a
foundation PR. What the contract permits in the meantime is its third
mechanism in 6.3: an explicit, greppable opt-out with a test that fails when a
new one appears. That guard is **not in this PR** either, because an allowlist
of 80 files would fail on every unrelated PR that touches a new file and would
be deleted within a month.

The honest recommendation, in order:

1. Before the first sandbox tenant is created, add a `sandbox` exclusion to
   the `app/admin/**` read paths specifically. Ten files, and it is the
   surface where "nothing sandboxed gets out" actually breaks.
2. Then scope a guard to `app/admin/**` only, where the file set is small and
   changes rarely.
3. Treat the wider refactor as its own piece of work with its own decision.

**No sandbox tenant should be provisioned until step 1 is done.** The barrier
holds for every user session, including super-admins. It does not hold for
server-side code running as `service_role`, and that is where the internal
reports live.

---

## Checklist state, section by section

### Foundation (section 11 phase 1)

| Item | State |
|---|---|
| One tenant predicate no data access can skip (6.3) | **Built for every user session**, restrictive RLS on 39 tables. **Not held on 92 service-role call sites.** See the gap above. |
| `sandbox boolean not null default false` (6.5) | Built. **Migration not applied.** |
| Isolation test watched failing before the boundary (6.8) | Static half observed red then green. psql half not run; SELECT-only access. |
| Synthetic checked-in seed (6.4) | Built, guarded, no caller yet. |
| Secret received per 2.4, two values accepted | **Not started.** No secret exists. Nothing here handles one. |
| Logging redacts `Authorization` and the body (4.4) | **Not started.** Belongs with the routes. |

### Egress (phase 2)

| Item | State |
|---|---|
| Sandbox check at every 6.5 chokepoint | **Inventory fixed and guarded. Checks not wired**, blocked on the migration. |
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
| `report_counts` byte-identical before and after a sandbox | The count invariant is asserted inside the psql script. The endpoint does not exist. |
| No third-party client constructed for a sandbox tenant, failing on the network call | Construction sites enumerated and guarded. The per-tenant assertion needs the flag. |
| A real user's search returns no sandbox document | Not applicable today, and guarded so it stays that way. |
| Every export path routes through the tenant predicate | Export entry points enumerated from the codebase, not from memory. Assertion not written. |
| The purge test in 8.7 including step 5 | Not started. The catalog half exists (`lib/hq/catalog.ts`) and is already load-bearing for the boundary. |

---

## Files

| Path | What it is |
|---|---|
| `supabase/migrations/20260819010000_hq_sandbox_boundary.sql` | The flag, the two predicate functions, the restrictive barrier on 39 tables. **Unapplied.** |
| `supabase/tests/rls-hq-sandbox-isolation.sql` | Section 6.8, real mechanism, psql. |
| `lib/hq/catalog.ts` | The schema catalog, read from the migrations. Will carry the purge too. |
| `lib/hq/boundary.test.ts` | The boundary is declared and covers every tenant table. |
| `lib/hq/sandbox-seed.ts` | The synthetic fixture. |
| `lib/hq/sandbox-seed.test.ts` | It is synthetic, fixed, and matches the schema. |
| `lib/hq/egress-chokepoints.test.ts` | The 6.5 inventory, and the two vector-store invariants. |
| `lib/hq/invisibility.test.ts` | Section 6.6. |
| `docs/SUPABASE_MIGRATIONS_RUNBOOK.md` | Gained the section 8.5 restore requirement. |

## Applying the migration

Not done here: DB access for this work was SELECT-only, and a boundary
migration touching 39 tables is not something to apply without a person
watching. Before applying:

1. Run `supabase/tests/rls-hq-sandbox-isolation.sql` and confirm it fails with
   `column "sandbox" does not exist`. That is the red the contract asks to be
   watched.
2. Apply the migration.
3. Run the script again and confirm the `[hq-sandbox] OK` notice.
4. `EXPLAIN ANALYZE` one ordinary `/mileage` read against `mileage_points_raw`
   before and after. The barrier is written as an uncorrelated subquery
   specifically to avoid a per-row cost, but that is a claim about the planner
   and it has not been measured on this data.
5. Re-run `npx vitest run lib/hq`.
