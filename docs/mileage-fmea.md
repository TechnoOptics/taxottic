# Mileage pipeline: failure mode and effects analysis

Scope: device capture through ingest, staging, segmentation, materialisation,
render and UI. Every claim below is cited as `file:line` against the canonical
content of `origin/main` at commit `9e4b5a45`. Where a statement is an
inference rather than something read directly in code, it is labelled
`INFERRED`.

Method note on the "Currently detected?" column: a `console.log` or
`console.error` is NOT detection. There is no error-reporting or paging
integration in this repository (no Sentry package, no Slack webhook, no ops
email helper: verified by searching `package.json`, `lib/` and `app/`). The
only channels that reach a human are (a) push notifications to the driver,
(b) UI surfaces the user has to open, and (c) Vercel function logs, which
nobody is monitoring.

---

## Executive summary: HIGH or CRITICAL severity and currently UNDETECTED

These are the ones that will bite next.

| # | Failure mode | Where |
|---|---|---|
| C1 | iOS never escalates from significant-location-change to continuous updates, because escalation is gated on device-reported speed and SLC fixes report speed `-1`. The entire drive is captured as a sparse breadcrumb. | `ios/App/App/TaxotticBackgroundLocation.swift:60,163-169` |
| C2 | The segmenter throws away both points of any pair separated by more than 8 minutes and never accumulates them, so a sparse-but-real stream produces ZERO trips instead of an approximate trip plus a flag. | `lib/mileage/segmentation.ts:93,226-229,199-203` |
| C3 | Unconsumed raw points are silently marked consumed at 45 days and deleted at 75, destroying the only evidence from which a lost drive could ever be recovered. | `app/api/cron/mileage-retention/route.ts:47-56` |
| C4 | The fleet canary has no notification channel at all. Its verdict goes to `console.error` and a JSON response field. Nothing pages, emails, pushes or persists an alert. | `app/api/cron/mileage-finalize/route.ts:427-431,446-453` |
| C5 | The canary's own input is an unpaginated PostgREST select, so its day histogram is built from a truncated, unordered sample. | `app/api/cron/mileage-finalize/route.ts:381-388,397-404` |
| C6 | GATED 2026-08-01. `renderTripFromRaw` rewrote `distance_miles` and `deduction_cents` with no plausibility gate. `isPlausibleTrip` guarded only the insert path. Now gated by `assessRenderedTrack`, with refusals recorded in `mileage_render_refusals`. See the C6 detail below. | `lib/mileage/finalize.ts:241-249` vs `:505-511` |
| C7 | Three concurrent finalize callers do read-then-insert with no isolation. The unique index only catches byte-identical `started_at`, so overlapping-but-not-identical trips can both land and double-count the miles. | `lib/mileage/finalize.ts:374-382`, `supabase/migrations/20260711120000_mileage_finalize_race_backstop.sql` |
| C8 | A `started_at` unique-index collision aborts the update that carries the corrected distance, but the rendered track has ALREADY been replaced. The map and the claimed miles diverge permanently. | `lib/mileage/finalize.ts:241-255` |
| H1 | The "parked device" detector is dead on exactly the devices that break: a device whose `speed_mps` is always null or 0 has `lastMovementMs = null`, which the evaluator treats as healthy. | `lib/mileage/device-health.ts:93-97`, `app/api/cron/mileage-finalize/route.ts:292-300` |
| H2 | The degraded-capture detector requires at least one large jump, so a device that logged 387 points inside a 40 m box all day reads "ok". It is also pull-only: the user has to open `/mileage`. | `lib/mileage/health.ts:69`, `app/mileage/page.tsx:373` |
| H3 | A permanent 4xx quarantines up to 800 real GPS points into a 5-batch localStorage ring and drops them from the buffer forever. No user or server ever sees this. | `lib/mileage/native-tracker.ts:688-704` |
| H4 | Buffer eviction at `MAX_BUFFER` silently discards the oldest points. The counter that records the loss is never transmitted and never rendered. | `lib/mileage/native-tracker.ts:1111-1115,268`, heartbeat payload `:791-817` |
| H5 | Another company's orphaned buffer is overwritten in localStorage before its upload is confirmed, so a multi-company driver can permanently lose a drive. | `lib/mileage/native-tracker.ts:399,930-931,1116` |
| H6 | The zombie-watcher watchdog refuses to run unless the document is visible, which is precisely never during a backgrounded drive. | `lib/mileage/native-tracker.ts:1208-1213` |
| H8 | The clock-skew correction keys off the batch MAXIMUM timestamp, so one poisoned future fix shifts the whole batch. | `app/api/mileage/ingest/route.ts:107-116` |
| H10 | Any read failure on the iOS native buffer file returns an empty array, and the next append then overwrites the file with a single point. Total silent loss of every buffered drive. | `ios/App/App/TaxotticBackgroundLocation.swift:228-243,246-251` |
| H11 | Approximate-trip recovery finishes by consuming EVERY remaining unconsumed point in the window with no trip attached, destroying points a later finalize pass could have segmented. | `lib/mileage/reconstruct.ts:274-282` |

