# Geofence Mesh Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the learned-place geofence mesh from trip endpoints as well as raw-GPS dwells, so a drive that starts away from home still has a region that can wake a killed app.

**Architecture:** `learnPlaces` keeps its existing DBSCAN clustering, radius, 3-day bar, home/work labelling and cap. It gains a second candidate source: gaps BETWEEN consecutive trips. A trip that ends at a place and is followed by a trip starting at the same place describes a dwell, exactly like the gap between two consecutive raw points, so the new extractor mirrors `extractPlaceCandidates` and emits the same `PlaceCandidate` shape. Nothing downstream changes.

**Tech Stack:** TypeScript, Next.js App Router, Supabase (PostgREST), vitest.

## Global Constraints

- No em dashes anywhere: code, comments, commit messages, docs. Use commas, periods, parentheses, colons or hyphens.
- No emoji in UI chrome, headings, or as icons.
- Every new test assertion must be mutation-verified: reintroduce the bug, confirm the specific test fails, restore.
- `learnPlaces` must remain a pure function. All I/O stays in the route.
- Do not change `MIN_VISIT_DAYS` (3), `MIN_RADIUS_M` (150), `MAX_RADIUS_M` (250), `MAX_LEARNED_PLACES` (8), or `CLUSTER_EPS_M` (120).
- Only `mileage_trips.source = 'tracked'` may contribute candidates.
- Spec: `docs/superpowers/specs/2026-08-10-geofence-mesh-seeding-design.md`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `lib/mileage/places.ts` | Pure clustering engine | Add `TripSpan` type and `extractEndpointCandidates`; widen `learnPlaces` signature |
| `lib/mileage/places-endpoints.test.ts` | Tests for the new extractor | Create |
| `lib/mileage/places.test.ts` | Existing engine tests | Add two `learnPlaces` integration cases |
| `app/api/mileage/places/learned/route.ts` | Loads history, calls `learnPlaces`, persists | Load tracked trips, pass them, drop `STALE_AFTER_MS` to 1 day |

`lib/mileage/geofence.ts` is deliberately untouched. The device sync reads whatever `mileage_learned_places` holds and needs no knowledge of where candidates came from.

---

### Task 1: Endpoint candidate extraction

**Files:**
- Modify: `lib/mileage/places.ts` (add after `extractPlaceCandidates`, which ends near line 303)
- Test: `lib/mileage/places-endpoints.test.ts` (create)

**Interfaces:**
- Consumes: `PlaceCandidate`, `MIN_GAP_MS`, `DWELL_SAME_SPOT_M`, `haversineMeters` (already exported from `./segmentation`), all existing in `lib/mileage/places.ts`.
- Produces:
  - `export type TripSpan = { startLat: number; startLng: number; startMs: number; endLat: number; endLng: number; endMs: number }`
  - `export function extractEndpointCandidates(trips: TripSpan[]): PlaceCandidate[]`

- [ ] **Step 1: Write the failing test**

