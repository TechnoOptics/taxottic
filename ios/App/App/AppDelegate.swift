import UIKit
import Capacitor
import UserNotifications

/// The bridge view controller, subclassed for ONE reason: to register
/// this app's own plugins.
///
/// THE BUG THIS FIXES, and it had been live since the first custom
/// plugin shipped.
///
/// Capacitor 8 does NOT scan the Objective-C runtime for plugins.
/// `CapacitorBridge.registerPlugins()` builds its list from exactly two
/// sources: five framework built-ins, and the `packageClassList` array
/// in the generated capacitor.config.json. That array is written by
/// `@capacitor/cli` from INSTALLED NPM PACKAGES, so a plugin that lives
/// in the app target can never appear in it. Being `@objc`, conforming
/// to `CAPBridgedPlugin`, declaring `jsName`, and being compiled into
/// the target are all necessary and none of them are sufficient: with
/// no registration the class is simply never handed to the bridge.
///
/// The failure is silent and reads like a working system.
/// `registerPlugin("TaxotticDeviceStatus")` on the JS side always
/// returns a proxy, so nothing throws at import. The first actual method
/// call rejects immediately, which in production looked like
/// `device_probe = "error"` at stage "call" in 2ms, and left
/// location_authorization, precise_location, background_refresh,
/// low_power_mode, geofence_arm_state and geofence_count NULL on every
/// iOS heartbeat ever recorded.
///
/// Android was never affected, which is what made this so confusing to
/// chase: MainActivity.java calls registerPlugin() explicitly for all
/// five plugins, so the same code reported perfectly there. One platform
/// registering and the other not is the entire difference.
///
/// Measured cost before the fix: a driver's tracker degraded to
/// foreground-only capture and six days of driving went unrecorded,
/// while every field that would have explained why read NULL.
///
/// This class deliberately lives in AppDelegate.swift rather than its
/// own file. A new .swift that is not added to project.pbxproj compiles
/// to nothing and fails silently, which this repo has shipped twice.
/// AppDelegate.swift is already in the target, so the fix cannot itself
/// fall into the trap it is fixing.
class TaxotticViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // registerPluginInstance, NOT registerPluginType. This is not a
        // style choice and getting it wrong is silent.
        //
        // CapacitorBridge.registerPluginType() opens with:
        //
        //     if autoRegisterPlugins { return }
        //
        // and autoRegisterPlugins defaults to TRUE. CAPBridgeViewController's
        // loadView() constructs the bridge without passing that argument, so
        // it is always true for a storyboard-instantiated controller, so
        // registerPluginType is ALWAYS a no-op here. It logs nothing and
        // throws nothing.
        //
        // This was shipped once, in 1.3.10, as a "fix" that changed
        // absolutely nothing: the symptom afterwards was byte-for-byte the
        // symptom before, device_probe "error" at stage "call" in ~2ms with
        // every device-truth column NULL. A review caught it by reading the
        // Capacitor source rather than trusting that a compiling call does
        // something.
        //
        // registerPluginInstance() has no such guard. It goes straight to
        // plugins[jsName] = instance and exports the JS shim.
        //
        // Must match Android's MainActivity list. If you add a plugin there
        // and not here, iOS goes quiet again and nothing will tell you.
        bridge?.registerPluginInstance(TaxotticDeviceStatusPlugin())
        bridge?.registerPluginInstance(TaxotticGeofencePlugin())
        bridge?.registerPluginInstance(TaxotticWidgetBridgePlugin())
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Re-arm native background location BEFORE anything else.
        //
        // On a location relaunch iOS grants ~10 seconds and Apple warns
        // against network work in it — and this app's WebView loads a
        // REMOTE url, so waiting for JavaScript here would spend the
        // whole budget on a network fetch and often run no JS at all.
        // The bridge and its view controller may not even be built on a
        // background launch. So revival lives here, in the one callback
        // that always runs, and re-creating the manager + restarting SLC
        // is what makes iOS deliver the pending event that woke us.
        //
        // Deliberately NOT gated on UIApplication.LaunchOptionsKey.location:
        // it is deprecated as of iOS 26 and Apple DTS notes it is not
        // always present even on a genuine location launch.
        TaxotticBackgroundLocation.shared.restoreOnLaunch()

        // Vehicle-presence CONFIRMATION signals. Installs an audio
        // route observer and takes one route reading; starts no
        // sensors, so a launch that turns out not to be a drive costs
        // nothing. Nothing here can wake the app: it rides on the
        // CoreLocation revival above, which is the only thing that can.
        TaxotticVehicleSignals.shared.restoreOnLaunch()

        // Interactive notification categories for the Phase-2
        // "Business / Personal" actions (mileage / clarify). iOS only
        // renders action buttons — on the lock screen and a paired
        // Apple Watch — for a category whose identifier matches the
        // push payload's `aps.category`.
        //
        // These identifiers are a CONTRACT with the JS side and must
        // stay in sync:
        //   category id "TRIP_CLASSIFY" / "CLARIFY"
        //     ← lib/push/payloads.ts buildPayload().category
        //   action id  "business" / "personal"
        //     ← lib/push/action-map.ts resolvePushAction() (it
        //        lowercases actionId and matches these)
        //
        // UserNotifications only — no new dependency / SPM change, so
        // this cannot reintroduce the Capacitor-version resolution
        // break. Setting categories here is idempotent and additive;
        // @capacitor/push-notifications still owns delegate/handling.
        let business = UNNotificationAction(
            identifier: "business", title: "Business", options: [])
        let personal = UNNotificationAction(
            identifier: "personal", title: "Personal", options: [])
        // "Review" foregrounds the app on the item (deep link handled by
        // the pushNotificationActionPerformed listener). action-map maps
        // any unknown/`review` id to { type: "open" }, so this needs no
        // server change and can never mutate anything.
        let review = UNNotificationAction(
            identifier: "review", title: "Review",
            options: [.foreground])
        let tripCategory = UNNotificationCategory(
            identifier: "TRIP_CLASSIFY",
            actions: [business, personal, review],
            intentIdentifiers: [],
            options: [])
        let clarifyCategory = UNNotificationCategory(
            identifier: "CLARIFY",
            actions: [business, personal, review],
            intentIdentifiers: [],
            options: [])
        UNUserNotificationCenter.current().setNotificationCategories(
            [tripCategory, clarifyCategory])
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.

        // Re-read the audio route and, if the device went dark for a
        // while, ask the OS what it recorded during the gap. Foreground
        // only, and only when Motion is ALREADY granted, so this can
        // never raise a permission prompt the user did not ask for.
        TaxotticVehicleSignals.shared.onBecameActive()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // MARK: - APNs registration
    //
    // WITHOUT THESE TWO METHODS PUSH IS SILENTLY DEAD ON iOS.
    //
    // @capacitor/push-notifications does not hook UIApplicationDelegate
    // itself. register() calls UIApplication.registerForRemoteNotifications(),
    // iOS answers on the APP DELEGATE, and the plugin only ever learns the
    // outcome because the delegate re-posts it on NotificationCenter under
    // the two names below. This file had neither method, so iOS handed the
    // app a perfectly good APNs token and it went straight in the bin: the
    // JS `registration` listener never fired, and neither did
    // `registrationError`, because there was no error, only silence.
    //
    // What that looked like from the outside, and why it cost weeks: zero
    // rows in device_tokens for iOS while Android registered normally, so
    // the driver could never be sent a push and every tracker alert for
    // that device had to be escalated to a manager instead. The telemetry
    // added on 2026-08-06 is what finally pinned it, by recording the
    // branch REACHED rather than only errors. The affected phone reported
    // status='register_called', detail='receive=granted', app 1.3.7 (35),
    // attempts=10: permission granted, flag on, plugin present, register()
    // called ten times across twenty hours, and APNs returned neither a
    // token nor an error. A missing entitlement or a refused prompt would
    // both have produced an ERROR here; only a missing delegate hop
    // produces nothing at all.
    //
    // Copied verbatim from the plugin README's iOS setup section. Do not
    // delete them when regenerating or hand-editing this file: nothing in
    // the JS, the entitlements, or the Apple portal can compensate, and
    // the failure is invisible without the telemetry above.
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
