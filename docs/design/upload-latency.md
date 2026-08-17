# Upload latency: why points arrive hours after capture

Status: **investigation complete, decision needed.** Nothing here is
built. The one-line summary is that the leading hypothesis was wrong,
and the real cause is cheaper to fix than the one we were braced for.

Written 2026-08-17. Every number below comes from a query against
production `mileage_points_raw`, `mileage_device_heartbeats` and
`mileage_device_status` over the 10 days ending 2026-08-17, not from
reading the upload code and reasoning forward.

---

## The headline measurement was real but mis-sampled

The finding that started this was taken by sampling the most recent 1000
`mileage_points_raw` rows by `created_at desc`:

| metric | reported 2026-08-16 |
|---|---|
| p50 capture-to-receipt | 328 min |
| p90 | 336 min |
| over 30 min | 981 / 1000 |

Re-running the identical query on 2026-08-17 gives p50 **13.3 min**, max
27.2 min, and **zero** rows over 30 min. Neither run is wrong. The
sampling method is what moves: "most recent 1000 by `created_at`" samples
whatever happens to be landing at that instant, and when a large backlog
drains, several thousand old points land in a few seconds and fill the
entire sample. The 2026-08-16 measurement caught a drain in progress.

Measured properly, per point, per day:

| day | points | p50 lag | p90 lag | max lag | <2 min | 2-30 min | >30 min |
|---|---|---|---|---|---|---|---|
| 08-07 | 929 | 22.6 m | 43.2 m | 20.5 h | 71 | 528 | 330 |
| 08-08 | 447 | 15.4 m | 40.6 m | 20.3 h | 112 | 229 | 106 |
| 08-09 | 3320 | 0.6 m | 28.5 m | 12.7 h | 2097 | 924 | 299 |
| 08-10 | 269 | 0.5 m | 31.2 m | 3.4 h | 149 | 90 | 30 |
| 08-11 | 1162 | 0.3 m | 0.5 m | 1.8 m | 1162 | 0 | 0 |
| 08-12 | 11888 | 145.3 m | 617.2 m | 10.6 h | 979 | 2411 | 8498 |
| 08-13 | 1857 | 0.3 m | 0.5 m | 6.9 h | 1855 | 0 | 2 |
| 08-14 | 114 | 0.3 m | 0.5 m | 3.3 h | 112 | 0 | 2 |
| 08-15 | 4546 | 116.6 m | 2544 m | 47.6 h | 737 | 13 | 3796 |
| 08-16 | 3122 | 176.3 m | 1539 m | 25.7 h | 1173 | 3 | 1946 |
| 08-17 | 5749 | 14.3 m | 102.7 m | 3.3 h | 1235 | 3215 | 1299 |

Across all 33,403 points in the window:

- **29.0 %** arrive within 2 minutes.
- **22.2 %** arrive in the 2 to 30 minute band.
- **48.8 %** arrive more than 30 minutes late, and for that population
  the median lag is **160 min** and p90 is **1451 min (24 h)**.

So the lag is not a uniform 5.5 hours. It is **strongly bimodal**: about
a third of points are effectively live, about half are delivered in a
bulk drain hours or a day later, and which mode a given day sits in
depends entirely on whether a drain happened to fall inside it.

---

## Where the delay is NOT

Three separate measurements rule out the upload path.

**1. The newest point in almost every batch is seconds old.** Grouping
`mileage_points_raw` by exact `created_at` (one value per insert
transaction, so one row group per accepted POST) and taking the freshest
point in each:

| day | batches | p50 newest-point lag | batches <2 min | 2-30 min | >30 min |
|---|---|---|---|---|---|
| 08-07 | 44 | 0.07 m | 42 | 0 | 2 |
| 08-09 | 188 | 0.09 m | 183 | 0 | 5 |
| 08-12 | 233 | 0.02 m | 230 | 0 | 3 |
| 08-15 | 334 | 0.02 m | 332 | 0 | 2 |
| 08-16 | 190 | 0.01 m | 187 | 0 | 3 |
| 08-17 | 115 | 0.01 m | 114 | 0 | 1 |
| **all 10 days** | **1593** | **~0.02 m** | **1571** | **0** | **22** |

1571 of 1593 batches carry a point captured less than two minutes before
the server received it. The client is posting, promptly, continuously.
A throttled uploader does not look like this.

**2. The JS buffer is empty.** `mileage_device_heartbeats.buffer_size`
over the same window: mean about 1, p90 of 0 to 7 depending on build,
and an all-time maximum of **266** against a `MAX_BUFFER` of 5000.
`fail_streak` is 0 on every heartbeat but one, which reported 1. Nothing
is queuing in `native-tracker.ts`, and nothing is failing to send.

**3. Single inserts carry more points than the JS buffer can hold.**
`FLUSH_BATCH_MAX` is 800, yet individual inserts of 3764, 2289, 2264 and
1630 points exist. Those cannot have come from the JS flush loop at all.

