# Seed the geofence mesh from trip endpoints

Date: 2026-08-10
Status: approved, not yet implemented

## Problem

The learned-place geofence mesh is the only thing that can restart mileage
capture after Android kills the app. On 2026-08-09, with the mesh finally
reporting for the first time (see #548), the driver's device read:

```
geofence_arm_state  armed
geofence_count      1
```

One place. Home, in Shakopee. A drive that starts anywhere else has no
region to trip, so if the app has been killed there is nothing to wake it
and the drive is lost.

Measured over 90 days of that driver's trips, clustering endpoints at 250 m:

| place              | endpoint hits | distinct days | as drive origin | span            |
| ------------------ | ------------- | ------------- | --------------- | --------------- |
| A Shakopee (home)  | 67            | 35            | 35              | Jun 1 to Aug 9  |
| B 44.868 / -93.415 | 26            | 12            | 15              | Jun 24 to Aug 5 |
| C 44.927 / -93.448 | 9             | 5             | 5               | Jun 28 to Aug 9 |

**20 of 55 drive starts began somewhere with no geofence under them.** That
is 36% of drives with no resurrection net, and it is the number this change
exists to move.

## Why the current engine finds only one place

`learnPlaces` derives candidates from dwell gaps in `mileage_points_raw`: a
gap of at least `MIN_GAP_MS` (10 min) whose points either side are within
`DWELL_SAME_SPOT_M` (150 m). Those are clustered with DBSCAN and must appear
on `MIN_VISIT_DAYS` (3) separate local days.

Two things starve it:

1. **Raw points are exactly what a broken tracker does not produce.** The
   engine's input is the thing that fails first.
2. **`mileage-retention` deletes consumed raw rows at 30 days**, while the
   clustering window is 90. Two thirds of the window is empty by design.

`mileage_trips` has neither problem. Trips are permanent, and every trip
carries two endpoints, so the signal is denser and it survives.

## Approach

Add trip endpoints as a **second candidate source** feeding the existing
clustering. Rejected alternatives:

- **Replace dwell clustering with endpoints.** Discards working evidence. A
  place where the driver parks for three hours is real even when the trip
  boundary landed oddly.
- **Compute it as a SQL materialized view.** Moves tuned, tested logic out
  of TypeScript into a second dialect with no unit tests.

## Design

### Candidate extraction

Each trip contributes two candidates: its first point and its last point.

**Only `source = 'tracked'` trips.** `mileage_trips.source` is constrained
to `('tracked', 'manual', 'route')`. Both non-tracked writers live in
`app/mileage/actions.ts`: `route` is the reconstruct-from-stops tool, whose
endpoints are geocoded from place names, and `manual` is typed entry. Neither
has a GPS-derived endpoint, so seeding from them would register a region
around a coordinate the phone has never actually reported.

Currently a no-op for the sampled driver (165 of 165 trips are `tracked`), so
this is forward-looking rather than load-bearing today. It is still a
correctness requirement: the reconstruct tool exists and is linked from the
mileage page, so the first driver who uses it would otherwise get a geofence
at a geocoder's idea of an address. `lib/mileage/finalize.ts` already excludes
non-tracked trips at two call sites, so this follows established precedent
rather than inventing a rule.

Dwell credit for an endpoint is the real gap to the adjacent trip at that
place, capped by the existing `MAX_DWELL_CREDIT_MS` (12 h) so an overnight
stop cannot outvote a month of commuting.

### Unchanged thresholds

| constant              | value       | why it stays                                                    |
| --------------------- | ----------- | --------------------------------------------------------------- |
| `MIN_VISIT_DAYS`      | 3           | Excludes the one-off client site. ~10 endpoints in the sample sit at 1 to 2 days and correctly stay out. |
| `MIN/MAX_RADIUS_M`    | 150 to 250  | Already tuned against real GPS scatter.                          |
| `MAX_LEARNED_PLACES`  | 8           | The binding constraint is iOS's 20-region-per-app limit. 8 leaves headroom for future non-learned regions. |
| `CLUSTER_EPS_M`       | 120         | Merges the grid-adjacent cells that endpoint rounding produces.  |

### Ranking

By label first: home ranks 0, work ranks 1, every other stop follows.
Home is whichever cluster has the most overnight (small-hours) dwell time;
work is the strongest weekday-daytime cluster that is not home. Within the
"stop" group, clusters are ordered by summed dwell time, not by distinct
days or hit count. When the cap binds, the lowest-ranked stop is dropped,
never home or work.

### Recompute cadence

Drops from weekly (`STALE_AFTER_MS`, 7 days) to daily.

The 7-day figure exists because clustering reads up to `MAX_POINTS` (60,000)
raw rows. Endpoints read on the order of 100 trip rows, so the cost no
longer justifies the staleness. A new workplace arms within a day rather
than a week.

### Dependency on the fragment stitch

This must land after the stitch (#549 / #550). Severed trip fragments had
endpoints at **upload-stall locations**: phantom places wherever the
driver's signal happened to drop. Seeding geofences from those would arm
regions around traffic dead spots. The 13 merges applied on 2026-08-10
removed that contamination from this design's input.

## Testing

Pure-function tests against `extractPlaceCandidates`, using fixtures drawn
from the three real clusters above:

- three qualifying clusters emerge from endpoint-only input
- a 1-day endpoint never qualifies, however many hits it has
- `source != 'tracked'` trips contribute no candidates
- the cap drops the least habitual place, never home
- dwell credit is bounded by `MAX_DWELL_CREDIT_MS`

Every assertion mutation-verified: reintroduce the bug, confirm the specific
test fails.

## Risks

**A frequent non-origin becomes a geofence.** A place the driver is
regularly dropped at registers a region that never usefully fires. Cost is
negligible battery. Accepted.

**A wrong place from bad endpoint data.** The real risk, mitigated by the
`tracked`-only filter and the 3-day bar.

**The cap binds for a driver with many habitual places.** At 8 places the
least habitual drops. Acceptable now; if it bites, the answer is ranking by
recency-weighted origin count rather than raising the cap into iOS's limit.

## Out of scope

- Raising `MAX_LEARNED_PLACES` beyond 8
- Manual place management in the UI
- Any change to what a geofence does once it fires
