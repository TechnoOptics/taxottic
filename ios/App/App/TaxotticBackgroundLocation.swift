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
    }

    private func stopFineUpdates() {
        guard fineUpdatesActive else { return }
        fineUpdatesActive = false
        manager.stopUpdatingLocation()
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
            }
        } else {
            stopFineUpdates()
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
            var points = self.readBuffer(url)
            points.append([
                "ts": Int(loc.timestamp.timeIntervalSince1970 * 1000),
                "lat": loc.coordinate.latitude,
                "lng": loc.coordinate.longitude,
                "speedMps": loc.speed >= 0 ? loc.speed : NSNull(),
                "accuracyM": loc.horizontalAccuracy,
            ])
            if points.count > self.maxBufferedPoints {
                points.removeFirst(points.count - self.maxBufferedPoints)
            }
            self.writeBuffer(points, to: url)
        }
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
        }
    }

    @objc public func bufferedCount() -> Int {
        queue.sync {
            guard let url = bufferURL() else { return 0 }
            return readBuffer(url).count
        }
    }
}
