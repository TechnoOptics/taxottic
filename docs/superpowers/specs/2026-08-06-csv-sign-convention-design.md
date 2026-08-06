# CSV sign conventions: stop stranding rows, and let a refund be a refund

Status: designed, not implemented. First of three sequenced import specs
(this, then duplicate detection, then completion).

## The failure this comes from

A real import, 2026-08-01, 62 rows, uploaded as `business_checking`. The
file used the opposite convention to the one the app assumed: charges
positive, refunds negative.

| | |
| --- | --- |
| Rows with `amount_cents < 0` | 2 (a Vercel credit, a Lowe's return) |
| Rows with `amount_cents > 0` | 60 (Delta, Target, Sam's Club, Canva, Anthropic, Lowe's) |

The review page builds its expense-candidate list as `amount_cents < 0`
for every account type except `credit`. So the page offered two refunds
for categorization and hid sixty real expenses. The user's report was
"the app does not allow you to manually allocate the imported expenses".
The category picker was never broken: the rows simply never reached it.

There was no way to correct this after upload. Not a control, not a
setting, not a documented workaround. It was resolved by an operator
running a service-role `PATCH` to set `account_type = 'credit'`.

Two defects, then. The parser cannot tell which convention a file uses,
and nothing downstream can be told it guessed wrong.

## Decisions taken

1. **Auto-detect, state the verdict, allow a flip.** No new question at
   upload. The review page says which way it read the file, and one
   control changes it.
2. **Sign always carries meaning.** `account_type = 'credit'` currently
   means "every row is an expense regardless of sign", which is why a
   $24.45 Lowe's *return* was booked as a $24.45 deduction. That rule is
   retired.
3. **Never rewrite stored amounts.** The convention is recorded per
   import and applied at read time.
4. **A flip never restates a booked expense.** It re-reads what is
   uncommitted and surfaces what is committed for an explicit decision.

Decisions 2 and 3 look contradictory and are not. "Normalize" happens in
a single interpretation function, not by mutating rows. The guarantee is
identical; the blast radius is not.

## Model

### `bank_imports.sign_convention`

`text not null default 'charges_negative'`, checked against
`('charges_negative', 'charges_positive')`. Alongside it:

- `sign_convention_source text` is `detected` or `user`
- `sign_convention_confidence numeric(3,2)` is 0..1, from the detector
- `sign_convention_set_at timestamptz`

`source` exists because the first question anyone asks of a wrong number
months later is whether a human chose this or the software guessed.

Default is `charges_negative` because that is exactly today's behaviour,
so every existing import keeps its current interpretation with no
migration of amounts and no restatement.

### `account_type` stops deciding signs

It stays on the table. It still feeds the card-payment skip heuristic
(`looksLikeCardPayment`), which is a genuinely different concern. It no
longer answers "is this row an expense".

This is what makes a refund representable at all. It also lets
`lib/csv/net-refunds.ts`, which already pairs a charge to a refund by
matching *opposite signs*, and which `credit` imports could therefore
never trigger, work on card statements for the first time.

## Components

Three pure functions. Everything else calls them.

### `detectSignConvention(rows) => { convention, confidence }`

**The majority sign is charges.** People make far more purchases than
they receive deposits, on chequing accounts and cards alike. 60 positive
to 2 negative gives `charges_positive`. A typical chequing export, mostly
negative purchases with a few deposits, gives `charges_negative`.

Confidence is the majority share, so 60/62 is 0.97 and 12/22 is 0.55.

Falls back to `charges_negative` at low confidence when the split is near
even, when fewer than 8 rows carry a non-zero amount, or on any anomaly
(no rows, nothing parseable, every amount zero). A five-row file split
three to two proves nothing, and a confident wrong guess is worse than an
honest default. The detector never throws.

Deliberately excluded: merchant-name heuristics ("Target is probably an
expense"). The majority rule already handles the observed failure, and a
merchant list is upkeep that fails on precisely the unusual files where
help would matter.

### `interpretAmount(amountCents, convention) => { direction, magnitudeCents }`

`direction` is `expense`, `refund`, or `income`. Under
`charges_positive`, a positive amount is an expense and a negative one a
refund; under `charges_negative`, the reverse. `magnitudeCents` is always
positive, so no caller does sign arithmetic.

An unrecognised convention returns `charges_negative` behaviour rather
than throwing. A bad enum must never be able to blank the review page.
(Same lesson as `profiles.workspace_mode` on 2026-08-06: a stored
preference must not be able to break the surface that reads it.)

### `planFlip(rows, from, to) => { reinterpret, clearTag, needsReview }`

The consequential one, and the reason it is pure.

- `reinterpret`: untouched rows, nothing to do but read them differently
- `clearTag`: rows carrying `applied_category_code` but no
  `applied_expense_id` whose direction changes. A row flipping from
  expense to refund makes a "Supplies" pick meaningless, so the tag is
  cleared and the row returns to the candidate list.
- `needsReview`: rows with `applied_expense_id`. **Never modified.**
  Returned so the UI can list them.

Rows whose direction does not change are untouched in all three cases.

## Callers

Every consumer routes through `interpretAmount`, replacing its own
sign test:

| Site | Today |
| --- | --- |
| `app/c/[publicId]/import/[importId]/page.tsx` | `isCredit ? amount !== 0 : amount < 0` |
| `bellaAutoApply` | derives `isCredit` from `account_type` |
| `applyTransactions` | same |
| `lib/csv/net-refunds.ts` | pairs opposite signs (works once signs mean something) |
| `app/api/watch/confirm/route.ts` | mirrors `setTxCategory` |

## Flow

**Upload.** Parse rows, run the detector, store convention, source
`detected`, and confidence. Amounts are stored exactly as parsed.

**Review.** The page states the reading in one line: "Read as: charges
are the positive amounts. Not right? Flip." Below
`SIGN_CONFIDENCE_BANNER = 0.75` it renders as a banner that cannot be
scrolled past rather than a quiet line. That threshold is the only use of
the confidence value.

**Flip.** `setSignConvention(importId, convention)`, a server action
under the same authorization as the other import actions. Writes the
convention, sets source `user`, applies `planFlip`: clears the tags it
returns, leaves booked rows alone, and renders `needsReview` as *"N rows
were applied under the previous reading"* with per-row and bulk
**Un-apply**.

Flipping to the value already stored is a no-op, not a churn of cleared
tags.

**Nothing enters or leaves `monthly_expenses` without an explicit
click.** That table is a filed-deduction surface. An automatic
restatement there is the one behaviour this design refuses to build.

## Testing

Four caller-side defects shipped on 2026-08-06 (`notified_at` written for
an undelivered push, a `NOT NULL` violation, `Date.parse(null)`, a
clobbered `escalated_at`). Every one sat in route code wrapping a correct,
well-tested pure function. Hence three pure functions here, and hence the
emphasis below on `planFlip`.

| Target | Cases |
| --- | --- |
| `detectSignConvention` | 60/2, 2/60, near-even, 3 rows, all-positive, all-negative, all-zero, unparseable |
| `interpretAmount` | both conventions × positive / negative / zero, plus the unknown-convention fallback |
| `planFlip` | booked, tagged-and-direction-changed, tagged-and-unchanged, untouched, no-op flip |
| Fixture | the real 62-row file: detects `charges_positive` at ≥0.95, yields 62 expense candidates, and `planFlip` puts all 48 booked rows in `needsReview` and none in `clearTag` |

The fixture is the point. A real failing import outranks any synthetic
case, and this one is the regression.

## Out of scope

**Two-column Debit/Credit CSVs.** `sniffColumns` does
`find("amount", "debit", "credit")` and selects a single column, so a file
with separate Debit and Credit columns is misparsed today, independent of
this work. Real bug, named rather than folded in. Its own fix.

**Backfilling amounts.** Stored amounts are never rewritten, for any
import, ever.

## Migration: the one case a default would break

Existing imports with `account_type != 'credit'` take the
`charges_negative` default, which is exactly how they are read today.
Nothing changes for them.

Imports with **`account_type = 'credit'` cannot take that default.** They
are currently read as "every row is an expense, ignore the sign". Once
`account_type` stops deciding signs, defaulting them to
`charges_negative` would reinterpret every positive charge as income and
empty their candidate list, reintroducing the exact bug this spec
exists to fix, on the imports someone already worked around it on.

The live import is one of these. It was set to `credit` on 2026-08-06 to
unstrand its 60 positive charges. A naive default would re-strand them.

So the migration **runs the detector once over each `credit` import's
stored rows** and sets the convention from the result, with source
`detected`. Metadata only; no amount is touched. For the live import the
detector returns `charges_positive` at 0.97, which preserves its current
reading.

`account_type` itself is left alone. It is still used by the card-payment
skip heuristic.

## Known consequence: refunds already booked as expenses

Under `credit`, negative rows were booked as expenses. The live import has
two: a $24.45 Lowe's return, already applied as Supplies, and a $0.84
Vercel credit still in candidates. About $25 of overstated deduction.

Once signs mean something these are correctly typed as refunds, but this
spec does **not** retroactively un-apply them, that is a restatement of
`monthly_expenses`, which requires the explicit un-apply flow. After
migration they appear in the booked-row review list, which is where a
human decides.