---

## Answers to the two suspected live bugs

### 1. Does `track.ts` jitter suppression run on the ingest or capture path?

**Disproven for the raw table. Confirmed for the authoritative tax distance.**

Traced call sites: `buildTrackFromRaw` is imported and called in exactly one
non-test place, `lib/mileage/finalize.ts:10` and `lib/mileage/finalize.ts:176`,
inside `renderTripFromRaw`. `renderTripFromRaw` writes only to
`mileage_points` (`finalize.ts:208-229`) and to `mileage_trips`
(`finalize.ts:241-249`). It never writes `mileage_points_raw`. Nothing on the
device (`lib/mileage/native-tracker.ts`) and nothing in the ingest route
(`app/api/mileage/ingest/route.ts`) imports `track.ts`. The ingest route stages
points verbatim at `app/api/mileage/ingest/route.ts:144-162`, with only the
batch clock shift applied.

So the Android "387 points all inside a 40 m box in `mileage_points_raw`"
cannot have been produced by `track.ts`. Those raw coordinates are what the
device actually sent.

The nuance that matters anyway: `renderTripFromRaw` IS reached from the ingest
path, because ingest calls `finalizeUserTrips`
(`app/api/mileage/ingest/route.ts:175`) which calls `renderTripFromRaw` at
`finalize.ts:437`, `:546` and `:568`. And `renderTripFromRaw` overwrites
`distance_miles` and `deduction_cents` with the jitter-suppressed figure
(`finalize.ts:246-247`). The jitter rule at `track.ts:83-97` drops any fix whose
displacement from the last KEPT fix is below the pair's larger error radius, and
past `JITTER_ANCHOR_MS` it keeps the timestamp while snapping the coordinate
back to the previous anchor. With the default `distanceFilter` of 25 m
(`native-tracker.ts:144`) and fixes in the 30 to 60 m accuracy band, a real
low-speed drive can have most of its fixes suppressed, so the rendered distance
(and therefore the deduction) is understated. The anchor does not move while
snapping, so the error is bounded per dwell rather than unbounded, but the
rewrite is silent and it is the number the IRS deduction is computed from.

### 2. Why was the fleet canary silent?

Four independent reasons, all confirmed by reading code:

1. **There is no alerting channel.** The verdict is stringified into
   `console.error` at `app/api/cron/mileage-finalize/route.ts:427-431` and put
   in the cron's JSON response at `:452`. It calls no `notify()`, writes no
   alert row, sends no email. Compare the per-driver escalations, which do call
   `notify()` (`:253`, `:343`). The repository contains no error-reporting SDK
   and no webhook helper. A Vercel cron response body is read by nobody.
2. **It only judges complete days.** `route.ts:420-423` filters to days strictly
   before today's UTC date and evaluates the newest of those. A same-day capture
   collapse is invisible until the following day at the earliest.
3. **The points-but-no-trips rule is fleet-aggregate, not per driver.**
   `lib/mileage/fleet-canary.ts:104-112` fires only when `today.trips === 0`
   across the entire fleet. Two drivers producing zero trips while any third
   driver produced one trip yields `trips >= 1` and the rule never evaluates.
   The rule is also unreachable unless the earlier ratio gates pass, so a fleet
   whose points also dropped exits at `:88` or `:94` instead.
4. **Its input is truncated.** `route.ts:381-388` selects raw points with
   `.limit(200_000)` and no pagination and no ordering. The codebase documents
   its own PostgREST max-rows cap as 1000 at `lib/mileage/finalize.ts:273-275`,
   and every other bulk read in the pipeline pages explicitly
   (`finalize.ts:278-307`, `route.ts:63-83`, `reconstruct.ts:82-102`). The
   canary does not. Its baseline and subject day are therefore computed from an
   arbitrary 1000-row slice of an 8-day window. `INFERRED` only in that the
   exact max-rows value is a project setting, not repository content; the
   absence of pagination is read directly.

---

## Full inventory

### CRITICAL

#### C1. iOS never escalates past significant-location-change
- **Mode**: A drive is captured as 40 to 50 sparse fixes with null speed instead
  of a continuous track.
- **Cause**: `ios/App/App/TaxotticBackgroundLocation.swift:163` escalates to
  `startFineUpdates()` only when `loc.speed >= drivingSpeed` (1.5 m/s,
  `:60`). SLC fixes are cell and wifi derived and report `speed = -1`, which is
  written out as null at `:236`. There is no displacement-derived fallback in
  the file. This is the exact signal `lib/mileage/segmentation.ts:119-135`
  documents as untrustworthy and explicitly stopped trusting on the server, but
  the native capture layer never got the same treatment. The only other
  escalation trigger is a `CLVisit` departure (`:191-209`), which fires only at
  places iOS has learned.
- **Effect on user**: Lost or heavily degraded drive. Combined with C2, usually
  a completely lost drive. Silent.
