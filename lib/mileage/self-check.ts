/**
 * Does each capability actually WORK, or does it merely exist?
 *
 * WHY THIS MODULE EXISTS. Three separate investigations on 2026-08-15
 * ended at the same root cause, and none of them were visible in code
 * review, in CI, or in the type system:
 *
 *   iOS plugins        compiled, @objc, CAPBridgedPlugin, in the pbxproj,
 *                      and NEVER REGISTERED. Capacitor 8 loads only
 *                      packageClassList, which the CLI writes from npm
 *                      packages, so app-target plugins can never appear
 *                      there. Every iOS device-truth field had been NULL
 *                      since the feature shipped.
 *
 *   Bluetooth wake     plugin method, JS wrapper, receiver and vehicle
 *                      classifier all present and correct. Nothing ever
 *                      CALLED the permission request, so the permission
 *                      sat at granted=false with no USER_SET flag: never
 *                      declined, never offered. Six correctly classified
 *                      cars, zero wakes, for the life of the feature.
 *
 *   Trip endpoints     columns existed from the first migration, were
 *                      read by the UI, and were never written. 185 trips
 *                      with null at both ends.
 *
 * The common shape: BUILT BUT DEAD. The code is there, it type-checks,
 * it looks right, and it does nothing. Every symptom is an absence, and
 * absence is exactly what nobody investigates.
 *
 * THE DESIGN RULE THAT FOLLOWS. A dead capability must never report as
 * null. Null reads as "no data yet" and gets skipped. It must report as
 * DEAD, which reads as an accusation and gets chased. That distinction
 * is the entire point of this module, and it is why `unknown` and
 * `dead` are different verdicts rather than one nullable field.
 *
 * The second rule: OUR fault and the USER'S choice are not the same
 * alarm. A driver who declined a permission is not a bug. A plugin that
 * will not answer is. Conflating them trains people to ignore both.
 */

export type CapabilityId =
  | "device_status_plugin"
  | "geofence_plugin"
  | "geofence_armed"
  | "location_always"
  | "bluetooth_permission"
  | "car_signals_plugin"
  | "low_power_mode";

export type Verdict =
  /** Answered, and is doing its job. */
  | "live"
  /** We ship this and it will not answer. OUR bug. The reason this exists. */
  | "dead"
  /** The user said no. Their choice, surfaced, never alarmed on. */
  | "denied"
  /** Not available on this platform or OS version. Correct silence. */
  | "unsupported"
  /** Could not be determined. Honest, and NOT the same as dead. */
  | "unknown"
  /**
   * Working, but a DEVICE SETTING the driver controls is degrading it.
   *
   * Deliberately its own verdict rather than a shade of `dead` or
   * `denied`. It is not our bug, so `dead` would be a false alarm and
   * this module's whole value is that `dead` means something. It is also
   * not a refused permission, so `denied` would misdescribe both the
   * cause and the fix: nobody said no to anything, a battery setting is
   * simply throttling us.
   *
   * The distinguishing property is that the DRIVER can fix it in
   * Settings in ten seconds, and nobody can fix it for them. That makes
   * it the only verdict worth showing the driver directly.
   */
  | "degraded";

export type CapabilityCheck = {
  id: CapabilityId;
  verdict: Verdict;
  /** One line a human can act on. */
  detail: string;
  /**
   * True only for `dead`. Kept as its own field so a consumer can alarm
   * on "we shipped something broken" without having to know which
   * verdicts are our fault and which are the driver's.
   */
  builtButDead: boolean;
};

