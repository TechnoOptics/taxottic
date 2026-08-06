import Foundation
import Capacitor
import CoreLocation
import CoreMotion
import MetricKit
import UIKit

/// Device-truth probe for mileage reliability (plan §C). Reports the
/// EXACT location authorization level — the thing nothing else in the
/// stack can see: iOS silently downgrades provisional "Always" to
/// "While Using" without any error reaching the Capgo tracker, which is
/// how a driver lost 17 hours of drives twice. Also fires an
/// `authorizationChanged` event the moment the level changes
/// (locationManagerDidChangeAuthorization fires on every change,
/// including the silent downgrade), so the web layer can alert
/// instantly instead of inferring from hours of GPS silence.
///
/// Mirrors TaxotticWidgetBridgePlugin's registration pattern:
/// CAPBridgedPlugin in the app target + packageClassList entry.
@objc(TaxotticDeviceStatusPlugin)
public class TaxotticDeviceStatusPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "TaxotticDeviceStatusPlugin"
    public let jsName = "TaxotticDeviceStatus"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAlwaysUpgrade", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryStepsSince", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openLocationSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enableBackgroundRevival", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disableBackgroundRevival", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainBufferedLocations", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearBufferedLocations", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getExitInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainVehicleSignals", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearVehicleSignals", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryMotionHistory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "auditCaptureGap", returnType: CAPPluginReturnPromise)
    ]

    private var manager: CLLocationManager?
    private let pedometer = CMPedometer()

    override public func load() {
        let m = CLLocationManager()
        m.delegate = self
        manager = m
    }

    private func authString(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "notDetermined"
        @unknown default: return "notDetermined"
        }
    }

    private func statusPayload() -> [String: Any] {
        let m = manager ?? CLLocationManager()
        var payload: [String: Any] = [
            "platform": "ios",
            "locationAuthorization": authString(m.authorizationStatus),
            "preciseLocation": m.accuracyAuthorization == .fullAccuracy,
            "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
            // Walk-away drive-end support: step counting available and
            // not explicitly denied (notDetermined is fine — the first
            // pedometer query triggers the Motion & Fitness prompt).
            "motionPermission": CMPedometer.isStepCountingAvailable()
                && CMPedometer.authorizationStatus() != .denied
                && CMPedometer.authorizationStatus() != .restricted,
            // Motion ACTIVITY, distinct from the pedometer above: this
            // is what powers gap auditing against the OS's seven-day
            // history. Reported explicitly rather than collapsed into
            // motionPermission so a denied grant is VISIBLE in health
            // state instead of silently degrading the blackout audit to
            // nothing. Neither read prompts the user.
            "motionActivityAvailable": TaxotticVehicleSignals.shared.motionAvailable(),
            "motionActivityAuthorization":
                TaxotticVehicleSignals.shared.motionAuthorizationString(),
            // Tier 2 confirmation only. A car audio route can never wake
            // this app, so nothing may start a trip from it.
            "carAudioConnected": TaxotticVehicleSignals.shared.isCarAudioConnected()
        ]
        // Background App Refresh off = no relaunch events ever fire;
        // the wizard warns on this. Main-thread only API.
        if Thread.isMainThread {
            payload["backgroundRefresh"] =
                UIApplication.shared.backgroundRefreshStatus == .available
        }
        return payload
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(self.statusPayload())
        }
    }

    /// Steps taken since `fromMs` (epoch ms), from the motion
    /// coprocessor. The tracker uses this + GPS-stationary time to
    /// decide a drive has ENDED (the driver walked away) and close it
    /// immediately, instead of waiting out the server's parked timer.
    /// See lib/mileage/drive-end.ts. Needs Motion & Fitness
    /// (NSMotionUsageDescription); returns 0 when unavailable/denied so
    /// the drive-end logic simply falls back to the stationary timeout.
    @objc func queryStepsSince(_ call: CAPPluginCall) {
        guard CMPedometer.isStepCountingAvailable() else {
            call.resolve(["steps": 0, "available": false])
            return
        }
        let fromMs = call.getDouble("fromMs") ?? 0
        let from = Date(timeIntervalSince1970: fromMs / 1000.0)
        let to = Date()
        guard from < to else {
            call.resolve(["steps": 0, "available": true])
            return
        }
        pedometer.queryPedometerData(from: from, to: to) { data, error in
            let steps = (error == nil) ? (data?.numberOfSteps.intValue ?? 0) : 0
            call.resolve(["steps": steps, "available": true])
        }
    }

    /// Deliberately drive the provisional→real Always upgrade prompt
    /// (after a first successful trip, from the wizard) instead of
    /// letting iOS pick a random moment for its own reminder alert.
    @objc func requestAlwaysUpgrade(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.manager?.requestAlwaysAuthorization()
            call.resolve()
        }
    }

    /// Open this app's iOS Settings page (where Location lives). iOS
    /// offers no deeper per-permission deep link, but this lands the
    /// user one tap from Location → Always, unlike a generic bounce.
    @objc func openLocationSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

        // ── Native background revival bridge ───────────────────────────
    // The capture itself is WebView-independent (see
    // TaxotticBackgroundLocation); these only let JS arm it and collect
    // what it recorded while the page was not alive.

    @objc func enableBackgroundRevival(_ call: CAPPluginCall) {
        let companyId = call.getString("companyId") ?? ""
        TaxotticBackgroundLocation.shared.enable(companyId: companyId)
        call.resolve(["ok": true])
    }

    @objc func disableBackgroundRevival(_ call: CAPPluginCall) {
        TaxotticBackgroundLocation.shared.disable()
        call.resolve(["ok": true])
    }

    @objc func drainBufferedLocations(_ call: CAPPluginCall) {
        let points = TaxotticBackgroundLocation.shared.drainBuffered()
        call.resolve([
            "points": points,
            "companyId": TaxotticBackgroundLocation.shared.currentCompanyId(),
        ])
    }

    @objc func clearBufferedLocations(_ call: CAPPluginCall) {
        // Only ever called after the server accepted the upload, so a
        // failed flush can never lose a drive.
        let upTo = call.getInt("upToTs") ?? 0
        TaxotticBackgroundLocation.shared.clearBuffered(upTo: upTo)
        call.resolve(["remaining": TaxotticBackgroundLocation.shared.bufferedCount()])
    }

    /// Why iOS killed us last time, straight from the OS.
    ///
    /// MetricKit's background-exit counters are the only first-party
    /// answer to "the tracker stopped and nothing crashed". Until now we
    /// inferred the cause from GPS silence, which is guesswork; these are
    /// the OS's own tallies, available on release builds on real users'
    /// phones.
    ///
    /// Read from `pastPayloads` rather than registering a subscriber:
    /// payloads are delivered at most once a day and only while the app
    /// runs, so a pull model has the same coverage with none of the
    /// subscriber lifecycle to get wrong.
    ///
    /// The counter that matters most for us is
    /// suspendedWithLockedFile (termination code 0xdead10cc): iOS kills
    /// an app suspended while holding a file/SQLite lock, which is
    /// exactly the shape of a tracker writing its buffer as the system
    /// suspends it.
    ///
    /// Simulator returns nothing — MetricKit needs a physical device.
    @objc func getExitInfo(_ call: CAPPluginCall) {
        guard #available(iOS 14.0, *),
              let payload = MXMetricManager.shared.pastPayloads.last,
              let exits = payload.applicationExitMetrics?.backgroundExitData
        else {
            call.resolve(["available": false, "platform": "ios"])
            return
        }
        call.resolve([
            "available": true,
            "platform": "ios",
            "windowEnd": ISO8601DateFormatter().string(from: payload.timeStampEnd),
            "appVersion": payload.latestApplicationVersion,
            "normal": exits.cumulativeNormalAppExitCount,
            "abnormal": exits.cumulativeAbnormalExitCount,
            "watchdog": exits.cumulativeAppWatchdogExitCount,
            "cpuLimit": exits.cumulativeCPUResourceLimitExitCount,
            "memoryLimit": exits.cumulativeMemoryResourceLimitExitCount,
            "memoryPressure": exits.cumulativeMemoryPressureExitCount,
            "suspendedWithLockedFile": exits.cumulativeSuspendedWithLockedFileExitCount,
            "bgTaskTimeout": exits.cumulativeBackgroundTaskAssertionTimeoutExitCount,
            "badAccess": exits.cumulativeBadAccessExitCount,
            "illegalInstruction": exits.cumulativeIllegalInstructionExitCount,
        ])
    }

    // ── Vehicle-presence confirmation signals ──────────────────────
    //
    // Bridge only. Everything real lives in TaxotticVehicleSignals,
    // which is owned by AppDelegate rather than by this plugin, for the
    // same reason TaxotticBackgroundLocation is: on a background
    // relaunch the bridge and its view controller may never be built,
    // and a signal recorded during that window is exactly the signal
    // that matters.
    //
    // Every method degrades to an empty, explained answer rather than an
    // error, so a consumer that runs on a device with Motion denied
    // behaves precisely as the app does today.

    @objc func drainVehicleSignals(_ call: CAPPluginCall) {
        call.resolve([
            "events": TaxotticVehicleSignals.shared.drainSignals(),
            "bootMs": TaxotticVehicleSignals.shared.currentBootMs(),
            "motionAvailable": TaxotticVehicleSignals.shared.motionAvailable(),
            "motionAuthorization": TaxotticVehicleSignals.shared.motionAuthorizationString(),
        ])
    }

    @objc func clearVehicleSignals(_ call: CAPPluginCall) {
        // Only ever called after a consumer accepted the events, so a
        // failed upload cannot lose evidence of a missed drive.
        TaxotticVehicleSignals.shared.clearSignals(upTo: call.getInt("upToTs") ?? 0)
        call.resolve(["remaining": TaxotticVehicleSignals.shared.signalCount()])
    }

    /// Read-only: what the OS recorded as automotive in a window. Emits
    /// no signal events and never prompts.
    @objc func queryMotionHistory(_ call: CAPPluginCall) {
        let fromMs = call.getInt("fromMs") ?? 0
        let toMs = call.getInt("toMs") ?? Int(Date().timeIntervalSince1970 * 1000)
        TaxotticVehicleSignals.shared.queryAutomotiveSegments(fromMs: fromMs, toMs: toMs) {
            status, segments in
            call.resolve([
                "status": status,
                "segments": segments,
                "fromTsMs": fromMs,
                "toTsMs": toMs,
            ])
        }
    }

    /// The "never fail silently" call: reconcile a capture gap against
    /// the OS's own seven-day motion history and RECORD the finding.
    ///
    /// Returns duration only. There is no location in motion history, so
    /// there is no distance to report. Surfacing the gap is the whole
    /// deliverable, and inventing miles to fill it would be worse than
    /// the gap itself.
    @objc func auditCaptureGap(_ call: CAPPluginCall) {
        let fromMs = call.getInt("fromMs") ?? 0
        let toMs = call.getInt("toMs") ?? Int(Date().timeIntervalSince1970 * 1000)
        guard fromMs > 0 else {
            call.resolve(["status": "emptyWindow", "segments": [], "automotiveMs": 0])
            return
        }
        TaxotticVehicleSignals.shared.auditGap(fromMs: fromMs, toMs: toMs) { summary in
            call.resolve(summary)
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        notifyListeners("authorizationChanged", data: [
            "locationAuthorization": authString(manager.authorizationStatus),
            "preciseLocation": manager.accuracyAuthorization == .fullAccuracy
        ])
    }
}
