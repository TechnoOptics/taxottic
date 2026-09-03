import { describe, it, expect } from "vitest";
import {
  evaluateDeviceCause,
  describeDeviceCause,
  type DeviceCauseSignals,
} from "./device-cause";

/**
 * Driver c6218e2c's mileage_device_status row on 2026-09-03, verbatim.
 * The phone had diagnosed itself for nine days while the manager was
 * shown a guess. Every assertion about wording below is held to THIS
 * row, because it is the one that cost the nine days.
 */
const GRACE: DeviceCauseSignals = {
  platform: "ios",
  locationAuthorization: "whenInUse",
  backgroundRefresh: true,
  lowPowerMode: null,
  batteryOptimized: null,
  trackingEnabled: true,
};

/** A phone with nothing wrong that the row can see. */
const CLEAN: DeviceCauseSignals = {
  platform: "ios",
  locationAuthorization: "always",
  backgroundRefresh: true,
  lowPowerMode: false,
  batteryOptimized: false,
  trackingEnabled: true,
};

describe("evaluateDeviceCause", () => {
  it("names While Using from Grace's own status row", () => {
    expect(evaluateDeviceCause(GRACE)).toBe("authorization_downgraded");
  });

  it("returns null when the row shows nothing wrong, so the generic wording stays the fallback", () => {
    expect(evaluateDeviceCause(CLEAN)).toBeNull();
  });

  it("returns null for a row that never reported anything (old build, dead bridge)", () => {
    expect(
      evaluateDeviceCause({
        platform: null,
        locationAuthorization: null,
        backgroundRefresh: null,
        lowPowerMode: null,
        batteryOptimized: null,
        trackingEnabled: null,
      }),
    ).toBeNull();
  });

  it("does not blame the driver for a null authorization, only for a reported one", () => {
    // A null here was, for weeks, the dead device-status plugin rather
    // than anything the driver did (see self-check.ts).
    expect(
      evaluateDeviceCause({ ...CLEAN, locationAuthorization: null }),
    ).toBeNull();
  });

  it("tells a refused permission apart from While Using", () => {
    expect(
      evaluateDeviceCause({ ...CLEAN, locationAuthorization: "denied" }),
    ).toBe("authorization_denied");
    expect(
      evaluateDeviceCause({ ...CLEAN, locationAuthorization: "notDetermined" }),
    ).toBe("authorization_denied");
  });

  it("background refresh off", () => {
    expect(evaluateDeviceCause({ ...CLEAN, backgroundRefresh: false })).toBe(
      "background_refresh_off",
    );
  });

  it("low power mode on", () => {
    expect(evaluateDeviceCause({ ...CLEAN, lowPowerMode: true })).toBe(
      "low_power_mode",
    );
  });

  it("battery optimization on (Android)", () => {
    expect(
      evaluateDeviceCause({ ...CLEAN, platform: "android", batteryOptimized: true }),
    ).toBe("battery_optimized");
  });

  it("tracking turned off by the driver", () => {
    expect(evaluateDeviceCause({ ...CLEAN, trackingEnabled: false })).toBe(
      "tracking_off",
    );
  });

  describe("priority, when a row carries more than one fault", () => {
    it("authorization outranks background refresh", () => {
      expect(
        evaluateDeviceCause({ ...GRACE, backgroundRefresh: false }),
      ).toBe("authorization_downgraded");
    });

    it("background refresh outranks low power mode", () => {
      expect(
        evaluateDeviceCause({ ...CLEAN, backgroundRefresh: false, lowPowerMode: true }),
      ).toBe("background_refresh_off");
    });

    it("low power mode outranks battery optimization", () => {
      expect(
        evaluateDeviceCause({ ...CLEAN, lowPowerMode: true, batteryOptimized: true }),
      ).toBe("low_power_mode");
    });

    it("battery optimization outranks the tracking toggle", () => {
      expect(
        evaluateDeviceCause({ ...CLEAN, batteryOptimized: true, trackingEnabled: false }),
      ).toBe("battery_optimized");
    });
  });
});

describe("describeDeviceCause", () => {
  it("tells the manager what Grace's phone is set to and the exact Settings path", () => {
    const t = describeDeviceCause("authorization_downgraded", "ios", "manager");
    expect(t.short).toBe("Location is While Using");
    expect(t.fix).toBe(
      "Ask them to set it to Always: Settings > Taxottic > Location > Always.",
    );
  });

  it("tells Grace herself, in the second person, with the same path", () => {
    const t = describeDeviceCause("authorization_downgraded", "ios", "driver");
    expect(t.short).toBe("Your location permission is While Using");
    expect(t.fix).toBe("Set it to Always: Settings > Taxottic > Location > Always.");
  });

  it("gives the Android path on Android", () => {
    const t = describeDeviceCause("authorization_downgraded", "android", "manager");
    expect(t.fix).toContain("Allow all the time");
    expect(t.fix).toContain("Settings > Apps > Taxottic > Permissions > Location");
    expect(t.fix).not.toContain("Settings > Taxottic > Location");
  });

  it("names no OS path when the platform is unknown, rather than guessing one", () => {
    const t = describeDeviceCause("authorization_downgraded", null, "manager");
    expect(t.fix).not.toContain("Settings >");
    expect(t.fix).toContain("Always");
  });

  it("refused permission", () => {
    const t = describeDeviceCause("authorization_denied", "ios", "manager");
    expect(t.short).toBe("Location permission is not granted");
    expect(t.fix).toContain("Settings > Taxottic > Location > Always");
  });

  it("background refresh, with the path the alert already words", () => {
    const t = describeDeviceCause("background_refresh_off", "ios", "manager");
    expect(t.short).toBe("Background App Refresh is off");
    expect(t.fix).toBe(
      "Ask them to turn it on: Settings > General > Background App Refresh.",
    );
  });

  it("low power mode on iOS, battery saver on Android", () => {
    expect(describeDeviceCause("low_power_mode", "ios", "manager").short).toBe(
      "Low Power Mode is on",
    );
    expect(describeDeviceCause("low_power_mode", "android", "driver").short).toBe(
      "Battery Saver is on",
    );
    expect(describeDeviceCause("low_power_mode", "ios", "driver").fix).toBe(
      "Turn it off in Settings > Battery.",
    );
  });

  it("battery optimization", () => {
    const t = describeDeviceCause("battery_optimized", "android", "manager");
    expect(t.short).toBe("Battery optimization is throttling Taxottic");
    expect(t.fix).toContain("Unrestricted");
  });

  it("tracking off", () => {
    expect(describeDeviceCause("tracking_off", "ios", "manager").short).toBe(
      "Tracking is turned off",
    );
  });

  it("carries no em dash and no emoji, on any surface", () => {
    const causes = [
      "authorization_downgraded",
      "authorization_denied",
      "background_refresh_off",
      "low_power_mode",
      "battery_optimized",
      "tracking_off",
    ] as const;
    for (const c of causes) {
      for (const p of ["ios", "android", null]) {
        for (const a of ["manager", "driver"] as const) {
          const t = describeDeviceCause(c, p, a);
          const all = `${t.short} ${t.fix}`;
          expect(all, `${c}/${p}/${a}`).not.toMatch(/\u2014/);
          expect(all, `${c}/${p}/${a}`).not.toMatch(/\p{Extended_Pictographic}/u);
          expect(t.short.length, `${c}/${p}/${a} short`).toBeGreaterThan(0);
          expect(t.fix.length, `${c}/${p}/${a} fix`).toBeGreaterThan(0);
        }
      }
    }
  });
});
