// Concrete push providers behind the PushProvider interface.
//
// HONEST SCOPE (same status as the iOS build / Maps key): the APNs
// and FCM transports are real, but they are exercised only once the
// founder provisions credentials, they CANNOT be CI-verified (no
// keys, no device). Phase 1's tested surface is the orchestration
// (lib/push/send.ts) + payloads, proven with a fake provider. With
// no credentials, resolveProvider() returns the Noop provider so the
// pipeline is a clean no-op rather than a crash (the Maps-key /
// graceful-degradation pattern used across the app).

import crypto from "node:crypto";
import http2 from "node:http2";
import type { PushProvider, Platform } from "./send";
import type { PushPayload } from "./payloads";

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Default. Delivers nothing; never throws. Used when no credentials
 *  are configured so the rest of the pipeline runs and is testable. */
export const NoopProvider: PushProvider = {
  async send() {
    return { delivered: false };
  },
};

// ---------------------------------------------------------------------------
// APNs (iOS), token-based auth, ES256 JWT, HTTP/2. Env:
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (.p8 contents),
//   APNS_BUNDLE_ID, APNS_PRODUCTION ("1" → api.push.apple.com).
// ---------------------------------------------------------------------------
function apnsConfigured() {
  return !!(
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID &&
    process.env.APNS_PRIVATE_KEY &&
    process.env.APNS_BUNDLE_ID
  );
}

