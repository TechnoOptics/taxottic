import { SignJWT, jwtVerify } from "jose";

// CSRF state token for OAuth flows.
//
// When the firm preparer clicks "Connect Zoom", we mint a short-lived
// signed JWT containing { user_id, firm_id, provider, nonce } and
// pass it as the `state` query param. The provider echoes it back on
// the callback; we verify the signature + the embedded user_id
// against the current session before exchanging the auth code.
//
// Without this, a malicious site could trick a logged-in user into
// completing a `?code=...&state=...` callback that connects an
// attacker-controlled OAuth account to the victim's profile.

const ALG = "HS256";

function getSecret(): Uint8Array | null {
  const raw =
    process.env.OAUTH_STATE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw) return null;
  // Use TextEncoder to bytes; jose expects a Uint8Array key.
  return new TextEncoder().encode(raw);
}

export type StatePayload = {
  /** User the OAuth flow is for. Verified === auth.uid() on callback. */
  uid: string;
  /** Firm context the OAuth flow runs in. */
  fid: string;
  /** Provider id. */
  prov: "zoom" | "google" | "microsoft";
  /** Random per-flow nonce, defense in depth against replay. */
  n: string;
};

export async function signOauthState(
  payload: StatePayload,
): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  return await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

export async function verifyOauthState(
  token: string,
): Promise<StatePayload | null> {
  const secret = getSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALG],
    });
    if (
      typeof payload.uid !== "string" ||
      typeof payload.fid !== "string" ||
      typeof payload.prov !== "string" ||
      typeof payload.n !== "string"
    ) {
      return null;
    }
    if (
      payload.prov !== "zoom" &&
      payload.prov !== "google" &&
      payload.prov !== "microsoft"
    ) {
      return null;
    }
    return {
      uid: payload.uid,
      fid: payload.fid,
      prov: payload.prov,
      n: payload.n,
    };
  } catch {
    return null;
  }
}
