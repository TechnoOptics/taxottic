import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Both platforms must register the same plugins, explicitly.
 *
 * THE OUTAGE THIS GUARDS, live from the first custom plugin until
 * 2026-08-11.
 *
 * Capacitor 8 does not scan the ObjC runtime. CapacitorBridge's
 * registerPlugins() builds its list from five framework built-ins plus
 * `packageClassList` in the generated capacitor.config.json, and that
 * array is written by @capacitor/cli from INSTALLED NPM PACKAGES. A
 * plugin living in the app target can never appear in it. So on iOS the
 * Taxottic plugins were compiled, `@objc`, CAPBridgedPlugin-conforming,
 * correctly named, present in project.pbxproj, and never registered.
 *
 * Nothing threw. registerPlugin() on the JS side returns a proxy
 * regardless, so the failure surfaced only as a method call rejecting in
 * about 2ms, recorded in production as device_probe "error" at stage
 * "call", with location_authorization, precise_location,
 * background_refresh, low_power_mode, geofence_arm_state and
 * geofence_count NULL on every iOS heartbeat ever taken.
 *
 * Android was fine the whole time because MainActivity registers each
 * plugin explicitly. That asymmetry is what made it hard to see: the
 * same JS, reporting perfectly on one platform and blank on the other,
 * reads like a device problem rather than a registration problem.
 *
 * Hence this test. It does not check that the code is elegant, it checks
 * that the two lists AGREE, because a plugin added to one platform and
 * forgotten on the other is precisely how this recurs, and the recurrence
 * is invisible at runtime.
 */

const IOS_APP_DELEGATE = "ios/App/App/AppDelegate.swift";
const IOS_STORYBOARD = "ios/App/App/Base.lproj/Main.storyboard";
const ANDROID_MAIN = "android/app/src/main/java/com/taxottic/app/MainActivity.java";

/** Plugins Android registers, minus the ones with no iOS counterpart. */
const IOS_EXEMPT = new Set([
  // Wear OS only. There is no watch companion on iOS yet, see the
  // "watch app has 0 pbxproj refs" note in the release history.
  "TaxotticWatchBridgePlugin",
  // Android Auto / car signals are read natively on iOS inside
  // TaxotticVehicleSignals rather than exposed as a bridge plugin.
  "TaxotticCarSignalsPlugin",
]);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function androidPlugins(): string[] {
  return [...read(ANDROID_MAIN).matchAll(/registerPlugin\((Taxottic\w+)\.class\)/g)]
    .map((m) => m[1])
    .filter((n) => !IOS_EXEMPT.has(n));
}

function iosPlugins(): string[] {
  // registerPluginInstance(Foo()), not registerPluginType(Foo.self).
  // See the "no-op API" test below for why the distinction is the whole
  // ballgame.
  return [
    ...read(IOS_APP_DELEGATE).matchAll(
      /registerPluginInstance\((Taxottic\w+)\(\)\)/g,
    ),
  ].map((m) => m[1]);
}

describe("iOS registers its plugins at all", () => {
  it("has a bridge subclass that overrides capacitorDidLoad", () => {
    const src = read(IOS_APP_DELEGATE);
    expect(
      src,
      "Without a CAPBridgeViewController subclass there is nowhere to " +
        "register app-target plugins, and Capacitor 8 will load none of them.",
    ).toMatch(/class\s+TaxotticViewController\s*:\s*CAPBridgeViewController/);
    expect(src).toContain("override func capacitorDidLoad()");
  });

  it("the storyboard actually points at that subclass", () => {
    // The subclass existing is useless if the storyboard still
    // instantiates Capacitor's stock controller, and that mistake looks
    // completely fine in the Swift source.
    const sb = read(IOS_STORYBOARD);
    expect(sb).toContain('customClass="TaxotticViewController"');
    expect(sb).toContain('customModule="App"');
    expect(
      sb,
      "storyboard still instantiates the stock Capacitor controller",
    ).not.toContain('customClass="CAPBridgeViewController"');
  });

  it("registers at least one plugin", () => {
    expect(iosPlugins().length).toBeGreaterThan(0);
  });

  it("does NOT use registerPluginType, which is a no-op here", () => {
    // THE TRAP THIS FILE FAILED TO CATCH THE FIRST TIME.
    //
    // CapacitorBridge.registerPluginType() begins `if autoRegisterPlugins
    // { return }`, and autoRegisterPlugins defaults to true because
    // CAPBridgeViewController.loadView() constructs the bridge without
    // passing it. So on a storyboard-instantiated controller the call
    // compiles, runs, logs nothing, throws nothing, and registers
    // nothing.
    //
    // Version 1.3.10 shipped exactly that and changed nothing at all.
    // This file passed 6 of 6 against it, because it only ever checked
    // that some registration-shaped TEXT existed. Text is not behaviour.
    //
    // No source-text assertion can prove registration WORKED. What it
    // can do is refuse the API that provably does not, which is the
    // difference between this test being theatre and being a guard.
    const src = read(IOS_APP_DELEGATE);
    const uncommented = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(
      uncommented,
      "registerPluginType returns immediately when autoRegisterPlugins " +
        "is true, which it always is here. Use registerPluginInstance.",
    ).not.toMatch(/registerPluginType\s*\(/);
  });
});

describe("the two platforms agree", () => {
  it("finds both registration lists", () => {
    // Guards the guard: a moved file would make every check below
    // vacuous, and vacuous is exactly how this bug survived.
    expect(androidPlugins().length).toBeGreaterThan(0);
    expect(iosPlugins().length).toBeGreaterThan(0);
  });

  it("registers the same plugins on iOS as on Android", () => {
    const android = androidPlugins().sort();
    const ios = iosPlugins().sort();
    const missingOnIos = android.filter((p) => !ios.includes(p));
    const missingOnAndroid = ios.filter((p) => !android.includes(p));

    expect(
      missingOnIos,
      "Registered on Android but NOT on iOS. iOS will compile the " +
        "plugin, return a proxy for it, and reject every call in a few " +
        "milliseconds without throwing. That is what left every iOS " +
        "device-truth field NULL for weeks.",
    ).toEqual([]);
    expect(
      missingOnAndroid,
      "Registered on iOS but not Android. Add it to MainActivity, or to " +
        "IOS_EXEMPT if it genuinely has no Android counterpart.",
    ).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An exemption for a plugin Android no longer registers is dead
    // weight that hides a real divergence later.
    const androidAll = [
      ...read(ANDROID_MAIN).matchAll(/registerPlugin\((Taxottic\w+)\.class\)/g),
    ].map((m) => m[1]);
    for (const e of IOS_EXEMPT) {
      expect(
        androidAll,
        `${e} is exempted from iOS parity but Android no longer registers it.`,
      ).toContain(e);
    }
  });
});
