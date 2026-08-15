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
  | "background_location"
  | "bluetooth_permission"
  | "car_signals_plugin";

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
  | "unknown";

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
  backgroundLocation: boolean | null;
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

  // ---- background location --------------------------------------
  if (!native) {
    out.push(check("background_location", "unsupported", "Not applicable on web."));
  } else if (p.backgroundLocation == null) {
    out.push(check("background_location", "unknown", "Not reported."));
  } else {
    out.push(
      p.backgroundLocation
        ? check("background_location", "live", "Granted.")
        : check("background_location", "denied", "Not granted. Only foreground drives record."),
    );
  }

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
  return "Every shipped capability is answering.";
}