Create `lib/mileage/places-endpoints.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DWELL_SAME_SPOT_M,
  MIN_GAP_MS,
  extractEndpointCandidates,
  type TripSpan,
} from "./places";

/**
 * Trip endpoints as dwell evidence.
 *
 * A trip that ends at a place and is followed by a trip starting at the
 * same place describes a stop, exactly as the gap between two consecutive
 * raw points does. So this mirrors extractPlaceCandidates rather than
 * inventing a second set of rules.
 *
 * It exists because the raw-point path starves: mileage-retention deletes
 * consumed rows at 30 days against a 90 day clustering window, and raw
 * points are precisely what a broken tracker fails to produce. Trips are
 * permanent. Measured on the owner's 90 days: raw dwells yielded ONE
 * place, trip endpoints yield three, covering 20 additional drive starts
 * that had no geofence under them.
 */

const T0 = 1_760_000_000_000;
const MIN = 60_000;
const HOME = { lat: 44.7619, lng: -93.4731 };
const SITE = { lat: 44.868, lng: -93.415 };

function span(
  startMs: number,
  endMs: number,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): TripSpan {
  return {
    startLat: from.lat,
    startLng: from.lng,
    startMs,
    endLat: to.lat,
    endLng: to.lng,
    endMs,
  };
}

describe("extractEndpointCandidates", () => {
  it("returns nothing for no trips", () => {
    expect(extractEndpointCandidates([])).toEqual([]);
  });

  it("credits a parked gap between two trips at the same place", () => {
    // Arrive at SITE at T0+30min, leave SITE at T0+120min: 90 minutes parked.
    const trips = [
      span(T0, T0 + 30 * MIN, HOME, SITE),
      span(T0 + 120 * MIN, T0 + 150 * MIN, SITE, HOME),
    ];
    const out = extractEndpointCandidates(trips);
    const atSite = out.filter(
      (c) => Math.abs(c.lat - SITE.lat) < 0.001 && c.confirmedDwell,
    );
    expect(atSite.length).toBe(2);
    expect(atSite[0].dwellMs).toBe(90 * MIN);
    expect(atSite[0].startMs).toBe(T0 + 30 * MIN);
    expect(atSite[0].endMs).toBe(T0 + 120 * MIN);
  });

  it("does not confirm a dwell when the next trip starts somewhere else", () => {
    // Ended at SITE, next trip starts at HOME: the vehicle moved without
    // being captured, so this is a blackout and not a stop.
    const trips = [
      span(T0, T0 + 30 * MIN, HOME, SITE),
      span(T0 + 120 * MIN, T0 + 150 * MIN, HOME, SITE),
    ];
    const out = extractEndpointCandidates(trips);
    expect(out.some((c) => c.confirmedDwell && c.lat === SITE.lat)).toBe(false);
  });

  it("ignores a turnaround shorter than the minimum gap", () => {
    const trips = [
      span(T0, T0 + 30 * MIN, HOME, SITE),
      span(T0 + 30 * MIN + 5000, T0 + 60 * MIN, SITE, HOME),
    ];
    const out = extractEndpointCandidates(trips);
    expect(out.every((c) => c.dwellMs >= MIN_GAP_MS)).toBe(true);
  });

  it("credits the final trip's end as an open stop, at minimum weight", () => {
    const trips = [span(T0, T0 + 30 * MIN, HOME, SITE)];
    const out = extractEndpointCandidates(trips);
    const tail = out.find((c) => c.ts === T0 + 30 * MIN);
    expect(tail).toBeDefined();
    expect(tail!.dwellMs).toBe(MIN_GAP_MS);
    expect(tail!.confirmedDwell).toBe(false);
  });

  it("treats a small GPS scatter at the same address as one spot", () => {
    // ~40 m apart, comfortably inside DWELL_SAME_SPOT_M.
    const nudged = { lat: SITE.lat + 0.00036, lng: SITE.lng };
    const trips = [
      span(T0, T0 + 30 * MIN, HOME, SITE),
      span(T0 + 120 * MIN, T0 + 150 * MIN, nudged, HOME),
    ];
    expect(DWELL_SAME_SPOT_M).toBeGreaterThan(40);
    const out = extractEndpointCandidates(trips);
    expect(out.some((c) => c.confirmedDwell)).toBe(true);
  });

  it("sorts unordered input before pairing", () => {
    const a = span(T0, T0 + 30 * MIN, HOME, SITE);
    const b = span(T0 + 120 * MIN, T0 + 150 * MIN, SITE, HOME);
    expect(extractEndpointCandidates([b, a])).toEqual(
      extractEndpointCandidates([a, b]),
    );
  });

  it("drops trips with non-finite coordinates instead of poisoning a cluster", () => {
    const bad = span(T0, T0 + 30 * MIN, HOME, { lat: NaN, lng: -93.4 });
    const good = span(T0 + 120 * MIN, T0 + 150 * MIN, SITE, HOME);
    const out = extractEndpointCandidates([bad, good]);
    expect(out.every((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run lib/mileage/places-endpoints.test.ts`