let apnsJwt: { token: string; mintedAt: number } | null = null;
function apnsToken(): string {
  // APNs caps JWT lifetime at 1h and rejects <20min-old reuse churn;
  // mint once, reuse ~50min.
  if (apnsJwt && Date.now() - apnsJwt.mintedAt < 50 * 60_000) {
    return apnsJwt.token;
  }
  const header = b64url(
    JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID }),
  );
  const claims = b64url(
    JSON.stringify({
      iss: process.env.APNS_TEAM_ID,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const signer = crypto.createSign("SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign({
    key: process.env.APNS_PRIVATE_KEY as string,
    dsaEncoding: "ieee-p1363",
  });
  const token = `${header}.${claims}.${b64url(sig)}`;
  apnsJwt = { token, mintedAt: Date.now() };
  return token;
}

const ApnsProvider: PushProvider = {
  async send(deviceToken, _platform, payload: PushPayload) {
    const host = process.env.APNS_PRODUCTION
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
    const body = JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
        ...(payload.category ? { category: payload.category } : {}),
      },
      data: payload.data,
    });
    return await new Promise((resolve) => {
      const client = http2.connect(host);
      const req = client.request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${apnsToken()}`,
        "apns-topic": process.env.APNS_BUNDLE_ID as string,
        "apns-push-type": "alert",
        "content-type": "application/json",
      });
      let status = 0;
      req.on("response", (h) => {
        status = Number(h[":status"]) || 0;
      });
      req.on("error", () => {
        client.close();
        resolve({ delivered: false });
      });
      req.on("end", () => {
        client.close();
        // 410 = token no longer valid; 400 BadDeviceToken similar.
        resolve({
          delivered: status === 200,
          invalidToken: status === 410 || status === 400,
        });
      });
      req.setEncoding("utf8");
      req.on("data", () => {});
      req.end(body);
    });
  },
};

// ---------------------------------------------------------------------------
// FCM v1 (Android) → OAuth2 access token → HTTPS POST. Two auth modes, in
// priority order:
//   "sa":  FCM_SERVICE_ACCOUNT_JSON, the classic downloaded service-account
//           key. Simplest, but needs a key file, which some GCP orgs forbid
//           via the iam.disableServiceAccountKeyCreation policy.
//   "wif": keyless Workload Identity Federation. Vercel mints an OIDC token
//           (VERCEL_OIDC_TOKEN) per invocation; GCP STS exchanges it for a
//           federated token that then impersonates the Firebase SA. Nothing
//           to store or leak, and it sidesteps the key-creation org policy.
//           Env: GCP_WIF_AUDIENCE, GCP_WIF_SERVICE_ACCOUNT, FCM_PROJECT_ID.
//           One-time GCP setup: docs/PUSH_FCM_WORKLOAD_IDENTITY.md.
// ---------------------------------------------------------------------------
type FcmAuthMode = "sa" | "wif";
function fcmAuthMode(): FcmAuthMode | null {
  if (process.env.FCM_SERVICE_ACCOUNT_JSON) return "sa";
  // WIF is "configured" by the build-time vars. The subject token is
  // per-request and fetched at send time via getVercelOidcToken() (it is
  // NOT in process.env at runtime, only during `vercel env pull`, which
  // is the bug this replaced).
  if (
    process.env.GCP_WIF_AUDIENCE &&
    process.env.GCP_WIF_SERVICE_ACCOUNT &&
    process.env.FCM_PROJECT_ID
  ) {
    return "wif";
  }
  return null;
}
function fcmConfigured() {
  return fcmAuthMode() !== null;
}

// One cache slot: only one mode is ever active per deployment.
let fcmAccess: { token: string; exp: number } | null = null;

// "sa" mode: sign a JWT with the SA private key, exchange for an OAuth token.
async function fcmAccessTokenFromSaKey(sa: {
  client_email: string;
  private_key: string;
  token_uri: string;
}): Promise<string> {
  if (fcmAccess && Date.now() < fcmAccess.exp - 60_000) {
    return fcmAccess.token;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64url(
    signer.sign(sa.private_key),
  )}`;
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  fcmAccess = {
    token: json.access_token,
    exp: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

// "wif" mode: Vercel OIDC token → GCP STS federated token → SA impersonation.
// Cached ~55 min (the impersonated token's lifetime), independent of the
// per-request Vercel OIDC token.
async function fcmAccessTokenViaWif(): Promise<string> {
  if (fcmAccess && Date.now() < fcmAccess.exp - 60_000) {
    return fcmAccess.token;
  }
  // 0. Get the per-request Vercel OIDC token. In the deployed runtime this
  //    is NOT process.env.VERCEL_OIDC_TOKEN (that only exists locally via
  //    `vercel env pull`); it is exposed per-invocation and read by
  //    @vercel/functions' getVercelOidcToken(). Dynamic import so the
  //    package only loads on the WIF path.
  let oidcToken = "";
  try {
    const { getVercelOidcToken } = await import("@vercel/functions/oidc");
    oidcToken = await getVercelOidcToken();
  } catch (e) {
    console.log(
      `[push-fcm] no Vercel OIDC token: ${(e as Error)?.message ?? String(e)}`,
    );
    throw new Error("wif: Vercel OIDC token unavailable");
  }
  // 1. Exchange the Vercel OIDC JWT for a federated Google access token.
  //    STS wants application/x-www-form-urlencoded with snake_case fields
  //    (the documented format used by every google-auth client). An earlier
  //    JSON/camelCase body was silently rejected, so the whole FCM send
  //    failed with delivered=0 and no visible error.
  const stsRes = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      audience: process.env.GCP_WIF_AUDIENCE as string,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: oidcToken,
    }),
  });
  const stsText = await stsRes.text();
  if (!stsRes.ok) {
    console.log(`[push-fcm] STS ${stsRes.status}: ${stsText.slice(0, 400)}`);
    throw new Error(`wif: STS exchange failed (${stsRes.status})`);
  }
  const sts = JSON.parse(stsText) as { access_token?: string };
  if (!sts.access_token) {
    throw new Error("wif: STS token exchange returned no access_token");
  }
  // 2. Impersonate the Firebase SA for a messaging-scoped access token.
  const impRes = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${process.env.GCP_WIF_SERVICE_ACCOUNT}:generateAccessToken`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${sts.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scope: ["https://www.googleapis.com/auth/firebase.messaging"],
        lifetime: "3600s",
      }),
    },
  );
  const impText = await impRes.text();
  if (!impRes.ok) {
    console.log(
      `[push-fcm] impersonate ${impRes.status}: ${impText.slice(0, 400)}`,
    );
    throw new Error(`wif: SA impersonation failed (${impRes.status})`);
  }
  const imp = JSON.parse(impText) as { accessToken?: string };
  if (!imp.accessToken) {
    throw new Error("wif: SA impersonation returned no accessToken");
  }
  fcmAccess = { token: imp.accessToken, exp: Date.now() + 3600 * 1000 };
  return imp.accessToken;
}

const FcmProvider: PushProvider = {
  async send(deviceToken, _platform, payload: PushPayload) {
    const mode = fcmAuthMode();
    if (!mode) return { delivered: false };
    let projectId: string;
    let access: string;
    if (mode === "sa") {
      const sa = JSON.parse(
        process.env.FCM_SERVICE_ACCOUNT_JSON as string,
      ) as {
        project_id: string;
        client_email: string;
        private_key: string;
        token_uri: string;
      };
      projectId = sa.project_id;
      access = await fcmAccessTokenFromSaKey(sa);
    } else {
      projectId = process.env.FCM_PROJECT_ID as string;
      access = await fcmAccessTokenViaWif();
    }
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: { title: payload.title, body: payload.body },
            data: payload.data,
            android: payload.category
              ? { notification: { click_action: payload.category } }
              : undefined,
          },
        }),
      },
    );
    if (res.ok) return { delivered: true };
    // Surface WHY a send failed (403 permission, 404 unregistered, etc.)
    // instead of failing silently.
    const errText = await res.text().catch(() => "");
    console.log(`[push-fcm] send ${res.status}: ${errText.slice(0, 400)}`);
    // UNREGISTERED / invalid token → 404.
    return { delivered: false, invalidToken: res.status === 404 };
  },
};

// ---------------------------------------------------------------------------
// Web Push (browsers / desktop PWAs), VAPID + RFC 8291 payload
// encryption. Env: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (optional, defaults to a mailto:). The device "token"
// for platform:"web" is the JSON-stringified PushSubscription that
// lib/push/web.ts stored via /api/push/register.
//
// Unlike APNs/FCM above (hand-rolled on node built-ins), web push uses
// the `web-push` library: the aes128gcm content encryption (RFC 8188)
// over an ECDH/HKDF-derived key (RFC 8291) is security-sensitive and
// not worth reimplementing. This is the one intentional dependency in
// this file.
// ---------------------------------------------------------------------------
function webPushConfigured() {
  return !!(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
}

let vapidReady = false;
function ensureVapid(webpush: typeof import("web-push")) {
  if (vapidReady) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:contact@technooptics.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );
  vapidReady = true;
}

// Deep-link target per event kind, read by sw.js's notificationclick
// handler. Conservative: only routes we know exist, else the app root.
function webUrlFromData(data: Record<string, string>): string {
  switch (data.kind) {
    case "trip_classify":
    case "trip_logged":
    case "tracker_stalled":
    case "tracker_parked":
    case "tracker_foreground_only":
      return "/mileage";
    // MANAGER-facing tracker alerts. These used to fall through to the
    // default "/" and drop a manager on the app root with no indication of
    // which driver or what to do, which is a notification that interrupts
    // someone and then wastes the interruption. /firm/mileage is the
    // per-driver rollup, the one screen where a manager can actually see
    // whose capture has stopped.
    case "driver_tracker_unreachable":
    case "driver_tracker_foreground_only":
      return "/firm/mileage";
    case "clarify":
      return data.subject === "trip" ? "/mileage" : "/expenses";
    case "expense_applied":
      return "/expenses";
    case "badge_awarded":
      return "/achievements";
    default:
      return "/";
  }
}

const WebPushProvider: PushProvider = {
  async send(subJson, _platform, payload: PushPayload) {
    const webpush = (await import("web-push")).default;
    ensureVapid(webpush);
    let subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };
    try {
      subscription = JSON.parse(subJson);
    } catch {
      // A token that isn't a subscription JSON is unusable; treat it as
      // invalid so it gets revoked rather than retried forever.
      return { delivered: false, invalidToken: true };
    }
    // The service worker's `push` handler (public/sw.js v96) reads
    // exactly these fields.
    const swPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      data: payload.data,
      url: webUrlFromData(payload.data),
      tag: payload.data.kind,
      // Interactive category → the SW renders Business/Personal/Review
      // action buttons (sw.js v119). Same contract as aps.category.
      ...(payload.category ? { category: payload.category } : {}),
    });
    try {
      await webpush.sendNotification(subscription, swPayload, {
        TTL: 60 * 60 * 24,
      });
      return { delivered: true };
    } catch (err) {
      // 404/410 → the subscription is gone (unsubscribed / expired);
      // ask the caller to revoke it. Other statuses are soft misses.
      const status = (err as { statusCode?: number })?.statusCode;
      return {
        delivered: false,
        invalidToken: status === 404 || status === 410,
      };
    }
  },
};

/**
 * Resolve the provider for the current environment. Routes per
 * platform; any platform without configured credentials falls back
 * to a clean no-op (not a crash) for that platform.
 */
export function resolveProvider(): PushProvider {
  const apnsOn = apnsConfigured();
  const fcmOn = fcmConfigured();
  const webOn = webPushConfigured();
  if (!apnsOn && !fcmOn && !webOn) return NoopProvider;
  return {
    async send(token: string, platform: Platform, payload: PushPayload) {
      if (platform === "ios" && apnsOn) {
        return ApnsProvider.send(token, platform, payload);
      }
      if (platform === "android" && fcmOn) {
        return FcmProvider.send(token, platform, payload);
      }
      if (platform === "web" && webOn) {
        return WebPushProvider.send(token, platform, payload);
      }
      return { delivered: false };
    },
  };
}
