/**
 * The one way this app POSTs mileage JSON.
 *
 * Extracted from native-tracker so the two native-buffer drains can use
 * it too. Before that they each called raw `fetch`, which meant the
 * single upload that can carry an entire day of driving was the only one
 * NOT on the native HTTP stack. See docs/design/upload-latency.md.
 *
 * Why this exists: Android throttles HTTP requests issued from the
 * WebView after roughly 5 minutes in the background. The
 * capacitor-community background-geolocation README documents exactly
 * this ("after 5 minutes in the background Android will throttle HTTP
 * requests initiated from the WebView. The solution is to use a native
 * HTTP plugin"), and Transistor Software's SDK docs say native upload
 * "is more reliable for background delivery than ad-hoc HTTP requests
 * from your own code". We had already adopted the OTHER half of that
 * same workaround (android.useLegacyBridge, which keeps the location
 * CALLBACKS firing) without ever moving the uploads.
 *
 * Symptom this fixes: on a long backgrounded drive the fixes keep being
 * captured but the flush stops landing, so the buffer grows toward
 * MAX_BUFFER and starts evicting oldest-first, which is real, silent
 * data loss.
 *
 * Auth: verified on-device (emulator, CDP) that CapacitorHttp carries
 * our Supabase session cookie: a native POST and a WebView fetch to the
 * same authenticated endpoint returned the IDENTICAL status (403
 * not_a_member, which only fires AFTER the auth check passes). Falls
 * back to fetch if the plugin is missing or throws, so a bad native
 * path can never take uploads down.
 */
export async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const webFetch = async () => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    let json: unknown = null;
    try {
      json = await res.clone().json();
    } catch {
      /* not JSON */
    }
    return { status: res.status, json };
  };

  let native = false;
  try {
    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    native = w.Capacitor?.isNativePlatform?.() === true;
  } catch {
    native = false;
  }
  if (!native) return webFetch();

  try {
    const { CapacitorHttp } = await import("@capacitor/core");
    const r = await CapacitorHttp.post({
      url: new URL(path, window.location.origin).toString(),
      headers: { "Content-Type": "application/json" },
      data: body,
    });
    return { status: r.status, json: r.data ?? null };
  } catch {
    // Native path unavailable or failed. Never lose the upload over it.
    return webFetch();
  }
}

/** 2xx, spelled once. */
export function postAccepted(res: { status: number }): boolean {
  return res.status >= 200 && res.status < 300;
}
