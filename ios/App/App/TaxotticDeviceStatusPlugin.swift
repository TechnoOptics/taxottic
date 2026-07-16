import Foundation
import Capacitor
import CoreLocation
import CoreMotion
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
        CAPPluginMethod(name: "queryStepsSince", returnType: CAPPluginReturnPromise)
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
                && CMPedometer.authorizationStatus() != .restricted
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

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        notifyListeners("authorizationChanged", data: [
            "locationAuthorization": authString(manager.authorizationStatus),
            "preciseLocation": manager.accuracyAuthorization == .fullAccuracy
        ])
    }
}