- **Detected?** No. `assessMileageTrackingHealth` would classify the resulting
  pattern as `degraded` (`lib/mileage/health.ts:69`, since SLC hops exceed
  `JUMP_MIN_M`), but only if the driver opens `/mileage`
  (`app/mileage/page.tsx:373`). Nothing pushes.
- **Recovered?** Partially, and only manually: the user must notice the banner
  and tap Recover, which runs `reconstructApproximateTrips`.
- **Severity**: Critical.

#### C2. Sparse streams produce zero trips, not an approximate trip
- **Mode**: 45 points across 29 km yields no trips at all.
- **Cause**: `lib/mileage/segmentation.ts:226-229`. When
  `gap > MAX_CAPTURE_GAP_MS` (8 minutes, `:93`) the code closes the open trip
  and `continue`s, so `cur` is never pushed into `current`. If SLC delivers on
  a cadence longer than 8 minutes (Apple's SLC contract is roughly one update
  per 500 m and not more often than every 5 minutes, so 8-minute-plus gaps on a
  highway are routine), every iteration hits this branch and `current` stays
  empty forever. Even where a fragment does form, `closeTrip` discards it below
  2 points (`:199-203`) or below `MIN_TRIP_METERS` 200 m (`:205`). There is no
  "sparse but plausible" branch anywhere in `segmentTrips`.
- **Effect on user**: The whole day's mileage is lost. Silent: the UI shows an
  empty drive log, which is indistinguishable from not having driven.
- **Detected?** No. Nothing counts unconsumed points per driver and alerts. The
  ingest response does return `stagingRemaining`
  (`app/api/mileage/ingest/route.ts:189-202`) but the client only stores it in
  `trackerDiag.flushLastStagingLeft` (`native-tracker.ts:667`), which is not
  rendered in the toggle diagnostics (`components/mileage/AutoTrackToggle.tsx:304-315`).
- **Recovered?** No, not automatically. Only the opt-in Recover button.
- **Severity**: Critical.

#### C3. Retention silently writes off stranded evidence
- **Mode**: Raw points that never became a trip are marked consumed at 45 days
  and hard-deleted 30 days after that.
- **Cause**: `app/api/cron/mileage-retention/route.ts:47-56` updates every
  unconsumed row older than the 45-day cutoff to `consumed_at = now()` with no
  `consumed_trip_id`, and `:38-45` deletes consumed rows older than 30 days.
- **Effect on user**: Permanent, irreversible loss of the only data from which a
  missed drive could be reconstructed. Silent. Tax impact is total for those
  drives.
- **Detected?** No. `console.log` of the swept count only (`:58-60`). No
  threshold, no alert, no per-driver breakdown.
- **Recovered?** No. This is the point of no return.
- **Severity**: Critical.

#### C4. The fleet canary cannot reach a human
See "Answers to the two suspected live bugs" above.
- **Effect on user**: Any fleet-wide capture regression runs until a customer
  complains. This is stated as the motivating history in the module's own header
  (`lib/mileage/fleet-canary.ts:1-16`) and the mechanism to fix it was never
  wired.
- **Detected?** The canary is itself the detection, and it is undetectable.
- **Recovered?** No.
- **Severity**: Critical.

#### C5. The canary computes its verdict from truncated input
- **Cause**: `app/api/cron/mileage-finalize/route.ts:381-388` and `:397-404`.
- **Effect**: Both false negatives (a truncated baseline can read as
  `medianPoints < MIN_BASELINE_POINTS_PER_DAY`, which returns `ok` at
  `fleet-canary.ts:61-64`) and false positives.
- **Detected?** No.
- **Recovered?** No.
- **Severity**: Critical, because it silently disarms the only fleet-level
  guard.

#### C6. Render path can fabricate distance with no plausibility gate
- **Mode**: A trip's stored distance is inflated by a straight-line hop drawn
  across a gap where no road was travelled, or across a period the vehicle was
  not moving with the phone.
- **Cause**: `isPlausibleTrip` (`lib/mileage/finalize.ts:95-102`) is applied
  only before the insert at `:505-511`. `renderTripFromRaw` writes
  `distance_miles` and `deduction_cents` at `:241-249` with no such check. The
  window it renders is not the segmenter's window: on the `consume_to_keeper`
  path it is the union of the keeper's span and the candidate's span
  (`:419-420`), clamped only by NEIGHBOURING trips (`:421-436`). If the
  intermediate stretch produced no trip (below 200 m, or fewer than 2 points,
  per C2), there is no neighbour to clamp against and the union can span a long
  gap. `buildTrackFromRaw` then joins the surviving points with straight lines
  and sums haversine (`track.ts:102-106`).
- **Effect on user**: Fabricated distance and fabricated deduction. Tax risk,
  not just lost money.
- **Detected?** No. The never-shrink invariant `shouldReplaceTrack`
  (`finalize.ts:80-85`) compares POINT COUNTS, not distance or plausibility, so
  a rebuild that adds points while adding a fabricated hop passes.
