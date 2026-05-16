// Production PushStore — Supabase service client (the standard
// validate-session-then-service-write pattern; RLS still protects
// direct session-client access). Kept behind the PushStore interface
// so lib/push/send.ts stays unit-testable with an in-memory fake.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PushStore, Platform } from "./send";
import type { PushPayload } from "./payloads";

export function createSupabasePushStore(admin: any): PushStore {
  return {
    async listActiveTokens(userId: string) {
      const { data } = await admin
        .from("device_tokens")
        .select("token, platform")
        .eq("user_id", userId)
        .is("revoked_at", null);
      return ((data ?? []) as { token: string; platform: Platform }[]).map(
        (r) => ({ token: r.token, platform: r.platform }),
      );
    },

    async claimDedupe(
      userId: string,
      dedupeKey: string,
      kind: string,
      payload: PushPayload,
    ) {
      // INSERT ... ON CONFLICT (user_id, dedupe_key) DO NOTHING, then
      // .select() — Supabase returns the inserted row only when this
      // call actually won the insert. Empty ⇒ already sent. This is
      // the atomic claim; no read-then-write race.
      const { data, error } = await admin
        .from("notification_log")
        .upsert(
          { user_id: userId, kind, dedupe_key: dedupeKey, payload },
          { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
        )
        .select("id");
      if (error) {
        // A unique violation here means a concurrent claim won — treat
        // as "already sent" (don't double-notify on the error path).
        return false;
      }
      return Array.isArray(data) && data.length > 0;
    },

    async revokeToken(userId: string, token: string) {
      await admin
        .from("device_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("token", token);
    },
  };
}
