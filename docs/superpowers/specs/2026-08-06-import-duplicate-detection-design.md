# Import duplicate detection: make suppression visible

Status: implemented, fix round 2 (2026-08-06). Second of three sequenced
import specs (sign convention, **this**, then completion). This document
was rewritten after two review rounds; see "What changed since the first
draft" at the end for what the original premise got wrong.

## Why

Re-importing the same CSV does **not** double a user's expenses.
`runCsvImport` already contains an exact-charge dedupe that drops any row
matching something already in `bank_transactions` for the company (see
`splitAlreadyBookedCharges` in `lib/csv/duplicates.ts`), so a re-import
inserts nothing new. That part already worked before this spec existed.

The actual bug is that the drop is **silent**. A user who re-uploads
"activity (7).csv" lands on a review page whose header still reflected
the file's row count with no acknowledgment that the rows were already
there, sitting above an empty or near-empty candidate list. No error, no
warning, nothing explaining why nothing showed up. `bank_import_duplicates`
existed to record exactly this and was never wired up, so the silence
persisted even though the table for ending it was sitting right there.

## What already exists, and does nothing

`public.bank_import_duplicates` was created by
`20260801224316_csv_import_review.sql` with a schema that is exactly
right for this:

```
import_id, company_id, posted_at, description, amount_cents,
fingerprint, kind check (kind in ('within_file','already_booked')),
existing_transaction_id, existing_import_id, created_at
```

**No code references it.** Zero reads, zero writes. The data model was
designed and never wired up.

This is the third instance of that pattern found in this codebase: the
watch app (12 Swift files, no target in `project.pbxproj`), the device
status plugin (compiled to nothing for weeks), and now this. Worth noting
because it means "the table exists" has repeatedly not meant "the feature
exists" here.

The schema is adopted as-is. The `kind` split it already encodes (duplicates within one file versus
against rows already booked) is the right one.

## The rule that matters most

**Within-file duplicates are flagged, never auto-removed. Already-booked
duplicates are auto-removed by a different, pre-existing mechanism this
spec does not change, and this feature's job is to make that removal
visible, not to decide it.**

Those are two different rules for two different situations, and
conflating them was the first draft's mistake:

- `within_file`: two rows in the SAME upload with the same fingerprint
  (see Fingerprint below). Both get inserted into `bank_transactions`
  today; nothing removes either of them. The example that matters here
  is real: two `DELTA AIR LINES ATLANTA` rows, **$11,684.63 each, both
  2026-07-07**, from the import that prompted this work. Two identical
  Delta charges on one day is an ordinary way to buy two tickets, so
  auto-suppression would delete a real $11,684.63 deduction and leave no
  trace that it had. For this case, detection produces a question for
  the user (a marker plus "Ignore this row"), never a decision. This is
  deliberately the opposite posture from `net-refunds.ts`, which nets
  charge/refund pairs automatically: an unnetted refund overstates a
  deduction, while a wrongly-suppressed duplicate understates one and is
  invisible. Different risk, different default.

- `already_booked`: a row whose exact charge (day-precision date, exact
  cents, normalized description) already exists in the company's
  `bank_transactions`. `runCsvImport`'s exact-charge dedupe drops this row
  before insert, and it has always done this, independent of this spec.
  This feature does not add a second opinion about whether to drop it
  (an earlier draft of this file did, by re-deriving "already booked"
  with a different normalizer than the dedupe used, which let the two
  disagree). It reads the dedupe's own decision
  (`splitAlreadyBookedCharges`) and writes a record of every row it
  dropped, with a link to the real transaction it matched. The
  suppression already happened; this makes it visible instead of silent.

## Fingerprint

Two identities, used for two different purposes, and NOT the same
function. This was a source of real defects in the first draft and is
worth stating plainly: do not assume they ever agree.

**Within-file matching** (`fingerprintRow` in `lib/csv/duplicates.ts`):

```
normalizeMerchant(description) | posted_at | amount_cents
```

`normalizeMerchant` uppercases, collapses whitespace, and keeps the first
three whitespace-separated tokens: the same normalization
`net-refunds.ts` already uses, and for the same reason: one statement
renders `DELTA AIR LINES` and another `DELTA AIR LINES ATLANTA`, and a
fixed-length prefix fails to match them while three tokens does. Reusing
that function keeps `net-refunds.ts` and within-file matching from
disagreeing about what counts as the same merchant.

**Already-booked matching** (`chargeFingerprint` in
`lib/banking/subscription-dedupe.ts`, already existed before this spec):

```
posted_at (day precision) | amount_cents | normalizeDesc(description)
```

`normalizeDesc` lowercases, turns non-alphanumeric runs into spaces, and
truncates at 40 characters. This is not `normalizeMerchant`, and the two
disagree on punctuation: `"SAM'S CLUB 6311 SHAKOPEE"` and `"SAM S CLUB
6311 SHAKOPEE"` fingerprint identically under `normalizeDesc` and
differently under `normalizeMerchant`. The first draft of this feature
matched already-booked rows with `normalizeMerchant` anyway, independent
of the dedupe, and that let the flagged set and the actually-suppressed
set diverge. The fix was not to reconcile the two normalizers (out of
scope, and not needed): `splitAlreadyBookedCharges` uses
`chargeFingerprint`, the SAME call the dedupe uses to decide what to
drop, so the already-booked findings are the dedupe's own decision, not
a second opinion on it.