- **Recovered?** No. `reconcileBrokenTrips` will happily re-run the same render.
- **Severity**: Critical.
- **GATED (2026-08-01).** `assessRenderedTrack` now runs on the rebuilt track
  after the never-shrink check and before the destructive `mileage_points`
  delete, so a refusal leaves the trip exactly as it was. Two checks, because
  the insert gate alone does not cover this path: (1) `isPlausibleTrip` over the
  rebuilt span, the mode that produced 808 / 314 / 1,343 "mile" trips; and (2)
  an unsupported-gap check, the mode described above, which check (1) misses
  entirely because two real drives three hours apart average an innocent
  18 mph. A rendered leg spanning more than `MAX_CAPTURE_GAP_MS` and carrying
  at least `MIN_TRIP_METERS` is refused: those are the segmenter's own "a
  capture gap longer than this ends the open trip" and "shorter than this is
  GPS noise, not a drive", so no new threshold is invented. A long gap carrying
  no displacement is a parked phone and stays allowed, preserving the widened
  `TRIP_END_DWELL_MS` behaviour. Detection: every refusal writes
  `public.mileage_render_refusals` (one row per trip, with `occurrences`,
  `first_seen_at`, `last_seen_at`, and the miles refused vs kept) and the
  finalize cron logs and returns a non-zero `renderRefused`. Note the method
  note at the top of this file: the ledger is real detection, the log line is
  not. What remains open is that nothing PAGES on it, same gap as C4.

#### C7. Concurrent finalize can double-count a drive
- **Mode**: The same drive materialises as two overlapping trips, and both
  count toward the deduction.
- **Cause**: Three callers segment the same pool concurrently: ingest
  (`app/api/mileage/ingest/route.ts:175`), the 10-minute cron
  (`app/api/cron/mileage-finalize/route.ts:101`) and page open
  (`app/mileage/page.tsx:90`). The overlap check is a read
  (`lib/mileage/finalize.ts:374-382`) followed by an insert (`:513`) with no
  transaction or advisory lock. The backstop is a unique index on
  `(driver_user_id, started_at)`
  (`supabase/migrations/20260711120000_mileage_finalize_race_backstop.sql`),
  which only catches byte-identical start instants. Ingest uses a 24h window
  and the cron uses 45 days (`ingest/route.ts:176`, `route.ts:94-96`), so the
  two runs frequently see DIFFERENT pools and therefore produce different
  segment boundaries for the same drive. Different `started_at` means the index
  does not fire and both rows persist.
- **Effect on user**: Overstated business miles and deduction. Tax risk.
- **Detected?** No.
- **Recovered?** Partially and unreliably: a later finalize pass may resolve the
  pair via `resolveOverlapAction`, but only if it produces a candidate whose
  window overlaps both, and the raw points are consumed by then so it usually
  will not.
- **Severity**: Critical.

#### C8. Track and distance diverge on a `started_at` collision
- **Mode**: A trip's drawn route is replaced with a corrected track while its
  `distance_miles` keeps the old, uncorrected value.
- **Cause**: `lib/mileage/finalize.ts:208-229` deletes and re-inserts
  `mileage_points` FIRST. The update carrying `started_at`, `ended_at`,
  `distance_miles` and `deduction_cents` happens afterwards at `:241-249`, in a
  single statement. If the `started_at` change collides with the unique index,
  the whole update fails and is only logged (`:250-255`). The comment there
  calls it harmless on the grounds that the points are already corrected, but
  the distance and deduction were in the same statement and are now stale.
- **Effect on user**: The map and the claimed mileage disagree. Whichever is
  wrong, the audit trail is now self-contradictory, which is worse than either
  error alone for an IRS-facing log.
- **Detected?** No.
- **Recovered?** No. Subsequent reconcile runs hit `shouldReplaceTrack`
  (`:204-206`) with an equal point count, return null, and never retry the
  update.
- **Severity**: Critical.

### HIGH

#### H1. The parked-device detector is blind to zero-speed devices
- **Cause**: `app/api/cron/mileage-finalize/route.ts:292-300` finds the last
  movement with `.gte("speed_mps", MOVEMENT_SPEED_MPS)`, which excludes NULL
  rows in SQL. `lib/mileage/device-health.ts:93-94` then substitutes
  `nowMs - lastUploadMs` when `lastMovementMs` is null. A device that is
  uploading briskly but has never reported a usable speed therefore has a tiny
  "stillness" and is classified `healthy` at `:99`.
- **Effect**: The exact Android incident (387 stationary points, real driving
  happening elsewhere) is reported as healthy on the manager health card
  (`lib/mileage/team-health.ts:106`).
- **Detected?** No, and worse: actively mis-reported as healthy.
- **Recovered?** No.
- **Severity**: High.

#### H2. The degraded-capture detector requires a teleport
- **Cause**: `lib/mileage/health.ts:69`, `degraded = movingPairs <= 3 && bigJumps >= 1`.
  A device wedged in one 40 m box produces `movingPairs = 0` AND `bigJumps = 0`,
  so `degraded` is false and the status is `ok`. There is no dispersion or
  bounding-box test anywhere in the pipeline.
- **Effect**: The "phone did not move all day while the user drove" class is
  invisible to every detector in the system.
