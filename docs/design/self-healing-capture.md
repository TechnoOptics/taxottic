# Self-healing mileage capture: three approaches

Status: **decided, steps A and B built.** Step C is not.

- **Step A shipped.** `lib/mileage/device-stall.ts`, and the finalize
  cron escalates on a `dead=` self-check verdict.
- **Step B shipped.** `lib/mileage/self-repair.ts`. The device repairs
  the two verdicts it safely can, capped and reported on the heartbeat
  in `self_repair` / `self_repair_attempts`.
- **Step C not started.** Expectations and the reconciler.

The three open questions at the bottom of this document were answered by
the owner and are recorded there.

Written 2026-08-16, immediately after a night that produced an unusually
complete failure taxonomy. Every claim below is grounded in production
data from that session rather than in what the architecture was supposed
to do.

---

## What actually breaks, measured

Six distinct failure modes reached production. They are not variations of
one problem, and a design that treats them as one will fix the cheap ones
and miss the expensive ones.

| # | Failure | Evidence | Self-heals today? |
|---|---|---|---|
| 1 | Native plugin compiled but never registered | iOS `device_probe=error`, stage `call`, 1 ms, 64 push attempts, `device_tokens` ios=0 since July | No. Needed a store build. |
| 2 | JS timers freeze while backgrounded | `timer_lag_ms` observed at 54,455,326 ms (15 h) and 2,329,489 ms (39 min) | Partly. Capture rides location callbacks. |
| 3 | OS kills the process | Android `LOW_MEMORY` at importance 400 | Yes, via geofence + boot receiver. |
| 4 | Device setting throttles us | `low_power_mode=true` on the phone whose drives went missing | No. Nothing told the driver. |
| 5 | Batch timestamps rewritten in flight | 203 coordinates re-delivered at a constant +1157 s | Now prevented, not healed. |
| 6 | **Instrumentation nobody reads** | push cause sat in `push_registration_state` for **9 days** | No, and this is the expensive one. |

**Mode 6 is the real target.** Modes 1 through 5 were each found by a
human running a query. The system had the answer in every case and never
volunteered it. A "self-healing" architecture that still requires someone
to think of the right `SELECT` has not healed anything.

A second observation worth designing around: **absence is the universal
symptom.** Dead plugin, frozen timer, killed process, throttled radio and
missing token all present as a null column or an empty table. The system
cannot currently distinguish "nothing happened" from "nothing was
recorded", and that ambiguity, not any individual bug, is what cost
weeks.

---

## Approach A: Watchdog cron with escalation

A server-side job runs every N minutes, evaluates each driver's expected
versus actual capture, and escalates: silent repair, then push to the
driver, then alert the manager.

**Mechanism.** Extend the existing `mileage-finalize` cron. It already
reads `mileage_device_status` and knows the last heartbeat, the last
point, and now `self_check`.

**Good**
- Smallest step. The cron, heartbeat and self-check all exist.
- Server-side, so it works when the device is asleep, dead or throttled.
- Naturally fixes mode 6: the system reads its own instrumentation.

**Bad**
- Cannot repair anything on the device. It can only notice and nag.
- Escalation policy is where these designs rot. Too eager and drivers mute
  it, at which point it is worse than nothing.
- Needs a clear notion of "expected", which is genuinely hard: a driver
  who did not drive today looks identical to one whose tracker died.

**Fixes:** 1 (detect), 3 (detect), 4 (detect + instruct), 6 (**yes**).
**Misses:** 2, 5.

---

## Approach B: Device-side supervisor

An on-device loop that verifies its own capabilities each launch and after
each OS event, repairs what it can (re-arm geofences, re-request
permissions, restart the foreground service), and reports what it cannot.

**Mechanism.** Promote `self-check.ts` from a reporter to an actor. Each
`dead` verdict gets a repair attempt; each `degraded` gets a driver-facing
prompt.

**Good**
- Repairs rather than reports. A disarmed geofence re-arms without anyone
  noticing it broke.
- Closest to the phrase "self-healing".
- Mode 4 becomes a prompt at the moment it matters.

**Bad**
- **Cannot fix the failure that has cost the most.** Modes 1 and 6 are
  invisible from inside a broken app: a dead plugin cannot report that it
  is dead, and that is exactly what happened on iOS for six weeks.
- Runs where the environment is least reliable: frozen timers, killed
  processes, throttled radios.
