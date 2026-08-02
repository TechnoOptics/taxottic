import Foundation
import AVFoundation
import CoreMotion
import UIKit

/// Vehicle-presence CONFIRMATION signals for iOS.
///
/// ── The one sentence that governs this whole file ──────────────────
/// Nothing here can wake a dead app, so nothing here may ever be
/// load-bearing for STARTING a trip.
///
/// Only three mechanisms relaunch a terminated iOS app, and all three
/// are CoreLocation: significant-location-change, region monitoring and
/// visit monitoring. Two of them are already live in
/// `TaxotticBackgroundLocation`. Every signal in this file is observed
/// only once some CoreLocation event has already brought us back to
/// life, so each one can raise or lower confidence in a trip that
/// already started, and can explain a gap after the fact. None of them
/// can start anything. Getting that backwards is how "Bluetooth is the
/// most reliable signal" becomes a design that never fires.
///
/// This class therefore EMITS timestamped signal events and decides
/// nothing. Scoring lives elsewhere. The buffer is bounded, self-aging
/// and drained by JavaScript, so if no consumer ever appears the whole
/// subsystem costs one file on disk and no behaviour change.
///
/// ── What was verified, and where ───────────────────────────────────
/// Read from the iOS 26.4 SDK headers on the build machine, not
/// recalled:
///
///  1. CoreBluetooth is Bluetooth Low Energy ONLY. `CoreBluetooth.h`
///     describes itself as the "Bluetooth Low Energy framework" and
///     every manager-state constant is LE-scoped
///     (`CBManagerStateUnsupported`: "The platform doesn't support the
///     Bluetooth Low Energy Central/Client role"). Classic car audio
///     (A2DP/HFP) is invisible to it. The obvious "detect the car's
///     Bluetooth" implementation does not exist on iOS, which is why
///     this file uses the audio route instead.
///
///  2. `AVAudioSessionPortCarAudio` ("Input or output via Car Audio")
///     is the port type a head unit presents, and it covers classic
///     Bluetooth and wired/USB car connections alike. See
///     `carAudioPortTypes` below for the exact set and why HFP is
///     excluded.
///
///  3. `CMMotionActivityManager` retains roughly seven days: "Data is
///     only available for the last seven days"
///     (`CMMotionActivityManager.h`). The same header states the design
///     intent this file exploits: "Updates are not delivered while the
///     application is suspended, the application may use
///     queryActivityStartingFromDate:toDate:toQueue:withHandler: to get
///     activities from the time when the application was suspended."
///     Apple is describing our blackout, and prescribing the fix.
///
///  4. `CMMotionActivity` properties are NOT mutually exclusive. The
///     header's own example: stopped at a stop sign reads
///     `stationary = YES, automotive = YES`. Treating stationary as
///     "not driving" would delete every traffic light from a
///     reconstructed drive.
///
/// ── CarPlay: confirmed unavailable, deliberately not built ─────────
/// CarPlay app entitlements are granted by Apple per app category
/// (audio, navigation, EV charging, parking, quick food ordering,
/// driving task, fueling, communication). A mileage and tax tool is in
/// none of them, so the entitlement request would be refused, and the
/// framework's connection notifications are unreachable without it.
/// Even granted it would cover only the fraction of vehicles that ship
/// CarPlay. There is no CarPlay code in this file on purpose. Note that
/// a CarPlay head unit still shows up as an `AVAudioSessionPortCarAudio`
/// output when audio is routed to it, so the route signal below picks up
/// part of that population anyway, for free and with no entitlement.
///
/// ── The audio-route honesty problem ────────────────────────────────
/// A route-change NOTIFICATION is an NSNotification, and an NSNotification
/// is delivered only to a process that is running. That is not a
/// hypothesis, it is what a notification is. A suspended app runs no
/// code, so it observes no route change, and nothing replays the missed
/// ones when it resumes.
///
/// Making the notification survive backgrounding would require
/// `UIBackgroundModes: audio` plus an audio session this app holds
/// active at all times. This app is a WebView tax tool that plays
/// nothing. An always-on audio session would burn battery, would
/// duck/interrupt the user's actual music, and is exactly the kind of
/// background-mode abuse App Review rejects, because the declared mode
/// would not match any audio feature in the product. We do not do it,
/// and we do not pretend the notification covers the backgrounded case.
///
/// So the audio signal is delivered two ways, and only the second one
/// is trustworthy while backgrounded:
///
///   * `source: "event"`: a real route change observed while our
///     process happened to be running. Precise timestamp. Best case.
///   * `source: "poll"`: `currentRoute` read at wake, launch and
///     foreground. Reading the CURRENT route needs no active session
///     and no notification, so whenever CoreLocation revives us we can
///     still ask "is the phone plugged into a car right now?" and get a
///     true answer. The timestamp is when we looked, NOT when the car
///     connected, and the event records that distinction so the scorer
///     never mistakes one for the other.
///
/// Both are Tier 2. Neither wakes anything.
@objc public class TaxotticVehicleSignals: NSObject {

