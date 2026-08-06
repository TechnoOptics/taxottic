# Import duplicate detection: surface, never suppress

Status: designed, not implemented. Second of three sequenced import specs
(sign convention, **this**, then completion).

## Why

Re-importing the same CSV silently doubles expenses. Nothing today
detects it. A user who uploads "activity (7).csv" twice gets two copies
of every charge, and the only symptom is a forecast that is quietly
wrong. No error, no warning, no row to notice.

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

**Duplicates are flagged, never auto-removed.**

The real import that prompted this work contains:

- two `DELTA AIR LINES ATLANTA` rows, **$11,684.63 each, both 2026-07-07**
- three `ANTHROPIC` rows at $20.00 across 2026-07-11 and 07-12
- two `LAUNCHPAD GOLF` rows on 2026-06-22

Every one of those may be legitimate. Two identical Delta charges on one
day is an ordinary way to buy two tickets. Auto-suppression would delete a
real $11,684.63 deduction and leave no trace that it had.

So detection produces a **question for the user**, never a decision. This
is deliberately the opposite posture from `net-refunds.ts`, which nets
charge/refund pairs automatically: an unnetted refund overstates a
deduction, while a wrongly-suppressed duplicate understates one and is
invisible. Different risk, different default.

## Fingerprint

```
normalizeMerchant(description) | posted_at | amount_cents
```

`normalizeMerchant` uppercases, collapses whitespace, and keeps the first
three whitespace-separated tokens: the same normalization
`net-refunds.ts` already uses, and for the same reason: one statement
renders `DELTA AIR LINES` and another `DELTA AIR LINES ATLANTA`, and a
fixed-length prefix fails to match them while three tokens does.

Reusing that function keeps two features from disagreeing about what
counts as the same merchant.

All three parts are load-bearing: merchant alone collapses a month of
Sam's Club runs, date alone collapses a busy day, amount alone collapses
every $20 subscription.

A row with no `posted_at` or an unparseable amount is never fingerprinted
and never flagged. Silence is correct there; a fabricated match is not.

### On "same item"

CSV exports carry a merchant and a total. There are no line items. Two
$45 Walmart charges on one day are indistinguishable in the data whether
they are one duplicate or two genuine trips. Merchant, date and exact
amount is the strongest available signal, and the user is the only one
who can settle the remainder, which is another reason the output is a
question.

## Detection

Runs once at upload, after parsing, before Bella. Two passes:

**`within_file`**: group parsed rows by fingerprint; any group larger
than one produces a record per row beyond the first.

**`already_booked`**: look up each fingerprint against the company's
existing `bank_transactions` where `applied_expense_id is not null` or
`applied_income_id is not null`, excluding this import. Committed rows
only: matching against another still-under-review import would flag rows
the user has not acted on and may yet ignore.

Both write to `bank_import_duplicates` with the matching
`existing_transaction_id` and `existing_import_id`, so the review UI can
link to the original rather than merely assert one exists.

Scoped by `company_id` throughout. A duplicate is a duplicate within one
company's books, and cross-tenant matching would be a data leak.

## Interface

A duplicate-flagged row renders inline in the candidate list with a
marker and a plain sentence:

> Looks identical to a row you booked on 2026-07-07, same merchant,
> same date, same amount. **View it** · **Ignore this row**

`View it` deep-links to the original transaction. `Ignore this row` is
the existing `ignoreTx` action, no new write path.

When a whole upload is a re-import, a summary sits above the list:

> **58 of 62 rows look like duplicates** of an import from 1 August.
> Review before applying, or delete this import.

That is the case worth designing for: the user who uploads the same sheet
twice should meet one clear sentence, not fifty-eight separate warnings.

Duplicate status never blocks applying. The user may have a genuine
reason, and a blocked apply with no override is how the sign-convention
bug trapped sixty rows.

## Components

| Function | Purity |
| --- | --- |
| `fingerprintRow(row)` | pure |
| `findWithinFileDuplicates(rows)` | pure |
| `findAlreadyBookedDuplicates(rows, existing)` | pure, takes the existing rows, does not query |
| `detectDuplicates(admin, importId, rows)` | the only impure piece: queries, then delegates, then writes |

The query is separated from the matching so the matching can be tested
exhaustively without a database. Same reasoning as `planFlip` in the
sign-convention spec, and the same reason: on 2026-08-06 four defects in
one evening all lived in caller code around correct pure functions.

## Errors

Detection failing must never fail an upload. The rows are already parsed
and stored; a missing duplicate flag is a degraded upload, not a broken
one. Wrapped, logged, and the import proceeds with no duplicate records,
which reads as "none found", the same as a clean file.

That ambiguity is accepted deliberately rather than adding a
`duplicate_scan_failed` state to a table this spec does not otherwise
need to change.

## Testing

| Target | Cases |
| --- | --- |
| `fingerprintRow` | `DELTA AIR LINES` vs `DELTA AIR LINES ATLANTA` match; null date and unparseable amount produce no fingerprint |
| `findWithinFileDuplicates` | the two Delta rows pair; three Anthropic rows across two dates do **not** pair; the second and third of three identical rows are both flagged |
| `findAlreadyBookedDuplicates` | matches booked only; ignores rows still under review; never crosses `company_id` |
| Fixture | the real 62-row file re-imported against itself flags all 62 as `already_booked` |
| Fixture | that same file scanned once flags the Delta pair as `within_file` and nothing else |

The second fixture is the guard against over-eagerness, which is the
failure mode that costs money here.
