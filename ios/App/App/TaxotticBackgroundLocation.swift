import Foundation
import CoreLocation

/// Native background-location capture and revival for iOS.
///
/// ── Why this exists ────────────────────────────────────────────────
/// Measured over 10 days: the Android driver's phone uploaded on 10/10
/// days starting ~05:00 (a foreground service keeps the process alive),
/// while the iOS driver's first upload averaged 13:52 — every morning
/// commute was lost until she opened the app by hand.
///
/// Three verified platform facts explain it, and dictate this design:
///
///  1. `startUpdatingLocation` — the only service the JS tracker uses —
///     does NOT relaunch a terminated app. Apple: "If your app is
///     terminated, the delivery of new location events stops
///     altogether." Once iOS reclaims the app overnight, the device is
///     blind until the user taps the icon.
///
///  2. Significant-location-change DOES relaunch a terminated app, and
///     per Apple DTS (Mar 2026) it does so *even after the user swipes
///     the app away*. It is the only mechanism that can wake us when a
///     drive starts. On relaunch we must re-create a manager and call
///     the start method again to receive the pending event.
///
///  3. A background relaunch grants only ~10 seconds, and Apple
///     explicitly warns against network work in that window. This app
///     is a REMOTE-URL WebView (server.url = https://taxottic.com), so
///     "let JavaScript handle it" means a DNS + TLS + HTML + bundle
///     fetch inside a 10-second no-network budget — which on a flaky
///     connection frequently completes zero JS. Worse, the Capacitor
///     plugin hands every fix to a saved bridge call and silently drops
///     it when no WebView is attached.
///
/// So capture here is deliberately native and WebView-independent:
/// persist first, let JavaScript drain later. Late points are fine —
/// the server finalizer works over a 45-day window and reconciles
/// trips, so a commute uploaded at lunchtime still materialises
/// correctly. Ingest is idempotent (unique on driver+company+captured
/// instant), so overlapping with the JS path costs nothing.
///
/// Owned by AppDelegate, NOT by the Capacitor bridge, because the
/// bridge and its view controller may never be constructed on a
/// background launch.
@objc public class TaxotticBackgroundLocation: NSObject, CLLocationManagerDelegate {

    @objc public static let shared = TaxotticBackgroundLocation()

    // Persisted so a cold background launch knows whether to re-arm
    // without asking JavaScript (which may never run).
    private let kEnabled = "taxottic.bg.enabled"
    private let kCompanyId = "taxottic.bg.companyId"
    private let kBufferFile = "taxottic-bg-locations.json"

    // ── Geofence mesh state ────────────────────────────────────────
    //
    // Region monitoring lives HERE, not in the Capacitor plugin, and
    // that placement is the whole point of the feature.
    //
    // A CAPPlugin instance only exists once the web layer has loaded.
    // The case this mesh exists to recover from is the opposite one: the
    // OS terminated the app overnight, the driver gets in the car, and
    // there is no WebView, no bridge and no plugin object for iOS to
    // deliver `didExitRegion` to. AppDelegate constructs this singleton
    // on EVERY launch (`restoreOnLaunch`), including a launch iOS starts
    // purely to hand over a region event, so this is the only object in
    // the app that can reliably be the CLLocationManagerDelegate at that
    // moment. Moving any of this into the plugin reintroduces exactly
    // the bug it closes: a cold relaunch that silently captures nothing.
    //
    // Keys are namespaced separately from the bg.* keys above so the
    // mesh can be reasoned about, and cleared, on its own.
    private let kPlaces = "taxottic.geofence.places"
    private let kArmState = "taxottic.geofence.armState"
    private let kRegisteredCount = "taxottic.geofence.registeredCount"
    private let kRegisteredAt = "taxottic.geofence.registeredAtMs"
    private let kRegistrationError = "taxottic.geofence.registrationError"
    private let kLastEvent = "taxottic.geofence.lastEvent"
    private let kLastCapture = "taxottic.geofence.lastCapture"
    private let kCaptureRunning = "taxottic.geofence.captureRunning"
    private let kBufferOverflow = "taxottic.geofence.bufferOverflow"

    /// How many places are ever monitored. Identical to
    /// TaxotticGeofenceStore.MAX_PLACES on Android, deliberately: the
    /// same server-computed list feeds both platforms, so the platforms
    /// must agree on how much of it they honour. iOS allows 20 regions
    /// per app; the 12 spare stay unused.
    @objc public static let maxPlaces = 8

