/**
 * JS side of the Android car-connection signals.
 *
 * Three observations about the vehicle, produced by native code that
 * runs whether or not this WebView exists:
 *
 *   bluetooth   a car head unit connected or disconnected. The earliest
 *               trip-start signal this platform offers, and the only one
 *               besides a geofence transition that will start a dead
 *               process. A disconnect is worth as much as a connect,
 *               because bad stop detection is what splits one journey
 *               into three.
 *   projection  Android Auto is connected. Near-certain vehicle
 *               presence, but it can only confirm a drive something else
 *               already noticed: the observer behind it lives in our
 *               process, and a dead process observes nothing.
 *   power       the phone started or stopped charging. Corroboration
 *               only. Car USB plus motion means something; charging at a
 *               desk means a desk.
 *
 * THIS MODULE REPORTS. IT DOES NOT DECIDE.
 *
 * Nothing here concludes that a drive started. Signals are timestamped
 * observations handed to whatever scores them, and the scoring lives
 * elsewhere on purpose: car Bluetooth is strong evidence and is still
 * only evidence, since a passenger in their own car connects exactly the
 * same way. A fabricated mile is worse than a missed one.
 *
 * Everything that has to survive process death is in
 * android/app/src/main/java/com/taxottic/app/TaxotticCar*.java. This file
 * is a typed reader over it, and returns null on every platform that has
 * no native side, which is web, iOS, and any Android build that shipped
 * before this feature.
 */

// STATIC import, matching lib/mileage/geofence.ts and
// lib/mileage/device-status.ts. A dynamic import() here is not a style
// choice, it is the proven cause of the geofence mesh never arming: a
// chunk fetch that never settles leaves the promise pending forever with
// no rejection for a catch to see, so every caller waits silently.
import { registerPlugin } from "@capacitor/core";

/** Which observation this is. */
export type CarSignalKind = "bluetooth" | "projection" | "power";

/** Every signal is one or the other. There is no third state. */
export type CarSignalState = "connected" | "disconnected";

/**
 * What the native side did about a signal.
 *
 * Named outcomes rather than a boolean, because "capture did not start"
 * has five distinct meanings and flattening them is how a silent failure
 * hides. Only `started` means a foreground service is now running.
 */
export type CarSignalWakeOutcome =
  /** A location foreground service was started for this signal. */
  | "started"
  /** A capture session was already live, so this changed nothing. */
  | "already_running"
  /** The wake fired but ACCESS_BACKGROUND_LOCATION is not granted, so
   *  starting would have produced a service that sees nothing. Refused
   *  on purpose. This is the one to surface to the driver. */
  | "blocked_no_background_permission"
  /** The OS refused the foreground-service start despite the broadcast
   *  exemption. Records that the exemption did not apply on this build. */
  | "blocked_service_start_denied"
  /** This kind of signal never starts capture (projection, charging, and
   *  every Bluetooth disconnect). */
  | "not_a_wake_source"
  /** Audio device, but not a car head unit. Logged, never woken on. */
  | "not_vehicle_class";