Expected: FAIL. The import cannot resolve, reported as `No "extractEndpointCandidates" export is defined on the "./places" module`.

- [ ] **Step 3: Implement the extractor**

In `lib/mileage/places.ts`, immediately after the closing brace of `extractPlaceCandidates`, add:

```ts
/**
 * One trip reduced to its two endpoints.
 *
 * Deliberately not the trip row: this module is pure and must not learn
 * the database's column names. The route maps rows to this shape.
 */
export type TripSpan = {
  startLat: number;
  startLng: number;
  /** Epoch milliseconds. */
  startMs: number;
  endLat: number;
  endLng: number;
  /** Epoch milliseconds. */
  endMs: number;
};

/**
 * Dwell candidates derived from the gaps BETWEEN trips.
 *
 * A trip ending at a place, followed by a trip starting at the same
 * place, is a stop, and it is the same evidence that a gap between two
 * consecutive raw points gives. So the rules here mirror
 * extractPlaceCandidates exactly: at least MIN_GAP_MS, and confirmed only
 * when nothing moved (within DWELL_SAME_SPOT_M).
 *
 * Why this source exists at all: the raw-point path starves. Consumed
 * rows are deleted at 30 days against a 90 day clustering window, and raw
 * points are exactly what a failing tracker does not produce. Trips are
 * permanent. On the owner's 90 days, raw dwells produced ONE place while
 * endpoints produce three, covering 20 drive starts that had no geofence.
 *
 * Filtering to tracked-only trips is the CALLER's job, because this
 * module never sees a trip row. See the route.
 */
export function extractEndpointCandidates(trips: TripSpan[]): PlaceCandidate[] {
  const finite = (n: number) => Number.isFinite(n);
  const sorted = [...trips]
    .filter(
      (t) =>
        finite(t.startLat) &&
        finite(t.startLng) &&
        finite(t.endLat) &&
        finite(t.endLng) &&
        finite(t.startMs) &&
        finite(t.endMs) &&
        Math.abs(t.startLat) <= 90 &&
        Math.abs(t.endLat) <= 90 &&
        Math.abs(t.startLng) <= 180 &&
        Math.abs(t.endLng) <= 180,
    )
    .sort((a, b) => a.startMs - b.startMs);

  const out: PlaceCandidate[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const gapMs = next.startMs - prev.endMs;
    if (gapMs < MIN_GAP_MS) continue;
    const sameSpot =
      haversineMeters(
        { lat: prev.endLat, lng: prev.endLng },
        { lat: next.startLat, lng: next.startLng },
      ) <= DWELL_SAME_SPOT_M;

    // Where the vehicle was when the drive ended: evidence either way.
    out.push({
      lat: prev.endLat,
      lng: prev.endLng,
      ts: prev.endMs,
      dwellMs: gapMs,
      startMs: prev.endMs,
      endMs: next.startMs,
      confirmedDwell: sameSpot,
    });
    // Where the next drive began is evidence only if nothing moved.
    if (sameSpot) {
      out.push({
        lat: next.startLat,
        lng: next.startLng,
        ts: next.startMs,
        dwellMs: gapMs,
        startMs: prev.endMs,
        endMs: next.startMs,
        confirmedDwell: true,
      });
    }
  }

  // The last trip's end bounds an open stop with no "after" yet. That is
  // where the vehicle is now, which for a driver whose tracking just died
  // is the most valuable place there is. Minimum credit so it cannot
  // dominate on its own.
  const last = sorted[sorted.length - 1];
  if (last) {
    out.push({
      lat: last.endLat,
      lng: last.endLng,
      ts: last.endMs,
      dwellMs: MIN_GAP_MS,
      startMs: last.endMs,
      endMs: last.endMs + MIN_GAP_MS,
      confirmedDwell: false,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run lib/mileage/places-endpoints.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-verify the two load-bearing rules**

COMMIT FIRST (Step 6), then mutate. Restoring with `git checkout` only
works once the work is committed; run before the commit it discards the
whole implementation. Either commit first and restore with `git checkout`,
or revert each mutation with an explicit Edit that puts the original line
back. Confirm the NAMED test fails for each mutation and that no mutation
survives into the final file.

Mutation A, drop the same-spot requirement. Change `confirmedDwell: sameSpot,` to `confirmedDwell: true,` in the first `out.push`.
Expected failure: `does not confirm a dwell when the next trip starts somewhere else`.

Mutation B, drop the minimum gap. Change `if (gapMs < MIN_GAP_MS) continue;` to `if (gapMs < 0) continue;`.
Expected failure: `ignores a turnaround shorter than the minimum gap`.

- [ ] **Step 6: Typecheck, lint and commit**

```bash
npx tsc --noEmit
npx eslint lib/mileage/places.ts lib/mileage/places-endpoints.test.ts
git add lib/mileage/places.ts lib/mileage/places-endpoints.test.ts
git commit -m "Derive place candidates from the gaps between trips

