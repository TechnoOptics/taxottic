// Public entry point for Phase-3 producers (trip done, expense
// applied, goal met, badge awarded, message). One call, fire-and-
// forget-safe: idempotent via notification_log, no-ops cleanly when
// no push credentials are configured.

import { createServiceClient } from "@/lib/supabase/server";
import { sendToUser, type SendResult } from "./send";
import { createSupabasePushStore } from "./store";
import { resolveProvider } from "./providers";
import { eventParties, type PushEvent } from "./payloads";
import {
  screenOutbound,
  type OutboundRealmSource,
  type Recipient,
} from "@/lib/hq/outbound-allowlist";

export type { PushEvent } from "./payloads";

/**
 * Notify a user of an event across all their devices, exactly once.
 * Safe to call from a server action / route after the underlying
 * write commits. Never throws, a notification failure must not fail
 * the business operation that triggered it.
 *
 * Logs a structured `[push]` line on every call so docs/PUSH_NOTIFICATIONS_SETUP.md
 * verification ("watch Vercel logs after a drive") has something to
 * point at. The NoopProvider path (no creds) logs delivered=0 too,
 * which is the answer to "did my producer even fire?" without
 * needing to add a debug endpoint.
 */
export async function notify(
  userId: string,
  event: PushEvent,
): Promise<SendResult> {
  try {
    const admin = createServiceClient();

    // Fleet contract 6.5, the SMS/push/voice row: "Same rule, same chokepoint
    // shape, same allowlist" as transactional email. This is that chokepoint.
    // It runs BEFORE the dedupe claim, so a refused event is not recorded as
    // sent and does not burn its idempotency key.
    //
    // The parties are the recipient plus anyone the event is about, which for
    // the two manager alerts is the driver. Screening the recipient alone
    // could never refuse anything, because one recipient is always wholly on
    // one side of the boundary.
    //
    // A refusal is a drop, not a throw: notify() is documented as
    // fire-and-forget and 16 producers call it after a write has committed.
    const parties: Recipient[] = [
      { kind: "user", id: userId },
      ...eventParties(event).map((id) => ({ kind: "user" as const, id })),
    ];
    const screen = await screenOutbound(
      parties,
      () => admin as unknown as OutboundRealmSource,
    );
    if (!screen.allowed) {
      console.warn(
        `[hq-egress] push dropped kind=${event.kind} user=${userId} reason=${screen.reason}`,
      );
      return { sent: false, delivered: 0, revoked: 0 };
    }

    const store = createSupabasePushStore(admin);
    const result = await sendToUser(store, resolveProvider(), userId, event);
    console.log(
      `[push] ${event.kind} user=${userId} sent=${result.sent} delivered=${result.delivered} revoked=${result.revoked}`,
    );
    return result;
  } catch (err) {
    console.log(
      `[push] ${event.kind} user=${userId} error=${(err as Error)?.message ?? "unknown"}`,
    );
    return { sent: false, delivered: 0, revoked: 0 };
  }
}
