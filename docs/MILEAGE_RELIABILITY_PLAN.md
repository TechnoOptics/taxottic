# Mileage tracking reliability plan (launch hardening)

Written 2026-07-11 after a week of real-device incidents and a three-way
audit (native stack, server pipeline, industry research). Goal:
"bulletproof" = every failure mode is prevented where possible, detected
within MINUTES where not, and never loses a drive silently.

## 1. Observed failure taxonomy (all reproduced on team devices)

| # | Mode | Incident | Status |
|---|------|----------|--------|
| F1 | iOS silently reverts Always→While Using ("provisional Always" by design) | Grace 2x, 17h dead | Detect: server stall push (3h) only. Native detection = workstream C |
| F2 | Android OEM battery starvation (Samsung sleeping apps + wake-lock limits) | Abel, chronic sparse capture | NO countermeasure today. Workstream C |
| F3 | Zombie watcher (toggle ON, service dead; re-arm is launch/resume-only) | Abel Jul 11 | Workstream B watchdog |
| F4 | Points buffered on device until next app open | Abel: 27h late | Mitigated (FGS flush); full fix = C heartbeat awareness |
| F5 | Upload auth decay: 401 retried silently forever; 4xx poison batch blocks queue head; oldest points shed at 5k cap | audited | Workstream B |
| F6 | Recovery artifacts (duplicates, straight lines) | Abel | FIXED #376/#382/#383 + tests |
| F7 | Stale WebView client (SW cache) | Grace | FIXED #384 + convention memory |
| F8 | Finalize concurrency race → duplicate trips + double deductions (3 triggers, no lock, no unique constraint) | audited (latent) | Workstream A |
| F9 | Data-integrity gaps: no GPS-accuracy filter (phantom distance), device clock skew unclamped, raw table grows unbounded, stranded points immortal | audited (latent) | Workstream A |

## 2. Principle: layered time-to-detection
The OS always wins eventually. Trustworthy ≠ never fails; trustworthy =
the driver knows within minutes and one tap fixes it.
Layers: on-device (resume/authorization listeners, watchdog) → device
heartbeat telemetry → server silence alarm (live today, 3h backstop).

## 3. Workstreams

### A. Server pipeline correctness (this PR)
- Unique index `mileage_trips(driver_user_id, started_at)` + conflict
  handling in finalize: the race's loser consumes to the winner instead of
  double-inserting. (F8)
- Extract finalize's overlap decision into a pure, unit-tested function.
- GPS accuracy filter in segmentation (drop fixes > 100 m accuracy). (F9)
- Clamp future device timestamps at ingest (> now+2min → receipt time). (F9)
- Retention cron: purge consumed raw points > 30 d; sweep stranded
  unconsumed > 45 d. (F9)
- Fix stagingRemaining diag field mismatch.

### B. Client tracker resilience (next PR)
- flush(): ensure fresh session before POST; on 401 refresh-and-retry
  once, then surface a re-login banner and back off (no silent forever
  loop). Quarantine 400/413 poison batches so the queue drains. Count and
  surface buffer evictions. (F5)
- In-process watchdog: while enabled + foregrounded, if no plugin callback
  for 10 min → auto stop/start re-arm (bounded), diag counter. (F3)

### C. Device-state truth + guided setup (native; ships with next app build)
- Thin native plugin (Swift + Kotlin, WidgetBridge precedent): exact
  location authorization (always/whenInUse/denied), precise-location flag,
  iOS backgroundRefreshStatus + Low Power Mode, authorization-CHANGE
  events (locationManagerDidChangeAuthorization), Android manufacturer.
  (F1 detection at the moment of downgrade, not 3h later.)
- `@capawesome-team/capacitor-android-battery-optimization` for
  isBatteryOptimizationEnabled / requestIgnoreBatteryOptimization /
  settings intent; manifest gains REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
  (Google's acceptable-use list covers "core function breaks under
  Doze" — mileage tracking is the canonical case; prep the Play FGS
  declaration video). (F2)
- Device heartbeat: app POSTs device state (authorization, toggle, buffer
  size, last-fix age, battery-exemption, versions) on open/resume/toggle +
  periodically while tracking → `mileage_device_status`; server alerts
  IMMEDIATELY on authorization≠always or battery-optimized while enabled
  (new push kind), distinct from the 3h silence stall. Manager-visible
  per-driver tracking health. (F1/F2/F4 detection floor → minutes)
- Recurring "tracking health" setup wizard (Samsung-specific steps when
  manufacturer=samsung; re-verify on every open — Samsung re-enables
  sleeping-apps after firmware updates).

### D. Phase 2 (post-launch, architectural)
- Trigger-armed GPS like every incumbent (MileIQ/Everlance/TripLog):
  idle = significant-location-change + parked geofence + activity
  recognition; drive = full GPS. Options: Transistorsoft's commercial
  Capacitor plugin (built exactly for this) vs extending @capgo with a
  small activity-recognition layer. Also: iOS parked-location geofence is
  the ONLY relaunch path after force-quit (Apple forum guidance) — the
  @capgo plugin's unused geofencing supports this today.
- Property-style segmentation tests (fuzzed traces, invariants: no
  overlaps, idempotent re-runs, distance never negative).

## 4. Launch gate checklist
- [ ] A merged: race-proof finalize, accuracy filter, retention, tests
- [ ] B merged: no silent upload failure states
- [ ] C merged + new native build shipped: minutes-level detection + wizard
- [ ] Play Console: FGS location declaration + video; location permissions declaration
- [ ] Both team phones pass the wizard green and survive a 48h soak with zero manual toggles