The raw-point path starves twice over: mileage-retention deletes
consumed rows at 30 days against a 90 day clustering window, and raw
points are exactly what a failing tracker does not produce. Trips are
permanent and carry two endpoints each.

A trip ending at a place followed by a trip starting at the same place
is a stop, and it is the same evidence a gap between two consecutive raw
points gives, so this mirrors extractPlaceCandidates rather than
inventing a second set of rules.

Pure. The tracked-only filter belongs to the caller, because this module
never sees a trip row."
```

---

### Task 2: Feed endpoints into learnPlaces

**Files:**
- Modify: `lib/mileage/places.ts:447` (`learnPlaces`)
- Test: `lib/mileage/places.test.ts` (append two cases)

**Interfaces:**
- Consumes: `extractEndpointCandidates`, `TripSpan` from Task 1.
- Produces: `export function learnPlaces(points: RawPoint[], trips?: TripSpan[]): LearnedPlace[]`. The second parameter is optional and defaults to `[]`, so every existing caller and test keeps working unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `lib/mileage/places.test.ts`:

```ts
describe("learnPlaces with trip endpoints", () => {
  const T0 = 1_760_000_000_000;
  const DAY = 86_400_000;
  const MIN = 60_000;
  const HOME = { lat: 44.7619, lng: -93.4731 };
  const SITE = { lat: 44.868, lng: -93.415 };

  /** Three days of commuting, expressed only as trips. */
  function commuteTrips(days: number): TripSpan[] {
    const out: TripSpan[] = [];
    for (let d = 0; d < days; d++) {
      const dayStart = T0 + d * DAY;
      // Leave home 09:00, arrive site 09:30.
      out.push({
        startLat: HOME.lat,
        startLng: HOME.lng,
        startMs: dayStart + 9 * 60 * MIN,
        endLat: SITE.lat,
        endLng: SITE.lng,
        endMs: dayStart + 9.5 * 60 * MIN,
      });
      // Leave site 17:00, home 17:30.
      out.push({
        startLat: SITE.lat,
        startLng: SITE.lng,
        startMs: dayStart + 17 * 60 * MIN,
        endLat: HOME.lat,
        endLng: HOME.lng,
        endMs: dayStart + 17.5 * 60 * MIN,
      });
    }
    return out;
  }

  it("finds nothing from trips alone below the visit-day bar", () => {
    // Two days only. MIN_VISIT_DAYS is 3.
    expect(learnPlaces([], commuteTrips(2))).toEqual([]);
  });

  it("learns home and the work site from trips with no raw points at all", () => {
    // THE POINT OF THE CHANGE. The old engine returns [] here, because
    // there are no raw points to derive a dwell from.
    expect(learnPlaces([], [])).toEqual([]);

    const places = learnPlaces([], commuteTrips(5));
    expect(places.length).toBeGreaterThanOrEqual(2);
    const labels = places.map((p) => p.label);
    expect(labels).toContain("home");
    // Home is the overnight place, so it must outrank the work site.
    expect(places[0].label).toBe("home");
    const home = places.find((p) => p.label === "home")!;
    expect(Math.abs(home.lat - HOME.lat)).toBeLessThan(0.005);
  });

  it("respects the cap when trips add many habitual places", () => {
    const trips = commuteTrips(5);
    let ms = T0 + 40 * DAY;
    // Ten extra habitual places, each visited on 4 separate days.
    for (let place = 0; place < 10; place++) {
      for (let d = 0; d < 4; d++) {
        const lat = 45.2 + place * 0.05;
        trips.push({
          startLat: HOME.lat,
          startLng: HOME.lng,
          startMs: ms,
          endLat: lat,
          endLng: -93.4,
          endMs: ms + 30 * MIN,
        });
        trips.push({
          startLat: lat,
          startLng: -93.4,
          startMs: ms + 200 * MIN,
          endLat: HOME.lat,
          endLng: HOME.lng,
          endMs: ms + 230 * MIN,
        });
        ms += DAY;
      }
    }
    const places = learnPlaces([], trips);
    expect(places.length).toBeLessThanOrEqual(MAX_LEARNED_PLACES);
    expect(places[0].label).toBe("home");
  });
});
```

Add `TripSpan` and `MAX_LEARNED_PLACES` to the existing import from `./places` at the top of `lib/mileage/places.test.ts` if they are not already imported.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run lib/mileage/places.test.ts`

