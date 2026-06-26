import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncPlaidConnection } from "@/lib/plaid/sync";
import { verifyPlaidWebhook } from "@/lib/plaid/webhookVerify";

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
 * Signature verification: Plaid signs each request with an ES256 JWT
 * in the Plaid-Verification header. lib/plaid/webhookVerify checks
 * the signature against Plaid's published JWKS, the body SHA-256
 * against the JWT claim, and rejects JWTs older than 5 minutes. We
 * skip verification only when PLAID_WEBHOOK_SKIP_VERIFY=1, which is
 * intended for local development against the sandbox.
 */
export async function POST(req: NextRequest) {
  const admin = createServiceClient();
  const raw = await req.text();
  const skipVerify = process.env.PLAID_WEBHOOK_SKIP_VERIFY === "1";

  if (!skipVerify) {
    const result = await verifyPlaidWebhook(
      req.headers.get("plaid-verification"),
      raw,
    );
    if (!result.ok) {
      // 401 so Plaid retries (in case of a transient JWKS fetch
      // failure on our side). Plaid backs off automatically if we
      // keep returning 401 to a genuinely-bad request.
      return NextResponse.json(
        { error: "verification_failed", reason: result.reason },
        { status: 401 },
      );
    }
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
      // force: true — this webhook fires ONLY when Plaid has new
      // transaction data ready, so we must sync NOW and bypass the
      // monthly cost throttle in syncPlaidConnection. That throttle
      // exists to stop the blind DAILY CRON from making redundant
      // calls — not to ignore real update events. Without force the
      // throttle saw "already synced this calendar month" and skipped
      // every mid-month webhook, so the connected bank appeared to
      // stop pulling new transactions until the next month.
      await syncPlaidConnection(admin, conn.id, { force: true });
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
