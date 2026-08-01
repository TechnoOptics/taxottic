# CSV import review: selection, duplicates, and per-file framing

Date: 2026-08-01

## What already exists

This feature is mostly built. The parts below are real and were read before
anything was designed:

| Piece | Where | State |
| --- | --- | --- |
| Multi-file upload, sequential | `components/CsvDropZone.tsx` | Works. Navigates to the LAST import when the queue finishes. |
| Per-import review screen | `app/c/[publicId]/import/[importId]/page.tsx` | Works. Month grouping, per-row category combobox, IRC/Pub citations, Bella rollup, "sorted awaiting Apply" pile, ignore, teach-a-rule, delete. |
| Row categorization | `lib/csv/auto-categorize.ts`, `lib/csv/bella-categorize.ts`, `lib/csv/categorization-rules.ts` | Works. Keyword pass, then saved rules, then Sonnet with a confidence threshold. |
| Row-level dedupe on ingest | `runCsvImport` in `app/c/[publicId]/import/actions.ts` | Works, but **silently drops** the duplicates before insert. |
| Exact-charge identity | `chargeFingerprint` in `lib/banking/subscription-dedupe.ts` | Reused, not reinvented. `date | cents | normalized-description`. |
| Money | `bank_transactions.amount_cents` is `bigint` | Integer cents throughout. No floats to fix in storage. |
| CSV parsing | `lib/csv/parse.ts` | Hand-rolled RFC-4180. No parsing library is a dependency. |

So this work **extends** the existing screen. It does not build a parallel one.

## Gaps this closes

1. **No selection model.** Today the user assigns a category per row and a
   single "Apply manually selected" button books every tagged row. There is no
   checkbox, no select-all, and no way to exclude one row from the batch
   without first un-categorizing it.
2. **No file-content duplicate detection.** The same statement re-exported
   under a different filename imports again in full.
3. **Duplicates are invisible.** Row duplicates are filtered out before insert
   and the user is never told. That is how a real expense disappears.
4. **The review screen is titled with the filename**, not with the period the
   statement covers, and a multi-file upload gives no sense of "file 2 of 4".

## Decisions, and where they differ from the request as relayed

**Checkboxes default to unchecked unless a human already picked the category.**
A row whose category came from Bella or from the keyword pass is listed,
pre-filled, and visibly ready, but not pre-selected. A row whose
`applied_category_code` was set by a person is pre-selected. The asymmetry is
deliberate: an unchecked row that should have been claimed is a missed
deduction the user can still see and fix on the same screen; a checked row that
should not have been claimed is a wrong number on a Schedule C. "Select all"
is the one-click path the owner asked for, and it stays one click.

**"Save as business expense" cannot apply to a row with no category.**
`monthly_expenses.category_code` is NOT NULL and `applyTransactions` already
skips uncategorized rows. Rather than let select-all silently skip them, rows
that cannot be saved are shown in their own state ("needs a category", "needs a
date") with the checkbox disabled and a reason. Nothing is skipped quietly.

**A CSV has no single date, so the title is a period.** The screen is titled
with the range the rows actually cover, derived from `min(posted_at)` and
`max(posted_at)`, with the filename demoted to a subtitle. When no date parses
the title reads "No dates in this file" and the screen explains that those rows
cannot be booked to a month, rather than inventing a date.

**Duplicate "avoidance" is not silent suppression.** Duplicate rows are still
kept out of the live transaction list, but they are now recorded and shown, with
the date, amount, description, and which earlier import already holds them.

## Architecture

Pure logic lives in `lib/` because `vitest.config.ts` only collects
`lib/**/*.test.ts`. Three new pure modules, one hardened existing one:

- `lib/csv/content-hash.ts`: content identity for a whole file. Normalizes BOM,
  line endings, trailing whitespace and trailing blank lines, then SHA-256. Two
  exports of the same statement that differ only in line endings hash the same,
  which is what makes rename-detection work.
- `lib/csv/duplicates.ts`: `partitionRows`. Splits incoming rows into fresh,
  duplicated within the same file, and duplicated against rows already in the
  books. Row identity is `chargeFingerprint`, reused from the Stripe/Plaid
  dedupe rather than invented a second time.
- `lib/csv/selection.ts`: `rowEligibility`, `defaultSelectedIds`, `summarize`.
  The checkbox rules and the running total, with no React in them.
- `lib/csv/parse.ts`: hardened: BOM stripping, integer-safe cents (no
  float multiply), trailing-minus and `CR`/`DR` suffixes, and a quote rule that
  only opens a quoted field at the start of a field.

Storage, all additive:

- `bank_imports.content_sha256 text` plus a lookup index on
  `(company_id, content_sha256)`.
- `bank_imports.period_start date`, `bank_imports.period_end date`.
- `bank_imports.batch_id uuid`, so a multi-file upload can be walked one file
  at a time.
- `bank_import_duplicates`, a new table recording every row held back as a
  duplicate and the import that already holds it.

## UI at 344px

The checkbox sits in a 44px square hit area, so nothing depends on hitting a
20px box with a thumb. The row itself is not a `<label>`: it already contains a
category combobox, an Ignore button and a teach-a-rule form, and wrapping those
in a label would make every one of them toggle the checkbox. The checkbox
carries an `aria-label` naming the merchant instead.

Rows are a stacked flex layout, never a table. Below `sm` the amount wraps to
its own line so the description keeps the full row width; the growing child
carries `min-w-0`, which is what stops it being squeezed into a
one-character column. A component test asserts at 344px that no element's
border box escapes the viewport and that no row is narrower than 240px.

The list is not given `content-visibility: auto`; it was measured on this
codebase at roughly three times worse scrolling because row heights vary. Rows
are memoized on their selected flag instead, so toggling one checkbox repaints
one row.

## Testing

Vitest over the pure modules: parsing traps (quoted commas and newlines, BOM,
CRLF, parenthesised negatives, currency symbols, thousands separators, trailing
minus, unparseable amounts), duplicate partitioning in both directions, content
hash stability across cosmetic differences, and the checkbox defaults including
the "never pre-select a machine guess" rule.
