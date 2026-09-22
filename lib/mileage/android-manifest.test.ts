import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Source-level guard for two findings of the 2026-09-14 native audit.
 *
 * Neither of these can be covered by a behavioural test from Node: the
 * manifest is read by the Android packager and the channel is created by
 * the OS at first run. Reading the source is the only place a regression
 * can be caught before a build reaches a phone.
 */
describe("the Android manifest and channels match the audit", () => {
  const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");

  it("does not back up the app's data to the cloud", () => {
    // A restored backup carries a stale device id and a dead session
    // into a phone that then reports as the original device.
    expect(manifest).toMatch(/android:allowBackup="false"/);
  });

  it("the capture channel is not the quietest one available", () => {
    const service = readFileSync(
      "android/app/src/main/java/com/taxottic/app/TaxotticResurrectionService.java",
      "utf8",
    );
    expect(service).toMatch(/IMPORTANCE_DEFAULT/);
    expect(service).not.toMatch(/IMPORTANCE_LOW/);
  });
});
