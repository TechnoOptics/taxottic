// Public entry point for Phase-3 producers (trip done, expense
// applied, goal met, badge awarded, message). One call, fire-and-
// forget-safe: idempotent via notification_log, no-ops cleanly when
// no push credentials are configured.

import { createServiceClient } from "@/lib/supabase/server";
import { sendToUser, type SendResult } from "./send";
import { createSupabasePushStore } from "./store";
import { resolveProvider } from "./providers";
import type { PushEvent } from "./payloads";

export type { PushEvent } from "./payloads";

/**
 * Notify a user of an event across all their devices, exactly once.
 * Safe to call from a server action / route after the underlying
 * write commits. Never throws — a notification failure must not fail
 * the business operation that triggered it.
 */
export async function notify(
  userId: string,
  event: PushEvent,
): Promise<SendResult> {
  try {
    const store = createSupabasePushStore(createServiceClient());
    return await sendToUser(store, resolveProvider(), userId, event);
  } catch {
    return { sent: false, delivered: 0, revoked: 0 };
  }
}