export type CarSignal = {
  /** Event schema version. Bump means a field's meaning changed. */
  v: number;
  /** Monotonic per install, so the stream is orderable even if the wall
   *  clock moves. */
  seq: number;
  kind: CarSignalKind;
  state: CarSignalState;
  /**
   * Wall clock. Joins to server rows and is readable by humans. Can jump
   * backwards when the network or the user changes the clock, so never
   * difference two of these to measure an interval.
   */
  atMs: number;
  /**
   * Monotonic since boot, counting time spent in deep sleep. This is the
   * one to difference when asking "how long after the car connected did
   * the phone start moving".
   */
  elapsedRealtimeMs: number;
  /**
   * atMs minus elapsedRealtimeMs, rounded to the second. Equal values
   * mean the same boot, so the two events' elapsedRealtimeMs are
   * comparable. Different values mean a reboot happened in between and
   * only atMs may be differenced. A monotonic clock without a way to
   * know whether two readings share an origin would be worse than none,
   * because it would look usable and quietly be wrong.
   */
  bootAtMs: number;

  /** Bluetooth only. Salted hash of the peer address, stable across
   *  connections on this install and reversible to nothing. */
  deviceId: string | null;
  /** Bluetooth only, and null unless BLUETOOTH_CONNECT is granted. The
   *  only field a driver can recognise when confirming "that is my car". */
  deviceName: string | null;
  /** Decoded major class, e.g. "audio_video". */
  deviceMajorClass: string | null;
  /** Decoded device class, e.g. "car_audio", "handsfree", "headphones". */
  deviceClass: string | null;
  /** Raw BluetoothClass values, so a class this build did not name is
   *  still fully recoverable downstream. */
  deviceMajorClassRaw: number | null;
  deviceClassRaw: number | null;
  /** True only for car audio and handsfree units. Headphones and
   *  speakers reach the log with this false and never wake anything. */
  vehicleClass: boolean | null;

  /** Power only: "ac" | "usb" | "wireless" | "dock" | "none" | "other" |
   *  "unknown". USB is the one that is plausibly a car. */
  plugged: string | null;

  /** Projection only: "projection" | "native" | "none" | "unknown". */
  projectionType: string | null;

  /** Whether the native side intended to start capture from this signal. */
  wakeAttempted: boolean;
  wakeOutcome: CarSignalWakeOutcome;
  /** Free text, e.g. the exception class name for a denied start. */
  wakeDetail: string;
};

export type CarSignalState_Bluetooth =
  | "granted"
  | "denied"
  | "not_requested"
  /** Below Android 12 there is no runtime Bluetooth permission. */
  | "not_required";

export type CarSignalsState = {
  schemaVersion: number;
  bluetoothPermission: CarSignalState_Bluetooth;
  bluetoothPermissionAsked: boolean;
  /** "on" | "off" | "absent" | "unreadable". A granted permission on a
   *  phone with the radio off produces no events either, and the two
   *  look identical from the signal log alone. */
  bluetoothAdapter: string;
  projectionType: string;
  projectionObserved: boolean;
  projectionError: string | null;
  backgroundLocation: boolean;
  vehicleConnects: number;
  vehicleDisconnects: number;
  /** Audio devices that were not cars. Non-zero proves broadcasts are
   *  reaching us even when no car ever has. */
  otherAudioEvents: number;
  /** Bluetooth events outside the audio-video class, counted and never
   *  logged: the user's watch and keyboard are not ours to record. */
  ignoredEvents: number;
  pendingSignals: number;
  /** Signals aged out of the ring because nothing drained them. */
  droppedSignals: number;
  totalSignals: number;
  lastWakeOutcome: CarSignalWakeOutcome | null;
  lastWakeAtMs: number;
  lastSignal: CarSignal | null;
};

type CarSignalsPlugin = {
  getState(): Promise<CarSignalsState>;
  readSignals(): Promise<{
    signals: CarSignal[];
    count: number;
    schemaVersion: number;
  }>;
  consumeSignals(options: { count: number }): Promise<{ remaining: number }>;
  requestBluetoothPermission(): Promise<{
    permission: CarSignalState_Bluetooth;
    granted: boolean;
    asked: boolean;
  }>;
};

/**
 * Same reasoning as lib/mileage/geofence.ts: deliberately NOT gated on
 * isPluginAvailable(). This app loads a remote URL, so the bridge's
 * plugin registry is not reliably populated in the page's JS context at
 * the moment we ask. registerPlugin is safe regardless, and a missing
 * native side simply makes the call reject, which every caller handles.
 */
function plugin(): CarSignalsPlugin | null {
  try {
    if (typeof window === "undefined") return null;
    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    if (w.Capacitor?.isNativePlatform?.() !== true) return null;
    return registerPlugin<CarSignalsPlugin>("TaxotticCarSignals");
  } catch {
    return null;
  }
}

/** Native health, or null when there is no native side to ask. */
export async function getCarSignalsState(): Promise<CarSignalsState | null> {
  const p = plugin();
  if (!p) return null;
  try {
    return await p.getState();
  } catch {
    return null;
  }
}

/**
 * Read buffered signals without removing them.
 *
 * Read, then act, then consume. Never a single draining call: a consumer
 * that dies mid-handoff must not take the evidence with it. Signals that
 * are read twice are cheap; signals that vanish are a lost drive.
 */