Expected: FAIL. `learnPlaces([], commuteTrips(5))` returns `[]` because `learnPlaces` still ignores its second argument, so `expect(places.length).toBeGreaterThanOrEqual(2)` fails.

- [ ] **Step 3: Widen learnPlaces**

In `lib/mileage/places.ts`, replace the signature and first statement of `learnPlaces`:

```ts
export function learnPlaces(
  points: RawPoint[],
  trips: TripSpan[] = [],
): LearnedPlace[] {
  // Two independent sources of the same evidence, deliberately merged
  // BEFORE clustering so a place attested by both gets one cluster with
  // the combined weight rather than two competing ones.
  //
  // Raw dwells are higher resolution and vanish at 30 days. Trip
  // endpoints are coarser and permanent. Neither is sufficient alone:
  // the owner's 90 days yield ONE place from raw dwells and three from
  // endpoints.
  const candidates = [
    ...extractPlaceCandidates(points),
    ...extractEndpointCandidates(trips),
  ];

  // Habitual only. A place seen on fewer than MIN_VISIT_DAYS separate
  // days does not earn one of a strictly limited number of platform
  // region registrations.
  const clusters = clusterCandidates(candidates).filter(
    (c) => c.visits >= MIN_VISIT_DAYS,
  );
```

Leave the rest of the function exactly as it is.

- [ ] **Step 4: Run the full suite and confirm it passes**

Run: `npx vitest run lib/mileage/`

Expected: PASS. Every pre-existing `places.test.ts` case still passes because the new parameter defaults to `[]`.

- [ ] **Step 5: Mutation-verify the merge**

COMMIT FIRST (Step 6), then mutate, for the reason given in Task 1 Step 5.

Change the candidates array to `[...extractPlaceCandidates(points)]` only.
Expected failure: `learns home and the work site from trips with no raw points at all`.
Restore with `git checkout lib/mileage/places.ts` (safe once committed) or
by re-adding the spread with an Edit.

- [ ] **Step 6: Typecheck, lint and commit**

