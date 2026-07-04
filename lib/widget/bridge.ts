// Phone → home-screen widget bridge (client half). Mirrors
// lib/watch/bridge.ts. syncWidget() fetches the same forecast snapshot
// the watch uses and hands it to the native TaxotticWidgetBridge plugin,
// which persists it (Android SharedPreferences today; iOS App Group
// later) so the native home-screen widget can render it. The widget
// itself is a dumb renderer, all the plan/entity adaptation (business
// vs personal forecast, or an empty state for free) already lives in the
// server snapshot, so there's no duplicated gating in native code.
//
// Graceful degradation (#69 lesson): dynamic-imported + guarded on
// isNativePlatform + isPluginAvailable. Web and pre-plugin binaries are
// a clean no-op; nothing throws.

type WidgetBridgePlugin = {
  update(opts: { snapshot: unknown }): Promise<void>;
};

// IMPORTANT (same gotcha as the watch bridge): never return the
// Capacitor plugin proxy directly from an async function, the proxy
// forwards every property access to native, so `await plugin()` would
// invoke proxy.then(...) and the runtime reports
// "TaxotticWidgetBridge.then() is not implemented". Wrap it in a plain
// holder so `await` resolves a non-thenable; `.bg` is the real proxy.
async function plugin(): Promise<{ bg: WidgetBridgePlugin } | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Capacitor, registerPlugin } = await import("@capacitor/core");
    if (
      !Capacitor.isNativePlatform() ||
      !Capacitor.isPluginAvailable("TaxotticWidgetBridge")
    ) {
      return null;
    }
    return { bg: registerPlugin<WidgetBridgePlugin>("TaxotticWidgetBridge") };
  } catch {
    return null;
  }
}

/** Fetch the freshest snapshot and hand it to the widget. Best-effort. */
export async function syncWidget(): Promise<void> {
  const p = await plugin();
  if (!p) return;
  try {
    const res = await fetch("/api/watch/snapshot", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return;
    const snapshot = (await res.json()) as Record<string, unknown>;
    await p.bg.update({ snapshot });
  } catch {
    /* offline / signed out, leave the widget on its last snapshot */
  }
}

let resumeWired = false;

/**
 * Keep the widget fresh: re-push the snapshot whenever the phone comes
 * back to the foreground. The widget can't fetch authenticated data on
 * its own, so "as of" freshness tracks app opens (with a timestamp shown
 * on the widget). Idempotent.
 */
export async function startWidgetBridge(): Promise<void> {
  if (resumeWired) return;
  const p = await plugin();
  if (!p) return;
  resumeWired = true;
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("resume", () => {
      void syncWidget();
    });
    await App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void syncWidget();
    });
  } catch {
    /* @capacitor/app absent, launch sync still applies */
  }
}
