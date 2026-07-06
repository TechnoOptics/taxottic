"use client";

/**
 * Web Push client (the browser/desktop-PWA half of the notification
 * pipeline). This is the web analogue of what
 * @capacitor/push-notifications does natively on iOS/Android:
 *
 *   native (iOS/Android): register() → APNs/FCM token → POST /api/push/register
 *   web (this file):      pushManager.subscribe(VAPID) → subscription JSON
 *                         → POST /api/push/register (platform:"web")
 *
 * The server's Phase-3 send path fans a single { title, body, url }
 * payload out to all three: APNs, FCM, and (for these rows) the Web Push
 * protocol via the `web-push` library + the VAPID PRIVATE key.
 *
 * Gating mirrors native exactly: only act when
 * NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "1" and a VAPID public key
 * is configured. Everything is best-effort and never throws into the
 * caller. A failed subscribe just means no web push until next visit.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const PUSH_ENABLED =
  process.env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "1";

function webPushConfigured(): boolean {
  return (
    PUSH_ENABLED &&
    VAPID_PUBLIC_KEY.length > 0 &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// VAPID public keys are base64url-encoded; the Push API wants the raw
// bytes as a Uint8Array (the "applicationServerKey").
// Returns an ArrayBuffer-backed view so it satisfies `BufferSource`
// (applicationServerKey) under TS's generic-typed-array lib, since a bare
// `Uint8Array` widens to `Uint8Array<ArrayBufferLike>`, which includes
// SharedArrayBuffer and is not assignable to BufferSource.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function persist(subscription: PushSubscription): Promise<void> {
  try {
    await fetch("/api/push/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      // The whole subscription (endpoint + p256dh/auth keys) is the
      // "token" the send path needs. It fits well under the route's
      // 4096-char cap.
      body: JSON.stringify({
        token: JSON.stringify(subscription.toJSON()),
        platform: "web",
      }),
    });
  } catch {
    /* offline / logged out, retried on the next visit */
  }
}

/**
 * Idempotent: if a subscription already exists, refresh it server-side
 * (keeps last_seen_at current, same as native's cold-start re-register).
 * Only creates a NEW subscription when notification permission is already
 * granted, and never prompts. Call `enableWebPush()` from a user gesture to
 * prompt.
 */
export async function ensureWebPushSubscribed(): Promise<void> {
  if (!webPushConfigured()) return;
  // Native shell handles its own push via Capacitor; don't double-register.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).Capacitor?.isNativePlatform?.() === true) return;
  } catch {
    /* not in a Capacitor context */
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await persist(existing);
      return;
    }
    if (Notification.permission !== "granted") return;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    await persist(sub);
  } catch {
    /* subscribe unsupported / blocked; silent, best-effort */
  }
}

/**
 * Opt-in entry point for a settings toggle or "Enable notifications"
 * button. MUST be called from a user gesture (browsers reject
 * Notification.requestPermission() otherwise). Returns the resulting
 * permission so the caller can update its UI.
 */
export async function enableWebPush(): Promise<NotificationPermission> {
  if (!webPushConfigured()) return "denied";
  let permission: NotificationPermission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }
  if (permission === "granted") await ensureWebPushSubscribed();
  return permission;
}
