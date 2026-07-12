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
