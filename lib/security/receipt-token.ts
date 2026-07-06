// Signed proof that a real receipt OCR scan happened (item 10 hardening).
//
// The manager receipt threshold is only meaningful if "a receipt was
// captured" cannot be self-asserted. Previously addExpense trusted a raw
// `receipt_captured=1` form field, so a crafted POST could skip the policy.
// Now the OCR route (app/api/receipts/extract) mints one of these HMAC tokens
// only after actually running an extraction for the user, and addExpense
// verifies it. Forging the token requires the server secret, so the only way
// to satisfy an over-threshold expense is to genuinely scan a receipt.
//
// Scope note: the token is bound to the user and a short expiry, not to a
// specific receipt image or amount, so within its window one scan can cover
// more than one expense. Full per-receipt substantiation (storing the image
// and linking receipt_url on the row) is the follow-up; this closes the
// forge-a-boolean bypass, which was the actual hole.

import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  return (
    process.env.HUMAN_CHECK_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "taxottic-receipt-token-dev-secret"
  );
}

const TTL_MS = 30 * 60 * 1000; // a scan covers expense entry for 30 minutes

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function sigEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export type ReceiptToken = { token: string; exp: number };

/** Mint a token proving `userId` just completed a real receipt scan. */
export function issueReceiptToken(userId: string, now: number): ReceiptToken {
  const exp = now + TTL_MS;
  return { token: sign(`receipt:${userId}:${exp}`), exp };
}

/** Verify a receipt token belongs to `userId`, is unexpired, and is genuine. */
export function verifyReceiptToken(
  userId: string,
  token: string,
  exp: number,
  now: number,
): boolean {
  if (!token || !Number.isFinite(exp) || now > exp) return false;
  return sigEqual(token, sign(`receipt:${userId}:${exp}`));
}