/** What a probe of the native surface produced. All fields optional. */
export type ProbeInput = {
  platform: "ios" | "android" | "web" | null;
  /**
   * Has a probe cycle actually completed?
   *
   * Without this the module cannot tell "the plugin refused to answer"
   * from "we have not asked yet", because both arrive as nulls. Calling
   * the second one dead would fire on every cold start, and a check that
   * cries wolf on startup is a check people mute. Defaults to false, so
   * silence is only ever an accusation once we have genuinely looked.
   */
  probed: boolean;
  /** Milliseconds the device-status plugin took, and whether it threw. */
  deviceStatusOk: boolean | null;
  deviceStatusMs: number | null;
  /** The stage a failed probe reached. "call" means registered-but-absent. */
  deviceStatusStage: string | null;
  geofenceArmState: string | null;
  geofenceCount: number | null;
  locationAuthorization: string | null;
  /**
   * iOS Low Power Mode / Android battery saver, as the device reports it.
   * Null means not reported, which is NOT the same as off: before the
   * iOS plugin registration was fixed this field was null on every iPhone
   * for weeks while Low Power Mode was actually ON.
   */
  lowPowerMode: boolean | null;
  bluetoothPermission: string | null;
  bluetoothPermissionAsked: boolean | null;
  carSignalsOk: boolean | null;
};

function check(
  id: CapabilityId,
  verdict: Verdict,
  detail: string,
): CapabilityCheck {
  return { id, verdict, detail, builtButDead: verdict === "dead" };
}

/**
 * A probe that rejects in single-digit milliseconds is the signature of
 * a plugin that was never registered, not of a slow device.
 *
 * registerPlugin() returns a proxy whatever happens, so the failure
 * surfaces only when a method is called and the bridge finds nothing to
 * call. In production that read as device_probe "error" at stage "call"
 * in 1 to 2 ms. A genuinely slow or busy plugin takes tens of ms and
 * usually succeeds.
 */
export const UNREGISTERED_MS_CEILING = 10;