    /// Arm states. Byte-identical to Android's TaxotticGeofenceStore, so
    /// `geofence_arm_state` in the heartbeat means one thing across the
    /// fleet and lib/mileage/geofence.ts needs no platform branch.
    private let armArmed = "armed"
    private let armNoPlaces = "disarmed_no_places"
    private let armNoBackgroundPermission = "disarmed_no_background_permission"
    private let armRegistrationFailed = "disarmed_registration_failed"

    /// Outcomes of a single region transition.
    private let outcomeStarted = "started"
    private let outcomeEnterIgnored = "enter_ignored"
    private let outcomeNoBackgroundPermission = "blocked_no_background_permission"
    private let outcomeStartDenied = "blocked_service_start_denied"

    /// Outcomes of a capture session.
    private let captureCapturing = "capturing"
    private let captureBlind = "blind_no_fix"
    private let captureEnded = "ended"
    private let captureServicesOff = "location_services_off"

    /// Regions below this are unreliable on iOS, and there is no point
    /// monitoring a whole town. Same clamp as Android.
    private let minRegionRadius: CLLocationDistance = 100
    private let maxRegionRadius: CLLocationDistance = 500

    /// Stop fine-grained capture after this long with no driving-speed
    /// movement, so a parked car doesn't hold the GPS open all night.
    private let idleStopInterval: TimeInterval = 15 * 60
    /// Speed that counts as driving (m/s, ~3.4 mph). Mirrors
    /// STATIONARY_SPEED_MPS in lib/mileage/drive-end.ts.
    private let drivingSpeed: CLLocationSpeed = 1.5
    /// Hard cap on buffered fixes. A commute is a few thousand; this
    /// holds days of driving and still bounds disk use.
    private let maxBufferedPoints = 20_000