export async function readCarSignals(): Promise<CarSignal[]> {
  const p = plugin();
  if (!p) return [];
  try {
    const read = await p.readSignals();
    return read?.signals ?? [];
  } catch {
    return [];
  }
}

/** Drop the oldest N signals, after they have been durably handled. */
export async function consumeCarSignals(count: number): Promise<void> {
  const p = plugin();
  if (!p || count <= 0) return;
  try {
    await p.consumeSignals({ count });
  } catch {
    // Failing to consume costs a duplicate read next time, which every
    // consumer must tolerate anyway because seq makes duplicates
    // detectable. Failing to consume never costs a signal.
  }
}

/**
 * Ask for BLUETOOTH_CONNECT.
 *
 * A user-facing system dialog, so the caller owns the moment. It should
 * be a moment where the ask explains itself: mileage setup, or straight
 * after a drive the app missed. Not first launch next to four other
 * prompts, and not twice, because Android stops showing the dialog after
 * a second refusal.
 *
 * Refusal is a supported outcome, not an error. Nothing else changes:
 * the geofence resurrection mesh, the foreground service and every
 * existing capture path behave exactly as they do today. The only
 * consequence is that the Bluetooth wake source is absent, which
 * describeCarSignalsHealth reports rather than hiding.
 */
export async function requestCarBluetoothPermission(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    const result = await p.requestBluetoothPermission();
    return result?.granted === true;
  } catch {
    return false;
  }
}

export type CarSignalsHealth = {
  status: "ok" | "unavailable" | "degraded" | "broken";
  /** One sentence, written for a driver, not for a log. */
  message: string;
  action: "bluetooth_permission" | "background_location" | "bluetooth_radio" | null;
};

/**
 * Turn native state into something the driver sees.
 *
 * This exists because of how the original blackout hid: the tracking
 * notification kept saying healthy while every fix was discarded, so a
 * 21-hour hole looked identical to a quiet day. A denied Bluetooth
 * permission has the same shape, and worse, because on Android 12+ the
 * broadcast is simply never delivered and there is no error anywhere to
 * notice. Every way this feature can be off is a state below that a
 * driver can read and act on. There is deliberately no path that reports
 * success without evidence of success.
 */
export function describeCarSignalsHealth(
  state: CarSignalsState | null,
): CarSignalsHealth {
  if (!state) {
    return {
      status: "unavailable",
      message: "Car connection detection is not available on this device.",
      action: null,
    };
  }

  // Ordered by what costs the driver the most money. A wake that fired
  // and could not record beats a wake source that is merely absent,
  // because it means a drive was detected and still lost.
  if (state.lastWakeOutcome === "blocked_no_background_permission") {
    return {
      status: "broken",
      message:
        'Taxottic noticed you connect to your car but could not record the drive. Set Location to "Allow all the time".',
      action: "background_location",
    };
  }
  if (state.lastWakeOutcome === "blocked_service_start_denied") {
    return {
      status: "broken",
      message:
        "Taxottic noticed you connect to your car but this phone blocked it from starting. Drives that begin while the app is closed may be missed.",
      action: "background_location",
    };
  }
  if (
    state.bluetoothPermission === "denied" ||
    state.bluetoothPermission === "not_requested"
  ) {
    return {
      status: "degraded",
      message:
        "Taxottic cannot see when you connect to your car, so a drive may start recording a minute or two late. Everything else keeps working.",
      action: "bluetooth_permission",
    };
  }
  if (state.bluetoothAdapter === "off") {
    return {
      status: "degraded",
      message:
        "Bluetooth is off, so Taxottic cannot tell when you get into your car. Drives are still recorded when you leave a saved place.",
      action: "bluetooth_radio",
    };
  }
  if (state.bluetoothAdapter === "absent") {
    return {
      status: "degraded",
      message:
        "This phone has no Bluetooth, so drives start recording when you leave a saved place instead.",
      action: null,
    };
  }
  if (state.vehicleConnects === 0) {
    return {
      status: "degraded",
      message:
        "Taxottic has not seen your car's Bluetooth yet. Connect your phone to your car once and it will start recognising the start of your drives.",
      action: null,
    };
  }
  return {
    status: "ok",
    message: "Taxottic starts recording as soon as your phone connects to your car.",
    action: null,
  };
}