```bash
npx tsc --noEmit
npx eslint lib/mileage/places.ts lib/mileage/places.test.ts
git add lib/mileage/places.ts lib/mileage/places.test.ts
git commit -m "Merge trip-endpoint candidates into learnPlaces

Merged BEFORE clustering, so a place attested by both raw dwells and
trip endpoints becomes one cluster with the combined weight rather than
two competing ones.

The trips parameter defaults to empty, so every existing caller and test
is unaffected.

Raw dwells are higher resolution and vanish at 30 days; endpoints are
coarser and permanent. Neither is sufficient alone: the owner's 90 days
yield one place from raw dwells and three from endpoints."
```

---

### Task 3: Load tracked trips in the route and tighten the cadence

**Files:**
- Modify: `app/api/mileage/places/learned/route.ts` (constants near line 30, `recompute` near line 82)

**Interfaces:**
- Consumes: `learnPlaces(points, trips)` and `TripSpan` from Task 2.
- Produces: no new exports. Behaviour change only.

- [ ] **Step 1: Widen the import**

At the top of `app/api/mileage/places/learned/route.ts`, add `type TripSpan` to the existing import from `@/lib/mileage/places`:

```ts
import {
  learnPlaces,
  MAX_LEARNED_PLACES,
  type LearnedPlace,
  type RawPoint,
  type TripSpan,
} from "@/lib/mileage/places";
```

- [ ] **Step 2: Drop the staleness window to one day**

Replace the `STALE_AFTER_MS` declaration and its comment:

```ts
/**
 * Recompute daily.
 *
 * This was weekly, and the reason was cost: clustering read up to
 * MAX_POINTS (60,000) raw rows. Trip endpoints read on the order of a
 * hundred rows, so the price no longer justifies a week of staleness,
 * and a new habitual place now arms within a day instead of seven.
 *
 * If a future change makes this path read raw points again in bulk,
 * put the week back.
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
```

- [ ] **Step 3: Load the trips inside recompute**

In `recompute`, directly after the `mileage_points_raw` query's error check and the `points` mapping, and before the `learnPlaces` call, insert:

```ts
  // Trip endpoints, the second candidate source.
  //
  // tracked ONLY. mileage_trips.source is constrained to
  // ('tracked', 'manual', 'route'); `route` endpoints are geocoded from
  // place names typed into the reconstruct tool and `manual` are typed
  // outright, so neither is a coordinate the phone ever reported.
  // Seeding a geofence from one would arm a region around a geocoder's
  // idea of an address. lib/mileage/finalize.ts already excludes
  // non-tracked trips for the same reason.
  const { data: tripRows, error: tripError } = await admin
    .from("mileage_trips")
    .select("id, started_at, ended_at")
    .eq("driver_user_id", userId)
    .eq("company_id", companyId)
    .eq("source", "tracked")
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: true });
  if (tripError) throw new Error(tripError.message);

  // Endpoints come from the trip's own materialised points. start_place_id
  // and end_place_id are NULL on every row in production, so they cannot
  // be used for this.
  const trips: TripSpan[] = [];
  for (const row of tripRows ?? []) {
    const tripId = row.id as string;
    const [firstRes, lastRes] = await Promise.all([
      admin
        .from("mileage_points")
        .select("lat, lng")
        .eq("trip_id", tripId)
        .order("captured_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      admin
        .from("mileage_points")
        .select("lat, lng")
        .eq("trip_id", tripId)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const first = firstRes.data;
    const last = lastRes.data;
    if (!first || !last) continue;
    trips.push({
      startLat: first.lat as number,
      startLng: first.lng as number,
      startMs: Date.parse(row.started_at as string),
      endLat: last.lat as number,
      endLng: last.lng as number,
      endMs: Date.parse(row.ended_at as string),
    });
  }
```

- [ ] **Step 4: Pass the trips**

Change the single call:

```ts
  const places = learnPlaces(points, trips);
```

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/mileage/places/learned/route.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/mileage/places/learned/route.ts
git commit -m "Feed tracked trip endpoints into the learned-place recompute

