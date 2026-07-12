import Foundation
import Capacitor
import CoreLocation
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
        CAPPluginMethod(name: "requestAlwaysUpgrade", returnType: CAPPluginReturnPromise)
    ]

    private var manager: CLLocationManager?

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
            "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled
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
