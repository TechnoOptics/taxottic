import Foundation
import Capacitor

/// JS bridge for the learned-place geofence mesh (iOS).
///
/// THIS CLASS DELIBERATELY CONTAINS NO REGION LOGIC, AND THAT IS THE
/// POINT OF THE WHOLE FEATURE.
///
/// The mesh exists for one situation: iOS terminated the app overnight,
/// the driver gets in the car in the morning, and region monitoring is
/// the only mechanism left that can restart mileage capture. In that
/// situation the WebView does not exist, the Capacitor bridge has not
/// been built, and no CAPPlugin instance has been created, because a
/// plugin is only instantiated when the web layer loads. An object that
/// does not exist cannot be the CLLocationManagerDelegate that receives
/// `didExitRegion`.
///
/// So registration, the exit trigger, the fix buffer and the durable
/// health state all live in TaxotticBackgroundLocation, the singleton
/// AppDelegate constructs on EVERY launch via `restoreOnLaunch()`,
/// including a launch iOS starts purely to hand over a region event.
/// This file is a thin call-through so the web layer can push places
/// down and read health back. Moving any region handling up here would
/// reproduce the exact bug the mesh closes: a cold relaunch that
/// silently captures nothing, which cost one driver a full day of
/// driving on 2026-08-10.
///
/// The surface below mirrors `type GeofencePlugin` in
/// lib/mileage/geofence.ts and Android's TaxotticGeofencePlugin, so no
/// JavaScript, database or heartbeat change is needed for iOS to start
/// reporting `geofence_arm_state` and `geofence_count`.
///
/// Capacitor 6+ auto-registers Swift plugins conforming to
/// CAPBridgedPlugin in the app target, but the FILE must still be in
/// project.pbxproj: a Swift file that is not compiles to nothing and
/// fails silently at runtime, which this repo has shipped twice.
@objc(TaxotticGeofencePlugin)
public class TaxotticGeofencePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TaxotticGeofencePlugin"
    public let jsName = "TaxotticGeofence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncPlaces", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readBuffer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeBuffer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearPlaces", returnType: CAPPluginReturnPromise)
    ]

    private var core: TaxotticBackgroundLocation { TaxotticBackgroundLocation.shared }

    /// Replace the monitored place list and re-register the mesh.
    ///
    /// `places`: array of { id, latitude, longitude, radius, label }.
    /// Validation and the MAX_PLACES cap live in the singleton, so the
    /// rules cannot drift between the JS-driven path and the relaunch
    /// path that never sees JavaScript.
    @objc func syncPlaces(_ call: CAPPluginCall) {
        // The typed accessor, not `getArray(_:) as? [[String: Any]]`: a
        // bridge array is [JSValue] whose elements are JSObject, and a
        // whole-array conditional cast that fails returns nil silently,
        // which would look exactly like "the server sent no places".
        let submitted = call.getArray("places", JSObject.self) ?? []
        let accepted = core.syncPlaces(submitted.map { $0 as [String: Any] })
        call.resolve([
            "accepted": accepted,
            "submitted": submitted.count,
            "maxPlaces": TaxotticBackgroundLocation.maxPlaces,
            "armState": core.currentArmState(),
            "backgroundLocation": core.hasBackgroundLocation(),
        ])
    }

    /// Full durable health picture, including every failure field.
    @objc func getState(_ call: CAPPluginCall) {
        call.resolve(core.geofenceState())
    }

    /// Read buffered fixes captured while the WebView was dead.
    ///
    /// Read only: the caller consumes them separately, after the server
    /// has accepted them, so a failed upload never loses a drive.
    ///
    /// The buffer stores its own compact keys; the JS `NativeFix` shape
    /// is the contract, so the mapping happens here rather than in the
    /// singleton, which the device-status plugin also drains in the
    /// buffer's own vocabulary.
    @objc func readBuffer(_ call: CAPPluginCall) {
        let fixes: [[String: Any]] = core.drainBuffered().map { point in
            [
                "latitude": point["lat"] ?? 0,
                "longitude": point["lng"] ?? 0,
                "accuracy": point["accuracyM"] ?? NSNull(),
                "speed": point["speedMps"] ?? NSNull(),
                "time": point["ts"] ?? 0,
            ]
        }
        call.resolve(["fixes": fixes, "count": fixes.count])
    }

    /// Drop the first N buffered fixes, after they have been uploaded.
    @objc func consumeBuffer(_ call: CAPPluginCall) {
        let count = call.getInt("count") ?? 0
        call.resolve(["remaining": core.consumeBuffered(count: count)])
    }

    /// Capture alongside a drive the WebView is already watching.
    ///
    /// Additive, never a handoff: on iOS the page is a remote URL whose
    /// timers freeze when backgrounded, so native capture must not
    /// depend on it. Duplicate points cost nothing, because ingest is
    /// idempotent on (driver, company, captured_at).
    @objc func startCapture(_ call: CAPPluginCall) {
        call.resolve(core.startCaptureRequested())
    }

    /// Stand capture down because the drive is over. Not called merely
    /// because the app was opened.
    @objc func stopCapture(_ call: CAPPluginCall) {
        core.stopCaptureRequested()
        call.resolve()
    }

    /// Forget every place and unregister the mesh.
    @objc func clearPlaces(_ call: CAPPluginCall) {
        core.clearPlaces()
        call.resolve(["armState": core.currentArmState()])
    }
}
