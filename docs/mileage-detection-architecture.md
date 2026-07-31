# Automatic drive detection architecture (multi-signal, confidence scored)

Status: design document, written 2026-07-30. Nothing here is implemented.
Sections marked INCOMPLETE were not finished before the writing window
closed and are flagged rather than guessed at.

Verification discipline for this document: every platform claim is tagged
`[verified-code]` (read in this repo or in `node_modules`), `[verified-doc]`
(read from vendor documentation), or `[UNVERIFIED]`. Two previous
implementation efforts on this project went down dead ends because a
background-execution claim was asserted confidently and was wrong, so an
`[UNVERIFIED]` tag here is a hard instruction: prove it on a device before
building on it.

The two research documents referenced in the brief,
`docs/research-mileage-tracking-2026.md` and `docs/mileage-fmea.md`, do not
exist in this checkout. The established findings summarised in the brief are
carried forward as given but are not re-derived here.

---

## 1. The failure this design is for

The failure is NOT degraded fidelity. It is total blackout.

| Driver | Date | Dark for | Capture either side |
|---|---|---|---|
| Abel (Samsung, Android) | Jul 30 | 16.6 h | full fidelity |
| Abel | Jul 28 | 21.6 h | full fidelity |
| Grace (iOS) | recent | 19.6 h | full fidelity |
| Grace | prior | 27 h | full fidelity |

Blackouts end only when the user reopens the app. Abel's device captured
932 points in one hour at up to 75 mph the day before a blackout, and holds
22,943 consumed points; Grace holds 34,981 and three correctly created
trips. The pipeline works. The process dies and never comes back on its own.

Explicitly discarded as a premise: the "387 points in a 40 metre box"
reading. Those are an overnight parked phone at home. At a 25 m distance
filter (`lib/mileage/native-tracker.ts:144`) roughly 50 fixes per hour of
stationary GPS drift is normal and expected, not a wedged state machine.

Consequence for this document: **trip-start precision is the second
problem. Re-arm after process death is the first.** A confidence score
computed by a process that is not running scores nothing. Section 4 is
therefore the load-bearing section, and Section 9 (self-heal) outranks
Section 6 (scoring) in implementation priority.

---

## 2. What the current stack actually is

Correcting the record, because the design depends on it.

- Plugin is `@capgo/background-geolocation` **8.0.35**
  (`node_modules/@capgo/background-geolocation/package.json`). Not
  Transistorsoft. `[verified-code]`
- There is **no moving/stationary state machine**, no `stationaryRadius`,
  no `stopTimeout`, and no activity-recognition machinery anywhere in the
  plugin or in this repo. `[verified-code]`
- Android capture is raw `LocationManager.GPS_PROVIDER` with `minTime`
  1000 ms and `minDistance` = our `distanceFilter`
  (`BackgroundGeolocationService.java:239`). It is **not** the fused
  provider. Satellite only, no Wi-Fi/cell assist for the fix itself.
  `[verified-code]`
- `stale: true` (`native-tracker.ts:1011`) maps on Android to a single
  `fetchLastLocation` fused call at start
  (`BackgroundGeolocation.java:110-112`), not to an ongoing behaviour.
  `[verified-code]`
- iOS already has a real native, WebView-independent capture and disk
  buffer: `ios/App/App/TaxotticBackgroundLocation.swift`, armed from
  `AppDelegate.swift:25` via `restoreOnLaunch()`. It is correctly
  registered in the project file (`ios/App/App.xcodeproj/project.pbxproj`
  lines 12, 68, 126, 269), so unlike the earlier `TaxotticDeviceStatusPlugin`
  incident it is genuinely compiled in. `[verified-code]`
- **Android has no equivalent.** This is the single largest structural
  asymmetry in the codebase.

### 2.1 The Android delivery path is a WebView-owned single point of failure

This is the most important code finding in this document.

`BackgroundGeolocationService` broadcasts each fix locally. The plugin
receives it and does:

```java
// BackgroundGeolocation.java:522-537
String id = intent.getStringExtra("id");
PluginCall call = getBridge().getSavedCall(id);
if (call == null) {
    return;                      // <-- fix is silently discarded
}
```

`[verified-code]`

Every captured Android fix is routed through a Capacitor `PluginCall` that
was created by a JavaScript `start()` call and kept alive with
`setKeepAlive(true)` (`BackgroundGeolocation.java:100`, `:104`). That call
lives in the bridge, and the bridge lives in the Activity.

Therefore, on Android:

1. If the Activity/WebView is destroyed while the foreground service
   survives, `getSavedCall` returns null and **every fix is dropped on the
   floor with no buffer, no log, and no error surfaced to anyone**. The
   foreground-service notification stays visible, so the user and the app
   both believe tracking is healthy.
2. If the process dies and `START_STICKY` restarts the service in the
   background, no JavaScript ever runs, so no `start()` is ever issued, so
   there is no saved call id at all. Same outcome: service alive, capture
   dead.
3. On Android 14+, a `START_STICKY` restart that tries to re-promote a
   `location`-type foreground service without usable
   `ACCESS_BACKGROUND_LOCATION` throws `SecurityException` or runs with
   location stripped. `[verified-doc, per coordinator]` This is a
   documented route from one process death to indefinite silent death.