- **Detected?** No.
- **Recovered?** No.
- **Severity**: High.

#### H3. Dead-lettering discards up to 800 real points per 4xx
- **Cause**: `lib/mileage/native-tracker.ts:688-704`. On HTTP 400 or 413 the
  batch is pushed into a localStorage ring capped at 5 entries (`:696`) and then
  removed from the live buffer (`:701`). Nothing ever re-sends the dead letter,
  nothing reports it, and `trackerDiag.deadlettered` (`:270`) is never
  transmitted or rendered.
- **Effect**: Up to 800 GPS fixes lost per event, permanently and silently. A
  misbehaving CDN, captive portal or proxy returning 400 on a POST is enough.
- **Detected?** No.
- **Recovered?** No.
- **Severity**: High.

#### H4. Buffer eviction loses the oldest points invisibly
- **Cause**: `lib/mileage/native-tracker.ts:1111-1115` calls `capBuffer`
  (`lib/mileage/buffer.ts:46-53`) at 5000 points. The eviction count accumulates
  in `trackerDiag.evictedPoints` (`:268`). The heartbeat body
  (`:791-817`) sends `bufferSize` and `failStreak` but NOT `evictedPoints` or
  `deadlettered`, and the toggle diagnostic string
  (`components/mileage/AutoTrackToggle.tsx:304-315`) does not print them either.
  The doc comment at `lib/mileage/buffer.ts:41` claims the caller reports the
  loss. No caller does.
- **Effect**: Sustained upload failure (auth loop, offline, 403) silently eats
  the oldest half of a multi-day backlog.
- **Detected?** No.
- **Recovered?** No.
- **Severity**: High.

#### H5. Orphan cross-company buffer can be destroyed before it uploads
- **Cause**: `lib/mileage/native-tracker.ts:395-401` moves another company's
  persisted points into the module-level `orphanBuffer` and returns without
  touching `buffer`. `startMileageTracking` then calls
  `void drainOrphanBuffer()` WITHOUT awaiting (`:931`). The very first GPS
  callback calls `persistBuffer()` (`:1116`), which overwrites `LS_BUFFER` with
  the new company's payload (`:370-373`). The comment at `:502-505` asserts the
  overwrite only happens after a successful drain; the code does not enforce
  that ordering.
- **Effect**: For a multi-company driver, a whole company's buffered drive can
  exist only in RAM and be lost on the next process kill.
- **Detected?** No.
- **Recovered?** No.
- **Severity**: High.

#### H6. The zombie-watcher watchdog is blind while backgrounded
- **Cause**: `lib/mileage/native-tracker.ts:1208-1213` returns early unless
  `document.visibilityState === "visible"`. The stall threshold is 10 minutes
  (`:223`) and the timer is 60 s (`:1229`). During an actual drive the app is
  backgrounded, so the watchdog never evaluates. The comment justifies this on
  the grounds that WebView timers are throttled in the background, which is true
  but leaves the entire drive unguarded.
- **Effect**: The documented `ALREADY_STARTED` orphaned-callback failure
  (`:938-947`) cannot be caught mid-drive. This is a plausible contributor to
  the Android incident.
- **Detected?** No.
- **Recovered?** Only on the next resume, via `resumeMileageTrackingIfEnabled`
  (`:1364-1378`), by which time the drive is over.
- **Severity**: High.

#### H7. Client drive-end detection also trusts device speed only
- **Cause**: `lib/mileage/native-tracker.ts:1042-1046` sets `deHasDriven` only
  when `pt.speedMps >= DE_STATIONARY_SPEED_MPS`, and `spd` defaults to 0 when
  `speedMps` is undefined (`:1042`). `maybeCloseDrive` returns immediately
  unless `deHasDriven` (`:527`). On the Android plugin that reports 0, and on
  iOS SLC fixes that report null, the fast-close never arms. The server-side
  segmenter deliberately fixed this same trap at
  `lib/mileage/segmentation.ts:136-143`; the client never did.
- **Effect**: Trips close late or not at all, and the walk-away fast-close is
  dead on the affected devices.
- **Detected?** No.
- **Recovered?** Partially: the server's parked test at
  `lib/mileage/finalize.ts:339-341` still closes trips after
  `TRIP_END_DWELL_MS`.
- **Severity**: High.

#### H8. Clock-skew correction keys off the batch maximum
- **Cause**: `app/api/mileage/ingest/route.ts:107-116`. `newestTs` is a
  `Math.max` reduce over the whole batch; `skewMs` is derived from it and
  subtracted from EVERY point. A single fix with a garbage far-future timestamp
  makes the entire batch shiftable and relocates every genuine point by the same
  large offset.
- **Effect**: An entire batch is filed at the wrong instant, potentially in the
  wrong tax year, and the drive it belonged to becomes unsegmentable or lands as
  a fabricated trip elsewhere in time.
- **Detected?** No. `isPlausibleTrip` catches only the impossible-average case.
- **Recovered?** No, the shift is applied before staging and is unrecoverable.
- **Severity**: High.

