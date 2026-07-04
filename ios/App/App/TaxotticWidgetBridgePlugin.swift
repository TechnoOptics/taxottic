import Foundation
import Capacitor
import WidgetKit

/// JS → home-screen widget bridge (iOS). Mirrors the Android
/// TaxotticWidgetBridgePlugin: `update({ snapshot })` persists the
/// forecast snapshot JSON to the shared App Group and reloads the
/// WidgetKit timelines so TaxotticWidget repaints.
///
/// The widget is a dumb renderer of that snapshot — all the plan/entity
/// adaptation already lives in the server snapshot (business- vs
/// personal-scoped, or `forecast` omitted for a free/empty state), so
/// there's no gating logic duplicated in Swift.
///
/// Capacitor 6+ auto-registers Swift plugins that conform to
/// CAPBridgedPlugin and live in the app target — no extra registration
/// file needed. `jsName` matches registerPlugin("TaxotticWidgetBridge").
@objc(TaxotticWidgetBridgePlugin)
public class TaxotticWidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TaxotticWidgetBridgePlugin"
    public let jsName = "TaxotticWidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise)
    ]

    static let appGroup = "group.com.taxottic.app"
    static let snapshotKey = "snapshot"
    static let tsKey = "ts"

    @objc func update(_ call: CAPPluginCall) {
        guard let snapshot = call.getObject("snapshot") else {
            call.reject("invalid snapshot")
            return
        }
        do {
            let data = try JSONSerialization.data(
                withJSONObject: snapshot, options: [])
            let json = String(data: data, encoding: .utf8) ?? "{}"
            let defaults = UserDefaults(suiteName: Self.appGroup)
            defaults?.set(json, forKey: Self.snapshotKey)
            defaults?.set(Date().timeIntervalSince1970, forKey: Self.tsKey)
            if #available(iOS 14.0, *) {
                WidgetCenter.shared.reloadAllTimelines()
            }
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }
}
