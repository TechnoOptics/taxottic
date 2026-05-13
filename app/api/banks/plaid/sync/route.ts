import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { syncPlaidConnection } from "@/lib/plaid/sync";
import { requireFeatureGate } from "@/lib/plans/gate";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Manual "Sync now" trigger. The same syncPlaidConnection runs from
 * the webhook handler when Plaid notifies us of new transactions; this
 * endpoint exists so the UI can offer a refresh button without having
 * to wait for Plaid's next webhook.
 *
 * Body: { connectionId: string }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  // Manual sync hits Plaid's /transactions/sync, which is a billable
  // call. Gate it so a downgraded-to-free user can't keep firing
  // syncs after their subscription ends.
  const gateFail = await requireFeatureGate(supabase, user.id, "bankConnect");
  if (gateFail) return gateFail;

  const body = await req.json().catch(() => ({}));
  const connectionId = body?.connectionId as string | undefined;
  if (!connectionId) {
    return NextResponse.json(
      { error: "connectionId required" },
      { status: 400 },
    );
  }

  // Confirm the connection belongs to a company the user can read.
  const { data: conn } = await supabase
    .from("bank_connections")
    .select("id, company_id")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createServiceClient();
  try {
    // force:true — this is the user-clicked "Sync now" button; if
    // they explicitly ask for fresh data, honour it even within the
    // same calendar month.
    const result = await syncPlaidConnection(admin, connectionId, { force: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    await admin
      .from("bank_connections")
      .update({
        status: "error",
        last_error: err instanceof Error ? err.message : String(err),
      })
      .eq("id", connectionId);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync_failed" },
      { status: 502 },
    );
  }
}
