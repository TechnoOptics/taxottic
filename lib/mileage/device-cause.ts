/**
 * Why is this phone not tracking? Answered from the phone's own row.
 *
 * WHY THIS EXISTS. Driver c6218e2c's mileage_device_status row read
 * location_authorization = 'whenInUse', self_check =
 * 'denied=geofence_armed,location_always' and geofence_arm_state =
 * 'disarmed_no_background_permission' from 2026-08-25. The phone had
 * diagnosed itself correctly: iOS Location was While Using, so nothing
 * is captured unless the app is on screen, and only the driver can
 * change that. For nine days the manager's alert showed "Silent 42h"
 * next to prose saying it is "usually" While Using or a force-close,
 * a guess rendered beside a row that already held the answer, and the
 * driver's own page said nothing at all. Ten days, zero trips.
 *
 * This module turns the columns that row already carries into one
 * named cause and the exact Settings path for it, in priority order,
 * for whichever person is looking (the manager asking, or the driver
 * fixing). The generic wording stays only as the fallback for a row
 * that genuinely does not know.
 *
 * Vocabulary is shared with the existing evaluators rather than
 * invented: `authorization_downgraded` is device-stall.ts's StallReason
 * for the same fact, `low_power_mode` is self-check.ts's CapabilityId
 * for the same setting, and the rest are the row's own column names.
 *
 * Pure, so it is testable without a database, a cron or a device.
 */

export type DeviceCause =
  /** Location permission is While Using: capture only while on screen. */
  | "authorization_downgraded"
  /** Location permission refused or never granted. */
  | "authorization_denied"
  /** iOS Background App Refresh off: iOS will not wake the app at all. */
  | "background_refresh_off"
  /** iOS Low Power Mode / Android Battery Saver throttling background work. */
  | "low_power_mode"
  /** Android battery optimization not exempted. */
  | "battery_optimized"
  /** The driver's own toggle is off. */
  | "tracking_off";

/** The columns of mileage_device_status the cause is read from. */
export type DeviceCauseSignals = {
  /** "ios" | "android" | "web" as the heartbeat reports it. */
  platform: string | null;
  /** "always" | "whenInUse" | "denied" | "notDetermined", or null when
   *  the device-status bridge did not answer. Null is NOT a fault: for
   *  weeks it meant a dead plugin, not a driver who declined. */
  locationAuthorization: string | null;
  backgroundRefresh: boolean | null;
  lowPowerMode: boolean | null;
  batteryOptimized: boolean | null;
  trackingEnabled: boolean | null;
};

/**
 * The single most useful thing to fix, or null when the row shows
 * nothing wrong. Order matters: a permission that stops capture outright
 * outranks a setting that merely throttles it, and a setting the OS
 * enforces outranks the driver's own toggle.
 */
export function evaluateDeviceCause(s: DeviceCauseSignals): DeviceCause | null {
  if (s.locationAuthorization === "whenInUse") return "authorization_downgraded";
  if (s.locationAuthorization != null && s.locationAuthorization !== "always") {
    return "authorization_denied";
  }
  if (s.backgroundRefresh === false) return "background_refresh_off";
  if (s.lowPowerMode === true) return "low_power_mode";
  if (s.batteryOptimized === true) return "battery_optimized";
  if (s.trackingEnabled === false) return "tracking_off";
  return null;
}

export type DeviceCauseAudience = "manager" | "driver";

export type DeviceCauseText = {
  /** What is wrong, e.g. "Location is While Using". */
  short: string;
  /** What to do about it, with the Settings path when the OS is known. */
  fix: string;
};

/**
 * Wording for one cause, for one reader. The manager is asked to relay
 * it ("Ask them to..."), the driver is told directly ("Set it to...").
 * The Settings path is named only when the platform is known; a guessed
 * path is worse than none.
 */
export function describeDeviceCause(
  cause: DeviceCause,
  platform: string | null,
  audience: DeviceCauseAudience,
): DeviceCauseText {
  const ios = platform === "ios";
  const android = platform === "android";
  const manager = audience === "manager";
  const ask = manager ? "Ask them to " : "";
  const cap = (s: string) => (manager ? s : s.charAt(0).toUpperCase() + s.slice(1));

  switch (cause) {
    case "authorization_downgraded":
    case "authorization_denied": {
      const short =
        cause === "authorization_downgraded"
          ? manager
            ? "Location is While Using"
            : "Your location permission is While Using"
          : manager
            ? "Location permission is not granted"
            : "Your location permission is not granted";
      const fix = ios
        ? cap(`${ask}set it to Always: Settings > Taxottic > Location > Always.`)
        : android
          ? cap(
              `${ask}set it to Allow all the time: Settings > Apps > Taxottic > Permissions > Location > Allow all the time.`,
            )
          : cap(
              `${ask}set it to Always in ${manager ? "the" : "your"} phone's Settings for Taxottic.`,
            );
      return { short, fix };
    }
    case "background_refresh_off":
      return {
        short: "Background App Refresh is off",
        fix: cap(`${ask}turn it on: Settings > General > Background App Refresh.`),
      };
    case "low_power_mode":
      return {
        short: android ? "Battery Saver is on" : "Low Power Mode is on",
        fix: cap(`${ask}turn it off in Settings > Battery.`),
      };
    case "battery_optimized":
      return {
        short: "Battery optimization is throttling Taxottic",
        fix: cap(
          `${ask}set it to Unrestricted: Settings > Apps > Taxottic > Battery > Unrestricted.`,
        ),
      };
    case "tracking_off":
      return {
        short: "Tracking is turned off",
        fix: manager
          ? "Ask them to turn it on from the Mileage page."
          : "Turn it on with the toggle above.",
      };
  }
}