For both identities: all parts are load-bearing (merchant alone
collapses a month of Sam's Club runs, date alone collapses a busy day,
amount alone collapses every $20 subscription), and a row with no
`posted_at` or an unparseable amount is never fingerprinted and never
flagged. Silence is correct there; a fabricated match is not.

### On "same item"

CSV exports carry a merchant and a total. There are no line items. Two
$45 Walmart charges on one day are indistinguishable in the data whether
they are one duplicate or two genuine trips. Merchant, date and exact
amount is the strongest available signal, and the user is the only one
who can settle the remainder, which is another reason the output is a
question.

## Detection

Runs once at upload, before Bella, in two places rather than one pass,
because the two kinds answer different questions at different points in
`runCsvImport`:

**`already_booked`**: computed at the exact-charge dedupe site, BEFORE
insert, by `splitAlreadyBookedCharges`. This is not a lookup this
feature invented: `runCsvImport` has always queried the company's prior
`bank_transactions` in the parsed rows' date range and dropped exact
matches before insert. That query does not filter on
`applied_expense_id` or `applied_income_id`, and never has, it matches
ANY prior row for the company in range, booked or not. An earlier draft
of this spec said "committed rows only"; that described a filter the
dedupe has never applied, and adding it to the pure matcher would have
made the flagged set disagree with what actually gets dropped, exactly
the bug fix round 1 corrected. `splitAlreadyBookedCharges` reproduces
the dedupe's real behavior: it partitions rows into "keep" (insert) and
"drop" (already booked), and every dropped row becomes a
`bank_import_duplicates` record with the real `existing_transaction_id`
/ `existing_import_id` of the row it matched. There is no separate
query to exclude the current import: this runs before the current
import's rows exist in `bank_transactions`, so there is nothing to
exclude.

**`within_file`**: computed AFTER insert, by `findWithinFileDuplicates`,
over the rows that survived the drop above (`toInsert`) and actually
landed in `bank_transactions`. Group by the `normalizeMerchant`
fingerprint; any group larger than one produces a record per row beyond
the first. Both `within_file` and `already_booked` findings are deduped
by source row (`dedupeFindings`) and written together in one call to
`detectDuplicates`, immediately after insert and before Bella runs.

Scoped by `company_id`: the exact-charge dedupe's query has always
scoped its lookup with `.eq("company_id", companyId)`, and
`splitAlreadyBookedCharges` trusts that scoping rather than re-checking
it (`ExistingChargeRow` carries no `company_id` field to check against).
That is a caller responsibility, not a pure-layer guarantee: the single
existing caller (`runCsvImport`) scopes correctly, and a second caller
would need to scope its own query the same way, since nothing in the
matcher itself would catch a caller that forgot to.

## Interface

`within_file` and `already_booked` render differently, because they
describe different rows: one exists in `bank_transactions` and one does
not.

A `within_file` row IS inserted (both copies are; nothing here removes
either one), so it renders inline in the candidate list with a marker,
a plain sentence, and a real row-level action:

> Looks identical to another row in this file: same merchant, same
> date, same amount. **Ignore this row**

`Ignore this row` is the existing `ignoreTx` action against that row's
real `bank_transactions.id`, no new write path.

An `already_booked` row was DROPPED before insert and has no
`bank_transactions.id` to act on. An earlier draft of this component
required one anyway (posting a nonexistent id to `ignoreTx`), which
meant its primary case could not render. It is informational only, no
form, just a link:

> SAMS CLUB #4471 · $206.47 · 2026-07-01: not added, identical to a row
> already booked. **View it**

`View it` deep-links to the real transaction
(`/c/{publicId}/import/{existingImportId}?highlight={existingTransactionId}`).

When an upload drops rows this way, a summary sits above the whole
candidate list, above the header count too, since it is the first thing
that should explain an otherwise-confusing page:

> **62 rows in the file, 0 added, 62 already imported**
> Every row in this upload matched a transaction already in your
> books, so nothing new was added. Review the list below, or delete
> this import if it was uploaded in error.

That is the case worth designing for: the user who uploads the same sheet
twice should meet one clear explanation, not an empty list with no
context, and not sixty-two separate warnings either.

Duplicate status never blocks applying. The user may have a genuine
reason, and a blocked apply with no override is how the sign-convention
bug trapped sixty rows.

## Components

All in `lib/csv/duplicates.ts` unless noted.

| Function | Purity |
| --- | --- |
| `fingerprintRow(row)` | pure. Within-file matching only; see Fingerprint above |
| `findWithinFileDuplicates(rows)` | pure |
| `splitAlreadyBookedCharges(companyId, rows, existing)` | pure, reproduces the exact-charge dedupe's own decision (`chargeFingerprint`, from `lib/banking/subscription-dedupe.ts`); does not query |
| `dedupeFindings(findings)` | pure, collapses two findings for the same source row into one before writing |
| `detectDuplicates(admin, importId, findings)` | the only impure piece: dedupes and writes already-computed findings, batched at 500 rows (mirrors the adjacent `bank_transactions` insert) |

