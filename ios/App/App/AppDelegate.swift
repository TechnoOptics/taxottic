import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
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
        let tripCategory = UNNotificationCategory(
            identifier: "TRIP_CLASSIFY",
            actions: [business, personal],
            intentIdentifiers: [],
            options: [])
        let clarifyCategory = UNNotificationCategory(
            identifier: "CLARIFY",
            actions: [business, personal],
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
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
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