- Repair loops are dangerous. A supervisor that restarts a service which
  immediately dies burns battery and generates the noise it exists to
  remove.

**Fixes:** 2 (partly), 3, 4.
**Misses:** 1, 6. Both are the expensive ones.

---

## Approach C: Contract-and-reconcile (recommended)

Treat capture as a **contract with an expected observable**, and make
every gap between expectation and observation a first-class row rather
than an absence.

**Mechanism.**
1. The device declares what it *should* be doing: tracking on, N
   geofences armed, heartbeat every 5 min, these capabilities live.
2. The server records that declaration as an **expectation with an
   expiry**.
3. A reconciler compares expectations against observations and writes a
   `capture_gap` row naming the specific unmet expectation.
4. Gaps route by who can fix them: device-repairable → command to the
   device; driver-fixable → prompt; ours → alert us.

**Good**
- **Turns absence into a row**, which is the root problem behind all six
  modes. A dead plugin does not need to report; the expectation it failed
  to meet is already recorded.
- Fixes mode 1 without a working plugin, and mode 6 by construction,
  because a gap is generated rather than waiting to be queried.
- Subsumes A and B: the reconciler is A, the device-repairable route is B.
- The existing `self_check` verdicts (`live`/`dead`/`denied`/`degraded`/
  `unknown`) are already the right vocabulary.

**Bad**
- Biggest build of the three. New table, new reconciler, device changes.
- An expectation that is wrong generates false gaps, and false gaps are
  exactly the noise that gets alarms muted. The expiry semantics have to
  be conservative.
- Needs care not to become a second source of truth alongside
  `mileage_device_status`.

**Fixes:** 1, 3, 4, 6 fully; 2 and 5 detected, not prevented.

---

## Recommendation

**C, built in the order A → B → C**, because A is a genuine subset of C
and delivers the highest-value fix (mode 6) first.

Concretely:

1. **Now.** Extend the finalize cron to read `self_check` and raise an
   alert on any `dead` verdict. Small, and it closes the nine-day gap.
2. **Next.** Add device-side repair for the two verdicts that are
   safely repairable (`geofence_armed`, `location_always` re-prompt),
   with a hard attempt cap so it cannot loop.
3. **Then.** Introduce expectations and the reconciler, and migrate the
   cron's ad-hoc checks onto it.

**Do not start at C.** Its value depends on the expectation model being
right, and we would be guessing at it today. Steps 1 and 2 produce the
data that tells us what the expectations should be.

---

## What this does not solve

Honest boundaries, so nobody expects otherwise:

- **Mode 5** (timestamp rewriting) is a pipeline correctness problem,
  already fixed at source in `lib/mileage/clock-skew.ts`. No amount of
  healing substitutes for not corrupting the data.
- **Mode 2** (frozen timers) is an OS behaviour. It can be ridden (gate on
  wall clock, ride location callbacks) but not fixed.
- **Mode 1** required a store build. Nothing on-device could have repaired
  an unregistered plugin. What C changes is the *detection* latency: six
  weeks becomes one heartbeat.

## The three questions, answered

Decided by the owner. Build against these rather than re-litigating them.

1. **Prompt eagerness.** Prompt the driver only for `degraded`: a device
   setting they control and can fix in ten seconds. Never for `dead`,
   which is our bug, and telling a driver about it makes them distrust
   the app while being unable to act on it. At most one prompt per
   condition per week, permanently dismissible.
2. **Manager visibility.** A manager sees tracking health only: `dead`
   and silence. Never location, never drive detail, never `degraded` or
   `denied`, and nothing at all for a driver in personal mode. Ours
   versus theirs: the manager sees our failures, the driver sees their
   own settings.
3. **"Expected capture" for a driver who did not drive.** Do not define
   it. Alarm on CONTRADICTION, not absence. Tracking enabled plus a
   fresh heartbeat plus zero location callbacks for 30 minutes is a
   fault. Tracking enabled with no points and no heartbeat is a closed
   app. Silence alone is never evidence.

Answer 1 is why `self-repair.ts` rations the Always re-prompt to one a
week and three ever, and why nothing in step B puts a `dead` verdict in
front of a driver. Answer 3 is already the rule `device-stall.ts`
implements: it refuses to judge a device whose heartbeat is stale.

Related: `lib/mileage/self-check.ts`, `lib/mileage/clock-skew.ts`,
`app/api/cron/mileage-finalize/route.ts`.