`findAlreadyBookedDuplicates`, named in the first draft of this spec,
does not exist: it matched with `fingerprintRow` independent of the
dedupe and was deleted in fix round 1 in favor of
`splitAlreadyBookedCharges`, which reads the dedupe's decision instead
of re-deriving one.

The query that used to live inside `detectDuplicates` moved to the
caller (`runCsvImport`), because that caller already has to run the
exact-charge dedupe's query for its own purposes; a second, separate
query inside `detectDuplicates` would have re-created the divergence
risk `splitAlreadyBookedCharges` exists to close. The matching logic
stays pure and is tested exhaustively without a database. Same
reasoning as `planFlip` in the sign-convention spec, and the same
reason: on 2026-08-06 five defects in one evening all lived in caller
code around correct pure functions.

## Errors

Detection failing must never fail an upload. The rows are already parsed
and stored; a missing duplicate flag is a degraded upload, not a broken
one. Wrapped, logged, and the import proceeds with no duplicate records,
which reads as "none found", the same as a clean file.

That ambiguity is accepted deliberately rather than adding a
`duplicate_scan_failed` state to a table this spec does not otherwise
need to change.

## Testing

All in `lib/csv/duplicates.test.ts` (21 tests) unless noted. Fixtures
live in `lib/csv/fixtures/import-62-row.ts` and are shaped like the real
import that prompted this work; the descriptions and dates in them were
invented for this branch, not read from the real file.

| Target | Cases |
| --- | --- |
| `fingerprintRow` | `DELTA AIR LINES` vs `DELTA AIR LINES ATLANTA` match; null date and unparseable amount produce no fingerprint |
| `findWithinFileDuplicates` | the two Delta rows pair; three Anthropic rows across two dates do **not** pair; the second and third of three identical rows are both flagged |
| `findWithinFileDuplicates` over `ADVERSARIAL_DUPLICATE_ROWS` | the over-eagerness guard. `LIVE_IMPORT_ROWS` gives every row a unique `amount_cents` by construction, so a guard test built only from it cannot fail even with a broken merchant key: amount alone always disambiguates. This fixture adds a pair engineered to actually depend on `MERCHANT_KEY_TOKENS` (two different merchants, same date, same amount, same first token) plus the Launchpad Golf and Anthropic cases from the spec. Verified by mutation: setting `MERCHANT_KEY_TOKENS` to 1 makes exactly this test fail (1 of 844 in the full suite as of fix round 2), confirming it is a real guard, not a test that cannot fail |
| `splitAlreadyBookedCharges` | matches an existing charge and drops the row from `keptIndexes`; keeps a row with no match; always keeps a row with no `posted_at`; does NOT require the existing row to be applied to an expense or income (reproducing the dedupe's real, filter-free behavior); partitions a mixed batch correctly |
| `dedupeFindings` | collapses two findings for the same row into one; prefers `already_booked` over `within_file` on a collision; order-independent; leaves distinct rows untouched even with identical content |
| Fixture | the 62-row fixture, scanned once (nothing dropped yet), flags only the Delta pair as `within_file` and nothing else |
| Fixture | the same fixture, matched against an "everything already sitting in `bank_transactions`" existing set, drops all 62 as `already_booked` |

The adversarial-fixture case is the guard against over-eagerness, which
is the failure mode that costs money here, and it is the one entry in
this table proven to fail on a real regression rather than merely
passing today.

## What changed since the first draft

The first draft of this spec (2026-08-06, before implementation) got
its central premise wrong: it said re-importing a CSV silently doubles
a user's expenses. It does not, and never did once
`runCsvImport`'s exact-charge dedupe existed. What actually happens on
a re-import is that the dedupe correctly drops every matching row, and
does so silently, which is a different bug with a different fix: make
the drop visible, not stop it from happening.

That premise error produced a real implementation defect in round 1:
the first version of this feature matched "already booked" rows with
its own fingerprint (`fingerprintRow` / `normalizeMerchant`), computed
independently of the exact-charge dedupe's own fingerprint
(`chargeFingerprint` / `normalizeDesc`). The two normalizers disagree on
punctuation, so a row the dedupe actually dropped could go unflagged,
and the reverse could also happen. Fix round 1 replaced that matcher
with `splitAlreadyBookedCharges`, which reads the dedupe's own decision
instead of re-deriving one, so the flagged set and the suppressed set
cannot diverge.

Fix round 2 corrected two remaining gaps: an already-booked row has no
`bank_transactions.id` (it was never inserted), so the review-page
component that assumed one for `ignoreTx` could not render its primary
case; it is now a discriminated union that makes that state impossible
to construct. And the table this whole feature exists for had exactly
one write and zero reads, so nothing a user could see had changed; the
review page now reads it and renders the summary and the header count
described in Interface above.