That is an exact match for the observed blackout signature: silent, total,
multi-hour, ends only when the user reopens the app (which rebuilds the
bridge and issues a fresh `start()`).

The existing JS watchdog (`native-tracker.ts:1212-1256`) cannot fix this,
because the watchdog is itself JavaScript. When the WebView is gone, the
watchdog is gone. It is a watchdog inside the thing it is watching.

### 2.2 Samsung sleeping apps

Samsung's own developer documentation states that apps unused for roughly
three days enter "sleeping" mode, in which "features such as Job, Alarm,
and Foreground-service are restricted". `[verified-doc, per coordinator]`
Abel is on a Samsung.

There is **no API that reports this state.** Design implication: it can
only be inferred (expected wake did not happen) and must be surfaced to the
user as a device-level warning with manufacturer-specific remediation
steps, never silently absorbed.

---

## 3. The two-tier split (the crux)

A confidence score requires a running process. Signals therefore divide
into two tiers that must never be confused:

- **Tier 1, WAKE SOURCES.** Events the OS will use to start or resume our
  process. Small, platform-dictated, non-negotiable. If a signal is not on
  this list it cannot start a trip, no matter how predictive it is.
- **Tier 2, CONFIRMATION SIGNALS.** Everything read once awake, used to
  decide whether this is a drive, to score confidence, and to classify.

Rule: **no Tier 2 signal may ever be load-bearing for starting a trip.**
A Tier 2 signal can only raise or lower confidence in a trip that a Tier 1
event already started. Getting this backwards is how "Bluetooth is the most
reliable signal" turns into a design that never fires, because on iOS
classic Bluetooth cannot wake you.

### 3.1 iOS wake sources

| Wake source | Wakes terminated app | Wakes suspended app | Execution budget | Entitlement / mode | Confidence |
|---|---|---|---|---|---|
| Significant location change (`startMonitoringSignificantLocationChanges`) | Yes | Yes | ~10 s, no network expected | `Always` auth, `UIBackgroundModes: location` | `[verified-code]` in use today at `TaxotticBackgroundLocation.swift:93`; Apple DTS guidance cited in the file header says it survives user swipe-away |
| Region monitoring / geofence (`startMonitoringForRegion`) | Yes | Yes | ~10 s | `Always` auth | `[verified-doc]` Apple documents relaunch on region transition. Not currently used. **This is the single highest-value unused wake source we have.** |
| Visit monitoring (`startMonitoringVisits`) | Yes | Yes | ~10 s | `Always` auth | `[verified-code]` in use at `TaxotticBackgroundLocation.swift:101`. Departure events are system-computed and free. Latency is poor (visits are often reported well after the fact) |
| `startUpdatingLocation` | **No** | Yes (while running) | continuous | `Always` + background mode | `[verified-code]` documented in the file header: "If your app is terminated, the delivery of new location events stops altogether." Never treat this as a wake source |
| CoreBluetooth central with State Preservation and Restoration | Yes | Yes | short restore window | `UIBackgroundModes: bluetooth-central` (NOT currently declared, `Info.plist` has only `location`) | `[verified-code]` for the missing background mode. `[UNVERIFIED]` for behaviour. **BLE only. Classic car audio Bluetooth (A2DP/HFP) is invisible to CoreBluetooth.** For most cars this wake source does not exist |
| `AVAudioSession` route change to a car audio port | `[UNVERIFIED]` | `[UNVERIFIED]` | `[UNVERIFIED]` | would need `UIBackgroundModes: audio` | **Must be device-tested before any design depends on it.** The plausible reading is that a route-change notification reaches a *suspended* app only if the app holds an active audio session, which a WebView tax app does not. Do not build on this until proven |
| CarPlay connection | `[UNVERIFIED]` | `[UNVERIFIED]` | n/a | CarPlay entitlements are granted by Apple per app category; a mileage tracker is unlikely to qualify | Treat as unavailable. Even if it worked it covers a small fraction of vehicles |
| `CMMotionActivityManager` | **No** | No | n/a | `NSMotionUsageDescription` (present) | Motion activity has **no wake capability** on iOS. It is queryable history only. Tier 2 only |

**iOS conclusion: there are exactly three trustworthy wake sources, and
all three are CoreLocation.** SLC, region monitoring, and visits. Every
other candidate is either unverified, entitlement-blocked, or documented as
non-waking. The iOS design is therefore: keep SLC and visits (already
live), and **add region monitoring around learned places**, which is the
one real gain available.

Additional iOS constraint already recorded in the code: Background App
Refresh being off means iOS relaunches us for no location event at all, and
SLC plus geofences both go silent with no error to log
(`native-tracker.ts:813-817`). It is read and transmitted today. Good.

### 3.2 Android wake sources

