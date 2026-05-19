import { createServiceClient } from "@/lib/supabase/server";
import { sha256Hex } from "@/lib/watch/pair-crypto";

// Watch device-token auth. The watch authenticates server requests
// (snapshot pull, confirm) with `Authorization: Bearer <token>`. Only
// the SHA-256 of the token is stored (watch_devices.token_hash), so a
// DB leak can't be replayed. Resolution is service-role; clients
// never read the table.

/**
 * Resolve the account behind a watch bearer token, or null. Touches
 * last_seen_at so an idle device is visible for later pruning.
 * Revoked devices never resolve.
 */
export async function resolveWatchUserId(
  authHeader: string | null,
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const admin = createServiceClient();
  const { data } = await admin
    .from("watch_devices")
    .select("id,user_id,revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data?.user_id) return null;
  await admin
    .from("watch_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);
  return data.user_id as string;
}
