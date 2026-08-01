# Team mileage view: the manager default

Owner request (verbatim, 2026-08-01):

> "By default, for the company admin, please show every users drives and code
> them different colors, do not show the other users personal miles. only
> business."

## What already existed

`/mileage` already had most of the machinery, added alongside the
`DriverPicker`:

- `?driver=all` renders a read-only team overlay (`viewingAll`).
- The overlay already ran two scoped queries: the viewer's own trips (all
  classifications) plus teammates' trips filtered to `classification =
  'business'`.
- `MileageMap` already assigned one colour per driver when 2+ drivers are on
  the map, with a legend.

So this is not a new feature. It is four gaps against the request.

## The four gaps

1. **It was not the default.** A manager landing on `/mileage` saw only their
   own drives. `?driver=all` was opt-in through the picker. The owner asked for
   "by default".
2. **Unconfirmed drives leaked.** `needs_confirmation = true` means the
   classifier had *no evidence* and applied a blanket "business" default
   (migration `20260801000000_mileage_needs_confirmation.sql`). Those rows
   passed the `classification = 'business'` filter, so a teammate's personal
   drive that had merely not been corrected yet was shown to the manager,
   route and all.
3. **Colour identification relied on hue alone.** The 12-hue palette was not
   colour-blind safe and had no redundant channel.
4. **The manager lost their own triage tools by default.** The overlay hides
   the trip list, the classify banner and the manual-log forms. Making it the
   default would silently remove the manager's own workflow.

## Decisions on the ambiguities

### Does the admin see their OWN personal drives here?

**Yes.** Two reasons, both from existing behaviour rather than preference:

- The single-driver path already reads
  `if (!viewingSelf) tripQuery = tripQuery.eq("classification", "business")`:
  the business-only restriction is explicitly scoped to *other people*.
- The whole page is the viewer's own triage surface: the unclassified banner,
  the deduction total and the reclassify controls all operate on the viewer's
  own drives. Hiding the viewer's own personal drives would break triage and
  would misreport their own totals.

Privacy here protects colleagues from the manager, not the manager from
themselves.

### What is "company admin"?

`company_members.role = 'manager'`, the existing role model. Confirmed the same
notion is used by `lib/mileage/reclassify.ts` (`mem?.role === "manager"`),
`lib/tax/company-context.ts` and the `is_company_manager(company_id)` predicate
that backs the `mileage_trips manager + firm read` RLS policy.

`lead` is deliberately **not** included. A department lead's visibility is
scoped to their own department; granting them a whole-company drive map would
be inventing a new notion of admin, which the brief rules out.

### Should another driver's unconfirmed drive be visible?

**No.** Excluded at the query level.

`needs_confirmation = true` is the system saying "no evidence supports this
call". The same migration writes `deduction_cents = 0` on those rows precisely
because the product does not trust the label. A drive the product will not
count as a deduction is not a drive it should publish to a colleague. In a
company with no saved `mileage_places` (which the migration notes is three of
the four production companies), *every* auto-classified drive takes the blanket
default, so without this filter the "business only" promise would be close to
meaningless.

The viewer's own unconfirmed drives stay visible: that is their triage queue.

## Design

### Privacy filter

Extracted out of the page and into `lib/mileage/team-scope.ts` so it is a real
unit under test rather than inline server-component code.

```
scope "self"  → company_id, driver_user_id = viewer, started_at >= since
scope "other" → company_id, driver_user_id = target, started_at >= since,
                classification = 'business',
                NOT (needs_confirmation IS TRUE)
scope "team"  → the "self" query UNION the "other" query with
                driver_user_id <> viewer
```

`NOT (needs_confirmation IS TRUE)` rather than `!= true`: the column is
nullable and `NULL` means "not flagged", so a `neq` comparison would silently
drop every pre-flag row.

Route points follow the trips: `mileage_trip_polylines` is called with exactly
the ids of the trips that survived the filter, so a row that is filtered out
has no way to contribute geometry.

RLS is **not** the barrier here and must not be mistaken for one. The
`mileage_trips manager + firm read` policy grants a manager `select` on every
trip in the company, and `mileage_points follow trip visibility` grants the
matching points. The server-side scope is the only thing between an admin and a
colleague's private movements, which is why it is unit-tested.

### Colour coding

Palette derived from Okabe-Ito, the reference colour-blind-safe qualitative
set, lightened for the `#1d2843` navy map skin (raw map/SVG hex is not remapped
by the theme, so these are deliberate light values, not tokens).

Hue is never the only channel. Every driver also gets a **number**, shown both
on the start disc of each of their trails and in the legend. The number
identifies the driver with no colour perception at all.

### Keeping the manager's own workflow

The team overlay gains the manager's own unclassified banner and an explicit
"My drive log" link back to the single-driver view, so making it the default
does not cost them anything.

## Out of scope, flagged separately

`app/firm/mileage/page.tsx` selects every classification plus full
`mileage_points` for every driver in every engaged company, so an external
accounting firm sees employees' personal routes. Same class of bug, different
actor and a different consent story; raised as its own task rather than changed
here.
