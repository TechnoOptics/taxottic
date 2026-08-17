import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * `CLLocationManager.locationServicesEnabled()` must never be called on
 * the main thread.
 *
 * It is a SYNCHRONOUS XPC round trip to locationd. iOS raises a runtime
 * issue for it ("This method can cause UI unresponsiveness if invoked on
 * the main thread. Instead, consider waiting for the
 * -locationManagerDidChangeAuthorization: callback and checking
 * authorizationStatus first").
 *
 * Every caller inside TaxotticBackgroundLocation is on the main thread:
 * CoreLocation delivers its delegate callbacks there, and the Capacitor
 * bridge calls in from there. The worst of them is the one this file
 * exists for. AppDelegate's didFinishLaunchingWithOptions calls
 * restoreOnLaunch() directly, which is the background-relaunch path, and
 * that path gets roughly 10 seconds of runtime before iOS suspends the
 * app again. Blocking on IPC spends the budget in the one window where
 * it buys nothing.
 *
 * The check is not lost, only moved: `authorizationStatus` already
 * answers it, because CLLocationManager.h documents
 * kCLAuthorizationStatusDenied as "User has explicitly denied
 * authorization for this application, or location services are disabled
 * in Settings". The device-wide switch being off therefore forces
 * .denied, so .authorizedAlways already implies services are on. The
 * only residual use of the raw switch is labelling WHICH refusal was
 * recorded, and that is answered from a snapshot refreshed off the main
 * thread.
 *
 * Same shape as apns-delegate-integrity.test.ts and
 * plugin-registration.test.ts: assert the native bytes from the node
 * suite, because nothing else in CI can see this. It compiles, it
 * launches, it tracks. It just spends the relaunch budget blocking, and
 * the only symptom is drives that quietly never start.
 */

const SOURCE = "ios/App/App/TaxotticBackgroundLocation.swift";

/**
 * Swift source with comments removed.
 *
 * Load-bearing: the fix is DOCUMENTED in a comment block that quotes
 * `CLLocationManager.locationServicesEnabled()` several times. Asserting
 * on the raw file would match the explanation of the bug and call it the
 * bug, so every assertion below runs on stripped source.
 */
function withoutComments(src: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (!inString && two === "//") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (!inString && two === "/*") {
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    if (src[i] === '"' && src[i - 1] !== "\\") inString = !inString;
    if (src[i] === "\n") inString = false;
    out += src[i];
    i++;
  }
  return out;
}

const code = withoutComments(readFileSync(SOURCE, "utf8"));

describe("iOS location services check never blocks the main thread", () => {
  it("calls locationServicesEnabled() exactly once in the whole file", () => {
    // Three call sites is the pre-fix state: hasAlwaysAuthorization(),
    // didExitRegion and startCaptureRequested. Any number above one
    // means a synchronous caller came back.
    const calls = code.match(/CLLocationManager\.locationServicesEnabled\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("makes that one call inside an async dispatch off the main thread", () => {
    const refresh = code.match(
      /private func refreshServicesEnabled\(\)\s*\{[\s\S]*?\n {4}\}/,
    );
    expect(refresh, "refreshServicesEnabled() is missing").not.toBeNull();
    const body = refresh![0];
    expect(body).toContain("servicesQueue.async");
    expect(body).toContain("CLLocationManager.locationServicesEnabled()");
  });

  it("does not park the blocking call on `queue`, which is drained with queue.sync", () => {
    // `queue` is read back synchronously from the main thread
    // (drainBuffered, bufferedCount). Dispatching the XPC call there
    // would reintroduce the same stall through the back door, so the
    // refresh gets a queue of its own.
    expect(code).toMatch(
      /private let servicesQueue = DispatchQueue\(\s*label: "com\.taxottic\.bglocation\.services"/,
    );
  });

  it("keeps the launch path free of the blocking call", () => {
    // restoreOnLaunch() runs from didFinishLaunchingWithOptions and
    // gates on hasAlwaysAuthorization(). That gate must be a pure
    // authorizationStatus read.
    const gate = code.match(
      /private func hasAlwaysAuthorization\(\) -> Bool \{[\s\S]*?\n {4}\}/,
    );
    expect(gate, "hasAlwaysAuthorization() is missing").not.toBeNull();
    expect(gate![0]).not.toContain("locationServicesEnabled");
    expect(gate![0]).toContain("authorizationStatus == .authorizedAlways");
  });

  it("re-reads the snapshot when authorization changes", () => {
    // Flipping the device-wide switch forces this app's status to
    // .denied, so the authorization callback is the moment a
    // services-off flip becomes observable. Without this refresh the
    // snapshot only ever reflects app construction.
    const cb = code.match(
      /public func locationManagerDidChangeAuthorization\([\s\S]*?\n {4}\}/,
    );
    expect(cb, "locationManagerDidChangeAuthorization is missing").not.toBeNull();
    expect(cb![0]).toContain("refreshServicesEnabled()");
  });
});
