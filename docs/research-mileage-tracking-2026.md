# Automatic mileage tracking: platform research, 2026

Research date: 2026-07-30. Scope: first-party platform mechanics for background
location on iOS and Android, for a Capacitor 8 app whose WebView points at a
remote URL.

Section 4 (what commercial mileage apps do and admit they cannot do) was
researched separately by a parallel workstream and is deliberately not
duplicated here. See the notes carried into section 4 below for the handful of
conclusions that the architecture section depends on.

Live symptoms this research is trying to explain:

- Android (Samsung): 387 GPS points logged during a full day of real driving,
  all inside a 40 metre bounding box. Nothing captured while moving.
- iOS: 45 sparse points across 29 km with null speeds. Zero trips materialised
  on either platform.

---

## 1. Executive summary: the factors that most determine whether tracking works

Ranked by impact on capture rate.

**1. Whether location is collected by native code or by the WebView.**
This is almost certainly the root cause on Android and a major contributor on
iOS. Android throttles HTTP requests initiated from a WebView after roughly 5
minutes in the background, and WebView `setTimeout`/`setInterval` are documented
as unreliable and arbitrarily delayed or cancelled when backgrounded
(https://github.com/nodekit-io/nodekit-android/issues/16). `navigator.geolocation.watchPosition`
is documented as not working in the background on Android 8 and above
(https://bugzilla.mozilla.org/show_bug.cgi?id=1482733). Any design where the
page collects points and posts them is structurally incapable of capturing a
drive. Collection and upload must both be native.

**2. Whether a correctly typed foreground service is running on Android for the
whole drive.** Without one, "the location system service computes a new location
for your app only a few times each hour ... even when your app is requesting
more frequent location updates"
(https://developer.android.com/about/versions/oreo/background-location-limits).
With one, sampling is unrestricted. This single bit flips Android between
"works" and "logs the same coordinate hundreds of times".

**3. Whether the app polls a cache instead of subscribing to updates.**
`getLastLocation()` "doesn't make a location request, it simply returns the
location most recently obtained" and "uses a local cache that won't update
automatically"
(https://developer.android.com/develop/sensors-and-location/location/retrieve-current).
Polling it, or calling `navigator.geolocation.getCurrentPosition` with a
permissive `maximumAge`, produces exactly the observed pathology: hundreds of
near-identical points. Independent field report of the same symptom, including
the tell that opening Google Maps "unlocks" the frozen coordinate:
https://www.b4x.com/android/forum/threads/problems-with-fused-location.137536/

**4. iOS `pausesLocationUpdatesAutomatically`.** It defaults to `true`. Once
Core Location pauses, resumption is not something you can rely on. Every
production configuration found in the wild sets it to `false`. Detail in
section 2.1. This is a live-bug candidate for the iOS side.

**5. OEM battery layers, Samsung in particular.** Samsung stacks Adaptive
Battery, Background app limits, App power management, Deep sleeping apps and
"Put unused apps to sleep", and re-adds apps to restriction lists after firmware
updates even when the user previously removed them
(https://dontkillmyapp.com/samsung). A correct foreground service is necessary
but not sufficient on Samsung. There is no developer-side API that fixes this;
it requires an in-app remediation flow that walks the user through OEM settings.

**6. Authorisation completeness and its silent decay.** On Android, missing
`ACCESS_BACKGROUND_LOCATION` prevents starting a location foreground service
from the background at all
(https://developer.android.com/develop/background-work/services/fgs/service-types).
Missing `ACTIVITY_RECOGNITION` on API 29+ makes activity detection fail
silently. On iOS, users can revoke or downgrade Always without any signal to the
app, and turning off Background App Refresh kills relaunch entirely.

**7. iOS termination and relaunch reality.** Only significant-location-change,
region monitoring and visit monitoring relaunch a terminated app, and the
relaunch budget is on the order of 10 seconds
(https://developer.apple.com/forums/thread/701377). Standard continuous updates
do not survive termination. This is why the iOS symptom looks like an SLC
fallback: because that is all that is left running.

**8. Buffering and native upload.** Whatever is captured must be written to disk
synchronously and uploaded by native HTTP, because the WebView is throttled and
the app may be killed mid-drive. A design that holds points in JS memory loses
the whole trip on process death.

---

## 2. iOS: mechanisms, guarantees, recommended configuration

### 2.1 `pausesLocationUpdatesAutomatically` (priority question)

Established facts:

- The property defaults to `true`. When enabled, Core Location pauses location
  updates when it judges that doing so saves power, typically when the device
  has been stationary
  (multiple secondary sources; Apple's own doc page is JS-rendered and could not
  be read directly, see section 7).
- With `.whenInUse` authorisation, a measured report puts the pause at roughly
  16 to 17 minutes of stationary time, with update frequency decreasing before
  the pause
  (https://developer.apple.com/forums/thread/763696).
- `locationManagerDidPauseLocationUpdates(_:)` is not reliably called. Reports
  from iOS 13 onward describe the pause happening during background tracking
  with the delegate callback never firing
  (https://developer.apple.com/forums/thread/124048,
  https://developer.apple.com/forums/thread/20468).
- Resumption is the dangerous part. Apple's model is that the system resumes on
  its own when it detects movement again, but field reports of updates pausing
  and never resuming are common, including cases where the property was already
  set to `false`
  (https://developer.apple.com/forums/thread/75072,
  https://developer.apple.com/forums/thread/717291).
- Testing on a device tethered to Xcode or on charge suppresses the pause,
  because iOS sees no reason to save power. This is why the bug does not
  reproduce in development
  (https://developer.apple.com/forums/thread/124048).

Correct handling:

1. Set `pausesLocationUpdatesAutomatically = false` unconditionally for drive
   tracking. Do not rely on the system's judgement about when a car has stopped.
   Every library configuration found in the wild does this, and Transistor's SDK
   documents it as the way to stop iOS turning location services off
   (https://github.com/transistorsoft/react-native-background-geolocation/issues/1871).
2. Do not depend on `locationManagerDidPauseLocationUpdates(_:)` firing. Instead
   run an independent watchdog: record the timestamp of the last delivered
   location, and if the gap exceeds a threshold (60 to 120 seconds while a trip
   is believed to be in progress), call `stopUpdatingLocation()` followed by
   `startUpdatingLocation()` to force a restart. Treat a pause as a fault to be
   recovered from, not an event to be observed.
3. Implement your own stop detection instead: end the trip when speed stays
   under threshold for a stop timeout, then explicitly de-escalate. This gives
   you the battery saving that auto-pause was meant to provide, but under your
   control and with a known resume path.

Caveat to be honest about: setting the flag `false` is necessary but has not
been shown to be sufficient. There are credible reports of background updates
ceasing after 40 minutes to 2 hours even with pausing disabled
(https://developer.apple.com/forums/thread/75072). The watchdog is therefore not
optional.

### 2.2 `CLActivityType`

- `.automotiveNavigation` means positioning in a vehicle following a road
  network. `.otherNavigation` covers movement that may not follow roads: boats,
  trains, off-road, scooters
  (https://developer.apple.com/documentation/corelocation/clactivitytype/othernavigation,
  as summarised in search results; the doc page itself is JS-rendered).
- `.automotiveNavigation` causes Core Location to snap coordinates toward the
  road network, correcting some GPS scatter. That is generally desirable for
  mileage, but it means the raw points you store have already been altered.
- Activity type does **not** act as a filter. It does not mean "only give me
  locations when the device is moving in a way matching this type". It tunes
  accuracy and pausing heuristics only. This is an important correction to a
  common misconception
  (https://developer.apple.com/forums/thread/763696).
- Activity type interacts directly with auto-pause: it is the input the system
  uses to decide when a stop is "real". `.fitness` will pause on behaviour that
  a car would not exhibit. For drive tracking use `.automotiveNavigation` and
  still disable pausing.
- One report notes that `CLLocationUpdate` with the `automotiveNavigation`
  configuration delivers location changes very aggressively
  (https://developer.apple.com/forums/thread/758704). Unverified whether this is
  a defect or intended.

### 2.3 The menu of background mechanisms and their real guarantees

**Standard continuous updates** (`startUpdatingLocation` with
`allowsBackgroundLocationUpdates = true` and the `location` background mode).
Highest fidelity, roughly 1 to 2 updates per second in the foreground
(https://twocentstudios.com/2024/12/03/core-location-modern-api-tips/, cited as
https://twocentstudios.com/2024/12/02/core-location-modern-api-tips/). Two hard
constraints:

- `startUpdatingLocation()` must be called while the app is in the foreground.
  If the app was activated in the background for any reason other than an SLC
  callback, updates stop after a few seconds
  (https://developer.apple.com/forums/thread/776698).
- It does **not** relaunch a terminated app. Once the app is terminated,
  continuous updates are gone until the user reopens the app.

Since iOS 16.4, apps calling both `startUpdatingLocation()` and
`startMonitoringSignificantLocationChanges()` can be suspended in the background
if they specify low accuracy and distance filtering. Apps needing continuous
high accuracy in the background must set `allowsBackgroundLocationUpdates = true`,
`distanceFilter = kCLDistanceFilterNone`, and `desiredAccuracy` to
`kCLLocationAccuracyHundredMeters` or better
(https://developer.apple.com/forums/thread/776698).

**Significant-location-change (SLC).** Wakes or relaunches the app on cell tower
change, typically at least 500 metres of movement, with a minimum of about 5
minutes between notifications
(https://www.oreilly.com/library/view/ios-components-and/9780133086898/ch02lev2sec5.html).
Survives termination. Coarse and network-derived, which is consistent with the
observed iOS symptom of 45 points across 29 km. Network-derived fixes commonly
carry no valid speed, which matches the reported null speeds
(consistent but **unverified** as the specific cause).

**Region / geofence monitoring.** Relaunches a terminated app. Region crossing
requires the device to cross the boundary, move a minimum distance beyond it,
and remain there for at least 20 seconds before notification
(https://developer.apple.com/forums/thread/701377). Modern `CLMonitor` delivers
region entered/exited "within 3 to 5 minutes on average, if not sooner" and is
limited to 20 regions per app
(https://twocentstudios.com/2024/12/02/core-location-modern-api-tips/). The
classic pattern is a single self-recentring geofence around the parked position:
exit means "a drive may have started, escalate".

**Visit monitoring** (`startMonitoringVisits`). Relaunches a terminated app.
Reports arrivals and departures with substantial latency; useful for
reconstructing that a trip happened, not for capturing its path.

**Deferred updates** (`allowDeferredLocationUpdates(untilTraveled:timeout:)`).
Deprecated as of iOS 13 with no replacement
(https://developer.apple.com/forums/thread/654296,
http://codeworkshop.net/objc-diff/sdkdiffs/ios/13.0/CoreLocation.html). Do not
build on it.

**iOS 17+ modern API** (`CLLocationUpdate.liveUpdates` plus
`CLBackgroundActivitySession`). Background updates no longer strictly require
`.always`; holding a `CLBackgroundActivitySession` or running a Live Activity
suffices alongside `.whenInUse`
(https://twocentstudios.com/2024/12/02/core-location-modern-api-tips/,
https://developer.apple.com/videos/play/wwdc2024/10212/). Critical limitation for
our use case: a new `CLBackgroundActivitySession` can only be started from the
foreground. When the app is relaunched in the background, creating a new session
plus `liveUpdates` has no effect because the foreground-started session has
already been invalidated
(https://developer.apple.com/forums/thread/810433,
https://developer.apple.com/forums/thread/767460). This makes the modern API a
poor fit for recovery after termination, and is a reason to keep the classic
`CLLocationManager` path as the primary mechanism.

Note also that on iOS 18 and later, Core Location automatically pauses
`CLLocationUpdate` when backgrounding and resumes when foregrounding
(https://twocentstudios.com/2024/12/02/core-location-modern-api-tips/), which is
another argument against depending on that API for continuous drive capture.

### 2.4 Suspension, termination and relaunch

- If the app is terminated by the user or the system, "the system doesn't
  automatically restart your app when new location updates arrive. A user must
  explicitly relaunch your app before the delivery of location updates resumes"
  unless region monitoring or SLC is in use
  (https://developer.apple.com/forums/thread/701377,
  https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/CoreLocation/CoreLocation.html).
- If the user turns off Background App Refresh, globally or for the app, iOS
  does not relaunch the app for any location event, including SLC and region
  events (same source). This is a silent, user-invisible kill switch.
- Execution budget on relaunch: expect about 10 seconds total, less if launch
  itself is slow. `beginBackgroundTask(expirationHandler:)` can request up to
  around 30 seconds but is not guaranteed
  (https://developer.apple.com/forums/thread/701377).
- Are network calls realistic in that window? Marginal. A single small POST to a
  warm host can complete in a few hundred milliseconds, but a cold TLS handshake
  on a poor cellular link can eat the entire budget. The safe design is: write
  to disk first, always; then attempt an opportunistic native upload inside a
  `beginBackgroundTask` with a short timeout; never block trip persistence on the
  network. A Capacitor app is doubly exposed here because the WebView will not
  even be loaded during a background relaunch, so the upload must be native Swift.
- Region monitoring has also been reported to stop working after a couple of days
  in some cases (https://developer.apple.com/forums/thread/92605), and SLC
  relaunch after force-quit has been reported as regressed on some iOS 15 builds
  (https://developer.apple.com/forums/thread/694081). Treat relaunch as
  best-effort, not a guarantee.

### 2.5 `CMMotionActivityManager` for automotive detection

- Two modes: live updates via `startActivityUpdates`, and historical query via
  `queryActivityStarting(from:to:to:withHandler:)`. The device records motion
  activity continuously at the OS level, and up to **7 days** of history is
  retrievable regardless of whether your app was running
  (https://www.devfright.com/how-to-use-the-cmmotionactivitymanager/,
  https://developer.apple.com/forums/thread/685532).
- Requires `NSMotionUsageDescription` in Info.plist and a user authorisation
  prompt (Motion & Fitness). Apple has been expanding which Core Motion APIs
  require this string over time
  (https://developer.apple.com/forums/thread/762886,
  https://developer.apple.com/forums/thread/756249).
- Live `startActivityUpdates` while suspended: **not reliable as a wake
  mechanism.** Core Motion is not in the list of things that relaunch a
  terminated app. The practical pattern reported is to query history on
  relaunch or on a background task and persist the results
  (https://developer.apple.com/forums/thread/685532).
- Accuracy caveat: `CMMotionActivityManager` has been reported to misclassify
  activity on some iOS releases (https://developer.apple.com/forums/thread/725416).

The strategically important point is the 7-day history. It makes Core Motion the
best available tool on iOS for **gap detection and after-the-fact
reconstruction**: if the app was dead from 09:00 to 09:40, you can ask the OS
whether the user was `automotive` during that window and surface a
"possible untracked drive" prompt. That is a far more honest product behaviour
than silently losing the trip.

### 2.6 Recent changes and silent authorisation downgrade

- iOS 14 introduced the precise/approximate distinction. Approximate location
  makes drive tracking useless. `fullAccuracyPurposeKey` plus
  `NSLocationTemporaryUsageDescriptionDictionary` lets you request temporary
  full accuracy
  (https://twocentstudios.com/2024/12/02/core-location-modern-api-tips/).
- iOS 13 onward periodically shows the user a map of where an app has been
  tracking them in the background, with a one-tap option to revert to While
  Using. This is the main real-world mechanism by which Always authorisation
  silently disappears
  (https://support.apple.com/en-us/102515). The app receives no notice beyond a
  changed authorisation status on next check.
- iOS 18.x has a cluster of user-reported location permission defects: Always
  reverting to While Using or Never on its own, and repeated permission prompts
  after updating
  (https://discussions.apple.com/thread/256052316,
  https://discussions.apple.com/thread/256127208). These are user reports, not
  Apple acknowledgements, so treat as **unverified** but plausible.
- iOS 18 moves toward `CLServiceSession` as the preferred authorisation model
  (https://developer.apple.com/videos/play/wwdc2024/10212/).

Implication: check `authorizationStatus` and accuracy authorisation on every
launch and every foreground transition, persist the result, and surface a
visible in-app banner when the app is no longer capable of tracking. Do not
assume permission granted at onboarding is still granted a month later.

### 2.7 Recommended iOS configuration

```
Info.plist:
  UIBackgroundModes: [location]
  NSLocationWhenInUseUsageDescription
  NSLocationAlwaysAndWhenInUseUsageDescription
  NSMotionUsageDescription

CLLocationManager (classic API, native Swift, not the WebView):
  allowsBackgroundLocationUpdates      = true
  pausesLocationUpdatesAutomatically   = false      // priority fix
  activityType                         = .automotiveNavigation
  desiredAccuracy                      = kCLLocationAccuracyBestForNavigation  (moving)
                                       = kCLLocationAccuracyHundredMeters      (idle)
  distanceFilter                       = kCLDistanceFilterNone (moving)
  showsBackgroundLocationIndicator     = true       // honest, and avoids surprise

Always running, regardless of trip state:
  startMonitoringSignificantLocationChanges()   // relaunch after termination
  startMonitoringVisits()                       // arrival/departure reconstruction
  one self-recentring CLCircularRegion (~200 m) around the last stationary fix

On SLC / region / visit callback (app may be cold-launched, ~10 s budget):
  1. persist the event to disk immediately
  2. if it indicates movement, call startUpdatingLocation()
     (note: this only sustains if the callback was an SLC callback)
  3. opportunistic native upload inside beginBackgroundTask, short timeout

Watchdog while a trip is believed active:
  if now - lastFixTimestamp > 90 s: stopUpdatingLocation(); startUpdatingLocation()
  log every restart as a diagnostic event
```

Known unavoidable weakness: `startUpdatingLocation()` is documented as needing a
foreground call to stick, and background restarts outside an SLC callback die
after a few seconds
(https://developer.apple.com/forums/thread/776698). This means a drive that
begins after the app has been terminated will realistically be captured at SLC
fidelity (roughly a point every 500 m or 5 minutes) until the user next opens
the app. That is precisely the 45-points-over-29 km signature currently being
observed, and it is a platform limit, not a bug to be coded away.

---

## 3. Android: mechanisms, guarantees, OEM problems, recommended configuration

### 3.1 What configuration produces hundreds of stationary points and nothing while driving (priority question)

Three mechanisms produce this exact signature. They are not mutually exclusive
and the live bug is most likely a combination.

**Cause A: polling a cache rather than subscribing to updates.**
`getLastLocation()` "doesn't make a location request, it simply returns the
location most recently obtained by the FusedLocationProviderClient" and "uses a
local cache that won't update automatically"
(https://developer.android.com/develop/sensors-and-location/location/retrieve-current,
https://developers.google.com/android/reference/com/google/android/gms/location/FusedLocationProviderClient).
The web equivalent is `navigator.geolocation.getCurrentPosition` with a
permissive `maximumAge`, which returns the cached fix without acquiring a new
one. A timer calling either of these produces an arbitrarily long run of
identical or near-identical coordinates. The corroborating field tell is that
opening Google Maps "unlocks" the frozen coordinate, because another app forces
the fused provider to compute a fresh fix
(https://www.b4x.com/android/forum/threads/problems-with-fused-location.137536/).

**Cause B: no foreground service, so the OS is only computing a few fixes an
hour.** "If your app is running in the background, the location system service
computes a new location for your app only a few times each hour ... even when
your app is requesting more frequent location updates." The affected APIs
explicitly include the Fused Location Provider, Geofencing and LocationManager
(https://developer.android.com/about/versions/oreo/background-location-limits).
Combined with Cause A, a high-frequency poller in the background reads the same
stale cached value hundreds of times, and it only refreshes a handful of times
per hour. The 40 metre box is simply GPS scatter around wherever the app last
had a real fix.

**Cause C: collection is happening in the WebView, so it only runs when the app
is in the foreground.** Android WebView `setTimeout`/`setInterval` "do not fire
reliably on schedule ... arbitrarily delayed or cancelled"
(https://github.com/nodekit-io/nodekit-android/issues/16), and
`watchPosition()` is documented as not working in the background on Android 8+
(https://bugzilla.mozilla.org/show_bug.cgi?id=1482733). Under this hypothesis
the 387 points are the accumulation of every foreground session of the day,
which all happened while parked at home or the office, and the drive produced
nothing because nothing was running.

**Diagnostic to distinguish them** (do this before changing any code): look at
the timestamp deltas of the 387 points.

- Uniform short interval (for example every 10 s) clustered into a few bursts
  totalling roughly an hour of wall time: Cause C, foreground-only WebView
  collection.
- Uniform interval spread evenly across the whole 13-hour day, with coordinates
  identical to many decimal places: Cause A, cache polling.
- Points genuinely stop for the duration of the drive and resume on arrival with
  no gap marker: Cause B or an OEM kill.
- Also check whether identical `latitude`/`longitude`/`accuracy` triples repeat
  byte-for-byte. Real GPS never repeats exactly; a cache does.

**Configuration errors that are commonly blamed but do not produce this
symptom:** a large `setMinUpdateDistanceMeters` yields *fewer* points while
stationary and *more* while driving, which is the opposite of what is observed.
`setWaitForAccurateLocation(true)` only delays the first fix. Coarse-only
permission would produce a bounding box of hundreds of metres to kilometres, not
40 metres. None of these explain the data.

### 3.2 `ACTIVITY_RECOGNITION` as a runtime permission

- Manifest needs both forms:
  `com.google.android.gms.permission.ACTIVITY_RECOGNITION` for API 28 and below,
  and `android.permission.ACTIVITY_RECOGNITION` for API 29 and above
  (https://developer.android.com/codelabs/activity-recognition-transition).
- On API 29+ it is a **runtime, dangerous permission** in the Physical Activity
  group. It must be requested with the normal runtime flow and can be revoked by
  the user at Settings > Privacy > Permission manager > Physical activity.
- What breaks when it is absent: activity updates simply never arrive. There is
  no exception and no error callback. The system degrades silently
  (https://newbe.dev/android-activity-recognition-permission-sdk-28-running-on-android-10-q-sdk-29).
  Downstream, a motion-first architecture then falls back to location-only
  detection, which needs hundreds of metres of movement before it notices a
  drive, which is how trips get missed entirely with no error anywhere.
- Practical consequence: the app must explicitly probe for this permission,
  report its state in diagnostics, and refuse to claim "tracking active" when it
  is missing.

### 3.3 Activity Recognition Transition API

- Request `ActivityTransition` entries for `IN_VEHICLE` with both
  `ACTIVITY_TRANSITION_ENTER` and `ACTIVITY_TRANSITION_EXIT`, wrap them in an
  `ActivityTransitionRequest`, and register via
  `ActivityRecognition.getClient(ctx).requestActivityTransitionUpdates(request, pendingIntent)`.
- Results are delivered to a `PendingIntent`, normally a `BroadcastReceiver`,
  and extracted with `ActivityTransitionResult.extractResult(intent)`. Events
  are chronologically ordered
  (https://developer.android.com/codelabs/activity-recognition-transition).
- Because delivery is via `PendingIntent` broadcast, it can start your
  components without the app being open, which is what makes it usable as the
  escalation trigger.
- No latency or reliability guarantee is published. Google's own codelab notes
  only that activity changes are hard to reproduce on the emulator and that
  physical device testing is required. Treat detection latency as
  seconds-to-minutes and unbounded in the worst case. There is a reported
  Samsung-specific activity recognition problem on Android 12
  (https://github.com/transistorsoft/react-native-background-geolocation/issues/1462),
  which matters given the affected device.

### 3.4 Foreground service, correctly

Requirements as of Android 14 (API 34) and later:

- Every foreground service must declare `android:foregroundServiceType`. Omitting
  it throws `MissingForegroundServiceTypeException` and crashes the app
  (https://developer.android.com/about/versions/14/changes/fgs-types-required,
  https://dev.to/joe_wang_6a4a3e51566e8b52/android-foreground-services-in-2026-what-changed-and-how-to-adapt-2o3d).
- For location work, declare `android:foregroundServiceType="location"` and hold
  both `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION`
  (https://developer.android.com/develop/background-work/services/fgs/service-types).
- You cannot start a `location`-typed foreground service while the app is in the
  background unless you hold `ACCESS_BACKGROUND_LOCATION` at runtime (same
  source). This is the single most important gate for an app that needs to start
  tracking on an activity-transition broadcast rather than a user tap.
- Android 13+ requires the `POST_NOTIFICATIONS` runtime permission to display
  the persistent notification. If the user denies it, the notification is
  suppressed; plan for that path
  (https://github.com/capacitor-community/background-geolocation).
- Android 15 (API 35) imposes a 6-hour cap on `dataSync` foreground services.
  The `location` type is **not** subject to that cap as of the sources reviewed.
  Do not be tempted to use `dataSync` for the uploader as a workaround for a
  location-type problem.
- Use `START_STICKY` so the system attempts to restart the service after a kill,
  accepting that restarts take seconds to tens of seconds and may not happen at
  all under memory pressure or OEM autostart restrictions
  (https://www.solutionbox.cz/en/blog/background-location-realne-telefony).

Capacitor-specific: set `android.useLegacyBridge = true` in the Capacitor config.
The community background-geolocation plugin documents this as the fix for
location updates stopping after 5 minutes in the background, and separately
documents that "after 5 minutes in the background Android will throttle HTTP
requests initiated from the WebView", with the remedy being a native HTTP path
such as CapacitorHttp
(https://github.com/capacitor-community/background-geolocation).

### 3.5 Doze, App Standby Buckets and background limits

- Doze and App Standby restrict app behaviour when the screen is off, the device
  is idle and it is not charging, batching and deferring work into maintenance
  windows
  (https://developer.android.com/training/monitoring-device-state/doze-standby).
  A phone sitting in a cupholder with the screen off is exactly this state.
- Background location limits (Android 8+) reduce a background app to a few
  computed fixes per hour across FLP, Geofencing, LocationManager, WifiManager
  and GNSS APIs
  (https://developer.android.com/about/versions/oreo/background-location-limits).
- App Standby Buckets throttle any app in a bucket above `ACTIVE`
  (https://developer.android.com/topic/performance/appstandby).
- What exempts you: a running foreground service keeps the app in the active
  bucket, and location sampling reverts to unrestricted rates while it runs.
  However, a foreground service prevents process death and restores sampling
  rates; it does not lift every restriction, and it does not override OEM layers
  (https://developer.android.com/topic/performance/power/power-details).
- Battery optimisation exemption: apps on the Doze exemption list are also exempt
  from App Standby bucket restrictions. Google Play policy prohibits requesting
  direct exemption from Doze and App Standby "unless the core function of the app
  is adversely affected", and lists real-time location tracking during an
  activity and turn-by-turn navigation among the acceptable use cases
  (https://developer.android.com/training/monitoring-device-state/doze-standby,
  https://support.google.com/googleplay/android-developer/thread/330168645).
  An automatic mileage tracker has a defensible claim under that carve-out, but
  the request must be user-initiated via
  `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, clearly explained, and the app
  must still work (degraded) if declined. Declaring
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` without a strong justification is a
  known Play review rejection trigger.

### 3.6 Samsung and other OEMs

Samsung stacks several independent mechanisms
(https://dontkillmyapp.com/samsung):

- **Deep sleeping apps**: apps unused for 3 days lose background processing and
  alarms entirely.
- **Adaptive Battery**: learns usage patterns and restricts unused apps more
  aggressively than stock Android.
- **Background app limits** ("Put unused apps to sleep"): operates independently
  of the standard battery optimisation toggle, so turning off battery
  optimisation alone is not enough.
- **App power management**: can terminate apps judged to be consuming excessive
  resources.
- Restrictions can revert after firmware updates or reboots even when the user
  previously removed the app from the lists.

Remediation on Samsung is entirely user-side. There is no supported developer
API. The documented path for recent One UI:

1. Settings > Apps > [app] > Battery > set to Unrestricted / "Don't optimize".
2. Settings > Battery > Background usage limits: turn off "Put unused apps to
   sleep", remove the app from "Sleeping apps" and "Deep sleeping apps".
3. Turn off Adaptive Battery.
4. Lock the app in the Recents view so it is not swept away.
5. On Android 14 devices, Samsung's Good Guardians / Memory Guardian settings may
   also need adjusting.

Other OEMs, for completeness
(https://dontkillmyapp.com,
https://www.solutionbox.cz/en/blog/background-location-realne-telefony):

- **Xiaomi / MIUI**: the most aggressive. Requires the app-specific "Autostart"
  permission plus battery saver exclusion, or nothing survives a reboot or a
  kill.
- **Huawei / EMUI**: kills foreground services within roughly 5 to 10 minutes
  unless the app is in "Protected apps".
- **OnePlus / OxygenOS**: older versions ignore foreground service notifications;
  users must use "Advanced optimization" battery settings.
- **Oppo / ColorOS**: similar autostart and background-freeze model to Xiaomi.

Samsung stated in July 2024 that it would drop non-standard optimisations for
apps targeting Android 14 and above, but this is **unverified** in practice and
dontkillmyapp explicitly flags it as needing verification.

The only workable product response is an in-app "tracking health" screen that
detects the manufacturer, links directly to the relevant settings pages where
deep links exist, walks the user through the steps where they do not, and then
verifies by checking whether the foreground service actually survived overnight.

### 3.7 Recommended Android configuration

```
Manifest:
  ACCESS_FINE_LOCATION
  ACCESS_COARSE_LOCATION
  ACCESS_BACKGROUND_LOCATION           // required to start FGS from background
  ACTIVITY_RECOGNITION                 // API 29+, runtime
  com.google.android.gms.permission.ACTIVITY_RECOGNITION   // API 28-
  FOREGROUND_SERVICE
  FOREGROUND_SERVICE_LOCATION
  POST_NOTIFICATIONS                   // API 33+, runtime
  <service android:foregroundServiceType="location" ... />

Capacitor:
  android.useLegacyBridge = true

Idle state (no drive detected):
  no location subscription at all, or a single ~200 m geofence around the last
  parked position
  ActivityRecognition transition updates for IN_VEHICLE ENTER/EXIT via PendingIntent

On IN_VEHICLE ENTER (or geofence exit):
  start the location-typed foreground service
  FusedLocationProviderClient.requestLocationUpdates with:
    priority                    = PRIORITY_HIGH_ACCURACY
    intervalMillis              = 5000
    minUpdateIntervalMillis     = 2000
    minUpdateDistanceMeters     = 0        // do not filter; filter server-side
    setWaitForAccurateLocation(false)      // do not delay the first fix
    granularity                 = GRANULARITY_FINE
  never call getLastLocation() as a data source

On IN_VEHICLE EXIT, or speed < threshold for the stop timeout:
  stop the foreground service, drop back to idle state, close the trip

Always:
  write every fix to a local SQLite/Room queue synchronously, before any network
  upload via native HTTP (CapacitorHttp or OkHttp), never via WebView fetch
```

---

## 4. What commercial apps do, and what they admit they cannot do

**Covered separately.** This section was researched by a parallel workstream and
is intentionally not duplicated here. The conclusions that the architecture above
depends on, carried over as given:

- The motion-first pattern is industry consensus: two states, moving and
  stationary, with activity recognition or a roughly 200 m geofence as the
  escalation trigger, and a stop timeout of about 5 minutes to de-escalate.
- Detection thresholds cluster at 4 to 15 mph with a 1 to 2 minute confirmation
  window; minimum trip distances sit around 0.5 to 1.0 mile.
- TripLog backfills the trip start from buffered pre-trigger location data,
  recovering the miles lost to detection latency. Our design should do the same:
  keep a small rolling pre-trigger buffer so the trip does not start half a mile
  down the road.
- A missing Android `ACTIVITY_RECOGNITION` permission silently degrades the
  system to location-only detection needing 200 to 1000 m of movement, with no
  error raised. Independently confirmed in section 3.2.
- OEM battery layers can override a correctly implemented foreground service,
  Samsung included. Independently confirmed in section 3.6.
- No vendor publishes a measured capture rate, and every one of them ships a
  manual-add fallback.

That last point is the honest ceiling: if the entire commercial category ships a
manual fallback and none of them will state a capture rate, we should not promise
one either.

---

## 5. Recommended architecture

### 5.1 Shared principles

1. **All collection and all upload is native.** The WebView is a UI surface
   only. It may read from and command the native layer, but it must never be on
   the data path for a drive.
2. **Disk first, network second.** Every fix is appended to a local durable queue
   (SQLite on Android, SQLite or a Core Data store on iOS) in the same call stack
   that receives it. Upload is a separate, idempotent, retrying process keyed on
   a client-generated point id.
3. **Two states, explicitly modelled.** `IDLE` and `TRACKING`, with the
   transitions logged as first-class events so a support engineer can reconstruct
   what the device believed at any moment.
4. **A pre-trigger ring buffer.** Keep the last few minutes of cheap fixes so
   that on escalation the trip start can be backfilled.
5. **Everything is instrumented.** Per the production-experience write-up, the
   minimum telemetry is: fixes per hour, service restart events classified as
   "after kill" versus "intentional", permission state snapshots, and OS version
   and device model on every event
   (https://www.solutionbox.cz/en/blog/background-location-realne-telefony).

### 5.2 iOS

- Native `CLLocationManager` singleton owned by the AppDelegate, configured per
  section 2.7. `pausesLocationUpdatesAutomatically = false`,
  `activityType = .automotiveNavigation`.
- Permanent background scaffolding: SLC + visits + one self-recentring geofence.
  These are the only things that survive termination, so they are always on.
- Escalation to `startUpdatingLocation()` on geofence exit or SLC callback,
  de-escalation on a 5-minute stop timeout.
- Watchdog timer restarting location updates whenever the last-fix age exceeds 90
  seconds during an active trip.
- Core Motion 7-day history queried on every foreground and on every background
  relaunch, used purely to detect that an `automotive` window occurred while the
  app was not tracking.
- Uploads: native `URLSession` background configuration where possible (survives
  app suspension and hands the transfer to the system daemon), falling back to a
  foreground `URLSession` inside `beginBackgroundTask`.

### 5.3 Android

- Native `Service` with `foregroundServiceType="location"`, `START_STICKY`, owned
  by the app process rather than the WebView.
- Idle state: no GPS. Activity Recognition Transition API registered via
  `PendingIntent` for `IN_VEHICLE` enter/exit, plus a geofence around the last
  parked position as a redundant trigger for the case where activity recognition
  is unavailable or unpermitted.
- Escalation starts the foreground service and subscribes to FLP at high accuracy
  per section 3.7. Never poll `getLastLocation()`.
- De-escalation on `IN_VEHICLE` EXIT or the stop timeout.
- `BOOT_COMPLETED` receiver to re-register triggers after reboot.
- Room-backed queue plus a `WorkManager` upload job, with an immediate OkHttp
  attempt from the service while it is alive.
- An onboarding and health screen that requests background location as a separate
  second-stage prompt, requests `ACTIVITY_RECOGNITION` and `POST_NOTIFICATIONS`,
  offers `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, and gives Samsung-specific
  instructions when `Build.MANUFACTURER` says Samsung.

### 5.4 The immediate fix list for the live bugs

In priority order, assuming the diagnostics in section 3.1 confirm the
hypotheses:

1. Android: confirm whether the 387 points came from the WebView or from native
   code, and whether they came from a cache read. Fix by moving collection into
   the foreground service and subscribing rather than polling.
2. Android: verify the manifest actually declares `foregroundServiceType="location"`
   plus `FOREGROUND_SERVICE_LOCATION`, and that the service is genuinely running
   during a drive (check for the persistent notification on the device).
3. Android: verify `ACCESS_BACKGROUND_LOCATION` and `ACTIVITY_RECOGNITION` are
   granted, not just declared.
4. Android: set `android.useLegacyBridge = true` and move uploads to native HTTP.
5. iOS: set `pausesLocationUpdatesAutomatically = false` and
   `activityType = .automotiveNavigation`; add the last-fix-age watchdog.
6. iOS: confirm `UIBackgroundModes` includes `location` and that
   `startUpdatingLocation()` is being called from the foreground at least once
   per session.
7. Both: add a diagnostics payload (permission states, service alive, last fix
   age, restart count) uploaded with every batch, so the next failure is
   diagnosable from the server instead of from a driver's recollection.

---

## 6. Honest limits: what will still be missed

These are platform limits. They should be surfaced in the product, not promised
away.

1. **iOS after termination.** If iOS terminates the app and a drive starts before
   the user next opens it, the best available capture is SLC fidelity: roughly a
   point per 500 m or per 5 minutes, network-derived, often without valid speed.
   The route will be a polyline of straight segments and the distance will be an
   underestimate. This is the current live iOS symptom and it is not fully
   fixable.
2. **iOS with Background App Refresh disabled.** No relaunch for any location
   event. Tracking is dead until the user opens the app, and the app cannot tell
   the user this while it is not running.
3. **iOS silent authorisation decay.** iOS periodically invites the user to
   downgrade Always to While Using. Some users will accept. The app finds out on
   next launch, not at the time.
4. **Android OEM kills.** Samsung, Xiaomi and Huawei can kill a correctly
   implemented foreground service. There is no developer-side defence. Some
   fraction of drives on these devices will be lost regardless of code quality.
5. **Detection latency at trip start.** Activity recognition and geofence exits
   take seconds to minutes. Without pre-trigger buffering, the first fraction of
   a mile is always lost; with buffering, it is recovered only if a cheap fix
   happened to be taken during that window.
6. **Device off, dead battery, aeroplane mode, or the user's phone left at home.**
   Nothing to be done.
7. **Reboot windows.** Between reboot and the app's `BOOT_COMPLETED` handling
   (Android) or first user launch (iOS), nothing is captured.

### What to do instead of promising

- **Detect gaps and say so.** Any interval where the app expected to be tracking
  but received no fixes, or where the app was not running, should be recorded as
  a `coverage_gap` record with a start, an end and a cause code. Show these in the
  UI as "we may have missed a drive here" with a one-tap manual add.
- **Reconstruct where possible.** On iOS, query `CMMotionActivityManager` history
  (7 days) to establish whether the user was `automotive` during a gap. On
  Android, an equivalent partial signal is available from the fact that the OS
  still computes a few background fixes per hour, and from geofence and
  activity-transition events that fired without a corresponding trip.
  Reconstruct the endpoints from those, mark the trip as `inferred`, and require
  the user to confirm the distance. Never present a reconstructed distance as
  measured.
- **Report tracking health honestly.** A visible status: permissions, background
  refresh, battery optimisation, service alive, last fix age, and last successful
  upload. If any of these is bad, the app should say tracking is degraded rather
  than showing a green tick.
- **Ship a manual add path and treat it as a first-class feature**, because every
  commercial competitor does.

---

## 7. Open questions

1. **Apple's own documented resume semantics for
   `pausesLocationUpdatesAutomatically`.** Apple's documentation pages are
   JavaScript-rendered and returned no content to a plain fetch. The claim that
   iOS resumes updates on its own once movement is detected is asserted by many
   secondary sources but was not verified against Apple's own text in this
   research. What is well-attested is that in practice it frequently does not
   resume. Recommend confirming against the Xcode-bundled documentation locally.
2. **Whether `pausesLocationUpdatesAutomatically = false` is currently set in our
   iOS code.** This research did not read the repository. It should be checked
   first, since the whole iOS hypothesis rests on it.
3. **Null speeds on the observed iOS points.** The explanation that
   network-derived SLC fixes carry no valid speed is consistent with the data but
   was not directly verified. It could equally be a serialisation bug that drops
   a negative sentinel value.
4. **Whether the location foreground service type is exempt from Android 15's
   6-hour cap.** Sources confirm the cap applies to `dataSync` and are silent on
   `location`. Treated here as exempt, but unverified. Worth confirming before
   relying on a service that runs all day.
5. **Samsung's July 2024 statement** that it would drop non-standard
   optimisations for apps targeting Android 14+. Flagged by dontkillmyapp as
   needing verification; still unverified as of this research.
6. **iOS 18.x permission instability.** User reports of Always silently reverting
   are numerous but are user reports, not Apple acknowledgements. Impact on our
   install base is unknown and could be measured directly by logging
   authorisation status transitions.
7. **Actual latency distribution of the Activity Recognition Transition API for
   `IN_VEHICLE` ENTER**, particularly on Samsung where a specific defect has been
   reported. No published figures were found. This needs on-device measurement
   before we can state a trip-start accuracy.
8. **Whether iOS delivers usable results from `startUpdatingLocation()` called
   inside a region-monitoring callback** as opposed to an SLC callback. Sources
   are specific that SLC callbacks work and that other background activations do
   not sustain updates, but region callbacks were not separately confirmed.

---

## Source list

iOS:
- https://developer.apple.com/forums/thread/776698 (background updates stop in
  iOS 17+, required configuration, iOS 16.4 change)
- https://developer.apple.com/forums/thread/763696 (auto-pause timing with When
  In Use; activity type is not a filter)
- https://developer.apple.com/forums/thread/75072 (updates pause and never resume)
- https://developer.apple.com/forums/thread/717291 (updates stopping in background)
- https://developer.apple.com/forums/thread/124048 (pause delegate not called;
  tethered testing suppresses the pause)
- https://developer.apple.com/forums/thread/20468 (locationManagerDidPause...)
- https://developer.apple.com/forums/thread/701377 (terminated app relaunch,
  ~10 s budget, Background App Refresh kill switch, region 20 s dwell)
- https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/CoreLocation/CoreLocation.html
- https://developer.apple.com/forums/thread/810433 and
  https://developer.apple.com/forums/thread/767460 (CLBackgroundActivitySession
  cannot be started from background after relaunch)
- https://developer.apple.com/forums/thread/758704 (automotiveNavigation update
  volume)
- https://developer.apple.com/forums/thread/92605 (region monitoring degrading
  over days)
- https://developer.apple.com/forums/thread/694081 (SLC relaunch regression on
  iOS 15)
- https://developer.apple.com/forums/thread/654296 and
  http://codeworkshop.net/objc-diff/sdkdiffs/ios/13.0/CoreLocation.html (deferred
  updates deprecated)
- https://developer.apple.com/forums/thread/685532,
  https://developer.apple.com/forums/thread/725416,
  https://developer.apple.com/forums/thread/762886,
  https://developer.apple.com/forums/thread/756249,
  https://www.devfright.com/how-to-use-the-cmmotionactivitymanager/ (Core Motion,
  7-day history, NSMotionUsageDescription)
- https://twocentstudios.com/2024/12/02/core-location-modern-api-tips/ (modern
  API gotchas, CLMonitor limits and latency, iOS 18 auto-pause)
- https://developer.apple.com/videos/play/wwdc2024/10212/ (what's new in location
  authorization)
- https://support.apple.com/en-us/102515 (iOS periodic background-location
  reminder and downgrade prompt)
- https://discussions.apple.com/thread/256052316,
  https://discussions.apple.com/thread/256127208 (iOS 18 permission instability,
  user reports)
- https://www.oreilly.com/library/view/ios-components-and/9780133086898/ch02lev2sec5.html
  (SLC thresholds: ~500 m, 5 minute minimum)

Android:
- https://developer.android.com/about/versions/oreo/background-location-limits
  (few fixes per hour for background apps; affected APIs; foreground service
  remedy)
- https://developer.android.com/develop/sensors-and-location/location/retrieve-current
  and https://developers.google.com/android/reference/com/google/android/gms/location/FusedLocationProviderClient
  (getLastLocation is a cache read)
- https://www.b4x.com/android/forum/threads/problems-with-fused-location.137536/
  (frozen coordinates in the field; Google Maps unfreezes them)
- https://developer.android.com/about/versions/14/changes/fgs-types-required,
  https://developer.android.com/develop/background-work/services/fgs/service-types,
  https://developer.android.com/develop/background-work/services/fgs/declare,
  https://developer.android.com/develop/background-work/services/fgs/changes
  (foreground service types, FOREGROUND_SERVICE_LOCATION, background-start gate)
- https://dev.to/joe_wang_6a4a3e51566e8b52/android-foreground-services-in-2026-what-changed-and-how-to-adapt-2o3d
  (Android 14/15/16 foreground service changes)
- https://developer.android.com/training/monitoring-device-state/doze-standby,
  https://developer.android.com/topic/performance/appstandby,
  https://developer.android.com/topic/performance/power/power-details (Doze,
  buckets, exemptions, Play policy on exemption requests)
- https://support.google.com/googleplay/android-developer/thread/330168645
  (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS policy discussion)
- https://developer.android.com/codelabs/activity-recognition-transition
  (Activity Recognition Transition API, permissions, PendingIntent delivery)
- https://newbe.dev/android-activity-recognition-permission-sdk-28-running-on-android-10-q-sdk-29
  (ACTIVITY_RECOGNITION runtime permission on API 29+)
- https://dontkillmyapp.com/samsung and https://dontkillmyapp.com (OEM battery
  killers and remediation)
- https://github.com/transistorsoft/react-native-background-geolocation/issues/1462
  (Samsung Android 12 activity recognition problem)
- https://www.solutionbox.cz/en/blog/background-location-realne-telefony
  (production failure modes, telemetry, offline queue, kill detection)

Capacitor and WebView:
- https://github.com/capacitor-community/background-geolocation (useLegacyBridge,
  5-minute WebView HTTP throttle, POST_NOTIFICATIONS, iOS Info.plist keys)
- https://github.com/capacitor-community/background-geolocation/issues/53
  (5-minute background cutoff report)
- https://bugzilla.mozilla.org/show_bug.cgi?id=1482733 (watchPosition does not
  work in background on Android 8+)
- https://github.com/nodekit-io/nodekit-android/issues/16 (WebView setTimeout and
  setInterval unreliable)