    private let manager = CLLocationManager()
    private let queue = DispatchQueue(label: "com.taxottic.bglocation", qos: .utility)
    private var fineUpdatesActive = false
    private var lastDrivingFixAt: Date?
    /// Last fix the parked filter KEPT. Read and written only on
    /// `queue`, alongside the buffer it guards.
    private var lastKeptFix: (lat: CLLocationDegrees, lng: CLLocationDegrees, ts: Int)?
    /// Fixes buffered since the current capture session began, and when
    /// that session began. Both are informational, surfaced through
    /// `lastCapture` so a session that ran and saw nothing is visible
    /// rather than indistinguishable from a quiet day.
    private var captureFixCount = 0
    private var captureStartedAtMs = 0
    private var lastCaptureWriteAt = Date.distantPast
    /// CoreLocation callbacks land on the main thread while the buffer
    /// writes run on `queue`, and both touch the counters above.
    private let captureLock = NSLock()
    /// Previous accepted fix, used to DERIVE speed when CoreLocation
    /// does not report one. See `effectiveSpeed(of:)`.
    private var lastFix: CLLocation?

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        // kCLDistanceFilterNone is one of Apple's documented mitigations
        // for the iOS 16.4+ rule that suspends apps running both
        // startUpdatingLocation and SLC with a distance filter set.
        manager.distanceFilter = kCLDistanceFilterNone
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .automotiveNavigation
    }

    // ── Lifecycle ──────────────────────────────────────────────────

    /// Call from AppDelegate on EVERY launch. Re-arms SLC when the user
    /// had tracking on, which is what makes a relaunch deliver its
    /// pending event. Safe to call repeatedly.
    @objc public func restoreOnLaunch() {
        guard UserDefaults.standard.bool(forKey: kEnabled) else { return }
        // Re-arm the learned-place mesh BEFORE the authorization guard
        // below. A launch that finds "Always" revoked is precisely the
        // launch worth recording: rearmRegions writes
        // disarmed_no_background_permission, the heartbeat carries it,
        // and a driver on "While Using" stops being invisible. Returning
        // early instead would leave geofence_arm_state null, which is
        // the state the whole feature exists to end.
        rearmRegions()
        guard hasAlwaysAuthorization() else { return }
        manager.startMonitoringSignificantLocationChanges()
        // Visits is a SECOND force-quit-survivable relaunch trigger and
        // costs almost nothing to run alongside SLC. Its departure
        // events are system-computed, so iOS tells us when the user
        // actually left a place — a free trip-start anchor that no
        // major mileage app appears to use. Belt and braces: if SLC is
        // throttled (relaunch is capped at ~1 per 3-5 min), a visit
        // event can still wake us.
        manager.startMonitoringVisits()
    }

    /// JS calls this when the user turns tracking on, passing the
    /// company the drives belong to.
    @objc public func enable(companyId: String) {
        UserDefaults.standard.set(true, forKey: kEnabled)
        UserDefaults.standard.set(companyId, forKey: kCompanyId)
        rearmRegions()
        guard hasAlwaysAuthorization() else { return }
        manager.startMonitoringSignificantLocationChanges()
        manager.startMonitoringVisits()
    }

    /// JS calls this when the user turns tracking off. Buffered points
    /// are intentionally KEPT so an in-flight drive still uploads.
    @objc public func disable() {
        UserDefaults.standard.set(false, forKey: kEnabled)
        manager.stopMonitoringSignificantLocationChanges()
        manager.stopMonitoringVisits()
        stopFineUpdates()
    }

    @objc public func isEnabled() -> Bool {
        UserDefaults.standard.bool(forKey: kEnabled)
    }

    @objc public func currentCompanyId() -> String {
        UserDefaults.standard.string(forKey: kCompanyId) ?? ""
    }

    private func hasAlwaysAuthorization() -> Bool {
        CLLocationManager.locationServicesEnabled()
            && manager.authorizationStatus == .authorizedAlways
    }

    // ── Capture ────────────────────────────────────────────────────

    /// Escalate to continuous updates once we know the device is
    /// actually driving. SLC alone would give a ~500 m / 5-minute
    /// breadcrumb; this recovers full route fidelity for the rest of
    /// the trip without the WebView being involved at all.
    private func startFineUpdates() {
        guard !fineUpdatesActive, hasAlwaysAuthorization() else { return }
        fineUpdatesActive = true
        // Start the idle clock at the moment of escalation. It used to be
        // set ONLY where a reported speed cleared drivingSpeed, so a
        // session escalated from a source that reports no speed (every
        // SLC fix, every CLVisit) left `lastDrivingFixAt` nil forever and
        // stopFineUpdates()'s `let last = lastDrivingFixAt` guard could
        // never pass: continuous GPS then ran until the app died.
        if lastDrivingFixAt == nil { lastDrivingFixAt = Date() }
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        // A session opens BLIND and has to earn "capturing" by producing
        // a fix. Starting it as healthy is how a capture that received
        // no location at all once looked identical to a quiet day.
        captureLock.lock()
        captureFixCount = 0
        captureStartedAtMs = nowMs()
        captureLock.unlock()
        recordCapture(state: captureBlind, detail: "fine updates started",
                      running: true, force: true)
        // Confirmation signals ride along with fine capture and only
        // with fine capture: this is the window where we already hold
        // the GPS open and already believe a drive is happening, so
        // motion sampling adds no standing battery cost. It confirms
        // nothing about STARTING, since escalation already happened.
        TaxotticVehicleSignals.shared.startLiveUpdates()
    }

    private func stopFineUpdates() {
        guard fineUpdatesActive else { return }
        fineUpdatesActive = false
        manager.stopUpdatingLocation()
        TaxotticVehicleSignals.shared.stopLiveUpdates()
        // A session that ends having seen nothing stays BLIND in the
        // record. "Ended" would claim it worked.
        recordCapture(
            state: captureFixCount > 0 ? captureEnded : captureBlind,
            detail: captureFixCount > 0 ? "fine updates stopped" : "no fix in session",
            running: false, force: true)
    }

    /// Speed in m/s, DERIVED from the previous fix when CoreLocation does
    /// not report one. Returns a negative value only when it is genuinely
    /// unknowable (no usable predecessor).
    ///
    /// Load-bearing: `CLLocation.speed` is -1 (unavailable) on every fix
    /// that did not come from continuous GPS, which is precisely the
    /// fixes this class receives before it escalates. Significant-
    /// location-change and CLVisit locations are computed by the system
    /// from cell/Wi-Fi, carry no Doppler, and therefore report -1. Any
    /// test of the form `loc.speed >= drivingSpeed` is unreachable from
    /// those sources, so gating escalation on it meant the device stayed
    /// on the SLC net for the entire drive and only ever recorded a
    /// handful of ~500 m breadcrumbs with null speeds.
    ///
    /// The server learned this lesson in 2026-05 and the native layer
    /// never did: see `segmentSpeedMps` in lib/mileage/segmentation.ts,
    /// which trusts device-reported speed ONLY when it is > 0 and
    /// otherwise falls back to haversine over the time delta, precisely
    /// because a device that misreports speed must not be able to hide a
    /// real drive. This function is that same rule, applied at capture.
    private func effectiveSpeed(of loc: CLLocation) -> CLLocationSpeed {
        if loc.speed >= 0 { return loc.speed }
        guard let prev = lastFix else { return -1 }
        let dt = loc.timestamp.timeIntervalSince(prev.timestamp)
        guard dt > 0 else { return -1 }
        return loc.distance(from: prev) / dt
    }

    public func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard UserDefaults.standard.bool(forKey: kEnabled) else { return }
        var sawDriving = false
        for loc in locations {
            // Negative accuracy means the fix is invalid.
            guard loc.horizontalAccuracy >= 0 else { continue }
            append(loc)
            // Watermark for the gap audit. Throttled inside, and it can
            // only ever move forward, so a late fix cannot reopen an
            // already-audited window. Purely observational: it does not
            // touch capture.
            TaxotticVehicleSignals.shared.noteCapture(
                atMs: Int(loc.timestamp.timeIntervalSince1970 * 1000))
            let speed = effectiveSpeed(of: loc)
            lastFix = loc
            // Unknown speed with nothing to derive from means this is the
            // FIRST fix of a wake-up: SLC does not fire until the device
            // has moved roughly 500 m, so the OS has effectively just told
            // us the phone is travelling. Escalate and let the idle timer
            // below stand it back down if the derived speeds say we were
            // wrong. Treating "unknown" as "not driving" is what kept the
            // tracker asleep through entire trips.
            if speed >= drivingSpeed || speed < 0 {
                sawDriving = true
                if speed >= drivingSpeed { lastDrivingFixAt = Date() }
            }
        }
        if sawDriving {
            startFineUpdates()
        } else if fineUpdatesActive,
                  Date().timeIntervalSince(lastDrivingFixAt ?? .distantPast)
                    > idleStopInterval {
            // Parked long enough: drop back to the cheap SLC net. The
            // server's own parked test closes the trip.
            stopFineUpdates()
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // Losing "Always" (the recurring iOS failure) silently disarms
        // revival; regaining it re-arms without user action.
        if hasAlwaysAuthorization() {
            if UserDefaults.standard.bool(forKey: kEnabled) {
                manager.startMonitoringSignificantLocationChanges()
                // Region monitoring needs "Always" too, so the mesh went
                // down with SLC and comes back with it.
                rearmRegions()
            }
        } else {
            stopFineUpdates()
            // Record the loss rather than only reacting to it: an arm
            // state that still says "armed" while the OS has revoked
            // the permission is the lie that hid this class of failure.
            recordRegistration(armNoBackgroundPermission, count: 0,
                               error: "authorization is not authorizedAlways")
        }
    }

    public func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        guard UserDefaults.standard.bool(forKey: kEnabled) else { return }
        // A departure means a trip just began from a known place. Record
        // the departure point so the server has an anchor at the true
        // start, and escalate to fine updates immediately rather than
        // waiting for SLC's ~500 m threshold.
        let departed = visit.departureDate != Date.distantFuture
        guard departed, visit.coordinate.latitude != 0 || visit.coordinate.longitude != 0
        else { return }
        let loc = CLLocation(
            coordinate: visit.coordinate,
            altitude: 0,
            horizontalAccuracy: visit.horizontalAccuracy,
            verticalAccuracy: -1,
            timestamp: visit.departureDate
        )
        append(loc)
        startFineUpdates()
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Never surface; a transient CL error must not stop capture.
    }

    // ── Disk buffer ────────────────────────────────────────────────
    //
    // A plain JSON array, written synchronously on the utility queue.
    // Small, dependency-free, and survives termination — which is the
    // entire point. Points leave only when JavaScript confirms upload.

    private func bufferURL() -> URL? {
        try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true
        ).appendingPathComponent(kBufferFile)
    }

    private func append(_ loc: CLLocation) {
        queue.async { [weak self] in
            guard let self = self, let url = self.bufferURL() else { return }
            let ts = Int(loc.timestamp.timeIntervalSince1970 * 1000)
            guard self.shouldKeepFix(
                lat: loc.coordinate.latitude,
                lng: loc.coordinate.longitude,
                ts: ts) else { return }
            self.lastKeptFix = (loc.coordinate.latitude, loc.coordinate.longitude, ts)
            var points = self.readBuffer(url)
            points.append([
                "ts": ts,
                "lat": loc.coordinate.latitude,
                "lng": loc.coordinate.longitude,
                "speedMps": loc.speed >= 0 ? loc.speed : NSNull(),
                "accuracyM": loc.horizontalAccuracy,
            ])
            if points.count > self.maxBufferedPoints {
                points.removeFirst(points.count - self.maxBufferedPoints)
                // Dropping the oldest points is data loss, so say so
                // instead of trimming quietly. describeGeofenceHealth
                // turns this into a "waiting to upload" warning the
                // driver can act on.
                UserDefaults.standard.set(true, forKey: self.kBufferOverflow)
            }
            self.writeBuffer(points, to: url)
            self.noteCapturedFix()
        }
    }

    // ── Parked filter ──────────────────────────────────────────────
    //
    // A Swift port of lib/mileage/parked-filter.ts, applied at the point
    // fixes enter the buffer.
    //
    // It has to live here as well as in JavaScript because native
    // capture does not pass through the web tracker at all: without this
    // the native path would upload a parked phone's GPS scatter, one
    // point per second, and silently undo the 76% stationary-volume
    // reduction shipped in #556. Measured on the owner's phone: 2.6
    // hours parked produced 140 points whose MAXIMUM movement was 7.7 m.
    //
    // The two constants are shared policy, not per-platform tuning. See
    // the source file for why PARKED_KEEPALIVE_MS must stay strictly
    // under MAX_CAPTURE_GAP_MS (8 min): at 10 minutes, suppressing
    // fixes during a 9 minute stop MANUFACTURED a capture gap and
    // severed one drive into two, dropping the connector leg.

    /// Movement below this is scatter, not travel. PARKED_RADIUS_M.
    private let parkedRadiusM: CLLocationDistance = 30
    /// A parked phone still reports this often, so it never looks dead,
    /// and so the heartbeat that rides ingest keeps beating.
    /// PARKED_KEEPALIVE_MS.
    private let parkedKeepaliveMs = 5 * 60_000

    /// Keep the fix if it moved, or if the device is due to prove it is
    /// alive. An out-of-order fix (negative elapsed) is KEPT rather than
    /// judged: CLVisit departures are dated in the past, a late arrival
    /// costs one row, and dropping a real point costs mileage.
    ///
    /// Called only on `queue`, which owns `lastKeptFix`.
    private func shouldKeepFix(
        lat: CLLocationDegrees, lng: CLLocationDegrees, ts: Int
    ) -> Bool {
        guard let last = lastKeptFix else { return true }
        let elapsed = ts - last.ts
        if elapsed < 0 { return true }
        if elapsed >= parkedKeepaliveMs { return true }
        let a = CLLocation(latitude: last.lat, longitude: last.lng)
        let b = CLLocation(latitude: lat, longitude: lng)
        return b.distance(from: a) > parkedRadiusM
    }

    private func readBuffer(_ url: URL) -> [[String: Any]] {
        guard let data = try? Data(contentsOf: url),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return arr
    }

    private func writeBuffer(_ points: [[String: Any]], to url: URL) {
        guard let data = try? JSONSerialization.data(withJSONObject: points) else { return }
        try? data.write(to: url, options: .atomic)
    }

    /// Hand every buffered point to JavaScript. Nothing is deleted here
    /// — JS calls `clearBuffered(upTo:)` only after the server has
    /// accepted them, so a failed upload can never lose a drive.
    @objc public func drainBuffered() -> [[String: Any]] {
        queue.sync {
            guard let url = bufferURL() else { return [] }
            return readBuffer(url)
        }
    }

    /// Drop points at or before `ts` (milliseconds). Called after a
    /// confirmed upload.
    @objc public func clearBuffered(upTo ts: Int) {
        queue.sync {
            guard let url = bufferURL() else { return }
            let remaining = readBuffer(url).filter { ($0["ts"] as? Int ?? 0) > ts }
            writeBuffer(remaining, to: url)
            if remaining.isEmpty {
                UserDefaults.standard.set(false, forKey: kBufferOverflow)
            }
        }
    }

    @objc public func bufferedCount() -> Int {
        queue.sync {
            guard let url = bufferURL() else { return 0 }
            return readBuffer(url).count
        }
    }

    /// Drop the FIRST `count` buffered points, after JS confirmed the
    /// server accepted exactly those. Returns how many remain.
    ///
    /// Count-based rather than timestamp-based on purpose, even though
    /// `clearBuffered(upTo:)` sits right above. A CLVisit departure is
    /// dated at the moment the user actually left, which can be well in
    /// the past, so a timestamp cutoff can delete a later-appended fix
    /// that was never uploaded. Consuming a prefix cannot: it removes
    /// precisely what the caller read. Same semantics as Android's
    /// TaxotticGeofenceStore.consumeBuffer.
    @objc public func consumeBuffered(count: Int) -> Int {
        queue.sync {
            guard let url = bufferURL() else { return 0 }
            let points = readBuffer(url)
            guard count > 0 else { return points.count }
            let remaining: [[String: Any]] =
                count >= points.count ? [] : Array(points.dropFirst(count))
            writeBuffer(remaining, to: url)
            if remaining.isEmpty {
                UserDefaults.standard.set(false, forKey: kBufferOverflow)
            }
            return remaining.count
        }
    }

    // ── Learned-place region mesh ──────────────────────────────────
    //
    // Registration, the exit trigger, and the durable health state.
    // TaxotticGeofencePlugin is a thin bridge onto these; see the note
    // beside the key declarations at the top of this file for why none
    // of it may move into the plugin.

    private struct Place {
        let id: String
        let lat: CLLocationDegrees
        let lng: CLLocationDegrees
        let radius: CLLocationDistance
        let label: String
    }

    private func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

    private func writeJSON(_ object: [String: Any], forKey key: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let raw = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(raw, forKey: key)
    }

    private func readJSON(forKey key: String) -> [String: Any]? {
        guard let raw = UserDefaults.standard.string(forKey: key),
              let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return obj
    }

    // ── Places ─────────────────────────────────────────────────────

    /// Replace the monitored place list. The server's ranked list is
    /// trusted for ORDER; everything else is validated here, because a
    /// garbage region is worse than no region. Returns how many were
    /// kept. Mirrors TaxotticGeofenceStore.savePlaces.
    private func savePlaces(_ incoming: [[String: Any]]) -> Int {
        var kept: [[String: Any]] = []
        for raw in incoming {
            if kept.count >= Self.maxPlaces { break }
            let id = (raw["id"] as? String) ?? ""
            guard !id.isEmpty else { continue }
            guard let lat = numeric(raw["latitude"]), let lng = numeric(raw["longitude"])
            else { continue }
            guard lat >= -90, lat <= 90, lng >= -180, lng <= 180 else { continue }
            var radius = numeric(raw["radius"]) ?? minRegionRadius
            radius = min(max(radius, minRegionRadius), maxRegionRadius)
            // iOS refuses a region larger than the hardware ceiling and
            // simply never fires it, which would read as "armed" while
            // monitoring nothing.
            let ceiling = manager.maximumRegionMonitoringDistance
            if ceiling > 0 { radius = min(radius, ceiling) }
            kept.append([
                "id": id,
                "latitude": lat,
                "longitude": lng,
                "radius": radius,
                "label": (raw["label"] as? String) ?? "stop",
            ])
        }
        if let data = try? JSONSerialization.data(withJSONObject: kept),
           let raw = String(data: data, encoding: .utf8) {
            UserDefaults.standard.set(raw, forKey: kPlaces)
        }
        return kept.count
    }

    private func numeric(_ value: Any?) -> Double? {
        if let d = value as? Double { return d.isFinite ? d : nil }
        if let n = value as? NSNumber { return n.doubleValue.isFinite ? n.doubleValue : nil }
        return nil
    }

    private func storedPlaces() -> [Place] {
        guard let raw = UserDefaults.standard.string(forKey: kPlaces),
              let data = raw.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return arr.compactMap { item in
            guard let id = item["id"] as? String, !id.isEmpty,
                  let lat = numeric(item["latitude"]),
                  let lng = numeric(item["longitude"]),
                  let radius = numeric(item["radius"])
            else { return nil }
            return Place(id: id, lat: lat, lng: lng, radius: radius,
                         label: (item["label"] as? String) ?? "stop")
        }
    }

    // ── Registration ───────────────────────────────────────────────

    /// (Re)register the mesh, and record WHY when we refuse to.
    ///
    /// Resolution order is TaxotticGeofenceRegistrar.reregister's,
    /// deliberately, so the two platforms cannot drift into reporting
    /// different reasons for the same situation.
    @objc public func rearmRegions() {
        // 1. Region monitoring requires Always. Registering without it
        //    produces a mesh that fires only while the app is already
        //    open, which is exactly the case that never needed
        //    resurrecting. Refuse and say so.
        guard hasAlwaysAuthorization() else {
            recordRegistration(armNoBackgroundPermission, count: 0,
                               error: "authorization is not authorizedAlways")
            return
        }
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
            recordRegistration(armRegistrationFailed, count: 0,
                               error: "region monitoring unavailable on this device")
            return
        }

        let places = storedPlaces()
        var wanted: [String: Place] = [:]
        for place in places { wanted[place.id] = place }

        // Reconcile rather than tear down and rebuild. On a launch that
        // iOS started purely to deliver an exit, stopping every region
        // first can cancel the very delivery we woke for, so a region
        // that already matches is left strictly alone.
        var alreadyMonitored = Set<String>()
        for region in manager.monitoredRegions {
            guard let circle = region as? CLCircularRegion,
                  let want = wanted[circle.identifier],
                  matches(circle, want) else {
                manager.stopMonitoring(for: region)
                continue
            }
            alreadyMonitored.insert(circle.identifier)
        }

        // 2. Nothing to monitor is a state, not a failure: the server is
        //    still learning where this driver parks.
        if places.isEmpty {
            recordRegistration(armNoPlaces, count: 0, error: nil)
            return
        }

        for place in places where !alreadyMonitored.contains(place.id) {
            let region = CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: place.lat, longitude: place.lng),
                radius: place.radius,
                identifier: place.id)
            // EXIT is the whole feature: the phone has been parked for
            // hours and the drive begins by leaving. Entry is monitored
            // by nobody, so it costs nothing to suppress and it avoids
            // waking the app every time the driver comes home.
            region.notifyOnExit = true
            region.notifyOnEntry = false
            manager.startMonitoring(for: region)
        }

        // 3. Optimistic, corrected by monitoringDidFailFor below.
        //    startMonitoring reports failure asynchronously, so this is
        //    the same shape as Android's in-flight record.
        recordRegistration(armArmed, count: places.count, error: nil)
    }

    private func matches(_ region: CLCircularRegion, _ place: Place) -> Bool {
        let centre = CLLocation(latitude: region.center.latitude,
                                longitude: region.center.longitude)
        let wanted = CLLocation(latitude: place.lat, longitude: place.lng)
        return centre.distance(from: wanted) < 1 && abs(region.radius - place.radius) < 1
    }

    /// Forget every place and unregister the mesh.
    @objc public func clearPlaces() {
        UserDefaults.standard.removeObject(forKey: kPlaces)
        for region in manager.monitoredRegions { manager.stopMonitoring(for: region) }
        rearmRegions()
    }

    /// Replace the place list and re-register. Returns the accepted count.
    @objc public func syncPlaces(_ places: [[String: Any]]) -> Int {
        let accepted = savePlaces(places)
        rearmRegions()
        return accepted
    }

    // ── Region delegate callbacks ──────────────────────────────────
    //
    // These are the callbacks that must survive a cold relaunch, and
    // they are the reason this code is in the singleton. iOS delivers
    // them to whatever object is the manager's delegate at the moment
    // the app is running, which on a region-triggered launch is this
    // object and cannot be a Capacitor plugin.

    public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        let placeId = region.identifier
        guard UserDefaults.standard.bool(forKey: kEnabled) else {
            recordTransition(placeId: placeId, enter: false,
                             outcome: outcomeStartDenied, detail: "tracking_disabled")
            return
        }
        guard CLLocationManager.locationServicesEnabled() else {
            recordCapture(state: captureServicesOff, detail: "location services off",
                          running: false, force: true)
            recordTransition(placeId: placeId, enter: false,
                             outcome: outcomeStartDenied, detail: "location_services_off")
            return
        }
        guard hasAlwaysAuthorization() else {
            recordTransition(placeId: placeId, enter: false,
                             outcome: outcomeNoBackgroundPermission,
                             detail: "authorization is not authorizedAlways")
            return
        }
        // The existing fine-updates path, unchanged: it already owns
        // escalation, the idle stand-down, the disk buffer and the
        // vehicle signals. The region is only the trigger.
        startFineUpdates()
        recordTransition(placeId: placeId, enter: false,
                         outcome: outcomeStarted, detail: "exit")
    }

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        // Arriving somewhere is not a drive. Recorded, never acted on.
        // Regions are registered with notifyOnEntry = false, so this
        // should not fire at all; it exists so a region left over from
        // an older build cannot start a capture by surprise.
        recordTransition(placeId: region.identifier, enter: true,
                         outcome: outcomeEnterIgnored, detail: "")
    }

    public func locationManager(
        _ manager: CLLocationManager,
        monitoringDidFailFor region: CLRegion?,
        withError error: Error
    ) {
        // One region failing means the mesh is not what the state claims
        // it is, so the whole thing reports failed. Overstating health
        // is the failure mode this feature exists to remove.
        recordRegistration(
            armRegistrationFailed, count: 0,
            error: "\(region?.identifier ?? "unknown"): \(error.localizedDescription)")
    }

    // ── Durable health state ───────────────────────────────────────

    private func recordRegistration(_ armState: String, count: Int, error: String?) {
        let defaults = UserDefaults.standard
        defaults.set(armState, forKey: kArmState)
        defaults.set(count, forKey: kRegisteredCount)
        defaults.set(nowMs(), forKey: kRegisteredAt)
        defaults.set(error ?? "", forKey: kRegistrationError)
    }

    private func recordTransition(
        placeId: String, enter: Bool, outcome: String, detail: String
    ) {
        writeJSON([
            "placeId": placeId,
            "transition": enter ? "enter" : "exit",
            "outcome": outcome,
            "detail": detail,
            "atMs": nowMs(),
        ], forKey: kLastEvent)
    }

    /// Persist capture health. Throttled unless `force`, because this is
    /// written from the fix path and a UserDefaults write per GPS fix
    /// would be a needless disk write every second of every drive.
    private func recordCapture(
        state: String, detail: String, running: Bool, force: Bool
    ) {
        captureLock.lock()
        if !force, Date().timeIntervalSince(lastCaptureWriteAt) < 30 {
            captureLock.unlock()
            return
        }
        lastCaptureWriteAt = Date()
        let fixCount = captureFixCount
        let startedAtMs = captureStartedAtMs
        captureLock.unlock()

        writeJSON([
            "state": state,
            "detail": detail,
            "fixCount": fixCount,
            "startedAtMs": startedAtMs,
            "updatedAtMs": nowMs(),
        ], forKey: kLastCapture)
        UserDefaults.standard.set(running, forKey: kCaptureRunning)
    }

    /// A fix reached the buffer, so the session is no longer blind.
    private func noteCapturedFix() {
        captureLock.lock()
        let live = captureStartedAtMs > 0
        if live { captureFixCount += 1 }
        captureLock.unlock()
        guard live, UserDefaults.standard.bool(forKey: kCaptureRunning) else { return }
        recordCapture(state: captureCapturing, detail: "buffered", running: true, force: false)
    }

    /// The full health picture, shaped as `GeofenceState` in
    /// lib/mileage/geofence.ts. Every failure field is present on
    /// purpose: a status object that can only say "fine" is how the
    /// original blackout stayed invisible for a week.
    @objc public func geofenceState() -> [String: Any] {
        let defaults = UserDefaults.standard
        let registrationError = defaults.string(forKey: kRegistrationError) ?? ""
        var out: [String: Any] = [
            "armState": defaults.string(forKey: kArmState) ?? armNoPlaces,
            "registeredCount": defaults.integer(forKey: kRegisteredCount),
            "registeredAtMs": defaults.integer(forKey: kRegisteredAt),
            "registrationError": registrationError.isEmpty ? NSNull() : registrationError,
            "placeCount": storedPlaces().count,
            "maxPlaces": Self.maxPlaces,
            "backgroundLocation": hasAlwaysAuthorization(),
            "captureRunning": defaults.bool(forKey: kCaptureRunning),
            "bufferOverflow": defaults.bool(forKey: kBufferOverflow),
            "bufferedFixes": bufferedCount(),
        ]
        out["lastEvent"] = readJSON(forKey: kLastEvent) ?? NSNull()
        out["lastCapture"] = readJSON(forKey: kLastCapture) ?? NSNull()
        return out
    }

    @objc public func currentArmState() -> String {
        UserDefaults.standard.string(forKey: kArmState) ?? armNoPlaces
    }

    @objc public func hasBackgroundLocation() -> Bool { hasAlwaysAuthorization() }

    // ── Capture control for the web layer ──────────────────────────

    /// Start capturing because the WebView believes a drive is running.
    ///
    /// Additive, never a handoff. On iOS the web layer is the least
    /// reliable component in the system (timers do not fire when
    /// backgrounded, and the page is a REMOTE url), so native capture
    /// keeps running regardless of what JavaScript is doing. Both
    /// observing the same CLLocation is free: ingest is idempotent on
    /// (driver, company, captured_at), so the second write is a no-op.
    ///
    /// Returns (started, reason) with the reason recorded rather than
    /// swallowed, so a refusal is visible in the heartbeat.
    @objc public func startCaptureRequested() -> [String: Any] {
        guard UserDefaults.standard.bool(forKey: kEnabled) else {
            return ["started": false, "reason": "tracking_disabled"]
        }
        guard CLLocationManager.locationServicesEnabled() else {
            recordCapture(state: captureServicesOff, detail: "location services off",
                          running: false, force: true)
            return ["started": false, "reason": "location_services_off"]
        }
        guard hasAlwaysAuthorization() else {
            return ["started": false, "reason": "no_background_permission"]
        }
        startFineUpdates()
        return ["started": true, "reason": "started"]
    }

    /// Stand capture down because THE DRIVE IS OVER.
    ///
    /// Deliberately not called merely because the WebView woke up. See
    /// the capture-lifecycle section of the design note: handing capture
    /// back to the page means capture dies when the page does.
    @objc public func stopCaptureRequested() {
        stopFineUpdates()
    }
}
