# Batch selection: checkboxes, and a button that commits what you picked

Status: designed, not implemented. Fourth import spec. Sequenced after
sign convention (merged as PR #507, pending), duplicate detection, and
completion. It supersedes the Interface section of the completion spec,
because Complete and batch Apply are the same moment in the workflow.

## The report

"Each item imported should have a check box next to it so the user can do
batch editing, approval or applying. They should be able to select all or
deselect some and perform actions. There are no buttons that can be
clicked to commit the actions."

Verified against the live screen. There are **no checkboxes anywhere** in
the import UI (`grep 'type="checkbox"'` over
`app/c/[publicId]/import/` and `components/import/` returns nothing), and
the review page wires exactly three actions: `deleteImport`,
`bellaAutoApply`, `applyTransactions`. Everything else is per-row inside
`TxRow`: a category `<select>` that submits on change, an Ignore form,
and a Teach Bella form.

## The button that lies

There is one commit control and it reads **"Apply manually selected"**.
Nothing on the page can be selected. It applies every row that happens to
carry `applied_category_code`, which is not a selection, it is a residue
of having pressed Save on rows one at a time earlier.

It also renders only when `pendingApply.length > 0`. On the live import
that is **1 row**, so the entire commit affordance is a button for a
single transaction, while 13 rows sit above it displaying Bella's
suggested categories that look chosen and are not. `suggested_category_code`
and `applied_category_code` are different columns; only the second is
committable, and nothing on screen says so.

That gap is the whole report.

## Decisions

Asked and not answered, so these are rulings, recorded so they can be
reversed cheaply:

1. **One step.** A selected row carrying a category is booked by Apply.
   The Save-then-Apply two-step goes away. The confirmation happens once,
   on the batch, not once per row. The second look the old flow bought
   was never real: nobody re-reads 60 rows they already touched.
2. **Refunds are structurally unselectable.** Not greyed out on a whim,
   absent from the selection model entirely.
3. **Accepting a suggestion is its own action**, distinct from Apply.

Ruling 2 is the one that is not negotiable, and it is not hypothetical.
The live import has a `VERCEL -$0.84` refund still in candidates and a
`LOWE'S -$24.45` refund already booked as a deduction. A "select all,
Apply" that swept those in would commit precisely the error the sign
convention work exists to prevent, at speed and in bulk. Batch actions
multiply whatever the model gets wrong.

## Model

Selection is **client state only**. Nothing is persisted, no column, no
draft table. A selected row is a row the user is about to act on, and
that intent lives for the length of one interaction.

This matters because the alternative (a `selected` column) creates a
second source of truth about what the user meant, which is how
`applied_count` came to read 0 while 48 rows were booked.

### What can be selected

A row is selectable when `interpretAmount(amount, convention).direction`
is `expense` and it is not already booked. Everything else, refunds,
income, and rows already in `monthly_expenses`, has no checkbox at all.

Rendering a disabled checkbox on a refund invites "why can't I tick
this", and the honest answer belongs in the row, not in a tooltip on a
dead control. Refund rows carry a short label instead: `Refund, not
deductible`.

## Interface

A header row above the candidate list:

```
[ ] Select all 13        3 selected     [ Apply 3 ]  [ Ignore 3 ]
```

The header checkbox is tri-state: empty, indeterminate when some are
selected, checked when all are. "Select all" means all **selectable**
rows, which is the only thing it can honestly mean given refunds are
excluded.

The batch bar is only rendered when at least one row is selected. A bar
of disabled buttons is noise.

Separately, above it, a standing action when Bella has ungrafted
suggestions:

```
Bella suggested categories for 13 rows.  [ Accept all 13 ]
```

This is the button that clears the reported backlog in one press. It sets
`applied_category_code` from `suggested_category_code` and books in the
same action, consistent with ruling 1.

Keeping it separate from Apply preserves something worth preserving on a
tax record: whether a human ever agreed with the software. Bella's own
confidence threshold already decides what it books unattended; this is
the explicit accept of what it was not confident enough to book alone.

### Counts must be honest

Every count on this screen is derived from the rows on the page, never
from `bank_imports.applied_count`, which is currently wrong by 48 on the
live import. The completion spec makes that counter derived; this spec
depends on that and must not ship before it.

## Actions

| Action | Writes |
| --- | --- |
| `applySelected(importId, ids[], )` | `monthly_expenses` inserts plus `applied_expense_id` on each row |
| `ignoreSelected(importId, ids[])` | `ignored = true` |
| `acceptSuggestions(importId, ids[])` | copies `suggested_category_code` to `applied_category_code`, then books |

All three re-derive selectability server-side from the ids they are
given. **The client's selection is a request, not an authorization.** A
posted id that is a refund, is already booked, or belongs to another
company is dropped, and the action reports how many it dropped rather
than failing the batch.

A stale tab is the ordinary case here, not an attack: the user opens the
page, walks away, Bella's cron books four rows, they come back and press
Apply on a selection that includes them. Silently skipping is right;
failing the whole batch would be worse.

## Errors

A batch is **not atomic**, deliberately. Booking 40 rows where row 17
fails should keep the 39. The action returns
`{ applied, skipped, failed }` and the page states it plainly:
`Applied 39. Skipped 1 refund. 0 failed.`

An all-or-nothing transaction sounds safer and is not: it converts one
bad row into zero progress, on a screen whose entire complaint is that
progress is too slow.

## Components

| Function | Purity |
| --- | --- |
| `isSelectable(row, convention)` | pure |
| `summarizeSelection(rows, selectedIds, convention)` | pure, returns `{ selectable, selected, refunds, alreadyBooked }` |
| `partitionBatch(rows, postedIds, convention)` | pure, returns `{ actionable, skipped }` |
| `applySelected` / `ignoreSelected` / `acceptSuggestions` | server actions, thin over the above |

`partitionBatch` is the one that must be pure and exhaustively tested. It
decides which rows a batch touches, and a defect there books the wrong
rows in bulk.

The precedent is direct: on 2026-08-06 five defects in the sign
convention work all lived in caller code wrapping correct pure functions,
including one that made refund netting silently dead while 742 tests
passed. Batch actions raise the cost of that class of defect by the size
of the batch.

## Testing

| Target | Cases |
| --- | --- |
| `isSelectable` | expense yes; refund no; income no; already booked no; zero amount no; both conventions |
| `summarizeSelection` | select-all count excludes refunds; indeterminate state; empty selection |
| `partitionBatch` | a posted refund id is skipped not applied; an already-booked id is skipped; an id from another import is skipped; a valid id is actionable |
| Fixture | the real 62-row import: select-all offers 13, not 62 and not 15; the Vercel refund is absent from selectable |
| Component | Playwright CT: header checkbox tri-state, batch bar hidden at zero selection |

The fixture case is the regression. On that import, select-all must not
reach the two refunds or the 48 booked rows.

## Out of scope

**Batch re-categorization** (select 10 rows, set them all to Supplies).
The report mentions "batch editing", and it is a reasonable next step,
but it needs a category picker in the batch bar and a rule about what
happens to rows that already have a different category. Worth its own
pass once selection exists.

**Un-apply.** Still owed from the sign-convention spec, which promised a
booked-row review list with per-row and bulk un-apply and did not deliver
it. Batch selection makes it more obviously missing, since the natural
question after "select and apply" is "select and undo". Tracked there,
not here.