export function evaluate(p: ProbeInput): CapabilityCheck[] {
  const out: CapabilityCheck[] = [];
  const native = p.platform === "ios" || p.platform === "android";

  // ---- device status plugin -------------------------------------
  if (!native) {
    out.push(
      check("device_status_plugin", "unsupported", "Web has no native plugins."),
    );
  } else if (p.deviceStatusOk === true) {
    out.push(check("device_status_plugin", "live", "Answering."));
  } else if (p.deviceStatusOk === false) {
    const fast =
      p.deviceStatusMs != null && p.deviceStatusMs <= UNREGISTERED_MS_CEILING;
    out.push(
      check(
        "device_status_plugin",
        "dead",
        fast || p.deviceStatusStage === "call"
          ? `Rejected in ${p.deviceStatusMs ?? "?"}ms at stage "${p.deviceStatusStage ?? "?"}". The plugin is compiled but not registered with the bridge.`
          : "The plugin did not answer.",
      ),
    );
  } else {
    out.push(check("device_status_plugin", "unknown", "Not probed yet."));
  }

  // ---- geofence plugin, and separately whether it ARMED ----------
  //
  // Two checks, not one, and the split matters. A registered plugin
  // that reports disarmed_no_places is working correctly and has
  // nothing to do. A plugin that reports nothing at all is dead. Those
  // had been indistinguishable, because both produced a null column.
  if (!native) {
    out.push(check("geofence_plugin", "unsupported", "Web has no geofences."));
    out.push(check("geofence_armed", "unsupported", "Web has no geofences."));
  } else if (p.geofenceArmState == null && !p.probed) {
    out.push(check("geofence_plugin", "unknown", "Not probed yet."));
    out.push(check("geofence_armed", "unknown", "Not probed yet."));
  } else if (p.geofenceArmState == null) {
    out.push(
      check(
        "geofence_plugin",
        "dead",
        "No arm state reported at all. On iOS this is the registration failure: the plugin ships in the binary and is never handed to the bridge.",
      ),
    );
    out.push(
      check("geofence_armed", "unknown", "Cannot arm what does not answer."),
    );
  } else {
    out.push(check("geofence_plugin", "live", `Reported "${p.geofenceArmState}".`));
    if (p.geofenceArmState === "armed") {
      out.push(
        check(
          "geofence_armed",
          "live",
          `${p.geofenceCount ?? 0} place${p.geofenceCount === 1 ? "" : "s"} armed.`,
        ),
      );
    } else if (p.geofenceArmState === "disarmed_no_background_permission") {
      out.push(
        check(
          "geofence_armed",
          "denied",
          "Needs Location set to Always. Region monitoring cannot run on While Using.",
        ),
      );
    } else if (p.geofenceArmState === "disarmed_no_places") {
      out.push(
        check(
          "geofence_armed",
          "live",
          "Nothing to arm yet. Places are learned from the first few drives.",
        ),
      );
    } else {
      out.push(check("geofence_armed", "dead", `Arm failed: ${p.geofenceArmState}.`));
    }
  }

  // ---- location authorization -----------------------------------
  if (!native) {
    out.push(check("location_always", "unsupported", "Web uses the page's own permission."));
  } else if (p.locationAuthorization == null) {
    // Deliberately NOT "denied". A null here means we could not read the
    // setting, which on iOS was caused by the dead plugin rather than by
    // the driver refusing anything. Blaming the driver for our bug is
    // how a registration failure got mistaken for a permissions problem
    // for weeks.
    out.push(
      check(
        "location_always",
        "unknown",
        "Could not read the setting. Usually means the device-status plugin is not answering, not that the driver declined.",
      ),
    );
  } else if (p.locationAuthorization === "always") {
    out.push(check("location_always", "live", "Always. Background capture can run."));
  } else {
    out.push(
      check(
        "location_always",
        "denied",
        `Set to "${p.locationAuthorization}". Drives taken with the app closed will not record.`,
      ),
    );
  }

  // ---- background location: DELIBERATELY NOT A CAPABILITY --------
  //
  // There used to be a `background_location` check here and it was wrong
  // in both directions.
  //
  // On iOS it was fed from UIApplication.backgroundRefreshStatus, which
  // is BACKGROUND APP REFRESH, a different setting from background
  // location authorisation (CLLocationManager .authorizedAlways). A
  // phone with App Refresh on and Location set to While Using reported
  // "Granted", which is false.
  //
  // On Android the Java plugin never emits the field at all, so it was
  // permanently null, permanently `unknown`, and a completely healthy
  // Android device could never reach "ok". A check that no device can
  // ever satisfy is a check people learn to ignore, which costs more
  // than the check was ever worth.
  //
  // location_always already reports the real signal correctly on both
  // platforms, so this was a duplicate that disagreed with its twin.
  // One accurate check beats two that argue.

  // ---- bluetooth, where "never asked" is its own answer ----------
  //
  // The distinction this check exists for: not_requested with
  // bluetoothPermissionAsked false is OUR failure to show a prompt, and
  // is dead. A driver who saw the prompt and declined is denied. Those
  // look identical in the permission value alone, which is why the
  // feature sat broken with six paired cars.
  if (p.platform !== "android") {
    out.push(check("bluetooth_permission", "unsupported", "Android only."));
  } else if (p.bluetoothPermission === "granted") {
    out.push(check("bluetooth_permission", "live", "A car connect can start a drive."));
  } else if (p.bluetoothPermission === "not_required") {
    out.push(check("bluetooth_permission", "unsupported", "Not a runtime permission below Android 12."));
  } else if (p.bluetoothPermission == null) {
    out.push(check("bluetooth_permission", "unknown", "Not reported."));
  } else if (p.bluetoothPermissionAsked === false) {
    out.push(
      check(
        "bluetooth_permission",
        "dead",
        "The prompt has never been shown. Not declined, never offered, so the car wake trigger cannot work at all.",
      ),
    );
  } else {
    out.push(
      check("bluetooth_permission", "denied", "Declined. Car connects will not start a drive."),
    );
  }

  // ---- car signals plugin ---------------------------------------
  if (p.platform !== "android") {
    out.push(check("car_signals_plugin", "unsupported", "Android only."));
  } else if (p.carSignalsOk == null) {
    out.push(check("car_signals_plugin", "unknown", "Not probed."));
  } else {
    out.push(
      p.carSignalsOk
        ? check("car_signals_plugin", "live", "Answering.")
        : check("car_signals_plugin", "dead", "Compiled but not answering."),
    );
  }

  // ---- low power mode -------------------------------------------
  //
  // Not a capability we ship, which is exactly why it belongs here. On
  // 2026-08-16, the first heartbeat where the iOS plugins finally
  // answered reported low_power_mode = true on a phone whose drives had
  // been going missing for weeks. iOS Low Power Mode suppresses
  // background activity and can delay or drop location callbacks, so it
  // produces the same symptom as a dead tracker while everything we ship
  // reports healthy.
  //
  // It was invisible until now for the dullest possible reason: the
  // field was NULL along with every other device-truth column, because
  // the plugin that reports it was never registered.
  //
  // `degraded`, never `dead`: we are not broken, and calling this our
  // bug would put a false accusation in the one field people trust to
  // mean "we shipped something that does not work".
  if (!native) {
    out.push(check("low_power_mode", "unsupported", "Web has no battery mode."));
  } else if (p.lowPowerMode === true) {
    out.push(
      check(
        "low_power_mode",
        "degraded",
        p.platform === "ios"
          ? "Low Power Mode is ON. iOS throttles background activity, so drives can be recorded late or missed. Turn it off in Settings > Battery."
          : "Battery Saver is ON. Android throttles background work, so drives can be recorded late or missed. Turn it off in Settings > Battery.",
      ),
    );
  } else if (p.lowPowerMode === false) {
    out.push(check("low_power_mode", "live", "Not throttled."));
  } else {
    out.push(check("low_power_mode", "unknown", "Not reported."));
  }

  return out;
}

