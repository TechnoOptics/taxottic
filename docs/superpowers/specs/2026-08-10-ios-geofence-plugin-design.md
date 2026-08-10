# iOS geofence plugin

Date: 2026-08-10
Status: approved, not yet implemented

## Problem

On iOS, region monitoring is the only mechanism that can restart mileage
capture after the OS terminates the app. Android has a full geofence
implementation (5 files). iOS has none: the file was never written.

Measured 2026-08-10, a driver mid-workday:

```
tracking_enabled     true
geofence_arm_state   null        server has 4 learned places for her
geofence_count       null
points in last hour  0
last point           12.2 hours ago
trips today          0
```

Her app was terminated overnight, and with no regions registered there was
nothing to relaunch it. She lost a day of driving and only discovered it
when asked. That is the failure this closes.

## Decision: mirror Android's vocabulary, diverge on lifecycle

**Vocabulary is identical**, deliberately, so no JS, database or heartbeat
change is needed. `lib/mileage/geofence.ts` already speaks this contract
and `registerPlugin("TaxotticGeofence")` already exists; the moment the
native side answers, `geofence_arm_state` and `geofence_count` start
reporting with no other edit anywhere.

| constant / state | value |
| --- | --- |
| `MAX_PLACES` | 8 (iOS allows 20 regions; the 12 spare stay unused) |
| arm states | `armed`, `disarmed_no_places`, `disarmed_no_background_permission`, `disarmed_registration_failed` |
| event outcomes | `started`, `enter_ignored`, `blocked_no_background_permission`, `blocked_service_start_denied` |
| capture states | `capturing`, `blind_no_fix`, `ended`, `location_services_off` |
| transition rule | EXIT starts capture; ENTER records `enter_ignored` |

**Lifecycle deliberately differs, and this is the one divergence.** See
"Capture lifecycle" below. Anyone later "fixing" the inconsistency should
read that section first.

## Architecture: delegate, do not reimplement

iOS already has `TaxotticBackgroundLocation`, and it owns everything hard:

- a `CLLocationManager` singleton with an existing delegate
- significant-location-change and Visits monitoring, which already relaunch
  a terminated app
- an on-disk fix buffer (`taxottic-bg-locations.json`)
- `drainBuffered()`, `clearBuffered(upTo:)`, `bufferedCount()`
- `restoreOnLaunch()`, already wired into `AppDelegate.didFinishLaunching`

That machinery is proven: it is what has been buffering fixes on both
iPhones. So the plugin adds region monitoring as a TRIGGER and delegates
capture to the class that already does it.

| piece | Android | iOS |
| --- | --- | --- |
| region registration | `TaxotticGeofenceRegistrar` | `startMonitoring(for: CLCircularRegion)` on the existing manager |
| exit starts capture | `TaxotticGeofenceReceiver` to a service | `didExitRegion` to the existing capture path |
| fix buffer | `TaxotticGeofenceStore` file | already exists |
| relaunch | `TaxotticGeofenceBootReceiver` | already exists (`restoreOnLaunch`) |
| state for the heartbeat | `TaxotticGeofenceStore` prefs | small `UserDefaults` block, same keys |

Net new Swift is roughly one file, not five.

## Plugin surface

Mirrors `type GeofencePlugin` in `lib/mileage/geofence.ts` exactly:

```
syncPlaces({places}) -> {accepted, submitted, maxPlaces, armState, backgroundLocation}
getState()           -> GeofenceState
readBuffer()         -> {fixes, count}
consumeBuffer({count}) -> {remaining}
startCapture()       -> {started, reason}
stopCapture()        -> void
clearPlaces()        -> {armState}
```

Declared with `@objc`, `CAPBridgedPlugin`, `identifier`, `jsName =
"TaxotticGeofence"`, and an explicit `pluginMethods` list, matching
`TaxotticWidgetBridgePlugin`. **Registered in `project.pbxproj`**: a
`.swift` file that is not compiles to nothing and fails silently, which
this repo has shipped twice. CI job `ios compiles` (#558) now catches it.

## Arm state

Resolved in this order, matching `TaxotticGeofenceRegistrar`:

1. `CLLocationManager.authorizationStatus != .authorizedAlways` ->
   `disarmed_no_background_permission`
2. no places -> `disarmed_no_places`
3. `startMonitoring` throws or reports failure -> `disarmed_registration_failed`
4. otherwise -> `armed`, with `registeredCount`

Rule 1 is worth more than it looks. Region monitoring requires Always
authorization, so a driver on "While Using" will now report
`disarmed_no_background_permission` in her heartbeat. That setting is
currently INVISIBLE (the device-status probe rejects in 3ms for reasons
still unknown), and not knowing it blocked a whole day of diagnosis.

## Capture lifecycle: the deliberate divergence

**Native capture stops only on drive end or tracking disabled. It does NOT
stop because the WebView woke up.**

Android hands off to the JS layer once the app is alive, and that is safe
there because a foreground service keeps the process up. On iOS the
WebView is the least reliable component in the system, as measured:

- `setInterval` does not fire at all in a backgrounded WebView
- an upload stall of 47 minutes was recorded on 2026-08-09
- the page loads a REMOTE url and cannot be trusted to boot inside the
  roughly 10 second background wake budget

Handing capture to that layer means capture dies when it dies. So the
model is one capturer, not two: **native captures and buffers, JS drains
and uploads.** If JS is alive it also captures, which is harmless.

Harmless because the ingest upsert identity is `(driver_user_id,
company_id, captured_at)` (`app/api/mileage/ingest/route.ts`). Two
observers of the same `CLLocation` carry the same timestamp, so the second
write is a no-op. Redundancy is free at the database.

### Required: port the parked filter to Swift

Native fixes bypass `lib/mileage/parked-filter.ts`, so without this,
"both run" silently undoes the 76% stationary-volume reduction shipped in
#556. `shouldKeepFix` is a pure function (distance from last kept fix, or
keepalive elapsed) and ports in about thirty lines.

`PARKED_KEEPALIVE_MS` MUST stay at 5 minutes on both sides. It was 10 and
that exceeded `MAX_CAPTURE_GAP_MS` (8 min), so suppressing fixes during a
9 minute stop manufactured a capture gap and severed the drive. This is
not a number to tune independently per platform.

## Testing

- `ios compiles` (#558) gates every PR, so a pbxproj omission cannot ship.
- Simulator: register regions, simulate an exit, assert `armState` becomes
  `armed`, `geofence_count` is 4, and a fix lands in the buffer.
- Device: the only test that counts. Arm the mesh, terminate the app, drive
  out of a region, confirm a trip materialises without opening the app.
- Heartbeat: `geofence_arm_state` and `geofence_count` populate for an iOS
  device for the first time.

## Risks

**Always authorization may not be granted.** Then the plugin reports
`disarmed_no_background_permission` and nothing improves for that driver
except that we can finally SEE why. That is still a win.

**Region monitoring is coarse.** iOS regions have a practical floor around
100 to 200 m and can lag. The learned places use 150 to 250 m radii, which
is inside that envelope, but exits will not be instant.

**This does not fix the 3ms device-status rejection.** Different plugin,
unknown cause, tracked separately. Do not assume this build resolves it.

## Out of scope

- Raising `MAX_PLACES` above 8
- Using iOS's spare 12 regions for anything
- Changing what a geofence does once it fires
- The push-token registration failure (task #61)
