# Finishing an import: a Complete step, and a counter that tells the truth

Status: designed, not implemented. Third of three sequenced import specs
(sign convention, duplicate detection, **this**).

## What was asked for, and what turned out to already work

The request: when everything is applied and allocated there should be a
Complete step; it should clear the import from the list and from the
notifications section, and flow the changes into the forecast and
everywhere else.

Two thirds of that already happen, and the design is smaller for it.

**Notifications already self-clear.** `lib/tasks/outstanding.ts` derives
its items live from `bank_transactions` rows that are neither applied nor
ignored. It is a query, not a flag anyone has to remember to clear. The
last row resolved empties the section on the next render. No new
mechanism needed, and adding a flag would introduce a way for the two to
disagree.

**The forecast already updates.** Applying a row writes a real
`monthly_expenses` record, and the forecast reads that table. Verified on
the live import: 48 booked rows resolve to 48 existing expenses totalling
$26,456.40 across June and July, with zero dangling references. Applying
*is* the forecast update; there is nothing to propagate at the end.

So Complete is not plumbing. It is a confirmation step, an honest
resting state, and it exposes one real bug.

## The bug: `applied_count` lies

`bank_imports.applied_count` on the live import reads **0** while 48 rows
are booked. The import list renders this directly: *"62 rows - 0
applied"*.

It is written by `applyTransactions` and by `bellaAutoApply`, but not by
the upload-time auto-categorize path that booked most of these rows. It
has been drifting since.

Any completion check built on that counter inherits the lie. So:

**Completion is computed, never stored as a counter.** An import is
complete when no row is unresolved, every row is applied as an expense,
applied as income, or ignored.

`applied_count` is kept as a display value but **derived on read** from
the transactions themselves, not maintained incrementally. A counter that
can drift from its own source of truth is worth less than the query it
replaces, and this table is small enough that the query is free.

## Model

`bank_imports.status` gains `complete`, alongside the existing
`reviewing` and `applied`.

```
completed_at timestamptz
completed_by uuid references profiles(id)
```

`status = 'complete'` is a user assertion, not a derived fact. The
derived fact is "no unresolved rows"; Complete records that a human saw
that and agreed.

## Interface

When an import has no unresolved rows, the review page shows a single
action:

> All 62 rows are sorted. **Complete import**

It moves to a collapsed **Completed** section of the import list, out of
the active list. Reversible: reopening is a status change, since nothing
was destroyed.

The button appears only when the import is genuinely finished. A Complete
that is available while rows remain would be a way to lose work, and the
import list is already where the sign-convention bug hid sixty rows.

### Not "Commit"

Rows are written as they are applied. Nothing waits for a final step.
Calling this Commit would imply the work was held in escrow until the
end, which is false, and a user who believed it might reasonably think
abandoning an import discards it. It does not.

## Interaction with the other two specs

**Sign convention.** Flipping the convention on a completed import is
allowed. It runs the same `planFlip`, and the booked rows land in the
same review list. Completion is not a lock; discovering a mis-signed file
after finishing it is precisely the case that must stay recoverable.

**Duplicates.** Duplicate flags do not block completion. A flagged row
still ends up applied or ignored, and either resolves it. Flags are
advisory throughout.

## Components

| Function | Purity |
| --- | --- |
| `summarizeImport(rows)` → `{ total, applied, ignored, income, unresolved, isComplete }` | pure |
| `completeImport(importId)` | server action: re-checks `isComplete` server-side, then writes status |

`summarizeImport` is the single definition of "resolved", used by the
list, the review page, the Complete button's enablement, and the
completion check inside the action. One definition, four consumers: the
alternative is four subtly different filters, which is how
`applied_count` drifted in the first place.

`completeImport` re-checks rather than trusting the client. A stale page
must not be able to complete an import that has gained an unresolved row.

## Errors

Completing an already-complete import is a no-op, not an error.

Completing an import with unresolved rows fails with a message naming the
count. It cannot happen through the UI, since the button is absent: the
guard is for stale tabs and direct posts.

Neither path touches `monthly_expenses`. Complete changes a status and
nothing else.

## Testing

| Target | Cases |
| --- | --- |
| `summarizeImport` | all applied; all ignored; mixed applied/ignored/income; one unresolved among 61; zero rows |
| `summarizeImport` | a row both `applied_expense_id` and `ignored` counts once, not twice |
| `completeImport` | rejects when unresolved rows exist; no-op when already complete |
| Fixture | the live import today: 62 rows, 48 booked, 1 income → `unresolved: 13`, `isComplete: false` |
| Regression | derived `applied` returns 48 where the stored `applied_count` says 0 |

That last row is the bug this spec exists to close, expressed as a test.
