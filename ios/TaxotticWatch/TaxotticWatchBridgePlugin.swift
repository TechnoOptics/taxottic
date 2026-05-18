//  TaxotticWatchBridgePlugin.swift
//  PHONE-SIDE Capacitor plugin (add to the iOS *App* target, NOT the
//  watch target). Bridges the WebView to WatchConnectivity:
//   • sync({ snapshot })  → updateApplicationContext + App Group +
//                           reload the complication
//   • inbound watch messages → notifyListeners("action", …) which
//     lib/watch/bridge.ts forwards to /api/push/action
//
//  STATUS: scaffold. Not in project.pbxproj (hand-editing it risks
//  the working iOS release). Add this one Swift file to the App
//  target in Xcode (see ios/TaxotticWatch/README.md) — the JS half
//  (lib/watch/bridge.ts, /api/watch/snapshot) already ships, so data
//  flows the moment this is compiled in.

import Foundation
import Capacitor
import WatchConnectivity
import WidgetKit

private let appGroup = "group.com.taxottic.app"

@objc(TaxotticWatchBridgePlugin)
public class TaxotticWatchBridgePlugin: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    public let identifier = "TaxotticWatchBridgePlugin"
    public let jsName = "TaxotticWatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
    ]

    public override func load() {
        if WCSession.isSupported() {
            let s = WCSession.default
            s.delegate = self
            s.activate()
        }
    }

    /// JS → watch. `snapshot` is the WatchSnapshot object; we JSON-
    /// encode it for WCSession and mirror the headline figures into
    /// the shared App Group so the complication can render without
    /// launching the watch app.
    @objc func sync(_ call: CAPPluginCall) {
        guard
            let snapshot = call.getObject("snapshot"),
            let data = try? JSONSerialization.data(withJSONObject: snapshot)
        else {
            call.reject("invalid snapshot")
            return
        }

        if let d = UserDefaults(suiteName: appGroup) {
            d.set(snapshot["ytdDeductionCents"] as? Int ?? 0, forKey: "ytdDeductionCents")
            d.set(snapshot["taxReadinessPct"] as? Int ?? 0, forKey: "taxReadinessPct")
        }
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }

        if WCSession.isSupported() {
            let session = WCSession.default
            if session.activationState == .activated {
                try? session.updateApplicationContext(["snapshot": data])
            }
        }
        call.resolve()
    }

    // MARK: WCSessionDelegate — inbound one-tap actions from the watch

    public func session(_ s: WCSession, activationDidCompleteWith _: WCSessionActivationState, error _: Error?) {}
    public func sessionDidBecomeInactive(_ s: WCSession) {}
    public func sessionDidDeactivate(_ s: WCSession) { WCSession.default.activate() }

    public func session(_ s: WCSession, didReceiveMessage message: [String: Any]) {
        forward(message)
    }
    public func session(_ s: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        forward(userInfo)
    }

    private func forward(_ message: [String: Any]) {
        // Stringify for the JSObject contract; lib/watch/bridge.ts
        // maps it onto /api/push/action.
        var out: [String: String] = [:]
        for (k, v) in message { out[k] = String(describing: v) }
        notifyListeners("action", data: out)
    }
}
