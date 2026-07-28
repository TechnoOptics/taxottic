import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// The Android foreground service only survives the Capacitor Activity
// unbinding because of a local patch to @capgo/background-geolocation.
// Upstream's onUnbind() stops every watcher and terminates the service
// the moment the user backgrounds the app — which would silently lose
// EVERY drive that isn't watched on-screen. That is the single most
// load-bearing line of native code we own, and it lives in a patch file
// that a dependency bump can silently invalidate.
//
// `patch-package --error-on-fail` now fails the install, and this test
// fails the build if the patched bytes are ever missing from the
// installed package. Belt and braces, because the failure mode is
// invisible: the app builds, runs, looks fine, and loses drives.
const SERVICE =
  "node_modules/@capgo/background-geolocation/android/src/main/java/" +
  "com/capgo/capacitor_background_geolocation/BackgroundGeolocationService.java";

describe("critical native patch integrity", () => {
  it("the patch file is still present in the repo", () => {
    expect(
      existsSync("patches/@capgo+background-geolocation+8.0.35.patch"),
    ).toBe(true);
  });

  it("the installed service carries our patch marker", () => {
    if (!existsSync(SERVICE)) {
      // Fresh clone without install — nothing to assert against.
      return;
    }
    const src = readFileSync(SERVICE, "utf8");
    expect(src).toContain("TAXOTTIC PATCH");
  });

  it("onUnbind does NOT tear down the service (the whole point)", () => {
    if (!existsSync(SERVICE)) return;
    const src = readFileSync(SERVICE, "utf8");
    const i = src.indexOf("onUnbind");
    expect(i).toBeGreaterThan(-1);
    // Body of onUnbind through the next closing brace at method level.
    const body = src.slice(i, i + 600);
    // Upstream stopped watchers + killed the service here. If either of
    // those calls comes back, backgrounded drives die silently again.
    expect(body).not.toMatch(/stopSelf\s*\(/);
    expect(body).not.toMatch(/watchers\.clear\s*\(/);
  });
});
