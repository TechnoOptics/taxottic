import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * iOS push has never worked. This is the reason, and it is a one-word
 * defect that survived from July because nothing could see it.
 *
 * `aps-environment` was checked in as `development`, on the stated belief
 * that "a distribution build's provisioning profile promotes this to
 * production automatically at archive time". It does not. Xcode signs the
 * archive with whatever the file says.
 *
 * The evidence is unambiguous. push_registration_state on 2026-08-16:
 *
 *   ios      registration_error   64 attempts   1.3.11 (40)
 *            no valid "aps-environment" entitlement string found
 *   android  registered          140 attempts
 *   web      registered           28 attempts
 *
 * device_tokens: android 3, web 2, ios 0.
 *
 * The value is a single string in a file nobody reads, it type-checks
 * (it is not typed at all), it compiles, it signs, it ships, and the only
 * symptom is an absence of rows. That is the same shape as the plugin
 * registration and the trip endpoints: BUILT BUT DEAD.
 */

const ENTITLEMENTS = "ios/App/App/App.entitlements";

function valueFor(key: string, xml: string): string | null {
  // Plists are ordered <key>/<value> pairs; take the string that follows
  // the key. Crude, and correct for a file this shape.
  const i = xml.indexOf(`<key>${key}</key>`);
  if (i === -1) return null;
  const after = xml.slice(i);
  const m = after.match(/<string>([^<]*)<\/string>/);
  return m ? m[1] : null;
}

describe("the iOS push entitlement", () => {
  const xml = readFileSync(ENTITLEMENTS, "utf8");

  it("is production, because distribution builds are the only ones that ship", () => {
    // If this ever reads "development" again, iOS push is dead and the
    // only symptom will be device_tokens quietly staying at zero.
    expect(valueFor("aps-environment", xml)).toBe("production");
  });

  it("still declares the app group the widget depends on", () => {
    // Guard against a careless edit to this file taking the widget's
    // shared container with it.
    expect(xml).toContain("com.apple.security.application-groups");
    expect(xml).toContain("group.com.taxottic.app");
  });

  it("records why, so the next person does not 'fix' it back", () => {
    // The old value was not a typo, it was a reasoned choice based on a
    // wrong premise. Deleting the reasoning invites the same reasoning.
    expect(xml).toMatch(/THAT BELIEF IS FALSE/);
    expect(xml).toMatch(/registration_error|no valid/);
  });
});

/**
 * The entitlements file is worthless if the build does not sign with it.
 * That is exactly how the iOS plugins were dead for weeks: present in the
 * tree, absent from the binary.
 */
describe("the build actually signs with that file", () => {
  const pbx = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");

  it("points the App target at App/App.entitlements", () => {
    expect(pbx).toContain("CODE_SIGN_ENTITLEMENTS = App/App.entitlements;");
  });

  it("wires it for BOTH build configurations, not just one", () => {
    // Debug and Release each carry their own CODE_SIGN_ENTITLEMENTS. One
    // configuration silently missing it is a build that ships unsigned
    // for push while the other looks fine locally.
    const hits = pbx.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g);
    expect(hits?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