tracked only. mileage_trips.source is constrained to ('tracked',
'manual', 'route'), and both non-tracked writers in
app/mileage/actions.ts produce endpoints from geocoded place names or
typed entry rather than GPS. Seeding from one would arm a region around
a geocoder's idea of an address.

Endpoints come from each trip's materialised points because
start_place_id and end_place_id are NULL on every row in production.

Staleness drops from seven days to one: the old window existed because
clustering read up to 60,000 raw rows, and endpoints read about a
hundred, so a new habitual place now arms within a day."
```

---

### Task 4: Verify against real data, then ship

**Files:** none modified. This task is verification.

**Interfaces:** none.

- [ ] **Step 1: Run the whole suite**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 2: Force a recompute for the owner and read the result**

The route recomputes on GET when the cache is stale, and POST forces it. With the app signed in as the owner, POST to `/api/mileage/places/learned?companyId=<id>`.

Then confirm in Supabase:

```sql
select label, radius_m, round(lat::numeric,4) lat, round(lng::numeric,4) lng,
       visits, round(dwell_hours::numeric,1) dwell_h, rank
from mileage_learned_places
where driver_user_id = '89871e98-cf67-4150-9579-6238876a7161'
order by rank;
```

Expected: three or more rows where there was one. Home near 44.7619 / -93.4731 at rank 0, plus a place near 44.868 / -93.415 and one near 44.927 / -93.448. If only home appears, the trips are not reaching `learnPlaces`; check the `source` filter and that `mileage_points` rows exist for those trips.

- [ ] **Step 3: Confirm the device picks up the larger mesh**

Open the app on the Android handset, then:

```sql
select reported_at, web_build, geofence_arm_state, geofence_count
from mileage_device_status
where driver_user_id = '89871e98-cf67-4150-9579-6238876a7161';
```

Expected: `geofence_arm_state` still `armed`, and `geofence_count` matching the number of learned places rather than 1. This is the only step that proves the change reached a phone. A green suite does not.

- [ ] **Step 4: Bump the service worker cache and open the PR**

`public/sw.js` holds `const CACHE_VERSION = "vNNN"`. Increment it, because client JS changed and phone WebViews otherwise render the stale bundle.

```bash
node --check public/sw.js
git add public/sw.js
git commit -m "Bump sw.js so phones pick up the endpoint-seeded mesh"
git push -u origin HEAD
gh pr create --title "Seed the geofence mesh from trip endpoints" --body "Implements docs/superpowers/specs/2026-08-10-geofence-mesh-seeding-design.md"
```

---

## Self-Review

**Spec coverage:** candidate extraction from endpoints (Task 1), tracked-only filter (Task 3), dwell credit bounded by `MAX_DWELL_CREDIT_MS` (inherited unchanged, applied in `summarize`), thresholds untouched (Global Constraints), ranking unchanged (Task 2 leaves the body alone), daily recompute (Task 3), testing including the cap and the 1-day exclusion (Tasks 1 and 2), device verification (Task 4). The spec's "dependency on the fragment stitch" needs no task: #549 and #550 are already merged and the 13 merges were applied on 2026-08-10.

**Placeholders:** none. Every code step carries the literal code.

**Type consistency:** `TripSpan` uses `startLat/startLng/startMs/endLat/endLng/endMs` in Tasks 1, 2 and 3. `extractEndpointCandidates` returns `PlaceCandidate[]` in Task 1 and is consumed as such in Task 2. `learnPlaces(points, trips = [])` is defined in Task 2 and called with two arguments in Task 3.

**One gap worth naming:** Task 3 issues two queries per trip, so a 90 day window costs roughly 2N round trips (about 320 for the current 160 trips, near 15 seconds). That is fine now and will not be at fleet scale. The fix is a single `mileage_points` query filtered by `trip_id in (...)` with client-side first/last selection, which is worth doing the moment a driver exceeds a few hundred trips in the window.