    @objc public static let shared = TaxotticVehicleSignals()

    // ── Event vocabulary (the contract with the scoring layer) ─────
    //
    // These strings are a CROSS-AGENT CONTRACT. Adding new kinds or
    // states is safe; renaming or repurposing an existing one is not.

    /// Phone's audio output is (or is not) a car head unit.
    public static let kindCarAudioRoute = "carAudioRoute"
    /// Live `CMMotionActivity` update while our process was running.
    public static let kindMotionActivity = "motionActivity"
    /// A segment recovered from the OS's motion history, after the fact.
    public static let kindMotionHistory = "motionHistory"
    /// The result of comparing a capture gap against motion history.
    public static let kindCaptureAudit = "captureAudit"

    private let kBufferFile = "taxottic-vehicle-signals.json"
    /// Last instant the location layer captured a fix, so an audit knows
    /// where the gap starts even when JavaScript never ran.
    private let kLastCaptureMs = "taxottic.signals.lastCaptureMs"
    /// Last instant an automatic audit ran, to bound how often we ask.
    private let kLastAuditMs = "taxottic.signals.lastAuditMs"

    /// The OS keeps ~7 days (verified in `CMMotionActivityManager.h`).
    /// Asking for more is not an error, it just returns nothing, but
    /// clamping keeps the reported window honest.
    private let historyWindow: TimeInterval = 7 * 24 * 60 * 60
    /// Ignore automotive blips shorter than this when reconstructing a
    /// gap. A 20-second automotive flicker is noise or a car park
    /// shuffle, not a deductible drive, and IRS numbers must not be
    /// built out of noise.
    private let minReportableSegment: TimeInterval = 60
    /// Do not audit unless the gap is at least this long. Below it the
    /// ordinary capture path is the better record anyway.
    private let minAuditableGap: TimeInterval = 20 * 60
    /// At most one automatic audit per this interval.
    private let autoAuditInterval: TimeInterval = 30 * 60
    /// Hard cap on buffered events. Signals are far sparser than GPS
    /// fixes, so this is days of driving.
    private let maxBufferedEvents = 2_000
    /// Drop events older than the motion-history window; past that the
    /// OS itself can no longer corroborate them.
    private let maxEventAge: TimeInterval = 7 * 24 * 60 * 60
    /// Throttle for persisting the last-capture watermark, so a 1 Hz GPS
    /// stream does not mean a 1 Hz UserDefaults write.
    private let captureNoteThrottle: TimeInterval = 60

    /// Output ports that mean "this phone is connected to a car".
    ///
    /// `.carAudio` is the head-unit port and is the signal proper.
    /// `.usbAudio` is included because a wired CarPlay or USB head-unit
    /// connection presents as USB audio on some vehicles.
    ///
    /// `.bluetoothHFP` is deliberately EXCLUDED even though a car
    /// hands-free profile matches it: HFP is also every bluetooth
    /// headset and speakerphone on earth, so including it would turn a
    /// desk headset into vehicle evidence. `.bluetoothA2DP` is excluded
    /// for the same reason, since it is indistinguishable from ordinary
    /// bluetooth headphones at the port level.
    private let carAudioPortTypes: Set<AVAudioSession.Port> = [
        .carAudio, .usbAudio,
    ]

