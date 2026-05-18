// Phone ↔ watch bridge (client half).
//
// This is the CI-verifiable, live-deployable half. It pushes the
// WatchSnapshot to the native TaxotticWatchBridge plugin (which hands
// it to WCSession + the complication App Group) and forwards inbound
// one-tap watch actions to the SAME server path the notification
// action uses (/api/push/action) — no new tax/mileage logic.
//
// Graceful degradation (#69 lesson): dynamic-imported + guarded on
// isNativePlatform + isPluginAvailable("TaxotticWatchBridge"). On
// web, and on any binary built before the native plugin is added in
// Xcode, every entry point is a clean no-op — nothing throws.

type WatchBridgePlugin = {
  sync(opts: { snapshot: unknown }): Promise<void>;
  addListener(
    event: "action",
    cb: (msg: Record<string, unknown>) => void,
  ): Promise<{ remove: () => void }>;
};

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

/** Fetch the freshest snapshot and hand it to the watch. Best-effort:
 *  a failed fetch or absent plugin just means the watch keeps its
 *  last value. Call on launch and on resume. */
export async function syncWatch(): Promise<void> {
  const bg = await plugin();
  if (!bg) return;
  try {
    const res = await fetch("/api/watch/snapshot", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return;
    const snapshot = await res.json();
    await bg.sync({ snapshot });
  } catch {
    /* offline / not signed in — leave the watch as-is */
  }
}

let actionUnsub: (() => void) | null = null;

/** Forward inbound one-tap watch actions to the existing
 *  /api/push/action handler (same auth + reclassify core as the
 *  notification action). Idempotent: a second call is a no-op. */
export async function startWatchBridge(): Promise<void> {
  const bg = await plugin();
  if (!bg || actionUnsub) return;
  try {
    const handle = await bg.addListener("action", (msg) => {
      const type = String(msg.type ?? "");
      if (type === "trip-classify" && msg.tripId && msg.classification) {
        void fetch("/api/push/action", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: {
              kind: "trip",
              tripId: String(msg.tripId),
              classification: String(msg.classification),
            },
            actionId: String(msg.classification),
          }),
        }).catch(() => {});
      } else if (type === "open" && msg.route) {
        // The phone is already foregrounded by the OS when an action
        // is delivered; route the WebView there.
        try {
          window.location.assign(`/${String(msg.route).replace(/^\/+/, "")}`);
        } catch {
          /* ignore */
        }
      }
    });
    actionUnsub = handle.remove;
  } catch {
    /* plugin shape changed / absent — no-op */
  }
}