#### H9. A 2-to-30 minute offline backlog is relabelled as "now"
- **Cause**: `app/api/mileage/ingest/route.ts:105-116`. The guard against
  relabelling backlogs only applies beyond `MAX_BEHIND_SHIFT_MS` (30 minutes).
  A batch that is genuinely 20 minutes old, which is completely normal after a
  tunnel or a dead zone, is treated as clock skew and shifted forward to
  receipt time.
- **Effect**: Real points are relocated in time, interleaved with fresh points,
  and can collide with the identity unique index and be silently dropped
  (`:157-162`, `ignoreDuplicates: true`). Distance can be both lost and
  fabricated.
- **Detected?** No.
- **Recovered?** No.
- **Severity**: High.

#### H10. iOS native buffer is destroyed by any read failure
- **Cause**: `ios/App/App/TaxotticBackgroundLocation.swift:246-251`.
  `readBuffer` returns `[]` on any failure to read or decode. `append`
  (`:228-243`) calls `readBuffer`, appends one point and writes the result back
  with `.atomic` (`:253-256`). A truncated file, a disk error, a decode failure
  or a shape change therefore replaces days of buffered drives with a
  single-element array. There is no quarantine of the unreadable file and no
  error signal.
- **Effect**: Total silent loss of every drive captured while the WebView was
  not alive, which on iOS is the entire morning commute case this file exists
  to solve.
- **Detected?** No.
- **Recovered?** No.
- **Severity**: High.

#### H11. Approximate recovery consumes everything it did not use
- **Cause**: `lib/mileage/reconstruct.ts:274-282` marks every remaining
  unconsumed row between `sinceIso` and the last point's timestamp as consumed,
  with no `consumed_trip_id`. The window is 90 days when driven from the page
  (`app/mileage/page.tsx:377`).
- **Effect**: Points that a future finalize pass could have segmented into a
  real trip, including any in-progress drive, are permanently removed from the
  pool. One tap on Recover can destroy 90 days of unprocessed evidence.
- **Detected?** No.
- **Recovered?** No.
- **Severity**: High.

#### H12. `stale: true` accepts cached fixes on every start
- **Cause**: `lib/mileage/native-tracker.ts:1003`. Stale/cached fixes are
  accepted by default for all users, not just eco mode. On an OS-fused provider
  a cached last-known location can be returned repeatedly while the real GPS is
  asleep.
- **Effect**: `INFERRED` as a leading candidate for the Android 40 m box.
  If the plugin re-timestamps a cached fix, the buffer fills with hundreds of
  distinct rows all sharing one stale coordinate, which is exactly the observed
  signature. Distance lost, silently.
- **Detected?** No.
- **Recovered?** No.
- **Severity**: High.

#### H13. Idempotent upsert keeps the first row, not the best
- **Cause**: `app/api/mileage/ingest/route.ts:157-162` uses
  `ignoreDuplicates: true` on `(driver_user_id, company_id, captured_at)`. The
  first row to land for an instant wins. The migration that created the index
  chose the opposite tie-break for its own backfill, preferring best accuracy
  (`supabase/migrations/20260728000000_mileage_raw_idempotent.sql`, the
  `row_number()` ordering).
- **Effect**: When the JS path and the iOS native path both report the same
  instant, a 500 m junk fix can permanently shadow a 5 m one. Distance error in
  either direction.
- **Detected?** No.
- **Recovered?** No.
- **Severity**: High.

#### H14. The broken-trip reconciler ignores null-accuracy points
- **Cause**: `supabase/migrations/20260725000000_mileage_trip_source.sql`,
  `mileage_broken_trips` counts raw with `r.accuracy_m <= 100`, which is false
  for NULL in SQL. `buildTrackFromRaw` by contrast KEEPS null-accuracy fixes
  (`lib/mileage/track.ts:50` only rejects non-null values above the cap).
- **Effect**: A trip whose window is full of undrawn null-accuracy points is
  never flagged as broken, so the self-healing safety net does not fire for it.
- **Detected?** No, this IS the detector.
- **Recovered?** No.
- **Severity**: High.

#### H15. A 403 wedges the queue with no dead letter and no user signal
- **Cause**: `app/api/mileage/ingest/route.ts:133-138` returns 403 for
  `not_a_member`. The client's dead-letter branch handles only 400 and 413
  (`lib/mileage/native-tracker.ts:688`), and the auth banner is set only for 401
  (`:678-687`). A 403 therefore increments `failStreak`, keeps the batch, backs
  off to one attempt per 2 minutes (`:606-613`) and retries forever while the
  buffer grows to `MAX_BUFFER` and evicts (H4).
- **Effect**: Silent total capture loss after a company membership change or
  company-id drift, with the oldest points progressively destroyed.
- **Detected?** No.
- **Recovered?** No.
- **Severity**: High.

### MEDIUM

#### M1. Jitter suppression understates real distance
- **Cause**: `lib/mileage/track.ts:83-97`, described in detail above. The
  suppressed distance becomes the stored trip distance and deduction at
  `lib/mileage/finalize.ts:246-247`.
