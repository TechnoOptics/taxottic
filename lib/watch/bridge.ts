// Phone ↔ watch bridge (client half). CI-verifiable, deploys live.
//
// syncWatch() pushes the WatchSnapshot to the native
// TaxotticWatchBridge plugin (→ WCSession + complication App Group),
// merging the two device-only mileage flags first. startWatchBridge()
// forwards inbound one-gesture watch actions to the SAME server paths
// the in-app / notification flows use — no new tax/mileage logic.
//
// Graceful degradation (#69 lesson): dynamic-imported + guarded on
// isNativePlatform + isPluginAvailable. Web and pre-plugin binaries
// are a clean no-op; nothing throws.

const LS_AUTO_APPLY = "taxottic.mileage.autoApply";

type WatchBridgePlugin = {
  sync(opts: { snapshot: unknown }): Promise<void>;
  addListener(
    event: "action",
    cb: (msg: Record<string, unknown>) => void,
  ): Promise<{ remove: () => void }>;
};

let lastCompanyId: string | null = null;

async function plugin(): Promise<WatchBridgePlugin | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Capacitor, registerPlugin } = await import("@capacitor/core");
    if (
      !Capacitor.isNativePlatform() ||
      !Capacitor.isPluginAvailable("TaxotticWatchBridge")
    ) {
      return null;
    }
    return registerPlugin<WatchBridgePlugin>("TaxotticWatchBridge");
  } catch {
    return null;
  }
}

/** Fetch the freshest snapshot, fold in the device-only mileage
 *  flags, and hand it to the watch. Best-effort. */
export async function syncWatch(): Promise<void> {
  const bg = await plugin();
  if (!bg) return;
  try {
    const res = await fetch("/api/watch/snapshot", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return;
    const snapshot = (await res.json()) as Record<string, unknown> & {
      companyId?: string;
      mileage?: Record<string, unknown>;
    };
    lastCompanyId = snapshot.companyId ?? lastCompanyId;

    // trackingActive / autoApplyBusiness are device prefs the server
    // can't know — merge them in client-side.
    try {
      const { getMileageTrackingState } = await import(
        "@/lib/mileage/native-tracker"
      );
      const st = await getMileageTrackingState();
      let autoApply = false;
      try {
        autoApply = window.localStorage.getItem(LS_AUTO_APPLY) === "1";
      } catch {
        /* private mode */
      }
      snapshot.mileage = {
        ...(snapshot.mileage ?? {}),
        trackingActive: !!st.enabled,
        autoApplyBusiness: autoApply,
      };
    } catch {
      /* native-tracker absent — leave server defaults */
    }

    await bg.sync({ snapshot });
  } catch {
    /* offline / signed out — leave the watch as-is */
  }
}

let actionUnsub: (() => void) | null = null;

/** Forward inbound one-gesture watch actions. Idempotent. */
export async function startWatchBridge(): Promise<void> {
  const bg = await plugin();
  if (!bg || actionUnsub) return;
  try {
    const handle = await bg.addListener("action", (msg) => {
      void handleAction(msg);
    });
    actionUnsub = handle.remove;
  } catch {
    /* absent — no-op */
  }

  // Keep the watch live: re-push the snapshot whenever the phone
  // comes back to the foreground (the phone may have changed state
  // while the watch was glanced at), so "updates from the phone
  // update the watch" holds beyond the initial launch sync.
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("resume", () => {
      void syncWatch();
    });
    await App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void syncWatch();
    });
  } catch {
    /* @capacitor/app absent — launch + post-action sync still apply */
  }
}

async function handleAction(msg: Record<string, unknown>): Promise<void> {
  const type = String(msg.type ?? "");

  // Swipe-confirm: left = Business, right = Personal. Trips AND
  // bank-synced expense/income clarification both go through the
  // session-authed /api/watch/confirm (it reuses the same
  // reclassify / setTxCategory / ignoreTx writes the app uses).
  if (type === "confirm") {
    const kind = String(msg.kind ?? "trip");
    const id = String(msg.id ?? "");
    const decision = String(msg.decision ?? "") === "left" ? "left" : "right";
    if (!id) return;
    await fetch("/api/watch/confirm", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, kind, decision }),
    }).catch(() => {});
    // Re-pull so the watch reflects the new server truth (the row is
    // now classified/ignored and anything new surfaces).
    void syncWatch();
    return;
  }

  // Mileage auto-tracking toggled from the wrist.
  if (type === "mileage") {
    const action = String(msg.action ?? "");
    try {
      const tracker = await import("@/lib/mileage/native-tracker");
      if (action === "start" && lastCompanyId) {
        await tracker.startMileageTracking(lastCompanyId);
      } else if (action === "stop") {
        await tracker.stopMileageTracking();
      }
    } catch {
      /* tracker plugin absent — no-op */
    }
    void syncWatch(); // reflect the new tracking state on the watch
    return;
  }

  if (type === "autoApply") {
    try {
      window.localStorage.setItem(
        LS_AUTO_APPLY,
        String(msg.value) === "on" ? "1" : "0",
      );
    } catch {
      /* private mode */
    }
    void syncWatch();
    return;
  }

  if (type === "open" && msg.route) {
    try {
      window.location.assign(`/${String(msg.route).replace(/^\/+/, "")}`);
    } catch {
      /* ignore */
    }
  }
}