| Wake source | Wakes killed process | Survives Doze | Survives OEM manager | Permission | Confidence |
|---|---|---|---|---|---|
| Foreground service that is still alive | n/a (already alive) | Yes | **No** (Samsung sleeping apps restricts foreground services) | `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` (both declared) | `[verified-code]` manifest lines present |
| `START_STICKY` service restart | Yes, but into a state with no JS and no saved call | Partially | No | n/a | `[verified-code]` for the null-call drop; `[verified-doc, per coordinator]` for the Android 14+ SecurityException. **Currently a source of zombie state, not recovery** |
| Geofence transition (`GeofencingClient`) via `PendingIntent` to a `BroadcastReceiver` | Yes | Yes (geofence is a system-level trigger) | Mostly, but OEM managers can delay | `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION` (both declared) | `[verified-code]` the plugin already ships `GeofenceBroadcastReceiver` and a `GeofenceBootReceiver` registered for `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED` in its own manifest, and delivers via `notifyListeners(..., true)` (retained), which is a **fundamentally better delivery path than the saved-call path** because retained events survive until a listener attaches (`BackgroundGeolocation.java:539-556`) |
| `ActivityRecognitionClient.requestActivityTransitionUpdates` (IN_VEHICLE enter) via `PendingIntent` | Yes | Yes | Mostly | `ACTIVITY_RECOGNITION` runtime permission on API 29+ | **Blocked by policy, not by technology.** The manifest comment records that Google Play refuses the release when this permission ships alongside a truthful "no health features" declaration. See Section 8.3 |
| `BluetoothDevice.ACTION_ACL_CONNECTED` | `[UNVERIFIED]` | `[UNVERIFIED]` | `[UNVERIFIED]` | `BLUETOOTH_CONNECT` runtime permission on API 31+ (not declared) | Android 8+ blocks most implicit broadcasts from manifest-declared receivers. Whether ACL_CONNECTED is on the exemption list must be **device-tested per API level** before use. If it is exempt this is the strongest Android wake source available; if not it is Tier 2 only |
| `BOOT_COMPLETED` | Yes (on boot only) | n/a | OEM managers sometimes block | `RECEIVE_BOOT_COMPLETED` (declared by the plugin's manifest) | `[verified-code]`. Covers reboot, not the blackout case |
| `AlarmManager.setExactAndAllowWhileIdle` | Only if process is restartable | Yes, this is the documented Doze escape hatch | **No** on Samsung sleeping apps (alarms explicitly restricted) | `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` (not declared) | `[verified-doc]` for the Doze exemption; `[verified-doc, per coordinator]` for the Samsung restriction. Useful as a heartbeat, unreliable as a guarantee |
| `WorkManager` periodic work | Yes | Deferred, batched | No | none | Minimum period 15 min, and it is the first thing OEMs starve. Detection floor only, never a capture mechanism |

**Android conclusion: the wake story is geofences plus alarms, and both
are OEM-defeatable.** The honest position is that Android cannot be made
unconditionally reliable on Samsung, so the design must *detect* the dead
state and tell the user, which is Section 9.

### 3.3 What this split means for the proposed signals

| Proposed signal | Tier |
|---|---|
| Bluetooth connected to car | iOS: Tier 2 only (classic BT invisible to CoreBluetooth). Android: Tier 1 **if and only if** ACL_CONNECTED broadcast delivery is proven, else Tier 2 |
| CarPlay / Android Auto | Tier 2 both platforms (entitlement-blocked on iOS; unverified on Android) |
| Vehicle-speed movement | Tier 2 everywhere. Speed is only visible once we are already running |
| Step counter says not walking | Tier 2. iOS `CMPedometer` cannot wake. Android blocked by Play policy |
| Wi-Fi disconnect from known network | Tier 2. Not a wake source on either platform |
| On a road, not a parking lot | Tier 2, and server-side at that |
| Charging state / car USB | Tier 2 on iOS. Android `ACTION_POWER_CONNECTED` is an implicit broadcast with the same API 26+ manifest-receiver problem, so `[UNVERIFIED]` as Tier 1 |
| Accelerometer vibration signature | Tier 2, and expensive. See 5.4 |
| Barometric elevation profile | Tier 2, low value. See 5.5 |
| Compass heading stability | Tier 2 |
| Screen-off plus sustained motion | Tier 2 |
| Learned geofences (home / office / habitual parking) | **Tier 1 on both platforms.** This is the single most valuable addition in this document |
| Learned time-of-day commute pattern | Tier 1 *scheduler*, not a signal: it schedules a pre-arm, it does not observe anything. See 5.7 |
| Calendar event at client address | Tier 2, classification only, never detection |

---

## 4. The re-arm and self-heal design (highest priority)

Question to answer: what wakes the app when nothing is moving and the
service is already dead?

Honest answer: **nothing, on either platform, until something in the
physical world changes.** There is no OS mechanism that says "your dead
process should be alive now" in the absence of a trigger. So the design
cannot promise continuous liveness. It must instead guarantee that the
*next physical event* re-arms us, and that the *gap* is detected and
reported.

### 4.1 Layer A: make every wake source re-arm everything

On any wake, from any source, the very first thing the native code does,
before any capture decision, is re-register **all** wake sources. iOS
already does this correctly (`TaxotticBackgroundLocation.restoreOnLaunch()`
re-calls both `startMonitoringSignificantLocationChanges` and
`startMonitoringVisits` on every launch,
`TaxotticBackgroundLocation.swift:90-102`). Android has no equivalent and
needs one.

The property to preserve: any single surviving wake source restores all the
others. That turns N fragile mechanisms into a mesh where one hit repairs
the whole net.

### 4.2 Layer B: Android needs a native, WebView-independent capture path

This is the direct fix for Section 2.1 and the highest-value single change
in this document.

Build the Android mirror of `TaxotticBackgroundLocation.swift`:

- A native service that requests location itself (fused provider, not raw
  `GPS_PROVIDER`) and writes fixes to a **native disk buffer**, exactly as
  iOS does today.
- Persist "tracking enabled" and `companyId` in `SharedPreferences` so a
  cold background start knows to re-arm without asking JavaScript, mirroring
  `TaxotticBackgroundLocation.swift:51-52`.
- JavaScript drains the buffer on next open, which is the mechanism that
  already exists on the JS side (`drainNativeLocationBuffer()`,
  `native-tracker.ts:1385`) and is already wired to a plugin method
  (`lib/mileage/device-status.ts:36`).

Effect: a destroyed WebView stops being data loss and becomes upload
latency. Late points are already fine, because the finalizer runs a 45-day
window and reconciles (`TaxotticBackgroundLocation.swift:36-40`).

This alone converts an unknown fraction of the observed blackout hours from
"lost" to "delivered late". It does not fix a killed *process*, but it
fixes the killed *WebView*, which the `getSavedCall` null path makes
indistinguishable from the outside today.

### 4.3 Layer C: geofence mesh as the resurrection net

Register a small set of geofences (see 5.6) around learned places. On both
platforms a geofence transition is delivered by the system to a process it
will start for the purpose. On Android the plugin's existing
`GeofenceBroadcastReceiver` plus retained `notifyListeners` is the right
delivery shape already. On iOS, region monitoring joins SLC and visits.

The important property: a geofence around **home** means that a phone which
died overnight in the driveway is resurrected by the act of driving out of
the driveway, which is exactly the missing-morning-commute complaint. SLC
alone requires roughly 500 m of travel before it fires; a 150 m home
geofence exit fires far sooner and, crucially, fires even if the process is
dead.

### 4.4 Layer D: expected-wake accounting (the detection floor)

Since Samsung's sleeping state has no API, infer it:

1. The device knows the learned commute schedule (5.7). Before a habitual
   departure window, it should have woken.
2. Server-side, compare each driver's expected wake events against actual
   heartbeats. `mileage_device_status` already exists
   (`supabase/migrations/20260711130000_mileage_device_status.sql`) and the
   heartbeat already carries `exitReason`, `exitAtMs`, `backgroundRefresh`,
   `batteryOptimized`, `lowPowerMode` (`native-tracker.ts:809-824`).
3. A missed expected wake escalates: in-app banner, then push, then manager
   visibility. The existing 3 h stall alarm is the backstop; the expected
   wake check should fire far sooner because it knows when to look.

**Blackout must become a first-class, named, reported state.** It is
currently invisible until someone reads the points table.

### 4.5 Layer E: what we will not claim

We will not claim continuous background liveness on Android. The
degraded-mode ladder (Section 8) exists precisely so that a device we
cannot keep alive tells its user so, in plain language, with a one-tap
manual-add fallback. Every vendor in this market ships a manual-add
fallback, and no vendor publishes a capture rate. We should match the
fallback and beat them on the honesty.

---

## 5. Confirmation signals, weights, and failure modes

Weights are on a 0 to 100 evidence scale. They are additive within a
decision window and are deliberately not equal.

| Signal | iOS API / permission | Android API / permission | Weight | False positives | False negatives | Permission cost |
|---|---|---|---|---|---|---|
| Car Bluetooth connected (known device) | `AVAudioSession.currentRoute` outputs for classic BT; CoreBluetooth only sees BLE | `BluetoothAdapter` + `BLUETOOTH_CONNECT` (API 31+, not currently declared) | **+45** | Passenger in own car; connecting to test audio while parked; car BT stays connected while parked with ignition accessories on | Car has no Bluetooth; user uses a cable; phone BT off; rental or borrowed vehicle | Android needs a new runtime prompt (`BLUETOOTH_CONNECT`). Justified: this is the strongest single confirmation available. iOS route inspection needs no new prompt |
| Vehicle-speed movement sustained (>= ~7 m/s for >= 60 s) | CoreLocation | fused provider | **+40** | Passenger in a car, bus, train, cyclist downhill | Stop-and-go city driving never sustains; tunnel/urban canyon dropout | None beyond existing location |
| Learned-place geofence exit (home/office/parking) | region monitoring | `GeofencingClient` | **+30** | Walking the dog out of the home radius | Parking in an unlearned place; radius too large | None beyond existing location |
| Movement is road-snapped (not a parking lot or footpath) | server-side | server-side | **+25** | Road-adjacent footpaths and cycle lanes | Rural or unmapped roads; poor map coverage | None (server-side, no device permission) |
| CarPlay / Android Auto connected | entitlement-blocked, treat as unavailable | `[UNVERIFIED]` | **+40 if present** | none meaningful | Most vehicles do not have it | iOS: unobtainable entitlement. Do not build |
| Not walking (step rate near zero during motion) | `CMPedometer`, `NSMotionUsageDescription` (present) | **blocked**, `ACTIVITY_RECOGNITION` refused by Play policy | **+15** | Phone in a bag while walking registers few steps | Phone in a pocket during a drive picks up road vibration as steps | iOS: already granted. Android: unavailable |
| Screen off plus sustained motion | app lifecycle | app lifecycle | **+10** | Phone in pocket while a passenger | Driver using phone mount with screen on (navigation), which is common | None |
| Charging state changed to charging | `UIDevice.batteryState` | `BatteryManager` / `ACTION_POWER_CONNECTED` | **+10** | Plugging in at a desk | Wireless-only car charging still reads as charging (fine); no car charger at all | None. TripLog ships this as "Plug-N-Go", so it is a proven-enough idea, but it is weak alone |
| Wi-Fi disconnected from known home/office SSID | needs `com.apple.developer.networking.wifi-info` entitlement plus location permission for SSID reads | `WifiManager` + location permission | **+8** | Wi-Fi drops for router reasons; user walks out of range | User's car is in Wi-Fi range of the house; phone stays on cellular anyway | iOS entitlement request plus a stronger location justification. **Not worth the ask at weight 8.** Recommend: infer "away from known network" only from data already held, do not request the entitlement |
| Compass heading stability | `CLHeading` | `SensorManager` rotation vector | **+8** | Highway walking in a straight line | Urban driving with frequent turns is not stable | None. Cheap, weak |
| Accelerometer road-vibration signature vs gait | `CMMotionManager` | `SensorManager` accelerometer | **+15 potential** | `[UNVERIFIED]` classifier, unvalidated | needs training data we do not have | High battery cost for continuous sampling. This is what Cambridge Mobile Telematics does with raw three-axis data and dedicated engineering. **Recommend: do not build in this phase.** Revisit only with labelled data |
| Barometric elevation smoothness | `CMAltimeter` | `Sensor.TYPE_PRESSURE` (not on all devices) | **+5** | Weather fronts change pressure; elevator rides | Flat terrain gives no signal at all | Low value. **Recommend: skip** |
| Calendar event at a known client address | EventKit, calendar permission | Calendar provider, permission | **0 for detection** | n/a | n/a | A calendar permission prompt for a *classification* nicety is a bad trade. Use it only if the user already connected a calendar for another reason. Classification only, never detection |

### 5.4 On the accelerometer classifier

It is the most technically interesting option and the worst value per unit
of effort at this stage. It needs continuous high-rate sampling (battery),
a labelled dataset (we have none), a trained classifier (new infrastructure),
and it is Tier 2 anyway, so it cannot fix the blackout. Park it.

### 5.5 On barometric pressure

Same conclusion, less upside. Skip.

### 5.6 Learned geofences (build this)

Cluster the historical points we already have into places. The data exists:
Abel has 22,943 consumed points and Grace 34,981. A simple density
clustering over trip endpoints yields home, office, and habitual parking
with no new permissions and no new user input.

Register the top N places (N small, both platforms cap monitored regions;
iOS is 20 per app, `[verified-doc]`) as exit-triggered geofences with a
radius of roughly 100 to 200 m. Exit is the wake, entry is the stop hint.

This is Tier 1, needs no new permission, uses data we already have, and
directly attacks the missing-morning-commute complaint. It is the best
idea in this document.

### 5.7 Learned schedule (pre-arm, not a signal)

A real user complaint is "it always misses her drives to work in the
morning". The schedule is not evidence about the current moment; it is a
reason to be awake at a particular time.

Use it two ways:

1. **Pre-arm.** Before a habitual departure window, escalate from cheap
   monitoring to armed monitoring. On iOS this is limited (there is no
   general "run my code at 07:40" primitive; `BGProcessingTask` scheduling
   is opportunistic and cannot be relied on for a punctual arm,
   `[UNVERIFIED]` as to whether it ever lands close enough to a target time
   to matter). On Android, `setExactAndAllowWhileIdle` is the documented
   Doze escape hatch, but is restricted under Samsung sleeping apps.
2. **Expected-wake accounting** (4.4). Even where pre-arm fails, the
   schedule tells the server when to *expect* a heartbeat, which converts
   silent failure into a reported one. This second use is reliable even
   when the first is not, and is the reason to build the schedule model
   regardless.

Note there is an existing `lib/mileage/schedule.ts` in the repo which was
not read before the writing window closed. Check it before building a
second schedule model. INCOMPLETE.

---

## 6. Scoring and state machine

Weighted evidence, not a flat count of three. A flat count is wrong here
for a specific reason: the signals are not independent and are not equally
strong. Car Bluetooth alone is better evidence than screen-off plus
charging plus Wi-Fi-drop combined, and a flat count would rank those
equally at three signals versus one.

### 6.1 States

```
DORMANT        no wake source has fired; only Tier 1 monitors registered
ARMED          a Tier 1 wake fired; process running; ring buffer recording;
               score being accumulated
TRACKING       score >= START_THRESHOLD; full-fidelity capture; trip open
SETTLING       movement stopped; stop timers running; trip still open
CLOSED         trip finalised server-side and eligible for retrospective prune
```

### 6.2 Thresholds

- `ARM_THRESHOLD` = any Tier 1 event. No score required. Arming is cheap.
- `START_THRESHOLD` = **35**. Deliberately low: one strong signal, or two
  medium ones, is enough. Rationale in Section 7.
- `HIGH_CONFIDENCE` = **70**. Trip is recorded normally.
- `LOW_CONFIDENCE` = 35 to 69. Trip is recorded but tagged
  `confidence: low` and surfaced to the user at a labelled lower tier
  (Section 10), never dropped.
- Below 35 after the arm window expires (suggest 3 minutes): stand down to
  DORMANT, keep the ring buffer contents for the retention window, record
  a diagnostic counter. No trip.

### 6.3 Negative evidence

Score is not monotonic. Subtract:

- Sustained walking-speed track with off-axis drift: **-40** (this logic
  already exists and is unit-tested in `lib/mileage/drive-end.ts:133-159`).
- Total displacement under 300 m after 5 minutes armed: **-30**.
- Track never leaves a single parking polygon: **-25**.

### 6.4 Where the score is computed

Prefer the server. The device's job stays "stream raw points", which is the
stated architecture (`lib/mileage/native-tracker.ts:1-8`) and is the right
call: the server has the whole track, road snapping, and history, and it is
where the existing unit-tested segmentation lives. The device computes only
the subset needed to decide whether to escalate to full-fidelity capture
right now.

---

## 7. Eager start with retrospective prune: RECOMMENDED

Recommendation: **yes, adopt it.** Reasoning, including the costs.

The asymmetry is real and decisive. A missed trip start is unrecoverable
and the user cannot even tell it happened. A false start is fully
recoverable at finalize time, when we have the complete track, the whole
speed distribution, and road snapping. Competitors tune the other way and
pay for it visibly: Driversnote openly logs bike rides, TripLog logs
jogging. They accept those because their alternative (suppression) loses
real drives, which is worse.

Our position is strictly better than theirs, because the pre-trigger ring
buffer means an eager start costs almost nothing in recovered miles: we
backfill the origin either way.

Costs, honestly:

- **Battery.** This is the real cost. Eager start means escalating to
  full-fidelity GPS on weak evidence, sometimes wrongly. Mitigation: the
  arm window is short (3 minutes) and standing down is cheap. The current
  25 m distance filter and `stale: true` already keep the duty cycle
  moderate. Estimated additional cost: a handful of extra 3-minute GPS
  windows per day. Acceptable.
- **Storage.** Negligible. A 3-minute armed window at 25 m filter is tens
  of points. The staging table already holds tens of thousands of points
  per driver and has a retention cron
  (`supabase/migrations/` retention work, per `MILEAGE_RELIABILITY_PLAN.md`
  section 3A).
- **User trust, if a pruned false positive is briefly visible.** This is
  the one that matters, and it is manageable *only if* pruning happens
  before the user sees the trip. Design rule: **a trip below
  `HIGH_CONFIDENCE` is not shown as a confirmed trip until finalize has
  run and pruning has had its chance.** Low-confidence trips appear in a
  distinct "needs review" tier from the start (Section 10) and are never
  presented as established fact and then retracted. Silent retraction of a
  thing the user already saw as a fact is what destroys trust; showing an
  uncertain thing as uncertain does not.

There is an IRS-record dimension too: a fabricated business mile is a worse
error than a missing one, from an audit standpoint. That is an argument for
pruning aggressively and for never auto-classifying a low-confidence trip
as business, not an argument against eager start.

---

## 8. Degraded-mode ladder

Every rung degrades **visibly**. Nothing on this ladder is silent.

| Rung | Condition | Behaviour | What the user sees |
|---|---|---|---|
| 0 | All wake sources armed, permissions full | Full multi-signal detection | Nothing (silence means healthy) |
| 1 | No car Bluetooth pairing known | Location-only wake mesh, thresholds unchanged | Optional one-time prompt: "Pair your car for faster trip start" |
| 2 | Android: ACTIVITY_RECOGNITION unavailable (policy) | GPS walk-away detection (already built, `drive-end.ts:143-153`) replaces step counting | Nothing. This is a supported path, not a break |
| 3 | iOS: location downgraded from Always to While Using | Native revival disarmed. Detect immediately via `locationManagerDidChangeAuthorization` (already wired, `TaxotticBackgroundLocation.swift:219`) | Non-dismissible banner, one-tap deep link to the exact settings page (already built, `openLocationSettingsPrecise`) |
| 4 | iOS: Background App Refresh off | SLC and geofences go silent with no error | Explicit banner naming Background App Refresh. Already transmitted (`native-tracker.ts:817`), needs the banner |
| 5 | Android: battery optimization on / Samsung sleeping apps suspected | Cannot be fixed by us | Manufacturer-specific wizard (Samsung steps when `manufacturer=samsung`), re-verified on every open because Samsung re-enables sleeping apps after firmware updates |
| 6 | Expected wake missed (4.4) | Blackout suspected | Named "tracking was asleep from HH:MM to HH:MM" notice with a one-tap manual add pre-filled for the gap |
| 7 | Location permission denied entirely | No automatic tracking at all | Tracking toggle shows OFF and disabled, with manual add promoted to the primary action. Never show a toggle that says ON while capturing nothing |

Rung 7 states the principle for the whole ladder: **the toggle must never
say ON while the system is dead.** That is the current bug, and it is what
made a 21-hour blackout invisible.

### 8.3 On ACTIVITY_RECOGNITION and Play policy

The manifest records the decision and the reasoning: Play rejects a binary
shipping `ACTIVITY_RECOGNITION` alongside a truthful "no health features"
declaration, and we will not file a false declaration for a convenience
feature. That decision stands. It costs us the single best Android Tier 1
wake source (`requestActivityTransitionUpdates` on IN_VEHICLE enter), which
is worth re-litigating with Play only if the geofence mesh proves
insufficient in the field. Do not re-add the permission speculatively.

---

## 9. Pre-trigger ring buffer

Purpose: recover the miles lost between the true start of a drive and the
moment detection fires. Vendor thresholds cluster at 4 to 15 mph with a 1 to
2 minute confirmation window, so the start of every drive is structurally at
risk. TripLog backfills from buffered pre-trigger data; so should we.

Design:

- **What is retained:** raw fixes only (lat, lng, ts, speed, accuracy), the
  same `GpsPoint` shape used everywhere else
  (`lib/mileage/segmentation.ts`).
- **How long:** a rolling 10-minute window, or 200 points, whichever is
  smaller. Ten minutes comfortably covers the worst realistic detection
  latency plus the walk-to-car and warm-up period.
- **Where:** native disk on both platforms, so it survives process death.
  iOS reuses the existing buffer file
  (`TaxotticBackgroundLocation.swift:53`, currently capped at 20,000
  points, which already exceeds what a ring buffer needs). Android needs
  the buffer built (4.2).
- **Cost:** 200 points is on the order of 20 KB of JSON. Power cost is the
  real cost, since retaining a buffer means sampling while dormant. Sample
  the ring buffer at the cheap tier only (SLC-class fixes on iOS, fused
  balanced-power on Android), not at full fidelity. The ring buffer is a
  low-resolution safety net, not a second tracker.
- **Backfill:** on transition to TRACKING, prepend the ring buffer contents
  to the trip and mark them `source: prebuffer`. The server's existing
  idempotent ingest (unique on driver + company + captured instant, per
  `TaxotticBackgroundLocation.swift:39-40`) means re-posting overlapping
  points is free. Origin selection then uses the earliest point that is
  either (a) above stationary speed or (b) at the last known parked place,
  whichever is earlier.
- **On stand-down:** if the arm never reaches `START_THRESHOLD`, discard
  the buffer contents rather than uploading them. Do not accumulate a
  permanent low-resolution record of the user's whole life. This is both a
  privacy position and a storage one.

---

## 10. Stop detection

The failure mode to design against: MileIQ splits one journey into several
when stopped for 10 to 15 minutes. Traffic, fuel stops, and drive-throughs
are all normal parts of one trip.

Current behaviour: the server closes on a 5-minute parked dwell; the client
force-closes on walk-away (steps, iOS only), on a GPS walk-away signal
(both platforms), or on a 12-minute stationary timeout
(`drive-end.ts:32`, `:133-159`). The anti-traffic guards (hard-stop arming,
off-axis bearing test) are already well thought out and field-corrected.
Keep all of it.

What to add:

1. **Stop classification, not a single timer.** Score the stop, the same
   way we score the start:
   - Engine-proxy still connected (car Bluetooth still paired, still
     charging): strong evidence the trip is *not* over. Suppress closing.
     This is the single most valuable addition, because it directly solves
     fuel stops and drive-throughs: you do not disconnect from the car to
     buy petrol.
   - Stop location snaps to a fuel station, drive-through, or traffic
     signal polygon: suppress closing for a longer window.
   - Walk-away detected: close immediately (already built).
   - Stop location is a learned place (home, office): close confidently.
2. **Merge-on-review rather than split-and-hope.** When two trips end and
   start within a short window at the same place with the car signal
   unbroken, offer a merge at review time rather than guessing. Vendors
   get this wrong by committing to a split silently.
3. **Never split an IRS record on a weak signal.** The existing comment in
   `drive-end.ts:84-85` states the principle correctly:
   correct-but-slower beats fast-but-wrong.

INCOMPLETE: specific dwell thresholds per stop class are not proposed here.
They should be derived from the existing 22,943 and 34,981 point corpora
rather than invented.

---

## 11. What is surfaced when confidence is low

Borrowing Life360's pattern: record the lower-confidence event at a
labelled lower tier rather than dropping it silently.

- Trips at `LOW_CONFIDENCE` appear in a **"Needs review"** group, visually
  distinct, never mixed into confirmed trips.
- Each carries a plain-language reason: "Started from an unrecognised
  place", "No car connection detected", "Speeds were unusually low for
  driving".
- One tap confirms, one tap rejects. A rejection is training data for the
  learned-places and learned-schedule models.
- Blackout gaps (rung 6) appear as an explicit gap card: "No tracking
  between 08:12 and 09:40", with a pre-filled manual add. A gap the user
  can see and fill is infinitely better than a gap they discover at tax
  time.
- Nothing in this tier is auto-classified as business.

---

## 12. Phased implementation plan, ordered by value per unit of effort

### Phase 1 (ships this week, no new permissions, no store review risk)

All server-side or existing-permission work. This is the phase that
addresses the actual observed failure.

1. **Blackout detection and reporting.** Server-side job over
   `mileage_device_status` and the points tables: for each driver, detect
   contiguous silence exceeding a threshold during their historically
   active hours, and raise it. Turns invisible 21-hour blackouts into a
   named, alertable event. No client change at all.
2. **Gap cards in the UI.** Show detected gaps to the driver with a
   pre-filled manual add. Web-only change, ships through the normal
   deploy, no app build. Remember to bump `sw.js` `CACHE_VERSION` in the
   same PR (see the project convention on stale WebView caches).
3. **Fix the "toggle says ON while dead" lie.** The client already knows
   `lastCbAt` (`native-tracker.ts:288`) and `failStreak`. Surface an
   explicit "tracking has not reported since HH:MM" state in the toggle UI
   instead of a plain ON. Web-only.
4. **Learned places, computed server-side.** Cluster existing trip
   endpoints into home/office/habitual parking per driver. Pure server
   work on data we already hold. It produces the geofence list that Phase
   2 consumes, and it immediately improves classification.

Phase 1 ships nothing to the app stores and fixes the visibility half of
the problem, which is the half that lets a 21-hour blackout go unnoticed.

### Phase 2 (next app build, high value, low policy risk)

5. **Android native capture and disk buffer** (4.2). The largest single
   fix. Removes the `getSavedCall` null-drop path entirely.
6. **Geofence mesh on both platforms** (4.3, 5.6), consuming Phase 1's
   learned places. iOS region monitoring alongside existing SLC and visits;
   Android via the plugin's existing geofence receivers.
7. **Re-arm-everything-on-any-wake** (4.1) on Android, matching what iOS
   already does.
8. **Pre-trigger ring buffer** (Section 9), riding on the Phase 2 native
   buffers.

### Phase 3 (scoring)

9. Weighted score and state machine (Section 6), server-side.
10. Eager start with retrospective prune (Section 7).
11. Low-confidence review tier (Section 11).
12. Stop classification (Section 10).

### Phase 4 (permission-gated, only if Phases 1 to 3 leave a real gap)

13. Android `BLUETOOTH_CONNECT` and car-device confirmation, after
    device-testing the ACL_CONNECTED broadcast delivery question.
14. iOS `AVAudioSession` car route as confirmation, after device-testing
    whether it is observable at all from a backgrounded WebView app.

Explicitly not planned: accelerometer classifier, barometer, Wi-Fi SSID
entitlement, CarPlay entitlement, calendar permission for detection.

---

## 13. Honest limits

What will still be missed, and must therefore be detected and reported
rather than promised away:

1. **A Samsung device in sleeping mode.** No API detects it, and it
   restricts foreground services, jobs, and alarms. If the OS decides not
   to run us, nothing in this architecture runs. Mitigation is detection
   (4.4), user-facing manufacturer steps (rung 5), and manual add.
2. **iOS after a force-quit with Background App Refresh off.** Both of the
   remaining wake mechanisms go silent, and the OS reports no error.
   Detection only.
3. **A drive that starts and ends entirely inside a geofence-free,
   SLC-threshold-sized area.** Short local drives under roughly 500 m are
   structurally hard to detect and may never fire a wake source.
4. **The first drive after any permission change** until the user reopens
   the app, because the change itself disarms the mesh.
5. **Passenger trips.** Nothing in this signal set distinguishes driver
   from passenger. Bluetooth to *your own* car is the closest proxy and it
   is not proof. These will be logged and must be user-correctable.
6. **The first N days for a new user**, before learned places and learned
   schedule have data. Detection quality ramps rather than starting good.
7. **Battery-drained or powered-off phone.** Obvious, but worth stating in
   user-facing copy since it is a real cause of gaps.

The product commitment that follows: we do not promise to catch every
drive. We promise that **when we miss one, the user finds out the same
day**, with a one-tap way to add it. No competitor publishes a capture
rate, and every one of them ships a manual-add fallback, which tells you
what they actually believe. Our differentiator should be that our gaps are
visible and theirs are not.

---

## 14. Open items and things this document did not finish

- INCOMPLETE: `lib/mileage/schedule.ts` was not read. Check it before
  building a second schedule model (5.7).
- INCOMPLETE: per-stop-class dwell thresholds (Section 10).
- `[UNVERIFIED]` and requiring device tests before any dependent work:
  Android `ACTION_ACL_CONNECTED` implicit-broadcast delivery to a
  manifest-declared receiver, per API level; iOS `AVAudioSession` route
  change observability from a suspended app; iOS `BGProcessingTask`
  punctuality for schedule pre-arm; Android Auto connection detectability.
- Not evaluated: whether the `@capgo` plugin's geofence API is
  well-behaved enough to build the mesh on, or whether the mesh should be
  implemented in our own native code alongside
  `TaxotticBackgroundLocation.swift` and its Android counterpart. Given
  that the plugin's location delivery path has a silent-drop bug
  (Section 2.1), the default assumption should be "own it ourselves"
  unless the geofence path proves solid.