    private let queue = DispatchQueue(label: "com.taxottic.vehiclesignals", qos: .utility)
    private let activityManager = CMMotionActivityManager()
    private let activityQueue = OperationQueue()

    /// Last emitted state per kind, used to suppress repeats. Touched
    /// only on `queue`.
    private var lastStateByKind: [String: String] = [:]
    private var routeObserverInstalled = false
    private var liveUpdatesActive = false
    private var lastCaptureNoteAt: Date?

    private override init() {
        super.init()
        activityQueue.maxConcurrentOperationCount = 1
        activityQueue.qualityOfService = .utility
    }

    // ── Monotonic time ─────────────────────────────────────────────
    //
    // Wall clock alone is not enough: a user (or NTP) can move the
    // clock, and these events are evidence about a tax number. Every
    // event therefore carries BOTH a wall-clock instant (so it can be
    // lined up against captured GPS points, which are wall clock) and a
    // monotonic instant (so ordering and elapsed time survive a clock
    // change).
    //
    // `systemUptime` resets to zero at boot, so a monotonic value is
    // only comparable against another from the SAME boot. `bootMs`
    // identifies that boot: it is the wall-clock instant the device
    // started, which every process in a boot computes identically, and
    // it lets a consumer detect a clock jump (bootMs moving without a
    // reboot means the wall clock was changed).

    private func monotonicMs() -> Int {
        Int(ProcessInfo.processInfo.systemUptime * 1000)
    }

    private func bootMs() -> Int {
        let uptime = ProcessInfo.processInfo.systemUptime
        // Round to whole seconds so two reads inside one boot agree.
        return Int((Date().timeIntervalSince1970 - uptime).rounded()) * 1000
    }

    // ── Lifecycle ──────────────────────────────────────────────────

    /// Call from AppDelegate on EVERY launch, including background
    /// relaunches. Cheap and idempotent: it installs notification
    /// observers and takes one route reading. It starts no sensors, so
    /// it costs nothing on a launch that turns out not to be a drive.
    @objc public func restoreOnLaunch() {
        installRouteObserver()
        // A background relaunch is precisely the moment the poll is
        // worth taking: CoreLocation just told us something moved, and
        // the route says whether it moved in a car.
        pollCarAudioRoute(source: "poll")
    }

    /// Foreground entry point. Safe to call on every resume.
    @objc public func onBecameActive() {
        installRouteObserver()
        pollCarAudioRoute(source: "poll")
        runAutomaticAuditIfDue()
    }

    private func installRouteObserver() {
        guard !routeObserverInstalled else { return }
        routeObserverInstalled = true
        // Obtaining the shared session does NOT activate it and needs no
        // permission. We never call setActive(true): see the file header
        // for why an always-on audio session is not acceptable here.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRouteChange(_:)),
            name: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    // ── Signal 1: car audio route ──────────────────────────────────

    @objc private func handleRouteChange(_ note: Notification) {
        let reasonRaw = (note.userInfo?[AVAudioSessionRouteChangeReasonKey]
            as? NSNumber)?.uintValue ?? 0
        let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw)
        emitCarAudioState(source: "event", reason: describe(reason))
    }

    /// Read the CURRENT output route. Requires no active session and no
    /// notification, which is the entire reason it is the trustworthy
    /// half of this signal.
    private func pollCarAudioRoute(source: String) {
        emitCarAudioState(source: source, reason: nil)
    }

    private func emitCarAudioState(source: String, reason: String?) {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        let matched = outputs.first { carAudioPortTypes.contains($0.portType) }
        var detail: [String: Any] = [
            "outputs": outputs.map { $0.portType.rawValue },
        ]
        if let reason { detail["reason"] = reason }
        if let matched { detail["portType"] = matched.portType.rawValue }
        record(
            kind: Self.kindCarAudioRoute,
            state: matched != nil ? "connected" : "disconnected",
            // AVAudioSession reports no confidence for a route, so this
            // is null rather than an invented number. A route either is
            // or is not car audio.
            confidence: nil,
            source: source,
            detail: detail
        )
    }