The `fetch`-versus-native-HTTP question is also settled and is not the
issue. `postJson()` in `lib/mileage/native-tracker.ts` already routes
through `CapacitorHttp` on device with a `fetch` fallback, shipped in
#455. **Cookie auth is not a blocker and has not been since 2026-07-28**:
an on-device probe showed a native POST and a WebView fetch to the same
authenticated endpoint returning an identical 403 `not_a_member`, a
status only reachable after the auth check passes. The memory note
claiming "no native HTTP uploader on either platform" is stale.

---

## Where the delay actually is

The backlog lives in a **native on-disk buffer that only drains when the
tracker starts.**

`mileage_device_heartbeats.geofence_buffered_fixes` is the smoking gun,
because it moves independently of `buffer_size`:

| reported_at | platform | buffer_size | geofence_buffered_fixes | capture | last_cb_age_s |
|---|---|---|---|---|---|
| 08-17 01:31 | ios | 0 | 832 | ended | 5584 |
| 08-17 01:46 | ios | 2 | 833 | ended | 1 |
| 08-17 01:51 | ios | 14 | 975 | capturing | 1 |
| 08-17 01:56 | ios | 9 | 1130 | capturing | 2 |
| 08-17 02:01 | ios | 13 | 1366 | capturing | 0 |
| 08-17 02:08 | ios | 8 | 1512 | capturing | 1 |
| 08-17 02:16 | android | 0 | 1630 | ended | (exit: low_memory) |

At 02:08 the JS layer is demonstrably healthy: location callbacks are
firing every second (`last_cb_age_s` 0 to 2), and the JS buffer is
draining normally at 8 to 14 points. Meanwhile **1512 fixes are sitting
in the native store, untouched.** The two 1630-point inserts landed at
02:16:31 and 02:16:32, matching the counter exactly.

The mechanism, traced in code:

- Android `TaxotticGeofenceStore.java` appends fixes to a JSONL file on
  disk. Its own comment states the reason: the resurrection service owns
  its capture and its buffer because the plugin discards fixes when the
  WebView's saved `PluginCall` is gone.
- iOS has the equivalent path in `TaxotticBackgroundLocation.swift`.
- Both are emptied only by `drainGeofenceBuffer()` in
  `lib/mileage/geofence.ts` and `drainNativeLocationBuffer()` in
  `lib/mileage/device-status.ts`.
- **Each has exactly one caller**, `native-tracker.ts:2056` and
  `:2021`, both inside the tracker start path.

So the drain fires on tracker start and at no other time. Critically,
`installAppStateWatch()` does not drain either: its `appStateChange`
handler only calls `refreshDeviceStatusCache()`. **A resume from
background does not drain the native buffer. Only a cold page load
does.**

That is the whole latency. Time-to-server is not bounded by network
conditions or OS HTTP policy. It is bounded by **when the app is next
cold-started**, which after an overnight process kill is the next
morning. It also explains the bimodality precisely: fresh callbacks
reach JS and upload in seconds, while everything captured by the native
resurrection path waits for a launch, however long that is.

### A secondary finding, worth recording but not the cause

`drainGeofenceBuffer()` posts with a raw `fetch`, not `postJson()`, so
the one upload that can carry a whole day of driving is the one that
does not use the native HTTP stack. In practice it fires at launch while
foregrounded, so it mostly succeeds, and no measurement here shows it
failing. It is an inconsistency, not the bug.

---

## Option A: Drain from the existing flush loop

Call `drainGeofenceBuffer()` on the flush tick and on `appStateChange`
`isActive`, instead of only at tracker start.

**Good**
- By far the smallest change. No new OS capability, no native HTTP, no
  background task, no auth work. It reuses a drain function that already
  exists, already handles read-then-confirm-then-consume, and already
  tolerates a failed consume.
- Directly addresses the case the data actually shows: the app **is**
  alive and flushing for long stretches while the native buffer grows
  untouched. The 01:51 to 02:08 window above would have drained on the
  first tick.
- Zero new failure surface on iOS, where the OS is least cooperative.

**Bad**
- Only helps while the app is running. It cannot shorten the tail after
  a `low_memory` kill or an overnight termination, which is where the
  24-hour p90 comes from.
- Adds a plugin round trip to a 30-second loop. `readBuffer()` reads the
  whole JSONL file, so it needs a cheap "is it empty" guard or a longer
  interval, or it becomes a battery regression.
- Reduces the median substantially and moves the p90 barely at all, so
  it will look like a smaller win on a percentile dashboard than it is
  in a driver's hands.

## Option B: Upload natively, from the service that captures

Have the Android foreground service and the iOS background handler POST
their own fixes, bypassing JS entirely.

**Good**
- The only option that bounds latency without the app being launched.
  On Android the resurrection service is already running, already a
  foreground service, and already holds the fixes.
- Cookie auth is genuinely available: Android can read the session from
  `android.webkit.CookieManager`, iOS from `WKHTTPCookieStore`.

**Bad**
- Duplicates auth, retry, batching and token refresh into two native
  codebases, and they have to keep working without any JS running. Token
  refresh without the Supabase client is the part that will rot.
