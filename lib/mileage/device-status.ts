// JS bridge to the TaxotticDeviceStatus native plugin (plan §C).
// Graceful-degradation discipline (same as native-tracker): the plugin
// only exists in app builds that shipped it; on web and older installed
// binaries every entry point no-ops to null.

export type DeviceStatus = {
  platform: string;
  locationAuthorization: "always" | "whenInUse" | "denied" | "notDetermined";
  preciseLocation: boolean;
  /** Android only: OS is battery-optimizing the app (the Samsung
   *  starvation signal). */
  batteryOptimized?: boolean;
  /** Android only, lowercased OEM for wizard branching. */
  manufacturer?: string;
  /** iOS only. */
  lowPowerMode?: boolean;
  backgroundRefresh?: boolean;
};

type DeviceStatusPlugin = {
  getStatus(): Promise<DeviceStatus>;
  requestAlwaysUpgrade(): Promise<void>;
  requestBatteryExemption(): Promise<void>;
  openBatterySettings(): Promise<void>;
  addListener(
    event: "authorizationChanged",
    cb: (data: {
      locationAuthorization: DeviceStatus["locationAuthorization"];
      preciseLocation: boolean;
    }) => void,
  ): Promise<{ remove: () => void }>;
};

async function guard(): Promise<DeviceStatusPlugin | null> {
  try {
    const w = window as unknown as {
      Capacitor?: {
        isNativePlatform?: () => boolean;
        isPluginAvailable?: (n: string) => boolean;
      };
    };
    if (w.Capacitor?.isNativePlatform?.() !== true) return null;
    if (w.Capacitor?.isPluginAvailable?.("TaxotticDeviceStatus") !== true) {
      return null;
    }
    const { registerPlugin } = await import("@capacitor/core");
    return registerPlugin<DeviceStatusPlugin>("TaxotticDeviceStatus");
  } catch {
    return null;
  }
}

export async function getDeviceStatus(): Promise<DeviceStatus | null> {
  const plugin = await guard();
  if (!plugin) return null;
  try {
    return await plugin.getStatus();
  } catch {
    return null;
  }
}

export async function requestAlwaysUpgrade(): Promise<void> {
  const plugin = await guard();
  try {
    await plugin?.requestAlwaysUpgrade();
  } catch {
    /* no-op */
  }
}

/**
 * FIRM auto-exemption (all Android phones + tablets): make sure the OS
 * isn't battery-optimizing us, prompting the native "allow background"
 * dialog automatically when it is — so a driver never has to discover
 * the setup wizard to keep tracking alive. Called on launch + resume
 * (see CapacitorNativeInit) whenever tracking is enabled.
 *
 * Throttled: at most one auto-prompt per ATTEMPT_INTERVAL so we don't
 * nag on every resume, but we DO re-prompt after the interval if the
 * OS silently re-optimized us (Samsung re-enables "sleeping apps" after
 * firmware updates — the exact repeat failure this guards against).
 * A grant clears the throttle immediately so the next revocation
 * re-prompts without delay.
 */
const AUTO_EXEMPT_KEY = "taxottic.mileage.batteryPromptAt";
const ATTEMPT_INTERVAL_MS = 3 * 24 * 60 * 60_000; // 3 days

export async function ensureBatteryExemption(): Promise<void> {
  const plugin = await guard();
  if (!plugin) return;
  let status: DeviceStatus;
  try {
    status = await plugin.getStatus();
  } catch {
    return;
  }
  // Only Android optimizes; batteryOptimized false/undefined = fine.
  if (status.batteryOptimized !== true) {
    try {
      localStorage.removeItem(AUTO_EXEMPT_KEY);
    } catch {
      /* private mode */
    }
    return;
  }
  // Throttle repeated auto-prompts.
  try {
    const last = Number(localStorage.getItem(AUTO_EXEMPT_KEY) ?? 0);
    if (Date.now() - last < ATTEMPT_INTERVAL_MS) return;
    localStorage.setItem(AUTO_EXEMPT_KEY, String(Date.now()));
  } catch {
    /* private mode: still prompt, just no throttle memory */
  }
  try {
    await plugin.requestBatteryExemption();
  } catch {
    /* dialog unavailable; the setup wizard remains the manual path */
  }
}

export async function requestBatteryExemption(): Promise<boolean> {
  const plugin = await guard();
  if (!plugin) return false;
  try {
    await plugin.requestBatteryExemption();
    return true;
  } catch {
    try {
      await plugin.openBatterySettings();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Instant downgrade detection: subscribe to native authorization-change
 * events. Fires the callback with the new level the MOMENT iOS applies
 * a silent Always→While-Using downgrade (or the user changes settings),
 * instead of the server inferring it hours later from GPS silence.
 * Returns an unsubscribe fn (no-op when the plugin is absent).
 */
export async function onAuthorizationChanged(
  cb: (auth: DeviceStatus["locationAuthorization"]) => void,
): Promise<() => void> {
  const plugin = await guard();
  if (!plugin) return () => {};
  try {
    const handle = await plugin.addListener("authorizationChanged", (d) =>
      cb(d.locationAuthorization),
    );
    return () => void handle.remove();
  } catch {
    return () => {};
  }
}
