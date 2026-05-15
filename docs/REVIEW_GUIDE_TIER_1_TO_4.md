# Review guide — Tier 1-4 enterprise/firm portal closure

This branch is large (~26k LoC over 12 commits). The PR description
covers the *what*; this doc tells a reviewer *how to walk through
it efficiently* without trying to read every diff line.

The branch is organized as one coherent deliverable per commit.
You can review commit-by-commit and treat each as a self-contained
unit; the dependencies between commits are minimal.

## How to read this branch in 90 minutes

### 1. Skim the commit list (5 min)
```
git log --oneline origin/main..HEAD
```

There are four tiers + one build-fixes commit. Each tier's commit
message is structured: short title, then bullet list of what
changed and why, then footer.

### 2. Audit the migrations first (15 min)
Five new SQL files, all idempotent:

- `20260514000011_firm_w9_forms.sql` — W-9 schema + two SECURITY
  DEFINER RPCs (`lookup_w9_request`, `submit_w9_form`)
- `20260514000012_firm_document_versions.sql` — versioned doc
  snapshots with `snapshot_firm_document(id, reason)` RPC
- `20260514000013_company_state_nexus.sql` — multi-state nexus
  table with `company_resident_state(uuid)` helper
- `20260514000014_tier2_schemas.sql` — invoice templates + threads
  + messages + doc comments. Three new tables, all on the
  supabase_realtime publication. RLS-scoped via existing
  `is_firm_member()` / `is_firm_owner_or_manager()` helpers.
- `20260514000015_entity_return_document_kinds.sql` — appends
  three values to `firm_document_kind` enum

Spot-checks worth doing:
- `firm_invoice_templates_next_idx` partial index — does it cover
  the cron's query? (Yes; the cron filters by `active = true` + 
  `next_issue_at <= now()` and orders ascending.)
- Every RLS policy on the four new Tier 2 tables uses the same
  pattern as Phase 5 (`is_firm_member(firm_id)` for reads,
  `is_firm_owner_or_manager(firm_id)` for writes). Worth confirming
  against `supabase/migrations/20260429000005_enterprise_part3_helpers_rls.sql`.

### 3. Run the test suite (10 min)
```
npm test
```

There are 211 passing tests after this branch (190 pre-existing +
21 new). The new ones live in:
- `lib/firm/documents/generate-1040.test.ts` (8)
- `lib/firm/documents/generate-entity-return.test.ts` (6)
- `lib/firm/invoice-templates/schedule.test.ts` (7)
- `lib/firm/invoice-templates/schedule.load.test.ts` (1)

### 4. RLS isolation drill (15 min)
There's a SQL test that exercises Tier 2 RLS end-to-end via SET
LOCAL impersonation. Run it against staging (it's wrapped in a
transaction + ROLLBACK so production data is untouched):

```
psql $DATABASE_URL -f supabase/tests/rls-tier2-isolation.sql
psql $DATABASE_URL -f supabase/tests/rls-w9-adversarial.sql
```

Both scripts raise `exception 'FAIL: ...'` on any leak.

### 5. Drill into the surfaces a reviewer cares about (20 min)
- `app/firm/audit-log/page.tsx` — Cross-tenant access viewer.
  Comment at top explains the historical-rows policy.
- `app/firm/templates/page.tsx` + cron at
  `app/api/cron/firm-invoice-issue/route.ts` — Recurring invoice
  blueprint flow. Pagination + wall-budget guarding the cron.
- `app/firm/clients/[id]/banks/page.tsx` — read-only Plaid mirror;
  no write paths, no Plaid SDK changes.
- `app/firm/clients/[id]/documents/[docId]/comments/page.tsx` —
  per-document comment thread with resolve/reopen.
- `lib/firm/documents/generate-1040.ts` +
  `lib/firm/documents/generate-entity-return.ts` — the math is
  unit-tested; review the comments at the top of each file for
  the scope-of-automation boundary.

### 6. Production checklist (5 min)
See PR description for the deploy-time test plan. The pivotal
steps:
- `supabase db push` to apply the 5 migrations
- Vercel cron limit (Hobby = 2, Pro = 40) — branch adds 3 net new
  crons; total goes 1 → 4
- Required env vars: `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`,
  `CRON_SECRET` (plus optional `FIRM_ACTIVITY_RETENTION_DAYS`,
  `IRS_EFIN`)

## Commit-by-commit map

| Commit | Tier | Coverage |
|---|---|---|
| `9b4570e` | T1 #1 | W-9 collection: schema + public token-fill flow + firm admin surface |
| `5772806` | T1 #2-3 | E-signature auto-send (HTML → Chromium PDF → provider) + document version history |
| `745b4a2` | T1 #4 | Multi-state apportionment with sales-factor weights + resident-state credit |
| `e44ac03` | T1 #5 | Playwright E2E suite (13 specs) for the public marketing + legal + login surfaces |
| `f03ab8e` | T1 #6-7 | IRS MeF SubmissionManifest + envelope builder + mobile-app-store runbook |
| `05753d6` | T2 | Six firm-portal surfaces: billing, threads, audit-log, banks, doc-comments, recurring invoices |
| `446078c` | T3 | Firm Bella + onboarding tour + CSV import preview + retention cron + firm pricing |
| `09dfda1` | T4 | Form 1040 + entity return (1065/1120/1120-S) generators + 14 unit tests |
| `45cbb36` | Build | Turbopack fixes + E2E smoke spec + schedule helper extraction |
| (this commit) | Audit | RLS isolation tests + W-9 adversarial tests + DRAFT messaging + retention policy + cron hardening + this guide |

## Known gaps (intentional)

These are documented in code/PR comments — they're not regressions,
they're scoped non-goals:

1. **Tax-form generators are review starters, not file-ready.**
   `docs/TAX_FORM_GENERATOR_LIMITATIONS.md` enumerates everything
   the preparer still has to fill in.
2. **MeF submission is a stub.** `submitViaMef` flips status +
   generates a synthetic submission ID. Real MeF wiring waits on
   IRS EFIN approval.
3. **No partial-PDF preview for doc comments.** The
   `page_number` anchor exists in the schema for future
   PDF-overlay UX; today the UI shows page-tagged comments as
   text-only.
4. **Plaid feed is read-only on the firm side.** Connecting +
   reconnecting still has to happen on the consumer surface
   (legal consent is recorded against the company owner).
5. **W-9 backup withholding** indicator is not wired to a 1099
   adjustment. Today the firm sees the W-9 data and the 1099
   generator emits without backup-withholding deduction.

## When to push back

If you spot one of these patterns, please block the PR:

- A new public surface that doesn't gate via `requireFirmContext`
  / `requireFirmAdmin` / `requireUser`. Auth helpers exist for a
  reason.
- A server action that doesn't validate the engagement/firm
  ownership before mutating. Pattern: load the row, check
  `firm_id === ctx.firm.id`, then mutate.
- A cron route that doesn't gate on `x-vercel-cron` header OR
  `Authorization: Bearer $CRON_SECRET`.
- A new column or table that captures personal financial info
  without RLS enabled.
- A migration that does NOT use `if not exists` / `do $$
  exception when duplicate_object then null; end $$` for
  idempotency.