- **Effect**: Understated deduction, silent. Bounded per dwell because the
  anchor does escape once real displacement exceeds the noise radius.
- **Detected?** No.
- **Recovered?** No, and by design cannot be: `shouldReplaceTrack` guarantees a
  later pass will not shrink the point count, but it does not guarantee the
  distance is right.
- **Severity**: Medium.

#### M2. Render accuracy cliff and unfiltered fallback
- **Cause**: `lib/mileage/track.ts:76` drops anything worse than 60 m, while
  segmentation accepts up to 100 m (`lib/mileage/segmentation.ts:180`). If fewer
  than 2 points survive, `:101` falls back to the completely unfiltered set.
- **Effect**: Behaviour flips discontinuously between "aggressively cleaned" and
  "raw, including 100 m junk" based on how many points happened to survive.
  Distance error in either direction.
- **Detected?** No. **Recovered?** No. **Severity**: Medium.

#### M3 and M4. Two remaining UTC tax-year computations
- **Cause**: `lib/mileage/reconstruct.ts:232` uses
  `new Date(a.ts).getUTCFullYear()`, and `lib/mileage/finalize.ts:231` uses
  `new Date(startIso).getUTCFullYear()` as the fallback when `trip.tax_year` is
  null. `localTaxYear` (`finalize.ts:106-115`) exists precisely to fix this and
  is applied only on the insert path (`:493`).
- **Effect**: A US-evening drive on 31 December is filed to the following tax
  year, potentially into a return that has already been filed.
- **Detected?** No. **Recovered?** No. **Severity**: Medium.

#### M5. `localTaxYear` hardcodes America/Chicago fleet-wide
- **Cause**: `lib/mileage/finalize.ts:106-115`. Documented as the fleet default
  pending a per-company timezone.
- **Effect**: Wrong tax year for drivers in Hawaii-Aleutian or any non-US zone
  on the year boundary. Also affects the push notification's displayed time
  (`:608-611`).
- **Detected?** No. **Recovered?** No. **Severity**: Medium.

#### M6. Canary buckets by UTC day, trips are filed by Chicago year
- **Cause**: `app/api/cron/mileage-finalize/route.ts:391` and `:407` both slice
  ISO strings to get a UTC date. A US-evening drive's points and its trip land
  on the following UTC day.
- **Effect**: Day-over-day ratios are computed on misaligned buckets, which
  adds noise to an already conservative detector.
- **Detected?** N/A. **Severity**: Medium.

#### M7. Recovered approximate trips are not marked as user-authored
- **Cause**: `lib/mileage/reconstruct.ts:223-237` inserts without a `source`
  value, so it defaults to `tracked`
  (`supabase/migrations/20260725000000_mileage_trip_source.sql`). The backfill in
  that migration matches only the note prefix "Reconstructed from entered
  stops", which does not match the note this module writes
  (`reconstruct.ts:33-34`).
- **Effect**: The provenance guard at `lib/mileage/finalize.ts:185-192` does not
  protect these trips, so `renderTripFromRaw` can silently rewrite an
  approximate trip the user was told to verify.
- **Detected?** No. **Recovered?** No. **Severity**: Medium.

#### M8. `flushAdmission` is dead code
- **Cause**: `lib/mileage/buffer.ts:64-79` is exported and unit tested
  (`buffer.test.ts:73-107`) but never called. `flush()` reimplements the
  admission decision inline at `lib/mileage/native-tracker.ts:580-613`, with
  different conditions (a busy-wait loop rather than the `queue-session-end`
  result, and an inverted empty-buffer test at `:602`).
- **Effect**: The test suite gives false assurance about the code path that
  actually runs.
- **Detected?** No. **Severity**: Medium.

#### M9. `removeUploadedPoints` deletes by timestamp, not identity
- **Cause**: `lib/mileage/buffer.ts:32-34` builds a Set of sent timestamps and
  filters the whole buffer by it. Any buffered point that shares a millisecond
  with a sent point but was not itself in the batch is dropped unsent. Duplicate
  timestamps are reachable via the `Date.now()` fallback in `toPoint`
  (`native-tracker.ts:864`).
- **Effect**: Small silent loss. **Detected?** No. **Severity**: Medium.

#### M10. `toPoint` fabricates a timestamp when the plugin gives none
- **Cause**: `lib/mileage/native-tracker.ts:864` falls back to `Date.now()`.
- **Effect**: A batch of fixes delivered together all receive the same or nearly
  the same receipt time, collapsing under the identity index or producing a
  fabricated instantaneous displacement.
- **Detected?** Only the extreme case, by `isPlausibleTrip`
  (`finalize.ts:95-102`), and only at insert. **Severity**: Medium.

#### M11. Page-open finalize is raced but not cancelled
- **Cause**: `app/mileage/page.tsx:86-99` wraps `finalizeUserTrips` in a
  `Promise.race` with a 2.5 s timer. `Promise.race` does not cancel the loser.
  The finalize keeps running after the response is sent and can be torn down
  mid-loop by the serverless runtime.
