import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireFeatureGate } from "@/lib/plans/gate";
import { syncStripeConnection } from "@/lib/stripe-connect/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Manual "Sync now" trigger for a Stripe Connect connection. Same
 * shape as /api/banks/plaid/sync, so the UI button can call either
 * route depending on the connection's provider.
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

  // Bank-connect feature gate (paid plans only).
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

  // Confirm the connection is in a company the user can read; RLS on
  // bank_connections covers it via company_members.
  const { data: conn } = await supabase
    .from("bank_connections")
    .select("id, provider")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (conn.provider !== "stripe") {
    return NextResponse.json(
      { error: "wrong_provider", expected: "stripe", got: conn.provider },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  try {
    const result = await syncStripeConnection(admin, connectionId, {
      force: true,
    });
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
