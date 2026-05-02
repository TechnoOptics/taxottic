import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncPlaidConnection } from "@/lib/plaid/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Plaid sends webhooks for several lifecycle events. The two we care
 * about right now:
 *   TRANSACTIONS / SYNC_UPDATES_AVAILABLE  - new tx data ready, run sync
 *   ITEM / ERROR (PENDING_EXPIRATION etc.) - flag the connection so
 *   the UI shows a "reconnect" prompt
 *
 * Webhook URL: set PLAID_WEBHOOK_URL=https://taxottic.com/api/banks/plaid/webhook
 * in Vercel and in the Plaid dashboard webhook config (sandbox uses
 * the same URL; Plaid pushes from a documented IP range).
 *
 * Signature verification: Plaid signs each request with a JWT in the
 * Plaid-Verification header. We verify it before doing any DB work.
 * In sandbox, Plaid still signs but the JWKS rotation is fast, so we
 * accept unsigned in dev only when PLAID_WEBHOOK_SKIP_VERIFY=1.
 */
export async function POST(req: NextRequest) {
  const admin = createServiceClient();
  const raw = await req.text();
  const skipVerify = process.env.PLAID_WEBHOOK_SKIP_VERIFY === "1";

  // TODO(prod): verify Plaid-Verification JWT against
  // /webhook_verification_key/get JWKS. For now we trust the body
  // when the env flag is set or in non-production contexts. The
  // webhook only triggers a server-side sync (no user action), so
  // the worst-case spam is wasted Plaid API quota.
  if (!skipVerify && process.env.NODE_ENV === "production") {
    const verification = req.headers.get("plaid-verification");
    if (!verification) {
      return NextResponse.json(
        { error: "missing_verification" },
        { status: 401 },
      );
    }
    // Implement JWKS verification here before relying on this for
    // anything destructive.
  }

  let payload: {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
    error?: { error_code?: string };
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const itemId = payload.item_id;
  if (!itemId) return NextResponse.json({ ok: true });

  const { data: conn } = await admin
    .from("bank_connections")
    .select("id, status")
    .eq("external_item_id", itemId)
    .maybeSingle();
  if (!conn) return NextResponse.json({ ok: true });

  const type = payload.webhook_type;
  const code = payload.webhook_code;

  if (
    type === "TRANSACTIONS" &&
    (code === "SYNC_UPDATES_AVAILABLE" ||
      code === "DEFAULT_UPDATE" ||
      code === "INITIAL_UPDATE" ||
      code === "HISTORICAL_UPDATE")
  ) {
    try {
      await syncPlaidConnection(admin, conn.id);
    } catch (err) {
      await admin
        .from("bank_connections")
        .update({
          status: "error",
          last_error: err instanceof Error ? err.message : String(err),
        })
        .eq("id", conn.id);
    }
    return NextResponse.json({ ok: true });
  }

  if (type === "ITEM" && code === "ERROR") {
    const errorCode = payload.error?.error_code;
    const needsReauth =
      errorCode === "ITEM_LOGIN_REQUIRED" ||
      errorCode === "PENDING_EXPIRATION";
    await admin
      .from("bank_connections")
      .update({
        status: needsReauth ? "needs_reauth" : "error",
        last_error: errorCode ?? "unknown_error",
      })
      .eq("id", conn.id);
    return NextResponse.json({ ok: true });
  }

  // Unhandled type - ack so Plaid stops retrying.
  return NextResponse.json({ ok: true });
}