    private func describe(_ reason: AVAudioSession.RouteChangeReason?) -> String {
        switch reason {
        case .newDeviceAvailable: return "newDeviceAvailable"
        case .oldDeviceUnavailable: return "oldDeviceUnavailable"
        case .categoryChange: return "categoryChange"
        case .override: return "override"
        case .wakeFromSleep: return "wakeFromSleep"
        case .noSuitableRouteForCategory: return "noSuitableRouteForCategory"
        case .routeConfigurationChange: return "routeConfigurationChange"
        case .unknown: return "unknown"
        default: return "unknown"
        }
    }

    /// Current car-audio state without emitting anything, for the health
    /// payload.
    @objc public func isCarAudioConnected() -> Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains {
            carAudioPortTypes.contains($0.portType)
        }
    }

    // ── Signal 2: live motion activity ─────────────────────────────
    //
    // Nothing else in this codebase touches CMMotionActivity. The
    // existing TaxotticDeviceStatusPlugin uses CMPedometer (step counts,
    // for walk-away drive-end detection), which is a different sensor
    // with a different question, so this is not a second path onto the
    // same API. Both share the one NSMotionUsageDescription grant.
    //
    // Bounded on purpose: live updates run ONLY while the location layer
    // has escalated to fine updates, which is the window where we
    // already believe a drive is happening and are already holding the
    // GPS open. Outside that window the incremental battery cost is
    // zero because nothing is sampling. The header is explicit that
    // updates stop anyway while suspended, so running them permanently
    // would buy nothing.

    @objc public func startLiveUpdates() {
        guard motionUsable(), !liveUpdatesActive else { return }
        liveUpdatesActive = true
        activityManager.startActivityUpdates(to: activityQueue) { [weak self] activity in
            guard let self, let activity else { return }
            self.record(
                kind: Self.kindMotionActivity,
                state: Self.state(of: activity),
                confidence: Self.confidenceValue(activity.confidence),
                source: "live",
                detail: [
                    "automotive": activity.automotive,
                    "stationary": activity.stationary,
                    // startDate is when the OS believes the state began,
                    // which can predate the moment it told us.
                    "startTsMs": Int(activity.startDate.timeIntervalSince1970 * 1000),
                ]
            )
        }
    }

    @objc public func stopLiveUpdates() {
        guard liveUpdatesActive else { return }
        liveUpdatesActive = false
        activityManager.stopActivityUpdates()
    }

    /// Note that the location layer captured a fix. Feeds the automatic
    /// gap audit so it works even when JavaScript never runs. Throttled,
    /// because this is on the per-fix path.
    @objc public func noteCapture(atMs ms: Int) {
        queue.async { [weak self] in
            guard let self else { return }
            let now = Date()
            if let last = self.lastCaptureNoteAt,
               now.timeIntervalSince(last) < self.captureNoteThrottle {
                return
            }
            self.lastCaptureNoteAt = now
            let previous = UserDefaults.standard.integer(forKey: self.kLastCaptureMs)
            // Never move the watermark backwards: a late-delivered fix
            // must not reopen a window we already audited.
            if ms > previous {
                UserDefaults.standard.set(ms, forKey: self.kLastCaptureMs)
            }
        }
    }

    // ── Signal 3: seven-day motion history (the valuable one) ───────
    //
    // This is the only mechanism on iOS that turns an invisible blackout
    // into a detectable, explainable and partially reconstructable gap.
    // Everything else adds another way to START a trip; this adds a way
    // to KNOW one was missed.
    //
    // What it can reconstruct:
    //   * that the user was in a vehicle, WHEN, and for how long
    //   * the OS's own confidence in that call
    //   * whether the phone was off (`unknown` is documented as "the
    //     device was turned off"), which separates "we failed" from
    //     "there was nothing to capture"
    //
    // What it can NOT reconstruct, ever:
    //   * where the drive went. There is no location in this data.
    //   * therefore distance, and therefore a deductible mile.
    //
    // That second list is a feature, not a limitation to work around. A
    // fabricated mile is worse than a missed one, so this surfaces the
    // gap with its duration and leaves the mileage to the user's own
    // manual entry.

    private func motionUsable() -> Bool {
        CMMotionActivityManager.isActivityAvailable()
            && CMMotionActivityManager.authorizationStatus() == .authorized
    }

    @objc public func motionAvailable() -> Bool {
        CMMotionActivityManager.isActivityAvailable()
    }

    @objc public func motionAuthorizationString() -> String {
        switch CMMotionActivityManager.authorizationStatus() {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "notDetermined"
        }
    }

    /// Contiguous automotive stretches between two instants, from the
    /// OS's own record.
    ///
    /// Deliberately does NOT emit events or prompt for permission: it is
    /// the read primitive that `auditGap` and the JS bridge share. When
    /// motion is unavailable or not granted it completes with an empty
    /// list and an explanatory status, so every caller degrades to
    /// exactly today's behaviour.
    public func queryAutomotiveSegments(
        fromMs: Int,
        toMs: Int,
        completion: @escaping (_ status: String, _ segments: [[String: Any]]) -> Void
    ) {
        guard CMMotionActivityManager.isActivityAvailable() else {
            completion("unavailable", [])
            return
        }
        guard CMMotionActivityManager.authorizationStatus() == .authorized else {
            completion(motionAuthorizationString(), [])
            return
        }
        let now = Date()
        let earliest = now.addingTimeInterval(-historyWindow)
        var from = Date(timeIntervalSince1970: Double(fromMs) / 1000.0)
        var to = Date(timeIntervalSince1970: Double(toMs) / 1000.0)
        if from < earliest { from = earliest }
        if to > now { to = now }
        guard from < to else {
            completion("emptyWindow", [])
            return
        }
        activityManager.queryActivityStarting(from: from, to: to, to: activityQueue) {
            [weak self] activities, error in
            guard let self else { return }
            if error != nil {
                // A CMErrorMotionActivityNotAuthorized surfaces here as
                // well as through authorizationStatus. Either way the
                // honest answer is "no data", never a guess.
                completion("error", [])
                return
            }
            completion("ok", self.collapse(activities ?? [], from: from, to: to))
        }
    }

    /// Collapse the OS's activity transitions into automotive segments.
    ///
    /// CMMotionActivity is a TRANSITION list: each entry carries the
    /// instant a state began, and that state holds until the next entry.
    /// So a segment's end is the NEXT entry's startDate, and the last
    /// entry runs to the end of the queried window.
    ///
    /// `stationary && automotive` counts as automotive, per the header's
    /// own stop-sign example. Dropping it would chop every drive into
    /// fragments at every traffic light.
    private func collapse(
        _ activities: [CMMotionActivity],
        from: Date,
        to: Date
    ) -> [[String: Any]] {
        var segments: [[String: Any]] = []
        var runStart: Date?
        var runConfidence = CMMotionActivityConfidence.low
        var sawStationary = false

        func closeRun(at end: Date) {
            guard let start = runStart else { return }
            runStart = nil
            let duration = end.timeIntervalSince(start)
            guard duration >= minReportableSegment else { return }
            segments.append([
                "startTsMs": Int(start.timeIntervalSince1970 * 1000),
                "endTsMs": Int(end.timeIntervalSince1970 * 1000),
                "durationMs": Int(duration * 1000),
                "confidence": Self.confidenceValue(runConfidence),
                "includedStationary": sawStationary,
            ])
        }

        for (index, activity) in activities.enumerated() {
            // The header notes the first entry may start before `from`;
            // clamp so a reported segment never claims time outside the
            // window the caller asked about.
            let start = max(activity.startDate, from)
            let end = index + 1 < activities.count
                ? min(activities[index + 1].startDate, to)
                : to
            guard end > start else { continue }
            if activity.automotive {
                if runStart == nil {
                    runStart = start
                    runConfidence = activity.confidence
                    sawStationary = false
                } else if activity.confidence.rawValue < runConfidence.rawValue {
                    // A run is only as good as its weakest evidence.
                    runConfidence = activity.confidence
                }
                if activity.stationary { sawStationary = true }
            } else {
                closeRun(at: start)
            }
        }
        closeRun(at: to)
        return segments
    }

    /// Compare a capture gap against motion history and RECORD what the
    /// OS says happened in it.
    ///
    /// This is the "never fail silently" mechanism. It emits one
    /// `motionHistory` event per automotive segment plus one
    /// `captureAudit` summary, so a consumer can tell the user "you were
    /// driving for 34 minutes at 08:12 on Tuesday and we recorded none
    /// of it" instead of showing a blank day that looks like a day off.
    public func auditGap(
        fromMs: Int,
        toMs: Int,
        completion: @escaping ([String: Any]) -> Void
    ) {
        let gapMs = max(0, toMs - fromMs)
        queryAutomotiveSegments(fromMs: fromMs, toMs: toMs) { [weak self] status, segments in
            guard let self else { return }
            var automotiveMs = 0
            for segment in segments {
                automotiveMs += segment["durationMs"] as? Int ?? 0
                self.record(
                    kind: Self.kindMotionHistory,
                    state: "automotive",
                    confidence: segment["confidence"] as? Double,
                    source: "history",
                    detail: segment,
                    tsMs: segment["startTsMs"] as? Int
                )
            }
            let summary: [String: Any] = [
                "status": status,
                "fromTsMs": fromMs,
                "toTsMs": toMs,
                "gapMs": gapMs,
                "automotiveMs": automotiveMs,
                "segmentCount": segments.count,
                "segments": segments,
            ]
            self.record(
                kind: Self.kindCaptureAudit,
                // A gap the OS says contained driving is the alarming
                // one. A gap it says contained none is a REASSURING
                // result and worth recording too: it converts "we do not
                // know" into "nothing was missed", which is the whole
                // point of auditing.
                state: status == "ok"
                    ? (segments.isEmpty ? "noDrivingInGap" : "drivingMissed")
                    : status,
                confidence: nil,
                source: "audit",
                detail: summary
            )
            completion(summary)
        }
    }

    /// Audit the window since the last known capture, at most once per
    /// `autoAuditInterval`.
    ///
    /// Two guards make this safe to call on every foreground:
    ///
    ///  1. It runs only when motion is ALREADY authorized. If the grant
    ///     is notDetermined this does nothing at all, so it can never
    ///     surprise a user with a Motion & Fitness prompt at a moment
    ///     they did not ask for. The prompt stays owned by the existing
    ///     explicit permission flow.
    ///  2. It never touches capture. A denied or missing grant leaves
    ///     the app behaving exactly as it does today, minus these
    ///     events.
    @objc public func runAutomaticAuditIfDue() {
        guard motionUsable() else { return }
        let defaults = UserDefaults.standard
        let nowMs = Int(Date().timeIntervalSince1970 * 1000)
        let lastCapture = defaults.integer(forKey: kLastCaptureMs)
        guard lastCapture > 0 else { return }
        let lastAudit = defaults.integer(forKey: kLastAuditMs)
        if nowMs - lastAudit < Int(autoAuditInterval * 1000) { return }
        if nowMs - lastCapture < Int(minAuditableGap * 1000) { return }
        defaults.set(nowMs, forKey: kLastAuditMs)
        auditGap(fromMs: lastCapture, toMs: nowMs) { _ in }
    }

    // ── Event shape ────────────────────────────────────────────────

    private static func confidenceValue(_ c: CMMotionActivityConfidence) -> Double {
        // CoreMotion exposes three ordinal buckets and no probability.
        // These numbers are a stable MAPPING of those buckets onto the
        // 0..1 field, not a measured likelihood, and the raw bucket is
        // preserved in `state`/`detail` so a scorer can re-map without
        // losing information.
        switch c {
        case .high: return 0.9
        case .medium: return 0.6
        case .low: return 0.3
        @unknown default: return 0.3
        }
    }

    private static func state(of activity: CMMotionActivity) -> String {
        // Ordered by what matters to a mileage tracker. `automotive`
        // wins over `stationary` because a car at a red light is still a
        // car, and the two flags are documented as non-exclusive.
        if activity.automotive { return activity.stationary ? "automotiveStopped" : "automotive" }
        if activity.cycling { return "cycling" }
        if activity.running { return "running" }
        if activity.walking { return "walking" }
        if activity.stationary { return "stationary" }
        if activity.unknown { return "unknown" }
        return "other"
    }

    /// Append one signal event.
    ///
    /// Repeat suppression is deliberate: live activity updates and
    /// foreground polls both re-report an unchanged state, and a buffer
    /// full of "still disconnected" is noise a scorer has to filter.
    /// History and audit events are never suppressed, because each one
    /// describes a distinct past window.
    private func record(
        kind: String,
        state: String,
        confidence: Double?,
        source: String,
        detail: [String: Any],
        tsMs: Int? = nil
    ) {
        let wallMs = tsMs ?? Int(Date().timeIntervalSince1970 * 1000)
        let mono = monotonicMs()
        let boot = bootMs()
        queue.async { [weak self] in
            guard let self else { return }
            let suppressible = kind == Self.kindCarAudioRoute
                || kind == Self.kindMotionActivity
            if suppressible, self.lastStateByKind[kind] == state { return }
            self.lastStateByKind[kind] = state

            var event: [String: Any] = [
                "kind": kind,
                "state": state,
                "tsMs": wallMs,
                "monotonicMs": mono,
                "bootMs": boot,
                "source": source,
                "confidence": confidence.map { $0 as Any } ?? NSNull(),
            ]
            if !detail.isEmpty { event["detail"] = detail }

            guard let url = self.bufferURL() else { return }
            var events = self.readBuffer(url)
            events.append(event)
            self.writeBuffer(self.prune(events), to: url)
        }
    }

    // ── Disk buffer ────────────────────────────────────────────────
    //
    // Same shape and same discipline as the location buffer in
    // TaxotticBackgroundLocation: a plain JSON array written atomically
    // on a utility queue, surviving termination, cleared only after a
    // consumer confirms it took the data. Signal events must outlive the
    // process for the same reason fixes must: the interesting ones are
    // recorded during a background wake that JavaScript never sees.

    private func bufferURL() -> URL? {
        try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true
        ).appendingPathComponent(kBufferFile)
    }

    private func prune(_ events: [[String: Any]]) -> [[String: Any]] {
        let cutoff = Int(Date().addingTimeInterval(-maxEventAge).timeIntervalSince1970 * 1000)
        var kept = events.filter { ($0["tsMs"] as? Int ?? 0) >= cutoff }
        if kept.count > maxBufferedEvents {
            kept.removeFirst(kept.count - maxBufferedEvents)
        }
        return kept
    }

    private func readBuffer(_ url: URL) -> [[String: Any]] {
        guard let data = try? Data(contentsOf: url),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return arr
    }

    private func writeBuffer(_ events: [[String: Any]], to url: URL) {
        guard let data = try? JSONSerialization.data(withJSONObject: events) else { return }
        try? data.write(to: url, options: .atomic)
    }

    /// Hand every buffered event to the consumer. Nothing is deleted
    /// here; the caller clears only what it accepted.
    @objc public func drainSignals() -> [[String: Any]] {
        queue.sync {
            guard let url = bufferURL() else { return [] }
            return readBuffer(url)
        }
    }

    /// Drop events at or before `ts` (wall-clock ms).
    @objc public func clearSignals(upTo ts: Int) {
        queue.sync {
            guard let url = bufferURL() else { return }
            let remaining = readBuffer(url).filter { ($0["tsMs"] as? Int ?? 0) > ts }
            writeBuffer(remaining, to: url)
        }
    }

    @objc public func signalCount() -> Int {
        queue.sync {
            guard let url = bufferURL() else { return 0 }
            return readBuffer(url).count
        }
    }

    /// Boot identity for the monotonic clock, exposed so a consumer can
    /// tell whether two `monotonicMs` values are comparable.
    @objc public func currentBootMs() -> Int { bootMs() }
}
