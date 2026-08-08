import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// iOS push depends on two UIApplicationDelegate methods that nothing in
// the JS, the entitlements, or the Apple portal can substitute for.
//
// @capacitor/push-notifications does NOT hook the app delegate itself.
// register() calls UIApplication.registerForRemoteNotifications(), iOS
// replies on the app delegate, and the plugin only ever hears about it
// because the delegate re-posts the result on NotificationCenter. Delete
// those two methods and the app still compiles, still launches, still
// prompts for permission, still reports "granted" — and silently never
// registers a token. Neither the `registration` nor the
// `registrationError` JS listener fires, because there is no error, only
// silence.
//
// That is not hypothetical: it cost this project weeks of zero iOS
// device_tokens. The affected phone reported status='register_called',
// detail='receive=granted', attempts=10 across twenty hours, with APNs
// returning neither a token nor an error. Every mileage alert for that
// driver had to be escalated to a manager because the driver's own phone
// could not be reached.
//
// Same shape as patch-integrity.test.ts: assert the native bytes from the
// node suite, because the failure is invisible to every other check and
// regenerating or hand-editing AppDelegate.swift drops these silently.
const APP_DELEGATE = "ios/App/App/AppDelegate.swift";

describe("APNs app-delegate integrity", () => {
  it("AppDelegate.swift is present", () => {
    expect(existsSync(APP_DELEGATE)).toBe(true);
  });

  it("forwards a successful APNs registration to Capacitor", () => {
    if (!existsSync(APP_DELEGATE)) return;
    const src = readFileSync(APP_DELEGATE, "utf8");
    expect(src).toContain("didRegisterForRemoteNotificationsWithDeviceToken");
    // The method existing is not enough: it has to POST, or the token is
    // received and discarded, which is exactly the bug this guards.
    expect(src).toContain(".capacitorDidRegisterForRemoteNotifications");
  });

  it("forwards an APNs registration failure to Capacitor", () => {
    if (!existsSync(APP_DELEGATE)) return;
    const src = readFileSync(APP_DELEGATE, "utf8");
    expect(src).toContain("didFailToRegisterForRemoteNotificationsWithError");
    // Without this, a genuine APNs error (bad entitlement, revoked
    // capability) is indistinguishable from the silent case above, and
    // the one useful diagnostic is lost.
    expect(src).toContain(".capacitorDidFailToRegisterForRemoteNotifications");
  });

  it("keeps the aps-environment entitlement", () => {
    const ent = "ios/App/App/App.entitlements";
    if (!existsSync(ent)) return;
    // The delegate hop is useless without the capability: iOS would then
    // call the failure path instead of delivering a token.
    expect(readFileSync(ent, "utf8")).toContain("aps-environment");
  });
});