/** Capabilities we ship that are not working. The only true alarm. */
export function deadCapabilities(checks: CapabilityCheck[]): CapabilityCheck[] {
  return checks.filter((c) => c.builtButDead);
}

/**
 * Compact, sortable summary for the heartbeat column.
 *
 * Format: "dead=geofence_plugin,bluetooth_permission" or "ok".
 * Deliberately names the dead ones rather than counting them: a count
 * tells you something is wrong, a name tells you what to fix, and this
 * string is what someone will read at 2am in a database row.
 */
export function summarizeForHeartbeat(checks: CapabilityCheck[]): string {
  const dead = deadCapabilities(checks).map((c) => c.id);
  if (dead.length > 0) return `dead=${dead.join(",")}`;
  const denied = checks.filter((c) => c.verdict === "denied").map((c) => c.id);
  if (denied.length > 0) return `denied=${denied.join(",")}`;
  // Ranked ABOVE unknown: degraded is a measured fact with a fix the
  // driver can apply, while unknown is the absence of a measurement.
  // Reporting "unknown=x" while a phone sits throttled would bury the
  // actionable finding under the unmeasured one.
  const degraded = checks
    .filter((c) => c.verdict === "degraded")
    .map((c) => c.id);
  if (degraded.length > 0) return `degraded=${degraded.join(",")}`;
  const unknown = checks.filter((c) => c.verdict === "unknown").map((c) => c.id);
  if (unknown.length > 0) return `unknown=${unknown.join(",")}`;
  return "ok";
}

/** One line for a human, ordered worst first. */
export function describe(checks: CapabilityCheck[]): string {
  const dead = deadCapabilities(checks);
  if (dead.length > 0) {
    return `${dead.length} capabilit${dead.length === 1 ? "y is" : "ies are"} shipped but not working: ${dead.map((c) => c.id).join(", ")}`;
  }
  const denied = checks.filter((c) => c.verdict === "denied");
  if (denied.length > 0) {
    return `${denied.length} permission${denied.length === 1 ? "" : "s"} not granted: ${denied.map((c) => c.id).join(", ")}`;
  }
  const degraded = checks.filter((c) => c.verdict === "degraded");
  if (degraded.length > 0) {
    // The detail carries the actual instruction ("Settings > Battery"),
    // because this is the one verdict a DRIVER is meant to read and act
    // on rather than an engineer.
    return degraded.map((c) => c.detail).join(" ");
  }
  return "Every shipped capability is answering.";
}

/**
 * Checks a DRIVER should see, with an instruction they can follow.
 *
 * Separate from deadCapabilities() on purpose. That one answers "did we
 * ship something broken", which is an engineering alarm. This answers
 * "is there something only you can fix", which belongs on the phone.
 * Mixing them would put our bugs in front of the driver and their
 * battery settings in front of us, and both audiences would learn to
 * ignore the result.
 */
export function driverActionable(
  checks: CapabilityCheck[],
): CapabilityCheck[] {
  return checks.filter((c) => c.verdict === "degraded" || c.verdict === "denied");
}
