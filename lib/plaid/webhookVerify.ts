import { createHash } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { getPlaidClient } from "./client";

/**
 * Plaid signs every webhook with a JWT in the Plaid-Verification
 * header. The JWT header carries a `kid` (key id); we fetch the
 * matching public JWK from Plaid's
 *   /webhook_verification_key/get
 * endpoint, verify the JWT signature with it, then check that the
 * SHA-256 of the raw request body matches the `request_body_sha256`
 * claim and that the JWT was issued recently.
 *
 * Verifying both the signature AND the body hash is what makes the
 * webhook tamper-evident: an attacker who replays a captured request
 * with a modified body fails the body-hash check; an attacker with no
 * valid JWT fails the signature check.
 *
 * Plaid docs reference:
 *   https://plaid.com/docs/api/webhooks/webhook-verification/
 *
 * The verification key is cached in-memory for 10 minutes per kid.
 * Plaid rotates keys infrequently and the JWT carries the kid, so a
 * stale-cache miss simply forces a fresh fetch.
 */

const KEY_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_AGE_SECONDS = 5 * 60;

type CachedKey = { jwk: JWK; expiresAt: number };
const keyCache = new Map<string, CachedKey>();

async function getVerificationKey(kid: string): Promise<JWK> {
  const cached = keyCache.get(kid);
  if (cached && cached.expiresAt > Date.now()) return cached.jwk;

  const plaid = getPlaidClient();
  if (!plaid) {
    throw new Error("plaid_not_configured");
  }
  // The plaid SDK's webhookVerificationKeyGet wraps the same endpoint
  // with the client_id + secret already attached. The response shape
  // is { key: { ...JWK fields } }.
  const { data } = await plaid.webhookVerificationKeyGet({ key_id: kid });
  const jwk = data.key as unknown as JWK;
  keyCache.set(kid, { jwk, expiresAt: Date.now() + KEY_CACHE_TTL_MS });
  return jwk;
}

export type WebhookVerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function verifyPlaidWebhook(
  jwtHeader: string | null,
  rawBody: string,
): Promise<WebhookVerifyResult> {
  if (!jwtHeader) return { ok: false, reason: "missing_verification_header" };

  let kid: string | undefined;
  try {
    const protectedHeader = decodeProtectedHeader(jwtHeader);
    if (protectedHeader.alg !== "ES256") {
      return { ok: false, reason: `unsupported_alg:${protectedHeader.alg}` };
    }
    kid = protectedHeader.kid;
  } catch {
    return { ok: false, reason: "malformed_jwt" };
  }
  if (!kid) return { ok: false, reason: "missing_kid" };

  let jwk: JWK;
  try {
    jwk = await getVerificationKey(kid);
  } catch (err) {
    return {
      ok: false,
      reason: `key_fetch_failed:${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  let claims: { iat?: number; request_body_sha256?: string };
  try {
    const key = await importJWK(jwk, "ES256");
    const { payload } = await jwtVerify(jwtHeader, key, {
      algorithms: ["ES256"],
    });
    claims = payload as typeof claims;
  } catch (err) {
    return {
      ok: false,
      reason: `signature_invalid:${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  // Plaid recommends rejecting JWTs older than 5 minutes to limit
  // replay windows. iat is in seconds.
  if (typeof claims.iat !== "number") {
    return { ok: false, reason: "missing_iat" };
  }
  const ageSec = Math.floor(Date.now() / 1000) - claims.iat;
  if (ageSec > MAX_AGE_SECONDS) {
    return { ok: false, reason: `expired:age=${ageSec}s` };
  }

  // Confirm the body hasn't been tampered with: hex-SHA256 of the raw
  // body string must match the claim.
  const expected = claims.request_body_sha256;
  if (typeof expected !== "string") {
    return { ok: false, reason: "missing_body_hash_claim" };
  }
  const actual = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (actual !== expected) {
    return { ok: false, reason: "body_hash_mismatch" };
  }

  return { ok: true };
}