- **Effect**: A teardown between `consumeRange` (`finalize.ts:561`) and
  `renderTripFromRaw` (`:568`) leaves points consumed but never drawn, which is
  the original straight-line bug.
- **Detected?** Yes, partially: `mileage_broken_trips` catches this, except for
  null-accuracy points (H14).
- **Recovered?** Yes, within one cron tick, subject to H14.
- **Severity**: Medium.

#### M12. Native drain uses the throttled WebView fetch and no batching
- **Cause**: `lib/mileage/device-status.ts:317-322` uses plain `fetch`, not the
  `postJson` native-HTTP helper that exists at
  `lib/mileage/native-tracker.ts:439-482` specifically to dodge Android's
  background WebView HTTP throttling. It also sends the entire buffer, up to
  20,000 points (`TaxotticBackgroundLocation.swift:63`), in one request with no
  `FLUSH_BATCH_MAX` equivalent.
- **Effect**: A large overnight buffer may never drain, and each failed attempt
  returns 0 with no signal.
- **Detected?** No. **Recovered?** Retried on next resume. **Severity**: Medium.

#### M13. `clearBuffered(upTo:)` can delete points that were never uploaded
- **Cause**: `ios/App/App/TaxotticBackgroundLocation.swift:270-276` deletes
  everything with `ts <= maxTs`. `maxTs` is computed before the upload
  (`device-status.ts:315`). Any fix appended during the request with an older
  timestamp, which SLC's delayed delivery makes possible, is deleted unsent.
- **Effect**: Small silent loss. **Detected?** No. **Severity**: Medium.

#### M14. Finalize pool pagination uses offsets over a mutating filter
- **Cause**: `lib/mileage/finalize.ts:278-307` pages with `.range(from, ...)`
  on a query filtered by `consumed_at is null`. A concurrent finalize run
  consuming rows shifts the offsets between pages, so rows can be skipped.
- **Effect**: A silently truncated pool leads to a fragmented or missing trip.
- **Detected?** No. **Recovered?** Next run, if the rows are still unconsumed.
- **Severity**: Medium.

#### M15. Cron pair scan can saturate
- **Cause**: `app/api/cron/mileage-finalize/route.ts:55,63-88`. The scan is
  capped at 50,000 rows. Saturation is only `console.error`ed at `:84-88`.
- **Effect**: On a busy fleet some drivers are never finalized on a given tick.
- **Detected?** No, log only. **Severity**: Medium.

#### M16. Unclassified trips are worth zero and nothing chases them
- **Cause**: `lib/mileage/segmentation.ts:300-313` returns `unclassified`
  whenever neither end matches a known place, and
  `lib/mileage/deduction.ts:78` returns 0 cents for anything not `business`.
  A push is sent once at materialisation (`finalize.ts:602-613`) but only when
  `opts.push` is true, which is false for the cron
  (`app/api/cron/mileage-finalize/route.ts:104`) and false for page open
  (`app/mileage/page.tsx:93`).
- **Effect**: Every trip recovered by the cron, which is the majority of the
  stranded-drive path this system exists for, is silently worth zero and
  never prompts the user. Money lost with no signal.
- **Detected?** No. **Recovered?** Only if the user browses the drive log.
- **Severity**: Medium, arguably high given the volume.

### LOW

#### L1. Short business drives are discarded as noise
`lib/mileage/segmentation.ts:96`, `MIN_TRIP_METERS = 200`. Legitimate short
business hops are dropped. Silent, undetected, unrecovered.

#### L2. Escalation pushes may be undeliverable on iOS
`INFERRED`, not verifiable from the repository. `lib/push/providers.ts:40-43`
gates APNs on four environment variables. If those are unset in the deployment,
`tracker_stalled` and `tracker_parked`
(`app/api/cron/mileage-finalize/route.ts:253,343`) reach nobody on iOS, which
would make the only push-based detection in the pipeline a no-op for the
platform with the worst capture reliability. Verify against the Vercel
environment before relying on either alert.

#### L3. `didFailWithError` is deliberately swallowed
`ios/App/App/TaxotticBackgroundLocation.swift:211-213` discards every
CoreLocation error with no counter and no breadcrumb, so a persistent failure is
indistinguishable from a quiet day.

---

## Cross-cutting observation

The pipeline has an unusually strong set of PURE, unit-tested decision functions
(`segmentation.ts`, `buffer.ts`, `fleet-canary.ts`, `stall.ts`,
`device-health.ts`, `drive-end.ts`, `track.ts`) and an unusually weak set of
edges around them. Almost every failure in this document lives in the wiring:
a tested function that is never called (M8), a detector with no output channel
(C4), a detector fed truncated input (C5), a counter that is incremented and
never read (H3, H4), a guard applied on one write path and not the sibling
path (C6, M3, M4), and a native layer that repeats the exact mistake the server
layer already learned not to make (C1, H7).

The single highest-leverage fix is not in the algorithms. It is giving the
canary and the per-driver zero-trip condition somewhere to speak, and adding a
per-driver check for "raw points arrived today, zero trips materialised", which
would have caught both of the incidents that prompted this document.
