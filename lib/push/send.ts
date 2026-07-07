// Send orchestration, dependency-injected so the core (dedupe +
// fan-out) is unit-tested with fakes and prod swaps in the Supabase
// store + the real APNs/FCM provider.

import { buildPayload, type PushEvent, type PushPayload } from "./payloads";

export type Platform = "ios" | "android" | "web";

export interface PushProvider {
  /** Deliver one payload to one token. Resolve with delivered:false
   *  (don't throw) on a soft failure so one dead token can't sink the
   *  whole fan-out. `invalidToken` asks the caller to revoke it. */
  send(
    token: string,
    platform: Platform,
    payload: PushPayload,
  ): Promise<{ delivered: boolean; invalidToken?: boolean }>;
}

export interface PushStore {
  listActiveTokens(
    userId: string,
  ): Promise<{ token: string; platform: Platform }[]>;
  /** Atomically claim the dedupe key. Returns true if THIS call won
   *  the claim (first time), false if it was already sent. */
  claimDedupe(
    userId: string,
    dedupeKey: string,
    kind: string,
    payload: PushPayload,
  ): Promise<boolean>;
  /** Mark a token dead (provider said it's invalid). */
  revokeToken(userId: string, token: string): Promise<void>;
}

export type SendResult = {
  /** false when the dedupe key was already claimed (no-op). */
  sent: boolean;
  /** Tokens the provider accepted. */
  delivered: number;
  /** Tokens the provider rejected as invalid (revoked). */
  revoked: number;
};

/**
 * Send `event` to every live device of `userId`, exactly once per
 * logical event. Dedupe is claimed BEFORE fan-out: a retry/duplicate
 * producer is a clean no-op, and a mid-send crash won't double-send
 * on the next attempt (the row is already there).
 */
export async function sendToUser(
  store: PushStore,
  provider: PushProvider,
  userId: string,
  event: PushEvent,
): Promise<SendResult> {
  const payload = buildPayload(event);

  const claimed = await store.claimDedupe(
    userId,
    payload.dedupeKey,
    event.kind,
    payload,
  );
  if (!claimed) return { sent: false, delivered: 0, revoked: 0 };

  const tokens = await store.listActiveTokens(userId);
  let delivered = 0;
  let revoked = 0;
  for (const t of tokens) {
    let res: { delivered: boolean; invalidToken?: boolean };
    try {
      res = await provider.send(t.token, t.platform, payload);
    } catch (e) {
      // A transport throw is treated as a soft miss, not a crash -
      // the notification_log row stays so we don't retry-storm; a
      // future "retry unconfirmed" job (out of Phase 1 scope) can
      // reconcile if we ever need delivery guarantees. Log the throw so
      // a silent per-token failure (e.g. a WIF/parse error the provider
      // didn't catch) is visible in the runtime logs.
      console.log(
        `[push] ${t.platform} threw: ${
          (e as Error)?.message ?? String(e)
        }`.slice(0, 200),
      );
      continue;
    }
    console.log(
      `[push] ${t.platform} delivered=${res.delivered} invalid=${!!res.invalidToken}`,
    );
    if (res.delivered) delivered++;
    if (res.invalidToken) {
      revoked++;
      try {
        await store.revokeToken(userId, t.token);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
  return { sent: true, delivered, revoked };
}