- **On iOS it does not deliver what it promises.** After a termination
  only SLC, region and visit events relaunch the app, with roughly a
  10-second budget and no dependable network, per the platform rules we
  already documented. `BGProcessingTask` is opportunistic: the OS
  typically runs it charging and on wifi, often overnight. That is not
  "the driver checks the app after a trip".
- Biggest build, in the two codebases with the slowest release cycle, to
  fix a latency whose median cause Option A already covers.

## Option C: Accept the lag and make everything downstream lag-aware

Stop treating "recent point" as "recent event". Make the parked test,
tail-close and the finalize window reason explicitly about
`captured_at`, and tell the driver when drives are waiting.

**Good**
- Honest. No option removes the tail, so the freshness assumptions are
  wrong today and stay wrong under A and B. This work is needed
  regardless of which of A or B is chosen.
- Fixes the actively misleading part: heartbeats arrive within a minute,
  so device health reads current while the mileage behind it is hours
  old. A driver told "2 drives are waiting to upload, open the app" both
  understands the app and triggers the drain, which is Option A's
  benefit acquired for free.
- Cheapest per unit of confusion removed.

**Bad**
- Does nothing about latency itself. A driver who opens the app after a
  trip still sees nothing, they just see a better explanation of
  nothing.
- Touching the finalize window is genuinely risky. Those tests exist
  because trips were closing wrongly, and making them lag-aware means
  re-deriving thresholds we currently only trust empirically.

---

## Recommendation

**A, then C. Not B, at least not first.**

1. **Now: Option A.** Drain the native buffer from the flush tick and on
   foreground resume, gated on a cheap emptiness check. The evidence
   that this is the right first move is that the buffer grows for
   17 minutes and more while the JS thread is provably healthy and
   flushing every 30 seconds. This is a bug of a missing call site, not
   an OS constraint, and it should be measured before anything larger is
   designed.
2. **Next: Option C**, scoped to visibility only at first. Surface
   pending native fixes in the app and in device health, so the
   heartbeat stops implying the mileage is current. Defer changing the
   finalize thresholds until A has been in the field long enough to show
   what the residual tail actually looks like.
3. **Only then reconsider B**, and only for Android, and only if the
   post-A p90 still justifies it. iOS should be assumed to keep a long
   tail permanently.

**Do not start at B.** It is the largest build, it lands in the two
slowest codebases, and on iOS it cannot deliver the property it is being
bought for. Its case rests on a residual we have not measured yet
because Option A has never been tried.

---

## What this does not solve

- **The overnight tail.** After a `low_memory` kill with the app closed,
  nothing in A or C moves the points until the driver opens the app. The
  observed p90 of 24 hours is dominated by exactly this, and only B
  touches it, and only on Android.
- **Capture gaps.** Everything here is about points that were captured
  and are waiting. A point never captured is a different problem, and
  the subject of `docs/design/self-healing-capture.md`.
- **The clock-skew shift is still un-exercised, and that is not the same
  as passing.** `SKEW_TOLERANCE_MS` is 2 min and `MAX_BEHIND_SHIFT_MS`
  is 30 min, so the shift fires only when a batch's newest point is
  between 2 and 30 minutes behind receipt. Across **1593 batches over 10
  days, exactly zero** fell in that band. The reason is sharper than
  "everything is hours late": the newest point in a batch is almost
  always **under two minutes old** (p50 about 0.01 min), so batches pass
  *below* the window, while drains pass *above* it. The condition sits
  in the gap between the two modes and has never occurred. Task #97
  therefore cannot be concluded from production data. What can be said,
  and is worth saying, is that a full census found **zero duplicate rows
  across all 33,403 fixes** in the window, on `(driver, captured_at,
  lat, lng)`, maximum copies 1. That is evidence of no duplicates. It is
  not evidence that the fix works, because the code path never ran.
  Option A would make it run, by moving drains into the 2 to 30 minute
  band for the first time, which is a reason to watch duplicates closely
  when A ships rather than a reason not to ship it.

## Open questions for the decision

1. How long is an acceptable worst case for a driver seeing a completed
   drive? Until that number exists, there is no way to say whether the
   post-A tail justifies B's cost.
2. Should the app prompt the driver to open it when fixes are pending,
   and does that survive the same trust budget as every other
   driver-facing prompt?
3. Is a permanently long iOS tail acceptable as a product property, or
   is it a reason to change what the app promises about promptness?
4. Draining on the flush tick makes drains far more frequent and much
   smaller. Does the finalizer behave well under many small late batches
   rather than a few enormous ones? Nothing measured here answers that.

Related: `lib/mileage/geofence.ts`, `lib/mileage/native-tracker.ts`,
`lib/mileage/device-status.ts`, `lib/mileage/clock-skew.ts`,
`android/app/src/main/java/com/taxottic/app/TaxotticGeofenceStore.java`,
`ios/App/App/TaxotticBackgroundLocation.swift`.
